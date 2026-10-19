/** Cómo se escriben las cantidades grandes; el jugador lo elige en Ajustes. */
export type NumberFormat = 'short' | 'words' | 'scientific' | 'full';

export const NUMBER_FORMATS: { id: NumberFormat; name: string }[] = [
  { id: 'short', name: 'Abreviado' },
  { id: 'words', name: 'En palabras' },
  { id: 'scientific', name: 'Científico' },
  { id: 'full', name: 'Completo' },
];

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
// Escala larga en español: un billón son 10^12.
const WORDS: [string, string][] = [
  ['', ''],
  ['mil', 'mil'],
  ['millón', 'millones'],
  ['mil millones', 'mil millones'],
  ['billón', 'billones'],
  ['mil billones', 'mil billones'],
  ['trillón', 'trillones'],
  ['mil trillones', 'mil trillones'],
  ['cuatrillón', 'cuatrillones'],
  ['mil cuatrillones', 'mil cuatrillones'],
  ['quintillón', 'quintillones'],
];

let mode: NumberFormat = 'short';

/** Cómo se escriben los números en el idioma elegido (por defecto, en español). */
export interface NumberLocale {
  decimal: string;
  group: string;
  /** Palabras de cada potencia de mil, [singular, plural]; vacío para el chino, que agrupa de 10⁴ en 10⁴. */
  words: [string, string][];
  /** Unidades de las duraciones. */
  units: { h: string; min: string; s: string };
}
// En chino los números grandes se cuentan por 万 (10⁴), 亿 (10⁸)…
const CJK = ['', '万', '亿', '兆', '京', '垓', '秭', '穰'];
let loc: NumberLocale = { decimal: ',', group: '.', words: WORDS, units: { h: 'h', min: 'min', s: 's' } };

export function setNumberLocale(l: Partial<NumberLocale>): void {
  loc = { ...loc, ...l };
}

export function setNumberFormat(format: NumberFormat): void {
  mode = format;
}

export function getNumberFormat(): NumberFormat {
  return mode;
}

const comma = (n: number, digits: number) => n.toFixed(digits).replace('.', loc.decimal);

function scientific(value: number): string {
  const [m, e] = value.toExponential(2).split('e');
  return `${m.replace('.', loc.decimal)}e${Number(e)}`;
}

/** Formatea números grandes de forma legible según el formato elegido: 1234 → "1,23K". */
export function formatNumber(value: number, format: NumberFormat = mode): string {
  if (!Number.isFinite(value)) return '∞';
  if (Math.abs(value) < 1000) {
    return Number.isInteger(value) ? String(value) : comma(value, 1);
  }
  const tier = Math.floor(Math.log10(Math.abs(value)) / 3);
  if (format === 'scientific') return scientific(value);
  if (format === 'full') {
    if (Math.abs(value) >= 1e21) return scientific(value);
    return Math.floor(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, loc.group);
  }
  if (format === 'words' && !loc.words.length) {
    const t4 = Math.floor(Math.log10(Math.abs(value)) / 4);
    if (t4 >= CJK.length) return scientific(value);
    return `${comma(value / 10 ** (t4 * 4), 2)}${CJK[t4]}`;
  }
  const list = format === 'words' ? loc.words : SUFFIXES;
  if (tier >= list.length) return scientific(value);
  const scaled = value / 10 ** (tier * 3);
  if (format === 'words') {
    const [one, many] = loc.words[tier];
    const text = comma(scaled, 2);
    return `${text} ${scaled.toFixed(2) === '1.00' ? one : many}`;
  }
  return `${comma(scaled, 2)}${SUFFIXES[tier]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const u = loc.units;
  if (h > 0) return `${h} ${u.h} ${m} ${u.min}`;
  if (m > 0) return `${m} ${u.min}`;
  return `${s} ${u.s}`;
}
