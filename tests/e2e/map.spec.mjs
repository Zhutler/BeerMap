// E2E-проверка собранных карт. Клиенты берутся из dist/build-result.json (успешно собранные)
// или из переменной CLIENTS=id1,id2.
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';

const clients = process.env.CLIENTS
  ? process.env.CLIENTS.split(',')
  : existsSync('dist/build-result.json') ? JSON.parse(readFileSync('dist/build-result.json', 'utf8')).ok : [];

// Хосты геокодеров: браузер посетителя не должен к ним обращаться
const GEOCODERS = /nominatim|photon\.komoot|visicom|maptiler|geocod|maps\.googleapis/i;

test('есть что проверять', () => { expect(clients.length, 'нет собранных клиентов в dist/').toBeGreaterThan(0); });

for (const id of clients) {
  test.describe(id, () => {
    let requests, pageErrors;

    test.beforeEach(async ({ page }) => {
      requests = []; pageErrors = [];
      page.on('request', r => requests.push(r.url()));
      page.on('pageerror', e => pageErrors.push(e.message));
      await page.goto(`/${id}/`);
      await page.waitForFunction(() => window.__beermap);
    });

    test('все точки на месте, без ошибок и без геокодинга в браузере', async ({ page }, info) => {
      // ждём, пока закончится стартовый облёт к главному городу
      await page.waitForTimeout(2500);
      const s = await page.evaluate(() => {
        const { map, cluster, markers, places } = __beermap;
        return { places: places.length, markers: markers.length, inCluster: cluster.getLayers().length,
          listItems: document.querySelectorAll('#list .place').length,
          zoom: map.getZoom(), minZoom: map.getMinZoom(), snap: map.options.zoomSnap };
      });
      expect(s.markers).toBe(s.places);
      expect(s.inCluster).toBe(s.places);
      expect(s.listItems).toBe(s.places);
      expect(s.snap).toBe(1);
      expect(Number.isInteger(s.zoom), `зум ${s.zoom}`).toBe(true);
      expect(Number.isInteger(s.minZoom), `minZoom ${s.minZoom}`).toBe(true);
      expect(pageErrors).toEqual([]);
      expect(requests.filter(u => GEOCODERS.test(new URL(u).hostname))).toEqual([]);

      mkdirSync('test-results/screenshots', { recursive: true });
      const path = `test-results/screenshots/${id}-${info.project.name}.png`;
      await page.screenshot({ path });
      await info.attach('screenshot', { path, contentType: 'image/png' });
    });

    test('нет точек вне своих городов', async ({ page }) => {
      const bad = await page.evaluate(() => {
        const { places, cities } = __beermap;
        return places.filter(p => { const b = cities[p.city]; return !b || p.c[0] < b[0] || p.c[0] > b[2] || p.c[1] < b[1] || p.c[1] > b[3]; })
          .map(p => `${p.name} (${p.city}): ${p.c}`);
      });
      expect(bad).toEqual([]);
    });

    test('кластеры распадаются при зуме', async ({ page }) => {
      // Вид на всю страну: близкие точки должны собраться в кластеры
      await page.evaluate(() => { const { map } = __beermap; map.setView(map.getCenter(), map.getMinZoom(), { animate: false }); });
      await page.waitForTimeout(500);
      const clustered = await page.evaluate(() => {
        const { cluster, markers } = __beermap;
        return { any: markers.some(m => { const v = cluster.getVisibleParent(m); return v && v !== m; }), icons: document.querySelectorAll('.cluster').length };
      });
      if (await page.evaluate(() => __beermap.places.length > 1)) {
        expect(clustered.any).toBe(true);
        expect(clustered.icons).toBeGreaterThan(0);
      }
      // На зуме 15 (disableClusteringAtZoom) каждая точка показана сама по себе
      const n = await page.evaluate(() => __beermap.places.length);
      const stuck = [];
      for (let i = 0; i < n; i++) {
        await page.evaluate(i => { const { map, places } = __beermap; map.setView(places[i].c, 15, { animate: false }); }, i);
        await page.waitForTimeout(350); // markercluster раскладывает маркеры после анимации
        const ok = await page.evaluate(i => { const { cluster, markers } = __beermap; return cluster.getVisibleParent(markers[i]) === markers[i]; }, i);
        if (!ok) stuck.push(await page.evaluate(i => __beermap.places[i].name, i));
      }
      expect(stuck).toEqual([]);
    });

    test('попап и кнопка маршрута ведут в Google Maps', async ({ page, isMobile }) => {
      if (isMobile) await page.locator('#handle').click();
      await page.locator('#list .place').first().click();
      const link = page.locator('.leaflet-popup .go');
      await expect(link).toBeVisible({ timeout: 5000 });
      expect(await link.getAttribute('href')).toMatch(/^https:\/\/(www\.google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)/);
      // ведёт на карточку заведения: своя ссылка, place_id или поиск по названию (а не голый адрес)
      const href = await link.getAttribute('href');
      const p0 = await page.evaluate(() => { const li = document.querySelector('#list .place.active'); return __beermap.places[+li.dataset.i]; });
      if (!p0.gmaps) expect(href).toContain(encodeURIComponent(p0.name));
      if (p0.placeId) expect(href).toContain(p0.placeId);
    });

    for (const delay of [0, 900]) test(`тап через ${delay} мс после загрузки не перебивается стартовым облётом`, async ({ page, isMobile }) => {
      await page.waitForTimeout(delay); // 900 мс: прямо во время облёта
      if (isMobile) await page.evaluate(() => { document.getElementById('panel').dataset.open = 'true'; });
      await page.locator('#list .place').first().click();
      await page.waitForTimeout(2500); // стартовый облёт начался бы через 0,6 с
      await expect(page.locator('.leaflet-popup .go')).toBeVisible();
      expect(await page.evaluate(() => __beermap.map.getZoom())).toBeGreaterThanOrEqual(15);
    });

    test('«Що поруч»: камера приближается к человеку, подсказка не пропадает сразу', async ({ page, context, isMobile }) => {
      // первая точка списка данных: у Loca Deserta это единственная точка в Одессе (раньше камера улетала на всю Украину)
      const p = await page.evaluate(() => __beermap.places[0].c);
      const meLL = [p[0] + 0.002, p[1] + 0.002];
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation({ latitude: meLL[0], longitude: meLL[1] });
      await page.waitForTimeout(2500); // стартовый облёт закончился
      await page.locator(isMobile ? '#fab' : '#near').click();
      await page.waitForTimeout(3000);
      const r = await page.evaluate(() => { const { map } = __beermap; const c = map.getCenter(); return { zoom: map.getZoom(), c: [c.lat, c.lng] }; });
      expect(r.zoom).toBeGreaterThanOrEqual(13);
      expect(Math.abs(r.c[0] - meLL[0]) + Math.abs(r.c[1] - meLL[1])).toBeLessThan(0.05);
      if (isMobile) await expect(page.locator('#toast.show')).toContainText('Найближче');
      else await expect(page.locator('#status')).toContainText('Найближче');
    });

    test('поиск фильтрует список и маркеры', async ({ page, isMobile }) => {
      const name = await page.evaluate(() => __beermap.places[0].name);
      if (isMobile) await page.locator('#handle').click();
      await page.locator('#q').fill(name);
      await page.waitForTimeout(400);
      const n = await page.evaluate(n => __beermap.places.filter(p => p.name.toLowerCase().includes(n.toLowerCase())).length, name);
      await expect(page.locator('#list .place')).toHaveCount(n);
      expect(await page.evaluate(() => __beermap.cluster.getLayers().length)).toBe(n);
    });
  });

  test.describe(`${id} на телефоне`, () => {
    test.skip(({ isMobile }) => !isMobile, 'только мобильная раскладка');

    test('шторка ~90px, точки не прячутся под шторкой и плашкой', async ({ page }) => {
      await page.goto(`/${id}/`);
      await page.waitForFunction(() => window.__beermap);
      await page.waitForTimeout(2500);
      const r = await page.evaluate(() => {
        const vh = innerHeight;
        const sheetTop = document.getElementById('panel').getBoundingClientRect().top;
        const headBottom = document.querySelector('.mhead').getBoundingClientRect().bottom;
        const icons = [...document.querySelectorAll('.leaflet-marker-icon')].map(el => el.getBoundingClientRect())
          .filter(b => b.right > 0 && b.left < innerWidth); // на экране по горизонтали
        return { peek: vh - sheetTop, sheetTop, headBottom, icons: icons.map(b => [b.top, b.bottom]) };
      });
      expect(r.peek).toBeGreaterThan(80);
      expect(r.peek).toBeLessThan(110);
      expect(r.icons.length).toBeGreaterThan(0);
      const hidden = r.icons.filter(([top, bottom]) => bottom > r.sheetTop || top < r.headBottom);
      expect(hidden, `иконки под шторкой/плашкой: ${JSON.stringify(hidden)}`).toEqual([]);
    });

    test('геолокация только с устройства: тап по карте не ставит точку', async ({ page, context }) => {
      await page.goto(`/${id}/`);
      await page.waitForFunction(() => window.__beermap);
      await page.locator('#map').tap({ position: { x: 200, y: 300 } });
      expect(await page.locator('.me, .me-pic').count()).toBe(0);
      const p = await page.evaluate(() => __beermap.places[0].c);
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation({ latitude: p[0] + 0.001, longitude: p[1] + 0.001 });
      await page.locator('#fab').click();
      await expect(page.locator('.me, .me-pic')).toHaveCount(1);
      await expect(page.locator('#list .km').first()).toBeVisible({ timeout: 5000 }).catch(() => {});
      expect(await page.locator('#list .km').count()).toBeGreaterThan(0);
    });
  });
}
