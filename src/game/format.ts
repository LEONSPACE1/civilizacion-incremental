const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Formatea números grandes de forma legible: 1234 → "1,23K". */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (Math.abs(value) < 1000) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
  }
  const tier = Math.floor(Math.log10(Math.abs(value)) / 3);
  if (tier >= SUFFIXES.length) return value.toExponential(2).replace('.', ',');
  const scaled = value / 10 ** (tier * 3);
  return `${scaled.toFixed(2).replace('.', ',')}${SUFFIXES[tier]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}
