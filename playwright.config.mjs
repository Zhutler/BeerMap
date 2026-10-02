import { defineConfig } from '@playwright/test';

// Проверяем уже собранные страницы из dist/ (сначала npm run build).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/serve.mjs dist 4173', port: 4173, reuseExistingServer: true },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
