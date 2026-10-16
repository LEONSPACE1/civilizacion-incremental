import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import {
  applyOfflineProgress,
  buildingCost,
  buyBuilding,
  buyGoal,
  advanceEra,
  buyUpgrade,
  canAdvanceEra,
  clickAmount,
  currentGoal,
  upgradeAvailable,
  gather,
  ratePerSecond,
  tick,
  unitRate,
} from '../src/game/logic';
import { MAX_OFFLINE_SECONDS } from '../src/game/balance';
import { BUILDING_BY_ID, ERA1_GOAL, GOALS } from '../src/game/content';

describe('lógica de la era 1', () => {
  it('recolectar suma comida', () => {
    const s = newGame(0);
    gather(s);
    expect(s.resources.food).toBe(1);
    expect(s.totals.food).toBe(1);
  });

  it('cada edificio produce su recurso', () => {
    const s = newGame(0);
    s.buildings.gatherer = 2;
    s.buildings.woodcutter = 5;
    tick(s, 10);
    expect(s.resources.food).toBe(10);
    expect(s.resources.wood).toBeCloseTo(25);
  });

  it('el coste crece un 15 % por unidad y puede pedir varios recursos', () => {
    const s = newGame(0);
    expect(buildingCost(s, 'gatherer')).toEqual({ food: 10 });
    s.buildings.gatherer = 10;
    expect(buildingCost(s, 'gatherer')).toEqual({ food: 41 });
    expect(buildingCost(s, 'hunter')).toEqual({ food: 80, wood: 40 });
  });

  it('no se puede comprar sin recursos ni antes del desbloqueo', () => {
    const s = newGame(0);
    s.resources.food = 9;
    expect(buyBuilding(s, 'gatherer')).toBe(false);
    s.resources.food = 10;
    expect(buyBuilding(s, 'gatherer')).toBe(true);
    s.resources = { food: 1000, wood: 1000, stone: 0 };
    expect(buyBuilding(s, 'hunter')).toBe(false);
    s.buildings.woodcutter = 2;
    expect(buyBuilding(s, 'hunter')).toBe(true);
  });

  it('los hitos de 10 y 25 unidades duplican la producción', () => {
    const s = newGame(0);
    s.buildings.gatherer = 9;
    expect(unitRate(s, 'gatherer')).toBe(0.5);
    s.buildings.gatherer = 10;
    expect(unitRate(s, 'gatherer')).toBe(1);
    s.buildings.gatherer = 25;
    expect(unitRate(s, 'gatherer')).toBe(2);
  });

  it('las mejoras multiplican y solo se compran una vez', () => {
    const s = newGame(0);
    s.buildings.woodcutter = 1;
    s.resources = { food: 100, wood: 100, stone: 0 };
    expect(buyUpgrade(s, 'fire')).toBe(true);
    expect(clickAmount(s)).toBe(3);
    expect(buyUpgrade(s, 'fire')).toBe(false);
    s.buildings.gatherer = 5;
    s.resources = { food: 1000, wood: 1000, stone: 0 };
    buyUpgrade(s, 'baskets');
    expect(ratePerSecond(s).food).toBe(5);
  });

  it('la meta de la era se paga una vez', () => {
    const s = newGame(0);
    s.resources = { food: ERA1_GOAL.cost.food!, wood: ERA1_GOAL.cost.wood!, stone: 0 };
    expect(buyGoal(s)).toBe(true);
    expect(s.goalReached).toBe(true);
    expect(buyGoal(s)).toBe(false);
  });

  it('el progreso fuera de línea tiene un límite', () => {
    const s = newGame(0);
    s.buildings.gatherer = 2;
    const applied = applyOfflineProgress(s, 100 * 3600 * 1000);
    expect(applied).toBe(MAX_OFFLINE_SECONDS);
    expect(s.resources.food).toBe(MAX_OFFLINE_SECONDS);
  });
});

describe('paso a la era 2', () => {
  it('los oficios y mejoras del Neolítico esperan a su era', () => {
    const s = newGame(0);
    s.buildings.quarrier = 0;
    s.resources = { food: 1e9, wood: 1e9, stone: 1e9 };
    expect(BUILDING_BY_ID.quarrier.unlocked(s)).toBe(false);
    expect(buyBuilding(s, 'quarrier')).toBe(false);
    s.era = 2;
    expect(buyBuilding(s, 'quarrier')).toBe(true);
    expect(BUILDING_BY_ID.farmer.unlocked(s)).toBe(true);
  });

  it('solo se avanza tras cumplir la meta, y la meta pasa a ser la de la nueva era', () => {
    const s = newGame(0);
    expect(advanceEra(s)).toBe(false);
    s.resources = { food: 2e6, wood: 2e6, stone: 0 };
    buyGoal(s);
    expect(canAdvanceEra(s)).toBe(true);
    expect(advanceEra(s)).toBe(true);
    expect(s.era).toBe(2);
    expect(s.goalReached).toBe(false);
    expect(currentGoal(s)).toBe(GOALS[2]);
    // La era 2 es la última por ahora: su meta no abre otra era todavía.
    s.resources = { food: 1e12, wood: 1e12, stone: 1e12 };
    buyGoal(s);
    expect(canAdvanceEra(s)).toBe(false);
  });

  it('los canteros producen piedra y el molino de mano suma comida por clic', () => {
    const s = newGame(0);
    s.era = 2;
    s.buildings.quarrier = 2;
    s.buildings.farmer = 1;
    expect(ratePerSecond(s).stone).toBe(1000);
    s.resources = { food: 1e6, wood: 1e6, stone: 1e6 };
    expect(upgradeAvailable(s, 'quern')).toBe(true);
    buyUpgrade(s, 'quern');
    expect(clickAmount(s)).toBeCloseTo(1 + 500 * 0.05);
  });
});
