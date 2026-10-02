/* Карта «Де купити». Все координаты готовы на этапе сборки: в браузере геокодинга нет. */
(() => {
const D = JSON.parse(document.getElementById('map-data').textContent);
const { cfg, cities, mask } = D;
const PLACES = D.places; // {name,type,city,street,house,old,ig,gmaps,placeId,note,c:[lat,lng]}
const TYPE_LABEL = cfg.typeLabels;
const CITY_ORDER = cfg.cityOrder;
const C = cfg.colors;

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));

/* ---------- mobile helpers ---------- */
const isMobile = () => matchMedia('(max-width:760px)').matches;
const PEEK = 92;
// відступи для fitBounds: на телефоні знизу шторка, зверху плашка з лого
const pad = n => isMobile() ? { paddingTopLeft: [20, 70], paddingBottomRight: [20, PEEK + 30] } : { padding: [n, n] };

/* ---------- map ---------- */
// markercluster не дружить із дробовим зумом: тільки цілі рівні
const map = L.map('map', { zoomControl: true, attributionControl: true, zoomSnap: 1, zoomDelta: 1, worldCopyJump: false }).setView([48.5, 31], 6);
const ATTR = '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
function useOsmFallback() { L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map); }
// Прибираємо всі заклади з підложки й перефарбовуємо під бренд
function brandStyle(gl) {
  const st = gl.getStyle(); if (!st) return;
  const B = cfg.basemap;
  const nameExpr = ['coalesce', ['get', 'name:uk'], ['get', 'name']];
  st.layers.forEach(l => {
    const id = l.id.toLowerCase(), src = (l['source-layer'] || '').toLowerCase();
    try {
      if (src === 'poi' || id.includes('poi')) { gl.setLayoutProperty(l.id, 'visibility', 'none'); return; }
      if (l.type === 'background') gl.setPaintProperty(l.id, 'background-color', B.background);
      if (l.type === 'fill' && (src === 'water' || id.includes('water'))) gl.setPaintProperty(l.id, 'fill-color', B.water);
      if (l.type === 'fill' && (src === 'park' || id.includes('park') || id.includes('wood') || id.includes('grass'))) gl.setPaintProperty(l.id, 'fill-color', B.park);
      if (l.type === 'fill' && id.includes('building')) gl.setPaintProperty(l.id, 'fill-color', B.building);
      if (l.type === 'symbol') {
        const tf = JSON.stringify((l.layout || {})['text-field'] || '');
        if (tf.includes('name')) { gl.setLayoutProperty(l.id, 'text-field', nameExpr); gl.setPaintProperty(l.id, 'text-color', B.label); }
      }
    } catch (e) { /* шар без такої властивості */ }
  });
}
try {
  if (!L.maplibreGL || !window.maplibregl) throw new Error('no maplibre');
  const base = L.maplibreGL({ style: 'https://tiles.openfreemap.org/styles/positron', attribution: ATTR }).addTo(map);
  const gl = base.getMaplibreMap();
  gl.on('style.load', () => brandStyle(gl));
  gl.on('error', e => console.warn('map style', e && e.error && e.error.message));
} catch (e) { useOsmFallback(); }
map.setMaxZoom(19);

