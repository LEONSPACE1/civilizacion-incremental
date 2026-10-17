import type { BuildingId, Cost, GameState, ResourceId } from './state';

export interface ResourceDef {
  id: ResourceId;
  name: string;
}

export interface BuildingDef {
  id: BuildingId;
  /** Era en la que aparece este oficio. */
  era: number;
  name: string;
  plural: string;
  description: string;
  baseCost: Cost;
  produces: ResourceId;
  rate: number;
  unlocked: (s: GameState) => boolean;
  unlockHint: string;
}

export type UpgradeEffect =
  | { kind: 'building'; building: BuildingId; multiplier: number }
  | { kind: 'click'; multiplier: number }
  /** Cada clic suma además una parte de la comida por segundo. */
  | { kind: 'clickRate'; multiplier: number; share: number }
  | { kind: 'global'; multiplier: number };

/** Qué hace falta para que aparezca una mejora. */
export type Requirement = { building: BuildingId; count: number } | { total: ResourceId; amount: number };

export interface UpgradeDef {
  id: string;
  era: number;
  name: string;
  description: string;
  cost: Cost;
  effect: UpgradeEffect;
  requires: Requirement;
  unlocked: (s: GameState) => boolean;
}

export interface GoalDef {
  name: string;
  /** Texto del botón para pagarla. */
  action: string;
  description: string;
  cost: Cost;
}

export const COST_GROWTH = 1.15;

export const RESOURCE_DEFS: ResourceDef[] = [
  { id: 'food', name: 'Comida' },
  { id: 'wood', name: 'Madera' },
  { id: 'stone', name: 'Piedra' },
  { id: 'metal', name: 'Bronce' },
];

export interface EraDef {
  n: number;
  name: string;
  /** Recursos que se muestran desde esta era. */
  resources: ResourceId[];
  gatherLabel: string;
  /** Texto del botón para entrar en esta era. */
  enter: string;
  intro: string;
}

export const ERA_DEFS: EraDef[] = [
  { n: 1, name: 'Paleolítico', resources: ['food', 'wood'], gatherLabel: 'Recolectar bayas', enter: 'Entrar en el Paleolítico', intro: '' },
  {
    n: 2,
    name: 'Neolítico',
    resources: ['food', 'wood', 'stone'],
    gatherLabel: 'Cosechar trigo',
    enter: 'Entrar en el Neolítico',
    intro: 'Tu tribu se asienta: campos de trigo, rebaños, casas de barro y la piedra como nuevo recurso.',
  },
  {
    n: 3,
    name: 'Edad del Bronce',
    resources: ['food', 'wood', 'stone', 'metal'],
    gatherLabel: 'Hornear pan',
    enter: 'Entrar en la Edad del Bronce',
    intro: 'Hornos de fundición, arados tirados por bueyes, casas de piedra y el bronce como nuevo recurso. La aldea crece hacia el bosque.',
  },
];
export const ERA_BY_N = Object.fromEntries(ERA_DEFS.map((e) => [e.n, e])) as Record<number, EraDef>;

