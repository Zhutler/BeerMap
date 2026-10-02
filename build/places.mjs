// Карточки заведений в Google: для строк без place_id/gmaps_url находим place_id через Places API (New)
// и записываем его в таблицу клиента (сервисный аккаунт) и в кеш data/placeids.json.
// Координаты из Google на карту НЕ берём: только place_id для кнопки маршрута.
//
// Секреты: GOOGLE_PLACES_API_KEY (поиск), GOOGLE_SERVICE_ACCOUNT_JSON (запись в таблицу).
import { createSign } from 'node:crypto';
import { normText } from './geocode/match.mjs';

const TIMEOUT = 15000;
const NOT_FOUND_RETRY_DAYS = 30;
const MAX_DISTANCE_M = 500;

/* ---------- сравнение названий (кириллица ↔ латиница) ---------- */
const TR = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ъ: '', ё: 'e' };
const key = s => [...normText(s)].map(ch => TR[ch] ?? ch).join('')
  .replace(/[^a-z0-9]/g, '')
  .replace(/kh/g, 'h').replace(/y/g, 'i').replace(/w/g, 'v'); // гонір/honir, punkraft
const STOP = /^(bar|pub|pab|shop|craft|beer|piv|the)$/;
const words = s => normText(s).split(/[\s.,]+/).map(key).filter(w => w.length >= 3 && !STOP.test(w));

/** Название из Google совпадает с нашим: одно содержит другое, или общее значимое слово. */
export function placeNameMatches(found, ours) {
  const a = key(found), b = key(ours);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const wa = words(found), wb = words(ours);
  return wb.some(w => wa.some(v => v === w || (Math.min(v.length, w.length) >= 5 && (v.startsWith(w) || w.startsWith(v)))));
}

export function distanceM(a, b) {
  const R = 6371000, t = x => x * Math.PI / 180;
  const dLa = t(b[0] - a[0]), dLo = t(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Выбор карточки из ответа Places: название совпадает и рядом с нашей точкой. */
export const placeUrl = id => `https://www.google.com/maps/place/?q=place_id:${id}`;

export function pickPlace(places, { name, near }) {
  const reasons = [], candidates = [];
  for (const pl of places || []) {
    const dn = pl.displayName?.text || '';
    const d = near && pl.location ? Math.round(distanceM(near, [pl.location.latitude, pl.location.longitude])) : null;
    candidates.push({ id: pl.id, name: dn, address: pl.formattedAddress || '', distanceM: d });
    if (!placeNameMatches(dn, name)) { reasons.push(`«${dn}»: другое название`); continue; }
    if (d != null && d > MAX_DISTANCE_M) { reasons.push(`«${dn}»: ${d} м от нашей точки`); continue; }
    return { id: pl.id, name: dn, address: pl.formattedAddress || '' };
  }
  return { reasons, candidates: candidates.slice(0, 3) };
}

/* ---------- Places API (New): Text Search ---------- */
async function searchText(apiKey, { query, bbox }) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({
      textQuery: query, languageCode: 'uk', regionCode: 'UA', pageSize: 5,
      locationRestriction: { rectangle: { low: { latitude: bbox[0], longitude: bbox[1] }, high: { latitude: bbox[2], longitude: bbox[3] } } },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Places API HTTP ${r.status}: ${j.error?.message || ''}`.trim());
  return j.places || [];
}

/* ---------- Google Sheets: запись через сервисный аккаунт ---------- */
const b64url = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
async function sheetsToken(saJson) {
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64url(createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google auth: ${j.error_description || j.error || r.status}`);
  return { token: j.access_token, email: sa.client_email };
}

export const sheetIdFromUrl = url => (String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/) || [])[1] || null;

async function writePlaceIds(saJson, spreadsheetId, rows) {
  const { token, email } = await sheetsToken(saJson);
  const auth = { Authorization: `Bearer ${token}` };
  const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, { headers: auth, signal: AbortSignal.timeout(TIMEOUT) });
  const mj = await meta.json();
  if (!meta.ok) throw new Error(`таблица недоступна для ${email}: ${mj.error?.message || meta.status}. Дай ему доступ «Редактор».`);
  const tab = mj.sheets[0].properties.title.replace(/'/g, "''");
  // колонка place_id ищется по заголовку
  const hr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${tab}'!1:1`)}`, { headers: auth, signal: AbortSignal.timeout(TIMEOUT) });
  const header = ((await hr.json()).values || [[]])[0].map(h => String(h).trim().toLowerCase());
  const col = header.indexOf('place_id');
  if (col < 0) throw new Error('в таблице нет колонки place_id');
  const letter = String.fromCharCode(65 + col);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST', signal: AbortSignal.timeout(TIMEOUT),
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: rows.map(x => ({ range: `'${tab}'!${letter}${x.row}`, values: [[x.placeId]] })) }),
  });
  if (!r.ok) throw new Error(`запись в таблицу: ${(await r.json().catch(() => ({}))).error?.message || r.status}`);
}

