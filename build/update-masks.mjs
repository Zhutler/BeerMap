// Разовый скрипт: контуры стран для маски.
// Natural Earth admin_0 в версии с точки зрения Украины (Крым в составе Украины),
// раздуваем на 3 км наружу (чтобы маска не резала побережье), упрощаем и сохраняем в data/masks/<ISO3>.geojson.
//
//   node build/update-masks.mjs UKR POL
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import buffer from '@turf/buffer';
import simplify from '@turf/simplify';

const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ukr.geojson';
const CACHE = '.cache/ne_10m_admin_0_countries_ukr.geojson';
const BUFFER_KM = 3;
// Допуск упрощения ~0.004° ≈ 300–450 м: заметно меньше 3 км, поэтому контур не залезет обратно на берег
const TOLERANCE = 0.004;

const isos = process.argv.slice(2).map(s => s.toUpperCase());
if (!isos.length) { console.error('Укажи страны: node build/update-masks.mjs UKR POL'); process.exit(1); }

if (!existsSync(CACHE)) {
  console.log('Скачиваю Natural Earth…');
  const r = await fetch(SRC);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${SRC}`);
  mkdirSync('.cache', { recursive: true });
  writeFileSync(CACHE, await r.text());
}
const ne = JSON.parse(readFileSync(CACHE, 'utf8'));

const round = c => typeof c[0] === 'number' ? [+c[0].toFixed(4), +c[1].toFixed(4)] : c.map(round);

mkdirSync('data/masks', { recursive: true });
for (const iso of isos) {
  const f = ne.features.find(x => x.properties.ADM0_A3_UA === iso);
  if (!f) { console.error(`Нет страны ${iso} в Natural Earth`); process.exitCode = 1; continue; }
  const pre = simplify(f, { tolerance: 0.001, highQuality: true });
  const buf = buffer(pre, BUFFER_KM, { units: 'kilometers', steps: 4 });
  const out = simplify(buf, { tolerance: TOLERANCE, highQuality: true });
  out.geometry.coordinates = round(out.geometry.coordinates);
  out.properties = { iso, name: f.properties.NAME_UK || f.properties.NAME, source: 'Natural Earth ne_10m_admin_0_countries_ukr', bufferKm: BUFFER_KM };
  const path = `data/masks/${iso}.geojson`;
  writeFileSync(path, JSON.stringify(out));
  const pts = JSON.stringify(out.geometry.coordinates).split('],[').length;
  console.log(`${path}: ${out.geometry.type}, ~${pts} точек, ${(JSON.stringify(out).length / 1024).toFixed(0)} КБ`);
}
