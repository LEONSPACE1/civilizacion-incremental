import { describe, expect, it } from 'vitest';
import { simulateEra1, simulateEra2, simulateEra3, simulateEra4, simulateEra5, simulateEra6 } from '../src/game/simulate';
import { BUILDING_DEFS, GOALS, UPGRADE_DEFS } from '../src/game/content';
import { BUILDING_CAP } from '../src/game/balance';

// El pilar del juego: progreso constante, sin muros de dificultad.
describe('balance de la era 1', () => {
  const result = simulateEra1();

  it('se completa en 10 a 25 minutos', () => {
    expect(result.finished).toBe(true);
    expect(result.seconds).toBeGreaterThanOrEqual(10 * 60);
    expect(result.seconds).toBeLessThanOrEqual(25 * 60);
  });

  it('ninguna espera entre compras supera 3 minutos', () => {
    expect(result.longestWait).toBeLessThanOrEqual(180);
  });

  it('comida y madera crecen a la par', () => {
    const { food, wood } = result.finalRates;
    expect(Math.max(food, wood) / Math.min(food, wood)).toBeLessThan(1.5);
  });

  // Aunque alguien prefiera un recurso, el otro no se convierte en un muro.
  for (const [label, bias] of [['madera', { wood: 2.5 }], ['comida', { food: 2.5 }]] as const) {
    it(`quien prefiere ${label} también termina sin esperas largas`, () => {
      const r = simulateEra1({ bias });
      expect(r.finished).toBe(true);
      expect(r.seconds).toBeLessThanOrEqual(35 * 60);
      expect(r.longestWait).toBeLessThanOrEqual(180);
    });
  }
});

// La era 2 empieza con la tribu que dejó la era 1 y suma la piedra como tercer recurso.
describe('balance de la era 2', () => {
  const result = simulateEra2();

  it('se completa en 15 a 35 minutos', () => {
    expect(result.finished).toBe(true);
    expect(result.seconds).toBeGreaterThanOrEqual(15 * 60);
    expect(result.seconds).toBeLessThanOrEqual(35 * 60);
  });

  it('ninguna espera entre compras supera 3 minutos', () => {
    expect(result.longestWait).toBeLessThanOrEqual(180);
  });

  // Comida y madera, recursos de la era anterior, sobran; la piedra marca el ritmo.
  it('comida y madera crecen a la par y por encima de la piedra', () => {
    const { food, wood, stone } = result.finalRates;
    expect(Math.max(food, wood) / Math.min(food, wood)).toBeLessThan(1.2);
    expect(Math.min(food, wood) / stone).toBeGreaterThan(1.2);
    expect(Math.min(food, wood) / stone).toBeLessThan(2.5);
  });

  it('se compran todas las mejoras de la era antes de la meta', () => {
    const bought = new Set(result.events.map((e) => e.what));
    for (const u of UPGRADE_DEFS.filter((u) => u.era === 2)) expect(bought).toContain(u.name);
  });

  for (const [label, bias] of [['comida', { food: 2.5 }], ['madera', { wood: 2.5 }], ['piedra', { stone: 2.5 }]] as const) {
    it(`quien prefiere ${label} también termina sin esperas largas`, () => {
      const r = simulateEra2({ bias });
      expect(r.finished).toBe(true);
      expect(r.seconds).toBeLessThanOrEqual(40 * 60);
      expect(r.longestWait).toBeLessThanOrEqual(180);
    });
  }
}, 30000);

