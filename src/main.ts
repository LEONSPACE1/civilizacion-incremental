import './style.css';
import { BUILDING_DEFS, ERA_BY_N, RESOURCE_DEFS, UPGRADE_DEFS, type UpgradeDef } from './game/content';
import {
  advanceEra,
  applyOfflineProgress,
  buildingCost,
  buyBuilding,
  buyGoal,
  buyUpgrade,
  canAdvanceEra,
  canAfford,
  clickAmount,
  currentGoal,
  gather,
  milestonesReached,
  nextMilestone,
  ratePerSecond,
  tick,
  unitRate,
  upgradeAvailable,
} from './game/logic';
import { MILESTONES } from './game/balance';
import { deleteSave, deserialize, loadGame, saveGame, serialize } from './game/save';
import { newGame, RESOURCES, type Cost, type GameState } from './game/state';
import { formatDuration, formatNumber, getNumberFormat, NUMBER_FORMATS, setNumberFormat, type NumberFormat } from './game/format';
import { BUILDING_ICONS, ERA_ICONS, ICONS, RESOURCE_ICONS, UPGRADE_ICONS } from './ui/icons';
import { createUpgradeTree } from './ui/tree';
import { createVillage } from './scene/village';
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
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

let state: GameState = loadGame() ?? newGame();
const offlineSeconds = applyOfflineProgress(state, Date.now());
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
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  if (NUMBER_FORMATS.some((f) => f.id === saved.numberFormat)) setNumberFormat(saved.numberFormat);
} catch {
  // Ajustes ilegibles: se usan los de siempre.
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
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ numberFormat: f.id }));
    } catch {
      // Sin almacenamiento: el formato dura solo esta sesión.
    }
    renderSettings();
    render();
  });
  $('number-formats').append(b);
  return { id: f.id as NumberFormat, b };
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
  $('gather-label').textContent = era.gatherLabel;
  sound.setEra(era.n);
}

