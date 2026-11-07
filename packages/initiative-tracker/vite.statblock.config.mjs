import { defineConfig } from 'vite';

// dist/statblock.js: the stat block renderer on its own (no DOM, no tracker), for a server or
// page that shows stat blocks. Built into the same dist/ as the tracker, so it must not empty it.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/statblock.ts',
      formats: ['es'],
      fileName: () => 'statblock.js',
    },
  },
});
