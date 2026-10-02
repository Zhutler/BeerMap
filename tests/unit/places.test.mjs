import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { placeNameMatches, pickPlace, sheetIdFromUrl, fillPlaceIds } from '../../build/places.mjs';

test('названия: кириллица/латиница, лишние слова', () => {
  assert.ok(placeNameMatches('Honir', 'Гонір'));
  assert.ok(placeNameMatches('Punkraft Bar', 'Punkraft'));
  assert.ok(placeNameMatches('Drunken Duck Pub', 'Drunken Duck'));
  assert.ok(placeNameMatches('Бородате пиво', 'Бородате Пиво'));
  assert.ok(placeNameMatches('Shanson', 'Shanson Bar'));
  assert.ok(!placeNameMatches('Кораблик', 'Shanson Bar'));
  assert.ok(!placeNameMatches('Craft Beer Shop', 'VASCO craft beer'));
});

test('выбор карточки: название и не дальше 500 м от нашей точки', () => {
  const near = [46.4015, 30.7548];
  const list = [
    { id: 'far', displayName: { text: 'Shanson' }, location: { latitude: 46.48, longitude: 30.73 } },
    { id: 'other', displayName: { text: 'Кораблик' }, location: { latitude: 46.4006, longitude: 30.7548 } },
    { id: 'ok', displayName: { text: 'Shanson Bar' }, formattedAddress: 'Фонтанська дорога, 153', location: { latitude: 46.4016, longitude: 30.7549 } },
  ];
  assert.equal(pickPlace(list, { name: 'Shanson Bar', near }).id, 'ok');
  const none = pickPlace(list.slice(0, 2), { name: 'Shanson Bar', near });
  assert.equal(none.id, undefined);
  assert.match(none.reasons.join(';'), /м от нашей точки/);
});

test('id таблицы из ссылки на CSV', () => {
  assert.equal(sheetIdFromUrl('https://docs.google.com/spreadsheets/d/1jLWLh9hizyTO1xpQiyxV-J6WmY_bJn9fTRbx97szLe8/export?format=csv'), '1jLWLh9hizyTO1xpQiyxV-J6WmY_bJn9fTRbx97szLe8');
  assert.equal(sheetIdFromUrl('https://example.com/a.csv'), null);
});

test('полный цикл: нашли карточку, записали place_id в таблицу, второй раз из кеша', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = {
    GOOGLE_PLACES_API_KEY: 'k',
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'bot@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
  };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push(String(url));
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (String(url).includes('places:searchText')) {
      const q = JSON.parse(opts.body).textQuery;
      return json({ places: q.startsWith('Punkraft') ? [{ id: 'PID1', displayName: { text: 'Punkraft' }, formattedAddress: 'Ігорівська 14А', location: { latitude: 50.465, longitude: 30.518 } }] : [] });
    }
    if (String(url).includes('oauth2')) return json({ access_token: 't' });
    if (String(url).includes('fields=sheets')) return json({ sheets: [{ properties: { title: 'Точки' } }] });
    if (String(url).includes('values/')) return json({ values: [['name', 'type', 'city', 'street', 'house', 'old_street', 'instagram', 'gmaps_url', 'place_id']] });
    if (String(url).includes('values:batchUpdate')) { calls.push(opts.body); return json({}); }
    throw new Error('unexpected ' + url);
  };
  try {
    const client = { id: 'ld', sheetCsvUrl: 'https://docs.google.com/spreadsheets/d/1jLWLh9hizyTO1xpQiyxV-J6WmY_bJn9fTRbx97szLe8/export?format=csv' };
    const cities = { 'Київ': { bbox: [50.21, 30.23, 50.59, 30.83] } };
    const mk = () => [
      { row: 6, name: 'Punkraft', city: 'Київ', street: 'вулиця Ігорівська', house: '14А', placeId: '', gmapsUrl: '' },
      { row: 7, name: 'Nowhere', city: 'Київ', street: 'вулиця Х', house: '1', placeId: '', gmapsUrl: '' },
      { row: 8, name: 'Has', city: 'Київ', street: 'вулиця Х', house: '2', placeId: 'KEEP', gmapsUrl: '' },
    ];
    const places = mk();
    const located = new Map([[places[0], { lat: 50.4651, lng: 30.5181 }]]);
    const cache = {};
    const r = await fillPlaceIds({ client, places, located, cities, cache, env });
    assert.equal(places[0].placeId, 'PID1');
    assert.equal(places[2].placeId, 'KEEP');
    assert.equal(r.found.length, 1);
    assert.equal(r.notFound.length, 1);
    assert.equal(r.written, 1);
    assert.deepEqual(r.errors, []);
    const body = JSON.parse(calls.find(c => c.startsWith('{"valueInputOption"')));
    assert.deepEqual(body.data, [{ range: "'Точки'!I6", values: [['PID1']] }]);

    // второй прогон: из кеша, без запросов к Places, ненайденное не ищем снова 30 дней
    calls.length = 0;
    const places2 = mk();
    await fillPlaceIds({ client, places: places2, located: new Map(), cities, cache, env });
    assert.equal(places2[0].placeId, 'PID1');
    assert.equal(calls.filter(c => c.includes('places:searchText')).length, 0);
  } finally { globalThis.fetch = realFetch; }
});