// Regla de precios: cada coste pide la misma cantidad de cada recurso que usa.
// Los recursos de eras anteriores se producen más rápido que el recurso nuevo de la era
// (x1,5 por unidad), así que sobran y el recurso nuevo marca el ritmo.
//
// Era 1: Paleolítico. Cada recurso tiene su propia escalera de oficios, uno por nivel,
// con la misma producción por unidad: así ninguno se queda atrás al avanzar.
export const BUILDING_DEFS: BuildingDef[] = [
  {
    id: 'gatherer',
    era: 1,
    name: 'Recolector',
    plural: 'recolectores',
    description: 'Busca bayas y raíces cerca del campamento.',
    baseCost: { food: 10 },
    produces: 'food',
    rate: 0.5,
    unlocked: () => true,
    unlockHint: '',
  },
  {
    id: 'woodcutter',
    era: 1,
    name: 'Leñador',
    plural: 'leñadores',
    description: 'Recoge ramas y troncos caídos del bosque.',
    baseCost: { food: 15 },
    produces: 'wood',
    rate: 0.5,
    unlocked: (s) => s.totals.food >= 15,
    unlockHint: 'Reúne 15 de comida',
  },
  {
    id: 'hunter',
    era: 1,
    name: 'Cazador',
    plural: 'cazadores',
    description: 'Sale en grupo a cazar con lanzas de madera.',
    baseCost: { food: 60, wood: 60 },
    produces: 'food',
    rate: 3,
    unlocked: (s) => s.buildings.woodcutter >= 2,
    unlockHint: 'Ten 2 leñadores',
  },
  {
    id: 'feller',
    era: 1,
    name: 'Talador',
    plural: 'taladores',
    description: 'Derriba árboles enteros con hachas de mano.',
    baseCost: { food: 60, wood: 60 },
    produces: 'wood',
    rate: 3,
    unlocked: (s) => s.buildings.woodcutter >= 3,
    unlockHint: 'Ten 3 leñadores',
  },
  {
    id: 'fisher',
    era: 1,
    name: 'Pescador',
    plural: 'pescadores',
    description: 'Pesca en el lago con trampas de ramas.',
    baseCost: { food: 400, wood: 400 },
    produces: 'food',
    rate: 14,
    unlocked: (s) => s.buildings.hunter >= 3,
    unlockHint: 'Ten 3 cazadores',
  },
  {
    id: 'rafter',
    era: 1,
    name: 'Balsero',
    plural: 'balseros',
    description: 'Recoge troncos a la deriva y los trae por el lago.',
    baseCost: { food: 400, wood: 400 },
    produces: 'wood',
    rate: 14,
    unlocked: (s) => s.buildings.feller >= 3,
    unlockHint: 'Ten 3 taladores',
  },
  // Era 2: Neolítico. La piedra es el recurso nuevo y cada recurso suma dos oficios más.
  // Los oficios de comida y madera rinden x1,5 frente a los de piedra.
  {
    id: 'quarrier',
    era: 2,
    name: 'Cantero',
    plural: 'canteros',
    description: 'Arranca bloques de la cantera con mazos y cuñas.',
    baseCost: { food: 25000, wood: 25000 },
    produces: 'stone',
    rate: 500,
    unlocked: () => true,
    unlockHint: '',
  },
  {
    id: 'farmer',
    era: 2,
    name: 'Agricultor',
    plural: 'agricultores',
    description: 'Siembra y cosecha trigo en los campos de la aldea.',
    baseCost: { food: 20000, wood: 20000, stone: 20000 },
    produces: 'food',
    rate: 750,
    unlocked: (s) => s.buildings.quarrier >= 1,
    unlockHint: 'Ten 1 cantero',
  },
  {
    id: 'forester',
    era: 2,
    name: 'Silvicultor',
    plural: 'silvicultores',
    description: 'Planta y cuida arboledas para que nunca falte madera.',
    baseCost: { food: 20000, wood: 20000, stone: 20000 },
    produces: 'wood',
    rate: 750,
    unlocked: (s) => s.buildings.quarrier >= 2,
    unlockHint: 'Ten 2 canteros',
  },
  {
    id: 'herder',
    era: 2,
    name: 'Pastor',
    plural: 'pastores',
    description: 'Cuida rebaños de ovejas y cabras en el corral.',
    baseCost: { food: 520000, wood: 520000, stone: 520000 },
    produces: 'food',
    rate: 4500,
    unlocked: (s) => s.buildings.farmer >= 3,
    unlockHint: 'Ten 3 agricultores',
  },
  {
    id: 'carpenter',
    era: 2,
    name: 'Carpintero',
    plural: 'carpinteros',
    description: 'Labra vigas y tablones con azuelas de piedra pulida.',
    baseCost: { food: 520000, wood: 520000, stone: 520000 },
    produces: 'wood',
    rate: 4500,
    unlocked: (s) => s.buildings.forester >= 3,
    unlockHint: 'Ten 3 silvicultores',
  },
  {
    id: 'miner',
    era: 2,
    name: 'Minero de sílex',
    plural: 'mineros de sílex',
    description: 'Excava pozos hondos para sacar el mejor sílex.',
    baseCost: { food: 450000, wood: 450000, stone: 450000 },
    produces: 'stone',
    rate: 3000,
    unlocked: (s) => s.buildings.quarrier >= 4,
    unlockHint: 'Ten 4 canteros',
  },
  // Era 3: Edad del Bronce. El bronce es el recurso nuevo: el fundidor abre la era y el minero
  // de cobre la sostiene. Comida, madera y piedra suman un oficio cada una, que rinde x1,5
  // frente al minero de cobre, y los oficios de eras anteriores llegan a su tope durante la era.
  {
    id: 'smelter',
    era: 3,
    name: 'Fundidor',
    plural: 'fundidores',
    description: 'Funde mineral en hornos de barro avivados con fuelles de piel.',
    baseCost: { food: 2e6, wood: 2e6, stone: 2e6 },
    produces: 'metal',
    rate: 12000,
    unlocked: () => true,
    unlockHint: '',
  },
  {
    id: 'mason',
    era: 3,
    name: 'Picapedrero',
    plural: 'picapedreros',
    description: 'Labra sillares con cinceles de bronce para casas y murallas.',
    baseCost: { food: 1.5e7, wood: 1.5e7, stone: 1.5e7, metal: 1.5e7 },
    produces: 'stone',
    rate: 150000,
    unlocked: (s) => s.buildings.smelter >= 2,
    unlockHint: 'Ten 2 fundidores',
  },
  {
    id: 'plowman',
    era: 3,
    name: 'Arador',
    plural: 'aradores',
    description: 'Ara campos grandes con una yunta de bueyes.',
    baseCost: { food: 1.5e7, wood: 1.5e7, stone: 1.5e7, metal: 1.5e7 },
    produces: 'food',
    rate: 150000,
    unlocked: (s) => s.buildings.smelter >= 3,
    unlockHint: 'Ten 3 fundidores',
  },
  {
    id: 'charcoaler',
    era: 3,
    name: 'Carbonero',
    plural: 'carboneros',
    description: 'Cuece leña bajo tierra para hacer el carbón de los hornos.',
    baseCost: { food: 1.5e7, wood: 1.5e7, stone: 1.5e7, metal: 1.5e7 },
    produces: 'wood',
    rate: 150000,
    unlocked: (s) => s.buildings.smelter >= 4,
    unlockHint: 'Ten 4 fundidores',
  },
  {
    id: 'copperMiner',
    era: 3,
    name: 'Minero de cobre',
    plural: 'mineros de cobre',
    description: 'Abre galerías en la colina y saca mineral verde de cobre y estaño.',
    baseCost: { food: 1.5e7, wood: 1.5e7, stone: 1.5e7, metal: 1.5e7 },
    produces: 'metal',
    rate: 100000,
    unlocked: (s) => s.buildings.smelter >= 5,
    unlockHint: 'Ten 5 fundidores',
  },
];


