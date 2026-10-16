import * as THREE from 'three';
import type { BuildingId, GameState } from '../game/state';

// Escena 3D low poly de la era 1. Lee el estado del juego y hace crecer la aldea;
// nunca lo modifica.

const POND = new THREE.Vector2(11, -7);
const MAX_SHOWN: Record<BuildingId, number> = { gatherer: 10, woodcutter: 10, hunter: 8, fisher: 6 };

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1, metalness: 0, ...extra });

function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 + 0.4) * 1.4 + Math.sin((x + z) * 0.09) * 1.6 + Math.cos(x * 0.5 - z * 0.3) * 0.35;
  h *= THREE.MathUtils.smoothstep(r, 5, 15);
  h += Math.max(0, r - 24) * 0.35;
  const pd = Math.hypot(x - POND.x, z - POND.y);
  if (pd < 5.5) h = Math.min(h, -0.6 + (pd / 5.5) * 0.6);
  return h;
}

/** Objeto que aparece con una pequeña animación de crecimiento. */
interface Spawned {
  obj: THREE.Object3D;
  born: number;
  scale: number;
}

export interface Village {
  update(state: GameState): void;
  /** Pequeño destello de la hoguera al recolectar. */
  pulse(): void;
  dispose(): void;
}

export function createVillage(container: HTMLElement): Village {
  const canvas = document.createElement('canvas');
  canvas.className = 'scene-canvas';
  canvas.setAttribute('aria-label', 'Tu aldea en 3D');
  container.prepend(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    canvas.remove();
    container.classList.add('no-3d');
    return { update() {}, pulse() {}, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const rng = mulberry32(7);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x3a2a52, 28, 85);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
  const add = <T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0, shadow = true): T => {
    o.position.set(x, y, z);
    if (shadow) o.traverse((c) => { c.castShadow = true; c.receiveShadow = true; });
    scene.add(o);
    return o;
  };

  // Cielo, estrellas y luna
  const skyGeo = new THREE.SphereGeometry(200, 24, 16);
  const skyColors: number[] = [];
  const top = new THREE.Color(0x0f0b24), mid = new THREE.Color(0x3a2558), hor = new THREE.Color(0xc8645a);
  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const y = skyGeo.attributes.position.getY(i) / 200;
    const c = y > 0.25 ? mid.clone().lerp(top, Math.min(1, (y - 0.25) / 0.5)) : hor.clone().lerp(mid, Math.max(0, (y + 0.05) / 0.3));
    skyColors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
  scene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));
  const starPos: number[] = [];
  for (let i = 0; i < 500; i++) {
    const th = rng() * Math.PI * 2, ph = Math.acos(rng() * 0.85 + 0.12);
    starPos.push(Math.cos(th) * Math.sin(ph) * 180, Math.cos(ph) * 180, Math.sin(th) * Math.sin(ph) * 180);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xe8e0ff, size: 1.6, sizeAttenuation: false, fog: false })));
  add(new THREE.Mesh(new THREE.IcosahedronGeometry(7, 1), new THREE.MeshBasicMaterial({ color: 0xf3e9cc, fog: false })), -70, 60, -110, false);

  // Luces
  scene.add(new THREE.HemisphereLight(0x8a7ac8, 0x2a1a10, 1.6));
  const moonLight = new THREE.DirectionalLight(0x9aa8ff, 1.3);
  moonLight.position.set(-25, 35, -20);
  moonLight.castShadow = true;
  Object.assign(moonLight.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 100 });
  moonLight.shadow.mapSize.set(1024, 1024);
  scene.add(moonLight);
  const fireLight = new THREE.PointLight(0xff8a3a, 60, 26, 2);
  fireLight.position.set(0, 1.4, 0);
  fireLight.castShadow = true;
  fireLight.shadow.mapSize.set(512, 512);
  scene.add(fireLight);

  // Terreno y lago
  let tg: THREE.BufferGeometry = new THREE.PlaneGeometry(110, 110, 60, 60);
  tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, heightAt(tp.getX(i), tp.getZ(i)) + (rng() - 0.5) * 0.25);
  tg = tg.toNonIndexed();
  const tpos = tg.attributes.position, tcol: number[] = [];
  const grassA = new THREE.Color(0x3f5a2e), grassB = new THREE.Color(0x4d6b35), dirt = new THREE.Color(0x6b4a32);
  const rockC = new THREE.Color(0x5e5868), sand = new THREE.Color(0x8a7a52);
  for (let i = 0; i < tpos.count; i += 3) {
    const cx = (tpos.getX(i) + tpos.getX(i + 1) + tpos.getX(i + 2)) / 3;
    const cz = (tpos.getZ(i) + tpos.getZ(i + 1) + tpos.getZ(i + 2)) / 3;
    const cy = (tpos.getY(i) + tpos.getY(i + 1) + tpos.getY(i + 2)) / 3;
    const r = Math.hypot(cx, cz), pd = Math.hypot(cx - POND.x, cz - POND.y);
    let c = grassA.clone().lerp(grassB, rng());
    if (r < 4.5 + rng()) c = dirt.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.04);
    else if (pd < 6.5) c = sand.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.05);
    else if (cy > 4) c = rockC.clone().lerp(new THREE.Color(0x8a8296), Math.min(1, (cy - 4) / 8));
    for (let k = 0; k < 3; k++) tcol.push(c.r, c.g, c.b);
  }
  tg.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, mat(0xffffff, { vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(5.2, 9), mat(0x2e5a8a, { roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.88 }));
  pond.rotation.x = -Math.PI / 2;
  add(pond, POND.x, -0.25, POND.y, false);

  // Montañas
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng() * 0.2, d = 62 + rng() * 14, r = 10 + rng() * 9, h = 16 + rng() * 16, rot = rng() * Math.PI;
    const mx = Math.cos(a) * d, mz = Math.sin(a) * d;
    add(new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), mat(0x4a4066)), mx, h / 2 - 1, mz, false).rotation.y = rot;
    const sh = h * 0.3;
    add(new THREE.Mesh(new THREE.ConeGeometry(r * 0.3 + 0.05, sh, 5), mat(0xe9e6f4)), mx, h - 1 - sh / 2 + 0.02, mz, false).rotation.y = rot;
  }

  // Bosque (con un hueco para que la cámara pase)
  const pineMats = [mat(0x2a5034), mat(0x2f5a3a), mat(0x356640)], trunkMat = mat(0x5a3a22);
  const pine = (x: number, z: number, s: number) => {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 0.9 * s, 5), trunkMat);
    t.position.y = 0.45 * s;
    g.add(t);
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry((1.15 - k * 0.28) * s, 1.4 * s, 7), pineMats[(k + Math.floor(rng() * 3)) % 3]);
      c.position.y = (1.2 + k * 0.75) * s;
      c.rotation.y = rng() * 3;
      g.add(c);
    }
    add(g, x, heightAt(x, z) - 0.05, z);
  };
  for (let i = 0; i < 130; i++) {
    const a = rng() * Math.PI * 2, d = i < 14 ? 9 + rng() * 4 : 25 + Math.pow(rng(), 0.8) * 26;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - POND.x, z - POND.y) < 7.5) continue;
    pine(x, z, 0.8 + rng() * 0.8);
  }
  const rockMat = mat(0x7a7484);
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2, d = 7 + rng() * 26, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const r = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng() * 0.8, 0), rockMat), x, heightAt(x, z), z);
    r.scale.y = 0.6;
    r.rotation.set(rng(), rng() * 3, rng());
  }

  // Hoguera
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + rng() * 0.06, 0), mat(0x6d6873)), Math.cos(a), 0.12, Math.sin(a)).rotation.set(rng(), rng(), rng());
  }
  for (let i = 0; i < 5; i++) {
    const l = add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 6), mat(0x4e3018)), 0, 0.45, 0);
    l.rotation.set(0, (i / 5) * Math.PI * 2, 0);
    l.rotateZ(0.95);
  }
  const fireGroup = new THREE.Group();
  scene.add(fireGroup);
  const flames = ([[0.5, 1.4, 0xff6a1a], [0.34, 1.05, 0xffa632], [0.18, 0.65, 0xfff0b0]] as const).map(([r, h, c]) => {
    const f = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95 }));
    f.userData.h = h;
    fireGroup.add(f);
    return f;
  });
  const EN = 50, emberPos = new Float32Array(EN * 3), emberSpeed: number[] = [];
  for (let i = 0; i < EN; i++) {
    emberPos.set([(rng() - 0.5) * 0.6, rng() * 4, (rng() - 0.5) * 0.6], i * 3);
    emberSpeed.push(0.01 + rng() * 0.02);
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  scene.add(new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: 0xffb347, size: 0.09 })));

  // ---------- Elementos que dependen del progreso ----------
  const spawned: Spawned[] = [];
  const clock = new THREE.Clock();
  const spawn = (obj: THREE.Object3D, scale = 1) => {
    obj.scale.setScalar(0.001);
    spawned.push({ obj, born: clock.getElapsedTime(), scale });
    return obj;
  };

  const hideA = mat(0xa06e44), hideB = mat(0x8a5c38), pole = mat(0x4e3420), dark = mat(0x1a100b);
  const tentSlots = Array.from({ length: 10 }, (_, i) => {
    const a = i * 2.39996 + 0.5, d = 5.8 + (i % 3) * 1.6;
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, s: 0.8 + ((i * 7) % 5) * 0.08, tone: i % 2 };
  }).filter((t) => Math.hypot(t.x - POND.x, t.z - POND.y) > 7);
  const tents: THREE.Object3D[] = [];
  function makeTent(x: number, z: number, s: number, tone: number) {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7 * s, 3 * s, 8), tone ? hideB : hideA);
    cone.position.y = 1.5 * s;
    g.add(cone);
    for (let k = 0; k < 4; k++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2 * s, 4), pole);
      p.position.y = 3.1 * s;
      p.rotation.z = (k - 1.5) * 0.25;
      p.rotation.y = k * 0.8;
      g.add(p);
    }
    const door = new THREE.Mesh(new THREE.ConeGeometry(0.5 * s, 1.3 * s, 3), dark);
    door.position.set(0, 0.62 * s, 1.15 * s);
    door.rotation.x = -0.5;
    g.add(door);
    add(g, x, heightAt(x, z), z);
    g.lookAt(0, heightAt(x, z), 0);
    return g;
  }

  const skins = [0xe0b48a, 0xc99068, 0xb07850, 0xe8c29a], hairs = [0x2a1a12, 0x5a3418, 0x1a120c];
  const clothes: Record<BuildingId, number> = { gatherer: 0x9a7048, woodcutter: 0x6b4a2c, hunter: 0x8b5a3c, fisher: 0x56606d };
  function makePerson(kind: BuildingId, i: number): THREE.Group {
    const g = new THREE.Group();
    const skin = mat(skins[i % skins.length]);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.85, 7), mat(clothes[kind]));
    body.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 0), skin);
    head.position.y = 1.12;
    const hair = new THREE.Mesh(new THREE.IcosahedronGeometry(0.225, 0), mat(hairs[i % hairs.length]));
    hair.scale.set(1, 0.6, 1);
    hair.position.set(0, 1.22, -0.05);
    g.add(body, head, hair);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.55, 5), skin);
      arm.position.set(side * 0.28, 0.62, 0.05);
      arm.rotation.set(-0.5, 0, side * 0.25);
      g.add(arm);
    }
    if (kind === 'hunter') {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), pole);
      sp.position.set(0.35, 1.1, 0);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 4), mat(0x9a9aa8));
      tip.position.set(0.35, 2.3, 0);
      g.add(sp, tip);
    } else if (kind === 'gatherer') {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.32, 7), mat(0x7a5a32));
      b.position.set(0, 0.8, -0.3);
      g.add(b);
    } else if (kind === 'woodcutter') {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 6), mat(0x6b4527));
      log.position.set(0, 1.0, -0.25);
      log.rotation.z = Math.PI / 2;
      g.add(log);
    } else {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 4), pole);
      rod.position.set(0.3, 1.1, 0.5);
      rod.rotation.x = 0.9;
      g.add(rod);
    }
    return g;
  }
  // Dónde trabaja cada oficio: recolectores junto a los arbustos, leñadores hacia el bosque,
  // cazadores alrededor del fuego y pescadores en la orilla del lago.
  function personSlot(kind: BuildingId, i: number): { x: number; z: number; face: THREE.Vector3 } {
    if (kind === 'hunter') {
      const a = (i / MAX_SHOWN.hunter) * Math.PI * 2 + 0.3, d = 2.3 + (i % 2) * 0.35;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, face: new THREE.Vector3(0, 0, 0) };
    }
    if (kind === 'fisher') {
      const a = Math.PI * 0.75 + (i / MAX_SHOWN.fisher) * Math.PI * 1.1;
      return { x: POND.x + Math.cos(a) * 5.6, z: POND.y + Math.sin(a) * 5.6, face: new THREE.Vector3(POND.x, 0, POND.y) };
    }
    const base = kind === 'gatherer' ? -2.3 : 0.9;
    const a = base + (i - 4.5) * 0.2, d = 7.6 + (i % 3) * 0.8;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    return { x, z, face: new THREE.Vector3(x * 2, 0, z * 2) };
  }
  const people: Record<BuildingId, THREE.Object3D[]> = { gatherer: [], woodcutter: [], hunter: [], fisher: [] };

  // Arbustos de bayas (siempre) y extras de las mejoras
  const bushMat = mat(0x3a6a34), berryMat = mat(0xc23a3a);
  const berryGroups: THREE.Object3D[] = [];
  for (let i = 0; i < 7; i++) {
    const a = -2.3 + (i - 3) * 0.28, d = 11 + (i % 2) * 1.2, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), bushMat));
    const berries = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), berryMat);
      b.position.set((rng() - 0.5) * 1.1, 0.2 + rng() * 0.4, (rng() - 0.5) * 1.1);
      berries.add(b);
    }
    berries.visible = false;
    berryGroups.push(berries);
    g.add(berries);
    add(g, x, heightAt(x, z) + 0.35, z);
  }
  const upgradeProps: Record<string, () => THREE.Object3D> = {
    axes: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.6, 6), mat(0x6b4527));
        l.rotation.set(Math.PI / 2, 0, 0.3);
        l.position.set(0, 0.15 + Math.floor(i / 3) * 0.24, (i % 3) * 0.27 + (i >= 3 ? 0.13 : 0));
        g.add(l);
      }
      return add(g, 3.6, 0, -3);
    },
    spears: () => {
      const g = new THREE.Group();
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 4), pole);
        p.position.set(s, 0.9, 0);
        g.add(p);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 4), pole);
      bar.rotation.z = Math.PI / 2;
      bar.position.y = 1.75;
      const hide = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 0.04), mat(0xc49a68));
      hide.position.y = 1.2;
      g.add(bar, hide);
      g.rotation.y = 0.9;
      return add(g, -4.5, 0, 2.5);
    },
    'cave-paintings': () => {
      const g = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 0), mat(0x8a8296));
      rock.scale.set(1.3, 1, 0.8);
      g.add(rock);
      const paint = mat(0xb5432a, { emissive: 0x3a0f05 });
      [[-0.5, 0.3], [0.1, 0.5], [0.5, 0.1], [-0.1, -0.1]].forEach(([px, py]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.05), paint);
        m.position.set(px, py, 1.25);
        g.add(m);
      });
      g.lookAt(0, 0, 0);
      return add(g, -6.5, heightAt(-6.5, -5.5) + 0.8, -5.5);
    },
    nets: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 4), pole);
        p.position.set(i * 0.9, 0.8, 0);
        g.add(p);
      }
      const net = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1, 6, 4), new THREE.MeshStandardMaterial({ color: 0xd9c9a0, wireframe: true }));
      net.position.set(0.9, 0.9, 0);
      g.add(net);
      return add(g, POND.x - 5.8, 0, POND.y + 2.5);
    },
  };
  const props: Record<string, THREE.Object3D> = {};
  let farm: THREE.Object3D | null = null;
  function makeFarm() {
    const g = new THREE.Group();
    const soil = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 3), mat(0x5a3d26));
    g.add(soil);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 4), mat(0x7cc46a));
      sprout.position.set(-1.6 + c * 0.64, 0.3, -1.1 + r * 0.72);
      g.add(sprout);
    }
    return add(g, -2, heightAt(-2, 8.5) + 0.05, 8.5);
  }

  let flash = 0;
  function update(state: GameState) {
    const units = state.buildings.gatherer + state.buildings.woodcutter + state.buildings.hunter + state.buildings.fisher;
    const wantTents = Math.min(tentSlots.length, 1 + Math.floor(units / 6));
    while (tents.length < wantTents) {
      const t = tentSlots[tents.length];
      tents.push(spawn(makeTent(t.x, t.z, t.s, t.tone)));
    }
    while (tents.length > wantTents) scene.remove(tents.pop()!);
    for (const kind of Object.keys(people) as BuildingId[]) {
      const want = Math.min(MAX_SHOWN[kind], state.buildings[kind]);
      const list = people[kind];
      while (list.length < want) {
        const slot = personSlot(kind, list.length);
        const p = makePerson(kind, list.length);
        add(p, slot.x, heightAt(slot.x, slot.z), slot.z);
        p.lookAt(slot.face.x, p.position.y, slot.face.z);
        p.userData.phase = rng() * 6;
        list.push(spawn(p, kind === 'hunter' && list.length % 4 === 3 ? 0.75 : 1));
      }
      while (list.length > want) scene.remove(list.pop()!);
    }
    berryGroups.forEach((b) => (b.visible = state.upgrades.includes('baskets')));
    for (const [id, make] of Object.entries(upgradeProps)) {
      const has = state.upgrades.includes(id);
      if (has && !props[id]) props[id] = spawn(make());
      if (!has && props[id]) {
        scene.remove(props[id]);
        delete props[id];
      }
    }
    fireGroup.userData.big = state.upgrades.includes('fire');
    if (state.goalReached && !farm) farm = spawn(makeFarm());
    if (!state.goalReached && farm) {
      scene.remove(farm);
      farm = null;
    }
  }

  // Cámara: órbita lenta, arrastrable
  let angle = 0.9;
  let dragX: number | null = null;
  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointerdown', (e) => {
    dragX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragX === null) return;
    angle -= (e.clientX - dragX) * 0.008;
    dragX = e.clientX;
  });
  const endDrag = () => (dragX = null);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(container);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame() {
    if (!visible || document.hidden) return;
    const t = clock.getElapsedTime();
    if (!reduceMotion && dragX === null) angle += 0.0015;
    camera.position.set(Math.cos(angle) * 19, 8.5, Math.sin(angle) * 19);
    camera.lookAt(0, 1.2, 0);

    const big = fireGroup.userData.big ? 1.35 : 1;
    flash = Math.max(0, flash - 0.05);
    flames.forEach((f, k) => {
      const s = (1 + (reduceMotion ? 0 : Math.sin(t * (9 + k * 3)) * 0.08 + Math.sin(t * 23 + k) * 0.05)) * big * (1 + flash * 0.3);
      f.scale.set(big / Math.sqrt(s / big), s, big / Math.sqrt(s / big));
      f.rotation.y = t * (1 + k);
      f.position.y = 0.3 + (f.userData.h * s) / 2;
    });
    fireLight.intensity = (55 + Math.sin(t * 11) * 6 + Math.sin(t * 27) * 4) * big * (1 + flash);
    if (!reduceMotion) {
      for (let i = 0; i < EN; i++) {
        emberPos[i * 3 + 1] += emberSpeed[i];
        emberPos[i * 3] += Math.sin(t * 2 + i) * 0.003;
        if (emberPos[i * 3 + 1] > 4.5) emberPos.set([(rng() - 0.5) * 0.5, 0.6, (rng() - 0.5) * 0.5], i * 3);
      }
      emberGeo.attributes.position.needsUpdate = true;
      for (const list of Object.values(people)) {
        for (const p of list) p.position.y = heightAt(p.position.x, p.position.z) + Math.abs(Math.sin(t * 1.5 + p.userData.phase)) * 0.04;
      }
    }
    for (let i = spawned.length - 1; i >= 0; i--) {
      const s = spawned[i];
      const k = Math.min(1, (t - s.born) / 0.45);
      const ease = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
      s.obj.scale.setScalar(Math.max(0.001, s.scale * (reduceMotion ? 1 : ease)));
      if (k >= 1) spawned.splice(i, 1);
    }
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  return {
    update,
    pulse: () => (flash = 1),
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      renderer.dispose();
    },
  };
}
