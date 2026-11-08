import { defineConfig } from 'vite';

// Library build: dist/tabletop-client.js (ES module) + dist/tabletop-client.css.
// three.js is bundled in, so a host page needs nothing else.
// The icon font is the one file kept out of the bundle (imported with `?url&no-inline`): it goes
// to dist/assets/ and the bundle finds it next to itself (`base: './'` makes the address relative
// to the bundle's own URL), so pages download it only when an icon is drawn, alongside the script,
// instead of as 171 KB of base64 inside the script.
export default defineConfig({
  base: './',
  build: {
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: () => 'tabletop-client.js',
      cssFileName: 'tabletop-client',
    },
    rollupOptions: {
      // the stylesheet stays at dist/tabletop-client.css (the package's "./style.css")
      output: {
        assetFileNames: (asset) =>
          (asset.names || []).some((n) => n.endsWith('.css'))
            ? '[name][extname]'
            : 'assets/[name][extname]',
      },
    },
    chunkSizeWarningLimit: 2000,
  },
});
