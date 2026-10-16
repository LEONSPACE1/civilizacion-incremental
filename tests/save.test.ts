import { beforeEach, describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { deserialize, loadGame, saveGame, serialize } from '../src/game/save';
import { formatNumber } from '../src/game/format';

describe('guardado', () => {
  beforeEach(() => localStorage.clear());

  it('guarda y carga la misma partida', () => {
    const s = newGame(0);
    s.resources.food = 42;
    s.buildings.hunter = 3;
    s.upgrades = ['fire'];
    saveGame(s, 1000);
    expect(loadGame()).toEqual({ ...s, lastSaved: 1000 });
  });

  it('exportar e importar conserva la partida', () => {
    const s = newGame(0);
    s.resources.wood = 7;
    s.goalReached = true;
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('migra partidas de la fase 1', () => {
    const v1 = btoa(JSON.stringify({ version: 1, food: 55, totalFood: 300, gatherers: 4, lastSaved: 5 }));
    const s = deserialize(v1)!;
    expect(s.version).toBe(2);
    expect(s.resources.food).toBe(55);
    expect(s.totals.food).toBe(300);
    expect(s.buildings.gatherer).toBe(4);
  });

  it('rechaza texto inválido', () => {
    expect(deserialize('no es una partida')).toBeNull();
  });

  it('ignora valores corruptos y mejoras desconocidas', () => {
    const text = btoa(JSON.stringify({ version: 2, resources: { food: 'mucho', wood: 3 }, buildings: { gatherer: 5 }, upgrades: ['fire', 'trampa'] }));
    const s = deserialize(text)!;
    expect(s.resources.food).toBe(0);
    expect(s.resources.wood).toBe(3);
    expect(s.buildings.gatherer).toBe(5);
    expect(s.upgrades).toEqual(['fire']);
  });
});

describe('formato de números', () => {
  it('muestra sufijos para números grandes', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1234)).toBe('1,23K');
    expect(formatNumber(2_500_000)).toBe('2,50M');
  });
});
