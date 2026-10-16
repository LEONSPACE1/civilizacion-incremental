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

export function setNumberFormat(format: NumberFormat): void {
  mode = format;
}

export function getNumberFormat(): NumberFormat {
  return mode;
}

const comma = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');

function scientific(value: number): string {
  const [m, e] = value.toExponential(2).split('e');
  return `${m.replace('.', ',')}e${Number(e)}`;
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
    return Math.floor(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  const list = format === 'words' ? WORDS : SUFFIXES;
  if (tier >= list.length) return scientific(value);
  const scaled = value / 10 ** (tier * 3);
  if (format === 'words') {
    const [one, many] = WORDS[tier];
    const text = comma(scaled, 2);
    return `${text} ${text === '1,00' ? one : many}`;
  }
  return `${comma(scaled, 2)}${SUFFIXES[tier]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}
