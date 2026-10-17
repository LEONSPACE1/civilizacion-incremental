// Reglas globales de balance. Los números de cada edificio y mejora viven en content.ts.
export const BASE_CLICK = 1;
// Cada vez que un oficio llega a uno de estos números, su producción se duplica.
export const MILESTONES = [10, 25, 50];
// Tope de personas por oficio. Coincide con el último hito: al llegar, el oficio está completo
// y el avance pasa a las mejoras y a los oficios de la era siguiente.
export const BUILDING_CAP = 50;
// Fuera del juego (pestaña oculta o cerrada) la tribu solo trabaja los primeros 10 minutos:
// así jugar activo siempre compensa más que dejar la partida abierta o volver horas después.
export const MAX_OFFLINE_SECONDS = 10 * 60;
