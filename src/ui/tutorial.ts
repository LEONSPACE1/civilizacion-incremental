// Tutoriales: una guía paso a paso que señala cada parte de la interfaz. El de inicio explica el
// juego al empezar por primera vez; los demás saltan la primera vez que se desbloquea una sección.
//
// REGLA: toda sección nueva del juego lleva aquí su tutorial (en TUTORIALS, con su condición) y sus
// textos en es.ts y en los cinco idiomas (locales/*.ts).
import { achievedCount } from '../game/achievements';
import { legacyUnlocked } from '../game/legacy';
import { canAfford, currentGoal, upgradeAvailable } from '../game/logic';
import { UPGRADE_DEFS } from '../game/content';
import { MIGRATED } from '../game/save';
import type { GameState } from '../game/state';
import { t } from '../i18n/i18n';
import type ES from '../i18n/es';

type Key = keyof typeof ES;

export interface TutorialStep {
  /** Elemento que se señala (selector CSS); sin él, la tarjeta sale en el centro. */
  target?: string;
  /** Pestaña de los paneles que se abre antes de señalar. */
  tab?: 'jobs' | 'upgrades' | 'goal';
  title: Key;
  text: Key;
}

export interface TutorialDef {
  id: string;
  /** Cuándo salta por primera vez. El de inicio no tiene condición: lo lanza la pantalla de inicio. */
  when?: (s: GameState) => boolean;
  steps: TutorialStep[];
}

const step = (name: string, target?: string, tab?: TutorialStep['tab']): TutorialStep => ({
  target, tab, title: `tut.${name}.title` as Key, text: `tut.${name}.text` as Key,
});

export const TUTORIALS: TutorialDef[] = [
  {
    id: 'intro',
    steps: [
      step('welcome'),
      step('scene', '#scene'),
      step('gather', '#gather'),
      step('hud', '#hud'),
      step('jobs', '#tabbtn-jobs', 'jobs'),
      step('buyAmount', '#buy-amount', 'jobs'),
      step('goal', '#tabbtn-goal'),
      step('header', '.header-actions'),
      step('go'),
    ],
  },
  { id: 'upgrades', when: (s) => UPGRADE_DEFS.some((u) => upgradeAvailable(s, u.id)), steps: [step('upgrades', '#tabbtn-upgrades', 'upgrades'), step('tree', '#open-tree', 'upgrades')] },
  { id: 'goalReady', when: (s) => !s.goalReached && canAfford(s, currentGoal(s).cost), steps: [step('goalReady', '#tabbtn-goal', 'goal')] },
  { id: 'newEra', when: (s) => s.era >= 2, steps: [step('newEra', '#hud'), step('oldEras', '#tabbtn-jobs', 'jobs')] },
  { id: 'achievements', when: (s) => achievedCount(s) > 0, steps: [step('achievements', '#open-achievements')] },
  { id: 'legacy', when: (s) => legacyUnlocked(s), steps: [step('legacy', '#open-legacy'), step('legacyShop', '#open-legacy')] },
  { id: 'reborn', when: (s) => s.legacy.rebirths > 0, steps: [step('reborn'), step('rebornShop', '#open-legacy')] },
];

/** Partida de antes de los tutoriales: marca como vistos los de todo lo que ya tiene desbloqueado. */
export function settleMigrated(s: GameState): void {
  const seen = s.profile.tutorials;
  if (!seen.includes(MIGRATED)) return;
  s.profile.tutorials = seen.filter((id) => id !== MIGRATED);
  for (const tut of TUTORIALS) if (tut.when?.(s) && !s.profile.tutorials.includes(tut.id)) s.profile.tutorials.push(tut.id);
}

/** El siguiente tutorial que toca enseñar, si hay alguno. */
export function dueTutorial(s: GameState): TutorialDef | undefined {
  // Hasta terminar el de inicio no salta ningún otro.
  if (!s.profile.tutorials.includes('intro')) return undefined;
  return TUTORIALS.find((tut) => tut.when && !s.profile.tutorials.includes(tut.id) && tut.when(s));
}

