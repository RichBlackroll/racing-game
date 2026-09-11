import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const TYPES = ["balloon", "rocket", "elephant", "plane", "helicopter", "birds", "kite", "airship", "ufo", "satellite", "comet", "astronaut"];
const C = {
  red: 0xe74646, coral: 0xff7654, yellow: 0xffcf45, gold: 0xe7a535,
  teal: 0x21b6ae, blue: 0x397de0, navy: 0x243553, cream: 0xfff0d5,
  white: 0xf1f5f6, gray: 0x8795ad, purple: 0x9382c5, pink: 0xf090a7,
  brown: 0xa86838, skin: 0xf2c99a, green: 0x86db79, cyan: 0x73e6ff,
};
const TAU = Math.PI * 2;
const ZERO = [0, 0, 0], ONE = [1, 1, 1];
const rocketRise = time => Math.min(450, Math.max(0, time - 3) ** 2 * 2.4);

/** Procedural +Z-forward actors. The caller exclusively owns the root transform and visibility. */
export function createAmbientModel(type, { level = "forest", tablet = false, reducedMotion = false } = {}) {
  if (!TYPES.includes(type)) throw new RangeError(`Unknown ambient model type: ${type}`);

  const group = new THREE.Group();
  group.name = `ambient-${type}`;
  Object.assign(group.userData, { castShadow: false, receiveShadow: false });
  const owned = new Set(), temporary = new Set(), primitives = new Map(), batches = new Map();
  const animations = [], transform = new THREE.Object3D(), color = new THREE.Color();
  const moon = level === "moon", motion = reducedMotion ? 0 : 1;
  let disposed = false, glow, glass, haze;
  function material(options) {
    const value = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.72, metalness: 0.08, flatShading: true,
      emissive: 0xffffff, emissiveIntensity: 0.06, ...options,
    });
    owned.add(value);
    return value;
  }
  const paint = material({ name: "ambient-paint" });
  function lightMaterial() {
    if (!glow) {
      // Vertex colors preserve saturated, HDR navigation/fire colors without point lights.
      glow = new THREE.MeshBasicMaterial({ name: "ambient-glow", vertexColors: true, toneMapped: false });
      owned.add(glow);
    }
    return glow;
  }
  function glassMaterial() {
    return glass ??= material({ name: "ambient-glass", transparent: true, opacity: 0.19,
      depthWrite: false, roughness: 0.18, side: THREE.DoubleSide, forceSinglePass: true });
  }
  function hazeMaterial() {
    if (!haze) {
      haze = new THREE.MeshBasicMaterial({ name: "ambient-haze", vertexColors: true,
        transparent: true, opacity: 0.38, depthWrite: false, toneMapped: false });
      owned.add(haze);
    }
    return haze;
  }
  function part(name, position = ZERO, parent = group) {
    const value = new THREE.Group();
    value.name = name;
    value.position.fromArray(position);
    parent.add(value);
    return value;
  }
  function source(geometry) {
    temporary.add(geometry);
    return geometry;
  }
  function primitive(kind) {
    if (!primitives.has(kind)) {
      let geometry;
      switch (kind) {
        case "box": geometry = new THREE.BoxGeometry(1, 1, 1); break;
        case "sphere": geometry = new THREE.SphereGeometry(1, 12, 8); break;
        case "dome": geometry = new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, Math.PI / 2); break;
        case "cylinder": geometry = new THREE.CylinderGeometry(1, 1, 1, 12); break;
        case "cone": geometry = new THREE.ConeGeometry(1, 1, 10); break;
        case "ring": geometry = new THREE.TorusGeometry(1, 0.1, 4, 16); break;
        case "gem": geometry = new THREE.IcosahedronGeometry(1, 0); break;
      }
      primitives.set(kind, source(geometry));
    }
    return primitives.get(kind);
  }
  function shape(parent, geometry, tint, position = ZERO, scale = ONE, rotation = ZERO, mat = paint) {
    const baked = source(geometry.index ? geometry.toNonIndexed() : geometry.clone());
    transform.position.fromArray(position);
    transform.scale.fromArray(scale);
    transform.rotation.set(rotation[0], rotation[1], rotation[2]);
    transform.updateMatrix();
    baked.applyMatrix4(transform.matrix);
    baked.deleteAttribute("uv");
    baked.clearGroups();
    color.set(tint);
    const colors = new Float32Array(baked.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    baked.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (!batches.has(parent)) batches.set(parent, new Map());
    const byMaterial = batches.get(parent);
    if (!byMaterial.has(mat)) byMaterial.set(mat, []);
    byMaterial.get(mat).push(baked);
  }
  const box = (p, c, size, at = ZERO, rot = ZERO) => shape(p, primitive("box"), c, at, size, rot);
  const orb = (p, c, size, at = ZERO, mat = paint) => shape(p, primitive("sphere"), c, at, size, ZERO, mat);
  const cylinder = (p, c, r, h, at, rot = ZERO) => shape(p, primitive("cylinder"), c, at, [r, h, r], rot);
  const cone = (p, c, r, h, at, rot = ZERO, mat = paint) => shape(p, primitive("cone"), c, at, [r, h, r], rot, mat);
  const ring = (p, c, size, at, rot = ZERO, mat = paint) => shape(p, primitive("ring"), c, at, size, rot, mat);
  function rod(parent, tint, from, to, radius = 0.05) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
    const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion()
      .setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
    shape(parent, primitive("cylinder"), tint, a.add(b).multiplyScalar(0.5).toArray(),
      [radius, delta.length(), radius], rotation.toArray());
  }
  function plate(parent, tint, points, depth, at = ZERO, rot = ZERO) {
    const outline = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const geometry = source(new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, steps: 1 }));
    geometry.translate(0, 0, -depth / 2);
    shape(parent, geometry, tint, at, ONE, rot);
  }
  function lathe(parent, tint, points, at = ZERO, rot = ZERO, segments = 16, start = 0, length = TAU) {
    shape(parent, source(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)),
      segments, start, length)), tint, at, ONE, rot);
  }
  function propeller(name, parent, at, radius, tail = false) {
    const prop = part(name, at, parent);
    box(prop, C.navy, [0.18, radius * 2, 0.1]);
    box(prop, C.navy, [radius * 2, 0.18, 0.1]);
    for (const side of [-1, 1]) {
      box(prop, C.yellow, [0.2, radius * 0.24, 0.12], [0, side * radius * 0.86, 0]);
      box(prop, C.yellow, [radius * 0.24, 0.2, 0.12], [side * radius * 0.86, 0, 0]);
    }
    orb(prop, C.coral, [0.26, 0.26, 0.23]);
    if (tail) prop.rotation.y = Math.PI / 2;
    animations.push(t => { prop.rotation.z = motion * ((t * 16) % TAU); });
    return prop;
  }

  const actor = part(`${type}-body`);
  try {
    switch (type) {
      case "balloon": {
        const profile = [[0.8, 0], [1.5, 0.9], [3.35, 2.9], [4.5, 5.3], [4.2, 7.1], [3, 8.7], [1.5, 9.6], [0, 10]];
        const stripes = [C.red, C.yellow, C.teal, C.cream, C.blue, C.coral];
        for (let i = 0; i < 12; i++) lathe(actor, stripes[i % stripes.length], profile, [0, 4, 0], ZERO, 1, i * TAU / 12, TAU / 12);
        box(actor, C.brown, [1.9, 0.2, 1.5], [0, 0.1, 0]);
        for (const side of [-1, 1]) {
          box(actor, C.gold, [1.9, 1.1, 0.14], [0, 0.7, side * 0.7]);
          box(actor, C.brown, [0.14, 1.1, 1.4], [side * 0.88, 0.7, 0]);
          for (const y of [0.35, 0.7, 1.05]) box(actor, C.cream, [1.94, 0.045, 0.025], [0, y, side * 0.78]);
          for (const z of [-0.65, 0.65]) rod(actor, C.brown, [side * 0.8, 1.2, z], [side * 0.65, 4.35, z * 0.8], 0.045);
        }
        box(actor, C.yellow, [2.02, 0.15, 1.6], [0, 1.3, 0]);
        box(actor, C.teal, [0.5, 0.62, 0.4], [0, 1.62, 0.16]);
        orb(actor, C.skin, [0.29, 0.32, 0.28], [0, 2.12, 0.16]);
        orb(actor, C.navy, [0.3, 0.13, 0.29], [0, 2.36, 0.13]);
        for (const x of [-0.1, 0.1]) orb(actor, C.navy, [0.035, 0.05, 0.035], [x, 2.15, 0.42]);
        const arm = part("balloon-wave", [0.3, 1.86, 0.16], actor);
        cylinder(arm, C.teal, 0.1, 0.45, [0, 0.2, 0]);
        orb(arm, C.skin, [0.13, 0.15, 0.12], [0, 0.5, 0]);
        cylinder(actor, C.navy, 0.25, 0.3, [0, 2.95, -0.35]);
        const burner = part("balloon-burner", [0, 3.12, -0.35], actor);
        cone(burner, C.yellow, 0.2, 0.65, [0, 0.325, 0], ZERO, lightMaterial());
        animations.push(t => {
          actor.position.y = motion * 0.18 * Math.sin(t * 0.6);
          actor.rotation.z = motion * 0.025 * Math.sin(t * 0.45);
          arm.rotation.z = -0.45 + motion * 0.35 * Math.sin(t * 2.1);
          burner.scale.y = 0.9 + motion * 0.1 * Math.sin(t * 2);
        });
        break;
      }
      case "plane": {
        lathe(actor, C.red, [[0.12, 0], [0.42, 1.4], [0.92, 6], [1.02, 9.2], [0.68, 11], [0.1, 11.8]],
          [0, 0, -5.8], [Math.PI / 2, 0, 0]);
        plate(actor, C.cream, [[-8.5, -1.4], [-8.5, 0.1], [-1, 2.1], [1, 2.1], [8.5, 0.1], [8.5, -1.4], [1, -0.65], [-1, -0.65]],
          0.22, [0, -0.1, 0], [Math.PI / 2, 0, 0]);
        for (const side of [-1, 1]) {
          box(actor, C.teal, [1.2, 0.25, 1.35], [side * 7.15, -0.1, -0.4], [0, side * 0.12, 0]);
          rod(actor, C.navy, [side * 0.7, -0.6, 1], [side * 4.3, -0.12, 0.4], 0.045);
          orb(actor, side < 0 ? C.red : C.green, [0.16, 0.13, 0.2], [side * 8.35, 0.05, -0.45], lightMaterial());
          cylinder(actor, C.navy, 0.4, 0.24, [side * 1.15, -1.25, 1.6], [0, 0, Math.PI / 2]);
          rod(actor, C.cream, [side * 0.7, -0.6, 1.6], [side * 1.15, -1.25, 1.6], 0.09);
        }
        plate(actor, C.yellow, [[-2.65, -0.7], [-2.3, 0.4], [0, 1], [2.3, 0.4], [2.65, -0.7]], 0.15,
          [0, 0.3, -4.6], [Math.PI / 2, 0, 0]);
        plate(actor, C.teal, [[-1, 0], [-0.6, 2], [0.35, 1.8], [1, 0]], 0.18, [0, 0.25, -4.6], [0, Math.PI / 2, 0]);
        orb(actor, C.navy, [0.72, 0.64, 1.08], [0, 0.88, 1.4]);
        ring(actor, C.cream, [0.72, 0.6, 0.8], [0, 0.87, 1.35]);
        cylinder(actor, C.yellow, 0.72, 0.35, [0, 0, 5.25], [Math.PI / 2, 0, 0]);
        propeller("plane-propeller", actor, [0, 0, 6.03], 1.8);
        animations.push((t, p) => { actor.rotation.z = motion * (0.035 * Math.sin(t * 0.7) + 0.06 * Math.sin(p * TAU)); });
        break;
      }
      case "helicopter": {
        orb(actor, C.yellow, [1.65, 1.45, 2.9], [0, 0, 1.5]);
        orb(actor, C.navy, [1.42, 1.08, 1.4], [0, 0.22, 3.05]);
        cone(actor, C.teal, 0.75, 6.4, [0, 0.2, -2.7], [-Math.PI / 2, 0, 0]);
        for (const side of [-1, 1]) {
          box(actor, C.coral, [0.08, 1.35, 1.5], [side * 1.57, -0.1, 1.1]);
          box(actor, C.navy, [0.1, 0.55, 1.1], [side * 1.61, 0.4, 1.1]);
          rod(actor, C.navy, [side * 1.55, -1.9, -1.1], [side * 1.55, -1.9, 3.3], 0.12);
          rod(actor, C.navy, [side * 1.55, -1.9, 3.3], [side * 1.55, -1.65, 3.7], 0.12);
          for (const z of [-0.4, 2.5]) rod(actor, C.cream, [side * 0.9, -0.9, z], [side * 1.55, -1.85, z], 0.09);
          orb(actor, side < 0 ? C.red : C.green, [0.15, 0.15, 0.15], [side * 1.7, 0.2, 0.1], lightMaterial());
        }
        plate(actor, C.coral, [[-0.8, 0], [-0.6, 2], [0.6, 1.6], [0.85, -0.4]], 0.18,
          [0, 0.45, -5.4], [0, Math.PI / 2, 0]);
        box(actor, C.yellow, [3.2, 0.12, 0.7], [0, 0.6, -4.7]);
        cylinder(actor, C.navy, 0.2, 1, [0, 1.8, 0.8]);
        const rotor = part("helicopter-rotor", [0, 2.4, 0.8], actor);
        box(rotor, C.navy, [13.6, 0.09, 0.42]);
        box(rotor, C.navy, [0.42, 0.09, 13.6]);
        for (const side of [-1, 1]) {
          box(rotor, C.yellow, [0.7, 0.11, 0.44], [side * 6.4, 0, 0]);
          box(rotor, C.yellow, [0.44, 0.11, 0.7], [0, 0, side * 6.4]);
        }
        orb(rotor, C.coral, [0.42, 0.23, 0.42]);
        propeller("helicopter-tail-rotor", actor, [-0.35, 1.05, -5.6], 1.05, true);
        animations.push(t => {
          rotor.rotation.y = motion * ((t * 12) % TAU);
          actor.position.y = motion * 0.12 * Math.sin(t * 1.1);
          actor.rotation.z = motion * 0.025 * Math.sin(t * 0.8);
        });
        break;
      }
      case "birds": {
        const count = tablet ? 3 : 5;
        for (let i = 0; i < count; i++) {
          const rank = Math.ceil(i / 2), side = i % 2 ? -1 : 1;
          const bird = part(`bird-${i}`, [side * rank * (tablet ? 5.2 : 2.6), 0, 2 - rank * 3], actor);
          orb(bird, C.navy, [0.27, 0.32, 0.87]);
          orb(bird, C.cream, [0.22, 0.24, 0.66], [0, -0.12, 0.13]);
          orb(bird, C.navy, [0.26, 0.26, 0.3], [0, 0.14, 0.67]);
          cone(bird, C.yellow, 0.13, 0.4, [0, 0.12, 1], [Math.PI / 2, 0, 0]);
          for (const x of [-0.2, 0.2]) orb(bird, C.white, [0.045, 0.065, 0.08], [x, 0.22, 0.83]);
          plate(bird, C.teal, [[-0.4, -0.4], [0, 0.25], [0.4, -0.4]], 0.06, [0, 0, -0.8], [Math.PI / 2, 0, 0]);
          for (const wingSide of [-1, 1]) {
            const wing = part(`bird-${i}-wing-${wingSide}`, [wingSide * 0.2, 0.12, 0.12], bird);
            plate(wing, C.cream, [[0, 0.15], [wingSide * 0.8, 0.4], [wingSide * 1.8, -0.65], [wingSide * 0.65, -0.45]],
              0.075, ZERO, [Math.PI / 2, 0, 0]);
            plate(wing, C.navy, [[wingSide * 1.15, -0.01], [wingSide * 1.8, -0.65], [wingSide * 1.2, -0.54]],
              0.09, ZERO, [Math.PI / 2, 0, 0]);
            animations.push(t => { wing.rotation.z = wingSide * (0.16 + motion * 0.6 * Math.sin(t * 4.5 + i * 0.7)); });
          }
          animations.push(t => { bird.position.y = motion * 0.12 * Math.sin(t * 2 + i * 0.5); });
        }
        break;
      }
      case "kite": {
        const corners = [[0, 2.5], [2.3, 0.1], [0, -2.5], [-2.3, 0.1]];
        for (let i = 0; i < 4; i++) plate(actor, [C.red, C.yellow, C.teal, C.blue][i], [[0, 0.1], corners[i], corners[(i + 1) % 4]], 0.06);
        rod(actor, C.cream, [0, -2.5, -0.07], [0, 2.5, -0.07], 0.035);
        rod(actor, C.cream, [-2.3, 0.1, -0.07], [2.3, 0.1, -0.07], 0.035);
        rod(actor, C.cream, [0, 0.1, -0.15], [0.5, -6.7, -1.8], 0.018);
        for (let tail = 0; tail < 3; tail++) {
          let parent = actor;
          const length = tail ? 0.62 : 0.85, count = tail ? 3 : 5;
          for (let i = 0; i < count; i++) {
            const ribbon = part(`kite-ribbon-${tail}-${i}`, i ? [0, -length, 0] : tail ? [(tail === 1 ? -1 : 1) * 1.75, -0.5, 0] : [0, -2.5, 0], parent);
            box(ribbon, tail === 1 ? C.coral : C.yellow, [0.11, length, 0.035], [0, -length / 2, 0]);
            if (i % 2 === 0) {
              plate(ribbon, tail === 2 ? C.teal : C.pink, [[-0.33, 0.15], [0, 0], [-0.33, -0.15]], 0.035, [0, -length * 0.65, 0.02]);
              plate(ribbon, C.coral, [[0.33, 0.15], [0, 0], [0.33, -0.15]], 0.035, [0, -length * 0.65, 0.02]);
            }
            animations.push(t => {
              ribbon.rotation.z = motion * 0.18 * Math.sin(t * 1.8 - i * 0.65 + tail);
              ribbon.rotation.x = motion * 0.12 * Math.sin(t * 1.3 - i * 0.5 + tail);
            });
            parent = ribbon;
          }
        }
        animations.push(t => { actor.rotation.x = 0.16; actor.rotation.z = motion * 0.06 * Math.sin(t * 0.7); });
        break;
      }
      case "airship": {
        const profile = [[0, 0], [1.3, 1], [2.6, 3], [3.3, 7], [3.3, 12], [2.4, 17], [0.9, 19], [0, 20]];
        for (let i = 0; i < 12; i++) lathe(actor, [C.teal, C.cream, C.teal, C.blue][i % 4], profile,
          [0, 0, -10], [Math.PI / 2, 0, 0], 1, i * TAU / 12, TAU / 12);
        for (const side of [-1, 1]) {
          plate(actor, C.coral, [[side * 1.2, -2], [side * 4.8, -2.6], [side * 3.7, 1.1], [side * 1.6, 1.8]],
            0.14, [0, 0, -6.4], [Math.PI / 2, 0, 0]);
          cylinder(actor, C.yellow, 0.42, 1.3, [side * 2.5, -2.8, 0.2], [Math.PI / 2, 0, 0]);
          propeller(`airship-propeller-${side}`, actor, [side * 2.5, -2.8, 1], 0.9);
          rod(actor, C.navy, [side * 0.7, -2.7, 0], [side * 2.5, -2.8, 0], 0.12);
          for (let i = 0; i < 4; i++) box(actor, C.navy, [0.06, 0.45, 0.56], [side * 1.04, -3.55, -0.1 + i * 0.9]);
          orb(actor, side < 0 ? C.red : C.green, [0.17, 0.17, 0.17], [side * 4.5, 0, -8.5], lightMaterial());
        }
        plate(actor, C.yellow, [[-2.1, 0], [-2.4, 4.4], [0.8, 3.4], [1.8, 0]], 0.16,
          [0, 0, -6.7], [0, Math.PI / 2, 0]);
        plate(actor, C.coral, [[-2.1, 0], [-2.4, -3.6], [0.8, -2.9], [1.8, 0]], 0.16,
          [0, 0, -6.7], [0, Math.PI / 2, 0]);
        box(actor, C.yellow, [2, 1.25, 4.1], [0, -3.5, 1.25]);
        orb(actor, C.navy, [0.95, 0.53, 0.65], [0, -3.4, 3.2]);
        animations.push(t => { actor.position.y = motion * 0.15 * Math.sin(t * 0.5); actor.rotation.x = motion * 0.018 * Math.sin(t * 0.3); });
        break;
      }
      case "ufo": {
        lathe(actor, C.teal, [[0, -0.8], [3, -0.8], [5.65, -0.2], [6, 0.05], [5.4, 0.4], [2.3, 1.1], [0, 1.1]]);
        ring(actor, C.yellow, [5.35, 5.35, 0.8], [0, 0.2, 0], [Math.PI / 2, 0, 0]);
        ring(actor, C.cream, [2.3, 2.3, 1], [0, 1.05, 0], [Math.PI / 2, 0, 0]);
        orb(actor, C.green, [0.64, 0.72, 0.55], [0, 1.7, 0.3]);
        for (const side of [-1, 1]) {
          orb(actor, C.navy, [0.16, 0.24, 0.08], [side * 0.25, 1.8, 0.79]);
          rod(actor, C.green, [side * 0.3, 2.2, 0.3], [side * 0.55, 2.6, 0.3], 0.045);
          orb(actor, C.yellow, [0.1, 0.1, 0.1], [side * 0.55, 2.6, 0.3]);
        }
        shape(actor, primitive("dome"), C.cyan, [0, 1.05, 0], [2.2, 1.9, 2.2], ZERO, glassMaterial());
        const lights = part("ufo-lights", ZERO, actor);
        for (let i = 0; i < 10; i++) {
          const angle = i * TAU / 10;
          orb(lights, i % 2 ? C.pink : C.cyan, [0.23, 0.14, 0.23], [5.35 * Math.cos(angle), 0.36, 5.35 * Math.sin(angle)], lightMaterial());
        }
        ring(lights, C.cyan, [1.5, 1.5, 1.4], [0, -0.83, 0], [Math.PI / 2, 0, 0], lightMaterial());
        animations.push(t => {
          actor.position.y = motion * 0.22 * Math.sin(t * 0.65);
          lights.rotation.y = motion * ((t * 0.13) % TAU);
          glow.color.multiplyScalar(1 + motion * 0.1 * Math.sin(t * 0.7));
        });
        break;
      }
      case "satellite": {
        box(actor, C.gold, [2.2, 2.7, 2]);
        box(actor, C.cream, [2.25, 0.22, 2.06], [0, 1.12, 0]);
        box(actor, C.cream, [2.25, 0.22, 2.06], [0, -1.12, 0]);
        box(actor, C.navy, [0.9, 0.7, 0.15], [0, 0.2, 1.04]);
        for (const side of [-1, 1]) {
          rod(actor, C.cream, [side, 0, 0], [side * 2.2, 0, 0], 0.12);
          const panel = part(`satellite-panel-${side}`, [side * 2.2, 0, 0], actor);
          box(panel, C.cream, [4.3, 0.14, 3.2], [side * 2.15, 0, 0]);
          for (let x = 0; x < 4; x++) for (let z = 0; z < 3; z++) {
            box(panel, (x + z) % 2 ? C.blue : C.navy, [0.94, 0.18, 0.93], [side * (0.59 + x * 1.04), 0, (z - 1) * 1.04]);
            box(panel, C.cyan, [0.018, 0.19, 0.88], [side * (0.59 + x * 1.04), 0, (z - 1) * 1.04]);
          }
          animations.push(t => { panel.rotation.z = side * (0.12 + motion * 0.09 * Math.sin(t * 0.35)); });
          cone(actor, C.navy, 0.28, 0.55, [side * 0.65, -1.55, 0], [Math.PI, 0, 0]);
        }
        const dish = part("satellite-dish", [0, 1.4, 0], actor);
        lathe(dish, C.cream, [[0, 0], [0.4, 0.08], [1, 0.4], [1.35, 0.9]]);
        ring(dish, C.gold, [1.35, 1.35, 0.7], [0, 0.9, 0], [Math.PI / 2, 0, 0]);
        rod(dish, C.navy, [0, 0, 0], [0, 1.25, 0], 0.055);
        orb(dish, C.coral, [0.16, 0.16, 0.16], [0, 1.25, 0], lightMaterial());
        rod(actor, C.cream, [0.7, 1.2, 0.6], [0.7, 3.3, 0.6], 0.025);
        animations.push(t => {
          actor.rotation.y = motion * ((t * 0.12) % TAU);
          actor.rotation.z = motion * 0.07 * Math.sin(t * 0.25);
          dish.rotation.x = 0.55 + motion * 0.1 * Math.sin(t * 0.3);
        });
        break;
      }
      case "comet": {
        const head = part("comet-head", ZERO, actor), tail = part("comet-tail", ZERO, actor);
        shape(head, primitive("gem"), C.navy, ZERO, [1.04, 0.93, 1.04]);
        shape(head, primitive("gem"), C.cyan, [0.15, 0.08, 0.05], [0.86, 0.86, 1], ZERO, lightMaterial());
        for (let i = 0; i < 5; i++) {
          const angle = i * TAU / 5;
          shape(head, primitive("gem"), C.white, [Math.cos(angle) * 0.7, Math.sin(angle) * 0.65, 0.4], [0.22, 0.18, 0.3], ZERO, lightMaterial());
        }
        cone(tail, C.cyan, 1.3, 20, [0, 0, -10.5], [-Math.PI / 2, 0, 0], hazeMaterial());
        cone(tail, C.blue, 0.85, 17, [0, 0, -9], [-Math.PI / 2, 0, 0], hazeMaterial());
        cone(tail, C.cream, 0.45, 12, [0, 0, -6.5], [-Math.PI / 2, 0, 0], lightMaterial());
        for (const side of [-1, 1]) cone(tail, C.cyan, 0.19, 8, [side * 0.75, side * 0.2, -5.3], [-Math.PI / 2, 0, side * 0.06], lightMaterial());
        animations.push(t => {
          head.rotation.z = motion * ((t * 0.15) % TAU);
          tail.scale.x = 1 + motion * 0.05 * Math.sin(t * 0.8);
          tail.scale.y = 1 + motion * 0.04 * Math.sin(t * 0.8);
        });
        break;
      }
      case "elephant": {
        orb(actor, C.gray, [1.23, 1.1, 1.9], [0, 2.1, -0.3]);
        orb(actor, C.purple, [1.02, 0.93, 0.92], [0, 2.6, 1.13]);
        for (let i = 0; i < 4; i++) {
          const side = i % 2 ? 1 : -1, z = i < 2 ? 0.95 : -1.45;
          const leg = part(`elephant-leg-${i}`, [side * 0.8, 1.2, z], actor);
          cylinder(leg, C.gray, 0.37, 0.9, [0, -0.47, 0]);
          orb(leg, C.gray, [0.45, 0.26, 0.58], [0, -0.94, 0.06]);
          for (const x of [-0.23, 0, 0.23]) box(leg, C.cream, [0.14, 0.14, 0.09], [x, -1.08, 0.57]);
          animations.push(t => {
            const stride = motion * Math.sin(t * (moon ? 1.3 : 2.6) + (i === 0 || i === 3 ? 0 : Math.PI));
            const angle = stride * 0.18;
            leg.rotation.x = angle;
            // Compensate the rotated sole, so stance feet never penetrate y=0.
            leg.position.y = 1.2 * Math.cos(angle) + 0.65 * Math.abs(Math.sin(angle)) + Math.max(0, stride) * 0.24;
            leg.position.z = z + stride * 0.15;
          });
        }
        for (const side of [-1, 1]) {
          const ear = part(`elephant-ear-${side}`, [side * 0.78, 2.8, 1.02], actor);
          orb(ear, C.purple, [0.73, 0.92, 0.18], [side * 0.48, -0.14, 0]);
          orb(ear, C.pink, [0.5, 0.66, 0.075], [side * 0.52, -0.16, 0.15]);
          animations.push(t => { ear.rotation.y = side * (0.12 + motion * 0.22 * Math.sin(t * 1.8)); });
          orb(actor, C.cream, [0.21, 0.25, 0.11], [side * 0.53, 2.87, 1.9]);
          orb(actor, C.navy, [0.105, 0.14, 0.07], [side * 0.52, 2.86, 2.005]);
          orb(actor, C.white, [0.034, 0.044, 0.03], [side * 0.49, 2.91, 2.065]);
          orb(actor, C.pink, [0.19, 0.11, 0.06], [side * 0.72, 2.55, 1.85]);
          rod(actor, C.cream, [side * 0.51, 2.12, 1.75], [side * 0.57, 1.99, 2.2], 0.12);
          cone(actor, C.cream, 0.12, 0.65, [side * 0.57, 2.07, 2.46], [1.2, 0, 0]);
        }
        let parent = actor;
        for (let i = 0; i < 3; i++) {
          const trunk = part(`elephant-trunk-${i}`, i ? [0, -0.53, 0] : [0, 2.56, 1.96], parent);
          const r = 0.29 - i * 0.055;
          cylinder(trunk, C.purple, r, 0.53, [0, -0.265, 0]);
          orb(trunk, C.purple, [r, r, r], [0, -0.5, 0]);
          if (i === 2) orb(trunk, C.navy, [0.09, 0.06, 0.08], [0, -0.65, 0.06]);
          animations.push(t => {
            trunk.rotation.x = -0.16 - i * 0.25 + motion * 0.13 * Math.sin(t * 1.7 - i * 0.5);
            trunk.rotation.z = motion * 0.08 * Math.sin(t * 1.3 - i * 0.45);
          });
          parent = trunk;
        }
        const tail = part("elephant-tail", [0, 2.05, -2.05], actor);
        rod(tail, C.gray, ZERO, [0, -0.55, -0.36], 0.07);
        cone(tail, C.navy, 0.16, 0.4, [0, -0.67, -0.42], [Math.PI - 0.6, 0, 0]);
        animations.push(t => {
          tail.rotation.z = motion * 0.22 * Math.sin(t * 1.6);
          actor.position.y = moon ? motion * 0.3 * (1 - Math.cos(t * 0.9)) : 0;
        });
        if (level === "stunt" || level === "city") {
          box(actor, C.teal, [2.25, 0.14, 2.65], [0, 3.07, -0.4]);
          for (const side of [-1, 1]) {
            box(actor, C.red, [0.14, 1.05, 2.65], [side * 1.16, 2.6, -0.4]);
            box(actor, C.yellow, [0.16, 0.12, 2.7], [side * 1.16, 2.12, -0.4]);
            for (let i = 0; i < 5; i++) {
              cone(actor, C.gold, 0.12, 0.25, [side * 1.16, 1.95, -1.4 + i * 0.5], [Math.PI, 0, 0]);
              shape(actor, primitive("gem"), C.cream, [side * 1.25, 2.6, -1.4 + i * 0.5], [0.035, 0.24, 0.16]);
            }
          }
        }
        if (moon) {
          const helmet = part("elephant-helmet", [0, 2.63, 1.16], actor);
          orb(helmet, C.cyan, [1.17, 1.16, 1.12], ZERO, glassMaterial());
          ring(helmet, C.cream, [1.08, 1.08, 1], [0, 0, 0.35]);
          box(actor, C.cream, [1.55, 1.25, 0.65], [0, 2.7, -1.88]);
          for (const side of [-1, 1]) cylinder(actor, C.gold, 0.22, 1.35, [side * 0.57, 2.7, -2.25]);
          box(actor, C.coral, [0.75, 0.4, 0.12], [0, 2.8, -2.26]);
        }
        break;
      }
      case "astronaut": {
        box(actor, C.cream, [0.94, 1, 0.64], [0, 1.65, 0]);
        box(actor, C.navy, [0.68, 0.16, 0.69], [0, 1.2, 0]);
        box(actor, C.coral, [0.63, 0.46, 0.09], [0, 1.76, 0.36]);
        for (let i = 0; i < 3; i++) orb(actor, [C.cyan, C.yellow, C.green][i], [0.06, 0.06, 0.035], [-0.19 + i * 0.19, 1.8, 0.43], lightMaterial());
        box(actor, C.gray, [0.85, 1.1, 0.52], [0, 1.65, -0.48]);
        for (const side of [-1, 1]) cylinder(actor, C.yellow, 0.17, 0.94, [side * 0.35, 1.7, -0.72]);
        orb(actor, C.cream, [0.63, 0.62, 0.61], [0, 2.42, 0]);
        orb(actor, C.navy, [0.52, 0.43, 0.18], [0, 2.43, 0.49]);
        orb(actor, C.gold, [0.42, 0.32, 0.1], [0, 2.42, 0.63]);
        box(actor, C.white, [0.2, 0.08, 0.035], [-0.17, 2.56, 0.72], [0, 0, -0.3]);
        rod(actor, C.navy, [0.32, 2.05, -0.53], [0.32, 2.96, -0.53], 0.025);
        orb(actor, C.coral, [0.065, 0.065, 0.065], [0.32, 2.96, -0.53]);
        for (const side of [-1, 1]) {
          const leg = part(`astronaut-leg-${side}`, [side * 0.27, 1.1, 0], actor);
          box(leg, C.cream, [0.36, 0.77, 0.42], [0, -0.385, 0]);
          box(leg, C.coral, [0.38, 0.14, 0.44], [0, -0.48, 0]);
          box(leg, C.navy, [0.44, 0.33, 0.66], [0, -0.935, 0.1]);
          const arm = part(side > 0 ? "astronaut-wave" : "astronaut-arm", [side * 0.56, 1.99, 0], actor);
          cylinder(arm, C.cream, 0.19, 0.59, [0, -0.295, 0]);
          cylinder(arm, C.coral, 0.2, 0.13, [0, -0.53, 0]);
          orb(arm, C.cream, [0.2, 0.21, 0.22], [0, -0.71, 0]);
          animations.push(t => {
            const angle = motion * side * 0.16 * Math.sin(t * 2.2);
            leg.rotation.x = angle;
            leg.position.y = 1.1 * Math.cos(angle) + 0.43 * Math.abs(Math.sin(angle));
            arm.rotation.z = side > 0 ? 2.5 + motion * 0.3 * Math.sin(t * 2.1) : -0.22;
            arm.rotation.x = side < 0 ? motion * 0.18 * Math.sin(t * 2.2) : 0;
          });
        }
        animations.push(t => { actor.position.y = motion * (moon ? 0.65 : 0.4) * (1 - Math.cos(t * (moon ? 1.5 : 2.2))); });
        break;
      }
      case "rocket": {
        const pad = part("rocket-pad");
        box(pad, C.navy, [5.8, 0.22, 5.8], [0, 0.11, 0]);
        box(pad, C.gray, [3.8, 0.1, 3.8], [0, 0.27, 0]);
        for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
          box(pad, C.yellow, [0.45, 0.025, 0.5], [-2 + i, 0.235, side * 2.5], [0, -0.35, 0]);
        }
        cylinder(actor, C.cream, 1.5, 7.7, [0, 5.5, 0]);
        shape(actor, source(new THREE.CylinderGeometry(1.5, 0.9, 1.4, 12)), C.gray, [0, 1.7, 0]);
        cone(actor, C.red, 1.5, 2.65, [0, 10.675, 0]);
        for (const y of [3.7, 8.7]) cylinder(actor, C.teal, 1.515, 0.28, [0, y, 0]);
        cylinder(actor, C.navy, 0.85, 0.55, [0, 1.1, 0]);
        for (let i = 0; i < 4; i++) {
          plate(actor, C.red, [[1.1, 3.8], [2.7, 0.6], [2.7, 0], [1.1, 0.6]], 0.22, ZERO, [0, i * Math.PI / 2, 0]);
          plate(actor, C.yellow, [[2.35, 1.3], [2.7, 0.6], [2.7, 0.25], [2.35, 0.4]], 0.24, ZERO, [0, i * Math.PI / 2, 0]);
        }
        ring(actor, C.gold, [0.64, 0.64, 1.5], [0, 6.6, 1.45]);
        orb(actor, C.navy, [0.54, 0.54, 0.1], [0, 6.6, 1.49]);
        orb(actor, C.cyan, [0.29, 0.16, 0.025], [-0.12, 6.79, 1.59], lightMaterial());
        for (let i = 0; i < 8; i++) orb(actor, C.cream, [0.055, 0.055, 0.045],
          [0.66 * Math.cos(i * TAU / 8), 6.6 + 0.66 * Math.sin(i * TAU / 8), 1.5]);
        const outer = part("rocket-flame-outer", [0, 1.15, 0], actor);
        const inner = part("rocket-flame-inner", [0, 1.15, 0], actor);
        cone(outer, C.coral, 0.75, 1, [0, -0.5, 0], [Math.PI, 0, 0], hazeMaterial());
        cone(inner, C.yellow, 0.43, 1, [0, -0.5, 0], [Math.PI, 0, 0], lightMaterial());
        cone(inner, C.white, 0.25, 0.6, [0, -0.3, 0.08], [Math.PI, 0, 0], lightMaterial());
        animations.push(t => {
          const rise = rocketRise(t), ignition = THREE.MathUtils.smoothstep(t, 0, 1.2);
          actor.position.y = rise;
          actor.position.x = reducedMotion ? 0 : 0.025 * Math.sin(t * 17) * ignition * (1 - THREE.MathUtils.smoothstep(t, 2.3, 3));
          const length = ignition * (1.02 + 3.4 * THREE.MathUtils.smoothstep(rise, 0, 8));
          outer.visible = inner.visible = t > 0;
          outer.scale.set(1, Math.max(0.001, length * (1 + motion * 0.04 * Math.sin(t * 3))), 1);
          inner.scale.set(1, Math.max(0.001, length * (0.8 + motion * 0.025 * Math.sin(t * 3 + 0.5))), 1);
        });
        if (!moon && !reducedMotion) {
          const count = tablet ? 8 : 12, lifetime = 3.2;
          const geometry = primitive("gem").clone();
          owned.add(geometry);
          const smokeMaterial = material({ name: "ambient-smoke", vertexColors: false, color: 0xb6bfd1,
            transparent: true, opacity: 0.42, depthWrite: false, emissiveIntensity: 0.04 });
          const smoke = new THREE.InstancedMesh(geometry, smokeMaterial, count);
          smoke.name = "rocket-smoke";
          smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          smoke.frustumCulled = false;
          group.add(smoke);
          owned.add(smoke); // InstancedMesh owns renderer-side instance buffers, too.
          const puff = new THREE.Object3D();
          animations.push(t => {
            let active = false;
            for (let i = 0; i < count; i++) {
              // Reconstruct each slot's most recent birth, including on seeks/restarts.
              const offset = 0.4 + i * lifetime / count;
              const birth = offset + Math.floor((Math.min(t, 22) - offset) / lifetime) * lifetime;
              const age = t - birth;
              const alive = birth >= 0.399999 && age >= 0 && age < lifetime;
              const radius = alive ? (0.32 + age * 0.9) * (1 - THREE.MathUtils.smoothstep(age / lifetime, 0.7, 1)) : 0;
              const angle = i * 2.39996 + Math.floor(birth / lifetime) * 0.7;
              const spread = 0.2 + age * 0.95;
              puff.position.set(alive ? Math.cos(angle) * spread : 0,
                alive ? Math.max(radius, rocketRise(birth) - 2 + age * 0.8) : 0,
                alive ? Math.sin(angle) * spread : 0);
              puff.rotation.set(0, angle, 0);
              puff.scale.setScalar(radius);
              puff.updateMatrix();
              smoke.setMatrixAt(i, puff.matrix);
              active ||= alive;
            }
            smoke.visible = active;
            smoke.instanceMatrix.needsUpdate = true;
          });
        }
        break;
      }
    }

    // One vertex-colored draw per material/animated part, with no material groups.
    for (const [parent, byMaterial] of batches) for (const [mat, pieces] of byMaterial) {
      const geometry = mergeGeometries(pieces, false);
      owned.add(geometry);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.name = `${parent.name}/${mat.name}`;
      parent.add(mesh);
    }
    group.traverse(object => {
      object.castShadow = object.receiveShadow = false;
      object.userData.castShadow = object.userData.receiveShadow = false;
      // The existing daylight traversal uses this opt-out for both shadow flags.
      if (object.isMesh) object.userData.celestial = true;
    });
  } catch (error) {
    for (const resource of owned) resource.dispose();
    group.clear();
    throw error;
  } finally {
    for (const geometry of temporary) geometry.dispose();
    temporary.clear();
    primitives.clear();
    batches.clear();
  }

  function update({ time = 0, progress = 0, night = 0 } = {}) {
    if (disposed) return;
    const t = Number.isFinite(time) ? Math.max(0, Math.min(time, Number.MAX_SAFE_INTEGER)) : 0;
    const p = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0;
    const darkness = Number.isFinite(night) ? THREE.MathUtils.clamp(night, 0, 1) : 0;
    paint.emissiveIntensity = 0.06 + darkness * 0.18;
    if (glow) glow.color.setScalar(1.25 + darkness * 0.5);
    if (haze) haze.color.setScalar(1.3 + darkness * 0.4);
    for (const animate of animations) animate(t, p);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    group.clear();
    animations.length = 0;
    for (const resource of owned) resource.dispose();
    owned.clear();
  }
  update();
  return { group, update, dispose };
}
