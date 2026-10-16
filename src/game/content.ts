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
];

export interface EraDef {
  n: number;
  name: string;
  /** Recursos que se muestran desde esta era. */
  resources: ResourceId[];
  gatherLabel: string;
  intro: string;
}

export const ERA_DEFS: EraDef[] = [
  { n: 1, name: 'Paleolítico', resources: ['food', 'wood'], gatherLabel: 'Recolectar bayas', intro: '' },
  {
    n: 2,
    name: 'Neolítico',
    resources: ['food', 'wood', 'stone'],
    gatherLabel: 'Cosechar trigo',
    intro: 'Tu tribu se asienta: campos de trigo, rebaños, casas de barro y la piedra como nuevo recurso.',
  },
];
export const ERA_BY_N = Object.fromEntries(ERA_DEFS.map((e) => [e.n, e])) as Record<number, EraDef>;

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
    baseCost: { food: 80, wood: 40 },
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
    baseCost: { food: 80, wood: 40 },
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
    baseCost: { food: 500, wood: 300 },
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
    baseCost: { food: 500, wood: 300 },
    produces: 'wood',
    rate: 14,
    unlocked: (s) => s.buildings.feller >= 3,
    unlockHint: 'Ten 3 taladores',
  },
  // Era 2: Neolítico. La piedra es el recurso nuevo y cada recurso suma dos oficios más.
  {
    id: 'quarrier',
    era: 2,
    name: 'Cantero',
    plural: 'canteros',
    description: 'Arranca bloques de la cantera con mazos y cuñas.',
    baseCost: { food: 30000, wood: 20000 },
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
    baseCost: { food: 30000, wood: 20000, stone: 8000 },
    produces: 'food',
    rate: 500,
    unlocked: (s) => s.buildings.quarrier >= 1,
    unlockHint: 'Ten 1 cantero',
  },
  {
    id: 'forester',
    era: 2,
    name: 'Silvicultor',
    plural: 'silvicultores',
    description: 'Planta y cuida arboledas para que nunca falte madera.',
    baseCost: { food: 30000, wood: 20000, stone: 8000 },
    produces: 'wood',
    rate: 500,
    unlocked: (s) => s.buildings.quarrier >= 2,
    unlockHint: 'Ten 2 canteros',
  },
  {
    id: 'herder',
    era: 2,
    name: 'Pastor',
    plural: 'pastores',
    description: 'Cuida rebaños de ovejas y cabras en el corral.',
    baseCost: { food: 800000, wood: 500000, stone: 250000 },
    produces: 'food',
    rate: 3000,
    unlocked: (s) => s.buildings.farmer >= 3,
    unlockHint: 'Ten 3 agricultores',
  },
  {
    id: 'carpenter',
    era: 2,
    name: 'Carpintero',
    plural: 'carpinteros',
    description: 'Labra vigas y tablones con azuelas de piedra pulida.',
    baseCost: { food: 800000, wood: 500000, stone: 250000 },
    produces: 'wood',
    rate: 3000,
    unlocked: (s) => s.buildings.forester >= 3,
    unlockHint: 'Ten 3 silvicultores',
  },
  {
    id: 'miner',
    era: 2,
    name: 'Minero de sílex',
    plural: 'mineros de sílex',
    description: 'Excava pozos hondos para sacar el mejor sílex.',
    baseCost: { food: 800000, wood: 500000, stone: 100000 },
    produces: 'stone',
    rate: 3000,
    unlocked: (s) => s.buildings.quarrier >= 4,
    unlockHint: 'Ten 4 canteros',
  },
];


