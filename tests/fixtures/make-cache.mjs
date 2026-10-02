// Тестовый кеш с ПРИМЕРНЫМИ координатами (только для локальных e2e-тестов, на карту не попадает).
import { writeFileSync, readFileSync } from 'node:fs';
import { parseSheet } from '../../build/sheet.mjs';
import { cacheKey } from '../../build/geocode/match.mjs';
const approx = {
  'Балківська': [46.4662, 30.7104], 'Головківська': [46.4687, 30.7166], 'Болгарська': [46.4745, 30.7128],
  'Степова': [46.4718, 30.7196], 'Перлинна': [46.4306, 30.7605], 'Фонтанська': [46.3955, 30.7480],
  'Чикаленка': [46.3870, 30.7232], 'Ніжинська': [46.4690, 30.7290], 'Гаванна': [46.4840, 30.7400],
  'Кінна': [46.4736, 30.7279], 'Самофалова': [46.4029, 30.7182], 'Вадатурського': [46.4535, 30.6998],
  'Чорновола': [50.7536, 25.3342], 'Привокзальна': [50.7518, 25.3563], 'Франка': [50.7400, 25.3095], 'Рівненська': [50.7478, 25.3468],
};
const { places } = parseSheet(readFileSync(new URL('./nizashcho-myla.csv', import.meta.url), 'utf8'));
const cache = {};
for (const p of places) {
  const k = Object.keys(approx).find(s => p.street.includes(s));
  if (k && p.lat == null) cache[cacheKey(p)] = { lat: approx[k][0], lng: approx[k][1], source: 'test-approx' };
}
writeFileSync(new URL('./geocache.json', import.meta.url), JSON.stringify(cache, null, 1) + '\n');
console.log(Object.keys(cache).length, 'entries');
