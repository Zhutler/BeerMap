// Загрузка и разбор Google-таблицы (опубликована как CSV).
import { parse } from 'csv-parse/sync';

export const COLUMNS = ['name', 'type', 'city', 'street', 'house', 'old_street', 'instagram',
  'gmaps_url', 'place_id', 'lat', 'lng', 'note', 'active'];
const REQUIRED = ['name', 'type', 'city', 'street', 'house'];

const TYPE_ALIASES = {
  shop: 'shop', 'магазин': 'shop', store: 'shop',
  bar: 'bar', 'бар': 'bar', pub: 'bar', 'паб': 'bar',
};
const FALSE_VALUES = new Set(['false', 'ні', 'нет', 'no', '0', 'n']);

export async function fetchCsv(url, { retries = 3 } = {}) {
  if (!url) throw new Error('В client.json не задан sheetCsvUrl');
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      // Неопубликованная таблица отдаёт HTML-страницу входа вместо CSV
      if (/^\s*<!doctype html|^\s*<html/i.test(text)) {
        throw new Error('вместо CSV пришёл HTML: таблица закрыта (нужен доступ «Все, у кого есть ссылка: читатель» или публикация в CSV) или ссылка неверная');
      }
      return text;
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise(res => setTimeout(res, 2000 * 2 ** i));
    }
  }
  throw new Error(`Не удалось скачать таблицу (${url}): ${lastErr.message}`);
}

// «46,4724» (украинская локаль) и «46.4724» → число; пусто → null
export function parseNumber(v) {
  const s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export function parseInstagram(v) {
  let s = String(v ?? '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '');
  return s.split(/[/?#]/)[0];
}

export function parseActive(v) {
  return !FALSE_VALUES.has(String(v ?? '').trim().toLowerCase());
}

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Разбирает CSV. Возвращает { places, errors }. Строка в errors = строка таблицы (с заголовком = 1).
 * Неактивные точки возвращаются с active:false (нужны, чтобы не чистить их кеш).
 */
export function parseSheet(text) {
  const errors = [];
  let rows;
  try {
    rows = parse(text.replace(/^﻿/, ''), { columns: h => h.map(x => clean(x).toLowerCase()), skip_empty_lines: true, relax_column_count: true });
  } catch (e) {
    return { places: [], errors: [{ row: 0, msg: `CSV не читается: ${e.message}` }] };
  }
  const header = rows.length ? Object.keys(rows[0]) : [];
  const missing = REQUIRED.filter(c => !header.includes(c));
  if (missing.length) {
    return { places: [], errors: [{ row: 1, msg: `В таблице нет колонок: ${missing.join(', ')}` }] };
  }

  const places = [];
  const seen = new Map();
  rows.forEach((r, i) => {
    const row = i + 2;
    if (COLUMNS.every(c => !clean(r[c]))) return; // пустая строка
    const rowErrors = [];
    const err = msg => rowErrors.push({ row, name: clean(r.name), msg });
    const p = {
      row,
      name: clean(r.name),
      type: TYPE_ALIASES[clean(r.type).toLowerCase()],
      city: clean(r.city),
      street: clean(r.street),
      house: clean(r.house),
      oldStreet: clean(r.old_street),
      instagram: parseInstagram(r.instagram),
      gmapsUrl: clean(r.gmaps_url),
      placeId: clean(r.place_id),
      lat: parseNumber(r.lat),
      lng: parseNumber(r.lng),
      note: clean(r.note),
      active: parseActive(r.active),
    };
    if (!p.name) err('пустое name');
    if (!p.type) err(`type «${clean(r.type)}» неизвестен, нужно shop или bar`);
    if (!p.city) err('пустое city');
    if (!p.street) err('пустое street');
    if (!p.house) err('пустое house');
    if (Number.isNaN(p.lat) || Number.isNaN(p.lng)) err('lat/lng не число');
    else if ((p.lat == null) !== (p.lng == null)) err('заполнено только одно из lat/lng');
    else if (p.lat != null && (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180)) err('lat/lng вне допустимых значений');
    if (p.gmapsUrl && !/^https?:\/\//i.test(p.gmapsUrl)) err('gmaps_url должен начинаться с http');

    const key = [p.name, p.city, p.street, p.house].join('|').toLowerCase();
    if (p.active) {
      if (seen.has(key)) err(`дубль строки ${seen.get(key)}`);
      else seen.set(key, row);
      errors.push(...rowErrors); // ошибки в выключенных строках (active = FALSE) не мешают сборке
    }
    if (!rowErrors.length) places.push(p);
  });
  if (!places.length && !errors.length) errors.push({ row: 0, msg: 'Таблица пустая' });
  return { places, errors };
}
