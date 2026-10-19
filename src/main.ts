import './style.css';
import { BUILDING_DEFS, ERA_BY_N, RESOURCE_DEFS, UPGRADE_DEFS, type UpgradeDef } from './game/content';
import {
  advanceEra,
  applyOfflineProgress,
  applyTradition,
  autoHire,
  atCap,
  bulkCost,
  BUY_AMOUNTS,
  buyBuildings,
  buyCount,
  buyGoal,
  buyUpgrade,
  canAdvanceEra,
  canAfford,
  clickAmount,
  creditedSeconds,
  currentGoal,
  gather,
  milestonesReached,
  nextMilestone,
  offlineLimit,
  population,
  ratePerSecond,
  rebirth,
  tick,
  unitRate,
  upgradeAvailable,
  type BuyAmount,
} from './game/logic';
import { BUILDING_CAP, MILESTONES } from './game/balance';
import {
  buyLegacy,
  canBuyLegacy,
  canRebirth,
  goalsDone,
  GUILD_DISCOUNT,
  HANDS_MULTIPLIER,
  LEGACY_DEFS,
  legacyUnlocked,
  maxLevel,
  MEMORY_BONUS,
  nextLegacyCost,
  PATIENCE_MINUTES,
  REBIRTH_MIN_GOALS,
  TRADITION_PEOPLE,
  wisdomForRun,
  type LegacyId,
} from './game/legacy';
import { allAchieved, checkAchievements } from './game/achievements';
import { deleteSave, exportFileName, exportFileText, importFileText, loadGame, saveGame } from './game/save';
import { LAST_ERA, newGame, RESOURCES, type Cost, type GameState } from './game/state';
import { formatDuration, formatNumber, getNumberFormat, NUMBER_FORMATS, setNumberFormat, setNumberLocale, type NumberFormat } from './game/format';
import { BUILDING_ICONS, ERA_ICONS, ICONS, RESOURCE_ICONS, UPGRADE_ICONS } from './ui/icons';
import { createUpgradeTree } from './ui/tree';
import { createTrophies, achievementText } from './ui/trophies';
import { createCoach, dueTutorial, settleMigrated, TUTORIALS } from './ui/tutorial';
import { createEndings } from './ui/endings';
import { createVillage } from './scene/village';
import { DEFAULT_FPS, DEFAULT_QUALITY, FPS_OPTIONS, isFpsLimit, isQualityLevel, type FpsLimit, type QualityLevel } from './scene/quality';
import { Sound } from './audio/sound';
import { browserLang, getLang, isLang, LANGS, setDict, t, type Dict, type Lang } from './i18n/i18n';
import { applyContent, type ContentLocale } from './i18n/content';
import type ES from './i18n/es';

type Key = keyof typeof ES;

const TICK_MS = 100;
const AUTOSAVE_MS = 10_000;
const SETTINGS_KEY = 'civilizacion-incremental:settings';

// Cada idioma se descarga solo si el jugador lo elige.
const LOCALES: Record<Exclude<Lang, 'es'>, () => Promise<{ ui: Partial<Dict>; content: Partial<ContentLocale> }>> = {
  en: () => import('./i18n/locales/en'),
  zh: () => import('./i18n/locales/zh'),
  fr: () => import('./i18n/locales/fr'),
  pt: () => import('./i18n/locales/pt'),
};

// Safari de iOS ignora user-scalable=no: se bloquean a mano el pellizco y el doble toque.
for (const type of ['gesturestart', 'gesturechange', 'dblclick']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// La interfaz se redibuja 10 veces por segundo, pero casi nada cambia entre una vez y la
// siguiente. Escribir en la página aunque sea el mismo texto obliga al navegador a recalcular
// estilos y a repintar, y eso gasta batería. Estas funciones solo tocan la página si hay cambios.
const lastWrite = new WeakMap<Element, string>();
function setText(e: HTMLElement, text: string): void {
  if (lastWrite.get(e) === text) return;
  lastWrite.set(e, text);
  e.textContent = text;
}
function setHtml(e: Element, html: string): void {
  if (lastWrite.get(e) === html) return;
  lastWrite.set(e, html);
  e.innerHTML = html;
}
function setWidth(e: HTMLElement, width: string): void {
  if (e.style.width !== width) e.style.width = width;
}
function setHidden(e: HTMLElement, hidden: boolean): void {
  if (e.hidden !== hidden) e.hidden = hidden;
}
function setDisabled(e: HTMLButtonElement, disabled: boolean): void {
  if (e.disabled !== disabled) e.disabled = disabled;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

// ---------- Pantalla de carga ----------
// Se ve desde el primer instante (index.html). Avanza mientras llegan el idioma, las letras y la
// aldea, y se quita cuando todo está dibujado en pantalla.
const loader = $('loader');
function loaderStep(pct: number, text?: string): void {
  $('loader-fill').style.width = `${pct}%`;
  if (text) $('loader-step').textContent = text;
}

// ---------- Ajustes guardados ----------
type Tab = 'jobs' | 'upgrades' | 'goal';
const TABS: Tab[] = ['jobs', 'upgrades', 'goal'];
const graphics: { quality: QualityLevel; fps: FpsLimit } = { quality: DEFAULT_QUALITY, fps: DEFAULT_FPS };
let panelTab: Tab = 'jobs';
let buyAmount: BuyAmount = 1;
let lang: Lang = browserLang();
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  if (NUMBER_FORMATS.some((f) => f.id === saved.numberFormat)) setNumberFormat(saved.numberFormat);
  if (isQualityLevel(saved.quality)) graphics.quality = saved.quality;
  if (isFpsLimit(saved.fps)) graphics.fps = saved.fps;
  if (TABS.includes(saved.tab)) panelTab = saved.tab;
  if (BUY_AMOUNTS.includes(saved.buyAmount)) buyAmount = saved.buyAmount;
  if (isLang(saved.lang)) lang = saved.lang;
} catch {
  // Ajustes ilegibles: se usan los de siempre.
}
function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ numberFormat: getNumberFormat(), ...graphics, tab: panelTab, buyAmount, lang }));
  } catch {
    // Sin almacenamiento: los ajustes duran solo esta sesión.
  }
}

// ---------- Idioma ----------
loaderStep(12);
if (lang !== 'es') {
  try {
    const locale = await LOCALES[lang]();
    setDict(lang, locale.ui);
    applyContent(locale.content);
  } catch {
    // Sin conexión para bajar el idioma: el juego sigue en español.
    lang = 'es';
  }
}
document.documentElement.lang = getLang();
document.title = t('game.title');
setNumberLocale({
  decimal: t('num.decimal'),
  group: t('num.group'),
  words: t('num.words') ? [['', ''], ...t('num.words').split(';').map((w) => w.split('|') as [string, string])] : [],
  units: { h: t('num.h'), min: t('num.min'), s: t('num.s') },
});
// Textos fijos de la página: los elementos llevan la clave en data-i18n (texto) o data-i18n-label (aria-label y title).
for (const e of document.querySelectorAll<HTMLElement>('[data-i18n]')) e.textContent = t(e.dataset.i18n as Key);
for (const e of document.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
  const text = t(e.dataset.i18nLabel as Key);
  e.setAttribute('aria-label', text);
  if (e.hasAttribute('title')) e.title = text;
}
for (const e of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) e.title = t(e.dataset.i18nTitle as Key);
const RESOURCE_NAME = Object.fromEntries(RESOURCE_DEFS.map((r) => [r.id, r.name.toLowerCase()])) as Record<string, string>;

