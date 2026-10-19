// Prestigio: «Renacer» y el Legado. Al renacer, la tribu vuelve al Paleolítico y gana Sabiduría por
// cada meta de era cumplida en la partida. La Sabiduría compra mejoras permanentes con tope, que
// aceleran las partidas siguientes sin hacerlas triviales: con todo comprado, una partida completa
// dura unos 104 minutos frente a los 208 de la primera (ver tests/balance.test.ts).
import type { GameState } from './state';

export const LEGACY_IDS = ['memory', 'guilds', 'tradition', 'hands', 'patience', 'foremen'] as const;
export type LegacyId = (typeof LEGACY_IDS)[number];

export interface LegacyDef {
  id: LegacyId;
  name: string;
  /** Qué hace cada nivel, en una frase. */
  description: string;
  /** Coste en Sabiduría de cada nivel, en orden; su longitud es el tope de niveles. */
  costs: number[];
  /** Efecto con `level` niveles comprados, para mostrar «ahora → siguiente». */
  effect: (level: number) => string;
}

/** Sabiduría que da la meta de cada era (índice = era). Crece para que llegar lejos compense más
 *  que repetir las primeras eras: 6 al renacer tras la era 3 y 73 tras el cohete. */
export const WISDOM_PER_GOAL = [0, 1, 2, 3, 5, 8, 12, 17, 25];
/** Metas que hay que cumplir en la partida para poder renacer: la 3 es «Inventar la escritura». */
export const REBIRTH_MIN_GOALS = 3;

export const MEMORY_BONUS = 0.1;
export const GUILD_DISCOUNT = 0.95;
export const TRADITION_PEOPLE = 5;
export const HANDS_MULTIPLIER = 3;
/** Minutos extra que trabaja la tribu fuera del juego por cada nivel de Paciencia. */
export const PATIENCE_MINUTES = 10;

const pct = (x: number) => `${Math.round(x * 100)} %`;

export const LEGACY_DEFS: LegacyDef[] = [
  {
    id: 'memory',
    name: 'Memoria de los antepasados',
    description: 'Lo que aprendieron tus antepasados guía cada oficio: +10 % de toda la producción por nivel.',
    costs: [2, 4, 7, 11, 16],
    effect: (l) => `+${pct(l * MEMORY_BONUS)} de producción`,
  },
  {
    id: 'guilds',
    name: 'Gremios',
    description: 'Los maestros enseñan a los aprendices: cada nivel abarata un 5 % todos los oficios.',
    costs: [8, 12, 16],
    effect: (l) => `oficios un ${pct(1 - GUILD_DISCOUNT ** l)} más baratos`,
  },
  {
    id: 'tradition',
    name: 'Tradición oral',
    description: 'Las familias pasan el oficio de padres a hijos: cada oficio empieza con 5 personas en cuanto se descubre.',
    costs: [20],
    effect: (l) => (l ? `cada oficio empieza con ${TRADITION_PEOPLE}` : 'los oficios empiezan vacíos'),
  },
  {
    id: 'hands',
    name: 'Manos hábiles',
    description: 'Recolectar a mano rinde el triple.',
    costs: [1],
    effect: (l) => `recolectar ×${HANDS_MULTIPLIER ** l}`,
  },
  {
    id: 'patience',
    name: 'Paciencia de la tribu',
    description: 'Tu tribu trabaja 10 minutos más mientras no juegas, por cada nivel.',
    costs: [3, 6],
    effect: (l) => `trabaja ${10 + l * PATIENCE_MINUTES} min fuera del juego`,
  },
  {
    id: 'foremen',
    name: 'Capataces',
    description: 'Los capataces contratan solos a la gente de los oficios de eras pasadas, hasta llenarlos.',
    costs: [25],
    effect: (l) => (l ? 'los oficios de eras pasadas se llenan solos' : 'contratas a mano'),
  },
];

export const LEGACY_BY_ID = Object.fromEntries(LEGACY_DEFS.map((d) => [d.id, d])) as Record<LegacyId, LegacyDef>;
/** Sabiduría necesaria para comprar todo el Legado. */
export const LEGACY_TOTAL_COST = LEGACY_DEFS.reduce((sum, d) => sum + d.costs.reduce((a, b) => a + b, 0), 0);

export interface Legacy {
  /** Sabiduría sin gastar. */
  wisdom: number;
  levels: Record<LegacyId, number>;
  /** Cuántas veces ha renacido la civilización. */
  rebirths: number;
  /** La era más lejana a la que ha llegado alguna civilización. */
  bestEra: number;
}

export function newLegacy(): Legacy {
  return { wisdom: 0, levels: Object.fromEntries(LEGACY_IDS.map((id) => [id, 0])) as Record<LegacyId, number>, rebirths: 0, bestEra: 1 };
}

export const level = (state: GameState, id: LegacyId): number => state.legacy.levels[id];
export const maxLevel = (id: LegacyId): number => LEGACY_BY_ID[id].costs.length;

/** Coste del siguiente nivel, o undefined si ya está al tope. */
export function nextLegacyCost(state: GameState, id: LegacyId): number | undefined {
  return LEGACY_BY_ID[id].costs[level(state, id)];
}

export function canBuyLegacy(state: GameState, id: LegacyId): boolean {
  const cost = nextLegacyCost(state, id);
  return cost !== undefined && state.legacy.wisdom >= cost;
}

export function buyLegacy(state: GameState, id: LegacyId): boolean {
  if (!canBuyLegacy(state, id)) return false;
  state.legacy.wisdom -= nextLegacyCost(state, id)!;
  state.legacy.levels[id] += 1;
  return true;
}

/** Metas de era cumplidas en esta partida. */
export function goalsDone(state: GameState): number {
  return state.era - 1 + (state.goalReached ? 1 : 0);
}

/** Sabiduría que daría renacer ahora. */
export function wisdomForRun(state: GameState): number {
  let total = 0;
  for (let era = 1; era <= goalsDone(state); era++) total += WISDOM_PER_GOAL[era] ?? 0;
  return total;
}

export function canRebirth(state: GameState): boolean {
  return goalsDone(state) >= REBIRTH_MIN_GOALS;
}

/** Si el Legado ya se puede ver: desde que se puede renacer por primera vez. */
export function legacyUnlocked(state: GameState): boolean {
  return state.legacy.rebirths > 0 || canRebirth(state);
}

// Efectos de cada mejora del Legado, para logic.ts.
export const productionMultiplier = (state: GameState) => 1 + MEMORY_BONUS * level(state, 'memory');
export const jobCostMultiplier = (state: GameState) => GUILD_DISCOUNT ** level(state, 'guilds');
export const clickMultiplier = (state: GameState) => HANDS_MULTIPLIER ** level(state, 'hands');
export const offlineMinutesBonus = (state: GameState) => PATIENCE_MINUTES * level(state, 'patience');
