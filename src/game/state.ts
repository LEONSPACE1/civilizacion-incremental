// Estado completo de una partida. Todo lo que se guarda vive aquí.
export interface GameState {
  version: number;
  food: number;
  totalFood: number;
  gatherers: number;
  lastSaved: number;
}

export const SAVE_VERSION = 1;

export function newGame(now = Date.now()): GameState {
  return {
    version: SAVE_VERSION,
    food: 0,
    totalFood: 0,
    gatherers: 0,
    lastSaved: now,
  };
}
