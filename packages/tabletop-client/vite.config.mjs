import { defineConfig } from 'vite';

// Library build: dist/tabletop-client.js (ES module) + dist/tabletop-client.css.
// three.js is bundled in, so a host page needs nothing else.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: () => 'tabletop-client.js',
      cssFileName: 'tabletop-client',
    },
    chunkSizeWarningLimit: 2000,
  },
});
