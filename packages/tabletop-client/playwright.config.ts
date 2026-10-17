import { defineConfig } from '@playwright/test';

// The viewer's dev page is served from its production build (dist/dev, made by `npm run build`).
// The tabletop server is started by the test itself, because it has to restart it.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'e2e/.results',
  use: {
    // Set E2E_CHANNEL=chrome to use an installed Chrome instead of the downloaded Chromium.
    channel: process.env.E2E_CHANNEL || undefined,
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      // Headless Chromium has no GPU. SwiftShader is a software WebGL implementation that ships
      // with Chromium; these flags make sure it is used (and allowed) in CI containers too.
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  webServer: {
    command: 'npx vite preview -c vite.page.config.mjs --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