const UPGRADES: (Omit<UpgradeDef, 'unlocked' | 'era'> & { era?: number })[] = [
  {
    id: 'fire',
    name: 'Dominar el fuego',
    description: 'Cada clic recolecta el triple.',
    cost: { food: 40, wood: 10 },
    effect: { kind: 'click', multiplier: 3 },
    requires: { building: 'woodcutter', count: 1 },
  },
  {
    id: 'baskets',
    name: 'Cestas de mimbre',
    description: 'Los recolectores producen el doble.',
    cost: { food: 150, wood: 40 },
    effect: { kind: 'building', building: 'gatherer', multiplier: 2 },
    requires: { building: 'gatherer', count: 5 },
  },
  {
    id: 'axes',
    name: 'Hachas de piedra',
    description: 'Los leñadores producen el doble.',
    cost: { food: 350, wood: 120 },
    effect: { kind: 'building', building: 'woodcutter', multiplier: 2 },
    requires: { building: 'woodcutter', count: 5 },
  },
  {
    id: 'spears',
    name: 'Lanzas con punta de sílex',
    description: 'Los cazadores producen el doble.',
    cost: { food: 1800, wood: 700 },
    effect: { kind: 'building', building: 'hunter', multiplier: 2 },
    requires: { building: 'hunter', count: 5 },
  },
  {
    id: 'sledges',
    name: 'Trineos de arrastre',
    description: 'Los taladores producen el doble.',
    cost: { food: 1500, wood: 500 },
    effect: { kind: 'building', building: 'feller', multiplier: 2 },
    requires: { building: 'feller', count: 5 },
  },
  {
    id: 'cave-paintings',
    name: 'Pinturas rupestres',
    description: 'Las historias unen a la tribu: toda la producción +50 %.',
    cost: { food: 5000, wood: 2500 },
    effect: { kind: 'global', multiplier: 1.5 },
    requires: { total: 'food', amount: 4000 },
  },
  {
    id: 'nets',
    name: 'Redes de fibra',
    description: 'Los pescadores producen el doble.',
    cost: { food: 9000, wood: 4000 },
    effect: { kind: 'building', building: 'fisher', multiplier: 2 },
    requires: { building: 'fisher', count: 5 },
  },
  {
    id: 'rafts',
    name: 'Balsas de troncos atados',
    description: 'Los balseros producen el doble.',
    cost: { food: 9000, wood: 4000 },
    effect: { kind: 'building', building: 'rafter', multiplier: 2 },
    requires: { building: 'rafter', count: 5 },
  },
  // Era 2
  {
    id: 'quern',
    era: 2,
    name: 'Molino de mano',
    description: 'Cada clic suma además el 5 % de tu comida por segundo.',
    cost: { food: 40000, wood: 15000, stone: 3000 },
    effect: { kind: 'clickRate', multiplier: 1, share: 0.05 },
    requires: { building: 'farmer', count: 1 },
  },
  {
    id: 'wedges',
    era: 2,
    name: 'Cuñas y palancas',
    description: 'Los canteros producen el doble.',
    cost: { food: 400000, wood: 250000, stone: 150000 },
    effect: { kind: 'building', building: 'quarrier', multiplier: 2 },
    requires: { building: 'quarrier', count: 5 },
  },
  {
    id: 'sickles',
    era: 2,
    name: 'Hoces de sílex',
    description: 'Los agricultores producen el doble.',
    cost: { food: 400000, wood: 250000, stone: 150000 },
    effect: { kind: 'building', building: 'farmer', multiplier: 2 },
    requires: { building: 'farmer', count: 5 },
  },
  {
    id: 'seedbeds',
    era: 2,
    name: 'Semilleros',
    description: 'Los silvicultores producen el doble.',
    cost: { food: 400000, wood: 250000, stone: 150000 },
    effect: { kind: 'building', building: 'forester', multiplier: 2 },
    requires: { building: 'forester', count: 5 },
  },
  {
    id: 'pottery',
    era: 2,
    name: 'Cerámica',
    description: 'Vasijas para guardar grano y agua: toda la producción +50 %.',
    cost: { food: 2500000, wood: 1500000, stone: 1000000 },
    effect: { kind: 'global', multiplier: 1.5 },
    requires: { total: 'stone', amount: 300000 },
  },
  {
    id: 'corrals',
    era: 2,
    name: 'Corrales de piedra',
    description: 'Los pastores producen el doble.',
    cost: { food: 25000000, wood: 16000000, stone: 10000000 },
    effect: { kind: 'building', building: 'herder', multiplier: 2 },
    requires: { building: 'herder', count: 5 },
  },
  {
    id: 'adzes',
    era: 2,
    name: 'Azuelas pulidas',
    description: 'Los carpinteros producen el doble.',
    cost: { food: 25000000, wood: 16000000, stone: 10000000 },
    effect: { kind: 'building', building: 'carpenter', multiplier: 2 },
    requires: { building: 'carpenter', count: 5 },
  },
  {
    id: 'antler-picks',
    era: 2,
    name: 'Picos de asta',
    description: 'Los mineros de sílex producen el doble.',
    cost: { food: 25000000, wood: 16000000, stone: 10000000 },
    effect: { kind: 'building', building: 'miner', multiplier: 2 },
    requires: { building: 'miner', count: 5 },
  },
  {
    id: 'menhirs',
    era: 2,
    name: 'Círculo de menhires',
    description: 'Un lugar sagrado que une a la aldea: toda la producción +50 %.',
    cost: { food: 80000000, wood: 50000000, stone: 35000000 },
    effect: { kind: 'global', multiplier: 1.5 },
    requires: { total: 'stone', amount: 20000000 },
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
    description: 'Calentar piedras verdes en un horno de barro hasta que suelten metal abre la Edad de los Metales.',
    cost: { food: 300000000, wood: 300000000, stone: 180000000 },
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
