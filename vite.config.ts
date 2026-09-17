import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    // Parser Web Worker'i ES modulu olarak paketlenir (bkz. src/gcode/worker).
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
