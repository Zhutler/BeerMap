// Сценарии живых людей на карте Loca Deserta (тестовая таблица tests/fixtures/loca-deserta.csv).
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

const clients = process.env.CLIENTS
  ? process.env.CLIENTS.split(',')
  : existsSync('dist/build-result.json') ? JSON.parse(readFileSync('dist/build-result.json', 'utf8')).ok : [];
test.skip(!clients.includes('loca-deserta'), 'нужна собранная loca-deserta');

const LVIV = [49.76, 23.9, 49.9, 24.13], ODESA = [46.3, 30.55, 46.66, 30.86], KHARKIV = [49.88, 36.1, 50.1, 36.46];
const inBox = (b, [lat, lng]) => lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3];

async function open(page, context, { query = '', geo } = {}) {
  if (geo) { await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude: geo[0], longitude: geo[1] }); }
  await page.goto(`/loca-deserta/${query}`);
  await page.waitForFunction(() => window.__beermap);
  await page.waitForTimeout(2500); // стартовый облёт
}
const view = page => page.evaluate(() => { const { map } = __beermap; const c = map.getCenter(); const b = map.getBounds();
  return { zoom: map.getZoom(), c: [c.lat, c.lng], b: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()] }; });
async function nearMe(page, isMobile) {
  await page.locator(isMobile ? '#fab' : '#near').click();
  await page.waitForTimeout(3000);
  return isMobile ? page.locator('#toast') : page.locator('#status');
}

test('фестиваль во Львове, QR ?city=Львів, человек из Харькова', async ({ page, context, isMobile }) => {
  await open(page, context, { query: '?city=Львів', geo: [49.8419, 24.0315] }); // площа Ринок
  let v = await view(page);
  expect(inBox(LVIV, v.c), 'стартует на Львове').toBe(true);
  expect(v.zoom).toBeGreaterThanOrEqual(12);
  await expect(page.locator('.city').first()).toHaveAttribute('data-city', 'Львів');

  const msg = await nearMe(page, isMobile);
  await expect(msg).toContainText(/Найближче: .+, \d+ м/); // в метрах, пешком
  v = await view(page);
  expect(v.zoom).toBeGreaterThanOrEqual(14);
  expect(inBox(LVIV, v.c)).toBe(true);

  // а где купить дома, в Харькове?
  if (isMobile) await page.evaluate(() => { document.getElementById('panel').dataset.open = 'true'; });
  await page.locator('#list button#byCity').click();
  await page.locator('#q').fill('Харків');
  await page.waitForTimeout(1200);
  await expect(page.locator('#list .place')).toHaveCount(1);
  await expect(page.locator('#list .place b')).toHaveText('VASCO craft beer');
  v = await view(page);
  expect(inBox(KHARKIV, v.c), 'поиск увёл карту в Харьков').toBe(true);
});

test('фестиваль в Одессе: одна точка в городе, камера на человеке, а не на всей Украине', async ({ page, context, isMobile }) => {
  await open(page, context, { query: '?city=Одеса', geo: [46.4846, 30.7326] }); // Дерибасівська
  expect(inBox(ODESA, (await view(page)).c)).toBe(true);
  const msg = await nearMe(page, isMobile);
  await expect(msg).toContainText('Hoppy Hog');
  const v = await view(page);
  expect(v.zoom).toBeGreaterThanOrEqual(13);
  expect(inBox(ODESA, v.c)).toBe(true);
});

test('нашёл на Untappd, дома в Полтаве: видно себя и ближайшую точку в другом городе', async ({ page, context, isMobile }) => {
  const home = [49.5883, 34.5514];
  await open(page, context, { geo: home });
  const msg = await nearMe(page, isMobile);
  await expect(msg).toContainText(/Найближче: VASCO craft beer, \d+ км/);
  const v = await view(page);
  expect(inBox(v.b, home), 'человек в кадре').toBe(true);
  expect(inBox(v.b, [49.9915, 36.23]), 'ближайшая точка в кадре').toBe(true);
  // список отсортирован по расстоянию
  if (isMobile) await page.evaluate(() => { document.getElementById('panel').dataset.open = 'true'; });
  await expect(page.locator('#list .place b').first()).toHaveText('VASCO craft beer');
});

test('геолокация запрещена: понятное сообщение, карта жива', async ({ page, context, isMobile }) => {
  await open(page, context);
  await context.clearPermissions();
  const msg = await nearMe(page, isMobile);
  await expect(msg).toContainText(/заборонено|Не вдалося/);
  expect((await view(page)).zoom).toBeGreaterThan(4);
});

test('QR с неизвестным городом не ломает карту', async ({ page, context }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page, context, { query: '?city=Мукачево' });
  expect(errors).toEqual([]);
  expect(inBox(LVIV, (await view(page)).c), 'главный город по умолчанию').toBe(true);
});
