// Мастер нового клиента: создаёт clients/<id>/ с конфигом-заготовкой и временным лого.
//   npm run new-client -- loca-deserta "Loca Deserta" [--shape hex] [--text LD]
// Клиент создаётся черновиком (draft: true): ежедневная сборка его пропускает, пока не подключена таблица.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENTS_DIR, MARKER_SHAPES } from './config.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const shape = opt('--shape', 'cap');
const textOpt = opt('--text', null);
const [id, name] = args;

const fail = msg => { console.error(msg); process.exit(1); };
if (!id || !name) fail('Использование: npm run new-client -- <id латиницей> "<Название>" [--shape cap|hex|drop] [--text НМ]');
if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(`id «${id}»: только латиница в нижнем регистре, цифры и дефис`);
if (!MARKER_SHAPES.includes(shape)) fail(`--shape: одно из ${MARKER_SHAPES.join(', ')}`);
const dir = join(CLIENTS_DIR, id);
if (existsSync(dir)) fail(`${dir} уже существует`);

const initials = textOpt ?? name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

// Нейтральная палитра: заменить на фирменную
const config = {
  name,
  draft: true,
  sheetCsvUrl: '',
  cloudflareProject: `${id}-map`,
  githubPages: true,
  countries: ['UKR'],
  texts: {
    title: `Де купити · ${name}`,
    heading: 'Де купити?',
    subheading: `Тут продають ${name}`,
    panelLabel: `Де купити ${name}`,
    logoAlt: name,
  },
  images: { logo: 'logo.svg' },
  font: { family: 'Montserrat', googleWeights: [500, 600, 700, 800, 900], fallback: '\'Segoe UI\', Roboto, Arial, sans-serif' },
  colors: { cream: '#F3EFE6', paper: '#FBF9F4', navy: '#2B2B2B', navy2: '#4A4A4A', orange: '#C8862A', gold: '#A8873E', line: '#DED8C9', muted: '#75716A' },
  basemap: { background: '#F3EFE6', water: '#C9DDE3', park: '#E1E4CF', building: '#E6E1D4', label: '#4A4A4A' },
  marker: { shape, text: initials, colors: { shop: '#2B2B2B', bar: '#C8862A' } },
  cityOrder: [],
};

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220">
  <circle cx="110" cy="110" r="106" fill="${config.colors.paper}" stroke="${config.colors.gold}" stroke-width="8"/>
  <text x="110" y="138" text-anchor="middle" font-family="Montserrat,Arial,sans-serif" font-weight="900" font-size="84" fill="${config.colors.navy}">${initials.replace(/[<&]/g, '')}</text>
</svg>
`;

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'client.json'), JSON.stringify(config, null, 2) + '\n');
writeFileSync(join(dir, 'logo.svg'), logo);
console.log(`Создано: ${dir}/client.json и временное ${dir}/logo.svg

Дальше:
  1. Таблица: копия шаблона (README → «Новый клиент»), доступ «Все, у кого есть ссылка: читатель»,
     ссылку https://docs.google.com/spreadsheets/d/<ID>/export?format=csv → sheetCsvUrl.
  2. Лого (logo.jpg/png/svg) и цвета в client.json; иконку «Що поруч» можно положить как near.png.
  3. Убрать "draft": true, закоммитить в main. Сборка опубликует карту:
     https://<owner>.github.io/<repo>/${id}/`);
