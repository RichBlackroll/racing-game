import * as THREE from "three";
import * as CANNON from "cannon-es";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ---------------------------------------------------------------------------
// People field: instanced, procedural ragdoll pedestrians.
//
// Each person is an 11-body Cannon-body ragdoll (pelvis, torso, head, two
// upper arms, two forearms, two hands, two thighs, two calves, two feet)
// held together by a joint controller instead of constraints:
//   * positional springs keep every joint anchor coincident,
//   * orientation springs steer each child's relative rotation to a target
//     pose (gait during walking, keyframe poses while getting up).
// While walking the pelvis is puppeted kinematically; the moment a car hits,
// the person becomes a dynamic ragdoll (floor collisions on, low gains),
// gets pancaked underneath the car, springs back up rubber-style, and then
// runs a get-up sequence before resuming the walk.
// ---------------------------------------------------------------------------

const FLOOR_Y = 0.075; // road ribbon surface, matches the game world

const SKIN = [0xf2c99a, 0xe0a87a, 0xc98d5f, 0xa66a3f, 0x7c4c28, 0x4e3121];
const HAIR_COLORS = [0x181513, 0x46301f, 0x6b4a2a, 0x9c6b35, 0xd3b178, 0xdcd2c0, 0x595959];
const SHIRT_COLORS = [0xd93a3a, 0x2f6fd0, 0x3f9e4f, 0xf2c531, 0x8d4fc9, 0x2aa9a0, 0xe8862e, 0xf2eee6, 0x2e2e33, 0xdd5fa8];
const PANTS_COLORS = [0x23345a, 0x5c4834, 0x35353d, 0x4a6244, 0x8e2f35, 0x6b6b6b];
const SHOE_COLORS = [0xf2f2f2, 0x26262b, 0xb23a2f, 0x7a4f2e, 0x2f5a8c, 0xd9c7a2];

const YELLS = [
  "Oof!", "Whoa!", "Aah!", "Hey!", "Careful!", "Watch it!",
  "My back!", "Help!", "Yikes!", "Oi!", "Ey!", "Whoooah!",
];

const unitSphere = () => new THREE.SphereGeometry(1, 14, 11);
const unitCapsule = () => new THREE.CapsuleGeometry(0.5, 1, 5, 10);
const unitBox = () => new RoundedBoxGeometry(1, 1, 1, 3, 0.06);
// Top half of a unit sphere (hair caps, hats).
const unitCap = () => new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);

// Bulk-merge primitives into one instanced geometry (uniform attributes).
const mergeParts = (...geos) =>
  mergeGeometries(geos.map((g) => {
    const x = g.index ? g.toNonIndexed() : g;
    x.computeVertexNormals();
    return x;
  }));

// Hair styles: index 0..5
const HAIR_BUILDERS = [
  () => new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  () => mergeParts(
    new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new RoundedBoxGeometry(0.5, 0.42, 0.3, 3, 0.12).translate(0, -0.33, -0.12),
  ),
  () => mergeParts(
    new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.CapsuleGeometry(0.3, 1.25, 4, 8).translate(0, -0.82, -0.16),
  ),
  () => mergeParts(
    new THREE.ConeGeometry(0.3, 0.95, 6).translate(0, 0.95, 0),
    new THREE.ConeGeometry(0.34, 0.85, 6).translate(0, 0.82, 0.32).rotateY(0.55),
    new THREE.ConeGeometry(0.34, 0.85, 6).translate(0, 0.82, -0.32).rotateY(-0.55),
  ),
  () => mergeParts(
    new THREE.TorusGeometry(0.98, 0.36, 6, 14).translate(0, -0.06, 0),
    new THREE.SphereGeometry(0.72, 12, 10).translate(0, 0.22, 0),
  ),
  () => mergeParts(
    new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.SphereGeometry(0.44, 10, 8).translate(0, 0.74, -0.14),
  ),
];

// Hats: 0 = none
const HAT_BUILDERS = [
  null,
  () => mergeParts(
    new THREE.SphereGeometry(0.84, 12, 9, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.12, 0),
    new RoundedBoxGeometry(1.5, 0.07, 0.46, 2, 0.03).translate(0, -0.2, 0.56),
    new RoundedBoxGeometry(0.3, 0.14, 0.6, 2, 0.06).translate(0, 0.34, 0.4),
  ),
  () => mergeParts(
    new THREE.SphereGeometry(1, 12, 9, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.15, 0),
    new THREE.CylinderGeometry(1.05, 1.05, 0.22, 10).translate(0, -0.24, 0),
  ),
];

// Glasses: 0 = none
const GLASS_BUILDERS = [
  null,
  () => mergeParts(
    new THREE.TorusGeometry(0.3, 0.055, 6, 12).translate(-0.36, 0.04, 0.5),
    new THREE.TorusGeometry(0.3, 0.055, 6, 12).translate(0.36, 0.04, 0.5),
    new RoundedBoxGeometry(0.24, 0.06, 0.05, 2, 0.02).translate(0, 0.04, 0.5),
  ),
  () => mergeParts(
    new RoundedBoxGeometry(0.36, 0.11, 0.22, 2, 0.03).translate(-0.36, 0.05, 0.58),
    new RoundedBoxGeometry(0.36, 0.11, 0.22, 2, 0.03).translate(0.36, 0.05, 0.58),
    new RoundedBoxGeometry(0.2, 0.05, 0.1, 2, 0.02).translate(0, 0.05, 0.56),
  ),
];

function canvasTex(size, paint) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let shirtTexturesCache = null;
function shirtTextures() {
  if (shirtTexturesCache) return shirtTexturesCache;
  if (typeof document === "undefined") {
    // Headless tests: patterns are cosmetic, skip canvas textures.
    shirtTexturesCache = [null, null, null, null];
    return shirtTexturesCache;
  }
  const stripe = canvasTex(64, (c) => {
    c.fillStyle = "#ff000000"; c.fillRect(0, 0, 64, 64);
    c.fillStyle = "#00000070"; c.fillRect(0, 0, 64, 11); c.fillRect(0, 22, 64, 11);
  });
  const dots = canvasTex(64, (c) => {
    c.fillStyle = "#ff000000"; c.fillRect(0, 0, 64, 64);
    c.fillStyle = "#00000060";
    for (let x = 9; x < 64; x += 18)
      for (let y = 9; y < 64; y += 18) {
        c.beginPath(); c.arc(x, y, 4.5, 0, 7); c.fill();
      }
  });
  const checker = canvasTex(64, (c) => {
    c.fillStyle = "#ff000000"; c.fillRect(0, 0, 64, 64);
    c.fillStyle = "#00000070";
    for (let y = 0; y < 64; y += 16)
      for (let x = 0; x < 64; x += 16)
        if ((x / 16 + y / 16) % 2 === 0) c.fillRect(x, y, 16, 16);
  });
  shirtTexturesCache = [null, stripe, dots, checker];
  return shirtTexturesCache;
}

