import './style.css';
import { applyOfflineProgress, buyGatherer, foodPerSecond, gather, gathererCost, tick } from './game/logic';
import { deleteSave, deserialize, loadGame, saveGame, serialize } from './game/save';
import { newGame, type GameState } from './game/state';
import { formatDuration, formatNumber } from './game/format';

const TICK_MS = 100;
const AUTOSAVE_MS = 10_000;
const MAX_GATHERERS_DRAWN = 24;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  food: $('food'),
  foodRate: $('food-rate'),
  gather: $<HTMLButtonElement>('gather'),
  buyGatherer: $<HTMLButtonElement>('buy-gatherer'),
  gathererCount: $('gatherer-count'),
  gathererCost: $('gatherer-cost'),
  gatherersLayer: document.getElementById('gatherers-layer') as unknown as SVGGElement,
  saveStatus: $('save-status'),
  toast: $('toast'),
};

let state: GameState = loadGame() ?? newGame();
const offlineSeconds = applyOfflineProgress(state, Date.now());
if (offlineSeconds > 60) {
  showToast(`Mientras no estabas (${formatDuration(offlineSeconds)}) tu tribu siguió recolectando.`);
}

let toastTimer: number | undefined;
function showToast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove('visible'), 4000);
}

function floatText(text: string, x: number, y: number): void {
  const el = document.createElement('span');
  el.className = 'float';
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.append(el);
  el.addEventListener('animationend', () => el.remove());
}

// Cada recolector comprado aparece alrededor de la hoguera.
function drawGatherers(): void {
  const wanted = Math.min(state.gatherers, MAX_GATHERERS_DRAWN);
  const layer = ui.gatherersLayer;
  while (layer.childElementCount > wanted) layer.lastElementChild?.remove();
  while (layer.childElementCount < wanted) {
    const i = layer.childElementCount;
    const side = i % 2 === 0 ? -1 : 1;
    const x = 200 + side * (50 + Math.floor(i / 2) * 26);
    const y = 128 + (i % 3) * 6;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${x} ${y})`);
    g.innerHTML =
      '<circle cy="-22" r="5" fill="var(--person)" />' +
      '<path d="M-6 -16 H6 L4 0 H-4 Z" fill="var(--person)" />';
    layer.append(g);
  }
}

function render(): void {
  ui.food.textContent = formatNumber(Math.floor(state.food));
  ui.foodRate.textContent = `+${formatNumber(foodPerSecond(state))}/s`;
  const cost = gathererCost(state);
  ui.gathererCost.textContent = formatNumber(cost);
  ui.gathererCount.textContent = `(${state.gatherers})`;
  ui.buyGatherer.disabled = state.food < cost;
  drawGatherers();
}

function save(): void {
  saveGame(state);
  ui.saveStatus.textContent = `Guardado ${new Date().toLocaleTimeString('es')}`;
}

ui.gather.addEventListener('click', (event) => {
  gather(state);
  floatText('+1', event.clientX, event.clientY);
  render();
});

ui.buyGatherer.addEventListener('click', () => {
  if (buyGatherer(state)) render();
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
  save();
  render();
  showToast('Partida importada.');
});

$('reset').addEventListener('click', () => {
  if (!window.confirm('¿Seguro? Se perderá todo tu progreso.')) return;
  deleteSave();
  state = newGame();
  render();
});

// Bucle principal: se usa el tiempo real transcurrido para que pestañas en segundo plano no pierdan producción.
let last = performance.now();
window.setInterval(() => {
  const now = performance.now();
  tick(state, (now - last) / 1000);
  last = now;
  render();
}, TICK_MS);

window.setInterval(save, AUTOSAVE_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
window.addEventListener('beforeunload', save);

render();