interface CoachOptions {
  showTab: (tab: NonNullable<TutorialStep['tab']>) => void;
  onDone: (id: string) => void;
}

/** La guía en pantalla: oscurece todo menos lo que señala y muestra una tarjeta con el texto. */
export function createCoach(options: CoachOptions) {
  const root = document.createElement('div');
  root.className = 'coach';
  root.hidden = true;
  root.innerHTML =
    `<div class="coach-hole"></div>` +
    `<div class="coach-card" role="dialog" aria-modal="true" aria-labelledby="coach-title">` +
    `<p class="coach-count"></p><h3 id="coach-title"></h3><p class="coach-text"></p>` +
    `<div class="coach-actions"><button type="button" class="coach-skip"></button><button type="button" class="coach-next stone-btn"></button></div></div>`;
  document.body.append(root);
  const hole = root.querySelector('.coach-hole') as HTMLElement;
  const card = root.querySelector('.coach-card') as HTMLElement;
  const count = root.querySelector('.coach-count') as HTMLElement;
  const title = root.querySelector('h3') as HTMLElement;
  const text = root.querySelector('.coach-text') as HTMLElement;
  const skip = root.querySelector('.coach-skip') as HTMLButtonElement;
  const next = root.querySelector('.coach-next') as HTMLButtonElement;

  let current: TutorialDef | null = null;
  let index = 0;

  function place(): void {
    if (!current) return;
    const s = current.steps[index];
    const target = s.target ? (document.querySelector(s.target) as HTMLElement | null) : null;
    const visible = target && target.offsetParent !== null && target.getBoundingClientRect().width > 0;
    root.classList.toggle('centered', !visible);
    if (!visible) {
      hole.style.cssText = '';
      card.style.cssText = '';
      return;
    }
    const r = target!.getBoundingClientRect();
    const pad = 6;
    Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = Math.min(360, vw - 24);
    const ch = card.offsetHeight || 180;
    // Debajo de lo señalado si cabe; si no, encima; si tampoco, sobre la parte de abajo de la pantalla.
    let top = r.bottom + 14;
    if (top + ch > vh - 12) top = r.top - ch - 14;
    if (top < 12) top = Math.max(12, vh - ch - 12);
    const left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), vw - cw - 12);
    Object.assign(card.style, { left: `${left}px`, top: `${top}px`, width: `${cw}px` });
  }

  function show(): void {
    if (!current) return;
    const s = current.steps[index];
    if (s.tab) options.showTab(s.tab);
    const last = index === current.steps.length - 1;
    count.textContent = current.steps.length > 1 ? t('tut.count', { i: index + 1, n: current.steps.length }) : '';
    title.textContent = t(s.title);
    text.textContent = t(s.text);
    next.textContent = last ? t('tut.done') : t('tut.next');
    skip.textContent = t('tut.skip');
    skip.hidden = last;
    const target = s.target ? (document.querySelector(s.target) as HTMLElement | null) : null;
    target?.scrollIntoView({ block: 'nearest' });
    place();
    // La tarjeta mide distinto con cada texto: se vuelve a colocar cuando ya tiene su tamaño.
    requestAnimationFrame(place);
    next.focus({ preventScroll: true });
  }

  function finish(): void {
    if (!current) return;
    const id = current.id;
    current = null;
    root.hidden = true;
    document.body.classList.remove('coaching');
    options.onDone(id);
  }

  next.addEventListener('click', () => {
    if (!current) return;
    if (index < current.steps.length - 1) {
      index++;
      show();
    } else finish();
  });
  skip.addEventListener('click', finish);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);

  return {
    get active() {
      return current !== null;
    },
    start(tut: TutorialDef): void {
      current = tut;
      index = 0;
      root.hidden = false;
      document.body.classList.add('coaching');
      show();
    },
  };
}
