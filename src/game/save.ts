import { BUILDINGS, LAST_ERA, newGame, RESOURCES, SAVE_VERSION, type GameState } from './state';
import { UPGRADE_BY_ID } from './content';
import { BUILDING_CAP } from './balance';

const STORAGE_KEY = 'civilizacion-incremental:save';

export function serialize(state: GameState): string {
  return btoa(JSON.stringify(state));
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Convierte un texto exportado en partida, migrando versiones antiguas. Devuelve null si no es válido. */
export function deserialize(text: string): GameState | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(atob(text.trim()));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const state = newGame(num(data.lastSaved) ?? Date.now());

  if ((num(data.version) ?? 1) < 2) {
    // Versión 1 (fase 1): solo comida y recolectores.
    state.resources.food = num(data.food) ?? 0;
    state.totals.food = num(data.totalFood) ?? state.resources.food;
    state.buildings.gatherer = Math.floor(num(data.gatherers) ?? 0);
    return state;
  }

  const resources = (data.resources ?? {}) as Record<string, unknown>;
  const totals = (data.totals ?? {}) as Record<string, unknown>;
  const buildings = (data.buildings ?? {}) as Record<string, unknown>;
  for (const r of RESOURCES) {
    state.resources[r] = num(resources[r]) ?? 0;
    state.totals[r] = num(totals[r]) ?? state.resources[r];
  }
  // Las partidas anteriores al tope pueden tener más personas en un oficio: se ajustan al tope.
  for (const b of BUILDINGS) state.buildings[b] = Math.min(BUILDING_CAP, Math.floor(num(buildings[b]) ?? 0));
  if (Array.isArray(data.upgrades)) state.upgrades = data.upgrades.filter((u): u is string => typeof u === 'string' && u in UPGRADE_BY_ID);
  state.goalReached = data.goalReached === true;
  state.awaySince = num(data.awaySince) ?? null;
  // Las partidas de la versión 2 no guardaban la era: todas eran del Paleolítico.
  state.era = Math.min(LAST_ERA, Math.max(1, Math.floor(num(data.era) ?? 1)));
  state.version = SAVE_VERSION;
  return state;
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
