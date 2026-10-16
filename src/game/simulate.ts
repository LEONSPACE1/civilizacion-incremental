import { BUILDING_DEFS, ERA1_GOAL, UPGRADE_DEFS } from './content';
import {
  buildingCost,
  buyBuilding,
  buyGoal,
  buyUpgrade,
  canAfford,
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
}

export interface SimOptions {
  /** Clics por segundo durante los primeros minutos, cuando el clic aún importa. */
  earlyClicksPerSecond?: number;
  earlyClickSeconds?: number;
  maxSeconds?: number;
  /** Cuánto valora el jugador cada recurso; por defecto los dos igual. */
  bias?: Partial<Record<ResourceId, number>>;
}

let bias: Record<ResourceId, number> = { food: 1, wood: 1 };
const value = (c: Cost) => RESOURCES.reduce((sum, r) => sum + (c[r] ?? 0) * bias[r], 0);

/** Un jugador razonable: compra mejoras en cuanto puede y, si no, el edificio más rentable. */
function nextTarget(s: GameState): { cost: Cost; buy: () => boolean; name: string } {
  if (secondsUntil(s, ERA1_GOAL.cost) < 120) {
    return { cost: ERA1_GOAL.cost, buy: () => buyGoal(s), name: ERA1_GOAL.name };
  }
  const buildings = BUILDING_DEFS.filter((b) => b.unlocked(s)).map((b) => {
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
      const short = RESOURCES.reduce((a, r) =>
        ((u.cost[r] ?? 0) - s.resources[r]) / rates[r] > ((u.cost[a] ?? 0) - s.resources[a]) / rates[a] ? r : a,
      );
      const helpers = buildings.filter((o) => o.b.produces === short && secondsUntil(s, o.cost) < wait / 3);
      if (helpers.length) return asTarget(helpers.reduce((a, c) => (c.score < a.score ? c : a)));
    }
    return { cost: u.cost, buy: () => buyUpgrade(s, u.id), name: u.name };
  }
  return asTarget(buildings.reduce((a, c) => (c.score < a.score ? c : a)));
}

export function simulateEra1(options: SimOptions = {}): SimResult {
  const { earlyClicksPerSecond = 3, earlyClickSeconds = 180, maxSeconds = 4 * 3600 } = options;
  bias = { food: 1, wood: 1, ...options.bias };
  const s = newGame(0);
  const events: SimEvent[] = [];
  let lastBuy = 0;
  let longestWait = 0;
  let longestWaitBefore = '';
  let pendingClicks = 0;
  const blockedBy: Record<ResourceId, number> = { food: 0, wood: 0 };
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
    for (let guard = 0; guard < 20; guard++) {
      const target = nextTarget(s);
      if (!canAfford(s, target.cost) || !target.buy()) break;
      if (t - lastBuy > longestWait) {
        longestWait = t - lastBuy;
        longestWaitBefore = target.name;
      }
      lastBuy = t;
      events.push({ time: t, what: target.name });
      if (s.goalReached) return { finished: true, seconds: t, longestWait, longestWaitBefore, events, blockedBy, finalRates: ratePerSecond(s) };
    }
  }
  return { finished: false, seconds: maxSeconds, longestWait, longestWaitBefore, events, blockedBy, finalRates: ratePerSecond(s) };
}
