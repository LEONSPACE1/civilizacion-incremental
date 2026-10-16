import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import {
  applyOfflineProgress,
  buildingCost,
  buyBuilding,
  buyGoal,
  buyUpgrade,
  clickAmount,
  gather,
  ratePerSecond,
  tick,
  unitRate,
} from '../src/game/logic';
import { MAX_OFFLINE_SECONDS } from '../src/game/balance';
import { ERA1_GOAL } from '../src/game/content';

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
    expect(s.resources.wood).toBeCloseTo(20);
  });

  it('el coste crece un 15 % por unidad y puede pedir varios recursos', () => {
    const s = newGame(0);
    expect(buildingCost(s, 'gatherer')).toEqual({ food: 10 });
    s.buildings.gatherer = 10;
    expect(buildingCost(s, 'gatherer')).toEqual({ food: 41 });
    expect(buildingCost(s, 'hunter')).toEqual({ food: 90, wood: 30 });
  });

  it('no se puede comprar sin recursos ni antes del desbloqueo', () => {
    const s = newGame(0);
    s.resources.food = 9;
    expect(buyBuilding(s, 'gatherer')).toBe(false);
    s.resources.food = 10;
    expect(buyBuilding(s, 'gatherer')).toBe(true);
    s.resources = { food: 1000, wood: 1000 };
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
    s.resources = { food: 100, wood: 100 };
    expect(buyUpgrade(s, 'fire')).toBe(true);
    expect(clickAmount(s)).toBe(3);
    expect(buyUpgrade(s, 'fire')).toBe(false);
    s.buildings.gatherer = 5;
    s.resources = { food: 1000, wood: 1000 };
    buyUpgrade(s, 'baskets');
    expect(ratePerSecond(s).food).toBe(5);
  });

  it('la meta de la era se paga una vez', () => {
    const s = newGame(0);
    s.resources = { food: ERA1_GOAL.cost.food!, wood: ERA1_GOAL.cost.wood! };
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
