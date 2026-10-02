import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streetMismatch, houseMismatch, houseVariants, normHouse, rejectReason, cacheKey, nameMatches, poiRejectReason } from '../../build/geocode/match.mjs';
import { parseVisicom, parseMaptiler, parseNominatim } from '../../build/geocode/providers.mjs';
import { locateAll, failureReport } from '../../build/geocode/chain.mjs';

const ODESA = [46.30, 30.55, 46.66, 30.86];

test('улицы: совпадения', () => {
  assert.equal(streetMismatch('Балківська вулиця', 'вулиця Балківська'), null);
  assert.equal(streetMismatch('вул. Свища', 'вулиця Олександра Свища'), null);
  assert.equal(streetMismatch('Фонтанська дорога', 'Фонтанська дорога'), null);
  assert.equal(streetMismatch('вулиця В’ячеслава Самофалова', "вулиця В'ячеслава Самофалова"), null);
  assert.equal(streetMismatch('Академіка Вільямса', 'вулиця Академіка Вільямса'), null);
  assert.equal(streetMismatch('вулиця Ніжинської', 'вулиця Ніжинська'), null);
});

test('улицы: несовпадения', () => {
  assert.match(streetMismatch('вулиця Головна', 'вулиця Головківська'), /другая улица/);
  assert.match(streetMismatch('Ніжинський провулок', 'вулиця Ніжинська'), /другой тип/);
  assert.match(streetMismatch('', 'вулиця Кінна'), /нет названия/);
  assert.match(streetMismatch('вулиця Івана Франка', 'вулиця Петра Франка'), /другая улица/);
});

test('номера домов', () => {
  assert.equal(normHouse('5-Б'), '5б');
  assert.equal(normHouse('87 a'), '87а'); // латинская a
  assert.deepEqual(houseVariants('16а/2'), ['16а/2', '16а']);
  assert.equal(houseMismatch('16-А', '16а/2'), null);
  assert.equal(houseMismatch('30;32', '30'), null);
  assert.match(houseMismatch('', '30'), /уровня улицы/);
  assert.match(houseMismatch('31', '30'), /другой дом/);
});

test('кандидат: центр города и точки вне bbox отбрасываются', () => {
  const want = { street: 'вулиця Кінна', house: '22', bbox: ODESA };
  assert.match(rejectReason({ kind: 'city', lat: 46.48, lng: 30.72, street: '', house: '' }, want), /нужен адрес/);
  assert.match(rejectReason({ kind: 'address', lat: 50.45, lng: 30.52, street: 'Кінна', house: '22' }, want), /вне города/);
  assert.equal(rejectReason({ kind: 'address', lat: 46.47, lng: 30.73, street: 'Кінна вулиця', house: '22' }, want), null);
});

test('ключ кеша не зависит от записи', () => {
  assert.equal(cacheKey({ city: 'Одеса', street: 'вул. Перлинна', house: '5-Б' }), cacheKey({ city: 'одеса', street: 'вулиця  Перлинна', house: '5б' }));
  assert.notEqual(cacheKey({ city: 'Одеса', street: 'вулиця Перлинна', house: '5' }), cacheKey({ city: 'Одеса', street: 'вулиця Перлинна', house: '7' }));
});

