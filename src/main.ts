import './style.css';
import { BUILDING_DEFS, ERA_BY_N, RESOURCE_DEFS, UPGRADE_DEFS, type UpgradeDef } from './game/content';
import {
  advanceEra,
  applyOfflineProgress,
  atCap,
  buildingCost,
  buyBuilding,
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
  ratePerSecond,
  tick,
  unitRate,
  upgradeAvailable,
} from './game/logic';
import { BUILDING_CAP, MAX_OFFLINE_SECONDS, MILESTONES } from './game/balance';
import { deleteSave, exportFileName, exportFileText, importFileText, loadGame, saveGame } from './game/save';
import { newGame, RESOURCES, type Cost, type GameState } from './game/state';
import { formatDuration, formatNumber, getNumberFormat, NUMBER_FORMATS, setNumberFormat, type NumberFormat } from './game/format';
import { BUILDING_ICONS, ERA_ICONS, ICONS, RESOURCE_ICONS, UPGRADE_ICONS } from './ui/icons';
import { createUpgradeTree } from './ui/tree';
import { createVillage } from './scene/village';
import { DEFAULT_FPS, DEFAULT_QUALITY, FPS_OPTIONS, isFpsLimit, isQualityLevel, QUALITY_PRESETS, type FpsLimit, type QualityLevel } from './scene/quality';
import { Sound } from './audio/sound';

const TICK_MS = 100;
const AUTOSAVE_MS = 10_000;
const SETTINGS_KEY = 'civilizacion-incremental:settings';
const RESOURCE_NAME = Object.fromEntries(RESOURCE_DEFS.map((r) => [r.id, r.name.toLowerCase()])) as Record<string, string>;

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

let state: GameState = loadGame() ?? newGame();
// Cuánto tiempo estuvo fuera el jugador (para el aviso), antes de que se apliquen sus minutos.
const offlineSeconds = (Date.now() - (state.awaySince ?? state.lastSaved)) / 1000;
applyOfflineProgress(state, Date.now());
const village = createVillage($('scene'));
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
const graphics: { quality: QualityLevel; fps: FpsLimit } = { quality: DEFAULT_QUALITY, fps: DEFAULT_FPS };
// Panel que se ve en la barra lateral (o debajo de la aldea, en móvil).
const TABS = ['jobs', 'upgrades', 'goal'] as const;
type Tab = (typeof TABS)[number];
let panelTab: Tab = 'jobs';
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  if (NUMBER_FORMATS.some((f) => f.id === saved.numberFormat)) setNumberFormat(saved.numberFormat);
  if (isQualityLevel(saved.quality)) graphics.quality = saved.quality;
  if (isFpsLimit(saved.fps)) graphics.fps = saved.fps;
  if (TABS.includes(saved.tab)) panelTab = saved.tab;
} catch {
  // Ajustes ilegibles: se usan los de siempre.
}
village.setGraphics(graphics.quality, graphics.fps);
function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ numberFormat: getNumberFormat(), ...graphics, tab: panelTab }));
  } catch {
    // Sin almacenamiento: los ajustes duran solo esta sesión.
  }
}
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
  b.innerHTML = `<span class="choice-name">${f.name}</span><span class="choice-example">${formatNumber(1_234_567, f.id)}</span>`;
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
  b.innerHTML = `<span class="choice-name">${o.name}</span><span class="choice-example">${o.hint}</span>`;
  b.addEventListener('click', () => {
    graphics.fps = o.id;
    village.setGraphics(graphics.quality, graphics.fps);
    saveSettings();
    renderSettings();
  });
  $('fps-options').append(b);
  return { id: o.id, b };
});

function renderSettings(): void {
  muteButton.innerHTML = sound.muted ? ICONS.soundOff : ICONS.soundOn;
  const label = sound.muted ? 'Activar sonido' : 'Silenciar sonido';
  muteButton.setAttribute('aria-label', label);
  muteButton.title = label;
  muteButton.classList.toggle('off', sound.muted);
  mutedBox.checked = sound.muted;
  for (const s of sliders) {
    s.input.value = String(s.get());
    s.out.textContent = `${Math.round(s.get() * 100)} %`;
  }
  for (const f of formatButtons) f.b.setAttribute('aria-checked', String(f.id === getNumberFormat()));
  const preset = QUALITY_PRESETS[graphics.quality];
  qualityInput.value = String(graphics.quality);
  qualityInput.setAttribute('aria-valuetext', preset.name);
  $('quality-name').textContent = `${graphics.quality}/5 · ${preset.name}.`;
  $('quality-hint').textContent = preset.hint;
  for (const f of fpsButtons) f.b.setAttribute('aria-checked', String(f.id === graphics.fps));
}
renderSettings();