// ---------- Letras y aldea ----------
loaderStep(30, t('loader.fonts'));
await Promise.race([document.fonts.ready, delay(4000)]);
loaderStep(50, t('loader.village'));
await nextFrame();

const loadedGame = loadGame();
/** Primera vez en el juego: no hay partida guardada. Sale la pantalla de inicio. */
const firstTime = loadedGame === null;
let state: GameState = loadedGame ?? newGame();
settleMigrated(state);
// Cuánto tiempo estuvo fuera el jugador (para el aviso), antes de que se apliquen sus minutos.
const offlineSeconds = (Date.now() - (state.awaySince ?? state.lastSaved)) / 1000;
applyOfflineProgress(state, Date.now());
const village = createVillage($('scene'));
document.querySelector('.scene-canvas')?.setAttribute('aria-label', t('scene.label'));
village.setGraphics(graphics.quality, graphics.fps);
village.update(state);
loaderStep(80, t('loader.people'));
const sound = new Sound();

// ---------- Sonido ----------
// Los navegadores solo permiten audio tras un gesto del jugador.
const unlockAudio = () => sound.unlock();
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
const muteButton = $<HTMLButtonElement>('mute');
muteButton.addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  renderSettings();
});

// ---------- Ajustes ----------
const settingsDialog = $<HTMLDialogElement>('settings');
$('open-settings').innerHTML = ICONS.gear;
settingsDialog.querySelector('.close')!.innerHTML = ICONS.close;
$('open-settings').addEventListener('click', () => {
  renderSettings();
  settingsDialog.showModal();
});
// Clic fuera de la ventana la cierra.
settingsDialog.addEventListener('click', (e) => {
  if (e.target === settingsDialog) settingsDialog.close();
});

/** Cambiar de idioma guarda la partida y recarga: así todos los textos salen ya en el idioma nuevo. */
function changeLanguage(next: Lang): void {
  if (next === lang) return;
  lang = next;
  saveSettings();
  if (!firstTime || state.profile.tutorials.length) save();
  window.location.reload();
}
function languageButtons(container: HTMLElement): void {
  for (const l of LANGS) {
    const b = el('button', 'choice lang');
    b.type = 'button';
    b.lang = l.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(l.id === lang));
    b.innerHTML = `<span class="choice-name">${l.name}</span>`;
    b.addEventListener('click', () => changeLanguage(l.id));
    container.append(b);
  }
}
languageButtons($('lang-options'));

const sliders = [
  { id: 'volume', get: () => sound.volume, set: (v: number) => sound.setVolume(v) },
  { id: 'effects', get: () => sound.effects, set: (v: number) => sound.setEffects(v) },
  { id: 'ambience', get: () => sound.ambienceVolume, set: (v: number) => sound.setAmbience(v) },
  { id: 'music', get: () => sound.musicVolume, set: (v: number) => sound.setMusic(v) },
].map((s) => {
  const input = $<HTMLInputElement>(`set-${s.id}`);
  const out = $<HTMLOutputElement>(`out-${s.id}`);
  input.addEventListener('input', () => {
    s.set(Number(input.value));
    if (sound.muted) sound.setMuted(false);
    renderSettings();
  });
  return { ...s, input, out };
});
const mutedBox = $<HTMLInputElement>('set-muted');
mutedBox.addEventListener('change', () => {
  sound.setMuted(mutedBox.checked);
  renderSettings();
});

const formatButtons = NUMBER_FORMATS.map((f) => {
  const b = el('button', 'choice');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.innerHTML = `<span class="choice-name">${t(`numfmt.${f.id}` as Key)}</span><span class="choice-example">${formatNumber(1_234_567, f.id)}</span>`;
  b.addEventListener('click', () => {
    setNumberFormat(f.id);
    saveSettings();
    renderSettings();
    render();
  });
  $('number-formats').append(b);
  return { id: f.id as NumberFormat, b };
});

// Gráficos: un control deslizante de cinco niveles, del máximo rendimiento a la máxima calidad, y el tope de fps.
const qualityInput = $<HTMLInputElement>('set-quality');
qualityInput.addEventListener('input', () => {
  graphics.quality = Number(qualityInput.value) as QualityLevel;
  village.setGraphics(graphics.quality, graphics.fps);
  saveSettings();
  renderSettings();
});
const fpsButtons = FPS_OPTIONS.map((o) => {
  const b = el('button', 'choice');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  const name = o.id === 'auto' ? t('fps.auto') : o.id === 'max' ? t('fps.max') : o.name;
  const hint = o.id === 'auto' ? t('fps.autoHint') : o.id === 'max' ? t('fps.maxHint') : 'fps';
  b.innerHTML = `<span class="choice-name">${name}</span><span class="choice-example">${hint}</span>`;
  b.addEventListener('click', () => {
    graphics.fps = o.id;
    village.setGraphics(graphics.quality, graphics.fps);
    saveSettings();
    renderSettings();
  });
  $('fps-options').append(b);
  return { id: o.id, b };
});

const pct = (v: number) => t('num.pct', { v });

function renderSettings(): void {
  muteButton.innerHTML = sound.muted ? ICONS.soundOff : ICONS.soundOn;
  const label = sound.muted ? t('sound.on') : t('sound.off');
  muteButton.setAttribute('aria-label', label);
  muteButton.title = label;
  muteButton.classList.toggle('off', sound.muted);
  mutedBox.checked = sound.muted;
  for (const s of sliders) {
    s.input.value = String(s.get());
    s.out.textContent = pct(Math.round(s.get() * 100));
  }
  for (const f of formatButtons) f.b.setAttribute('aria-checked', String(f.id === getNumberFormat()));
  const name = t(`quality.${graphics.quality}.name` as Key);
  qualityInput.value = String(graphics.quality);
  qualityInput.setAttribute('aria-valuetext', name);
  $('quality-name').textContent = `${graphics.quality}/5 · ${name}.`;
  $('quality-hint').textContent = t(`quality.${graphics.quality}.hint` as Key);
  for (const f of fpsButtons) f.b.setAttribute('aria-checked', String(f.id === graphics.fps));
}
renderSettings();

