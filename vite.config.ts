import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * GitHub Pages projeyi <kullanici>.github.io/<repo>/ altinda yayinlar, bu
 * yuzden CI'da base yolu repo adi olmalidir. Repo adi GITHUB_REPOSITORY'den
 * okunur; boylece repo yeniden adlandirilsa da yapilandirma bozulmaz.
 *
 * Istisnalar:
 *  - yerelde (npm run dev) base '/' kalir
 *  - <kullanici>.github.io reposu kokten yayinlanir, base '/' olur
 *  - ozel alan adi (custom domain) kullanilacaksa BASE_PATH=/ verilmelidir
 */
function resolveBase(): string {
  if (process.env.BASE_PATH) return process.env.BASE_PATH;
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (!repo) return '/';
  if (repo.endsWith('.github.io')) return '/';
  return `/${repo}/`;
}

const base = resolveBase();

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
