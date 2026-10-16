// Iconos dibujados a mano en SVG, al estilo de las pinturas rupestres: se tiñen con
// currentColor y el filtro #pintura (en index.html) les da bordes irregulares de pigmento.

const svg = (body: string) =>
  `<svg viewBox="0 0 48 48" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const line = (d: string, w = 4) => `<path d="${d}" fill="none" stroke-width="${w}"/>`;

export const ICONS = {
  berry: svg('<circle cx="17" cy="30" r="8"/><circle cx="31" cy="31" r="7"/><circle cx="24" cy="18" r="6.5"/><path d="M25 12c2-6 8-8 13-6-2 5-8 8-13 6z" stroke="none"/>'),
  log: svg('<path d="M10 15h25a9 9 0 0 1 0 18H10a9 9 0 0 1 0-18z" stroke="none"/><circle cx="35" cy="24" r="5" fill="none" stroke-width="2.5" opacity=".55"/>'),
  person: svg('<circle cx="24" cy="9" r="6"/><path d="M13 44l5-17-7-6 9-5h8l9 5-7 6 5 17h-6l-4-13-4 13z" stroke="none"/>'),
  axe: svg(line('M12 43L31 12', 4.5) + '<path d="M25 7c7-3 14 1 16 9l-10 5c-1-5-3-8-8-9z" stroke="none"/>'),
  spear: svg(line('M7 43L35 13', 3.5) + '<path d="M33 6l10-1-1 10-7 2-5-5z" stroke="none"/>'),
  fish: svg('<path d="M5 24c8-11 23-13 31 0-8 13-23 11-31 0z" stroke="none"/><path d="M35 24l9-8v16z" stroke="none"/>'),
  fire: svg('<path d="M24 3c3 8 13 12 13 25a13 13 0 0 1-26 0c0-7 4-10 6-15 2 4 3 7 6 8-2-6-1-13 1-18z" stroke="none"/>'),
  basket: svg('<path d="M7 21h34l-5 20H12z" stroke="none"/>' + line('M14 21c0-10 20-10 20 0', 3.5)),
  hand: svg('<path d="M17 45c-5-6-8-13-8-19 0-3 4-4 5-1l3 6V11c0-3 4-3 4 0v13V7c0-3 4-3 4 0v17V9c0-3 4-3 4 0v17V15c0-3 4-3 4 0v15c0 8-3 12-7 15z" stroke="none"/>'),
  net: svg(line('M8 8h32v32H8zM8 19h32M8 30h32M19 8v32M30 8v32', 2.8)),
  sprout: svg(line('M24 45V22', 4) + '<path d="M23 27c-10 0-15-6-15-13 9 0 15 4 15 13zM25 22c0-9 6-15 15-15 0 9-6 15-15 15z" stroke="none"/>'),
  gear: svg('<circle cx="24" cy="24" r="14" fill="none" stroke-width="7" stroke-dasharray="5.5 5.5" stroke-linecap="butt"/><circle cx="24" cy="24" r="10" fill="none" stroke-width="4"/>'),
  soundOn: svg('<path d="M7 18h8l11-9v30l-11-9H7z" stroke="none"/>' + line('M32 17c4 4 4 10 0 14M37 11c7 7 7 19 0 26', 3.5)),
  soundOff: svg('<path d="M7 18h8l11-9v30l-11-9H7z" stroke="none"/>' + line('M33 18l10 12M43 18L33 30', 3.5)),
  locked: svg('<circle cx="24" cy="24" r="16" fill="none" stroke-width="3.5" stroke-dasharray="4 5"/><path d="M19 19c0-6 10-6 10 0 0 4-5 4-5 9M24 34v1" fill="none" stroke-width="3.5"/>'),
  close: svg(line('M12 12l24 24M36 12L12 36', 4.5)),
};

export type IconId = keyof typeof ICONS;

export const BUILDING_ICONS: Record<string, IconId> = { gatherer: 'berry', woodcutter: 'axe', hunter: 'spear', fisher: 'fish' };
export const UPGRADE_ICONS: Record<string, IconId> = { fire: 'fire', baskets: 'basket', axes: 'axe', spears: 'spear', 'cave-paintings': 'hand', nets: 'net' };
export const RESOURCE_ICONS: Record<string, IconId> = { food: 'berry', wood: 'log' };
