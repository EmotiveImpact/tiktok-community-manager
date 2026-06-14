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
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Split the single ~940KB bundle so the renderer ships a small vendor
        // core up front and lazy-loads heavy libs only where they're used.
        manualChunks: {
          // React core — stable, cached across deploys, loaded everywhere.
          'vendor-react': ['react', 'react-dom'],
          // hls.js is only pulled in by StreamPlayer; keep it out of the
          // initial bundle so opening the live view doesn't pay for it.
          'vendor-hls': ['hls.js'],
          // Icon set used by a handful of views.
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
});