/* ---------- маркери ---------- */
// Форми маркера (client.json → marker.shape): кришка від пляшки, бджолина сота, крапля меду.
const SHAPES = {
  cap() { // зубчасте коло
    let d = ''; const n = 21, R = 18, r = 15.2;
    for (let i = 0; i <= n * 2; i++) { const a = i * Math.PI / n; const rr = i % 2 ? r : R; d += (i ? 'L' : 'M') + (19 + rr * Math.cos(a)).toFixed(2) + ' ' + (19 + rr * Math.sin(a)).toFixed(2); }
    return { outer: `${d}Z`, cx: 19, cy: 19, r: 10.5 };
  },
  hex() { // шестикутник «сота», вершиною вгору
    let d = '';
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i - Math.PI / 2; d += (i ? 'L' : 'M') + (19 + 17.5 * Math.cos(a)).toFixed(2) + ' ' + (19 + 17.5 * Math.sin(a)).toFixed(2); }
    return { outer: `${d}Z`, cx: 19, cy: 19, r: 10.5 };
  },
  drop() { // крапля: гострий верх, кругле дно
    return { outer: 'M19 1.5C19 1.5 5.5 15.5 5.5 23.5a13.5 13.5 0 0 0 27 0C32.5 15.5 19 1.5 19 1.5Z', cx: 19, cy: 23.5, r: 9.5 };
  },
};
function markerSvg(type, size) {
  const M = cfg.marker, fill = M.colors[type] || C.navy;
  const st = size ? ` style="width:${size}px;height:${size}px"` : '';
  const g = (SHAPES[M.shape] || SHAPES.cap)();
  const fs = (M.text || '').length > 2 ? 8.5 : 10.5;
  return `<svg class="cap"${st} viewBox="0 0 38 38"><path d="${g.outer}" fill="${fill}" stroke="${C.gold}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" fill="${C.cream}"/>
    <text x="${g.cx}" y="${g.cy + fs * 0.38}" text-anchor="middle" font-family="${esc(cfg.fontFamily)},Arial" font-weight="900" font-size="${fs}" fill="${fill}">${esc(M.text)}</text></svg>`;
}
const icon = type => L.divIcon({ html: markerSvg(type), className: '', iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18] });

const cluster = L.markerClusterGroup({
  showCoverageOnHover: false, maxClusterRadius: 45, disableClusteringAtZoom: 15, spiderfyOnMaxZoom: true,
  iconCreateFunction: c => L.divIcon({ html: `<div class="cluster">${c.getChildCount()}</div>`, className: '', iconSize: [46, 46] }),
});
map.addLayer(cluster);

/* ---------- обрізка карти: показуємо лише країни, де продається ---------- */
map.createPane('mask'); map.getPane('mask').style.zIndex = 350; map.getPane('mask').style.pointerEvents = 'none';
const WORLD = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
L.polygon([WORLD, ...mask], { pane: 'mask', stroke: false, fillColor: C.cream, fillOpacity: .93, interactive: false }).addTo(map);
mask.forEach(r => L.polygon(r, { pane: 'mask', color: C.gold, weight: 2, fill: false, interactive: false }).addTo(map));
const COUNTRY_BOUNDS = L.latLngBounds(mask.flat());
map.options.maxBoundsViscosity = 1;
function lockView() {
  const mob = isMobile(), h = Math.max(map.getSize().y, 300);
  const extra = mob ? L.point(0, PEEK + 90) : L.point(0, 0);
  map.setMinZoom(Math.max(4, Math.floor(map.getBoundsZoom(COUNTRY_BOUNDS, false, extra))));
  let b = COUNTRY_BOUNDS.pad(.06);
  if (mob) { // запас знизу під шторку і зверху під плашку, щоб південь можна було витягнути у видиму зону
    const span = b.getNorth() - b.getSouth();
    b = L.latLngBounds([b.getSouth() - span * (PEEK + 40) / h, b.getWest()], [b.getNorth() + span * 80 / h, b.getEast()]);
  }
  map.setMaxBounds(b);
}
lockView(); map.on('resize', lockView);
map.fitBounds(COUNTRY_BOUNDS, { ...pad(10), animate: false });

