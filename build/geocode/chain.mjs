// Координаты для точек: таблица (lat/lng) → кеш → провайдеры по очереди (street, затем old_street).
import { rejectReason, poiRejectReason, cacheKey, inBbox } from './match.mjs';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Находит bbox для всех городов. Неизвестный город ищем в Nominatim (если он есть среди провайдеров)
 * и принимаем только однозначный результат. Новые записи добавляются в cities (auto: true).
 */
export async function resolveCities(places, { cities, country, providers, offline }) {
  const failures = [];
  const nom = providers.find(p => p.city);
  for (const city of [...new Set(places.map(p => p.city))]) {
    if (cities[city]) continue;
    if (offline || !nom) { failures.push({ city, msg: 'нет bbox в data/cities.json' }); continue; }
    try {
      let found = (await nom.city(city, country)).filter(c => c.name?.toLowerCase() === city.toLowerCase());
      // несколько совпадений, но город среди них один (остальное сёла/районы): берём город
      if (found.length > 1 && found.filter(c => c.type === 'city').length === 1) found = found.filter(c => c.type === 'city');
      if (found.length === 1) {
        const b = found[0].bbox;
        const m = 0.01; // ~1 км запаса
        cities[city] = { country, bbox: [b[0] - m, b[1] - m, b[2] + m, b[3] + m].map(x => +x.toFixed(4)), auto: true, source: found[0].label };
      } else {
        failures.push({ city, msg: found.length ? `неоднозначно (${found.map(f => f.label).join(' / ')}), добавь bbox вручную в data/cities.json` : 'город не найден, добавь bbox вручную в data/cities.json' });
      }
    } catch (e) {
      failures.push({ city, msg: `ошибка поиска города: ${e.message}` });
    }
  }
  return failures;
}

/**
 * places: из parseSheet (только active). cities: { name: { bbox } }. cache: объект, мутируется.
 * Возвращает { located: Map(place → {lat,lng,source,exact}), failures: [...], used: Set(cacheKey) }.
 */
