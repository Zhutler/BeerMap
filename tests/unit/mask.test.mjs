import { test } from 'node:test';
import assert from 'node:assert/strict';
import pip from '@turf/boolean-point-in-polygon';
import { buildMask } from '../../build/mask.mjs';

const inside = (rings, [lat, lng]) => rings.some(r => pip([lng, lat], { type: 'Polygon', coordinates: [r.map(([a, b]) => [b, a])] }));

test('маска Украины: с Крымом, с запасом у берега, без соседей', () => {
  const rings = buildMask(['UKR']);
  const yes = { 'Одеса': [46.48, 30.73], 'Луцьк': [50.75, 25.33], 'Севастополь': [44.6, 33.52], 'Ужгород': [48.62, 22.29],
    'Одеса, пляж Ланжерон': [46.4405, 30.7712] }; // Зміїного в Natural Earth 10m нет
  for (const [name, p] of Object.entries(yes)) assert.ok(inside(rings, p), name);
  const no = { 'Кишинів': [47.01, 28.86], 'Мінськ': [53.9, 27.56], 'Варшава': [52.23, 21.01] };
  for (const [name, p] of Object.entries(no)) assert.ok(!inside(rings, p), name);
});

test('Украина + Польша сливаются без шва', () => {
  const rings = buildMask(['UKR', 'POL']);
  assert.ok(inside(rings, [52.23, 21.01]), 'Варшава');
  assert.ok(inside(rings, [50.05, 23.95]), 'граница возле Рави-Руської');
  const big = rings.filter(r => r.length > 100);
  assert.equal(big.length, 1, 'материковая часть одним контуром');
});