/* ---------- state ---------- */
let filter = 'all', query = '', me = null, meMarker = null, activeIdx = null;
// Стартовий переліт до міста скасовується будь-якою дією користувача, інакше він перебиває його переліт
let introTimer = null;
const cancelIntro = () => { if (introTimer) { clearTimeout(introTimer); introTimer = null; } };
['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, cancelIntro, { capture: true, passive: true }));
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast'); let toastT;
function say(msg, ms = 6000) {
  statusEl.textContent = msg; if (!isMobile()) return;
  clearTimeout(toastT); if (!msg) { toastEl.classList.remove('show'); return; }
  toastEl.textContent = msg; toastEl.classList.add('show'); toastT = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ---------- render ---------- */
const shortStreet = s => (s || '').replace(/^вулиця\s+/i, '');
const markers = [];
function routeUrl(p) {
  // Маршрут: якщо знаємо картку закладу в Google (placeId), ведемо точно до неї.
  // Якщо ні, ведемо на адресу (без назви, щоб Google не підсунув чужий магазин).
  const addrText = `${p.street}, ${p.house}, ${p.city}`;
  if (p.gmaps) return p.gmaps;
  if (p.placeId) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.name + ', ' + addrText)}&destination_place_id=${encodeURIComponent(p.placeId)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addrText)}`;
}
function popupHtml(p) {
  const addr = `${p.street.replace(/^вулиця /i, 'вул. ')}, ${p.house}`;
  return `<div class="pop">
    <h3>${esc(p.name)}</h3><div class="type">${esc(TYPE_LABEL[p.type])}</div>
    <p class="addr">${esc(addr)}${p.old ? `<span class="old">колишня ${esc(shortStreet(p.old))}</span>` : ''}</p>
    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
    <div class="acts">
      <a class="go" href="${esc(routeUrl(p))}" target="_blank" rel="noopener">Прокласти маршрут</a>
      ${p.ig ? `<a class="ig" href="https://instagram.com/${encodeURIComponent(p.ig)}" target="_blank" rel="noopener">Instagram</a>` : ''}
    </div></div>`;
}
PLACES.forEach((p, i) => {
  const m = L.marker(p.c, { icon: icon(p.type), title: p.name, keyboard: true }).bindPopup(() => popupHtml(p), { maxWidth: 280 });
  m.on('click', () => setActive(i, false));
  markers[i] = m;
});
function matches(p) {
  if (filter !== 'all' && p.type !== filter) return false;
  if (!query) return true;
  const hay = `${p.name} ${p.city} ${p.street} ${p.old}`.toLowerCase();
  return query.split(/\s+/).every(w => hay.includes(w));
}
function applyFilterToMarkers() {
  cluster.clearLayers();
  cluster.addLayers(PLACES.map((p, i) => matches(p) ? markers[i] : null).filter(Boolean));
}
const km = (a, b) => {
  const R = 6371, t = x => x * Math.PI / 180; const dLa = t(b[0] - a[0]), dLo = t(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h));
};
const fmtKm = d => d < 1 ? `${Math.round(d * 1000 / 10) * 10} м` : d < 20 ? `${d.toFixed(1).replace('.', ',')} км` : `${Math.round(d)} км`;

const openCities = new Set(CITY_ORDER);
function placeLi(p, i, dist) {
  const addr = `${shortStreet(p.street)}, ${p.house}${p.old ? ` (кол. ${shortStreet(p.old)})` : ''}`;
  return `<li class="place${i === activeIdx ? ' active' : ''}" data-i="${i}" tabindex="0" role="button">
    <span class="dot">${markerSvg(p.type, 26)}</span>
    <span><b>${esc(p.name)}</b><small>${esc(addr)}</small></span>
    ${dist != null ? `<span class="km">${fmtKm(dist)}</span>` : ''}</li>`;
}
const chev = '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 9 7 7 7-7"/></svg>';
function renderList() {
  const el = document.getElementById('list');
  const vis = PLACES.map((p, i) => ({ p, i })).filter(x => matches(x.p));
  if (!vis.length) { el.innerHTML = '<div class="empty">Нічого не знайшли. Спробуйте іншу вулицю або місто.</div>'; return; }
  if (me) {
    const withD = vis.map(x => ({ ...x, d: km(me, x.p.c) })).sort((a, b) => a.d - b.d);
    el.innerHTML = `<div class="nearhead"><h2>Найближчі до вас</h2><button id="byCity">Показати по містах</button></div>
      <ul style="list-style:none;margin:0;padding:0 12px">${withD.map(x => placeLi(x.p, x.i, x.d)).join('')}</ul>`;
    document.getElementById('byCity').onclick = () => { me = null; renderList(); };
    return;
  }
  const groups = {}; vis.forEach(x => (groups[x.p.city] ??= []).push(x));
  const rank = c => { const i = CITY_ORDER.indexOf(c); return i < 0 ? 99 : i; };
  const cityNames = Object.keys(groups).sort((a, b) => rank(a) - rank(b) || groups[b].length - groups[a].length || a.localeCompare(b, 'uk'));
  el.innerHTML = cityNames.map(c => {
    const open = query ? true : openCities.has(c);
    return `<section class="city" data-open="${open}" data-city="${esc(c)}">
      <button aria-expanded="${open}"><h2>${esc(c)}</h2><span><span class="count">${groups[c].length}</span> ${chev}</span></button>
      <ul>${groups[c].map(x => placeLi(x.p, x.i)).join('')}</ul></section>`;
  }).join('');
}
document.getElementById('list').addEventListener('click', e => {
  const cityBtn = e.target.closest('.city>button');
  if (cityBtn) {
    const s = cityBtn.parentElement, c = s.dataset.city; openCities.has(c) ? openCities.delete(c) : openCities.add(c);
    const open = openCities.has(c); s.dataset.open = open; cityBtn.setAttribute('aria-expanded', open);
    if (open) { const pts = PLACES.filter(p => p.city === c).map(p => p.c); if (pts.length) map.flyToBounds(pts, { ...pad(60), maxZoom: 14, duration: .6 }); }
    return;
  }
  const li = e.target.closest('.place'); if (li) setActive(+li.dataset.i, true);
});
document.getElementById('list').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('place')) { e.preventDefault(); setActive(+e.target.dataset.i, true); }
});

const panel = document.getElementById('panel');
function setActive(i, fly) {
  activeIdx = i;
  document.querySelectorAll('.place').forEach(n => n.classList.toggle('active', +n.dataset.i === i));
  const p = PLACES[i], m = markers[i];
  if (fly && m) {
    if (isMobile()) panel.dataset.open = 'false';
    // Зум 16 більший за disableClusteringAtZoom (15): після перельоту маркер точно окремий.
    const z = Math.max(map.getZoom(), 16);
    // на телефоні зсуваємо центр, щоб точка й попап були над шторкою
    const c = isMobile() ? map.unproject(map.project(p.c, z).subtract([0, 90 - PEEK / 2]), z) : p.c;
    const token = ++flyToken;
    map.once('moveend', () => openWhenShown(m, token, Date.now()));
    map.flyTo(c, z, { duration: .6 });
  }
}
// Кластер додає маркер на карту трохи після moveend (власна анімація). Чекаємо, поки з'явиться іконка.
let flyToken = 0;
function openWhenShown(m, token, t0) {
  if (token !== flyToken) return; // користувач уже вибрав інше
  if (m._icon) { m.openPopup(); return; }
  if (Date.now() - t0 > 3000) { cluster.zoomToShowLayer(m, () => m.openPopup()); return; }
  requestAnimationFrame(() => openWhenShown(m, token, t0));
}

/* ---------- controls ---------- */
document.querySelectorAll('.chip').forEach(b => b.onclick = () => {
  filter = b.dataset.f; document.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === b));
  applyFilterToMarkers(); renderList();
});
let qt; document.getElementById('q').addEventListener('input', e => {
  clearTimeout(qt); qt = setTimeout(() => {
    query = e.target.value.trim().toLowerCase(); applyFilterToMarkers(); renderList();
    const pts = PLACES.filter(matches).map(p => p.c);
    if (query && pts.length) map.flyToBounds(pts, { ...pad(60), maxZoom: 15, duration: .5 });
  }, 180);
});

// Геолокація тільки з пристрою, без ручного встановлення точки
const nearBtn = document.getElementById('near'), fab = document.getElementById('fab');
function locateMe() {
  if (!navigator.geolocation) { say('Браузер не вміє визначати місцезнаходження.'); return; }
  nearBtn.setAttribute('aria-busy', 'true'); fab.setAttribute('aria-busy', 'true'); say('Шукаємо вас…', 15000);
  navigator.geolocation.getCurrentPosition(pos => {
    nearBtn.removeAttribute('aria-busy'); fab.removeAttribute('aria-busy');
    const acc = pos.coords.accuracy || 0;
    setMe([pos.coords.latitude, pos.coords.longitude]);
    say(acc > 800 ? `Місце визначено приблизно (точність ~${fmtKm(acc / 1000)}).` : '');
  }, err => {
    nearBtn.removeAttribute('aria-busy'); fab.removeAttribute('aria-busy');
    say((err.code === 1 ? 'Доступ до геолокації заборонено.' : 'Не вдалося визначити місцезнаходження.') + ' Перевірте дозвіл на геолокацію в браузері.', 7000);
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}
nearBtn.onclick = locateMe; fab.onclick = locateMe;
function setMe(ll) {
  me = ll;
  if (meMarker) map.removeLayer(meMarker);
  meMarker = L.marker(me, { zIndexOffset: 1000, icon: L.divIcon({ className: '', html: `<div class="me"><img src="${esc(cfg.nearIcon)}" alt="Ви тут"></div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) })
    .addTo(map).bindTooltip('Ви тут', { direction: 'top', offset: [0, -14] });
  const near = PLACES.filter(matches).map(p => ({ p, d: km(me, p.c) })).sort((a, b) => a.d - b.d).slice(0, 3);
  map.flyToBounds([me, ...near.map(x => x.p.c)], { ...pad(70), maxZoom: 15, duration: .8 });
  renderList();
  if (isMobile()) { const n = near[0]; if (n) say(`Найближче: ${n.p.name}, ${fmtKm(n.d)}. Потягніть список угору, щоб побачити всі.`, 5000); }
}

