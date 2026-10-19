// Logros: reconocen el progreso del jugador en todas sus civilizaciones. El porcentaje de logros
// conseguidos es el avance del juego; con el 100 %, lanzar el cohete lleva al final verdadero.
// Se guardan en el perfil (sobreviven al renacer) y una vez conseguidos no se pierden.
import { BUILDING_CAP } from './balance';
import { BUILDING_DEFS, UPGRADE_DEFS } from './content';
import { LEGACY_TOTAL_COST, LEGACY_DEFS } from './legacy';
import { population } from './logic';
import { BUILDINGS, LAST_ERA, RESOURCES, type GameState } from './state';

export const ACH_GROUPS = ['history', 'tribe', 'upgrades', 'production', 'legacy', 'feats'] as const;
export type AchGroup = (typeof ACH_GROUPS)[number];

export interface AchievementDef {
  id: string;
  group: AchGroup;
  /** Clave de los textos (ach.<key>.name / ach.<key>.desc); varios logros pueden compartirla. */
  key: string;
  /** Valores para los textos, p. ej. la era o la cantidad. */
  params?: Record<string, number>;
  done: (s: GameState) => boolean;
  /** Avance hacia el logro, para la barra: [lo que hay, lo que pide]. */
  progress?: (s: GameState) => [number, number];
}

const eras = Array.from({ length: LAST_ERA }, (_, i) => i + 1);
const bestEra = (s: GameState) => Math.max(s.era, s.legacy.bestEra);
const legacySpent = (s: GameState) =>
  LEGACY_DEFS.reduce((sum, d) => sum + d.costs.slice(0, s.legacy.levels[d.id]).reduce((a, b) => a + b, 0), 0);
const maxRate = (s: GameState) => Math.max(...RESOURCES.map((r) => s.profile.maxRate[r]));
const jobsFull = (s: GameState, era: number) => BUILDING_DEFS.filter((b) => b.era === era).filter((b) => s.buildings[b.id] >= BUILDING_CAP).length;
const jobsOf = (era: number) => BUILDING_DEFS.filter((b) => b.era === era).length;
const upsOwned = (s: GameState, era: number) => UPGRADE_DEFS.filter((u) => u.era === era && s.upgrades.includes(u.id)).length;
const upsOf = (era: number) => UPGRADE_DEFS.filter((u) => u.era === era).length;
/** Población con todos los oficios llenos. */
export const FULL_POPULATION = 1 + BUILDINGS.length * BUILDING_CAP;

const count = (id: string, group: AchGroup, key: string, need: number, have: (s: GameState) => number, params: Record<string, number> = {}): AchievementDef => ({
  id, group, key, params: { n: need, ...params }, done: (s) => have(s) >= need, progress: (s) => [Math.min(have(s), need), need],
});

/** Producción por segundo de un solo recurso para los logros de producción: el jugador de la
 *  simulación llega a cada una al final de su era (era 1: 9,3e3 … era 8: 5,5e24). */
export const RATE_STEPS = [1e3, 1e6, 1e8, 1e11, 1e14, 1e17, 1e21, 1e24];

export const ACHIEVEMENTS: AchievementDef[] = [
  // Historia: cada era y el cohete.
  ...eras.slice(1).map((n) => ({ id: `era${n}`, group: 'history' as const, key: `era${n}`, params: { era: n }, done: (s: GameState) => bestEra(s) >= n })),
  { id: 'rocket', group: 'history', key: 'rocket', done: (s) => s.profile.rockets >= 1 },
  // La tribu: población, oficios completos y todos los oficios de cada era.
  { id: 'hire1', group: 'tribe', key: 'hire1', done: (s) => population(s) >= 2 },
  ...[100, 500, 1000, 2000].map((n) => count(`pop${n}`, 'tribe', 'pop', n, (s) => Math.max(s.profile.maxPopulation, population(s)))),
  count('popMax', 'tribe', 'popMax', FULL_POPULATION, (s) => Math.max(s.profile.maxPopulation, population(s))),
  { id: 'cap1', group: 'tribe', key: 'cap1', params: { n: BUILDING_CAP }, done: (s) => BUILDING_DEFS.some((b) => s.buildings[b.id] >= BUILDING_CAP) },
  ...eras.map((n) => count(`jobs${n}`, 'tribe', 'jobsEra', jobsOf(n), (s) => jobsFull(s, n), { era: n })),
  // Mejoras.
  { id: 'up1', group: 'upgrades', key: 'up1', done: (s) => s.upgrades.length > 0 },
  ...eras.map((n) => count(`ups${n}`, 'upgrades', 'upsEra', upsOf(n), (s) => upsOwned(s, n), { era: n })),
  // Producción: el récord de un solo recurso por segundo.
  ...RATE_STEPS.map((n, i) => count(`rate${i + 1}`, 'production', 'rate', n, maxRate)),
  // Legado.
  count('rebirth1', 'legacy', 'rebirth1', 1, (s) => s.legacy.rebirths),
  count('rebirth3', 'legacy', 'rebirths', 3, (s) => s.legacy.rebirths),
  { id: 'legacy1', group: 'legacy', key: 'legacy1', done: (s) => legacySpent(s) > 0 },
  count('legacyAll', 'legacy', 'legacyAll', LEGACY_TOTAL_COST, legacySpent),
  count('rocket2', 'legacy', 'rocket2', 2, (s) => s.profile.rockets),
  // Hazañas.
  ...[100, 1000, 5000].map((n) => count(`clicks${n}`, 'feats', 'clicks', n, (s) => s.profile.clicks)),
  { id: 'fastEra1', group: 'feats', key: 'fastEra1', params: { min: 10 }, done: (s) => (s.profile.run.goalTimes[0] ?? Infinity) < 10 * 60 },
  { id: 'fastRocket', group: 'feats', key: 'fastRocket', params: { h: 3 }, done: (s) => (s.profile.run.goalTimes[LAST_ERA - 1] ?? Infinity) < 3 * 3600 },
  count('play1h', 'feats', 'playH', 1, (s) => s.profile.playSeconds / 3600),
  count('play5h', 'feats', 'playH', 5, (s) => s.profile.playSeconds / 3600),
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a])) as Record<string, AchievementDef>;

/** Apunta los logros recién conseguidos y los devuelve. */
export function checkAchievements(s: GameState): AchievementDef[] {
  const got = new Set(s.profile.achievements);
  const fresh = ACHIEVEMENTS.filter((a) => !got.has(a.id) && a.done(s));
  for (const a of fresh) s.profile.achievements.push(a.id);
  return fresh;
}

export const achievedCount = (s: GameState) => ACHIEVEMENTS.filter((a) => s.profile.achievements.includes(a.id)).length;

/** Avance del juego, de 0 a 1: la parte de los logros conseguidos. */
export const completion = (s: GameState) => achievedCount(s) / ACHIEVEMENTS.length;

/** El juego al 100 %: todos los logros. Con él, el cohete lleva al final verdadero. */
export const allAchieved = (s: GameState) => achievedCount(s) === ACHIEVEMENTS.length;
