import { describe, expect, it } from 'vitest';
import { BUILDINGS, newGame, RESOURCES } from '../src/game/state';
import { GOALS, UPGRADE_DEFS } from '../src/game/content';
import { BUILDING_CAP } from '../src/game/balance';
import { buildingCost, bulkCost, buyBuildings, buyCount, buyGoal, gather, maxAffordable, rebirth, tick } from '../src/game/logic';
import { ACHIEVEMENTS, allAchieved, checkAchievements, completion, FULL_POPULATION } from '../src/game/achievements';
import { deserialize, MIGRATED, serialize } from '../src/game/save';
import { formatDuration, formatNumber, setNumberLocale } from '../src/game/format';
import { dueTutorial, settleMigrated, TUTORIALS } from '../src/ui/tutorial';
import ES from '../src/i18n/es';
import * as EN from '../src/i18n/locales/en';
import * as ZH from '../src/i18n/locales/zh';
import * as FR from '../src/i18n/locales/fr';
import * as PT from '../src/i18n/locales/pt';
import { extractContent } from '../src/i18n/content';

describe('comprar x1, x5, x10 y máx', () => {
  it('el coste de varias es la suma de cada una', () => {
    const s = newGame(0);
    const one = buildingCost(s, 'gatherer').food!;
    s.buildings.gatherer = 1;
    const two = buildingCost(s, 'gatherer').food!;
    s.buildings.gatherer = 0;
    expect(bulkCost(s, 'gatherer', 2).food).toBe(one + two);
  });
  it('compra todas o ninguna y no pasa del tope', () => {
    const s = newGame(0);
    s.resources.food = 1e9;
    s.buildings.gatherer = BUILDING_CAP - 3;
    expect(buyCount(s, 'gatherer', 10)).toBe(3);
    expect(buyBuildings(s, 'gatherer', 3)).toBe(3);
    expect(s.buildings.gatherer).toBe(BUILDING_CAP);
    expect(buyBuildings(s, 'gatherer', 1)).toBe(0);
    const poor = newGame(0);
    poor.resources.food = 15;
    expect(buyBuildings(poor, 'gatherer', 5)).toBe(0);
    expect(poor.resources.food).toBe(15);
  });
  it('máx compra lo que se puede pagar', () => {
    const s = newGame(0);
    s.resources.food = 100;
    const n = maxAffordable(s, 'gatherer');
    expect(n).toBeGreaterThan(1);
    expect(bulkCost(s, 'gatherer', n).food!).toBeLessThanOrEqual(100);
    expect(bulkCost(s, 'gatherer', n + 1).food!).toBeGreaterThan(100);
    expect(buyBuildings(s, 'gatherer', buyCount(s, 'gatherer', 'max'))).toBe(n);
  });
});

describe('logros', () => {
  it('se consiguen y no se repiten', () => {
    const s = newGame(0);
    for (let i = 0; i < 100; i++) gather(s);
    const fresh = checkAchievements(s).map((a) => a.id);
    expect(fresh).toContain('clicks100');
    expect(checkAchievements(s).length).toBe(0);
  });
  it('el 100 % pide todos y el cohete cuenta', () => {
    const s = newGame(0);
    s.era = 8;
    for (const r of RESOURCES) s.resources[r] = GOALS[8].cost[r]!;
    expect(buyGoal(s)).toBe(true);
    expect(s.profile.rockets).toBe(1);
    checkAchievements(s);
    expect(s.profile.achievements).toContain('rocket');
    expect(allAchieved(s)).toBe(false);
    s.profile.achievements = ACHIEVEMENTS.map((a) => a.id);
    expect(completion(s)).toBe(1);
  });
  it('la población máxima es la de todos los oficios llenos', () => {
    expect(FULL_POPULATION).toBe(1 + BUILDINGS.length * 50);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

describe('perfil y estadísticas', () => {
  it('cuenta récords y sobrevive al renacer y al guardado', () => {
    const s = newGame(0);
    s.buildings.gatherer = 10;
    tick(s, 60);
    expect(s.profile.run.seconds).toBe(60);
    expect(s.profile.maxRate.food).toBeGreaterThan(0);
    s.era = 4;
    s.profile.achievements = ['era2'];
    const next = rebirth(s)!;
    expect(next.profile.civs).toHaveLength(1);
    expect(next.profile.civs[0].era).toBe(4);
    expect(next.profile.run.seconds).toBe(0);
    expect(next.profile.achievements).toEqual(['era2']);
    const back = deserialize(serialize(next))!;
    expect(back.profile.civs[0].maxRate.food).toBe(s.profile.maxRate.food);
    expect(back.profile.playSeconds).toBe(60);
  });
  it('las partidas antiguas no repiten los tutoriales de lo ya desbloqueado', () => {
    const old = newGame(0) as unknown as Record<string, unknown>;
    old.version = 4;
    old.era = 3;
    delete old.profile;
    const s = deserialize(btoa(JSON.stringify(old)))!;
    expect(s.profile.tutorials).toContain(MIGRATED);
    settleMigrated(s);
    expect(s.profile.tutorials).not.toContain(MIGRATED);
    expect(s.profile.tutorials).toContain('newEra');
    expect(dueTutorial(s)?.id).not.toBe('newEra');
  });
  it('el tutorial de inicio va primero', () => {
    const s = newGame(0);
    s.era = 2;
    expect(dueTutorial(s)).toBeUndefined();
    s.profile.tutorials = ['intro'];
    expect(dueTutorial(s)?.id).toBe('newEra');
    expect(TUTORIALS[0].id).toBe('intro');
  });
});

describe('idiomas', () => {
  const es = extractContent();
  for (const [name, loc] of Object.entries({ en: EN, zh: ZH, fr: FR, pt: PT })) {
    it(`${name}: tiene todos los textos con sus mismas {marcas}`, () => {
      const marks = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      for (const [k, v] of Object.entries(ES)) {
        const tr = loc.ui[k as keyof typeof ES];
        expect(tr, k).toBeTypeOf('string');
        expect(marks(tr!), k).toBe(marks(v));
      }
      for (const group of ['resources', 'eras', 'buildings', 'upgrades', 'goals'] as const) {
        for (const id of Object.keys(es[group])) expect(loc.content[group]?.[id], `${group}.${id}`).toBeTruthy();
      }
      expect(Object.keys(loc.content.upgrades ?? {})).toHaveLength(UPGRADE_DEFS.length);
    });
  }
  it('números y duraciones según el idioma', () => {
    setNumberLocale({ decimal: '.', group: ',', words: [['', ''], ['thousand', 'thousand'], ['million', 'million']], units: { h: 'h', min: 'min', s: 's' } });
    expect(formatNumber(1234)).toBe('1.23K');
    expect(formatNumber(2_300_000, 'words')).toBe('2.30 million');
    setNumberLocale({ words: [], units: { h: '小时', min: '分钟', s: '秒' } });
    expect(formatNumber(123_456_789, 'words')).toBe('1.23亿');
    expect(formatDuration(3700)).toBe('1 小时 1 分钟');
    setNumberLocale({ decimal: ',', group: '.', words: [['', ''], ['mil', 'mil'], ['millón', 'millones']], units: { h: 'h', min: 'min', s: 's' } });
  });
});
