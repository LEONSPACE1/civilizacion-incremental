import { BUILDING_BY_ID, BUILDING_DEFS, ERA_BY_N, ERA_DEFS, GOALS, RESOURCE_DEFS, UPGRADE_DEFS, requirementProgress, type UpgradeDef } from '../game/content';
import { canAfford, upgradeAvailable } from '../game/logic';
import { formatNumber } from '../game/format';
import { RESOURCES, type BuildingId, type Cost, type GameState } from '../game/state';
import { BUILDING_ICONS, ERA_ICONS, ICONS, UPGRADE_ICONS, type IconId } from './icons';

// Vista ampliada de las mejoras: un árbol pintado en la pared de la cueva. Cada rama es un
// oficio con sus mejoras debajo; lo que aún no se ha descubierto aparece en sombra con "?".

type NodeRef = { kind: 'root' } | { kind: 'tribe' } | { kind: 'building'; id: BuildingId } | { kind: 'upgrade'; def: UpgradeDef } | { kind: 'goal' };
type NodeState = 'owned' | 'available' | 'locked';

interface TreeNode {
  ref: NodeRef;
  el: HTMLButtonElement;
  disc: HTMLElement;
  label: HTMLElement;
  sub: HTMLElement;
}

interface TreeOptions {
  getState: () => GameState;
  costHtml: (cost: Cost) => string;
  buyUpgrade: (def: UpgradeDef) => void;
}

const resourceName = (id: string) => RESOURCE_DEFS.find((r) => r.id === id)!.name.toLowerCase();

function requirementText(s: GameState, def: UpgradeDef): string {
  const r = def.requires;
  const { have, need } = requirementProgress(s, r);
  if ('building' in r) {
    const b = BUILDING_BY_ID[r.building];
    if (!b.unlocked(s)) return 'Descubre primero un nuevo oficio.';
    return `Ten ${need} ${b.plural} (llevas ${have}).`;
  }
  return `Reúne ${formatNumber(need)} de ${resourceName(r.total)} en total (llevas ${formatNumber(Math.floor(have))}).`;
}

