import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingId, GameState } from '../game/state';
import { BUILDING_DEFS } from '../game/content';
import { DEFAULT_FPS, DEFAULT_QUALITY, frameIntervals, pixelRatioFor, QUALITY_PRESETS, type FpsLimit, type QualityLevel } from './quality';

// Escena 3D low poly. Lee el estado del juego y hace crecer la aldea; nunca lo modifica.
// Cada oficio tiene su rutina (ir, trabajar, volver) y el entorno se mueve con viento,
// humo, agua y animales para que el progreso se sienta vivo. En el Paleolítico es de noche
// junto al fuego; al llegar el Neolítico amanece y aparecen campos, rebaños, casas de barro,
// la cantera y las minas de sílex. En la Edad del Bronce cae una tarde dorada y llegan los
// hornos de fundición, la mina de cobre, los campos arados con bueyes, las carboneras y las
// casas de piedra. Con cada era el bosque retrocede y el claro de la aldea se hace más grande.

const POND = new THREE.Vector2(11, -7);
const POND_R = 5.2;
const MAX_SHOWN: Record<BuildingId, number> = {
  gatherer: 10, woodcutter: 10, hunter: 8, feller: 8, fisher: 6, rafter: 4,
  quarrier: 4, farmer: 6, forester: 4, herder: 3, carpenter: 4, miner: 3,
  smelter: 4, mason: 4, plowman: 3, charcoaler: 4, copperMiner: 4,
};
// Radio del claro de la aldea en cada era: más allá empieza el bosque. Al pasar de era se talan
// los árboles que quedan dentro y la cámara se aleja para que se note el crecimiento.
const CLEARING: Record<number, number> = { 1: 24, 2: 31, 3: 40 };
const CAMERA: Record<number, { r: number; y: number }> = { 1: { r: 21, y: 9.5 }, 2: { r: 29, y: 15 }, 3: { r: 39, y: 23 } };
const FOG: Record<number, [number, number]> = { 1: [28, 85], 2: [36, 110], 3: [48, 140] };
// Las colinas empiezan detrás del claro de la última era.
const HILLS_R = 50;
const JOB_ERA = Object.fromEntries(BUILDING_DEFS.map((b) => [b.id, b.era])) as Record<BuildingId, number>;
// Las viviendas de cada era crecen con sus propios oficios. En el Paleolítico cuentan solo los
// que viven junto al fuego.
const BUILDINGS_OF: Record<number, BuildingId[]> = {
  1: ['gatherer', 'woodcutter', 'hunter', 'fisher'],
  2: BUILDING_DEFS.filter((b) => b.era === 2).map((b) => b.id),
  3: BUILDING_DEFS.filter((b) => b.era === 3).map((b) => b.id),
};
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
  h += Math.max(0, r - HILLS_R) * 0.35;
  // La colina de la mina de cobre
  const md = Math.hypot(x - COPPER_HILL.x, z - COPPER_HILL.z);
  if (md < 7) h += Math.cos((md / 7) * Math.PI * 0.5) ** 2 * 3.2;
  const pd = Math.hypot(x - POND.x, z - POND.y);
  if (pd < 5.5) h = Math.min(h, -0.6 + (pd / 5.5) * 0.6);
  return h;
}

// ---------- Distribución del campamento ----------
// Se calcula una sola vez para que las rutas de trabajo nunca atraviesen tiendas ni rocas.
const FARM = polar(2.5, 12);
// Zonas de trabajo del Neolítico, fuera del anillo de casas.
// Desde la era 2 el claro es más grande, así que quedan más separadas que antes.
const FIELDS = polar(2.5, 16.5);
const PEN = polar(-1.43, 17.5);
const PEN_R = 2.7;
const QUARRY = polar(3.3, 21.5);
const MINE = polar(0.06, 20.5);
const NURSERY = polar(1.88, 15.5);
const BENCHES = [polar(1.47, 6.5), polar(1.58, 8.1)];
const POTS = polar(-1.5, 3.7);
const MENHIRS = polar(2.92, 27);
// Zonas de la Edad del Bronce, en el anillo que se gana al bosque.
const FOUNDRY = polar(-0.85, 26);
const COPPER_HILL = polar(0.42, 34);
const COPPER_MOUTH = polar(0.42, 29.6);
const PLOW = polar(-0.28, 31.5);
const CHARCOAL = polar(1.2, 26.5);
const MASONRY = polar(-2.05, 25.5);
const SKY_DISK = polar(-0.2, 11.5);
const CART = polar(-2.75, 13.5);
const PAINT_ROCK = polar(3.0, 10.2);
const SPEAR_RACK = { x: -4.5, z: 2.5 };
const LOG_PILE = { x: 3.6, z: -3 };
const inCorridor = (x: number, z: number, margin: number) => {
  const a = Math.atan2(z, x);
  return angDist(a, GATHER_ANGLE) < margin || angDist(a, WOOD_ANGLE) < margin;
};
const blockers: { x: number; z: number; r: number }[] = [
  { ...FARM, r: 2.8 },
  { ...FIELDS, r: 3.4 },
  { ...PEN, r: PEN_R + 0.6 },
  { ...QUARRY, r: 3 },
  { ...MINE, r: 2.6 },
  { ...NURSERY, r: 2 },
  { ...BENCHES[0], r: 1.1 },
  { ...BENCHES[1], r: 1.1 },
  { ...MENHIRS, r: 3.2 },
  { ...FOUNDRY, r: 4 },
  { ...COPPER_HILL, r: 7.5 },
  { ...PLOW, r: 6.5 },
  { ...CHARCOAL, r: 3.8 },
  { ...MASONRY, r: 3.6 },
  { ...SKY_DISK, r: 1.2 },
  { ...CART, r: 1.8 },
  { ...PAINT_ROCK, r: 2.2 },
  { ...SPEAR_RACK, r: 1.6 },
  { ...LOG_PILE, r: 1.3 },
];
const isFree = (x: number, z: number, r: number) =>
  Math.hypot(x - POND.x, z - POND.y) > POND_R + 0.8 + r && blockers.every((b) => Math.hypot(x - b.x, z - b.z) > b.r + r);

