# De la Chispa a las Estrellas

Juego incremental para navegador sobre la evolución de una civilización humana, desde la primera hoguera hasta la colonización del espacio.

**Jugar:** https://leonspace1.github.io/civilizacion-incremental/

## Estado

Fase 2: la era 1 (Paleolítico) completa y jugable, con una aldea 3D low poly (Three.js) que crece con cada compra.

- 4 oficios: recolector, leñador, cazador y pescador. Cada uno duplica su producción al llegar a 10, 25, 50 y 100.
- 6 mejoras y una meta de era: descubrir la agricultura.
- Guardado automático, progreso fuera de línea (hasta 8 h) y exportar/importar partida.

## Desarrollo

Requiere Node 22.

```bash
npm install
npm run dev     # servidor local con recarga instantánea
npm test        # pruebas, incluido el simulador de balance
npm run build   # versión para publicar en dist/
```

Cada cambio en `main` se prueba y se publica automáticamente en GitHub Pages.

## Estructura

- `src/game/content.ts` contenido de la era: edificios, mejoras, meta y sus números.
- `src/game/` lógica pura del juego (estado, reglas, guardado, simulador), sin DOM.
- `src/scene/village.ts` la aldea 3D: lee el estado y añade tiendas, aldeanos y objetos.
- `src/main.ts` interfaz: dibuja el estado y conecta los botones.
- `tests/` pruebas; `balance.test.ts` simula una partida y falla si la era dura menos de 10 o más de 25 minutos, o si alguna espera supera 3 minutos.
