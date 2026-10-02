// Шаблон + конфиг + данные → dist/<client>/
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATE = 'template';
const VENDOR = {
  leaflet: ['node_modules/leaflet/dist', ['leaflet.js', 'leaflet.css', 'images']],
  'leaflet.markercluster': ['node_modules/leaflet.markercluster/dist', ['leaflet.markercluster.js', 'MarkerCluster.css']],
  'maplibre-gl': ['node_modules/maplibre-gl/dist', ['maplibre-gl.js', 'maplibre-gl.css']],
  'maplibre-gl-leaflet': ['node_modules/@maplibre/maplibre-gl-leaflet', ['leaflet-maplibre-gl.js']],
};
const VERSION_OF = name => JSON.parse(readFileSync(join(name === 'maplibre-gl-leaflet' ? 'node_modules/@maplibre/maplibre-gl-leaflet' : `node_modules/${name}`, 'package.json'), 'utf8')).version;

// Иконка «Що поруч» по умолчанию, если у клиента нет своей
const NEAR_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#26325A" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>');

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));

/** {{key}} экранируется, {{{key}}} вставляется как есть */
export function fill(tpl, vars) {
  return tpl.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (_, raw, safe) => {
    const k = raw || safe;
    if (!(k in vars)) throw new Error(`Шаблон: нет значения для {{${k}}}`);
    return raw ? String(vars[k]) : escHtml(vars[k]);
  });
}

function fontLinks(font) {
  if (!font.googleWeights?.length) return '';
  const fam = encodeURIComponent(font.family).replace(/%20/g, '+');
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${fam}:wght@${font.googleWeights.join(';')}&display=swap" rel="stylesheet">`;
}

function rootVars(c) {
  const k = c.colors;
  return `:root{--cream:${k.cream};--paper:${k.paper};--navy:${k.navy};--navy-2:${k.navy2};--orange:${k.orange};--gold:${k.gold};--line:${k.line};--muted:${k.muted};
  --font:'${c.font.family}', ${c.font.fallback}}`;
}

/** Компактный вид точки для браузера */
export function toClientPlace(p, loc) {
  const o = { name: p.name, type: p.type, city: p.city, street: p.street, house: p.house, c: [loc.lat, loc.lng] };
  if (p.oldStreet) o.old = p.oldStreet;
  if (p.instagram) o.ig = p.instagram;
  if (p.gmapsUrl) o.gmaps = p.gmapsUrl;
  if (p.placeId) o.placeId = p.placeId;
  if (p.note) o.note = p.note;
  return o;
}

export function renderClient({ client: c, places, cities, mask, outDir }) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Библиотеки кладём рядом (без сторонних CDN), версия в пути для долгого кеша
  const vendorDir = 'vendor';
  for (const [name, [src, files]] of Object.entries(VENDOR)) {
    for (const f of files) cpSync(join(src, f), join(outDir, vendorDir, `${name}`, f), { recursive: true });
  }
  const vendorVersions = Object.fromEntries(Object.keys(VENDOR).map(n => [n, VERSION_OF(n)]));

  for (const f of Object.values(c.images)) if (f) cpSync(join(c.dir, f), join(outDir, f));

  const usedCities = [...new Set(places.map(p => p.city))];
  // Город, где больше всего точек, если в конфиге не задан
  const counts = {};
  places.forEach(p => { counts[p.city] = (counts[p.city] || 0) + 1; });
  const focusCity = c.focusCity && counts[c.focusCity] ? c.focusCity : Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  const data = {
    cfg: {
      typeLabels: c.typeLabels, cityOrder: c.cityOrder, focusCity, colors: c.colors, basemap: c.basemap,
      marker: c.marker, fontFamily: c.font.family, nearIcon: c.images.near || NEAR_FALLBACK, meIcon: c.images.me || '',
    },
    cities: Object.fromEntries(usedCities.map(n => [n, cities[n].bbox])),
    mask,
    places,
  };
  // </script> внутри JSON сломал бы страницу
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  const html = fill(readFileSync(join(TEMPLATE, 'index.html'), 'utf8'), {
    ...c.texts, name: c.name,
    logo: c.images.logo, near: c.images.near || NEAR_FALLBACK,
    themeColor: c.colors.navy,
    vendor: vendorDir,
    fontLinks: fontLinks(c.font),
    rootVars: rootVars(c),
    css: readFileSync(join(TEMPLATE, 'app.css'), 'utf8'),
    js: readFileSync(join(TEMPLATE, 'app.js'), 'utf8'),
    data: json,
  });
  writeFileSync(join(outDir, 'index.html'), html);

  // Cloudflare Pages: страница всегда свежая, библиотеки кешируются на день
  writeFileSync(join(outDir, '_headers'), `/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/vendor/*
  Cache-Control: public, max-age=86400
`);
  writeFileSync(join(outDir, 'build.json'), JSON.stringify({ client: c.id, places: places.length, cities: usedCities, vendor: vendorVersions }, null, 2));
  return { html, data };
}
