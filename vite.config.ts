import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * GitHub Pages projeyi <kullanici>.github.io/<repo>/ altinda yayinlar, bu
 * yuzden CI'da base yolu repo adi olmali. Yerelde (npm run dev) kok '/' kalir.
 * Ozel bir domain kullanilacaksa BASE_PATH=/ verilerek ezilebilir.
 */
const base = process.env.BASE_PATH ?? (process.env.GITHUB_ACTIONS ? '/G_CODE-Visualizer/' : '/');

export default defineConfig({
  base,
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
