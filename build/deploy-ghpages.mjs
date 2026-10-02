// Публикация на GitHub Pages через ветку gh-pages: каждый клиент в своей папке.
//   node build/deploy-ghpages.mjs nizashcho-myla [loca-deserta ...]
// Обновляются только переданные клиенты: у клиента, чья сборка упала, на сайте остаётся прошлая версия.
// Запускается в GitHub Actions (нужны GITHUB_REPOSITORY и право contents: write).
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadClient } from './config.mjs';

const ids = process.argv.slice(2).filter(id => loadClient(id).githubPages);
if (!ids.length) { console.log('GitHub Pages: нечего публиковать'); process.exit(0); }

const repo = process.env.GITHUB_REPOSITORY; // Zhutler/BeerMap
if (!repo) { console.error('Нет GITHUB_REPOSITORY: скрипт для GitHub Actions'); process.exit(1); }
const [owner, name] = repo.split('/');
const base = `https://${owner.toLowerCase()}.github.io/${name}/`;
const dir = '.ghpages';
const git = (...a) => execFileSync('git', a, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim();

rmSync(dir, { recursive: true, force: true });
let exists = true;
try { git('fetch', '--depth', '1', 'origin', 'gh-pages'); } catch { exists = false; }
if (exists) git('worktree', 'add', '-B', 'gh-pages', dir, 'FETCH_HEAD');
else git('worktree', 'add', '--orphan', '-b', 'gh-pages', dir);

for (const id of ids) {
  rmSync(join(dir, id), { recursive: true, force: true });
  cpSync(join('dist', id), join(dir, id), { recursive: true });
  rmSync(join(dir, id, '_headers'), { force: true }); // это для Cloudflare
}
writeFileSync(join(dir, '.nojekyll'), '');

// Корень: простой список карт
const clients = readdirSync(dir, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(dir, d.name, 'build.json')))
  .map(d => ({ id: d.name, title: (readFileSync(join(dir, d.name, 'index.html'), 'utf8').match(/<title>([^<]*)<\/title>/) || [])[1] || d.name }));
writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Карти «Де купити»</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px}</style>
<h1>Карти «Де купити»</h1><ul>${clients.map(c => `<li><a href="${c.id}/">${c.title}</a></li>`).join('')}</ul>\n`);

git('-C', dir, 'add', '-A');
if (git('-C', dir, 'status', '--porcelain')) {
  git('-C', dir, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-q', '-m', `Публикация: ${ids.join(', ')}`);
  git('-C', dir, 'push', '-q', 'origin', 'gh-pages');
  console.log(`GitHub Pages: обновлено ${ids.join(', ')}`);
} else console.log('GitHub Pages: изменений нет');
git('worktree', 'remove', '--force', dir);

// GitHub собирает Pages ~1 минуту после push. Ждём до ~4 минут, пока сайт покажет нашу свежую страницу.
const want = id => readFileSync(join('dist', id, 'index.html'), 'utf8');
let failed = 0;
for (const id of ids) {
  const url = `${base}${id}/`;
  let ok = false, last = '';
  for (let i = 0; i < 16 && !ok; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
      const html = await r.text();
      ok = r.ok && html === want(id);
      last = ok ? '' : `HTTP ${r.status}${r.ok ? ', ещё старая версия' : ''}`;
    } catch (e) { last = [e.message, e.cause?.code].filter(Boolean).join(' / '); }
    if (!ok) await new Promise(res => setTimeout(res, 15000));
  }
  if (ok) console.log(`✓ ${id} → ${url}`);
  else { console.error(`✗ ${id}: ${url} не открывается (${last}). Включены ли Pages: Settings → Pages → Source: Deploy from a branch → gh-pages?`); failed++; }
}
process.exit(failed ? 1 : 0);
