import { BUILDINGS, LAST_ERA, newGame, RESOURCES, SAVE_VERSION, type Amounts, type GameState } from './state';
import { zeroAmounts } from './profile';
import { UPGRADE_BY_ID } from './content';
import { BUILDING_CAP } from './balance';
import { LEGACY_IDS, maxLevel } from './legacy';

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
  // El Legado llegó con la versión 4: las partidas anteriores empiezan sin Sabiduría.
  const legacy = (data.legacy ?? {}) as Record<string, unknown>;
  const levels = (legacy.levels ?? {}) as Record<string, unknown>;
  state.legacy.wisdom = num(legacy.wisdom) ?? 0;
  for (const id of LEGACY_IDS) state.legacy.levels[id] = Math.min(maxLevel(id), Math.floor(num(levels[id]) ?? 0));
  state.legacy.rebirths = Math.floor(num(legacy.rebirths) ?? 0);
  state.legacy.bestEra = Math.min(LAST_ERA, Math.max(1, Math.floor(num(legacy.bestEra) ?? state.era)));
  readProfile(state, data);
  state.version = SAVE_VERSION;
  return state;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
function amounts(v: unknown): Amounts {
  const src = (v ?? {}) as Record<string, unknown>;
  const out = zeroAmounts();
  for (const r of RESOURCES) out[r] = num(src[r]) ?? 0;
  return out;
}

/** El perfil (logros, tutoriales, finales y estadísticas) llegó con la versión 5. */
function readProfile(state: GameState, data: Record<string, unknown>): void {
  const p = state.profile;
  if ((num(data.version) ?? 1) < 5 || typeof data.profile !== 'object' || data.profile === null) {
    // Partida de antes de los tutoriales: el jugador ya conoce el juego. Al cargarla se marcan como
    // vistos los tutoriales de todo lo que ya tiene desbloqueado (ver tutorial.ts).
    p.tutorials = ['intro', MIGRATED];
    if (state.era === LAST_ERA && state.goalReached) p.rockets = 1;
    return;
  }
  const src = data.profile as Record<string, unknown>;
  p.achievements = strings(src.achievements);
  p.tutorials = strings(src.tutorials);
  const endings = (src.endings ?? {}) as Record<string, unknown>;
  p.endings = { rocket: endings.rocket === true, true: endings.true === true };
  p.clicks = Math.floor(num(src.clicks) ?? 0);
  p.playSeconds = num(src.playSeconds) ?? 0;
  p.rockets = Math.floor(num(src.rockets) ?? 0);
  p.maxRate = amounts(src.maxRate);
  p.maxPopulation = Math.floor(num(src.maxPopulation) ?? 1);
  p.civs = (Array.isArray(src.civs) ? src.civs : []).filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null).map((c, i) => ({
    n: Math.floor(num(c.n) ?? i + 1),
    era: Math.min(LAST_ERA, Math.max(1, Math.floor(num(c.era) ?? 1))),
    rocket: c.rocket === true,
    seconds: num(c.seconds) ?? 0,
    population: Math.floor(num(c.population) ?? 1),
    wisdom: Math.floor(num(c.wisdom) ?? 0),
    maxRate: amounts(c.maxRate),
  }));
  const run = (src.run ?? {}) as Record<string, unknown>;
  p.run = {
    seconds: num(run.seconds) ?? 0,
    clicks: Math.floor(num(run.clicks) ?? 0),
    maxRate: amounts(run.maxRate),
    goalTimes: (Array.isArray(run.goalTimes) ? run.goalTimes : []).map((t) => num(t) ?? 0),
  };
}

/** Marca que deja una partida anterior a los tutoriales hasta que el juego la ve por primera vez. */
export const MIGRATED = '*migrada';

const FILE_GAME = 'civilizacion-incremental';

/** Contenido del archivo de partida que se descarga al exportar. */
export function exportFileText(state: GameState, now = Date.now()): string {
  return JSON.stringify({ juego: FILE_GAME, era: state.era, exportada: new Date(now).toISOString(), partida: serialize(state) }, null, 2) + '\n';
}

/** Nombre del archivo de partida: lleva la era y la fecha para distinguir varias copias. */
export function exportFileName(state: GameState, now = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `civilizacion-era${state.era}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.civ`;
}

/** Lee un archivo de partida. También acepta el texto que se copiaba antes al exportar. */
export function importFileText(text: string): GameState | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      return data.juego === FILE_GAME && typeof data.partida === 'string' ? deserialize(data.partida) : null;
    } catch {
      return null;
    }
  }
  return deserialize(trimmed);
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
