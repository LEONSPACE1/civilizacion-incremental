import { describe, expect, it } from 'vitest';
import { simulateEra1 } from '../src/game/simulate';

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