export function createUpgradeTree(options: TreeOptions) {
  const dialog = document.getElementById('tree-dialog') as HTMLDialogElement;
  const grid = document.getElementById('tree-grid')!;
  const detail = document.getElementById('tree-detail')!;
  const closeBtn = dialog.querySelector('.close') as HTMLButtonElement;
  closeBtn.innerHTML = ICONS.close;
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  const tabsEl = document.getElementById('tree-tabs')!;
  const nodes: TreeNode[] = [];
  let selected: TreeNode | null = null;
  let era = 1;

  function makeNode(ref: NodeRef, extraClass = ''): TreeNode {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `node ${extraClass}`;
    el.innerHTML = `<span class="disc"></span><span class="label"></span><span class="sub"></span>`;
    const node: TreeNode = { ref, el, disc: el.querySelector('.disc')!, label: el.querySelector('.label')!, sub: el.querySelector('.sub')! };
    el.addEventListener('click', () => {
      selected = node;
      update();
    });
    nodes.push(node);
    return node;
  }

  // Una pestaña por era. Dentro: raíz, ramas por oficio (más una para toda la tribu) y la meta al final.
  const tabs = ERA_DEFS.map((e) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tree-tab';
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => {
      if (e.n > options.getState().era) return;
      build(e.n);
      update();
    });
    tabsEl.append(tab);
    return { n: e.n, tab };
  });

  function build(n: number): void {
    era = n;
    nodes.length = 0;
    grid.replaceChildren();
    const eraBuildings = BUILDING_DEFS.filter((b) => b.era === n);
    grid.style.setProperty('--cols', String(eraBuildings.length + 1));
    const root = makeNode({ kind: 'root' }, 'header root');
    const top = document.createElement('div');
    top.className = 'tree-cap';
    top.append(root.el);
    grid.append(top, Object.assign(document.createElement('div'), { className: 'tree-rail' }));
    const branchKeys: (BuildingId | 'tribe')[] = ['tribe', ...eraBuildings.map((b) => b.id)];
    for (const key of branchKeys) {
      const branch = document.createElement('div');
      branch.className = 'branch';
      branch.append(makeNode(key === 'tribe' ? { kind: 'tribe' } : { kind: 'building', id: key }, 'header').el);
      const ups = UPGRADE_DEFS.filter((u) => u.era === n && (u.effect.kind === 'building' ? u.effect.building === key : key === 'tribe'));
      for (const def of ups) branch.append(makeNode({ kind: 'upgrade', def }).el);
      // En el móvil la línea de la rama llega hasta el último nodo de la primera fila.
      branch.style.setProperty('--n', String(ups.length + 1));
      grid.append(branch);
    }
    grid.append(Object.assign(document.createElement('div'), { className: 'tree-rail' }));
    const goal = makeNode({ kind: 'goal' }, 'header goal-node');
    const bottom = document.createElement('div');
    bottom.className = 'tree-cap bottom';
    bottom.append(goal.el);
    grid.append(bottom);
    selected = root;
    delete detail.dataset.html;
  }

  function describe(n: TreeNode, s: GameState): { state: NodeState; icon: IconId; label: string; sub: string } {
    const ref = n.ref;
    switch (ref.kind) {
      case 'root':
        return { state: 'owned', icon: ERA_ICONS[era].root, label: `Era ${era} · ${ERA_BY_N[era].name}`, sub: era === 1 ? 'El origen de tu tribu' : 'Tu tribu se asienta' };
      case 'tribe':
        return { state: 'owned', icon: 'person', label: 'Toda la tribu', sub: 'Mejoras generales' };
      case 'building': {
        const def = BUILDING_BY_ID[ref.id];
        if (!def.unlocked(s)) return { state: 'locked', icon: BUILDING_ICONS[ref.id], label: '???', sub: 'Oficio por descubrir' };
        return { state: 'owned', icon: BUILDING_ICONS[ref.id], label: def.name, sub: `${s.buildings[ref.id]} en la tribu` };
      }
      case 'upgrade': {
        const icon = UPGRADE_ICONS[ref.def.id] ?? 'fire';
        if (s.upgrades.includes(ref.def.id)) return { state: 'owned', icon, label: ref.def.name, sub: 'Obtenida' };
        if (upgradeAvailable(s, ref.def.id)) return { state: 'available', icon, label: ref.def.name, sub: canAfford(s, ref.def.cost) ? '¡Puedes comprarla!' : 'Disponible' };
        return { state: 'locked', icon, label: '???', sub: '' };
      }
      case 'goal': {
        const goal = GOALS[era], icon = ERA_ICONS[era].goal;
        if (s.era > era || s.goalReached) return { state: 'owned', icon, label: goal.name, sub: 'Era completada' };
        const pct = Math.min(...RESOURCES.filter((r) => goal.cost[r]).map((r) => s.resources[r] / goal.cost[r]!));
        return { state: 'available', icon, label: goal.name, sub: `Meta de la era · ${Math.floor(Math.min(1, pct) * 100)} %` };
      }
    }
  }

  function renderDetail(n: TreeNode, s: GameState): void {
    const d = describe(n, s);
    const ref = n.ref;
    let title = d.label, text = '', extra = '', button = '';
    if (ref.kind === 'root') {
      text = era === 1
        ? 'Desde este fuego crece todo lo demás. Cada rama es un oficio y debajo están sus mejoras.'
        : 'La aldea del Neolítico: campos, rebaños y casas de barro. Cada rama es un oficio y debajo están sus mejoras.';
    }
    else if (ref.kind === 'tribe') text = 'Mejoras que ayudan a toda la tribu a la vez, no a un solo oficio.';
    else if (ref.kind === 'building') {
      const def = BUILDING_BY_ID[ref.id];
      if (d.state === 'locked') {
        title = 'Oficio por descubrir';
        text = `Se desbloquea: ${def.unlockHint.toLowerCase()}.`;
      } else text = `${def.description} Produce ${resourceName(def.produces)}.`;
    } else if (ref.kind === 'upgrade') {
      if (d.state === 'locked') {
        title = 'Mejora por descubrir';
        text = requirementText(s, ref.def);
      } else {
        text = ref.def.description;
        if (d.state === 'available') {
          extra = `<p class="detail-cost">Coste: ${options.costHtml(ref.def.cost)}</p>`;
          button = `<button type="button" class="stone-btn buy" ${canAfford(s, ref.def.cost) ? '' : 'disabled'}>Comprar mejora</button>`;
        }
      }
    } else {
      text = GOALS[era].description;
      if (d.state !== 'owned') extra = `<p class="detail-cost">Coste: ${options.costHtml(GOALS[era].cost)}</p>`;
    }
    const html = `<span class="disc ${d.state}">${ICONS[d.icon]}${d.state === 'locked' ? '<span class="q">?</span>' : ''}</span>` +
      `<div class="detail-text"><h3>${title}</h3><p>${text}</p>${extra}</div>${button}`;
    if (detail.dataset.html !== html) {
      detail.dataset.html = html;
      detail.innerHTML = html;
      detail.querySelector('.buy')?.addEventListener('click', () => {
        if (ref.kind === 'upgrade') options.buyUpgrade(ref.def);
      });
    }
  }

  function update(): void {
    if (!dialog.open) return;
    const s = options.getState();
    for (const t of tabs) {
      const open = t.n <= s.era;
      const label = open ? `Era ${t.n} · ${ERA_BY_N[t.n].name}` : `Era ${t.n} · ???`;
      if (t.tab.textContent !== label) t.tab.textContent = label;
      t.tab.disabled = !open;
      t.tab.setAttribute('aria-selected', String(t.n === era));
    }
    for (const n of nodes) {
      const d = describe(n, s);
      const affordable = n.ref.kind === 'upgrade' && d.state === 'available' && canAfford(s, n.ref.def.cost);
      const cls = `${d.state}${affordable ? ' affordable' : ''}${n === selected ? ' selected' : ''}`;
      if (n.el.dataset.cls !== cls) {
        n.el.dataset.cls = cls;
        n.el.classList.remove('owned', 'available', 'locked', 'affordable', 'selected');
        n.el.classList.add(...cls.split(' '));
      }
      const disc = ICONS[d.icon] + (d.state === 'locked' ? '<span class="q">?</span>' : '') + (d.state === 'owned' && n.ref.kind === 'upgrade' ? '<span class="badge">✓</span>' : '');
      if (n.disc.dataset.html !== disc) {
        n.disc.dataset.html = disc;
        n.disc.innerHTML = disc;
      }
      n.label.textContent = d.label;
      n.sub.textContent = d.sub;
      n.el.setAttribute('aria-label', `${d.label}. ${d.sub}`);
    }
    if (selected) renderDetail(selected, s);
  }

  return {
    open(): void {
      build(options.getState().era);
      dialog.showModal();
      update();
    },
    update,
  };
}