// ---------- Era: estilo de los paneles, fondo, botón de recolectar y cabecera ----------
// Cada era tiene su propio estilo (data-era en <body>); al cambiar de era cambia todo a la vez.
function applyEra(): void {
  const era = ERA_BY_N[state.era];
  if (document.body.dataset.era === String(era.n)) return;
  document.body.dataset.era = String(era.n);
  (document.querySelector('.header .era') as HTMLElement).textContent = t('era.label', { n: era.n, name: era.name });
  (document.querySelector('.gather-icon') as HTMLElement).innerHTML = ICONS[ERA_ICONS[era.n].gather];
  (document.querySelector('#tabbtn-goal .tab-icon') as HTMLElement).innerHTML = ICONS[ERA_ICONS[era.n].goal];
  $('gather-label').textContent = era.gatherLabel;
  sound.setEra(era.n);
}

/** Cortina con el nombre de la nueva era: el estilo cambia mientras cubre la pantalla. */
function playEraTransition(): void {
  const era = ERA_BY_N[state.era];
  const curtain = $('era-curtain');
  curtain.dataset.era = String(era.n);
  curtain.querySelector('.era-kicker')!.textContent = t('era.kicker', { n: era.n });
  curtain.querySelector('h2')!.textContent = era.name;
  curtain.querySelector('.era-intro')!.textContent = era.intro;
  curtain.hidden = false;
  void curtain.offsetWidth;
  curtain.classList.add('show');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => {
    applyEra();
    village.update(state);
    render();
    // Era nueva: sus oficios abiertos arriba y las eras anteriores plegadas.
    folded.jobs.clear();
    folded.upgrades.clear();
    showDone.clear();
    showTab('jobs');
    render();
  }, reduce ? 0 : 750);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    curtain.classList.remove('show');
    window.setTimeout(() => (curtain.hidden = true), reduce ? 0 : 900);
  };
  window.setTimeout(close, reduce ? 2500 : 3600);
  curtain.addEventListener('click', close, { once: true });
}

// ---------- Avisos ----------
let toastTimer: number | undefined;
function showToast(message: string): void {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 4000);
}
function floatText(text: string, x: number, y: number): void {
  const f = el('span', 'float', text);
  f.style.left = `${x}px`;
  f.style.top = `${y}px`;
  document.body.append(f);
  f.addEventListener('animationend', () => f.remove());
}

function costHtml(cost: Cost): string {
  return RESOURCES.filter((r) => cost[r])
    .map((r) => `<span class="${state.resources[r] >= (cost[r] ?? 0) ? 'ok' : 'no'}">${formatNumber(cost[r]!)} ${RESOURCE_NAME[r]}</span>`)
    .join(' · ');
}

// ---------- Indicadores de recursos ----------
const hud = $('hud');
const chips = RESOURCE_DEFS.map((r) => {
  const chip = el('div', 'chip');
  chip.title = r.name;
  chip.innerHTML = `<span class="chip-icon">${ICONS[RESOURCE_ICONS[r.id]]}</span><span class="chip-name">${r.name}</span> <b></b> <small></small>`;
  hud.append(chip);
  return { id: r.id, chip, value: chip.querySelector('b')!, rate: chip.querySelector('small')! };
});
const populationChip = el('div', 'chip');
populationChip.title = t('hud.population');
populationChip.innerHTML = `<span class="chip-icon">${ICONS.person}</span><span class="chip-name">${t('hud.population')}</span> <b></b>`;
hud.append(populationChip);
const populationValue = populationChip.querySelector('b')!;

// ---------- Paneles: una pestaña a la vez, eras plegables y lo completado oculto ----------
// Cada panel agrupa sus tarjetas por era. La era actual va abierta y arriba; las anteriores se
// pliegan en una línea con su resumen. Dentro de cada era, lo terminado (oficios al tope y mejoras
// obtenidas) se esconde tras «Ver…» para que la lista no crezca sin fin con las eras.
type ListKind = 'jobs' | 'upgrades';
interface EraGroup {
  era: number;
  root: HTMLElement;
  head: HTMLButtonElement;
  summary: HTMLElement;
  body: HTMLElement;
  active: HTMLElement;
  doneToggle: HTMLButtonElement;
  done: HTMLElement;
}
// Lo que el jugador abre o cierra a mano; si no ha tocado una era, solo la actual va abierta.
const folded: Record<ListKind, Map<number, boolean>> = { jobs: new Map(), upgrades: new Map() };
const showDone = new Set<string>();
const isOpen = (kind: ListKind, era: number) => folded[kind].get(era) ?? era === state.era;
function setAttr(e: Element, name: string, value: string): void {
  if (e.getAttribute(name) !== value) e.setAttribute(name, value);
}

function createEraGroups(kind: ListKind, container: HTMLElement, eras: number[]): Record<number, EraGroup> {
  return Object.fromEntries(
    [...new Set(eras)].map((n) => {
      const root = el('div', 'era-group');
      root.dataset.era = String(n);
      const head = el('button', 'era-head');
      head.type = 'button';
      head.innerHTML = `<span class="chev" aria-hidden="true">${ICONS.chevron}</span><span class="era-name">${ERA_BY_N[n].name}</span><span class="era-sum"></span>`;
      const body = el('div', 'era-body');
      const active = el('div', 'list');
      const doneToggle = el('button', 'done-toggle');
      doneToggle.type = 'button';
      const done = el('div', 'list done-list');
      body.append(active, doneToggle, done);
      root.append(head, body);
      container.append(root);
      head.addEventListener('click', () => {
        folded[kind].set(n, !isOpen(kind, n));
        render();
      });
      doneToggle.addEventListener('click', () => {
        const key = `${kind}-${n}`;
        if (!showDone.delete(key)) showDone.add(key);
        render();
      });
      return [n, { era: n, root, head, summary: head.querySelector('.era-sum') as HTMLElement, body, active, doneToggle, done }];
    }),
  ) as Record<number, EraGroup>;
}

function renderEraGroup(kind: ListKind, g: EraGroup, counts: { active: number; done: number }, summary: string, complete: boolean, doneText: string): void {
  setHidden(g.root, g.era > state.era || counts.active + counts.done === 0);
  // La era actual arriba y las anteriores debajo, de la más reciente a la más antigua.
  if (g.root.style.order !== String(state.era - g.era)) g.root.style.order = String(state.era - g.era);
  const open = isOpen(kind, g.era);
  g.root.classList.toggle('open', open);
  g.root.classList.toggle('complete', complete);
  setAttr(g.head, 'aria-expanded', String(open));
  setHidden(g.body, !open);
  setText(g.summary, summary);
  // Si ya no queda nada en curso, lo completado se ve directamente al abrir la era.
  const doneOpen = counts.active === 0 || showDone.has(`${kind}-${g.era}`);
  setHidden(g.active, counts.active === 0);
  setHidden(g.doneToggle, counts.active === 0 || counts.done === 0);
  setText(g.doneToggle, t(doneOpen ? 'list.hide' : 'list.show', { what: doneText }));
  setAttr(g.doneToggle, 'aria-expanded', String(doneOpen));
  setHidden(g.done, !doneOpen || counts.done === 0);
}