const UPGRADES: (Omit<UpgradeDef, 'unlocked' | 'era'> & { era?: number })[] = [
  {
    id: 'fire',
    name: 'Dominar el fuego',
    description: 'Cada clic recolecta el triple.',
    cost: { food: 20, wood: 20 },
    effect: { kind: 'click', multiplier: 3 },
    requires: { building: 'woodcutter', count: 1 },
  },
  {
    id: 'baskets',
    name: 'Cestas de mimbre',
    description: 'Los recolectores producen el doble.',
    cost: { food: 100, wood: 100 },
    effect: { kind: 'building', building: 'gatherer', multiplier: 2 },
    requires: { building: 'gatherer', count: 5 },
  },
  {
    id: 'axes',
    name: 'Hachas de piedra',
    description: 'Los leñadores producen el doble.',
    cost: { food: 240, wood: 240 },
    effect: { kind: 'building', building: 'woodcutter', multiplier: 2 },
    requires: { building: 'woodcutter', count: 5 },
  },
  {
    id: 'spears',
    name: 'Lanzas con punta de sílex',
    description: 'Los cazadores producen el doble.',
    cost: { food: 1250, wood: 1250 },
    effect: { kind: 'building', building: 'hunter', multiplier: 2 },
    requires: { building: 'hunter', count: 5 },
  },
  {
    id: 'sledges',
    name: 'Trineos de arrastre',
    description: 'Los taladores producen el doble.',
    cost: { food: 1000, wood: 1000 },
    effect: { kind: 'building', building: 'feller', multiplier: 2 },
    requires: { building: 'feller', count: 5 },
  },
  {
    id: 'cave-paintings',
    name: 'Pinturas rupestres',
    description: 'Las historias unen a la tribu: toda la producción +50 %.',
    cost: { food: 3750, wood: 3750 },
    effect: { kind: 'global', multiplier: 1.5 },
    requires: { total: 'food', amount: 4000 },
  },
  {
    id: 'nets',
    name: 'Redes de fibra',
    description: 'Los pescadores producen el doble.',
    cost: { food: 6500, wood: 6500 },
    effect: { kind: 'building', building: 'fisher', multiplier: 2 },
    requires: { building: 'fisher', count: 5 },
  },
  {
    id: 'rafts',
    name: 'Balsas de troncos atados',
    description: 'Los balseros producen el doble.',
    cost: { food: 6500, wood: 6500 },
    effect: { kind: 'building', building: 'rafter', multiplier: 2 },
    requires: { building: 'rafter', count: 5 },
  },
  // Era 2
  {
    id: 'quern',
    era: 2,
    name: 'Molino de mano',
    description: 'Cada clic suma además el 5 % de tu comida por segundo.',
    cost: { food: 20000, wood: 20000, stone: 20000 },
    effect: { kind: 'clickRate', multiplier: 1, share: 0.05 },
    requires: { building: 'farmer', count: 1 },
  },
  {
    id: 'wedges',
    era: 2,
    name: 'Cuñas y palancas',
    description: 'Los canteros producen el doble.',
    cost: { food: 270000, wood: 270000, stone: 270000 },
    effect: { kind: 'building', building: 'quarrier', multiplier: 2 },
    requires: { building: 'quarrier', count: 5 },
  },
  {
    id: 'sickles',
    era: 2,
    name: 'Hoces de sílex',
    description: 'Los agricultores producen el doble.',
    cost: { food: 270000, wood: 270000, stone: 270000 },
    effect: { kind: 'building', building: 'farmer', multiplier: 2 },
    requires: { building: 'farmer', count: 5 },
  },
  {
    id: 'seedbeds',
    era: 2,
    name: 'Semilleros',
    description: 'Los silvicultores producen el doble.',
    cost: { food: 270000, wood: 270000, stone: 270000 },
    effect: { kind: 'building', building: 'forester', multiplier: 2 },
    requires: { building: 'forester', count: 5 },
  },
  {
    id: 'pottery',
    era: 2,
    name: 'Cerámica',
    description: 'Vasijas para guardar grano y agua: toda la producción +50 %.',
    cost: { food: 1700000, wood: 1700000, stone: 1700000 },
    effect: { kind: 'global', multiplier: 1.5 },
    requires: { total: 'stone', amount: 300000 },
  },
  {
    id: 'corrals',
    era: 2,
    name: 'Corrales de piedra',
    description: 'Los pastores producen el doble.',
    cost: { food: 17000000, wood: 17000000, stone: 17000000 },
    effect: { kind: 'building', building: 'herder', multiplier: 2 },
    requires: { building: 'herder', count: 5 },
  },
  {
    id: 'adzes',
    era: 2,
    name: 'Azuelas pulidas',
    description: 'Los carpinteros producen el doble.',
    cost: { food: 17000000, wood: 17000000, stone: 17000000 },
    effect: { kind: 'building', building: 'carpenter', multiplier: 2 },
    requires: { building: 'carpenter', count: 5 },
  },
  {
    id: 'antler-picks',
    era: 2,
    name: 'Picos de asta',
    description: 'Los mineros de sílex producen el doble.',
    cost: { food: 17000000, wood: 17000000, stone: 17000000 },
    effect: { kind: 'building', building: 'miner', multiplier: 2 },
    requires: { building: 'miner', count: 5 },
  },
  {
    id: 'menhirs',
    era: 2,
    name: 'Círculo de menhires',
    description: 'Un lugar sagrado que une a la aldea: toda la producción +50 %.',
    cost: { food: 55000000, wood: 55000000, stone: 55000000 },
    effect: { kind: 'global', multiplier: 1.5 },
    requires: { total: 'stone', amount: 20000000 },
  },
  // Era 3
  {
    id: 'threshing',
    era: 3,
    name: 'Trillo',
    description: 'Cada clic suma además el 5 % de tu comida por segundo.',
    cost: { food: 2e7, wood: 2e7, stone: 2e7, metal: 2e7 },
    effect: { kind: 'clickRate', multiplier: 1, share: 0.05 },
    requires: { building: 'smelter', count: 2 },
  },
  {
    id: 'bellows',
    era: 3,
    name: 'Fuelles de piel',
    description: 'Los fundidores producen el doble.',
    cost: { food: 1.5e8, wood: 1.5e8, stone: 1.5e8, metal: 1.5e8 },
    effect: { kind: 'building', building: 'smelter', multiplier: 2 },
    requires: { building: 'smelter', count: 5 },
  },
  {
    id: 'wheel',
    era: 3,
    name: 'La rueda',
    description: 'Carros para llevarlo todo: toda la producción +50 %.',
    cost: { food: 6e8, wood: 6e8, stone: 6e8, metal: 6e8 },
    effect: { kind: 'global', multiplier: 1.5 },
    requires: { total: 'metal', amount: 1.5e8 },
  },
  {
    id: 'timbering',
    era: 3,
    name: 'Galerías entibadas',
    description: 'Los mineros de cobre producen el doble.',
    cost: { food: 2e9, wood: 2e9, stone: 2e9, metal: 2e9 },
    effect: { kind: 'building', building: 'copperMiner', multiplier: 2 },
    requires: { building: 'copperMiner', count: 5 },
  },
  {
    id: 'bronze-plough',
    era: 3,
    name: 'Reja de bronce',
    description: 'Los aradores producen el doble.',
    cost: { food: 2e9, wood: 2e9, stone: 2e9, metal: 2e9 },
    effect: { kind: 'building', building: 'plowman', multiplier: 2 },
    requires: { building: 'plowman', count: 5 },
  },
  {
    id: 'kilns',
    era: 3,
    name: 'Carboneras cubiertas',
    description: 'Los carboneros producen el doble.',
    cost: { food: 2e9, wood: 2e9, stone: 2e9, metal: 2e9 },
    effect: { kind: 'building', building: 'charcoaler', multiplier: 2 },
    requires: { building: 'charcoaler', count: 5 },
  },
  {
    id: 'chisels',
    era: 3,
    name: 'Cinceles de bronce',
    description: 'Los picapedreros producen el doble.',
    cost: { food: 2e9, wood: 2e9, stone: 2e9, metal: 2e9 },
    effect: { kind: 'building', building: 'mason', multiplier: 2 },
    requires: { building: 'mason', count: 5 },
  },
  {
    id: 'sky-disk',
    era: 3,
    name: 'Disco celeste',
    description: 'Un disco de bronce y oro marca las siembras y las fiestas: toda la producción +50 %.',
    cost: { food: 5e9, wood: 5e9, stone: 5e9, metal: 5e9 },
    effect: { kind: 'global', multiplier: 1.5 },
    requires: { total: 'metal', amount: 2e9 },
  },
];


