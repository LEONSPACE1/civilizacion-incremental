# De la Chispa a las Estrellas

Juego incremental para navegador sobre la evolución de una civilización humana, desde la primera hoguera hasta la colonización del espacio.

**Jugar:** https://leonspace1.github.io/civilizacion-incremental/

## Estado

Seis eras jugables, cada una con su estilo, su música, su ropa y su parte de la aldea 3D low poly (Three.js):
Paleolítico, Neolítico, Edad del Bronce, Antigüedad, Edad Media y Renacimiento.

- Cada era suma un recurso (comida y madera, piedra, bronce, hierro, oro y libros), sus oficios, sus mejoras y una meta que abre la siguiente.
- La aldea crece con cada compra: el agua pasa de charca a lago (con balsas) y a río (con puente y carabelas), y las afueras se llenan de caseríos, campos, prados, rebaños y monumentos.
- Ciclo de día y noche: de día cada uno hace su oficio; a mediodía hay mercado o fiesta en las plazas, al anochecer baile o velada junto a la hoguera, y de noche todos vuelven a casa con antorchas y se encienden las ventanas.
- Guardado automático, progreso fuera de línea (hasta 8 h) y partida en archivo `.civ`.

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
