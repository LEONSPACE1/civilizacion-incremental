import * as THREE from 'three';
import type { BuildingId, GameState } from '../game/state';

// Escena 3D low poly de la era 1. Lee el estado del juego y hace crecer la aldea;
// nunca lo modifica. Cada oficio tiene su rutina (ir, trabajar, volver) y el entorno
// se mueve con viento, humo, agua y animales para que el progreso se sienta vivo.

const POND = new THREE.Vector2(11, -7);
const POND_R = 5.2;
const MAX_SHOWN: Record<BuildingId, number> = { gatherer: 10, woodcutter: 10, hunter: 8, fisher: 6 };
// Pasillos de trabajo: hacia los arbustos y hacia la arboleda. Ahí no se levantan tiendas.
const GATHER_ANGLE = -2.3;
const WOOD_ANGLE = 0.9;
const PILE_R = 4.2;
const HOME_R = 5;
const GRAVITY = 18;

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
const polar = (a: number, d: number) => ({ x: Math.cos(a) * d, z: Math.sin(a) * d });
const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 + 0.4) * 1.4 + Math.sin((x + z) * 0.09) * 1.6 + Math.cos(x * 0.5 - z * 0.3) * 0.35;
  h *= THREE.MathUtils.smoothstep(r, 5, 15);
  h += Math.max(0, r - 24) * 0.35;
  const pd = Math.hypot(x - POND.x, z - POND.y);
  if (pd < 5.5) h = Math.min(h, -0.6 + (pd / 5.5) * 0.6);
  return h;
}

// ---------- Distribución del campamento ----------
// Se calcula una sola vez para que las rutas de trabajo nunca atraviesen tiendas ni rocas.
const FARM = polar(2.5, 12);
const PAINT_ROCK = polar(3.0, 10.2);
const SPEAR_RACK = { x: -4.5, z: 2.5 };
const LOG_PILE = { x: 3.6, z: -3 };
const inCorridor = (x: number, z: number, margin: number) => {
  const a = Math.atan2(z, x);
  return angDist(a, GATHER_ANGLE) < margin || angDist(a, WOOD_ANGLE) < margin;
};
const blockers: { x: number; z: number; r: number }[] = [
  { ...FARM, r: 2.8 },
  { ...PAINT_ROCK, r: 2.2 },
  { ...SPEAR_RACK, r: 1.6 },
  { ...LOG_PILE, r: 1.3 },
];
const isFree = (x: number, z: number, r: number) =>
  Math.hypot(x - POND.x, z - POND.y) > POND_R + 0.8 + r && blockers.every((b) => Math.hypot(x - b.x, z - b.z) > b.r + r);

const TENT_SLOTS = (() => {
  // Anillos de dentro hacia fuera: las primeras tiendas quedan cerca del fuego.
  const slots: { x: number; z: number; s: number; tone: number }[] = [];
  for (const d of [6.2, 8, 9.8]) {
    for (let k = 0; k < 126 && slots.length < 10; k++) {
      const { x, z } = polar(-Math.PI + k * 0.05, d);
      if (inCorridor(x, z, 0.5 + 1.4 / d) || !isFree(x, z, 1.45)) continue;
      slots.push({ x, z, s: 0.8 + ((slots.length * 7) % 5) * 0.08, tone: slots.length % 2 });
      blockers.push({ x, z, r: 1.45 });
    }
  }
  return slots;
})();
const BUSHES = Array.from({ length: 8 }, (_, k) => polar(GATHER_ANGLE + (k - 3.5) * 0.15, 11 + (k % 2) * 1.4));
const GROVE = Array.from({ length: MAX_SHOWN.woodcutter }, (_, k) => polar(WOOD_ANGLE + (k - 4.5) * 0.12, 11 + (k % 2) * 1.7));
const FOOD_PILE = polar(GATHER_ANGLE, PILE_R);
const WOOD_PILE = polar(WOOD_ANGLE, PILE_R);

/** Objeto que cae del cielo y rebota al aparecer. */
interface Drop {
  obj: THREE.Object3D;
  baseY: number;
  dynamic: boolean;
  delay: number;
  offset: number;
  vy: number;
  squash: number;
  scale: number;
}

/** Pequeños trozos con gravedad: astillas, bayas, gotas. */
interface Debris {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  ground: boolean;
}

interface Rig {
  root: THREE.Group;
  torso: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  carry?: THREE.Object3D;
  /** La lanza se mantiene vertical aunque el brazo se mueva. */
  tool?: THREE.Object3D;
  rodTip?: THREE.Object3D;
}

interface Person {
  kind: BuildingId;
  i: number;
  rig: Rig;
  x: number;
  z: number;
  heading: number;
  walk: number;
  bob: number;
  state: string;
  timer: number;
  cheer: number;
  phase: number;
  line?: THREE.Line;
  bobber?: THREE.Mesh;
  bobberPos?: THREE.Vector3;
}

interface Tree {
  pivot: THREE.Group;
  inner: THREE.Group;
  state: 'standing' | 'falling' | 'down' | 'shrink' | 'regrow';
  theta: number;
  omega: number;
  timer: number;
  shake: number;
}

