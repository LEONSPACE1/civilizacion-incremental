import type { GameState } from './state';
import {
  FOOD_PER_CLICK,
  FOOD_PER_GATHERER_PER_SECOND,
  GATHERER_BASE_COST,
  GATHERER_COST_GROWTH,
  MAX_OFFLINE_SECONDS,
} from './balance';

export function foodPerSecond(state: GameState): number {
  return state.gatherers * FOOD_PER_GATHERER_PER_SECOND;
}

export function gainFood(state: GameState, amount: number): void {
  state.food += amount;
  state.totalFood += amount;
}

export function gather(state: GameState): void {
  gainFood(state, FOOD_PER_CLICK);
}

/** Avanza la simulación `seconds` segundos. */
export function tick(state: GameState, seconds: number): void {
  if (seconds <= 0) return;
  gainFood(state, foodPerSecond(state) * seconds);
}

export function gathererCost(state: GameState): number {
  return Math.ceil(GATHERER_BASE_COST * GATHERER_COST_GROWTH ** state.gatherers);
}

export function buyGatherer(state: GameState): boolean {
  const cost = gathererCost(state);
  if (state.food < cost) return false;
  state.food -= cost;
  state.gatherers += 1;
  return true;
}

/** Aplica el tiempo que el jugador estuvo fuera y devuelve los segundos aplicados. */
export function applyOfflineProgress(state: GameState, now: number): number {
  const elapsed = Math.min((now - state.lastSaved) / 1000, MAX_OFFLINE_SECONDS);
  if (elapsed <= 0) return 0;
  tick(state, elapsed);
  return elapsed;
}
