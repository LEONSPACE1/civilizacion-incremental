import { beforeEach, describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { deserialize, exportFileName, exportFileText, importFileText, loadGame, saveGame, serialize } from '../src/game/save';
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

  it('el archivo exportado se vuelve a importar igual', () => {
    const s = newGame(0);
    s.era = 5;
    s.resources.gold = 123;
    s.buildings.merchant = 7;
    const text = exportFileText(s, Date.UTC(2026, 9, 18));
    expect(JSON.parse(text).juego).toBe('civilizacion-incremental');
    expect(importFileText(text)).toEqual(s);
  });

  it('importar acepta también el texto que se copiaba antes y rechaza otros archivos', () => {
    const s = newGame(0);
    s.resources.food = 9;
    expect(importFileText(serialize(s))).toEqual(s);
    expect(importFileText('{"otro": 1}')).toBeNull();
    expect(importFileText('hola')).toBeNull();
  });

  it('el nombre del archivo lleva la era y la fecha', () => {
    const s = newGame(0);
    s.era = 3;
    expect(exportFileName(s, new Date(2026, 9, 18, 9, 5).getTime())).toBe('civilizacion-era3-2026-10-18-0905.civ');
  });

  it('migra partidas de la fase 1', () => {
    const v1 = btoa(JSON.stringify({ version: 1, food: 55, totalFood: 300, gatherers: 4, lastSaved: 5 }));
    const s = deserialize(v1)!;
    expect(s.version).toBe(5);
    expect(s.resources.food).toBe(55);
    expect(s.totals.food).toBe(300);
    expect(s.buildings.gatherer).toBe(4);
  });

  it('las partidas de la versión 2 siguen en el Paleolítico', () => {
    const v2 = btoa(JSON.stringify({ version: 2, resources: { food: 9, wood: 4 }, buildings: { gatherer: 3 }, goalReached: true }));
    const s = deserialize(v2)!;
    expect(s.era).toBe(1);
    expect(s.goalReached).toBe(true);
    expect(s.resources.stone).toBe(0);
    expect(s.buildings.farmer).toBe(0);
  });

  it('guarda la era y la piedra', () => {
    const s = newGame(0);
    s.era = 2;
    s.resources.stone = 120;
    s.buildings.quarrier = 4;
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('guarda el bronce y la era 3', () => {
    const s = newGame(0);
    s.era = 3;
    s.resources.metal = 5e6;
    s.buildings.smelter = 7;
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('guarda el hierro, la era 4 y cuándo salió el jugador', () => {
    const s = newGame(0);
    s.era = 4;
    s.resources.iron = 3e9;
    s.buildings.blacksmith = 9;
    s.awaySince = 1234;
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('las partidas de la era 3 empiezan sin hierro', () => {
    const text = btoa(JSON.stringify({ version: 3, era: 3, resources: { metal: 5 } }));
    const s = deserialize(text)!;
    expect(s.resources.iron).toBe(0);
    expect(s.buildings.blacksmith).toBe(0);
    expect(s.awaySince).toBeNull();
  });

  it('ajusta al tope los oficios de partidas anteriores', () => {
    const text = btoa(JSON.stringify({ version: 3, era: 2, buildings: { gatherer: 80, quarrier: 12 } }));
    const s = deserialize(text)!;
    expect(s.buildings.gatherer).toBe(50);
    expect(s.buildings.quarrier).toBe(12);
    expect(s.resources.metal).toBe(0);
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

  it('respeta el formato elegido en ajustes', () => {
    expect(formatNumber(1500, 'words')).toBe('1,50 mil');
    expect(formatNumber(1_000_000, 'words')).toBe('1,00 millón');
    expect(formatNumber(2_300_000, 'words')).toBe('2,30 millones');
    expect(formatNumber(4e12, 'words')).toBe('4,00 billones');
    expect(formatNumber(1_500_000, 'scientific')).toBe('1,50e6');
    expect(formatNumber(1_500_000.7, 'full')).toBe('1.500.000');
    expect(formatNumber(42.5, 'full')).toBe('42,5');
  });
});