type Slot = { x: number; z: number; s: number; tone: number };
/** Huecos para viviendas en anillos de dentro hacia fuera: las primeras quedan cerca del fuego. */
function dwellingSlots(rings: number[], max: number, r: number, reserve: boolean): Slot[] {
  const slots: Slot[] = [];
  for (const d of rings) {
    for (let k = 0; k < 126 && slots.length < max; k++) {
      const { x, z } = polar(-Math.PI + k * 0.05, d);
      if (inCorridor(x, z, 0.5 + 1.4 / d) || !isFree(x, z, r) || slots.some((o) => Math.hypot(o.x - x, o.z - z) < r * 2)) continue;
      slots.push({ x, z, s: 0.8 + ((slots.length * 7) % 5) * 0.08, tone: slots.length % 2 });
    }
  }
  if (reserve) for (const sl of slots) blockers.push({ ...sl, r });
  return slots;
}
// Casas de barro del Neolítico y casas de piedra de la Edad del Bronce: cada era ocupa más anillos.
const HUT_SLOTS = dwellingSlots([7, 9.4, 11.8, 14.2], 16, 1.55, false);
const HOUSE_SLOTS = dwellingSlots([9.4, 11.8, 14.2, 16.6, 19.2, 21.8], 26, 1.35, false);
const TENT_SLOTS = dwellingSlots([6.2, 8, 9.8], 10, 1.45, true);
const BUSHES = Array.from({ length: 8 }, (_, k) => polar(GATHER_ANGLE + (k - 3.5) * 0.15, 11 + (k % 2) * 1.4));
const GROVE = Array.from({ length: MAX_SHOWN.woodcutter }, (_, k) => polar(WOOD_ANGLE + (k - 4.5) * 0.12, 11 + (k % 2) * 1.7));
// Los taladores trabajan árboles más grandes, detrás de la arboleda y en sus huecos.
const BIG_GROVE = Array.from({ length: MAX_SHOWN.feller }, (_, k) => polar(WOOD_ANGLE + (k - 3.5) * 0.12 + 0.06, 14.6 + (k % 2) * 1.3));
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
  raft?: THREE.Group;
  bobberPos?: THREE.Vector3;
  /** Trigo, plantón o pozo en el que trabaja. */
  target?: number;
  /** Profundidad dentro del pozo de sílex (negativa = bajo tierra). */
  depth?: number;
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
  /** Detiene el dibujo mientras una ventana tapa la escena. */
  setPaused(paused: boolean): void;
  /** Nivel de calidad gráfica (1 = máximo rendimiento, 5 = máxima calidad) y tope de fps. */
  setGraphics(quality: QualityLevel, fps: FpsLimit): void;
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
    return { update() {}, pulse() {}, celebrate() {}, setPaused() {}, setGraphics() {}, dispose() {} };
  }
  renderer.setPixelRatio(pixelRatioFor(DEFAULT_QUALITY, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  let quality = QUALITY_PRESETS[DEFAULT_QUALITY];

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rng = mulberry32(7);
  const fx = Math.random; // efectos que no necesitan ser deterministas
  const scene = new THREE.Scene();
  // Lo que se añade a la escena se revisa en el siguiente fotograma (ver trimShadows()).
  const newObjects: THREE.Object3D[] = [];
  scene.addEventListener('childadded', (e) => newObjects.push(e.child));
  scene.fog = new THREE.Fog(0x3a2a52, 28, 85);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
  let shownEra = 0;
  const add = <T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0, shadow = true): T => {
    o.position.set(x, y, z);
    if (shadow) o.traverse((c) => { c.castShadow = true; c.receiveShadow = true; });
    scene.add(o);
    return o;
  };

  // Cielo, estrellas y luna. El cielo guarda sus colores de noche y de día para el amanecer.
  const skyGeo = new THREE.SphereGeometry(200, 24, 16);
  const skyGradient = (top: THREE.Color, mid: THREE.Color, hor: THREE.Color) => {
    const out: number[] = [];
    for (let i = 0; i < skyGeo.attributes.position.count; i++) {
      const y = skyGeo.attributes.position.getY(i) / 200;
      const c = y > 0.25 ? mid.clone().lerp(top, Math.min(1, (y - 0.25) / 0.5)) : hor.clone().lerp(mid, Math.max(0, (y + 0.05) / 0.3));
      out.push(c.r, c.g, c.b);
    }
    return out;
  };
  const skyNight = skyGradient(new THREE.Color(0x0f0b24), new THREE.Color(0x3a2558), new THREE.Color(0xc8645a));
  const skyDay = skyGradient(new THREE.Color(0x4f8fd6), new THREE.Color(0x92c3ec), new THREE.Color(0xf7dcae));
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyNight, 3));
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
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xf3e9cc, fog: false, transparent: true });
  add(new THREE.Mesh(new THREE.IcosahedronGeometry(7, 1), moonMat), -70, 60, -110, false);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8, fog: false, transparent: true, opacity: 0 });
  const sun = add(new THREE.Mesh(new THREE.IcosahedronGeometry(9, 2), sunMat), 90, 80, 60, false);
  const sunHalo = new THREE.Mesh(new THREE.IcosahedronGeometry(15, 2), new THREE.MeshBasicMaterial({ color: 0xffe7a0, fog: false, transparent: true, opacity: 0, depthWrite: false }));
  sun.add(sunHalo);
  // Nubes de día: bloques suaves que cruzan despacio
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const clouds = Array.from({ length: 7 }, (_, k) => {
    const g = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + rng() * 2.5, 0), cloudMat);
      puff.position.set((j - 1.5) * 4.2, rng() * 1.5, (rng() - 0.5) * 3);
      puff.scale.y = 0.55;
      g.add(puff);
    }
    const a = (k / 7) * Math.PI * 2;
    g.position.set(Math.cos(a) * 95, 38 + rng() * 14, Math.sin(a) * 95);
    g.userData.a = a;
    g.visible = false;
    scene.add(g);
    return g;
  });

  // Luces
  const hemi = new THREE.HemisphereLight(0x8a7ac8, 0x2a1a10, 1.6);
  scene.add(hemi);
  const moonLight = new THREE.DirectionalLight(0x9aa8ff, 1.3);
  moonLight.position.set(-25, 35, -20);
  moonLight.castShadow = true;
  Object.assign(moonLight.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 1, far: 130 });
  moonLight.shadow.mapSize.set(2048, 2048);
  // Las sombras se recalculan a mano, una luz por fotograma (ver frame()).
  moonLight.shadow.autoUpdate = false;
  scene.add(moonLight);
  const fireLight = new THREE.PointLight(0xff8a3a, 60, 26, 2);
  fireLight.position.set(0, 1.4, 0);
  fireLight.castShadow = true;
  fireLight.shadow.mapSize.set(512, 512);
  fireLight.shadow.autoUpdate = false;
  scene.add(fireLight);

  // Terreno
  let tg: THREE.BufferGeometry = new THREE.PlaneGeometry(250, 250, 112, 112);
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
    else if (cy > 4 && Math.hypot(cx - COPPER_HILL.x, cz - COPPER_HILL.z) > 7) c = rockC.clone().lerp(new THREE.Color(0x8a8296), Math.min(1, (cy - 4) / 8));
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

  // Montañas (de noche se ven violetas; de día, azuladas por la distancia)
  const mountainMat = mat(0x4a4066);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng() * 0.2, d = 92 + rng() * 16, r = 14 + rng() * 12, h = 22 + rng() * 22, rot = rng() * Math.PI;
    const mx = Math.cos(a) * d, mz = Math.sin(a) * d;
    add(new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), mountainMat), mx, h / 2 - 1, mz, false).rotation.y = rot;
    const sh = h * 0.3;
    add(new THREE.Mesh(new THREE.ConeGeometry(r * 0.3 + 0.05, sh, 5), mat(0xe9e6f4)), mx, h - 1 - sh / 2 + 0.02, mz, false).rotation.y = rot;
  }

  // Bosque que se mece con el viento
  const pineMats = [mat(0x2a5034), mat(0x2f5a3a), mat(0x356640)], trunkMat = mat(0x5a3a22);
  const swaying: { obj: THREE.Object3D; phase: number; amp: number }[] = [];
  // La copa de cada pino son tres conos unidos en una sola pieza, cada uno con su tono de verde
  // (colores por vértice): se ve igual que tres piezas sueltas y se dibuja de una vez.
  const pineCrownMat = mat(0xffffff, { vertexColors: true });
  const pineColors = pineMats.map((m) => m.color);
  const makePine = (s: number) => {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 0.9 * s, 5), trunkMat);
    t.position.y = 0.45 * s;
    g.add(t);
    const cones = [0, 1, 2].map((k) => {
      const c = new THREE.ConeGeometry((1.15 - k * 0.28) * s, 1.4 * s, 7);
      const col = pineColors[(k + Math.floor(rng() * 3)) % 3];
      c.rotateY(rng() * 3);
      c.translate(0, k * 0.75 * s, 0);
      c.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: c.attributes.position.count }, () => [col.r, col.g, col.b]).flat(), 3));
      return c;
    });
    const crown = new THREE.Mesh(mergeGeometries(cones)!, pineCrownMat);
    crown.position.y = 1.2 * s;
    g.add(crown);
    return g;
  };
  // Bosque: un anillo cerca del fuego (solo en el Paleolítico) y uno ancho alrededor del claro.
  // Cada pino recuerda en qué era se tala: entonces se encoge y deja un tocón.
  interface Pine { obj: THREE.Group; clearedIn: number; k: number }
  const pines: Pine[] = [];
  const stumpMat = mat(0x8a6440);
  for (let i = 0, near = 0, far = 0; i < 1400 && far < 230; i++) {
    const isNear = near < 14;
    const a = rng() * Math.PI * 2, d = isNear ? 9 + rng() * 4 : 25 + Math.pow(rng(), 0.85) * 36;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - POND.x, z - POND.y) < 7.5) continue;
    if (isNear && (inCorridor(x, z, 0.75) || !isFree(x, z, 1.2))) continue;
    // Los pinos del bosque lejano no crecen encima de lo que se construirá en su era.
    if (!isNear && blockers.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + 0.6)) continue;
    if (isNear) near++;
    else far++;
    const g = add(makePine(0.8 + rng() * 0.8), x, heightAt(x, z) - 0.05, z);
    // Fuera del alcance de la sombra del sol no hace falta que proyecten sombra
    if (d > 44) g.traverse((c) => (c.castShadow = false));
    swaying.push({ obj: g, phase: rng() * 6, amp: 0.02 + rng() * 0.025 });
    const clearedIn = isNear ? 2 : d < CLEARING[2] ? 2 : d < CLEARING[3] ? 3 : 99;
    pines.push({ obj: g, clearedIn, k: 1 });
  }
  /** Tala (o vuelve a plantar) los pinos del claro de la era. Con `animate`, se encogen poco a poco. */
  function clearForest(era: number, animate: boolean): void {
    for (const p of pines) {
      const target = era >= p.clearedIn ? 0 : 1;
      if (!animate) setPine(p, target);
      p.obj.userData.target = target;
    }
  }
  function setPine(p: Pine, k: number): void {
    p.k = k;
    const [trunk, crown] = p.obj.children;
    crown.visible = k > 0.02;
    crown.scale.setScalar(Math.max(0.02, k));
    // Al talarlo queda un tocón claro
    trunk.userData.y0 ??= trunk.position.y;
    trunk.scale.y = 0.3 + 0.7 * k;
    trunk.position.y = trunk.userData.y0 * trunk.scale.y;
    (trunk as THREE.Mesh).material = k < 0.5 ? stumpMat : trunkMat;
  }
  const rockMat = mat(0x7a7484);
  for (let i = 0; i < 34; i++) {
    const a = rng() * Math.PI * 2, d = 7 + rng() * 36, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if ((d < 13 && inCorridor(x, z, 0.3)) || !isFree(x, z, 0.6)) continue;
    const r = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng() * 0.8, 0), rockMat), x, heightAt(x, z), z);
    r.scale.y = 0.6;
    r.rotation.set(rng(), rng() * 3, rng());
  }

  // Arboleda de los leñadores: cada árbol se tala, cae y vuelve a crecer
  const makeGrove = (spots: { x: number; z: number }[], size: number): Tree[] =>
    spots.map(({ x, z }) => {
      const pivot = new THREE.Group();
      const inner = makePine(size + rng() * 0.3);
      pivot.add(inner);
      add(pivot, x, heightAt(x, z) - 0.05, z);
      pivot.rotation.y = Math.atan2(x, z); // cae hacia fuera, lejos del leñador
      return { pivot, inner, state: 'standing', theta: 0, omega: 0, timer: 0, shake: 0 } as Tree;
    });
  const trees = makeGrove(GROVE, 1);
  const bigTrees = makeGrove(BIG_GROVE, 1.4);

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
  /** Al cambiar de era, la gente nueva llega dando un saltito en vez de caer desde muy alto. */
  let gentleDrops = false;
  const spawn = <T extends THREE.Object3D>(obj: T, scale = 1, dynamic = false): T => {
    obj.scale.setScalar(scale);
    if (reduceMotion) return obj;
    const offset = gentleDrops && dynamic ? 1 + fx() : 7 + fx() * 2;
    drops.push({ obj, baseY: obj.position.y, dynamic, delay: dropDelay, offset, vy: 0, squash: 0, scale });
    // Si llegan muchas cosas a la vez (al cargar una partida grande), caen más juntas.
    dropDelay = Math.min(dropDelay + 0.07, 3);
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
  // Los ciervos pastan cerca del borde del bosque y se apartan de lo construido.
  const deerZones = () => blockers.filter((b) => b.r > 1.9);
  const deerRing = () => CLEARING[Math.max(1, shownEra)] - 9.5;
  const deerSpot = (fromAngle: number) => {
    for (let n = 0; n < 60; n++) {
      const a = fromAngle + (fx() - 0.5) * 1.2, d = deerRing() + fx() * 3;
      if (angDist(a, Math.atan2(POND.y, POND.x)) < 0.55 || angDist(a, WOOD_ANGLE) < 0.75) continue;
      const p = polar(a, d);
      if (shownEra >= 2 && deerZones().some((z) => Math.hypot(p.x - z.x, p.z - z.z) < z.r + 0.8)) continue;
      return p;
    }
    return polar(shownEra >= 2 ? 3.75 + (fx() - 0.5) * 0.4 : fromAngle, deerRing() + 1);
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
  // En el Neolítico ya se teje: túnicas de lino y lana teñidas.
  const clothes: Record<BuildingId, number> = {
    gatherer: 0x9a7048, woodcutter: 0x6b4a2c, hunter: 0x8b5a3c, feller: 0x5a3a26, fisher: 0x56606d, rafter: 0x4a6a62,
    quarrier: 0x7a7468, farmer: 0xd6c08a, forester: 0x5f7a3a, herder: 0xb0784a, carpenter: 0x9a6a3e, miner: 0x5c5248,
    smelter: 0x7a3a24, mason: 0xa49c8a, plowman: 0xb89a62, charcoaler: 0x3e3a38, copperMiner: 0x4f6a5e,
  };
  const wheatMat = mat(0xe2b64a), flintMat = mat(0x2e2a30, { roughness: 0.6 }), blockMat = mat(0xa8a3a0), clayMat = mat(0xb5683a);
  const wrapMat = mat(0x3d2a1c), stoneMat = mat(0x9a9aa8), berryMat = mat(0xc23a3a);
  const bronzeHeadMat = mat(0xc98a3a, { metalness: 0.5, roughness: 0.45 }), oreHeadMat = mat(0x3f9a7a);
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
    } else if (kind === 'woodcutter' || kind === 'feller') {
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
      if (kind === 'feller') log.scale.set(1.35, 1.25, 1.35);
    } else if (kind === 'rafter') {
      // Pértiga larga para empujar la balsa
      const pole2 = new THREE.Group();
      pole2.position.set(0, -0.48, 0.02);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 4), pole);
      stick.position.y = 0.1;
      pole2.add(stick);
      armR.add(pole2);
      rig.tool = pole2;
    } else if (kind === 'farmer') {
      // Hoz de sílex y una gavilla de trigo a la espalda
      const sickle = new THREE.Group();
      sickle.position.set(0, -0.48, 0.02);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 4), pole);
      handle.rotation.x = Math.PI / 2;
      handle.position.z = 0.15;
      const blade = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 3, 8, Math.PI * 1.1), stoneMat);
      blade.position.set(0, 0.12, 0.36);
      blade.rotation.y = Math.PI / 2;
      sickle.add(handle, blade);
      armR.add(sickle);
      const sheaf = new THREE.Group();
      const stalks = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.6, 6), wheatMat);
      const ears = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.32, 6), wheatMat);
      ears.position.y = 0.42;
      ears.rotation.x = Math.PI;
      sheaf.add(stalks, ears);
      sheaf.position.set(0.05, 0.55, -0.27);
      sheaf.rotation.z = 0.35;
      torso.add(sheaf);
      rig.carry = sheaf;
    } else if (kind === 'herder') {
      // Cayado de pastor, siempre vertical
      const staff = new THREE.Group();
      staff.position.set(0, -0.48, 0.02);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.9, 4), pole);
      shaft.position.y = 0.5;
      const crook = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 4, 8, Math.PI * 1.2), pole);
      crook.position.set(0.12, 1.45, 0);
      staff.add(shaft, crook);
      armR.add(staff);
      rig.tool = staff;
    } else if (kind === 'forester') {
      // Vasija de barro para regar los plantones
      const jug = new THREE.Group();
      jug.position.set(0, -0.5, 0.06);
      const body2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.26, 7), clayMat);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.08, 7), clayMat);
      neck.position.y = 0.16;
      jug.add(body2, neck);
      armR.add(jug);
    } else if (kind === 'carpenter' || kind === 'quarrier' || kind === 'miner') {
      // Azuela (carpintero), mazo de piedra (cantero) o pico de asta (minero)
      const tool = new THREE.Group();
      tool.position.set(0, -0.48, 0.02);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 4), pole);
      handle.rotation.x = Math.PI / 2;
      handle.position.z = 0.3;
      tool.add(handle);
      if (kind === 'carpenter') {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.16), stoneMat);
        head.position.set(0, -0.02, 0.64);
        tool.add(head);
      } else if (kind === 'quarrier') {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.3), blockMat);
        head.position.set(0, 0, 0.66);
        tool.add(head);
      } else {
        const tine = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 4), antlerMat);
        tine.position.set(0, -0.16, 0.62);
        tine.rotation.x = Math.PI - 0.3;
        tool.add(tine);
      }
      armR.add(tool);
      if (kind === 'quarrier') {
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.3), blockMat);
        block.position.set(0, 0.72, -0.18);
        torso.add(block);
        rig.carry = block;
      } else if (kind === 'miner') {
        const basket = new THREE.Group();
        basket.position.set(0, 0.35, -0.3);
        basket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.32, 7), mat(0x7a5a32)));
        const load = new THREE.Group();
        for (let k = 0; k < 5; k++) {
          const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), flintMat);
          b.position.set((k % 3 - 1) * 0.1, 0.17, (Math.floor(k / 3) - 0.5) * 0.12);
          load.add(b);
        }
        basket.add(load);
        torso.add(basket);
        rig.carry = load;
      }
    } else if (kind === 'smelter' || kind === 'mason') {
      // Fundidor con un lingote al hombro; picapedrero con maza y un sillar
      const tool = new THREE.Group();
      tool.position.set(0, -0.48, 0.02);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 4), pole);
      handle.rotation.x = Math.PI / 2;
      handle.position.z = 0.2;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.2), kind === 'smelter' ? stoneMat : bronzeHeadMat);
      head.position.set(0, 0, 0.44);
      tool.add(handle, head);
      armR.add(tool);
      const load = new THREE.Mesh(kind === 'smelter' ? new THREE.BoxGeometry(0.46, 0.13, 0.26) : new THREE.BoxGeometry(0.5, 0.3, 0.34), kind === 'smelter' ? bronzeHeadMat : mat(0xd6cab2));
      load.position.set(0, 0.72, -0.18);
      torso.add(load);
      rig.carry = load;
    } else if (kind === 'charcoaler') {
      // Pértiga para avivar la carbonera y un tronco al hombro
      const stick = new THREE.Group();
      stick.position.set(0, -0.48, 0.02);
      const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 4), pole);
      s2.position.y = 0.2;
      stick.add(s2);
      armR.add(stick);
      rig.tool = stick;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.95, 6), mat(0x6b4527));
      log.position.set(0, 0.68, -0.22);
      log.rotation.z = Math.PI / 2;
      torso.add(log);
      rig.carry = log;
    } else if (kind === 'copperMiner') {
      // Pico de bronce y un capazo de mineral verde a la espalda
      const tool = new THREE.Group();
      tool.position.set(0, -0.48, 0.02);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 4), pole);
      handle.rotation.x = Math.PI / 2;
      handle.position.z = 0.3;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.45, 4), bronzeHeadMat);
      head.rotation.z = Math.PI / 2;
      head.position.set(0, 0, 0.64);
      tool.add(handle, head);
      armR.add(tool);
      const basket = new THREE.Group();
      basket.position.set(0, 0.35, -0.3);
      basket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.32, 7), mat(0x7a5a32)));
      const load = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), oreHeadMat);
        b.position.set((k % 3 - 1) * 0.1, 0.17, (Math.floor(k / 3) - 0.5) * 0.12);
        load.add(b);
      }
      basket.add(load);
      torso.add(basket);
      rig.carry = load;
    } else if (kind === 'plowman') {
      // Vara para guiar a los bueyes, siempre en alto
      const goad = new THREE.Group();
      goad.position.set(0, -0.48, 0.02);
      const g2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.6, 4), pole);
      g2.position.y = 0.5;
      goad.add(g2);
      armR.add(goad);
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

  const people = Object.fromEntries(Object.keys(MAX_SHOWN).map((k) => [k, []])) as unknown as Record<BuildingId, Person[]>;
  const homeOf = (p: Person) =>
    p.kind === 'feller'
      ? polar(WOOD_ANGLE + (p.i - 3.5) * 0.09 + 0.04, HOME_R + 0.9 + (p.i % 2) * 0.4)
      : polar((p.kind === 'gatherer' ? GATHER_ANGLE : WOOD_ANGLE) + (p.i - 4.5) * 0.08, HOME_R + (p.i % 2) * 0.4);
  const workOf = (p: Person) => {
    const spot = p.kind === 'gatherer' ? BUSHES[p.i % BUSHES.length] : p.kind === 'feller' ? BIG_GROVE[p.i] : GROVE[p.i];
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
    if (kind === 'gatherer' || kind === 'woodcutter' || kind === 'feller') {
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
    } else if (kind === 'farmer') {
      const start = around(FIELDS, (i - 2.5) * 0.8, -2.9);
      [p.x, p.z, p.state] = [start.x, start.z, 'toWork'];
    } else if (kind === 'herder') {
      p.timer = i * 2.1 + 0.5;
      p.x = PEN.x + Math.cos(p.timer) * (PEN_R + 0.9);
      p.z = PEN.z + Math.sin(p.timer) * (PEN_R + 0.9);
      p.state = 'walk';
    } else if (kind === 'forester') {
      const start = around(NURSERY, (i - 1.5) * 0.9, -1.9);
      [p.x, p.z, p.state, p.target] = [start.x, start.z, 'toWork', i];
    } else if (kind === 'carpenter' || kind === 'quarrier') {
      const stand = kind === 'quarrier' ? quarrySpot(i) : benchSpot(i).stand;
      [p.x, p.z, p.state, p.timer] = [stand.x, stand.z, 'work', 1 + fx() * 3];
      const face = kind === 'quarrier' ? QUARRY : benchSpot(i).face;
      p.heading = Math.atan2(face.x - p.x, face.z - p.z);
    } else if (kind === 'miner') {
      const pit = pitOf(i);
      [p.x, p.z, p.state, p.timer, p.depth] = [pit.x, pit.z, 'dig', 1 + fx() * 3, -1.9];
    } else if (kind === 'smelter' || kind === 'mason') {
      const spot = kind === 'smelter' ? furnaceStand(i).stand : around(ROUGH_BLOCKS[i % 4], 0, -0.95);
      [p.x, p.z, p.state, p.timer] = [spot.x, spot.z, 'work', 1 + fx() * 4];
    } else if (kind === 'charcoaler') {
      const start = around(CHARCOAL, (i - 1.5) * 0.8, -1.4);
      [p.x, p.z, p.state] = [start.x, start.z, 'toStack'];
    } else if (kind === 'copperMiner') {
      const start = around(COPPER_MOUTH, (i - 1.5) * 0.9, -2.6 - i * 0.5);
      [p.x, p.z, p.state] = [start.x, start.z, i % 2 ? 'toMine' : 'toHeap'];
    } else if (kind === 'plowman') {
      const start = furrow(i, 0);
      [p.x, p.z, p.state] = [start.x, start.z, 'plow'];
    } else if (kind === 'rafter') {
      // Cada balsero navega en círculo por el lago con su carga de troncos.
      p.timer = (i / MAX_SHOWN.rafter) * Math.PI * 2;
      p.raft = makeRaft();
      p.x = POND.x + Math.cos(p.timer) * raftRadius(i);
      p.z = POND.y + Math.sin(p.timer) * raftRadius(i);
      p.raft.position.set(p.x, -0.2, p.z);
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
    add(rig.root, p.x, p.raft ? -0.08 : heightAt(p.x, p.z), p.z);
    return p;
  }
  function removePerson(p: Person): void {
    scene.remove(p.rig.root);
    if (p.line) scene.remove(p.line);
    if (p.bobber) scene.remove(p.bobber);
    if (p.raft) scene.remove(p.raft);
    const team = teamOf.get(p);
    if (team) {
      scene.remove(team.root);
      teamOf.delete(p);
    }
  }

  const raftRadius = (i: number) => 1.5 + (i % 2) * 0.8;
  function makeRaft(): THREE.Group {
    const g = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.7, 6), logMat);
      l.rotation.x = Math.PI / 2;
      l.position.x = (k - 2) * 0.26;
      g.add(l);
    }
    // Troncos de carga apilados en la popa
    for (let k = 0; k < 3; k++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 6), logMat);
      l.rotation.z = Math.PI / 2;
      l.position.set(0, 0.2 + (k === 2 ? 0.18 : 0), -0.55 + (k % 2) * 0.22 - (k === 2 ? 0.11 : 0));
      g.add(l);
    }
    g.traverse((c) => { c.castShadow = true; c.receiveShadow = true; });
    scene.add(g);
    return g;
  }

  function updateRafter(p: Person, dt: number, t: number): void {
    const r = p.rig, rad = raftRadius(p.i), dir = p.i % 2 ? -1 : 1;
    p.timer += (dt * 0.55 * dir) / rad;
    const nx = POND.x + Math.cos(p.timer) * rad, nz = POND.y + Math.sin(p.timer) * rad;
    p.heading = Math.atan2(nx - p.x, nz - p.z) || p.heading;
    p.x = nx;
    p.z = nz;
    // Empuja con la pértiga: brazos adelante y atrás
    const push = Math.sin(t * 1.8 + p.phase);
    r.armR.rotation.x = -0.6 + push * 0.5;
    r.armL.rotation.x = -0.9 + push * 0.4;
    r.torso.rotation.x = 0.15 + push * 0.12;
    standPose(p, dt);
    const raft = p.raft!;
    const wave = Math.sin(t * 1.6 + p.phase) * 0.04;
    raft.position.set(p.x, -0.2 + wave, p.z);
    raft.rotation.set(Math.sin(t * 1.3 + p.phase) * 0.05, p.heading, Math.cos(t * 1.1 + p.phase) * 0.05);
    if (fx() < dt * 0.8) ripple(p.x - Math.sin(p.heading) * 0.9, p.z - Math.cos(p.heading) * 0.9, 0.6);
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
    const r = p.rig, home = homeOf(p), work = workOf(p), tree = (p.kind === 'feller' ? bigTrees : trees)[p.i];
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
    // Edad del Bronce
    wheel: () => {
      // Un carro de ruedas macizas aparcado junto a la aldea
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 2), mat(0x8a6038));
      box.position.y = 0.85;
      g.add(box);
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.14, 12), mat(0x6a4a2c));
        w.rotation.z = Math.PI / 2;
        w.position.set(s * 0.78, 0.5, 0.15);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 6), mat(0xc98a3a, { metalness: 0.5 }));
        hub.rotation.z = Math.PI / 2;
        hub.position.copy(w.position);
        g.add(w, hub);
      }
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 4), pole);
      shaft.rotation.x = Math.PI / 2 - 0.25;
      shaft.position.set(0, 0.55, 1.9);
      g.add(shaft);
      const load = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1.5), mat(0xd6cab2));
      load.position.y = 1.2;
      g.add(load);
      add(g, CART.x, heightAt(CART.x, CART.z), CART.z);
      g.rotation.y = 0.6;
      return g;
    },
    'sky-disk': () => {
      // El disco celeste en lo alto de un poste, mirando a la aldea
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 3, 6), pole);
      post.position.y = 1.5;
      const disk = new THREE.Group();
      disk.position.y = 3.3;
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.08, 20), mat(0x2f6a5e, { metalness: 0.4, roughness: 0.5 }));
      plate.rotation.x = Math.PI / 2;
      const gold = mat(0xf2c450, { metalness: 0.7, roughness: 0.3, emissive: 0x4a3008 });
      const sunD = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 14), gold);
      sunD.rotation.x = Math.PI / 2;
      sunD.position.set(-0.25, 0.15, 0.03);
      disk.add(plate, sunD);
      for (let k = 0; k < 9; k++) {
        const a = k * 2.3, r = 0.3 + (k % 3) * 0.13;
        const star = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 6), gold);
        star.rotation.x = Math.PI / 2;
        star.position.set(Math.cos(a) * r + 0.1, Math.sin(a) * r - 0.05, 0.03);
        disk.add(star);
      }
      g.add(post, disk);
      add(g, SKY_DISK.x, heightAt(SKY_DISK.x, SKY_DISK.z), SKY_DISK.z);
      g.lookAt(0, g.position.y, 0);
      return g;
    },
    // Neolítico
    quern: () => {
      // Molino de mano: una losa con la piedra que se frota encima
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.25, 8), mat(0x8a8494));
      base.scale.z = 0.6;
      base.position.y = 0.12;
      const rubber = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.4, 2, 6), mat(0xa29cab));
      rubber.rotation.z = Math.PI / 2;
      rubber.position.y = 0.35;
      g.add(base, rubber);
      const q = polar(2.0, 3.9);
      return add(g, q.x, heightAt(q.x, q.z), q.z);
    },
    pottery: () => {
      // Vasijas de barro con bandas incisas junto a la hoguera
      const g = new THREE.Group();
      const profile = [[0.05, 0], [0.32, 0.05], [0.42, 0.3], [0.36, 0.6], [0.24, 0.72], [0.27, 0.8]].map(([x, y]) => new THREE.Vector2(x, y));
      const potGeo = new THREE.LatheGeometry(profile, 9);
      const potMats = [clayMat, mat(0xa65a30), mat(0xc98a52)];
      for (let k = 0; k < 5; k++) {
        const pot = new THREE.Mesh(potGeo, potMats[k % 3]);
        const sc = 0.75 + (k % 3) * 0.25;
        pot.scale.setScalar(sc);
        pot.position.set((k % 3) * 0.75 - 0.75, 0, Math.floor(k / 3) * 0.7);
        g.add(pot);
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.4 * sc, 0.025, 3, 12), mat(0x5a2a14));
        band.rotation.x = Math.PI / 2;
        band.position.set(pot.position.x, 0.4 * sc, pot.position.z);
        g.add(band);
      }
      add(g, POTS.x, heightAt(POTS.x, POTS.z), POTS.z);
      g.lookAt(0, g.position.y, 0);
      return g;
    },
    wedges: () => {
      // Un gran bloque sobre rodillos de madera, listo para arrastrar
      const g = new THREE.Group();
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), blockMat);
      block.position.y = 0.6;
      g.add(block);
      for (const x of [-0.5, 0.1, 0.7]) {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6), logMat);
        roller.rotation.x = Math.PI / 2;
        roller.position.set(x, 0.1, 0);
        g.add(roller);
      }
      const at = around(QUARRY, -2.9, -2.3);
      faceCenter(g, at);
      return add(g, at.x, heightAt(at.x, at.z), at.z);
    },
    sickles: () => {
      // Más gavillas en tresnales junto a los campos
      const g = new THREE.Group();
      for (const u of [-3.6, 3.6]) {
        for (let k = 0; k < 4; k++) {
          const sh = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.1, 6), wheatMat);
          const a = (k / 4) * Math.PI * 2;
          sh.position.set(u + Math.cos(a) * 0.2, 0.5, -2 + Math.sin(a) * 0.2);
          sh.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
          g.add(sh);
        }
      }
      faceCenter(g, FIELDS);
      return add(g, FIELDS.x, heightAt(FIELDS.x, FIELDS.z), FIELDS.z);
    },
    seedbeds: () => {
      // Marcos de madera alrededor de cada hilera del vivero
      const g = new THREE.Group();
      for (let r = 0; r < 3; r++) {
        for (const v of [-0.38, 0.38]) {
          const plank = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.18, 0.08), logMat);
          plank.position.set(0, 0.2, (r - 1) * 0.95 + v);
          g.add(plank);
        }
      }
      faceCenter(g, NURSERY);
      return add(g, NURSERY.x, heightAt(NURSERY.x, NURSERY.z), NURSERY.z);
    },
    corrals: () => {
      // Muro bajo de piedra seca alrededor del corral
      const g = new THREE.Group();
      const wallMat = mat(0x9a948c);
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        if (angDist(a, Math.atan2(-PEN.z, -PEN.x)) < 0.22) continue;
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24 + fx() * 0.08, 0), wallMat);
        const x = Math.cos(a) * (PEN_R + 0.35), z = Math.sin(a) * (PEN_R + 0.35);
        st.position.set(x, heightAt(PEN.x + x, PEN.z + z) - heightAt(PEN.x, PEN.z) + 0.15 + (k % 2) * 0.18, z);
        st.rotation.set(fx(), fx() * 3, fx());
        g.add(st);
      }
      return add(g, PEN.x, heightAt(PEN.x, PEN.z), PEN.z);
    },
    adzes: () => {
      // Vigas labradas apiladas junto a los bancos
      const g = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 0.22), mat(0xa77b4c));
        beam.position.set(0, 0.1 + Math.floor(k / 3) * 0.21, (k % 3) * 0.25 + (k >= 3 ? 0.12 : 0));
        g.add(beam);
      }
      const at = around(BENCHES[1], 1.9, 0.6);
      faceCenter(g, at);
      return add(g, at.x, heightAt(at.x, at.z), at.z);
    },
    'antler-picks': () => {
      // Montón de astas de ciervo para cavar
      const g = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const antler = new THREE.Group();
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.9, 4), antlerMat);
        beam.rotation.z = Math.PI / 2 - 0.3;
        const tine = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.35, 4), antlerMat);
        tine.position.set(0.25, 0.2, 0);
        antler.add(beam, tine);
        antler.position.set((fx() - 0.5) * 0.6, 0.06 + k * 0.04, (fx() - 0.5) * 0.6);
        antler.rotation.y = fx() * 6;
        g.add(antler);
      }
      const at = around(MINE, 2.2, -1.9);
      return add(g, at.x, heightAt(at.x, at.z), at.z);
    },
    menhirs: () => {
      // Círculo de piedras levantadas en las afueras
      const g = new THREE.Group();
      const mMat = mat(0x8e8a98);
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2, h = 1.9 + ((k * 5) % 3) * 0.35;
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.55, h, 0.4), mMat);
        const x = Math.cos(a) * 2.6, z = Math.sin(a) * 2.6;
        st.position.set(x, heightAt(MENHIRS.x + x, MENHIRS.z + z) - heightAt(MENHIRS.x, MENHIRS.z) + h / 2 - 0.1, z);
        st.rotation.set((fx() - 0.5) * 0.12, -a, (fx() - 0.5) * 0.12);
        g.add(st);
      }
      const altar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.9), mMat);
      altar.position.y = 0.3;
      g.add(altar);
      return add(g, MENHIRS.x, heightAt(MENHIRS.x, MENHIRS.z), MENHIRS.z);
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

  // ---------- Neolítico: campos, corral, vivero, talleres, cantera y minas ----------
  // Todo se construye la primera vez que la tribu entra en la era 2 y cae del cielo como lo demás.
  const radial = (c: { x: number; z: number }) => {
    const d = Math.hypot(c.x, c.z);
    return { rx: c.x / d, rz: c.z / d, tx: -c.z / d, tz: c.x / d };
  };
  /** Punto a `u` de lado y `v` hacia fuera de un centro (v negativo = hacia la hoguera). */
  const around = (c: { x: number; z: number }, u: number, v: number) => {
    const { rx, rz, tx, tz } = radial(c);
    return { x: c.x + tx * u + rx * v, z: c.z + tz * u + rz * v };
  };
  const faceCenter = (o: THREE.Object3D, c: { x: number; z: number }) => {
    const { tx, tz } = radial(c);
    o.rotation.y = Math.atan2(-tz, tx);
  };
  const neoStatics: THREE.Object3D[] = [];
  // Gavilla: tallos abiertos abajo, atada por la cintura y con las espigas arriba
  const sheafGeo = new THREE.LatheGeometry(
    [[0.01, 0], [0.24, 0], [0.16, 0.25], [0.11, 0.45], [0.18, 0.62], [0.27, 0.82], [0.22, 0.98], [0.01, 1.05]].map(([x, y]) => new THREE.Vector2(x, y)),
    7,
  );
  const wheatDark = mat(0xcf9c38);
  let neoBuilt = false;

  // Trigo: cada mata es una instancia; se mece, se siega y vuelve a crecer verde hasta dorarse.
  interface Tuft { x: number; y: number; z: number; h: number; plot: number; phase: number }
  const tufts: Tuft[] = [];
  const tuftGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4, lean = 0.18;
      const stalk = new THREE.CylinderGeometry(0.014, 0.018, 0.6, 3);
      stalk.translate(0, 0.3, 0);
      const ear = new THREE.ConeGeometry(0.045, 0.22, 4);
      ear.rotateX(Math.PI);
      ear.translate(0, 0.66, 0);
      for (const g of [stalk, ear]) {
        g.rotateZ(Math.cos(a) * lean);
        g.rotateX(Math.sin(a) * lean);
        parts.push(g);
      }
    }
    return mergeGeometries(parts)!;
  })();
  const wheatInst = new THREE.InstancedMesh(tuftGeo, mat(0xffffff), 3 * 35);
  wheatInst.castShadow = true;
  wheatInst.visible = false;
  scene.add(wheatInst);
  const green = new THREE.Color(0x7dbd4e), gold = new THREE.Color(0xe8b94a), tmpColor = new THREE.Color();
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
  const PLOTS = [around(FIELDS, -1.6, -0.9), around(FIELDS, 1.6, -0.9), around(FIELDS, 0, 1.5)];
  const SHEAF_STACK = around(FIELDS, 0.2, -3.4);
  const STONE_PILE = around(QUARRY, 2.6, -2.6);
  const FLINT_HEAP = around(MINE, 0, -2.6);
  const PITS = [around(MINE, -1.5, 0.2), around(MINE, 1.5, 0.2), around(MINE, 0, 1.6)];
  const SAPLINGS = Array.from({ length: 12 }, (_, k) => around(NURSERY, ((k % 4) - 1.5) * 0.9, (Math.floor(k / 4) - 1) * 0.95));
  const saplings: { obj: THREE.Object3D; g: number; target: number }[] = [];
  const sheep: { root: THREE.Group; head: THREE.Object3D; legs: THREE.Object3D[]; x: number; z: number; tx: number; tz: number; heading: number; timer: number; walk: number; state: string }[] = [];
  let sheafPile: THREE.Object3D[] = [], stoneBlocks: THREE.Object3D[] = [], flintNodules: THREE.Object3D[] = [];

  function buildNeolithic(): void {
    neoBuilt = true;
    // Parcelas con surcos
    const soilMat = mat(0x6a4a2c), furrowMat = mat(0x553820);
    PLOTS.forEach((pc, plot) => {
      const g = new THREE.Group();
      const soil = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.36, 2.2), soilMat);
      g.add(soil);
      for (let r = 0; r < 4; r++) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.08, 0.16), furrowMat);
        f.position.set(0, 0.2, (r - 1.5) * 0.48);
        g.add(f);
      }
      const y = heightAt(pc.x, pc.z) + 0.02;
      faceCenter(g, FIELDS);
      neoStatics.push(spawn(add(g, pc.x, y, pc.z)));
      for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) {
        const { rx, rz, tx, tz } = radial(FIELDS);
        const u = (c - 3) * 0.42 + (r % 2) * 0.1, v = (r - 2) * 0.4;
        tufts.push({ x: pc.x + tx * u + rx * v, y: y + 0.2, z: pc.z + tz * u + rz * v, h: 0.55 + fx() * 0.45, plot, phase: fx() * 6 });
      }
    });
    wheatInst.visible = true;
    // Gavillas apiladas delante de los campos
    const stack = new THREE.Group();
    sheafPile = Array.from({ length: 9 }, (_, k) => {
      const sh = new THREE.Group();
      sh.add(new THREE.Mesh(sheafGeo, k % 2 ? wheatMat : wheatDark));
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 3, 8), pole);
      tie.rotation.x = Math.PI / 2;
      tie.position.y = 0.45;
      sh.add(tie);
      const a = k * 2.4, rad = k ? 0.45 + (k % 3) * 0.12 : 0;
      sh.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      sh.rotation.set((fx() - 0.5) * 0.3, fx() * 3, (fx() - 0.5) * 0.3);
      stack.add(sh);
      return sh;
    });
    neoStatics.push(spawn(add(stack, SHEAF_STACK.x, heightAt(SHEAF_STACK.x, SHEAF_STACK.z), SHEAF_STACK.z)));

    // Corral de palos con su puerta mirando a la aldea
    const fence = new THREE.Group();
    const posts = 18;
    for (let k = 0; k < posts; k++) {
      const a = (k / posts) * Math.PI * 2, gate = Math.atan2(-PEN.z, -PEN.x);
      if (angDist(a, gate) < 0.2) continue;
      const x = Math.cos(a) * PEN_R, z = Math.sin(a) * PEN_R;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1, 5), pole);
      post.position.set(x, heightAt(PEN.x + x, PEN.z + z) - heightAt(PEN.x, PEN.z) + 0.5, z);
      fence.add(post);
      const b = ((k + 1) / posts) * Math.PI * 2;
      if (angDist(b, gate) < 0.2) continue;
      const nx = Math.cos(b) * PEN_R, nz = Math.sin(b) * PEN_R, len = Math.hypot(nx - x, nz - z);
      for (const h of [0.45, 0.8]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), pole);
        rail.position.set((x + nx) / 2, post.position.y - 0.5 + h, (z + nz) / 2);
        rail.rotation.y = -Math.atan2(nz - z, nx - x);
        fence.add(rail);
      }
    }
    const trough = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.4), logMat);
    trough.position.set(0.6, 0.15, -0.9);
    fence.add(trough);
    neoStatics.push(spawn(add(fence, PEN.x, heightAt(PEN.x, PEN.z), PEN.z)));

    // Vivero de plantones en hileras
    const bedMat = mat(0x5a3d26);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.2, 3), bedMat);
    faceCenter(bed, NURSERY);
    neoStatics.push(spawn(add(bed, NURSERY.x, heightAt(NURSERY.x, NURSERY.z) + 0.05, NURSERY.z)));
    for (const sp of SAPLINGS) {
      const t = makePine(0.55);
      const g0 = 0.25 + fx() * 0.6;
      t.scale.setScalar(g0);
      add(t, sp.x, heightAt(sp.x, sp.z) + 0.12, sp.z);
      saplings.push({ obj: t, g: g0, target: g0 });
      neoStatics.push(t);
      swaying.push({ obj: t, phase: fx() * 6, amp: 0.05 });
    }

    // Bancos de los carpinteros: un tronco sobre caballetes y tablones apilados
    for (const bc of BENCHES) {
      const g = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.8, 7), logMat);
      beam.rotation.z = Math.PI / 2;
      beam.position.y = 0.72;
      g.add(beam);
      for (const sx of [-0.65, 0.65]) for (const k of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.85, 4), pole);
        leg.position.set(sx, 0.38, k * 0.14);
        leg.rotation.x = k * 0.35;
        g.add(leg);
      }
      for (let k = 0; k < 3; k++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.28), mat(0xa77b4c));
        plank.position.set(0, 0.04 + k * 0.07, 0.75);
        plank.rotation.y = (k - 1) * 0.06;
        g.add(plank);
      }
      faceCenter(g, bc);
      neoStatics.push(spawn(add(g, bc.x, heightAt(bc.x, bc.z), bc.z)));
    }

    // Cantera: un afloramiento de roca con caras recién cortadas
    const quarry = new THREE.Group();
    const qMat = mat(0x8c8794), cutMat = mat(0xc9c4c0);
    [[0, 1.2, 0.6, 2.4], [-2, 0.8, 0.9, 1.7], [2.1, 0.9, 0.7, 1.8], [0.6, 2.4, 1.4, 1.4]].forEach(([x, y, z, r]) => {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), qMat);
      rock.position.set(x, y, z);
      rock.rotation.set(fx(), fx() * 3, fx());
      quarry.add(rock);
    });
    for (const [x, y] of [[-0.9, 0.7], [0.8, 0.9], [-0.1, 1.6]]) {
      const cut = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.1), cutMat);
      cut.position.set(x, y, -1.45);
      quarry.add(cut);
    }
    faceCenter(quarry, QUARRY);
    quarry.rotation.y += Math.PI;
    neoStatics.push(spawn(add(quarry, QUARRY.x, heightAt(QUARRY.x, QUARRY.z) - 0.3, QUARRY.z)));
    const pile = new THREE.Group();
    stoneBlocks = Array.from({ length: 10 }, (_, k) => {
      let row = 0, left = k;
      while (left >= 4 - row) left -= 4 - row++;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.36), blockMat);
      b.position.set((left - (3 - row) / 2) * 0.54, 0.16 + row * 0.33, (fx() - 0.5) * 0.06);
      b.rotation.y = (fx() - 0.5) * 0.2;
      pile.add(b);
      return b;
    });
    faceCenter(pile, STONE_PILE);
    neoStatics.push(spawn(add(pile, STONE_PILE.x, heightAt(STONE_PILE.x, STONE_PILE.z), STONE_PILE.z)));

    // Minas de sílex: pozos en la creta blanca con su trípode y el montón de nódulos
    const chalk = mat(0xe8e2d4), pitMat = new THREE.MeshBasicMaterial({ color: 0x0d0a08 });
    for (const pt of PITS) {
      const g = new THREE.Group();
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.62, 10), pitMat);
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = 0.06;
      g.add(hole);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + fx() * 0.1, 0), chalk);
        lump.position.set(Math.cos(a) * 0.82, 0.06, Math.sin(a) * 0.82);
        lump.scale.y = 0.6;
        g.add(lump);
      }
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2, 4), pole);
        leg.position.set(Math.cos(a) * 0.5, 0.95, Math.sin(a) * 0.5);
        leg.lookAt(0, 3, 0);
        leg.rotateX(Math.PI / 2);
        g.add(leg);
      }
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.7, 3), mat(0xc8b48a));
      rope.position.y = 1.0;
      g.add(rope);
      neoStatics.push(spawn(add(g, pt.x, heightAt(pt.x, pt.z), pt.z)));
    }
    const spoil = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.7, 7), chalk);
    const sp = around(MINE, 0, 2.9);
    neoStatics.push(spawn(add(spoil, sp.x, heightAt(sp.x, sp.z) + 0.3, sp.z)));
    const heap = new THREE.Group();
    flintNodules = Array.from({ length: 16 }, (_, k) => {
      const layer = Math.floor(k / 7), a = k * 1.9, rad = (0.55 - layer * 0.22) * (0.4 + ((k * 31) % 10) / 16);
      const n = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), flintMat);
      n.position.set(Math.cos(a) * rad, 0.1 + layer * 0.15, Math.sin(a) * rad);
      heap.add(n);
      return n;
    });
    neoStatics.push(spawn(add(heap, FLINT_HEAP.x, heightAt(FLINT_HEAP.x, FLINT_HEAP.z), FLINT_HEAP.z)));
  }

  // Ovejas: deambulan por el corral y pastan
  const woolMat = mat(0xf1ece0), sheepFace = mat(0x3a3030);
  function makeSheep(): (typeof sheep)[number] {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), woolMat);
    body.scale.set(0.95, 0.8, 1.25);
    body.position.y = 0.55;
    const head = new THREE.Group();
    head.position.set(0, 0.62, 0.42);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.3), sheepFace);
    face.position.z = 0.12;
    const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), woolMat);
    tuft.position.set(0, 0.1, 0.02);
    head.add(face, tuft);
    root.add(body, head);
    const legs = [[-0.15, 0.22], [0.15, 0.22], [-0.15, -0.22], [0.15, -0.22]].map(([lx, lz]) => {
      const pivot = new THREE.Group();
      pivot.position.set(lx, 0.36, lz);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.36, 4), sheepFace);
      leg.position.y = -0.18;
      pivot.add(leg);
      root.add(pivot);
      return pivot;
    });
    const a = fx() * Math.PI * 2, d = fx() * (PEN_R - 0.7);
    const x = PEN.x + Math.cos(a) * d, z = PEN.z + Math.sin(a) * d;
    add(root, x, heightAt(x, z), z);
    return { root, head, legs, x, z, tx: x, tz: z, heading: fx() * 6, timer: fx() * 3, walk: 0, state: 'graze' };
  }

  // Casas de barro con techo de paja (sustituyen a las tiendas en el Neolítico)
  const adobeA = mat(0xc9996a), adobeB = mat(0xb7875a), thatchA = mat(0xd8b05a), thatchB = mat(0xc49a48);
  function makeHut(x: number, z: number, s: number, tone: number) {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.3 * s, 1.4 * s, 1.3 * s, 10), tone ? adobeB : adobeA);
    wall.position.y = 0.65 * s;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.32 * s, 1.32 * s, 0.12 * s, 10), clayMat);
    band.position.y = 1.05 * s;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.85 * s, 1.7 * s, 10), tone ? thatchB : thatchA);
    roof.position.y = 2.1 * s;
    g.add(wall, band, roof);
    const poles = new THREE.Group(); // copete de paja en la punta, que mueve el viento
    poles.position.y = 2.95 * s;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22 * s, 0.4 * s, 6), tone ? thatchA : thatchB);
    tip.position.y = 0.1 * s;
    poles.add(tip);
    g.add(poles);
    const door = new THREE.Group();
    door.position.set(0, 1.0 * s, 1.33 * s);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.6 * s, 0.95 * s), mat(0x8a5a3a, { side: THREE.DoubleSide }));
    curtain.position.y = -0.48 * s;
    door.add(curtain);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.75 * s, 1.0 * s, 0.1 * s), dark);
    frame.position.set(0, 0.52 * s, 1.3 * s);
    g.add(frame, door);
    g.userData.door = door;
    g.userData.poles = poles;
    g.userData.phase = fx() * 6;
    add(g, x, heightAt(x, z), z);
    g.lookAt(0, heightAt(x, z), 0);
    return g;
  }

  // ---------- Rutinas de los oficios del Neolítico ----------
  const quarrySpot = (i: number) => around(QUARRY, (i - 1.5) * 1.15, -2.15);
  const benchSpot = (i: number) => {
    const bc = BENCHES[Math.floor(i / 2) % BENCHES.length], side = i % 2 ? 1 : -1;
    return { stand: around(bc, side * 0.5, -0.7), face: around(bc, side * 0.5, 0) };
  };
  const pitOf = (i: number) => PITS[i % PITS.length];
  const faceTo = (p: Person, x: number, z: number, dt: number) =>
    (p.heading = lerpAngle(p.heading, Math.atan2(x - p.x, z - p.z), Math.min(1, dt * 6)));
  /** El siguiente trigo maduro de su parcela (o el más alto si ninguno lo está). */
  function nextTuft(p: Person): number {
    let best = -1, bestScore = -Infinity;
    tufts.forEach((t, k) => {
      if (t.plot !== p.i % PLOTS.length) return;
      const score = t.h - Math.hypot(t.x - p.x, t.z - p.z) * 0.08 + (people.farmer.some((o) => o !== p && o.target === k) ? -5 : 0);
      if (score > bestScore) [best, bestScore] = [k, score];
    });
    return best;
  }

  function updateFarmer(p: Person, dt: number, t: number): void {
    const r = p.rig;
    if (p.target === undefined || p.target < 0) p.target = nextTuft(p);
    const tuft = tufts[p.target];
    if (!tuft) return standPose(p, dt);
    // De pie justo delante de la mata, del lado de la aldea
    const { rx, rz } = radial(FIELDS);
    const spot = { x: tuft.x - rx * 0.5, z: tuft.z - rz * 0.5 };
    if (p.state === 'toWork' || p.state === 'toStack') {
      const target = p.state === 'toWork' ? spot : SHEAF_STACK;
      const swing = Math.sin(p.walk) * 0.5;
      r.armL.rotation.x = -swing;
      r.armR.rotation.x = swing;
      if (walkTo(p, target.x, target.z, dt, 1.05)) {
        p.state = p.state === 'toWork' ? 'reap' : 'drop';
        p.timer = p.state === 'reap' ? 2.6 + fx() : 0.7;
      }
      return;
    }
    standPose(p, dt);
    p.timer -= dt;
    if (p.state === 'reap') {
      faceTo(p, tuft.x, tuft.z, dt);
      // Agachado, con golpes cortos de hoz de lado a lado
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.55, dt);
      const cut = Math.sin(t * 6 + p.phase);
      r.armR.rotation.x = -1.0 + cut * 0.45;
      r.armR.rotation.z = 0.12 + cut * 0.35;
      r.armL.rotation.x = -0.9;
      if (fx() < dt * 3) emit(chaffMat, tuft.x, tuft.y + 0.4, tuft.z, 1, 0.6, 0.04, 0.5);
      if (p.timer <= 0) {
        tuft.h = 0.12;
        emit(chaffMat, tuft.x, tuft.y + 0.3, tuft.z, 5, 0.9, 0.05);
        r.armR.rotation.z = 0.12;
        if (r.carry) r.carry.visible = true;
        p.state = 'toStack';
      }
    } else {
      faceTo(p, SHEAF_STACK.x + 1, SHEAF_STACK.z, dt);
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.5, dt);
      if (p.timer <= 0) {
        if (r.carry?.visible) {
          r.carry.visible = false;
          emit(chaffMat, SHEAF_STACK.x, heightAt(SHEAF_STACK.x, SHEAF_STACK.z) + 1, SHEAF_STACK.z, 3, 0.7, 0.05, 0.6);
        }
        p.target = nextTuft(p);
        p.state = 'toWork';
      }
    }
  }

  function updateHerder(p: Person, dt: number, t: number): void {
    const r = p.rig;
    if (p.state === 'walk') {
      p.timer += (dt * 0.3) / (PEN_R + 0.9) * (p.i % 2 ? -1 : 1) * 2.2;
      const tx = PEN.x + Math.cos(p.timer) * (PEN_R + 0.9), tz = PEN.z + Math.sin(p.timer) * (PEN_R + 0.9);
      walkTo(p, tx, tz, dt, 0.75);
      r.armL.rotation.x = -Math.sin(p.walk) * 0.4;
      r.armR.rotation.x = ease(r.armR.rotation.x, -0.5, dt);
      if (fx() < dt * 0.12) {
        p.state = 'watch';
        p.cheer = 3 + fx() * 3;
      }
      return;
    }
    // Se apoya en el cayado y mira al rebaño
    standPose(p, dt);
    faceTo(p, PEN.x, PEN.z, dt);
    r.armR.rotation.x = ease(r.armR.rotation.x, -0.75, dt);
    r.armL.rotation.x = ease(r.armL.rotation.x, -0.65, dt);
    r.torso.rotation.x = ease(r.torso.rotation.x, 0.12 + Math.sin(t * 0.8 + p.phase) * 0.03, dt);
    p.cheer -= dt;
    if (p.cheer <= 0) {
      p.cheer = 0;
      p.state = 'walk';
    }
  }

  function updateForester(p: Person, dt: number, t: number): void {
    const r = p.rig;
    if (p.target === undefined) p.target = p.i;
    const sap = saplings[p.target % saplings.length], spot = SAPLINGS[p.target % SAPLINGS.length];
    if (!sap) return standPose(p, dt);
    const { rx, rz } = radial(NURSERY);
    const stand = { x: spot.x - rx * 0.55, z: spot.z - rz * 0.55 };
    if (p.state === 'toWork') {
      r.armL.rotation.x = -Math.sin(p.walk) * 0.5;
      r.armR.rotation.x = ease(r.armR.rotation.x, -0.3, dt);
      if (walkTo(p, stand.x, stand.z, dt, 0.9)) {
        p.state = 'water';
        p.timer = 2.4 + fx();
      }
      return;
    }
    standPose(p, dt);
    faceTo(p, spot.x, spot.z, dt);
    p.timer -= dt;
    // Inclina la vasija y riega: caen gotas y el plantón crece
    r.torso.rotation.x = ease(r.torso.rotation.x, 0.4, dt);
    r.armR.rotation.x = ease(r.armR.rotation.x, -1.25 + Math.sin(t * 3 + p.phase) * 0.08, dt);
    r.armL.rotation.x = ease(r.armL.rotation.x, -0.4, dt);
    if (fx() < dt * 8) emit(splashMat, spot.x - rx * 0.15, heightAt(spot.x, spot.z) + 0.8, spot.z - rz * 0.15, 1, 0.2, 0.03, 0.1);
    if (p.timer <= 0) {
      sap.target = Math.min(1, sap.target + 0.3);
      if (sap.g >= 0.98) {
        // Ya es un árbol joven: se trasplanta al bosque y se siembra otro
        sap.target = 0.2;
        sap.g = 0.2;
        emit(chipMat, spot.x, heightAt(spot.x, spot.z) + 0.3, spot.z, 4, 0.8, 0.05);
      }
      p.target += 4;
      p.state = 'toWork';
    }
  }

  /** Carpintero y cantero: golpes rítmicos contra el tronco o la roca. */
  function updateStriker(p: Person, dt: number, t: number): void {
    const r = p.rig, quarrier = p.kind === 'quarrier';
    const stand = quarrier ? quarrySpot(p.i) : benchSpot(p.i).stand;
    const face = quarrier ? QUARRY : benchSpot(p.i).face;
    if (p.state === 'toWork' || p.state === 'toPile') {
      const target = p.state === 'toWork' ? stand : STONE_PILE;
      r.armL.rotation.x = p.state === 'toPile' ? ease(r.armL.rotation.x, -2.6, dt) : -Math.sin(p.walk) * 0.5;
      r.armR.rotation.x = Math.sin(p.walk) * 0.3;
      if (walkTo(p, target.x, target.z, dt, p.state === 'toPile' ? 0.85 : 1.1)) {
        p.state = p.state === 'toWork' ? 'work' : 'drop';
        p.timer = p.state === 'work' ? 3 + fx() * 2 : 0.7;
      }
      return;
    }
    standPose(p, dt);
    if (p.state === 'drop') {
      faceTo(p, STONE_PILE.x, STONE_PILE.z + 1, dt);
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.5, dt);
      p.timer -= dt;
      if (p.timer <= 0) {
        if (r.carry) r.carry.visible = false;
        emit(stoneChipMat, STONE_PILE.x, heightAt(STONE_PILE.x, STONE_PILE.z) + 0.6, STONE_PILE.z, 3, 0.7, 0.06, 0.5);
        p.state = 'toWork';
      }
      return;
    }
    faceTo(p, face.x, face.z, dt);
    const speed = quarrier ? 1.1 : 1.6;
    const before = (p.timer * speed) % 1;
    p.timer -= dt;
    const ph = (p.timer * speed) % 1;
    const raise = ph > 0.35 ? (1 - ph) / 0.65 : ph / 0.35;
    r.armR.rotation.x = -0.5 - raise * (quarrier ? 2.4 : 1.6);
    r.armL.rotation.x = -0.6 - raise * (quarrier ? 2.2 : 0.8);
    r.torso.rotation.x = (quarrier ? 0.3 : 0.45) - raise * 0.3;
    if (ph > before && p.timer > 0) {
      const hx = p.x + Math.sin(p.heading) * 0.8, hz = p.z + Math.cos(p.heading) * 0.8;
      emit(quarrier ? stoneChipMat : chipMat, hx, heightAt(hx, hz) + (quarrier ? 0.5 : 0.75), hz, quarrier ? 5 : 3, 1.1, quarrier ? 0.07 : 0.045);
    }
    if (p.timer <= 0) {
      if (quarrier) {
        // Lleva el bloque cortado al montón de piedra
        if (r.carry) r.carry.visible = true;
        p.state = 'toPile';
      } else p.timer = 3 + fx() * 2;
    }
    void t;
  }

  function updateMiner(p: Person, dt: number, t: number): void {
    const r = p.rig, pit = pitOf(p.i);
    if (p.state === 'toPit' || p.state === 'toHeap') {
      const target = p.state === 'toPit' ? pit : FLINT_HEAP;
      r.armL.rotation.x = -Math.sin(p.walk) * 0.5;
      r.armR.rotation.x = Math.sin(p.walk) * 0.5;
      if (walkTo(p, target.x, target.z, dt, 1)) {
        p.state = p.state === 'toPit' ? 'descend' : 'drop';
        p.timer = p.state === 'descend' ? 1.2 : 0.7;
      }
      return;
    }
    standPose(p, dt);
    p.timer -= dt;
    if (p.state === 'descend' || p.state === 'climb') {
      // Baja o sube por la cuerda del pozo, brazo tras brazo
      const k = Math.max(0, p.timer / 1.2);
      p.depth = p.state === 'descend' ? -(1 - k) * 1.9 : -k * 1.9;
      r.armL.rotation.x = -2.6 + Math.sin(t * 8) * 0.4;
      r.armR.rotation.x = -2.6 - Math.sin(t * 8) * 0.4;
      if (p.timer <= 0) {
        if (p.state === 'descend') {
          p.state = 'dig';
          p.timer = 3 + fx() * 3;
        } else {
          p.depth = 0;
          p.state = 'toHeap';
        }
      }
    } else if (p.state === 'dig') {
      // Bajo tierra: de vez en cuando sale polvo de creta del pozo
      if (fx() < dt * 2.5) emit(chalkMat, pit.x, heightAt(pit.x, pit.z) + 0.2, pit.z, 2, 0.5, 0.05, 0.9);
      if (p.timer <= 0) {
        if (r.carry) r.carry.visible = true;
        p.state = 'climb';
        p.timer = 1.2;
      }
    } else {
      faceTo(p, FLINT_HEAP.x, FLINT_HEAP.z + 1, dt);
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.6, dt);
      if (p.timer <= 0) {
        if (r.carry?.visible) {
          r.carry.visible = false;
          emit(flintMat, FLINT_HEAP.x, heightAt(FLINT_HEAP.x, FLINT_HEAP.z) + 0.9, FLINT_HEAP.z, 4, 0.7, 0.07, 0.5);
        }
        p.state = 'toPit';
      }
    }
  }

  // ---------- Edad del Bronce: fundición, mina de cobre, arado, carboneras y cantería ----------
  // Se construye la primera vez que la tribu entra en la era 3, en el anillo que se gana al bosque.
  const bronzeStatics: THREE.Object3D[] = [];
  let bronzeBuilt = false;
  const bronzeMat = mat(0xc98a3a, { metalness: 0.55, roughness: 0.45 });
  const oreMat = mat(0x3f9a7a), charMat = mat(0x2a2522), ashlarMat = mat(0xd6cab2), earthMat = mat(0x5a4632);
  const furnaceMat = mat(0xa45a34), timberMat = mat(0x6a4a2c), roofMat = mat(0xb08a4a);
  const FURNACES = [around(FOUNDRY, -1.7, 0.6), around(FOUNDRY, 1.7, 0.6)];
  const INGOT_PILE = around(FOUNDRY, 0.2, -2.6);
  const ORE_HEAP = around(COPPER_MOUTH, 2.4, -1.4);
  const MOUNDS = [around(CHARCOAL, -1.7, 0.4), around(CHARCOAL, 1.5, 0.9), around(CHARCOAL, -0.1, 2.4)];
  const LOG_STACK = around(CHARCOAL, 0.4, -2.4);
  const ASHLAR_PILE = around(MASONRY, 2.1, -1.5);
  const ROUGH_BLOCKS = [around(MASONRY, -1.4, 0.2), around(MASONRY, 0.5, 0.7), around(MASONRY, -0.5, 2), around(MASONRY, 1.7, 1.6)];
  const furnaceGlows: THREE.MeshBasicMaterial[] = [];
  let foundryLight: THREE.PointLight | null = null;
  let ingotStack: THREE.Object3D[] = [], oreLumps: THREE.Object3D[] = [], ashlarStack: THREE.Object3D[] = [];
  /** Humo de carboneras y hornos: bocanadas que suben y se deshacen. */
  const puffs: { m: THREE.Mesh; age: number; x: number; z: number; y: number; speed: number }[] = [];
  const puffMat = new THREE.MeshStandardMaterial({ color: 0x7a7470, flatShading: true, transparent: true, opacity: 0, depthWrite: false });
  function puff(x: number, z: number, y: number, speed = 1): void {
    let p = puffs.find((q) => q.age >= 1);
    if (!p) {
      if (puffs.length >= 40) return;
      p = { m: new THREE.Mesh(smokeGeo, puffMat.clone()), age: 1, x: 0, z: 0, y: 0, speed: 1 };
      scene.add(p.m);
      puffs.push(p);
    }
    Object.assign(p, { age: 0, x, z, y, speed });
  }

  // Yunta de bueyes con su arado: una por arador, va y viene por su surco.
  interface Team { root: THREE.Group; oxen: { legs: THREE.Object3D[] }[]; s: number; dir: number; walk: number }
  const teamOf = new Map<Person, Team>();
  const oxMat = [mat(0x8a5a36), mat(0x6e4a32), mat(0xb08a62)], hornMat = mat(0xeee2c8);
  function makeTeam(i: number): Team {
    const root = new THREE.Group();
    const oxen = [-0.55, 0.55].map((x, k) => {
      const ox = new THREE.Group();
      ox.position.x = x;
      const m = oxMat[(i + k) % oxMat.length];
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 1.35), m);
      body.position.y = 0.95;
      const hump = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4), m);
      hump.position.set(0, 1.3, 0.45);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.45), m);
      head.position.set(0, 1.0, 0.9);
      ox.add(body, hump, head);
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.32, 4), hornMat);
        horn.position.set(s * 0.25, 1.25, 0.9);
        horn.rotation.z = -s * 1.1;
        ox.add(horn);
      }
      const legs = [[-0.2, 0.45], [0.2, 0.45], [-0.2, -0.45], [0.2, -0.45]].map(([lx, lz]) => {
        const pivot = new THREE.Group();
        pivot.position.set(lx, 0.68, lz);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.68, 5), m);
        leg.position.y = -0.34;
        pivot.add(leg);
        ox.add(pivot);
        return pivot;
      });
      root.add(ox);
      return { legs };
    });
    // Yugo sobre los cuellos, lanza hasta el arado y la reja de bronce que abre el surco
    const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 5), timberMat);
    yoke.rotation.z = Math.PI / 2;
    yoke.position.set(0, 1.28, 0.68);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.4, 4), timberMat);
    beam.rotation.x = Math.PI / 2 - 0.12;
    beam.position.set(0, 0.95, -0.45);
    const share = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 4), bronzeMat);
    share.rotation.x = Math.PI / 2 + 0.6;
    share.position.set(0, 0.22, -1.6);
    const stilt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 4), timberMat);
    stilt.rotation.x = -0.6;
    stilt.position.set(0, 0.62, -1.85);
    root.add(yoke, beam, share, stilt);
    root.traverse((c) => { c.castShadow = true; });
    scene.add(root);
    return { root, oxen, s: fx() * 2 - 1, dir: i % 2 ? -1 : 1, walk: 0 };
  }
  /** Punto del surco de un arador: `s` de -1 a 1 a lo largo del campo. */
  const furrow = (i: number, s: number) => around(PLOW, (i - 1) * 2.2, s * 3.6);

  function buildBronze(): void {
    bronzeBuilt = true;
    // Fundición: dos hornos de barro bajo un cobertizo, con el yunque de piedra en medio
    const shed = new THREE.Group();
    for (const [u, v] of [[-3.2, -1.2], [3.2, -1.2], [-3.2, 2.2], [3.2, 2.2]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 5), timberMat);
      post.position.set(u, 1.3, v);
      shed.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(7, 0.18, 4), roofMat);
    roof.position.set(0, 2.7, 0.5);
    roof.rotation.x = 0.12;
    shed.add(roof);
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.5), mat(0x6e6a72));
    anvil.position.set(0, 0.28, -0.4);
    shed.add(anvil);
    faceCenter(shed, FOUNDRY);
    bronzeStatics.push(spawn(add(shed, FOUNDRY.x, heightAt(FOUNDRY.x, FOUNDRY.z), FOUNDRY.z)));
    for (const f of FURNACES) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.85, 1.5, 9), furnaceMat);
      body.position.y = 0.75;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 4, 10), furnaceMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 1.5;
      // Boca del horno que brilla más cuando se avivan los fuelles
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a32 });
      furnaceGlows.push(glowMat);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.26, 8), glowMat);
      mouth.position.set(0, 0.42, -0.79);
      mouth.rotation.y = Math.PI;
      mouth.rotation.x = 0.25;
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.42, 9), glowMat);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 1.46;
      // Fuelles de piel a un lado
      const bellows = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), mat(0x8a6040));
      bellows.scale.set(1, 0.45, 1.3);
      bellows.position.set(0.9, 0.18, -0.6);
      g.add(body, rim, mouth, top, bellows);
      g.userData.bellows = bellows;
      faceCenter(g, f);
      g.rotation.y += Math.PI;
      bronzeStatics.push(spawn(add(g, f.x, heightAt(f.x, f.z), f.z)));
    }
    foundryLight = new THREE.PointLight(0xff8a3a, 0, 14, 2);
    foundryLight.position.set(FOUNDRY.x, heightAt(FOUNDRY.x, FOUNDRY.z) + 1.6, FOUNDRY.z);
    scene.add(foundryLight);
    bronzeStatics.push(foundryLight);
    const pile = new THREE.Group();
    ingotStack = Array.from({ length: 14 }, (_, k) => {
      const row = Math.floor(k / 4), col = k % 4;
      const ingot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.24), bronzeMat);
      ingot.position.set((col - 1.5) * 0.46 + (row % 2) * 0.12, 0.07 + row * 0.13, 0);
      ingot.rotation.y = row % 2 ? Math.PI / 2 * 0.15 : 0;
      pile.add(ingot);
      return ingot;
    });
    faceCenter(pile, INGOT_PILE);
    bronzeStatics.push(spawn(add(pile, INGOT_PILE.x, heightAt(INGOT_PILE.x, INGOT_PILE.z), INGOT_PILE.z)));

    // Mina de cobre: boca entibada en la ladera de la colina, con su montón de mineral verde
    const mouth = new THREE.Group();
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.1, 0.22), timberMat);
      post.position.set(s * 0.85, 1.05, 0);
      mouth.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.26, 0.3), timberMat);
    lintel.position.y = 2.15;
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2), new THREE.MeshBasicMaterial({ color: 0x0b0806 }));
    dark.position.set(0, 1, 0.12);
    mouth.add(lintel, dark);
    faceCenter(mouth, COPPER_MOUTH);
    mouth.rotation.y += Math.PI;
    bronzeStatics.push(spawn(add(mouth, COPPER_MOUTH.x, heightAt(COPPER_MOUTH.x, COPPER_MOUTH.z) - 0.15, COPPER_MOUTH.z)));
    const heap = new THREE.Group();
    oreLumps = Array.from({ length: 18 }, (_, k) => {
      const layer = Math.floor(k / 8), a = k * 2.1, rad = (0.75 - layer * 0.3) * (0.35 + ((k * 37) % 10) / 14);
      const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), k % 3 ? oreMat : mat(0x6a6a58));
      lump.position.set(Math.cos(a) * rad, 0.12 + layer * 0.17, Math.sin(a) * rad);
      heap.add(lump);
      return lump;
    });
    bronzeStatics.push(spawn(add(heap, ORE_HEAP.x, heightAt(ORE_HEAP.x, ORE_HEAP.z), ORE_HEAP.z)));
    // Carretilla de mano junto a la boca
    const cartTrack = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 4), timberMat);
    const ct = around(COPPER_MOUTH, 0, -2.2);
    faceCenter(cartTrack, ct);
    cartTrack.rotation.y += Math.PI / 2;
    bronzeStatics.push(spawn(add(cartTrack, ct.x, heightAt(ct.x, ct.z) + 0.04, ct.z)));

    // Campo de arado: tierra oscura con surcos y lindes de piedra
    const field = new THREE.Group();
    const soil = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.3, 8.6), earthMat);
    field.add(soil);
    for (let r = 0; r < 13; r++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 8.2), mat(0x45331f));
      f.position.set((r - 6) * 0.56, 0.17, 0);
      field.add(f);
    }
    for (let k = 0; k < 22; k++) {
      const edge = k % 2 ? 1 : -1, along = (Math.floor(k / 2) / 10 - 0.5) * 8.6;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), stoneMat);
      st.position.set(edge * 4.05, 0.15, along);
      field.add(st);
    }
    faceCenter(field, PLOW);
    field.rotation.y += Math.PI / 2;
    bronzeStatics.push(spawn(add(field, PLOW.x, heightAt(PLOW.x, PLOW.z) - 0.05, PLOW.z)));

    // Carboneras: montículos de tierra que humean, y la pila de leña
    for (const m of MOUNDS) {
      const mound = new THREE.Mesh(new THREE.SphereGeometry(1.2, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3e3228));
      mound.scale.y = 0.75;
      bronzeStatics.push(spawn(add(mound, m.x, heightAt(m.x, m.z) - 0.05, m.z)));
    }
    const stack = new THREE.Group();
    for (let k = 0; k < 9; k++) {
      const row = Math.floor(k / 4), l = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.5, 6), logMat);
      l.rotation.z = Math.PI / 2;
      l.position.set(0, 0.14 + row * 0.25, ((k % 4) - 1.5 + row * 0.5) * 0.28);
      stack.add(l);
    }
    const coal = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.45, 7), charMat);
    coal.position.set(0, 0.22, 1.3);
    stack.add(coal);
    faceCenter(stack, LOG_STACK);
    bronzeStatics.push(spawn(add(stack, LOG_STACK.x, heightAt(LOG_STACK.x, LOG_STACK.z), LOG_STACK.z)));

    // Cantería: bloques en bruto donde trabajan los picapedreros y sillares listos
    for (const b of ROUGH_BLOCKS) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.75, 0.85), mat(0xb8ae9c));
      block.rotation.y = fx() * 3;
      bronzeStatics.push(spawn(add(block, b.x, heightAt(b.x, b.z) + 0.35, b.z)));
    }
    const ashlars = new THREE.Group();
    ashlarStack = Array.from({ length: 12 }, (_, k) => {
      let row = 0, left = k;
      while (left >= 5 - row) left -= 5 - row++;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.36, 0.42), ashlarMat);
      b.position.set((left - (4 - row) / 2) * 0.63, 0.18 + row * 0.37, 0);
      ashlars.add(b);
      return b;
    });
    faceCenter(ashlars, ASHLAR_PILE);
    bronzeStatics.push(spawn(add(ashlars, ASHLAR_PILE.x, heightAt(ASHLAR_PILE.x, ASHLAR_PILE.z), ASHLAR_PILE.z)));
  }

  // Casas de piedra con tejado de paja a dos aguas (sustituyen a las de barro)
  const wallA = mat(0xcfc2a6), wallB = mat(0xb9ab90), thatchC = mat(0xc9a050);
  function makeHouse(x: number, z: number, s: number, tone: number) {
    const g = new THREE.Group();
    const w = 2.3 * s, d = 1.7 * s, h = 1.35 * s;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), tone ? wallB : wallA);
    wall.position.y = h / 2;
    // Prisma triangular tumbado a lo largo de la casa, con la cumbrera arriba
    const rr = (d + 0.35 * s) / Math.sqrt(3);
    const roofGeo = new THREE.CylinderGeometry(rr, rr, w + 0.3 * s, 3, 1);
    roofGeo.rotateZ(Math.PI / 2);
    roofGeo.rotateX(-Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, tone ? thatchA : thatchC);
    roof.scale.y = 0.7;
    roof.position.y = h + rr * 0.5 * 0.7;
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.22 * s, d + 0.16), stoneMat);
    base.position.y = 0.1 * s;
    g.add(wall, roof, base);
    const poles = new THREE.Group(); // remate de paja en la cumbrera
    poles.position.y = h + rr * 1.5 * 0.7;
    poles.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.35 * s, 0.12 * s, 0.18 * s), thatchB));
    g.add(poles);
    const door = new THREE.Group();
    door.position.set(0, 0.95 * s, d / 2 + 0.02);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.55 * s, 0.9 * s), mat(0x3f6a5a, { side: THREE.DoubleSide }));
    curtain.position.y = -0.45 * s;
    door.add(curtain);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.75 * s, 1.0 * s, 0.08), timberMat);
    frame.position.set(0, 0.52 * s, d / 2 - 0.02);
    g.add(frame, door);
    g.userData.door = door;
    g.userData.poles = poles;
    g.userData.phase = fx() * 6;
    add(g, x, heightAt(x, z), z);
    g.lookAt(0, heightAt(x, z), 0);
    return g;
  }

  // ---------- Rutinas de los oficios de la Edad del Bronce ----------
  const furnaceStand = (i: number) => {
    const f = FURNACES[i % FURNACES.length], side = Math.floor(i / FURNACES.length) ? 1 : -1;
    return { stand: around(f, side * 0.95, -1.15), face: f };
  };
  const furnaceHeat = [0, 0];

  /** Trabajo en un puesto y, al terminar, llevar la pieza a su montón. Lo usan fundidor y picapedrero. */
  function updateCrafter(p: Person, dt: number, t: number): void {
    const r = p.rig, smelter = p.kind === 'smelter';
    const spot = smelter ? furnaceStand(p.i) : { stand: around(ROUGH_BLOCKS[p.i % 4], 0, -0.95), face: ROUGH_BLOCKS[p.i % 4] };
    const pile = smelter ? INGOT_PILE : ASHLAR_PILE;
    if (p.state === 'toWork' || p.state === 'toPile') {
      const target = p.state === 'toWork' ? spot.stand : pile;
      r.armL.rotation.x = p.state === 'toPile' ? ease(r.armL.rotation.x, -2.6, dt) : -Math.sin(p.walk) * 0.5;
      r.armR.rotation.x = Math.sin(p.walk) * 0.4;
      if (walkTo(p, target.x, target.z, dt, p.state === 'toPile' ? 0.9 : 1.1)) {
        p.state = p.state === 'toWork' ? 'work' : 'drop';
        p.timer = p.state === 'work' ? 4 + fx() * 3 : 0.7;
      }
      return;
    }
    standPose(p, dt);
    p.timer -= dt;
    if (p.state === 'drop') {
      faceTo(p, pile.x, pile.z, dt);
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.5, dt);
      if (p.timer <= 0) {
        if (r.carry) r.carry.visible = false;
        p.state = 'toWork';
      }
      return;
    }
    faceTo(p, spot.face.x, spot.face.z, dt);
    if (smelter) {
      // Pisa y aprieta el fuelle: el horno se aviva con cada golpe de aire
      const pump = Math.sin(t * 4.5 + p.phase);
      r.torso.rotation.x = 0.35 + pump * 0.12;
      r.armR.rotation.x = -1.1 + pump * 0.45;
      r.armL.rotation.x = -1.1 + pump * 0.45;
      const k = p.i % FURNACES.length;
      if (pump > 0.9) furnaceHeat[k] = Math.min(1, furnaceHeat[k] + dt * 3);
      if (fx() < dt * 4) {
        const f = FURNACES[k];
        emit(sparkMat, f.x, heightAt(f.x, f.z) + 1.6, f.z, 1, 1.4, 0.04, 1.6, false);
      }
    } else {
      // Cincel en una mano, maza en la otra: golpes cortos y rápidos
      const ph = (t * 2.6 + p.phase) % 1, raise = ph < 0.6 ? ph / 0.6 : (1 - ph) / 0.4;
      r.torso.rotation.x = 0.55;
      r.armL.rotation.x = -1.2;
      r.armR.rotation.x = -0.8 - raise * 1.3;
      if (ph < 0.08 && fx() < 0.5) {
        const b = spot.face;
        emit(stoneChipMat, b.x, heightAt(b.x, b.z) + 0.8, b.z, 2, 0.9, 0.05);
      }
    }
    if (p.timer <= 0) {
      if (r.carry) r.carry.visible = true;
      p.state = 'toPile';
    }
  }

  function updateCharcoaler(p: Person, dt: number, t: number): void {
    const r = p.rig, mound = MOUNDS[p.i % MOUNDS.length];
    const { rx, rz } = radial(CHARCOAL);
    const at = { x: mound.x - rx * 1.5 + (p.i % 2 ? 0.5 : -0.5), z: mound.z - rz * 1.5 };
    if (p.state === 'toStack' || p.state === 'toMound') {
      const target = p.state === 'toStack' ? LOG_STACK : at;
      r.armL.rotation.x = p.state === 'toMound' ? ease(r.armL.rotation.x, -2.6, dt) : -Math.sin(p.walk) * 0.5;
      r.armR.rotation.x = Math.sin(p.walk) * 0.3;
      if (walkTo(p, target.x, target.z, dt, 1)) {
        p.state = p.state === 'toStack' ? 'load' : 'tend';
        p.timer = p.state === 'load' ? 0.8 : 3 + fx() * 2;
      }
      return;
    }
    standPose(p, dt);
    p.timer -= dt;
    if (p.state === 'load') {
      faceTo(p, LOG_STACK.x, LOG_STACK.z + 1, dt);
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.6, dt);
      if (p.timer <= 0) {
        if (r.carry) r.carry.visible = true;
        p.state = 'toMound';
      }
      return;
    }
    // Deja la leña y aviva la carbonera con la pértiga
    if (r.carry?.visible) {
      r.carry.visible = false;
      emit(chipMat, mound.x, heightAt(mound.x, mound.z) + 0.6, mound.z, 3, 0.6, 0.05);
    }
    faceTo(p, mound.x, mound.z, dt);
    const poke = Math.sin(t * 2.4 + p.phase);
    r.torso.rotation.x = 0.3 + Math.max(0, poke) * 0.2;
    r.armR.rotation.x = -0.9 - poke * 0.35;
    r.armL.rotation.x = -0.8 - poke * 0.3;
    if (fx() < dt * 1.5) puff(mound.x + (fx() - 0.5) * 0.8, mound.z + (fx() - 0.5) * 0.8, heightAt(mound.x, mound.z) + 0.9, 1.3);
    if (p.timer <= 0) p.state = 'toStack';
  }

  function updateCopperMiner(p: Person, dt: number, t: number): void {
    const r = p.rig;
    const { rx, rz } = radial(COPPER_MOUTH);
    const inside = { x: COPPER_MOUTH.x + rx * 0.6, z: COPPER_MOUTH.z + rz * 0.6 };
    const out = { x: COPPER_MOUTH.x - rx * 1.4 + (p.i % 2 ? 0.4 : -0.4), z: COPPER_MOUTH.z - rz * 1.4 };
    if (p.state === 'toMine' || p.state === 'enter' || p.state === 'toHeap' || p.state === 'exit') {
      const target = p.state === 'toMine' ? out : p.state === 'enter' ? inside : p.state === 'exit' ? out : ORE_HEAP;
      r.armL.rotation.x = -Math.sin(p.walk) * 0.5;
      r.armR.rotation.x = Math.sin(p.walk) * 0.5;
      if (walkTo(p, target.x, target.z, dt, p.state === 'toHeap' ? 0.9 : 1.05)) {
        if (p.state === 'toMine') p.state = 'enter';
        else if (p.state === 'enter') {
          // Dentro de la galería: no se ve, pero sale polvo de la boca
          r.root.visible = false;
          p.state = 'dig';
          p.timer = 4 + fx() * 4;
        } else if (p.state === 'exit') p.state = 'toHeap';
        else {
          p.state = 'drop';
          p.timer = 0.7;
        }
      }
      return;
    }
    standPose(p, dt);
    p.timer -= dt;
    if (p.state === 'dig') {
      if (fx() < dt * 1.2) emit(chalkMat, COPPER_MOUTH.x, heightAt(COPPER_MOUTH.x, COPPER_MOUTH.z) + 0.6, COPPER_MOUTH.z, 2, 0.5, 0.05, 0.7);
      if (p.timer <= 0) {
        r.root.visible = true;
        if (r.carry) r.carry.visible = true;
        p.state = 'exit';
      }
    } else {
      faceTo(p, ORE_HEAP.x, ORE_HEAP.z + 1, dt);
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.6, dt);
      if (p.timer <= 0) {
        if (r.carry?.visible) {
          r.carry.visible = false;
          emit(oreMat, ORE_HEAP.x, heightAt(ORE_HEAP.x, ORE_HEAP.z) + 0.9, ORE_HEAP.z, 4, 0.7, 0.07, 0.5);
        }
        p.state = 'toMine';
      }
    }
    void t;
  }

  function updatePlowman(p: Person, dt: number, t: number): void {
    const r = p.rig;
    let team = teamOf.get(p);
    if (!team) teamOf.set(p, (team = makeTeam(p.i)));
    // La yunta avanza despacio por su surco; al llegar al final da la vuelta
    team.s += (dt * 0.42 * team.dir) / 3.6;
    if (Math.abs(team.s) > 1) {
      team.s = Math.sign(team.s);
      team.dir = -team.dir;
    }
    const at = furrow(p.i, team.s), ahead = furrow(p.i, team.s + team.dir * 0.05);
    const heading = Math.atan2(ahead.x - at.x, ahead.z - at.z);
    team.root.rotation.y = lerpAngle(team.root.rotation.y, heading, Math.min(1, dt * 3));
    team.root.position.set(at.x, heightAt(at.x, at.z), at.z);
    team.walk += dt * 3.2;
    team.oxen.forEach((ox, k) => ox.legs.forEach((l, j) => (l.rotation.x = Math.sin(team.walk + k + (j === 0 || j === 3 ? 0 : Math.PI)) * 0.35)));
    // El arador camina detrás, con las manos en la esteva y la vara en alto
    const back = 2.3, hr = team.root.rotation.y;
    p.x = at.x - Math.sin(hr) * back;
    p.z = at.z - Math.cos(hr) * back;
    p.heading = hr;
    p.walk += dt * 3.4;
    const s = Math.sin(p.walk);
    r.legL.rotation.x = s * 0.5;
    r.legR.rotation.x = -s * 0.5;
    p.bob = Math.abs(Math.cos(p.walk)) * 0.05;
    r.torso.rotation.x = 0.3;
    r.armL.rotation.x = -0.9;
    r.armR.rotation.x = -1.3 + Math.sin(t * 1.3 + p.phase) * 0.15;
    if (fx() < dt * 3) {
      const sx = at.x - Math.sin(hr) * 1.6, sz = at.z - Math.cos(hr) * 1.6;
      emit(soilMat, sx, heightAt(sx, sz) + 0.2, sz, 1, 0.5, 0.06, 0.5);
    }
  }
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb347 }), soilMat = mat(0x4a3622);

  const chaffMat = mat(0xe8c060), stoneChipMat = mat(0xb8b2ac), chalkMat = mat(0xf0ece2);

  let flash = 0;
  let lastFood = -1, lastWood = -1;
  // ---------- Día y noche: el Neolítico amanece ----------
  let day = 0, dayTarget = 0, warm = 0, warmTarget = 0, zoom = 1, zoomTarget = 1;
  const nightFog = new THREE.Color(0x3a2a52), dayFog = new THREE.Color(0xcfdde6);
  const hemiSky = [new THREE.Color(0x8a7ac8), new THREE.Color(0xfff0d8)], hemiGround = [new THREE.Color(0x2a1a10), new THREE.Color(0x6e5a3a)];
  const lightCol = [new THREE.Color(0x9aa8ff), new THREE.Color(0xffefd0)];
  const mountainCol = [new THREE.Color(0x4a4066), new THREE.Color(0x7d8aa6)];
  const lightPos = [new THREE.Vector3(-25, 35, -20), new THREE.Vector3(28, 42, 18)];
  // Edad del Bronce: tarde dorada, con el sol más bajo y la luz cálida
  const skyGold = skyGradient(new THREE.Color(0x5a88c4), new THREE.Color(0xf0c890), new THREE.Color(0xffa45a));
  const goldFog = new THREE.Color(0xf0cfa0), goldLight = new THREE.Color(0xffcf94), goldSky = new THREE.Color(0xffe2b8);
  const goldPos = new THREE.Vector3(40, 26, 30), goldMountain = new THREE.Color(0x9a8aa0);
  const sunDay = new THREE.Vector3(90, 80, 60), sunGold = new THREE.Vector3(120, 34, 90);
  function applyDay(k: number, w = warm): void {
    const e = k * k * (3 - 2 * k), g = w * w * (3 - 2 * w);
    const colors = skyGeo.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < skyNight.length; i++) {
      const dayC = skyDay[i] + (skyGold[i] - skyDay[i]) * g;
      (colors.array as Float32Array)[i] = skyNight[i] + (dayC - skyNight[i]) * e;
    }
    colors.needsUpdate = true;
    (scene.fog as THREE.Fog).color.copy(nightFog).lerp(dayFog, e).lerp(goldFog, g);
    hemi.color.copy(hemiSky[0]).lerp(hemiSky[1], e).lerp(goldSky, g);
    hemi.groundColor.copy(hemiGround[0]).lerp(hemiGround[1], e);
    hemi.intensity = 1.6 + e * 0.2;
    moonLight.color.copy(lightCol[0]).lerp(lightCol[1], e).lerp(goldLight, g);
    moonLight.intensity = 1.3 + e * 1.6 - g * 0.2;
    moonLight.position.copy(lightPos[0]).lerp(lightPos[1], e).lerp(goldPos, g);
    sun.position.copy(sunDay).lerp(sunGold, g);
    mountainMat.color.copy(mountainCol[0]).lerp(mountainCol[1], e).lerp(goldMountain, g);
    moonMat.opacity = 1 - e;
    sunMat.opacity = e;
    (sunHalo.material as THREE.MeshBasicMaterial).opacity = e * 0.28;
    cloudMat.opacity = e * 0.92;
    for (const c of clouds) c.visible = e > 0.01;
    stars.visible = e < 0.99;
  }

  let dwellingStyle = 0;
  function update(state: GameState) {
    const neolithic = state.era >= 2, bronze = state.era >= 3;
    gentleDrops = false;
    if (state.era !== shownEra) {
      const first = shownEra === 0;
      gentleDrops = !first;
      shownEra = state.era;
      dayTarget = neolithic ? 1 : 0;
      warmTarget = bronze ? 1 : 0;
      zoomTarget = state.era;
      if (first || reduceMotion) {
        applyDay((day = dayTarget), (warm = warmTarget));
        zoom = zoomTarget;
      }
      // Desde el Neolítico la partida se abre mirando por encima de los campos, sin la arboleda delante.
      if (first && neolithic) angle = 2.5;
      // El bosque retrocede: los árboles dentro del nuevo claro se talan.
      clearForest(state.era, !first && !reduceMotion);
      if (neolithic) {
        if (!neoBuilt) buildNeolithic();
        else for (const o of neoStatics) o.visible = true;
      } else for (const o of neoStatics) o.visible = false;
      if (bronze) {
        if (!bronzeBuilt) buildBronze();
        else for (const o of bronzeStatics) o.visible = true;
      } else for (const o of bronzeStatics) o.visible = false;
      wheatInst.visible = neolithic && neoBuilt;
      // Los ciervos que se quedan dentro de lo construido se van al borde del bosque.
      deer.forEach((d) => {
        if (Math.hypot(d.x, d.z) > CLEARING[state.era] - 11 && !blockers.some((z) => z.r > 1.9 && Math.hypot(d.x - z.x, d.z - z.z) < z.r + 0.8)) return;
        const to = deerSpot(Math.atan2(d.z, d.x));
        [d.x, d.z, d.tx, d.tz, d.state] = [to.x, to.z, to.x, to.z, 'graze'];
      });
    }

    // Tiendas de piel en el Paleolítico, casas de barro en el Neolítico y casas de piedra en la
    // Edad del Bronce. Cada era empieza con unas pocas y crecen con los oficios de esa era.
    const style = Math.min(3, state.era);
    if (dwellingStyle !== style) {
      for (const t of tents) scene.remove(t);
      tents.length = 0;
      dwellingStyle = style;
    }
    // Nunca hay menos viviendas que al final de la era anterior: la aldea solo crece.
    const slots = style === 3 ? HOUSE_SLOTS : style === 2 ? HUT_SLOTS : TENT_SLOTS;
    const units = (n: number) => BUILDINGS_OF[n].reduce((a, b) => a + state.buildings[b], 0);
    let wantTents = Math.min(TENT_SLOTS.length, 1 + Math.floor(units(1) / 6));
    if (style >= 2) wantTents = Math.min(HUT_SLOTS.length, Math.max(5, wantTents) + Math.floor(units(2) / 12));
    if (style >= 3) wantTents = Math.min(HOUSE_SLOTS.length, Math.max(5, wantTents) + Math.floor(units(3) / 9));
    while (tents.length < wantTents) {
      const t = slots[tents.length];
      tents.push(spawn(style === 3 ? makeHouse(t.x, t.z, t.s * 0.72, t.tone) : style === 2 ? makeHut(t.x, t.z, t.s * 0.8, t.tone) : makeTent(t.x, t.z, t.s, t.tone)));
    }
    while (tents.length > wantTents) scene.remove(tents.pop()!);
    for (const kind of Object.keys(people) as BuildingId[]) {
      const want = state.era >= JOB_ERA[kind] ? Math.min(MAX_SHOWN[kind], state.buildings[kind]) : 0;
      const list = people[kind];
      while (list.length < want) {
        const p = createPerson(kind, list.length);
        spawn(p.rig.root, kind === 'hunter' && list.length % 4 === 3 ? 0.75 : 1, true);
        list.push(p);
      }
      while (list.length > want) removePerson(list.pop()!);
    }
    // El rebaño crece con los pastores
    const wantSheep = neolithic && state.buildings.herder ? Math.min(10, 2 + state.buildings.herder * 2) : 0;
    while (sheep.length < wantSheep) {
      const sh = makeSheep();
      spawn(sh.root, 1, true);
      sheep.push(sh);
    }
    while (sheep.length > wantSheep) scene.remove(sheep.pop()!.root);

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
    // El huerto que anuncia la agricultura; en el Neolítico lo sustituyen los campos.
    const wantFarm = state.era === 1 && state.goalReached;
    if (wantFarm && !farm) farm = spawn(makeFarm());
    if (!wantFarm && farm) {
      scene.remove(farm);
      farm = null;
      sprouts.length = 0;
    }
    // Los montones crecen de forma logarítmica: se nota el avance sin llenar la escena.
    const food = Math.min(pileBerries.length, Math.round(3 + Math.log10(state.resources.food + 1) * 4.5));
    const wood = Math.min(pileLogs.length, Math.round(1 + Math.log10(state.resources.wood + 1) * 2.6));
    if (food !== lastFood) pileBerries.forEach((b, k) => (b.visible = k < food));
    if (wood !== lastWood) pileLogs.forEach((l, k) => (l.visible = k < wood));
    lastFood = food;
    lastWood = wood;
    if (neoBuilt) {
      const stone = Math.min(stoneBlocks.length, Math.round(Math.log10(state.resources.stone + 1) * 1.4));
      stoneBlocks.forEach((b, k) => (b.visible = k < stone));
      flintNodules.forEach((n, k) => (n.visible = k < 3 + state.buildings.miner * 2));
      sheafPile.forEach((sh, k) => (sh.visible = k < 1 + state.buildings.farmer));
    }
    if (bronzeBuilt) {
      const metal = Math.min(ingotStack.length, Math.round(Math.log10(state.resources.metal + 1) * 1.3));
      ingotStack.forEach((b, k) => (b.visible = k < metal));
      oreLumps.forEach((n, k) => (n.visible = k < 4 + state.buildings.copperMiner * 2));
      ashlarStack.forEach((b, k) => (b.visible = k < 2 + state.buildings.mason));
    }
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
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) wake();
  });
  io.observe(container);

  const tmp = new THREE.Vector3();
  function updateWheat(t: number, dt: number): void {
    const wind = 0.6 + Math.sin(t * 0.23) * 0.4;
    tufts.forEach((tf, k) => {
      // Lo segado vuelve a brotar verde y se dora al madurar
      tf.h = Math.min(1, tf.h + dt / 18);
      tmpE.set(Math.sin(t * 1.7 + tf.phase) * 0.12 * wind, tf.phase, Math.cos(t * 1.3 + tf.phase) * 0.1 * wind);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP.set(tf.x, tf.y, tf.z), tmpQ, tmpS.set(1, 0.15 + tf.h * 0.95, 1));
      wheatInst.setMatrixAt(k, tmpM);
      wheatInst.setColorAt(k, tmpColor.copy(green).lerp(gold, THREE.MathUtils.smoothstep(tf.h, 0.55, 0.95)));
    });
    wheatInst.count = tufts.length;
    wheatInst.instanceMatrix.needsUpdate = true;
    if (wheatInst.instanceColor) wheatInst.instanceColor.needsUpdate = true;
  }

  function animateWorld(t: number, dt: number): void {
    const wind = 0.6 + Math.sin(t * 0.23) * 0.4;

    // Nubes que cruzan despacio el cielo de día
    if (day > 0.01) for (const c of clouds) {
      c.userData.a += dt * 0.004;
      c.position.x = Math.cos(c.userData.a) * 95;
      c.position.z = Math.sin(c.userData.a) * 95;
      c.lookAt(0, c.position.y, 0);
    }
    // Tala del bosque al pasar de era: los pinos del nuevo claro se encogen hasta dejar un tocón
    for (const p of pines) {
      const target = p.obj.userData.target as number | undefined;
      if (target === undefined || p.k === target) continue;
      const k = target < p.k ? Math.max(target, p.k - dt / (1.2 + (p.obj.id % 8) * 0.25)) : Math.min(target, p.k + dt / 2);
      setPine(p, k);
      if (target === 0 && k === 0) emit(chipMat, p.obj.position.x, p.obj.position.y + 0.4, p.obj.position.z, 4, 1, 0.06);
    }
    // Hornos de la fundición: brillan más cuando se avivan los fuelles
    if (bronzeBuilt) {
      furnaceGlows.forEach((m, k) => {
        furnaceHeat[k] = Math.max(0, furnaceHeat[k] - dt * 0.5);
        const heat = 0.45 + furnaceHeat[k] * 0.55 + Math.sin(t * 9 + k) * 0.05;
        m.color.setRGB(1, 0.35 + heat * 0.35, 0.1 + heat * 0.1);
        if (fx() < dt * (0.8 + furnaceHeat[k] * 2)) {
          const f = FURNACES[k];
          puff(f.x, f.z, heightAt(f.x, f.z) + 1.7, 1.6);
        }
      });
      if (foundryLight) foundryLight.intensity = (people.smelter.length ? 18 : 6) * (1 + (furnaceHeat[0] + furnaceHeat[1]) * 0.4) * (0.6 + (1 - day) * 0.4);
      // Las carboneras humean siempre un poco
      if (fx() < dt * 1.2) {
        const m = MOUNDS[Math.floor(fx() * MOUNDS.length)];
        puff(m.x + (fx() - 0.5) * 0.6, m.z + (fx() - 0.5) * 0.6, heightAt(m.x, m.z) + 0.9, 0.8);
      }
    }
    for (const p of puffs) {
      if (p.age >= 1) continue;
      p.age = Math.min(1, p.age + (dt / 4.5) * p.speed);
      const a = p.age;
      p.m.position.set(p.x + a * a * 2 * wind, p.y + a * 4.5, p.z + a * 0.5);
      p.m.scale.setScalar(0.3 + a * 1.3);
      p.m.rotation.set(a * 2, a * 3, 0);
      (p.m.material as THREE.MeshStandardMaterial).opacity = Math.sin(Math.PI * a) * 0.32;
    }
    // Plantones del vivero: crecen poco a poco y más rápido cuando los riegan
    for (const sp of saplings) {
      sp.target = Math.min(1, sp.target + dt / 60);
      sp.g = ease(sp.g, sp.target, dt, 1.5);
      sp.obj.scale.setScalar(sp.g);
    }
    // Ovejas: pastan, caminan a otro rincón del corral y saltan cuando la aldea celebra
    for (const sh of sheep) {
      sh.timer -= dt;
      if (sh.state === 'hop') {
        sh.root.position.y = heightAt(sh.x, sh.z) + Math.abs(Math.sin(sh.timer * Math.PI * 3)) * 0.35;
        if (sh.timer <= 0) [sh.state, sh.timer] = ['graze', 1 + fx() * 3];
        sh.root.position.x = sh.x;
        sh.root.position.z = sh.z;
        continue;
      }
      if (sh.state === 'graze') {
        sh.head.rotation.x = ease(sh.head.rotation.x, Math.sin(t * 0.7 + sh.heading) > 0.6 ? -0.1 : 0.75, dt, 3);
        sh.legs.forEach((l) => (l.rotation.x = ease(l.rotation.x, 0, dt)));
        if (sh.timer <= 0) {
          const a = fx() * Math.PI * 2, d = fx() * (PEN_R - 0.7);
          [sh.tx, sh.tz, sh.state] = [PEN.x + Math.cos(a) * d, PEN.z + Math.sin(a) * d, 'walk'];
        }
      } else {
        const dx = sh.tx - sh.x, dz = sh.tz - sh.z, dist = Math.hypot(dx, dz);
        sh.head.rotation.x = ease(sh.head.rotation.x, 0, dt, 3);
        if (dist < 0.08) [sh.state, sh.timer] = ['graze', 3 + fx() * 5];
        else {
          const step = Math.min(dist, 0.55 * dt);
          sh.x += (dx / dist) * step;
          sh.z += (dz / dist) * step;
          sh.heading = lerpAngle(sh.heading, Math.atan2(dx, dz), Math.min(1, dt * 4));
          sh.walk += dt * 9;
          sh.legs.forEach((l, k) => (l.rotation.x = Math.sin(sh.walk + (k === 0 || k === 3 ? 0 : Math.PI)) * 0.5));
        }
      }
      sh.root.position.set(sh.x, heightAt(sh.x, sh.z) + (sh.state === 'walk' ? Math.abs(Math.sin(sh.walk)) * 0.04 : 0), sh.z);
      sh.root.rotation.y = sh.heading;
    }

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
      const glow = Math.pow(Math.max(0, Math.sin(t * 1.3 + i * 2.1)), 4) * (1 - day);
      ffCol[i * 3] = glow * 0.85;
      ffCol[i * 3 + 1] = glow;
      ffCol[i * 3 + 2] = glow * 0.35;
    }
    ffGeo.attributes.position.needsUpdate = true;
    ffGeo.attributes.color.needsUpdate = true;
    (stars.material as THREE.PointsMaterial).opacity = (0.85 + Math.sin(t * 0.7) * 0.15) * (1 - day);

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

  // Las piezas diminutas (dedos, bayas, guijarros, astillas) no proyectan sombra: en el mapa de
  // sombras ocupan uno o dos píxeles que el suavizado borra, pero costaban cientos de dibujos más
  // por fotograma. Siguen recibiendo la sombra de lo demás.
  const SHADOW_MIN_R = 0.05;
  function trimShadows(): void {
    for (const obj of newObjects) {
      obj.updateMatrixWorld(true);
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.castShadow || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        if (m.geometry.boundingSphere!.radius * m.matrixWorld.getMaxScaleOnAxis() < SHADOW_MIN_R) {
          m.userData.tinyShadow = true;
          m.castShadow = quality.tinyShadows;
        }
      });
    }
    newObjects.length = 0;
  }

  const clock = new THREE.Clock();
  let shadowTurn = 0;
  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.getElapsedTime();
    if (!reduceMotion && dragX === null) angle += 0.09 * dt;
    // Con cada era la aldea ocupa más: la cámara se aleja y la niebla se va más lejos.
    if (zoom !== zoomTarget) zoom = zoomTarget > zoom ? Math.min(zoomTarget, zoom + dt / 3) : Math.max(zoomTarget, zoom - dt / 3);
    const z0 = Math.floor(zoom), zk = zoom - z0, z1 = Math.min(3, z0 + 1), zs = zk * zk * (3 - 2 * zk);
    const camR = THREE.MathUtils.lerp(CAMERA[z0].r, CAMERA[z1].r, zs), camY = THREE.MathUtils.lerp(CAMERA[z0].y, CAMERA[z1].y, zs);
    const fog = scene.fog as THREE.Fog;
    fog.near = THREE.MathUtils.lerp(FOG[z0][0], FOG[z1][0], zs);
    fog.far = THREE.MathUtils.lerp(FOG[z0][1], FOG[z1][1], zs);
    camera.position.set(Math.cos(angle) * camR, camY, Math.sin(angle) * camR);
    camera.lookAt(0, 1.2, 0);

    const big = fireGroup.userData.big ? 1.35 : 1;
    flash = Math.max(0, flash - dt * 3);
    flames.forEach((f, k) => {
      const s = (1 + (reduceMotion ? 0 : Math.sin(t * (9 + k * 3)) * 0.08 + Math.sin(t * 23 + k) * 0.05)) * big * (1 + flash * 0.3);
      f.scale.set(big / Math.sqrt(s / big), s, big / Math.sqrt(s / big));
      f.rotation.y = t * (1 + k);
      f.position.y = 0.3 + (f.userData.h * s) / 2;
    });
    // De día el fuego alumbra menos: manda el sol.
    if (day !== dayTarget || warm !== warmTarget) {
      day = dayTarget > day ? Math.min(dayTarget, day + dt / 4) : Math.max(dayTarget, day - dt / 4);
      warm = warmTarget > warm ? Math.min(warmTarget, warm + dt / 4) : Math.max(warmTarget, warm - dt / 4);
      applyDay(day, warm);
    }
    fireLight.intensity = (55 + Math.sin(t * 11) * 6 + Math.sin(t * 27) * 4) * big * (1 + flash) * (1 - day * 0.65);
    if (wheatInst.visible) updateWheat(reduceMotion ? 0 : t, reduceMotion ? 0 : dt);

    if (!reduceMotion) {
      animateWorld(t, dt);
      for (const kind of Object.keys(people) as BuildingId[]) {
        for (const p of people[kind]) {
          if (kind === 'gatherer') updateGatherer(p, dt, t);
          else if (kind === 'woodcutter' || kind === 'feller') updateWoodcutter(p, dt, t);
          else if (kind === 'hunter') updateHunter(p, dt, t);
          else if (kind === 'rafter') updateRafter(p, dt, t);
          else if (kind === 'fisher') updateFisher(p, dt, t, jumpers[p.i % jumpers.length]);
          else if (kind === 'farmer') updateFarmer(p, dt, t);
          else if (kind === 'herder') updateHerder(p, dt, t);
          else if (kind === 'forester') updateForester(p, dt, t);
          else if (kind === 'miner') updateMiner(p, dt, t);
          else if (kind === 'smelter' || kind === 'mason') updateCrafter(p, dt, t);
          else if (kind === 'charcoaler') updateCharcoaler(p, dt, t);
          else if (kind === 'copperMiner') updateCopperMiner(p, dt, t);
          else if (kind === 'plowman') updatePlowman(p, dt, t);
          else updateStriker(p, dt, t);
          if (p.rig.tool) p.rig.tool.rotation.x = -p.rig.armR.rotation.x;
          p.rig.root.position.set(p.x, p.raft ? p.raft.position.y + 0.12 : heightAt(p.x, p.z) + p.bob + (p.depth ?? 0), p.z);
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
    // Cada sombra se recalcula en fotogramas alternos: la luz de la luna en uno y la del fuego en
    // el siguiente. Lo que se mueve es lento, así que no se nota y se ahorra casi la mitad del trabajo.
    // En calidad alta se recalculan las dos en cada fotograma.
    if (quality.shadowsEveryFrame) moonLight.shadow.needsUpdate = fireLight.shadow.needsUpdate = true;
    else if (shadowTurn++ % 2 === 0) moonLight.shadow.needsUpdate = true;
    else fireLight.shadow.needsUpdate = true;
    if (newObjects.length) trimShadows();
    renderer.render(scene, camera);
  }

  // Bucle de dibujo con ritmo propio para ahorrar batería. En «Auto», 30 fotogramas por segundo en
  // pantallas táctiles (60 mientras se arrastra la cámara) y como mucho 60 en el resto, aunque la
  // pantalla vaya a 90, 120 o 144 Hz; en los ajustes se puede fijar otro tope (frameIntervals()). Entre fotograma y fotograma se espera con un temporizador, así el
  // navegador no despierta al juego en cada refresco de pantalla para nada. Si la escena no se ve
  // (pestaña oculta, escena fuera de la pantalla o una ventana encima), el bucle se para del todo.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  let intervals = frameIntervals(DEFAULT_FPS, touch);
  let paused = false, running = false, raf = 0, timer = 0;
  const shouldRun = () => visible && !paused && !document.hidden;
  function step(now: number) {
    raf = 0;
    if (!shouldRun()) {
      running = false;
      return;
    }
    frame();
    const wait = (dragX === null ? intervals.idle : intervals.drag) - (performance.now() - now) - 4;
    if (wait > 1) timer = window.setTimeout(() => ((timer = 0), (raf = requestAnimationFrame(step))), wait);
    else raf = requestAnimationFrame(step);
  }
  function wake() {
    if (running || !shouldRun()) return;
    running = true;
    clock.getDelta(); // que el tiempo parado no cuente como un salto
    shadowTurn = 0;
    moonLight.shadow.needsUpdate = fireLight.shadow.needsUpdate = true;
    raf = requestAnimationFrame(step);
  }
  function stop() {
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    raf = timer = 0;
    running = false;
  }
  /** Aplica un nivel de calidad: resolución, sombras y su tamaño. */
  function applyQuality(level: QualityLevel): void {
    const before = quality;
    quality = QUALITY_PRESETS[level];
    renderer.setPixelRatio(pixelRatioFor(level, window.devicePixelRatio));
    resize();
    renderer.shadowMap.enabled = quality.shadows;
    renderer.shadowMap.type = quality.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    fireLight.castShadow = quality.fireShadows;
    if (moonLight.shadow.mapSize.x !== quality.shadowMap) {
      moonLight.shadow.map?.dispose();
      moonLight.shadow.map = null;
      moonLight.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    }
    // Activar o cambiar el tipo de sombras obliga a recompilar los materiales.
    const recompile = before.shadows !== quality.shadows || before.softShadows !== quality.softShadows || before.fireShadows !== quality.fireShadows;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.userData.tinyShadow) m.castShadow = quality.tinyShadows;
      if (recompile) (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => (mt.needsUpdate = true));
    });
    moonLight.shadow.needsUpdate = fireLight.shadow.needsUpdate = true;
  }

  const onVisibility = () => (document.hidden ? stop() : wake());
  document.addEventListener('visibilitychange', onVisibility);
  wake();

  return {
    update,
    pulse() {
      flash = 1;
      if (shownEra >= 3 && bronzeBuilt) {
        // Hornear pan: sale una bocanada del horno de la fundición
        const f = FURNACES[0];
        emit(sparkMat, f.x, heightAt(f.x, f.z) + 1.6, f.z, 5, 1.6, 0.04, 1.5, false);
        furnaceHeat[0] = 1;
      } else if (shownEra >= 2 && neoBuilt) emit(chaffMat, SHEAF_STACK.x, heightAt(SHEAF_STACK.x, SHEAF_STACK.z) + 1.1, SHEAF_STACK.z, 5, 1.2, 0.06);
      else emit(berryBurstMat, FOOD_PILE.x, 0.8, FOOD_PILE.z, 4, 1.2, 0.08);
    },
    celebrate() {
      for (const p of people.hunter) p.cheer = 0.9;
      for (const sh of sheep) if (sh.state !== 'hop') [sh.state, sh.timer] = ['hop', 0.6];
      flash = Math.max(flash, 0.6);
    },
    setGraphics(level: QualityLevel, fps: FpsLimit) {
      intervals = frameIntervals(fps, touch);
      if (QUALITY_PRESETS[level] === quality) return;
      applyQuality(level);
      // Con los ajustes abiertos la escena está parada: se dibuja una vez para ver el cambio detrás.
      if (!running && visible && !document.hidden) {
        if (newObjects.length) trimShadows();
        renderer.render(scene, camera);
      }
    },
    setPaused(p: boolean) {
      paused = p;
      if (p) stop();
      else wake();
    },
    dispose() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      ro.disconnect();
      io.disconnect();
      renderer.dispose();
    },
  };
}
