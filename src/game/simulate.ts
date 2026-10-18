import { BUILDING_DEFS, UPGRADE_DEFS } from './content';
import {
  advanceEra,
  atCap,
  buildingCost,
  buyBuilding,
  buyGoal,
  buyUpgrade,
  canAfford,
  currentGoal,
  gather,
  ratePerSecond,
  secondsUntil,
  tick,
  unitRate,
  upgradeAvailable,
} from './logic';
import { newGame, RESOURCES, type Cost, type GameState, type ResourceId } from './state';

export interface SimEvent {
  time: number;
  what: string;
}

export interface SimResult {
  finished: boolean;
  seconds: number;
  longestWait: number;
  longestWaitBefore: string;
  events: SimEvent[];
  /** Segundos de espera en los que faltaba sobre todo cada recurso. */
  blockedBy: Record<ResourceId, number>;
  /** Producción por segundo al terminar. */
  finalRates: Record<ResourceId, number>;
  /** La partida al terminar, para seguir simulando la era siguiente. */
  state: GameState;
}

export interface SimOptions {
  /** Clics por segundo durante los primeros minutos, cuando el clic aún importa. */
  earlyClicksPerSecond?: number;
  earlyClickSeconds?: number;
  maxSeconds?: number;
  /** Cuánto valora el jugador cada recurso; por defecto los dos igual. */
  bias?: Partial<Record<ResourceId, number>>;
  /** Se llama cada segundo simulado (para estudiar la curva de progreso). */
  onSecond?: (t: number, s: GameState) => void;
}

const NO_BIAS = Object.fromEntries(RESOURCES.map((r) => [r, 1])) as Record<ResourceId, number>;
let bias = { ...NO_BIAS };
const value = (c: Cost) => RESOURCES.reduce((sum, r) => sum + (c[r] ?? 0) * bias[r], 0);

/** Un jugador razonable: compra mejoras en cuanto puede y, si no, el edificio más rentable. */
function nextTarget(s: GameState): { cost: Cost; buy: () => boolean; name: string } {
  const goal = currentGoal(s);
  if (secondsUntil(s, goal.cost) < 120) {
    return { cost: goal.cost, buy: () => buyGoal(s), name: goal.name };
  }
  const buildings = BUILDING_DEFS.filter((b) => b.unlocked(s) && !atCap(s, b.id)).map((b) => {
    const cost = buildingCost(s, b.id);
    const gainValue = unitRate(s, b.id) * bias[b.produces];
    return { b, cost, score: value(cost) / gainValue + secondsUntil(s, cost) };
  });
  const asTarget = (o: (typeof buildings)[number]) => ({ cost: o.cost, buy: () => buyBuilding(s, o.b.id), name: o.b.name });
  // Una mejora que nunca se podría pagar (falta un recurso que aún no se produce) no cuenta.
  const ups = UPGRADE_DEFS.filter((u) => upgradeAvailable(s, u.id) && secondsUntil(s, u.cost) < Infinity);
  if (ups.length) {
    const u = ups.reduce((a, b) => (value(a.cost) <= value(b.cost) ? a : b));
    const wait = secondsUntil(s, u.cost);
    if (wait > 45) {
      // Mientras espera una mejora cara, refuerza el recurso que le falta, como haría una persona.
      const rates = ratePerSecond(s);
      const missing = (r: ResourceId) => Math.max(0, (u.cost[r] ?? 0) - s.resources[r]) / Math.max(rates[r], 1e-9);
      const short = RESOURCES.reduce((a, r) => (missing(r) > missing(a) ? r : a));
      const helpers = buildings.filter((o) => o.b.produces === short && secondsUntil(s, o.cost) < wait / 3);
      if (helpers.length) return asTarget(helpers.reduce((a, c) => (c.score < a.score ? c : a)));
    }
    return { cost: u.cost, buy: () => buyUpgrade(s, u.id), name: u.name };
  }
  if (!buildings.length) return { cost: goal.cost, buy: () => buyGoal(s), name: goal.name };
  return asTarget(buildings.reduce((a, c) => (c.score < a.score ? c : a)));
}

