import type { BuildingId, Cost, GameState, ResourceId } from './state';

export interface ResourceDef {
  id: ResourceId;
  name: string;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
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

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  cost: Cost;
  effect: UpgradeEffect;
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

// Era 1: Paleolítico. Cada edificio se desbloquea cuando el anterior ya rinde.
export const BUILDING_DEFS: BuildingDef[] = [
  {
    id: 'gatherer',
    name: 'Recolector',
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
    description: 'Recoge ramas y troncos caídos del bosque.',
    baseCost: { food: 20 },
    produces: 'wood',
    rate: 0.4,
    unlocked: (s) => s.totals.food >= 15,
    unlockHint: 'Reúne 15 de comida',
  },
  {
    id: 'hunter',
    name: 'Cazador',
    description: 'Sale en grupo a cazar con lanzas de madera.',
    baseCost: { food: 90, wood: 30 },
    produces: 'food',
    rate: 3,
    unlocked: (s) => s.buildings.woodcutter >= 2,
    unlockHint: 'Ten 2 leñadores',
  },
  {
    id: 'fisher',
    name: 'Pescador',
    description: 'Pesca en el lago con trampas de ramas.',
    baseCost: { food: 600, wood: 250 },
    produces: 'food',
    rate: 14,
    unlocked: (s) => s.buildings.hunter >= 3,
    unlockHint: 'Ten 3 cazadores',
  },
];

export const UPGRADE_DEFS: UpgradeDef[] = [
  {
    id: 'fire',
    name: 'Dominar el fuego',
    description: 'Cada clic recolecta el triple.',
    cost: { food: 40, wood: 10 },
    effect: { kind: 'click', multiplier: 3 },
    unlocked: (s) => s.buildings.woodcutter >= 1,
  },
  {
    id: 'baskets',
    name: 'Cestas de mimbre',
    description: 'Los recolectores producen el doble.',
    cost: { food: 150, wood: 40 },
    effect: { kind: 'building', building: 'gatherer', multiplier: 2 },
    unlocked: (s) => s.buildings.gatherer >= 5,
  },
  {
    id: 'axes',
    name: 'Hachas de piedra',
    description: 'Los leñadores producen el doble.',
    cost: { food: 350, wood: 120 },
    effect: { kind: 'building', building: 'woodcutter', multiplier: 2 },
    unlocked: (s) => s.buildings.woodcutter >= 5,
  },
  {
    id: 'spears',
    name: 'Lanzas con punta de sílex',
    description: 'Los cazadores producen el doble.',
    cost: { food: 1800, wood: 700 },
    effect: { kind: 'building', building: 'hunter', multiplier: 2 },
    unlocked: (s) => s.buildings.hunter >= 5,
  },
  {
    id: 'cave-paintings',
    name: 'Pinturas rupestres',
    description: 'Las historias unen a la tribu: toda la producción +50 %.',
    cost: { food: 5000, wood: 2500 },
    effect: { kind: 'global', multiplier: 1.5 },
    unlocked: (s) => s.totals.food >= 4000,
  },
  {
    id: 'nets',
    name: 'Redes de fibra',
    description: 'Los pescadores producen el doble.',
    cost: { food: 9000, wood: 4000 },
    effect: { kind: 'building', building: 'fisher', multiplier: 2 },
    unlocked: (s) => s.buildings.fisher >= 5,
  },
];

export const ERA1_GOAL: GoalDef = {
  name: 'Descubrir la agricultura',
  description: 'Plantar semillas cerca del campamento abre la puerta al Neolítico.',
  cost: { food: 150000, wood: 60000 },
};

export const BUILDING_BY_ID = Object.fromEntries(BUILDING_DEFS.map((b) => [b.id, b])) as Record<BuildingId, BuildingDef>;
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADE_DEFS.map((u) => [u.id, u])) as Record<string, UpgradeDef>;