// ---------- Era: estilo de los paneles, fondo, botón de recolectar y cabecera ----------
// Cada era tiene su propio estilo (data-era en <body>); al cambiar de era cambia todo a la vez.
function applyEra(): void {
  const era = ERA_BY_N[state.era];
  if (document.body.dataset.era === String(era.n)) return;
  document.body.dataset.era = String(era.n);
  (document.querySelector('.header .era') as HTMLElement).textContent = `Era ${era.n} · ${era.name}`;
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
  curtain.querySelector('.era-kicker')!.textContent = `Era ${era.n}`;
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
populationChip.title = 'Población';
populationChip.innerHTML = `<span class="chip-icon">${ICONS.person}</span><span class="chip-name">Población</span> <b></b>`;
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
  setText(g.doneToggle, `${doneOpen ? 'Ocultar' : 'Ver'} ${doneText}`);
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
  more.setAttribute('aria-label', 'Ver detalle');
  more.setAttribute('aria-expanded', 'false');
  more.addEventListener('click', () => {
    const open = item.classList.toggle('open');
    more.setAttribute('aria-expanded', String(open));
    more.setAttribute('aria-label', open ? 'Ocultar detalle' : 'Ver detalle');
  });
  item.append(card, more);
  return item;
}

// Precio en una línea: como cada coste pide lo mismo de cada recurso, basta la cifra y los iconos.
function priceHtml(cost: Cost): string {
  const rs = RESOURCES.filter((r) => cost[r]);
  const amount = Math.max(...rs.map((r) => cost[r]!));
  const icons = rs
    .map((r) => `<span class="${state.resources[r] >= cost[r]! ? 'ok' : 'no'}" title="${RESOURCE_NAME[r]}">${ICONS[RESOURCE_ICONS[r]]}</span>`)
    .join('');
  return `<span class="${canAfford(state, cost) ? 'ok' : 'no'}">${formatNumber(amount)}</span><span class="price-icons">${icons}</span>`;
}

