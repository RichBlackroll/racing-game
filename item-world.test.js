import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createItemSystem, ITEMS } from "./item-system.js";
import { createItemWorld } from "./item-world.js";
import * as itemWorldExports from "./item-world.js";

const course = { route: [{ x: 0, z: 0 }, { x: 0, z: 240 }, { x: 0, z: -240 }],
  halfSize: 300, heightAt: () => 0, roadDistance: x => Math.abs(x) };
const target = (id = "player", x = 0, y = 0, z = 0) => ({ id, x, y, z, heading: 0.7, speed: 20, radius: 1.12 });
const empty = () => ({ held: null, pickups: [], entities: [], effects: [], statuses: [] });
const mesh = (scene, name) => scene.getObjectByName(`items/${name}`);
const count = (scene, name) => mesh(scene, name)?.count ?? 0;
const pickupCount = scene => ITEMS.reduce((total, item) => total + count(scene, `pickups/model/${item.id}`), 0);
const matrixAt = (object, index = 0) => { const m = new THREE.Matrix4(); object.getMatrixAt(index, m); return m; };
const positionAt = (object, index = 0) => new THREE.Vector3().setFromMatrixPosition(matrixAt(object, index));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} != ${expected}`);
function boundsAt(object, index = 0) {
  const bounds = new THREE.Box3(), vertex = new THREE.Vector3(), matrix = matrixAt(object, index);
  const positions = object.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) bounds.expandByPoint(vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix));
  return bounds;
}

function fixture(t, reducedMotion = false) {
  const scene = new THREE.Scene(), world = createItemWorld({ scene, course, reducedMotion });
  const system = createItemSystem({ course });
  t.after(() => world.dispose());
  return { scene, world, system };
}
function assertFinite(scene) {
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    assert.ok(o.matrixWorld.elements.every(Number.isFinite), o.name);
    assert.ok(!o.isLight && !o.isCamera);
    if (!o.isMesh) return;
    assert.equal(o.castShadow, false);
    assert.equal(o.receiveShadow, false);
    assert.ok(o.isInstancedMesh, o.name);
    assert.ok(o.count <= o.instanceMatrix.count);
    assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite), o.name);
    for (let i = 0; i < o.count; i++) assert.ok(matrixAt(o, i).elements.every(Number.isFinite), `${o.name}/${i}`);
  });
}
function transforms(scene) {
  const result = [];
  scene.traverse(o => { if (o.isInstancedMesh) result.push([o.name, o.visible, o.count,
    [...o.instanceMatrix.array.slice(0, o.count * 16)], [...o.instanceColor.array.slice(0, o.count * 3)]]); });
  return result;
}
function deploy(system, type, racers = [target()]) {
  const p = system.state().pickups.find(p => p.type === type && p.available);
  assert.ok(p);
  const player = target("player", p.x, p.y - 0.9, p.z);
  system.update(0, [player]); system.update(0.001, [player]);
  assert.equal(system.state().held, type);
  system.update(0, racers); assert.equal(system.deploy(), true);
}
function canvas() {
  const paths = [], stack = [];
  return { paths, fillStyle: "old-fill", strokeStyle: "old-stroke", lineWidth: 4, globalAlpha: 0.3,
    save() { stack.push([this.fillStyle, this.strokeStyle, this.lineWidth, this.globalAlpha]); },
    restore() { [this.fillStyle, this.strokeStyle, this.lineWidth, this.globalAlpha] = stack.pop(); },
    beginPath() { paths.push({ points: [], color: this.fillStyle }); },
    moveTo(x, y) { paths.at(-1).points.push([x, y]); }, lineTo(x, y) { this.moveTo(x, y); },
    closePath() {}, fill() {}, stroke() {},
  };
}

test("exact API works in Node without a DOM, lights, cameras or an animation loop", t => {
  assert.equal(typeof document, "undefined");
  assert.equal(typeof requestAnimationFrame, "undefined");
  const { scene, world, system } = fixture(t);
  assert.deepEqual(Object.keys(world), ["update", "drawMap", "dispose"]);
  assert.deepEqual(Object.keys(itemWorldExports), ["createItemWorld"]);
  world.update(system.state(), 0);
  assert.equal(pickupCount(scene), 60);
  assertFinite(scene);
});

for (const item of ITEMS) test(`${item.id}: real core deployment renders its distinct toy/status/effect and resets`, t => {
  const { scene, world, system } = fixture(t);
  const racers = [target(), target("friend", 30, 12, 40)];
  world.update(system.state(), 0, racers);
  assert.ok(count(scene, `pickups/model/${item.id}`) > 0);
  deploy(system, item.id, racers);
  const snapshot = system.state(), before = structuredClone(snapshot);
  world.update(snapshot, 0, racers);
  assert.deepEqual(snapshot, before, "rendering must not mutate core state");
  if (item.id === "shield" || item.id === "star") {
    assert.equal(count(scene, `statuses/${item.id}`), 1);
    assert.notEqual(mesh(scene, `statuses/${item.id}`).geometry, mesh(scene, `pickups/model/${item.id}`).geometry);
  } else if (item.id === "lightning") {
    assert.equal(count(scene, "effects/lightning"), racers.length);
    assert.ok(positionAt(mesh(scene, "effects/lightning"), 1).y >= 12);
    assert.notEqual(mesh(scene, "effects/lightning").geometry, mesh(scene, "pickups/model/lightning").geometry);
  } else {
    assert.equal(count(scene, `entities/${item.id}`), 1);
    const e = snapshot.entities[0], p = positionAt(mesh(scene, `entities/${item.id}`));
    close(p.x, e.x); close(p.y, e.y); close(p.z, e.z);
    const deployed = mesh(scene, `entities/${item.id}`).geometry, pickup = mesh(scene, `pickups/model/${item.id}`).geometry;
    if (item.id === "oil") assert.notEqual(deployed, pickup);
    else assert.equal(deployed, pickup, "reuse suitable deployed toy geometry without cloning");
  }
  for (let i = 0; i < 12; i++) {
    system.update(1 / 60, racers); world.update(system.state(), 1 / 60, racers); assertFinite(scene);
  }
  system.reset(); world.update(system.state(), 0, racers);
  assert.equal(pickupCount(scene), 60);
  scene.traverse(o => { if (o.isInstancedMesh && !o.name.startsWith("items/pickups/")) {
    assert.equal(o.count, 0, o.name); assert.equal(o.visible, false, o.name);
  } });
  deploy(system, item.id, racers); world.update(system.state(), 0, racers);
  assertFinite(scene);
});

test("available on/off-road item models, halos and sparkles compact and reconcile together at dt=0", t => {
  const { scene, world, system } = fixture(t);
  const snapshot = system.state();
  world.update(snapshot, 0);
  assert.ok(snapshot.pickups.some(p => course.roadDistance(p.x, p.z) > 35));
  assert.equal(scene.getObjectByName("items/world").children.length, 12, "60 detailed pickups use only 12 draws");
  assert.equal(mesh(scene, "pickups/gift-boxes"), undefined);
  assert.equal(mesh(scene, "pickups/ribbons"), undefined);
  const color = new THREE.Color();
  function assertPickups() {
    const available = snapshot.pickups.filter(p => p.available), indices = new Map();
    assert.equal(pickupCount(scene), available.length);
    assert.equal(count(scene, "pickups/glow-rings"), available.length);
    assert.equal(count(scene, "pickups/sparkles"), available.length);
    available.forEach((p, i) => {
      const index = indices.get(p.type) ?? 0, model = mesh(scene, `pickups/model/${p.type}`);
      indices.set(p.type, index + 1);
      const position = positionAt(model, index);
      close(position.x, p.x); close(position.z, p.z); assert.ok(position.y > p.y);
      assert.deepEqual(positionAt(mesh(scene, "pickups/sparkles"), i), position);
      const ring = mesh(scene, "pickups/glow-rings"), ground = positionAt(ring, i);
      close(ground.x, p.x); close(ground.z, p.z); close(ground.y, course.heightAt(p.x, p.z) + 0.07);
      ring.getColorAt(i, color);
      const expected = new THREE.Color(ITEMS.find(item => item.id === p.type).color);
      close(color.r, expected.r); close(color.g, expected.g); close(color.b, expected.b);
      model.getColorAt(index, color); assert.deepEqual(color, new THREE.Color(0xffffff), "keep baked toy colors intact");
    });
    for (const item of ITEMS) assert.equal(count(scene, `pickups/model/${item.id}`), indices.get(item.id) ?? 0);
  }
  assertPickups();
  snapshot.pickups.forEach((p, i) => { p.available = i % 2 === 0; });
  world.update(snapshot, 0); assertPickups(); assert.equal(pickupCount(scene), 30);
  snapshot.pickups = snapshot.pickups.slice(0, 2).map(p => ({ ...p, available: true, x: p.x + 1000, y: 20 }));
  world.update(snapshot, 0); assertPickups(); assert.equal(pickupCount(scene), 2);
  snapshot.pickups.forEach(p => { p.available = false; });
  world.update(snapshot, 0); assertPickups();
  assert.ok(scene.getObjectByName("items/world").children.every(o => o.count === 0 && !o.visible));
  snapshot.pickups.forEach(p => { p.available = true; });
  world.update(snapshot, 0); assertPickups();
  world.update(empty(), 0);
  assert.ok(scene.getObjectByName("items/world").children.every(o => o.count === 0 && !o.visible));
});

test("all ten pickups have distinct full-color geometry with large floating visual extents", t => {
  const { scene, world } = fixture(t), snapshot = empty();
  snapshot.pickups = ITEMS.map((item, i) => ({ id: i, type: item.id, x: i * 10, y: 0.9, z: 0, available: true }));
  world.update(snapshot, 0);
  const models = ITEMS.map(item => mesh(scene, `pickups/model/${item.id}`));
  assert.equal(new Set(models.map(o => o.geometry)).size, ITEMS.length);
  assert.equal(new Set(models.map(o => JSON.stringify([...o.geometry.attributes.position.array,
    ...o.geometry.attributes.color.array]))).size, ITEMS.length, "distinct parts, not renamed copies");
  for (const [i, model] of models.entries()) {
    const expected = new THREE.Color(ITEMS[i].color), { color: colors, position: positions } = model.geometry.attributes;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let matching = 0, area = 0;
    // Compare surface area: small curved highlights have more vertices than broad emblem faces.
    for (let j = 0; j < colors.count; j += 3) {
      a.fromBufferAttribute(positions, j);
      b.fromBufferAttribute(positions, j + 1).sub(a); c.fromBufferAttribute(positions, j + 2).sub(a);
      const triangle = b.cross(c).length() / 2;
      area += triangle;
      if (Math.abs(colors.getX(j) - expected.r) < 1e-4 && Math.abs(colors.getY(j) - expected.g) < 1e-4
        && Math.abs(colors.getZ(j) - expected.b) < 1e-4) matching += triangle;
    }
    assert.ok(matching > area * 0.1, `${model.name} uses the shared catalog palette`);
    assert.equal(model.material.transparent, false);
  }
  // Sample a full turn. Measure actual toy vertices, excluding halos and sparkle accents.
  for (let frame = 0; frame <= 126; frame++) {
    world.update(snapshot, frame ? 0.1 : 0);
    if (frame % 15 !== 0 && frame !== 126) continue;
    for (const model of models) {
      const bounds = boundsAt(model), size = bounds.getSize(new THREE.Vector3());
      assert.ok(size.y >= 1.45, `${model.name} vertical silhouette: ${size.y}`);
      assert.ok(Math.max(size.x, size.y, size.z) >= 2.25, `${model.name} dominant extent`);
      assert.ok(Math.min(size.x, size.z) >= 0.65, `${model.name} retains thickness edge-on`);
      assert.ok(bounds.min.y > 0.25 && bounds.max.y < 4.25, `${model.name} floats above the ground, within driving view`);
    }
    for (const id of ["rocket", "homing"]) {
      const nose = new THREE.Vector3(0, 0, 1).transformDirection(matrixAt(mesh(scene, `pickups/model/${id}`)));
      close(nose.y, Math.sin(Math.PI / 3));
    }
  }
  const halo = mesh(scene, "pickups/glow-rings"), haloSize = boundsAt(halo).getSize(new THREE.Vector3());
  close(haloSize.x, 2.96); close(haloSize.z, 2.96);
  assert.equal(halo.material.depthWrite, false); assert.equal(halo.material.depthTest, true);
  assert.ok(halo.material.transparent);
  assert.equal(mesh(scene, "pickups/sparkles").material.toneMapped, false);
  assertFinite(scene);
});

test("oil droplet/puddle, shield, single star and solid bolt have recognizable pickup silhouettes", t => {
  const { scene, world, system } = fixture(t, true);
  world.update(system.state(), 0);
  const probes = {
    oil: { inside: [[0, 0.8], [0.8, -0.76]], outside: [[0.5, 0.8], [0.8, -0.5]] },
    shield: { inside: [[0, 0.1], [0.6, 0.8], [0, -0.8]], outside: [[0.7, -0.8]] },
    star: { inside: [[0, 0], [0, 0.9], [0.85, 0.27]], outside: [[0.6, 0.8], [0, -0.78]] },
    lightning: { inside: [[0, 0.8], [0, 0], [-0.19, -0.8]], outside: [[0.5, 0.8], [0.55, -0.55]] },
  };
  for (const [id, { inside, outside }] of Object.entries(probes)) {
    const model = mesh(scene, `pickups/model/${id}`);
    assert.equal(model.geometry.name, `items/geometry/pickup-${id}`);
    const local = new THREE.Mesh(model.geometry, model.material);
    for (const side of [-1, 1]) for (const [points, expected] of [[inside, true], [outside, false]]) {
      for (const [x, y] of points) {
        const ray = new THREE.Raycaster(new THREE.Vector3(x, y, side * 5), new THREE.Vector3(0, 0, -side));
        assert.equal(ray.intersectObject(local).length > 0, expected, `${id} silhouette at ${x},${y} from ${side}`);
      }
    }
  }
  const rocket = mesh(scene, "pickups/model/rocket"), homing = mesh(scene, "pickups/model/homing");
  const whites = object => {
    const colors = object.geometry.attributes.color, positions = object.geometry.attributes.position, bounds = new THREE.Box3();
    for (let i = 0; i < colors.count; i++) if (colors.getX(i) === 1 && colors.getY(i) === 1 && colors.getZ(i) === 1) {
      bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, i));
    }
    return bounds;
  };
  assert.ok(whites(rocket).isEmpty(), "orange foam rocket has no eyes");
  const eyes = whites(homing);
  assert.ok(!eyes.isEmpty() && eyes.min.x < 0 && eyes.max.x > 0 && eyes.min.y > 0.2 && eyes.min.z > 0.2,
    "green buddy rocket retains its forward-facing white eyes");
});

test("dt=0 and invalid dt freeze decoration; snapshots still move entities and racer overlays", t => {
  const { scene, world, system } = fixture(t);
  const racers = [target()];
  deploy(system, "shield", racers); deploy(system, "star", racers); deploy(system, "ball", racers);
  const snapshot = system.state();
  world.update(snapshot, 0.1, racers);
  const before = transforms(scene);
  for (const dt of [0, -1, NaN, Infinity]) {
    world.update(snapshot, dt, racers); assert.deepEqual(transforms(scene), before);
  }
  const ball = snapshot.entities[0]; ball.x = 80; ball.y = 20; ball.z = -50;
  racers[0] = target("player", -30, 15, 27);
  world.update(snapshot, 0, racers);
  assert.deepEqual(positionAt(mesh(scene, "entities/ball")).toArray(), [80, 20, -50]);
  assert.deepEqual(positionAt(mesh(scene, "statuses/shield")).toArray(), [-30, 15, 27]);
  const pickupBefore = matrixAt(mesh(scene, "pickups/model/banana")).elements;
  world.update(snapshot, 0.1, racers);
  assert.notDeepEqual(matrixAt(mesh(scene, "pickups/model/banana")).elements, pickupBefore);
  world.update(snapshot, 0, []);
  assert.equal(count(scene, "statuses/shield"), 0); assert.equal(count(scene, "statuses/star"), 0);
});

test("reduced motion removes bob/spin/confetti and keeps rings and bolts static while following racers", t => {
  const { scene, world, system } = fixture(t, true);
  const racers = [target(), target("friend", 20, 5, 30)];
  deploy(system, "star", racers); deploy(system, "lightning", racers);
  const snapshot = system.state(); world.update(snapshot, 0, racers);
  const before = transforms(scene);
  for (const e of snapshot.effects) e.age = 0.5;
  for (let i = 0; i < 50; i++) world.update(snapshot, 0.1, racers);
  assert.deepEqual(transforms(scene), before);
  assert.equal(count(scene, "effects/confetti"), 0);
  assert.ok(count(scene, "effects/rings") > 0); assert.equal(count(scene, "effects/lightning"), 2);
  racers[1].x = 100; racers[1].y = 25;
  world.update(snapshot, 0, racers);
  assert.deepEqual(positionAt(mesh(scene, "effects/lightning"), 1).toArray(), [100, 25, 30]);
  for (const e of snapshot.effects) e.age = e.life;
  world.update(snapshot, 0, racers); assert.equal(count(scene, "effects/rings"), 0);
  assert.equal(count(scene, "effects/lightning"), 0);
  assertFinite(scene);
});

test("bursts expand from core ages, expire, and lightning ID reuse binds the new racer", t => {
  const { scene, world } = fixture(t);
  const snapshot = empty(), racers = [target("a", 10), target("b", 50, 15, 80)];
  snapshot.effects = [{ id: 1, type: "lightning", item: "lightning", x: 10, y: 0, z: 0, age: 0, life: 0.8, radius: 3 }];
  world.update(snapshot, 0, racers);
  const small = matrixAt(mesh(scene, "effects/rings")).elements[0];
  snapshot.effects[0].age = 0.4; racers[0].x = 25;
  world.update(snapshot, 0, racers);
  assert.ok(matrixAt(mesh(scene, "effects/rings")).elements[0] > small);
  close(positionAt(mesh(scene, "effects/lightning")).x, 25);
  assert.equal(count(scene, "effects/confetti"), 8);
  Object.assign(snapshot.effects[0], { x: 50, y: 15, z: 80, age: 0 });
  world.update(snapshot, 0, racers); close(positionAt(mesh(scene, "effects/lightning")).x, 50);
  racers[1].x = 70; world.update(snapshot, 0, racers);
  close(positionAt(mesh(scene, "effects/lightning")).x, 70);
  world.update(empty(), 0); assert.equal(count(scene, "effects/lightning"), 0);
  assert.equal(count(scene, "effects/confetti"), 0);
});

test("shield hoops are sparse, transparent, depth-tested and never a full sphere or framebuffer effect", t => {
  const { scene, world, system } = fixture(t);
  deploy(system, "shield"); world.update(system.state(), 0, [target()]);
  const shield = mesh(scene, "statuses/shield");
  assert.equal(shield.material.transparent, true); assert.ok(shield.material.opacity <= 0.45);
  assert.equal(shield.material.depthWrite, false); assert.equal(shield.material.depthTest, true);
  assert.equal(shield.material.map, null); assert.ok(!shield.material.isShaderMaterial);
  // A ray from the cockpit through the forward view does not hit an enclosing surface.
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.15, 0), new THREE.Vector3(Math.sin(0.7), 0, Math.cos(0.7)));
  assert.equal(ray.intersectObject(shield).length, 0);
});

test("minimap shows only available colored diamonds, preserves canvas state, and uses -Z", t => {
  const { world } = fixture(t), snapshot = empty(), ctx = canvas();
  snapshot.pickups = ITEMS.map((item, i) => ({ id: i, type: item.id, x: 20 + i, y: 0.9, z: 30 + i, available: i !== 3 }));
  world.update(snapshot, 0); world.drawMap(ctx, 0.5);
  assert.equal(ctx.paths.length, 9);
  assert.deepEqual(ctx.paths[0], { color: ITEMS[0].color, points: [[10, -17.3], [12.3, -15], [10, -12.7], [7.7, -15]] });
  assert.deepEqual([ctx.fillStyle, ctx.strokeStyle, ctx.lineWidth, ctx.globalAlpha], ["old-fill", "old-stroke", 4, 0.3]);
  snapshot.pickups[0].x = 999;
  const detached = canvas(); world.drawMap(detached, 0.5); assert.deepEqual(detached.paths, ctx.paths);
  world.update(empty(), 0); const cleared = canvas(); world.drawMap(cleared, 0.5); assert.equal(cleared.paths.length, 0);
  for (const scale of [0, -1, NaN, Infinity]) world.drawMap(cleared, scale);
  assert.equal(cleared.paths.length, 0);
});

test("hundreds of pickups and capped effects reuse bounded geometry/material/instance resources", t => {
  const { scene, world } = fixture(t), snapshot = empty();
  snapshot.pickups = Array.from({ length: 300 }, (_, i) => ({ id: i, type: ITEMS[i % 10].id, x: i, y: 0.9, z: i * 2, available: true }));
  snapshot.entities = Array.from({ length: 32 }, (_, i) => ({ id: i, type: ITEMS[i % 7].id, x: i, y: 2, z: i, heading: i, age: 0, life: 10 }));
  snapshot.effects = Array.from({ length: 48 }, (_, i) => ({ id: i, type: i % 2 ? "burst" : "lightning", item: ITEMS[i % 10].id,
    x: i, y: 0, z: i, age: 0.2, life: 0.8, radius: 3 }));
  snapshot.statuses = [{ id: "player", shield: 6, turbo: 5 }];
  world.update(snapshot, 0, [target()]);
  const root = scene.getObjectByName("items/world"), meshes = [...root.children];
  const geometries = new Set(meshes.map(o => o.geometry)), materials = new Set(meshes.map(o => o.material));
  assert.equal(geometries.size, 18); assert.equal(materials.size, 3);
  assert.equal(meshes.length, 24); assert.equal(count(scene, "effects/confetti"), 384);
  const buffers = meshes.map(o => o.instanceMatrix.array);
  for (let i = 0; i < 100; i++) {
    snapshot.entities.forEach(e => { e.id += 32; }); snapshot.effects.forEach(e => { e.id += 48; });
    world.update(snapshot, 1 / 60, [target()]);
    if (i % 10 === 0) world.update(empty(), 0);
  }
  world.update(snapshot, 0, [target()]);
  assert.deepEqual(root.children, meshes);
  root.children.forEach((o, i) => assert.equal(o.instanceMatrix.array, buffers[i]));
  assertFinite(scene);
  const released = new Map();
  for (const resource of [...geometries, ...materials, ...meshes]) {
    released.set(resource, 0); resource.addEventListener("dispose", () => released.set(resource, released.get(resource) + 1));
  }
  const unrelated = new THREE.Group(); scene.add(unrelated);
  world.dispose(); world.dispose();
  assert.deepEqual(scene.children, [unrelated]); assert.equal(root.children.length, 0);
  for (const value of released.values()) assert.equal(value, 1);
  world.update(snapshot, 1, [target()]); const ctx = canvas(); world.drawMap(ctx, 1);
  assert.equal(ctx.paths.length, 0); assert.deepEqual(scene.children, [unrelated]);
});

test("growing pickup instance buffers disposes old meshes without disposing shared deployed geometry", t => {
  const { scene, world, system } = fixture(t), snapshot = system.state();
  snapshot.pickups = snapshot.pickups.slice(0, 1); world.update(snapshot, 0);
  const old = mesh(scene, "pickups/model/banana"); let meshDisposals = 0, geometryDisposals = 0;
  old.addEventListener("dispose", () => meshDisposals++);
  old.geometry.addEventListener("dispose", () => geometryDisposals++);
  snapshot.pickups = Array.from({ length: 33 }, (_, i) => ({ ...snapshot.pickups[0], id: i, x: i * 4 }));
  snapshot.entities = [{ id: 1, type: "banana", x: 0, y: 0, z: 0, heading: 0, age: 0, life: 10 }];
  world.update(snapshot, 0);
  assert.equal(meshDisposals, 1); assert.equal(geometryDisposals, 0); assert.equal(old.parent, null);
  assert.equal(mesh(scene, "pickups/model/banana").geometry, old.geometry);
  assert.equal(mesh(scene, "entities/banana").geometry, old.geometry);
  assert.equal(pickupCount(scene), 33);
  snapshot.pickups.forEach((p, i) => {
    close(positionAt(mesh(scene, "pickups/model/banana"), i).x, p.x);
    close(positionAt(mesh(scene, "pickups/glow-rings"), i).x, p.x);
    close(positionAt(mesh(scene, "pickups/sparkles"), i).x, p.x);
  });
  assertFinite(scene);
  world.dispose(); assert.equal(geometryDisposals, 1);
});

test("invalid coordinates are skipped and missing optional headings never create NaN transforms", t => {
  const { scene, world } = fixture(t), snapshot = empty();
  snapshot.pickups = [{ id: 1, type: "banana", x: NaN, y: 1, z: 0, available: true },
    { id: 2, type: "star", x: 0, y: 1, z: Infinity, available: true },
    { id: 3, type: "unknown", x: 0, y: 1, z: 0, available: true },
    { id: 4, type: "oil", x: 0, y: 1, z: 0, available: false }];
  snapshot.entities = [{ id: 1, type: "rocket", x: 2, y: 3, z: 4, heading: NaN, age: 0, life: 1 },
    { id: 2, type: "ball", x: Infinity, y: 0, z: 0 }];
  snapshot.statuses = [{ id: "player", shield: 4 }];
  snapshot.effects = [{ id: 1, type: "burst", item: "banana", x: 0, y: NaN, z: 0, age: 0, life: 1 }];
  world.update(snapshot, NaN, [{ id: "player", x: 0, y: 0, z: 0 }]);
  assert.equal(pickupCount(scene), 0); assert.equal(count(scene, "entities/ball"), 0);
  assert.equal(count(scene, "pickups/glow-rings"), 0); assert.equal(count(scene, "pickups/sparkles"), 0);
  const ctx = canvas(); world.drawMap(ctx, 1); assert.equal(ctx.paths.length, 0);
  assert.equal(count(scene, "entities/rocket"), 1); assert.equal(count(scene, "statuses/shield"), 1);
  assertFinite(scene);
});
