import { BASE_CLICK, BUILDING_CAP, MAX_OFFLINE_SECONDS, MILESTONES } from './balance';
import { BUILDING_BY_ID, BUILDING_DEFS, COST_GROWTH, GOALS, UPGRADE_BY_ID, UPGRADE_DEFS, type GoalDef } from './content';
import { clickMultiplier, jobCostMultiplier, level, offlineMinutesBonus, productionMultiplier, TRADITION_PEOPLE, wisdomForRun, canRebirth } from './legacy';
import { LAST_ERA, newGame, RESOURCES, type Amounts, type BuildingId, type Cost, type GameState, type ResourceId } from './state';

function upgradeMultiplier(state: GameState, match: (e: (typeof UPGRADE_DEFS)[number]['effect']) => boolean): number {
  let m = 1;
  for (const id of state.upgrades) {
    const u = UPGRADE_BY_ID[id];
    if (u && match(u.effect)) m *= u.effect.multiplier;
  }
  return m;
}

/** Cuántos hitos (10, 25, 50) ha alcanzado un edificio. */
export function milestonesReached(count: number): number {
  return MILESTONES.filter((m) => count >= m).length;
}

export function nextMilestone(count: number): number | undefined {
  return MILESTONES.find((m) => count < m);
}

/** Producción por segundo de una sola unidad del edificio, con todas las bonificaciones. */
export function unitRate(state: GameState, id: BuildingId): number {
  const def = BUILDING_BY_ID[id];
  const fromUpgrades = upgradeMultiplier(state, (e) => e.kind === 'building' && e.building === id);
  const global = upgradeMultiplier(state, (e) => e.kind === 'global');
  return def.rate * fromUpgrades * global * productionMultiplier(state) * 2 ** milestonesReached(state.buildings[id]);
}

export function buildingRate(state: GameState, id: BuildingId): number {
  return unitRate(state, id) * state.buildings[id];
}

export function ratePerSecond(state: GameState): Amounts {
  const rates = Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Amounts;
  for (const def of BUILDING_DEFS) rates[def.produces] += buildingRate(state, def.id);
  return rates;
}

export function clickAmount(state: GameState): number {
  let share = 0;
  for (const id of state.upgrades) {
    const e = UPGRADE_BY_ID[id]?.effect;
    if (e?.kind === 'clickRate') share += e.share;
  }
  const base = BASE_CLICK * upgradeMultiplier(state, (e) => e.kind === 'click') * clickMultiplier(state);
  return share ? base + ratePerSecond(state).food * share : base;
}

export function gain(state: GameState, resource: ResourceId, amount: number): void {
  state.resources[resource] += amount;
  state.totals[resource] += amount;
}

export function gather(state: GameState): number {
  const amount = clickAmount(state);
  gain(state, 'food', amount);
  return amount;
}

/** Avanza la simulación `seconds` segundos. */
export function tick(state: GameState, seconds: number): void {
  if (seconds <= 0) return;
  const rates = ratePerSecond(state);
  for (const r of RESOURCES) if (rates[r] > 0) gain(state, r, rates[r] * seconds);
}

export function buildingCost(state: GameState, id: BuildingId): Cost {
  const def = BUILDING_BY_ID[id];
  // Los Gremios del Legado abaratan todos los oficios.
  const factor = COST_GROWTH ** state.buildings[id] * jobCostMultiplier(state);
  const cost: Cost = {};
  for (const r of RESOURCES) {
    const base = def.baseCost[r];
    if (base) cost[r] = Math.ceil(base * factor);
  }
  return cost;
}

export function canAfford(state: GameState, cost: Cost): boolean {
  return RESOURCES.every((r) => state.resources[r] >= (cost[r] ?? 0));
}

function pay(state: GameState, cost: Cost): void {
  for (const r of RESOURCES) state.resources[r] -= cost[r] ?? 0;
}

/** Si el oficio ya tiene el máximo de personas que admite la tribu. */
export function atCap(state: GameState, id: BuildingId): boolean {
  return state.buildings[id] >= BUILDING_CAP;
}

export function buyBuilding(state: GameState, id: BuildingId): boolean {
  const def = BUILDING_BY_ID[id];
  const cost = buildingCost(state, id);
  if (!def.unlocked(state) || atCap(state, id) || !canAfford(state, cost)) return false;
  pay(state, cost);
  state.buildings[id] += 1;
  return true;
}

export function upgradeAvailable(state: GameState, id: string): boolean {
  const def = UPGRADE_BY_ID[id];
  return !!def && !state.upgrades.includes(id) && def.unlocked(state);
}

