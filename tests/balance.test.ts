import { describe, expect, it } from 'vitest';
import { simulateEra1, simulateEra2 } from '../src/game/simulate';
import { UPGRADE_DEFS } from '../src/game/content';

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

  it('comida, madera y piedra crecen a la par', () => {
    const rates = Object.values(result.finalRates);
    expect(Math.max(...rates) / Math.min(...rates)).toBeLessThan(1.5);
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
