import type { BuildingId, Cost, GameState, ResourceId } from './state';

export interface ResourceDef {
  id: ResourceId;
  name: string;
}

export interface BuildingDef {
  id: BuildingId;
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
  | { kind: 'global'; multiplier: number };

/** Qué hace falta para que aparezca una mejora. */
export type Requirement = { building: BuildingId; count: number } | { total: ResourceId; amount: number };

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  cost: Cost;
  effect: UpgradeEffect;
  requires: Requirement;
  unlocked: (s: GameState) => boolean;
}

export interface GoalDef {
  name: string;
  description: string;
  cost: Cost;
}

export const COST_GROWTH = 1.15;

export const RESOURCE_DEFS: ResourceDef[] = [
  { id: 'food', name: 'Comida' },
  { id: 'wood', name: 'Madera' },
];

// Era 1: Paleolítico. Cada recurso tiene su propia escalera de oficios, uno por nivel,
// con la misma producción por unidad: así ninguno se queda atrás al avanzar.
export const BUILDING_DEFS: BuildingDef[] = [
  {
    id: 'gatherer',
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
    name: 'Balsero',
    plural: 'balseros',
    description: 'Recoge troncos a la deriva y los trae por el lago.',
    baseCost: { food: 500, wood: 300 },
    produces: 'wood',
    rate: 14,
    unlocked: (s) => s.buildings.feller >= 3,
    unlockHint: 'Ten 3 taladores',
  },
];

const UPGRADES: Omit<UpgradeDef, 'unlocked'>[] = [
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
];

export function requirementProgress(s: GameState, r: Requirement): { have: number; need: number } {
  return 'building' in r ? { have: s.buildings[r.building], need: r.count } : { have: s.totals[r.total], need: r.amount };
}

export const UPGRADE_DEFS: UpgradeDef[] = UPGRADES.map((u) => ({
  ...u,
  unlocked: (s: GameState) => {
    const { have, need } = requirementProgress(s, u.requires);
    return have >= need;
  },
}));

export const ERA1_GOAL: GoalDef = {
  name: 'Descubrir la agricultura',
  description: 'Plantar semillas cerca del campamento abre la puerta al Neolítico.',
  cost: { food: 1200000, wood: 1200000 },
};

export const BUILDING_BY_ID = Object.fromEntries(BUILDING_DEFS.map((b) => [b.id, b])) as Record<BuildingId, BuildingDef>;
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADE_DEFS.map((u) => [u.id, u])) as Record<string, UpgradeDef>;
