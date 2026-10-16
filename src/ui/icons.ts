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
  tree: svg('<path d="M24 3l11 15h-6l9 12h-7l8 10H9l8-10h-7l9-12h-6z" stroke="none"/>' + line('M24 40v6', 4)),
  raft: svg('<path d="M4 30h40l-4 8H8z" stroke="none"/>' + line('M10 30v-4M18 30v-4M26 30v-4M34 30v-4', 3) + line('M30 26L38 4', 3) + '<path d="M6 42c4-2 8 2 12 0s8 2 12 0 8 2 12 0" fill="none" stroke-width="2.5"/>'),
  sledge: svg(line('M6 34h30c5 0 8-3 8-7', 3.5) + '<path d="M10 20h24a6 6 0 0 1 0 12H10a6 6 0 0 1 0-12z" stroke="none"/>' + line('M12 34l-2 6M30 34l-2 6', 3)),
  gear: svg('<circle cx="24" cy="24" r="14" fill="none" stroke-width="7" stroke-dasharray="5.5 5.5" stroke-linecap="butt"/><circle cx="24" cy="24" r="10" fill="none" stroke-width="4"/>'),
  soundOn: svg('<path d="M7 18h8l11-9v30l-11-9H7z" stroke="none"/>' + line('M32 17c4 4 4 10 0 14M37 11c7 7 7 19 0 26', 3.5)),
  soundOff: svg('<path d="M7 18h8l11-9v30l-11-9H7z" stroke="none"/>' + line('M33 18l10 12M43 18L33 30', 3.5)),
  locked: svg('<circle cx="24" cy="24" r="16" fill="none" stroke-width="3.5" stroke-dasharray="4 5"/><path d="M19 19c0-6 10-6 10 0 0 4-5 4-5 9M24 34v1" fill="none" stroke-width="3.5"/>'),
  stone: svg('<path d="M6 40l5-12 9-4 6 5 7-9 9 4 2 16z" stroke="none"/><path d="M14 18l6-8 8 2 2 7-8 4z" stroke="none" opacity=".75"/>'),
  wheat: svg(line('M24 46V10', 3) + '<path d="M24 12c-5-2-6-7-5-10 4 1 6 5 5 10zM24 12c5-2 6-7 5-10-4 1-6 5-5 10zM24 21c-5-2-7-6-6-10 4 1 6 5 6 10zM24 21c5-2 7-6 6-10-4 1-6 5-6 10zM24 30c-5-2-7-6-6-10 4 1 6 5 6 10zM24 30c5-2 7-6 6-10-4 1-6 5-6 10z" stroke="none"/>'),
  sheep: svg('<path d="M10 22c0-5 4-8 8-7 2-4 8-5 11-1 4-2 9 1 9 6 4 1 5 6 2 9 1 4-3 7-7 6-2 3-8 4-11 1-4 2-9 0-10-4-4-1-5-7-2-10z" stroke="none"/><path d="M6 20c-3 0-4 4-1 6l5-1z" stroke="none"/>' + line('M16 34v9M22 35v8M30 35v8M36 33v9', 3.5)),
  sapling: svg('<path d="M12 44h24l-3-10H15z" stroke="none"/>' + line('M24 34V16', 3.5) + '<path d="M24 22c-9 0-13-5-13-12 8 0 13 4 13 12zM24 18c0-8 5-13 13-13 0 8-5 13-13 13z" stroke="none"/>'),
  adze: svg(line('M14 42L32 10', 4.5) + '<path d="M26 6c6-2 13 0 16 5l-12 4c-1-3-2-5-4-6z" stroke="none"/>' + '<path d="M4 44h40v-5H4z" stroke="none" opacity=".7"/>'),
  hammer: svg(line('M10 42l20-20', 4.5) + '<path d="M24 8l16 16-6 6-16-16z" stroke="none"/>' + '<path d="M36 40l3-5 5 2-1 6z" stroke="none" opacity=".75"/>'),
  pick: svg(line('M24 44V14', 4) + '<path d="M24 14c-6-4-13-4-19 0 2 3 5 3 7 2 4-3 8-3 12 1zM24 14c6-4 13-4 19 0-2 3-5 3-7 2-4-3-8-3-12 1z" stroke="none"/>' + line('M24 22l-7-6M24 28l6-6', 3)),
  quern: svg('<ellipse cx="24" cy="34" rx="19" ry="8" stroke="none"/><ellipse cx="24" cy="24" rx="13" ry="5" stroke="none" opacity=".75"/>' + line('M24 24V9', 4)),
  wedge: svg('<path d="M18 6h12l-4 30h-4z" stroke="none"/><path d="M4 44l8-12h24l8 12z" stroke="none" opacity=".75"/>'),
  sickle: svg('<path d="M14 40C6 30 10 12 26 8c10-2 16 4 16 4-9-2-20 2-22 12-2 7 1 12 4 16z" stroke="none"/>' + line('M14 40l-6 6', 5)),
  pot: svg('<path d="M15 6h18l-2 6c8 4 11 11 9 19-2 9-9 13-16 13S10 40 8 31c-2-8 1-15 9-19z" stroke="none"/><path d="M11 24l5 5 5-5 5 5 5-5 5 5 4-4" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2.5"/>'),
  fence: svg(line('M8 44V12M20 44V10M32 44V12M44 44V14', 4) + line('M4 20h42M4 34h42', 3.2)),
  menhir: svg('<path d="M18 44l2-34c1-6 9-6 10 0l3 34z" stroke="none"/><path d="M4 44l2-16c1-4 6-4 7 0l1 16zM35 44l1-18c1-4 6-4 7 0l2 18z" stroke="none" opacity=".7"/>'),
  copper: svg('<path d="M8 22h32l-4 18H12z" stroke="none"/><path d="M14 22c0-8 4-13 4-16 3 3 2 7 6 9 0-4 2-7 4-9 3 5 6 9 6 16z" stroke="none" opacity=".7"/>'),
  hut: svg('<path d="M4 24L24 6l20 18z" stroke="none"/><path d="M9 24h30v18H9z" stroke="none" opacity=".75"/>' + '<path d="M20 42V31h8v11z" fill="#000" fill-opacity=".35" stroke="none"/>'),
  close: svg(line('M12 12l24 24M36 12L12 36', 4.5)),
};

