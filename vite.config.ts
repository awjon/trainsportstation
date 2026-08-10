import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the game (index.html) and the procedural asset lab (lab.html). The lab is a real
// dev tool — the piece grid, the instancing demo and the contact-sheet script all run off it —
// so it stays in the build rather than living in a scratch directory.
export default defineConfig({
  root: '.',
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lab: resolve(__dirname, 'lab.html'),
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