test('разбор ответов провайдеров', () => {
  const v = parseVisicom({ type: 'Feature', properties: { categories: 'adr_address', name: '30', street: 'Балківська', street_type: 'вул.', settlement: 'Одеса' }, geometry: { type: 'Point', coordinates: [30.71, 46.46] } });
  assert.deepEqual(v[0], { lat: 46.46, lng: 30.71, kind: 'address', street: 'вул. Балківська', house: '30', label: 'Одеса вул. Балківська 30' });
  const v2 = parseVisicom({ type: 'FeatureCollection', features: [{ properties: { categories: 'adr_address', name: '1' }, geometry: { type: 'Polygon' }, geo_centroid: { type: 'Point', coordinates: [30, 46] } }] });
  assert.equal(v2[0].lat, 46);
  const m = parseMaptiler({ features: [{ place_type: ['address'], text: 'Кінна вулиця', address: '22', center: [30.73, 46.47], place_name: 'Кінна вулиця 22, Одеса' }] });
  assert.equal(m[0].kind, 'address'); assert.equal(m[0].house, '22');
  const n = parseNominatim([{ lat: '46.47', lon: '30.73', addresstype: 'building', address: { road: 'Кінна вулиця', house_number: '22' } }, { lat: '46.48', lon: '30.72', addresstype: 'city', address: {} }]);
  assert.equal(n[0].kind, 'address'); assert.equal(n[1].kind, 'city');
});

// Фейковый провайдер: отвечает по словарю «улица → кандидаты»
const fake = (name, table, calls = []) => ({
  name, supports: () => true,
  async search(q) { calls.push(`${name}:${q.street}`); return table[q.street] || []; },
});
const P = (o) => ({ row: 2, name: 'X', type: 'shop', city: 'Одеса', house: '1', oldStreet: '', lat: null, lng: null, ...o });
const cities = { 'Одеса': { bbox: ODESA } };

test('цепочка: ручные координаты главнее, кеш, старое название, фолбэк', async () => {
  const calls = [];
  const good = (street, house) => [{ kind: 'address', lat: 46.47, lng: 30.73, street, house }];
  const primary = fake('visicom', { 'вулиця Нова': [{ kind: 'street', lat: 46.48, lng: 30.72, street: 'Нова', house: '' }] }, calls);
  const fallback = fake('nominatim', { 'вулиця Стара': good('Стара вулиця', '1'), 'вулиця Друга': good('Друга', '5') }, calls);
  const cache = { [cacheKey({ city: 'Одеса', street: 'вулиця Кешована', house: '1' })]: { lat: 46.4, lng: 30.7, source: 'visicom' } };
  const places = [
    P({ street: 'вулиця Ручна', lat: 46.45, lng: 30.75 }),
    P({ street: 'вулиця Кешована' }),
    P({ street: 'вулиця Нова', oldStreet: 'вулиця Стара' }),
    P({ street: 'вулиця Друга', house: '5' }),
  ];
  const { located, failures } = await locateAll(places, { cities, cache, providers: [primary, fallback], country: 'UKR' });
  assert.equal(failures.length, 0);
  assert.equal(located.get(places[0]).source, 'sheet');
  assert.equal(located.get(places[1]).source, 'cache:visicom');
  assert.equal(located.get(places[2]).source, 'nominatim');
  // порядок: провайдер с ключом (street, old_street), затем Nominatim (street, old_street)
  assert.deepEqual(calls.slice(0, 4), ['visicom:вулиця Нова', 'visicom:вулиця Стара', 'nominatim:вулиця Нова', 'nominatim:вулиця Стара']);
  assert.equal(Object.keys(cache).length, 3); // добавились 2 новых
});

test('цепочка: ненайденный адрес и перепутанные lat/lng попадают в отчёт', async () => {
  const prov = fake('nominatim', { 'вулиця Кінна': [{ kind: 'address', lat: 46.47, lng: 30.73, street: 'Кінна', house: '24' }] });
  const places = [P({ street: 'вулиця Кінна', house: '22' }), P({ row: 3, street: 'вулиця Ручна', lat: 30.75, lng: 46.45 })];
  const { failures } = await locateAll(places, { cities, cache: {}, providers: [prov], country: 'UKR' });
  assert.equal(failures.length, 2);
  assert.match(failures[0].attempts[0].reason, /другой дом/);
  assert.match(failures[1].attempts[0].reason, /перепутаны/);
  const md = failureReport('test', { failures });
  assert.match(md, /\| 3 \| X \|/);
  assert.match(md, /openstreetmap\.org\/search/);
});