/** Pone la tarjeta en la lista de su era que toca (en curso o completada) sin moverla si ya está. */
function place(item: HTMLElement, list: HTMLElement): void {
  if (item.parentElement !== list) list.append(item);
}

/** Tarjeta: tocarla compra. Las que están en curso enseñan todo su detalle; las completadas quedan
 *  en una línea y la flecha de la derecha lo despliega. */
function createItem(card: HTMLButtonElement, index: number): HTMLElement {
  const item = el('div', 'item');
  item.style.order = String(index);
  const more = el('button', 'more');
  more.type = 'button';
  more.innerHTML = ICONS.chevron;
  more.setAttribute('aria-label', t('list.details'));
  more.setAttribute('aria-expanded', 'false');
  more.addEventListener('click', () => {
    const open = item.classList.toggle('open');
    more.setAttribute('aria-expanded', String(open));
    more.setAttribute('aria-label', open ? t('list.hideDetails') : t('list.details'));
  });
  item.append(card, more);
  return item;
}

// Precio en una línea: como cada coste pide lo mismo de cada recurso, basta la cifra y los iconos.
function priceHtml(cost: Cost, count = 1): string {
  const rs = RESOURCES.filter((r) => cost[r]);
  const amount = Math.max(...rs.map((r) => cost[r]!));
  const icons = rs
    .map((r) => `<span class="${state.resources[r] >= cost[r]! ? 'ok' : 'no'}" title="${RESOURCE_NAME[r]}">${ICONS[RESOURCE_ICONS[r]]}</span>`)
    .join('');
  const qty = count > 1 ? `<span class="qty">×${count}</span>` : '';
  return `${qty}<span class="${canAfford(state, cost) ? 'ok' : 'no'}">${formatNumber(amount)}</span><span class="price-icons">${icons}</span>`;
}

// ---------- Cantidad a contratar: x1, x5, x10 o el máximo ----------
const buyAmountButtons = BUY_AMOUNTS.map((a) => {
  const b = el('button', 'amount', a === 'max' ? t('jobs.max') : `x${a}`);
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.addEventListener('click', () => {
    buyAmount = a;
    saveSettings();
    renderBuyAmount();
    render();
  });
  $('buy-amount').append(b);
  return { a, b };
});
function renderBuyAmount(): void {
  for (const { a, b } of buyAmountButtons) setAttr(b, 'aria-checked', String(a === buyAmount));
}
renderBuyAmount();

// ---------- Edificios ----------
$('cap-note').textContent = t('jobs.capNote', { cap: BUILDING_CAP, x: 2 ** MILESTONES.length });
const buildingGroups = createEraGroups('jobs', $('buildings'), BUILDING_DEFS.map((b) => b.era));
const buildingCards = BUILDING_DEFS.map((def, index) => {
  const card = el('button', 'card');
  card.innerHTML =
    `<span class="icon"></span><span class="name"></span><span class="price"></span><span class="count"></span><span class="ms-bar"><span></span></span>` +
    `<span class="details"><span class="desc"></span><span class="meta"></span><span class="ms-text"></span><span class="cost"></span></span>`;
  const item = createItem(card, index);
  card.addEventListener('click', () => {
    const before = milestonesReached(state.buildings[def.id]);
    if (buyBuildings(state, def.id, buyCount(state, def.id, buyAmount))) {
      village.update(state);
      village.celebrate();
      if (atCap(state, def.id)) {
        // Último hito y tope a la vez: el oficio queda completo.
        sound.upgrade();
        showToast(t('jobs.fullToast', { cap: BUILDING_CAP, plural: def.plural }));
        card.classList.remove('milestone-hit');
        void card.offsetWidth;
        card.classList.add('milestone-hit');
      } else if (milestonesReached(state.buildings[def.id]) > before) {
        // Hito alcanzado: la barra se llena y la producción de este oficio se duplica.
        sound.upgrade();
        showToast(t('jobs.milestoneToast', { n: state.buildings[def.id], plural: def.plural }));
        card.classList.remove('milestone-hit');
        void card.offsetWidth;
        card.classList.add('milestone-hit');
      } else sound.buy();
      render();
    }
  });
  buildingGroups[def.era].active.append(item);
  const q = (s: string) => card.querySelector(s) as HTMLElement;
  return {
    def,
    item,
    card,
    icon: q('.icon'),
    name: q('.name'),
    price: q('.price'),
    count: q('.count'),
    desc: q('.desc'),
    meta: q('.meta'),
    msBar: q('.ms-bar'),
    msText: q('.ms-text'),
    msFill: q('.ms-bar span'),
    cost: q('.cost'),
  };
});

// ---------- Mejoras ----------
function purchaseUpgrade(def: UpgradeDef): void {
  if (!buyUpgrade(state, def.id)) return;
  sound.upgrade();
  showToast(t('upgrades.boughtToast', { name: def.name }));
  village.update(state);
  village.celebrate();
  render();
}
const upgradeGroups = createEraGroups('upgrades', $('upgrades'), UPGRADE_DEFS.map((u) => u.era));
const upgradeCards = UPGRADE_DEFS.map((def, index) => {
  const card = el('button', 'card upgrade');
  card.innerHTML =
    `<span class="icon">${ICONS[UPGRADE_ICONS[def.id] ?? 'fire']}</span><span class="name">${def.name}</span><span class="price"></span>` +
    `<span class="details"><span class="desc">${def.description}</span><span class="cost"></span></span>`;
  card.addEventListener('click', () => purchaseUpgrade(def));
  const item = createItem(card, index);
  upgradeGroups[def.era].active.append(item);
  return { def, item, card, price: card.querySelector('.price') as HTMLElement, cost: card.querySelector('.cost') as HTMLElement };
});

// ---------- Árbol de mejoras ----------
const tree = createUpgradeTree({ getState: () => state, costHtml, buyUpgrade: purchaseUpgrade });
(document.querySelector('#open-tree .mini-icon') as HTMLElement).innerHTML = ICONS.tree;
$('open-tree').addEventListener('click', () => tree.open());

// ---------- Logros ----------
const trophies = createTrophies(() => state);
$('open-achievements').innerHTML = ICONS.trophy;
$('open-achievements').addEventListener('click', () => trophies.open());
// Aviso de logro: una medalla arriba que no tapa los demás avisos. Si llegan varios, van en cola.
const achToast = el('div', 'ach-toast');
achToast.setAttribute('role', 'status');
document.body.append(achToast);
const achQueue: string[] = [];
let achShowing = false;
function nextAchToast(): void {
  const text = achQueue.shift();
  if (!text) {
    achShowing = false;
    return;
  }
  achShowing = true;
  achToast.innerHTML = `<span class="ach-toast-icon" aria-hidden="true">${ICONS.trophy}</span><span><small>${t('ach.unlocked')}</small><b></b></span>`;
  achToast.querySelector('b')!.textContent = text;
  achToast.classList.add('visible');
  window.setTimeout(() => {
    achToast.classList.remove('visible');
    window.setTimeout(nextAchToast, 400);
  }, 3200);
}
function updateAchievements(): void {
  const fresh = checkAchievements(state);
  if (!fresh.length) return;
  for (const a of fresh) achQueue.push(achievementText(a).name);
  sound.goal();
  if (!achShowing) nextAchToast();
  trophies.update();
}

