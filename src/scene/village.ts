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
// casas de piedra. En la Antigüedad luce un mediodía claro y llegan el templo de mármol, la forja,
// el olivar con su prensa, la cantera de mármol, el aserradero, el taller del broncista, la mina de
// hierro, la calzada y las villas de tejas rojas. Con cada era el bosque retrocede y el claro de la
// aldea se hace más grande.

const POND = new THREE.Vector2(11, -7);
const POND_R = 5.2;
// En el Neolítico la charca crece hasta ser un lago para las balsas.
const LAKE = new THREE.Vector2(12.5, -8);
const LAKE_R = 7.5;
const MAX_SHOWN: Record<BuildingId, number> = {
  gatherer: 10, woodcutter: 10, hunter: 8, feller: 8, fisher: 6, rafter: 4,
  quarrier: 4, farmer: 6, forester: 4, herder: 3, carpenter: 4, miner: 3,
  smelter: 4, mason: 4, plowman: 3, charcoaler: 4, copperMiner: 4,
  blacksmith: 4, oliveGrower: 4, sawyer: 3, marbler: 4, bronzesmith: 3, ironMiner: 4,
  merchant: 4, miller: 3, ranger: 3, bricklayer: 4, bellfounder: 3, armorer: 3, goldMiner: 4,
  printer: 4, vintner: 4, shipwright: 4, sculptor: 3, clockmaker: 3, gunsmith: 3, banker: 3, bookbinder: 4,
  coalMiner: 4, journalist: 3, canner: 3, cabinetmaker: 3, brickmaker: 3, boilermaker: 3, puddler: 3, stockbroker: 3, engineer: 3,
  electrician: 4, excavator: 2, agronomist: 4, forestEngineer: 3, concreter: 3, mechanic: 3, welder: 3, entrepreneur: 3, scientist: 3, solarTech: 4,
};
// Radio del claro de la aldea en cada era: más allá empieza el bosque. Al pasar de era se talan
// los árboles que quedan dentro y la cámara se aleja para que se note el crecimiento.
const CLEARING: Record<number, number> = { 1: 24, 2: 31, 3: 40, 4: 48, 5: 58, 6: 72, 7: 89, 8: 106 };
const CAMERA: Record<number, { r: number; y: number }> = {
  1: { r: 21, y: 9.5 }, 2: { r: 29, y: 15 }, 3: { r: 39, y: 23 }, 4: { r: 47, y: 30 }, 5: { r: 58, y: 38 }, 6: { r: 70, y: 47 }, 7: { r: 90, y: 60 }, 8: { r: 106, y: 72 },
};
const FOG: Record<number, [number, number]> = { 1: [28, 85], 2: [36, 110], 3: [48, 140], 4: [60, 175], 5: [74, 215], 6: [88, 255], 7: [108, 305], 8: [126, 350] };
const MAX_ZOOM = Math.max(...Object.keys(CAMERA).map(Number));
// Las colinas empiezan detrás del claro de la última era. En el Renacimiento la ciudad llega más
// lejos y las colinas se apartan (el terreno se rehace al cambiar de era, ver shapeTerrain()).
let hillsR = 64;
const JOB_ERA = Object.fromEntries(BUILDING_DEFS.map((b) => [b.id, b.era])) as Record<BuildingId, number>;
// Las viviendas de cada era crecen con sus propios oficios. En el Paleolítico cuentan solo los
// que viven junto al fuego.
const BUILDINGS_OF: Record<number, BuildingId[]> = {
  1: ['gatherer', 'woodcutter', 'hunter', 'fisher'],
  2: BUILDING_DEFS.filter((b) => b.era === 2).map((b) => b.id),
  3: BUILDING_DEFS.filter((b) => b.era === 3).map((b) => b.id),
  4: BUILDING_DEFS.filter((b) => b.era === 4).map((b) => b.id),
  5: BUILDING_DEFS.filter((b) => b.era === 5).map((b) => b.id),
  6: BUILDING_DEFS.filter((b) => b.era === 6).map((b) => b.id),
  7: BUILDING_DEFS.filter((b) => b.era === 7).map((b) => b.id),
  8: BUILDING_DEFS.filter((b) => b.era === 8).map((b) => b.id),
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

const newMat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1, metalness: 0, ...extra });
/** Material compartido por color y opciones. Compartirlo ahorra trabajo al dibujar (antes había más de
 *  1400 materiales en la era 8, muchos iguales). Nada que salga de aquí debe cambiarse después: lo que
 *  cambia con el tiempo (color, opacidad) se crea aparte con newMat(). */
const matCache = new Map<string, THREE.MeshStandardMaterial>();
const mat = (color: number, extra?: THREE.MeshStandardMaterialParameters) => {
  const key = extra ? `${color}:${JSON.stringify(extra)}` : `${color}`;
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = newMat(color, extra)));
  return m;
};
const polar = (a: number, d: number) => ({ x: Math.cos(a) * d, z: Math.sin(a) * d });
const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// ---------- Agua ----------
// Paleolítico: una charca. Neolítico: un lago más grande para las balsas. Desde la Edad del Bronce
// el lago se seca en un prado y un río rodea la ciudad por el oeste: en él navegan las balsas y,
// en el Renacimiento, las carabelas del astillero. El terreno se rehace al cambiar (shapeTerrain()).
let waterStage = 1;
const RIVER_W = 3; // media anchura del agua
const RIVER_CTRL = [[-130, -75], [-85, -48], [-55, -20], [-38, 2], [-37, 17], [-43, 28], [-62, 37], [-90, 47], [-130, 62]];
/** Puntos del cauce (curva Catmull-Rom por los puntos de control) y distancia recorrida en cada uno. */
const RIVER: { x: number; z: number }[] = [];
for (let i = 0; i < RIVER_CTRL.length - 1; i++) {
  const p0 = RIVER_CTRL[Math.max(0, i - 1)], p1 = RIVER_CTRL[i], p2 = RIVER_CTRL[i + 1], p3 = RIVER_CTRL[Math.min(RIVER_CTRL.length - 1, i + 2)];
  for (let k = 0; k < 20; k++) {
    const t = k / 20, t2 = t * t, t3 = t2 * t;
    const c = (j: number) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
    RIVER.push({ x: c(0), z: c(1) });
  }
}
RIVER.push({ x: RIVER_CTRL[RIVER_CTRL.length - 1][0], z: RIVER_CTRL[RIVER_CTRL.length - 1][1] });
const RIVER_S = RIVER.map(() => 0);
for (let k = 1; k < RIVER.length; k++) RIVER_S[k] = RIVER_S[k - 1] + Math.hypot(RIVER[k].x - RIVER[k - 1].x, RIVER[k].z - RIVER[k - 1].z);
const RIVER_MAX_X = Math.max(...RIVER.map((p) => p.x));
/** Punto del cauce más cercano: distancia, distancia recorrida a lo largo del río y lado. */
function riverNear(x: number, z: number): { d: number; s: number; side: number } {
  let best = Infinity, bs = 0, side = 1;
  for (let k = 0; k < RIVER.length - 1; k++) {
    const a = RIVER[k], b = RIVER[k + 1], ux = b.x - a.x, uz = b.z - a.z, len2 = ux * ux + uz * uz;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ux + (z - a.z) * uz) / len2));
    const px = a.x + ux * t, pz = a.z + uz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) [best, bs, side] = [d, RIVER_S[k] + t * Math.sqrt(len2), Math.sign(ux * (z - a.z) - uz * (x - a.x)) || 1];
  }
  return { d: best, s: bs, side };
}
/** Distancia al centro del río (o una cota inferior si está claramente lejos). */
function riverDist(x: number, z: number): number {
  if (x > RIVER_MAX_X + 8) return x - RIVER_MAX_X;
  return riverNear(x, z).d;
}
/** Punto del río a una distancia `s` de su nacimiento, con su dirección. */
function riverAt(s: number): { x: number; z: number; tx: number; tz: number } {
  let k = 0;
  while (k < RIVER.length - 2 && RIVER_S[k + 1] < s) k++;
  const a = RIVER[k], b = RIVER[k + 1], len = RIVER_S[k + 1] - RIVER_S[k], f = Math.max(0, Math.min(1, (s - RIVER_S[k]) / len));
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, tx: (b.x - a.x) / len, tz: (b.z - a.z) / len };
}
/** Lado del río en el que está la ciudad (el del fuego central). */
const TOWN_SIDE = riverNear(0, 0).side;
/** Tramo del río más cercano a la ciudad: allí está el puente. */
const RIVER_NEAR_S = riverNear(0, 0).s;
/** Normal del río que apunta hacia la ciudad en el punto `s`. */
function townNormal(s: number): { x: number; z: number } {
  // El lado de un punto no cambia a lo largo del río: la normal izquierda (-tz, tx) es el lado +1.
  const p = riverAt(s);
  return { x: -p.tz * TOWN_SIDE, z: p.tx * TOWN_SIDE };
}
/** Punto a `off` del centro del río, hacia la ciudad (negativo: hacia la otra orilla). */
const riverBank = (s: number, off: number) => {
  const p = riverAt(s), n = townNormal(s);
  return { x: p.x + n.x * off, z: p.z + n.z * off };
};
/** En qué lado del río queda un punto (1 = el de la ciudad). Antes de que haya río, todo es ciudad. */
const sideOf = (x: number, z: number) => (waterStage < 3 || x > RIVER_MAX_X + 2 ? 1 : riverNear(x, z).side === TOWN_SIDE ? 1 : -1);
/** ¿Hay agua en este punto? */
function inWater(x: number, z: number, margin = 0): boolean {
  if (waterStage === 1) return Math.hypot(x - POND.x, z - POND.y) < POND_R - 1.6 + margin;
  if (waterStage === 2) return Math.hypot(x - LAKE.x, z - LAKE.y) < LAKE_R + margin;
  return riverDist(x, z) < RIVER_W + margin;
}

function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 + 0.4) * 1.4 + Math.sin((x + z) * 0.09) * 1.6 + Math.cos(x * 0.5 - z * 0.3) * 0.35;
  h *= THREE.MathUtils.smoothstep(r, 5, 15);
  h += Math.max(0, r - hillsR) * 0.35;
  // La colina de la mina de cobre
  const md = Math.hypot(x - COPPER_HILL.x, z - COPPER_HILL.z);
  if (md < 7) h += Math.cos((md / 7) * Math.PI * 0.5) ** 2 * 3.2;
  // La colina de la mina de hierro, al borde de la Antigüedad
  const id = Math.hypot(x - IRON_HILL.x, z - IRON_HILL.z);
  if (id < 10) h += Math.cos((id / 10) * Math.PI * 0.5) ** 2 * 6.5;
  // La loma del castillo, con la cima llana para que la muralla no flote, y la colina de la mina de oro
  const cd = Math.hypot(x - CASTLE.x, z - CASTLE.z);
  if (cd < 13) h += 3.2 * (1 - THREE.MathUtils.smoothstep(cd, 8.5, 13));
  const gd = Math.hypot(x - GOLD_HILL.x, z - GOLD_HILL.z);
  if (gd < 10) h += Math.cos((gd / 10) * Math.PI * 0.5) ** 2 * 7;
  // La mina a cielo abierto de la Era Moderna: un hoyo ancho con el fondo llano
  if (hillsR > 100) {
    const pd = Math.hypot(x - OPEN_PIT.x, z - OPEN_PIT.z);
    if (pd < 7.5) h -= 3.4 * (1 - THREE.MathUtils.smoothstep(pd, 2.5, 7.5));
  }
  if (waterStage === 1) {
    const pd = Math.hypot(x - POND.x, z - POND.y);
    if (pd < 5.5) h = Math.min(h, -0.6 + (pd / 5.5) * 0.6);
  } else if (waterStage === 2) {
    // Orilla justo a la altura del agua (-0.25) en el borde del lago
    const ld = Math.hypot(x - LAKE.x, z - LAKE.y);
    if (ld < LAKE_R + 4) h = Math.min(h, ld < LAKE_R ? -0.25 - 0.75 * (1 - (ld / LAKE_R) ** 2) : -0.25 + (ld - LAKE_R) * 0.35);
  } else if (x < RIVER_MAX_X + 16) {
    // El cauce del río; fuera del claro cruza las colinas por un valle
    const rd = riverDist(x, z);
    if (rd < 40) h = Math.min(h, rd < RIVER_W ? -0.25 - 0.75 * (1 - (rd / RIVER_W) ** 2) : -0.25 + (rd - RIVER_W) * 0.4);
  }
  return h;
}

/**
 * Altura a la que apoyar algo de radio `r` en una ladera: la más baja bajo su planta. Así el lado de
 * arriba queda un poco enterrado en vez de dejar el de abajo flotando sobre el suelo.
 */
function groundY(x: number, z: number, r: number): number {
  let y = heightAt(x, z);
  for (let k = 0; k < 8; k++) y = Math.min(y, heightAt(x + Math.cos((k * Math.PI) / 4) * r, z + Math.sin((k * Math.PI) / 4) * r));
  return y;
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
// Zonas de la Antigüedad, en el último anillo antes de las colinas.
const TEMPLE = polar(-0.6, 42.5);
const FORGE = polar(-1.2, 41);
const OLIVE_GROVE = polar(0.05, 42.5);
const MARBLE = polar(1.65, 42.5);
const SAWMILL = polar(2.3, 41.5);
const WORKSHOP = polar(-1.85, 41.5);
const IRON_HILL = polar(0.85, 52.5);
const IRON_MOUTH = polar(0.85, 46.8);
const MARKET = polar(-2.25, 39.5);
// Edad Media: más allá de las antiguas colinas, con el castillo en lo alto de una loma
const CASTLE = polar(-0.35, 58.5);
const WINDMILL = polar(0.3, 52.5);
const ARMORY = polar(-1.05, 52);
const BELFRY = polar(-1.62, 52.5);
const FAIR = polar(-2.05, 51.5);
const WORKS = polar(1.3, 52.5);
const CATHEDRAL = polar(1.85, 55);
const LODGE = polar(2.75, 52.5);
const GOLD_HILL = polar(2.3, 61.5);
const GOLD_MOUTH = polar(2.3, 55.4);
// Renacimiento: imprenta, viñedo, astillero en el río, escultores, torre del reloj, armero, banco y
// encuadernadores, en el anillo que se gana a las antiguas colinas
const PRINTING = polar(-1.35, 64);
const VINEYARD = polar(0.02, 66.5);
const CLOCKTOWER = polar(-0.66, 67.5);
const SCULPTOR = polar(0.6, 65);
const GUNSMITH = polar(-1.95, 63.5);
const BANK = polar(1.12, 65);
const BINDERY = polar(1.62, 64);
const DOME = polar(-2.5, 63);
// El astillero, aguas arriba del puente: de ahí salen las carabelas río arriba
const SHIPYARD_S = RIVER_NEAR_S - 30;
const SHIPYARD = riverBank(SHIPYARD_S, RIVER_W + 4);
// Revolución Industrial: pozo de carbón, fábricas de ladrillo, la bolsa, el periódico y la estación,
// en el anillo que se gana al bosque. Un ferrocarril da la vuelta a toda la ciudad por el borde.
const TRACK_R = 86.5;
const COLLIERY = polar(0.25, 77);
const CANNERY = polar(-0.35, 77.5);
const CABINET = polar(1.0, 78);
const BRICKWORKS = polar(-1.0, 77);
const BOILERSHOP = polar(1.6, 78);
const IRONWORKS = polar(-1.6, 77);
const EXCHANGE = polar(2.12, 77);
const NEWSPAPER = polar(-2.08, 77.5);
const STATION = polar(0.64, 82);
const EXHIBITION = polar(-2.47, 78);
// Era Moderna: más allá de la vía, la central eléctrica, rascacielos, campos solares, invernaderos,
// el laboratorio, la obra con su grúa, el taller, la mina a cielo abierto y la rampa del cohete
const POWER = polar(0.0, 97.5);
const OFFICES = polar(0.38, 95.5);
const SOLAR = polar(0.76, 96);
const OPEN_PIT = polar(1.12, 97.5);
const NURSERY8 = polar(1.47, 95);
const GARAGE = polar(2.05, 95);
const LAB = polar(-0.38, 95);
const GREENHOUSES = polar(-0.75, 96);
const LAUNCH = polar(-1.08, 96);
const SITE = polar(-1.42, 96);
const STEELWORKS = polar(-2.02, 95);
const AQUEDUCT_ANGLE = -2.65;
const FOUNTAIN = polar(AQUEDUCT_ANGLE, 34.5);
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
  { ...TEMPLE, r: 6.5 },
  { ...FORGE, r: 4.2 },
  { ...OLIVE_GROVE, r: 5.5 },
  { ...MARBLE, r: 4.5 },
  { ...SAWMILL, r: 4 },
  { ...WORKSHOP, r: 4 },
  { ...IRON_MOUTH, r: 3.5 },
  { ...MARKET, r: 2.5 },
  { ...FOUNTAIN, r: 2.2 },
  ...[36.5, 39.5, 42.5, 45.5].map((d) => ({ ...polar(AQUEDUCT_ANGLE, d), r: 1.6 })),
  { ...CASTLE, r: 9 },
  { ...WINDMILL, r: 5 },
  { ...ARMORY, r: 4.5 },
  { ...BELFRY, r: 4.5 },
  { ...FAIR, r: 5.5 },
  { ...WORKS, r: 6 },
  { ...CATHEDRAL, r: 7 },
  { ...LODGE, r: 5.5 },
  { ...GOLD_HILL, r: 8 },
  { ...GOLD_MOUTH, r: 3.5 },
  { ...PRINTING, r: 5.5 },
  { ...VINEYARD, r: 7 },
  { ...CLOCKTOWER, r: 4.5 },
  { ...SCULPTOR, r: 5 },
  { ...GUNSMITH, r: 4.5 },
  { ...BANK, r: 5.5 },
  { ...BINDERY, r: 4.5 },
  { ...DOME, r: 8.5 },
  { ...SHIPYARD, r: 4.5 },
  { ...COLLIERY, r: 7 },
  { ...CANNERY, r: 5.5 },
  { ...CABINET, r: 5.5 },
  { ...BRICKWORKS, r: 6.5 },
  { ...BOILERSHOP, r: 5.5 },
  { ...IRONWORKS, r: 6.5 },
  { ...EXCHANGE, r: 6 },
  { ...NEWSPAPER, r: 5.5 },
  { ...STATION, r: 7.5 },
  { ...EXHIBITION, r: 5.8 },
  { ...POWER, r: 8.5 },
  { ...OFFICES, r: 6.5 },
  { ...SOLAR, r: 8.5 },
  { ...OPEN_PIT, r: 10.5 },
  { ...NURSERY8, r: 7 },
  { ...GARAGE, r: 6 },
  { ...LAB, r: 6 },
  { ...GREENHOUSES, r: 7 },
  { ...LAUNCH, r: 7 },
  { ...SITE, r: 7.5 },
  { ...STEELWORKS, r: 6 },
];
/** Libre de lo construido, del lago del Neolítico, del río y de la vía del tren. */
const isFree = (x: number, z: number, r: number) =>
  Math.hypot(x - LAKE.x, z - LAKE.y) > LAKE_R + 0.8 + r && riverDist(x, z) > RIVER_W + 2 + r && Math.abs(Math.hypot(x, z) - TRACK_R) > 2.2 + r &&
  blockers.every((b) => Math.hypot(x - b.x, z - b.z) > b.r + r);

/** Primer hueco libre de radio `r` cerca de un ángulo y una distancia. */
function findFree(a: number, d: number, r: number): { x: number; z: number } | null {
  for (const dd of [0, 2.5, -2.5, 5, -5, 7.5, -7.5]) {
    for (let k = 0; k <= 24; k++) {
      const p = polar(a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.03, d + dd);
      if (isFree(p.x, p.z, r)) return p;
    }
  }
  return null;
}

// ---------- Plazas de la vida diaria ----------
// A mediodía hay mercado o fiesta y al anochecer velada con hoguera: cada uno va a la plaza más
// cercana de su lado del río. La primera es el fuego del campamento; el lago seco del Neolítico
// se convierte en un prado de fiestas y cada era abre plazas nuevas en los barrios de fuera.
interface Plaza { x: number; z: number; era: number; pit: boolean }
const PLAZA_R = 6.2;
const PLAZAS: Plaza[] = [{ x: 0, z: 0, era: 1, pit: false }, { x: LAKE.x, z: LAKE.y, era: 3, pit: true }];
for (const [era, a, d] of [[4, -2.25, 33], [4, 0.55, 33], [5, -2.0, 45], [5, 1.0, 45], [6, -1.0, 59], [6, 0.85, 59], [6, -2.35, 52], [7, -1.3, 71], [7, 1.3, 71], [7, 0.0, 71], [8, -1.75, 95], [8, 1.76, 95], [8, -0.2, 93]]) {
  const p = findFree(a, d, PLAZA_R);
  if (!p) continue;
  PLAZAS.push({ ...p, era, pit: true });
  blockers.push({ ...p, r: PLAZA_R });
}

// ---------- Afueras: aldeas, campos, prados, arboledas, rebaños y monumentos ----------
// Cada era llena el anillo que gana al bosque, para que las afueras no queden vacías. Se reservan
// aquí, antes que las viviendas, y se construyen al llegar su era (ver buildOutskirts()).
type OutType = 'hamlet' | 'field' | 'meadow' | 'grove' | 'monument' | 'herd';
interface Outskirt { era: number; type: OutType; x: number; z: number; r: number; seed: number }
const OUT_R: Record<OutType, number> = { hamlet: 4.4, field: 3.8, meadow: 3.2, grove: 3.4, monument: 2.4, herd: 3.6 };
const OUT_MIX: Record<number, OutType[]> = {
  2: ['grove', 'meadow', 'monument', 'field', 'grove', 'meadow', 'herd'],
  3: ['hamlet', 'field', 'grove', 'meadow', 'monument', 'herd', 'field', 'grove', 'hamlet'],
  4: ['hamlet', 'field', 'grove', 'meadow', 'monument', 'herd', 'hamlet', 'field', 'grove', 'meadow', 'monument'],
  5: ['hamlet', 'field', 'grove', 'meadow', 'monument', 'herd', 'hamlet', 'field', 'grove', 'meadow', 'hamlet', 'field', 'monument'],
  6: ['hamlet', 'field', 'grove', 'meadow', 'monument', 'herd', 'hamlet', 'field', 'grove', 'meadow', 'hamlet', 'field', 'monument', 'grove', 'herd', 'meadow', 'hamlet'],
  7: ['hamlet', 'field', 'grove', 'meadow', 'monument', 'herd', 'hamlet', 'field', 'grove', 'meadow', 'hamlet', 'field', 'monument', 'grove', 'herd', 'meadow', 'hamlet', 'field'],
  8: ['hamlet', 'field', 'monument', 'grove', 'meadow', 'herd', 'hamlet', 'monument', 'field', 'grove', 'meadow', 'hamlet', 'monument', 'field', 'grove', 'herd', 'meadow', 'hamlet', 'monument', 'field'],
};
const OUTSKIRTS: Outskirt[] = [];
for (const era of [2, 3, 4, 5, 6, 7, 8]) {
  const rnd = mulberry32(900 + era);
  const inner = CLEARING[era - 1] + (era === 2 ? 1 : -2), outer = CLEARING[era] - 2.5;
  const mix = OUT_MIX[era];
  // Si un tipo no cabe en ningún sitio tras muchos intentos, se pasa al siguiente.
  for (let tries = 0, k = 0; tries < 2000 && k < mix.length; tries++) {
    const type = mix[k], r = OUT_R[type];
    const a = rnd() * Math.PI * 2, d = inner + r + rnd() * Math.max(0, outer - inner - 2 * r);
    const { x, z } = polar(a, d);
    if (tries % 120 === 119) k++;
    if (inCorridor(x, z, 0.25) || !isFree(x, z, r + 0.8)) continue;
    OUTSKIRTS.push({ era, type, x, z, r, seed: Math.floor(rnd() * 1e9) });
    blockers.push({ x, z, r });
    k++;
    tries = Math.ceil((tries + 1) / 120) * 120 - 1;
  }
}

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
// Las villas de la Antigüedad ocupan los mismos huecos que las casas de piedra y dos anillos más.
const VILLA_SLOTS = dwellingSlots([9.4, 11.8, 14.2, 16.6, 19.2, 21.8, 24.4, 27], 36, 1.35, false);
// Casas con entramado de la Edad Media: llegan hasta el anillo de la Edad del Bronce
const TIMBER_SLOTS = dwellingSlots([9.4, 11.8, 14.2, 16.6, 19.2, 21.8, 24.4, 27, 29.6, 32.2, 34.8], 48, 1.35, false);
// Casas del Renacimiento: fachadas de colores con tejado de tejas, hasta la orilla del río
const REN_SLOTS = dwellingSlots([9.4, 11.8, 14.2, 16.6, 19.2, 21.8, 24.4, 27, 29.6, 32.2, 34.8, 37.4, 40, 42.6], 64, 1.4, false);
// Casas obreras de ladrillo de la Revolución Industrial y bloques modernos: la ciudad sigue creciendo
const BRICK_SLOTS = dwellingSlots([9.4, 11.8, 14.2, 16.6, 19.2, 21.8, 24.4, 27, 29.6, 32.2, 34.8, 37.4, 40, 42.6, 45.2, 47.8, 50.4], 80, 1.4, false);
const MODERN_SLOTS = dwellingSlots([9.4, 11.8, 14.2, 16.6, 19.2, 21.8, 24.4, 27, 29.6, 32.2, 34.8, 37.4, 40, 42.6, 45.2, 47.8, 50.4, 53, 55.6], 96, 1.4, false);
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
  /** Piel y pelo de la persona. El cuerpo, la cabeza y el pelo van unidos a la ropa en una sola
   *  malla con colores por vértice (ver dress()): así cada persona se dibuja con menos piezas. */
  skin: THREE.Material;
  hair: number;
  limbs: { legs: THREE.Mesh[]; arms: THREE.Mesh[] };
  /** Cabezas de hacha, puntas de lanza, hojas de hoz…: piedra, luego bronce y luego hierro. */
  heads: THREE.Mesh[];
  /** Cinturón, capa, sombrero y demás: una sola malla con colores por vértice. */
  outfit?: THREE.Mesh;
  /** Antorcha para andar de noche e instrumento para tocar en las fiestas (se crean al usarse). */
  torch?: THREE.Object3D;
  instrument?: THREE.Object3D;
  kind: BuildingId;
  i: number;
  era: number;
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
  /** Fuera del trabajo: de fiesta, de camino a casa o durmiendo (ver la vida diaria). */
  life?: Life;
}

/** Lo que se hace en una plaza: bailar, sentarse junto al fuego, tocar, charlar o comerciar. */
type Act = 'dance' | 'sit' | 'music' | 'chat' | 'trade';
interface Spot {
  plaza: Plaza;
  act: Act;
  x: number;
  z: number;
  /** Hacia dónde mira: el fuego, el corro o la pareja con la que comercia. */
  fx: number;
  fz: number;
  /** Ángulo y radio en el corro de baile, que gira. */
  a: number;
  r: number;
  taken: Person | null;
  /** La mercancía que pasa de mano en mano entre los dos de un trato. */
  item?: THREE.Object3D;
  partner?: Spot;
}
interface Life {
  mode: 'toEvent' | 'event' | 'toHome' | 'home' | 'back';
  spot?: Spot;
  home?: { x: number; z: number };
  /** Lo que hacía en su oficio, para retomarlo al volver. */
  saved: { x: number; z: number; state: string; timer: number; heading: number; target?: number; carry: boolean };
  best: number;
  stuck: number;
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
  /** Cuánta luz de día hay ahora: 0 de noche cerrada, 1 a pleno sol. */
  daylight(): number;
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
    return { update() {}, pulse() {}, celebrate() {}, setPaused() {}, setGraphics() {}, daylight: () => 1, dispose() {} };
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
  const moon = add(new THREE.Mesh(new THREE.IcosahedronGeometry(7, 1), moonMat), -70, 60, -110, false);
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
    g.userData.y = g.position.y;
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

  // Terreno. Se rehace (alturas y colores) cuando el agua cambia o las colinas se apartan: el ruido
  // sale de un hash de la posición, así el relieve y los tonos son los mismos cada vez.
  const hash = (x: number, z: number) => {
    const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const tBase = new THREE.PlaneGeometry(300, 300, 128, 128);
  tBase.rotateX(-Math.PI / 2);
  const tIndex = tBase.index!.array, gridPos = tBase.attributes.position;
  const gridH = new Float32Array(gridPos.count);
  const tg = tBase.toNonIndexed();
  const tpos = tg.attributes.position as THREE.BufferAttribute;
  tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(tpos.count * 3), 3));
  const grassA = new THREE.Color(0x3f5a2e), grassB = new THREE.Color(0x4d6b35), dirt = new THREE.Color(0x6b4a32);
  const pitCol = new THREE.Color(0x4e4440);
  const rockC = new THREE.Color(0x5e5868), rockHi = new THREE.Color(0x8a8296), sand = new THREE.Color(0x8a7a52), tc = new THREE.Color();
  const shore = (x: number, z: number) =>
    waterStage === 1 ? Math.hypot(x - POND.x, z - POND.y) < 6.5
    : waterStage === 2 ? Math.hypot(x - LAKE.x, z - LAKE.y) < LAKE_R + 1.4
    : riverDist(x, z) < RIVER_W + 1.5;
  function shapeTerrain(): void {
    for (let i = 0; i < gridPos.count; i++) {
      const x = gridPos.getX(i), z = gridPos.getZ(i);
      gridH[i] = heightAt(x, z) + (hash(x, z) - 0.5) * 0.25;
    }
    for (let j = 0; j < tpos.count; j++) tpos.setY(j, gridH[tIndex[j]]);
    const col = tg.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < tpos.count; i += 3) {
      const cx = (tpos.getX(i) + tpos.getX(i + 1) + tpos.getX(i + 2)) / 3;
      const cz = (tpos.getZ(i) + tpos.getZ(i + 1) + tpos.getZ(i + 2)) / 3;
      const cy = (tpos.getY(i) + tpos.getY(i + 1) + tpos.getY(i + 2)) / 3;
      const r = Math.hypot(cx, cz), n = hash(cx * 1.7, cz * 1.3), n2 = hash(cz + 3.1, cx);
      tc.copy(grassA).lerp(grassB, n);
      if (r < 4.5 + n2) tc.copy(dirt).offsetHSL(0, 0, (n - 0.5) * 0.04);
      else if (shore(cx, cz)) tc.copy(sand).offsetHSL(0, 0, (n - 0.5) * 0.05);
      else if (hillsR > 100 && Math.hypot(cx - OPEN_PIT.x, cz - OPEN_PIT.z) < 8) tc.copy(pitCol).offsetHSL(0, 0, (n - 0.5) * 0.06);
      else if (cy > 4 && Math.hypot(cx - COPPER_HILL.x, cz - COPPER_HILL.z) > 7) tc.copy(rockC).lerp(rockHi, Math.min(1, (cy - 4) / 8));
      // Senderos pisados hacia los arbustos y la arboleda
      else if (r < 11 && (angDist(Math.atan2(cz, cx), GATHER_ANGLE) < 0.12 || angDist(Math.atan2(cz, cx), WOOD_ANGLE) < 0.12)) tc.lerp(dirt, 0.55);
      for (let k = 0; k < 3; k++) col.setXYZ(i + k, tc.r, tc.g, tc.b);
    }
    col.needsUpdate = true;
    tpos.needsUpdate = true;
    tg.computeVertexNormals();
    tg.computeBoundingSphere();
  }
  shapeTerrain();
  const terrain = new THREE.Mesh(tg, mat(0xffffff, { vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Charca del Paleolítico con oleaje suave; en el Neolítico es la misma malla, más grande
  const waterMat = mat(0x2e5a8a, { roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.88 });
  const pondGeo = new THREE.RingGeometry(0.01, POND_R, 20, 5);
  const pondBase = Float32Array.from(pondGeo.attributes.position.array);
  const pond = new THREE.Mesh(pondGeo, waterMat);
  pond.rotation.x = -Math.PI / 2;
  add(pond, POND.x, -0.25, POND.y, false);
  pond.receiveShadow = true;
  // El río: una cinta de agua a lo largo del cauce, con cuatro hileras de vértices para el oleaje
  const RIVER_LANES = [-1, -0.35, 0.35, 1];
  const riverGeo = new THREE.BufferGeometry();
  {
    const v: number[] = [], idx: number[] = [];
    RIVER.forEach((p, k) => {
      const a = RIVER[Math.max(0, k - 1)], b = RIVER[Math.min(RIVER.length - 1, k + 1)];
      const len = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      for (const j of RIVER_LANES) v.push(p.x + nx * (RIVER_W + 0.8) * j, 0, p.z + nz * (RIVER_W + 0.8) * j);
      if (k) for (let j = 0; j < 3; j++) {
        const q = k * 4 + j, o = q - 4;
        idx.push(o, o + 1, q, o + 1, q + 1, q);
      }
    });
    riverGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    riverGeo.setIndex(idx);
    riverGeo.computeVertexNormals();
  }
  const river = new THREE.Mesh(riverGeo, waterMat);
  river.position.y = -0.25;
  river.receiveShadow = true;
  river.visible = false;
  river.frustumCulled = false;
  scene.add(river);

  // Montañas (de noche se ven violetas; de día, azuladas por la distancia). Por donde sale el río no
  // hay montaña, y en el Renacimiento se apartan con las colinas.
  const mountainMat = newMat(0x4a4066), snowMat = mat(0xe9e6f4);
  const mountains: { peak: THREE.Mesh; snow: THREE.Mesh; a: number; d: number }[] = [];
  const riverMouths = [Math.atan2(RIVER[0].z, RIVER[0].x), Math.atan2(RIVER[RIVER.length - 1].z, RIVER[RIVER.length - 1].x)];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng() * 0.2, d = 92 + rng() * 16, r = 14 + rng() * 12, h = 22 + rng() * 22, rot = rng() * Math.PI;
    if (riverMouths.some((m) => angDist(a, m) < 0.3)) continue;
    const peak = add(new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), mountainMat), 0, h / 2 - 1, 0, false);
    peak.rotation.y = rot;
    const sh = h * 0.3;
    const snow = add(new THREE.Mesh(new THREE.ConeGeometry(r * 0.3 + 0.05, sh, 5), snowMat), 0, h - 1 - sh / 2 + 0.02, 0, false);
    snow.rotation.y = rot;
    mountains.push({ peak, snow, a, d });
  }
  function placeMountains(): void {
    const k = hillsR > 100 ? 1.5 : hillsR > 85 ? 1.36 : hillsR > 64 ? 1.22 : 1;
    for (const m of mountains) for (const o of [m.peak, m.snow]) o.position.set(Math.cos(m.a) * m.d * k, o.position.y, Math.sin(m.a) * m.d * k);
  }
  placeMountains();

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
  interface Pine { obj: THREE.Group; clearedIn: number; k: number; river: boolean }
  const pines: Pine[] = [];
  const stumpMat = mat(0x8a6440);
  for (let i = 0, near = 0, far = 0; i < 1800 && far < 290; i++) {
    const isNear = near < 14;
    const a = rng() * Math.PI * 2, d = isNear ? 9 + rng() * 4 : 25 + Math.pow(rng(), 0.85) * 48;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - LAKE.x, z - LAKE.y) < LAKE_R + 1.5) continue;
    if (isNear && (inCorridor(x, z, 0.75) || !isFree(x, z, 1.2))) continue;
    // Los pinos del bosque lejano no crecen encima de lo que se construirá en su era.
    if (!isNear && blockers.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + 0.6)) continue;
    if (isNear) near++;
    else far++;
    const g = add(makePine(0.8 + rng() * 0.8), x, heightAt(x, z) - 0.05, z);
    // Fuera del alcance de la sombra del sol no hace falta que proyecten sombra
    if (d > 44) g.traverse((c) => (c.castShadow = false));
    swaying.push({ obj: g, phase: rng() * 6, amp: 0.02 + rng() * 0.025 });
    const clearedIn = isNear ? 2 : d < CLEARING[2] ? 2 : d < CLEARING[3] ? 3 : d < CLEARING[4] ? 4 : d < CLEARING[5] ? 5 : d < CLEARING[6] ? 6 : 7;
    // Los que quedan en el cauce del río desaparecen del todo cuando llega el agua
    pines.push({ obj: g, clearedIn, k: 1, river: riverDist(x, z) < RIVER_W + 2.5 });
  }
  // Bosque lejano, más allá del claro del Renacimiento: muchos pinos dibujados de una vez
  // (instancias), sin viento ni sombra, sobre las colinas.
  const outerCrownGeo = (() => {
    const cones = [0, 1, 2].map((k) => {
      const c = new THREE.ConeGeometry(1.15 - k * 0.28, 1.4, 7);
      const col = pineColors[k];
      c.translate(0, 1.2 + k * 0.75, 0);
      c.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: c.attributes.position.count }, () => [col.r, col.g, col.b]).flat(), 3));
      return c;
    });
    return mergeGeometries(cones)!;
  })();
  const outerTrunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.9, 5).translate(0, 0.45, 0);
  const outerSpots: { x: number; z: number; s: number; rot: number; d: number }[] = [];
  for (let i = 0; i < 4000 && outerSpots.length < 520; i++) {
    const a = rng() * Math.PI * 2, d = 74 + rng() * 52, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (riverDist(x, z) < RIVER_W + 5 || Math.abs(x) > 148 || Math.abs(z) > 148) continue;
    outerSpots.push({ x, z, s: 0.9 + rng() * 1.1, rot: rng() * 6, d });
  }
  // Más allá, hasta el borde del mundo, para cuando la ciudad moderna se coma el bosque de antes
  {
    const far = mulberry32(77);
    for (let i = 0; i < 3000 && outerSpots.length < 820; i++) {
      const a = far() * Math.PI * 2, d = 120 + far() * 30, x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (riverDist(x, z) < RIVER_W + 5 || Math.abs(x) > 148 || Math.abs(z) > 148) continue;
      outerSpots.push({ x, z, s: 1 + far() * 1.2, rot: far() * 6, d });
    }
  }
  const outerCrowns = new THREE.InstancedMesh(outerCrownGeo, pineCrownMat, outerSpots.length);
  const outerTrunks = new THREE.InstancedMesh(outerTrunkGeo, trunkMat, outerSpots.length);
  outerSpots.forEach((_, k) => outerCrowns.setColorAt(k, new THREE.Color().setHSL(0.3, 0.2, 0.85 + ((k * 37) % 10) / 60)));
  scene.add(outerCrowns, outerTrunks);
  /**
   * Coloca los pinos lejanos sobre el terreno (se llama cada vez que el terreno cambia o la ciudad
   * crece). Desde la Revolución Industrial la ciudad llega hasta ellos: los del claro, los de la vía
   * y los que caen sobre lo construido desaparecen.
   */
  function placeOuterForest(): void {
    const clear = CLEARING[Math.max(1, shownEra)] ?? 0;
    outerSpots.forEach((o, k) => {
      const gone = o.d < clear || (shownEra >= 7 && (Math.abs(o.d - TRACK_R) < 3 || blockers.some((b) => b.r > 3 && Math.hypot(o.x - b.x, o.z - b.z) < b.r + 1)));
      tmpM4.compose(tmpV3.set(o.x, heightAt(o.x, o.z) - 0.1, o.z), tmpQ4.setFromAxisAngle(tmpUp, o.rot), tmpS3.setScalar(gone ? 0 : o.s));
      outerCrowns.setMatrixAt(k, tmpM4);
      outerTrunks.setMatrixAt(k, tmpM4);
    });
    outerCrowns.instanceMatrix.needsUpdate = outerTrunks.instanceMatrix.needsUpdate = true;
    outerCrowns.computeBoundingSphere();
    outerTrunks.computeBoundingSphere();
  }
  const tmpM4 = new THREE.Matrix4(), tmpV3 = new THREE.Vector3(), tmpQ4 = new THREE.Quaternion(), tmpS3 = new THREE.Vector3(), tmpUp = new THREE.Vector3(0, 1, 0);
  placeOuterForest();
  /** Tala (o vuelve a plantar) los pinos del claro de la era. Con `animate`, se encogen poco a poco. */
  function clearForest(era: number, animate: boolean): void {
    for (const p of pines) {
      p.obj.visible = !(p.river && era >= 3);
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
  // ---------- Obstáculos ----------
  // Todo lo fijo que cae del cielo (viviendas, edificios, árboles de cultivo, montones) ocupa un
  // círculo en el suelo. walkTo() rodea esos círculos para que nadie atraviese una casa o un horno.
  interface Solid { obj: THREE.Object3D; x: number; z: number; r: number }
  const solids: Solid[] = [];
  const solidBox = new THREE.Box3();
  function addSolid(obj: THREE.Object3D): void {
    if (!obj.parent) return;
    obj.updateMatrixWorld(true);
    solidBox.setFromObject(obj);
    if (solidBox.isEmpty()) return;
    // El círculo queda un poco por dentro de la caja: los aleros y esquinas sobresalen sin estorbar.
    const r = (Math.max(solidBox.max.x - solidBox.min.x, solidBox.max.z - solidBox.min.z) / 2) * 0.82;
    // Lo muy pequeño no estorba; lo enorme (campos, canteras) es una zona de trabajo, no un muro.
    if (r < 0.3 || r > 6.5) return;
    solids.push({ obj, x: (solidBox.min.x + solidBox.max.x) / 2, z: (solidBox.min.z + solidBox.max.z) / 2, r });
  }

  /** Vuelve a calcular el obstáculo de algo fijo que se ha movido de sitio. */
  function moveSolid(obj: THREE.Object3D): void {
    for (let k = solids.length - 1; k >= 0; k--) if (solids[k].obj === obj) solids.splice(k, 1);
    addSolid(obj);
  }

  const spawn = <T extends THREE.Object3D>(obj: T, scale = 1, dynamic = false): T => {
    obj.scale.setScalar(scale);
    if (!dynamic) addSolid(obj);
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

  /** Un punto al azar en el agua de la era, cerca de la ciudad. */
  function waterSpot(): { x: number; z: number } {
    if (waterStage === 3) return riverBank(RIVER_NEAR_S + (fx() - 0.5) * 56, (fx() - 0.5) * RIVER_W * 1.3);
    const c = waterStage === 2 ? LAKE : POND, a = fx() * Math.PI * 2, d = fx() * (waterStage === 2 ? LAKE_R - 1.8 : 3.4);
    return { x: c.x + Math.cos(a) * d, z: c.y + Math.sin(a) * d };
  }
  /** Las redes tendidas en la orilla: junto a la charca, al lago o al río, según la era. */
  const netsSpot = () =>
    waterStage === 3 ? riverBank(RIVER_NEAR_S + 3.4, RIVER_W + 1.9)
    : waterStage === 2 ? { x: LAKE.x + Math.cos(2.2) * (LAKE_R + 1.5), z: LAKE.y + Math.sin(2.2) * (LAKE_R + 1.5) }
    : { x: POND.x - 5.8, z: POND.y + 2.5 };

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
      if (inWater(p.x, p.z, 3) || sideOf(p.x, p.z) !== 1) continue;
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
  // Ventanas: de día oscuras; al caer la noche se encienden con la luz cálida de dentro.
  const windowMat = new THREE.MeshBasicMaterial({ color: 0x2a2018 });
  const windowDark = new THREE.Color(0x2a2018), windowLit = new THREE.Color(0xffc46a);
  /** Una ventana pegada a la pared, con el frente hacia +z girado rotY. */
  function pane(g: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, rotY = 0): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), windowMat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    g.add(m);
  }

  /**
   * Une en una sola malla las piezas fijas de g que comparten material: una casa moderna pasa de nueve
   * piezas a seis, y cada pieza menos es un dibujo menos en cada fotograma (y en cada sombra). Se ve
   * igual. Lo que se anima o se usa después (lo guardado en g.userData, como la puerta y el humo) y
   * las piezas con datos propios se quedan como están.
   */
  function bakeStatic<T extends THREE.Object3D>(g: T): T {
    const keep = new Set(Object.values(g.userData).filter((v): v is THREE.Object3D => v instanceof THREE.Object3D));
    const sets = new Map<string, { m: THREE.Material; cast: boolean; receive: boolean; list: THREE.Mesh[] }>();
    const walk = (o: THREE.Object3D) => {
      if (keep.has(o) || !o.visible) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mesh.material) && !Object.keys(mesh.userData).length) {
        const key = `${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}`;
        let set = sets.get(key);
        if (!set) sets.set(key, (set = { m: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, list: [] }));
        set.list.push(mesh);
      }
      for (const c of o.children) walk(c);
    };
    for (const c of g.children) walk(c);
    g.updateMatrixWorld(true);
    const toLocal = new THREE.Matrix4().copy(g.matrixWorld).invert(), rel = new THREE.Matrix4();
    for (const { m, cast, receive, list } of sets.values()) {
      if (list.length < 2) continue;
      const colors = (m as THREE.MeshStandardMaterial).vertexColors;
      const geos = list.map((mesh) => {
        const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        for (const name of Object.keys(src.attributes)) if (name !== 'position' && name !== 'normal' && !(colors && name === 'color')) src.deleteAttribute(name);
        rel.multiplyMatrices(toLocal, mesh.matrixWorld);
        src.applyMatrix4(rel);
        // Una pieza reflejada (escala negativa) tiene las caras al revés: se les da la vuelta.
        if (rel.determinant() < 0) {
          for (const attr of Object.values(src.attributes) as THREE.BufferAttribute[]) {
            const a = attr.array, n = attr.itemSize;
            for (let v = 0; v < attr.count; v += 3)
              for (let k = 0; k < n; k++) [a[(v + 1) * n + k], a[(v + 2) * n + k]] = [a[(v + 2) * n + k], a[(v + 1) * n + k]];
          }
        }
        return src;
      });
      if (geos.some((x) => !x.attributes.normal)) for (const x of geos) if (x.attributes.normal) x.deleteAttribute('normal');
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      for (const mesh of list) mesh.removeFromParent();
      const one = new THREE.Mesh(merged, m);
      one.castShadow = cast;
      one.receiveShadow = receive;
      g.add(one);
    }
    return g;
  }

  function makeTent(x: number, z: number, s: number, tone: number) {
    const g = new THREE.Group();
    // La punta, tiznada de humo, deja ver de noche el fuego de dentro
    const glow = new THREE.Mesh(new THREE.ConeGeometry(0.31 * s, 0.52 * s, 8), windowMat);
    glow.position.y = 2.76 * s;
    g.add(glow);
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
    const gy = groundY(x, z, 1.1 * s);
    add(g, x, gy, z);
    g.lookAt(0, gy, 0);
    return g;
  }

  const skins = [0xe0b48a, 0xc99068, 0xb07850, 0xe8c29a], hairs = [0x2a1a12, 0x5a3418, 0x1a120c];
  // En el Neolítico ya se teje: túnicas de lino y lana teñidas.
  const clothes: Record<BuildingId, number> = {
    gatherer: 0x9a7048, woodcutter: 0x6b4a2c, hunter: 0x8b5a3c, feller: 0x5a3a26, fisher: 0x56606d, rafter: 0x4a6a62,
    quarrier: 0x7a7468, farmer: 0xd6c08a, forester: 0x5f7a3a, herder: 0xb0784a, carpenter: 0x9a6a3e, miner: 0x5c5248,
    smelter: 0x7a3a24, mason: 0xa49c8a, plowman: 0xb89a62, charcoaler: 0x3e3a38, copperMiner: 0x4f6a5e,
    // Antigüedad: túnicas blancas, azules y teñidas de púrpura
    blacksmith: 0x5a4a44, oliveGrower: 0xe8e2d2, sawyer: 0x8a6a48, marbler: 0xd8d4ca, bronzesmith: 0x7a3a5a, ironMiner: 0x6a4a3a,
    // Edad Media: paños teñidos de colores vivos
    merchant: 0x7a2a3a, miller: 0xd8cfb8, ranger: 0x3e5a2e, bricklayer: 0x8a7a62, bellfounder: 0x5a4a6a, armorer: 0x4a4a52, goldMiner: 0x6a5232,
    // Renacimiento: jubones de terciopelo y paño fino
    printer: 0x2e3440, vintner: 0x6a2a4a, shipwright: 0x2f4f6e, sculptor: 0xcfc6b4, clockmaker: 0x5e4a2a, gunsmith: 0x3f4248, banker: 0x8a1a22, bookbinder: 0x4a5a32,
    // Revolución Industrial: paño oscuro, chalecos y gorras
    coalMiner: 0x3a3632, journalist: 0x4a4038, canner: 0x6a7a8a, cabinetmaker: 0x7a5a3a, brickmaker: 0x8a5a42, boilermaker: 0x3e4a5a, puddler: 0x5a3a2a, stockbroker: 0x2a2a32, engineer: 0x2f3e5a,
    // Era Moderna: monos y camisas de colores, bata blanca en el laboratorio
    electrician: 0x2a5aa8, excavator: 0xd88a2a, agronomist: 0x5a8a3a, forestEngineer: 0x3a6a3a, concreter: 0x8a8a8a, mechanic: 0x2a3a6a, welder: 0x5a4a3a, entrepreneur: 0x2e3440, scientist: 0xf2f2f0, solarTech: 0xe8a82a,
  };
  const wheatMat = mat(0xe2b64a), flintMat = mat(0x2e2a30, { roughness: 0.6 }), blockMat = mat(0xa8a3a0), clayMat = mat(0xb5683a);
  const wrapMat = mat(0x3d2a1c), stoneMat = mat(0x9a9aa8), berryMat = mat(0xc23a3a);
  const bronzeHeadMat = mat(0xc98a3a, { metalness: 0.5, roughness: 0.45 }), oreHeadMat = mat(0x3f9a7a);
  const ironMat = mat(0x4a4c55, { metalness: 0.6, roughness: 0.4 }), ironOreMat = mat(0x9a3e2a), marbleMat = mat(0xf2efe6);
  const plankMat = mat(0xc89a62), oliveMat = mat(0x4a5a2a);
  const MEDIEVAL_GEAR = new Set<BuildingId>(['merchant', 'miller', 'ranger', 'bricklayer', 'bellfounder', 'armorer', 'goldMiner']);
  const goldOreHeadMat = mat(0xd8a828), goldMatP = mat(0xd8b040, { metalness: 0.6, roughness: 0.35 });
  const RENAISSANCE_GEAR = new Set<BuildingId>(['printer', 'vintner', 'shipwright', 'sculptor', 'clockmaker', 'gunsmith', 'banker', 'bookbinder']);
  const BOOK_COLORS = [0x7a2a24, 0x2a4a6a, 0x3a5a2a, 0x6a4a2a];
  // Revolución Industrial y Era Moderna: herramienta en la mano (si la usan) y lo que llevan al montón
  const INDUSTRY_TOOL: Partial<Record<BuildingId, 'pick' | 'hammer' | 'bar' | 'shovel' | 'torch'>> = {
    coalMiner: 'pick', boilermaker: 'hammer', puddler: 'bar', engineer: 'shovel', concreter: 'shovel', mechanic: 'hammer', welder: 'torch', cabinetmaker: 'hammer',
  };
  const INDUSTRY_LOAD: Partial<Record<BuildingId, [number, number, number, number]>> = {
    journalist: [0.4, 0.2, 0.3, 0xece4d0], canner: [0.4, 0.25, 0.3, 0xc8ccd0], cabinetmaker: [0.42, 0.42, 0.3, 0x8a5a32], brickmaker: [0.45, 0.22, 0.3, 0xb4583a],
    boilermaker: [0.36, 0.36, 0.36, 0x5a6068], puddler: [0.8, 0.1, 0.14, 0x4a4c55], stockbroker: [0.36, 0.12, 0.28, 0xe8dcb8], engineer: [0.4, 0.3, 0.3, 0x1e1c1c],
    electrician: [0.4, 0.4, 0.2, 0x2e2a28], excavator: [0.4, 0.3, 0.3, 0x1e1c1c], agronomist: [0.45, 0.25, 0.32, 0xd83a2a], forestEngineer: [0.2, 0.2, 1, 0x8a5a32],
    concreter: [0.42, 0.25, 0.3, 0xb8b4ac], mechanic: [0.4, 0.4, 0.14, 0x2e2a28], welder: [1, 0.12, 0.14, 0x8a4a2a], entrepreneur: [0.5, 0.36, 0.14, 0x3a2418],
    scientist: [0.4, 0.26, 0.3, 0xd8d4c8], solarTech: [0.7, 0.05, 0.45, 0x1e3a6a],
  };
  function makePerson(kind: BuildingId, i: number): Rig {
    const root = new THREE.Group();
    const skin = mat(skins[i % skins.length]);
    const heads: THREE.Mesh[] = [];
    const th = <T extends THREE.Mesh>(m: T): T => {
      m.userData.base = m.material;
      heads.push(m);
      return m;
    };
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
    const armL = limb(-0.27, 0.56, 0.5, 0.065, skin, torso);
    const armR = limb(0.27, 0.56, 0.5, 0.065, skin, torso);
    armL.rotation.z = -0.12;
    armR.rotation.z = 0.12;
    const meshOf = (g: THREE.Group) => g.children[0] as THREE.Mesh;
    const rig: Rig = {
      root, torso, armL, armR, legL, legR, skin, hair: hairs[i % hairs.length], heads, kind, i, era: 0,
      limbs: { legs: [meshOf(legL), meshOf(legR)], arms: [meshOf(armL), meshOf(armR)] },
    };
    if (kind === 'hunter') {
      const spear = new THREE.Group();
      spear.position.set(0, -0.48, 0.02);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), pole);
      shaft.position.y = 0.6;
      const tip = th(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 4), stoneMat));
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
      const head = th(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.16), stoneMat));
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
      const blade = th(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 3, 8, Math.PI * 1.1), stoneMat));
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
        const head = th(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.16), stoneMat));
        head.position.set(0, -0.02, 0.64);
        tool.add(head);
      } else if (kind === 'quarrier') {
        const head = th(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.3), blockMat));
        head.position.set(0, 0, 0.66);
        tool.add(head);
      } else {
        const tine = th(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 4), antlerMat));
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
      const head = th(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.2), kind === 'smelter' ? stoneMat : bronzeHeadMat));
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
      const head = th(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.45, 4), bronzeHeadMat));
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
    } else if (kind === 'blacksmith' || kind === 'bronzesmith' || kind === 'marbler') {
      // Martillo y la pieza terminada al hombro: barra de hierro, escudo de bronce o bloque de mármol
      const tool = new THREE.Group();
      tool.position.set(0, -0.48, 0.02);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 4), pole);
      handle.rotation.x = Math.PI / 2;
      handle.position.z = 0.2;
      const head = th(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.22), kind === 'marbler' ? pole : ironMat));
      head.position.set(0, 0, 0.44);
      tool.add(handle, head);
      armR.add(tool);
      const load =
        kind === 'blacksmith' ? new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.14), ironMat)
        : kind === 'bronzesmith' ? new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), bronzeHeadMat)
        : new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.34), marbleMat);
      if (kind === 'bronzesmith') load.rotation.x = Math.PI / 2;
      load.position.set(0, 0.72, -0.2);
      torso.add(load);
      rig.carry = load;
    } else if (kind === 'sawyer') {
      // Sierra de hierro y un tablón al hombro
      const saw = new THREE.Group();
      saw.position.set(0, -0.48, 0.02);
      const blade = th(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.8), ironMat));
      blade.position.z = 0.42;
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), pole);
      saw.add(blade, grip);
      armR.add(saw);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.22), plankMat);
      plank.position.set(0, 0.7, -0.22);
      torso.add(plank);
      rig.carry = plank;
    } else if (kind === 'oliveGrower') {
      // Cesto de aceitunas a la espalda
      const basket = new THREE.Group();
      basket.position.set(0, 0.35, -0.3);
      basket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.32, 7), mat(0x9a7a4a)));
      const load = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const o = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), oliveMat);
        o.position.set((k % 3 - 1) * 0.09, 0.17, (Math.floor(k / 3) - 0.5) * 0.1);
        load.add(o);
      }
      basket.add(load);
      torso.add(basket);
      rig.carry = load;
    } else if (kind === 'ironMiner') {
      // Pico de hierro y un capazo de mineral rojo
      const tool = new THREE.Group();
      tool.position.set(0, -0.48, 0.02);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 4), pole);
      handle.rotation.x = Math.PI / 2;
      handle.position.z = 0.3;
      const head = th(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.45, 4), ironMat));
      head.rotation.z = Math.PI / 2;
      head.position.set(0, 0, 0.64);
      tool.add(handle, head);
      armR.add(tool);
      const basket = new THREE.Group();
      basket.position.set(0, 0.35, -0.3);
      basket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.32, 7), mat(0x7a5a32)));
      const load = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), ironOreMat);
        b.position.set((k % 3 - 1) * 0.1, 0.17, (Math.floor(k / 3) - 0.5) * 0.12);
        load.add(b);
      }
      basket.add(load);
      torso.add(basket);
      rig.carry = load;
    } else if (MEDIEVAL_GEAR.has(kind)) {
      // Edad Media: mazo, hacha, mayal o pico en la mano y lo que llevan al montón a la espalda
      const tool = new THREE.Group();
      tool.position.set(0, -0.48, 0.02);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, kind === 'miller' ? 0.9 : 0.6, 4), pole);
      handle.rotation.x = Math.PI / 2;
      handle.position.z = kind === 'miller' ? 0.4 : 0.26;
      tool.add(handle);
      if (kind === 'miller') {
        // Mayal: un palo corto unido con una correa al mango
        const swingle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4), pole);
        swingle.position.set(0, -0.2, 0.85);
        tool.add(swingle);
      } else if (kind === 'ranger') {
        const head = th(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.16), ironMat));
        head.position.set(0, 0.08, 0.5);
        tool.add(head);
      } else if (kind === 'goldMiner') {
        const head = th(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.45, 4), ironMat));
        head.rotation.z = Math.PI / 2;
        head.position.set(0, 0, 0.56);
        tool.add(head);
      } else if (kind !== 'merchant') {
        const head = th(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.22), ironMat));
        head.position.set(0, 0, 0.56);
        tool.add(head);
      }
      if (kind !== 'merchant') armR.add(tool);
      let load: THREE.Object3D;
      if (kind === 'goldMiner') {
        const basket = new THREE.Group();
        basket.position.set(0, 0.35, -0.3);
        basket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.32, 7), mat(0x7a5a32)));
        const ore = new THREE.Group();
        for (let k = 0; k < 5; k++) {
          const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), goldOreHeadMat);
          b.position.set((k % 3 - 1) * 0.1, 0.17, (Math.floor(k / 3) - 0.5) * 0.12);
          ore.add(b);
        }
        basket.add(ore);
        torso.add(basket);
        load = ore;
      } else {
        load =
          kind === 'merchant' ? new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.32), mat(0x7a4a26))
          : kind === 'miller' ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), mat(0xece4d0))
          : kind === 'ranger' ? new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.95, 6), mat(0x6b4527))
          : kind === 'bricklayer' ? new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.34), mat(0xb4ac9c))
          : kind === 'bellfounder' ? new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.36, 8), bronzeHeadMat)
          : new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), ironMat);
        if (kind === 'ranger') load.rotation.z = Math.PI / 2;
        load.position.set(0, 0.72, -0.2);
        torso.add(load);
      }
      rig.carry = load;
    } else if (RENAISSANCE_GEAR.has(kind)) {
      // Renacimiento: mazo, azuela o cuchillo de vendimiar en la mano, y lo que llevan a su sitio
      if (kind === 'shipwright' || kind === 'sculptor' || kind === 'gunsmith' || kind === 'vintner') {
        const tool = new THREE.Group();
        tool.position.set(0, -0.48, 0.02);
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, kind === 'vintner' ? 0.2 : 0.55, 4), pole);
        handle.rotation.x = Math.PI / 2;
        handle.position.z = kind === 'vintner' ? 0.1 : 0.24;
        const head = th(new THREE.Mesh(kind === 'vintner' ? new THREE.BoxGeometry(0.03, 0.08, 0.22) : new THREE.BoxGeometry(0.13, 0.13, 0.2), ironMat));
        head.position.set(0, 0, kind === 'vintner' ? 0.3 : 0.52);
        tool.add(handle, head);
        armR.add(tool);
      }
      let load: THREE.Object3D;
      if (kind === 'vintner') {
        // Cesto de uvas a la espalda
        const basket = new THREE.Group();
        basket.position.set(0, 0.35, -0.3);
        basket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.34, 7), mat(0x9a7a42)));
        load = new THREE.Group();
        for (let k = 0; k < 6; k++) {
          const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), mat(0x5a2a5a));
          b.position.set((k % 3 - 1) * 0.1, 0.18 + (k > 2 ? 0.06 : 0), (Math.floor(k / 3) - 0.5) * 0.1);
          load.add(b);
        }
        basket.add(load);
        torso.add(basket);
      } else {
        if (kind === 'bookbinder' || kind === 'printer') {
          load = new THREE.Group();
          for (let k = 0; k < 3; k++) {
            const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.26), mat(kind === 'printer' ? 0xf2ecdc : BOOK_COLORS[k]));
            b.position.y = k * 0.09;
            b.rotation.y = (k - 1) * 0.15;
            load.add(b);
          }
        } else
          load =
            kind === 'shipwright' ? new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 1.1), mat(0x9a6a3a))
            : kind === 'sculptor' ? new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3), marbleMat)
            : kind === 'clockmaker' ? new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 4, 10), goldMatP)
            : kind === 'gunsmith' ? new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.1, 5), ironMat)
            : new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.28), mat(0x6a3a22));
        if (kind === 'gunsmith') load.rotation.x = Math.PI / 2;
        if (kind === 'clockmaker') load.rotation.x = Math.PI / 2;
        load.position.set(0, 0.72, -0.2);
        torso.add(load);
      }
      rig.carry = load;
    } else if (kind in INDUSTRY_LOAD || kind === 'coalMiner') {
      const tk = INDUSTRY_TOOL[kind];
      if (tk) {
        const tool = new THREE.Group();
        tool.position.set(0, -0.48, 0.02);
        const long = tk === 'shovel' || tk === 'bar';
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, long ? 0.9 : 0.5, 4), pole);
        handle.rotation.x = Math.PI / 2;
        handle.position.z = long ? 0.4 : 0.22;
        const headGeo =
          tk === 'pick' ? new THREE.ConeGeometry(0.05, 0.45, 4).rotateZ(Math.PI / 2)
          : tk === 'shovel' ? new THREE.BoxGeometry(0.24, 0.04, 0.28)
          : tk === 'torch' ? new THREE.CylinderGeometry(0.04, 0.05, 0.2, 5).rotateX(Math.PI / 2)
          : tk === 'bar' ? new THREE.BoxGeometry(0.05, 0.05, 0.3)
          : new THREE.BoxGeometry(0.13, 0.13, 0.2);
        const head = th(new THREE.Mesh(headGeo, ironMat));
        head.position.set(0, 0, long ? 0.95 : 0.5);
        tool.add(handle, head);
        armR.add(tool);
      }
      let load: THREE.Object3D;
      if (kind === 'coalMiner') {
        // Cesto de carbón a la espalda
        const basket = new THREE.Group();
        basket.position.set(0, 0.35, -0.3);
        basket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.32, 7), mat(0x5a4a32)));
        load = new THREE.Group();
        for (let k = 0; k < 5; k++) {
          const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), mat(0x1e1c1c));
          b.position.set((k % 3 - 1) * 0.1, 0.17, (Math.floor(k / 3) - 0.5) * 0.12);
          load.add(b);
        }
        basket.add(load);
        torso.add(basket);
      } else {
        const [w, h, d, c] = INDUSTRY_LOAD[kind]!;
        load = new THREE.Mesh(kind === 'electrician' || kind === 'mechanic' ? new THREE.TorusGeometry(w / 2, h / 4, 5, 10) : kind === 'forestEngineer' ? new THREE.CylinderGeometry(w / 2, w / 2, d, 6).rotateX(Math.PI / 2) : new THREE.BoxGeometry(w, h, d), mat(c));
        load.position.set(0, 0.72, -0.2);
        torso.add(load);
      }
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

  // ---------- Ropa y herramientas de cada era ----------
  // Al pasar de era se viste toda la población, también la que ya vivía en la aldea: pieles en el
  // Paleolítico, túnicas tejidas con cinturón en el Neolítico, lana teñida con capa y gorro en la
  // Edad del Bronce, túnicas blancas con orla, banda y sombrero de ala en la Antigüedad, y en la
  // Edad Media sayos de colores con capucha, calzas y zurrón. Las herramientas pasan de piedra a
  // bronce y de bronce a hierro.
  const outfitMat = mat(0xffffff, { vertexColors: true });
  const mix = (a: number, b: number, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();
  const DYES = [0x8a2a24, 0x3a5a8a, 0x4a6a3a, 0xa8803a, 0x6a3a6a, 0x2f5a5a];
  const FIELD_JOBS = new Set<BuildingId>(['gatherer', 'farmer', 'forester', 'herder', 'plowman', 'oliveGrower', 'fisher', 'rafter', 'vintner', 'agronomist', 'forestEngineer']);
  // Era Moderna: chaleco reflectante en las obras y en la calle, y casco en las más duras
  const HI_VIS = new Set<BuildingId>(['concreter', 'welder', 'excavator', 'electrician', 'solarTech', 'forestEngineer', 'mechanic', 'coalMiner', 'quarrier', 'miner', 'woodcutter', 'feller']);
  const HARD_HAT = new Set<BuildingId>(['concreter', 'welder', 'excavator', 'electrician', 'coalMiner', 'miner', 'quarrier']);
  const SUITED = new Set<BuildingId>(['stockbroker', 'journalist', 'banker', 'merchant', 'entrepreneur', 'printer', 'bookbinder']);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
  /** Pieza de ropa ya colocada y teñida, lista para unir con las demás. */
  function piece(geo: THREE.BufferGeometry, color: number, at: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g.attributes.uv) g.deleteAttribute('uv');
    _m.compose(_v.set(...at), _q.setFromEuler(_e.set(...rot)), _s.set(...scale));
    g.applyMatrix4(_m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) col.set([c.r, c.g, c.b], k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  function dress(rig: Rig, era: number): void {
    if (rig.era === era) return;
    rig.era = era;
    const { kind, i } = rig;
    const base = clothes[kind];
    const skin = rig.skin;
    const dye = DYES[(i + kind.length) % DYES.length];
    const parts: THREE.BufferGeometry[] = [];
    let body = base, legs: THREE.Material = wrapMat, arms: THREE.Material = skin;
    const hatted = FIELD_JOBS.has(kind) ? i % 2 === 0 : i % 3 === 0;
    if (era <= 1) {
      // Piel con el pelo hacia fuera sobre un hombro
      parts.push(piece(new THREE.IcosahedronGeometry(0.17, 0), mix(base, 0xd8c0a0, 0.35), [i % 2 ? 0.14 : -0.14, 0.56, 0], [0, 0, 0], [1, 0.55, 1.1]));
    } else if (era === 2) {
      // Túnica de lino tejido, ceñida con un cordón, y una cinta en la frente
      body = mix(base, 0xd9c9a3, 0.45);
      parts.push(piece(new THREE.TorusGeometry(0.262, 0.028, 4, 10), 0x5a3a22, [0, 0.25, 0], [Math.PI / 2, 0, 0]));
      parts.push(piece(new THREE.TorusGeometry(0.205, 0.025, 4, 10), mix(base, 0x7a3a22, 0.5), [0, 0.86, 0.02], [Math.PI / 2 - 0.15, 0, 0]));
    } else if (era === 3) {
      // Lana teñida con mangas, cinturón de cuero con hebilla de bronce, capa corta y gorro de cuero
      body = base;
      legs = mat(0x4a3a2c);
      arms = mat(base);
      parts.push(piece(new THREE.TorusGeometry(0.262, 0.035, 4, 10), 0x4a2e1a, [0, 0.25, 0], [Math.PI / 2, 0, 0]));
      parts.push(piece(new THREE.BoxGeometry(0.1, 0.08, 0.04), 0xc98a3a, [0, 0.25, 0.27]));
      parts.push(piece(new THREE.BoxGeometry(0.46, 0.5, 0.04), dye, [0, 0.32, -0.27], [-0.12, 0, 0]));
      if (hatted) parts.push(piece(new THREE.SphereGeometry(0.235, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0x6a4a2c, [0, 0.83, -0.01]));
    } else if (era === 4) {
      // Túnica blanca con orla de color, banda cruzada y sandalias; los del campo, sombrero de ala ancha
      body = i % 4 === 3 ? mix(base, 0xefe9da, 0.6) : 0xefe9da;
      legs = skin;
      parts.push(piece(new THREE.CylinderGeometry(0.297, 0.305, 0.08, 9, 1, true), base === 0xe8e2d2 || base === 0xd8d4ca ? dye : base, [0, 0.03, 0]));
      parts.push(piece(new THREE.BoxGeometry(0.11, 0.78, 0.05), dye, [0.02, 0.33, 0.24], [0, 0, 0.62]));
      parts.push(piece(new THREE.BoxGeometry(0.11, 0.5, 0.05), dye, [-0.14, 0.38, -0.25], [0, 0, -0.5]));
      if (hatted) {
        parts.push(piece(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 10), 0xc8a868, [0, 0.9, 0]));
        parts.push(piece(new THREE.SphereGeometry(0.2, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0xb89858, [0, 0.9, 0]));
      }
    } else if (era === 7) {
      // Revolución Industrial: chaqueta de paño oscuro con chaleco, pantalón largo, pañuelo al cuello
      // y gorra plana; los de la bolsa, el periódico y el comercio, sombrero de copa o bombín
      body = mix(base, 0x2a2826, 0.35);
      arms = mat(mix(base, 0x1a1816, 0.45));
      legs = mat(i % 2 ? 0x3a3530 : 0x4a4238);
      parts.push(piece(new THREE.BoxGeometry(0.3, 0.4, 0.05), DYES[(i + 1) % DYES.length], [0, 0.36, 0.25], [-0.06, 0, 0]));
      parts.push(piece(new THREE.TorusGeometry(0.16, 0.045, 4, 10), dye, [0, 0.6, 0.02], [Math.PI / 2, 0, 0]));
      if (SUITED.has(kind)) {
        parts.push(piece(new THREE.CylinderGeometry(0.33, 0.33, 0.03, 12), 0x1a1a1e, [0, 0.9, 0]));
        parts.push(piece(new THREE.CylinderGeometry(0.19, 0.2, i % 2 ? 0.42 : 0.2, 10), 0x1a1a1e, [0, i % 2 ? 1.11 : 1.0, 0]));
      } else if (hatted || i % 3 === 1) {
        // Gorra plana con visera
        parts.push(piece(new THREE.CylinderGeometry(0.25, 0.24, 0.1, 10), i % 2 ? 0x4a4440 : 0x5a4a3a, [0, 0.93, -0.02]));
        parts.push(piece(new THREE.BoxGeometry(0.3, 0.03, 0.16), 0x3a3430, [0, 0.9, 0.24]));
      }
    } else if (era >= 8) {
      // Era Moderna: camiseta o camisa, vaqueros, chaleco reflectante y casco en las obras, bata
      // blanca en el laboratorio, traje y corbata en las oficinas y gorra en el campo
      body = base;
      arms = kind === 'scientist' || SUITED.has(kind) || i % 2 ? mat(base) : skin;
      legs = mat(SUITED.has(kind) ? 0x2a2a30 : i % 3 === 2 ? 0x8a7a5a : 0x2a3e6a);
      // Cinturón y cuello de la camisa o de la camiseta
      parts.push(piece(new THREE.TorusGeometry(0.262, 0.025, 4, 10), 0x2a2420, [0, 0.25, 0], [Math.PI / 2, 0, 0]));
      parts.push(piece(new THREE.TorusGeometry(0.15, 0.035, 4, 10), SUITED.has(kind) ? 0xf2f2f0 : mix(base, 0xffffff, 0.3), [0, 0.6, 0.01], [Math.PI / 2, 0, 0]));
      if (HI_VIS.has(kind)) {
        parts.push(piece(new THREE.CylinderGeometry(0.255, 0.3, 0.42, 9, 1, true), 0xd8e82a, [0, 0.33, 0]));
        parts.push(piece(new THREE.CylinderGeometry(0.29, 0.29, 0.05, 9, 1, true), 0xe8e8e8, [0, 0.26, 0]));
      }
      if (kind === 'scientist') parts.push(piece(new THREE.CylinderGeometry(0.31, 0.35, 0.34, 9, 1, true), 0xf6f6f2, [0, 0.02, 0]));
      if (SUITED.has(kind)) parts.push(piece(new THREE.BoxGeometry(0.07, 0.3, 0.03), DYES[(i + 4) % DYES.length], [0, 0.42, 0.26], [-0.08, 0, 0]));
      if (HARD_HAT.has(kind)) {
        parts.push(piece(new THREE.SphereGeometry(0.25, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xe8c02a, [0, 0.86, 0]));
        parts.push(piece(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 10), 0xe8c02a, [0, 0.86, 0.02]));
      } else if (hatted && !SUITED.has(kind)) {
        // Gorra de visera
        parts.push(piece(new THREE.SphereGeometry(0.235, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), dye, [0, 0.86, -0.01]));
        parts.push(piece(new THREE.BoxGeometry(0.26, 0.03, 0.2), dye, [0, 0.88, 0.25]));
      }
    } else if (era === 6) {
      // Renacimiento: jubón ceñido con mangas abullonadas, cuello de lechuguilla, calzas de color
      // y, según quién, boina con pluma o sombrero de paja en el campo
      body = base;
      arms = mat(mix(base, 0x000000, 0.15));
      legs = mat(DYES[(i + 3) % DYES.length]);
      for (const sx of [-1, 1]) parts.push(piece(new THREE.IcosahedronGeometry(0.11, 1), dye, [sx * 0.27, 0.54, 0], [0, 0, 0], [1, 0.85, 1]));
      parts.push(piece(new THREE.TorusGeometry(0.15, 0.05, 5, 12), 0xf2eee4, [0, 0.62, 0], [Math.PI / 2, 0, 0]));
      parts.push(piece(new THREE.CylinderGeometry(0.305, 0.33, 0.14, 9, 1, true), dye, [0, 0.03, 0]));
      parts.push(piece(new THREE.TorusGeometry(0.262, 0.028, 4, 10), 0x2a1a10, [0, 0.25, 0], [Math.PI / 2, 0, 0]));
      if (hatted && FIELD_JOBS.has(kind)) {
        parts.push(piece(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 10), 0xd8b860, [0, 0.9, 0]));
        parts.push(piece(new THREE.CylinderGeometry(0.15, 0.19, 0.14, 8), 0xc8a850, [0, 0.97, 0]));
      } else if (hatted || i % 3 === 1) {
        // Boina de terciopelo, algo ladeada, con una pluma
        parts.push(piece(new THREE.CylinderGeometry(0.27, 0.25, 0.08, 10), i % 2 ? 0x2a2230 : 0x6a1a22, [0.03, 0.95, 0], [0, 0, 0.12]));
        parts.push(piece(new THREE.ConeGeometry(0.03, 0.34, 4), 0xf2ecdc, [-0.16, 1.05, -0.06], [0.3, 0, 0.7]));
      }
    } else {
      // Edad Media: sayo del color del oficio, capucha con esclavina de otro color, calzas, cinturón y zurrón
      body = base;
      arms = mat(base);
      legs = mat(DYES[(i + 2) % DYES.length]);
      parts.push(piece(new THREE.CylinderGeometry(0.235, 0.3, 0.16, 9, 1, true), dye, [0, 0.55, 0]));
      parts.push(piece(new THREE.TorusGeometry(0.262, 0.03, 4, 10), 0x3a2416, [0, 0.25, 0], [Math.PI / 2, 0, 0]));
      parts.push(piece(new THREE.BoxGeometry(0.13, 0.15, 0.08), 0x6a4a2c, [0.2, 0.17, 0.18], [0, -0.6, 0]));
      if (hatted && FIELD_JOBS.has(kind)) {
        // Sombrero de paja de los campesinos
        parts.push(piece(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 10), 0xd8b860, [0, 0.9, 0]));
        parts.push(piece(new THREE.CylinderGeometry(0.14, 0.2, 0.16, 8), 0xc8a850, [0, 0.98, 0]));
      } else if (hatted) {
        // Capucha con la punta caída hacia atrás
        parts.push(piece(new THREE.SphereGeometry(0.245, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.6), dye, [0, 0.8, -0.02]));
        parts.push(piece(new THREE.ConeGeometry(0.1, 0.42, 5), dye, [0, 0.86, -0.3], [-1.9, 0, 0]));
      } else {
        // Cofia de lino atada bajo la barbilla
        parts.push(piece(new THREE.SphereGeometry(0.23, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0xe8e0cc, [0, 0.82, -0.02], [-0.15, 0, 0]));
      }
    }
    // Cuerpo, cabeza y pelo, con los mismos colores que tenían como piezas sueltas
    parts.push(piece(new THREE.CylinderGeometry(0.2, 0.3, 0.62, 7), body, [0, 0.3, 0]));
    parts.push(piece(new THREE.IcosahedronGeometry(0.21, 0), skins[i % skins.length], [0, 0.78, 0]));
    parts.push(piece(new THREE.IcosahedronGeometry(0.225, 0), rig.hair, [0, 0.88, -0.05], [0, 0, 0], [1, 0.6, 1]));
    for (const l of rig.limbs.legs) l.material = legs;
    for (const a of rig.limbs.arms) a.material = arms;
    for (const h of rig.heads) h.material = era >= 4 ? ironMat : era === 3 ? bronzeHeadMat : (h.userData.base as THREE.Material);
    if (rig.outfit) {
      rig.torso.remove(rig.outfit);
      rig.outfit.geometry.dispose();
    }
    const outfit = new THREE.Mesh(mergeGeometries(parts)!, outfitMat);
    outfit.castShadow = outfit.receiveShadow = true;
    rig.torso.add(outfit);
    rig.outfit = outfit;
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
    if (waterStage === 3) {
      // Repartidos por la orilla de la ciudad, a los dos lados del puente
      const s = RIVER_NEAR_S + (i % 2 ? 1 : -1) * (7 + Math.floor(i / 2) * 5.5);
      const st = riverBank(s, RIVER_W + 1.1), b = riverBank(s, RIVER_W - 1.8);
      return { x: st.x, z: st.z, bob: new THREE.Vector3(b.x, -0.2, b.z) };
    }
    const c = waterStage === 2 ? LAKE : POND, R = waterStage === 2 ? LAKE_R + 0.5 : 5.6, B = waterStage === 2 ? LAKE_R - 2.6 : 3.2;
    const a = Math.PI * 0.75 + (i / MAX_SHOWN.fisher) * Math.PI * 1.1;
    return { x: c.x + Math.cos(a) * R, z: c.y + Math.sin(a) * R, bob: new THREE.Vector3(c.x + Math.cos(a) * B, -0.2, c.y + Math.sin(a) * B) };
  };
  /** Tramo del río por el que van y vienen las balsas, aguas abajo del puente. */
  const RAFT_LO = RIVER_NEAR_S + 6, RAFT_HI = RIVER_NEAR_S + 34;
  /** Coloca al pescador o al balsero en su sitio según el agua de la era (charca, lago o río). */
  function placeOnWater(p: Person): void {
    if (p.kind === 'fisher') {
      const spot = fisherSpot(p.i);
      [p.x, p.z, p.state, p.timer] = [spot.x, spot.z, 'wait', 3 + fx() * 8];
      p.heading = Math.atan2(spot.bob.x - spot.x, spot.bob.z - spot.z);
      p.bobberPos = spot.bob.clone();
    } else if (p.kind === 'rafter') {
      if (waterStage === 3) {
        p.timer = RAFT_LO + ((p.i + 0.5) / MAX_SHOWN.rafter) * (RAFT_HI - RAFT_LO);
        p.target = p.i % 2 ? -1 : 1;
      } else p.timer = (p.i / MAX_SHOWN.rafter) * Math.PI * 2;
      const at = raftAt(p);
      [p.x, p.z] = [at.x, at.z];
      p.raft?.position.set(p.x, -0.2, p.z);
    }
  }

  function createPerson(kind: BuildingId, i: number): Person {
    const rig = makePerson(kind, i);
    dress(rig, Math.max(1, shownEra));
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
    } else if (CRAFTERS.has(kind)) {
      const spot = craftSpot(kind, i).stand;
      [p.x, p.z, p.state, p.timer] = [spot.x, spot.z, 'work', 1 + fx() * 4];
    } else if (kind === 'oliveGrower') {
      const start = around(OLIVE_GROVE, (i - 1.5) * 0.9, -3);
      [p.x, p.z, p.state, p.target] = [start.x, start.z, 'toTree', (i * 3) % OLIVES.length];
    } else if (kind === 'charcoaler') {
      const start = around(CHARCOAL, (i - 1.5) * 0.8, -1.4);
      [p.x, p.z, p.state] = [start.x, start.z, 'toStack'];
    } else if (kind === 'copperMiner' || kind === 'ironMiner' || kind === 'goldMiner' || kind === 'coalMiner') {
      const start = around(mineOf(kind).mouth, (i - 1.5) * 0.9, -2.6 - i * 0.5);
      [p.x, p.z, p.state] = [start.x, start.z, i % 2 ? 'toMine' : 'toHeap'];
    } else if (kind === 'plowman') {
      const start = furrow(i, 0);
      [p.x, p.z, p.state] = [start.x, start.z, 'plow'];
    } else if (kind === 'rafter') {
      // Cada balsero navega con su carga de troncos: en círculo por el lago o río arriba y abajo.
      p.raft = makeRaft();
      placeOnWater(p);
    } else {
      placeOnWater(p);
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
    if (p.life?.spot) p.life.spot.taken = null;
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

  const raftRadius = (i: number) => (waterStage === 2 ? 2.6 + (i % 2) * 2.2 : 1.5 + (i % 2) * 0.8);
  /** Dónde está la balsa ahora: en su círculo del lago o en su carril del río. */
  function raftAt(p: Person): { x: number; z: number } {
    if (waterStage === 3) return riverBank(p.timer, (p.i % 2 ? 1 : -1) * 1.2);
    const c = waterStage === 2 ? LAKE : POND, rad = raftRadius(p.i);
    return { x: c.x + Math.cos(p.timer) * rad, z: c.y + Math.sin(p.timer) * rad };
  }
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
    // Desde la Edad del Bronce la balsa lleva un mástil con vela cuadrada (ver dress()).
    const sail = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.9, 5), pole);
    mast.position.y = 0.95;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.85, 0.03), sailMat);
    cloth.position.set(0, 1.25, 0.04);
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.15, 4), pole);
    yard.rotation.z = Math.PI / 2;
    yard.position.y = 1.7;
    sail.add(mast, cloth, yard);
    sail.position.z = 0.45;
    sail.visible = shownEra >= 3;
    g.add(sail);
    g.userData.sail = sail;
    g.traverse((c) => { c.castShadow = true; c.receiveShadow = true; });
    scene.add(g);
    return g;
  }
  const sailMat = mat(0xe8dcc0, { side: THREE.DoubleSide });

  function updateRafter(p: Person, dt: number, t: number): void {
    const r = p.rig;
    if (waterStage === 3) {
      // Río arriba y río abajo por su tramo; al llegar al final da la vuelta
      p.target ??= 1;
      p.timer += dt * 0.6 * p.target;
      if (p.timer > RAFT_HI || p.timer < RAFT_LO) {
        p.timer = THREE.MathUtils.clamp(p.timer, RAFT_LO, RAFT_HI);
        p.target = -p.target;
      }
    } else p.timer += (dt * 0.55 * (p.i % 2 ? -1 : 1)) / raftRadius(p.i);
    const at = raftAt(p);
    const want = Math.atan2(at.x - p.x, at.z - p.z);
    if (Math.hypot(at.x - p.x, at.z - p.z) > 1e-4) p.heading = lerpAngle(p.heading, want, Math.min(1, dt * 2.5));
    p.x = at.x;
    p.z = at.z;
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
  /**
   * Distancia a la que hay que pasar de un obstáculo camino de (tx, tz): el radio más el cuerpo, o
   * menos si el destino está pegado a él (un puesto de trabajo junto al yunque). Devuelve 0 si el
   * destino está dentro: entonces se llega a su borde (ver walkTo()).
   */
  const BODY_R = 0.35;
  function reachOf(o: Solid, tx: number, tz: number): number {
    const td = Math.hypot(tx - o.x, tz - o.z);
    return td <= o.r ? 0 : Math.min(o.r + BODY_R, td - 0.05);
  }
  /** Desvía el paso para rodear los obstáculos que hay entre la persona y su destino. */
  function steer(p: { x: number; z: number }, tx: number, tz: number, dirX: number, dirZ: number): [number, number] {
    let sx = dirX, sz = dirZ;
    for (let k = solids.length - 1; k >= 0; k--) {
      const o = solids[k];
      if (!o.obj.parent) {
        solids.splice(k, 1);
        continue;
      }
      const reach = reachOf(o, tx, tz);
      const ox = p.x - o.x, oz = p.z - o.z, od = Math.hypot(ox, oz);
      // Quien ya está dentro (aparece ahí al crearse) sale sin desvíos.
      if (!reach || od < o.r || od > reach + 1.4) continue;
      const toward = -(ox * dirX + oz * dirZ) / od;
      if (toward <= 0) continue; // ya se aleja
      const cross = ox * dirZ - oz * dirX;
      if (Math.abs(cross) > reach) continue; // pasa por el lado sin rozarlo
      // Bordea por el lado más corto, cada vez con más fuerza cuanto más cerca está
      let tanX = -oz / od, tanZ = ox / od;
      if (tanX * dirX + tanZ * dirZ < 0) [tanX, tanZ] = [-tanX, -tanZ];
      const w = Math.min(1, Math.max(0, (reach + 1.4 - od) / 1.4));
      sx = sx * (1 - w) + tanX * w;
      sz = sz * (1 - w) + tanZ * w;
      const len = Math.hypot(sx, sz) || 1;
      sx /= len;
      sz /= len;
    }
    return [sx, sz];
  }
  /** Tras moverse, nadie queda metido en un obstáculo del que venía de fuera. */
  function pushOut(p: { x: number; z: number }, fromX: number, fromZ: number, tx: number, tz: number): void {
    for (const o of solids) {
      const reach = reachOf(o, tx, tz);
      if (!reach || Math.hypot(fromX - o.x, fromZ - o.z) < o.r) continue;
      const ox = p.x - o.x, oz = p.z - o.z, od = Math.hypot(ox, oz);
      if (od >= reach || od === 0) continue;
      p.x = o.x + (ox / od) * reach;
      p.z = o.z + (oz / od) * reach;
    }
  }
  /** Punto libre más cercano: si cae dentro de un obstáculo, se lleva a su borde. */
  function clearOfSolids(x: number, z: number): { x: number; z: number } {
    for (const o of solids) {
      const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), reach = o.r + BODY_R;
      if (d < reach && d > 0) [x, z] = [o.x + (dx / d) * reach, o.z + (dz / d) * reach];
    }
    return { x, z };
  }
  function walkTo(p: Person, tx: number, tz: number, dt: number, speed = 1.15): boolean {
    const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    // Si el destino es un montón, un tronco o un yunque, se llega a su borde y no a su centro:
    // así nadie se mete dentro de la pila de mineral al dejar la carga.
    for (const o of solids) {
      if (o.r > 1.6 || Math.hypot(tx - o.x, tz - o.z) > o.r) continue;
      const od = Math.hypot(p.x - o.x, p.z - o.z);
      if (od > o.r && od <= o.r + BODY_R) return true;
    }
    const step = Math.min(dist, speed * dt);
    const [mx, mz] = steer(p, tx, tz, dx / dist, dz / dist);
    const fromX = p.x, fromZ = p.z;
    p.x += mx * step;
    p.z += mz * step;
    pushOut(p, fromX, fromZ, tx, tz);
    p.heading = lerpAngle(p.heading, Math.atan2(mx, mz), Math.min(1, dt * 8));
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
      // La ronda alrededor del fuego bordea las vasijas y lo demás que haya en el camino
      const to = clearOfSolids(Math.cos(p.timer) * 3.25, Math.sin(p.timer) * 3.25);
      walkTo(p, to.x, to.z, dt, 0.9);
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
      const at = netsSpot();
      return add(g, at.x, heightAt(at.x, at.z), at.z);
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
    // Antigüedad
    coins: () => {
      // Puesto del mercado con monedas sobre la mesa y un toldo azul
      const g = new THREE.Group();
      const table = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1), timberMat);
      table.position.y = 0.85;
      const front = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.08), mat(0x5a3e24));
      front.position.set(0, 0.42, 0.46);
      const awning = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 1.5), mat(0x2c5a8c, { side: THREE.DoubleSide }));
      awning.position.set(0, 2.1, 0.2);
      awning.rotation.x = 0.2;
      g.add(table, front, awning);
      for (const sx of [-1.15, 1.15]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 4), pole);
        post.position.set(sx, 1.05, -0.3);
        g.add(post);
      }
      const gold = mat(0xe8c050, { metalness: 0.7, roughness: 0.35 });
      for (let k = 0; k < 14; k++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 8), k % 4 ? gold : bronzeMat);
        c.position.set(-0.6 + (k % 5) * 0.28 + (k > 9 ? 0.6 : 0), 0.93 + Math.floor(k / 5) * 0.03, -0.2 + Math.floor(k / 5) * 0.12);
        g.add(c);
      }
      add(g, MARKET.x, heightAt(MARKET.x, MARKET.z), MARKET.z);
      g.lookAt(0, g.position.y, 0);
      return g;
    },
    aqueduct: () => {
      // Arcos de piedra que traen el agua desde las colinas hasta una fuente
      const g = new THREE.Group();
      const parts: THREE.BufferGeometry[] = [];
      const a = AQUEDUCT_ANGLE, top = 4.2;
      for (let d = 36; d <= 47.1; d += 2.2) {
        const x = Math.cos(a) * d, z = Math.sin(a) * d, h = top - heightAt(x, z) + heightAt(FOUNTAIN.x, FOUNTAIN.z);
        const pier = new THREE.BoxGeometry(0.7, h, 0.9);
        pier.translate(x, heightAt(x, z) + h / 2, z);
        parts.push(pier);
      }
      const span = new THREE.BoxGeometry(0.9, 0.7, 12);
      span.rotateY(Math.PI / 2 - a);
      const mid = polar(a, 41.5);
      span.translate(mid.x, heightAt(FOUNTAIN.x, FOUNTAIN.z) + top + 0.3, mid.z);
      parts.push(span);
      const arches = new THREE.Mesh(mergeGeometries(parts)!, mat(0xcfc6b2));
      g.add(arches);
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.6, 12), marbleShadeMat);
      basin.position.set(FOUNTAIN.x, heightAt(FOUNTAIN.x, FOUNTAIN.z) + 0.3, FOUNTAIN.z);
      const water = new THREE.Mesh(new THREE.CircleGeometry(1.3, 12), mat(0x4a8ac8, { roughness: 0.15, metalness: 0.2 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(FOUNTAIN.x, heightAt(FOUNTAIN.x, FOUNTAIN.z) + 0.55, FOUNTAIN.z);
      const spout = new THREE.Mesh(new THREE.BoxGeometry(0.3, top - 0.3, 0.3), mat(0xcfc6b2));
      const sp = polar(a, 35.8);
      spout.position.set(sp.x, heightAt(FOUNTAIN.x, FOUNTAIN.z) + (top - 0.3) / 2 + 0.6, sp.z);
      g.add(basin, water, spout);
      return add(g);
    },
    crane: () => {
      // Grúa de madera con polea que levanta un bloque de mármol en la cantera
      const g = new THREE.Group();
      for (const sx of [-0.5, 0.5]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.6, 5), timberMat);
        leg.position.set(sx, 2.2, 0);
        leg.rotation.x = 0.35;
        g.add(leg);
      }
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 4), timberMat);
      boom.rotation.z = Math.PI / 2;
      boom.position.set(0, 4.3, 0.75);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 3), mat(0xc8b48a));
      rope.position.set(0, 3.1, 0.85);
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.6), marbleMat);
      block.position.set(0, 1.7, 0.85);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 4, 12), timberMat);
      wheel.position.set(0, 0.9, -0.9);
      g.add(boom, rope, block, wheel);
      const at = around(MARBLE, -3.4, -2);
      add(g, at.x, heightAt(at.x, at.z), at.z);
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
    for (const a of [-1.1, 1.1, Math.PI]) pane(g, Math.sin(a) * 1.36 * s, 0.72 * s, Math.cos(a) * 1.36 * s, 0.3 * s, 0.28 * s, a);
    g.userData.door = door;
    g.userData.poles = poles;
    g.userData.phase = fx() * 6;
    const gy = groundY(x, z, 1.1 * s);
    add(g, x, gy, z);
    g.lookAt(0, gy, 0);
    return bakeStatic(g);
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


  // ---------- Antigüedad: templo, forja, olivar, mármol, aserradero, broncista y mina de hierro ----------
  // Se construye la primera vez que la tribu entra en la era 4, en el último anillo antes de las colinas.
  const antiqueStatics: THREE.Object3D[] = [];
  let antiqueBuilt = false;
  const tileMat = mat(0xb4532e), marbleShadeMat = mat(0xd9d4c6), cedarMat = mat(0x8a5a3a), oliveTrunkMat = mat(0x6a5a48);
  const oliveLeafMat = mat(0x7a8a5a), stuccoA = mat(0xf0e8d8), stuccoB = mat(0xe2d4bc), pavingMat = mat(0xb9b3a6);
  const ANVILS = [around(FORGE, -1.3, -0.9), around(FORGE, 1.3, -0.9)];
  const IRON_PILE = around(FORGE, 3.1, -1.9);
  const HEARTH = around(FORGE, 0, 1.2);
  const TABLES = [around(WORKSHOP, -1.2, 0), around(WORKSHOP, 1.2, 0)];
  const GOODS_PILE = around(WORKSHOP, -3, -1.7);
  const MARBLE_BLOCKS = [around(MARBLE, -1.8, -0.6), around(MARBLE, -0.6, -0.1), around(MARBLE, 0.6, -0.6), around(MARBLE, 1.8, -0.1)];
  const MARBLE_PILE = around(MARBLE, 0.3, -3.1);
  const SAWHORSES = [around(SAWMILL, -1.6, 0), around(SAWMILL, 0, 0.6), around(SAWMILL, 1.6, 0)];
  const PLANK_PILE = around(SAWMILL, 0.2, -2.7);
  const OLIVES = [-3.3, -1.1, 1.1, 3.3].flatMap((u) => [0.2, 2.6].map((v) => around(OLIVE_GROVE, u + v * 0.2, v)));
  const PRESS = around(OLIVE_GROVE, -1.4, -3.7);
  const AMPHORA_PILE = around(OLIVE_GROVE, 1.7, -3.9);
  const IRON_ORE_HEAP = around(IRON_MOUTH, 2.4, -1.4);
  let ironBars: THREE.Object3D[] = [], ironOreLumps: THREE.Object3D[] = [], marbleStack: THREE.Object3D[] = [];
  let plankStack: THREE.Object3D[] = [], amphoras: THREE.Object3D[] = [], bronzeGoods: THREE.Object3D[] = [];
  let hearthGlow: THREE.MeshBasicMaterial | null = null, forgeLight: THREE.PointLight | null = null;
  let forgeHeat = 0;
  const CHIMNEY = around(FORGE, 1.6, 1.6);

  /** Puesto y montón de cada artesano, con lo que mira mientras trabaja. */
  const CRAFTERS = new Set<BuildingId>(['smelter', 'mason', 'blacksmith', 'bronzesmith', 'marbler', 'sawyer', 'merchant', 'miller', 'ranger', 'bricklayer', 'bellfounder', 'armorer', 'printer', 'vintner', 'shipwright', 'sculptor', 'clockmaker', 'gunsmith', 'banker', 'bookbinder',
    'journalist', 'canner', 'cabinetmaker', 'brickmaker', 'boilermaker', 'puddler', 'stockbroker', 'engineer',
    'electrician', 'excavator', 'agronomist', 'forestEngineer', 'concreter', 'mechanic', 'welder', 'entrepreneur', 'scientist', 'solarTech']);
  function craftSpot(kind: BuildingId, i: number): { stand: { x: number; z: number }; face: { x: number; z: number } } {
    if (kind === 'smelter') return furnaceStand(i);
    const at = (list: { x: number; z: number }[], u: number, v: number) => {
      const c = list[i % list.length], side = Math.floor(i / list.length) % 2 ? 1 : -1;
      return { stand: around(c, u * side, v), face: c };
    };
    if (kind === 'blacksmith') return at(ANVILS, 0.7, -0.75);
    if (kind === 'bronzesmith') return at(TABLES, 0.4, -0.9);
    if (kind === 'marbler') return { stand: around(MARBLE_BLOCKS[i % 4], 0, -0.95), face: MARBLE_BLOCKS[i % 4] };
    if (kind === 'sawyer') return { stand: around(SAWHORSES[i % 3], 0, -0.85), face: SAWHORSES[i % 3] };
    if (kind === 'armorer') return at(ARMOR_ANVILS, 0.7, -0.75);
    if (kind === 'bellfounder') return { stand: around(BELL_MOLDS[i % 3], 0, -0.95), face: BELL_MOLDS[i % 3] };
    if (kind === 'merchant') return { stand: around(STALLS[i % 3], (i >> 2) % 2 ? 0.6 : -0.6, -1.15), face: STALLS[i % 3] };
    if (kind === 'miller') return { stand: around(THRESH[i % 3], 0, -0.6), face: THRESH[i % 3] };
    if (kind === 'ranger') return { stand: around(OAKS[i % 4], 0, -1.05), face: OAKS[i % 4] };
    if (kind === 'bricklayer') return { stand: around(WALL_BLOCKS[i % 4], 0, -0.95), face: WALL_BLOCKS[i % 4] };
    if (kind === 'printer') return at(PRESSES, 0.35, -0.95);
    if (kind === 'vintner') return { stand: around(VINES[(i * 5) % VINES.length], 0, -0.55), face: VINES[(i * 5) % VINES.length] };
    if (kind === 'shipwright') return HULL_SPOTS[i % HULL_SPOTS.length];
    if (kind === 'sculptor') return { stand: around(STATUE_BLOCKS[i % 3], 0, -0.95), face: STATUE_BLOCKS[i % 3] };
    if (kind === 'clockmaker') return { stand: around(CLOCK_BENCHES[i % 2], 0, -0.7), face: CLOCK_BENCHES[i % 2] };
    if (kind === 'gunsmith') return at(GUN_ANVILS, 0.7, -0.75);
    if (kind === 'banker') return { stand: around(COUNTERS[i % 2], 0, 0.7), face: COUNTERS[i % 2] };
    if (kind === 'bookbinder') return { stand: around(BIND_TABLES[i % 2], (i >> 1) % 2 ? 0.35 : -0.35, -0.7), face: BIND_TABLES[i % 2] };
    const near = (list: { x: number; z: number }[], k: number, u: number, v: number) => ({ stand: around(list[k % list.length], u, v), face: list[k % list.length] });
    const side = (i >> 1) % 2 ? 1 : -1;
    if (kind === 'canner') return near(CAN_TABLES, i, side * 0.35, -0.75);
    if (kind === 'cabinetmaker') return near(CAB_BENCHES, i, 0, -0.75);
    if (kind === 'brickmaker') return near(BRICK_TABLES, i, 0, -0.75);
    if (kind === 'boilermaker') return at(BOILERS, 0.5, -1.25);
    if (kind === 'puddler') return near(PUDDLE, i, side * 0.35, -1.5);
    if (kind === 'stockbroker') return at(TICKERS, 0.5, -0.75);
    if (kind === 'journalist') return near(NEWS_DESKS, i, 0, -0.75);
    if (kind === 'engineer') return near(BUNKERS, i, 0, -1.25);
    if (kind === 'electrician') return at(TRANSFORMERS, 0.4, -1.1);
    if (kind === 'excavator') return near(EXCAVATORS, i, 0, -2.2);
    if (kind === 'agronomist') return at(BEDS, 0.5, -0.85);
    if (kind === 'forestEngineer') return near(SAPLINGS8, i * 5, 0, -0.7);
    if (kind === 'concreter') return near(FORMS, i, side * 0.4, -0.95);
    if (kind === 'mechanic') return near(CARS, i, side * 0.7, -1.05);
    if (kind === 'welder') return at(WELD_SPOTS, 0.5, -0.75);
    if (kind === 'entrepreneur') return near(DESKS8, i, 0, -0.75);
    if (kind === 'scientist') return near(BENCHES8, i, side * 0.35, -0.75);
    if (kind === 'solarTech') return near(PANELS, i * 5, 0, -1);
    return { stand: around(ROUGH_BLOCKS[i % 4], 0, -0.95), face: ROUGH_BLOCKS[i % 4] };
  }
  const craftPile = (kind: BuildingId) =>
    ({
      smelter: INGOT_PILE, blacksmith: IRON_PILE, bronzesmith: GOODS_PILE, marbler: MARBLE_PILE, sawyer: PLANK_PILE,
      armorer: ARMOR_PILE, bellfounder: BELL_PILE, merchant: CHESTS, miller: MILL_SACKS, ranger: OAK_LOGS, bricklayer: ASHLAR5_PILE,
      printer: PAPER_PILE, vintner: WINE_PRESS, shipwright: TIMBER_PILE, sculptor: STATUE_PILE, clockmaker: GEAR_PILE, gunsmith: GUN_PILE,
      banker: COIN_PILE, bookbinder: BOOK_PILE,
      canner: CAN_PILE, cabinetmaker: CHAIR_PILE, brickmaker: BRICK_PILE, boilermaker: BOILER_PILE, puddler: IRON7_PILE, stockbroker: CERT_PILE,
      journalist: BUNDLE_PILE, engineer: COAL_STAGE, electrician: CABLE_PILE, excavator: PIT_HEAP, agronomist: CRATE_PILE, forestEngineer: LOG8_PILE,
      concreter: SLAB_PILE, mechanic: TIRE_PILE, welder: BEAM_PILE, entrepreneur: CASE_PILE, scientist: FLASK_PILE, solarTech: PANEL_PILE,
    } as Partial<Record<BuildingId, { x: number; z: number }>>)[kind] ?? ASHLAR_PILE;

  /** Una pieza colocada en el suelo de la escena, girada hacia la aldea, que cae del cielo al construirse. */
  /** Radio de la planta de una pieza aún sin colocar, para apoyarla en la ladera con groundY(). */
  const footBox = new THREE.Box3();
  function footprint(o: THREE.Object3D): number {
    o.updateMatrixWorld(true);
    footBox.setFromObject(o);
    if (footBox.isEmpty()) return 0;
    return Math.max(-footBox.min.x, footBox.max.x, -footBox.min.z, footBox.max.z) * 0.8;
  }
  function place(o: THREE.Object3D, at: { x: number; z: number }, dy = 0, face = true): THREE.Object3D {
    if (face) faceCenter(o, at);
    antiqueStatics.push(spawn(add(o, at.x, groundY(at.x, at.z, footprint(o)) + dy, at.z)));
    return o;
  }
  /** Columna de mármol con basa y capitel, como geometrías para unir en una sola pieza. */
  function columnGeos(x: number, z: number, h: number, r: number): THREE.BufferGeometry[] {
    const shaft = new THREE.CylinderGeometry(r * 0.85, r, h, 8);
    shaft.translate(x, h / 2 + 0.12, z);
    const base = new THREE.BoxGeometry(r * 2.6, 0.24, r * 2.6);
    base.translate(x, 0.12, z);
    const cap = new THREE.BoxGeometry(r * 2.6, 0.22, r * 2.6);
    cap.translate(x, h + 0.23, z);
    return [shaft, base, cap];
  }
  function makeOlive(s: number): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 1.2 * s, 6), oliveTrunkMat);
    trunk.position.y = 0.6 * s;
    trunk.rotation.z = 0.15;
    const blobs = [[0, 1.55, 0, 0.8], [0.55, 1.35, 0.2, 0.6], [-0.5, 1.4, -0.2, 0.62], [0.1, 1.9, -0.3, 0.55]].map(([x, y, z, r]) => {
      const b = new THREE.IcosahedronGeometry(r * s, 0);
      b.scale(1, 0.75, 1);
      b.translate(x * s, y * s, z * s);
      return b;
    });
    g.add(trunk, new THREE.Mesh(mergeGeometries(blobs)!, oliveLeafMat));
    return g;
  }

  function buildAntiquity(): void {
    antiqueBuilt = true;
    // Templo de mármol: gradas, columnas alrededor, frontón y tejado de tejas
    {
      const g = new THREE.Group();
      const W = 6, L = 9, H = 3.2;
      for (let k = 0; k < 3; k++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6 - k * 0.5, 0.3, L + 1.6 - k * 0.5), k % 2 ? marbleShadeMat : marbleMat);
        step.position.y = 0.15 + k * 0.3;
        g.add(step);
      }
      const cols: THREE.BufferGeometry[] = [];
      for (let c = 0; c < 6; c++) for (const z of [-L / 2, L / 2]) cols.push(...columnGeos(-W / 2 + c * (W / 5), z, H, 0.26));
      for (let c = 1; c < 5; c++) for (const x of [-W / 2, W / 2]) cols.push(...columnGeos(x, -L / 2 + c * (L / 5), H, 0.26));
      const colMesh = new THREE.Mesh(mergeGeometries(cols)!, marbleMat);
      colMesh.position.y = 0.9;
      const cella = new THREE.Mesh(new THREE.BoxGeometry(W - 2.2, H, L - 3), marbleShadeMat);
      cella.position.y = 0.9 + H / 2;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.45, L + 0.5), marbleMat);
      beam.position.y = 0.9 + H + 0.55;
      // Frontón: prisma triangular tumbado a lo largo del templo (eje z, el lado largo), con la
      // cumbrera arriba. Ver «Tejados» en la memoria: el giro va en la geometría, no en el objeto.
      const rr = (W + 0.6) / Math.sqrt(3);
      const roofGeo = new THREE.CylinderGeometry(rr, rr, L + 0.7, 3, 1);
      roofGeo.rotateX(Math.PI / 2); // eje a lo largo de z; la arista queda hacia abajo
      roofGeo.rotateZ(Math.PI); // la arista pasa a la cumbrera
      roofGeo.scale(1, 0.42, 1);
      const roof = new THREE.Mesh(roofGeo, tileMat);
      roof.position.y = 0.9 + H + 0.78 + rr * 0.5 * 0.42;
      g.add(colMesh, cella, beam, roof);
      place(g, TEMPLE, -0.1);
    }
    // Calzada de losas desde la aldea hasta el templo
    {
      const slabs: THREE.BufferGeometry[] = [];
      const a = Math.atan2(TEMPLE.z, TEMPLE.x);
      for (let d = 23; d < 36.5; d += 1.05) {
        for (const u of [-0.55, 0.55]) {
          const sl = new THREE.BoxGeometry(1, 0.12, 1);
          const x = Math.cos(a) * d - Math.sin(a) * u, z = Math.sin(a) * d + Math.cos(a) * u;
          sl.rotateY(-a + (((d * 7) % 3) - 1) * 0.04);
          sl.translate(x, heightAt(x, z) + 0.03, z);
          slabs.push(sl);
        }
      }
      const road = new THREE.Mesh(mergeGeometries(slabs)!, pavingMat);
      road.receiveShadow = true;
      scene.add(road);
      antiqueStatics.push(road);
    }
    // Forja: taller de piedra abierto hacia la aldea, con chimenea y hogar encendido
    {
      const g = new THREE.Group();
      const back = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 0.4), stuccoB);
      back.position.set(0, 1.3, 2.4);
      g.add(back);
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.6, 3.2), stuccoB);
        side.position.set(sx * 2.8, 1.3, 1);
        g.add(side);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 3.8), tileMat);
      roof.position.set(0, 2.7, 1);
      roof.rotation.x = -0.14;
      const hearth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.1), mat(0x6e6a72));
      hearth.position.set(0, 0.45, 1.6);
      hearthGlow = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
      const coals = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.7), hearthGlow);
      coals.position.set(0, 0.94, 1.6);
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.4, 0.8), stuccoA);
      chimney.position.set(1.6, 3, 1.9);
      g.add(roof, hearth, coals, chimney);
      place(g, FORGE);
      for (const an of ANVILS) {
        const anvil = new THREE.Group();
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(0x6a4a2c));
        block.position.y = 0.25;
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.22, 0.32), ironMat);
        top.position.y = 0.61;
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 5), ironMat);
        horn.rotation.z = Math.PI / 2;
        horn.position.set(0.55, 0.61, 0);
        anvil.add(block, top, horn);
        place(anvil, an);
      }
      forgeLight = new THREE.PointLight(0xff8a3a, 0, 12, 2);
      forgeLight.position.set(HEARTH.x, heightAt(HEARTH.x, HEARTH.z) + 1.5, HEARTH.z);
      scene.add(forgeLight);
      antiqueStatics.push(forgeLight);
      const pile = new THREE.Group();
      ironBars = Array.from({ length: 15 }, (_, k) => {
        const row = Math.floor(k / 5), col = k % 5;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.9), ironMat);
        bar.position.set((col - 2) * 0.16 + (row % 2) * 0.08, 0.06 + row * 0.11, 0);
        pile.add(bar);
        return bar;
      });
      place(pile, IRON_PILE);
    }
    // Olivar: olivos en hileras, prensa de piedra y ánforas de aceite
    for (const [k, o] of OLIVES.entries()) {
      const tree = makeOlive(0.9 + ((k * 3) % 4) * 0.1);
      tree.rotation.y = k * 1.7;
      antiqueStatics.push(spawn(add(tree, o.x, heightAt(o.x, o.z) - 0.05, o.z)));
      swaying.push({ obj: tree, phase: k, amp: 0.015 });
    }
    {
      const press = new THREE.Group();
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.55, 12), marbleShadeMat);
      basin.position.y = 0.28;
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 10), mat(0x9a948a));
      stone.rotation.z = Math.PI / 2;
      stone.position.set(0, 0.8, 0);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.9, 0.22), timberMat);
      post.position.set(-1.3, 0.95, 0);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18, 0.2), timberMat);
      beam.position.set(0, 1.45, 0);
      beam.rotation.z = -0.12;
      press.add(basin, stone, post, beam);
      pressBeam = beam;
      place(press, PRESS);
      const jars = new THREE.Group();
      const amphoraGeo = new THREE.LatheGeometry(
        [[0.01, 0], [0.08, 0.02], [0.2, 0.25], [0.24, 0.5], [0.16, 0.75], [0.08, 0.85], [0.09, 0.95], [0.01, 0.96]].map(([x, y]) => new THREE.Vector2(x, y)),
        8,
      );
      amphoras = Array.from({ length: 10 }, (_, k) => {
        const j = new THREE.Mesh(amphoraGeo, clayMat);
        j.position.set(((k % 5) - 2) * 0.48 + Math.floor(k / 5) * 0.24, 0, Math.floor(k / 5) * 0.46);
        jars.add(j);
        return j;
      });
      place(jars, AMPHORA_PILE);
    }
    // Cantera de mármol: frentes blancos cortados en gradas y bloques listos
    {
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const terrace = new THREE.Mesh(new THREE.BoxGeometry(7 - k * 1.2, 0.9 + k * 0.9, 1.5), k % 2 ? marbleShadeMat : marbleMat);
        terrace.position.set(0, (0.9 + k * 0.9) / 2, 1.6 + k * 1.3);
        g.add(terrace);
      }
      place(g, MARBLE, -0.1);
      for (const b of MARBLE_BLOCKS) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 0.8), marbleMat);
        block.rotation.y = fx() * 3;
        antiqueStatics.push(spawn(add(block, b.x, heightAt(b.x, b.z) + 0.38, b.z)));
      }
      const pile = new THREE.Group();
      marbleStack = Array.from({ length: 12 }, (_, k) => {
        let row = 0, left = k;
        while (left >= 5 - row) left -= 5 - row++;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.38, 0.44), k % 3 ? marbleMat : marbleShadeMat);
        b.position.set((left - (4 - row) / 2) * 0.65, 0.19 + row * 0.39, 0);
        pile.add(b);
        return b;
      });
      place(pile, MARBLE_PILE);
    }
    // Aserradero: caballetes con su tronco, troncos de cedro y tablones apilados
    {
      for (const h of SAWHORSES) {
        const g = new THREE.Group();
        for (const sx of [-0.7, 0.7]) {
          for (const sz of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 4), timberMat);
            leg.position.set(sx, 0.45, sz * 0.18);
            leg.rotation.x = sz * 0.35;
            g.add(leg);
          }
        }
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.2, 7), cedarMat);
        log.rotation.z = Math.PI / 2;
        log.position.y = 0.95;
        g.add(log);
        place(g, h);
      }
      const logs = new THREE.Group();
      for (let k = 0; k < 7; k++) {
        const row = k < 4 ? 0 : k < 6 ? 1 : 2, col = row === 0 ? k : row === 1 ? k - 4 : 0;
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 2.8, 7), cedarMat);
        l.rotation.z = Math.PI / 2;
        l.position.set(0, 0.24 + row * 0.42, (col - (3 - row) / 2) * 0.5);
        logs.add(l);
      }
      place(logs, around(SAWMILL, 0, 2.5));
      const planks = new THREE.Group();
      plankStack = Array.from({ length: 12 }, (_, k) => {
        const pl = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 0.3), plankMat);
        pl.position.set(0, 0.05 + Math.floor(k / 3) * 0.08, ((k % 3) - 1) * 0.32);
        planks.add(pl);
        return pl;
      });
      place(planks, PLANK_PILE);
    }
    // Taller del broncista: cobertizo de tejas, mesas de trabajo y una estatua en su pedestal
    {
      const g = new THREE.Group();
      for (const [u, v] of [[-3, -1], [3, -1], [-3, 1.8], [3, 1.8]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 2.6, 8), marbleMat);
        post.position.set(u, 1.3, v);
        g.add(post);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.2, 3.6), tileMat);
      roof.position.set(0, 2.7, 0.4);
      roof.rotation.x = 0.12;
      g.add(roof);
      const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.8), marbleMat);
      pedestal.position.set(0, 0.45, 2.6);
      const statue = new THREE.Group();
      statue.position.set(0, 0.9, 2.6);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1, 7), bronzeMat);
      body.position.y = 0.75;
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.5, 6), bronzeMat);
      legs.position.y = 0.25;
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), bronzeMat);
      head.position.y = 1.42;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 5), bronzeMat);
      arm.position.set(0.3, 1.45, 0);
      arm.rotation.z = -0.4;
      const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2, 4), bronzeMat);
      spear.position.set(0.48, 1.4, 0);
      statue.add(body, legs, head, arm, spear);
      g.add(pedestal, statue);
      place(g, WORKSHOP);
      for (const tb of TABLES) {
        const table = new THREE.Group();
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.7), timberMat);
        top.position.y = 0.75;
        const legs2 = new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.5), mat(0x5a3e24));
        legs2.position.y = 0.35;
        const mold = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 10), bronzeMat);
        mold.position.set(0.2, 0.85, 0);
        table.add(top, legs2, mold);
        place(table, tb);
      }
      const goods = new THREE.Group();
      bronzeGoods = Array.from({ length: 8 }, (_, k) => {
        const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 12), bronzeMat);
        shield.rotation.x = Math.PI / 2 - 0.25;
        shield.position.set((k - 3.5) * 0.24, 0.34, 0);
        goods.add(shield);
        return shield;
      });
      place(goods, GOODS_PILE);
    }
    // Mina de hierro: boca con jambas de piedra en la colina y su montón de mineral rojo
    {
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.3, 0.5), mat(0x8e887e));
        jamb.position.set(sx * 0.95, 1.15, 0);
        g.add(jamb);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.45, 0.55), mat(0x8e887e));
      lintel.position.y = 2.4;
      const darkness = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.2), new THREE.MeshBasicMaterial({ color: 0x0b0806 }));
      darkness.position.set(0, 1.1, 0.2);
      g.add(lintel, darkness);
      faceCenter(g, IRON_MOUTH);
      g.rotation.y += Math.PI;
      antiqueStatics.push(spawn(add(g, IRON_MOUTH.x, heightAt(IRON_MOUTH.x, IRON_MOUTH.z) - 0.2, IRON_MOUTH.z)));
      const heap = new THREE.Group();
      ironOreLumps = Array.from({ length: 18 }, (_, k) => {
        const layer = Math.floor(k / 8), a = k * 2.1, rad = (0.75 - layer * 0.3) * (0.35 + ((k * 37) % 10) / 14);
        const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), k % 3 ? ironOreMat : mat(0x5a4a44));
        lump.position.set(Math.cos(a) * rad, 0.12 + layer * 0.17, Math.sin(a) * rad);
        heap.add(lump);
        return lump;
      });
      antiqueStatics.push(spawn(add(heap, IRON_ORE_HEAP.x, heightAt(IRON_ORE_HEAP.x, IRON_ORE_HEAP.z), IRON_ORE_HEAP.z)));
    }
  }

  // ---------- Edad Media: castillo, molino de viento, armería, campanario, feria, obras, guardería y mina de oro ----------
  // Se construye la primera vez que la tribu entra en la era 5, en el anillo que se gana a las antiguas colinas.
  const medievalStatics: THREE.Object3D[] = [];
  let medievalBuilt = false;
  const castleStoneMat = mat(0xb4ac9c), slateMat = mat(0x4a5266), plasterMat = mat(0xefe7d4), beamMat = mat(0x4a3220);
  const crimsonMat = mat(0x9a1e26, { side: THREE.DoubleSide }), royalMat = mat(0x24427a, { side: THREE.DoubleSide });
  const goldMat = mat(0xe8b830, { metalness: 0.6, roughness: 0.35 }), goldOreMat = mat(0xd8a828), oakLeafMat = mat(0x4f7a32);
  const flourMat = mat(0xece4d0), barrelMat = mat(0x8a5a32);
  const THRESH = [around(WINDMILL, -1.6, -2.4), around(WINDMILL, 0.4, -2.9), around(WINDMILL, 2.2, -2.2)];
  const MILL_SACKS = around(WINDMILL, -2.6, 0.2);
  const ARMOR_ANVILS = [around(ARMORY, -1.3, -0.9), around(ARMORY, 1.3, -0.9)];
  const ARMOR_PILE = around(ARMORY, 3.2, -1.6);
  const BELL_MOLDS = [around(BELFRY, -1.8, -1.6), around(BELFRY, 0, -2.4), around(BELFRY, 1.8, -1.6)];
  const BELL_PILE = around(BELFRY, -3.4, 0.4);
  const STALLS = [around(FAIR, -2.6, 0.6), around(FAIR, 0, 1.2), around(FAIR, 2.6, 0.6)];
  const CHESTS = around(FAIR, 0, -2.8);
  const WALL_BLOCKS = [around(WORKS, -2.2, -1.2), around(WORKS, -0.4, -1.6), around(WORKS, 1.4, -1.6), around(WORKS, 3, -1.1)];
  const ASHLAR5_PILE = around(WORKS, -3.6, -2.6);
  const OAKS = [around(LODGE, -2.6, 1.8), around(LODGE, 0.4, 2.8), around(LODGE, 2.8, 1.4), around(LODGE, -1.2, 4.4)];
  const OAK_LOGS = around(LODGE, 2.6, -1.8);
  const GOLD_ORE_HEAP = around(GOLD_MOUTH, 2.4, -1.4);
  const bellGeo = new THREE.LatheGeometry(
    [[0.01, 0], [0.62, 0], [0.56, 0.12], [0.42, 0.45], [0.36, 0.85], [0.3, 1.0], [0.01, 1.08]].map(([x, y]) => new THREE.Vector2(x, y)),
    10,
  );
  let flourSacks: THREE.Object3D[] = [], armorGoods: THREE.Object3D[] = [], bellGoods: THREE.Object3D[] = [], goldChests: THREE.Object3D[] = [];
  let ashlars5: THREE.Object3D[] = [], oakLogs: THREE.Object3D[] = [], goldOreLumps: THREE.Object3D[] = [];
  let millSails: THREE.Object3D | null = null, treadwheel: THREE.Object3D | null = null, bell: THREE.Object3D | null = null;
  let armoryGlow: THREE.MeshBasicMaterial | null = null;
  const banners: THREE.Object3D[] = [];
  let millBoost = 0;

  function placeMedieval(o: THREE.Object3D, at: { x: number; z: number }, dy = 0, face = true): THREE.Object3D {
    if (face) faceCenter(o, at);
    medievalStatics.push(spawn(add(o, at.x, groundY(at.x, at.z, footprint(o)) + dy, at.z)));
    return o;
  }
  /** Caja ya colocada, para unir muchas piezas iguales en una sola malla. */
  const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => {
    const b = new THREE.BoxGeometry(w, h, d);
    if (ry) b.rotateY(ry);
    b.translate(x, y, z);
    return b;
  };
  /** Almenas a lo largo de un muro de `len` que va de (x0, z0) en la dirección del eje x o z. */
  function merlons(parts: THREE.BufferGeometry[], x0: number, z0: number, len: number, alongX: boolean, y: number): void {
    for (let k = 0; k * 0.9 < len; k++) {
      const u = -len / 2 + 0.25 + k * 0.9;
      parts.push(alongX ? boxAt(0.45, 0.5, 0.9, x0 + u, y, z0) : boxAt(0.9, 0.5, 0.45, x0, y, z0 + u));
    }
  }
  /** Prisma de tejado a dos aguas a lo largo del eje z, con la base en y = 0. */
  function gableGeo(width: number, length: number, height: number): THREE.BufferGeometry {
    const rr = width / Math.sqrt(3);
    const g = new THREE.CylinderGeometry(rr, rr, length, 3, 1);
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI);
    g.scale(1, height / (rr * 1.5), 1);
    g.translate(0, height / 3, 0);
    return g;
  }
  function makeBanner(material: THREE.Material, h = 1.6): THREE.Group {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 4), beamMat);
    pole.position.y = h / 2;
    const flag = new THREE.Group();
    flag.position.y = h - 0.35;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.03), material);
    cloth.position.x = 0.45;
    flag.add(cloth);
    g.add(pole, flag);
    banners.push(flag);
    return g;
  }
  function makeOak(s: number): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.32 * s, 1.6 * s, 6), barrelMat);
    trunk.position.y = 0.8 * s;
    const blobs = [[0, 2.2, 0, 1.1], [0.8, 1.9, 0.3, 0.8], [-0.7, 2, -0.3, 0.85], [0.1, 2.7, -0.2, 0.75]].map(([x, y, z, r]) => {
      const b = new THREE.IcosahedronGeometry(r * s, 0);
      b.translate(x * s, y * s, z * s);
      return b;
    });
    g.add(trunk, new THREE.Mesh(mergeGeometries(blobs)!, oakLeafMat));
    return g;
  }

  function buildMedieval(): void {
    medievalBuilt = true;
    // Castillo en lo alto de su colina: muralla con almenas, cuatro torres con chapitel de pizarra,
    // torre del homenaje, puerta con rastrillo hacia la villa y estandartes al viento
    {
      const g = new THREE.Group();
      const stone: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [];
      const S = 11, H = 3;
      stone.push(boxAt(S, H, 0.9, 0, H / 2, -S / 2), boxAt(0.9, H, S, -S / 2, H / 2, 0), boxAt(0.9, H, S, S / 2, H / 2, 0));
      // Muro delantero con el hueco de la puerta (local +z mira a la villa)
      stone.push(boxAt(4.1, H, 0.9, -3.45, H / 2, S / 2), boxAt(4.1, H, 0.9, 3.45, H / 2, S / 2), boxAt(2.8, 1, 0.9, 0, H - 0.5, S / 2));
      merlons(stone, 0, -S / 2, S, true, H + 0.25);
      merlons(stone, -S / 2, 0, S, false, H + 0.25);
      merlons(stone, S / 2, 0, S, false, H + 0.25);
      merlons(stone, 0, S / 2, S, true, H + 0.25);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const t = new THREE.CylinderGeometry(1.35, 1.5, H + 2, 10);
        t.translate((x * S) / 2, (H + 2) / 2, (z * S) / 2);
        stone.push(t);
        const cone = new THREE.ConeGeometry(1.7, 2.6, 10);
        cone.translate((x * S) / 2, H + 2 + 1.3, (z * S) / 2);
        roofs.push(cone);
      }
      // Torre del homenaje al fondo del patio, con su tejado a cuatro aguas
      stone.push(boxAt(4.2, 7, 4.2, 0, 3.5, -1.8));
      merlons(stone, 0, -1.8 - 2.1, 4.2, true, 7.25);
      merlons(stone, 0, -1.8 + 2.1, 4.2, true, 7.25);
      const keepRoof = new THREE.ConeGeometry(1, 1, 4);
      keepRoof.rotateY(Math.PI / 4);
      keepRoof.scale(3.3 / Math.SQRT2 * 1.4, 2.4, 3.3 / Math.SQRT2 * 1.4);
      keepRoof.translate(0, 7 + 1.2, -1.8);
      roofs.push(keepRoof);
      g.add(new THREE.Mesh(mergeGeometries(stone)!, castleStoneMat), new THREE.Mesh(mergeGeometries(roofs)!, slateMat));
      const gate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.9, 0.1), mat(0x1a1410));
      gate.position.set(0, 0.95, S / 2 + 0.3);
      const grid: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 5; k++) grid.push(boxAt(0.07, 1.9, 0.07, -1 + k * 0.5, 0.95, S / 2 + 0.4));
      for (let k = 0; k < 3; k++) grid.push(boxAt(2.4, 0.07, 0.07, 0, 0.4 + k * 0.6, S / 2 + 0.4));
      g.add(gate, new THREE.Mesh(mergeGeometries(grid)!, ironMat));
      const b1 = makeBanner(crimsonMat, 2.2);
      b1.position.set(0, 7.5 + 2.4, -1.8);
      const b2 = makeBanner(royalMat);
      b2.position.set(-S / 2, H + 2 + 2.4, S / 2);
      const b3 = makeBanner(royalMat);
      b3.position.set(S / 2, H + 2 + 2.4, S / 2);
      g.add(b1, b2, b3);
      placeMedieval(g, CASTLE, -0.15);
    }
    // Camino de tierra apisonada desde la villa hasta la puerta del castillo
    {
      const slabs: THREE.BufferGeometry[] = [];
      const a = Math.atan2(CASTLE.z, CASTLE.x);
      for (let d = 37; d < 52.5; d += 1.1) {
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        // Losas gruesas y algo hundidas: en la cuesta de la loma no quedan escalones flotando
        slabs.push(boxAt(1.9, 0.5, 1.15, 0, 0, 0, 0).rotateY(-a).translate(x, groundY(x, z, 0.9) - 0.17, z));
      }
      const road = new THREE.Mesh(mergeGeometries(slabs)!, mat(0x9a8462));
      road.receiveShadow = true;
      scene.add(road);
      medievalStatics.push(road);
    }
    // Molino de viento: torre encalada, caperuza de paja y aspas que giran; era de trillar y sacos de harina
    {
      const g = new THREE.Group();
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.75, 5, 8), plasterMat);
      tower.position.y = 2.5;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.7, 8), thatchC);
      cap.position.y = 5.85;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.1), beamMat);
      door.position.set(0, 0.65, 1.7);
      const sails = new THREE.Group();
      sails.position.set(0, 4.7, 1.5);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 6), beamMat);
      hub.rotation.x = Math.PI / 2;
      sails.add(hub);
      for (let k = 0; k < 4; k++) {
        const arm = new THREE.Group();
        arm.rotation.z = (k * Math.PI) / 2;
        const spar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4.2, 0.08), beamMat);
        spar.position.y = 2.1;
        const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.75, 3, 0.03), mat(0xe8dcc0, { side: THREE.DoubleSide }));
        cloth.position.set(0.42, 2.5, 0);
        arm.add(spar, cloth);
        sails.add(arm);
      }
      millSails = sails;
      g.add(tower, cap, door, sails);
      placeMedieval(g, WINDMILL);
      // Era de trillar empedrada y gavillas
      const floor = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.12, 14), mat(0xb8a882));
      placeMedieval(floor, around(WINDMILL, 0.4, -2.6), 0.02);
      const sacks = new THREE.Group();
      flourSacks = Array.from({ length: 10 }, (_, k) => {
        const sk = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), flourMat);
        sk.scale.set(1, 1.25, 0.85);
        sk.position.set(((k % 4) - 1.5) * 0.5, 0.33 + Math.floor(k / 4) * 0.55, (Math.floor(k / 4) % 2) * 0.2);
        sacks.add(sk);
        return sk;
      });
      placeMedieval(sacks, MILL_SACKS);
    }
    // Armería: taller con entramado de madera, fragua encendida, yunques y armaduras colgadas
    {
      const g = new THREE.Group();
      const back = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 0.35), plasterMat);
      back.position.set(0, 1.3, 2.4);
      const beams: THREE.BufferGeometry[] = [boxAt(6.1, 0.18, 0.4, 0, 2.5, 2.4), boxAt(6.1, 0.18, 0.4, 0, 1.3, 2.4)];
      for (const x of [-2.9, -1, 1, 2.9]) beams.push(boxAt(0.2, 2.6, 0.4, x, 1.3, 2.4));
      for (const sx of [-1, 1]) beams.push(boxAt(0.25, 2.6, 0.25, sx * 2.9, 1.3, -0.2));
      g.add(back, new THREE.Mesh(mergeGeometries(beams)!, beamMat));
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.2, 3.6), slateMat);
      roof.position.set(0, 2.75, 1.1);
      roof.rotation.x = -0.14;
      const hearth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.1), mat(0x6e6a72));
      hearth.position.set(0, 0.45, 1.6);
      armoryGlow = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
      const coals = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.7), armoryGlow);
      coals.position.set(0, 0.94, 1.6);
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.4, 0.8), castleStoneMat);
      chimney.position.set(-1.6, 3, 1.9);
      g.add(roof, hearth, coals, chimney);
      // El lado abierto mira a la villa (faceCenter deja el +z local hacia el centro)
      faceCenter(g, ARMORY);
      g.rotation.y += Math.PI;
      placeMedieval(g, ARMORY, 0, false);
      for (const an of ARMOR_ANVILS) {
        const anvil = new THREE.Group();
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(0x6a4a2c));
        block.position.y = 0.25;
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.22, 0.32), ironMat);
        top.position.y = 0.61;
        anvil.add(block, top);
        placeMedieval(anvil, an);
      }
      // Soporte con yelmos y escudos terminados
      const rack = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), beamMat);
      bar.position.y = 1.2;
      rack.add(bar);
      for (const sx of [-1.25, 1.25]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), beamMat);
        leg.position.set(sx, 0.65, 0);
        rack.add(leg);
      }
      armorGoods = Array.from({ length: 8 }, (_, k) => {
        const piece = k % 2
          ? new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 3), k % 4 === 1 ? crimsonMat : royalMat)
          : new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), ironMat);
        if (k % 2) {
          piece.rotation.set(Math.PI / 2, 0, Math.PI);
          piece.position.set(-1.05 + (k >> 1) * 0.7, 0.85, 0.1);
        } else piece.position.set(-1.05 + (k >> 1) * 0.7, 1.26, 0);
        rack.add(piece);
        return piece;
      });
      placeMedieval(rack, ARMOR_PILE);
    }
    // Campanario de piedra con su campana, foso de fundir y campanas terminadas en un armazón
    {
      const g = new THREE.Group();
      const parts: THREE.BufferGeometry[] = [boxAt(2.6, 6, 2.6, 0, 3, 2)];
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(boxAt(0.45, 2, 0.45, x * 1.08, 7, 2 + z * 1.08));
      parts.push(boxAt(2.8, 0.3, 2.8, 0, 8.1, 2));
      g.add(new THREE.Mesh(mergeGeometries(parts)!, castleStoneMat));
      const spire = new THREE.ConeGeometry(1, 1, 4);
      spire.rotateY(Math.PI / 4);
      const roof = new THREE.Mesh(spire, slateMat);
      roof.scale.set(2.2, 2.6, 2.2);
      roof.position.set(0, 9.55, 2);
      const b = new THREE.Group();
      b.position.set(0, 7.8, 2);
      const bellMesh = new THREE.Mesh(bellGeo, bronzeMat);
      bellMesh.position.y = -0.95;
      b.add(bellMesh);
      bell = b;
      g.add(roof, b);
      placeMedieval(g, BELFRY);
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.1, 14), mat(0x3a2e26));
      placeMedieval(pit, around(BELFRY, 0, -1.8), 0.02);
      for (const m of BELL_MOLDS) {
        const mold = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 10), clayMat);
        mold.position.y = 0.55;
        const grp = new THREE.Group();
        grp.add(mold);
        placeMedieval(grp, m);
      }
      const frame = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 0.15), beamMat);
      top.position.y = 1.6;
      frame.add(top);
      for (const sx of [-1.4, 1.4]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.15), beamMat);
        leg.position.set(sx, 0.8, 0);
        frame.add(leg);
      }
      bellGoods = Array.from({ length: 6 }, (_, k) => {
        const bg = new THREE.Mesh(bellGeo, bronzeMat);
        bg.scale.setScalar(0.4 + (k % 3) * 0.08);
        bg.position.set(-1.1 + k * 0.44, 1.52 - bg.scale.y * 1.1, 0);
        frame.add(bg);
        return bg;
      });
      placeMedieval(frame, BELL_PILE);
    }
    // Feria: puestos con toldos a rayas, toneles, cajas y los cofres del oro de los mercaderes
    {
      STALLS.forEach((st, k) => {
        const g = new THREE.Group();
        const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.8), barrelMat);
        counter.position.y = 0.45;
        g.add(counter);
        for (const [x, z] of [[-1.05, -0.35], [1.05, -0.35], [-1.05, 0.9], [1.05, 0.9]]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 0.1), beamMat);
          post.position.set(x, 1.1, z);
          g.add(post);
        }
        const stripes = [crimsonMat, plasterMat, k === 1 ? royalMat : crimsonMat, plasterMat, k === 1 ? royalMat : crimsonMat];
        stripes.forEach((m, j) => {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.06, 1.7), m);
          strip.position.set(-0.94 + j * 0.47, 2.25, 0.25);
          strip.rotation.x = -0.25;
          g.add(strip);
        });
        const goods = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.5), [goldMat, oakLeafMat, clayMat][k]);
        goods.position.y = 0.99;
        g.add(goods);
        placeMedieval(g, st);
      });
      for (let k = 0; k < 4; k++) {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.8, 8), barrelMat);
        barrel.position.y = 0.4;
        const grp = new THREE.Group();
        grp.add(barrel);
        placeMedieval(grp, around(FAIR, -4.2 + (k % 2) * 0.75, -0.6 + (k >> 1) * 0.75), 0, false);
      }
      const chests = new THREE.Group();
      goldChests = Array.from({ length: 8 }, (_, k) => {
        const c = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.42), barrelMat);
        box.position.y = 0.2;
        const coins = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.34), goldMat);
        coins.position.y = 0.42;
        c.add(box, coins);
        c.position.set(((k % 4) - 1.5) * 0.66, Math.floor(k / 4) * 0.42, 0);
        chests.add(c);
        return c;
      });
      placeMedieval(chests, CHESTS);
    }
    // Obras de la muralla: un tramo a medio alzar con andamios y una grúa de rueda
    {
      const g = new THREE.Group();
      const parts: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 6; k++) parts.push(boxAt(1.5, 1.2 + (k < 3 ? k * 0.7 : (5 - k) * 0.5), 0.9, -3.75 + k * 1.5, (1.2 + (k < 3 ? k * 0.7 : (5 - k) * 0.5)) / 2, 1.4));
      g.add(new THREE.Mesh(mergeGeometries(parts)!, castleStoneMat));
      const scaff: THREE.BufferGeometry[] = [];
      for (const x of [-3.6, -1.2, 1.2, 3.6]) for (const z of [0.6, 2.2]) scaff.push(boxAt(0.08, 3.4, 0.08, x, 1.7, z));
      scaff.push(boxAt(7.4, 0.08, 0.08, 0, 1.6, 0.6), boxAt(7.4, 0.08, 0.08, 0, 3.2, 0.6), boxAt(7.4, 0.08, 0.6, 0, 3.2, 1.4));
      g.add(new THREE.Mesh(mergeGeometries(scaff)!, timberMat));
      // Grúa de rueda: dos hombres dentro la harían girar; aquí gira sola mientras haya albañiles
      const wheel = new THREE.Group();
      wheel.position.set(5, 1.6, 1.2);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.09, 4, 14), timberMat);
      wheel.add(rim);
      for (let k = 0; k < 4; k++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.7, 0.08), timberMat);
        spoke.rotation.z = (k * Math.PI) / 4;
        wheel.add(spoke);
      }
      wheel.rotation.y = Math.PI / 2;
      treadwheel = wheel;
      const jib = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.6, 0.14), timberMat);
      jib.position.set(5, 3, 1.2);
      jib.rotation.z = 0.35;
      g.add(wheel, jib);
      placeMedieval(g, WORKS);
      for (const b of WALL_BLOCKS) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), castleStoneMat);
        block.rotation.y = fx() * 3;
        medievalStatics.push(spawn(add(block, b.x, heightAt(b.x, b.z) + 0.28, b.z)));
      }
      const pile = new THREE.Group();
      ashlars5 = Array.from({ length: 12 }, (_, k) => {
        let row = 0, left = k;
        while (left >= 5 - row) left -= 5 - row++;
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.38, 0.44), castleStoneMat);
        bl.position.set((left - (4 - row) / 2) * 0.65, 0.19 + row * 0.39, 0);
        pile.add(bl);
        return bl;
      });
      placeMedieval(pile, ASHLAR5_PILE);
    }
    // Casa del guardabosques: cabaña de troncos entre robles, con la leña apilada
    {
      const g = new THREE.Group();
      const logs: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 6; k++) {
        for (const z of [-1.1, 1.1]) logs.push(new THREE.CylinderGeometry(0.2, 0.2, 3.6, 6).rotateZ(Math.PI / 2).translate(0, 0.2 + k * 0.36, z));
        for (const x of [-1.6, 1.6]) logs.push(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 6).rotateX(Math.PI / 2).translate(x, 0.38 + k * 0.36, 0));
      }
      g.add(new THREE.Mesh(mergeGeometries(logs)!, barrelMat));
      const roof = new THREE.Mesh(gableGeo(3, 4, 1.4).rotateY(Math.PI / 2), thatchC);
      roof.scale.set(1.05, 1, 1.25);
      roof.position.y = 2.3;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.1), beamMat);
      door.position.set(0, 0.7, 1.32);
      g.add(roof, door);
      placeMedieval(g, LODGE);
      OAKS.forEach((o, k) => {
        const tree = makeOak(0.95 + (k % 2) * 0.2);
        tree.rotation.y = k * 1.3;
        medievalStatics.push(spawn(add(tree, o.x, heightAt(o.x, o.z) - 0.05, o.z)));
        swaying.push({ obj: tree, phase: k * 2, amp: 0.012 });
      });
      const pile = new THREE.Group();
      oakLogs = Array.from({ length: 10 }, (_, k) => {
        const row = k < 4 ? 0 : k < 7 ? 1 : k < 9 ? 2 : 3, col = [k, k - 4, k - 7, 0][row];
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.6, 6), barrelMat);
        l.rotation.x = Math.PI / 2;
        l.position.set((col - (3 - row) / 2) * 0.42, 0.2 + row * 0.36, 0);
        pile.add(l);
        return l;
      });
      placeMedieval(pile, OAK_LOGS);
    }
    // Mina de oro: boca entibada en la colina, con su montón de mineral dorado
    {
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.3, 0.35), timberMat);
        jamb.position.set(sx * 0.95, 1.15, 0);
        g.add(jamb);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.35, 0.45), timberMat);
      lintel.position.y = 2.4;
      const darkness = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), new THREE.MeshBasicMaterial({ color: 0x0b0806 }));
      darkness.position.set(0, 1.1, 0.2);
      g.add(lintel, darkness);
      faceCenter(g, GOLD_MOUTH);
      g.rotation.y += Math.PI;
      medievalStatics.push(spawn(add(g, GOLD_MOUTH.x, heightAt(GOLD_MOUTH.x, GOLD_MOUTH.z) - 0.2, GOLD_MOUTH.z)));
      const heap = new THREE.Group();
      goldOreLumps = Array.from({ length: 18 }, (_, k) => {
        const layer = Math.floor(k / 8), a = k * 2.1, rad = (0.75 - layer * 0.3) * (0.35 + ((k * 37) % 10) / 14);
        const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), k % 3 ? goldOreMat : mat(0x6a5a44));
        lump.position.set(Math.cos(a) * rad, 0.12 + layer * 0.17, Math.sin(a) * rad);
        heap.add(lump);
        return lump;
      });
      medievalStatics.push(spawn(add(heap, GOLD_ORE_HEAP.x, heightAt(GOLD_ORE_HEAP.x, GOLD_ORE_HEAP.z), GOLD_ORE_HEAP.z)));
    }
  }

  // Mejoras de la Edad Media que se ven en la villa
  // Catedral: nave larga hacia la villa, dos torres con aguja, rosetón y arbotantes
  upgradeProps.cathedral = () => {
    const g = new THREE.Group();
    const stone: THREE.BufferGeometry[] = [boxAt(5, 5.5, 11, 0, 2.75, 0)];
    for (const sx of [-1, 1]) {
      stone.push(boxAt(2.2, 10, 2.2, sx * 1.6, 5, 5.6));
      for (let k = 0; k < 4; k++) stone.push(boxAt(0.5, 4, 0.8, sx * 3.1, 2, -3.6 + k * 2.4), boxAt(1.4, 0.35, 0.5, sx * 2.8, 4.6, -3.6 + k * 2.4));
    }
    const roofs: THREE.BufferGeometry[] = [gableGeo(5.6, 11.4, 3).translate(0, 5.5, 0)];
    for (const sx of [-1, 1]) {
      const spire = new THREE.ConeGeometry(1, 1, 4);
      spire.rotateY(Math.PI / 4);
      spire.scale(1.65, 4.2, 1.65);
      spire.translate(sx * 1.6, 10 + 2.1, 5.6);
      roofs.push(spire);
    }
    const rose = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12), mat(0x3a5aa8, { roughness: 0.3, metalness: 0.3 }));
    rose.position.set(0, 4.2, 5.52);
    const portal = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 0.1), mat(0x2a1e16));
    portal.position.set(0, 1.2, 5.52);
    g.add(new THREE.Mesh(mergeGeometries(stone)!, castleStoneMat), new THREE.Mesh(mergeGeometries(roofs)!, slateMat), rose, portal);
    faceCenter(g, CATHEDRAL);
    return add(g, CATHEDRAL.x, heightAt(CATHEDRAL.x, CATHEDRAL.z) - 0.1, CATHEDRAL.z);
  };
  // Ferias de comercio: guirnaldas de banderines de colores sobre la feria
  upgradeProps.fairs = () => {
    const g = new THREE.Group();
    const posts = [around(FAIR, -4.2, 2.6), around(FAIR, 4.2, 2.6), around(FAIR, 0, -4.6)];
    const flags: THREE.BufferGeometry[] = [], poles: THREE.BufferGeometry[] = [];
    const colors = [0x9a1e26, 0x24427a, 0xe8b830, 0x2f6a32];
    posts.forEach((p, k) => {
      poles.push(new THREE.CylinderGeometry(0.06, 0.07, 3.6, 5).translate(p.x, heightAt(p.x, p.z) + 1.8, p.z));
      const q = posts[(k + 1) % posts.length];
      const n = 9;
      for (let j = 1; j < n; j++) {
        const f = j / n, x = p.x + (q.x - p.x) * f, z = p.z + (q.z - p.z) * f;
        const y = THREE.MathUtils.lerp(heightAt(p.x, p.z), heightAt(q.x, q.z), f) + 3.4 - Math.sin(f * Math.PI) * 0.7;
        const tri = new THREE.ConeGeometry(0.2, 0.42, 3);
        tri.rotateX(Math.PI);
        tri.rotateY(Math.atan2(q.x - p.x, q.z - p.z));
        tri.translate(x, y - 0.21, z);
        const c = new THREE.Color(colors[(j + k) % colors.length]);
        tri.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: tri.attributes.position.count }, () => [c.r, c.g, c.b]).flat(), 3));
        flags.push(tri.toNonIndexed());
      }
    });
    g.add(new THREE.Mesh(mergeGeometries(poles)!, beamMat), new THREE.Mesh(mergeGeometries(flags.map((f) => { f.deleteAttribute('uv'); return f; }))!, outfitMat));
    return add(g);
  };

  // Casas de la Edad Media: entramado de madera oscura sobre muros encalados y tejado empinado
  function makeTimberHouse(x: number, z: number, s: number, tone: number) {
    const g = new THREE.Group();
    const w = 2.4 * s, d = 1.8 * s, h = 1.7 * s;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plasterMat);
    wall.position.y = h / 2;
    const beams: THREE.BufferGeometry[] = [];
    const t = 0.1 * s;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) beams.push(boxAt(t, h, t, (sx * w) / 2, h / 2, (sz * d) / 2));
    for (const sz of [-1, 1]) {
      beams.push(boxAt(w + t, t, t, 0, h * 0.5, (sz * d) / 2 + (sz * t) / 2), boxAt(w + t, t, t, 0, h - t / 2, (sz * d) / 2 + (sz * t) / 2));
      // Riostras en cruz a cada lado de la puerta
      for (const sx of [-1, 1]) {
        const br = new THREE.BoxGeometry(t, h * 0.62, t);
        br.rotateZ(sx * 0.6);
        br.translate((sx * w) / 3.2, h * 0.27, (sz * d) / 2 + (sz * t) / 2);
        beams.push(br);
      }
    }
    for (const sx of [-1, 1]) beams.push(boxAt(t, t, d + t, (sx * w) / 2 + (sx * t) / 2, h * 0.5, 0));
    g.add(wall, new THREE.Mesh(mergeGeometries(beams)!, beamMat));
    // Tejado a dos aguas a lo largo de la casa (eje x), con la cumbrera arriba
    const roof = new THREE.Mesh(gableGeo(d + 0.5 * s, w + 0.4 * s, 1.5 * s).rotateY(Math.PI / 2), tone ? slateMat : thatchC);
    roof.position.y = h;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.35 * s, 1.3 * s, 0.35 * s), castleStoneMat);
    chimney.position.set(w * 0.3, h + 0.9 * s, -d * 0.15);
    g.add(roof, chimney);
    const poles = new THREE.Group(); // humo de la chimenea
    poles.position.set(w * 0.3, h + 1.6 * s, -d * 0.15);
    g.add(poles);
    const door = new THREE.Group();
    door.position.set(0, 0.95 * s, d / 2 + 0.06 * s);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.6 * s, 0.95 * s), mat(0x5a3a22, { side: THREE.DoubleSide }));
    leaf.position.y = -0.47 * s;
    door.add(leaf);
    g.add(door);
    for (const sx of [-1, 1]) {
      pane(g, sx * w * 0.3, h * 0.76, d / 2 + 0.08 * s, 0.34 * s, 0.32 * s);
      pane(g, sx * w * 0.25, h * 0.7, -d / 2 - 0.08 * s, 0.34 * s, 0.32 * s);
    }
    g.userData.door = door;
    g.userData.poles = poles;
    g.userData.phase = fx() * 6;
    const gy = groundY(x, z, 1.1 * s);
    add(g, x, gy, z);
    g.lookAt(0, gy, 0);
    return bakeStatic(g);
  }

  // Villas de la Antigüedad: muros encalados y tejado de tejas rojas a cuatro aguas
  function makeVilla(x: number, z: number, s: number, tone: number) {
    const g = new THREE.Group();
    const w = 2.4 * s, d = 1.9 * s, h = 1.3 * s;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), tone ? stuccoB : stuccoA);
    wall.position.y = h / 2;
    // Cuatro aguas: la pirámide se gira 45° en la geometría y luego se estira, así sus aristas
    // quedan sobre las esquinas de la casa (con el giro en el objeto quedaba en rombo).
    const roofGeo = new THREE.ConeGeometry(1, 1, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, tileMat);
    roof.scale.set((w + 0.4 * s) / Math.SQRT2, 0.75 * s, (d + 0.4 * s) / Math.SQRT2);
    roof.position.y = h + 0.375 * s;
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.2 * s, d + 0.16), marbleShadeMat);
    base.position.y = 0.1 * s;
    g.add(wall, roof, base);
    // Dos columnas en la entrada
    for (const sx of [-0.45, 0.45]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.09 * s, h, 6), marbleMat);
      c.position.set(sx * s, h / 2, d / 2 + 0.3 * s);
      g.add(c);
    }
    const porch = new THREE.Mesh(new THREE.BoxGeometry(1.3 * s, 0.1 * s, 0.5 * s), tileMat);
    porch.position.set(0, h, d / 2 + 0.25 * s);
    g.add(porch);
    const poles = new THREE.Group(); // un toldo que se mece con el viento
    poles.position.set(w / 2 - 0.2 * s, h + 0.1, 0);
    g.add(poles);
    const door = new THREE.Group();
    door.position.set(0, 0.95 * s, d / 2 + 0.02);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.55 * s, 0.9 * s), mat(tone ? 0x2c5a8c : 0x8a3a5a, { side: THREE.DoubleSide }));
    curtain.position.y = -0.45 * s;
    door.add(curtain);
    g.add(door);
    for (const sx of [-1, 1]) {
      pane(g, sx * w * 0.34, h * 0.58, d / 2 + 0.02, 0.28 * s, 0.34 * s);
      pane(g, sx * (w / 2 + 0.02), h * 0.58, 0, 0.3 * s, 0.34 * s, Math.PI / 2);
    }
    g.userData.door = door;
    g.userData.poles = poles;
    g.userData.phase = fx() * 6;
    const gy = groundY(x, z, 1.1 * s);
    add(g, x, gy, z);
    g.lookAt(0, gy, 0);
    return bakeStatic(g);
  }

  /** Olivarero: va a un olivo, varea y recoge las aceitunas, y las lleva a la prensa. */
  function updateOliveGrower(p: Person, dt: number, t: number): void {
    const r = p.rig, tree = OLIVES[(p.target ?? 0) % OLIVES.length];
    const under = around(tree, (p.i % 2 ? 0.5 : -0.5), -0.9);
    const atPress = around(PRESS, (p.i - 1.5) * 0.5, -1.2);
    if (p.state === 'toTree' || p.state === 'toPress') {
      const target = p.state === 'toTree' ? under : atPress;
      r.armL.rotation.x = -Math.sin(p.walk) * 0.5;
      r.armR.rotation.x = Math.sin(p.walk) * 0.5;
      if (walkTo(p, target.x, target.z, dt, 1)) {
        p.state = p.state === 'toTree' ? 'pick' : 'drop';
        p.timer = p.state === 'pick' ? 3 + fx() * 3 : 0.8;
      }
      return;
    }
    standPose(p, dt);
    p.timer -= dt;
    if (p.state === 'pick') {
      // Brazos arriba entre las ramas; caen hojas y aceitunas
      faceTo(p, tree.x, tree.z, dt);
      const reach = Math.sin(t * 3 + p.phase);
      r.torso.rotation.x = ease(r.torso.rotation.x, -0.15, dt);
      r.armR.rotation.x = -2.5 + reach * 0.3;
      r.armL.rotation.x = -2.3 - reach * 0.3;
      if (fx() < dt * 2) emit(fx() < 0.5 ? oliveLeafMat : oliveMat, tree.x, heightAt(tree.x, tree.z) + 1.6, tree.z, 1, 0.5, 0.05, 0.3);
      if (p.timer <= 0) {
        if (r.carry) r.carry.visible = true;
        p.state = 'toPress';
      }
      return;
    }
    faceTo(p, PRESS.x, PRESS.z, dt);
    r.torso.rotation.x = ease(r.torso.rotation.x, 0.6, dt);
    if (p.timer <= 0) {
      if (r.carry?.visible) {
        r.carry.visible = false;
        emit(oliveMat, PRESS.x, heightAt(PRESS.x, PRESS.z) + 0.9, PRESS.z, 4, 0.6, 0.05, 0.6);
        pressPush = 1;
      }
      p.target = ((p.target ?? 0) + 3) % OLIVES.length;
      p.state = 'toTree';
    }
  }
  let pressPush = 0, pressBeam: THREE.Object3D | null = null;
  const marbleChipMat = mat(0xf4f1ea);

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
    for (const sx of [-1, 1]) {
      pane(g, sx * w * 0.32, h * 0.62, d / 2 + 0.02, 0.32 * s, 0.3 * s);
      pane(g, sx * w * 0.25, h * 0.62, -d / 2 - 0.02, 0.32 * s, 0.3 * s);
    }
    g.userData.door = door;
    g.userData.poles = poles;
    g.userData.phase = fx() * 6;
    const gy = groundY(x, z, 1.1 * s);
    add(g, x, gy, z);
    g.lookAt(0, gy, 0);
    return bakeStatic(g);
  }

  // ---------- Rutinas de los oficios de la Edad del Bronce ----------
  const furnaceStand = (i: number) => {
    const f = FURNACES[i % FURNACES.length], side = Math.floor(i / FURNACES.length) ? 1 : -1;
    return { stand: around(f, side * 0.95, -1.15), face: f };
  };
  const furnaceHeat = [0, 0];

  /** Oficios de mesa de las dos últimas eras: enlatar, escribir, ensayar, conectar, firmar, manejar. */
  const DESK_WORK = new Set<BuildingId>(['canner', 'journalist', 'scientist', 'electrician', 'entrepreneur', 'excavator']);
  /** Trabajo en un puesto y, al terminar, llevar la pieza a su montón. Lo usan fundidor, picapedrero,
   *  herrero, broncista, marmolista y aserrador. */
  function updateCrafter(p: Person, dt: number, t: number): void {
    const r = p.rig, smelter = p.kind === 'smelter';
    const spot = craftSpot(p.kind, p.i), pile = craftPile(p.kind);
    if (p.state === 'toWork' || p.state === 'toPile') {
      const target = p.state === 'toWork' ? spot.stand : pile;
      r.armR.rotation.z = 0.12;
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
    } else if (p.kind === 'sawyer' || p.kind === 'cabinetmaker') {
      // Sierra adelante y atrás sobre el tronco del caballete; caen virutas
      const saw = Math.sin(t * 5 + p.phase);
      r.torso.rotation.x = 0.45 + saw * 0.05;
      r.armR.rotation.x = -1.2 + saw * 0.35;
      r.armL.rotation.x = -0.9;
      if (fx() < dt * 5) {
        const b = spot.face;
        emit(chipMat, b.x, heightAt(b.x, b.z) + 0.75, b.z, 1, 0.5, 0.04, 0.4);
      }
    } else if (p.kind === 'printer') {
      // Tira de la barra de la prensa con todo el cuerpo y la suelta
      const pull = Math.max(0, Math.sin(t * 1.8 + p.phase));
      r.torso.rotation.x = 0.1 - pull * 0.25;
      r.armR.rotation.x = -1.5 + pull * 0.5;
      r.armL.rotation.x = -1.2 + pull * 0.3;
    } else if (p.kind === 'vintner' || p.kind === 'agronomist' || p.kind === 'forestEngineer' || p.kind === 'solarTech') {
      // Vendimia: agachado ante la cepa, corta racimos y los echa al cesto. Igual se agachan el
      // agrónomo ante las tomateras, el ingeniero forestal ante los plantones y el técnico solar.
      const cut = Math.sin(t * 2.2 + p.phase);
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.55, dt);
      r.armR.rotation.x = -1.3 + cut * 0.25;
      r.armL.rotation.x = -1.1 - cut * 0.2;
      const bit = p.kind === 'vintner' ? grapeMat : p.kind === 'agronomist' ? tomatoMat : p.kind === 'forestEngineer' ? leafMat8 : null;
      if (bit && fx() < dt * 0.8) {
        const v = spot.face;
        emit(bit, v.x, heightAt(v.x, v.z) + 0.6, v.z, 1, 0.4, 0.06, 0.3);
      }
    } else if (p.kind === 'banker' || p.kind === 'clockmaker' || p.kind === 'bookbinder' || DESK_WORK.has(p.kind)) {
      // Trabajo de mesa: cuenta monedas, lima ruedas o cose pliegos con gestos cortos
      const k = Math.sin(t * (p.kind === 'banker' ? 3.2 : 4.5) + p.phase);
      r.torso.rotation.x = ease(r.torso.rotation.x, p.kind === 'banker' ? 0.2 : 0.4, dt);
      r.armR.rotation.x = -1.1 + k * 0.15;
      r.armL.rotation.x = -1.0 - k * 0.1;
      r.armR.rotation.z = 0.12 + Math.max(0, k) * 0.2;
    } else if (p.kind === 'merchant' || p.kind === 'stockbroker') {
      // Regatea tras el puesto: señala la mercancía y abre los brazos
      const talk = Math.sin(t * 2.4 + p.phase);
      r.torso.rotation.x = 0.05;
      r.armR.rotation.x = -0.9 - Math.max(0, talk) * 0.6;
      r.armR.rotation.z = 0.12 + Math.max(0, -talk) * 0.5;
      r.armL.rotation.x = -0.4 + Math.min(0, talk) * 0.4;
    } else {
      // Cincel o tenazas en una mano, martillo en la otra: golpes cortos y rápidos.
      // El molinero trilla con el mayal y el guardabosques corta leña con el hacha.
      const metal = p.kind === 'blacksmith' || p.kind === 'bronzesmith' || p.kind === 'armorer' || p.kind === 'bellfounder' || p.kind === 'gunsmith' || p.kind === 'boilermaker' || p.kind === 'puddler' || p.kind === 'mechanic' || p.kind === 'welder';
      const ph = (t * (metal ? 2.2 : 2.6) + p.phase) % 1, raise = ph < 0.6 ? ph / 0.6 : (1 - ph) / 0.4;
      r.torso.rotation.x = 0.55;
      r.armL.rotation.x = -1.2;
      r.armR.rotation.x = -0.8 - raise * 1.3;
      if (ph < 0.08 && fx() < 0.5) {
        const b = spot.face;
        if (metal) emit(p.kind === 'welder' ? weldMat : sparkMat, b.x, heightAt(b.x, b.z) + 0.85, b.z, 3, 1.3, 0.035, 1.2, false);
        else if (p.kind === 'engineer') emit(coalMat, b.x, heightAt(b.x, b.z) + 0.6, b.z, 2, 0.8, 0.05, 0.6);
        else if (p.kind === 'brickmaker') emit(brickChipMat, b.x, heightAt(b.x, b.z) + 0.9, b.z, 2, 0.7, 0.04, 0.5);
        else if (p.kind === 'miller') emit(chaffMat, b.x, heightAt(b.x, b.z) + 0.3, b.z, 3, 0.8, 0.04, 0.6);
        else if (p.kind === 'ranger' || p.kind === 'shipwright') emit(chipMat, b.x, heightAt(b.x, b.z) + 1, b.z, 2, 0.9, 0.05);
        else emit(p.kind === 'marbler' || p.kind === 'sculptor' ? marbleChipMat : stoneChipMat, b.x, heightAt(b.x, b.z) + 0.8, b.z, 2, 0.9, 0.05);
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

  /** Boca, montón y mineral de cada mina: cobre en la Edad del Bronce, hierro en la Antigüedad. */
  const mineOf = (kind: BuildingId) =>
    kind === 'coalMiner' ? { mouth: COAL_MOUTH, heap: COAL_TIP, ore: coalMat }
    : kind === 'goldMiner' ? { mouth: GOLD_MOUTH, heap: GOLD_ORE_HEAP, ore: goldOreMat }
    : kind === 'ironMiner' ? { mouth: IRON_MOUTH, heap: IRON_ORE_HEAP, ore: ironOreMat } : { mouth: COPPER_MOUTH, heap: ORE_HEAP, ore: oreMat };
  function updateCopperMiner(p: Person, dt: number, t: number): void {
    const r = p.rig;
    const { mouth: MOUTH, heap: HEAP, ore } = mineOf(p.kind);
    const { rx, rz } = radial(MOUTH);
    const inside = { x: MOUTH.x + rx * 0.6, z: MOUTH.z + rz * 0.6 };
    const out = { x: MOUTH.x - rx * 1.4 + (p.i % 2 ? 0.4 : -0.4), z: MOUTH.z - rz * 1.4 };
    if (p.state === 'toMine' || p.state === 'enter' || p.state === 'toHeap' || p.state === 'exit') {
      const target = p.state === 'toMine' ? out : p.state === 'enter' ? inside : p.state === 'exit' ? out : HEAP;
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
      if (fx() < dt * 1.2) emit(chalkMat, MOUTH.x, heightAt(MOUTH.x, MOUTH.z) + 0.6, MOUTH.z, 2, 0.5, 0.05, 0.7);
      if (p.timer <= 0) {
        r.root.visible = true;
        if (r.carry) r.carry.visible = true;
        p.state = 'exit';
      }
    } else {
      faceTo(p, HEAP.x, HEAP.z + 1, dt);
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.6, dt);
      if (p.timer <= 0) {
        if (r.carry?.visible) {
          r.carry.visible = false;
          emit(ore, HEAP.x, heightAt(HEAP.x, HEAP.z) + 0.9, HEAP.z, 4, 0.7, 0.07, 0.5);
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
  // ---------- Día y noche ----------
  // Cada día dura seis minutos, en todas las eras: amanece, se trabaja, a mediodía hay mercado o
  // fiesta, al atardecer velada junto al fuego y de noche todos duermen en casa (ver la vida diaria).
  // El sol y la luna cruzan el cielo y la luz que proyecta las sombras los sigue. Con movimiento
  // reducido el reloj se para a media mañana.
  const CYCLE = 360;
  let tod = 0.3, dayNum = 0;
  const ramp = (t: number, a: number, b: number) => THREE.MathUtils.smoothstep(t, a, b);
  /** Luz del día a la hora `t` (0 = noche, 1 = pleno día). */
  const daylightAt = (t: number) => ramp(t, 0.12, 0.2) * (1 - ramp(t, 0.75, 0.83));
  /** Tono dorado del amanecer y del atardecer. */
  const glowAt = (t: number) => Math.max(1 - Math.min(1, Math.abs(t - 0.165) / 0.06), 1 - Math.min(1, Math.abs(t - 0.79) / 0.07));
  let day = daylightAt(tod), warm = 0, warmTarget = 0, med = 0, medTarget = 0, smog = 0, smogTarget = 0, zoom = 1, zoomTarget = 1;
  const nightFog = new THREE.Color(0x3a2a52), dayFog = new THREE.Color(0xcfdde6);
  const hemiSky = [new THREE.Color(0x8a7ac8), new THREE.Color(0xfff0d8)], hemiGround = [new THREE.Color(0x2a1a10), new THREE.Color(0x6e5a3a)];
  const lightCol = [new THREE.Color(0x9aa8ff), new THREE.Color(0xffefd0)];
  const mountainCol = [new THREE.Color(0x4a4066), new THREE.Color(0x7d8aa6)];
  // Edad del Bronce y atardeceres: luz dorada
  const skyGold = skyGradient(new THREE.Color(0x5a88c4), new THREE.Color(0xf0c890), new THREE.Color(0xffa45a));
  const goldFog = new THREE.Color(0xf0cfa0), goldLight = new THREE.Color(0xffcf94), goldSky = new THREE.Color(0xffe2b8);
  const goldMountain = new THREE.Color(0x9a8aa0);
  // Antigüedad: mediodía claro del Mediterráneo, cielo azul intenso y luz blanca
  const skyMed = skyGradient(new THREE.Color(0x2a66b8), new THREE.Color(0x7ab4e8), new THREE.Color(0xe6eef0));
  const medFog = new THREE.Color(0xd6e3ec), medLight = new THREE.Color(0xfff8ec), medSky = new THREE.Color(0xf2f6ff);
  const medMountain = new THREE.Color(0x7d90b2);
  // Revolución Industrial: un velo pardo de humo sobre el cielo y la niebla
  const smogSky = [0.62, 0.58, 0.52], smogFog = new THREE.Color(0xa89c8c);
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
  /** Ventanas encendidas de noche: un solo material para todas las casas. */
  function applyDay(k: number, w = warm, m = med): void {
    const e = k * k * (3 - 2 * k);
    // Los tonos de cada era son de día: de noche manda el azul de la luna.
    const g = w * w * (3 - 2 * w), c = m * m * (3 - 2 * m), ge = g * e, ce = c * e;
    const colors = skyGeo.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < skyNight.length; i++) {
      const dayC = skyDay[i] + (skyGold[i] - skyDay[i]) * g;
      const lit = dayC + (skyMed[i] - dayC) * c;
      const hazy = lit + (smogSky[i % 3] - lit) * smog * 0.45;
      (colors.array as Float32Array)[i] = skyNight[i] + (hazy - skyNight[i]) * e;
    }
    colors.needsUpdate = true;
    (scene.fog as THREE.Fog).color.copy(nightFog).lerp(dayFog, e).lerp(goldFog, ge).lerp(medFog, ce).lerp(smogFog, smog * e * 0.5);
    hemi.color.copy(hemiSky[0]).lerp(hemiSky[1], e).lerp(goldSky, ge).lerp(medSky, ce);
    hemi.groundColor.copy(hemiGround[0]).lerp(hemiGround[1], e);
    hemi.intensity = 1.6 + e * 0.2 + ce * 0.1;
    moonLight.color.copy(lightCol[0]).lerp(lightCol[1], e).lerp(goldLight, ge).lerp(medLight, ce);
    moonLight.intensity = 1.3 + e * 1.6 - ge * 0.2 + ce * 0.3;
    // El sol sale por el este a media mañana del reloj y se pone al atardecer; de noche la luna
    const sk = THREE.MathUtils.clamp((tod - 0.12) / 0.72, 0, 1) * Math.PI;
    sunDir.set(Math.cos(sk) * 0.85, Math.sin(sk) * 0.8 + 0.12, 0.42).normalize();
    const mk = THREE.MathUtils.clamp((((tod + 0.18) % 1) - 0.0) / 0.32, 0, 1) * Math.PI;
    moonDir.set(-Math.cos(mk) * 0.7, Math.sin(mk) * 0.55 + 0.35, -0.55).normalize();
    sun.position.copy(sunDir).multiplyScalar(150);
    moon.position.copy(moonDir).multiplyScalar(150);
    moonLight.position.copy(moonDir).lerp(sunDir, e).normalize().multiplyScalar(55);
    if (moonLight.position.y < 14) moonLight.position.y = 14;
    mountainMat.color.copy(mountainCol[0]).lerp(mountainCol[1], e).lerp(goldMountain, ge).lerp(medMountain, ce);
    moonMat.opacity = 1 - e;
    sunMat.opacity = e;
    (sunHalo.material as THREE.MeshBasicMaterial).opacity = e * 0.28;
    cloudMat.opacity = e * 0.92;
    for (const cl of clouds) cl.visible = e > 0.01;
    stars.visible = e < 0.99;
    windowMat.color.copy(windowDark).lerp(windowLit, 1 - e);
  }

  // ---------- Vida diaria ----------
  // Además de su oficio, cada persona sigue el reloj del día. A mediodía hay mercado (un día) o
  // fiesta (el siguiente) en la plaza más cercana de su lado del río; al atardecer, fiesta con baile
  // o velada tranquila junto a la hoguera; de noche todos duermen en la casa más cercana y por la
  // mañana vuelven a lo suyo. Nadie deja el trabajo a medias (dentro de un pozo o de una mina), y al
  // volver retoma lo que hacía en el mismo sitio. Los balseros y los aradores siguen en lo suyo.
  type Phase = 'work' | 'market' | 'festival' | 'party' | 'velada' | 'sleep';
  const phaseAt = (t: number, d: number): Phase =>
    t >= 0.44 && t < 0.53 ? (d % 2 ? 'festival' : 'market')
    : t >= 0.79 && t < 0.91 ? (d % 2 ? 'velada' : 'party')
    : t >= 0.91 || t < 0.13 ? 'sleep' : 'work';
  const EVENING = new Set<Phase>(['party', 'velada']);
  // Qué parte de la gente va a cada cosa
  const TURNOUT: Partial<Record<Phase, number>> = { market: 0.4, festival: 0.65, party: 0.75, velada: 0.6 };
  const STAYS = new Set<BuildingId>(['rafter', 'plowman']);
  let phase: Phase = 'work', phaseSpots: Spot[] = [], schedTimer = 0;
  const failed = new Set<Person>();
  /** Número fijo entre 0 y 1 para cada persona y cada día (para repartir sin que cambie a cada rato). */
  const personRnd = (p: Person, salt: number) => hash(p.i * 7.31 + p.kind.length * 3.7 + salt * 0.913, p.kind.charCodeAt(0) * 0.37 + salt * 1.71);

  // Plazas: un círculo de tierra pisada o enlosado que sigue el terreno, con su hoguera en el centro
  // (que se enciende en las fiestas de la noche) y, en el borde, algo propio de la era.
  /** Disco plano que se adapta al relieve, para plazas, prados y campos. */
  function groundDisc(x: number, z: number, r: number, color: number, lift = 0.2): THREE.Mesh {
    // Con anillos intermedios, para que el disco siga el relieve y el suelo no lo atraviese
    const g = new THREE.RingGeometry(0.001, r, 24, Math.max(3, Math.round(r / 1.2)));
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(x + pos.getX(i), z + pos.getZ(i)) + lift);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat(color));
    m.position.set(x, 0, z);
    m.receiveShadow = true;
    return m;
  }
  /** Figura de mármol de pie, con el peso en una pierna y la mano en el hombro, a escala s. */
  function makeStatue(m: THREE.Material, s: number): THREE.Group {
    const g = new THREE.Group();
    const part = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.rotation.z = rz;
      o.castShadow = true;
      g.add(o);
    };
    part(new THREE.CylinderGeometry(0.08, 0.06, 0.62, 6), -0.1, 0.31, 0, 0.05);
    part(new THREE.CylinderGeometry(0.08, 0.06, 0.62, 6), 0.11, 0.31, 0.04, -0.12);
    part(new THREE.CylinderGeometry(0.2, 0.15, 0.62, 7), 0, 0.92, 0, 0.04);
    part(new THREE.IcosahedronGeometry(0.13, 1), 0.02, 1.38, 0);
    part(new THREE.CylinderGeometry(0.05, 0.045, 0.6, 5), 0.25, 0.92, 0, 0.12);
    part(new THREE.CylinderGeometry(0.05, 0.045, 0.45, 5), -0.2, 1.1, 0.06, -2.4);
    g.scale.setScalar(s);
    return g;
  }
  /** Puertas de las casas de los caseríos de las afueras: también se duerme en ellas. */
  const hamletDoors: { x: number; z: number; era: number }[] = [];
  const plazaBuilt = new Set<Plaza>();
  const bonfires = new Map<Plaza, THREE.Group>();
  const bonfireFlames: THREE.Mesh[] = [];
  const PAVING: Record<number, number> = { 3: 0x8a7a50, 4: 0xcfc6b2, 5: 0x9a8a72, 6: 0xb4785a, 7: 0x6e6460, 8: 0xb4b2ac };
  function buildPlaza(pl: Plaza): void {
    plazaBuilt.add(pl);
    if (!pl.pit) return;
    const disc = groundDisc(pl.x, pl.z, PLAZA_R - 0.3, PAVING[pl.era] ?? 0x8a7a50);
    scene.add(disc);
    // Hoguera: un anillo de piedras con leña; las llamas solo se ven en las fiestas de la noche
    const pit = new THREE.Group();
    const stones: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      stones.push(new THREE.DodecahedronGeometry(0.2, 0).translate(Math.cos(a) * 0.75, 0.1, Math.sin(a) * 0.75));
    }
    for (let k = 0; k < 4; k++) stones.push(new THREE.CylinderGeometry(0.08, 0.1, 1, 5).rotateZ(0.95).rotateY((k / 4) * Math.PI * 2).translate(0, 0.35, 0));
    pit.add(new THREE.Mesh(mergeGeometries(stones.map((g) => (g.index ? g.toNonIndexed() : g)))!, mat(0x6d6873)));
    const fire = new THREE.Group();
    for (const [r, h, c] of [[0.42, 1.2, 0xff6a1a], [0.26, 0.85, 0xffb040]] as const) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.92 }));
      f.position.y = 0.2 + h / 2;
      f.userData.h = h;
      fire.add(f);
      bonfireFlames.push(f);
    }
    fire.visible = false;
    pit.add(fire);
    bonfires.set(pl, fire);
    spawn(add(pit, pl.x, groundY(pl.x, pl.z, 0.8), pl.z));
    // En el borde, mirando a la plaza: un mayo con cintas en el prado, una fuente en las plazas
    // de la Antigüedad, una cruz de piedra en la Edad Media y una estatua en el Renacimiento.
    const edge = polar(Math.atan2(-pl.z, -pl.x) + Math.PI * 0.75, PLAZA_R - 0.6);
    const ex = pl.x + edge.x, ez = pl.z + edge.z;
    const deco = new THREE.Group();
    if (pl.era === 3) {
      const pole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6), mat(0xd8c8a0));
      pole2.position.y = 2.1;
      deco.add(pole2);
      const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.08, 4, 10), oakLeafMat);
      wreath.rotation.x = Math.PI / 2;
      wreath.position.y = 4.1;
      deco.add(wreath);
      [0xc0392b, 0x2e6fb0, 0xe8b830, 0x3a8a4a].forEach((c, k) => {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 0.02), mat(c, { side: THREE.DoubleSide }));
        const a = (k / 4) * Math.PI * 2;
        rib.position.set(Math.cos(a) * 0.45, 2.8, Math.sin(a) * 0.45);
        rib.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
        deco.add(rib);
      });
    } else if (pl.era === 4) {
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1, 0.5, 10), marbleShadeMat);
      basin.position.y = 0.25;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 1.3, 8), marbleMat);
      col.position.y = 0.9;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.2, 0.25, 10), marbleMat);
      bowl.position.y = 1.6;
      const water = new THREE.Mesh(new THREE.CircleGeometry(0.8, 10), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.46;
      deco.add(basin, col, bowl, water);
    } else if (pl.era === 5) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 1.2), castleStoneMat);
      step.position.y = 0.17;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.4, 0.22), castleStoneMat);
      shaft.position.y = 1.5;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.2), castleStoneMat);
      arm.position.y = 2.2;
      deco.add(step, shaft, arm);
    } else if (pl.era === 6) {
      const ped = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 1), marbleShadeMat);
      ped.position.y = 0.6;
      deco.add(ped, makeStatue(marbleMat, 1.1).translateY(1.2));
    } else if (pl.era === 7) {
      // Farola de hierro fundido con cuatro faroles, que de noche se encienden como las ventanas
      deco.add(meshOf([new THREE.CylinderGeometry(0.45, 0.55, 0.4, 8).translate(0, 0.2, 0), new THREE.CylinderGeometry(0.07, 0.11, 3.4, 6).translate(0, 2, 0), boxAt(1.3, 0.06, 0.06, 0, 3.4, 0), boxAt(0.06, 0.06, 1.3, 0, 3.4, 0)], greenIronMat));
      for (const [x, z] of [[0.62, 0], [-0.62, 0], [0, 0.62], [0, -0.62]]) deco.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.32, 0.2).translate(x, 3.2, z), windowMat));
    } else {
      // Fuente moderna: un estanque cuadrado y un arco de acero pulido
      deco.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 2).translate(0, 0.2, 0), concreteMat));
      const water = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2).translate(0, 0.38, 0), waterMat);
      deco.add(water, new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.08, 6, 16, Math.PI).translate(0, 0.4, 0), tinMat));
    }
    faceCenter(deco, { x: -edge.x, z: -edge.z });
    deco.rotation.y += Math.PI;
    spawn(add(deco, ex, groundY(ex, ez, 0.6), ez));
  }

  /** Huecos de la plaza para una cosa: corro de baile, sitios junto al fuego, músicos, corros de
   *  charla y parejas de comerciantes. El orden decide quién llega primero a qué. */
  function plazaSpots(pl: Plaza, ph: Phase): Spot[] {
    const f = pl.pit ? 1 : 1.35, out: Spot[] = [];
    const base = Math.atan2(-pl.z, -pl.x) || 0;
    const mk = (act: Act, x: number, z: number, fx2: number, fz2: number, a = 0, r = 0): Spot => ({ plaza: pl, act, x, z, fx: fx2, fz: fz2, a, r, taken: null });
    const ring = (act: Act, n: number, r: number) =>
      Array.from({ length: n }, (_, k) => {
        const a = base + (k / n) * Math.PI * 2;
        return mk(act, pl.x + Math.cos(a) * r, pl.z + Math.sin(a) * r, pl.x, pl.z, a, r);
      });
    const music = (n: number) =>
      Array.from({ length: n }, (_, k) => {
        const a = base + Math.PI + (k - (n - 1) / 2) * 0.42, r = 4.3 * f;
        return mk('music', pl.x + Math.cos(a) * r, pl.z + Math.sin(a) * r, pl.x, pl.z);
      });
    const chats = (groups: number) =>
      Array.from({ length: groups }, (_, g) => {
        const a = base + Math.PI * 0.5 + g * 1.15, gx = pl.x + Math.cos(a) * 5.2 * f, gz = pl.z + Math.sin(a) * 5.2 * f;
        return Array.from({ length: 3 }, (_, k) => {
          const b = a + (k / 3) * Math.PI * 2;
          return mk('chat', gx + Math.cos(b) * 0.8, gz + Math.sin(b) * 0.8, gx, gz);
        });
      });
    const trades = (pairs: number) =>
      Array.from({ length: pairs }, (_, q) => {
        const a = base - Math.PI * 0.5 - q * 0.75, cx = pl.x + Math.cos(a) * 4.8 * f, cz = pl.z + Math.sin(a) * 4.8 * f;
        const tx = -Math.sin(a) * 0.65, tz = Math.cos(a) * 0.65;
        const s1 = mk('trade', cx + tx, cz + tz, cx - tx, cz - tz), s2 = mk('trade', cx - tx, cz - tz, cx + tx, cz + tz);
        s1.partner = s2;
        s2.partner = s1;
        return [s1, s2];
      });
    const dance = ring('dance', 8, 2.6 * f), sit = ring('sit', 8, 1.9 * f);
    if (ph === 'market') {
      const tr = trades(4), ch = chats(3);
      out.push(...tr[0], ...ch[0], ...tr[1], ...tr[2], ...ch[1], ...tr[3], ...ch[2]);
    } else if (ph === 'festival') {
      const mu = music(3), tr = trades(3), ch = chats(2);
      out.push(mu[0], ...dance.slice(0, 4), ...tr[0], mu[1], ...dance.slice(4), ...ch[0], ...tr[1], mu[2], ...ch[1], ...tr[2]);
    } else if (ph === 'party') {
      const mu = music(3), ch = chats(3);
      out.push(mu[0], ...dance.slice(0, 4), mu[1], ...ch[0], ...dance.slice(4), mu[2], ...ch[1], ...ch[2]);
    } else {
      const mu = music(2), ch = chats(2);
      out.push(...sit.slice(0, 4), mu[0], ...sit.slice(4), ...ch[0], mu[1], ...ch[1]);
    }
    // Fuera los huecos que caen dentro de algo construido o en el agua
    return out.filter((sp) => !inWater(sp.x, sp.z, 0.6) && solids.every((o) => !o.obj.parent || Math.hypot(sp.x - o.x, sp.z - o.z) > o.r + 0.5));
  }
  const tradeGoods = [mat(0xc8a050), mat(0x8a3a3a), mat(0x3a6a8a), mat(0xe0d8c0)];
  function beginPhase(ph: Phase): void {
    failed.clear();
    for (const sp of phaseSpots) if (sp.item) scene.remove(sp.item);
    phaseSpots = [];
    for (const [pl, fire] of bonfires) fire.visible = EVENING.has(ph) && pl.era <= shownEra;
    if (!TURNOUT[ph]) return;
    for (const pl of PLAZAS) {
      if (pl.era > shownEra) continue;
      for (const sp of plazaSpots(pl, ph)) {
        phaseSpots.push(sp);
        if (sp.act === 'trade' && sp.partner && !sp.partner.item) {
          // Un fardo, un cántaro o una cesta que pasa de uno a otro
          const it = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.22), tradeGoods[phaseSpots.length % tradeGoods.length]);
          it.visible = false;
          scene.add(it);
          sp.item = it;
        }
      }
    }
  }
  /** Una plaza de su lado del río que aún tenga sitio: la más cercana o, a veces, otra que no quede
   *  mucho más lejos, para que la gente se reparta por todas las plazas abiertas. */
  function claimSpot(p: Person): Spot | null {
    const side = sideOf(p.x, p.z), near = new Map<Plaza, number>();
    for (const sp of phaseSpots) {
      if (sp.taken || near.has(sp.plaza) || sideOf(sp.plaza.x, sp.plaza.z) !== side) continue;
      near.set(sp.plaza, Math.hypot(sp.plaza.x - p.x, sp.plaza.z - p.z));
    }
    const best = Math.min(...near.values());
    const options = [...near].filter(([, d]) => d < 36 && d <= best + 16).map(([pl]) => pl);
    if (!options.length) return null;
    const pl = options[Math.floor(personRnd(p, 9 + dayNum) * options.length) % options.length];
    // Dentro de esa plaza, el primer hueco libre según el orden de llegada
    const first = phaseSpots.find((sp) => sp.plaza === pl && !sp.taken)!;
    first.taken = p;
    return first;
  }
  /** La puerta de la casa más cercana de su lado del río. */
  function homeFor(p: Person): { x: number; z: number } | null {
    const side = sideOf(p.x, p.z);
    let best: { x: number; z: number } | null = null, bestD = Infinity;
    const consider = (x: number, z: number) => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bestD && sideOf(x, z) === side) [best, bestD] = [{ x, z }, d];
    };
    for (const t of tents) if (t.userData.doorAt) consider(t.userData.doorAt.x, t.userData.doorAt.z);
    for (const d of hamletDoors) if (d.era <= shownEra) consider(d.x, d.z);
    if (side !== 1 && medievalBuilt && shownEra >= 5) consider(around(LODGE, 0, -2.2).x, around(LODGE, 0, -2.2).z);
    return best;
  }
  const canLeave = (p: Person) =>
    !STAYS.has(p.kind) && (p.depth ?? 0) === 0 && p.rig.root.visible && !(p.kind === 'hunter' && p.cheer > 0);
  function leave(p: Person, mode: Life['mode'], spot?: Spot, home?: { x: number; z: number }): void {
    const r = p.rig;
    p.life = {
      mode, spot, home,
      saved: { x: p.x, z: p.z, state: p.state, timer: p.timer, heading: p.heading, target: p.target, carry: !!r.carry?.visible },
      best: Infinity, stuck: 0,
    };
    if (r.carry) r.carry.visible = false;
    if (p.line) p.line.visible = false;
    if (p.bobber) p.bobber.visible = false;
    r.torso.rotation.set(0, 0, 0);
    r.armR.rotation.z = 0.12;
  }
  /** Se va a dormir a la casa más cercana; si no hay ninguna, sigue con lo suyo. */
  function sendHome(p: Person): void {
    leave(p, 'back');
    setMode(p, 'toHome');
    if ((p.life as Life | undefined)?.mode === 'back') restore(p);
  }
  function setMode(p: Person, mode: Life['mode']): void {
    const L = p.life!;
    if (L.spot && mode !== 'event' && mode !== 'toEvent') {
      L.spot.taken = null;
      L.spot = undefined;
    }
    if (mode === 'toHome' && !L.home) L.home = homeFor(p) ?? undefined;
    if (mode === 'toHome' && !L.home) mode = 'back';
    L.mode = mode;
    L.best = Infinity;
    L.stuck = 0;
  }
  /** Vuelve a su oficio donde lo dejó. */
  function restore(p: Person): void {
    const L = p.life!, s0 = L.saved, r = p.rig;
    if (L.spot) L.spot.taken = null;
    [p.x, p.z, p.state, p.timer, p.heading, p.target] = [s0.x, s0.z, s0.state, s0.timer, s0.heading, s0.target];
    if (r.carry) r.carry.visible = s0.carry;
    if (p.line) p.line.visible = true;
    if (p.bobber) p.bobber.visible = true;
    r.root.visible = true;
    if (r.torch) r.torch.visible = false;
    if (r.instrument) r.instrument.visible = false;
    r.legL.rotation.x = r.legR.rotation.x = 0;
    p.bob = 0;
    p.life = undefined;
  }
  /** Al cambiar de era (o al quitar a alguien) todos vuelven a su oficio al instante. */
  function resetLives(): void {
    for (const list of Object.values(people)) for (const p of list) if (p.life) restore(p);
    phase = 'work';
    beginPhase('work');
  }
  function schedule(): void {
    const ph = phaseAt(tod, dayNum);
    if (ph !== phase) {
      phase = ph;
      beginPhase(ph);
    }
    for (const list of Object.values(people)) for (const p of list) {
      if (STAYS.has(p.kind)) continue;
      const L = p.life;
      if (ph === 'sleep') {
        if (!L) {
          if (canLeave(p)) {
            sendHome(p);
          }
        } else if (L.mode === 'toEvent' || L.mode === 'event' || L.mode === 'back') setMode(p, 'toHome');
      } else if (ph === 'work') {
        if (L && (L.mode === 'event' || L.mode === 'toEvent' || L.mode === 'toHome')) setMode(p, 'back');
        else if (L && L.mode === 'home' && tod > 0.13 + personRnd(p, 1) * 0.07 && tod < 0.5) {
          // Sale de casa por la puerta y vuelve a lo suyo
          p.x = L.home!.x;
          p.z = L.home!.z;
          p.rig.root.visible = true;
          setMode(p, 'back');
        }
      } else if (!L && !failed.has(p) && canLeave(p)) {
        if (personRnd(p, dayNum * 3 + (EVENING.has(ph) ? 2 : 1)) < TURNOUT[ph]!) {
          const spot = claimSpot(p);
          if (spot) leave(p, 'toEvent', spot);
          else failed.add(p);
        } else if (EVENING.has(ph)) failed.add(p);
        // Quien no va a la velada se retira pronto a casa
        if (!p.life && EVENING.has(ph) && failed.has(p) && tod > 0.81 + personRnd(p, 5) * 0.06) {
          sendHome(p);
        }
      } else if (!L && EVENING.has(ph) && failed.has(p) && canLeave(p) && tod > 0.81 + personRnd(p, 5) * 0.06) {
        sendHome(p);
      }
    }
  }
  /** Antorcha en la mano izquierda (se crea la primera vez que hace falta). */
  function torchOf(r: Rig): THREE.Object3D {
    if (!r.torch) {
      const g = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 4), pole);
      stick.position.y = 0.1;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 5), torchFlameMat);
      flame.position.y = 0.5;
      g.add(stick, flame);
      g.position.set(0, -0.5, 0.06);
      r.armL.add(g);
      r.torch = g;
    }
    return r.torch;
  }
  const torchFlameMat = new THREE.MeshBasicMaterial({ color: 0xffa640 });
  /** Laúd, flauta o tambor, según la persona. */
  function instrumentOf(p: Person): THREE.Object3D {
    const r = p.rig;
    if (!r.instrument) {
      const g = new THREE.Group(), kind = p.i % 3;
      if (kind === 0) {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5), mat(0xb07a3a));
        body.scale.set(1, 1.2, 0.5);
        const neck = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.04), mat(0x5a3a1e));
        neck.position.set(-0.22, 0.25, 0);
        neck.rotation.z = 0.9;
        g.add(body, neck);
        g.position.set(0.05, 0.35, 0.28);
        g.rotation.z = -0.6;
      } else if (kind === 1) {
        const flute = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5), mat(0xd8c08a));
        flute.rotation.x = Math.PI / 2 - 0.5;
        g.add(flute);
        g.position.set(0, 0.68, 0.38);
      } else {
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 10), mat(0x9a5a2a));
        const skin = new THREE.Mesh(new THREE.CircleGeometry(0.21, 10), mat(0xe8dcc0));
        skin.rotation.x = -Math.PI / 2;
        skin.position.y = 0.16;
        g.add(drum, skin);
        g.position.set(0, 0.1, 0.32);
      }
      r.torso.add(g);
      r.instrument = g;
    }
    return r.instrument;
  }
  /** Dónde tiene que estar ahora: el corro de baile gira; lo demás está quieto. */
  function spotNow(sp: Spot, t: number): { x: number; z: number } {
    if (sp.act !== 'dance') return sp;
    const a = sp.a + t * 0.28;
    return { x: sp.plaza.x + Math.cos(a) * sp.r, z: sp.plaza.z + Math.sin(a) * sp.r };
  }
  function updateLife(p: Person, dt: number, t: number): void {
    const L = p.life!, r = p.rig;
    if (L.mode === 'home') return;
    const night = day < 0.35;
    if (L.mode === 'event') return animateEvent(p, L.spot!, dt, t);
    if (r.instrument) r.instrument.visible = false;
    const goal = L.mode === 'toEvent' ? spotNow(L.spot!, t) : L.mode === 'toHome' ? L.home! : L.saved;
    // De noche se alumbra con una antorcha, que lleva en alto
    const torch = night ? torchOf(r) : r.torch;
    if (torch) torch.visible = night;
    if (torch && night) {
      r.armL.rotation.x = ease(r.armL.rotation.x, -1.1, dt);
      torch.rotation.x = -r.armL.rotation.x;
    } else r.armL.rotation.x = -Math.sin(p.walk) * 0.5;
    r.armR.rotation.x = Math.sin(p.walk) * 0.5;
    r.torso.rotation.y = ease(r.torso.rotation.y, 0, dt);
    r.legL.rotation.x = ease(r.legL.rotation.x, 0, dt, 10);
    p.bob = Math.max(p.bob, 0);
    const d = Math.hypot(goal.x - p.x, goal.z - p.z);
    if (d < L.best - 0.25) [L.best, L.stuck] = [d, 0];
    else L.stuck += dt;
    const there = walkTo(p, goal.x, goal.z, dt, 1.8);
    if (!there && L.stuck < 5) return;
    // Llegó (o se atascó: entonces se le da por llegado)
    if (L.mode === 'toEvent') {
      if (there) L.mode = 'event';
      else setMode(p, 'back');
    } else if (L.mode === 'toHome') {
      L.mode = 'home';
      r.root.visible = false;
      if (r.torch) r.torch.visible = false;
    } else {
      if (!there) [p.x, p.z] = [goal.x, goal.z];
      restore(p);
    }
  }
  function animateEvent(p: Person, sp: Spot, dt: number, t: number): void {
    const r = p.rig;
    if (r.torch) r.torch.visible = false;
    if (sp.act === 'dance') {
      // El corro gira: se sigue el sitio con pasitos y los brazos en alto
      const at = spotNow(sp, t);
      if (Math.hypot(at.x - p.x, at.z - p.z) > 0.08) walkTo(p, at.x, at.z, dt, 1.2);
      else standPose(p, dt);
      const k = Math.sin(t * 6 + sp.a * 3);
      r.armL.rotation.x = -2.5 + k * 0.35;
      r.armR.rotation.x = -2.5 - k * 0.35;
      r.armL.rotation.z = -0.4;
      r.armR.rotation.z = 0.4;
      p.bob = Math.abs(Math.sin(t * 5 + sp.a * 2)) * 0.14;
      return;
    }
    r.armL.rotation.z = ease(r.armL.rotation.z, -0.12, dt);
    if (Math.hypot(sp.x - p.x, sp.z - p.z) > 0.12) {
      walkTo(p, sp.x, sp.z, dt, 1.2);
      return;
    }
    faceTo(p, sp.fx, sp.fz, dt);
    if (sp.act === 'sit') {
      // Sentado en el suelo junto al fuego, con las manos en las rodillas
      r.legL.rotation.x = ease(r.legL.rotation.x, -1.45, dt, 5);
      r.legR.rotation.x = ease(r.legR.rotation.x, -1.45, dt, 5);
      p.bob = ease(p.bob, -0.34, dt, 5);
      r.torso.rotation.x = ease(r.torso.rotation.x, 0.12 + Math.sin(t * 0.7 + p.phase) * 0.04, dt);
      r.armL.rotation.x = ease(r.armL.rotation.x, -0.9, dt);
      r.armR.rotation.x = ease(r.armR.rotation.x, Math.sin(t * 0.5 + p.phase) > 0.7 ? -1.6 : -0.9, dt, 4);
      return;
    }
    standPose(p, dt);
    if (sp.act === 'music') {
      const ins = instrumentOf(p);
      ins.visible = true;
      const kind = p.i % 3;
      r.torso.rotation.y = Math.sin(t * 1.2 + p.phase) * 0.12;
      if (kind === 0) {
        r.armR.rotation.x = -1.0 + Math.sin(t * 10) * 0.18;
        r.armL.rotation.x = -1.3;
      } else if (kind === 1) {
        r.armR.rotation.x = -1.75 + Math.sin(t * 3) * 0.05;
        r.armL.rotation.x = -1.65;
      } else {
        r.armR.rotation.x = -0.9 + Math.max(0, Math.sin(t * 8)) * -0.5;
        r.armL.rotation.x = -0.9 + Math.max(0, Math.sin(t * 8 + Math.PI)) * -0.5;
      }
      p.bob = Math.abs(Math.sin(t * 4)) * 0.04;
    } else if (sp.act === 'chat') {
      // Charla en corro: se gira hacia unos y otros y gesticula de vez en cuando
      const talk = Math.sin(t * 0.9 + p.phase * 2);
      r.torso.rotation.y = Math.sin(t * 0.45 + p.phase) * 0.35;
      r.armR.rotation.x = talk > 0.4 ? -1.1 + Math.sin(t * 5 + p.phase) * 0.35 : ease(r.armR.rotation.x, -0.15, dt);
      r.armL.rotation.x = talk < -0.7 ? -0.8 : ease(r.armL.rotation.x, -0.1, dt);
      // Alguna carcajada
      p.bob = Math.sin(t * 0.33 + p.phase) > 0.94 ? Math.abs(Math.sin(t * 14)) * 0.05 : 0;
    } else {
      // Trato: los brazos hacia delante y la mercancía pasa de uno a otro
      r.armR.rotation.x = -1.05 + Math.sin(t * 1.3 + p.phase) * 0.1;
      r.armL.rotation.x = -0.6;
      const it = sp.item ?? sp.partner?.item;
      const other = sp.partner?.taken;
      if (it && sp.item) {
        const ready = other?.life?.mode === 'event' && Math.hypot(other.x - sp.partner!.x, other.z - sp.partner!.z) < 0.3;
        it.visible = ready;
        if (ready) {
          const k = (Math.sin(t * 0.9 + sp.a) + 1) / 2;
          it.position.set(THREE.MathUtils.lerp(sp.x, sp.fx, k), heightAt(sp.x, sp.z) + 0.95 + Math.sin(k * Math.PI) * 0.25, THREE.MathUtils.lerp(sp.z, sp.fz, k));
        }
      }
    }
  }
  /** Llamas de las hogueras de las plazas. */
  function animateBonfires(t: number): void {
    bonfireFlames.forEach((f, k) => {
      const s = 1 + Math.sin(t * (9 + k)) * 0.1 + Math.sin(t * 23 + k) * 0.06;
      f.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
      f.position.y = 0.2 + (f.userData.h * s) / 2;
      f.rotation.y = t * (1 + (k % 2));
    });
  }

  // ---------- Afueras ----------
  // Lo que cada era levanta en el anillo que gana al bosque: caseríos con sus casas, campos de
  // cultivo, prados con flores, arboledas, rebaños y monumentos, todo con el estilo de su época.
  const outBuilt = new Set<Outskirt>();
  interface Beast { root: THREE.Group; legs: THREE.Object3D[]; head: THREE.Object3D; cx: number; cz: number; r: number; x: number; z: number; tx: number; tz: number; heading: number; timer: number; walk: number; speed: number }
  const beasts: Beast[] = [];
  const ochreMat = mat(0xd9a45a), roseMat = mat(0xd89a8a), creamMat = mat(0xeadcb8), serenaMat = mat(0x8a8c90);
  const shutterMat = mat(0x3f5a3a), cypressMat = mat(0x2c4a2c), stonePineMat = mat(0x3d6a34), birchMat = mat(0xe8e4da), birchLeafMat = mat(0x7aa04a);
  const hayMat = mat(0xd8b85a), hiveMat = mat(0xc89a4a), menhirMat = mat(0x8e8a92);
  const fieldSoilMat = mat(0x6a4a2c, { side: THREE.DoubleSide });
  const FLOWER_MATS = [mat(0xe8d050), mat(0xd85a6a), mat(0xf0ece0), mat(0x8a6ad0)];
  const grainMat = mat(0xd8b04a), flaxMat = mat(0x7a8ad0), cabbageMat = mat(0x8aa860), vineMat = mat(0x4a6a2a), grapeMat = mat(0x5a2a5a);
  /** Une piezas sueltas en una sola malla (las de los campos y monumentos son muchas y pequeñas). */
  const meshOf = (geos: THREE.BufferGeometry[], m: THREE.Material) => new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!, m);
  /** Pieza en coordenadas del mundo, a u de lado y v hacia fuera del centro de la zona, sobre el suelo. */
  function partAt(o: { x: number; z: number }, geo: THREE.BufferGeometry, u: number, v: number, y = 0, ry = 0): THREE.BufferGeometry {
    const p = around(o, u, v), { tx, tz } = radial(o);
    geo.rotateY(Math.atan2(-tz, tx) + ry);
    return geo.translate(p.x, heightAt(p.x, p.z) + y, p.z);
  }
  /** Rectángulo de suelo que sigue el relieve, girado como la zona. */
  function groundPatch(o: { x: number; z: number }, w: number, d: number, m: THREE.Material): THREE.Mesh {
    const g = new THREE.PlaneGeometry(w, d, 8, 8);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const p = around(o, pos.getX(i), pos.getY(i));
      pos.setXYZ(i, p.x, heightAt(p.x, p.z) + 0.2, p.z);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    return mesh;
  }

  // Casas del Renacimiento: dos plantas encaladas en ocre, rosa o crema, zócalo de piedra gris,
  // cornisa, ventanas con contraventanas verdes y tejado de tejas a cuatro aguas.
  const REN_WALLS = [ochreMat, roseMat, creamMat, stuccoA];
  function makeRenHouse(x: number, z: number, s: number, tone: number) {
    const g = new THREE.Group();
    const w = 2.4 * s, d = 2 * s, h = 2.5 * s;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), REN_WALLS[(tone + Math.round(Math.abs(x * 3 + z * 7))) % REN_WALLS.length]);
    wall.position.y = h / 2;
    const trim = [boxAt(w + 0.12, 0.35 * s, d + 0.12, 0, 0.17 * s, 0), boxAt(w + 0.08, 0.08 * s, d + 0.08, 0, h * 0.5, 0), boxAt(w + 0.3 * s, 0.16 * s, d + 0.3 * s, 0, h, 0)];
    const roofGeo = new THREE.ConeGeometry(1, 1, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, tileMat);
    roof.scale.set((w + 0.4 * s) / Math.SQRT2, 0.6 * s, (d + 0.4 * s) / Math.SQRT2);
    roof.position.y = h + 0.08 * s + 0.3 * s;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.8 * s, 0.3 * s), stuccoB);
    chimney.position.set(-w * 0.28, h + 0.5 * s, -d * 0.2);
    g.add(wall, new THREE.Mesh(mergeGeometries(trim)!, serenaMat), roof, chimney);
    const shutters: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (const [zz, yy] of [[d / 2 + 0.03, h * 0.74], [-d / 2 - 0.03, h * 0.74], [-d / 2 - 0.03, h * 0.3]] as const) {
        pane(g, sx * w * 0.28, yy, zz, 0.32 * s, 0.48 * s);
        for (const k of [-1, 1]) shutters.push(boxAt(0.12 * s, 0.5 * s, 0.04, sx * w * 0.28 + k * 0.24 * s, yy, zz));
      }
    }
    pane(g, 0, h * 0.74, d / 2 + 0.03, 0.3 * s, 0.48 * s);
    g.add(new THREE.Mesh(mergeGeometries(shutters)!, shutterMat));
    const poles = new THREE.Group(); // humo de la chimenea
    poles.position.set(-w * 0.28, h + 0.95 * s, -d * 0.2);
    g.add(poles);
    const door = new THREE.Group();
    door.position.set(0, 1.0 * s, d / 2 + 0.04);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.6 * s, 1.0 * s), mat(0x5a3a22, { side: THREE.DoubleSide }));
    leaf.position.y = -0.5 * s;
    door.add(leaf);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.36 * s, 0.36 * s, 0.06, 10, 1, false, -Math.PI / 2, Math.PI), serenaMat);
    arch.rotation.x = Math.PI / 2;
    arch.position.set(0, 1.02 * s, d / 2 + 0.03);
    g.add(door, arch);
    g.userData.door = door;
    g.userData.poles = poles;
    g.userData.phase = fx() * 6;
    const gy = groundY(x, z, 1.2 * s);
    add(g, x, gy, z);
    g.lookAt(0, gy, 0);
    return bakeStatic(g);
  }

  function makeCypress(s: number): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 0.6 * s, 5), oliveTrunkMat);
    trunk.position.y = 0.3 * s;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.55 * s, 3.4 * s, 7), cypressMat);
    crown.position.y = 2.1 * s;
    g.add(trunk, crown);
    return g;
  }
  /** Pino piñonero: tronco alto y la copa plana como un parasol. */
  function makeStonePine(s: number): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 2.6 * s, 6), cedarMat);
    trunk.position.y = 1.3 * s;
    trunk.rotation.z = 0.12;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.3 * s, 8, 5), stonePineMat);
    crown.scale.y = 0.38;
    crown.position.set(0.3 * s, 2.8 * s, 0);
    g.add(trunk, crown);
    return g;
  }
  function makeBirch(s: number): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.13 * s, 2.2 * s, 5), birchMat);
    trunk.position.y = 1.1 * s;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 * s, 0), birchLeafMat);
    crown.scale.set(0.8, 1.3, 0.8);
    crown.position.y = 2.5 * s;
    g.add(trunk, crown);
    return g;
  }

  /** Animal de un rebaño: cabras, vacas, ovejas, cerdos o caballos según la era. */
  const BEAST_LOOK: Record<string, { body: number[]; size: number; leg: number; neck: number; horns: boolean }> = {
    goat: { body: [0xe8e0d0, 0x8a6a4a, 0x3a3030], size: 0.75, leg: 0.42, neck: 0.15, horns: true },
    cow: { body: [0xf0ece4, 0x8a5a36, 0x3a2a24], size: 1.15, leg: 0.5, neck: 0.1, horns: true },
    sheep: { body: [0xf1ece0, 0xe0d8c8], size: 0.8, leg: 0.36, neck: 0.05, horns: false },
    pig: { body: [0xe8a8a0, 0xd89088], size: 0.8, leg: 0.26, neck: 0, horns: false },
    horse: { body: [0x6a4028, 0x3a2418, 0xd8c8a8, 0x9a6a3a], size: 1.2, leg: 0.8, neck: 0.5, horns: false },
  };
  function makeBeast(kind: string, k: number, o: Outskirt): Beast {
    const L = BEAST_LOOK[kind], s = L.size, bodyMat = mat(L.body[k % L.body.length]), dark = mat(0x2a2420);
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.42 * s, 0.95 * s), bodyMat);
    body.position.y = L.leg + 0.2 * s;
    root.add(body);
    const head = new THREE.Group();
    head.position.set(0, L.leg + 0.3 * s + L.neck * 0.6, 0.5 * s);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.24 * s, 0.26 * s, 0.4 * s), bodyMat);
    face.position.set(0, L.neck * 0.4, 0.18 * s);
    face.rotation.x = L.neck > 0.3 ? 0.6 : 0.2;
    head.add(face);
    if (L.horns) for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.035 * s, 0.22 * s, 4), mat(0xeee2c8));
      horn.position.set(sx * 0.1 * s, L.neck * 0.4 + 0.18 * s, 0.05 * s);
      horn.rotation.x = -0.5;
      head.add(horn);
    }
    if (kind === 'horse') {
      const mane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5 * s, 0.12), dark);
      mane.position.set(0, 0.05, -0.08);
      mane.rotation.x = 0.6;
      head.add(mane);
    }
    root.add(head);
    const legs = [[-0.17, 0.33], [0.17, 0.33], [-0.17, -0.33], [0.17, -0.33]].map(([lx, lz]) => {
      const pivot = new THREE.Group();
      pivot.position.set(lx * s, L.leg, lz * s);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.04 * s, L.leg, 4), kind === 'cow' || kind === 'horse' ? dark : bodyMat);
      leg.position.y = -L.leg / 2;
      pivot.add(leg);
      root.add(pivot);
      return pivot;
    });
    const a = k * 2.1 + o.seed % 7, d = (o.r - 1.4) * (0.3 + (k % 3) * 0.3);
    const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d;
    add(root, x, heightAt(x, z), z);
    return { root, legs, head, cx: o.x, cz: o.z, r: o.r - 1.3, x, z, tx: x, tz: z, heading: a, timer: fx() * 4, walk: 0, speed: kind === 'horse' ? 0.6 : 0.3 };
  }
  function animateBeasts(dt: number, t: number): void {
    for (const b of beasts) {
      if (!b.root.parent) continue;
      b.timer -= dt;
      const d = Math.hypot(b.tx - b.x, b.tz - b.z);
      if (d > 0.1) {
        b.heading = lerpAngle(b.heading, Math.atan2(b.tx - b.x, b.tz - b.z), Math.min(1, dt * 3));
        b.x += Math.sin(b.heading) * b.speed * dt;
        b.z += Math.cos(b.heading) * b.speed * dt;
        b.walk += dt * 7;
        b.head.rotation.x = ease(b.head.rotation.x, 0, dt);
      } else {
        // Pasta: la cabeza abajo y algún tirón
        b.head.rotation.x = ease(b.head.rotation.x, 0.75 + Math.max(0, Math.sin(t * 2 + b.cx)) * 0.15, dt, 3);
        b.walk = ease(b.walk, Math.round(b.walk / Math.PI) * Math.PI, dt);
        if (b.timer <= 0) {
          const a = fx() * Math.PI * 2, rr = Math.sqrt(fx()) * b.r;
          [b.tx, b.tz, b.timer] = [b.cx + Math.cos(a) * rr, b.cz + Math.sin(a) * rr, 4 + fx() * 6];
        }
      }
      b.legs.forEach((l, k) => (l.rotation.x = Math.sin(b.walk + (k === 0 || k === 3 ? 0 : Math.PI)) * 0.45));
      b.root.position.set(b.x, heightAt(b.x, b.z), b.z);
      b.root.rotation.y = b.heading;
    }
  }

  /** Construye una zona de las afueras al llegar su era. */
  function buildOutskirt(o: Outskirt): void {
    outBuilt.add(o);
    const rnd = mulberry32(o.seed), era = o.era;
    const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length) % list.length];
    if (o.type === 'hamlet') {
      // Tres o cuatro casas de la era alrededor de un pozo, con un huerto detrás
      const n = 3 + Math.floor(rnd() * 2), make = era >= 8 ? makeModernHouse : era === 7 ? makeBrickHouse : era >= 6 ? makeRenHouse : era === 5 ? makeTimberHouse : era === 4 ? makeVilla : era === 3 ? makeHouse : makeHut;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rnd() * 0.4, p = around(o, Math.cos(a) * 2.7, Math.sin(a) * 2.7);
        const s = 0.6 + rnd() * 0.08;
        const h = spawn(make(p.x, p.z, era === 2 ? s * 1.1 : s, k % 2));
        const back = 1.6 * s + 0.3, l = Math.hypot(p.x, p.z);
        hamletDoors.push({ x: p.x - (p.x / l) * back, z: p.z - (p.z / l) * back, era });
        h.userData.hamlet = true;
      }
      const well: THREE.BufferGeometry[] = [];
      well.push(partAt(o, new THREE.CylinderGeometry(0.55, 0.6, 0.7, 10), 0, 0, 0.35));
      for (const sx of [-1, 1]) well.push(partAt(o, new THREE.BoxGeometry(0.1, 1.4, 0.1), sx * 0.5, 0, 1.05));
      well.push(partAt(o, new THREE.BoxGeometry(1.3, 0.1, 0.12), 0, 0, 1.75));
      const wg = new THREE.Group();
      wg.add(meshOf(well, era >= 4 ? castleStoneMat : stoneMat));
      spawn(add(wg));
      return;
    }
    if (o.type === 'field') {
      // Un campo arado con surcos y, según la era, cereal, lino, coles o viñas en hileras
      const crop = pick(era <= 2 ? ['grain', 'flax'] : era === 3 ? ['grain', 'flax', 'cabbage'] : era === 4 ? ['grain', 'vine', 'cabbage'] : era === 5 ? ['grain', 'cabbage', 'flax'] : era === 6 ? ['vine', 'grain', 'cabbage'] : ['grain', 'cabbage', 'grain']);
      const side = o.r * 1.3, rows = 6, g = new THREE.Group();
      g.add(groundPatch(o, side, side, fieldSoilMat));
      const plants: THREE.BufferGeometry[] = [], extra: THREE.BufferGeometry[] = [], posts: THREE.BufferGeometry[] = [];
      for (let rI = 0; rI < rows; rI++) {
        const v = -side / 2 + 0.5 + (rI * (side - 1)) / (rows - 1);
        if (crop === 'vine') {
          plants.push(partAt(o, new THREE.BoxGeometry(side - 1, 0.6, 0.3), 0, v, 0.55));
          for (let k = 0; k < 6; k++) extra.push(partAt(o, new THREE.IcosahedronGeometry(0.1, 0), -side / 2 + 0.8 + k * ((side - 1.6) / 5), v + 0.17, 0.45));
          for (const u of [-side / 2 + 0.4, side / 2 - 0.4]) posts.push(partAt(o, new THREE.BoxGeometry(0.06, 1, 0.06), u, v, 0.5));
        } else {
          for (let k = 0; k < 7; k++) {
            const u = -side / 2 + 0.5 + (k * (side - 1)) / 6 + (rnd() - 0.5) * 0.15;
            if (crop === 'cabbage') plants.push(partAt(o, new THREE.IcosahedronGeometry(0.22, 0), u, v, 0.18));
            else plants.push(partAt(o, new THREE.ConeGeometry(0.16, crop === 'grain' ? 0.75 : 0.55, 4), u, v, 0.4, rnd()));
          }
        }
      }
      g.add(meshOf(plants, crop === 'grain' ? grainMat : crop === 'flax' ? flaxMat : crop === 'cabbage' ? cabbageMat : vineMat));
      if (extra.length) g.add(meshOf(extra, grapeMat));
      // Espantapájaros desde la Edad del Bronce y cerca de postes desde la Antigüedad
      if (era >= 3 && crop !== 'vine') {
        posts.push(partAt(o, new THREE.BoxGeometry(0.08, 1.7, 0.08), 0.2, 0.1, 0.85), partAt(o, new THREE.BoxGeometry(1, 0.07, 0.07), 0.2, 0.1, 1.35));
        extra.length = 0;
        extra.push(partAt(o, new THREE.ConeGeometry(0.3, 0.25, 6), 0.2, 0.1, 1.9));
        g.add(meshOf(extra, hayMat));
      }
      if (era >= 4) {
        for (let k = 0; k < 8; k++) {
          const f = (k / 8) * 4, sideK = Math.floor(f), u0 = f - sideK;
          const [u, v] = sideK === 0 ? [-side / 2 - 0.3 + u0 * (side + 0.6), -side / 2 - 0.3] : sideK === 1 ? [side / 2 + 0.3, -side / 2 - 0.3 + u0 * (side + 0.6)] : sideK === 2 ? [side / 2 + 0.3 - u0 * (side + 0.6), side / 2 + 0.3] : [-side / 2 - 0.3, side / 2 + 0.3 - u0 * (side + 0.6)];
          posts.push(partAt(o, new THREE.BoxGeometry(0.1, 0.8, 0.1), u, v, 0.4));
        }
      }
      if (posts.length) g.add(meshOf(posts, timberMat));
      spawn(add(g));
      return;
    }
    if (o.type === 'meadow') {
      // Prado con flores; desde el Bronce, almiares de heno; desde la Antigüedad, colmenas
      const g = new THREE.Group();
      g.add(groundDisc(o.x, o.z, o.r - 0.3, 0x6a9a48));
      FLOWER_MATS.forEach((m) => {
        const fl: THREE.BufferGeometry[] = [];
        for (let k = 0; k < 14; k++) {
          const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * (o.r - 0.8);
          fl.push(partAt(o, new THREE.IcosahedronGeometry(0.09, 0), Math.cos(a) * d, Math.sin(a) * d, 0.3));
        }
        g.add(meshOf(fl, m));
      });
      add(g, 0, 0, 0, false);
      if (era >= 3) {
        const stacks: THREE.BufferGeometry[] = [];
        for (const u of era >= 4 ? [-1.2] : [-1.2, 1.1]) {
          stacks.push(partAt(o, new THREE.CylinderGeometry(0.75, 0.85, 0.9, 8), u, 0.4, 0.45), partAt(o, new THREE.ConeGeometry(0.8, 0.9, 8), u, 0.4, 1.35));
        }
        const hs = new THREE.Group();
        hs.add(meshOf(stacks, hayMat));
        spawn(add(hs));
      }
      if (era >= 4) {
        const hives: THREE.BufferGeometry[] = [];
        for (let k = 0; k < 3; k++) {
          const u = 0.7 + k * 0.7;
          hives.push(partAt(o, new THREE.CylinderGeometry(0.12, 0.28, 0.5, 8), u, -0.8, 0.45), partAt(o, new THREE.BoxGeometry(0.5, 0.2, 0.5), u, -0.8, 0.1));
        }
        const hv = new THREE.Group();
        hv.add(meshOf(hives, hiveMat));
        spawn(add(hv));
      }
      return;
    }
    if (o.type === 'grove') {
      // Árboles de la época: abedules y robles al norte; olivos y cipreses en el Mediterráneo
      const kinds = era <= 3 ? ['oak', 'birch', 'birch'] : era === 4 ? ['olive', 'cypress', 'olive'] : era === 5 ? ['oak', 'oak', 'birch'] : era === 6 ? ['cypress', 'stonePine', 'olive', 'cypress'] : ['birch', 'oak', 'birch', 'oak'];
      const n = 5 + Math.floor(rnd() * 2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rnd() * 0.5, d = k === 0 ? 0 : 1.6 + rnd() * (o.r - 2.4);
        const p = k === 0 ? { x: o.x, z: o.z } : around(o, Math.cos(a) * d, Math.sin(a) * d);
        const kind = pick(kinds), s = 0.7 + rnd() * 0.3;
        const tree = kind === 'oak' ? makeOak(s * 0.85) : kind === 'birch' ? makeBirch(s) : kind === 'olive' ? makeOlive(s) : kind === 'cypress' ? makeCypress(s) : makeStonePine(s);
        tree.rotation.y = rnd() * 6;
        spawn(add(tree, p.x, groundY(p.x, p.z, 0.4), p.z));
      }
      return;
    }
    if (o.type === 'herd') {
      // Cercado con animales que pastan: cabras, vacas, ovejas, cerdos o caballos
      const kind = pick(era === 2 ? ['goat'] : era === 3 ? ['cow', 'goat'] : era === 4 ? ['goat', 'sheep'] : era === 5 ? ['cow', 'pig'] : era === 6 ? ['horse', 'cow'] : ['cow', 'horse', 'sheep']);
      const fence: THREE.BufferGeometry[] = [], n = 18, rr = o.r - 0.3;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, a2 = ((k + 1) / n) * Math.PI * 2;
        const u = Math.cos(a) * rr, v = Math.sin(a) * rr, u2 = Math.cos(a2) * rr, v2 = Math.sin(a2) * rr;
        fence.push(partAt(o, new THREE.BoxGeometry(0.1, 0.9, 0.1), u, v, 0.45));
        if (k === 0) continue; // la portilla
        const len = Math.hypot(u2 - u, v2 - v);
        for (const y of [0.4, 0.75]) fence.push(partAt(o, new THREE.BoxGeometry(len, 0.07, 0.06), (u + u2) / 2, (v + v2) / 2, y, Math.atan2(v2 - v, u2 - u)));
      }
      const fg = new THREE.Group();
      fg.add(meshOf(fence, timberMat));
      add(fg);
      const count = kind === 'horse' || kind === 'cow' ? 3 : 4 + Math.floor(rnd() * 2);
      for (let k = 0; k < count; k++) beasts.push(makeBeast(kind, k, o));
      if (era >= 3) {
        // Abrevadero
        const tr = new THREE.Group();
        tr.add(meshOf([partAt(o, new THREE.BoxGeometry(1.2, 0.35, 0.45), 0, -o.r + 1.2, 0.18)], timberMat));
        add(tr);
      }
      return;
    }
    // Monumentos
    const g = new THREE.Group(), parts: THREE.BufferGeometry[] = [];
    let m: THREE.Material = menhirMat;
    const variant = Math.floor(rnd() * 2);
    if (era === 2) {
      // Dolmen: dos losas de pie y una encima; o un menhir con dos piedras menores
      if (variant) parts.push(partAt(o, new THREE.BoxGeometry(0.4, 1.4, 1.6), -0.8, 0, 0.6), partAt(o, new THREE.BoxGeometry(0.4, 1.4, 1.6), 0.8, 0, 0.6), partAt(o, new THREE.BoxGeometry(2.4, 0.35, 2), 0, 0, 1.45, 0.08));
      else parts.push(partAt(o, new THREE.BoxGeometry(0.7, 2.8, 0.55), 0, 0, 1.3, 0.2), partAt(o, new THREE.BoxGeometry(0.5, 1.3, 0.4), 1.1, 0.4, 0.6, 0.5), partAt(o, new THREE.BoxGeometry(0.45, 1, 0.4), -1.0, -0.5, 0.45, -0.3));
    } else if (era === 3) {
      // Círculo de piedras con dinteles
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        parts.push(partAt(o, new THREE.BoxGeometry(0.45, 1.8, 0.35), Math.cos(a) * 1.8, Math.sin(a) * 1.8, 0.8, a + Math.PI / 2));
        if (k % 2 === 0) parts.push(partAt(o, new THREE.BoxGeometry(1.6, 0.3, 0.4), Math.cos(a + 0.39) * 1.75, Math.sin(a + 0.39) * 1.75, 1.85, a + 0.39 + Math.PI / 2));
      }
    } else if (era === 4) {
      m = marbleMat;
      if (variant) {
        // Templete redondo: seis columnas y una cúpula
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          parts.push(partAt(o, new THREE.CylinderGeometry(0.12, 0.14, 2, 7), Math.cos(a) * 1.1, Math.sin(a) * 1.1, 1.25));
        }
        parts.push(partAt(o, new THREE.CylinderGeometry(1.45, 1.55, 0.25, 12), 0, 0, 0.12), partAt(o, new THREE.CylinderGeometry(1.35, 1.35, 0.2, 12), 0, 0, 2.35));
        parts.push(partAt(o, new THREE.SphereGeometry(1.3, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), 0, 0, 2.45));
      } else parts.push(partAt(o, new THREE.BoxGeometry(1.6, 0.4, 1.6), 0, 0, 0.2), partAt(o, new THREE.BoxGeometry(1.1, 0.4, 1.1), 0, 0, 0.6), partAt(o, new THREE.CylinderGeometry(0.2, 0.42, 3.4, 4, 1).rotateY(Math.PI / 4), 0, 0, 2.5), partAt(o, new THREE.ConeGeometry(0.22, 0.4, 4).rotateY(Math.PI / 4), 0, 0, 4.4));
    } else if (era === 5) {
      m = castleStoneMat;
      if (variant) {
        // Ermita: una nave pequeña con espadaña y su campana
        parts.push(partAt(o, new THREE.BoxGeometry(1.8, 1.6, 2.4), 0, 0, 0.8), partAt(o, new THREE.BoxGeometry(1.2, 1.1, 0.3), 0, 1.15, 2.1));
        const roofG = new THREE.Group();
        roofG.add(meshOf([partAt(o, gableGeo(2.1, 2.7, 1), 0, 0, 1.6, Math.PI / 2)], slateMat));
        g.add(roofG);
        const bell = new THREE.Group();
        bell.add(meshOf([partAt(o, new THREE.ConeGeometry(0.2, 0.3, 8), 0, 1.15, 2.15)], bronzeMat));
        g.add(bell);
      } else {
        // Torre en ruinas cubierta de hiedra
        parts.push(partAt(o, new THREE.CylinderGeometry(1.1, 1.25, 3.2, 10), 0, 0, 1.6));
        for (let k = 0; k < 10; k += 2) {
          const a = (k / 10) * Math.PI * 2;
          parts.push(partAt(o, new THREE.BoxGeometry(0.45, 0.5 + (k % 4) * 0.2, 0.4), Math.cos(a) * 0.95, Math.sin(a) * 0.95, 3.4, a + Math.PI / 2));
        }
        const ivy = new THREE.Group();
        ivy.add(meshOf([partAt(o, new THREE.IcosahedronGeometry(0.6, 0).scale(0.6, 1.4, 0.6), 0.9, 0.6, 1.2), partAt(o, new THREE.IcosahedronGeometry(0.5, 0).scale(0.6, 1, 0.6), -1.0, 0.2, 0.9)], oakLeafMat));
        g.add(ivy);
      }
    } else if (era === 6) {
      m = marbleMat;
      if (variant) {
        // Templete del Renacimiento: columnas en corro, cúpula y linterna
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          parts.push(partAt(o, new THREE.CylinderGeometry(0.1, 0.12, 1.9, 7), Math.cos(a) * 1.2, Math.sin(a) * 1.2, 1.25));
        }
        parts.push(partAt(o, new THREE.CylinderGeometry(1.5, 1.6, 0.3, 14), 0, 0, 0.15), partAt(o, new THREE.CylinderGeometry(1.4, 1.4, 0.25, 14), 0, 0, 2.3), partAt(o, new THREE.CylinderGeometry(0.15, 0.15, 0.5, 6), 0, 0, 3.6));
        const dome = new THREE.Group();
        dome.add(meshOf([partAt(o, new THREE.SphereGeometry(1.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, 2.42)], tileMat));
        g.add(dome);
      } else {
        // Estatua sobre un pedestal alto, mirando a la ciudad
        parts.push(partAt(o, new THREE.BoxGeometry(1.6, 0.3, 1.6), 0, 0, 0.15), partAt(o, new THREE.BoxGeometry(1.1, 1.6, 1.1), 0, 0, 1.1), partAt(o, new THREE.BoxGeometry(1.3, 0.2, 1.3), 0, 0, 1.95));
        const st = makeStatue(marbleMat, 1.4);
        const p = around(o, 0, 0), { tx, tz } = radial(o);
        st.position.set(p.x, heightAt(p.x, p.z) + 2.05, p.z);
        st.rotation.y = Math.atan2(-tz, tx) + Math.PI / 2;
        g.add(st);
      }
    } else if (era === 7) {
      if (variant) {
        // Depósito de agua de hierro sobre cuatro patas
        m = rustMat;
        parts.push(partAt(o, new THREE.CylinderGeometry(1.3, 1.3, 1.6, 12), 0, 0, 4.4), partAt(o, new THREE.ConeGeometry(1.4, 0.6, 12), 0, 0, 5.5));
        for (const [u, v] of [[0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]]) parts.push(partAt(o, new THREE.BoxGeometry(0.18, 3.6, 0.18), u, v, 1.8));
      } else {
        // Torre del reloj de ladrillo con tejado de pizarra
        m = brickMat;
        parts.push(partAt(o, new THREE.BoxGeometry(1.4, 5.5, 1.4), 0, 0, 2.75));
        const roofG = new THREE.Group();
        roofG.add(meshOf([partAt(o, new THREE.ConeGeometry(1.15, 1.4, 4).rotateY(Math.PI / 4), 0, 0, 6.2)], slate7Mat));
        const face = new THREE.Group();
        face.add(meshOf([partAt(o, new THREE.CircleGeometry(0.45, 12).translate(0, 0, 0.72), 0, 0, 4.6, Math.PI / 2)], paperMat));
        g.add(roofG, face);
      }
    } else {
      m = whiteMat;
      if (variant) {
        // Aerogenerador: torre blanca, góndola y tres palas que giran de cara a la ciudad
        parts.push(partAt(o, new THREE.CylinderGeometry(0.18, 0.32, 11, 8), 0, 0, 5.5), partAt(o, new THREE.BoxGeometry(0.5, 0.5, 1.3), 0, 0, 11.1));
        const p = around(o, 0, -0.75), { tx, tz } = radial(o);
        const rotor = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.2, 0.06).translate(0, 2.2, 0), whiteMat);
          blade.rotation.z = (k / 3) * Math.PI * 2;
          rotor.add(blade);
        }
        rotor.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), whiteMat));
        const holder = new THREE.Group();
        holder.position.set(p.x, heightAt(o.x, o.z) + 11.1, p.z);
        holder.rotation.y = Math.atan2(-tz, tx);
        holder.add(rotor);
        rotor.userData.phase = rnd() * 6;
        rotors.push(rotor);
        g.add(holder);
      } else {
        // Escultura moderna: un anillo de acero sobre una losa
        m = concreteMat;
        parts.push(partAt(o, new THREE.BoxGeometry(2.2, 0.3, 2.2), 0, 0, 0.15));
        const ring = new THREE.Group();
        ring.add(meshOf([partAt(o, new THREE.TorusGeometry(1.2, 0.18, 6, 18), 0, 0, 1.5)], tinMat));
        g.add(ring);
      }
    }
    g.add(meshOf(parts, m));
    spawn(add(g));
  }

  // ---------- Renacimiento: imprenta, viñedo, torre del reloj, escultores, arcabucería, banco,
  // encuadernadores, catedral con cúpula y astillero en el río ----------
  // Se construye la primera vez que la villa entra en la era 6, en el anillo que se gana a las colinas.
  const renStatics: THREE.Object3D[] = [];
  let renBuilt = false;
  const pietraMat = mat(0x8a8c90), terraMat = mat(0xc8643a), greenMarbleMat = mat(0x3f6a5a), paperMat = mat(0xf2ecdc), inkMat = mat(0x1e1c22);
  const brassMat = mat(0xd8b040, { metalness: 0.6, roughness: 0.35 }), clothRedMat = mat(0x8a1a22, { side: THREE.DoubleSide });
  /** Punto de una zona del Renacimiento a x de lado y z hacia la villa, como en la geometría local. */
  const zoneAt = (c: { x: number; z: number }, x: number, z: number) => around(c, x, -z);
  const PRESSES = [zoneAt(PRINTING, -1.7, 1.5), zoneAt(PRINTING, 1.7, 1.5)];
  const PAPER_PILE = zoneAt(PRINTING, 3.6, 2.2);
  const VINE_ROWS = [-1.5, 0, 1.5, 3].map((z) => -z);
  const VINES = VINE_ROWS.flatMap((z) => [-2, 0.4, 2.6].map((x) => zoneAt(VINEYARD, x, z)));
  const WINE_PRESS = zoneAt(VINEYARD, -3.4, 3.6);
  const WINE_PILE = zoneAt(VINEYARD, 3.2, 3.8);
  const CLOCK_BENCHES = [zoneAt(CLOCKTOWER, -1.1, 2.4), zoneAt(CLOCKTOWER, 1.1, 2.4)];
  const GEAR_PILE = zoneAt(CLOCKTOWER, 2.9, 1);
  const STATUE_BLOCKS = [zoneAt(SCULPTOR, -2, 0.6), zoneAt(SCULPTOR, 0, 1.3), zoneAt(SCULPTOR, 2, 0.6)];
  const STATUE_PILE = zoneAt(SCULPTOR, -3.3, 2.6);
  const GUN_ANVILS = [zoneAt(GUNSMITH, -1.2, 1.4), zoneAt(GUNSMITH, 1.2, 1.4)];
  const GUN_PILE = zoneAt(GUNSMITH, 3, 1.2);
  const COUNTERS = [zoneAt(BANK, -1.5, 2.6), zoneAt(BANK, 1.5, 2.6)];
  const COIN_PILE = zoneAt(BANK, -3.6, 2.2);
  const BIND_TABLES = [zoneAt(BINDERY, -1.1, 1.8), zoneAt(BINDERY, 1.1, 1.8)];
  const BOOK_PILE = zoneAt(BINDERY, 2.9, 1.4);
  // En el astillero el casco apunta al agua: x de lado y z hacia la villa, girado con la orilla
  const YARD_N = townNormal(SHIPYARD_S), YARD_ROT = Math.atan2(YARD_N.x, YARD_N.z);
  const yardAt = (x: number, z: number) => ({ x: SHIPYARD.x + x * Math.cos(YARD_ROT) + z * Math.sin(YARD_ROT), z: SHIPYARD.z - x * Math.sin(YARD_ROT) + z * Math.cos(YARD_ROT) });
  const HULL_SPOTS = [-0.6, 0.9].flatMap((z) => [-1, 1].map((sx) => ({ stand: yardAt(sx * 1.95, z), face: yardAt(0, z) })));
  const TIMBER_PILE = yardAt(2.6, 2.6);
  let paperStack: THREE.Object3D[] = [], wineBarrels: THREE.Object3D[] = [], statueRow: THREE.Object3D[] = [], gearPile: THREE.Object3D[] = [];
  let musketRack: THREE.Object3D[] = [], coinChests: THREE.Object3D[] = [], bookStacks: THREE.Object3D[] = [], timberStack: THREE.Object3D[] = [];
  let clockHands: THREE.Object3D[] = [], domeTop: THREE.Object3D | null = null, domeScaffold: THREE.Object3D | null = null;
  let cellar: THREE.Object3D | null = null, gunGlow: THREE.MeshBasicMaterial | null = null, treadBoost = 0;
  const caravels: THREE.Group[] = [];

  function placeRen(o: THREE.Object3D, at: { x: number; z: number }, dy = 0, face = true): THREE.Object3D {
    if (face) faceCenter(o, at);
    renStatics.push(spawn(add(o, at.x, groundY(at.x, at.z, footprint(o)) + dy, at.z)));
    return o;
  }
  /** Un montón que crece: piezas iguales apiladas, colocadas con su propia función. */
  function heap(at: { x: number; z: number }, n: number, make: (k: number) => THREE.Object3D): THREE.Object3D[] {
    const g = new THREE.Group(), list = Array.from({ length: n }, (_, k) => {
      const o = make(k);
      g.add(o);
      return o;
    });
    faceCenter(g, at);
    renStatics.push(spawn(add(g, at.x, heightAt(at.x, at.z), at.z)));
    return list;
  }
  /** Mesa de trabajo sencilla con algo encima. */
  function table(at: { x: number; z: number }, top: THREE.Material = timberMat, extra?: THREE.Object3D): void {
    const g = new THREE.Group();
    const parts = [boxAt(1.3, 0.1, 0.75, 0, 0.8, 0)];
    for (const sx of [-0.55, 0.55]) for (const sz of [-0.3, 0.3]) parts.push(boxAt(0.08, 0.8, 0.08, sx, 0.4, sz));
    g.add(new THREE.Mesh(mergeGeometries(parts)!, top));
    if (extra) g.add(extra);
    placeRen(g, at);
  }
  /** Caso de carabela: casco curvo, castillo de popa, dos o tres palos con velas latinas. */
  function makeCaravel(s: number, sails = true): THREE.Group {
    const g = new THREE.Group();
    const hullGeo = new THREE.CylinderGeometry(1, 0.55, 1, 10, 1, false, Math.PI / 2, Math.PI);
    hullGeo.rotateX(Math.PI / 2);
    hullGeo.rotateZ(Math.PI);
    hullGeo.scale(1.1, 0.9, 5);
    const hull = new THREE.Mesh(hullGeo, barrelMat);
    hull.position.y = 0.55;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 4.9), plankMat);
    deck.position.y = 0.58;
    const stern = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 1.2), barrelMat);
    stern.position.set(0, 0.95, -1.9);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.6, 4), barrelMat);
    bow.rotation.x = Math.PI / 2;
    bow.position.set(0, 0.5, 3.1);
    bow.scale.set(1.3, 1, 0.8);
    g.add(hull, deck, stern, bow);
    if (sails) {
      for (const [z, h] of [[1.2, 3.6], [-0.4, 4.4], [-1.9, 3]] as const) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, h, 5), timberMat);
        mast.position.set(0, 0.6 + h / 2, z);
        const sailGeo = new THREE.BufferGeometry();
        sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.9 + h, z + 0.9, 0, 1.0, z - 0.6, 0, 1.2, z + 1.4], 3));
        sailGeo.computeVertexNormals();
        const sail = new THREE.Mesh(sailGeo, sailMat);
        g.add(mast, sail);
      }
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.5), clothRedMat);
      cross.position.set(0.02, 3.4, -0.3);
      g.add(cross);
    }
    g.scale.setScalar(s);
    return g;
  }

  function buildRenaissance(): void {
    renBuilt = true;
    // Imprenta: casa de dos plantas con ventanales y, delante, dos prensas de madera
    {
      const g = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.BoxGeometry(6.4, 4, 3.6), ochreMat);
      wall.position.set(0, 2, -1.3);
      const roof = new THREE.Mesh(gableGeo(4.2, 7, 1.6).rotateY(Math.PI / 2), tileMat);
      roof.position.set(0, 4, -1.3);
      g.add(wall, roof, new THREE.Mesh(mergeGeometries([boxAt(6.6, 0.35, 3.8, 0, 0.17, -1.3), boxAt(6.7, 0.18, 3.9, 0, 4, -1.3)])!, pietraMat));
      for (const x of [-2.2, 0, 2.2]) {
        pane(g, x, 2.9, 0.53, 0.8, 1, 0);
        if (x) pane(g, x, 1.3, 0.53, 0.8, 1, 0);
      }
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.06), paperMat);
      sign.position.set(0, 1.6, 0.6);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.06), beamMat);
      door.position.set(0, 0.7, 0.53);
      g.add(sign, door);
      placeRen(g, PRINTING);
      for (const at of PRESSES) {
        // Prensa: dos pies, travesaño, husillo con su barra y la platina sobre la cama
        const pg = new THREE.Group();
        const wood = [boxAt(0.18, 2.3, 0.18, -0.55, 1.15, 0), boxAt(0.18, 2.3, 0.18, 0.55, 1.15, 0), boxAt(1.3, 0.25, 0.3, 0, 2.2, 0), boxAt(1.0, 0.18, 0.4, 0, 1.25, 0), boxAt(1.2, 0.12, 1.4, 0, 0.75, 0.2), boxAt(0.1, 0.75, 0.1, -0.5, 0.37, 0.75), boxAt(0.1, 0.75, 0.1, 0.5, 0.37, 0.75)];
        pg.add(new THREE.Mesh(mergeGeometries(wood)!, timberMat));
        const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.75, 6), ironMat);
        screw.position.y = 1.7;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4), ironMat);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0.4, 1.6, 0.1);
        const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.5), paperMat);
        sheet.position.set(0, 0.82, 0.45);
        pg.add(screw, bar, sheet);
        placeRen(pg, at);
      }
      paperStack = heap(PAPER_PILE, 8, (k) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.45), k % 3 ? paperMat : inkMat);
        b.position.set((k % 2) * 0.7 - 0.35, 0.09 + Math.floor(k / 2) * 0.19, 0);
        b.rotation.y = (k % 3) * 0.1;
        return b;
      });
    }
    // Viñedo: hileras de cepas en espaldera, un lagar de piedra y las barricas
    {
      const rows: THREE.BufferGeometry[] = [], stakes: THREE.BufferGeometry[] = [], grapes: THREE.BufferGeometry[] = [];
      for (const z of VINE_ROWS.map((v) => -v)) {
        for (let x = -3.2; x <= 3.21; x += 0.8) {
          rows.push(new THREE.IcosahedronGeometry(0.42, 0).scale(1.1, 0.95, 0.75).translate(x, 0.75, z));
          if ((x * 10) % 16 === 0) grapes.push(new THREE.IcosahedronGeometry(0.11, 0).translate(x + 0.2, 0.55, z + 0.32));
          else grapes.push(new THREE.IcosahedronGeometry(0.1, 0).translate(x - 0.15, 0.6, z - 0.33));
        }
        for (const x of [-3.6, 0, 3.6]) stakes.push(boxAt(0.08, 1.3, 0.08, x, 0.65, z));
        stakes.push(boxAt(7.3, 0.03, 0.03, 0, 1.1, z));
      }
      const g = new THREE.Group();
      g.add(meshOf(rows, vineMat), meshOf(stakes, timberMat), meshOf(grapes, grapeMat));
      placeRen(g, VINEYARD);
      const lagar = new THREE.Group();
      const vat = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.7, 12, 1, true), pietraMat);
      vat.position.y = 0.35;
      const must = new THREE.Mesh(new THREE.CircleGeometry(1.05, 12), grapeMat);
      must.rotation.x = -Math.PI / 2;
      must.position.y = 0.55;
      lagar.add(vat, must);
      placeRen(lagar, WINE_PRESS);
      wineBarrels = heap(WINE_PILE, 8, (k) => {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.8, 9), barrelMat);
        b.rotation.z = Math.PI / 2;
        b.position.set((k % 3) * 0.7 - 0.7 + (k >= 3 ? 0.35 : 0), 0.33 + (k >= 3 ? 0.6 : 0) + (k >= 6 ? 0.6 : 0), 0);
        return b;
      });
      // Bodega de barricas (mejora): la puerta de la cueva en la ladera y una hilera de toneles
      const c = new THREE.Group();
      c.add(new THREE.Mesh(mergeGeometries([boxAt(2.4, 1.8, 0.6, 0, 0.9, 0), boxAt(2.8, 0.3, 0.8, 0, 1.9, 0)])!, pietraMat));
      const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.3), new THREE.MeshBasicMaterial({ color: 0x0b0806 }));
      dark.position.set(0, 0.65, 0.31);
      c.add(dark);
      for (const x of [-0.9, 0.9]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 9), barrelMat);
        b.position.set(x * 1.6, 0.4, 0.8);
        b.rotation.x = Math.PI / 2;
        c.add(b);
      }
      cellar = placeRen(c, zoneAt(VINEYARD, 0, -4.9));
      cellar.visible = false;
    }
    // Torre del reloj: piedra gris y estuco, la esfera mira a la villa y marca la hora del día
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(mergeGeometries([boxAt(2.8, 9, 2.8, 0, 4.5, 0), boxAt(3.1, 0.3, 3.1, 0, 9, 0), boxAt(3.1, 0.5, 3.1, 0, 0.25, 0)])!, creamMat));
      const belfry: THREE.BufferGeometry[] = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) belfry.push(boxAt(0.4, 2, 0.4, sx * 1.15, 10.15, sz * 1.15));
      belfry.push(boxAt(3, 0.3, 3, 0, 11.3, 0));
      g.add(new THREE.Mesh(mergeGeometries(belfry)!, pietraMat));
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2, 4).rotateY(Math.PI / 4), tileMat);
      cap.position.y = 12.4;
      const bellR = new THREE.Mesh(bellGeo, bronzeMat);
      bellR.scale.setScalar(0.7);
      bellR.position.y = 9.7;
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.95, 20), paperMat);
      face.position.set(0, 7.4, 1.42);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.07, 4, 20), brassMat);
      rim.position.copy(face.position);
      g.add(cap, bellR, face, rim);
      clockHands = [0.55, 0.8].map((len, k) => {
        const hand = new THREE.Group();
        hand.position.set(0, 7.4, 1.47 + k * 0.02);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(k ? 0.06 : 0.1, len, 0.03), inkMat);
        bar.position.y = len / 2 - 0.08;
        hand.add(bar);
        g.add(hand);
        return hand;
      });
      for (const y of [3, 5.2]) pane(g, 0, y, 1.42, 0.5, 0.9);
      placeRen(g, CLOCKTOWER);
      for (const at of CLOCK_BENCHES) {
        const gear = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 4, 10), brassMat);
        gear.rotation.x = Math.PI / 2;
        gear.position.y = 0.9;
        table(at, timberMat, gear);
      }
      gearPile = heap(GEAR_PILE, 8, (k) => {
        const b = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 4, 10), brassMat);
        b.rotation.x = Math.PI / 2;
        b.position.set((k % 2) * 0.5 - 0.25, 0.08 + Math.floor(k / 2) * 0.12, (k % 3) * 0.1);
        return b;
      });
    }
    // Taller del escultor: un cobertizo de tejas, bloques de mármol de los que salen figuras y,
    // al lado, las estatuas acabadas
    {
      const g = new THREE.Group();
      const wood: THREE.BufferGeometry[] = [];
      for (const x of [-2.8, 0, 2.8]) wood.push(boxAt(0.2, 2.6, 0.2, x, 1.3, -1.6));
      g.add(new THREE.Mesh(mergeGeometries(wood)!, timberMat), new THREE.Mesh(mergeGeometries([boxAt(6.4, 2.6, 0.4, 0, 1.3, -2.6)])!, stuccoB));
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 2.2), tileMat);
      roof.position.set(0, 2.65, -2.1);
      roof.rotation.x = -0.18;
      g.add(roof);
      placeRen(g, SCULPTOR);
      STATUE_BLOCKS.forEach((at, k) => {
        const b = new THREE.Group();
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9 - k * 0.15, 0.8), marbleMat);
        block.position.y = (0.9 - k * 0.15) / 2;
        const fig = makeStatue(marbleMat, 0.55 + k * 0.12);
        fig.position.y = 0.85 - k * 0.15 - 0.2;
        b.add(block, fig);
        placeRen(b, at);
      });
      statueRow = heap(STATUE_PILE, 6, (k) => {
        const st = new THREE.Group();
        const ped = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), marbleShadeMat);
        ped.position.y = 0.22;
        const fig = makeStatue(marbleMat, 0.62);
        fig.position.y = 0.45;
        st.add(ped, fig);
        st.position.set((k % 3) * 0.95 - 0.95, 0, Math.floor(k / 3) * 1.0 - 0.5);
        return st;
      });
    }
    // Arcabucería: fragua de piedra con chimenea y dos yunques; los arcabuces, en su armero
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(mergeGeometries([boxAt(5, 2.6, 3.2, 0, 1.3, -1.4), boxAt(0.9, 4.6, 0.9, 1.6, 2.3, -2.2)])!, castleStoneMat));
      const roof = new THREE.Mesh(gableGeo(3.7, 5.4, 1.2).rotateY(Math.PI / 2), tileMat);
      roof.position.set(0, 2.6, -1.4);
      gunGlow = new THREE.MeshBasicMaterial({ color: 0x3a1a08 });
      const hearth = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1), gunGlow);
      hearth.position.set(-0.9, 0.8, 0.22);
      g.add(roof, hearth);
      placeRen(g, GUNSMITH);
      for (const at of GUN_ANVILS) {
        const a = new THREE.Group();
        const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.55, 7), barrelMat);
        stump.position.y = 0.27;
        const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.75), ironMat);
        anvil.position.y = 0.67;
        a.add(stump, anvil);
        placeRen(a, at);
      }
      const rack = new THREE.Group();
      rack.add(new THREE.Mesh(mergeGeometries([boxAt(2, 0.12, 0.3, 0, 0.3, 0), boxAt(2, 0.12, 0.3, 0, 1.3, -0.25), boxAt(0.1, 1.5, 0.1, -1, 0.75, -0.2), boxAt(0.1, 1.5, 0.1, 1, 0.75, -0.2)])!, timberMat));
      placeRen(rack, GUN_PILE);
      musketRack = heap(GUN_PILE, 8, (k) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 1.5, 5), k % 2 ? ironMat : barrelMat);
        m.position.set(-0.85 + k * 0.24, 0.95, -0.05);
        m.rotation.x = -0.18;
        return m;
      });
    }
    // Banco: palacio con la planta baja almohadillada, loggia de tres arcos, escudo y cornisa
    {
      const g = new THREE.Group();
      const rust: THREE.BufferGeometry[] = [];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 7; x++) rust.push(boxAt(0.92, 0.62, 0.15, -2.85 + x * 0.95 + (y % 2) * 0.2, 0.33 + y * 0.66, 0.55));
      g.add(new THREE.Mesh(mergeGeometries(rust)!, pietraMat));
      g.add(new THREE.Mesh(mergeGeometries([boxAt(7, 2.7, 4.4, 0, 1.35, -1.6), boxAt(7, 2.6, 4.4, 0, 4, -1.6)])!, creamMat));
      g.add(new THREE.Mesh(mergeGeometries([boxAt(7.6, 0.4, 5, 0, 5.4, -1.6), boxAt(7.2, 0.14, 4.6, 0, 2.72, -1.6)])!, pietraMat));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4), tileMat);
      roof.scale.set(7.4 / Math.SQRT2, 1.2, 4.8 / Math.SQRT2);
      roof.position.set(0, 6.2, -1.6);
      g.add(roof);
      for (const x of [-2.4, -0.8, 0.8, 2.4]) pane(g, x, 4.1, 0.62, 0.6, 1.1);
      // Loggia: cuatro columnas con su cubierta delante de la puerta
      const log: THREE.BufferGeometry[] = [];
      for (const x of [-2.6, -0.9, 0.9, 2.6]) log.push(...columnGeos(x, 1.9, 2.5, 0.16));
      log.push(boxAt(5.8, 0.35, 1.8, 0, 2.95, 1.2));
      g.add(new THREE.Mesh(mergeGeometries(log.map((q) => (q.index ? q.toNonIndexed() : q)))!, marbleMat));
      // El escudo: bolas rojas sobre oro
      const shield = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12), goldMat);
      shield.position.set(0, 4.1, 0.7);
      g.add(shield);
      for (let k = 0; k < 6; k++) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), clothRedMat);
        const a = (k / 6) * Math.PI * 2;
        ball.position.set(Math.cos(a) * 0.32, 4.1 + Math.sin(a) * 0.32, 0.75);
        g.add(ball);
      }
      placeRen(g, BANK);
      for (const at of COUNTERS) {
        const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.04, 0.79), mat(0x2f5a3a));
        cloth.position.y = 0.86;
        table(at, timberMat, cloth);
      }
      coinChests = heap(COIN_PILE, 6, (k) => {
        const c = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.42), barrelMat);
        box.position.y = 0.2;
        const coins = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.34), goldMat);
        coins.position.y = 0.42;
        c.add(box, coins);
        c.position.set((k % 2) * 0.7 - 0.35, Math.floor(k / 2) * 0.48, 0);
        return c;
      });
    }
    // Encuadernadores: tienda con toldo a rayas y mesas con los pliegos
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.8, 2.6).translate(0, 1.4, -1.4), roseMat));
      const roof = new THREE.Mesh(gableGeo(3.1, 5, 1).rotateY(Math.PI / 2), tileMat);
      roof.position.set(0, 2.8, -1.4);
      const awning: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 6; k++) awning.push(boxAt(0.7, 0.05, 1.1, -1.75 + k * 0.7, 2.1, 0.45).rotateX(0));
      const stripes = [awning.filter((_, k) => k % 2 === 0), awning.filter((_, k) => k % 2 === 1)];
      const aw1 = new THREE.Mesh(mergeGeometries(stripes[0])!, clothRedMat), aw2 = new THREE.Mesh(mergeGeometries(stripes[1])!, paperMat);
      for (const a of [aw1, aw2]) a.rotation.x = 0.25;
      g.add(roof, aw1, aw2);
      pane(g, -1.3, 1.3, -0.08, 0.9, 0.9);
      pane(g, 1.3, 1.3, -0.08, 0.9, 0.9);
      placeRen(g, BINDERY);
      for (const at of BIND_TABLES) {
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.3), mat(0x7a2a24));
        book.position.y = 0.92;
        table(at, timberMat, book);
      }
      bookStacks = heap(BOOK_PILE, 10, (k) => {
        const st = new THREE.Group();
        for (let q = 0; q < 4; q++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.3), mat(BOOK_COLORS[(k + q) % BOOK_COLORS.length]));
          b.position.y = 0.05 + q * 0.1;
          b.rotation.y = (q % 2) * 0.2;
          st.add(b);
        }
        st.position.set((k % 5) * 0.5 - 1, 0, Math.floor(k / 5) * 0.45);
        return st;
      });
    }
    // Catedral: fachada de mármol a franjas, nave, tambor octogonal y la cúpula de tejas con sus
    // nervios blancos y la linterna (mientras no se compre la cúpula, el tambor está en obras)
    {
      const g = new THREE.Group();
      const white: THREE.BufferGeometry[] = [boxAt(5.4, 6, 0.4, 0, 3, 3.8), new THREE.CylinderGeometry(3, 3, 3.2, 8).translate(0, 6.4, -2.4)];
      for (const y of [1, 2.6, 4.2]) white.push(boxAt(5.5, 0.3, 0.45, 0, y, 3.8));
      const green: THREE.BufferGeometry[] = [];
      for (const x of [-2.2, 2.2]) green.push(boxAt(0.35, 6, 0.48, x, 3, 3.8));
      green.push(new THREE.ConeGeometry(3.1, 1.6, 3).rotateZ(0).scale(1, 1, 0.1).translate(0, 6.7, 3.8));
      g.add(new THREE.Mesh(mergeGeometries(white.map((q) => (q.index ? q.toNonIndexed() : q)))!, marbleMat));
      g.add(new THREE.Mesh(mergeGeometries(green.map((q) => (q.index ? q.toNonIndexed() : q)))!, greenMarbleMat));
      const nave = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 6.4), creamMat);
      nave.position.set(0, 2.5, 0.6);
      const naveRoof = new THREE.Mesh(gableGeo(5.4, 6.6, 1.5), terraMat);
      naveRoof.position.set(0, 5, 0.6);
      const rose = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), windowMat);
      rose.position.set(0, 4.6, 4.02);
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), mat(0x3a2418));
      portal.position.set(0, 1.1, 4.02);
      g.add(nave, naveRoof, rose, portal);
      for (const x of [-1.5, 1.5]) pane(g, x * 1.68, 3.2, 0.6, 0.5, 1.4, Math.PI / 2);
      // Campanario a franjas al lado de la fachada
      const tower: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 6; k++) tower.push(boxAt(1.8, 1.8, 1.8, 4.3, 0.9 + k * 1.8, 2.6));
      g.add(new THREE.Mesh(mergeGeometries(tower.filter((_, k) => k % 2 === 0))!, marbleMat), new THREE.Mesh(mergeGeometries(tower.filter((_, k) => k % 2 === 1))!, greenMarbleMat));
      const spire = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.6, 4).rotateY(Math.PI / 4), terraMat);
      spire.position.set(4.3, 11.6, 2.6);
      g.add(spire);
      // Cúpula
      const top = new THREE.Group();
      const domeGeo = new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      domeGeo.scale(1, 1.25, 1);
      const dome = new THREE.Mesh(domeGeo, terraMat);
      dome.position.set(0, 8, -2.4);
      const ribs: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 8; k++) {
        // Un cuarto de arco que sigue la curva de la cúpula, de la base a la linterna
        const rib = new THREE.TorusGeometry(3.03, 0.1, 4, 12, Math.PI / 2);
        rib.scale(1, 1.25, 1);
        rib.rotateY((k / 8) * Math.PI * 2 + Math.PI / 8);
        ribs.push(rib.translate(0, 8, -2.4));
      }
      const lantern = [new THREE.CylinderGeometry(0.5, 0.6, 1.2, 8).translate(0, 12.3, -2.4), new THREE.ConeGeometry(0.55, 1, 8).translate(0, 13.4, -2.4), new THREE.SphereGeometry(0.15, 6, 4).translate(0, 14, -2.4)];
      top.add(dome, meshOf(ribs, marbleMat), meshOf(lantern, marbleMat));
      const scaf = new THREE.Group();
      const poles2: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        poles2.push(new THREE.CylinderGeometry(0.06, 0.06, 4, 4).translate(Math.cos(a) * 3.3, 9.5, -2.4 + Math.sin(a) * 3.3));
      }
      for (const y of [8.6, 10.2]) poles2.push(new THREE.TorusGeometry(3.3, 0.05, 3, 24).rotateX(Math.PI / 2).translate(0, y, -2.4));
      scaf.add(meshOf(poles2, timberMat));
      g.add(top, scaf);
      domeTop = top;
      domeScaffold = scaf;
      placeRen(g, DOME);
    }
    // Astillero: grada de tablones hacia el agua, un casco de carabela a medio hacer y la madera
    {
      const g = new THREE.Group();
      const ways: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 6; k++) ways.push(boxAt(2.6, 0.6, 0.9, 0, 0.05, 2.2 - k * 0.95));
      g.add(meshOf(ways, plankMat));
      const ribs: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.22, 0.3, 4.8).translate(0, 0.5, 0)];
      for (let k = 0; k < 7; k++) {
        const z = -1.8 + k * 0.6, w = 0.9 + Math.sin(((k + 0.5) / 7) * Math.PI) * 0.4;
        ribs.push(new THREE.TorusGeometry(w, 0.08, 4, 10, Math.PI).rotateZ(Math.PI).translate(0, 0.55 + w, z));
      }
      g.add(meshOf(ribs, barrelMat));
      for (const sx of [-1, 1]) for (const z of [-1.5, 1.5]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12).translate(sx * 1.6, 1.0, z), timberMat));
      g.rotation.y = YARD_ROT;
      renStatics.push(spawn(add(g, SHIPYARD.x, heightAt(SHIPYARD.x, SHIPYARD.z), SHIPYARD.z)));
      // La grada es zona de trabajo: los carpinteros andan junto al casco, no la rodean
      for (let k = solids.length - 1; k >= 0; k--) if (solids[k].obj === g) solids.splice(k, 1);
      timberStack = heap(TIMBER_PILE, 8, (k) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 1.8), plankMat);
        b.position.set((k % 4) * 0.28 - 0.42, 0.09 + Math.floor(k / 4) * 0.19, 0);
        return b;
      });
    }
  }
  /** Carabelas fondeadas río arriba del astillero (mejora): se mecen en el agua. */
  function setCaravels(on: boolean): void {
    if (on && !caravels.length) {
      for (const ds of [12, 24]) {
        const s0 = SHIPYARD_S - ds, c = riverAt(s0), c2 = riverAt(s0 + 1);
        const ship = makeCaravel(0.75);
        ship.rotation.y = Math.atan2(c2.x - c.x, c2.z - c.z) + (ds === 12 ? Math.PI : 0);
        ship.userData.phase = ds;
        add(ship, c.x, -0.62, c.z);
        caravels.push(ship);
      }
    }
    for (const c of caravels) c.visible = on;
  }
  /** La torre del reloj marca la hora del día; la fragua del arcabucero brilla; las carabelas se mecen. */
  function animateRenaissance(t: number, dt: number): void {
    if (!renBuilt || shownEra < 6) return;
    if (gunGlow) gunGlow.color.setRGB(0.55 + Math.sin(t * 5) * 0.1, 0.2 + Math.sin(t * 7) * 0.05, 0.04);
    for (const c of caravels) {
      c.rotation.z = Math.sin(t * 0.8 + c.userData.phase) * 0.04;
      c.position.y = -0.62 + Math.sin(t * 1.1 + c.userData.phase) * 0.05;
    }
    treadBoost = Math.max(0, treadBoost - dt);
  }

  // ---------- Revolución Industrial: pozo de carbón, fábricas de ladrillo, calderería, altos hornos,
  // la bolsa, el periódico, la estación y el ferrocarril que rodea la ciudad ----------
  // Se construye la primera vez que la ciudad entra en la era 7; la Era Moderna levanta lo suyo más
  // allá de la vía. Las dos eras comparten el humo, el tren y las piezas de los talleres.
  const indStatics: THREE.Object3D[] = [], modStatics: THREE.Object3D[] = [];
  let indBuilt = false, modBuilt = false;
  const brickMat = mat(0x9a4a32), darkBrickMat = mat(0x6e3426), sootMat = mat(0x2e2a28), slate7Mat = mat(0x3e4450);
  const steelMat = mat(0x5a6068, { metalness: 0.5, roughness: 0.5 }), rustMat = mat(0x7a4a2e), coalMat = mat(0x1e1c1c, { roughness: 0.7 });
  const tinMat = mat(0xc8ccd0, { metalness: 0.7, roughness: 0.3 }), posterMat = mat(0xe8dcb8), greenIronMat = mat(0x2f4a3a, { metalness: 0.3 });
  const concreteMat = mat(0xb8b4ac), whiteMat = mat(0xeeeeea), towerMat = mat(0xc8c4bc);
  const glassMat = mat(0x6a94b0, { metalness: 0.5, roughness: 0.2 }), solarMat = mat(0x1e3a6a, { metalness: 0.5, roughness: 0.25 });
  const yellowMat = mat(0xe8b02a), orangeMat = mat(0xe86a2a), redMat = mat(0xb8322a), tomatoMat = mat(0xd83a2a), leafMat8 = mat(0x4a8a3a);
  const brickChipMat = mat(0xb4583a);
  const greenhouseMat = new THREE.MeshStandardMaterial({ color: 0xd8efe8, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const furnaceGlow = new THREE.MeshBasicMaterial({ color: 0xff7a2a }), weldMat = new THREE.MeshBasicMaterial({ color: 0x9ad8ff });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9 });

  // Puestos de trabajo de la era 7 (x de lado, z hacia la villa, como en la geometría local)
  const COAL_MOUTH = zoneAt(COLLIERY, 0, 1.2);
  const COAL_TIP = zoneAt(COLLIERY, 3.9, 2.4);
  const CAN_TABLES = [zoneAt(CANNERY, -1.6, 2.3), zoneAt(CANNERY, 1.6, 2.3)];
  const CAN_PILE = zoneAt(CANNERY, 3.9, 2.6);
  const CAB_BENCHES = [zoneAt(CABINET, -1.6, 2.3), zoneAt(CABINET, 1.6, 2.3)];
  const CHAIR_PILE = zoneAt(CABINET, -3.9, 2.6);
  const BRICK_TABLES = [zoneAt(BRICKWORKS, -1.8, 2.8), zoneAt(BRICKWORKS, 1.8, 2.8)];
  const BRICK_PILE = zoneAt(BRICKWORKS, 4.3, 2.9);
  const BOILERS = [zoneAt(BOILERSHOP, -1.7, 1.7), zoneAt(BOILERSHOP, 1.7, 1.7)];
  const BOILER_PILE = zoneAt(BOILERSHOP, -4, 2.6);
  const PUDDLE = [zoneAt(IRONWORKS, -2, 0.7), zoneAt(IRONWORKS, 2, 0.7)];
  const IRON7_PILE = zoneAt(IRONWORKS, -4.3, 2.8);
  const TICKERS = [zoneAt(EXCHANGE, -1.6, 3.6), zoneAt(EXCHANGE, 1.6, 3.6)];
  const CERT_PILE = zoneAt(EXCHANGE, 4.3, 3.4);
  const NEWS_DESKS = [zoneAt(NEWSPAPER, -1.8, 2.5), zoneAt(NEWSPAPER, 1.8, 2.5)];
  const BUNDLE_PILE = zoneAt(NEWSPAPER, -4.1, 2.7);
  const BUNKERS = [zoneAt(STATION, -5.4, 1.3), zoneAt(STATION, 5.4, 1.3)];
  const COAL_STAGE = zoneAt(STATION, 6.9, 3.1);
  // Puestos de la era 8
  const TRANSFORMERS = [zoneAt(POWER, -2.3, 4.2), zoneAt(POWER, 2.3, 4.2)];
  const CABLE_PILE = zoneAt(POWER, 5.4, 4.6);
  const DESKS8 = [zoneAt(OFFICES, -1.6, 3.6), zoneAt(OFFICES, 1.6, 3.6)];
  const CASE_PILE = zoneAt(OFFICES, 4.4, 4.2);
  const PANELS = [-1, 1.4, 3.8].flatMap((z) => [-4.2, -1.4, 1.4, 4.2].map((x) => zoneAt(SOLAR, x, z - 2.2)));
  const PANEL_PILE = zoneAt(SOLAR, 5.8, 4.4);
  const EXCAVATORS = [zoneAt(OPEN_PIT, -6.4, 4.6), zoneAt(OPEN_PIT, 6.4, 4.6)];
  const PIT_HEAP = zoneAt(OPEN_PIT, 9.3, 2.2);
  const SAPLINGS8 = [-2.6, 0, 2.6].flatMap((z) => [-3.3, -1.1, 1.1, 3.3].map((x) => zoneAt(NURSERY8, x, z - 1)));
  const LOG8_PILE = zoneAt(NURSERY8, 5, 3.4);
  const CARS = [zoneAt(GARAGE, -1.9, 2.1), zoneAt(GARAGE, 1.9, 2.1)];
  const TIRE_PILE = zoneAt(GARAGE, -4.6, 2.8);
  const BENCHES8 = [zoneAt(LAB, -1.5, 2.4), zoneAt(LAB, 1.5, 2.4)];
  const FLASK_PILE = zoneAt(LAB, 4.2, 3);
  const BEDS = [zoneAt(GREENHOUSES, -2.4, 2.6), zoneAt(GREENHOUSES, 2.4, 2.6)];
  const CRATE_PILE = zoneAt(GREENHOUSES, -5.3, 3.6);
  const FORMS = [zoneAt(SITE, -1.2, 2.6), zoneAt(SITE, 2.4, 2.6)];
  const SLAB_PILE = zoneAt(SITE, 5, 3.4);
  const WELD_SPOTS = [zoneAt(STEELWORKS, -2.2, 1.6), zoneAt(STEELWORKS, 2.2, 1.6)];
  const BEAM_PILE = zoneAt(STEELWORKS, -4.6, 2.6);

  let coalLumps: THREE.Object3D[] = [], cans: THREE.Object3D[] = [], chairs: THREE.Object3D[] = [], bricks7: THREE.Object3D[] = [];
  let drums: THREE.Object3D[] = [], pigIron: THREE.Object3D[] = [], strongboxes: THREE.Object3D[] = [], bundles: THREE.Object3D[] = [], coalStage: THREE.Object3D[] = [];
  let cableDrums: THREE.Object3D[] = [], briefcases: THREE.Object3D[] = [], panelStack: THREE.Object3D[] = [], pitCoal: THREE.Object3D[] = [];
  let logs8: THREE.Object3D[] = [], tires: THREE.Object3D[] = [], flasks: THREE.Object3D[] = [], crates: THREE.Object3D[] = [], slabs: THREE.Object3D[] = [], beams: THREE.Object3D[] = [];
  let crystalPalace: THREE.Object3D | null = null, antenna: THREE.Object3D | null = null, extraPanels: THREE.Object3D | null = null;
  let pressRolls: THREE.Object3D[] = [], headWheel: THREE.Object3D | null = null, craneJib: THREE.Object3D | null = null, mixerDrum: THREE.Object3D | null = null;
  let truck: THREE.Object3D | null = null, rocket: THREE.Object3D | null = null, rocketFlame: THREE.Object3D | null = null, plane: THREE.Object3D | null = null;
  const excavatorArms: THREE.Object3D[] = [], rotors: THREE.Object3D[] = [];
  let rocketT = -1, rocketBase = 0;

  function placeIn(list: THREE.Object3D[], o: THREE.Object3D, at: { x: number; z: number }, dy = 0, face = true, solid = true): THREE.Object3D {
    if (face) faceCenter(o, at);
    add(o, at.x, groundY(at.x, at.z, footprint(o)) + dy, at.z);
    spawn(o);
    if (!solid) for (let k = solids.length - 1; k >= 0; k--) if (solids[k].obj === o) solids.splice(k, 1);
    list.push(o);
    return o;
  }
  function heapIn(list: THREE.Object3D[], at: { x: number; z: number }, n: number, make: (k: number) => THREE.Object3D): THREE.Object3D[] {
    const g = new THREE.Group(), items = Array.from({ length: n }, (_, k) => {
      const o = make(k);
      g.add(o);
      return o;
    });
    faceCenter(g, at);
    list.push(spawn(add(g, at.x, heightAt(at.x, at.z), at.z)));
    return items;
  }
  function tableIn(list: THREE.Object3D[], at: { x: number; z: number }, top: THREE.Material, extra?: THREE.Object3D, legs: THREE.Material = timberMat): void {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.75).translate(0, 0.8, 0), top));
    const ls: THREE.BufferGeometry[] = [];
    for (const sx of [-0.55, 0.55]) for (const sz of [-0.3, 0.3]) ls.push(boxAt(0.08, 0.8, 0.08, sx, 0.4, sz));
    g.add(new THREE.Mesh(mergeGeometries(ls)!, legs));
    if (extra) g.add(extra);
    placeIn(list, g, at);
  }
  /** Chimenea de ladrillo con su remate, como geometrías para unir. */
  const stackGeos = (x: number, z: number, h: number, r: number) => [
    new THREE.CylinderGeometry(r * 0.7, r, h, 8).translate(x, h / 2, z),
    new THREE.CylinderGeometry(r * 0.9, r * 0.8, 0.5, 8).translate(x, h, z),
  ];
  /** Ventanas en filas sobre la fachada que mira a la villa (z = zf). */
  function windowRows(g: THREE.Object3D, w: number, zf: number, rows: number[], n: number, ww = 0.55, wh = 0.8): void {
    for (const y of rows) for (let k = 0; k < n; k++) pane(g, -w / 2 + (k + 0.5) * (w / n), y, zf, ww, wh);
  }

  // ---------- Humo y vapor ----------
  // Bocanadas instanciadas que suben, crecen y se deshacen: humo negro del carbón y vapor blanco
  interface Puff8 { age: number; x: number; y: number; z: number; s: number; life: number }
  interface Smoke { obj: THREE.Object3D; x: number; y: number; z: number; rate: number; size: number; white: boolean; acc: number }
  const SMOKE_N = 110;
  const smokeKinds = [0x4a4644, 0xf2f2ee].map((color, k) => {
    const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color, flatShading: true, transparent: true, opacity: k ? 0.62 : 0.5, depthWrite: false }), SMOKE_N);
    m.frustumCulled = false;
    m.visible = false;
    for (let i = 0; i < SMOKE_N; i++) m.setMatrixAt(i, tmpM4.makeScale(0, 0, 0));
    scene.add(m);
    return { mesh: m, puffs: Array.from({ length: SMOKE_N }, (): Puff8 => ({ age: 1, x: 0, y: 0, z: 0, s: 1, life: 6 })), next: 0 };
  });
  const smokeSources: Smoke[] = [];
  function smokeAt(x: number, y: number, z: number, size: number, white: boolean, life = 6): void {
    const kind = smokeKinds[white ? 1 : 0];
    const p = kind.puffs[kind.next];
    kind.next = (kind.next + 1) % SMOKE_N;
    Object.assign(p, { age: 0, x, y, z, s: size, life });
  }
  /** Una chimenea que echa humo mientras su edificio se ve: `local` es la boca en la pieza. */
  function smokeFrom(obj: THREE.Object3D, local: THREE.Vector3, rate: number, size: number, white = false): void {
    obj.updateMatrixWorld(true);
    const w = obj.localToWorld(local.clone());
    smokeSources.push({ obj, x: w.x, y: w.y, z: w.z, rate, size, white, acc: fx() });
  }
  function animateSmoke(dt: number): void {
    for (const s of smokeSources) {
      if (!s.obj.visible || !s.obj.parent) continue;
      s.acc += dt * s.rate;
      while (s.acc >= 1) {
        s.acc -= 1;
        smokeAt(s.x + (fx() - 0.5) * 0.3, s.y, s.z + (fx() - 0.5) * 0.3, s.size, s.white);
      }
    }
    for (const kind of smokeKinds) {
      kind.puffs.forEach((p, i) => {
        if (p.age >= 1) return;
        p.age = Math.min(1, p.age + dt / p.life);
        p.y += dt * (1.4 + p.s * 0.3);
        p.x += dt * 0.5;
        p.z += dt * 0.2;
        const k = p.age >= 1 ? 0 : p.s * (0.35 + p.age * 1.5) * (p.age > 0.75 ? (1 - p.age) / 0.25 : 1);
        kind.mesh.setMatrixAt(i, tmpM4.compose(tmpV3.set(p.x, p.y, p.z), tmpQ4.identity(), tmpS3.setScalar(k)));
      });
      kind.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- El ferrocarril ----------
  // La vía da la vuelta a la ciudad en el anillo TRACK_R. Su altura sigue el terreno suavizado y,
  // sobre el valle del río, va por un puente de hierro con pilares.
  const TRACK_N = 720;
  const trackH: number[] = [];
  function buildTrackHeights(): void {
    const raw: number[] = [];
    for (let k = 0; k < TRACK_N; k++) {
      const a = (k / TRACK_N) * Math.PI * 2, x = Math.cos(a) * TRACK_R, z = Math.sin(a) * TRACK_R;
      raw.push(riverDist(x, z) < RIVER_W + 11 ? Math.max(heightAt(x, z), 1.7) : heightAt(x, z));
    }
    for (let k = 0; k < TRACK_N; k++) {
      let s = 0;
      for (let j = -6; j <= 6; j++) s += raw[(k + j + TRACK_N) % TRACK_N];
      trackH[k] = Math.max(s / 13, raw[k] - 0.25) + 0.12;
    }
  }
  const trackY = (a: number) => {
    const f = ((((a / (Math.PI * 2)) % 1) + 1) % 1) * TRACK_N, k = Math.floor(f) % TRACK_N;
    return THREE.MathUtils.lerp(trackH[k], trackH[(k + 1) % TRACK_N], f - Math.floor(f));
  };
  const ringAt = (a: number, r = TRACK_R) => new THREE.Vector3(Math.cos(a) * r, trackY(a), Math.sin(a) * r);
  /** Caja de sección w × h tendida de a hasta b. */
  const beamM = new THREE.Matrix4();
  function beamGeo(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(w, h, len + 0.02);
    g.applyMatrix4(beamM.identity().lookAt(b, a, tmpUp));
    return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  }
  function buildTrack(): void {
    buildTrackHeights();
    const sleepers: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], girders: THREE.BufferGeometry[] = [], piers: THREE.BufferGeometry[] = [];
    const SEG = 360;
    for (let k = 0; k < SEG; k++) {
      const a0 = (k / SEG) * Math.PI * 2, a1 = ((k + 1) / SEG) * Math.PI * 2, am = (a0 + a1) / 2;
      for (const off of [-0.72, 0.72]) {
        const p0 = ringAt(a0, TRACK_R + off), p1 = ringAt(a1, TRACK_R + off);
        p0.y += 0.16;
        p1.y += 0.16;
        rails.push(beamGeo(p0, p1, 0.1, 0.12));
      }
      for (const a of [a0, am]) {
        const i0 = ringAt(a, TRACK_R - 1.1), o0 = ringAt(a, TRACK_R + 1.1);
        sleepers.push(beamGeo(i0, o0, 0.32, 0.12));
      }
      // Puente: donde el suelo queda muy por debajo de la vía
      const mid = ringAt(am), ground = heightAt(mid.x, mid.z);
      if (ground < mid.y - 0.45) {
        for (const off of [-1.25, 1.25]) {
          const p0 = ringAt(a0, TRACK_R + off), p1 = ringAt(a1, TRACK_R + off);
          p0.y -= 0.15;
          p1.y -= 0.15;
          girders.push(beamGeo(p0, p1, 0.18, 0.7));
          p0.y += 0.75;
          p1.y += 0.75;
          girders.push(beamGeo(p0, p1, 0.12, 0.12));
        }
        girders.push(beamGeo(ringAt(a0, TRACK_R - 1.3).setY(mid.y - 0.45), ringAt(a0, TRACK_R + 1.3).setY(mid.y - 0.45), 0.5, 0.25));
        if (k % 5 === 0) {
          const h = mid.y + 2;
          piers.push(new THREE.BoxGeometry(2.6, h, 0.9).rotateY(-am).translate(mid.x, mid.y - 0.5 - h / 2, mid.z));
        }
      }
    }
    // Balasto: una cinta de grava bajo las traviesas
    const pos: number[] = [], idx: number[] = [];
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      for (const off of [-1.45, 1.45]) {
        const p = ringAt(a, TRACK_R + off), g = heightAt(p.x, p.z);
        pos.push(p.x, Math.max(g, p.y - 0.6) + 0.04, p.z);
      }
      if (k < SEG) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
    }
    const ballast = new THREE.BufferGeometry();
    ballast.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ballast.setIndex(idx);
    ballast.computeVertexNormals();
    const g = new THREE.Group();
    const ballastMesh = new THREE.Mesh(ballast, mat(0x6a6260, { side: THREE.DoubleSide }));
    g.add(ballastMesh, meshOf(sleepers, barrelMat), meshOf(rails, steelMat));
    if (girders.length) g.add(meshOf(girders, rustMat), meshOf(piers, castleStoneMat));
    add(g);
    g.traverse((c) => (c.castShadow = false));
    indStatics.push(g);
  }
  /** Locomotora de vapor: caldera, cabina, chimenea, ruedas rojas y el quitapiedras delante (+z). */
  function makeLoco(): THREE.Group {
    const g = new THREE.Group();
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.7, 10).rotateX(Math.PI / 2), sootMat);
    boiler.position.set(0, 1.25, 0.45);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.2), mat(0x2f4a3a));
    cab.position.set(0, 1.45, -1.35);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 1.4), sootMat);
    roof.position.set(0, 2.25, -1.35);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.25, 4.2), sootMat);
    frame.position.set(0, 0.6, 0);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.75, 8), sootMat);
    stack.position.set(0, 1.95, 1.45);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), brassMat);
    dome.position.set(0, 1.78, 0.2);
    const catcher = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.6, 4).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4), redMat);
    catcher.position.set(0, 0.45, 2.25);
    const wheels: THREE.BufferGeometry[] = [];
    for (const sx of [-0.66, 0.66]) for (const z of [-1.1, 0, 1.1]) wheels.push(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 10).rotateZ(Math.PI / 2).translate(sx, 0.45, z));
    g.add(boiler, cab, roof, frame, stack, dome, catcher, meshOf(wheels, redMat));
    pane(g, 0.71, 1.6, -1.35, 0.5, 0.5, Math.PI / 2);
    pane(g, -0.71, 1.6, -1.35, 0.5, 0.5, Math.PI / 2);
    g.userData.stack = new THREE.Vector3(0, 2.4, 1.45);
    return g;
  }
  function makeCar(kind: number): THREE.Group {
    const g = new THREE.Group();
    const wheels: THREE.BufferGeometry[] = [];
    for (const sx of [-0.66, 0.66]) for (const z of [-1.2, 1.2]) wheels.push(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8).rotateZ(Math.PI / 2).translate(sx, 0.35, z));
    g.add(meshOf(wheels, sootMat));
    if (kind === 0) {
      // Ténder de carbón
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 2.8).translate(0, 1.05, 0), mat(0x2f4a3a)));
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.4, 1.7).translate(0, 1.6, 0), coalMat));
    } else {
      // Vagón de pasajeros con ventanillas y techo curvo
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, 3.6).translate(0, 1.25, 0), kind === 1 ? mat(0x6a1a22) : mat(0x2a3a5a)));
      const roofG = new THREE.CylinderGeometry(0.85, 0.85, 3.7, 10, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, 0.3, 1).translate(0, 1.95, 0);
      g.add(new THREE.Mesh(roofG, sootMat));
      for (const sx of [-0.77, 0.77]) for (const z of [-1.2, 0, 1.2]) pane(g, sx, 1.45, z, 0.6, 0.5, Math.PI / 2);
    }
    return g;
  }
  /** Tren de alta velocidad de la Era Moderna: blanco, con el morro afilado y una franja azul. */
  function makeBullet(front: boolean): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 4.6).translate(0, 1.15, 0), whiteMat));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.18, 4.6).translate(0, 0.95, 0), mat(0x1e5aa8)));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.35, 4.2).translate(0, 1.55, 0), windowMat));
    if (front) {
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 2.2), whiteMat);
      nose.position.set(0, 1.15, 2.3);
      g.add(nose);
    }
    return g;
  }
  interface Train { cars: THREE.Group[]; a: number; speed: number; steam: boolean; gap: number }
  const trains: Train[] = [];
  function makeTrain(kinds: number[], a: number, speed: number, steam: boolean): Train {
    const cars = kinds.map((k, j) => {
      const c = k < 0 ? makeLoco() : k >= 10 ? makeBullet(j === 0) : makeCar(k);
      add(c);
      c.traverse((o) => (o.castShadow = false));
      return c;
    });
    const t: Train = { cars, a, speed, steam, gap: steam ? 4.4 : 4.9 };
    trains.push(t);
    placeTrain(t);
    return t;
  }
  function placeTrain(t: Train): void {
    t.cars.forEach((c, j) => {
      const a = t.a - (j * t.gap) / TRACK_R;
      c.position.copy(ringAt(a));
      c.position.y += 0.14;
      c.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
    });
  }

  function buildIndustrial(): void {
    indBuilt = true;
    buildTrack();
    // Pozo de carbón: castillete de hierro sobre el pozo con su rueda, casa de máquinas con chimenea
    // y la escombrera de carbón; los mineros bajan por el pozo y suben con el carbón
    {
      const g = new THREE.Group();
      const legs: THREE.BufferGeometry[] = [];
      for (const sx of [-1.3, 1.3]) {
        legs.push(beamGeo(new THREE.Vector3(sx, 0, 0.6), new THREE.Vector3(sx * 0.45, 7, -0.2), 0.2, 0.2));
        legs.push(beamGeo(new THREE.Vector3(sx, 0, -1.4), new THREE.Vector3(sx * 0.45, 7, -0.2), 0.2, 0.2));
        for (const y of [2.2, 4.4]) legs.push(boxAt(0.12, 0.12, 1.8, sx * (1 - y / 10), y, -0.4));
      }
      legs.push(boxAt(1.4, 0.2, 0.4, 0, 7, -0.2));
      g.add(meshOf(legs, steelMat));
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 1.6), new THREE.MeshBasicMaterial({ color: 0x0a0806 }));
      shaft.position.set(0, 0.06, -0.2);
      const curb = new THREE.Mesh(mergeGeometries([boxAt(2, 0.3, 0.2, 0, 0.15, 0.7), boxAt(2, 0.3, 0.2, 0, 0.15, -1.1), boxAt(0.2, 0.3, 1.8, -0.9, 0.15, -0.2), boxAt(0.2, 0.3, 1.8, 0.9, 0.15, -0.2)])!, castleStoneMat);
      const wheel = new THREE.Group();
      wheel.position.set(0, 7.3, -0.2);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.07, 4, 16).rotateY(Math.PI / 2), steelMat);
      const spokes = new THREE.Mesh(mergeGeometries([boxAt(0.06, 1.8, 0.06, 0, 0, 0), boxAt(0.06, 0.06, 1.8, 0, 0, 0)])!, steelMat);
      wheel.add(rim, spokes);
      headWheel = wheel;
      g.add(shaft, curb, wheel);
      placeIn(indStatics, g, zoneAt(COLLIERY, 0, 1.4), 0, true, false);
      const eng = new THREE.Group();
      eng.add(new THREE.Mesh(new THREE.BoxGeometry(4, 3.4, 3).translate(0, 1.7, 0), brickMat));
      eng.add(new THREE.Mesh(gableGeo(3.4, 4.4, 1.2).rotateY(Math.PI / 2).translate(0, 3.4, 0), slate7Mat));
      eng.add(meshOf(stackGeos(1.4, -0.9, 9, 0.55), darkBrickMat));
      windowRows(eng, 4, 1.53, [2.2], 3, 0.5, 1);
      placeIn(indStatics, eng, zoneAt(COLLIERY, -3.6, -2.4));
      smokeFrom(eng, new THREE.Vector3(1.4, 9.3, -0.9), 0.9, 0.8);
      coalLumps = heapIn(indStatics, COAL_TIP, 10, (k) => {
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32 + (k % 3) * 0.06, 0), coalMat);
        b.position.set(Math.cos(k * 2.4) * (0.55 - k * 0.04), 0.2 + Math.floor(k / 4) * 0.3, Math.sin(k * 2.4) * (0.55 - k * 0.04));
        return b;
      });
      // Vagonetas en su vía corta junto a la escombrera
      const tubs = new THREE.Group();
      for (const x of [-0.8, 0.8]) {
        tubs.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.8).translate(x, 0.55, 0), rustMat));
        tubs.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0).scale(1.1, 0.5, 0.9).translate(x, 0.9, 0), coalMat));
      }
      tubs.add(new THREE.Mesh(mergeGeometries([boxAt(3.4, 0.06, 0.06, 0, 0.12, -0.3), boxAt(3.4, 0.06, 0.06, 0, 0.12, 0.3)])!, steelMat));
      placeIn(indStatics, tubs, zoneAt(COLLIERY, -3.4, 2.8));
    }
    // Fábrica de conservas: nave de ladrillo con tejado en diente de sierra, chimenea y mesas de enlatar
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(7, 3, 3.6).translate(0, 1.5, -1.6), brickMat));
      const saw: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 4; k++) saw.push(new THREE.CylinderGeometry(0.75, 0.75, 3.6, 3, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, 0.9, 1).translate(-2.62 + k * 1.75, 3.35, -1.6));
      g.add(meshOf(saw, slate7Mat));
      g.add(meshOf(stackGeos(2.6, -2.9, 8, 0.45), darkBrickMat));
      windowRows(g, 7, 0.23, [1.7], 5, 0.7, 1.1);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.06), posterMat);
      sign.position.set(0, 2.6, 0.26);
      g.add(sign);
      placeIn(indStatics, g, CANNERY);
      smokeFrom(g, new THREE.Vector3(2.6, 8.3, -2.9), 0.7, 0.6);
      for (const at of CAN_TABLES) {
        const c = new THREE.Group();
        for (let k = 0; k < 4; k++) c.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 8).translate(-0.4 + k * 0.27, 0.93, 0), tinMat));
        tableIn(indStatics, at, plankMat, c);
      }
      cans = heapIn(indStatics, CAN_PILE, 10, (k) => {
        const b = new THREE.Group();
        for (let q = 0; q < 4; q++) b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8).translate((q % 2) * 0.22 - 0.11, 0.1, Math.floor(q / 2) * 0.22 - 0.11), tinMat));
        b.add(new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.04, 0.48).translate(0, 0.22, 0), plankMat));
        b.position.set((k % 3) * 0.52 - 0.52, Math.floor(k / 3) * 0.26, 0);
        if (k >= 9) b.position.set(0, 0.78, 0);
        return b;
      });
    }
    // Ebanistería: taller de madera con tejado a dos aguas, bancos de carpintero y las sillas hechas
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(6.4, 3, 3.4).translate(0, 1.5, -1.6), mat(0x8a6a48)));
      g.add(new THREE.Mesh(gableGeo(3.9, 6.8, 1.3).rotateY(Math.PI / 2).translate(0, 3, -1.6), slate7Mat));
      g.add(new THREE.Mesh(mergeGeometries([boxAt(6.5, 0.4, 3.5, 0, 0.2, -1.6), boxAt(0.3, 3, 0.1, -3.05, 1.5, 0.12), boxAt(0.3, 3, 0.1, 3.05, 1.5, 0.12)])!, brickMat));
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.06), beamMat);
      door.position.set(0, 1.1, 0.12);
      g.add(door);
      windowRows(g, 6.4, 0.13, [1.7], 4, 0.6, 0.9);
      placeIn(indStatics, g, CABINET);
      CAB_BENCHES.forEach((at) => {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.3), plankMat);
        plank.position.set(0, 0.88, 0.1);
        tableIn(indStatics, at, timberMat, plank);
      });
      chairs = heapIn(indStatics, CHAIR_PILE, 6, (k) => {
        const c = new THREE.Group();
        c.add(meshOf([boxAt(0.45, 0.06, 0.45, 0, 0.45, 0), boxAt(0.45, 0.5, 0.06, 0, 0.72, -0.2), ...[-0.19, 0.19].flatMap((x) => [boxAt(0.05, 0.45, 0.05, x, 0.22, 0.19), boxAt(0.05, 0.45, 0.05, x, 0.22, -0.19)])], barrelMat));
        c.position.set((k % 3) * 0.6 - 0.6, Math.floor(k / 3) * 0.52, 0);
        c.rotation.y = (k % 2) * Math.PI;
        return c;
      });
    }
    // Ladrillar: horno Hoffmann alargado con su chimenea alta en el centro y las eras de moldeo
    {
      const g = new THREE.Group();
      const kiln = new THREE.CylinderGeometry(1.7, 1.9, 2.2, 14).scale(2.4, 1, 1).translate(0, 1.1, -2);
      g.add(new THREE.Mesh(kiln, darkBrickMat));
      const arches: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 6; k++) arches.push(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 8, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(-2.8 + k * 1.12, 0.9, -0.12 + Math.abs(k - 2.5) * -0.12));
      g.add(meshOf(arches, new THREE.MeshBasicMaterial({ color: 0x1a0c06 })));
      g.add(meshOf([...stackGeos(0, -2, 12, 0.7), new THREE.CylinderGeometry(4.3, 4.3, 0.2, 14).scale(1, 1, 0.45).translate(0, 2.3, -2)], brickMat));
      placeIn(indStatics, g, BRICKWORKS);
      smokeFrom(g, new THREE.Vector3(0, 12.3, -2), 1.1, 0.9);
      for (const at of BRICK_TABLES) {
        const b = new THREE.Group();
        for (let k = 0; k < 4; k++) b.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.12).translate(-0.4 + k * 0.27, 0.9, 0), brickChipMat));
        tableIn(indStatics, at, plankMat, b);
      }
      bricks7 = heapIn(indStatics, BRICK_PILE, 8, (k) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.5), k % 2 ? brickMat : brickChipMat);
        b.position.set((k % 2) * 0.74 - 0.37, 0.15 + Math.floor(k / 2) * 0.31, 0);
        return b;
      });
    }
    // Calderería: cobertizo de hierro abierto por delante y dos calderas a medio remachar
    {
      const g = new THREE.Group();
      const cols: THREE.BufferGeometry[] = [];
      for (const x of [-3.2, 0, 3.2]) cols.push(boxAt(0.2, 3.4, 0.2, x, 1.7, 0.2));
      cols.push(boxAt(6.6, 3.2, 0.25, 0, 1.6, -2.1), boxAt(0.25, 3.2, 2.3, -3.2, 1.6, -1), boxAt(0.25, 3.2, 2.3, 3.2, 1.6, -1));
      g.add(meshOf(cols, steelMat));
      const roof = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 3.1), rustMat);
      roof.position.set(0, 3.5, -0.9);
      roof.rotation.x = 0.12;
      g.add(roof);
      g.add(meshOf(stackGeos(-2.4, -2.6, 6.5, 0.35), darkBrickMat));
      placeIn(indStatics, g, BOILERSHOP);
      smokeFrom(g, new THREE.Vector3(-2.4, 6.8, -2.6), 0.6, 0.5);
      for (const at of BOILERS) {
        const b = new THREE.Group();
        b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.8, 12).rotateZ(Math.PI / 2).translate(0, 0.75, 0), steelMat));
        b.add(new THREE.Mesh(mergeGeometries([boxAt(0.2, 0.25, 0.9, -0.6, 0.12, 0), boxAt(0.2, 0.25, 0.9, 0.6, 0.12, 0)])!, timberMat));
        const rivets: THREE.BufferGeometry[] = [];
        for (const x of [-0.6, 0, 0.6]) rivets.push(new THREE.TorusGeometry(0.56, 0.025, 3, 14).rotateY(Math.PI / 2).translate(x, 0.75, 0));
        b.add(meshOf(rivets, brassMat));
        placeIn(indStatics, b, at);
      }
      drums = heapIn(indStatics, BOILER_PILE, 6, (k) => {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 10), k % 2 ? steelMat : rustMat);
        d.position.set((k % 3) * 0.64 - 0.64, 0.3 + Math.floor(k / 3) * 0.6, 0);
        return d;
      });
    }
    // Ferrería: alto horno de ladrillo detrás y dos hornos de pudelar con la boca encendida
    {
      const g = new THREE.Group();
      const blast = new THREE.CylinderGeometry(1.2, 1.8, 6, 10).translate(0, 3, -3.4);
      g.add(meshOf([blast, ...stackGeos(0, -3.4, 9, 0.5)], darkBrickMat));
      g.add(meshOf([beamGeo(new THREE.Vector3(0, 6, -3.4), new THREE.Vector3(3, 2.6, -3.2), 0.4, 0.4), boxAt(0.6, 2.6, 0.6, 3, 1.3, -3.2)], rustMat));
      placeIn(indStatics, g, IRONWORKS);
      smokeFrom(g, new THREE.Vector3(0, 9.3, -3.4), 1, 0.85);
      PUDDLE.forEach((at) => {
        const f = new THREE.Group();
        f.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.5, 1.6).translate(0, 0.75, 0), brickMat));
        f.add(meshOf(stackGeos(0.4, -0.5, 4.5, 0.3), darkBrickMat));
        const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), furnaceGlow);
        mouth.position.set(0, 0.7, 0.81);
        f.add(mouth);
        placeIn(indStatics, f, at);
        smokeFrom(f, new THREE.Vector3(0.4, 4.8, -0.5), 0.5, 0.45);
      });
      pigIron = heapIn(indStatics, IRON7_PILE, 9, (k) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.18), k % 3 ? ironMat : rustMat);
        b.position.set(0, 0.07 + Math.floor(k / 3) * 0.15, (k % 3) * 0.24 - 0.24);
        b.rotation.y = Math.floor(k / 3) % 2 ? Math.PI / 2 : 0;
        return b;
      });
    }
    // La bolsa: edificio de piedra con pórtico de columnas, frontón y reloj; delante, los teletipos
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(8, 4.4, 4).translate(0, 2.2, -2), creamMat));
      const cols: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 6; k++) cols.push(...columnGeos(-3.2 + k * 1.28, 0.9, 3.8, 0.2));
      cols.push(boxAt(8.4, 0.4, 2.2, 0, 4.1, -0.1), boxAt(8.6, 0.35, 5, 0, 0.17, -1.4), boxAt(8.4, 0.2, 4.4, 0, 4.5, -2));
      g.add(meshOf(cols, marbleMat));
      // Frontón triangular sobre el pórtico, con el reloj en el tímpano
      const ped = new THREE.Mesh(gableGeo(8.4, 2.2, 1.3).translate(0, 4.3, -0.1), marbleShadeMat);
      g.add(ped);
      const clock = new THREE.Mesh(new THREE.CircleGeometry(0.38, 14), paperMat);
      clock.position.set(0, 4.75, 1.02);
      g.add(clock);
      windowRows(g, 6, 0.03, [1.4, 3.1], 4, 0.55, 1);
      placeIn(indStatics, g, EXCHANGE);
      for (const at of TICKERS) {
        const t = new THREE.Group();
        t.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 1, 6).translate(0, 0.5, 0), brassMat));
        t.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1, 0), glassMat));
        t.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.9).translate(0.1, 1.02, 0.45), paperMat));
        placeIn(indStatics, t, at);
      }
      strongboxes = heapIn(indStatics, CERT_PILE, 6, (k) => {
        const b = new THREE.Group();
        b.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.45).translate(0, 0.22, 0), greenIronMat));
        b.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02).translate(0, 0.3, 0.235), brassMat));
        b.position.set((k % 2) * 0.66 - 0.33, Math.floor(k / 2) * 0.46, 0);
        return b;
      });
    }
    // El periódico: casa de ladrillo de tres plantas con el rótulo, la rotativa y las mesas de redacción
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(6.4, 5.4, 3.4).translate(0, 2.7, -1.8), brickMat));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.3, 3.6).translate(0, 5.5, -1.8), slate7Mat));
      windowRows(g, 6.4, -0.07, [1.6, 3.2, 4.6], 4, 0.6, 0.9);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.7, 0.08), posterMat);
      sign.position.set(0, 6.0, -0.4);
      g.add(sign);
      placeIn(indStatics, g, NEWSPAPER);
      // Rotativa: bastidor de hierro, rodillos que giran y la bobina de papel
      const press = new THREE.Group();
      press.add(meshOf([boxAt(0.15, 1.4, 1.2, -0.75, 0.7, 0), boxAt(0.15, 1.4, 1.2, 0.75, 0.7, 0)], greenIronMat));
      pressRolls = [0.5, 1.0].map((y, k) => {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 10).rotateZ(Math.PI / 2), k ? inkMat : steelMat);
        r.position.set(0, y, k ? -0.2 : 0.2);
        press.add(r);
        return r;
      });
      press.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.02, 1.3).translate(0, 0.75, 0.75).rotateX(0.2), paperMat));
      placeIn(indStatics, press, zoneAt(NEWSPAPER, 0, 1.5));
      for (const at of NEWS_DESKS) {
        const typewriter = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.3), sootMat);
        typewriter.position.y = 0.92;
        tableIn(indStatics, at, barrelMat, typewriter);
      }
      bundles = heapIn(indStatics, BUNDLE_PILE, 8, (k) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.25, 0.4), paperMat);
        b.position.set((k % 2) * 0.6 - 0.3, 0.12 + Math.floor(k / 2) * 0.26, 0);
        b.rotation.y = (k % 3) * 0.12;
        return b;
      });
    }
    // Estación: edificio de ladrillo con reloj, andén con marquesina junto a la vía, carboneras y
    // un depósito de agua para las locomotoras
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 2.6).translate(0, 1.6, 0.6), brickMat));
      g.add(new THREE.Mesh(gableGeo(3.2, 7.4, 1.2).rotateY(Math.PI / 2).translate(0, 3.2, 0.6), slate7Mat));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(14, 0.7, 1.7).translate(0, 0.35, -2.4), castleStoneMat));
      const posts: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 5; k++) posts.push(boxAt(0.12, 3, 0.12, -5.6 + k * 2.8, 2.2, -2));
      g.add(meshOf(posts, greenIronMat));
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.12, 2.4), greenIronMat);
      canopy.position.set(0, 3.6, -2.1);
      canopy.rotation.x = -0.1;
      g.add(canopy);
      const clock = new THREE.Mesh(new THREE.CircleGeometry(0.4, 14), paperMat);
      clock.position.set(0, 2.7, 1.92);
      g.add(clock);
      windowRows(g, 7, 1.92, [1.4], 4, 0.6, 1.2);
      for (const x of [-2.6, 2.6]) pane(g, x, 1.4, -0.72, 0.6, 1.2);
      placeIn(indStatics, g, STATION, 0, true, false);
      for (const p of [zoneAt(STATION, -2.2, 0.6), zoneAt(STATION, 2.2, 0.6)]) solids.push({ obj: g, x: p.x, z: p.z, r: 1.6 });
      for (const at of BUNKERS) {
        const b = new THREE.Group();
        b.add(meshOf([boxAt(1.6, 0.9, 0.1, 0, 0.45, -0.6), boxAt(0.1, 0.9, 1.2, -0.8, 0.45, 0), boxAt(0.1, 0.9, 1.2, 0.8, 0.45, 0)], timberMat));
        b.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0).scale(1.1, 0.45, 0.8).translate(0, 0.35, -0.1), coalMat));
        placeIn(indStatics, b, at);
      }
      const water = new THREE.Group();
      water.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.4, 10).translate(0, 4, 0), rustMat));
      water.add(meshOf([0, 1, 2, 3].map((k) => boxAt(0.14, 3.4, 0.14, Math.cos(k * 1.57 + 0.78) * 0.7, 1.7, Math.sin(k * 1.57 + 0.78) * 0.7)), timberMat));
      placeIn(indStatics, water, zoneAt(STATION, -7.4, 0.4));
      coalStage = heapIn(indStatics, COAL_STAGE, 6, (k) => {
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), coalMat);
        b.position.set((k % 3) * 0.45 - 0.45, 0.2 + Math.floor(k / 3) * 0.3, 0);
        return b;
      });
    }
    // Palacio de Cristal de la Gran Exposición (mejora): nave de hierro y vidrio con bóveda y crucero
    {
      const g = new THREE.Group();
      const vault = (len: number, r: number, along: boolean, y: number) => {
        const c = new THREE.CylinderGeometry(r, r, len, 12, 1, true, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2);
        if (along) c.rotateY(Math.PI / 2);
        return c.translate(0, y, 0);
      };
      g.add(new THREE.Mesh(mergeGeometries([new THREE.BoxGeometry(9, 2.4, 3.6).translate(0, 1.2, 0), new THREE.BoxGeometry(3, 2.4, 6.4).translate(0, 1.2, 0)])!, greenhouseMat));
      g.add(new THREE.Mesh(mergeGeometries([vault(9, 1.8, false, 2.4), vault(6.4, 1.5, true, 2.4)])!, greenhouseMat));
      const ribs: THREE.BufferGeometry[] = [];
      for (let k = 0; k <= 8; k++) ribs.push(new THREE.TorusGeometry(1.8, 0.05, 3, 10, Math.PI).rotateY(Math.PI / 2).translate(-4.5 + k * 1.125, 2.4, 0));
      for (let k = 0; k <= 10; k++) ribs.push(boxAt(0.08, 2.4, 0.08, -4.5 + k * 0.9, 1.2, 1.8), boxAt(0.08, 2.4, 0.08, -4.5 + k * 0.9, 1.2, -1.8));
      ribs.push(boxAt(9.2, 0.12, 3.8, 0, 2.4, 0), boxAt(9.2, 0.3, 3.8, 0, 0.15, 0));
      g.add(meshOf(ribs, mat(0xd8dde0, { metalness: 0.4 })));
      const flags: THREE.BufferGeometry[] = [];
      for (const x of [-4.5, 4.5]) flags.push(boxAt(0.05, 1.6, 0.05, x, 4.6, 0), boxAt(0.6, 0.35, 0.02, x + 0.3, 5.2, 0));
      g.add(meshOf(flags, redMat));
      crystalPalace = placeIn(indStatics, g, EXHIBITION);
      crystalPalace.visible = false;
    }
    makeTrain([-1, 0, 1, 2, 1], 0.3, 0.05, true);
  }
  /** Segundo tren de vapor (Ferrocarril): de mercancías, media vuelta por detrás del primero. */
  let freight = false;
  function addFreight(): void {
    if (freight) return;
    freight = true;
    makeTrain([-1, 0, 0, 0], Math.PI + 0.3, 0.05, true);
  }

  // Casas obreras de ladrillo de la Revolución Industrial: dos plantas, tejado de pizarra a dos
  // aguas, una chimenea en cada hastial y ventanas de guillotina con el alféizar blanco.
  const BRICK_TONES = [brickMat, darkBrickMat, mat(0xa85a3a), mat(0x8a5040)];
  function makeBrickHouse(x: number, z: number, s: number, tone: number) {
    const g = new THREE.Group();
    const w = 2.4 * s, d = 2 * s, h = 2.7 * s;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), BRICK_TONES[(tone + Math.round(Math.abs(x * 3 + z * 7))) % BRICK_TONES.length]);
    wall.position.y = h / 2;
    const roof = new THREE.Mesh(gableGeo(d + 0.3 * s, w + 0.2 * s, 0.9 * s).rotateY(Math.PI / 2), slate7Mat);
    roof.position.y = h;
    const stacks = [boxAt(0.35 * s, 1.1 * s, 0.4 * s, -w * 0.4, h + 0.5 * s, 0), boxAt(0.35 * s, 1.1 * s, 0.4 * s, w * 0.4, h + 0.5 * s, 0)];
    g.add(wall, roof, new THREE.Mesh(mergeGeometries(stacks)!, darkBrickMat));
    const sills: THREE.BufferGeometry[] = [boxAt(w + 0.06, 0.1 * s, d + 0.06, 0, h * 0.5, 0)];
    for (const sx of [-1, 1]) {
      for (const [zz, yy] of [[d / 2 + 0.03, h * 0.74], [-d / 2 - 0.03, h * 0.74], [-d / 2 - 0.03, h * 0.28]] as const) {
        pane(g, sx * w * 0.27, yy, zz, 0.36 * s, 0.56 * s);
        sills.push(boxAt(0.46 * s, 0.06 * s, 0.12 * s, sx * w * 0.27, yy - 0.31 * s, zz));
      }
    }
    pane(g, w * 0.27, h * 0.28, d / 2 + 0.03, 0.36 * s, 0.56 * s);
    sills.push(boxAt(0.46 * s, 0.06 * s, 0.12 * s, w * 0.27, h * 0.28 - 0.31 * s, d / 2 + 0.03));
    g.add(new THREE.Mesh(mergeGeometries(sills)!, posterMat));
    const poles = new THREE.Group(); // humo de la chimenea
    poles.position.set(-w * 0.4, h + 1.15 * s, 0);
    g.add(poles);
    const door = new THREE.Group();
    door.position.set(-w * 0.22, 1.0 * s, d / 2 + 0.04);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.55 * s, 1.0 * s), mat(0x2f4a3a, { side: THREE.DoubleSide }));
    leaf.position.y = -0.5 * s;
    door.add(leaf);
    g.add(door);
    g.userData.door = door;
    g.userData.poles = poles;
    g.userData.phase = fx() * 6;
    const gy = groundY(x, z, 1.2 * s);
    add(g, x, gy, z);
    g.lookAt(0, gy, 0);
    return bakeStatic(g);
  }
  // Casas de la Era Moderna: bloques de dos plantas enlucidos de colores claros, azotea con su
  // pretil y una placa solar, ventanales y un balcón con barandilla de cristal.
  const MODERN_WALLS = [mat(0xf2efe8), mat(0xd8e2e8), mat(0xe8dcc8), mat(0xc8d8c8)];
  function makeModernHouse(x: number, z: number, s: number, tone: number) {
    const g = new THREE.Group();
    const w = 2.5 * s, d = 2.1 * s, h = 2.8 * s;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MODERN_WALLS[(tone + Math.round(Math.abs(x * 3 + z * 7))) % MODERN_WALLS.length]);
    wall.position.y = h / 2;
    const trim = [boxAt(w + 0.1, 0.25 * s, d + 0.1, 0, h + 0.1 * s, 0), boxAt(w * 0.9, 0.08 * s, 0.5 * s, 0, h * 0.5, d / 2 + 0.25 * s)];
    g.add(wall, new THREE.Mesh(mergeGeometries(trim)!, towerMat));
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.35 * s, 0.03), greenhouseMat);
    rail.position.set(0, h * 0.5 + 0.2 * s, d / 2 + 0.5 * s);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.05, d * 0.45), solarMat);
    panel.position.set(0, h + 0.4 * s, -d * 0.15);
    panel.rotation.x = -0.35;
    g.add(rail, panel);
    pane(g, -w * 0.18, h * 0.74, d / 2 + 0.03, w * 0.5, 0.6 * s);
    pane(g, w * 0.3, h * 0.26, d / 2 + 0.03, 0.6 * s, 0.6 * s);
    pane(g, 0, h * 0.74, -d / 2 - 0.03, w * 0.6, 0.6 * s);
    pane(g, 0, h * 0.26, -d / 2 - 0.03, w * 0.6, 0.6 * s);
    const poles = new THREE.Group();
    poles.position.set(w * 0.35, h + 0.3 * s, -d * 0.3);
    g.add(poles);
    const door = new THREE.Group();
    door.position.set(-w * 0.22, 1.0 * s, d / 2 + 0.04);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.55 * s, 1.0 * s), mat(0x3a3a3e, { side: THREE.DoubleSide }));
    leaf.position.y = -0.5 * s;
    door.add(leaf);
    g.add(door);
    g.userData.door = door;
    g.userData.poles = poles;
    g.userData.phase = fx() * 6;
    const gy = groundY(x, z, 1.2 * s);
    add(g, x, gy, z);
    g.lookAt(0, gy, 0);
    return bakeStatic(g);
  }

  // ---------- Era Moderna: central eléctrica, oficinas de cristal, campo solar, mina a cielo
  // abierto, vivero forestal, taller, laboratorio, invernaderos, rampa del cohete, obra y acería ----------
  /** Torre de refrigeración: hiperboloide hueco, más estrecho a dos tercios de la altura. */
  const coolingGeo = new THREE.LatheGeometry([[2.8, 0], [2.2, 3], [1.75, 5.6], [1.9, 8]].map(([x, y]) => new THREE.Vector2(x, y)), 18);
  /** Excavadora amarilla de orugas con la pluma y el cazo, que giran hacia el hoyo. */
  function makeExcavator(): THREE.Group {
    const g = new THREE.Group();
    g.add(meshOf([boxAt(0.6, 0.6, 2.8, -0.85, 0.3, 0), boxAt(0.6, 0.6, 2.8, 0.85, 0.3, 0)], sootMat));
    const top = new THREE.Group();
    top.position.y = 0.6;
    top.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 2.2).translate(0, 0.45, -0.2), yellowMat));
    top.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9).translate(-0.45, 1.35, 0.4), yellowMat));
    pane(top, -0.45, 1.4, 0.86, 0.7, 0.6);
    const arm = new THREE.Group();
    arm.position.set(0.5, 0.9, 0.7);
    arm.add(meshOf([beamGeo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2, 2.2), 0.3, 0.35), beamGeo(new THREE.Vector3(0, 2, 2.2), new THREE.Vector3(0, 0.2, 3.6), 0.25, 0.3)], yellowMat));
    arm.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5).translate(0, 0, 3.75), sootMat));
    top.add(arm);
    g.add(top);
    g.userData.top = top;
    g.userData.arm = arm;
    return g;
  }
  function makeModernCar(color: number): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 1.15).translate(0, 0.5, 0), mat(color, { metalness: 0.4, roughness: 0.4 })));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 1.05).translate(-0.15, 0.98, 0), windowMat));
    const w: THREE.BufferGeometry[] = [];
    for (const x of [-0.75, 0.75]) for (const z of [-0.55, 0.55]) w.push(new THREE.CylinderGeometry(0.25, 0.25, 0.16, 10).rotateX(Math.PI / 2).translate(x, 0.25, z));
    g.add(meshOf(w, sootMat));
    return g;
  }
  /** Una torre de oficinas: cristal azul con franjas de ventanas que se encienden de noche. */
  function officeTower(g: THREE.Group, x: number, z: number, w: number, d: number, floors: number): void {
    const h = floors * 1.1;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(x, h / 2, z), glassMat));
    const bands: THREE.BufferGeometry[] = [];
    for (let f = 1; f < floors; f++) bands.push(boxAt(w + 0.04, 0.45, d + 0.04, x, f * 1.1 - 0.3, z));
    g.add(meshOf(bands, windowMat));
    const slabs: THREE.BufferGeometry[] = [];
    for (let f = 0; f <= floors; f += 3) slabs.push(boxAt(w + 0.12, 0.14, d + 0.12, x, f * 1.1, z));
    slabs.push(boxAt(w * 0.5, 0.8, d * 0.5, x, h + 0.4, z));
    g.add(meshOf(slabs, towerMat));
  }

  function buildModern(): void {
    modBuilt = true;
    // Central eléctrica: dos torres de refrigeración con vapor, la sala de turbinas y la chimenea
    // a franjas; delante, los transformadores donde trabajan los electricistas
    {
      for (const x of [-4, 4]) {
        const t = new THREE.Group();
        t.add(new THREE.Mesh(coolingGeo, mat(0xd8d4cc, { side: THREE.DoubleSide })));
        placeIn(modStatics, t, zoneAt(POWER, x, -2.8));
        smokeFrom(t, new THREE.Vector3(0, 8.3, 0), 1.3, 1.6, true);
      }
      const hall = new THREE.Group();
      hall.add(new THREE.Mesh(new THREE.BoxGeometry(4.4, 4.2, 3).translate(0, 2.1, 0), concreteMat));
      hall.add(new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 3.2).translate(0, 4.3, 0), steelMat));
      const stripes: THREE.BufferGeometry[] = [], white: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 6; k++) (k % 2 ? white : stripes).push(new THREE.CylinderGeometry(0.45 - k * 0.02, 0.5 - k * 0.02, 2.2, 10).translate(0, 4.4 + 1.1 + k * 2.2, -2.6));
      hall.add(meshOf(stripes, redMat), meshOf(white, whiteMat));
      windowRows(hall, 4.4, 1.53, [2.8], 4, 0.7, 0.6);
      placeIn(modStatics, hall, zoneAt(POWER, 0, 0.6));
      smokeFrom(hall, new THREE.Vector3(0, 17.8, -2.6), 0.5, 0.7, true);
      for (const at of TRANSFORMERS) {
        const t = new THREE.Group();
        t.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.9).translate(0, 0.6, 0), mat(0x6a7a6a)));
        const fins: THREE.BufferGeometry[] = [];
        for (let k = 0; k < 5; k++) fins.push(boxAt(0.04, 0.9, 0.5, -0.5 + k * 0.25, 0.6, -0.65));
        for (const x of [-0.35, 0, 0.35]) fins.push(new THREE.CylinderGeometry(0.06, 0.08, 0.6, 6).translate(x, 1.5, 0));
        t.add(meshOf(fins, steelMat));
        placeIn(modStatics, t, at);
      }
      cableDrums = heapIn(modStatics, CABLE_PILE, 4, (k) => {
        const d = new THREE.Group();
        d.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0.42, 0.25), barrelMat));
        d.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0.42, -0.25), barrelMat));
        d.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.45, 10).rotateX(Math.PI / 2).translate(0, 0.42, 0), sootMat));
        d.position.set((k % 2) * 0.95 - 0.47, Math.floor(k / 2) * 0.82, 0);
        return d;
      });
    }
    // Oficinas: tres torres de cristal y, en la explanada, las mesas de los empresarios
    {
      const heights = [[-3.3, -2, 2.8, 2.8, 12], [0.4, -2.9, 3.2, 3, 20], [3.6, -1.6, 2.6, 2.4, 9]] as const;
      heights.forEach(([x, z, w, d, f], k) => {
        const g = new THREE.Group();
        officeTower(g, 0, 0, w, d, f);
        if (k === 1) {
          // Antena de telecomunicaciones (Internet)
          const ant = new THREE.Group();
          ant.add(meshOf([new THREE.CylinderGeometry(0.06, 0.12, 4, 5).translate(0, f * 1.1 + 2.8, 0), boxAt(0.5, 0.08, 0.08, 0, f * 1.1 + 2.5, 0), boxAt(0.08, 0.08, 0.5, 0, f * 1.1 + 3.4, 0)], steelMat));
          ant.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4).translate(0, f * 1.1 + 4.85, 0), new THREE.MeshBasicMaterial({ color: 0xff3a2a })));
          ant.visible = false;
          g.add(ant);
          antenna = ant;
        }
        placeIn(modStatics, g, zoneAt(OFFICES, x, z));
      });
      for (const at of DESKS8) {
        const laptop = new THREE.Group();
        laptop.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.28).translate(0, 0.87, 0.05), steelMat));
        laptop.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.02).translate(0, 1.0, -0.1), windowMat));
        tableIn(modStatics, at, whiteMat, laptop, steelMat);
      }
      briefcases = heapIn(modStatics, CASE_PILE, 6, (k) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.16), k % 2 ? mat(0x3a2418) : sootMat);
        b.position.set((k % 3) * 0.6 - 0.6, 0.2 + Math.floor(k / 3) * 0.41, 0);
        return b;
      });
    }
    // Campo solar: placas inclinadas hacia el sol, cada una sobre su poste
    {
      const panel = () => {
        const g = new THREE.Group();
        const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 1.2), solarMat);
        top.position.set(0, 1.0, 0);
        top.rotation.x = -0.5;
        const lines = new THREE.Mesh(mergeGeometries([0, 1, 2, 3].map((k) => boxAt(0.03, 0.07, 1.2, -0.75 + k * 0.5, 0, 0)))!, steelMat);
        lines.position.copy(top.position);
        lines.rotation.copy(top.rotation);
        g.add(top, lines, new THREE.Mesh(mergeGeometries([boxAt(0.1, 0.9, 0.1, -0.7, 0.45, 0.1), boxAt(0.1, 0.9, 0.1, 0.7, 0.45, 0.1)])!, steelMat));
        return g;
      };
      for (const at of PANELS) placeIn(modStatics, panel(), at);
      // Células de silicio (mejora): una hilera más de placas detrás
      const more = new THREE.Group();
      for (const x of [-4.2, -1.4, 1.4, 4.2]) {
        const p = panel();
        p.position.set(x, 0, -5.4);
        more.add(p);
      }
      extraPanels = placeIn(modStatics, more, SOLAR, 0, true, false);
      extraPanels.visible = false;
      panelStack = heapIn(modStatics, PANEL_PILE, 6, (k) => {
        const p = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.65), solarMat);
        p.position.set(0, 0.04 + k * 0.08, 0);
        p.rotation.y = (k % 2) * 0.08;
        return p;
      });
    }
    // Mina a cielo abierto: el hoyo en gradas (en el terreno), dos excavadoras y un volquete
    {
      for (const at of EXCAVATORS) {
        const e = makeExcavator();
        // La excavadora mira al centro del hoyo; solo estorba su cuerpo, no la pluma
        placeIn(modStatics, e, at, 0, true, false);
        e.rotation.y = Math.atan2(OPEN_PIT.x - at.x, OPEN_PIT.z - at.z);
        solids.push({ obj: e, x: at.x, z: at.z, r: 1.5 });
        excavatorArms.push(e);
      }
      pitCoal = heapIn(modStatics, PIT_HEAP, 9, (k) => {
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), coalMat);
        b.position.set(Math.cos(k * 2.2) * 0.5, 0.22 + Math.floor(k / 4) * 0.3, Math.sin(k * 2.2) * 0.5);
        return b;
      });
      const t = new THREE.Group();
      t.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 1.2).translate(0, 1.0, 1.3), yellowMat));
      pane(t, 0, 1.25, 1.92, 1, 0.45);
      const bed = new THREE.Group();
      bed.position.set(0, 0.85, -1.2);
      bed.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 2.2).translate(0, 0.45, 0.4), yellowMat));
      bed.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.4, 1.3).translate(0, 0.9, 0.4), coalMat));
      t.add(bed);
      const tw: THREE.BufferGeometry[] = [];
      for (const z of [-1.2, 1.2]) for (const x of [-0.75, 0.75]) tw.push(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10).rotateZ(Math.PI / 2).translate(x, 0.42, z));
      t.add(meshOf(tw, sootMat));
      t.userData.bed = bed;
      add(t, OPEN_PIT.x, 0, OPEN_PIT.z);
      t.traverse((c) => (c.castShadow = false));
      modStatics.push(t);
      truck = t;
    }
    // Vivero forestal: plantones en filas y troncos de repoblación
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 2.2).translate(0, 1.2, 0), mat(0x6a8a5a)));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.15, 2.5).translate(0, 2.45, 0), whiteMat));
      windowRows(g, 5, 1.13, [1.3], 3, 0.8, 0.8);
      placeIn(modStatics, g, zoneAt(NURSERY8, 0, -5));
      SAPLINGS8.forEach((at, k) => {
        const s = new THREE.Group();
        s.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.3, 8).translate(0, 0.15, 0), mat(0x2a2a2a)));
        s.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 4).translate(0, 0.55, 0), trunkMat));
        s.add(new THREE.Mesh(new THREE.ConeGeometry(0.32 + (k % 3) * 0.06, 0.8 + (k % 3) * 0.15, 6).translate(0, 1.1, 0), stonePineMat));
        placeIn(modStatics, s, at);
      });
      logs8 = heapIn(modStatics, LOG8_PILE, 8, (k) => {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.4, 7).rotateX(Math.PI / 2), barrelMat);
        b.position.set((k % 3) * 0.36 - 0.36 + (k >= 3 && k < 6 ? 0.18 : 0), 0.17 + Math.floor(k / 3) * 0.31, 0);
        return b;
      });
    }
    // Taller mecánico: nave con dos portones, el cartel y los coches en reparación
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 3.4).translate(0, 1.7, 0), whiteMat));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.25, 3.8).translate(0, 3.5, 0.1), redMat));
      g.add(meshOf([boxAt(2.4, 2.4, 0.06, -1.9, 1.2, 1.72), boxAt(2.4, 2.4, 0.06, 1.9, 1.2, 1.72)], mat(0x8a9098, { metalness: 0.4 })));
      placeIn(modStatics, g, zoneAt(GARAGE, 0, -2.2));
      CARS.forEach((at, k) => {
        const c = makeModernCar(k ? 0x2a5aa8 : 0xc83a2a);
        placeIn(modStatics, c, at);
      });
      tires = heapIn(modStatics, TIRE_PILE, 8, (k) => {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 6, 12).rotateX(Math.PI / 2), sootMat);
        t.position.set((k % 2) * 0.75 - 0.37, 0.12 + Math.floor(k / 2) * 0.24, 0);
        return t;
      });
    }
    // Laboratorio: edificio blanco con observatorio de cúpula y bancos con matraces
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(6, 3.6, 3.4).translate(0, 1.8, 0), whiteMat));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.4, 3.6).translate(0, 3.6, 0), mat(0x2a6a8a)));
      windowRows(g, 6, 1.73, [1.2, 2.7], 5, 0.7, 0.8);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.4, 12).translate(-1.6, 4.5, -0.3), whiteMat));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(1.25, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(-1.6, 5.2, -0.3), tinMat));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 1.3).translate(-1.6, 5.5, 0.3), sootMat));
      placeIn(modStatics, g, zoneAt(LAB, 0, -2.2));
      for (const at of BENCHES8) {
        const kit = new THREE.Group();
        const fl = [mat(0x3ad8a8, { transparent: true, opacity: 0.8 }), mat(0x8a5ad8, { transparent: true, opacity: 0.8 })];
        for (let k = 0; k < 3; k++) kit.add(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 8).translate(-0.4 + k * 0.4, 0.97, 0), fl[k % 2]));
        kit.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.25).translate(0.45, 1.0, -0.15), windowMat));
        tableIn(modStatics, at, whiteMat, kit, steelMat);
      }
      flasks = heapIn(modStatics, FLASK_PILE, 6, (k) => {
        const c = new THREE.Group();
        c.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.4).translate(0, 0.15, 0), mat(0xd8d4c8)));
        for (let q = 0; q < 2; q++) c.add(new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 6).translate(-0.12 + q * 0.24, 0.4, 0), mat(0x3ad8a8)));
        c.position.set((k % 3) * 0.6 - 0.6, Math.floor(k / 3) * 0.32, 0);
        return c;
      });
    }
    // Invernaderos: dos naves de vidrio con tomateras dentro y, delante, los bancales al aire libre
    {
      for (const x of [-2.4, 2.4]) {
        const g = new THREE.Group();
        const plants: THREE.BufferGeometry[] = [], fruit: THREE.BufferGeometry[] = [];
        for (const px of [-0.8, 0.8]) for (let z = -2; z <= 2; z += 0.8) {
          plants.push(new THREE.IcosahedronGeometry(0.3, 0).scale(0.8, 1.4, 0.8).translate(px, 0.55, z));
          fruit.push(new THREE.IcosahedronGeometry(0.08, 0).translate(px + 0.2, 0.55, z + 0.15));
        }
        g.add(meshOf(plants, leafMat8), meshOf(fruit, tomatoMat));
        const frame: THREE.BufferGeometry[] = [];
        for (let z = -2.5; z <= 2.51; z += 1.25) frame.push(new THREE.TorusGeometry(1.6, 0.04, 3, 10, Math.PI).translate(0, 0.6, z));
        frame.push(boxAt(0.06, 0.6, 5, -1.6, 0.3, 0), boxAt(0.06, 0.6, 5, 1.6, 0.3, 0));
        g.add(meshOf(frame, mat(0xd8dde0, { metalness: 0.4 })));
        // La bóveda de vidrio va a lo largo de z, sobre un murete también de vidrio
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 5, 12, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 0.6, 0), greenhouseMat));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.6, 5).translate(0, 0.3, 0), greenhouseMat));
        placeIn(modStatics, g, zoneAt(GREENHOUSES, x, -2.2));
      }
      for (const at of BEDS) {
        const b = new THREE.Group();
        b.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 0.8).translate(0, 0.2, 0), barrelMat));
        const plants: THREE.BufferGeometry[] = [], fruit: THREE.BufferGeometry[] = [];
        for (let k = 0; k < 4; k++) {
          plants.push(new THREE.IcosahedronGeometry(0.22, 0).scale(1, 1.3, 1).translate(-0.75 + k * 0.5, 0.65, 0));
          fruit.push(new THREE.IcosahedronGeometry(0.07, 0).translate(-0.65 + k * 0.5, 0.6, 0.18));
        }
        b.add(meshOf(plants, leafMat8), meshOf(fruit, tomatoMat));
        placeIn(modStatics, b, at);
      }
      crates = heapIn(modStatics, CRATE_PILE, 6, (k) => {
        const c = new THREE.Group();
        c.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.4).translate(0, 0.15, 0), plankMat));
        c.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.3).translate(0, 0.3, 0), tomatoMat));
        c.position.set((k % 3) * 0.6 - 0.6, Math.floor(k / 3) * 0.32, 0);
        return c;
      });
    }
    // Rampa de lanzamiento: losa de hormigón, torre de servicio roja y el cohete blanco
    {
      const pad = new THREE.Group();
      // La losa baja hasta el suelo aunque la ladera caiga
      pad.add(new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 2.1, 16).translate(0, -0.45, 0), concreteMat));
      pad.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 1.6).translate(0, 0.62, 0), new THREE.MeshBasicMaterial({ color: 0x1a1a1a })));
      const lattice: THREE.BufferGeometry[] = [];
      for (const sx of [-0.6, 0.6]) for (const sz of [-0.6, 0.6]) lattice.push(boxAt(0.12, 15, 0.12, 2.6 + sx, 7.5, sz));
      for (let y = 1; y < 15; y += 1.5) lattice.push(boxAt(1.3, 0.08, 0.08, 2.6, y, 0.6), boxAt(1.3, 0.08, 0.08, 2.6, y, -0.6), boxAt(0.08, 0.08, 1.3, 2.0, y, 0), boxAt(0.08, 0.08, 1.3, 3.2, y, 0));
      lattice.push(boxAt(2, 0.15, 0.3, 1.5, 11, 0), boxAt(2, 0.15, 0.3, 1.5, 6, 0));
      pad.add(meshOf(lattice, redMat));
      const padAt = zoneAt(LAUNCH, 0, -1.5);
      faceCenter(pad, padAt);
      add(pad, padAt.x, heightAt(padAt.x, padAt.z), padAt.z);
      modStatics.push(spawn(pad));
      const r = new THREE.Group();
      r.add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 10, 14).translate(0, 5.6, 0), whiteMat));
      r.add(new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.2, 14).translate(0, 11.7, 0), redMat));
      const fins: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 4; k++) fins.push(new THREE.BoxGeometry(0.08, 1.6, 1).translate(0, 1.4, 1.1).rotateY((k * Math.PI) / 2));
      r.add(meshOf(fins, sootMat));
      r.add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.5, 14).translate(0, 7.8, 0), sootMat));
      const flame = new THREE.Group();
      flame.add(new THREE.Mesh(new THREE.ConeGeometry(0.7, 3, 10).rotateX(Math.PI).translate(0, -1.1, 0), flameMat));
      flame.add(new THREE.Mesh(new THREE.ConeGeometry(0.4, 2, 10).rotateX(Math.PI).translate(0, -0.6, 0), new THREE.MeshBasicMaterial({ color: 0xfff2c0 })));
      flame.position.y = 0.6;
      flame.visible = false;
      r.add(flame);
      rocketFlame = flame;
      rocketBase = pad.position.y + 0.65;
      add(r, padAt.x, rocketBase, padAt.z);
      modStatics.push(r);
      rocket = r;
    }
    // Obra: grúa torre que gira, un edificio de hormigón a medio levantar y la hormigonera
    {
      const crane = new THREE.Group();
      const mast: THREE.BufferGeometry[] = [];
      for (const sx of [-0.4, 0.4]) for (const sz of [-0.4, 0.4]) mast.push(boxAt(0.1, 17, 0.1, sx, 8.5, sz));
      for (let y = 0.8; y < 17; y += 1.2) mast.push(boxAt(0.85, 0.06, 0.06, 0, y, 0.4), boxAt(0.85, 0.06, 0.06, 0, y, -0.4), boxAt(0.06, 0.06, 0.85, 0.4, y, 0), boxAt(0.06, 0.06, 0.85, -0.4, y, 0));
      crane.add(meshOf(mast, yellowMat));
      const jib = new THREE.Group();
      jib.position.y = 17;
      jib.add(meshOf([boxAt(0.6, 0.6, 14, 0, 0.3, 3), boxAt(0.9, 0.9, 0.9, 0, 0.9, 0), new THREE.ConeGeometry(0.5, 2.2, 4).translate(0, 1.6, 0)], yellowMat));
      jib.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4).translate(0, -0.2, -3.4), concreteMat));
      jib.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 7, 0.04).translate(0, -3.4, 7.5), sootMat));
      jib.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.5).translate(0, -7, 7.5), steelMat));
      crane.add(jib);
      craneJib = jib;
      // La pluma gira por encima de todo: solo el mástil es un obstáculo
      const craneAt = zoneAt(SITE, -5, -3.4);
      placeIn(modStatics, crane, craneAt, 0, true, false);
      solids.push({ obj: crane, x: craneAt.x, z: craneAt.z, r: 0.7 });
      const frame = new THREE.Group();
      const slabsG: THREE.BufferGeometry[] = [], cols: THREE.BufferGeometry[] = [];
      for (let f = 0; f < 4; f++) {
        slabsG.push(boxAt(5.6, 0.25, 4, 0, f * 2.4 + 0.12, 0));
        if (f < 3) for (const x of [-2.6, 0, 2.6]) for (const z of [-1.8, 1.8]) cols.push(boxAt(0.3, 2.4, 0.3, x, f * 2.4 + 1.3, z));
      }
      frame.add(meshOf(slabsG, concreteMat), meshOf(cols, mat(0x9a968e)));
      placeIn(modStatics, frame, zoneAt(SITE, 1.4, -2.8));
      FORMS.forEach((at) => {
        const f = new THREE.Group();
        f.add(meshOf([boxAt(1.4, 0.5, 0.06, 0, 0.25, 0.45), boxAt(1.4, 0.5, 0.06, 0, 0.25, -0.45), boxAt(0.06, 0.5, 0.9, -0.7, 0.25, 0), boxAt(0.06, 0.5, 0.9, 0.7, 0.25, 0)], plankMat));
        f.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 0.84).translate(0, 0.2, 0), concreteMat));
        placeIn(modStatics, f, at);
      });
      const mixer = new THREE.Group();
      mixer.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1).translate(0, 0.9, 1.4), orangeMat));
      mixer.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 3.6).translate(0, 0.5, 0.1), sootMat));
      const drum = new THREE.Group();
      drum.position.set(0, 1.6, -0.5);
      drum.rotation.x = 0.35;
      drum.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 2.2, 10).rotateX(Math.PI / 2), whiteMat));
      drum.add(new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.05, 3, 10).translate(0, 0, 0.2), orangeMat));
      mixer.add(drum);
      const mw: THREE.BufferGeometry[] = [];
      for (const z of [-1.1, 1.3]) for (const x of [-0.6, 0.6]) mw.push(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10).rotateZ(Math.PI / 2).translate(x, 0.35, z));
      mixer.add(meshOf(mw, sootMat));
      mixerDrum = drum;
      placeIn(modStatics, mixer, zoneAt(SITE, -4.6, 2.6));
      slabs = heapIn(modStatics, SLAB_PILE, 6, (k) => {
        const s = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.6), concreteMat);
        s.position.set(0, 0.09 + k * 0.19, 0);
        s.rotation.y = (k % 2) * 0.1;
        return s;
      });
    }
    // Acería: un esqueleto de vigas de acero y, delante, los soldadores con sus chispas azules
    {
      const g = new THREE.Group();
      const iron: THREE.BufferGeometry[] = [];
      for (const x of [-3, -1, 1, 3]) for (const z of [-1.6, 1.6]) iron.push(boxAt(0.25, 9, 0.25, x, 4.5, z));
      for (let y = 3; y <= 9; y += 3) {
        iron.push(boxAt(6.3, 0.3, 0.2, 0, y, -1.6), boxAt(6.3, 0.3, 0.2, 0, y, 1.6));
        for (const x of [-3, -1, 1, 3]) iron.push(boxAt(0.2, 0.3, 3.4, x, y, 0));
      }
      g.add(meshOf(iron, mat(0x8a4a2a, { metalness: 0.3 })));
      placeIn(modStatics, g, zoneAt(STEELWORKS, 0, -2.6));
      WELD_SPOTS.forEach((at) => {
        const t = new THREE.Group();
        t.add(meshOf([boxAt(0.2, 0.7, 0.2, -0.6, 0.35, 0), boxAt(0.2, 0.7, 0.2, 0.6, 0.35, 0)], steelMat));
        t.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.25, 0.3).translate(0, 0.82, 0), mat(0x8a4a2a, { metalness: 0.3 })));
        placeIn(modStatics, t, at);
      });
      beams = heapIn(modStatics, BEAM_PILE, 6, (k) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.25), mat(0x8a4a2a, { metalness: 0.3 }));
        b.position.set(0, 0.1 + Math.floor(k / 2) * 0.21, (k % 2) * 0.3 - 0.15);
        return b;
      });
    }
    // Un avión cruza el cielo en círculos
    {
      const p = new THREE.Group();
      p.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.35, 6, 10).rotateX(Math.PI / 2), whiteMat));
      p.add(new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 10).rotateX(Math.PI / 2).translate(0, 0, 3.5), whiteMat));
      p.add(new THREE.Mesh(mergeGeometries([boxAt(7, 0.1, 1.2, 0, 0, 0.3), boxAt(2.4, 0.1, 0.7, 0, 0.2, -2.6), boxAt(0.1, 1.2, 0.8, 0, 0.7, -2.6)])!, mat(0x1e5aa8)));
      add(p, Math.cos(1) * 85, 52, Math.sin(1) * 85, false);
      p.rotation.set(0, Math.atan2(-Math.sin(1), Math.cos(1)), 0.25);
      p.userData.a = 1;
      modStatics.push(p);
      plane = p;
    }
    makeTrain([10, 11, 11, 10], 1.2, 0.09, false);
  }

  /** El tren, el humo, las máquinas y el cohete de las dos últimas eras. */
  function animateIndustry(t: number, dt: number): void {
    if (shownEra < 7 || !indBuilt) return;
    animateSmoke(dt);
    for (const tr of trains) {
      if (!tr.cars[0].visible) continue;
      tr.a += tr.speed * dt;
      placeTrain(tr);
      if (tr.steam && fx() < dt * 3) {
        const c = tr.cars[0], s = c.userData.stack as THREE.Vector3;
        const w = c.localToWorld(s.clone());
        smokeAt(w.x, w.y, w.z, 0.55, fx() < 0.4, 3.5);
      }
    }
    if (headWheel) headWheel.rotation.x = t * 1.4;
    for (const r of pressRolls) r.rotation.x = t * 4;
    furnaceGlow.color.setRGB(1, 0.42 + Math.sin(t * 6) * 0.08, 0.12);
    if (shownEra < 8 || !modBuilt) return;
    if (craneJib) craneJib.rotation.y = Math.sin(t * 0.12) * 1.3;
    if (mixerDrum) mixerDrum.rotation.z = t * 2;
    for (const e of excavatorArms) {
      const k = Math.sin(t * 0.7 + e.position.x);
      (e.userData.top as THREE.Object3D).rotation.y = k * 0.5;
      (e.userData.arm as THREE.Object3D).rotation.x = 0.15 + Math.max(0, k) * 0.35;
    }
    if (truck) {
      // El volquete va y viene entre el borde del hoyo y el montón de carbón
      const a = zoneAt(OPEN_PIT, -1.6, 6.4), b = zoneAt(OPEN_PIT, 7, 4.6);
      const ph = (t * 0.06) % 1, go = ph < 0.4 ? ph / 0.4 : ph < 0.5 ? 1 : ph < 0.9 ? 1 - (ph - 0.5) / 0.4 : 0;
      const s = go * go * (3 - 2 * go);
      truck.position.set(a.x + (b.x - a.x) * s, 0, a.z + (b.z - a.z) * s);
      truck.position.y = heightAt(truck.position.x, truck.position.z);
      truck.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + (ph >= 0.5 && ph < 0.9 ? Math.PI : 0);
      (truck.userData.bed as THREE.Object3D).rotation.x = ph >= 0.4 && ph < 0.5 ? -Math.sin(((ph - 0.4) / 0.1) * Math.PI) * 0.7 : 0;
    }
    if (plane) {
      plane.userData.a += dt * 0.05;
      const a = plane.userData.a as number;
      plane.position.set(Math.cos(a) * 85, 52, Math.sin(a) * 85);
      plane.rotation.set(0, Math.atan2(-Math.sin(a), Math.cos(a)), 0.25);
    }
    for (const r of rotors) r.rotation.z = t * 1.6 + r.userData.phase;
    if (rocket && rocketT >= 0) {
      // ¡Despegue! El cohete acelera hacia el cielo dejando una columna de humo blanco
      rocketT += dt;
      const lift = Math.max(0, rocketT - 2);
      rocket.position.y = rocketBase + lift * lift * 1.6;
      if (rocketFlame) {
        rocketFlame.visible = rocketT > 0.5;
        rocketFlame.scale.set(1, 0.85 + Math.sin(t * 30) * 0.15, 1);
      }
      if (rocketT < 14 && fx() < dt * 14) smokeAt(rocket.position.x + (fx() - 0.5) * 2, rocket.position.y + 0.4, rocket.position.z + (fx() - 0.5) * 2, 1.4, true, 5);
      if (rocket.position.y > 190) rocket.visible = false;
    }
  }

  // ---------- El agua y el terreno de cada era ----------
  // Puente sobre el río, en el tramo más cercano a la ciudad: de madera en la Edad del Bronce y de
  // piedra desde la Antigüedad. El eje x del puente cruza el río; el z va a lo largo del agua.
  let bridge: THREE.Object3D | null = null, bridgeStone = false;
  function makeBridge(stone: boolean): THREE.Group {
    const g = new THREE.Group();
    const c = riverAt(RIVER_NEAR_S), n = townNormal(RIVER_NEAR_S);
    const half = RIVER_W + 2.4, segs = 10, top = 1.65;
    const endY = (u: number) => heightAt(c.x + n.x * half * u, c.z + n.z * half * u);
    const deckY = (u: number) => THREE.MathUtils.lerp(Math.max(endY(Math.sign(u) || 1), 0), top, 1 - u * u) + 0.05;
    const deck: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
    for (let k = 0; k < segs; k++) {
      const u0 = (k / segs) * 2 - 1, u1 = ((k + 1) / segs) * 2 - 1, um = (u0 + u1) / 2;
      const x0 = u0 * half, x1 = u1 * half, y0 = deckY(u0), y1 = deckY(u1), len = Math.hypot(x1 - x0, y1 - y0) + 0.04;
      const tilt = Math.atan2(y1 - y0, x1 - x0);
      if (stone) {
        // Bóveda: en los extremos el muro baja hasta el lecho; en el centro queda el arco
        const deep = Math.abs(um) > 0.55 ? (y0 + y1) / 2 + 0.8 : 0.55;
        deck.push(new THREE.BoxGeometry(len, deep, 2.2).translate(0, -deep / 2 + 0.2, 0).rotateZ(tilt).translate((x0 + x1) / 2, (y0 + y1) / 2, 0));
        for (const side of [-1, 1]) rails.push(new THREE.BoxGeometry(len, 0.5, 0.25).rotateZ(tilt).translate((x0 + x1) / 2, (y0 + y1) / 2 + 0.45, side * 1.0));
      } else {
        deck.push(new THREE.BoxGeometry(len, 0.14, 1.8).rotateZ(tilt).translate((x0 + x1) / 2, (y0 + y1) / 2, 0));
        for (const side of [-1, 1]) {
          rails.push(new THREE.BoxGeometry(0.1, 0.8, 0.1).translate(x0, y0 + 0.4, side * 0.85));
          rails.push(new THREE.BoxGeometry(len, 0.08, 0.08).rotateZ(tilt).translate((x0 + x1) / 2, (y0 + y1) / 2 + 0.75, side * 0.85));
        }
        // Pilotes clavados en el lecho
        if (k === 3 || k === 6) for (const side of [-1, 1]) rails.push(new THREE.BoxGeometry(0.18, y0 + 1.2, 0.18).translate(x0, (y0 - 1.2) / 2, side * 0.7));
      }
    }
    const m = stone ? castleStoneMat : timberMat;
    g.add(new THREE.Mesh(mergeGeometries(deck)!, m), new THREE.Mesh(mergeGeometries(rails)!, stone ? marbleShadeMat : timberMat));
    g.rotation.y = Math.atan2(-n.z, n.x);
    return add(g, c.x, 0, c.z);
  }
  /** Agua y colinas de la era: charca, lago o río, y en el Renacimiento las colinas más lejos. */
  function setLand(era: number): void {
    const stage = era >= 3 ? 3 : era === 2 ? 2 : 1, hills = era >= 8 ? 110 : era >= 7 ? 96 : era >= 6 ? 80 : 64;
    if (stage !== waterStage || hills !== hillsR) {
      waterStage = stage;
      hillsR = hills;
      shapeTerrain();
      pond.visible = stage < 3;
      river.visible = stage === 3;
      const c = stage === 2 ? LAKE : POND;
      pond.position.set(c.x, -0.25, c.y);
      pond.scale.setScalar(stage === 2 ? (LAKE_R + 0.4) / POND_R : 1);
      for (const p of pines) p.obj.position.y = heightAt(p.obj.position.x, p.obj.position.z) - 0.05;
      placeOuterForest();
      placeMountains();
      for (const p of [...people.fisher, ...people.rafter]) placeOnWater(p);
      if (props.nets) {
        const at = netsSpot();
        props.nets.position.set(at.x, heightAt(at.x, at.z), at.z);
        moveSolid(props.nets);
      }
    }
    const stone = era >= 4;
    if (stage === 3 && (!bridge || bridgeStone !== stone)) {
      if (bridge) scene.remove(bridge);
      bridge = makeBridge(stone);
      bridgeStone = stone;
    } else if (stage < 3 && bridge) {
      scene.remove(bridge);
      bridge = null;
    }
  }

  let dwellingStyle = 0;
  function update(state: GameState) {
    const neolithic = state.era >= 2, bronze = state.era >= 3, antique = state.era >= 4, medieval = state.era >= 5;
    gentleDrops = false;
    if (state.era !== shownEra) {
      const first = shownEra === 0;
      gentleDrops = !first;
      shownEra = state.era;
      // La tarde dorada es de la Edad del Bronce (y algo de la Toscana en el Renacimiento); en la
      // Antigüedad luce un mediodía claro.
      warmTarget = state.era === 3 ? 1 : state.era === 6 ? 0.35 : state.era === 7 ? 0.12 : 0;
      // En la Revolución Industrial el humo de las chimeneas vela el cielo; la Era Moderna vuelve a ser clara.
      smogTarget = state.era === 7 ? 1 : 0;
      // En la Edad Media vuelve el cielo templado del norte, sin la luz blanca del Mediterráneo.
      medTarget = state.era === 4 ? 1 : state.era === 8 ? 0.6 : 0;
      // La sombra del sol cubre todo el claro de la era.
      const reach = state.era >= 8 ? 108 : state.era >= 7 ? 92 : state.era >= 6 ? 78 : state.era >= 5 ? 64 : 46;
      Object.assign(moonLight.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, far: Math.max(130, reach + 70) });
      moonLight.shadow.camera.updateProjectionMatrix();
      zoomTarget = Math.min(MAX_ZOOM, state.era);
      if (first || reduceMotion) {
        smog = smogTarget;
        applyDay(day, (warm = warmTarget), (med = medTarget));
        zoom = zoomTarget;
      }
      // Desde el Neolítico la partida se abre mirando por encima de los campos, sin la arboleda delante.
      if (first && neolithic) angle = 2.5;
      // El agua de la era (charca, lago o río) y el terreno que la rodea
      setLand(state.era);
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
      if (antique) {
        if (!antiqueBuilt) buildAntiquity();
        else for (const o of antiqueStatics) o.visible = true;
      } else for (const o of antiqueStatics) o.visible = false;
      if (medieval) {
        if (!medievalBuilt) buildMedieval();
        else for (const o of medievalStatics) o.visible = true;
      } else for (const o of medievalStatics) o.visible = false;
      const renaissance = state.era >= 6;
      if (renaissance) {
        if (!renBuilt) buildRenaissance();
        else for (const o of renStatics) o.visible = true;
      } else for (const o of renStatics) o.visible = false;
      if (state.era >= 7) {
        if (!indBuilt) buildIndustrial();
        else for (const o of indStatics) o.visible = true;
      } else for (const o of indStatics) o.visible = false;
      if (state.era >= 8) {
        if (!modBuilt) buildModern();
        else for (const o of modStatics) o.visible = true;
      } else for (const o of modStatics) o.visible = false;
      for (const k of smokeKinds) k.mesh.visible = state.era >= 7;
      // Las nubes suben para no tapar la ciudad, que ya se ve desde muy alto
      for (const c of clouds) c.position.y = c.userData.y + (state.era >= 8 ? 30 : state.era >= 7 ? 18 : 0);
      wheatInst.visible = neolithic && neoBuilt;
      // Cada era nueva empieza con todos en su oficio, y con las plazas que ya tiene.
      resetLives();
      for (const pl of PLAZAS) if (pl.era <= state.era && !plazaBuilt.has(pl)) buildPlaza(pl);
      for (const o of OUTSKIRTS) if (o.era <= state.era && !outBuilt.has(o)) buildOutskirt(o);
      // Toda la población se viste con la ropa y las herramientas de la era nueva.
      for (const list of Object.values(people)) for (const p of list) {
        dress(p.rig, state.era);
        if (p.raft) p.raft.userData.sail.visible = state.era >= 3;
      }
      // Los ciervos que se quedan dentro de lo construido se van al borde del bosque.
      deer.forEach((d) => {
        if (Math.hypot(d.x, d.z) > CLEARING[state.era] - 11 && !blockers.some((z) => z.r > 1.9 && Math.hypot(d.x - z.x, d.z - z.z) < z.r + 0.8)) return;
        const to = deerSpot(Math.atan2(d.z, d.x));
        [d.x, d.z, d.tx, d.tz, d.state] = [to.x, to.z, to.x, to.z, 'graze'];
      });
    }

    // Tiendas de piel en el Paleolítico, casas de barro en el Neolítico, casas de piedra en la
    // Edad del Bronce y villas en la Antigüedad. Cada era empieza con unas pocas y crecen con los
    // oficios de esa era.
    const style = Math.min(8, state.era);
    if (dwellingStyle !== style) {
      for (const t of tents) scene.remove(t);
      tents.length = 0;
      dwellingStyle = style;
    }
    // Nunca hay menos viviendas que al final de la era anterior: la aldea solo crece.
    const slots = style === 8 ? MODERN_SLOTS : style === 7 ? BRICK_SLOTS : style === 6 ? REN_SLOTS : style === 5 ? TIMBER_SLOTS : style === 4 ? VILLA_SLOTS : style === 3 ? HOUSE_SLOTS : style === 2 ? HUT_SLOTS : TENT_SLOTS;
    const units = (n: number) => BUILDINGS_OF[n].reduce((a, b) => a + state.buildings[b], 0);
    let wantTents = Math.min(TENT_SLOTS.length, 1 + Math.floor(units(1) / 6));
    if (style >= 2) wantTents = Math.min(HUT_SLOTS.length, Math.max(5, wantTents) + Math.floor(units(2) / 12));
    if (style >= 3) wantTents = Math.min(HOUSE_SLOTS.length, Math.max(5, wantTents) + Math.floor(units(3) / 9));
    if (style >= 4) wantTents = Math.min(VILLA_SLOTS.length, Math.max(5, wantTents) + Math.floor(units(4) / 9));
    if (style >= 5) wantTents = Math.min(TIMBER_SLOTS.length, Math.max(5, wantTents) + Math.floor(units(5) / 9));
    if (style >= 6) wantTents = Math.min(REN_SLOTS.length, Math.max(5, wantTents) + Math.floor(units(6) / 9));
    if (style >= 7) wantTents = Math.min(BRICK_SLOTS.length, Math.max(5, wantTents) + Math.floor(units(7) / 9));
    if (style >= 8) wantTents = Math.min(MODERN_SLOTS.length, Math.max(5, wantTents) + Math.floor(units(8) / 9));
    while (tents.length < wantTents) {
      const t = slots[tents.length];
      const home = spawn(style === 8 ? makeModernHouse(t.x, t.z, t.s * 0.7, t.tone) : style === 7 ? makeBrickHouse(t.x, t.z, t.s * 0.7, t.tone) : style === 6 ? makeRenHouse(t.x, t.z, t.s * 0.7, t.tone) : style === 5 ? makeTimberHouse(t.x, t.z, t.s * 0.72, t.tone) : style === 4 ? makeVilla(t.x, t.z, t.s * 0.72, t.tone) : style === 3 ? makeHouse(t.x, t.z, t.s * 0.72, t.tone) : style === 2 ? makeHut(t.x, t.z, t.s * 0.8, t.tone) : makeTent(t.x, t.z, t.s, t.tone));
      // La puerta mira al centro de la aldea: ahí entra la gente a dormir.
      const back = 1.6 * t.s + 0.3, tl = Math.hypot(t.x, t.z) || 1;
      home.userData.doorAt = { x: t.x - (t.x / tl) * back, z: t.z - (t.z / tl) * back };
      tents.push(home);
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
    if (antiqueBuilt) {
      const iron = Math.min(ironBars.length, Math.round(Math.log10(state.resources.iron + 1) * 1.3));
      ironBars.forEach((b, k) => (b.visible = k < iron));
      ironOreLumps.forEach((n, k) => (n.visible = k < 4 + state.buildings.ironMiner * 2));
      marbleStack.forEach((b, k) => (b.visible = k < 2 + state.buildings.marbler));
      plankStack.forEach((b, k) => (b.visible = k < 2 + state.buildings.sawyer));
      amphoras.forEach((b, k) => (b.visible = k < 2 + state.buildings.oliveGrower));
      bronzeGoods.forEach((b, k) => (b.visible = k < 1 + state.buildings.bronzesmith));
    }
    if (medievalBuilt) {
      const gold = Math.min(goldChests.length, Math.round(Math.log10(state.resources.gold + 1) * 0.6));
      goldChests.forEach((b, k) => (b.visible = k < gold));
      goldOreLumps.forEach((n, k) => (n.visible = k < 4 + state.buildings.goldMiner * 2));
      flourSacks.forEach((b, k) => (b.visible = k < 2 + state.buildings.miller));
      armorGoods.forEach((b, k) => (b.visible = k < 2 + state.buildings.armorer));
      bellGoods.forEach((b, k) => (b.visible = k < 1 + state.buildings.bellfounder));
      ashlars5.forEach((b, k) => (b.visible = k < 2 + state.buildings.bricklayer));
      oakLogs.forEach((b, k) => (b.visible = k < 2 + state.buildings.ranger));
    }
    if (renBuilt && state.era >= 6) {
      const books = Math.min(bookStacks.length, Math.round(Math.log10(state.resources.books + 1) * 0.55));
      bookStacks.forEach((b, k) => (b.visible = k < books));
      paperStack.forEach((b, k) => (b.visible = k < 2 + state.buildings.printer));
      wineBarrels.forEach((b, k) => (b.visible = k < 2 + state.buildings.vintner));
      statueRow.forEach((b, k) => (b.visible = k < 1 + state.buildings.sculptor));
      gearPile.forEach((b, k) => (b.visible = k < 2 + state.buildings.clockmaker));
      musketRack.forEach((b, k) => (b.visible = k < 2 + state.buildings.gunsmith));
      coinChests.forEach((b, k) => (b.visible = k < 1 + state.buildings.banker));
      timberStack.forEach((b, k) => (b.visible = k < 2 + state.buildings.shipwright));
      const dome = state.upgrades.includes('dome');
      if (domeTop) domeTop.visible = dome;
      if (domeScaffold) domeScaffold.visible = !dome;
      if (cellar) cellar.visible = state.upgrades.includes('barrels');
    }
    setCaravels(state.era >= 6 && state.upgrades.includes('caravels'));
    if (indBuilt && state.era >= 7) {
      const coal = Math.min(coalLumps.length, Math.round(Math.log10(state.resources.coal + 1) * 0.5));
      coalLumps.forEach((b, k) => (b.visible = k < coal));
      cans.forEach((b, k) => (b.visible = k < 2 + state.buildings.canner));
      chairs.forEach((b, k) => (b.visible = k < 1 + state.buildings.cabinetmaker));
      bricks7.forEach((b, k) => (b.visible = k < 2 + state.buildings.brickmaker));
      drums.forEach((b, k) => (b.visible = k < 1 + state.buildings.boilermaker));
      pigIron.forEach((b, k) => (b.visible = k < 2 + state.buildings.puddler));
      strongboxes.forEach((b, k) => (b.visible = k < 1 + state.buildings.stockbroker));
      bundles.forEach((b, k) => (b.visible = k < 2 + state.buildings.journalist));
      coalStage.forEach((b, k) => (b.visible = k < 1 + state.buildings.engineer));
      if (crystalPalace) crystalPalace.visible = state.upgrades.includes('great-exhibition');
      if (state.upgrades.includes('railway')) addFreight();
    }
    // Un tren de vapor en la era 7 (dos con el Ferrocarril); en la Era Moderna, el de alta velocidad
    for (const tr of trains) for (const c of tr.cars) c.visible = tr.steam ? state.era === 7 && (tr === trains[0] || state.upgrades.includes('railway')) : state.era >= 8;
    if (modBuilt && state.era >= 8) {
      const energy = Math.min(cableDrums.length, Math.round(Math.log10(state.resources.energy + 1) * 0.3));
      cableDrums.forEach((b, k) => (b.visible = k < energy));
      briefcases.forEach((b, k) => (b.visible = k < 1 + state.buildings.entrepreneur));
      panelStack.forEach((b, k) => (b.visible = k < 1 + state.buildings.solarTech));
      pitCoal.forEach((b, k) => (b.visible = k < 3 + state.buildings.excavator));
      logs8.forEach((b, k) => (b.visible = k < 2 + state.buildings.forestEngineer));
      tires.forEach((b, k) => (b.visible = k < 2 + state.buildings.mechanic));
      flasks.forEach((b, k) => (b.visible = k < 1 + state.buildings.scientist));
      crates.forEach((b, k) => (b.visible = k < 1 + state.buildings.agronomist));
      slabs.forEach((b, k) => (b.visible = k < 1 + state.buildings.concreter));
      beams.forEach((b, k) => (b.visible = k < 1 + state.buildings.welder));
      if (antenna) antenna.visible = state.upgrades.includes('internet');
      if (extraPanels) extraPanels.visible = state.upgrades.includes('silicon-cells');
      // Alcanzada la meta final, el cohete despega (con movimiento reducido ya ha partido)
      if (state.goalReached && rocket && rocketT < 0) {
        rocketT = 0;
        if (reduceMotion) rocket.visible = false;
      } else if (!state.goalReached && rocket && rocketT >= 0) {
        rocketT = -1;
        rocket.visible = true;
        rocket.position.y = rocketBase;
        if (rocketFlame) rocketFlame.visible = false;
      }
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

  // Cambiar el tamaño del lienzo lo borra. Se vuelve a dibujar en el acto (el ResizeObserver avisa
  // antes de pintar) para que la aldea no se vea en blanco hasta el siguiente fotograma, que puede
  // tardar o no llegar si la escena está parada.
  let sizeW = 0, sizeH = 0, drawn = false;
  const resize = (force = false) => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h || (!force && w === sizeW && h === sizeH)) return;
    sizeW = w;
    sizeH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (drawn && !document.hidden) renderer.render(scene, camera);
  };
  const ro = new ResizeObserver(() => resize());
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
    // La forja: el hogar brilla al trabajar los herreros y la chimenea humea
    if (antiqueBuilt) {
      const working = people.blacksmith.length > 0;
      forgeHeat = ease(forgeHeat, working ? 0.7 + Math.sin(t * 7) * 0.15 + Math.sin(t * 17) * 0.1 : 0.25, dt, 2);
      hearthGlow?.color.setRGB(1, 0.3 + forgeHeat * 0.35, 0.08 + forgeHeat * 0.1);
      if (forgeLight) forgeLight.intensity = (working ? 14 : 4) * (0.5 + forgeHeat * 0.6);
      if (fx() < dt * (0.6 + forgeHeat)) puff(CHIMNEY.x, CHIMNEY.z, heightAt(CHIMNEY.x, CHIMNEY.z) + 4.4, 1.2);
      pressPush = Math.max(0, pressPush - dt * 1.5);
      if (pressBeam) pressBeam.rotation.z = -0.12 - Math.sin(pressPush * Math.PI) * 0.12;
    }
    // Edad Media: aspas del molino, grúa de rueda, campana que se mece, estandartes y fragua de la armería
    if (medievalBuilt && shownEra >= 5) {
      millBoost = Math.max(0, millBoost - dt * 0.6);
      if (millSails) millSails.rotation.z -= dt * (0.5 + wind * 0.3 + millBoost * 2);
      if (treadwheel && people.bricklayer.length) treadwheel.rotation.z += dt * 0.4;
      if (bell) bell.rotation.x = Math.sin(t * 0.9) * 0.08 * (people.bellfounder.length ? 1 : 0.3);
      for (const [k, b] of banners.entries()) b.rotation.y = Math.sin(t * 2.1 + k) * 0.35 * wind;
      const forging = people.armorer.length > 0;
      armoryGlow?.color.setRGB(1, forging ? 0.4 + Math.sin(t * 7) * 0.1 : 0.32, 0.1);
      if (fx() < dt * (forging ? 1.2 : 0.3)) {
        const c = around(ARMORY, -1.6, 1.9);
        puff(c.x, c.z, heightAt(c.x, c.z) + 4.4, 1.2);
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

    // Superficie del lago (o del río) y ondas
    if (pond.visible) {
      const pp = pondGeo.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const x = pondBase[i * 3], y = pondBase[i * 3 + 1], edge = 1 - Math.hypot(x, y) / POND_R;
        pp.setZ(i, (Math.sin(x * 1.3 + t * 1.6) + Math.cos(y * 1.1 - t * 1.3)) * 0.05 * edge);
      }
      pp.needsUpdate = true;
      pondGeo.computeVertexNormals();
    } else if (river.visible) {
      // La corriente: ondas que bajan por el río, más vivas en el centro que en las orillas
      const rp = riverGeo.attributes.position;
      for (let k = 0; k < RIVER.length; k++) {
        const s = RIVER_S[k];
        for (let j = 1; j < 3; j++) rp.setY(k * 4 + j, (Math.sin(s * 0.9 - t * 2.2 + j * 1.7) + Math.cos(s * 0.37 - t * 1.4)) * 0.045);
      }
      rp.needsUpdate = true;
      riverGeo.computeVertexNormals();
    }
    for (const m of ripples) {
      if (m.userData.age >= 1) continue;
      m.userData.age += dt / 1.6;
      const a = Math.min(1, m.userData.age);
      m.scale.setScalar((0.2 + a * 1.4) * m.userData.size);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - a) * 0.55;
    }
    if (fx() < dt * (waterStage === 3 ? 1.2 : 0.35)) {
      const w = waterSpot();
      ripple(w.x, w.z, 0.5);
    }

    // Peces: saltan solos o salen con el sedal
    for (const j of jumpers) {
      if (!j.active) {
        if (j.fish.userData.catch) continue;
        j.wait -= dt;
        if (j.wait <= 0) {
          const w = waterSpot(), from = new THREE.Vector3(w.x, -0.25, w.z);
          // Salta hacia un punto que también está en el agua
          let to = from.clone();
          for (let n = 0; n < 6; n++) {
            const b = fx() * Math.PI * 2;
            to = from.clone().add(new THREE.Vector3(Math.cos(b) * 1.3, 0, Math.sin(b) * 1.3));
            if (inWater(to.x, to.z, -0.4)) break;
          }
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
          const [mx, mz] = steer(d, d.tx, d.tz, dx / dist, dz / dist);
          const fromX = d.x, fromZ = d.z;
          d.x += mx * step;
          d.z += mz * step;
          pushOut(d, fromX, fromZ, d.tx, d.tz);
          d.heading = lerpAngle(d.heading, Math.atan2(mx, mz), Math.min(1, dt * 3));
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
      const floor = Math.max(heightAt(d.mesh.position.x, d.mesh.position.z), inWater(d.mesh.position.x, d.mesh.position.z) ? -0.25 : -99);
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
    const z0 = Math.floor(zoom), zk = zoom - z0, z1 = Math.min(MAX_ZOOM, z0 + 1), zs = zk * zk * (3 - 2 * zk);
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
    // El reloj del día. De día el fuego alumbra menos: manda el sol.
    if (!reduceMotion) {
      tod += dt / CYCLE;
      if (tod >= 1) {
        tod -= 1;
        dayNum++;
      }
    }
    day = daylightAt(tod);
    warm = warmTarget > warm ? Math.min(warmTarget, warm + dt / 4) : Math.max(warmTarget, warm - dt / 4);
    med = medTarget > med ? Math.min(medTarget, med + dt / 4) : Math.max(medTarget, med - dt / 4);
    smog = smogTarget > smog ? Math.min(smogTarget, smog + dt / 4) : Math.max(smogTarget, smog - dt / 4);
    applyDay(day, Math.max(warm, glowAt(tod) * 0.9), med);
    // La torre del reloj (Renacimiento): esfera de doce horas, la aguja corta da dos vueltas por
    // día y la larga, una por hora
    if (clockHands.length) {
      clockHands[0].rotation.z = -tod * Math.PI * 4;
      clockHands[1].rotation.z = -tod * Math.PI * 48;
    }
    fireLight.intensity = (55 + Math.sin(t * 11) * 6 + Math.sin(t * 27) * 4) * big * (1 + flash) * (1 - day * 0.65);
    if (wheatInst.visible) updateWheat(reduceMotion ? 0 : t, reduceMotion ? 0 : dt);

    if (!reduceMotion) {
      animateWorld(t, dt);
      animateBonfires(t);
      animateBeasts(dt, t);
      animateRenaissance(t, dt);
      animateIndustry(t, dt);
      // La agenda del día se revisa unas pocas veces por segundo: basta y ahorra trabajo.
      schedTimer -= dt;
      if (schedTimer <= 0) {
        schedTimer = 0.3;
        schedule();
      }
      for (const kind of Object.keys(people) as BuildingId[]) {
        for (const p of people[kind]) {
          if (p.life) updateLife(p, dt, t);
          else if (kind === 'gatherer') updateGatherer(p, dt, t);
          else if (kind === 'woodcutter' || kind === 'feller') updateWoodcutter(p, dt, t);
          else if (kind === 'hunter') updateHunter(p, dt, t);
          else if (kind === 'rafter') updateRafter(p, dt, t);
          else if (kind === 'fisher') updateFisher(p, dt, t, jumpers[p.i % jumpers.length]);
          else if (kind === 'farmer') updateFarmer(p, dt, t);
          else if (kind === 'herder') updateHerder(p, dt, t);
          else if (kind === 'forester') updateForester(p, dt, t);
          else if (kind === 'miner') updateMiner(p, dt, t);
          else if (CRAFTERS.has(kind)) updateCrafter(p, dt, t);
          else if (kind === 'charcoaler') updateCharcoaler(p, dt, t);
          else if (kind === 'copperMiner' || kind === 'ironMiner' || kind === 'goldMiner' || kind === 'coalMiner') updateCopperMiner(p, dt, t);
          else if (kind === 'oliveGrower') updateOliveGrower(p, dt, t);
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
    drawn = true;
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
    resize(true);
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
      if (shownEra >= 8 && modBuilt) {
        // Cosechar el invernadero: saltan tomates de los bancales
        for (const b of BEDS) emit(tomatoMat, b.x, heightAt(b.x, b.z) + 0.8, b.z, 3, 1.2, 0.07, 1.1);
      } else if (shownEra >= 7 && indBuilt) {
        // Enlatar conservas: saltan latas brillantes de las mesas de la fábrica
        for (const b of CAN_TABLES) emit(tinMat, b.x, heightAt(b.x, b.z) + 1, b.z, 3, 1.2, 0.07, 1.1);
      } else if (shownEra >= 6 && renBuilt) {
        // Pisar uvas: salpica mosto morado del lagar
        emit(grapeMat, WINE_PRESS.x, heightAt(WINE_PRESS.x, WINE_PRESS.z) + 0.8, WINE_PRESS.z, 6, 1.3, 0.06, 1.1);
        treadBoost = 1;
      } else if (shownEra >= 5 && medievalBuilt) {
        // Moler trigo: el molino acelera y sale harina por la puerta
        const door = around(WINDMILL, 0, -1.9);
        emit(flourMat, door.x, heightAt(door.x, door.z) + 0.8, door.z, 5, 1.1, 0.06, 1);
        millBoost = 1;
      } else if (shownEra >= 4 && antiqueBuilt) {
        // Prensar aceitunas: saltan aceitunas de la prensa del olivar
        emit(oliveMat, PRESS.x, heightAt(PRESS.x, PRESS.z) + 1, PRESS.z, 5, 1.3, 0.06, 1.2);
        pressPush = 1;
      } else if (shownEra >= 3 && bronzeBuilt) {
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
    daylight: () => day,
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
