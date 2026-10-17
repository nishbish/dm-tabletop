import { defineConfig } from 'vite';

// The local test page (dev/index.html) as a static site in dist/dev, used by `npm run e2e`.
export default defineConfig({
  root: 'dev',
  base: './',
  build: { outDir: '../dist/dev', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