export async function locateAll(places, { cities, cache, providers, country, offline = false, log = () => {} }) {
  const located = new Map();
  const failures = [];
  const used = new Set();

  for (const p of places) {
    const bbox = cities[p.city]?.bbox;
    if (!bbox) { failures.push({ place: p, attempts: [{ provider: '-', reason: `нет bbox для города «${p.city}»` }] }); continue; }

    // 1. Ручные координаты из таблицы главнее всего
    if (p.lat != null) {
      if (inBbox(bbox, p.lat, p.lng)) located.set(p, { lat: p.lat, lng: p.lng, source: 'sheet' });
      else {
        const swapped = inBbox(bbox, p.lng, p.lat) ? ' Похоже, lat и lng перепутаны местами.' : '';
        failures.push({ place: p, attempts: [{ provider: 'таблица', reason: `lat/lng (${p.lat}, ${p.lng}) вне города «${p.city}».${swapped}` }] });
      }
      continue;
    }

    // 2. Кеш
    const key = cacheKey(p);
    used.add(key);
    const hit = cache[key];
    if (hit && inBbox(bbox, hit.lat, hit.lng)) { located.set(p, { lat: hit.lat, lng: hit.lng, source: `cache:${hit.source}` }); continue; }

    if (offline) { failures.push({ place: p, attempts: [{ provider: '-', reason: 'нет в кеше (офлайн-сборка)' }] }); continue; }

    // 3. Провайдеры: каждый пробует street, потом old_street
    const attempts = [];
    let found = null;
    const streets = [p.street, p.oldStreet].filter(Boolean);
    const usable = providers.filter(x => x.supports(country));
    // 3a. Сначала заведение по названию: точнее адреса, если в одном доме несколько мест
    for (const prov of usable.filter(x => x.searchPlace)) {
      if (found) break;
      let cands;
      try { cands = await prov.searchPlace({ name: p.name, city: p.city, bbox, country }); }
      catch (e) { attempts.push({ provider: `${prov.name} (название)`, reason: `ошибка: ${e.message}` }); continue; }
      const reasons = [];
      for (const c of cands) {
        const r = [p.street, p.oldStreet].filter(Boolean).map(street => poiRejectReason(c, { name: p.name, street, house: p.house, bbox }));
        if (r.some(x => !x)) { found = { c, prov: `${prov.name}-poi`, street: p.street, approx: false }; break; }
        reasons.push(r[0]);
      }
      if (!found) attempts.push({ provider: `${prov.name} (название)`, reason: cands.length ? [...new Set(reasons)].slice(0, 3).join('; ') : 'ничего не найдено' });
    }
    // 3b. Потом адрес
    outer: for (const prov of found ? [] : usable) {
      for (const street of streets) {
        let cands;
        try { cands = await prov.search({ city: p.city, street, house: p.house, bbox, country }); }
        catch (e) { attempts.push({ provider: prov.name, street, reason: `ошибка: ${e.message}` }); continue; }
        if (!cands.length) { attempts.push({ provider: prov.name, street, reason: 'ничего не найдено' }); continue; }
        // Сначала точный дом; если его нет, тот же номер без литеры (5-Б → 5) на той же улице.
        // Для old_street улица в ответе может совпадать со старым или новым названием.
        const reasons = [];
        for (const loose of [false, true]) {
          for (const c of cands) {
            const r = rejectReason(c, { street, house: p.house, bbox, loose });
            const r2 = r && street !== p.street ? rejectReason(c, { street: p.street, house: p.house, bbox, loose }) : r;
            if (!r || !r2) { found = { c, prov: prov.name, street, approx: loose }; break; }
            if (!loose) reasons.push(r);
          }
          if (found) break;
        }
        if (found) break outer;
        attempts.push({ provider: prov.name, street, reason: [...new Set(reasons)].slice(0, 3).join('; ') });
      }
    }

    if (found) {
      const { c } = found;
      cache[key] = { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), source: found.prov, matched: c.label || `${c.street} ${c.house}`, query: found.street, ...(found.approx && { houseApprox: true }), at: today() };
      located.set(p, { lat: cache[key].lat, lng: cache[key].lng, source: found.prov });
      log(`  ✓ ${p.name}, ${p.street} ${p.house} → ${found.prov}${found.street !== p.street ? ' (по старому названию)' : ''}${found.approx ? ` (дом ${c.house}, без литеры)` : ''}`);
    } else {
      failures.push({ place: p, attempts });
      log(`  ✗ ${p.name}, ${p.street} ${p.house}`);
    }
  }
  return { located, failures, used };
}

/** Отчёт об ошибках в Markdown (для консоли и сводки GitHub Actions) */
export function failureReport(clientId, { sheetErrors = [], cityFailures = [], failures = [] }) {
  const esc = s => String(s ?? '').replace(/\|/g, '\\|');
  const out = [`### ❌ ${clientId}: проверь эти строки таблицы`, ''];
  if (sheetErrors.length) {
    out.push('**Ошибки в таблице**', '', '| Строка | Название | Что не так |', '|---|---|---|');
    sheetErrors.forEach(e => out.push(`| ${e.row} | ${esc(e.name)} | ${esc(e.msg)} |`));
    out.push('');
  }
  if (cityFailures.length) {
    out.push('**Города без bbox**', '', '| Город | Что не так |', '|---|---|');
    cityFailures.forEach(f => out.push(`| ${esc(f.city)} | ${esc(f.msg)} |`));
    out.push('');
  }
  if (failures.length) {
    out.push('**Адреса не найдены**', '', 'Проверь адрес в таблице или впиши координаты вручную в колонки lat/lng.', '',
      '| Строка | Название | Адрес | Что пробовали |', '|---|---|---|---|');
    failures.forEach(({ place: p, attempts }) => {
      const osm = `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${p.street} ${p.house}, ${p.city}`)}`;
      const tried = attempts.map(a => `${a.provider}${a.street ? ` «${a.street}»` : ''}: ${a.reason}`).join('<br>');
      out.push(`| ${p.row} | ${esc(p.name)} | [${esc(`${p.city}, ${p.street}, ${p.house}`)}](${osm}) | ${esc(tried)} |`);
    });
  }
  return out.join('\n');
}
