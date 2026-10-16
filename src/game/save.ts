import { newGame, SAVE_VERSION, type GameState } from './state';

const STORAGE_KEY = 'civilizacion-incremental:save';

export function serialize(state: GameState): string {
  return btoa(JSON.stringify(state));
}

/** Convierte un texto exportado en partida. Devuelve null si no es válido. */
export function deserialize(text: string): GameState | null {
  try {
    const data = JSON.parse(atob(text.trim()));
    if (typeof data !== 'object' || data === null) return null;
    const base = newGame(0);
    const state: GameState = { ...base };
    for (const key of Object.keys(base) as (keyof GameState)[]) {
      const value = data[key];
      if (typeof value === 'number' && Number.isFinite(value)) state[key] = value;
    }
    state.version = SAVE_VERSION;
    return state;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState, now = Date.now()): void {
  state.lastSaved = now;
  try {
    localStorage.setItem(STORAGE_KEY, serialize(state));
  } catch {
    // Sin almacenamiento (modo privado): el juego sigue funcionando sin guardar.
  }
}

export function loadGame(): GameState | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? deserialize(text) : null;
  } catch {
    return null;
  }
}

export function deleteSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nada que borrar.
  }
}
