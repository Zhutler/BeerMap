// Загрузка client.json с умолчаниями и проверкой.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const CLIENTS_DIR = 'clients';

const DEFAULTS = {
  countries: ['UKR'],
  texts: { filterShop: 'Магазини', filterBar: 'Бари й паби' },
  typeLabels: { shop: 'Магазин', bar: 'Бар / паб' },
  font: { family: 'Montserrat', googleWeights: [500, 600, 700, 800, 900], fallback: '\'Segoe UI\', Roboto, Arial, sans-serif' },
  marker: { shape: 'cap', text: '' },
  cityOrder: [],
};
const COLOR_KEYS = ['cream', 'paper', 'navy', 'navy2', 'orange', 'gold', 'line', 'muted'];
const BASEMAP_KEYS = ['background', 'water', 'park', 'building', 'label'];
const HEX = /^#[0-9a-f]{3,8}$/i;
export const MARKER_SHAPES = ['cap', 'hex', 'drop'];

export const listClients = ({ includeDrafts = false } = {}) => readdirSync(CLIENTS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(CLIENTS_DIR, d.name, 'client.json')))
  .map(d => d.name)
  // черновики (draft: true) ежедневная сборка пропускает; собрать можно явно: node build/build.mjs <id>
  .filter(id => includeDrafts || !JSON.parse(readFileSync(join(CLIENTS_DIR, id, 'client.json'), 'utf8')).draft)
  .sort();

export function loadClient(id) {
  const dir = join(CLIENTS_DIR, id);
  const path = join(dir, 'client.json');
  if (!existsSync(path)) throw new Error(`Нет ${path}`);
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`${path}: битый JSON (${e.message})`); }

  const c = {
    ...DEFAULTS, ...raw,
    texts: { ...DEFAULTS.texts, ...raw.texts },
    typeLabels: { ...DEFAULTS.typeLabels, ...raw.typeLabels },
    font: { ...DEFAULTS.font, ...raw.font },
    marker: { ...DEFAULTS.marker, ...raw.marker },
    images: { ...raw.images },
  };
  c.id = id;
  c.dir = dir;
  c.texts.mobileHeading ??= c.texts.heading;
  c.texts.panelLabel ??= `Де купити ${c.name}`;
  c.texts.logoAlt ??= c.name;

  const errs = [];
  if (!c.name) errs.push('name');
  for (const k of ['title', 'heading', 'subheading']) if (!c.texts[k]) errs.push(`texts.${k}`);
  if (!c.images.logo) errs.push('images.logo');
  for (const [k, f] of Object.entries(c.images)) if (f && !existsSync(join(dir, f))) errs.push(`images.${k}: нет файла ${f}`);
  for (const k of COLOR_KEYS) if (!HEX.test(c.colors?.[k] ?? '')) errs.push(`colors.${k}`);
  for (const k of BASEMAP_KEYS) if (!HEX.test(c.basemap?.[k] ?? '')) errs.push(`basemap.${k}`);
  for (const t of ['shop', 'bar']) if (!HEX.test(c.marker.colors?.[t] ?? '')) errs.push(`marker.colors.${t}`);
  if (!MARKER_SHAPES.includes(c.marker.shape)) errs.push(`marker.shape «${c.marker.shape}» (есть: ${MARKER_SHAPES.join(', ')})`);
  if (!Array.isArray(c.countries) || !c.countries.length) errs.push('countries');
  if (errs.length) throw new Error(`${path}: не заполнено или неверно: ${errs.join(', ')}`);
  return c;
}