// ---------- Legado: renacer y mejoras permanentes ----------
// Se descubre al «Inventar la escritura» (meta de la era 3): desde ahí la meta muestra cuánta
// Sabiduría daría renacer, y la cabecera tiene un botón para abrir la ventana del Legado.
const legacyDialog = $<HTMLDialogElement>('legacy');
const legacyButton = $<HTMLButtonElement>('open-legacy');
legacyButton.innerHTML = ICONS.scroll;
legacyDialog.querySelector('.close')!.innerHTML = ICONS.close;
legacyDialog.querySelector('.close')!.addEventListener('click', () => legacyDialog.close());
legacyDialog.addEventListener('click', (e) => {
  if (e.target === legacyDialog) legacyDialog.close();
});
(legacyDialog.querySelector('.wisdom-icon') as HTMLElement).innerHTML = ICONS.scroll;
function openLegacy(): void {
  renderLegacy();
  legacyDialog.showModal();
}
legacyButton.addEventListener('click', openLegacy);

const legacyBox = el('div', 'legacy-box');
legacyBox.innerHTML = `<p class="legacy-line"></p><button type="button" class="mini-btn legacy-open"><span class="mini-icon" aria-hidden="true">${ICONS.scroll}</span>${t('legacy.open')}</button>`;
legacyBox.querySelector('.legacy-open')!.addEventListener('click', openLegacy);
const legacyLine = legacyBox.querySelector('.legacy-line') as HTMLElement;
function renderLegacyBox(): void {
  const unlocked = legacyUnlocked(state);
  setHidden(legacyBox, !unlocked);
  setHidden(legacyButton, !unlocked);
  if (!unlocked) return;
  setText(legacyLine, canRebirth(state)
    ? t('legacy.boxCan', { gain: wisdomForRun(state), have: state.legacy.wisdom })
    : t('legacy.boxCannot', { have: state.legacy.wisdom, era: REBIRTH_MIN_GOALS }));
}

/** Efecto de una mejora del Legado con `l` niveles, para mostrar «ahora → siguiente». */
function legacyEffect(id: LegacyId, l: number): string {
  switch (id) {
    case 'memory': return t('legacy.memory.effect', { pct: pct(Math.round(l * MEMORY_BONUS * 100)) });
    case 'guilds': return t('legacy.guilds.effect', { pct: pct(Math.round((1 - GUILD_DISCOUNT ** l) * 100)) });
    case 'tradition': return l ? t('legacy.tradition.effect1', { n: TRADITION_PEOPLE }) : t('legacy.tradition.effect0');
    case 'hands': return t('legacy.hands.effect', { x: HANDS_MULTIPLIER ** l });
    case 'patience': return t('legacy.patience.effect', { min: 10 + l * PATIENCE_MINUTES });
    case 'foremen': return l ? t('legacy.foremen.effect1') : t('legacy.foremen.effect0');
  }
}

const shop = $('legacy-shop');
const shopItems = LEGACY_DEFS.map((def) => {
  const item = el('div', 'legacy-item');
  item.innerHTML = `<div class="li-head"><b>${t(`legacy.${def.id}.name` as Key)}</b><span class="li-level"></span></div><p class="li-desc">${t(`legacy.${def.id}.desc` as Key)}</p><p class="li-effect"></p><button type="button" class="stone-btn li-buy"></button>`;
  const buy = item.querySelector('.li-buy') as HTMLButtonElement;
  buy.addEventListener('click', () => {
    if (!buyLegacy(state, def.id)) return;
    sound.goal();
    applyTradition(state);
    save();
    renderLegacy();
    render();
  });
  shop.append(item);
  return { def, item, buy, level: item.querySelector('.li-level') as HTMLElement, effect: item.querySelector('.li-effect') as HTMLElement };
});

function renderLegacy(): void {
  const { legacy } = state;
  setText($('legacy-wisdom'), String(legacy.wisdom));
  setText($('legacy-runs'), legacy.rebirths ? t('legacy.civs', { n: legacy.rebirths + 1 }) : t('legacy.firstCiv'));
  const gain = wisdomForRun(state);
  const rebirthBtn = $<HTMLButtonElement>('rebirth');
  setText($('rebirth-text'), canRebirth(state)
    ? t('legacy.rebirthText', { gain, goals: goalsDone(state) })
    : t('legacy.rebirthLocked', { era: REBIRTH_MIN_GOALS }));
  setText(rebirthBtn, canRebirth(state) ? t('legacy.rebirthBtn', { gain }) : t('legacy.rebirth'));
  setDisabled(rebirthBtn, !canRebirth(state));
  for (const s of shopItems) {
    const lvl = legacy.levels[s.def.id], max = maxLevel(s.def.id), cost = nextLegacyCost(state, s.def.id);
    s.item.classList.toggle('maxed', cost === undefined);
    setText(s.level, `${lvl}/${max}`);
    setText(s.effect, cost === undefined
      ? t('legacy.effectMax', { now: legacyEffect(s.def.id, lvl) })
      : t('legacy.effectNext', { now: legacyEffect(s.def.id, lvl), next: legacyEffect(s.def.id, lvl + 1) }));
    setText(s.buy, cost === undefined ? t('legacy.complete') : t('legacy.buy', { cost }));
    setDisabled(s.buy, !canBuyLegacy(state, s.def.id));
  }
}

/** Renacer: pregunta, crea la civilización nueva y recarga la página tras la cortina. */
function doRebirth(): void {
  if (!canRebirth(state)) return;
  const gain = wisdomForRun(state);
  if (!window.confirm(t('legacy.confirm', { w: state.legacy.wisdom + gain }))) return;
  const next = rebirth(state);
  if (!next) return;
  state = next;
  save();
  if (legacyDialog.open) legacyDialog.close();
  // La aldea se vuelve a construir desde el Paleolítico: la cortina cubre la recarga de la página.
  const curtain = $('era-curtain');
  curtain.dataset.era = '1';
  curtain.querySelector('.era-kicker')!.textContent = t('legacy.curtainKicker', { n: state.legacy.rebirths + 1 });
  curtain.querySelector('h2')!.textContent = t('legacy.curtainTitle');
  curtain.querySelector('.era-intro')!.textContent = t('legacy.curtainText', { w: state.legacy.wisdom });
  curtain.hidden = false;
  void curtain.offsetWidth;
  curtain.classList.add('show');
  sound.goal();
  window.setTimeout(() => window.location.reload(), 1600);
}
$('rebirth').addEventListener('click', doRebirth);

