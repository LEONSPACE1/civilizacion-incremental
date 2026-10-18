import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import {
  applyOfflineProgress,
  creditedSeconds,
  atCap,
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
import { BUILDING_CAP, MAX_OFFLINE_SECONDS } from '../src/game/balance';
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
    expect(buildingCost(s, 'hunter')).toEqual({ food: 60, wood: 60 });
  });

  it('no se puede comprar sin recursos ni antes del desbloqueo', () => {
    const s = newGame(0);
    s.resources.food = 9;
    expect(buyBuilding(s, 'gatherer')).toBe(false);
    s.resources.food = 10;
    expect(buyBuilding(s, 'gatherer')).toBe(true);
    s.resources = { food: 1000, wood: 1000, stone: 0, metal: 0, iron: 0, gold: 0 };
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
    s.resources = { food: 100, wood: 100, stone: 0, metal: 0, iron: 0, gold: 0 };
    expect(buyUpgrade(s, 'fire')).toBe(true);
    expect(clickAmount(s)).toBe(3);
    expect(buyUpgrade(s, 'fire')).toBe(false);
    s.buildings.gatherer = 5;
    s.resources = { food: 1000, wood: 1000, stone: 0, metal: 0, iron: 0, gold: 0 };
    buyUpgrade(s, 'baskets');
    expect(ratePerSecond(s).food).toBe(5);
  });

  it('la meta de la era se paga una vez', () => {
    const s = newGame(0);
    s.resources = { food: ERA1_GOAL.cost.food!, wood: ERA1_GOAL.cost.wood!, stone: 0, metal: 0, iron: 0, gold: 0 };
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
    expect(MAX_OFFLINE_SECONDS).toBe(600);
  });

  it('fuera del juego solo cuentan los 10 minutos desde que el jugador se fue', () => {
    const s = newGame(0);
    s.buildings.gatherer = 2;
    // Se fue al minuto 5 y la partida se volvió a guardar al minuto 12 con la pestaña oculta.
    s.awaySince = 5 * 60_000;
    s.lastSaved = 12 * 60_000;
    expect(applyOfflineProgress(s, 3600_000)).toBe(3 * 60);
    expect(s.awaySince).toBeNull();
  });

  it('con la pestaña oculta la producción se detiene a los 10 minutos', () => {
    const s = newGame(0);
    s.awaySince = 1000;
    expect(creditedSeconds(s, 1000, 1000 + 300_000)).toBe(300);
    expect(creditedSeconds(s, 1000 + 300_000, 1000 + 900_000)).toBe(300);
    expect(creditedSeconds(s, 1000 + 900_000, 1000 + 2_000_000)).toBe(0);
    s.awaySince = null;
    expect(creditedSeconds(s, 0, 100)).toBeCloseTo(0.1);
  });
});

describe('paso a la era 2', () => {
  it('los oficios y mejoras del Neolítico esperan a su era', () => {
    const s = newGame(0);
    s.buildings.quarrier = 0;
    s.resources = { food: 1e9, wood: 1e9, stone: 1e9, metal: 0, iron: 0, gold: 0 };
    expect(BUILDING_BY_ID.quarrier.unlocked(s)).toBe(false);
    expect(buyBuilding(s, 'quarrier')).toBe(false);
    s.era = 2;
    expect(buyBuilding(s, 'quarrier')).toBe(true);
    expect(BUILDING_BY_ID.farmer.unlocked(s)).toBe(true);
  });

  it('solo se avanza tras cumplir la meta, y la meta pasa a ser la de la nueva era', () => {
    const s = newGame(0);
    expect(advanceEra(s)).toBe(false);
    s.resources = { food: 2e6, wood: 2e6, stone: 0, metal: 0, iron: 0, gold: 0 };
    buyGoal(s);
    expect(canAdvanceEra(s)).toBe(true);
    expect(advanceEra(s)).toBe(true);
    expect(s.era).toBe(2);
    expect(s.goalReached).toBe(false);
    expect(currentGoal(s)).toBe(GOALS[2]);
    s.resources = { food: 1e12, wood: 1e12, stone: 1e12, metal: 0, iron: 0, gold: 0 };
    buyGoal(s);
    expect(advanceEra(s)).toBe(true);
    expect(s.era).toBe(3);
    expect(currentGoal(s)).toBe(GOALS[3]);
    s.resources = { food: 1e12, wood: 1e12, stone: 1e12, metal: 1e12, iron: 0, gold: 0 };
    buyGoal(s);
    expect(advanceEra(s)).toBe(true);
    expect(s.era).toBe(4);
    expect(currentGoal(s)).toBe(GOALS[4]);
    s.resources = { food: 1e14, wood: 1e14, stone: 1e14, metal: 1e14, iron: 1e14, gold: 0 };
    buyGoal(s);
    expect(advanceEra(s)).toBe(true);
    expect(s.era).toBe(5);
    expect(currentGoal(s)).toBe(GOALS[5]);
    // La era 5 es la última por ahora: su meta no abre otra era todavía.
    s.resources = { food: 1e17, wood: 1e17, stone: 1e17, metal: 1e17, iron: 1e17, gold: 1e17 };
    buyGoal(s);
    expect(canAdvanceEra(s)).toBe(false);
  });

  it('los canteros producen piedra y el molino de mano suma comida por clic', () => {
    const s = newGame(0);
    s.era = 2;
    s.buildings.quarrier = 2;
    s.buildings.farmer = 1;
    expect(ratePerSecond(s).stone).toBe(1000);
    s.resources = { food: 1e6, wood: 1e6, stone: 1e6, metal: 0, iron: 0, gold: 0 };
    expect(upgradeAvailable(s, 'quern')).toBe(true);
    buyUpgrade(s, 'quern');
    expect(clickAmount(s)).toBeCloseTo(1 + 750 * 0.05);
  });
});