export type IconId = keyof typeof ICONS;

export const BUILDING_ICONS: Record<string, IconId> = {
  gatherer: 'berry', woodcutter: 'axe', hunter: 'spear', feller: 'tree', fisher: 'fish', rafter: 'raft',
  quarrier: 'hammer', farmer: 'wheat', forester: 'sapling', herder: 'sheep', carpenter: 'adze', miner: 'pick',
};
export const UPGRADE_ICONS: Record<string, IconId> = {
  fire: 'fire',
  baskets: 'basket',
  axes: 'axe',
  spears: 'spear',
  sledges: 'sledge',
  'cave-paintings': 'hand',
  nets: 'net',
  rafts: 'raft',
  quern: 'quern',
  wedges: 'wedge',
  sickles: 'sickle',
  seedbeds: 'sapling',
  pottery: 'pot',
  corrals: 'fence',
  adzes: 'adze',
  'antler-picks': 'pick',
  menhirs: 'menhir',
};
/** Icono del botón de recolectar y de la meta de cada era. */
export const ERA_ICONS: Record<number, { gather: IconId; goal: IconId; root: IconId }> = {
  1: { gather: 'berry', goal: 'sprout', root: 'fire' },
  2: { gather: 'wheat', goal: 'copper', root: 'hut' },
};
export const RESOURCE_ICONS: Record<string, IconId> = { food: 'berry', wood: 'log', stone: 'stone' };
