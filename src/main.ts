import './style.css';
import { BUILDING_DEFS, ERA1_GOAL, RESOURCE_DEFS, UPGRADE_DEFS } from './game/content';
import {
  applyOfflineProgress,
  buildingCost,
  buyBuilding,
  buyGoal,
  buyUpgrade,
  canAfford,
  clickAmount,
  gather,
  nextMilestone,
  ratePerSecond,
  tick,
  unitRate,
  upgradeAvailable,
} from './game/logic';
import { deleteSave, deserialize, loadGame, saveGame, serialize } from './game/save';
import { newGame, RESOURCES, type Cost, type GameState } from './game/state';
import { formatDuration, formatNumber } from './game/format';
import { createVillage } from './scene/village';

const TICK_MS = 100;
const AUTOSAVE_MS = 10_000;
const RESOURCE_NAME = Object.fromEntries(RESOURCE_DEFS.map((r) => [r.id, r.name.toLowerCase()])) as Record<string, string>;

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
  chip.innerHTML = `${r.name} <b></b> <small></small>`;
  hud.append(chip);
  return { id: r.id, value: chip.querySelector('b')!, rate: chip.querySelector('small')! };
});

// ---------- Edificios ----------
const buildingCards = BUILDING_DEFS.map((def) => {
  const card = el('button', 'card');
  card.innerHTML = `<span class="name"></span><span class="count"></span><span class="desc"></span><span class="meta"></span><span class="cost"></span>`;
  card.addEventListener('click', () => {
    if (buyBuilding(state, def.id)) {
      village.update(state);
      render();
    }
  });
  $('buildings').append(card);
  const q = (s: string) => card.querySelector(s) as HTMLElement;
  return { def, card, name: q('.name'), count: q('.count'), desc: q('.desc'), meta: q('.meta'), cost: q('.cost') };
});

// ---------- Mejoras ----------
const upgradeCards = UPGRADE_DEFS.map((def) => {
  const card = el('button', 'card upgrade');
  card.innerHTML = `<span class="name">${def.name}</span><span class="desc">${def.description}</span><span class="cost"></span>`;
  card.addEventListener('click', () => {
    if (buyUpgrade(state, def.id)) {
      showToast(`Mejora obtenida: ${def.name}`);
      village.update(state);
      render();
    }
  });
  $('upgrades').append(card);
  return { def, card, cost: card.querySelector('.cost') as HTMLElement };
});

// ---------- Meta de la era ----------
const goalPanel = $('goal');
function renderGoal(): void {
  if (state.goalReached) {
    goalPanel.classList.add('done');
    goalPanel.innerHTML = `<h2>¡Era 1 completada!</h2><p>Tu tribu ha descubierto la agricultura. El Neolítico llegará en la próxima actualización del juego; mientras tanto puedes seguir haciendo crecer tu aldea.</p>`;
    return;
  }
  if (!goalPanel.dataset.built) {
    goalPanel.dataset.built = '1';
    goalPanel.innerHTML = `<h2>Meta de la era: ${ERA1_GOAL.name}</h2><p>${ERA1_GOAL.description}</p><div class="rows"></div><button class="go">Descubrir la agricultura</button>`;
    goalPanel.querySelector('.go')!.addEventListener('click', () => {
      if (buyGoal(state)) {
        showToast('¡Has descubierto la agricultura! Era 1 completada.');
        village.update(state);
        save();
        render();
      }
    });
  }
  const rows = goalPanel.querySelector('.rows')!;
  rows.innerHTML = RESOURCES.filter((r) => ERA1_GOAL.cost[r])
    .map((r) => {
      const need = ERA1_GOAL.cost[r]!, have = Math.min(state.resources[r], need);
      return `<div class="row"><div><span>${RESOURCE_DEFS.find((d) => d.id === r)!.name}</span><span>${formatNumber(Math.floor(have))} / ${formatNumber(need)}</span></div><div class="bar"><span style="width:${(have / need) * 100}%"></span></div></div>`;
    })
    .join('');
  (goalPanel.querySelector('.go') as HTMLButtonElement).disabled = !canAfford(state, ERA1_GOAL.cost);
}

// ---------- Dibujo ----------
function render(): void {
  const rates = ratePerSecond(state);
  for (const c of chips) {
    c.value.textContent = formatNumber(Math.floor(state.resources[c.id]));
    c.rate.textContent = `+${formatNumber(rates[c.id])}/s`;
  }
  $('gather-amount').textContent = `+${formatNumber(clickAmount(state))}`;

  let shownLocked = false;
  for (const b of buildingCards) {
    const unlocked = b.def.unlocked(state);
    // Solo se anticipa el siguiente edificio bloqueado, para no saturar la lista.
    b.card.hidden = !unlocked && shownLocked;
    if (!unlocked) {
      shownLocked = true;
      b.card.classList.add('locked');
      b.card.disabled = true;
      b.name.textContent = '???';
      b.count.textContent = '';
      b.desc.textContent = `Se desbloquea: ${b.def.unlockHint.toLowerCase()}`;
      b.meta.textContent = '';
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
    b.meta.textContent = `+${formatNumber(unitRate(state, b.def.id))} ${RESOURCE_NAME[b.def.produces]}/s cada uno${next ? ` · con ${next} produce el doble` : ''}`;
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
}

function save(): void {
  saveGame(state);
  $('save-status').textContent = `Guardado ${new Date().toLocaleTimeString('es')}`;
}

// ---------- Acciones ----------
$('gather').addEventListener('click', (event) => {
  const amount = gather(state);
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
  showToast('Partida importada.');
});

$('reset').addEventListener('click', () => {
  if (!window.confirm('¿Seguro? Se perderá todo tu progreso.')) return;
  deleteSave();
  state = newGame();
  village.update(state);
  render();
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
    }
  }
  for (const u of UPGRADE_DEFS) {
    if (!seenUnlocks.has(u.id) && upgradeAvailable(state, u.id)) {
      seenUnlocks.add(u.id);
      showToast(`Nueva mejora disponible: ${u.name}`);
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
  render();
}, TICK_MS);

window.setInterval(save, AUTOSAVE_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
window.addEventListener('beforeunload', save);

village.update(state);
render();
if (offlineSeconds > 60) {
  showToast(`Mientras no estabas (${formatDuration(offlineSeconds)}) tu tribu siguió trabajando.`);
}
