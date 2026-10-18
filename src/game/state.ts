// Estado completo de una partida. Todo lo que se guarda vive aquí.
export const RESOURCES = ['food', 'wood', 'stone', 'metal', 'iron', 'gold', 'books', 'coal', 'energy'] as const;
export type ResourceId = (typeof RESOURCES)[number];

export const BUILDINGS = [
  'gatherer', 'woodcutter', 'hunter', 'feller', 'fisher', 'rafter',
  'quarrier', 'farmer', 'forester', 'herder', 'carpenter', 'miner',
  'smelter', 'plowman', 'charcoaler', 'mason', 'copperMiner',
  'blacksmith', 'oliveGrower', 'sawyer', 'marbler', 'bronzesmith', 'ironMiner',
  'merchant', 'miller', 'ranger', 'bricklayer', 'bellfounder', 'armorer', 'goldMiner',
  'printer', 'vintner', 'shipwright', 'sculptor', 'clockmaker', 'gunsmith', 'banker', 'bookbinder',
  'coalMiner', 'canner', 'cabinetmaker', 'brickmaker', 'boilermaker', 'puddler', 'stockbroker', 'journalist', 'engineer',
  'electrician', 'agronomist', 'forestEngineer', 'concreter', 'mechanic', 'welder', 'entrepreneur', 'scientist', 'excavator', 'solarTech',
] as const;
export type BuildingId = (typeof BUILDINGS)[number];

export type Amounts = Record<ResourceId, number>;
export type Cost = Partial<Amounts>;

export interface GameState {
  version: number;
  /** Era en la que está la tribu (1 = Paleolítico, 2 = Neolítico, 3 = Edad del Bronce, 4 = Antigüedad, 5 = Edad Media, 6 = Renacimiento,
   *  7 = Revolución Industrial, 8 = Era Moderna). */
  era: number;
  resources: Amounts;
  totals: Amounts;
  buildings: Record<BuildingId, number>;
  upgrades: string[];
  /** Si ya se pagó la meta de la era actual. */
  goalReached: boolean;
  lastSaved: number;
  /** Cuándo dejó el jugador la partida (pestaña oculta), en ms; null mientras juega. */
  awaySince: number | null;
}

export const SAVE_VERSION = 3;
export const LAST_ERA = 8;

const zeroAmounts = (): Amounts => ({ food: 0, wood: 0, stone: 0, metal: 0, iron: 0, gold: 0, books: 0, coal: 0, energy: 0 });

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
    awaySince: null,
  };
}
