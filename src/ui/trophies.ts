// Ventana de logros: el avance del juego en % y cada logro por grupos, los conseguidos en color y
// los pendientes en sombra con su barra de avance, para que el jugador sepa qué le falta.
import { ACH_GROUPS, ACHIEVEMENTS, achievedCount, completion, type AchievementDef } from '../game/achievements';
import { ERA_BY_N } from '../game/content';
import { formatNumber } from '../game/format';
import type { GameState } from '../game/state';
import { getLang, t } from '../i18n/i18n';
import type ES from '../i18n/es';
import { ICONS, type IconId } from './icons';

type Key = keyof typeof ES;

const GROUP_ICON: Record<string, IconId> = { history: 'scroll', tribe: 'person', upgrades: 'hammer', production: 'fire', legacy: 'scroll', feats: 'trophy' };

/** Nombre y descripción del logro, con sus cifras y su era. */
export function achievementText(a: AchievementDef): { name: string; desc: string } {
  const p: Record<string, string | number> = { ...a.params };
  // Las cifras pequeñas (personas, clics, horas) se escriben enteras: «2.000», no «2,00K».
  if (a.params?.n !== undefined) p.n = a.params.n < 1e6 ? a.params.n.toLocaleString(getLang()) : formatNumber(a.params.n);
  if (a.params?.era !== undefined) {
    p.num = a.params.era;
    p.era = ERA_BY_N[a.params.era].name;
  }
  return { name: t(`ach.${a.key}.name` as Key, p), desc: t(`ach.${a.key}.desc` as Key, p) };
}

export function createTrophies(getState: () => GameState) {
  const dialog = document.getElementById('achievements') as HTMLDialogElement;
  const list = dialog.querySelector('.ach-list') as HTMLElement;
  const pctEl = dialog.querySelector('.ach-pct') as HTMLElement;
  const countEl = dialog.querySelector('.ach-count') as HTMLElement;
  const fill = dialog.querySelector('.ach-bar span') as HTMLElement;
  const close = dialog.querySelector('.close') as HTMLButtonElement;
  close.innerHTML = ICONS.close;
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  const items = new Map<string, { li: HTMLElement; bar: HTMLElement | null; fill: HTMLElement | null; prog: HTMLElement | null }>();
  for (const g of ACH_GROUPS) {
    const section = document.createElement('section');
    section.className = 'ach-group';
    section.innerHTML = `<h3><span class="ach-gicon" aria-hidden="true">${ICONS[GROUP_ICON[g]]}</span>${t(`achGroup.${g}` as Key)}<small></small></h3><ul></ul>`;
    const ul = section.querySelector('ul')!;
    for (const a of ACHIEVEMENTS.filter((x) => x.group === g)) {
      const { name, desc } = achievementText(a);
      const li = document.createElement('li');
      li.className = 'ach';
      li.innerHTML = `<span class="ach-medal" aria-hidden="true">${ICONS.trophy}</span><span class="ach-body"><b></b><span class="ach-desc"></span>` +
        (a.progress ? `<span class="ach-prog"><span class="ach-pbar"><span></span></span><small></small></span>` : '') + `</span>`;
      li.querySelector('b')!.textContent = name;
      li.querySelector('.ach-desc')!.textContent = desc;
      ul.append(li);
      items.set(a.id, { li, bar: li.querySelector('.ach-prog'), fill: li.querySelector('.ach-pbar span'), prog: li.querySelector('.ach-prog small') });
    }
    list.append(section);
  }

  function update(): void {
    if (!dialog.open) return;
    const s = getState();
    const pct = Math.floor(completion(s) * 100);
    pctEl.textContent = `${pct} %`;
    countEl.textContent = t('ach.count', { have: achievedCount(s), total: ACHIEVEMENTS.length });
    fill.style.width = `${pct}%`;
    for (const section of list.querySelectorAll<HTMLElement>('.ach-group')) {
      const lis = [...section.querySelectorAll('.ach')];
      const got = lis.filter((li) => li.classList.contains('got')).length;
      section.querySelector('small')!.textContent = ` ${got}/${lis.length}`;
    }
    for (const a of ACHIEVEMENTS) {
      const it = items.get(a.id)!;
      const got = s.profile.achievements.includes(a.id);
      it.li.classList.toggle('got', got);
      if (it.bar) {
        it.bar.hidden = got;
        if (!got && a.progress) {
          const [have, need] = a.progress(s);
          it.fill!.style.width = `${Math.min(100, (have / need) * 100)}%`;
          it.prog!.textContent = `${formatNumber(Math.floor(have))} / ${formatNumber(need)}`;
        }
      }
    }
  }

  return {
    open(): void {
      dialog.showModal();
      update();
      update(); // la segunda pasada cuenta ya los conseguidos de cada grupo
    },
    update,
  };
}