/** Cortina con el nombre de la nueva era: el estilo cambia mientras cubre la pantalla. */
function playEraTransition(): void {
  const era = ERA_BY_N[state.era];
  const curtain = $('era-curtain');
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
    // Los oficios nuevos aparecen arriba de la lista: se muestra desde el principio.
    document.querySelector('.sidebar')!.scrollTop = 0;
    window.scrollTo(0, 0);
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

// ---------- Edificios ----------
// Un grupo por era; los oficios de la era actual van arriba.
const buildingGroups = Object.fromEntries(
  [...new Set(BUILDING_DEFS.map((b) => b.era))].map((n) => {
    const group = el('div', 'job-group');
    group.innerHTML = `<h3 class="group-title">${ERA_BY_N[n].name}</h3>`;
    group.dataset.era = String(n);
    $('buildings').append(group);
    return [n, group];
  }),
) as Record<number, HTMLElement>;
const buildingCards = BUILDING_DEFS.map((def) => {
  const card = el('button', 'card');
  card.innerHTML =
    `<span class="icon"></span><span class="name"></span><span class="count"></span><span class="desc"></span><span class="meta"></span>` +
    `<span class="milestone"><span class="ms-text"></span><span class="ms-bar"><span></span></span></span><span class="cost"></span>`;
  card.addEventListener('click', () => {
    const before = milestonesReached(state.buildings[def.id]);
    if (buyBuilding(state, def.id)) {
      village.update(state);
      village.celebrate();
      if (milestonesReached(state.buildings[def.id]) > before) {
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
  buildingGroups[def.era].append(card);
  const q = (s: string) => card.querySelector(s) as HTMLElement;
  return {
    def,
    card,
    icon: q('.icon'),
    name: q('.name'),
    count: q('.count'),
    desc: q('.desc'),
    meta: q('.meta'),
    milestone: q('.milestone'),
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
const upgradeCards = UPGRADE_DEFS.map((def) => {
  const card = el('button', 'card upgrade');
  card.innerHTML = `<span class="icon">${ICONS[UPGRADE_ICONS[def.id] ?? 'fire']}</span><span class="name">${def.name}</span><span class="desc">${def.description}</span><span class="cost"></span>`;
  card.addEventListener('click', () => purchaseUpgrade(def));
  $('upgrades').append(card);
  return { def, card, cost: card.querySelector('.cost') as HTMLElement };
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
      goalPanel.innerHTML = `<h2>¡Era ${era.n} completada!</h2><p>${goal.description}</p><button class="go">Entrar en el ${next.name}</button>`;
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
  rows.innerHTML = RESOURCES.filter((r) => goal.cost[r])
    .map((r) => {
      const need = goal.cost[r]!, have = Math.min(state.resources[r], need);
      return `<div class="row"><div><span>${RESOURCE_DEFS.find((d) => d.id === r)!.name}</span><span>${formatNumber(Math.floor(have))} / ${formatNumber(need)}</span></div><div class="bar"><span style="width:${(have / need) * 100}%"></span></div></div>`;
    })
    .join('');
  (goalPanel.querySelector('.go') as HTMLButtonElement).disabled = !canAfford(state, goal.cost);
}

// ---------- Dibujo ----------
function render(): void {
  applyEra();
  const rates = ratePerSecond(state);
  const eraResources = ERA_BY_N[state.era].resources;
  for (const c of chips) {
    c.chip.hidden = !eraResources.includes(c.id);
    c.value.textContent = formatNumber(Math.floor(state.resources[c.id]));
    c.rate.textContent = `+${formatNumber(rates[c.id])}/s`;
  }
  // La tribu: el fundador más cada miembro que trabaja en un oficio.
  populationValue.textContent = formatNumber(1 + Object.values(state.buildings).reduce((a, b) => a + b, 0));
  $('gather-amount').textContent = `+${formatNumber(clickAmount(state))}`;

  // Los oficios de la era actual arriba; los de eras futuras no se muestran.
  for (const [n, group] of Object.entries(buildingGroups)) {
    group.hidden = Number(n) > state.era;
    group.style.order = String(state.era - Number(n));
  }
  $('buildings').classList.toggle('grouped', state.era > 1);
  const shownLocked = new Set<number>();
  for (const b of buildingCards) {
    const unlocked = b.def.unlocked(state);
    // Solo se anticipa el siguiente edificio bloqueado de cada era, para no saturar la lista.
    b.card.hidden = !unlocked && shownLocked.has(b.def.era);
    const icon = unlocked ? BUILDING_ICONS[b.def.id] ?? 'person' : 'locked';
    if (b.icon.dataset.icon !== icon) {
      b.icon.dataset.icon = icon;
      b.icon.innerHTML = ICONS[icon];
    }
    if (!unlocked) {
      shownLocked.add(b.def.era);
      b.card.classList.add('locked');
      b.card.disabled = true;
      b.name.textContent = '???';
      b.count.textContent = '';
      b.desc.textContent = `Se desbloquea: ${b.def.unlockHint.toLowerCase()}`;
      b.meta.textContent = '';
      b.milestone.hidden = true;
      b.cost.textContent = '';
      continue;
    }
    b.card.classList.remove('locked');
    const cost = buildingCost(state, b.def.id);
    const n = state.buildings[b.def.id];
    const next = nextMilestone(n);
    b.card.disabled = !canAfford(state, cost);
    b.name.textContent = b.def.name;
    b.count.textContent = String(n);
    b.desc.textContent = b.def.description;
    b.meta.textContent = `+${formatNumber(unitRate(state, b.def.id))} ${RESOURCE_NAME[b.def.produces]}/s cada uno`;
    // Barra de hito: avance desde el hito anterior hasta el siguiente.
    b.milestone.hidden = false;
    const reached = milestonesReached(n);
    if (next) {
      const prev = reached ? MILESTONES[reached - 1] : 0;
      b.msText.innerHTML = `Hito <b>${n}/${next}</b> · al llegar, producción ×2`;
      b.msFill.style.width = `${((n - prev) / (next - prev)) * 100}%`;
      b.milestone.classList.remove('complete');
    } else {
      b.msText.innerHTML = `<b>Todos los hitos</b> · producción ×${2 ** reached}`;
      b.msFill.style.width = '100%';
      b.milestone.classList.add('complete');
    }
    b.cost.innerHTML = `Coste: ${costHtml(cost)}`;
  }

  let available = 0;
  for (const u of upgradeCards) {
    const show = upgradeAvailable(state, u.def.id);
    u.card.hidden = !show;
    if (!show) continue;
    available++;
    u.card.disabled = !canAfford(state, u.def.cost);
    u.cost.innerHTML = `Coste: ${costHtml(u.def.cost)}`;
  }
  $('no-upgrades').hidden = available > 0;
  const owned = UPGRADE_DEFS.filter((u) => state.upgrades.includes(u.id)).map((u) => u.name);
  $('owned-upgrades').textContent = owned.length ? `Obtenidas: ${owned.join(', ')}` : '';

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

$('export').addEventListener('click', async () => {
  const text = serialize(state);
  try {
    await navigator.clipboard.writeText(text);
    showToast('Partida copiada al portapapeles.');
  } catch {
    window.prompt('Copia este texto para guardar tu partida:', text);
  }
});

$('import').addEventListener('click', () => {
  const text = window.prompt('Pega el texto de tu partida:');
  if (!text) return;
  const loaded = deserialize(text);
  if (!loaded) {
    showToast('Ese texto no es una partida válida.');
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

// Bucle principal: usa el tiempo real transcurrido para no perder producción en segundo plano.
let last = performance.now();
window.setInterval(() => {
  const now = performance.now();
  tick(state, (now - last) / 1000);
  last = now;
  announceUnlocks();
  village.update(state);
  render();
}, TICK_MS);

window.setInterval(save, AUTOSAVE_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
  sound.setActive(document.visibilityState === 'visible');
});
window.addEventListener('beforeunload', save);

village.update(state);
render();
if (offlineSeconds > 60) {
  showToast(`Mientras no estabas (${formatDuration(offlineSeconds)}) tu tribu siguió trabajando.`);
}
