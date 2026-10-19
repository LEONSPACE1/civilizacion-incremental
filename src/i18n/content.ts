// Traducción del contenido del juego (recursos, eras, oficios, mejoras y metas). Los textos en
// español están en game/content.ts; al elegir otro idioma se sustituyen en los mismos objetos al
// arrancar, antes de construir la interfaz.
import { BUILDING_DEFS, ERA_DEFS, GOALS, RESOURCE_DEFS, UPGRADE_DEFS } from '../game/content';

export interface ContentLocale {
  resources: Record<string, string>;
  eras: Record<string, { name: string; gatherLabel: string; enter: string; intro: string }>;
  buildings: Record<string, { name: string; plural: string; description: string; unlockHint: string }>;
  upgrades: Record<string, { name: string; description: string }>;
  goals: Record<string, { name: string; action: string; description: string }>;
}

/** Los textos en español, con la forma que tiene que tener cada traducción. */
export function extractContent(): ContentLocale {
  return {
    resources: Object.fromEntries(RESOURCE_DEFS.map((r) => [r.id, r.name])),
    eras: Object.fromEntries(ERA_DEFS.map((e) => [e.n, { name: e.name, gatherLabel: e.gatherLabel, enter: e.enter, intro: e.intro }])),
    buildings: Object.fromEntries(BUILDING_DEFS.map((b) => [b.id, { name: b.name, plural: b.plural, description: b.description, unlockHint: b.unlockHint }])),
    upgrades: Object.fromEntries(UPGRADE_DEFS.map((u) => [u.id, { name: u.name, description: u.description }])),
    goals: Object.fromEntries(Object.entries(GOALS).map(([n, g]) => [n, { name: g.name, action: g.action, description: g.description }])),
  };
}

/** Pone los textos traducidos en el contenido. Lo que falte en la traducción se queda en español. */
export function applyContent(loc: Partial<ContentLocale>): void {
  for (const r of RESOURCE_DEFS) r.name = loc.resources?.[r.id] ?? r.name;
  for (const e of ERA_DEFS) Object.assign(e, loc.eras?.[e.n]);
  for (const b of BUILDING_DEFS) Object.assign(b, loc.buildings?.[b.id]);
  for (const u of UPGRADE_DEFS) Object.assign(u, loc.upgrades?.[u.id]);
  for (const [n, g] of Object.entries(GOALS)) Object.assign(g, loc.goals?.[n]);
}
