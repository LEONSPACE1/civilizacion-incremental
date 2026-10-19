/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Rutas relativas para que el juego funcione en GitHub Pages (/civilizacion-incremental/).
export default defineConfig({
  base: './',
  // three.js ocupa unos 600 kB; es esperado.
  // es2022: main.ts espera (top-level await) a cargar el idioma, las letras y la aldea antes de quitar la pantalla de carga.
  build: { chunkSizeWarningLimit: 900, target: 'es2022' },
  test: {
    environment: 'jsdom',
  },
});
