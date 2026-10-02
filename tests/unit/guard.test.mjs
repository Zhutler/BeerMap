// Сторож архитектуры: клиент = данные. Никакого кода в папках клиентов, все клиенты на одном шаблоне.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { listClients, loadClient, CLIENTS_DIR } from '../../build/config.mjs';

const ALLOWED = new Set(['.json', '.jpg', '.jpeg', '.png', '.svg', '.webp']);

test('в папках клиентов только client.json и картинки', () => {
  for (const id of listClients({ includeDrafts: true })) {
    for (const f of readdirSync(join(CLIENTS_DIR, id), { recursive: true })) {
      const ext = extname(String(f)).toLowerCase();
      if (!ext) continue; // подпапка
      assert.ok(ALLOWED.has(ext), `${id}/${f}: в папке клиента нельзя хранить ${ext} (код живёт в template/ и build/)`);
      if (ext === '.json') assert.equal(String(f), 'client.json', `${id}/${f}: единственный json клиента это client.json`);
    }
  }
});

test('client.json не содержит кода и не подменяет шаблон', () => {
  for (const id of listClients({ includeDrafts: true })) {
    const raw = readFileSync(join(CLIENTS_DIR, id, 'client.json'), 'utf8');
    assert.ok(!/<script|function\s*\(|=>|template\//i.test(raw), `${id}: в client.json код или путь к шаблону`);
    loadClient(id); // и он валиден
  }
});
