import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fill, toClientPlace } from '../../build/render.mjs';
import { loadClient, listClients } from '../../build/config.mjs';

test('шаблон: {{x}} экранируется, {{{x}}} нет, пропуск = ошибка', () => {
  assert.equal(fill('<b>{{a}}</b>{{{b}}}', { a: '<i>&', b: '<i>' }), '<b>&lt;i&gt;&amp;</b><i>');
  assert.throws(() => fill('{{nope}}', {}), /нет значения/);
});

test('точка для браузера: только нужные поля', () => {
  const p = { row: 2, name: 'A', type: 'bar', city: 'Одеса', street: 'вулиця X', house: '1', oldStreet: '', instagram: 'a', gmapsUrl: '', placeId: 'P', note: '', active: true, lat: null, lng: null };
  assert.deepEqual(toClientPlace(p, { lat: 46.4, lng: 30.7 }), { name: 'A', type: 'bar', city: 'Одеса', street: 'вулиця X', house: '1', c: [46.4, 30.7], ig: 'a', placeId: 'P' });
});

test('все конфиги клиентов валидны', () => {
  for (const id of listClients()) {
    const c = loadClient(id);
    assert.ok(c.texts.mobileHeading, id);
  }
});
