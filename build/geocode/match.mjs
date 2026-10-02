// Нормализация адресов и проверки результатов геокодера.
// Правило: точку принимаем только если это адрес (дом), он внутри bbox города,
// улица совпадает с нашей и номер дома совпадает.

// Тип улицы → канонический код. Если у обеих сторон тип указан и он разный, это разные улицы
// («вулиця Ніжинська» и «провулок Ніжинський»).
const STREET_TYPES = {
  'вулиця': 'st', 'вул': 'st', 'улица': 'st', 'ул': 'st', 'ulica': 'st', 'ul': 'st',
  'провулок': 'lane', 'пров': 'lane', 'переулок': 'lane', 'пер': 'lane',
  'проспект': 'ave', 'просп': 'ave', 'пр-т': 'ave', 'пр': 'ave', 'aleja': 'ave', 'al': 'ave',
  'бульвар': 'blvd', 'бул': 'blvd', 'б-р': 'blvd',
  'площа': 'sq', 'пл': 'sq', 'майдан': 'sq', 'площадь': 'sq', 'plac': 'sq',
  'узвіз': 'desc', 'спуск': 'desc',
  'дорога': 'road', 'шосе': 'hwy', 'набережна': 'emb', 'наб': 'emb',
  'алея': 'alley', 'тупик': 'dead', 'проїзд': 'pass', 'в\'їзд': 'pass', 'лінія': 'line',
};

const LATIN_TO_CYR = { a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', i: 'і', k: 'к', o: 'о', c: 'с' };

export function normText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[’'`ʼ‘]/g, '\'')
    .replace(/ё/g, 'е')
    .replace(/[«»"“”().,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «вулиця Олександра Свища» → { type: 'st', tokens: ['олександра','свища'] } */
export function parseStreet(s) {
  let type = null;
  const tokens = [];
  for (const w of normText(s).split(' ')) {
    if (!w) continue;
    if (STREET_TYPES[w]) { type ??= STREET_TYPES[w]; continue; }
    if (w.length < 2) continue; // инициалы
    tokens.push(w);
  }
  return { type, tokens };
}

// «Ніжинська»≈«Ніжинської» (падежи): общий префикс, отличаются не больше трёх последних букв
function tokenEq(a, b) {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  const m = Math.min(a.length, b.length);
  if (m < 5) return false;
  let i = 0;
  while (i < m && a[i] === b[i]) i++;
  return i >= Math.max(a.length, b.length) - 3;
}

/** Совпадает ли найденная улица с нашей. Возвращает null или текст причины отказа. */
export function streetMismatch(found, ours) {
  const f = parseStreet(found), o = parseStreet(ours);
  if (!f.tokens.length) return 'у результата нет названия улицы';
  if (f.type && o.type && f.type !== o.type) return `другой тип улицы: «${found}»`;
  const [short, long] = f.tokens.length <= o.tokens.length ? [f.tokens, o.tokens] : [o.tokens, f.tokens];
  const ok = short.every(t => long.some(u => tokenEq(t, u)));
  return ok ? null : `другая улица: «${found}»`;
}

/** «5-Б» → «5б», «87 a» (латиница) → «87а» */
export function normHouse(h) {
  return normText(h)
    .replace(/\s|-/g, '')
    .replace(/[a-z]/g, ch => LATIN_TO_CYR[ch] ?? ch)
    .replace(/^(буд|будинок|д|дом|корп)\.?/, '');
}

/**
 * Варианты номера дома: «16а/2» → ['16а/2', '16а'].
 * loose: ещё и номер без литеры (['16а/2', '16а', '16']): литерный корпус стоит рядом с основным домом.
 */
export function houseVariants(h, loose = false) {
  const n = normHouse(h);
  const out = [n];
  const base = n.split(/[\/\\]|корп|к(?=\d)/)[0];
  if (base && base !== n) out.push(base);
  const digits = n.match(/^\d+/)?.[0];
  if (loose && digits && !out.includes(digits)) out.push(digits);
  return out;
}

/** Совпадает ли номер дома. Поддерживает «30;32» и «30,32» у результата. */
export function houseMismatch(found, ours, loose = false) {
  if (!found) return 'нет номера дома (результат уровня улицы)';
  const want = new Set(houseVariants(ours, loose));
  const got = String(found).split(/[;,]/).map(normHouse);
  return got.some(g => want.has(g)) ? null : `другой дом: «${found}»`;
}

/** bbox: [south, west, north, east] */
export const inBbox = (b, lat, lng) => lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3];

/**
 * Проверка кандидата. cand: { lat, lng, kind, street, house }.
 * Возвращает null (подходит) или текст причины.
 */
export function rejectReason(cand, { street, house, bbox, loose = false }) {
  if (cand.kind !== 'address') return `тип результата «${cand.kind}», нужен адрес`;
  if (!Number.isFinite(cand.lat) || !Number.isFinite(cand.lng)) return 'нет координат';
  if (!inBbox(bbox, cand.lat, cand.lng)) return `точка вне города (${cand.lat.toFixed(5)}, ${cand.lng.toFixed(5)})`;
  return streetMismatch(cand.street, street) || houseMismatch(cand.house, house, loose);
}

/** Ключ кеша: город|улица без типа|дом */
export function cacheKey({ city, street, house }) {
  const s = parseStreet(street);
  return [normText(city), [s.type ?? '', ...s.tokens].join(' ').trim(), normHouse(house)].join('|');
}