/**
 * Для активных строк без place_id/gmaps_url ищет карточку и проставляет p.placeId.
 * cache: data/placeids.json (мутируется). Возвращает { found, notFound, written, errors }.
 */
export async function fillPlaceIds({ client, places, located, cities, cache, env = process.env, log = () => {} }) {
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  const res = { found: [], notFound: [], written: 0, errors: [] };
  const today = new Date().toISOString().slice(0, 10);
  const ck = p => `${client.id}|${p.name}|${p.city}|${p.street}|${p.house}`.toLowerCase();

  for (const p of places) {
    if (p.placeId || p.gmapsUrl) continue;
    const k = ck(p), hit = cache[k];
    if (hit?.placeId) { p.placeId = hit.placeId; res.found.push({ p, ...hit, fromCache: true }); continue; }
    if (!apiKey) continue;
    if (hit?.notFound && (Date.now() - Date.parse(hit.at)) / 864e5 < NOT_FOUND_RETRY_DAYS) { res.notFound.push({ p, reasons: [hit.reason], candidates: hit.candidates || [] }); continue; }
    const loc = located.get(p);
    try {
      const list = await searchText(apiKey, { query: `${p.name}, ${p.street} ${p.house}, ${p.city}`, bbox: cities[p.city].bbox });
      const pick = pickPlace(list, { name: p.name, near: loc && [loc.lat, loc.lng] });
      if (pick.id) {
        p.placeId = pick.id;
        cache[k] = { placeId: pick.id, googleName: pick.name, address: pick.address, at: today, newInSheet: true };
        res.found.push({ p, ...cache[k] });
        log(`  ✓ карточка: ${p.name} → «${pick.name}», ${pick.address}`);
      } else {
        const reason = pick.reasons.length ? pick.reasons.slice(0, 2).join('; ') : 'ничего не найдено';
        cache[k] = { notFound: true, reason, candidates: pick.candidates, at: today };
        res.notFound.push({ p, reasons: [reason], candidates: pick.candidates });
        log(`  ✗ карточка: ${p.name}: ${reason}`);
      }
    } catch (e) { res.errors.push(`${p.name}: ${e.message}`); }
  }

  // Новые place_id записываем в таблицу клиента
  const toWrite = res.found.filter(x => cache[ck(x.p)]?.newInSheet).map(x => ({ row: x.p.row, placeId: x.placeId, k: ck(x.p) }));
  const sid = sheetIdFromUrl(client.sheetCsvUrl);
  if (toWrite.length && env.GOOGLE_SERVICE_ACCOUNT_JSON && sid) {
    try {
      await writePlaceIds(env.GOOGLE_SERVICE_ACCOUNT_JSON, sid, toWrite);
      toWrite.forEach(x => { delete cache[x.k].newInSheet; });
      res.written = toWrite.length;
      log(`  Таблица: записано place_id для ${toWrite.length} строк`);
    } catch (e) { res.errors.push(e.message); }
  }
  return res;
}
