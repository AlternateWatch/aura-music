import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// Antes de que `vite build` vacíe la carpeta `dist/`, rescatamos cualquier archivo
// que ejecuciones anteriores de `./dist/server.js` hayan guardado en `dist/public/uploads`.
try {
  const trappedDir = path.resolve(__dirname, 'dist', 'public', 'uploads');
  const targetDir =
    process.platform !== 'win32' && fs.existsSync('/var/www/aura-uploads')
      ? '/var/www/aura-uploads'
      : path.resolve(__dirname, 'public', 'uploads');

  if (
    fs.existsSync(trappedDir) &&
    fs.statSync(trappedDir).isDirectory() &&
    fs.existsSync(targetDir) &&
    fs.statSync(targetDir).isDirectory()
  ) {
    for (const file of fs.readdirSync(trappedDir)) {
      const src = path.join(trappedDir, file);
      const dest = path.join(targetDir, file);
      if (!fs.existsSync(dest) && fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
        console.log(`[vite pre-build] Rescatado archivo de dist/public/uploads -> ${dest}`);
      }
    }
  }
} catch {}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