// ---------- Finales ----------
const endings = createEndings({
  getState: () => state,
  openLegacy,
  rebirth: doRebirth,
  onToggle: (open) => {
    updatePaused();
    if (!open) save();
  },
});

// ---------- Meta de la era ----------
const goalPanel = $('goal');
function renderGoal(): void {
  const goal = currentGoal(state);
  const era = ERA_BY_N[state.era];
  if (state.goalReached) {
    const key = `done-${state.era}`;
    if (goalPanel.dataset.built === key) {
      renderLegacyBox();
      return;
    }
    goalPanel.dataset.built = key;
    goalPanel.classList.add('done');
    const next = ERA_BY_N[state.era + 1];
    if (canAdvanceEra(state) && next) {
      goalPanel.innerHTML = `<h2>${t('goal.eraDone', { n: era.n })}</h2><p>${goal.description}</p><button class="go">${next.enter}</button>`;
      goalPanel.querySelector('.go')!.addEventListener('click', () => {
        if (!advanceEra(state)) return;
        sound.goal();
        save();
        playEraTransition();
      });
    } else {
      // La última era: el cohete ha despegado y la historia de la civilización está completa.
      goalPanel.innerHTML = `<h2>${t('goal.starsTitle')}</h2><p>${t('goal.starsText', { n: era.n })}</p><button type="button" class="mini-btn see-ending">${t('goal.seeEnding')}</button>`;
      goalPanel.querySelector('.see-ending')!.addEventListener('click', () => endings.show(false));
    }
    goalPanel.append(legacyBox);
    renderLegacyBox();
    return;
  }
  if (goalPanel.dataset.built !== String(state.era)) {
    goalPanel.dataset.built = String(state.era);
    goalPanel.classList.remove('done');
    goalPanel.innerHTML = `<h2>${t('goal.title', { name: goal.name })}</h2><p>${goal.description}</p><div class="rows"></div><button class="go">${goal.action}</button>`;
    goalPanel.querySelector('.go')!.addEventListener('click', () => {
      if (!buyGoal(state)) return;
      sound.goal();
      showToast(t('goal.doneToast', { name: currentGoal(state).name, n: state.era }));
      village.update(state);
      village.celebrate();
      if (state.era === LAST_ERA) {
        // El cohete despega. Mientras sube se ve la aldea; luego llega el final de la civilización,
        // o el final verdadero si el juego está al 100 %.
        updateAchievements();
        const truly = allAchieved(state);
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.setTimeout(() => endings.show(truly), reduce ? 1200 : 6500);
      }
      save();
      render();
    });
  }
  const rows = goalPanel.querySelector('.rows')!;
  setHtml(rows, RESOURCES.filter((r) => goal.cost[r])
    .map((r) => {
      const need = goal.cost[r]!, have = Math.min(state.resources[r], need);
      return `<div class="row"><div><span>${RESOURCE_DEFS.find((d) => d.id === r)!.name}</span><span>${formatNumber(Math.floor(have))} / ${formatNumber(need)}</span></div><div class="bar"><span style="width:${(have / need) * 100}%"></span></div></div>`;
    })
    .join(''));
  setDisabled(goalPanel.querySelector('.go') as HTMLButtonElement, !canAfford(state, goal.cost));
  if (legacyBox.parentElement !== goalPanel) goalPanel.append(legacyBox);
  renderLegacyBox();
}

// ---------- Pestañas de la barra inferior ----------
const tabButtons = TABS.map((tab) => ({ tab, b: $<HTMLButtonElement>(`tabbtn-${tab}`) }));
const tabPanels: Record<Tab, HTMLElement> = { jobs: $('tab-jobs'), upgrades: $('tab-upgrades'), goal: goalPanel };
const tabBadges = Object.fromEntries(tabButtons.map(({ tab, b }) => [tab, b.querySelector('.tab-badge') as HTMLElement])) as Record<Tab, HTMLElement>;
(document.querySelector('#tabbtn-jobs .tab-icon') as HTMLElement).innerHTML = ICONS.person;
(document.querySelector('#tabbtn-upgrades .tab-icon') as HTMLElement).innerHTML = ICONS.hammer;
function showTab(tab: Tab): void {
  const changed = tab !== panelTab;
  panelTab = tab;
  for (const { tab: key, b } of tabButtons) {
    setHidden(tabPanels[key], key !== tab);
    setAttr(b, 'aria-selected', String(key === tab));
    b.classList.toggle('on', key === tab);
  }
  setHidden(goalMini, tab === 'goal');
  if (!changed) return;
  saveSettings();
  // El panel nuevo se ve desde arriba.
  $('panels').scrollTop = 0;
  if (window.scrollY > 0) window.scrollTo(0, 0);
}
for (const { tab, b } of tabButtons) b.addEventListener('click', () => showTab(tab));

// Meta resumida (en escritorio, siempre visible debajo del panel): un toque abre la pestaña.
const goalMini = $<HTMLButtonElement>('goal-mini');
goalMini.innerHTML = `<span class="gm-label"></span><span class="bar"><span></span></span><span class="gm-pct"></span>`;
const goalMiniLabel = goalMini.querySelector('.gm-label') as HTMLElement;
const goalMiniFill = goalMini.querySelector('.bar span') as HTMLElement;
const goalMiniPct = goalMini.querySelector('.gm-pct') as HTMLElement;
goalMini.addEventListener('click', () => showTab('goal'));

/** Avance de la meta: lo reunido de todos sus recursos frente a lo que pide. */
function goalProgress(): number {
  const cost = currentGoal(state).cost;
  let have = 0, need = 0;
  for (const r of RESOURCES) {
    if (!cost[r]) continue;
    need += cost[r]!;
    have += Math.min(state.resources[r], cost[r]!);
  }
  return need ? have / need : 1;
}

function renderTabs(affordableUpgrades: number): void {
  // Aviso en «Mejoras»: cuántas se pueden comprar ya.
  setHidden(tabBadges.upgrades, affordableUpgrades === 0);
  setText(tabBadges.upgrades, String(affordableUpgrades));
  const goal = currentGoal(state);
  const ready = state.goalReached || canAfford(state, goal.cost);
  const p = Math.floor(goalProgress() * 100);
  setHidden(tabBadges.goal, false);
  tabBadges.goal.classList.toggle('ready', ready);
  setText(tabBadges.goal, ready ? '✓' : `${p}%`);
  goalMini.classList.toggle('ready', ready);
  setText(goalMiniLabel, state.goalReached ? t('goal.eraDone', { n: state.era }) : t('goal.mini', { name: goal.name }));
  setWidth(goalMiniFill, `${state.goalReached ? 100 : p}%`);
  setText(goalMiniPct, state.goalReached ? '✓' : `${p}%`);
}

