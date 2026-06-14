import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

// Keep these OUT of the bundled ESM main process. They (or their deps) use
// CommonJS `__dirname`/`require`, which throw "is not defined in ES module
// scope" when inlined into the `"type":"module"` main bundle. Externalizing
// makes Electron load them from node_modules (inside the asar) at runtime in
// their native CJS context. electron-builder ships all "dependencies" into the
// asar, so they resolve correctly in the packaged app.
const EXTERNAL_PKGS = ['bufferutil', 'utf-8-validate', 'electron-updater', 'electron-log', 'ffmpeg-static'];
// Match each package AND its subpaths (e.g. `electron-log/main`).
const isMainExternal = (id: string) =>
  EXTERNAL_PKGS.some((pkg) => id === pkg || id.startsWith(`${pkg}/`));

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: isMainExternal,
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
