import { defineConfig } from 'vite';

// Library build: dist/initiative-tracker.js (ES module). No runtime dependencies; the styles
// are injected by the code itself, so there is no CSS file to ship. Type declarations are
// written to dist/types by `tsc -p tsconfig.build.json` (see the build script).
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'initiative-tracker.js',
    },
  },
});
