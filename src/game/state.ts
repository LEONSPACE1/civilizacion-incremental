// Estado completo de una partida. Todo lo que se guarda vive aquí.
export const RESOURCES = ['food', 'wood'] as const;
export type ResourceId = (typeof RESOURCES)[number];

export const BUILDINGS = ['gatherer', 'woodcutter', 'hunter', 'feller', 'fisher', 'rafter'] as const;
export type BuildingId = (typeof BUILDINGS)[number];

export type Amounts = Record<ResourceId, number>;
export type Cost = Partial<Amounts>;

export interface GameState {
  version: number;
  resources: Amounts;
  totals: Amounts;
  buildings: Record<BuildingId, number>;
  upgrades: string[];
  goalReached: boolean;
  lastSaved: number;
}

export const SAVE_VERSION = 2;

const zeroAmounts = (): Amounts => ({ food: 0, wood: 0 });

export function newGame(now = Date.now()): GameState {
  return {
    version: SAVE_VERSION,
    resources: zeroAmounts(),
    totals: zeroAmounts(),
    buildings: { gatherer: 0, woodcutter: 0, hunter: 0, feller: 0, fisher: 0, rafter: 0 },
    upgrades: [],
    goalReached: false,
    lastSaved: now,
  };
}
