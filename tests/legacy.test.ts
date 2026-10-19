import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import {
  advanceEra,
  applyTradition,
  autoHire,
  buildingCost,
  buyGoal,
  clickAmount,
  creditedSeconds,
  offlineLimit,
  rebirth,
  unitRate,
} from '../src/game/logic';
import { buyLegacy, canRebirth, LEGACY_DEFS, LEGACY_TOTAL_COST, legacyUnlocked, maxLevel, wisdomForRun, WISDOM_PER_GOAL } from '../src/game/legacy';
import { BUILDING_DEFS, GOALS } from '../src/game/content';
import { deserialize, serialize } from '../src/game/save';
import { BUILDING_CAP, MAX_OFFLINE_SECONDS } from '../src/game/balance';

/** Una partida que ha cumplido las metas de las eras 1 a `goals`. */
function afterGoals(goals: number) {
  const s = newGame(0);
  for (let era = 1; era <= goals; era++) {
    for (const r of Object.keys(GOALS[era].cost)) s.resources[r as keyof typeof s.resources] = 1e30;
    expect(buyGoal(s)).toBe(true);
    if (era < goals) advanceEra(s);
  }
  return s;
}

describe('renacer', () => {
  it('se desbloquea al inventar la escritura (meta de la era 3)', () => {
    expect(canRebirth(afterGoals(2))).toBe(false);
    expect(legacyUnlocked(afterGoals(2))).toBe(false);
    expect(canRebirth(afterGoals(3))).toBe(true);
    expect(rebirth(afterGoals(2))).toBeNull();
  });

  it('da 6 de Sabiduría tras la era 3 y 73 tras el cohete', () => {
    expect(wisdomForRun(afterGoals(3))).toBe(6);
    expect(wisdomForRun(afterGoals(8))).toBe(73);
    expect(WISDOM_PER_GOAL.reduce((a, b) => a + b, 0)).toBe(73);
  });

  it('llegar lejos compensa más que repetir las primeras eras', () => {
    // Sabiduría por minuto en la primera partida: 6 en 65 min frente a 73 en 208 min.
    expect(73 / 208).toBeGreaterThan(3 * (6 / 65));
  });

  it('vuelve al Paleolítico y conserva el Legado', () => {
    const s = afterGoals(5);
    s.legacy.wisdom = 4;
    s.legacy.levels.memory = 2;
    s.upgrades.push('fire');
    s.buildings.gatherer = 30;
    const next = rebirth(s, 99)!;
    expect(next.era).toBe(1);
    expect(next.resources.food).toBe(0);
    expect(next.upgrades).toEqual([]);
    expect(next.buildings.gatherer).toBe(0);
    expect(next.legacy.wisdom).toBe(4 + 19);
    expect(next.legacy.levels.memory).toBe(2);
    expect(next.legacy.rebirths).toBe(1);
    expect(next.legacy.bestEra).toBe(5);
    expect(legacyUnlocked(next)).toBe(true);
    expect(canRebirth(next)).toBe(false);
  });
});

describe('tienda del Legado', () => {
  it('cada mejora tiene tope y no se compra sin Sabiduría', () => {
    const s = newGame(0);
    expect(buyLegacy(s, 'memory')).toBe(false);
    s.legacy.wisdom = 1000;
    for (const d of LEGACY_DEFS) {
      while (buyLegacy(s, d.id));
      expect(s.legacy.levels[d.id]).toBe(maxLevel(d.id));
    }
    expect(s.legacy.wisdom).toBe(1000 - LEGACY_TOTAL_COST);
    expect(LEGACY_TOTAL_COST).toBe(131);
  });

  it('Memoria de los antepasados: hasta +50 % de producción', () => {
    const s = newGame(0);
    const base = unitRate(s, 'gatherer');
    s.legacy.levels.memory = 5;
    expect(unitRate(s, 'gatherer') / base).toBeCloseTo(1.5);
  });

  it('Gremios: oficios hasta un 14 % más baratos', () => {
    const s = newGame(0);
    s.buildings.hunter = 20;
    const base = buildingCost(s, 'hunter').food!;
    s.legacy.levels.guilds = 3;
    expect(buildingCost(s, 'hunter').food! / base).toBeCloseTo(0.857, 2);
  });

  it('Manos hábiles: recolectar ×3', () => {
    const s = newGame(0);
    s.legacy.levels.hands = 1;
    expect(clickAmount(s)).toBe(3);
  });

  it('Paciencia: la tribu trabaja 10, 20 o 30 minutos fuera del juego', () => {
    const s = newGame(0);
    expect(offlineLimit(s)).toBe(MAX_OFFLINE_SECONDS);
    s.legacy.levels.patience = 2;
    expect(offlineLimit(s)).toBe(30 * 60);
    s.awaySince = 0;
    expect(creditedSeconds(s, 0, 3 * 3600 * 1000)).toBe(30 * 60);
  });

  it('Tradición oral: cada oficio descubierto empieza con 5 personas', () => {
    const s = newGame(0);
    expect(applyTradition(s)).toBe(false);
    s.legacy.levels.tradition = 1;
    expect(applyTradition(s)).toBe(true);
    expect(s.buildings.gatherer).toBe(5);
    // Los oficios de eras futuras no se tocan.
    for (const b of BUILDING_DEFS.filter((b) => b.era > 1)) expect(s.buildings[b.id]).toBe(0);
    s.buildings.gatherer = 12;
    applyTradition(s);
    expect(s.buildings.gatherer).toBe(12);
  });

  it('Capataces: llenan los oficios de eras pasadas, no los de la era actual', () => {
    const s = newGame(0);
    s.era = 2;
    s.legacy.levels.foremen = 1;
    for (const r of Object.keys(s.resources)) s.resources[r as keyof typeof s.resources] = s.totals[r as keyof typeof s.totals] = 1e30;
    for (let i = 0; i < 100; i++) autoHire(s);
    for (const b of BUILDING_DEFS.filter((b) => b.era === 1)) expect(s.buildings[b.id]).toBe(BUILDING_CAP);
    for (const b of BUILDING_DEFS.filter((b) => b.era === 2)) expect(s.buildings[b.id]).toBe(0);
  });
});

describe('guardado del Legado', () => {
  it('se guarda y se recupera', () => {
    const s = newGame(0);
    s.legacy = { wisdom: 12, levels: { memory: 3, guilds: 1, tradition: 1, hands: 1, patience: 0, foremen: 0 }, rebirths: 2, bestEra: 8 };
    expect(deserialize(serialize(s))!.legacy).toEqual(s.legacy);
  });

  it('las partidas antiguas empiezan sin Sabiduría y los niveles se recortan al tope', () => {
    const old = deserialize(btoa(JSON.stringify({ version: 3, era: 6 })))!;
    expect(old.legacy.wisdom).toBe(0);
    expect(old.legacy.bestEra).toBe(6);
    const odd = deserialize(btoa(JSON.stringify({ version: 4, legacy: { wisdom: -3, levels: { memory: 99, hands: 'x' } } })))!;
    expect(odd.legacy.wisdom).toBe(0);
    expect(odd.legacy.levels.memory).toBe(maxLevel('memory'));
    expect(odd.legacy.levels.hands).toBe(0);
  });
});
