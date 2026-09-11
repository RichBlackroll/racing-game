import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ITEMS } from "./item-system.js";

const TAU = Math.PI * 2;
const finitePosition = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** Rendering only: snapshot is itemSystem.state(), Y is world height, heading 0 is +Z.
 * dt=0 freezes decorative motion but still reconciles resets and changed snapshots.
 * drawMap uses an already centered canvas, with world +Z pointing up the map.
 */
export function createItemWorld({ scene, course, reducedMotion = false }) {
  const root = new THREE.Group();
  root.name = "items/world";
  scene.add(root);
  const resources = new Set(), batches = [], lightning = new Map(), markers = [];
  const white = new THREE.Color(0xffffff), color = new THREE.Color(), transform = new THREE.Object3D();
  const palette = new Map(ITEMS.map(item => [item.id, new THREE.Color(item.color)]));
  const mapColors = new Map(ITEMS.map(item => [item.id, item.color]));
  let time = 0, frame = 0, disposed = false;
  const own = resource => { resources.add(resource); return resource; };
  const solid = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72,
    metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.16, flatShading: true }));
  const glow = own(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
    opacity: 0.42, depthWrite: false, toneMapped: false }));
  const bright = own(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));

  // Bake colored toy parts once. Intermediate primitives never survive construction.
  const box = new RoundedBoxGeometry(1, 1, 1, 1, 0.12);
  const chip = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const ring = new THREE.TorusGeometry(1, 0.025, 5, 28);
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.46 : 1;
    if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const star = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true,
    bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 1, steps: 1 }).translate(0, 0, -0.07);
  const droplet = new THREE.LatheGeometry([
    [0, -0.6], [0.32, -0.54], [0.5, -0.28], [0.54, 0.02], [0.45, 0.3], [0.26, 0.62], [0.09, 0.88], [0, 1.06],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 12);
  const emblems = [
    [[-0.9, 0.9], [0, 0.72], [0.9, 0.9], [0.8, -0.15], [0.5, -0.65], [0, -1.05], [-0.5, -0.65], [-0.8, -0.15]],
    [[0.05, 1.05], [-0.7, -0.15], [-0.1, -0.15], [-0.3, -1.05], [0.75, 0.25], [0.15, 0.25]],
  ].map(points => {
    const outline = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    outline.closePath();
    return new THREE.ExtrudeGeometry(outline, { depth: 0.3, bevelEnabled: true,
      bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 1, steps: 1 }).translate(0, 0, -0.15);
  });
  const halo = new THREE.RingGeometry(1.25, 1.48, 32);
  const sparkle = new THREE.OctahedronGeometry(1, 0);
  const peel = new THREE.BufferGeometry(), peelVertices = [
    -0.12, 0.57, 0, 0.12, 0.57, 0, -0.30, 0.22, 0.4, 0.30, 0.22, 0.4,
    -0.23, 0.06, 0.86, 0.23, 0.06, 0.86, -0.025, 0.22, 1.22, 0.025, 0.22, 1.22,
  ];
  peel.setAttribute("position", new THREE.Float32BufferAttribute([
    ...peelVertices, ...peelVertices.map((v, i) => i % 3 === 1 ? v - 0.045 : v),
  ], 3));
  const peelFaces = [0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 4, 6, 5, 5, 6, 7];
  const underside = [...peelFaces].reverse().map(i => i + 8);
  const perimeter = [0, 1, 3, 5, 7, 6, 4, 2];
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i], b = perimeter[(i + 1) % perimeter.length];
    peelFaces.push(a, b, a + 8, b, b + 8, a + 8);
  }
  peel.setIndex([...peelFaces, ...underside]);
  peel.computeVertexNormals();

  const part = (geometry, tint, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) =>
    ({ geometry, tint, position, scale, rotation });
  function bake(name, parts) {
    const pieces = parts.map(p => {
      const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
      // All parts need the same attributes for merging, including custom silhouettes.
      g.deleteAttribute("uv");
      transform.position.fromArray(p.position); transform.scale.fromArray(p.scale);
      transform.rotation.set(...p.rotation); transform.updateMatrix();
      g.applyMatrix4(transform.matrix);
      color.set(p.tint);
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      return g;
    });
    const geometry = own(mergeGeometries(pieces));
    geometry.name = `items/geometry/${name}`;
    pieces.forEach(g => g.dispose());
    return geometry;
  }
  const models = new Map(), pickupModels = new Map();
  for (const item of ITEMS) {
    const c = item.color, parts = [];
    if (item.id === "banana") {
      for (let i = 0; i < 3; i++) parts.push(part(peel, c, [0, -0.12, 0], [1, 1, 1], [0, i * TAU / 3, 0]));
      parts.push(part(sphere, "#fff2a1", [0, 0.48, 0], [0.18, 0.38, 0.18]),
        part(box, "#b88c47", [0, 0.82, 0], [0.12, 0.13, 0.12]));
    } else if (item.id === "oil") {
      parts.push(part(sphere, "#7951b8", [0, -0.12, 0], [2.15, 0.085, 1.55]),
        part(sphere, c, [0.65, -0.11, 0.8], [1.1, 0.07, 1.15]),
        part(sphere, c, [-1.25, -0.11, -0.6], [0.95, 0.07, 0.8]),
        part(sphere, "#e2baff", [-0.4, -0.02, 0.35], [0.7, 0.012, 0.18]));
    } else if (item.id === "mine") {
      parts.push(part(cylinder, "#775be2", [0, 0.04, 0], [0.85, 0.3, 0.85]),
        part(cylinder, c, [0, 0.21, 0], [0.76, 0.12, 0.76]),
        part(star, "#fff178", [0, 0.30, 0], [0.43, 0.43, 0.43], [-Math.PI / 2, 0, 0]));
      for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8;
        parts.push(part(chip, i % 2 ? "#67e6e5" : "#fff6cc", [Math.sin(a) * 0.7, 0.3, Math.cos(a) * 0.7],
          [0.12, 0.07, 0.16], [0, a, 0]));
      }
    } else if (item.id === "rocket" || item.id === "homing") {
      parts.push(part(sphere, "#fff6df", [0, 0, 0], [0.34, 0.34, 0.85]),
        part(sphere, c, [0, 0, 0.69], [0.35, 0.35, 0.35]),
        part(cylinder, c, [0, 0, -0.48], [0.36, 0.2, 0.36], [Math.PI / 2, 0, 0]));
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3;
        parts.push(part(box, i === 0 ? "#c4a5ff" : c, [Math.sin(a) * 0.32, Math.cos(a) * 0.32, -0.54],
          [0.12, 0.55, 0.5], [0, 0, -a]));
      }
      if (item.id === "homing") for (const x of [-0.13, 0.13]) {
        parts.push(part(sphere, "#ffffff", [x, 0.29, 0.35], [0.105, 0.075, 0.12]),
          part(sphere, "#425078", [x, 0.35, 0.39], [0.045, 0.025, 0.055]));
      }
    } else if (item.id === "ball") {
      parts.push(part(sphere, c, [0, 0, 0], [0.58, 0.58, 0.58]));
      for (const rotation of [[Math.PI / 2, 0, 0], [0, 0, Math.PI / 4]]) {
        parts.push(part(ring, "#fff178", [0, 0, 0], [0.58, 0.58, 0.58], rotation));
      }
    } else if (item.id === "balloon") {
      parts.push(part(sphere, c, [0, 0.08, 0], [0.52, 0.65, 0.52]),
        part(sphere, c, [0, -0.51, 0], [0.14, 0.15, 0.14]),
        part(box, "#499ac8", [0, -0.62, 0], [0.2, 0.12, 0.12]),
        part(sphere, "#e3ffff", [-0.18, 0.31, 0.39], [0.11, 0.19, 0.045]));
    } else if (item.id === "shield") {
      // Open, thin hoops instead of a sphere: the cockpit never gets a full-screen tint.
      for (const [y, radius] of [[0.22, 1.42], [2.05, 1.12]]) {
        parts.push(part(ring, c, [0, y, 0], [radius, radius, radius], [Math.PI / 2, 0, 0]));
      }
      parts.push(part(ring, "#ede0ff", [0, 1.08, 0], [1.5, 1.1, 1.5], [0, 0, 0]));
    } else if (item.id === "star") {
      parts.push(part(ring, c, [0, 2.6, 0], [1.35, 1.35, 1.35], [Math.PI / 2, 0, 0]));
      for (let i = 0; i < 5; i++) {
        const a = i * TAU / 5;
        parts.push(part(star, i % 2 ? "#ffce65" : c, [Math.sin(a) * 1.35, 2.6, Math.cos(a) * 1.35],
          [0.3, 0.3, 0.3], [0, a, 0]));
      }
    } else {
      const points = [[0.3, 4.25], [-0.3, 3.45], [0.28, 3.45], [-0.22, 2.55]];
      for (let i = 1; i < points.length; i++) {
        const [x, y] = points[i - 1], [xx, yy] = points[i];
        parts.push(part(box, i === 2 ? "#fff6b0" : c, [(x + xx) / 2, (y + yy) / 2, 0],
          [0.18, Math.hypot(xx - x, yy - y) + 0.12, 0.22], [0, 0, -Math.atan2(xx - x, yy - y)]));
      }
    }
    models.set(item.id, bake(item.id, parts));
    // Pickups are standalone toys, not shrunken puddles or racer status overlays.
    const pickupParts = [];
    if (item.id === "oil") {
      pickupParts.push(part(sphere, "#7951b8", [0, -0.76, 0], [0.92, 0.08, 0.66]),
        part(sphere, c, [0.48, -0.75, 0.25], [0.5, 0.07, 0.43]),
        part(droplet, c), part(sphere, "#e2baff", [-0.2, 0.15, 0.43], [0.1, 0.23, 0.035]));
    } else if (item.id === "shield") {
      pickupParts.push(part(emblems[0], "#499ac8"), part(emblems[0], c, [0, 0, 0], [0.82, 0.82, 1.2]));
      for (const side of [-1, 1]) pickupParts.push(
        part(sphere, "#dffaff", [0, 0.08, side * 0.23], [0.36, 0.36, 0.16]),
        part(ring, "#ffffff", [0, 0.08, side * 0.3], [0.38, 0.38, 0.38]),
        part(sphere, "#ffffff", [-0.1, 0.21, side * 0.37], [0.08, 0.1, 0.035]));
    } else if (item.id === "star") {
      pickupParts.push(part(star, "#ffce65", [0, 0, 0], [1, 1, 2.6]),
        part(star, c, [0, 0, 0], [0.87, 0.87, 3.1]));
    } else if (item.id === "lightning") {
      pickupParts.push(part(emblems[1], c), part(emblems[1], "#f1e8ff", [0, 0, 0], [0.75, 0.82, 1.2]));
    }
    pickupModels.set(item.id, pickupParts.length ? bake(`pickup-${item.id}`, pickupParts) : models.get(item.id));
  }
  const pickupHalo = bake("pickup-halo", [part(halo, "#ffffff", [0, 0, 0], [1, 1, 1], [-Math.PI / 2, 0, 0])]);
  const pickupSparkles = bake("pickup-sparkles", [
    part(sparkle, "#fff6df", [-1.55, 0.85, 0], [0.13, 0.3, 0.13]),
    part(sparkle, "#ffffff", [1.5, -0.1, 0.2], [0.1, 0.23, 0.1]),
  ]);
  const hoop = bake("glow-ring", [part(ring, "#ffffff", [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0])]);
  const confetti = bake("confetti", [part(chip, "#ffffff", [0, 0, 0], [0.16, 0.07, 0.25])]);
  for (const primitive of [box, chip, sphere, cylinder, ring, star, peel, droplet, ...emblems, halo, sparkle]) primitive.dispose();

  function batch(name, geometry, material = solid) {
    const b = { name: `items/${name}`, geometry, material, mesh: null, capacity: 0 };
    batches.push(b);
    return b;
  }
  const pickupRings = batch("pickups/glow-rings", pickupHalo, glow);
  const sparkles = batch("pickups/sparkles", pickupSparkles, bright);
  const pickupSizes = { banana: 1.55, oil: 1.5, mine: 1.9, rocket: 1.7, homing: 1.7,
    ball: 2, balloon: 1.85, shield: 1.5, star: 1.5, lightning: 1.5 };
  const pickups = new Map(ITEMS.map(item => [item.id, {
    model: batch(`pickups/model/${item.id}`, pickupModels.get(item.id)), size: pickupSizes[item.id],
    tilt: item.id === "rocket" || item.id === "homing" ? -Math.PI / 3 : item.id === "mine" ? Math.PI / 5 : 0,
  }]));
  const entities = new Map(ITEMS.slice(0, 7).map(item => [item.id, batch(`entities/${item.id}`, models.get(item.id))]));
  const shields = batch("statuses/shield", models.get("shield"), glow);
  const stars = batch("statuses/star", models.get("star"), bright);
  const bolts = batch("effects/lightning", models.get("lightning"), bright);
  const rings = batch("effects/rings", hoop, glow), flecks = batch("effects/confetti", confetti, bright);

  function stamp(b, x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0, tint = white, order = "XYZ") {
    const index = b.mesh?.count ?? 0;
    if (index >= b.capacity) {
      const old = b.mesh;
      b.capacity = Math.max(8, b.capacity * 2);
      b.mesh = new THREE.InstancedMesh(b.geometry, b.material, b.capacity);
      b.mesh.name = b.name;
      b.mesh.userData.castShadow = false;
      b.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      b.mesh.setColorAt(0, white);
      b.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      // Instances move or disappear at reset, so never retain stale culling bounds.
      b.mesh.frustumCulled = false;
      if (old) {
        b.mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, index * 16));
        b.mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, index * 3));
        old.removeFromParent(); old.dispose();
      }
      root.add(b.mesh);
    }
    transform.position.set(x, y, z); transform.scale.set(sx, sy, sz);
    transform.rotation.set(rx, ry, rz, order); transform.updateMatrix();
    b.mesh.setMatrixAt(index, transform.matrix); b.mesh.setColorAt(index, tint);
    b.mesh.count = index + 1;
  }

  function update(snapshot, dt, targets = []) {
    if (disposed) return;
    if (Number.isFinite(dt) && dt > 0) time = (time + Math.min(dt, 0.1)) % (TAU * 100);
    frame++;
    for (const b of batches) if (b.mesh) b.mesh.count = 0;
    let markerCount = 0;
    for (const p of snapshot.pickups) {
      if (!p.available || !finitePosition(p) || !palette.has(p.type)) continue;
      const tint = palette.get(p.type), phase = p.x * 0.17 + p.z * 0.11;
      const angle = reducedMotion ? Math.PI / 4 : Math.PI / 4 + time * 0.5;
      const y = p.y + 1.2 + (reducedMotion ? 0 : Math.sin(time * 2 + phase) * 0.12);
      const { model, size, tilt } = pickups.get(p.type);
      // Yaw after the presentation tilt keeps rocket noses pointing up throughout a turn.
      stamp(model, p.x, y, p.z, size, size, size, tilt, angle, 0, white, "YXZ");
      stamp(sparkles, p.x, y, p.z, 1, 1, 1, 0, angle);
      const ground = number(course.heightAt(p.x, p.z), p.y - 0.9);
      stamp(pickupRings, p.x, ground + 0.07, p.z, 1, 1, 1, 0, 0, 0, tint);
      const marker = markers[markerCount] ?? (markers[markerCount] = {});
      marker.x = p.x; marker.z = p.z; marker.color = mapColors.get(p.type); markerCount++;
    }
    markers.length = markerCount;
    for (const e of snapshot.entities) {
      const b = entities.get(e.type);
      if (!b || !finitePosition(e) || e.age >= e.life) continue;
      const roll = e.type === "ball" && !reducedMotion ? number(e.age) * 3 : 0;
      stamp(b, e.x, e.y, e.z, 1, 1, 1, roll, number(e.heading));
    }
    for (const s of snapshot.statuses) {
      const target = targets.find(t => t.id === s.id && finitePosition(t));
      if (!target) continue;
      const size = Math.max(0.65, Math.min(3, number(target.radius, 1.12) / 1.12));
      if (s.shield > 0) stamp(shields, target.x, target.y, target.z, size, 1, size, 0, number(target.heading));
      if (s.turbo > 0) stamp(stars, target.x, target.y, target.z, size, 1, size, 0, reducedMotion ? 0 : time * 0.5);
    }
    for (const e of snapshot.effects) {
      if (!finitePosition(e) || !(e.life > 0) || e.age >= e.life || !palette.has(e.item)) continue;
      const age = Math.max(0, number(e.age)), progress = Math.min(1, age / e.life);
      let x = e.x, y = e.y, z = e.z;
      if (e.type === "lightning") {
        // The core supplies impact positions, not target IDs. Bind once, then follow
        // that racer; reset can reuse IDs, so a rewound age/new origin rebinds it.
        let link = lightning.get(e.id);
        if (!link || age < link.age || e.x !== link.x || e.y !== link.y || e.z !== link.z) {
          let nearest, distance = Infinity;
          for (const t of targets) if (finitePosition(t)) {
            const d = Math.hypot(t.x - e.x, t.y - e.y, t.z - e.z);
            if (d < distance && d < 6 + Math.abs(number(t.speed)) * age) { nearest = t.id; distance = d; }
          }
          link = { targetId: nearest, x: e.x, y: e.y, z: e.z };
          lightning.set(e.id, link);
        }
        link.age = age; link.frame = frame;
        const target = targets.find(t => t.id === link.targetId && finitePosition(t));
        if (target) { x = target.x; y = target.y; z = target.z; }
        stamp(bolts, x, y + (reducedMotion ? 0 : progress * 0.25), z, 1, 1, 1, 0, target ? number(target.heading) : 0);
      }
      const radius = Math.max(0.3, Math.min(9, number(e.radius, 2)));
      const expansion = reducedMotion ? 0.55 : 0.2 + progress * 0.8;
      stamp(rings, x, y + 0.1, z, radius * expansion, 1, radius * expansion, 0, 0, 0, palette.get(e.item));
      if (!reducedMotion) for (let i = 0; i < 8; i++) {
        const angle = i * TAU / 8 + number(e.id) * 0.7;
        const spread = radius * (0.15 + progress * 0.7), shrink = Math.max(0.02, 1 - progress * progress);
        stamp(flecks, x + Math.sin(angle) * spread, y + 0.4 + Math.sin(progress * Math.PI) * (1 + i % 3 * 0.25),
          z + Math.cos(angle) * spread, shrink, shrink, shrink, age * 2 + i, angle, age * 3,
          i % 3 === 0 ? white : i % 3 === 1 ? palette.get(e.item) : palette.get("star"));
      }
    }
    for (const [id, link] of lightning) if (link.frame !== frame) lightning.delete(id);
    for (const b of batches) if (b.mesh) {
      b.mesh.visible = b.mesh.count > 0;
      if (b.mesh.visible) { b.mesh.instanceMatrix.needsUpdate = true; b.mesh.instanceColor.needsUpdate = true; }
    }
  }

  function drawMap(ctx, scale) {
    if (disposed || !Number.isFinite(scale) || scale <= 0) return;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = "#ffffff";
    for (const p of markers) {
      const x = p.x * scale, y = -p.z * scale, r = 2.3;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const b of batches) { b.mesh?.dispose(); b.mesh = null; }
    for (const resource of resources) resource.dispose();
    root.clear(); resources.clear(); lightning.clear(); markers.length = 0;
  }
  return { update, drawMap, dispose };
}
