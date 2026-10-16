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
import { newGame, type Cost, type GameState } from './state';

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
}

export interface SimOptions {
  /** Clics por segundo durante los primeros minutos, cuando el clic aún importa. */
  earlyClicksPerSecond?: number;
  earlyClickSeconds?: number;
  maxSeconds?: number;
}

// La madera vale más que la comida porque se produce más lento.
const value = (c: Cost) => (c.food ?? 0) + (c.wood ?? 0) * 2.5;

/** Un jugador razonable: compra mejoras en cuanto puede y, si no, el edificio más rentable. */
function nextTarget(s: GameState): { cost: Cost; buy: () => boolean; name: string } {
  if (secondsUntil(s, ERA1_GOAL.cost) < 120) {
    return { cost: ERA1_GOAL.cost, buy: () => buyGoal(s), name: ERA1_GOAL.name };
  }
  const ups = UPGRADE_DEFS.filter((u) => upgradeAvailable(s, u.id));
  if (ups.length) {
    const u = ups.reduce((a, b) => (value(a.cost) <= value(b.cost) ? a : b));
    return { cost: u.cost, buy: () => buyUpgrade(s, u.id), name: u.name };
  }
  const rates = ratePerSecond(s);
  const options = BUILDING_DEFS.filter((b) => b.unlocked(s)).map((b) => {
    const cost = buildingCost(s, b.id);
    // Si falta madera, los leñadores pasan a ser prioritarios.
    const woodNeed = b.produces === 'wood' && rates.wood < rates.food / 6 ? 3 : 1;
    const gainValue = unitRate(s, b.id) * (b.produces === 'wood' ? 2.5 : 1) * woodNeed;
    return { b, cost, score: (value(cost) / gainValue) + secondsUntil(s, cost) };
  });
  const best = options.reduce((a, c) => (c.score < a.score ? c : a));
  return { cost: best.cost, buy: () => buyBuilding(s, best.b.id), name: best.b.name };
}

export function simulateEra1(options: SimOptions = {}): SimResult {
  const { earlyClicksPerSecond = 3, earlyClickSeconds = 180, maxSeconds = 4 * 3600 } = options;
  const s = newGame(0);
  const events: SimEvent[] = [];
  let lastBuy = 0;
  let longestWait = 0;
  let longestWaitBefore = '';
  let pendingClicks = 0;
  for (let t = 0; t < maxSeconds; t++) {
    pendingClicks += t < earlyClickSeconds ? earlyClicksPerSecond : 0.2;
    for (; pendingClicks >= 1; pendingClicks--) gather(s);
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
      if (s.goalReached) return { finished: true, seconds: t, longestWait, longestWaitBefore, events };
    }
  }
  return { finished: false, seconds: maxSeconds, longestWait, longestWaitBefore, events };
}