// ---------- Dibujo ----------
const gatherAmount = $('gather-amount'), noUpgrades = $('no-upgrades');
function render(): void {
  applyEra();
  const rates = ratePerSecond(state);
  const eraResources = ERA_BY_N[state.era].resources;
  for (const c of chips) {
    setHidden(c.chip, !eraResources.includes(c.id));
    setText(c.value, formatNumber(Math.floor(state.resources[c.id])));
    setText(c.rate, `+${formatNumber(rates[c.id])}/s`);
  }
  setText(populationValue, formatNumber(population(state)));
  setText(gatherAmount, `+${formatNumber(clickAmount(state))}`);

  // Oficios: los de eras futuras no se muestran y los que llegan al tope pasan a «completos».
  const jobCounts: Record<number, { active: number; done: number; total: number }> = {};
  const shownLocked = new Set<number>();
  for (const b of buildingCards) {
    const group = buildingGroups[b.def.era];
    const counts = (jobCounts[b.def.era] ??= { active: 0, done: 0, total: 0 });
    counts.total++;
    const unlocked = b.def.unlocked(state);
    // Solo se anticipa el siguiente edificio bloqueado de cada era, para no saturar la lista.
    const hidden = !unlocked && shownLocked.has(b.def.era);
    setHidden(b.item, hidden);
    const icon = unlocked ? BUILDING_ICONS[b.def.id] ?? 'person' : 'locked';
    if (b.icon.dataset.icon !== icon) {
      b.icon.dataset.icon = icon;
      b.icon.innerHTML = ICONS[icon];
    }
    b.item.classList.toggle('locked', !unlocked);
    if (!unlocked) {
      shownLocked.add(b.def.era);
      if (!hidden) counts.active++;
      place(b.item, group.active);
      b.item.classList.remove('pending');
      b.card.classList.add('locked');
      setDisabled(b.card, true);
      setText(b.name, '???');
      setText(b.count, '');
      setHtml(b.price, '');
      setText(b.desc, t('jobs.unlock', { hint: b.def.unlockHint.toLowerCase() }));
      setText(b.meta, '');
      setHidden(b.msBar, true);
      setHtml(b.msText, '');
      setHtml(b.cost, '');
      continue;
    }
    b.card.classList.remove('locked');
    const n = state.buildings[b.def.id];
    const next = nextMilestone(n);
    const full = atCap(state, b.def.id);
    counts[full ? 'done' : 'active']++;
    place(b.item, full ? group.done : group.active);
    // Lo que aún está en curso muestra siempre todo su detalle; lo completo queda en una línea.
    b.item.classList.toggle('pending', !full);
    b.card.classList.toggle('capped', full);
    setText(b.name, b.def.name);
    setText(b.count, String(n));
    setText(b.desc, b.def.description);
    setText(b.meta, t('jobs.perUnit', { v: formatNumber(unitRate(state, b.def.id)), res: RESOURCE_NAME[b.def.produces] }));
    // Barra de hito: avance desde el hito anterior hasta el siguiente.
    setHidden(b.msBar, false);
    const reached = milestonesReached(n);
    if (next) {
      const prev = reached ? MILESTONES[reached - 1] : 0;
      setHtml(b.msText, t('jobs.milestone', { n, next }));
      setWidth(b.msFill, `${((n - prev) / (next - prev)) * 100}%`);
      b.msBar.classList.remove('complete');
    } else {
      setHtml(b.msText, t('jobs.cap', { n, cap: BUILDING_CAP, x: 2 ** reached }));
      setWidth(b.msFill, '100%');
      b.msBar.classList.add('complete');
    }
    if (full) {
      setDisabled(b.card, true);
      setHtml(b.price, `<span class="full">${t('jobs.full')}</span>`);
      setHtml(b.cost, t('jobs.fullCost'));
      continue;
    }
    // Precio de las personas que contrataría un toque con la cantidad elegida (x1, x5, x10 o máx.).
    const count = buyCount(state, b.def.id, buyAmount);
    const cost = bulkCost(state, b.def.id, count);
    setDisabled(b.card, !canAfford(state, cost));
    setHtml(b.price, priceHtml(cost, count));
    setHtml(b.cost, count > 1 ? t('jobs.costN', { n: count, cost: costHtml(cost) }) : t('common.cost', { cost: costHtml(cost) }));
  }
  for (const g of Object.values(buildingGroups)) {
    const c = jobCounts[g.era];
    const complete = c.done === c.total;
    renderEraGroup('jobs', g, c, complete ? t('jobs.groupDone', { n: c.total }) : t('jobs.groupSum', { done: c.done, total: c.total }), complete,
      c.done === 1 ? t('jobs.doneOne') : t('jobs.doneMany', { n: c.done }));
  }

  // Mejoras: las disponibles en curso y las obtenidas plegadas aparte.
  const upCounts: Record<number, { active: number; done: number; total: number }> = {};
  let available = 0, affordable = 0;
  for (const u of upgradeCards) {
    const group = upgradeGroups[u.def.era];
    const counts = (upCounts[u.def.era] ??= { active: 0, done: 0, total: 0 });
    counts.total++;
    const owned = state.upgrades.includes(u.def.id);
    const show = owned || upgradeAvailable(state, u.def.id);
    setHidden(u.item, !show);
    if (!show) continue;
    counts[owned ? 'done' : 'active']++;
    place(u.item, owned ? group.done : group.active);
    u.item.classList.toggle('pending', !owned);
    u.card.classList.toggle('owned', owned);
    if (owned) {
      setDisabled(u.card, true);
      setHtml(u.price, `<span class="full">${t('upgrades.owned')}</span>`);
      setHtml(u.cost, t('upgrades.ownedLong'));
      continue;
    }
    available++;
    const can = canAfford(state, u.def.cost);
    if (can) affordable++;
    setDisabled(u.card, !can);
    setHtml(u.price, priceHtml(u.def.cost));
    setHtml(u.cost, t('common.cost', { cost: costHtml(u.def.cost) }));
  }
  for (const g of Object.values(upgradeGroups)) {
    const c = upCounts[g.era];
    const complete = c.done === c.total;
    const summary = complete
      ? t('upgrades.groupDone', { n: c.total })
      : [c.active ? (c.active === 1 ? t('upgrades.availOne') : t('upgrades.availMany', { n: c.active })) : '', t('upgrades.groupSum', { done: c.done, total: c.total })].filter(Boolean).join(' · ');
    renderEraGroup('upgrades', g, c, summary, complete, c.done === 1 ? t('upgrades.doneOne') : t('upgrades.doneMany', { n: c.done }));
  }
  setHidden(noUpgrades, available > 0);

  renderTabs(affordable);
  renderGoal();
  tree.update();
  trophies.update();
}

function save(): void {
  saveGame(state);
  $('save-status').textContent = t('save.status', { time: new Date().toLocaleTimeString(getLang()) });
}

// ---------- Acciones ----------
$('gather').addEventListener('click', (event) => {
  const amount = gather(state);
  sound.gather();
  village.pulse();
  floatText(`+${formatNumber(amount)}`, event.clientX || window.innerWidth / 2, event.clientY || window.innerHeight / 2);
  render();
});