// ---------------------------------------------------------------------------
// Quaternion math (plain JS objects, cannon-style x/y/z/w).
// ---------------------------------------------------------------------------
const invQ = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
function qmul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
function qAxisAngle(q) {
  const s = Math.sqrt(1 - q.w * q.w);
  if (s < 1e-5) return null;
  return {
    axis: { x: q.x / s, y: q.y / s, z: q.z / s },
    angle: 2 * Math.acos(Math.max(-1, Math.min(1, q.w))),
  };
}
const axisAngleQ = (ax, ay, az, angle) => {
  const s = Math.sin(angle / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) };
};
const vq = (q, v) => {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
};
function slerpQ(a, b, t) {
  let w = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let sign = 1;
  if (w < 0) { w = -w; sign = -1; }
  if (w > 0.9999) return { x: b.x, y: b.y, z: b.z, w: b.w };
  const theta = Math.acos(Math.max(-1, Math.min(1, w)));
  const s = 1 / Math.sin(theta);
  return {
    x: (a.x * Math.sin((1 - t) * theta) + sign * b.x * Math.sin(t * theta)) * s,
    y: (a.y * Math.sin((1 - t) * theta) + sign * b.y * Math.sin(t * theta)) * s,
    z: (a.z * Math.sin((1 - t) * theta) + sign * b.z * Math.sin(t * theta)) * s,
    w: (a.w * Math.sin((1 - t) * theta) + sign * b.w * Math.sin(t * theta)) * s,
  };
}

