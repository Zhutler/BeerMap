// Публикация собранных клиентов на Cloudflare Pages (Direct Upload через wrangler).
//   node build/deploy.mjs nizashcho-myla [loca-deserta ...]
// Нужны переменные CLOUDFLARE_API_TOKEN и CLOUDFLARE_ACCOUNT_ID.
// Для каждого клиента свой проект Pages (client.json → cloudflareProject). Если его нет, создаём.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadClient } from './config.mjs';

const WRANGLER = 'wrangler@4';
const ids = process.argv.slice(2);
if (!ids.length) { console.log('Нечего публиковать'); process.exit(0); }
for (const v of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[v]) { console.error(`Нет секрета ${v}: публикация пропущена`); process.exit(1); }
}

const wrangler = (...args) => spawnSync('npx', ['--yes', WRANGLER, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let failed = 0;
for (const id of ids) {
  const c = loadClient(id);
  const project = c.cloudflareProject;
  const dir = `dist/${id}`;
  if (!project || !existsSync(dir)) { console.error(`✗ ${id}: нет cloudflareProject или ${dir}`); failed++; continue; }

  // Создаём проект; если он уже есть, wrangler ответит ошибкой «already exists», это нормально
  const created = wrangler('pages', 'project', 'create', project, '--production-branch', 'main');
  if (created.status === 0) console.log(`Создан проект Pages «${project}»`);
  else if (!/already exists|8000002/i.test(created.stderr + created.stdout)) { console.error(`✗ ${id}: ${created.stderr || created.stdout}`); failed++; continue; }

  const r = wrangler('pages', 'deploy', dir, '--project-name', project, '--branch', 'main', '--commit-dirty=true');
  process.stdout.write(r.stdout);
  if (r.status !== 0) { console.error(`✗ ${id}: ${r.stderr}`); failed++; continue; }
  console.log(`✓ ${id} → https://${project}.pages.dev`);
}
process.exit(failed ? 1 : 0);
