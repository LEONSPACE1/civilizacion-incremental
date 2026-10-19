// Idiomas del juego. El español es el idioma de origen: sus textos de la interfaz están en es.ts y los
// del contenido (oficios, mejoras, metas…) en content.ts. Cada otro idioma vive en locales/<id>.ts con
// las mismas claves y se carga solo si el jugador lo elige. Cambiar de idioma recarga la página.
import ES from './es';

export const LANGS = [
  { id: 'es', name: 'Español' },
  { id: 'en', name: 'English' },
  { id: 'zh', name: '中文' },
  { id: 'fr', name: 'Français' },
  { id: 'pt', name: 'Português' },
] as const;
export type Lang = (typeof LANGS)[number]['id'];
export type Dict = Record<keyof typeof ES, string>;

export const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.id === v);

let lang: Lang = 'es';
let dict: Partial<Dict> = ES;

export const getLang = (): Lang => lang;

/** Texto de la interfaz en el idioma elegido. `{x}` se sustituye por `params.x`. */
export function t(key: keyof typeof ES, params?: Record<string, string | number>): string {
  let text = dict[key] ?? ES[key] ?? key;
  if (params) text = text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
  return text;
}

/** Idioma del navegador si el juego lo tiene; si no, español. */
export function browserLang(): Lang {
  for (const l of navigator.languages ?? [navigator.language]) {
    const id = l?.slice(0, 2).toLowerCase();
    if (isLang(id)) return id;
  }
  return 'es';
}

/** Pone el diccionario de un idioma ya cargado (lo usan main.ts y los tests). */
export function setDict(id: Lang, d: Partial<Dict>): void {
  lang = id;
  dict = d;
}
