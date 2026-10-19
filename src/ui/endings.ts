// Finales. Al lanzar el cohete termina la civilización: un final que invita a renacer y a usar el
// Legado. Si además el juego está al 100 % (todos los logros), es el final verdadero: un resumen de
// todas las civilizaciones y sus récords, unos créditos rápidos y una escena de agradecimiento.
import { completion } from '../game/achievements';
import { ERA_BY_N, RESOURCE_DEFS } from '../game/content';
import { formatDuration, formatNumber } from '../game/format';
import { wisdomForRun } from '../game/legacy';
import { civRecord } from '../game/logic';
import type { CivRecord } from '../game/profile';
import { LAST_ERA, RESOURCES, type GameState } from '../game/state';
import { t } from '../i18n/i18n';
import { ICONS, RESOURCE_ICONS } from './icons';

interface EndingOptions {
  getState: () => GameState;
  openLegacy: () => void;
  rebirth: () => void;
  /** Al abrirse y cerrarse (para parar la aldea y la música). */
  onToggle: (open: boolean) => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function createEndings(options: EndingOptions) {
  const root = document.createElement('div');
  root.className = 'ending';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `<div class="ending-sky" aria-hidden="true"><div class="stars s1"></div><div class="stars s2"></div><div class="ending-rocket">${rocketSvg()}</div></div><div class="ending-scroll"><div class="ending-page"></div></div>`;
  document.body.append(root);
  const page = root.querySelector('.ending-page') as HTMLElement;
  const scroller = root.querySelector('.ending-scroll') as HTMLElement;

  function open(): void {
    root.hidden = false;
    void root.offsetWidth;
    root.classList.add('show');
    options.onToggle(true);
  }
  function close(): void {
    root.classList.remove('show');
    root.hidden = true;
    root.removeAttribute('data-scene');
    options.onToggle(false);
  }
  function scene(name: string, html: string): void {
    root.dataset.scene = name;
    page.innerHTML = html;
    page.classList.remove('enter');
    void page.offsetWidth;
    page.classList.add('enter');
    scroller.scrollTop = 0;
    (page.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }
  function on(selector: string, fn: () => void): void {
    page.querySelector(selector)?.addEventListener('click', fn);
  }
  /** Botones comunes al final: renacer, abrir el Legado y quedarse. */
  function bindActions(): void {
    on('.e-rebirth', () => {
      close();
      options.rebirth();
    });
    on('.e-legacy', () => {
      close();
      options.openLegacy();
    });
    on('.e-stay', close);
  }
  const actions = (s: GameState) =>
    `<div class="ending-actions"><button type="button" class="stone-btn e-rebirth">${esc(t('end.rebirthNow', { w: wisdomForRun(s) }))}</button>` +
    `<button type="button" class="stone-btn e-legacy">${esc(t('end.openLegacy'))}</button>` +
    `<button type="button" class="e-stay link-btn">${esc(t('end.stay'))}</button></div>`;

  /** Final de una civilización que lanza el cohete. */
  function rocketEnding(): void {
    const s = options.getState();
    const civ = civRecord(s);
    const first = !s.profile.endings.rocket;
    s.profile.endings.rocket = true;
    const pct = Math.floor(completion(s) * 100);
    scene('rocket',
      `<p class="ending-kicker">${esc(t('end.kicker', { n: civ.n }))}</p>` +
      `<h2>${esc(t('end.rocketTitle'))}</h2>` +
      `<p class="ending-lead">${esc(t('end.rocketStory'))}</p>` +
      `<div class="ending-stats">` +
      stat(t('end.statTime'), formatDuration(civ.seconds)) +
      stat(t('end.statEras'), `${LAST_ERA}/${LAST_ERA}`) +
      stat(t('end.statPop'), formatNumber(civ.population)) +
      stat(t('end.statWisdom'), `+${civ.wisdom}`) +
      `</div>` +
      `<p>${esc(first ? t('end.rocketInvite') : t('end.rocketAgain'))}</p>` +
      `<p class="ending-progress">${esc(t('end.progress', { pct }))}</p>` +
      `<div class="ending-bar"><span style="width:${pct}%"></span></div>` +
      actions(s) +
      (s.profile.endings.true ? `<button type="button" class="link-btn e-true">${esc(t('end.replayTrue'))}</button>` : ''));
    bindActions();
    on('.e-true', () => trueEnding());
  }

  /** El final verdadero: resumen, créditos y agradecimiento. */
  function trueEnding(): void {
    const s = options.getState();
    s.profile.endings.true = true;
    s.profile.endings.rocket = true;
    scene('true-1',
      `<p class="ending-kicker">${esc(t('end.trueKicker'))}</p>` +
      `<h2>${esc(t('end.trueTitle'))}</h2>` +
      `<p class="ending-lead">${esc(t('end.trueStory1'))}</p>` +
      `<p>${esc(t('end.trueStory2'))}</p>` +
      `<div class="ending-actions"><button type="button" class="stone-btn e-next">${esc(t('end.continue'))}</button></div>`);
    on('.e-next', summary);
  }

  function summary(): void {
    const s = options.getState();
    const civs: CivRecord[] = [...s.profile.civs, civRecord(s)];
    const unknown = Math.max(0, s.legacy.rebirths + 1 - civs.length);
    const rows = civs.map((c) =>
      `<li><b>${esc(t('end.civ', { n: c.n }))}</b><span>${esc(c.rocket ? t('end.civRocket') : t('end.civEra', { era: ERA_BY_N[c.era]?.name ?? c.era }))}</span><span>${esc(formatDuration(c.seconds))}</span></li>`).join('');
    const records = RESOURCES.filter((r) => s.profile.maxRate[r] > 0).map((r) => {
      const name = RESOURCE_DEFS.find((d) => d.id === r)!.name;
      return `<li><span class="er-icon">${ICONS[RESOURCE_ICONS[r]]}</span><span>${esc(name)}</span><b>${esc(t('end.perSecond', { v: formatNumber(s.profile.maxRate[r]) }))}</b></li>`;
    }).join('');
    scene('true-2',
      `<h2>${esc(t('end.summaryTitle'))}</h2>` +
      `<div class="ending-stats">` +
      stat(t('end.statCivs'), String(s.legacy.rebirths + 1)) +
      stat(t('end.statRockets'), String(s.profile.rockets)) +
      stat(t('end.statPlay'), formatDuration(s.profile.playSeconds)) +
      stat(t('end.statClicks'), formatNumber(s.profile.clicks)) +
      stat(t('end.statMaxPop'), formatNumber(s.profile.maxPopulation)) +
      `</div>` +
      `<h3>${esc(t('end.civsTitle'))}</h3><ol class="ending-civs">${rows}</ol>` +
      (unknown ? `<p class="ending-note">${esc(t('end.civsUnknown', { n: unknown }))}</p>` : '') +
      `<h3>${esc(t('end.recordsTitle'))}</h3><ul class="ending-records">${records}</ul>` +
      `<p class="ending-lead">${esc(t('end.summaryOutro'))}</p>` +
      `<div class="ending-actions"><button type="button" class="stone-btn e-next">${esc(t('end.continue'))}</button></div>`);
    on('.e-next', credits);
  }

  function credits(): void {
    const lines: [string, string][] = [
      [t('credits.idea'), 'Juan (LEONSPACE1)'],
      [t('credits.code'), t('credits.codeWho')],
      [t('credits.graphics'), 'Three.js'],
      [t('credits.sound'), t('credits.soundWho')],
      [t('credits.fonts'), 'Google Fonts · Caveat Brush · Amatic SC · Cinzel · Marcellus · MedievalSharp · Cormorant Garamond · Alfa Slab One · Exo 2 · Nunito'],
      [t('credits.tests'), 'Juan'],
      [t('credits.you'), t('credits.youWho')],
    ];
    scene('credits',
      `<div class="credits-roll"><h2>De la Chispa a las Estrellas</h2>` +
      lines.map(([a, b]) => `<p class="credit"><span>${esc(a)}</span><b>${esc(b)}</b></p>`).join('') +
      `</div><div class="ending-actions"><button type="button" class="link-btn e-next">${esc(t('end.skip'))}</button></div>`);
    const roll = page.querySelector('.credits-roll') as HTMLElement;
    let done = false;
    const next = () => {
      if (done) return;
      done = true;
      thanks();
    };
    roll.addEventListener('animationend', next);
    // Con movimiento reducido no hay animación: los créditos se leen quietos unos segundos.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) window.setTimeout(next, 6000);
    on('.e-next', next);
  }

  function thanks(): void {
    const s = options.getState();
    scene('thanks',
      `<div class="thanks-mark" aria-hidden="true">${ICONS.fire}</div>` +
      `<h2>${esc(t('end.thanksTitle'))}</h2>` +
      `<p class="ending-lead">${esc(t('end.thanksText'))}</p>` +
      actions(s));
    bindActions();
  }

  return {
    get open() {
      return !root.hidden;
    },
    /** Lanza el final que toca tras el cohete. */
    show(truly: boolean): void {
      open();
      if (truly) trueEnding();
      else rocketEnding();
    },
    close,
  };
}

const stat = (label: string, value: string) => `<div class="ending-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;

function rocketSvg(): string {
  return `<svg viewBox="0 0 40 120" width="40" height="120"><path d="M20 4c9 12 12 28 12 46v34H8V50C8 32 11 16 20 4z" fill="#eef2f7" stroke="#9aa6b8" stroke-width="2"/>` +
    `<circle cx="20" cy="44" r="6" fill="#4aa3ff" stroke="#9aa6b8" stroke-width="2"/><path d="M8 66L0 90h8zM32 66l8 24h-8z" fill="#d6453a"/>` +
    `<path class="flame" d="M11 86h18l-9 32z" fill="#ffb02e"/><path class="flame" d="M15 86h10l-5 20z" fill="#fff1a8"/></svg>`;
}