// La era 3 suma el bronce. Comida, madera y piedra sobran; el bronce marca el ritmo,
// y los oficios de las eras anteriores se llenan hasta su tope.
describe('balance de la era 3', () => {
  const result = simulateEra3();

  it('se completa en 18 a 35 minutos', () => {
    expect(result.finished).toBe(true);
    expect(result.seconds).toBeGreaterThanOrEqual(18 * 60);
    expect(result.seconds).toBeLessThanOrEqual(35 * 60);
  });

  it('ninguna espera entre compras supera 3 minutos', () => {
    expect(result.longestWait).toBeLessThanOrEqual(180);
  });

  it('comida, madera y piedra crecen a la par y por encima del bronce', () => {
    const { food, wood, stone, metal } = result.finalRates;
    expect(Math.max(food, wood, stone) / Math.min(food, wood, stone)).toBeLessThan(1.2);
    expect(Math.min(food, wood, stone) / metal).toBeGreaterThan(1.2);
    expect(Math.min(food, wood, stone) / metal).toBeLessThan(2.5);
  });

  it('se compran todas las mejoras de la era antes de la meta', () => {
    const bought = new Set(result.events.map((e) => e.what));
    for (const u of UPGRADE_DEFS.filter((u) => u.era === 3)) expect(bought).toContain(u.name);
  });

  it('los oficios del Paleolítico llegan a su tope', () => {
    for (const b of BUILDING_DEFS.filter((b) => b.era === 1)) expect(result.state.buildings[b.id]).toBe(BUILDING_CAP);
  });

  for (const [label, bias] of [['comida', { food: 2.5 }], ['piedra', { stone: 2.5 }], ['bronce', { metal: 2.5 }]] as const) {
    it(`quien prefiere ${label} también termina sin esperas largas`, () => {
      const r = simulateEra3({ bias });
      expect(r.finished).toBe(true);
      expect(r.seconds).toBeLessThanOrEqual(40 * 60);
      expect(r.longestWait).toBeLessThanOrEqual(180);
    });
  }
}, 60000);

// La era 4 suma el hierro. Los cuatro recursos antiguos sobran; el hierro marca el ritmo,
// y al final de la era los oficios del Neolítico y de la Edad del Bronce también se llenan.
describe('balance de la era 4', () => {
  const result = simulateEra4();

  it('se completa en 20 a 35 minutos', () => {
    expect(result.finished).toBe(true);
    expect(result.seconds).toBeGreaterThanOrEqual(20 * 60);
    expect(result.seconds).toBeLessThanOrEqual(35 * 60);
  });

  it('ninguna espera entre compras supera 3 minutos', () => {
    expect(result.longestWait).toBeLessThanOrEqual(180);
  });

  it('comida, madera, piedra y bronce crecen a la par y por encima del hierro', () => {
    const { food, wood, stone, metal, iron } = result.finalRates;
    expect(Math.max(food, wood, stone, metal) / Math.min(food, wood, stone, metal)).toBeLessThan(1.2);
    expect(Math.min(food, wood, stone, metal) / iron).toBeGreaterThan(1.2);
    expect(Math.min(food, wood, stone, metal) / iron).toBeLessThan(2.5);
  });

  it('se compran todas las mejoras de la era antes de la meta', () => {
    const bought = new Set(result.events.map((e) => e.what));
    for (const u of UPGRADE_DEFS.filter((u) => u.era === 4)) expect(bought).toContain(u.name);
  });

  it('los oficios del Neolítico llegan a su tope', () => {
    for (const b of BUILDING_DEFS.filter((b) => b.era === 2)) expect(result.state.buildings[b.id]).toBe(BUILDING_CAP);
  });

  for (const [label, bias] of [['comida', { food: 2.5 }], ['bronce', { metal: 2.5 }], ['hierro', { iron: 2.5 }]] as const) {
    it(`quien prefiere ${label} también termina sin esperas largas`, () => {
      const r = simulateEra4({ bias });
      expect(r.finished).toBe(true);
      expect(r.seconds).toBeLessThanOrEqual(40 * 60);
      expect(r.longestWait).toBeLessThanOrEqual(180);
    });
  }
}, 120000);

