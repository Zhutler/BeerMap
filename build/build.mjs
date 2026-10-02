// Сборка карт.
//   node build/build.mjs                    все клиенты
//   node build/build.mjs nizashcho-myla     один клиент
// Опции:
//   --offline          без сети: только ручные координаты и кеш
//   --csv <file>       взять таблицу из файла (только для одного клиента)
//   --cache <file>     другой файл кеша (по умолчанию data/geocache.json)
//   --out <dir>        папка результата (по умолчанию dist)
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { listClients, loadClient } from './config.mjs';
import { fetchCsv, parseSheet } from './sheet.mjs';
import { providersFromEnv } from './geocode/providers.mjs';
import { resolveCities, locateAll, failureReport } from './geocode/chain.mjs';
import { cacheKey } from './geocode/match.mjs';
import { buildMask } from './mask.mjs';
import { renderClient, toClientPlace } from './render.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const offline = flag('--offline');
const csvFile = opt('--csv');
const cachePath = opt('--cache') || 'data/geocache.json';
const citiesPath = opt('--cities') || 'data/cities.json';
const outRoot = opt('--out') || 'dist';
const ids = args.length ? args : listClients();
if (csvFile && ids.length !== 1) { console.error('--csv работает только с одним клиентом'); process.exit(2); }

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const sortKeys = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
const cache = readJson(cachePath);
const cities = readJson(citiesPath);
const save = () => {
  writeFileSync(cachePath, JSON.stringify(sortKeys(cache), null, 1) + '\n');
  writeFileSync(citiesPath, JSON.stringify(sortKeys(cities), null, 2) + '\n');
};
const summary = md => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n\n'); };

const providers = offline ? [] : providersFromEnv();
if (!offline) console.log(`Геокодеры: ${providers.map(p => p.name).join(' → ')}`);

const result = { ok: [], failed: [] };
const usedKeys = new Set();
let allSheetsRead = true;

for (const id of ids) {
  console.log(`\n=== ${id} ===`);
  try {
    const client = loadClient(id);
    const text = csvFile ? readFileSync(csvFile, 'utf8') : await fetchCsv(client.sheetCsvUrl);
    const { places: all, errors: sheetErrors } = parseSheet(text);
    all.forEach(p => usedKeys.add(cacheKey(p))); // включая выключенные: их кеш не чистим
    const places = all.filter(p => p.active);
    console.log(`Таблица: ${all.length} строк, активных ${places.length}`);

    const country = client.countries[0];
    const cityFailures = await resolveCities(places, { cities, country, providers, offline });
    const { located, failures } = await locateAll(places, { cities, cache, providers, country, offline, log: console.log });
    save(); // найденное сохраняем, даже если что-то не нашлось

    if (sheetErrors.length || cityFailures.length || failures.length) {
      const md = failureReport(id, { sheetErrors, cityFailures, failures });
      console.error('\n' + md);
      summary(md);
      result.failed.push(id);
      continue;
    }

    const clientPlaces = places.map(p => toClientPlace(p, located.get(p)));
    const mask = buildMask(client.countries);
    const outDir = join(outRoot, id);
    renderClient({ client, places: clientPlaces, cities, mask, outDir });
    const bySource = {};
    for (const v of located.values()) { const s = v.source.split(':')[0]; bySource[s] = (bySource[s] || 0) + 1; }
    console.log(`Готово: ${outDir} (${clientPlaces.length} точек; ${Object.entries(bySource).map(([k, v]) => `${k}: ${v}`).join(', ')})`);
    summary(`### ✅ ${id}: ${clientPlaces.length} точек`);
    result.ok.push(id);
  } catch (e) {
    allSheetsRead = false;
    console.error(`✗ ${id}: ${e.message}`);
    summary(`### ❌ ${id}\n\n${e.message}`);
    result.failed.push(id);
  }
}

// Чистим кеш от адресов, которых нет ни в одной таблице (только если прочитали все таблицы)
if (!args.length && !csvFile && allSheetsRead && !offline) {
  let removed = 0;
  for (const k of Object.keys(cache)) if (!usedKeys.has(k)) { delete cache[k]; removed++; }
  if (removed) console.log(`\nКеш: удалено ${removed} неиспользуемых адресов`);
}
save();

mkdirSync(outRoot, { recursive: true });
writeFileSync(join(outRoot, 'build-result.json'), JSON.stringify(result, null, 2));
console.log(`\nСобрано: ${result.ok.join(', ') || '-'}${result.failed.length ? `; с ошибками: ${result.failed.join(', ')}` : ''}`);
process.exit(result.failed.length ? 1 : 0);