// Each limb is a cylinder pivoting at its top; (r, len) in metres.
// The visual capsule is slightly tapered by scaling the cylinder.
export function createPeopleField({
  scene,
  route,
  obstacles = [],
  ramps = [],
  roadDist = () => 0,
  gravity = 9.82,
  count = 12,
  speech = () => false,
  onChange = () => {},
}) {
  const people = [];
  let hits = 0, lastYell = 0;
  let seed = 91357;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // --- physics world: floor, static obstacles, kinematic car ----------------
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -gravity, 0), allowSleep: false });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 8;
  world.defaultContactMaterial.friction = 0.45;
  world.defaultContactMaterial.restitution = 0.1;

  const floor = new CANNON.Body({ mass: 0, collisionFilterGroup: 1, collisionFilterMask: 3 | 16 });
  floor.addShape(new CANNON.Plane());
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floor.position.y = FLOOR_Y;
  world.addBody(floor);

  const prevCar = new CANNON.Vec3();
  const carBody = new CANNON.Body({
    type: CANNON.Body.KINEMATIC,
    collisionFilterGroup: 4,
    collisionFilterMask: 3 | 16,
  });
  carBody.addShape(new CANNON.Box(new CANNON.Vec3(1.05, 0.55, 2.2)));
  world.addBody(carBody);

  for (const o of obstacles) {
    const body = new CANNON.Body({ mass: 0, collisionFilterGroup: 8, collisionFilterMask: 3 | 16 });
    body.position.set(o.x, 1.5, o.z);
    body.addShape(o.hx !== undefined
      ? new CANNON.Box(new CANNON.Vec3(o.hx, 1.5, o.hz))
      : new CANNON.Cylinder(o.r, o.r, 3, 8));
    world.addBody(body);
  }
  for (const ramp of ramps) {
    const body = new CANNON.Body({ mass: 0, collisionFilterGroup: 8, collisionFilterMask: 3 | 16 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(ramp.width / 2, 0.4, ramp.length)));
    body.position.set(ramp.x, 0.5, ramp.z);
    body.quaternion.setFromEuler(0, ramp.heading, 0);
    world.addBody(body);
  }

  // --- instanced visual groups ----------------------------------------------
  const groups = new Map(); // key -> { mesh, slot } with slot = next free index
  function group(key, geometry, material, capacity) {
    let g = groups.get(key);
    if (!g) {
      const m = new THREE.InstancedMesh(geometry, material, capacity);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
      g = { mesh: m, slot: 0 };
      groups.set(key, g);
    }
    return g;
  }
  const alloc = (g) => g.slot++;

  const mat = (color, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
  const skinMat = mat(0xffffff);
  const pantsMat = mat(0xffffff);
  const shoeMat = mat(0xffffff, { roughness: 0.6 });
  const hairMat = mat(0xffffff, { roughness: 1 });
  const eyeMat = mat(0x0d0b09, { roughness: 0.2 });
  const glassMat = mat(0x101014, { metalness: 0.7, roughness: 0.3 });
  const hatMat = mat(0xffffff, { roughness: 0.9 });
  const shirtMats = [0, 1, 2, 3].map((p) => {
    const t = shirtTextures()[p];
    return mat(0xffffff, t ? { map: t, roughness: 0.7 } : { roughness: 0.7 });
  });

  // One mesh per part kind; slots are handed out per person at creation.
  const G = {
    head: group("head", unitSphere(), skinMat, count),
    torso: [0, 1, 2, 3].map((p) => group("torso" + p, unitBox(), shirtMats[p], count)),
    pelvis: group("pelvis", unitBox(), pantsMat, count),
    skinLimbs: group("skinLimbs", unitCapsule(), skinMat, count * 10),
    pantsLimbs: group("pantsLimbs", unitCapsule(), pantsMat, count * 10),
    hands: group("hands", unitSphere(), skinMat, count * 2),
    feet: group("feet", unitBox(), shoeMat, count * 2),
    eyes: group("eyes", unitSphere(), eyeMat, count * 2),
    hair: HAIR_BUILDERS.map((b) => group("hair" + HAIR_BUILDERS.indexOf(b), b(), hairMat, count)),
    hat: HAT_BUILDERS.map((b) => b ? group("hat" + HAT_BUILDERS.indexOf(b), b(), hatMat, count) : null),
    glasses: GLASS_BUILDERS.map((b) => b ? group("glasses" + GLASS_BUILDERS.indexOf(b), b(), glassMat, count) : null),
  };

  // --- person construction ---------------------------------------------------
  function findSpot() {
    for (let attempt = 0; attempt < 90; attempt++) {
      const i = Math.floor(rnd() * route.length);
      const p = route[i], a = route[(i + 1) % route.length];
      let nx = a.z - p.z, nz = p.x - a.x;
      const len = Math.hypot(nx, nz);
      if (len < 1e-6) continue;
      nx /= len; nz /= len;
      const side = rnd() < 0.5 ? 1 : -1;
      const off = 7.5 + rnd() * 5;
      const x = p.x + nx * off * side + (rnd() - 0.5) * 8;
      const z = p.z + nz * off * side + (rnd() - 0.5) * 8;
      if (Math.abs(x) > 300 || Math.abs(z) > 300) continue;
      if (roadDist(x, z) < 6.6) continue;
      if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < (o.hx ?? o.r) + 1.2)) continue;
      const dx = a.x - p.x, dz = a.z - p.z;
      return { x, z, heading: side > 0 ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz) };
    }
    return null;
  }

  const randomPick = (list) => list[Math.floor(rnd() * list.length)];

  for (let i = 0; i < count; i++) {
    const spot = findSpot();
    if (!spot) continue;
    const H = 1.55 + rnd() * 0.35; // total height
    const S = H / 1.75;
    const build = 0.82 + rnd() * 0.28; // shoulder/hip width factor
    const p = {
      H, S, build,
      walkSpeed: 1.0 + rnd() * 1.2,
      phase: rnd() * Math.PI * 2,
      heading: spot.heading,
      origin: { x: spot.x, z: spot.z },
      target: null,
      skin: randomPick(SKIN),
      hairStyle: Math.floor(rnd() * HAIR_BUILDERS.length),
      hairColor: randomPick(HAIR_COLORS),
      hatStyle: rnd() < 0.24 ? 1 + Math.floor(rnd() * (HAT_BUILDERS.length - 1)) : 0,
      hatColor: randomPick(SHIRT_COLORS),
      glassesStyle: rnd() < 0.22 ? 1 + Math.floor(rnd() * (GLASS_BUILDERS.length - 1)) : 0,
      shirtStyle: Math.floor(rnd() * 4),
      shirtColor: randomPick(SHIRT_COLORS),
      pantsStyle: rnd() < 0.62 ? 1 : 0, // 1 = long pants (calves covered)
      pantsColor: randomPick(PANTS_COLORS),
      shoeColor: randomPick(SHOE_COLORS),
      state: "stand", // stand | panic | tumble | down | rise
      stateT: 0,
      panicT: 0,
      crush: 0,
      flatT: 0,
      riseQ: { x: 0, y: 0, z: 0, w: 1 }, // pelvis quaternion when lying down
      pelvisY: 1.08 * S,
      gaitTqs: null,
    };

    // Physics bodies -----------------------------------------------------------
    const mkBody = (shape, mass, groupMask, offset = new CANNON.Vec3()) => {
      const b = new CANNON.Body({
        mass,
        allowSleep: false,
        collisionFilterGroup: 16,
        collisionFilterMask: groupMask,
        linearDamping: 0.3,
        angularDamping: 0.25,
      });
      b.addShape(shape, offset);
      world.addBody(b);
      return b;
    };
    const floorMask = 1 | 4 | 8 | 16; // collide with floor, car, obstacles, people
    const airMask = 4 | 8 | 16; // walking: no floor contact (kinematic puppet)
    const PX = 0.16 * S * build, TX = 0.235 * S * build;

    const pelvis = mkBody(new CANNON.Box(new CANNON.Vec3(PX, 0.09 * S, 0.12 * S)), 14, airMask);
    const torso = mkBody(new CANNON.Box(new CANNON.Vec3(TX, 0.24 * S, 0.15 * S)), 22, airMask);
    const head = mkBody(new CANNON.Sphere(0.135 * S), 4.5, airMask);
    const limb = (r, len, mass) => mkBody(new CANNON.Cylinder(r, r, len, 6), mass, airMask);
    const uaL = limb(0.055 * S, 0.28 * S, 3), uaR = limb(0.055 * S, 0.28 * S, 3);
    const foL = limb(0.045 * S, 0.26 * S, 2), foR = limb(0.045 * S, 0.26 * S, 2);
    const haL = mkBody(new CANNON.Sphere(0.05 * S), 0.5, airMask), haR = mkBody(new CANNON.Sphere(0.05 * S), 0.5, airMask);
    const thL = limb(0.085 * S, 0.5 * S, 8), thR = limb(0.085 * S, 0.5 * S, 8);
    const caL = limb(0.06 * S, 0.47 * S, 5), caR = limb(0.06 * S, 0.47 * S, 5);
    const ftL = mkBody(new CANNON.Box(new CANNON.Vec3(0.045 * S, 0.032 * S, 0.11 * S)), 1.2, airMask);
    const ftR = mkBody(new CANNON.Box(new CANNON.Vec3(0.045 * S, 0.032 * S, 0.11 * S)), 1.2, airMask);

    // Standing skeleton (world offsets from pelvis center, upright).
    const ST = {
      torso: [0, 0.09 * S + 0.24 * S, 0],
      head: [0, 0.09 * S + 0.48 * S + 0.135 * S, 0],
      uaL: [-TX, 0.09 * S + 0.22 * S, 0], uaR: [TX, 0.09 * S + 0.22 * S, 0],
      foL: [-TX, 0.09 * S + 0.22 * S - 0.28 * S, 0], foR: [TX, 0.09 * S + 0.22 * S - 0.28 * S, 0],
      haL: [-TX, 0.09 * S + 0.22 * S - 0.54 * S, 0], haR: [TX, 0.09 * S + 0.22 * S - 0.54 * S, 0],
      thL: [-PX, -0.05 * S, 0], thR: [PX, -0.05 * S, 0],
      caL: [-PX, -0.05 * S - 0.5 * S, 0], caR: [PX, -0.05 * S - 0.5 * S, 0],
      ftL: [-PX, -0.05 * S - 0.97 * S + 0.02 * S, 0.03 * S], ftR: [PX, -0.05 * S - 0.97 * S + 0.02 * S, 0.03 * S],
    };
    const B = { pelvis, torso, head, uaL, uaR, foL, foR, haL, haR, thL, thR, caL, caR, ftL, ftR };
    pelvis.position.set(spot.x, p.pelvisY, spot.z);
    pelvis.quaternion.setFromEuler(0, spot.heading, 0);
    for (const k of Object.keys(ST)) {
      const b = B[k];
      b.position.set(spot.x + ST[k][0], p.pelvisY + ST[k][1], spot.z + ST[k][2]);
      b.quaternion.set(0, 0, 0, 1);
      b.velocity.setZero();
      b.angularVelocity.setZero();
      b.aabbNeedsUpdate = true;
    }

    // Joint map: child -> { parent, pa (anchor on parent, local), co (anchor on child, local) }
    const ll = 0.28 * S, lf = 0.26 * S, lt = 0.5 * S, lc = 0.47 * S;
    const joints = [
      ["torso", "pelvis", [0, 0.09 * S, 0], [0, -0.24 * S, 0]],
      ["head", "torso", [0, 0.24 * S, 0], [0, -0.135 * S, 0]],
      ["uaL", "torso", [-TX, 0.2 * S, 0], [0, -ll / 2, 0]],
      ["uaR", "torso", [TX, 0.2 * S, 0], [0, -ll / 2, 0]],
      ["foL", "uaL", [0, -ll / 2, 0], [0, -lf / 2, 0]],
      ["foR", "uaR", [0, -ll / 2, 0], [0, -lf / 2, 0]],
      ["haL", "foL", [0, -lf / 2, 0], [0, 0.04 * S, 0]],
      ["haR", "foR", [0, -lf / 2, 0], [0, 0.04 * S, 0]],
      ["thL", "pelvis", [-PX, -0.085 * S, 0], [0, -lt / 2, 0]],
      ["thR", "pelvis", [PX, -0.085 * S, 0], [0, -lt / 2, 0]],
      ["caL", "thL", [0, -lt / 2, 0], [0, -lc / 2, 0]],
      ["caR", "thR", [0, -lt / 2, 0], [0, -lc / 2, 0]],
      ["ftL", "caL", [0, -lc / 2, 0], [0, -0.02 * S, 0]],
      ["ftR", "caR", [0, -lc / 2, 0], [0, -0.02 * S, 0]],
    ].map(([child, parent, pa, co]) => ({
      child, parent,
      pa: new CANNON.Vec3(...pa), co: new CANNON.Vec3(...co),
      tq: { x: 0, y: 0, z: 0, w: 1 },
    }));

    // Visual slots -------------------------------------------------------------
    const slot = (g) => alloc(g);
    const s = p.slots = {
      head: slot(G.head),
      torso: slot(G.torso[p.shirtStyle]),
      pelvis: slot(G.pelvis),
      skin: { uaL: slot(G.skinLimbs), uaR: slot(G.skinLimbs), foL: slot(G.skinLimbs), foR: slot(G.skinLimbs), haL: slot(G.hands), haR: slot(G.hands), thL: slot(G.skinLimbs), thR: slot(G.skinLimbs), caL: slot(G.skinLimbs), caR: slot(G.skinLimbs) },
      pants: { thL: slot(G.pantsLimbs), thR: slot(G.pantsLimbs), caL: slot(G.pantsLimbs), caR: slot(G.pantsLimbs) },
      feet: { L: slot(G.feet), R: slot(G.feet) },
      eyes: { L: slot(G.eyes), R: slot(G.eyes) },
      hair: slot(G.hair[p.hairStyle]),
      hat: p.hatStyle ? slot(G.hat[p.hatStyle]) : -1,
      glasses: p.glassesStyle ? slot(G.glasses[p.glassesStyle]) : -1,
    };
    const color = (g, idx, c) => g.mesh.setColorAt(idx, new THREE.Color(c));
    color(G.head, s.head, p.skin);
    color(G.torso[p.shirtStyle], s.torso, p.shirtColor);
    color(G.pelvis, s.pelvis, p.pantsColor);
    for (const side of ["L", "R"]) {
      color(G.skinLimbs, s.skin["ua" + side], p.skin);
      color(G.skinLimbs, s.skin["fo" + side], p.skin);
      color(G.skinLimbs, s.skin["th" + side], p.pantsStyle ? p.pantsColor : p.skin);
      color(G.skinLimbs, s.skin["ca" + side], p.pantsStyle ? p.pantsColor : p.skin);
      color(G.hands, s.skin["ha" + side], p.skin);
      color(G.feet, s.feet[side], p.shoeColor);
      color(G.eyes, s.eyes[side], 0x0d0b09);
    }
    for (const side of ["L", "R"]) {
      color(G.pantsLimbs, s.pants["th" + side], p.pantsColor);
      color(G.pantsLimbs, s.pants["ca" + side], p.pantsColor);
    }
    color(G.hair[p.hairStyle], s.hair, p.hairColor);
    if (p.hatStyle) color(G.hat[p.hatStyle], s.hat, p.hatColor);

    people.push({ ...p, body: B, joints, ST });
  }

  // Shrink unused instanced slots off-screen so they are never drawn.
  const dummy = new THREE.Object3D();
  dummy.position.set(0, -40, 0);
  dummy.scale.setScalar(0.001);
  dummy.quaternion.set(0, 0, 0, 1);
  dummy.updateMatrix();
  const emptyMatrix = dummy.matrix;
  const allGroups = [...groups.values()];
  for (const g of allGroups) for (let i = g.slot; i < g.mesh.count; i++) g.mesh.setMatrixAt(i, emptyMatrix);

  // ---------------------------------------------------------------------------
  // Pose targets
  // ---------------------------------------------------------------------------
  function makeTargets() {
    const q = { x: 0, y: 0, z: 0, w: 1 };
    return {
      torso: q, head: q,
      uaL: q, uaR: q, foL: q, foR: q, haL: q, haR: q,
      thL: q, thR: q, caL: q, caR: q, ftL: q, ftR: q,
    };
  }
  function applyTargets(p, tqs) {
    for (const j of p.joints) j.tq = tqs[j.child] ?? j.tq;
    p.gaitTqs = tqs;
  }
  // Gait: hips swing about X, knees un/fold, arms counter-swing, spine leans
  // into the walk. All in the pelvis local frame (facing +Z).
  function gaitTargets(p, t, speed, arm) {
    const tqs = p.gaitTqs;
    const freq = (speed / (1.6 * p.S)) * 1.35;
    const ph = t * freq * Math.PI * 2 + p.phase;
    const A = Math.min(0.66, speed * 0.26 + 0.06);
    const swL = Math.sin(ph) * A, swR = Math.sin(ph + Math.PI) * A;
    const knL = Math.max(0, Math.sin(ph + Math.PI)) * 1.25;
    const knR = Math.max(0, Math.sin(ph)) * 1.25;
    const lean = Math.min(0.4, p.state === "panic" ? 0.34 : speed * 0.045 + 0.05);
    tqs.thL = axisAngleQ(1, 0, 0, -swL * 1.15);
    tqs.thR = axisAngleQ(1, 0, 0, -swR * 1.15);
    tqs.caL = qmul(tqs.thL, axisAngleQ(1, 0, 0, -(Math.PI - 0.35) - knL));
    tqs.caR = qmul(tqs.thR, axisAngleQ(1, 0, 0, -(Math.PI - 0.35) - knR));
    tqs.uaL = axisAngleQ(1, 0, 0, arm * -swR * 0.9);
    tqs.uaR = axisAngleQ(1, 0, 0, arm * -swL * 0.9);
    tqs.foL = qmul(tqs.uaL, axisAngleQ(1, 0, 0, -0.5 - swR * 0.6));
    tqs.foR = qmul(tqs.uaR, axisAngleQ(1, 0, 0, -0.5 - swL * 0.6));
    tqs.haL = qmul(tqs.foL, axisAngleQ(1, 0, 0, -0.4));
    tqs.haR = qmul(tqs.foR, axisAngleQ(1, 0, 0, -0.4));
    tqs.torso = axisAngleQ(1, 0, 0, lean);
    tqs.head = axisAngleQ(1, 0, 0, -lean * 0.75);
    tqs.ftL = axisAngleQ(1, 0, 0, -swL * 0.15);
    tqs.ftR = axisAngleQ(1, 0, 0, -swR * 0.15);
    return tqs;
  }
  function standingTargets(p) {
    const tqs = p.gaitTqs;
    tqs.thL = axisAngleQ(1, 0, 0, -0.1); tqs.thR = axisAngleQ(1, 0, 0, 0.1);
    tqs.caL = qmul(tqs.thL, axisAngleQ(1, 0, 0, -(Math.PI - 0.55)));
    tqs.caR = qmul(tqs.thR, axisAngleQ(1, 0, 0, -(Math.PI - 0.55)));
    tqs.uaL = axisAngleQ(1, 0, 0, -0.12); tqs.uaR = axisAngleQ(1, 0, 0, 0.12);
    tqs.foL = qmul(tqs.uaL, axisAngleQ(1, 0, 0, -0.35));
    tqs.foR = qmul(tqs.uaR, axisAngleQ(1, 0, 0, -0.35));
    tqs.haL = qmul(tqs.foL, axisAngleQ(1, 0, 0, -0.3));
    tqs.haR = qmul(tqs.foR, axisAngleQ(1, 0, 0, -0.3));
    tqs.torso = axisAngleQ(1, 0, 0, 0.05);
    tqs.head = axisAngleQ(1, 0, 0, -0.04);
    tqs.ftL = axisAngleQ(1, 0, 0, 0);
    tqs.ftR = axisAngleQ(1, 0, 0, 0);
  }
  // Keyframed get-up: lie -> push-up -> upright, ~1.9 s.
  function riseTargets(p, t) {
    const k = Math.min(1, t / 1.9);
    const fold = Math.sin(Math.min(1, k * 1.7) * Math.PI * 0.5); // 0 -> 1 unfold
    const up = Math.sin(Math.min(1, k * 3.4) * Math.PI * 0.5); // pelvis lift
    const tqs = p.gaitTqs;
    const lie = p.riseQ; // world orientation when they fell
    const spine = slerpQ(axisAngleQ(1, 0, 0, 0.35), axisAngleQ(1, 0, 0, 0.06), fold);
    const legRelax = axisAngleQ(1, 0, 0, Math.PI - 1.2); // knees tucked to belly
    tqs.torso = spine;
    tqs.head = slerpQ(axisAngleQ(1, 0, 0, 0.8), axisAngleQ(1, 0, 0, -0.05), fold);
    tqs.thL = slerpQ(axisAngleQ(1, 0, 0, -0.35), axisAngleQ(1, 0, 0, -0.1), fold);
    tqs.thR = slerpQ(axisAngleQ(1, 0, 0, -0.35), axisAngleQ(1, 0, 0, -0.1), fold);
    tqs.caL = qmul(tqs.thL, slerpQ(axisAngleQ(1, 0, 0, Math.PI - 0.7), axisAngleQ(1, 0, 0, -(Math.PI - 0.5)), fold));
    tqs.caR = qmul(tqs.thR, slerpQ(axisAngleQ(1, 0, 0, Math.PI - 0.7), axisAngleQ(1, 0, 0, -(Math.PI - 0.5)), fold));
    tqs.uaL = slerpQ(axisAngleQ(1, 0, 0, -2.3), axisAngleQ(1, 0, 0, -0.15), fold); // arms brace out
    tqs.uaR = slerpQ(axisAngleQ(1, 0, 0, -2.3), axisAngleQ(1, 0, 0, -0.15), fold);
    tqs.foL = qmul(tqs.uaL, axisAngleQ(1, 0, 0, 1.8));
    tqs.foR = qmul(tqs.uaR, axisAngleQ(1, 0, 0, 1.8));
    tqs.haL = axisAngleQ(1, 0, 0, -0.2);
    tqs.haR = axisAngleQ(1, 0, 0, -0.2);
    tqs.ftL = axisAngleQ(1, 0, 0, 0.3);
    tqs.ftR = axisAngleQ(1, 0, 0, 0.3);
    // pelvis world goal (upright + standing y)
    const yGoal = FLOOR_Y + (p.pelvisY - FLOOR_Y) * up;
    return { yGoal, up, lie };
  }

  // ---------------------------------------------------------------------------
  // Joint controller
  // ---------------------------------------------------------------------------
  const kpPose = (p, gain) => {
    const B = p.body, P = new CANNON.Vec3(), C = new CANNON.Vec3(), D = new CANNON.Vec3(), F = new CANNON.Vec3();
    for (const j of p.joints) {
      const Pb = B[j.parent], Cb = B[j.child];
      const pa = vq({ x: Pb.quaternion.x, y: Pb.quaternion.y, z: Pb.quaternion.z, w: Pb.quaternion.w }, { x: j.pa.x, y: j.pa.y, z: j.pa.z });
      P.set(pa.x + Pb.position.x, pa.y + Pb.position.y, pa.z + Pb.position.z);
      const co = vq({ x: Cb.quaternion.x, y: Cb.quaternion.y, z: Cb.quaternion.z, w: Cb.quaternion.w }, { x: j.co.x, y: j.co.y, z: j.co.z });
      C.set(co.x + Cb.position.x, co.y + Cb.position.y, co.z + Cb.position.z);
      D.copy(C).vsub(P, D);
      const d = D.length();
      if (d < 1e-4) continue;
      D.normalize();
      const rv = Cb.velocity.clone().vsub(Pb.velocity);
      const vd = rv.dot(D);
      F.copy(D).scale(Math.max(-90, Math.min(90, (d * 420 - vd * 22) * gain)));
      Cb.applyForce(F.clone(), C);
      Cb.applyForce(F.scale(-1), P);
    }
  };
  const kpOrient = (p, rate, maxRate) => {
    const B = p.body;
    for (const j of p.joints) {
      const Pb = B[j.parent], Cb = B[j.child];
      const qP = { x: Pb.quaternion.x, y: Pb.quaternion.y, z: Pb.quaternion.z, w: Pb.quaternion.w };
      const qC = { x: Cb.quaternion.x, y: Cb.quaternion.y, z: Cb.quaternion.z, w: Cb.quaternion.w };
      const rel = qmul(invQ(qP), qC);
      const aa = qAxisAngle(qmul(rel, invQ(j.tq)));
      if (!aa) continue;
      const r = Math.max(-maxRate, Math.min(maxRate, aa.angle * rate));
      const w = vq(qP, aa.axis);
      Cb.angularVelocity.copy(Pb.angularVelocity);
      Cb.angularVelocity.x += w.x * r;
      Cb.angularVelocity.y += w.y * r;
      Cb.angularVelocity.z += w.z * r;
      // mild reaction on the parent keeps the spine from flying about
      Pb.angularVelocity.x -= w.x * r * 0.12;
      Pb.angularVelocity.y -= w.y * r * 0.12;
      Pb.angularVelocity.z -= w.z * r * 0.12;
    }
  };

  // ---------------------------------------------------------------------------
  // Comedy: knockbacks, pancaking, rubber springs, yells.
  // ---------------------------------------------------------------------------
  function knock(p, carSpeed, heading, strength) {
    const B = p.body;
    const jx = Math.sin(heading), jz = Math.cos(heading);
    const J = (carSpeed * 8 + 5) * strength;
    const rand = () => (rnd() - 0.5);
    for (const k of Object.keys(B)) {
      const b = B[k];
      const f = b === B.pelvis ? 1 : 0.72;
      b.applyImpulse(new CANNON.Vec3(
        jx * J * f * (0.75 + rand() * 0.5),
        (carSpeed * 3.4 * f + 2.2) + rand() * 1.2,
        jz * J * f * (0.75 + rand() * 0.5),
      ), new CANNON.Vec3(rand() * 0.3, 0.35 + rand() * 0.2, rand() * 0.3));
    }
    B.pelvis.angularVelocity.set(rand() * 8, rand() * 6, rand() * 8);
    hits++;
    yell();
  }
  function yell() {
    if (!speech() || !("speechSynthesis" in window)) return;
    const now = performance.now();
    if (now - lastYell < 420) return;
    lastYell = now;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(YELLS[Math.floor(rnd() * YELLS.length)]);
      u.lang = "en-GB";
      u.rate = 1.1 + rnd() * 0.6;
      u.pitch = 0.8 + rnd() * 0.9;
      speechSynthesis.speak(u);
    } catch {}
  }

  function settle(p) {
    // Called when the state machine is done: restore walking pose.
    p.crush = 0;
    p.flatT = 0;
  }

  // ---------------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------------
  function update(dt, car, speed, t) {
    const carX = car.position.x, carZ = car.position.z;
    let sim = false;

    for (const p of people) {
      const B = p.body;
      p.stateT += dt;
      const dist = Math.hypot(B.pelvis.position.x - carX, B.pelvis.position.z - carZ);

      // --- state machine --------------------------------------------------------
      if (p.state === "stand" || p.state === "panic") {
        if (dist < 2.4 && speed > 2.5) {
          knock(p, speed, car.heading, p.state === "panic" ? 1.5 : 1.15);
          p.state = "tumble";
          p.stateT = 0;
          for (const k of Object.keys(B)) B[k].collisionFilterMask = 1 | 4 | 8 | 16;
        } else if (dist < 15 && speed > 6 && p.state === "stand") {
          p.state = "panic";
          p.panicT = 0;
          p.stateT = 0;
        } else if (p.state === "panic") {
          p.panicT += dt;
          if (dist > 28 || speed < 0.5 || p.panicT > 8) p.state = "stand";
        }
        if (p.state !== "panic") p.panicT = 0;
      } else if (p.state === "tumble") {
        if (dist < 2.5 && speed > 2) {
          // Car parked on top: pancake.
          p.crush = Math.min(1, p.crush + dt * 2.2);
          p.flatT += dt;
          B.pelvis.velocity.y = Math.min(B.pelvis.velocity.y, -0.3);
        } else {
          p.crush = Math.max(0, p.crush - dt * 1.6);
          if (p.flatT > 0.3) {
            // Rubber spring: boing back up when the car passes.
            const v = 4.5;
            for (const k of Object.keys(B)) {
              B[k].velocity.y += v;
              B[k].angularVelocity.scale(0.4);
            }
            p.flatT = 0;
            p.stateT = 0;
          }
        }
        const v = Math.hypot(B.pelvis.velocity.x, B.pelvis.velocity.z) + Math.abs(B.pelvis.velocity.y);
        if (p.stateT > 2.4 && v < 1.0 && B.pelvis.position.y < 1.0 * p.S) {
          p.state = "down";
          p.stateT = 0;
          p.riseQ = { x: B.pelvis.quaternion.x, y: B.pelvis.quaternion.y, z: B.pelvis.quaternion.z, w: B.pelvis.quaternion.w };
        }
      } else if (p.state === "down") {
        p.crush = Math.max(0, p.crush - dt * 2.5);
        if (p.stateT > 0.5 && dist > 3.4) {
          p.state = "rise";
          p.stateT = 0;
        }
      } else if (p.state === "rise") {
        if (dist < 2 && speed > 3) {
          knock(p, speed, car.heading, 0.9);
          p.state = "tumble";
          p.stateT = 0;
          for (const k of Object.keys(B)) B[k].collisionFilterMask = 1 | 4 | 8 | 16;
        }
      }

      // --- movement/puppetry -----------------------------------------------------
      if (p.state === "stand" || p.state === "panic") {
        let tx, tz;
        if (p.state === "panic") {
          const dx = B.pelvis.position.x - carX, dz = B.pelvis.position.z - carZ;
          const d = Math.hypot(dx, dz) || 1;
          tx = B.pelvis.position.x + dx / d * 16;
          tz = B.pelvis.position.z + dz / d * 16;
          p.panicT += dt;
        } else {
          if (!p.target || Math.hypot(p.target.x - B.pelvis.position.x, p.target.z - B.pelvis.position.z) < 2) {
            const ia = Math.floor(rnd() * route.length);
            const a = rnd() * Math.PI * 2, s = 20 + rnd() * 40;
            p.target = {
              x: THREE.MathUtils.clamp(route[ia].x + Math.sin(a) * s, -300, 300),
              z: THREE.MathUtils.clamp(route[ia].z + Math.cos(a) * s, -300, 300),
            };
          }
          tx = p.target.x; tz = p.target.z;
        }
        const dx = tx - B.pelvis.position.x, dz = tz - B.pelvis.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) {
          const nx = dx / d, nz = dz / d;
          const sp = p.state === "panic" ? Math.min(7.4, 3.4 + speed * 0.55) : p.walkSpeed;
          // panic: occasionally face-plant mid-sprint (comedy!)
          if (p.state === "panic" && rnd() < dt * 0.02) {
            knock(p, sp, Math.atan2(nx, nz), 0.9);
            p.state = "tumble";
            p.stateT = 0;
            for (const k of Object.keys(B)) B[k].collisionFilterMask = 1 | 4 | 8 | 16;
            continue;
          }
          B.pelvis.position.x += nx * sp * dt;
          B.pelvis.position.z += nz * sp * dt;
          const bob = Math.abs(Math.sin(p.phase + t * sp * 2.3)) * 0.025 * p.S;
          B.pelvis.position.y = p.pelvisY + bob;
          B.pelvis.velocity.setZero();
          B.pelvis.angularVelocity.set(0, 0, 0);
          const h = Math.atan2(nx, nz);
          B.pelvis.quaternion.setFromEuler(0, h, 0);
          gaitTargets(p, t + p.phase, sp, p.state === "panic" ? 2.4 : 1);
        } else if (p.state === "stand") {
          gaitTargets(p, t + p.phase, 0, 0.6);
        } else {
          gaitTargets(p, t + p.phase, 2, 2.4);
        }
        applyTargets(p, p.gaitTqs);
      } else if (p.state === "rise") {
        const r = riseTargets(p, p.stateT);
        applyTargets(p, p.gaitTqs);
        // Lift the pelvis toward standing height; feet push against the floor.
        const lift = (r.yGoal - B.pelvis.position.y) * 30 - B.pelvis.velocity.y * 5;
        B.pelvis.applyForce(new CANNON.Vec3(0, Math.max(0, Math.min(90, lift)), 0), B.pelvis.position.clone());
        // Steer the pelvis toward world-upright.
        const qP = { x: B.pelvis.quaternion.x, y: B.pelvis.quaternion.y, z: B.pelvis.quaternion.z, w: B.pelvis.quaternion.w };
        const err = qmul(invQ(qP), r.lie);
        const aa = qAxisAngle(err);
        if (aa && aa.angle > 0.02) {
          const w = vq({ x: B.pelvis.quaternion.x, y: B.pelvis.quaternion.y, z: B.pelvis.quaternion.z, w: B.pelvis.quaternion.w }, aa.axis);
          B.pelvis.angularVelocity.copy({ x: w.x * aa.angle * 6, y: w.y * aa.angle * 6, z: w.z * aa.angle * 6 });
        } else {
          B.pelvis.angularVelocity.set(0, 0, 0);
        }
        B.pelvis.velocity.x *= Math.exp(-2.5 * dt);
        B.pelvis.velocity.z *= Math.exp(-2.5 * dt);
        if (p.stateT > 2 && B.pelvis.position.y > 0.78 * p.pelvisY) {
          // landmark: standing!
          B.pelvis.quaternion.setFromEuler(0, p.heading, 0);
          B.pelvis.velocity.setZero();
          for (const k of Object.keys(B)) B[k].collisionFilterMask = 4 | 8 | 16;
          p.pelvisY = 1.08 * p.S;
          B.pelvis.position.y = p.pelvisY;
          settle(p);
          standingTargets(p);
          applyTargets(p, p.gaitTqs);
          p.state = "stand";
          p.stateT = 0;
        }
      } else {
        // tumble/down: keep last target poses (they flop toward them weakly)
      }

      // --- joint control ---------------------------------------------------------
      const flop = p.state === "tumble" || p.state === "down";
      kpPose(p, flop ? 0.5 : 1);
      kpOrient(p, p.state === "rise" ? 7 : flop ? 1.6 : 4, p.state === "rise" ? 9 : flop ? 3.5 : 5);
      if (flop) {
        B.torso.angularVelocity.scale(Math.exp(-1.2 * dt));
      }
      sim = sim || p.state !== "stand" && p.state !== "panic";

      // --- visuals ----------------------------------------------------------------
      const render = (g, idx, bx, bq, ox, oy, oz, sx, sy, sz) => {
        const o = vq({ x: bq.x, y: bq.y, z: bq.z, w: bq.w }, { x: ox, y: oy, z: oz });
        const base = B.pelvis.position.y;
        const sy2 = sy * (1 - p.crush * 0.62);
        const y = base + (bx.y + o.y - base) * (1 - p.crush * 0.62);
        dummy.position.set(bx.x + o.x, y, bx.z + o.z);
        dummy.quaternion.set(bq.x, bq.y, bq.z, bq.w);
        dummy.scale.set(sx, sy2, sz);
        dummy.updateMatrix();
        g.mesh.setMatrixAt(idx, dummy.matrix);
      };
      const s = p.slots;
      const qT = { x: B.torso.quaternion.x, y: B.torso.quaternion.y, z: B.torso.quaternion.z, w: B.torso.quaternion.w };
      const qP = { x: B.pelvis.quaternion.x, y: B.pelvis.quaternion.y, z: B.pelvis.quaternion.z, w: B.pelvis.quaternion.w };
      const qH = { x: B.head.quaternion.x, y: B.head.quaternion.y, z: B.head.quaternion.z, w: B.head.quaternion.w };
      render(G.torso[p.shirtStyle], s.torso, B.torso, qT, 0, 0, 0, 0.5 * p.S * p.build, 0.52 * p.S, 0.28 * p.S);
      render(G.pelvis, s.pelvis, B.pelvis, qP, 0, 0, 0, 0.34 * p.S, 0.2 * p.S, 0.24 * p.S);
      // Capsule limbs: unit capsule = radius 0.5, total height 2.
      const limb = (len, r) => [2 * r, len / 2, 2 * r];
      for (const side of ["L", "R"]) {
        const ua = B["ua" + side], fo = B["fo" + side], ha = B["ha" + side];
        const th = B["th" + side], ca = B["ca" + side], ft = B["ft" + side];
        const u = side === "L" ? -1 : 1;
        const [ar, ay] = limb(0.28 * p.S, 0.055 * p.S);
        render(G.skinLimbs, s.skin["ua" + side], ua, { x: ua.quaternion.x, y: ua.quaternion.y, z: ua.quaternion.z, w: ua.quaternion.w }, 0, 0, 0, ar, ay, ar);
        const [fr, fy] = limb(0.26 * p.S, 0.045 * p.S);
        render(G.skinLimbs, s.skin["fo" + side], fo, { x: fo.quaternion.x, y: fo.quaternion.y, z: fo.quaternion.z, w: fo.quaternion.w }, 0, 0, 0, fr, fy, fr);
        render(G.hands, s.skin["ha" + side], ha, { x: ha.quaternion.x, y: ha.quaternion.y, z: ha.quaternion.z, w: ha.quaternion.w }, 0, 0, 0, 0.06 * p.S, 0.065 * p.S, 0.055 * p.S);
        const legMesh = p.pantsStyle ? G.pantsLimbs : G.skinLimbs;
        const [tr, ty] = limb(0.5 * p.S, 0.085 * p.S);
        render(legMesh, s.skin["th" + side], th, { x: th.quaternion.x, y: th.quaternion.y, z: th.quaternion.z, w: th.quaternion.w }, 0, 0, 0, tr, ty, tr);
        const [cr, cy] = limb(0.47 * p.S, 0.06 * p.S);
        render(legMesh, s.skin["ca" + side], ca, { x: ca.quaternion.x, y: ca.quaternion.y, z: ca.quaternion.z, w: ca.quaternion.w }, 0, 0, 0, cr, cy, cr);
        render(G.feet, s.feet[side], ft, { x: ft.quaternion.x, y: ft.quaternion.y, z: ft.quaternion.z, w: ft.quaternion.w }, 0, 0, 0.13 * p.S, 0.1 * p.S, 0.05 * p.S, 0.22 * p.S);
        render(G.eyes, s.eyes[side], B.head, qH, u * 0.055 * p.S, 0.02 * p.S, 0.13 * p.S, 0.05 * p.S, 0.035 * p.S, 0.02 * p.S);
      }
      // torso "sit" lean already encoded by physics; head on top:
      render(G.head, s.head, B.head, qH, 0, 0, 0, 0.31 * p.S, 0.3 * p.S, 0.3 * p.S);
      const hr = 0.145 * p.S;
      render(G.hair[p.hairStyle], s.hair, B.head, qH, 0, hr * 0.92, 0, 1.06 * hr, 1.06 * hr, 1.06 * hr);
      if (p.hatStyle) render(G.hat[p.hatStyle], s.hat, B.head, qH, 0, hr * 1.02, 0, 1.3 * hr, 1.3 * hr, 1.3 * hr);
      if (p.glassesStyle) render(G.glasses[p.glassesStyle], s.glasses, B.head, qH, 0, 0.03 * p.S, 0.13 * p.S, 0.24 * p.S, 0.24 * p.S, 0.24 * p.S);
    }

    for (const g of allGroups) g.mesh.instanceMatrix.needsUpdate = true;

    // --- cannon step (only when somebody is dynamic) --------------------------
    if (sim) {
      const teleport = Math.hypot(car.position.x - prevCar.x, car.position.z - prevCar.z) > 30;
      carBody.position.set(teleport ? car.position.x : prevCar.x, car.position.y + 0.7, teleport ? car.position.z : prevCar.z);
      carBody.velocity.set(teleport ? 0 : (car.position.x - prevCar.x) / dt, 0, teleport ? 0 : (car.position.z - prevCar.z) / dt);
      carBody.quaternion.setFromEuler(0, car.heading, 0);
      carBody.aabbNeedsUpdate = true;
      world.step(1 / 120, Math.min(dt, 0.05), 8);
      prevCar.copy(car.position);
      onChange();
    } else {
      prevCar.copy(car.position);
    }
  }

  function reset(position = new THREE.Vector3(), heading = 0) {
    hits = 0;
    world.accumulator = 0;
    prevCar.copy(position);
    carBody.position.set(position.x, position.y + 0.7, position.z);
    carBody.velocity.setZero();
    carBody.quaternion.setFromEuler(0, heading, 0);
    carBody.aabbNeedsUpdate = true;
    for (const p of people) {
      const B = p.body;
      p.state = "stand";
      p.stateT = 0;
      p.panicT = 0;
      p.crush = 0;
      p.flatT = 0;
      p.target = null;
      B.pelvis.position.set(p.origin.x, p.pelvisY, p.origin.z);
      B.pelvis.quaternion.setFromEuler(0, p.heading, 0);
      B.pelvis.velocity.setZero();
      B.pelvis.angularVelocity.setZero();
      for (const k of Object.keys(p.ST)) {
        const b = B[k], off = p.ST[k];
        b.position.set(p.origin.x + off[0], p.pelvisY + off[1], p.origin.z + off[2]);
        b.quaternion.set(0, 0, 0, 1);
        b.velocity.setZero();
        b.angularVelocity.setZero();
        b.collisionFilterMask = 4 | 8 | 16;
        b.aabbNeedsUpdate = true;
      }
      standingTargets(p);
      applyTargets(p, p.gaitTqs);
    }
    world.broadphase.dirty = true;
    for (const g of allGroups) g.mesh.instanceMatrix.needsUpdate = true;
    onChange();
  }

  // Initialize per-person gait targets so nothing is null before first update.
  for (const p of people) {
    p.gaitTqs = makeTargets();
    standingTargets(p);
  }
  reset();

  return {
    update,
    reset,
    state: () => ({
      count: people.length,
      hits,
      walking: people.filter((p) => p.state === "stand").length,
      panicking: people.filter((p) => p.state === "panic").length,
      tumbling: people.filter((p) => p.state === "tumble").length,
      down: people.filter((p) => p.state === "down").length,
      rising: people.filter((p) => p.state === "rise").length,
      crushed: people.filter((p) => p.crush > 0.4).length,
      positions: people.slice(0, 3).map((p) => p.body.pelvis.position.toArray()),
    }),
  };
}