export function simulateEra1(options: SimOptions = {}): SimResult {
  return simulateEra(newGame(0), options);
}

// Cada era empieza donde termina la anterior, jugada por el mismo jugador. Las partidas al final de
// cada era se guardan para no volver a jugar las eras anteriores en cada prueba.
const finished = new Map<string, GameState>();
function startOfEra(era: number, options: SimOptions): GameState {
  if (era <= 1) return newGame(0);
  const key = `${era}:${JSON.stringify({ ...options, onSecond: undefined })}`;
  let s = finished.get(key);
  if (!s) {
    s = simulateEra(startOfEra(era - 1, options), era === 2 ? options : { earlyClickSeconds: 0, ...options }).state;
    advanceEra(s);
    finished.set(key, s);
  }
  return structuredClone(s);
}

/** Juega la era indicada con una partida que viene de jugar todas las anteriores. */
export function simulateEraN(era: number, options: SimOptions = {}): SimResult {
  return simulateEra(startOfEra(era, options), era === 1 ? options : { earlyClickSeconds: 0, ...options });
}

export const simulateEra2 = (options: SimOptions = {}) => simulateEraN(2, options);
export const simulateEra3 = (options: SimOptions = {}) => simulateEraN(3, options);
export const simulateEra4 = (options: SimOptions = {}) => simulateEraN(4, options);
export const simulateEra5 = (options: SimOptions = {}) => simulateEraN(5, options);
export const simulateEra6 = (options: SimOptions = {}) => simulateEraN(6, options);
export const simulateEra7 = (options: SimOptions = {}) => simulateEraN(7, options);
export const simulateEra8 = (options: SimOptions = {}) => simulateEraN(8, options);

/** Juega la era en la que está la partida hasta pagar su meta. */
export function simulateEra(s: GameState, options: SimOptions = {}): SimResult {
  const { earlyClicksPerSecond = 3, earlyClickSeconds = 180, maxSeconds = 4 * 3600 } = options;
  bias = { ...NO_BIAS, ...options.bias };
  const events: SimEvent[] = [];
  let lastBuy = 0;
  let longestWait = 0;
  let longestWaitBefore = '';
  let pendingClicks = 0;
  const blockedBy = Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Record<ResourceId, number>;
  for (let t = 0; t < maxSeconds; t++) {
    pendingClicks += t < earlyClickSeconds ? earlyClicksPerSecond : 0.2;
    for (; pendingClicks >= 1; pendingClicks--) gather(s);
    // Qué recurso hace esperar al jugador ahora mismo
    const wanted = nextTarget(s).cost;
    if (!canAfford(s, wanted)) {
      const rates = ratePerSecond(s);
      let worst: ResourceId = 'food', worstTime = -1;
      for (const r of RESOURCES) {
        const time = Math.max(0, (wanted[r] ?? 0) - s.resources[r]) / Math.max(rates[r], 1e-9);
        if (time > worstTime) [worst, worstTime] = [r, time];
      }
      blockedBy[worst]++;
    }
    tick(s, 1);
    options.onSecond?.(t, s);
    for (let guard = 0; guard < 20; guard++) {
      const target = nextTarget(s);
      if (!canAfford(s, target.cost) || !target.buy()) break;
      if (t - lastBuy > longestWait) {
        longestWait = t - lastBuy;
        longestWaitBefore = target.name;
      }
      lastBuy = t;
      events.push({ time: t, what: target.name });
      if (s.goalReached) return { finished: true, seconds: t, longestWait, longestWaitBefore, events, blockedBy, finalRates: ratePerSecond(s), state: s };
    }
  }
  return { finished: false, seconds: maxSeconds, longestWait, longestWaitBefore, events, blockedBy, finalRates: ratePerSecond(s), state: s };
}
