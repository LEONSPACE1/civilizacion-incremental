# De la Chispa a las Estrellas

Juego incremental para navegador sobre la evolución de una civilización humana, desde la primera hoguera hasta la colonización del espacio.

**Jugar:** https://leonspace1.github.io/civilizacion-incremental/

## Estado

Fase 1 (base técnica): recolección con clic, recolectores automáticos, guardado automático, progreso fuera de línea y exportar/importar partida.

## Desarrollo

Requiere Node 22.

```bash
npm install
npm run dev     # servidor local con recarga instantánea
npm test        # pruebas
npm run build   # versión para publicar en dist/
```

Cada cambio en `main` se prueba y se publica automáticamente en GitHub Pages.

## Estructura

- `src/game/` lógica pura del juego (estado, balance, guardado, formato), sin DOM.
- `src/main.ts` interfaz: dibuja el estado y conecta los botones.
- `tests/` pruebas de la lógica.