describe('era 3 y tope por oficio', () => {
  it('los fundidores producen bronce y piden los tres recursos anteriores', () => {
    const s = newGame(0);
    s.era = 3;
    s.buildings.smelter = 2;
    expect(ratePerSecond(s).metal).toBe(2 * BUILDING_BY_ID.smelter.rate);
    expect(Object.keys(buildingCost(s, 'smelter')).sort()).toEqual(['food', 'stone', 'wood']);
  });

  it('cada oficio admite como máximo el tope de personas', () => {
    const s = newGame(0);
    s.buildings.gatherer = BUILDING_CAP - 1;
    s.resources = { food: 1e30, wood: 1e30, stone: 0, metal: 0, iron: 0, gold: 0 };
    expect(atCap(s, 'gatherer')).toBe(false);
    expect(buyBuilding(s, 'gatherer')).toBe(true);
    expect(atCap(s, 'gatherer')).toBe(true);
    expect(buyBuilding(s, 'gatherer')).toBe(false);
    expect(s.buildings.gatherer).toBe(BUILDING_CAP);
  });

  it('el tope coincide con el último hito', () => {
    const s = newGame(0);
    s.buildings.gatherer = BUILDING_CAP;
    expect(unitRate(s, 'gatherer')).toBe(BUILDING_BY_ID.gatherer.rate * 8);
  });
});

describe('era 4: Antigüedad', () => {
  it('los herreros producen hierro y piden los cuatro recursos anteriores', () => {
    const s = newGame(0);
    s.era = 4;
    s.buildings.blacksmith = 3;
    expect(ratePerSecond(s).iron).toBe(3 * BUILDING_BY_ID.blacksmith.rate);
    expect(Object.keys(buildingCost(s, 'blacksmith')).sort()).toEqual(['food', 'metal', 'stone', 'wood']);
  });

  it('los oficios de la Antigüedad esperan a su era', () => {
    const s = newGame(0);
    s.era = 3;
    s.buildings.blacksmith = 20;
    expect(BUILDING_BY_ID.blacksmith.unlocked(s)).toBe(false);
    s.era = 4;
    expect(BUILDING_BY_ID.ironMiner.unlocked(s)).toBe(true);
  });

  it('los recursos antiguos rinden x1,5 frente al minero de hierro', () => {
    for (const id of ['oliveGrower', 'sawyer', 'marbler', 'bronzesmith'] as const) {
      expect(BUILDING_BY_ID[id].rate / BUILDING_BY_ID.ironMiner.rate).toBe(1.5);
    }
  });
});

describe('era 5: Edad Media', () => {
  it('los mercaderes producen oro y piden los cinco recursos anteriores', () => {
    const s = newGame(0);
    s.era = 5;
    s.buildings.merchant = 3;
    expect(ratePerSecond(s).gold).toBe(3 * BUILDING_BY_ID.merchant.rate);
    expect(Object.keys(buildingCost(s, 'merchant')).sort()).toEqual(['food', 'iron', 'metal', 'stone', 'wood']);
  });

  it('los oficios de la Edad Media esperan a su era', () => {
    const s = newGame(0);
    s.era = 4;
    s.buildings.merchant = 20;
    expect(BUILDING_BY_ID.merchant.unlocked(s)).toBe(false);
    s.era = 5;
    expect(BUILDING_BY_ID.goldMiner.unlocked(s)).toBe(true);
  });

  it('los recursos antiguos rinden x1,5 frente al minero de oro', () => {
    for (const id of ['miller', 'ranger', 'bricklayer', 'bellfounder', 'armorer'] as const) {
      expect(BUILDING_BY_ID[id].rate / BUILDING_BY_ID.goldMiner.rate).toBe(1.5);
    }
  });
});
