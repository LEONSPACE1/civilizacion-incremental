// Lo que se recuerda de todas las civilizaciones del jugador: logros, tutoriales vistos, finales
// alcanzados y estadísticas para el resumen del final verdadero. Sobrevive al renacer, como el Legado.
import type { Amounts } from './state';

/** Una civilización terminada (al renacer). */
export interface CivRecord {
  /** Número de la civilización: 1 es la primera. */
  n: number;
  /** Era a la que llegó. */
  era: number;
  /** Si lanzó el cohete. */
  rocket: boolean;
  /** Segundos que duró (tiempo de juego, contando los minutos fuera que trabajó la tribu). */
  seconds: number;
  population: number;
  /** Sabiduría que ganó al renacer. */
  wisdom: number;
  /** Producción máxima por segundo de cada recurso. */
  maxRate: Amounts;
}

/** La civilización en curso. */
export interface RunStats {
  seconds: number;
  clicks: number;
  maxRate: Amounts;
  /** Segundo de la partida en que se cumplió la meta de cada era (índice = era − 1). */
  goalTimes: number[];
}

export interface Profile {
  achievements: string[];
  tutorials: string[];
  /** Finales vistos: el del cohete y el verdadero (con el juego al 100 %). */
  endings: { rocket: boolean; true: boolean };
  clicks: number;
  playSeconds: number;
  rockets: number;
  maxRate: Amounts;
  maxPopulation: number;
  civs: CivRecord[];
  run: RunStats;
}

export const zeroAmounts = (): Amounts => ({ food: 0, wood: 0, stone: 0, metal: 0, iron: 0, gold: 0, books: 0, coal: 0, energy: 0 });

export const newRun = (): RunStats => ({ seconds: 0, clicks: 0, maxRate: zeroAmounts(), goalTimes: [] });

export function newProfile(): Profile {
  return {
    achievements: [],
    tutorials: [],
    endings: { rocket: false, true: false },
    clicks: 0,
    playSeconds: 0,
    rockets: 0,
    maxRate: zeroAmounts(),
    maxPopulation: 1,
    civs: [],
    run: newRun(),
  };
}
