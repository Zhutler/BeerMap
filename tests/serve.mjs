// Простой статический сервер для проверки dist/ локально: node tests/serve.mjs [dir] [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const root = process.argv[2] || 'dist';
const port = +(process.argv[3] || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.geojson': 'application/json' };

export function serve(dir = root, p = port) {
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(dir, path);
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { /* 404 ниже */ }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise(r => server.listen(p, () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await serve();
  console.log(`http://localhost:${port}/ → ${root}`);
}