test('офлайн-сборка не ходит в сеть', async () => {
  const calls = [];
  const { failures } = await locateAll([P({ street: 'вулиця Кінна' })], { cities, cache: {}, providers: [fake('n', {}, calls)], country: 'UKR', offline: true });
  assert.equal(calls.length, 0);
  assert.match(failures[0].attempts[0].reason, /офлайн/);
});

test('дом без литеры: только как запасной вариант', async () => {
  assert.deepEqual(houseVariants('5-Б', true), ['5б', '5']);
  assert.deepEqual(houseVariants('16а/2', true), ['16а/2', '16а', '16']);
  assert.match(houseMismatch('5', '5-Б'), /другой дом/); // строго нельзя
  assert.equal(houseMismatch('5', '5-Б', true), null);   // запасной вариант можно
  assert.match(houseMismatch('7', '5-Б', true), /другой дом/);
  // точный дом главнее, даже если в ответе он второй
  const cands = [{ kind: 'address', lat: 46.43, lng: 30.76, street: 'Перлинна', house: '5' },
    { kind: 'address', lat: 46.431, lng: 30.761, street: 'Перлинна', house: '5-Б' }];
  const prov = { name: 'visicom', supports: () => true, search: async () => cands };
  const p = P({ street: 'вулиця Перлинна', house: '5-Б' });
  const cache = {};
  const { located } = await locateAll([p], { cities, cache, providers: [prov], country: 'UKR' });
  assert.equal(located.get(p).lat, 46.431);
  // без точного: берём «5» и помечаем в кеше
  const p2 = P({ street: 'вулиця Перлинна', house: '5-Б', row: 9 });
  const cache2 = {};
  const prov2 = { ...prov, search: async () => [cands[0]] };
  const r2 = await locateAll([p2], { cities, cache: cache2, providers: [prov2], country: 'UKR' });
  assert.equal(r2.located.get(p2).lat, 46.43);
  assert.equal(Object.values(cache2)[0].houseApprox, true);
});

test('заведение по названию: на нашей улице и главнее адреса', async () => {
  assert.ok(nameMatches('Shanson', 'Shanson Bar'));
  assert.ok(nameMatches('Бородате пиво', 'Бородате Пиво'));
  assert.ok(!nameMatches('Кораблик', 'Shanson Bar'));
  const want = { name: 'Shanson Bar', street: 'Фонтанська дорога', house: '153', bbox: ODESA };
  assert.equal(poiRejectReason({ lat: 46.4015, lng: 30.7548, name: 'Shanson Bar', street: 'Фонтанська дорога', house: '', category: 'amenity' }, want), null);
  assert.match(poiRejectReason({ lat: 46.47, lng: 30.73, name: 'Shanson Bar', street: 'Дерибасівська вулиця', house: '1', category: 'amenity' }, want), /друг(ая|ой тип) улиц/);
  // сеть: из нескольких филиалов берём тот, что на нашей улице
  const calls = [];
  const prov = {
    name: 'nominatim', supports: () => true,
    async searchPlace() { calls.push('poi'); return [
      { kind: 'poi', lat: 46.47, lng: 30.71, name: 'BuduPivo', street: 'Болгарська вулиця', house: '87а', category: 'shop' },
      { kind: 'poi', lat: 46.46, lng: 30.70, name: 'BuduPivo', street: 'Головківська вулиця', house: '25', category: 'shop' }]; },
    async search() { calls.push('addr'); return []; },
  };
  const p = P({ name: 'BuduPivo', street: 'вулиця Головківська', house: '25' });
  const { located } = await locateAll([p], { cities, cache: {}, providers: [prov], country: 'UKR' });
  assert.equal(located.get(p).lat, 46.46);
  assert.equal(located.get(p).source, 'nominatim-poi');
  assert.deepEqual(calls, ['poi']); // по адресу уже не искали
});