export interface Village {
  update(state: GameState): void;
  /** Al recolectar: destello del fuego y bayas que saltan del montón. */
  pulse(): void;
  /** Al comprar: la tribu lo celebra. */
  celebrate(): void;
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
    return { update() {}, pulse() {}, celebrate() {}, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rng = mulberry32(7);
  const fx = Math.random; // efectos que no necesitan ser deterministas
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
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xe8e0ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true }));
  scene.add(stars);
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

  // Terreno
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
    // Senderos pisados hacia los arbustos y la arboleda
    else if (r < 11 && (angDist(Math.atan2(cz, cx), GATHER_ANGLE) < 0.12 || angDist(Math.atan2(cz, cx), WOOD_ANGLE) < 0.12)) c = c.lerp(dirt, 0.55);
    for (let k = 0; k < 3; k++) tcol.push(c.r, c.g, c.b);
  }
  tg.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, mat(0xffffff, { vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Lago con oleaje suave
  const pondGeo = new THREE.RingGeometry(0.01, POND_R, 20, 5);
  const pondBase = Float32Array.from(pondGeo.attributes.position.array);
  const pond = new THREE.Mesh(pondGeo, mat(0x2e5a8a, { roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.88 }));
  pond.rotation.x = -Math.PI / 2;
  add(pond, POND.x, -0.25, POND.y, false);
  pond.receiveShadow = true;

  // Montañas
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng() * 0.2, d = 62 + rng() * 14, r = 10 + rng() * 9, h = 16 + rng() * 16, rot = rng() * Math.PI;
    const mx = Math.cos(a) * d, mz = Math.sin(a) * d;
    add(new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), mat(0x4a4066)), mx, h / 2 - 1, mz, false).rotation.y = rot;
    const sh = h * 0.3;
    add(new THREE.Mesh(new THREE.ConeGeometry(r * 0.3 + 0.05, sh, 5), mat(0xe9e6f4)), mx, h - 1 - sh / 2 + 0.02, mz, false).rotation.y = rot;
  }

  // Bosque que se mece con el viento
  const pineMats = [mat(0x2a5034), mat(0x2f5a3a), mat(0x356640)], trunkMat = mat(0x5a3a22);
  const swaying: { obj: THREE.Object3D; phase: number; amp: number }[] = [];
  const makePine = (s: number) => {
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
    return g;
  };
  for (let i = 0, near = 0, far = 0; i < 600 && far < 116; i++) {
    const isNear = near < 14;
    const a = rng() * Math.PI * 2, d = isNear ? 9 + rng() * 4 : 25 + Math.pow(rng(), 0.8) * 26;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - POND.x, z - POND.y) < 7.5) continue;
    if (isNear && (inCorridor(x, z, 0.75) || !isFree(x, z, 1.2))) continue;
    if (isNear) near++;
    else far++;
    const g = add(makePine(0.8 + rng() * 0.8), x, heightAt(x, z) - 0.05, z);
    swaying.push({ obj: g, phase: rng() * 6, amp: 0.02 + rng() * 0.025 });
  }
  const rockMat = mat(0x7a7484);
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2, d = 7 + rng() * 26, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (d < 13 && inCorridor(x, z, 0.3)) continue;
    const r = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng() * 0.8, 0), rockMat), x, heightAt(x, z), z);
    r.scale.y = 0.6;
    r.rotation.set(rng(), rng() * 3, rng());
  }

  // Arboleda de los leñadores: cada árbol se tala, cae y vuelve a crecer
  const trees: Tree[] = GROVE.map(({ x, z }) => {
    const pivot = new THREE.Group();
    const inner = makePine(1 + rng() * 0.3);
    pivot.add(inner);
    add(pivot, x, heightAt(x, z) - 0.05, z);
    pivot.rotation.y = Math.atan2(x, z); // cae hacia fuera, lejos del leñador
    return { pivot, inner, state: 'standing', theta: 0, omega: 0, timer: 0, shake: 0 };
  });

  // Hoguera, humo y chispas
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
    emberSpeed.push(0.6 + rng() * 1.2);
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  scene.add(new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: 0xffb347, size: 0.09 })));
  const smokeGeo = new THREE.IcosahedronGeometry(0.4, 0);
  const smoke = Array.from({ length: 14 }, (_, i) => {
    const m = new THREE.Mesh(smokeGeo, new THREE.MeshStandardMaterial({ color: 0x8a8090, flatShading: true, transparent: true, opacity: 0, depthWrite: false }));
    m.userData.age = i / 14;
    m.userData.spin = fx() * 2;
    scene.add(m);
    return m;
  });

  // Luciérnagas junto a los arbustos y la arboleda
  const FF = 36, ffBase: THREE.Vector3[] = [], ffPos = new Float32Array(FF * 3), ffCol = new Float32Array(FF * 3);
  for (let i = 0; i < FF; i++) {
    const spot = i % 2 ? BUSHES[i % BUSHES.length] : GROVE[i % GROVE.length];
    ffBase.push(new THREE.Vector3(spot.x + (rng() - 0.5) * 4, 0.6 + rng() * 1.6, spot.z + (rng() - 0.5) * 4));
  }
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('color', new THREE.BufferAttribute(ffCol, 3));
  scene.add(new THREE.Points(ffGeo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));

  // ---------- Física sencilla: caídas con rebote y trocitos con gravedad ----------
  const drops: Drop[] = [];
  let dropDelay = 0;
  const spawn = <T extends THREE.Object3D>(obj: T, scale = 1, dynamic = false): T => {
    obj.scale.setScalar(scale);
    if (reduceMotion) return obj;
    drops.push({ obj, baseY: obj.position.y, dynamic, delay: dropDelay, offset: 7 + fx() * 2, vy: 0, squash: 0, scale });
    dropDelay += 0.07;
    if (dropDelay > 0) obj.visible = false;
    return obj;
  };

  const debris: Debris[] = [];
  const debrisGeo = new THREE.IcosahedronGeometry(1, 0);
  const chipMat = mat(0xc89a5a), berryBurstMat = mat(0xd2433f), splashMat = new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.85 });
  function emit(material: THREE.Material, x: number, y: number, z: number, count: number, speed: number, size: number, up = 1, ground = true): void {
    if (reduceMotion) return;
    for (let k = 0; k < count && debris.length < 160; k++) {
      const mesh = new THREE.Mesh(debrisGeo, material);
      mesh.scale.setScalar(size * (0.7 + fx() * 0.6));
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      scene.add(mesh);
      const a = fx() * Math.PI * 2;
      debris.push({
        mesh,
        v: new THREE.Vector3(Math.cos(a) * speed * (0.4 + fx()), up * (2.5 + fx() * 3), Math.sin(a) * speed * (0.4 + fx())),
        spin: new THREE.Vector3(fx() * 10, fx() * 10, fx() * 10),
        life: 1.2 + fx() * 0.8,
        ground,
      });
    }
  }

  // Ondas en el agua
  const rippleGeo = new THREE.RingGeometry(0.85, 1, 20);
  const ripples = Array.from({ length: 10 }, () => {
    const m = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.userData.age = 1;
    scene.add(m);
    return m;
  });
  let rippleNext = 0;
  function ripple(x: number, z: number, size = 1): void {
    const m = ripples[rippleNext++ % ripples.length];
    m.position.set(x, -0.2, z);
    m.userData.age = 0;
    m.userData.size = size;
  }

  // Peces que saltan del lago
  const fishMat = mat(0x9fb8c8, { metalness: 0.3, roughness: 0.5 });
  const makeFish = () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), fishMat);
    body.rotation.x = Math.PI / 2;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 3), fishMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.z = -0.3;
    g.add(body, tail);
    g.visible = false;
    scene.add(g);
    return g;
  };
  const jumpers = Array.from({ length: 2 }, () => ({ fish: makeFish(), from: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, active: false, wait: 2 + fx() * 5 }));
  function launch(j: { fish: THREE.Object3D; from: THREE.Vector3; v: THREE.Vector3; t: number; active: boolean }, from: THREE.Vector3, to: THREE.Vector3, time: number) {
    j.from.copy(from);
    j.v.set((to.x - from.x) / time, (to.y - from.y + 0.5 * GRAVITY * 0.5 * time * time) / time, (to.z - from.z) / time);
    j.t = 0;
    j.active = true;
    j.fish.visible = true;
    j.fish.position.copy(from);
  }

  // Ciervos que pastan en las afueras
  const deerMat = mat(0x9a6a40), deerBelly = mat(0xd8b48a), antlerMat = mat(0xe0d2b4);
  const deer = Array.from({ length: 3 }, (_, k) => {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.15), deerMat);
    body.position.y = 1.05;
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.9), deerBelly);
    belly.position.y = 0.8;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 4), deerBelly);
    tail.position.set(0, 1.25, -0.6);
    tail.rotation.x = -2.4;
    root.add(body, belly, tail);
    const neck = new THREE.Group();
    neck.position.set(0, 1.2, 0.5);
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.6, 5), deerMat);
    neckMesh.position.set(0, 0.25, 0.08);
    neckMesh.rotation.x = 0.35;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.42), deerMat);
    head.position.set(0, 0.55, 0.28);
    neck.add(neckMesh, head);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 3), deerMat);
      ear.position.set(s * 0.13, 0.7, 0.16);
      ear.rotation.z = -s * 0.8;
      neck.add(ear);
      if (k === 0) {
        const antler = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 4), antlerMat);
        antler.position.set(s * 0.12, 0.88, 0.2);
        antler.rotation.z = -s * 0.5;
        const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.25, 4), antlerMat);
        prong.position.set(s * 0.2, 0.95, 0.32);
        prong.rotation.x = 0.8;
        neck.add(antler, prong);
      }
    }
    root.add(neck);
    const legs = [[-0.17, 0.4], [0.17, 0.4], [-0.17, -0.4], [0.17, -0.4]].map(([lx, lz]) => {
      const pivot = new THREE.Group();
      pivot.position.set(lx, 0.82, lz);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.82, 4), deerMat);
      leg.position.y = -0.41;
      pivot.add(leg);
      root.add(pivot);
      return pivot;
    });
    const a = 1.8 + k * 1.3, d = 15 + k;
    const p = polar(a, d);
    add(root, p.x, heightAt(p.x, p.z), p.z);
    root.scale.setScalar(k === 2 ? 0.75 : 1);
    return { root, neck, legs, x: p.x, z: p.z, heading: fx() * 6, tx: p.x, tz: p.z, state: 'graze', timer: 2 + fx() * 4, walk: 0 };
  });
  const deerSpot = (fromAngle: number) => {
    for (let n = 0; n < 30; n++) {
      const a = fromAngle + (fx() - 0.5) * 1.2, d = 14.5 + fx() * 3;
      if (angDist(a, Math.atan2(POND.y, POND.x)) < 0.55) continue;
      return polar(a, d);
    }
    return polar(fromAngle, 15);
  };

  // Bandada de pájaros que cruza el cielo de vez en cuando
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x1c1428, side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.15, 0, 0, -0.15, 0.7, 0, -0.05], 3));
  wingGeo.computeVertexNormals();
  const flock = new THREE.Group();
  const birds = Array.from({ length: 6 }, (_, k) => {
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 4), birdMat);
    body.rotation.x = Math.PI / 2;
    b.add(body);
    const wings = [-1, 1].map((s) => {
      const w = new THREE.Mesh(wingGeo, birdMat);
      w.scale.x = s;
      b.add(w);
      return w;
    });
    const row = Math.ceil(k / 2), side = k % 2 ? 1 : -1;
    b.position.set(side * row * 0.9, (fx() - 0.5) * 0.4, -row * 1.1);
    b.userData.phase = fx() * 6;
    flock.add(b);
    return { b, wings };
  });
  flock.visible = false;
  scene.add(flock);
  const flight = { active: false, wait: 6, from: new THREE.Vector3(), dir: new THREE.Vector3(), t: 0 };

  // ---------- Elementos que dependen del progreso ----------
  const hideA = mat(0xa06e44), hideB = mat(0x8a5c38), pole = mat(0x4e3420), dark = mat(0x1a100b);
  const tents: THREE.Object3D[] = [];
  function makeTent(x: number, z: number, s: number, tone: number) {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7 * s, 3 * s, 8), tone ? hideB : hideA);
    cone.position.y = 1.5 * s;
    g.add(cone);
    const poles = new THREE.Group();
    poles.position.y = 2.6 * s;
    for (let k = 0; k < 4; k++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2 * s, 4), pole);
      p.position.y = 0.5 * s;
      p.rotation.z = (k - 1.5) * 0.25;
      p.rotation.y = k * 0.8;
      poles.add(p);
    }
    g.add(poles);
    const door = new THREE.Group();
    door.position.set(0, 1.25 * s, 0.75 * s);
    const flap = new THREE.Mesh(new THREE.ConeGeometry(0.5 * s, 1.3 * s, 3), dark);
    flap.position.y = -0.62 * s;
    flap.position.z = 0.4 * s;
    flap.rotation.x = -0.5;
    door.add(flap);
    g.add(door);
    g.userData.door = door;
    g.userData.poles = poles;
    g.userData.phase = fx() * 6;
    add(g, x, heightAt(x, z), z);
    g.lookAt(0, heightAt(x, z), 0);
    return g;
  }

  const skins = [0xe0b48a, 0xc99068, 0xb07850, 0xe8c29a], hairs = [0x2a1a12, 0x5a3418, 0x1a120c];
  const clothes: Record<BuildingId, number> = { gatherer: 0x9a7048, woodcutter: 0x6b4a2c, hunter: 0x8b5a3c, fisher: 0x56606d };
  const wrapMat = mat(0x3d2a1c), stoneMat = mat(0x9a9aa8), berryMat = mat(0xc23a3a);
  function makePerson(kind: BuildingId, i: number): Rig {
    const root = new THREE.Group();
    const skin = mat(skins[i % skins.length]);
    const limb = (x: number, y: number, len: number, r: number, m: THREE.Material, parent: THREE.Object3D) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, len, 5), m);
      mesh.position.y = -len / 2;
      pivot.add(mesh);
      parent.add(pivot);
      return pivot;
    };
    const legL = limb(-0.11, 0.42, 0.42, 0.075, wrapMat, root);
    const legR = limb(0.11, 0.42, 0.42, 0.075, wrapMat, root);
    const torso = new THREE.Group();
    torso.position.y = 0.42;
    root.add(torso);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.62, 7), mat(clothes[kind]));
    body.position.y = 0.3;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 0), skin);
    head.position.y = 0.78;
    const hair = new THREE.Mesh(new THREE.IcosahedronGeometry(0.225, 0), mat(hairs[i % hairs.length]));
    hair.scale.set(1, 0.6, 1);
    hair.position.set(0, 0.88, -0.05);
    torso.add(body, head, hair);
    const armL = limb(-0.27, 0.56, 0.5, 0.065, skin, torso);
    const armR = limb(0.27, 0.56, 0.5, 0.065, skin, torso);
    armL.rotation.z = -0.12;
    armR.rotation.z = 0.12;
    const rig: Rig = { root, torso, armL, armR, legL, legR };
    if (kind === 'hunter') {
      const spear = new THREE.Group();
      spear.position.set(0, -0.48, 0.02);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), pole);
      shaft.position.y = 0.6;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 4), stoneMat);
      tip.position.y = 1.8;
      spear.add(shaft, tip);
      armR.add(spear);
      rig.tool = spear;
    } else if (kind === 'gatherer') {
      const basket = new THREE.Group();
      basket.position.set(0, 0.35, -0.3);
      basket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.32, 7), mat(0x7a5a32)));
      const load = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), berryMat);
        b.position.set((k % 3 - 1) * 0.1, 0.17, (Math.floor(k / 3) - 0.5) * 0.12);
        load.add(b);
      }
      basket.add(load);
      torso.add(basket);
      rig.carry = load;
    } else if (kind === 'woodcutter') {
      const axe = new THREE.Group();
      axe.position.set(0, -0.48, 0.02);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 4), pole);
      handle.rotation.x = Math.PI / 2;
      handle.position.z = 0.3;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.16), stoneMat);
      head.position.set(0, 0.08, 0.62);
      axe.add(handle, head);
      armR.add(axe);
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.95, 6), mat(0x6b4527));
      log.position.set(0, 0.68, -0.22);
      log.rotation.z = Math.PI / 2;
      torso.add(log);
      rig.carry = log;
    } else {
      const rod = new THREE.Group();
      rod.position.set(0, -0.48, 0.02);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 2, 4), pole);
      stick.rotation.x = Math.PI / 2;
      stick.position.z = 1;
      const tipMark = new THREE.Object3D();
      tipMark.position.z = 2;
      rod.add(stick, tipMark);
      armR.add(rod);
      rig.rodTip = tipMark;
    }
    return rig;
  }

  const people: Record<BuildingId, Person[]> = { gatherer: [], woodcutter: [], hunter: [], fisher: [] };
  const homeOf = (p: Person) => polar((p.kind === 'gatherer' ? GATHER_ANGLE : WOOD_ANGLE) + (p.i - 4.5) * 0.08, HOME_R + (p.i % 2) * 0.4);
  const workOf = (p: Person) => {
    const spot = p.kind === 'gatherer' ? BUSHES[p.i % BUSHES.length] : GROVE[p.i];
    const d = Math.hypot(spot.x, spot.z), back = p.kind === 'gatherer' ? 1 : 1.05;
    const side = p.kind === 'gatherer' && p.i >= BUSHES.length ? 0.75 : 0;
    return { x: (spot.x / d) * (d - back) - (spot.z / d) * side, z: (spot.z / d) * (d - back) + (spot.x / d) * side, face: spot };
  };
  const hunterSeat = (i: number) => polar((i / MAX_SHOWN.hunter) * Math.PI * 2 + 0.3, 2.3 + (i % 2) * 0.35);
  const fisherSpot = (i: number) => {
    const a = Math.PI * 0.75 + (i / MAX_SHOWN.fisher) * Math.PI * 1.1;
    return { x: POND.x + Math.cos(a) * 5.6, z: POND.y + Math.sin(a) * 5.6, bob: new THREE.Vector3(POND.x + Math.cos(a) * 3.2, -0.2, POND.y + Math.sin(a) * 3.2) };
  };

  function createPerson(kind: BuildingId, i: number): Person {
    const rig = makePerson(kind, i);
    const p: Person = { kind, i, rig, x: 0, z: 0, heading: 0, walk: 0, bob: 0, state: 'idle', timer: fx() * 3, cheer: 0, phase: fx() * 6 };
    if (kind === 'gatherer' || kind === 'woodcutter') {
      // Cada uno empieza en un punto distinto de su ruta para que no vayan sincronizados.
      const home = homeOf(p), work = workOf(p), k = fx();
      p.x = home.x + (work.x - home.x) * k;
      p.z = home.z + (work.z - home.z) * k;
      p.state = 'toWork';
      p.heading = Math.atan2(work.x - home.x, work.z - home.z);
    } else if (kind === 'hunter') {
      const seat = hunterSeat(i);
      p.x = seat.x;
      p.z = seat.z;
      p.heading = Math.atan2(-seat.x, -seat.z);
      p.state = i % 3 === 2 ? 'patrol' : 'idle';
      p.timer = Math.atan2(seat.z, seat.x);
    } else {
      const spot = fisherSpot(i);
      p.x = spot.x;
      p.z = spot.z;
      p.heading = Math.atan2(POND.x - spot.x, POND.y - spot.z);
      p.state = 'wait';
      p.timer = 3 + fx() * 8;
      p.bobberPos = spot.bob.clone();
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      p.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xe8dcc0, transparent: true, opacity: 0.7 }));
      p.line.frustumCulled = false;
      scene.add(p.line);
      p.bobber = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), mat(0xe8e0d0));
      scene.add(p.bobber);
    }
    if (rig.carry) rig.carry.visible = false;
    rig.root.position.set(p.x, heightAt(p.x, p.z), p.z);
    rig.root.rotation.y = p.heading;
    add(rig.root, p.x, heightAt(p.x, p.z), p.z);
    return p;
  }
  function removePerson(p: Person): void {
    scene.remove(p.rig.root);
    if (p.line) scene.remove(p.line);
    if (p.bobber) scene.remove(p.bobber);
  }

  /** Avanza hacia un punto con paso animado; devuelve true al llegar. */
  function walkTo(p: Person, tx: number, tz: number, dt: number, speed = 1.15): boolean {
    const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const step = Math.min(dist, speed * dt);
    p.x += (dx / dist) * step;
    p.z += (dz / dist) * step;
    p.heading = lerpAngle(p.heading, Math.atan2(dx, dz), Math.min(1, dt * 8));
    p.walk += dt * speed * 5.5;
    const s = Math.sin(p.walk);
    p.rig.legL.rotation.x = s * 0.65;
    p.rig.legR.rotation.x = -s * 0.65;
    p.bob = Math.abs(Math.cos(p.walk)) * 0.06;
    p.rig.torso.rotation.x = THREE.MathUtils.lerp(p.rig.torso.rotation.x, 0.08, dt * 6);
    return false;
  }
  function standPose(p: Person, dt: number): void {
    const r = p.rig, k = Math.min(1, dt * 6);
    r.legL.rotation.x = THREE.MathUtils.lerp(r.legL.rotation.x, 0, k);
    r.legR.rotation.x = THREE.MathUtils.lerp(r.legR.rotation.x, 0, k);
    p.bob = THREE.MathUtils.lerp(p.bob, 0, k);
  }
  const ease = (from: number, to: number, dt: number, speed = 8) => THREE.MathUtils.lerp(from, to, Math.min(1, dt * speed));

  function updateGatherer(p: Person, dt: number, t: number): void {
    const r = p.rig, home = homeOf(p), work = workOf(p);
    if (p.state === 'toWork' || p.state === 'toHome') {
      const target = p.state === 'toWork' ? work : home;
      const swing = Math.sin(p.walk) * 0.55;
      r.armL.rotation.x = -swing;
      r.armR.rotation.x = swing;
      if (walkTo(p, target.x, target.z, dt)) {
        p.state = p.state === 'toWork' ? 'pick' : 'drop';
        p.timer = p.state === 'pick' ? 2.6 + fx() : 0.8;
      }
      return;
    }
    standPose(p, dt);
    p.timer -= dt;
    if (p.state === 'pick') {
      p.heading = lerpAngle(p.heading, Math.atan2(work.face.x - p.x, work.face.z - p.z), Math.min(1, dt * 6));
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.45, dt);
      r.armL.rotation.x = -1.1 + Math.sin(t * 7 + p.phase) * 0.35;
      r.armR.rotation.x = -1.1 + Math.sin(t * 7 + p.phase + 2) * 0.35;
      if (p.timer <= 0) {
        p.state = 'toHome';
        if (r.carry) r.carry.visible = true;
      }
    } else {
      p.heading = lerpAngle(p.heading, Math.atan2(FOOD_PILE.x - p.x, FOOD_PILE.z - p.z), Math.min(1, dt * 6));
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.6, dt);
      r.armL.rotation.x = ease(r.armL.rotation.x, -1.3, dt);
      r.armR.rotation.x = ease(r.armR.rotation.x, -1.3, dt);
      if (p.timer <= 0) {
        p.state = 'toWork';
        if (r.carry?.visible) {
          r.carry.visible = false;
          emit(berryBurstMat, FOOD_PILE.x, 0.9, FOOD_PILE.z, 2, 0.6, 0.07, 0.5);
        }
      }
    }
  }

  function updateWoodcutter(p: Person, dt: number, t: number): void {
    const r = p.rig, home = homeOf(p), work = workOf(p), tree = trees[p.i];
    if (p.state === 'toWork' || p.state === 'toHome') {
      const target = p.state === 'toWork' ? work : home;
      const swing = Math.sin(p.walk) * 0.5;
      r.armL.rotation.x = p.state === 'toHome' ? ease(r.armL.rotation.x, -2.6, dt) : -swing;
      r.armR.rotation.x = swing * 0.6;
      if (walkTo(p, target.x, target.z, dt, p.state === 'toHome' ? 0.95 : 1.15)) {
        p.state = p.state === 'toWork' ? 'chop' : 'drop';
        p.timer = p.state === 'chop' ? 3.4 + fx() : 0.7;
      }
      return;
    }
    standPose(p, dt);
    if (p.state === 'chop') {
      p.heading = lerpAngle(p.heading, Math.atan2(work.face.x - p.x, work.face.z - p.z), Math.min(1, dt * 6));
      if (tree.state !== 'standing') {
        r.armR.rotation.x = ease(r.armR.rotation.x, -0.2, dt);
        r.armL.rotation.x = ease(r.armL.rotation.x, 0, dt);
        return; // espera a que el árbol vuelva a crecer
      }
      // Golpe de hacha: subida lenta, bajada rápida.
      const before = (p.timer * 1.4) % 1;
      p.timer -= dt;
      const ph = (p.timer * 1.4) % 1;
      const raise = ph > 0.3 ? (1 - ph) / 0.7 : ph / 0.3;
      r.armR.rotation.x = -0.4 - raise * 2.3;
      r.armL.rotation.x = -0.5 - raise * 1.2;
      r.torso.rotation.x = 0.25 - raise * 0.25;
      r.torso.rotation.y = -raise * 0.3;
      if (ph > before && p.timer > 0) {
        // Impacto: astillas y sacudida del árbol.
        tree.shake = 1;
        const hx = p.x + Math.sin(p.heading) * 0.75, hz = p.z + Math.cos(p.heading) * 0.75;
        emit(chipMat, hx, heightAt(hx, hz) + 0.7, hz, 4, 1.2, 0.05);
      }
      if (p.timer <= 0) {
        r.torso.rotation.y = 0;
        tree.state = 'falling';
        tree.omega = 0.3;
        p.state = 'watch';
      }
    } else if (p.state === 'watch') {
      r.armR.rotation.x = ease(r.armR.rotation.x, -0.3, dt);
      r.armL.rotation.x = ease(r.armL.rotation.x, 0, dt);
      r.torso.rotation.x = ease(r.torso.rotation.x, -0.05, dt);
      if (tree.state === 'shrink' || tree.state === 'regrow') {
        p.state = 'toHome';
        if (r.carry) r.carry.visible = true;
      }
    } else {
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.5, dt);
      p.timer -= dt;
      if (p.timer <= 0) {
        p.state = 'toWork';
        if (r.carry?.visible) {
          r.carry.visible = false;
          emit(chipMat, WOOD_PILE.x, 0.6, WOOD_PILE.z, 3, 0.8, 0.05, 0.6);
        }
      }
    }
    void t;
  }

  function updateHunter(p: Person, dt: number, t: number): void {
    const r = p.rig;
    if (p.cheer > 0) {
      p.cheer -= dt;
      const k = Math.sin(Math.max(0, p.cheer) * Math.PI * 2.5);
      r.armL.rotation.x = ease(r.armL.rotation.x, -2.8, dt, 14);
      r.armR.rotation.x = ease(r.armR.rotation.x, -2.6, dt, 14);
      p.bob = Math.abs(k) * 0.25;
      standPose(p, 0);
      return;
    }
    if (p.state === 'patrol') {
      p.timer += dt * 0.22;
      const tx = Math.cos(p.timer) * 3.25, tz = Math.sin(p.timer) * 3.25;
      walkTo(p, tx, tz, dt, 0.9);
      const swing = Math.sin(p.walk) * 0.4;
      r.armL.rotation.x = -swing;
      r.armR.rotation.x = ease(r.armR.rotation.x, -0.35, dt);
      return;
    }
    standPose(p, dt);
    // Charla junto al fuego: balanceo, gestos y algún golpe de lanza.
    const talk = Math.sin(t * 0.7 + p.phase);
    r.torso.rotation.y = Math.sin(t * 0.5 + p.phase) * 0.2;
    r.torso.rotation.x = 0.05 + Math.sin(t * 1.3 + p.phase) * 0.03;
    r.armL.rotation.x = talk > 0.6 ? -1.2 + Math.sin(t * 6 + p.phase) * 0.3 : ease(r.armL.rotation.x, -0.1, dt);
    r.armR.rotation.x = ease(r.armR.rotation.x, -0.35 + Math.max(0, Math.sin(t * 0.4 + p.phase * 2)) * -0.4, dt);
  }

  function updateFisher(p: Person, dt: number, t: number, jumper: (typeof jumpers)[number] | undefined): void {
    const r = p.rig, spot = fisherSpot(p.i), bob = p.bobberPos!;
    standPose(p, dt);
    p.timer -= dt;
    if (p.state === 'wait') {
      r.armR.rotation.x = ease(r.armR.rotation.x, -0.75 + Math.sin(t * 0.8 + p.phase) * 0.05, dt, 4);
      r.armL.rotation.x = ease(r.armL.rotation.x, -0.7, dt, 4);
      bob.set(spot.bob.x, -0.2 + Math.sin(t * 2.2 + p.phase) * 0.03, spot.bob.z);
      if (p.timer < 0.8 && p.timer > 0) bob.y -= Math.abs(Math.sin(t * 25)) * 0.08; // pican
      if (p.timer <= 0) {
        p.state = 'reel';
        p.timer = 0.5;
        ripple(bob.x, bob.z, 0.8);
        emit(splashMat, bob.x, -0.1, bob.z, 5, 0.8, 0.04);
        if (jumper && !jumper.active) {
          // El pez sale volando hacia el pescador.
          launch(jumper, bob.clone(), new THREE.Vector3(p.x, heightAt(p.x, p.z) + 0.9, p.z), 0.9);
          jumper.fish.userData.catch = true;
        }
      }
    } else if (p.state === 'reel') {
      r.armR.rotation.x = ease(r.armR.rotation.x, -1.7, dt, 14);
      bob.lerp(new THREE.Vector3(p.x, 0.6, p.z), Math.min(1, dt * 4));
      if (p.timer <= 0) {
        p.state = 'cast';
        p.timer = 1;
      }
    } else {
      // Lanza de nuevo: atrás y adelante; el anzuelo vuela en arco y cae al agua.
      const k = 1 - p.timer;
      r.armR.rotation.x = k < 0.4 ? -1.7 - k * 2 : -2.5 + (k - 0.4) * 2.9;
      if (k > 0.4) {
        const f = (k - 0.4) / 0.6;
        bob.set(
          THREE.MathUtils.lerp(p.x, spot.bob.x, f),
          THREE.MathUtils.lerp(1.6, -0.2, f) + Math.sin(f * Math.PI) * 1.5,
          THREE.MathUtils.lerp(p.z, spot.bob.z, f),
        );
      }
      if (p.timer <= 0) {
        p.state = 'wait';
        p.timer = 6 + fx() * 9;
        ripple(spot.bob.x, spot.bob.z, 0.6);
      }
    }
    p.bobber!.position.copy(bob);
    const tip = r.rodTip!.getWorldPosition(new THREE.Vector3());
    const arr = p.line!.geometry.attributes.position as THREE.BufferAttribute;
    arr.setXYZ(0, tip.x, tip.y, tip.z);
    arr.setXYZ(1, bob.x, bob.y, bob.z);
    arr.needsUpdate = true;
  }

  // Arbustos de bayas (siempre) y extras de las mejoras
  const bushMat = mat(0x3a6a34);
  const berryGroups: THREE.Object3D[] = [];
  for (const { x, z } of BUSHES) {
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
    swaying.push({ obj: g, phase: rng() * 6, amp: 0.05 });
  }

  // Montones que crecen con lo que acumula la tribu
  const foodPile = new THREE.Group();
  const foodBasket = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.55, 0.5, 9, 1, true), mat(0x7a5a32, { side: THREE.DoubleSide }));
  foodBasket.position.y = 0.25;
  foodPile.add(foodBasket);
  const pileBerries = Array.from({ length: 30 }, (_, k) => {
    const layer = Math.floor(k / 10), a = (k % 10) * 0.63 + layer, rad = (0.5 - layer * 0.17) * (0.5 + ((k * 37) % 10) / 20);
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), berryMat);
    b.position.set(Math.cos(a) * rad, 0.35 + layer * 0.14, Math.sin(a) * rad);
    foodPile.add(b);
    return b;
  });
  add(foodPile, FOOD_PILE.x, heightAt(FOOD_PILE.x, FOOD_PILE.z), FOOD_PILE.z);
  const woodPile = new THREE.Group();
  const logMat = mat(0x6b4527);
  const pileLogs = Array.from({ length: 15 }, (_, k) => {
    // Pirámide de 5-4-3-2-1 troncos
    let row = 0, left = k;
    while (left >= 5 - row) left -= 5 - row++;
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.3, 6), logMat);
    l.rotation.x = Math.PI / 2;
    l.position.set((left - (4 - row) / 2) * 0.27, 0.13 + row * 0.23, 0);
    woodPile.add(l);
    return l;
  });
  add(woodPile, WOOD_PILE.x, heightAt(WOOD_PILE.x, WOOD_PILE.z), WOOD_PILE.z);
  woodPile.rotation.y = -WOOD_ANGLE;

  let spearHide: THREE.Mesh | null = null, netMesh: THREE.Mesh | null = null;
  const upgradeProps: Record<string, () => THREE.Object3D> = {
    axes: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.6, 6), logMat);
        l.rotation.set(Math.PI / 2, 0, 0.3);
        l.position.set(0, 0.15 + Math.floor(i / 3) * 0.24, (i % 3) * 0.27 + (i >= 3 ? 0.13 : 0));
        g.add(l);
      }
      return add(g, LOG_PILE.x, 0, LOG_PILE.z);
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
      // La piel cuelga de la barra y ondea con el viento
      const hideGeo = new THREE.PlaneGeometry(1.4, 1, 4, 3);
      hideGeo.translate(0, -0.5, 0);
      spearHide = new THREE.Mesh(hideGeo, mat(0xc49a68, { side: THREE.DoubleSide }));
      spearHide.position.y = 1.72;
      g.add(bar, spearHide);
      g.rotation.y = 0.9;
      return add(g, SPEAR_RACK.x, 0, SPEAR_RACK.z);
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
      add(g, PAINT_ROCK.x, heightAt(PAINT_ROCK.x, PAINT_ROCK.z) + 0.8, PAINT_ROCK.z);
      g.lookAt(0, g.position.y, 0);
      return g;
    },
    nets: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 4), pole);
        p.position.set(i * 0.9, 0.8, 0);
        g.add(p);
      }
      const netGeo = new THREE.PlaneGeometry(1.8, 1.1, 6, 4);
      netGeo.translate(0, -0.55, 0);
      netMesh = new THREE.Mesh(netGeo, new THREE.MeshStandardMaterial({ color: 0xd9c9a0, wireframe: true }));
      netMesh.position.set(0.9, 1.45, 0);
      g.add(netMesh);
      return add(g, POND.x - 5.8, 0, POND.y + 2.5);
    },
  };
  const props: Record<string, THREE.Object3D> = {};
  let farm: THREE.Object3D | null = null;
  const sprouts: THREE.Object3D[] = [];
  function makeFarm() {
    const g = new THREE.Group();
    const soil = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 3), mat(0x5a3d26));
    g.add(soil);
    sprouts.length = 0;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 4), mat(0x7cc46a));
      sprout.geometry.translate(0, 0.22, 0);
      sprout.position.set(-1.6 + c * 0.64, 0.1, -1.1 + r * 0.72);
      sprout.userData.phase = r * 0.7 + c * 0.4;
      sprouts.push(sprout);
      g.add(sprout);
    }
    add(g, FARM.x, heightAt(FARM.x, FARM.z) + 0.05, FARM.z);
    g.lookAt(0, g.position.y, 0);
    return g;
  }

  let flash = 0;
  let lastFood = -1, lastWood = -1;
  function update(state: GameState) {
    const units = state.buildings.gatherer + state.buildings.woodcutter + state.buildings.hunter + state.buildings.fisher;
    const wantTents = Math.min(TENT_SLOTS.length, 1 + Math.floor(units / 6));
    while (tents.length < wantTents) {
      const t = TENT_SLOTS[tents.length];
      tents.push(spawn(makeTent(t.x, t.z, t.s, t.tone)));
    }
    while (tents.length > wantTents) scene.remove(tents.pop()!);
    for (const kind of Object.keys(people) as BuildingId[]) {
      const want = Math.min(MAX_SHOWN[kind], state.buildings[kind]);
      const list = people[kind];
      while (list.length < want) {
        const p = createPerson(kind, list.length);
        spawn(p.rig.root, kind === 'hunter' && list.length % 4 === 3 ? 0.75 : 1, true);
        list.push(p);
      }
      while (list.length > want) removePerson(list.pop()!);
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
    // Los montones crecen de forma logarítmica: se nota el avance sin llenar la escena.
    const food = Math.min(pileBerries.length, Math.round(3 + Math.log10(state.resources.food + 1) * 4.5));
    const wood = Math.min(pileLogs.length, Math.round(1 + Math.log10(state.resources.wood + 1) * 2.6));
    if (food !== lastFood) pileBerries.forEach((b, k) => (b.visible = k < food));
    if (wood !== lastWood) pileLogs.forEach((l, k) => (l.visible = k < wood));
    lastFood = food;
    lastWood = wood;
    dropDelay = 0;
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

  const tmp = new THREE.Vector3();
  function animateWorld(t: number, dt: number): void {
    const wind = 0.6 + Math.sin(t * 0.23) * 0.4;

    // Viento en árboles, arbustos, tiendas, piel colgada y redes
    for (const s of swaying) {
      s.obj.rotation.x = Math.sin(t * 1.1 + s.phase) * s.amp * wind;
      s.obj.rotation.z = Math.cos(t * 0.9 + s.phase) * s.amp * wind;
    }
    for (const tent of tents) {
      (tent.userData.door as THREE.Object3D).rotation.x = -Math.abs(Math.sin(t * 1.3 + tent.userData.phase)) * 0.25 * wind;
      (tent.userData.poles as THREE.Object3D).rotation.z = Math.sin(t * 1.7 + tent.userData.phase) * 0.06 * wind;
    }
    if (spearHide) spearHide.rotation.x = Math.sin(t * 2.1) * 0.25 * wind + 0.1;
    if (netMesh) netMesh.rotation.x = Math.sin(t * 1.6 + 1) * 0.18 * wind;
    for (const s of sprouts) s.rotation.z = Math.sin(t * 2 + s.userData.phase) * 0.2 * wind;

    // Árboles talados: caen como un péndulo invertido, rebotan y vuelven a crecer
    for (const tree of trees) {
      tree.shake = Math.max(0, tree.shake - dt * 4);
      tree.inner.rotation.z = Math.sin(t * 45) * tree.shake * 0.05;
      if (tree.state === 'falling') {
        tree.omega += (3.5 * Math.sin(tree.theta + 0.05)) * dt;
        tree.theta += tree.omega * dt;
        if (tree.theta >= 1.42) {
          tree.theta = 1.42;
          tree.omega = -tree.omega * 0.3;
          const tip = tree.inner.localToWorld(tmp.set(0, 2.2, 0));
          emit(chipMat, tip.x, tip.y + 0.2, tip.z, 5, 1.5, 0.06);
          if (Math.abs(tree.omega) < 0.4) {
            tree.state = 'down';
            tree.timer = 0.9;
          }
        }
      } else if (tree.state === 'down') {
        tree.timer -= dt;
        if (tree.timer <= 0) {
          tree.state = 'shrink';
          tree.timer = 0.5;
        }
      } else if (tree.state === 'shrink') {
        tree.timer -= dt;
        tree.inner.scale.setScalar(Math.max(0.001, tree.timer / 0.5));
        if (tree.timer <= 0) {
          tree.state = 'regrow';
          tree.theta = 0;
          tree.omega = 0;
          tree.timer = 0;
        }
      } else if (tree.state === 'regrow') {
        tree.timer += dt / 7;
        const k = Math.min(1, tree.timer);
        tree.inner.scale.setScalar(Math.max(0.001, 1 - Math.pow(1 - k, 3)));
        if (k >= 1) tree.state = 'standing';
      }
      tree.inner.rotation.x = tree.theta;
    }

    // Humo de la hoguera
    for (const m of smoke) {
      m.userData.age += dt / 4.5;
      if (m.userData.age > 1) m.userData.age -= 1;
      const a = m.userData.age as number;
      m.position.set(Math.sin(a * 5 + m.userData.spin) * 0.25 + a * a * 2.2 * wind, 1.6 + a * 5.5, Math.cos(a * 4) * 0.2 + a * 0.6);
      m.scale.setScalar(0.4 + a * 1.4);
      m.rotation.set(a * 2, a * 3 + m.userData.spin, 0);
      (m.material as THREE.MeshStandardMaterial).opacity = Math.sin(Math.PI * Math.min(1, a * 1.3)) * 0.28;
    }

    // Chispas
    for (let i = 0; i < EN; i++) {
      emberPos[i * 3 + 1] += emberSpeed[i] * dt;
      emberPos[i * 3] += Math.sin(t * 2 + i) * 0.2 * dt + wind * 0.15 * dt;
      if (emberPos[i * 3 + 1] > 4.5) emberPos.set([(fx() - 0.5) * 0.5, 0.6, (fx() - 0.5) * 0.5], i * 3);
    }
    emberGeo.attributes.position.needsUpdate = true;

    // Luciérnagas que se encienden y apagan
    for (let i = 0; i < FF; i++) {
      const b = ffBase[i];
      ffPos[i * 3] = b.x + Math.sin(t * 0.5 + i) * 0.8;
      ffPos[i * 3 + 1] = b.y + Math.sin(t * 0.8 + i * 1.7) * 0.35;
      ffPos[i * 3 + 2] = b.z + Math.cos(t * 0.45 + i * 2.3) * 0.8;
      const glow = Math.pow(Math.max(0, Math.sin(t * 1.3 + i * 2.1)), 4);
      ffCol[i * 3] = glow * 0.85;
      ffCol[i * 3 + 1] = glow;
      ffCol[i * 3 + 2] = glow * 0.35;
    }
    ffGeo.attributes.position.needsUpdate = true;
    ffGeo.attributes.color.needsUpdate = true;
    (stars.material as THREE.PointsMaterial).opacity = 0.85 + Math.sin(t * 0.7) * 0.15;

    // Superficie del lago y ondas
    const pp = pondGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const x = pondBase[i * 3], y = pondBase[i * 3 + 1], edge = 1 - Math.hypot(x, y) / POND_R;
      pp.setZ(i, (Math.sin(x * 1.3 + t * 1.6) + Math.cos(y * 1.1 - t * 1.3)) * 0.05 * edge);
    }
    pp.needsUpdate = true;
    pondGeo.computeVertexNormals();
    for (const m of ripples) {
      if (m.userData.age >= 1) continue;
      m.userData.age += dt / 1.6;
      const a = Math.min(1, m.userData.age);
      m.scale.setScalar((0.2 + a * 1.4) * m.userData.size);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - a) * 0.55;
    }
    if (fx() < dt * 0.35) {
      const a = fx() * Math.PI * 2, d = fx() * 3.8;
      ripple(POND.x + Math.cos(a) * d, POND.y + Math.sin(a) * d, 0.5);
    }

    // Peces: saltan solos o salen con el sedal
    for (const j of jumpers) {
      if (!j.active) {
        if (j.fish.userData.catch) continue;
        j.wait -= dt;
        if (j.wait <= 0) {
          const a = fx() * Math.PI * 2, d = fx() * 3, from = new THREE.Vector3(POND.x + Math.cos(a) * d, -0.25, POND.y + Math.sin(a) * d);
          const b = a + Math.PI / 2;
          const to = from.clone().add(new THREE.Vector3(Math.cos(b) * 1.3, 0, Math.sin(b) * 1.3));
          launch(j, from, to, 0.75);
          ripple(from.x, from.z, 0.8);
          emit(splashMat, from.x, -0.1, from.z, 4, 0.6, 0.04);
          j.wait = 3 + fx() * 6;
        }
        continue;
      }
      j.t += dt;
      const g = GRAVITY * 0.5;
      j.fish.position.set(j.from.x + j.v.x * j.t, j.from.y + j.v.y * j.t - 0.5 * g * j.t * j.t, j.from.z + j.v.z * j.t);
      const vy = j.v.y - g * j.t;
      j.fish.lookAt(tmp.set(j.fish.position.x + j.v.x, j.fish.position.y + vy, j.fish.position.z + j.v.z));
      j.fish.rotation.z += Math.sin(t * 30) * 0.3;
      const landed = j.fish.userData.catch ? j.t > 0.9 : j.fish.position.y < -0.25 && vy < 0;
      if (landed) {
        j.active = false;
        j.fish.visible = false;
        if (!j.fish.userData.catch) {
          ripple(j.fish.position.x, j.fish.position.z, 0.9);
          emit(splashMat, j.fish.position.x, -0.1, j.fish.position.z, 6, 0.9, 0.045);
        }
        j.fish.userData.catch = false;
      }
    }

    // Ciervos: pastan, levantan la cabeza y se desplazan a otro claro
    for (const d of deer) {
      d.timer -= dt;
      if (d.state === 'graze') {
        d.neck.rotation.x = ease(d.neck.rotation.x, Math.sin(t * 0.6 + d.heading) > 0.7 ? -0.2 : 1.35, dt, 2);
        d.legs.forEach((l) => (l.rotation.x = ease(l.rotation.x, 0, dt)));
        if (d.timer <= 0) {
          const to = deerSpot(Math.atan2(d.z, d.x));
          d.tx = to.x;
          d.tz = to.z;
          d.state = 'walk';
        }
      } else {
        const dx = d.tx - d.x, dz = d.tz - d.z, dist = Math.hypot(dx, dz);
        d.neck.rotation.x = ease(d.neck.rotation.x, -0.15, dt, 3);
        if (dist < 0.1) {
          d.state = 'graze';
          d.timer = 4 + fx() * 6;
        } else {
          const step = Math.min(dist, 1.1 * dt);
          d.x += (dx / dist) * step;
          d.z += (dz / dist) * step;
          d.heading = lerpAngle(d.heading, Math.atan2(dx, dz), Math.min(1, dt * 3));
          d.walk += dt * 7;
          d.legs.forEach((l, k) => (l.rotation.x = Math.sin(d.walk + (k === 0 || k === 3 ? 0 : Math.PI)) * 0.5));
        }
      }
      d.root.position.set(d.x, heightAt(d.x, d.z) + (d.state === 'walk' ? Math.abs(Math.sin(d.walk)) * 0.05 : 0), d.z);
      d.root.rotation.y = d.heading;
    }

    // Pájaros
    if (!flight.active) {
      flight.wait -= dt;
      if (flight.wait <= 0) {
        const a = fx() * Math.PI * 2;
        flight.from.set(Math.cos(a) * 55, 15 + fx() * 6, Math.sin(a) * 55);
        flight.dir.set(-Math.cos(a + (fx() - 0.5) * 0.8), 0, -Math.sin(a + (fx() - 0.5) * 0.8));
        flight.t = 0;
        flight.active = true;
        flock.visible = true;
      }
    } else {
      flight.t += dt;
      flock.position.copy(flight.from).addScaledVector(flight.dir, flight.t * 7);
      flock.position.y += Math.sin(flight.t * 0.8) * 1.2;
      flock.lookAt(tmp.copy(flock.position).add(flight.dir));
      for (const { b, wings } of birds) {
        const flap = Math.sin(t * 9 + b.userData.phase) * 0.7;
        wings[0].rotation.z = flap;
        wings[1].rotation.z = -flap;
      }
      if (flight.t * 7 > 110) {
        flight.active = false;
        flock.visible = false;
        flight.wait = 12 + fx() * 20;
      }
    }

    // Trocitos con gravedad que rebotan en el suelo
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      d.v.y -= GRAVITY * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      const floor = Math.max(heightAt(d.mesh.position.x, d.mesh.position.z), Math.hypot(d.mesh.position.x - POND.x, d.mesh.position.z - POND.y) < POND_R ? -0.25 : -99);
      if (d.mesh.position.y < floor + 0.03) {
        if (!d.ground) d.life = 0;
        d.mesh.position.y = floor + 0.03;
        d.v.y = Math.abs(d.v.y) * 0.35;
        d.v.x *= 0.6;
        d.v.z *= 0.6;
        d.spin.multiplyScalar(0.5);
      }
      if (d.life < 0.3) d.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 6));
      if (d.life <= 0) {
        scene.remove(d.mesh);
        debris.splice(i, 1);
      }
    }
  }

  const clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    if (!visible || document.hidden) return;
    const t = clock.getElapsedTime();
    if (!reduceMotion && dragX === null) angle += 0.09 * dt;
    camera.position.set(Math.cos(angle) * 21, 9.5, Math.sin(angle) * 21);
    camera.lookAt(0, 1.2, 0);

    const big = fireGroup.userData.big ? 1.35 : 1;
    flash = Math.max(0, flash - dt * 3);
    flames.forEach((f, k) => {
      const s = (1 + (reduceMotion ? 0 : Math.sin(t * (9 + k * 3)) * 0.08 + Math.sin(t * 23 + k) * 0.05)) * big * (1 + flash * 0.3);
      f.scale.set(big / Math.sqrt(s / big), s, big / Math.sqrt(s / big));
      f.rotation.y = t * (1 + k);
      f.position.y = 0.3 + (f.userData.h * s) / 2;
    });
    fireLight.intensity = (55 + Math.sin(t * 11) * 6 + Math.sin(t * 27) * 4) * big * (1 + flash);

    if (!reduceMotion) {
      animateWorld(t, dt);
      for (const kind of Object.keys(people) as BuildingId[]) {
        for (const p of people[kind]) {
          if (kind === 'gatherer') updateGatherer(p, dt, t);
          else if (kind === 'woodcutter') updateWoodcutter(p, dt, t);
          else if (kind === 'hunter') updateHunter(p, dt, t);
          else updateFisher(p, dt, t, jumpers[p.i % jumpers.length]);
          if (p.rig.tool) p.rig.tool.rotation.x = -p.rig.armR.rotation.x;
          p.rig.root.position.set(p.x, heightAt(p.x, p.z) + p.bob, p.z);
          p.rig.root.rotation.y = p.heading;
        }
      }
    }

    // Lo nuevo cae del cielo y rebota hasta asentarse
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      if (d.delay > 0) {
        d.delay -= dt;
        if (d.delay > 0) continue;
      }
      d.obj.visible = true;
      d.vy -= GRAVITY * 1.4 * dt;
      d.offset += d.vy * dt;
      if (d.offset <= 0) {
        d.offset = 0;
        if (Math.abs(d.vy) > 2.5) {
          d.squash = Math.min(0.4, Math.abs(d.vy) * 0.025);
          d.vy = -d.vy * 0.32;
        } else d.vy = 0;
      }
      d.squash = Math.max(0, d.squash - dt * 2.2);
      const sq = Math.sin(d.squash * Math.PI) * 0.6;
      d.obj.scale.set(d.scale * (1 + sq * 0.5), d.scale * (1 - sq * 0.6), d.scale * (1 + sq * 0.5));
      if (d.dynamic) d.obj.position.y += d.offset;
      else d.obj.position.y = d.baseY + d.offset;
      if (d.offset === 0 && d.vy === 0 && d.squash === 0) {
        d.obj.scale.setScalar(d.scale);
        drops.splice(i, 1);
      }
    }
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  return {
    update,
    pulse() {
      flash = 1;
      emit(berryBurstMat, FOOD_PILE.x, 0.8, FOOD_PILE.z, 4, 1.2, 0.08);
    },
    celebrate() {
      for (const p of people.hunter) p.cheer = 0.9;
      flash = Math.max(flash, 0.6);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      renderer.dispose();
    },
  };
}