// Exportar descarga un archivo con la partida; importar lo vuelve a cargar desde el dispositivo.
$('export').addEventListener('click', () => {
  save();
  const blob = new Blob([exportFileText(state)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName(state);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  showToast(t('save.exported'));
});

const importInput = $<HTMLInputElement>('import-file');
$('import').addEventListener('click', () => {
  importInput.value = '';
  importInput.click();
});
importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  // Una partida ocupa unos pocos KB: un archivo enorme no puede ser una partida.
  const loaded = file.size < 1_000_000 ? importFileText(await file.text().catch(() => '')) : null;
  if (!loaded) {
    showToast(t('save.badFile'));
    return;
  }
  state = loaded;
  settleMigrated(state);
  applyOfflineProgress(state, Date.now());
  village.update(state);
  save();
  render();
  settingsDialog.close();
  showToast(t('save.imported'));
});

$('reset').addEventListener('click', () => {
  if (!window.confirm(t('save.resetConfirm'))) return;
  deleteSave();
  state = newGame();
  village.update(state);
  render();
  settingsDialog.close();
  showToast(t('save.resetDone'));
  coach.start(TUTORIALS[0]);
});

// Avisa cuando algo nuevo se desbloquea, para que el jugador siempre sepa qué hacer.
const seenUnlocks = new Set<string>([
  ...BUILDING_DEFS.filter((b) => b.unlocked(state)).map((b) => b.id),
  ...UPGRADE_DEFS.filter((u) => upgradeAvailable(state, u.id) || state.upgrades.includes(u.id)).map((u) => u.id),
]);
function announceUnlocks(): void {
  for (const b of BUILDING_DEFS) {
    if (!seenUnlocks.has(b.id) && b.unlocked(state)) {
      seenUnlocks.add(b.id);
      showToast(t('unlock.job', { name: b.name }));
      sound.unlockSound();
    }
  }
  for (const u of UPGRADE_DEFS) {
    if (!seenUnlocks.has(u.id) && upgradeAvailable(state, u.id)) {
      seenUnlocks.add(u.id);
      showToast(t('unlock.upgrade', { name: u.name }));
      sound.unlockSound();
    }
  }
}

// ---------- Tutoriales ----------
// El de inicio explica el juego; los demás saltan la primera vez que se desbloquea cada sección.
const coach = createCoach({
  showTab,
  onDone: (id) => {
    if (!state.profile.tutorials.includes(id)) state.profile.tutorials.push(id);
    save();
  },
});
const curtainEl = $('era-curtain');
const startScreen = $('start');
/** Salta el tutorial que toque si no hay nada tapando la pantalla. */
function maybeTutorial(): void {
  if (coach.active || endings.open || !startScreen.hidden || !curtainEl.hidden || dialogs.some((d) => d.open)) return;
  const due = dueTutorial(state);
  if (due) coach.start(due);
}

// Bucle principal: usa el tiempo real transcurrido, así que con la pestaña oculta la tribu sigue
// trabajando, pero solo los primeros minutos desde que el jugador se fue (creditedSeconds).
let last = Date.now();
function advance(): void {
  const now = Date.now();
  tick(state, creditedSeconds(state, last, now));
  applyTradition(state);
  autoHire(state);
  last = now;
}
window.setInterval(() => {
  advance();
  announceUnlocks();
  updateAchievements();
  maybeTutorial();
  village.update(state);
  // De noche cantan los grillos y callan los pájaros y el yunque.
  sound.setDaylight(village.daylight());
  render();
}, TICK_MS);

window.setInterval(() => {
  // Antes de empezar (pantalla de inicio) no hay partida que guardar.
  if (startScreen.hidden) save();
}, AUTOSAVE_MS);
document.addEventListener('visibilitychange', () => {
  advance();
  if (document.visibilityState === 'hidden') {
    state.awaySince = Date.now();
    if (startScreen.hidden) save();
  } else if (state.awaySince !== null) {
    const away = (Date.now() - state.awaySince) / 1000;
    state.awaySince = null;
    if (startScreen.hidden) save();
    if (away > 60) showToast(awayMessage(away));
  }
  sound.setActive(document.visibilityState === 'visible');
});
window.addEventListener('beforeunload', () => {
  if (startScreen.hidden) save();
});

// Mientras el árbol de mejoras, los ajustes o un final tapan la escena, o el aviso de girar el
// móvil tapa la pantalla, la aldea deja de dibujarse. La consulta es la misma que muestra el aviso en style.css.
const dialogs = [...document.querySelectorAll('dialog')];
const sideways = window.matchMedia('(orientation: landscape) and (pointer: coarse) and (max-height: 560px)');
function updatePaused(): void {
  village.setPaused(sideways.matches || dialogs.some((d) => d.open) || endings.open);
}
new MutationObserver(updatePaused).observe(document.body, {
  subtree: true,
  attributes: true,
  attributeFilter: ['open'],
});
sideways.addEventListener('change', updatePaused);
updatePaused();
// Donde el navegador lo permite (Android a pantalla completa o como app instalada), además se fija
// la orientación vertical. En los demás casos falla sin más y queda el aviso.
if (window.matchMedia('(pointer: coarse)').matches) {
  const lockPortrait = () => {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    orientation?.lock?.('portrait').catch(() => {});
  };
  lockPortrait();
  document.addEventListener('pointerdown', lockPortrait, { once: true });
}

showTab(panelTab);
render();
/** Aviso al volver: cuánto trabajó la tribu y, si la ausencia fue larga, que el resto no cuenta. */
function awayMessage(away: number): string {
  const limit = offlineLimit(state);
  return away > limit
    ? t('away.long', { away: formatDuration(away), limit: formatDuration(limit) })
    : t('away.short', { away: formatDuration(away) });
}

// ---------- Fin de la carga ----------
// Unos fotogramas para que la aldea quede dibujada (y sus materiales preparados) antes de quitar la pantalla de carga.
for (let i = 0; i < 3; i++) await nextFrame();
loaderStep(100, t('loader.ready'));
await delay(150);
loader.classList.add('done');
window.setTimeout(() => loader.remove(), 700);

if (firstTime) {
  // Pantalla de inicio: elegir idioma y empezar. Al empezar, el tutorial explica el juego.
  languageButtons($('start-langs'));
  (startScreen.querySelector('.start-mark') as HTMLElement).innerHTML = ICONS.fire;
  startScreen.hidden = false;
  $('start-play').addEventListener('click', () => {
    sound.unlock();
    startScreen.classList.add('leaving');
    window.setTimeout(() => {
      startScreen.hidden = true;
      save();
      coach.start(TUTORIALS[0]);
    }, 450);
  }, { once: true });
} else {
  if (!state.profile.tutorials.includes('intro')) coach.start(TUTORIALS[0]);
  if (offlineSeconds > 60) showToast(awayMessage(offlineSeconds));
}