const handle = document.getElementById('handle');
handle.onclick = () => { panel.dataset.open = panel.dataset.open === 'true' ? 'false' : 'true'; };
// свайп шторки вгору/вниз
let ty = null;
panel.addEventListener('touchstart', e => {
  if (e.target.closest('.list') && panel.dataset.open === 'true' && document.getElementById('list').scrollTop > 0) { ty = null; return; }
  ty = e.touches[0].clientY;
}, { passive: true });
panel.addEventListener('touchend', e => {
  if (ty == null) return; const dy = e.changedTouches[0].clientY - ty; ty = null;
  if (dy < -40) panel.dataset.open = 'true'; else if (dy > 40) panel.dataset.open = 'false';
}, { passive: true });
document.getElementById('q').addEventListener('focus', () => { if (isMobile()) panel.dataset.open = 'true'; });
map.on('click', () => { if (isMobile() && panel.dataset.open === 'true') panel.dataset.open = 'false'; });

/* ---------- boot: точки вже з координатами, ставимо одразу ---------- */
renderList();
applyFilterToMarkers();
// без анімації: інакше її кінець обриває переліт до міста нижче (на телефоні карта лишалась на зумі 6)
if (PLACES.length) map.fitBounds(L.latLngBounds(PLACES.map(p => p.c)), { ...pad(40), animate: false });
// одразу показуємо місто, де найбільше точок (або focusCity з конфігу)
const focus = PLACES.filter(p => p.city === cfg.focusCity).map(p => p.c);
if (focus.length) introTimer = setTimeout(() => { introTimer = null; map.flyToBounds(focus, { ...pad(50), duration: 1.2 }); }, 600);

// для автотестів
window.__beermap = { map, cluster, markers, places: PLACES, cities, pad };
})();
