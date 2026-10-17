// Ajustes gráficos: cinco niveles de calidad, del que más ahorra batería al que mejor se ve, y
// un tope de fotogramas por segundo. El nivel 3 es como se veía el juego hasta ahora.

export type QualityLevel = 1 | 2 | 3 | 4 | 5;
export type FpsLimit = 'auto' | 30 | 45 | 60 | 'max';

export interface QualityPreset {
  name: string;
  hint: string;
  /** Tope de píxeles por píxel de pantalla (más nitidez cuanto más alto). */
  maxPixelRatio: number;
  /** Escala sobre la resolución de la pantalla: por debajo de 1 se dibuja a menos resolución. */
  pixelScale: number;
  shadows: boolean;
  /** Sombras con bordes suaves (más caras) o duras. */
  softShadows: boolean;
  /** Tamaño del mapa de sombras de la luna o el sol. */
  shadowMap: number;
  /** El fuego también proyecta sombras. */
  fireShadows: boolean;
  /** Recalcular las sombras en cada fotograma en vez de en fotogramas alternos. */
  shadowsEveryFrame: boolean;
  /** Las piezas diminutas también proyectan sombra. */
  tinyShadows: boolean;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  1: {
    name: 'Máximo rendimiento',
    hint: 'Menos resolución y sin sombras. El que menos batería gasta.',
    maxPixelRatio: 1, pixelScale: 0.75, shadows: false, softShadows: false, shadowMap: 1024,
    fireShadows: false, shadowsEveryFrame: false, tinyShadows: false,
  },
  2: {
    name: 'Rendimiento',
    hint: 'Resolución normal y sombras sencillas del sol o la luna.',
    maxPixelRatio: 1.5, pixelScale: 1, shadows: true, softShadows: false, shadowMap: 1024,
    fireShadows: false, shadowsEveryFrame: false, tinyShadows: false,
  },
  3: {
    name: 'Equilibrada',
    hint: 'Nítida, con sombras suaves y la luz del fuego. Recomendada.',
    maxPixelRatio: 2, pixelScale: 1, shadows: true, softShadows: true, shadowMap: 2048,
    fireShadows: true, shadowsEveryFrame: false, tinyShadows: false,
  },
  4: {
    name: 'Calidad',
    hint: 'Más nitidez y sombras que se recalculan en cada fotograma.',
    maxPixelRatio: 2.5, pixelScale: 1, shadows: true, softShadows: true, shadowMap: 2048,
    fireShadows: true, shadowsEveryFrame: true, tinyShadows: false,
  },
  5: {
    name: 'Máxima calidad',
    hint: 'Resolución completa de la pantalla y sombras muy finas. Gasta más batería.',
    maxPixelRatio: 3, pixelScale: 1, shadows: true, softShadows: true, shadowMap: 4096,
    fireShadows: true, shadowsEveryFrame: true, tinyShadows: true,
  },
};

export const FPS_OPTIONS: { id: FpsLimit; name: string; hint: string }[] = [
  { id: 'auto', name: 'Auto', hint: '30 móvil, 60 PC' },
  { id: 30, name: '30', hint: 'fps' },
  { id: 45, name: '45', hint: 'fps' },
  { id: 60, name: '60', hint: 'fps' },
  { id: 'max', name: 'Máx.', hint: 'los de la pantalla' },
];

export const DEFAULT_QUALITY: QualityLevel = 3;
export const DEFAULT_FPS: FpsLimit = 'auto';

export const isQualityLevel = (v: unknown): v is QualityLevel => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
export const isFpsLimit = (v: unknown): v is FpsLimit => FPS_OPTIONS.some((o) => o.id === v);

/**
 * Milisegundos entre fotogramas: en reposo y mientras se arrastra la cámara. En «Auto», 30 fps en
 * pantallas táctiles y 60 en el resto, y 60 al arrastrar para que la cámara responda fluida.
 * Con un tope elegido a mano se respeta también al arrastrar. 0 = sin tope.
 */
export function frameIntervals(fps: FpsLimit, touch: boolean): { idle: number; drag: number } {
  if (fps === 'max') return { idle: 0, drag: 0 };
  if (fps === 'auto') return { idle: 1000 / (touch ? 30 : 60), drag: 1000 / 60 };
  return { idle: 1000 / fps, drag: 1000 / fps };
}

/** Píxeles por píxel de pantalla con los que se dibuja la escena. */
export function pixelRatioFor(level: QualityLevel, devicePixelRatio: number): number {
  const p = QUALITY_PRESETS[level];
  return Math.min(devicePixelRatio, p.maxPixelRatio) * p.pixelScale;
}