// ---------- Edificios ----------
$('cap-note').textContent = `Cada oficio admite hasta ${BUILDING_CAP} personas. Al llegar al tope, su producción es ×${2 ** MILESTONES.length}.`;
const buildingGroups = createEraGroups('jobs', $('buildings'), BUILDING_DEFS.map((b) => b.era));
const buildingCards = BUILDING_DEFS.map((def, index) => {
  const card = el('button', 'card');
  card.innerHTML =
    `<span class="icon"></span><span class="name"></span><span class="price"></span><span class="count"></span><span class="ms-bar"><span></span></span>` +
    `<span class="details"><span class="desc"></span><span class="meta"></span><span class="ms-text"></span><span class="cost"></span></span>`;
  const item = createItem(card, index);
  card.addEventListener('click', () => {
    const before = milestonesReached(state.buildings[def.id]);
    if (buyBuilding(state, def.id)) {
      village.update(state);
      village.celebrate();
      if (atCap(state, def.id)) {
        // Último hito y tope a la vez: el oficio queda completo.
        sound.upgrade();
        showToast(`¡Oficio completo! ${BUILDING_CAP} ${def.plural}: producción ×2 y ya no caben más.`);
        card.classList.remove('milestone-hit');
        void card.offsetWidth;
        card.classList.add('milestone-hit');
      } else if (milestonesReached(state.buildings[def.id]) > before) {
        // Hito alcanzado: la barra se llena y la producción de este oficio se duplica.
        sound.upgrade();
        showToast(`¡Hito! ${state.buildings[def.id]} ${def.plural}: su producción se duplica.`);
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
  showToast(`Mejora obtenida: ${def.name}`);
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

// ---------- Meta de la era ----------
const goalPanel = $('goal');
function renderGoal(): void {
  const goal = currentGoal(state);
  const era = ERA_BY_N[state.era];
  if (state.goalReached) {
    const key = `done-${state.era}`;
    if (goalPanel.dataset.built === key) return;
    goalPanel.dataset.built = key;
    goalPanel.classList.add('done');
    const next = ERA_BY_N[state.era + 1];
    if (canAdvanceEra(state) && next) {
      goalPanel.innerHTML = `<h2>¡Era ${era.n} completada!</h2><p>${goal.description}</p><button class="go">${next.enter}</button>`;
      goalPanel.querySelector('.go')!.addEventListener('click', () => {
        if (!advanceEra(state)) return;
        sound.goal();
        save();
        playEraTransition();
      });
    } else {
      goalPanel.innerHTML = `<h2>¡Era ${era.n} completada!</h2><p>Has llegado al final de lo que existe por ahora. La siguiente era llegará en una próxima actualización; mientras tanto puedes seguir haciendo crecer tu aldea.</p>`;
    }
    return;
  }
  if (goalPanel.dataset.built !== String(state.era)) {
    goalPanel.dataset.built = String(state.era);
    goalPanel.classList.remove('done');
    goalPanel.innerHTML = `<h2>Meta de la era: ${goal.name}</h2><p>${goal.description}</p><div class="rows"></div><button class="go">${goal.action}</button>`;
    goalPanel.querySelector('.go')!.addEventListener('click', () => {
      if (buyGoal(state)) {
        sound.goal();
        showToast(`¡${currentGoal(state).name}! Era ${state.era} completada.`);
        village.update(state);
        village.celebrate();
        save();
        render();
      }
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
}

// ---------- Pestañas de la barra inferior ----------
const tabButtons = TABS.map((t) => ({ t, b: $<HTMLButtonElement>(`tabbtn-${t}`) }));
const tabPanels: Record<Tab, HTMLElement> = { jobs: $('tab-jobs'), upgrades: $('tab-upgrades'), goal: goalPanel };
const tabBadges = Object.fromEntries(tabButtons.map(({ t, b }) => [t, b.querySelector('.tab-badge') as HTMLElement])) as Record<Tab, HTMLElement>;
(document.querySelector('#tabbtn-jobs .tab-icon') as HTMLElement).innerHTML = ICONS.person;
(document.querySelector('#tabbtn-upgrades .tab-icon') as HTMLElement).innerHTML = ICONS.hammer;
function showTab(t: Tab): void {
  const changed = t !== panelTab;
  panelTab = t;
  for (const { t: key, b } of tabButtons) {
    setHidden(tabPanels[key], key !== t);
    setAttr(b, 'aria-selected', String(key === t));
    b.classList.toggle('on', key === t);
  }
  setHidden(goalMini, t === 'goal');
  if (!changed) return;
  saveSettings();
  // El panel nuevo se ve desde arriba.
  $('panels').scrollTop = 0;
  if (window.scrollY > 0) window.scrollTo(0, 0);
}
for (const { t, b } of tabButtons) b.addEventListener('click', () => showTab(t));

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
  const pct = Math.floor(goalProgress() * 100);
  setHidden(tabBadges.goal, false);
  tabBadges.goal.classList.toggle('ready', ready);
  setText(tabBadges.goal, ready ? '✓' : `${pct}%`);
  goalMini.classList.toggle('ready', ready);
  setText(goalMiniLabel, state.goalReached ? `¡Era ${state.era} completada!` : `Meta: ${goal.name}`);
  setWidth(goalMiniFill, `${state.goalReached ? 100 : pct}%`);
  setText(goalMiniPct, state.goalReached ? '✓' : `${pct}%`);
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
  // La tribu: el fundador más cada miembro que trabaja en un oficio.
  setText(populationValue, formatNumber(1 + Object.values(state.buildings).reduce((a, b) => a + b, 0)));
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
      setText(b.desc, `Se desbloquea: ${b.def.unlockHint.toLowerCase()}`);
      setText(b.meta, '');
      setHidden(b.msBar, true);
      setHtml(b.msText, '');
      setHtml(b.cost, '');
      continue;
    }
    b.card.classList.remove('locked');
    const cost = buildingCost(state, b.def.id);
    const n = state.buildings[b.def.id];
    const next = nextMilestone(n);
    const full = atCap(state, b.def.id);
    counts[full ? 'done' : 'active']++;
    place(b.item, full ? group.done : group.active);
    // Lo que aún está en curso muestra siempre todo su detalle; lo completo queda en una línea.
    b.item.classList.toggle('pending', !full);
    b.card.classList.toggle('capped', full);
    setDisabled(b.card, full || !canAfford(state, cost));
    setText(b.name, b.def.name);
    setText(b.count, String(n));
    setHtml(b.price, full ? '<span class="full">Completo</span>' : priceHtml(cost));
    setText(b.desc, b.def.description);
    setText(b.meta, `+${formatNumber(unitRate(state, b.def.id))} ${RESOURCE_NAME[b.def.produces]}/s cada uno`);
    // Barra de hito: avance desde el hito anterior hasta el siguiente.
    setHidden(b.msBar, false);
    const reached = milestonesReached(n);
    if (next) {
      const prev = reached ? MILESTONES[reached - 1] : 0;
      setHtml(b.msText, `Hito <b>${n}/${next}</b> · al llegar, producción ×2`);
      setWidth(b.msFill, `${((n - prev) / (next - prev)) * 100}%`);
      b.msBar.classList.remove('complete');
    } else {
      setHtml(b.msText, `<b>Tope ${n}/${BUILDING_CAP}</b> · producción ×${2 ** reached}`);
      setWidth(b.msFill, '100%');
      b.msBar.classList.add('complete');
    }
    setHtml(b.cost, full ? 'Oficio completo: no caben más personas' : `Coste: ${costHtml(cost)}`);
  }
  for (const g of Object.values(buildingGroups)) {
    const c = jobCounts[g.era];
    const complete = c.done === c.total;
    renderEraGroup('jobs', g, c, complete ? `${c.total}/${c.total} completos ✓` : `${c.done} de ${c.total} completos`, complete,
      c.done === 1 ? '1 oficio completo' : `${c.done} oficios completos`);
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
      setHtml(u.price, '<span class="full">Obtenida ✓</span>');
      setHtml(u.cost, 'Mejora obtenida');
      continue;
    }
    available++;
    const can = canAfford(state, u.def.cost);
    if (can) affordable++;
    setDisabled(u.card, !can);
    setHtml(u.price, priceHtml(u.def.cost));
    setHtml(u.cost, `Coste: ${costHtml(u.def.cost)}`);
  }
  for (const g of Object.values(upgradeGroups)) {
    const c = upCounts[g.era];
    const complete = c.done === c.total;
    const summary = complete
      ? `${c.total}/${c.total} obtenidas ✓`
      : [c.active ? `${c.active} ${c.active === 1 ? 'disponible' : 'disponibles'}` : '', `${c.done}/${c.total} obtenidas`].filter(Boolean).join(' · ');
    renderEraGroup('upgrades', g, c, summary, complete, c.done === 1 ? '1 mejora obtenida' : `${c.done} mejoras obtenidas`);
  }
  setHidden(noUpgrades, available > 0);

  renderTabs(affordable);
  renderGoal();
  tree.update();
}

function save(): void {
  saveGame(state);
  $('save-status').textContent = `Guardado ${new Date().toLocaleTimeString('es')}`;
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
  showToast('Partida exportada: busca el archivo en tus descargas.');
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
    showToast('Ese archivo no es una partida válida.');
    return;
  }
  state = loaded;
  applyOfflineProgress(state, Date.now());
  village.update(state);
  save();
  render();
  settingsDialog.close();
  showToast('Partida importada.');
});

$('reset').addEventListener('click', () => {
  if (!window.confirm('¿Seguro? Se perderá todo tu progreso.')) return;
  deleteSave();
  state = newGame();
  village.update(state);
  render();
  settingsDialog.close();
  showToast('Partida reiniciada. ¡Empieza de nuevo la aventura!');
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
      showToast(`Nuevo en tu tribu: ${b.name}`);
      sound.unlockSound();
    }
  }
  for (const u of UPGRADE_DEFS) {
    if (!seenUnlocks.has(u.id) && upgradeAvailable(state, u.id)) {
      seenUnlocks.add(u.id);
      showToast(`Nueva mejora disponible: ${u.name}`);
      sound.unlockSound();
    }
  }
}

// Bucle principal: usa el tiempo real transcurrido, así que con la pestaña oculta la tribu sigue
// trabajando, pero solo los primeros minutos desde que el jugador se fue (creditedSeconds).
let last = Date.now();
function advance(): void {
  const now = Date.now();
  tick(state, creditedSeconds(state, last, now));
  last = now;
}
window.setInterval(() => {
  advance();
  announceUnlocks();
  village.update(state);
  render();
}, TICK_MS);

window.setInterval(save, AUTOSAVE_MS);
document.addEventListener('visibilitychange', () => {
  advance();
  if (document.visibilityState === 'hidden') {
    state.awaySince = Date.now();
    save();
  } else if (state.awaySince !== null) {
    const away = (Date.now() - state.awaySince) / 1000;
    state.awaySince = null;
    save();
    if (away > 60) showToast(awayMessage(away));
  }
  sound.setActive(document.visibilityState === 'visible');
});
window.addEventListener('beforeunload', save);

// Mientras el árbol de mejoras o los ajustes tapan la escena, la aldea deja de dibujarse.
const dialogs = [...document.querySelectorAll('dialog')];
new MutationObserver(() => village.setPaused(dialogs.some((d) => d.open))).observe(document.body, {
  subtree: true,
  attributes: true,
  attributeFilter: ['open'],
});

showTab(panelTab);
village.update(state);
render();
/** Aviso al volver: cuánto trabajó la tribu y, si la ausencia fue larga, que el resto no cuenta. */
function awayMessage(away: number): string {
  return away > MAX_OFFLINE_SECONDS
    ? `Estuviste fuera ${formatDuration(away)}. Tu tribu trabajó los primeros ${formatDuration(MAX_OFFLINE_SECONDS)} y luego descansó.`
    : `Mientras no estabas (${formatDuration(away)}) tu tribu siguió trabajando.`;
}
if (offlineSeconds > 60) showToast(awayMessage(offlineSeconds));
