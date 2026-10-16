/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Rutas relativas para que el juego funcione en GitHub Pages (/civilizacion-incremental/).
export default defineConfig({
  base: './',
  // three.js ocupa unos 600 kB; es esperado.
  build: { chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
  },
});