export function buyUpgrade(state: GameState, id: string): boolean {
  const def = UPGRADE_BY_ID[id];
  if (!upgradeAvailable(state, id) || !canAfford(state, def.cost)) return false;
  pay(state, def.cost);
  state.upgrades.push(id);
  return true;
}

/** La meta de la era en la que está la tribu. */
export function currentGoal(state: GameState): GoalDef {
  return GOALS[state.era] ?? GOALS[LAST_ERA];
}

export function buyGoal(state: GameState): boolean {
  const goal = currentGoal(state);
  if (state.goalReached || !canAfford(state, goal.cost)) return false;
  pay(state, goal.cost);
  state.goalReached = true;
  return true;
}

/** Tras cumplir la meta, la tribu entra en la era siguiente (si ya existe en el juego). */
export function canAdvanceEra(state: GameState): boolean {
  return state.goalReached && state.era < LAST_ERA;
}

export function advanceEra(state: GameState): boolean {
  if (!canAdvanceEra(state)) return false;
  state.era += 1;
  state.goalReached = false;
  state.legacy.bestEra = Math.max(state.legacy.bestEra, state.era);
  return true;
}

/** Segundos hasta poder pagar un coste con la producción actual (Infinity si nunca). */
export function secondsUntil(state: GameState, cost: Cost): number {
  const rates = ratePerSecond(state);
  let worst = 0;
  for (const r of RESOURCES) {
    const missing = (cost[r] ?? 0) - state.resources[r];
    if (missing <= 0) continue;
    if (rates[r] <= 0) return Infinity;
    worst = Math.max(worst, missing / rates[r]);
  }
  return worst;
}

/**
 * Segundos de producción que cuentan entre dos instantes (en ms). Si el jugador se fue, solo cuentan
 * los primeros MAX_OFFLINE_SECONDS desde que se fue; si no, un salto largo del reloj (el equipo
 * suspendido) tampoco suma más que eso.
 */
export function creditedSeconds(state: GameState, from: number, to: number): number {
  const limit = offlineLimit(state);
  const end = state.awaySince === null ? to : Math.min(to, state.awaySince + limit * 1000);
  return Math.min(Math.max(0, end - from) / 1000, limit);
}

/** Segundos que trabaja la tribu fuera del juego: 10 minutos, más los de la Paciencia del Legado. */
export function offlineLimit(state: GameState): number {
  return MAX_OFFLINE_SECONDS + offlineMinutesBonus(state) * 60;
}

/** Aplica el tiempo que el jugador estuvo fuera y devuelve los segundos aplicados. */
export function applyOfflineProgress(state: GameState, now: number): number {
  // Una partida guardada sin marca de salida se cerró de golpe: se fue al guardarla.
  state.awaySince ??= state.lastSaved;
  const elapsed = creditedSeconds(state, state.lastSaved, now);
  state.awaySince = null;
  if (elapsed <= 0) return 0;
  tick(state, elapsed);
  return elapsed;
}

// ---------- Legado (prestigio) ----------

/** Tradición oral: cada oficio descubierto empieza con 5 personas. Devuelve si cambió algo. */
export function applyTradition(state: GameState): boolean {
  if (!level(state, 'tradition')) return false;
  let changed = false;
  for (const def of BUILDING_DEFS) {
    if (def.era > state.era || state.buildings[def.id] >= TRADITION_PEOPLE || !def.unlocked(state)) continue;
    state.buildings[def.id] = TRADITION_PEOPLE;
    changed = true;
  }
  return changed;
}

/** Capataces: contratan una persona en cada oficio de eras pasadas que se pueda pagar. Devuelve cuántas. */
export function autoHire(state: GameState): number {
  if (!level(state, 'foremen')) return 0;
  let hired = 0;
  for (const def of BUILDING_DEFS) if (def.era < state.era && buyBuilding(state, def.id)) hired++;
  return hired;
}

/** Renacer: una partida nueva en el Paleolítico que conserva el Legado y suma la Sabiduría ganada. */
export function rebirth(state: GameState, now = Date.now()): GameState | null {
  if (!canRebirth(state)) return null;
  const next = newGame(now);
  next.legacy = structuredClone(state.legacy);
  next.legacy.wisdom += wisdomForRun(state);
  next.legacy.rebirths += 1;
  next.legacy.bestEra = Math.max(next.legacy.bestEra, state.era);
  applyTradition(next);
  return next;
}
