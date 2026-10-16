import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { applyOfflineProgress, buyGatherer, gather, gathererCost, tick } from '../src/game/logic';
import { MAX_OFFLINE_SECONDS } from '../src/game/balance';

describe('lógica de la era 1', () => {
  it('recolectar suma comida', () => {
    const s = newGame(0);
    gather(s);
    expect(s.food).toBe(1);
    expect(s.totalFood).toBe(1);
  });

  it('un recolector produce 0,5 comida por segundo', () => {
    const s = newGame(0);
    s.gatherers = 2;
    tick(s, 10);
    expect(s.food).toBe(10);
  });

  it('el coste del recolector crece un 15 % por unidad', () => {
    const s = newGame(0);
    expect(gathererCost(s)).toBe(10);
    s.gatherers = 1;
    expect(gathererCost(s)).toBe(12);
    s.gatherers = 10;
    expect(gathererCost(s)).toBe(41);
  });

  it('no se puede comprar sin comida suficiente', () => {
    const s = newGame(0);
    s.food = 9;
    expect(buyGatherer(s)).toBe(false);
    s.food = 10;
    expect(buyGatherer(s)).toBe(true);
    expect(s.food).toBe(0);
    expect(s.gatherers).toBe(1);
  });

  it('el progreso fuera de línea tiene un límite', () => {
    const s = newGame(0);
    s.gatherers = 2;
    const applied = applyOfflineProgress(s, 100 * 3600 * 1000);
    expect(applied).toBe(MAX_OFFLINE_SECONDS);
    expect(s.food).toBe(MAX_OFFLINE_SECONDS);
  });
});