export function requirementProgress(s: GameState, r: Requirement): { have: number; need: number } {
  return 'building' in r ? { have: s.buildings[r.building], need: r.count } : { have: s.totals[r.total], need: r.amount };
}

export const UPGRADE_DEFS: UpgradeDef[] = UPGRADES.map((u) => ({
  ...u,
  era: u.era ?? 1,
  unlocked: (s: GameState) => {
    const { have, need } = requirementProgress(s, u.requires);
    return s.era >= (u.era ?? 1) && have >= need;
  },
}));

export const GOALS: Record<number, GoalDef> = {
  1: {
    name: 'Descubrir la agricultura',
    action: 'Descubrir la agricultura',
    description: 'Plantar semillas cerca del campamento abre la puerta al Neolítico.',
    cost: { food: 1200000, wood: 1200000 },
  },
  2: {
    name: 'Fundir el cobre',
    action: 'Fundir el cobre',
    description: 'Calentar piedras verdes en un horno de barro hasta que suelten metal abre la Edad del Bronce.',
    cost: { food: 260000000, wood: 260000000, stone: 260000000 },
  },
  3: {
    name: 'Inventar la escritura',
    action: 'Inventar la escritura',
    description: 'Llevar la cuenta del grano y del bronce con signos en tablillas de barro abre la Antigüedad.',
    cost: { food: 4e10, wood: 4e10, stone: 4e10, metal: 4e10 },
  },
};
export const ERA1_GOAL = GOALS[1];

// Un oficio solo aparece cuando la tribu ha llegado a su era.
for (const b of BUILDING_DEFS) {
  const ready = b.unlocked;
  b.unlocked = (s) => s.era >= b.era && ready(s);
}

export const BUILDING_BY_ID = Object.fromEntries(BUILDING_DEFS.map((b) => [b.id, b])) as Record<BuildingId, BuildingDef>;
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADE_DEFS.map((u) => [u.id, u])) as Record<string, UpgradeDef>;
