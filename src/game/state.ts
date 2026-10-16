// Estado completo de una partida. Todo lo que se guarda vive aquí.
export const RESOURCES = ['food', 'wood', 'stone'] as const;
export type ResourceId = (typeof RESOURCES)[number];

export const BUILDINGS = [
  'gatherer', 'woodcutter', 'hunter', 'feller', 'fisher', 'rafter',
  'quarrier', 'farmer', 'forester', 'herder', 'carpenter', 'miner',
] as const;
export type BuildingId = (typeof BUILDINGS)[number];

export type Amounts = Record<ResourceId, number>;
export type Cost = Partial<Amounts>;

export interface GameState {
  version: number;
  /** Era en la que está la tribu (1 = Paleolítico, 2 = Neolítico). */
  era: number;
  resources: Amounts;
  totals: Amounts;
  buildings: Record<BuildingId, number>;
  upgrades: string[];
  /** Si ya se pagó la meta de la era actual. */
  goalReached: boolean;
  lastSaved: number;
}

export const SAVE_VERSION = 3;
export const LAST_ERA = 2;

const zeroAmounts = (): Amounts => ({ food: 0, wood: 0, stone: 0 });

export function newGame(now = Date.now()): GameState {
  return {
    version: SAVE_VERSION,
    era: 1,
    resources: zeroAmounts(),
    totals: zeroAmounts(),
    buildings: Object.fromEntries(BUILDINGS.map((b) => [b, 0])) as Record<BuildingId, number>,
    upgrades: [],
    goalReached: false,
    lastSaved: now,
  };
}
