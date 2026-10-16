// Reglas globales de balance. Los números de cada edificio y mejora viven en content.ts.
export const BASE_CLICK = 1;
// Cada vez que un edificio llega a uno de estos números, su producción se duplica.
export const MILESTONES = [10, 25, 50, 100];
// El progreso fuera de línea se limita para que una ausencia larga no rompa el balance.
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;
