// Провайдеры геокодинга. Каждый приводит ответ к списку кандидатов
// { lat, lng, kind: 'address'|'street'|..., street, house, label }.
// Разбор ответа вынесен в parse*, чтобы тестировать без сети.

const ISO2 = { UKR: 'ua', POL: 'pl', MDA: 'md', ROU: 'ro', SVK: 'sk', HUN: 'hu', DEU: 'de', CZE: 'cz', LTU: 'lt', LVA: 'lv', EST: 'ee' };
export const iso2 = iso3 => ISO2[iso3] ?? iso3.slice(0, 2).toLowerCase();

const TIMEOUT = 15000;
async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  if (r.status === 401 || r.status === 403) throw new Error(`HTTP ${r.status}: доступ запрещён (неверный ключ или блокировка)`);
  if (r.status === 429) throw new Error('HTTP 429: превышен лимит запросов');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ---------------- Visicom (только Украина) ---------------- */
// https://api.visicom.ua/data-api/5.0/uk/geocode.json?text=...&key=...
// Адрес: properties.categories = 'adr_address', name = номер дома, street, street_type, settlement.
// Геометрия: Point или geo_centroid. Если результат один, API может вернуть Feature вместо FeatureCollection.
export function parseVisicom(json) {
  const feats = json?.type === 'FeatureCollection' ? json.features : json?.type === 'Feature' ? [json] : [];
  return (feats || []).map(f => {
    const p = f.properties || {};
    const pt = f.geometry?.type === 'Point' ? f.geometry : f.geo_centroid;
    const cats = String(p.categories || '');
    const kind = cats.includes('adr_address') ? 'address' : cats.includes('adr_street') ? 'street' : (cats.split(',')[0] || 'other');
    return {
      lat: pt?.coordinates?.[1], lng: pt?.coordinates?.[0], kind,
      street: [p.street_type, p.street].filter(Boolean).join(' '),
      house: kind === 'address' ? p.name : '',
      label: [p.settlement, p.street_type, p.street, p.name].filter(Boolean).join(' '),
    };
  });
}

export function visicom(key) {
  return {
    name: 'visicom',
    supports: country => country === 'UKR',
    async search({ city, street, house }) {
      const text = `${city}, ${street}, ${house}`;
      const url = `https://api.visicom.ua/data-api/5.0/uk/geocode.json?text=${encodeURIComponent(text)}&categories=adr_address&country=ua&limit=5&key=${encodeURIComponent(key)}`;
      return parseVisicom(await getJson(url));
    },
  };
}

/* ---------------- MapTiler ---------------- */
// https://api.maptiler.com/geocoding/{query}.json?key=...
// Адрес: place_type ['address'], text = улица, address = номер дома, center = [lng, lat].
export function parseMaptiler(json) {
  return (json?.features || []).map(f => {
    const types = f.place_type || [];
    const kind = types.includes('address') ? 'address' : types.includes('road') ? 'street' : (types[0] || 'other');
    return {
      lat: f.center?.[1], lng: f.center?.[0], kind,
      street: f.text || '',
      house: f.address || '',
      label: f.place_name || '',
    };
  });
}

export function maptiler(key) {
  return {
    name: 'maptiler',
    supports: () => true,
    async search({ city, street, house, bbox, country }) {
      const q = `${street} ${house}, ${city}`;
      const params = new URLSearchParams({
        key, language: 'uk', types: 'address', limit: '5', autocomplete: 'false',
        country: iso2(country), bbox: [bbox[1], bbox[0], bbox[3], bbox[2]].join(','),
      });
      const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?${params}`;
      return parseMaptiler(await getJson(url));
    },
  };
}

/* ---------------- Nominatim (OSM) ---------------- */
// Правила: не чаще 1 запроса в секунду, свой User-Agent. https://operations.osmfoundation.org/policies/nominatim/
export const USER_AGENT = 'BeerMap/0.1 (+https://github.com/Zhutler/BeerMap)';
const STREET_KEYS = ['road', 'pedestrian', 'square', 'footway', 'residential', 'place'];

export function parseNominatim(json) {
  return (Array.isArray(json) ? json : []).map(x => {
    const a = x.address || {};
    const hn = a.house_number || '';
    const street = STREET_KEYS.map(k => a[k]).find(Boolean) || '';
    return {
      lat: Number(x.lat), lng: Number(x.lon),
      kind: hn ? 'address' : (x.addresstype || x.type || 'other'),
      street, house: hn, label: x.display_name || '', name: x.name || '', category: x.category || x.class || '',
    };
  });
}

export function nominatim({ minIntervalMs = 1100, userAgent = USER_AGENT } = {}) {
  let last = 0;
  async function call(params) {
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': 'uk', ...params })}`;
    try { return await getJson(url, { 'User-Agent': userAgent }); }
    finally { last = Date.now(); }
  }
  return {
    name: 'nominatim',
    supports: () => true,
    async search({ city, street, house, bbox, country }) {
      const common = { countrycodes: iso2(country), viewbox: [bbox[1], bbox[2], bbox[3], bbox[0]].join(','), bounded: '1' };
      // сначала структурированный запрос, потом свободный
      let res = parseNominatim(await call({ ...common, street: `${house} ${street}`, city }));
      if (!res.some(c => c.kind === 'address')) {
        res = res.concat(parseNominatim(await call({ ...common, q: `${street} ${house}, ${city}` })));
      }
      return res;
    },
    /** Заведение по названию в городе (POI из OSM). */
    async searchPlace({ name, city, bbox, country }) {
      const common = { countrycodes: iso2(country), viewbox: [bbox[1], bbox[2], bbox[3], bbox[0]].join(','), bounded: '1' };
      return parseNominatim(await call({ ...common, q: `${name}, ${city}` }))
        .map(c => ({ ...c, kind: 'poi' }));
    },
    /** bbox города по названию. Возвращает список кандидатов-населённых пунктов. */
    async city(name, country) {
      const json = await call({ countrycodes: iso2(country), city: name, limit: '5' });
      return (json || [])
        .filter(x => ['city', 'town', 'village', 'municipality', 'hamlet', 'suburb'].includes(x.addresstype))
        .map(x => ({ name: x.name, type: x.addresstype, label: x.display_name, bbox: [x.boundingbox[0], x.boundingbox[2], x.boundingbox[1], x.boundingbox[3]].map(Number) }));
    },
  };
}

/** Цепочка по наличию ключей: Visicom → MapTiler → Nominatim */
export function providersFromEnv(env = process.env) {
  const list = [];
  if (env.VISICOM_API_KEY) list.push(visicom(env.VISICOM_API_KEY));
  if (env.MAPTILER_API_KEY) list.push(maptiler(env.MAPTILER_API_KEY));
  list.push(nominatim({ userAgent: env.NOMINATIM_USER_AGENT || USER_AGENT }));
  return list;
}
