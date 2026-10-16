/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Rutas relativas para que el juego funcione en GitHub Pages (/civilizacion-incremental/).
export default defineConfig({
  base: './',
  test: {
    environment: 'jsdom',
  },
});
