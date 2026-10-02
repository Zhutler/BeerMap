import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSheet, parseNumber, parseInstagram, parseActive } from '../../build/sheet.mjs';

const HEAD = 'name,type,city,street,house,old_street,instagram,gmaps_url,place_id,lat,lng,note,active\n';

test('фикстура «Нізащо Мила» разбирается без ошибок', () => {
  const { places, errors } = parseSheet(readFileSync(new URL('../fixtures/nizashcho-myla.csv', import.meta.url), 'utf8'));
  assert.deepEqual(errors, []);
  assert.equal(places.length, 17);
  const budu = places[1];
  assert.equal(budu.lat, 46.472463);
  assert.equal(budu.lng, 30.7105);
  assert.equal(budu.oldStreet, 'вулиця Середня');
  assert.equal(places.filter(p => p.type === 'bar').length, 2);
});

test('числа с запятой и точкой', () => {
  assert.equal(parseNumber('46,4724'), 46.4724);
  assert.equal(parseNumber(' 30.71 '), 30.71);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('abc')));
});

test('instagram: ссылка, @ник, ник', () => {
  assert.equal(parseInstagram('https://www.instagram.com/budupivo/?hl=uk'), 'budupivo');
  assert.equal(parseInstagram('@budupivo'), 'budupivo');
  assert.equal(parseInstagram('budupivo'), 'budupivo');
});

test('active: только явное «нет» выключает', () => {
  for (const v of ['FALSE', 'false', 'ні', '0', 'no']) assert.equal(parseActive(v), false, v);
  for (const v of ['TRUE', '', 'так', '1']) assert.equal(parseActive(v), true, v);
});

test('ошибки в строках с номером строки таблицы', () => {
  const csv = HEAD
    + 'A,wine,Одеса,вулиця X,1,,,,,,,,\n'
    + ',shop,Одеса,вулиця X,2,,,,,,,,\n'
    + 'B,shop,Одеса,вулиця X,3,,,,,46.4,,,\n'
    + 'C,бар,Одеса,вулиця X,4,,,,,,,,\n'
    + 'C,bar,Одеса,вулиця X,4,,,,,,,,\n';
  const { places, errors } = parseSheet(csv);
  assert.deepEqual(errors.map(e => e.row), [2, 3, 4, 6]);
  assert.match(errors[0].msg, /type «wine»/);
  assert.match(errors[2].msg, /только одно из lat\/lng/);
  assert.match(errors[3].msg, /дубль строки 5/);
  assert.equal(places.find(p => p.name === 'C').type, 'bar');
});

test('выключенные строки не валидируются и не мешают', () => {
  const csv = HEAD + 'A,,Одеса,,,,,,,,,,FALSE\nB,shop,Одеса,вулиця X,1,,,,,,,,\n';
  const { places, errors } = parseSheet(csv);
  assert.deepEqual(errors, []);
  assert.deepEqual(places.map(p => p.name), ['B']);
});

test('нет обязательных колонок', () => {
  const { errors } = parseSheet('name,city\nA,Одеса\n');
  assert.match(errors[0].msg, /нет колонок: type, street, house/);
});
