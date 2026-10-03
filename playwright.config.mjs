import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '*.spec.mjs', workers: 1, timeout: 30000,
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1440, height: 1100 }, headless: true },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