// La era 5 suma el oro. Los cinco recursos antiguos sobran; el oro marca el ritmo, y al final
// de la era los oficios de la Edad del Bronce y de la Antigüedad también se llenan.
describe('balance de la era 5', () => {
  const result = simulateEra5();

  it('se completa en 20 a 35 minutos', () => {
    expect(result.finished).toBe(true);
    expect(result.seconds).toBeGreaterThanOrEqual(20 * 60);
    expect(result.seconds).toBeLessThanOrEqual(35 * 60);
  });

  it('ninguna espera entre compras supera 3 minutos', () => {
    expect(result.longestWait).toBeLessThanOrEqual(180);
  });

  it('comida, madera, piedra, bronce y hierro crecen a la par y por encima del oro', () => {
    const { food, wood, stone, metal, iron, gold } = result.finalRates;
    const old = Math.min(food, wood, stone, metal, iron);
    expect(Math.max(food, wood, stone, metal, iron) / old).toBeLessThan(1.2);
    expect(old / gold).toBeGreaterThan(1.2);
    expect(old / gold).toBeLessThan(2.5);
  });

  it('se compran todas las mejoras de la era antes de la meta', () => {
    const bought = new Set(result.events.map((e) => e.what));
    for (const u of UPGRADE_DEFS.filter((u) => u.era === 5)) expect(bought).toContain(u.name);
  });

  it('los oficios de la Edad del Bronce y de la Antigüedad llegan a su tope', () => {
    for (const b of BUILDING_DEFS.filter((b) => b.era === 3 || b.era === 4)) expect(result.state.buildings[b.id]).toBe(BUILDING_CAP);
  });

  for (const [label, bias] of [['comida', { food: 2.5 }], ['hierro', { iron: 2.5 }], ['oro', { gold: 2.5 }]] as const) {
    it(`quien prefiere ${label} también termina sin esperas largas`, () => {
      const r = simulateEra5({ bias });
      expect(r.finished).toBe(true);
      expect(r.seconds).toBeLessThanOrEqual(40 * 60);
      expect(r.longestWait).toBeLessThanOrEqual(180);
    });
  }
}, 240000);

// La era 6 suma los libros. Los seis recursos antiguos sobran; los libros marcan el ritmo, y al
// final de la era los oficios de la Antigüedad y de la Edad Media también se llenan.
describe('balance de la era 6', () => {
  const result = simulateEra6();

  it('se completa en 20 a 35 minutos', () => {
    expect(result.finished).toBe(true);
    expect(result.seconds).toBeGreaterThanOrEqual(20 * 60);
    expect(result.seconds).toBeLessThanOrEqual(35 * 60);
  });

  it('ninguna espera entre compras supera 3 minutos', () => {
    expect(result.longestWait).toBeLessThanOrEqual(180);
  });

  it('los seis recursos antiguos crecen a la par y por encima de los libros', () => {
    const { food, wood, stone, metal, iron, gold, books } = result.finalRates;
    const old = Math.min(food, wood, stone, metal, iron, gold);
    expect(Math.max(food, wood, stone, metal, iron, gold) / old).toBeLessThan(1.2);
    expect(old / books).toBeGreaterThan(1.2);
    expect(old / books).toBeLessThan(2.5);
  });

  it('se compran todas las mejoras de la era antes de la meta', () => {
    const bought = new Set(result.events.map((e) => e.what));
    for (const u of UPGRADE_DEFS.filter((u) => u.era === 6)) expect(bought).toContain(u.name);
  });

  it('los oficios de la Antigüedad y de la Edad Media llegan a su tope', () => {
    for (const b of BUILDING_DEFS.filter((b) => b.era === 4 || b.era === 5)) expect(result.state.buildings[b.id]).toBe(BUILDING_CAP);
  });

  for (const [label, bias] of [['comida', { food: 2.5 }], ['libros', { books: 2.5 }]] as const) {
    it(`quien prefiere ${label} también termina sin esperas largas`, () => {
      const r = simulateEra6({ bias });
      expect(r.finished).toBe(true);
      expect(r.seconds).toBeLessThanOrEqual(40 * 60);
      expect(r.longestWait).toBeLessThanOrEqual(180);
    });
  }
}, 300000);

// Los precios piden lo mismo de cada recurso: así ninguno se acumula sin uso.
describe('precios uniformes', () => {
  const costs = [
    ...BUILDING_DEFS.map((b) => [b.name, b.baseCost] as const),
    ...UPGRADE_DEFS.map((u) => [u.name, u.cost] as const),
    ...Object.values(GOALS).map((g) => [g.name, g.cost] as const),
  ];
  for (const [name, cost] of costs) {
    it(`${name} pide la misma cantidad de cada recurso`, () => {
      expect(new Set(Object.values(cost)).size).toBe(1);
    });
  }
});
