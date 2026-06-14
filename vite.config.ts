import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const nativeExternals = ['bufferutil', 'utf-8-validate'];

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: nativeExternals,
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
  ],
  // Relative base so assets resolve under the packaged app's file:// origin.
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // IMPORTANT: keep the renderer as a SINGLE self-contained bundle.
        // The packaged app loads index.html from file://, and cross-file ES
        // module imports between split chunks are blocked by Chromium's CORS
        // policy on file:// (origin "null") — which renders a blank window.
        // A single chunk has no inter-chunk imports, so it loads correctly.
        inlineDynamicImports: true,
      },
    },
  },
});
