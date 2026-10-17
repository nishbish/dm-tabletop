import { defineConfig } from '@playwright/test';

// The demo page is served from its production build (dist/dev, made by `npm run build`).
// Port 4174 so it can run next to the tabletop-client suite (4173).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'e2e/.results',
  use: {
    // Set E2E_CHANNEL=chrome to use an installed Chrome instead of the downloaded Chromium.
    channel: process.env.E2E_CHANNEL || undefined,
    baseURL: 'http://127.0.0.1:4174',
  },
  webServer: {
    command: 'npx vite preview -c vite.page.config.mjs --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
  },
});
