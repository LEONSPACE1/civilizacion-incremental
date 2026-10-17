import { describe, expect, it } from 'vitest';
import { FPS_OPTIONS, frameIntervals, isFpsLimit, isQualityLevel, pixelRatioFor, QUALITY_PRESETS, type QualityLevel } from '../src/scene/quality';

const LEVELS: QualityLevel[] = [1, 2, 3, 4, 5];

describe('calidad gráfica', () => {
  it('cada nivel ve igual o mejor que el anterior', () => {
    for (const n of LEVELS.slice(1)) {
      const a = QUALITY_PRESETS[(n - 1) as QualityLevel], b = QUALITY_PRESETS[n];
      expect(pixelRatioFor(n, 3)).toBeGreaterThanOrEqual(pixelRatioFor((n - 1) as QualityLevel, 3));
      expect(b.shadowMap).toBeGreaterThanOrEqual(a.shadowMap);
      for (const k of ['shadows', 'softShadows', 'fireShadows', 'shadowsEveryFrame', 'tinyShadows'] as const) {
        if (a[k]) expect(b[k]).toBe(true);
      }
    }
  });

  it('el nivel 3 es como se veía el juego hasta ahora', () => {
    const p = QUALITY_PRESETS[3];
    expect(pixelRatioFor(3, 3)).toBe(2);
    expect([p.shadows, p.softShadows, p.fireShadows, p.shadowMap]).toEqual([true, true, true, 2048]);
  });

  it('nunca dibuja con más resolución que la pantalla', () => {
    for (const n of LEVELS) expect(pixelRatioFor(n, 1)).toBeLessThanOrEqual(1);
  });

  it('valida lo que viene del guardado', () => {
    expect(isQualityLevel(3)).toBe(true);
    expect(isQualityLevel(0)).toBe(false);
    expect(isQualityLevel(2.5)).toBe(false);
    expect(isQualityLevel('3')).toBe(false);
    for (const o of FPS_OPTIONS) expect(isFpsLimit(o.id)).toBe(true);
    expect(isFpsLimit(120)).toBe(false);
  });
});

describe('fotogramas por segundo', () => {
  it('Auto: 30 en móvil, 60 en ordenador y 60 al arrastrar', () => {
    expect(frameIntervals('auto', true)).toEqual({ idle: 1000 / 30, drag: 1000 / 60 });
    expect(frameIntervals('auto', false)).toEqual({ idle: 1000 / 60, drag: 1000 / 60 });
  });

  it('un tope elegido se respeta también al arrastrar, y Máx. no tiene tope', () => {
    expect(frameIntervals(45, true)).toEqual({ idle: 1000 / 45, drag: 1000 / 45 });
    expect(frameIntervals('max', true)).toEqual({ idle: 0, drag: 0 });
  });
});
