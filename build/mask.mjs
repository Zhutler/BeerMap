// Маска «всё, кроме наших стран»: объединяем контуры стран из конфига в один.
import { readFileSync, existsSync } from 'node:fs';
import union from '@turf/union';
import { featureCollection } from '@turf/helpers';

/** Возвращает внешние кольца объединённых стран в формате Leaflet: [[[lat, lng], ...], ...] */
export function buildMask(countries, dir = 'data/masks') {
  const feats = countries.map(iso => {
    const path = `${dir}/${iso}.geojson`;
    if (!existsSync(path)) throw new Error(`Нет контура ${path}. Запусти: npm run masks -- ${iso}`);
    return JSON.parse(readFileSync(path, 'utf8'));
  });
  const merged = feats.length > 1 ? union(featureCollection(feats)) : feats[0];
  const g = merged.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  // Только внешние кольца: дыры внутри стран (анклавы) не затемняем
  return polys.map(p => p[0].map(([lng, lat]) => [lat, lng]));
}
