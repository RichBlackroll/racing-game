import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { createAmbientEvents, MAP_EVENTS } from "./ambient-events.js";
import { createCourse } from "./course.js";

const LEVELS = ["forest", "city", "stunt", "amsterdam", "wellington", "moon"];
const origin = new THREE.Vector3(0, 0, 0);

function seeded(seed = 12345) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function fixture(t, options = {}) {
  const scene = new THREE.Scene();
  const course = { halfSize: 1000, heightAt: () => 0, roadDistance: () => 1000 };
  const events = createAmbientEvents({ scene, course, random: seeded(), ...options });
  t.after(() => events.dispose());
  return { events, scene, course: options.course ?? course };
}

function resources(group) {
  const nodes = new Set(), geometries = new Set(), materials = new Set(), textures = new Set();
  let draws = 0, triangles = 0;
  group.traverse(node => {
    nodes.add(node);
    if (!node.isMesh) return;
    draws++;
    geometries.add(node.geometry);
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3
      * (node.isInstancedMesh ? node.count : 1);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  return { nodes, geometries, materials, textures, draws, triangles };
}

function pose(group) {
  const result = [];
  group.updateMatrixWorld(true);
  group.traverse(node => {
    const transform = [...node.position.toArray(), ...node.quaternion.toArray(),
      ...node.scale.toArray(), ...node.matrixWorld.elements];
    assert.ok(transform.every(Number.isFinite), `${node.name}: finite transforms`);
    const instances = node.isInstancedMesh ? Array.from(node.instanceMatrix.array) : null;
    if (instances) assert.ok(instances.every(Number.isFinite), `${node.name}: finite instances`);
    const materials = node.isMesh ? (Array.isArray(node.material) ? node.material : [node.material]) : [];
    const paint = materials.map(material => [material.opacity, material.emissiveIntensity ?? 0]);
    assert.ok(paint.flat().every(Number.isFinite), `${node.name}: finite paint`);
    result.push({ transform, visible: node.visible, instances, paint });
  });
  return result;
}

function tick(events, dt = 1, position = origin, heading = 0) {
  const before = events.state().counts;
  events.update(dt, position, heading);
  const state = events.state(), starts = [];
  for (const [id, count] of Object.entries(state.counts)) {
    assert.ok(count === before[id] || count === before[id] + 1, `${id}: no catch-up burst`);
    if (count > before[id]) {
      const actor = state.active.find(entry => entry.id === id);
      assert.ok(actor, `${id}: a counted event has a real actor`);
      starts.push(actor);
    }
  }
  assert.ok(starts.length <= 1, "at most one arrival per update");
  assert.equal(new Set(state.active.map(entry => entry.id)).size, state.active.length);
  return starts;
}

function assertGroundPath(entry, definition, course, obstacles = []) {
  const [ax, , az] = entry.from, [bx, , bz] = entry.to, radius = definition.radius;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
  let previousY;
  for (let i = 0; i <= steps; i++) {
    const x = ax + (bx - ax) * i / steps, z = az + (bz - az) * i / steps;
    const y = course.heightAt(x, z);
    assert.ok(Number.isFinite(y));
    assert.ok(Math.max(Math.abs(x), Math.abs(z)) + radius < course.halfSize, "footprint inside map");
    assert.ok(course.roadDistance(x, z) > 8 + radius, "entire path stays off roads");
    assert.ok(!course.isSafePosition || course.isSafePosition(x, z, radius), "dry, safe centre footprint");
    if (previousY !== undefined) assert.ok(Math.abs(y - previousY) < 0.65, "no steep step along path");
    previousY = y;
    for (const obstacle of obstacles) {
      const clearance = obstacle.hx === undefined
        ? Math.hypot(x - obstacle.x, z - obstacle.z) - (obstacle.r ?? 0)
        : Math.hypot(Math.max(0, Math.abs(x - obstacle.x) - obstacle.hx),
          Math.max(0, Math.abs(z - obstacle.z) - obstacle.hz));
      assert.ok(clearance >= radius + 1, "swept actor footprint clears collider");
    }
    for (let j = 0; j < 8; j++) {
      const angle = j * Math.PI / 4, xx = x + Math.sin(angle) * radius, zz = z + Math.cos(angle) * radius;
      assert.ok(Math.abs(course.heightAt(xx, zz) - y) < 0.85, "footprint has gentle terrain");
      assert.ok(!course.isSafePosition || course.isSafePosition(xx, zz, 0.5), "footprint edges stay dry");
    }
  }
  assert.ok(Math.abs(entry.from[1] - course.heightAt(ax, az) - 0.12) < 1e-8);
  assert.ok(Math.abs(entry.to[1] - course.heightAt(bx, bz) - 0.12) < 1e-8);
}

test("all six maps expose distinct, immutable, real event catalogs", () => {
  assert.deepEqual(Object.keys(MAP_EVENTS).sort(), [...LEVELS].sort());
  assert.ok(Object.isFrozen(MAP_EVENTS));
  for (const level of LEVELS) {
    const catalog = MAP_EVENTS[level], daytime = catalog.filter(event => !event.nightOnly);
    assert.ok(Object.isFrozen(catalog));
    assert.ok(new Set(catalog.map(event => event.id)).size >= 5, level);
    assert.equal(new Set(catalog.map(event => event.id)).size, catalog.length);
    assert.equal(daytime.length, 6, `${level}: six daytime events`);
    for (const event of catalog) {
      assert.ok(Object.isFrozen(event));
      assert.equal(event.type, event.id);
      assert.ok(event.name.length > 8);
      assert.ok(Number.isFinite(event.duration) && event.duration > 0);
      assert.ok(event.ground ? event.radius > 0 : event.altitude > 0);
    }
    assert.equal(catalog.find(event => event.id === "comet").nightOnly, level !== "moon",
      "Moon explicitly keeps its shooting star available in its permanently dark sky");
  }
  const scene = new THREE.Scene();
  assert.throws(() => createAmbientEvents({ scene, course: {}, level: "missing" }), RangeError);
  assert.equal(scene.children.length, 0, "invalid level does not attach a partial pool");
});

for (const level of LEVELS) {
  test(`${level}: six real daytime actors, exhausted shuffled bags, and bounded pooled resources over many cycles`, t => {
    const { events, scene } = fixture(t, { level });
    const catalog = MAP_EVENTS[level], expected = catalog.filter(event => !event.nightOnly).map(event => event.id).sort();
    const pool = resources(events.group), starts = [], visible = new Set();
    assert.equal(events.group.name, "ambient-events");
    assert.equal(events.group.parent, scene);
    assert.equal(events.group.children.length, catalog.length);
    assert.ok(pool.draws > catalog.length && pool.draws <= catalog.length * 32);
    assert.ok(pool.triangles <= catalog.length * 8000);
    assert.ok(pool.materials.size <= catalog.length * 5);
    assert.equal(pool.textures.size, 0);
    for (let second = 0; second < 1800; second++) {
      starts.push(...tick(events).map(entry => entry.id));
      const state = events.state();
      assert.equal(state.limit, 3);
      assert.ok(state.active.length <= 3);
      assert.ok(events.group.children.filter(node => node.visible).length <= 3);
      for (const entry of state.active) {
        assert.ok([...entry.position, ...entry.from, ...entry.to, entry.age, entry.opacity].every(Number.isFinite));
        assert.ok(entry.opacity >= 0 && entry.opacity <= 1);
        if (entry.opacity > 0.01) {
          const root = events.group.getObjectByName(`ambient-${entry.id}`);
          assert.ok(root?.visible, `${entry.id}: visible model, not just a counter`);
          let meshes = 0;
          root.traverseVisible(node => { if (node.isMesh) meshes++; });
          assert.ok(meshes > 0);
          visible.add(entry.id);
        }
      }
      if (second % 100 === 0) {
        pose(events.group);
        assert.deepEqual(resources(events.group), pool, "recurrence reuses every node, geometry and material");
        assert.deepEqual(scene.children, [events.group], "actors never add scene-level objects");
      }
    }
    assert.ok(starts.length >= expected.length * 10, "many complete shuffle cycles exercised");
    assert.deepEqual([...visible].sort(), expected);
    for (let i = 0; i + expected.length <= starts.length; i += expected.length) {
      assert.deepEqual(starts.slice(i, i + expected.length).sort(), expected, `bag ${i / expected.length}: no early repeats`);
    }
    for (let i = 1; i < starts.length; i++) assert.notEqual(starts[i], starts[i - 1], "no immediate repeat across bag boundary");
    if (level !== "moon") assert.equal(events.state().counts.comet, 0);
  });

  test(`${level}: injected seeded RNG determines the complete schedule and placements`, t => {
    const a = fixture(t, { level, random: seeded(731) }).events;
    const b = fixture(t, { level, random: seeded(731) }).events;
    const c = fixture(t, { level, random: seeded(732) }).events;
    t.mock.method(Math, "random", () => { throw new Error("controller must use injected random"); });
    const first = [], other = [];
    for (let i = 0; i < 420; i++) {
      if (i === 160 || i === 300) for (const events of [a, b, c]) events.setNight(i === 160 ? 1 : 0);
      const position = new THREE.Vector3(Math.sin(i / 30) * 30, 0, Math.cos(i / 30) * 30), heading = i / 80;
      const dt = [0.25, 0.75, 1, 40][i % 4];
      first.push(...tick(a, dt, position, heading));
      tick(b, dt, position, heading);
      other.push(...tick(c, dt, position, heading));
      assert.deepEqual(a.state(), b.state(), `same seed and inputs at update ${i}`);
      if (i % 70 === 0) assert.deepEqual(pose(a.group), pose(b.group));
    }
    assert.notDeepEqual(first, other, "different seeds change schedule/placements");
  });
}

test("zero, invalid dt and invalid driving inputs freeze schedule, RNG and all rendered transforms", t => {
  let calls = 0;
  const random = seeded(), { events } = fixture(t, { random: () => { calls++; return random(); } });
  for (let i = 0; i < 20; i++) tick(events);
  const state = events.state(), rendered = pose(events.group), randomCalls = calls;
  for (const dt of [0, -0, -1, NaN, Infinity, -Infinity, undefined, null, "1"]) {
    events.update(dt, origin, 0);
    assert.deepEqual(events.state(), state, `dt=${dt}`);
    assert.deepEqual(pose(events.group), rendered);
  }
  for (const position of [undefined, null, {}, { x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }, { x: 0, y: 0, z: "0" }]) {
    events.update(1, position);
    assert.deepEqual(events.state(), state);
  }
  for (const heading of [NaN, Infinity, null, "0"]) {
    events.update(1, origin, heading);
    assert.deepEqual(events.state(), state);
  }
  assert.equal(calls, randomCalls);
  assert.deepEqual(pose(events.group), rendered);
});

test("a stalled frame advances at most one second, never drains the bag in a catch-up loop", t => {
  for (const reducedMotion of [false, true]) {
    const a = fixture(t, { reducedMotion }).events, b = fixture(t, { reducedMotion }).events;
    for (let i = 0; i < 240; i++) {
      tick(a, [2, 3600, Number.MAX_VALUE][i % 3]);
      tick(b, 1);
      assert.deepEqual(a.state(), b.state());
      assert.equal(a.state().time, (i + 1) * (reducedMotion ? 0.5 : 1));
    }
    assert.deepEqual(pose(a.group), pose(b.group));
  }
});

test("tablet and live performance quality reduce actor budgets, allowing surplus a 1.8-second fade", t => {
  const normal = fixture(t).events, tablet = fixture(t, { tablet: true }).events;
  assert.equal(normal.state().limit, 3);
  assert.equal(tablet.state().limit, 2);
  assert.ok(resources(tablet.group).draws < resources(normal.group).draws, "tablet also lowers model draw budget");
  assert.ok(resources(tablet.group).triangles < resources(normal.group).triangles);
  let highWater = 0;
  for (let i = 0; i < 900; i++) {
    tick(tablet);
    highWater = Math.max(highWater, tablet.state().active.length);
    assert.ok(tablet.state().active.length <= 2);
  }
  assert.equal(highWater, 2, "tablet still permits overlapping visitors");
  for (let i = 0; i < 200 && normal.state().active.length < 3; i++) tick(normal);
  assert.equal(normal.state().active.length, 3);
  const before = normal.state(), pool = resources(normal.group), rendered = pose(normal.group);
  const surplus = before.active[2].id;
  normal.setPerformanceMode(true);
  assert.equal(normal.state().limit, 2);
  assert.equal(normal.state().time, before.time, "quality change is not a clock tick");
  assert.deepEqual(normal.state().counts, before.counts);
  assert.equal(normal.state().active.length, 3, "no abrupt disposal of the surplus actor");
  assert.deepEqual(pose(normal.group), rendered, "quality switch does not pop the current pose");
  normal.update(0, origin);
  tick(normal, 0.9);
  const fading = normal.state().active.find(entry => entry.id === surplus);
  assert.ok(fading && fading.opacity > 0 && fading.opacity < 1, "surplus visibly fades");
  assert.ok(Math.abs(fading.age - before.active[2].age - 0.9) < 1e-8, "retirement does not teleport the visitor to the end of its path");
  // Allow rounding error at the exact 1.8-second fade boundary.
  tick(normal, 0.900001);
  assert.ok(normal.state().active.length <= 2, "new budget reached after 1.8 seconds");
  assert.ok(!normal.state().active.some(entry => entry.id === surplus));
  for (let i = 0; i < 600; i++) {
    tick(normal);
    assert.ok(normal.state().active.length <= 2);
  }
  assert.deepEqual(resources(normal.group), pool);
  normal.setPerformanceMode(false);
  assert.equal(normal.state().limit, 3);
  const restored = normal.state();
  for (const value of [undefined, null, 1, "true"]) normal.setPerformanceMode(value);
  assert.deepEqual(normal.state(), restored);
});

test("reduced motion halves travel speed, removes the arcing bob and never exceeds one actor", t => {
  const normal = fixture(t, { random: () => 0.999999 }).events;
  const slow = fixture(t, { reducedMotion: true, random: () => 0.999999 }).events;
  for (let i = 0; i < 2; i++) tick(normal);
  for (let i = 0; i < 3; i++) tick(slow);
  const start = normal.state().active[0];
  assert.equal(start.id, "balloon");
  assert.deepEqual(slow.state().active[0].from, start.from);
  assert.deepEqual(slow.state().active[0].to, start.to);
  for (let i = 0; i < 6; i++) { tick(normal); tick(slow); }
  const a = normal.state().active[0], b = slow.state().active[0];
  assert.equal(a.age, 6);
  assert.equal(b.age, 3);
  const distance = entry => Math.hypot(entry.position[0] - entry.from[0], entry.position[2] - entry.from[2]);
  assert.ok(Math.abs(distance(a) - distance(b) * 2) < 1e-8);
  assert.ok(Math.abs(b.position[1] - (b.from[1] + (b.to[1] - b.from[1]) * b.age / b.duration)) < 1e-8);
  assert.ok(a.position[1] > a.from[1] + (a.to[1] - a.from[1]) * a.age / a.duration);
  const seen = new Set();
  for (let i = 0; i < 1600; i++) {
    if (i % 100 === 0) slow.setPerformanceMode(i % 200 === 0);
    for (const entry of tick(slow)) seen.add(entry.id);
    assert.equal(slow.state().limit, 1);
    assert.ok(slow.state().active.length <= 1);
  }
  assert.equal(seen.size, 6, "reduced motion still cycles the complete daytime lineup");
  pose(slow.group);
});

for (const level of LEVELS.filter(level => level !== "moon")) {
  test(`${level}: night-only comet is excluded by day and hidden on a day switch without advancing time`, t => {
    const { events } = fixture(t, { level });
    for (let i = 0; i < 180; i++) tick(events);
    assert.equal(events.state().counts.comet, 0);
    const beforeNight = events.state();
    events.setNight(1);
    assert.deepEqual(events.state(), beforeNight, "lighting alone cannot spawn or age an actor");
    let comet;
    for (let i = 0; i < 100 && !comet; i++) {
      tick(events);
      comet = events.state().active.find(entry => entry.id === "comet" && entry.opacity > 0.1);
    }
    assert.ok(comet, "night makes the real shooting star available promptly");
    const root = events.group.getObjectByName("ambient-comet"), beforeDay = events.state();
    assert.ok(root.visible);
    events.setNight(0);
    events.update(0, origin);
    const afterDay = events.state();
    assert.equal(afterDay.time, beforeDay.time);
    assert.equal(afterDay.nextIn, beforeDay.nextIn);
    assert.deepEqual(afterDay.counts, beforeDay.counts);
    assert.deepEqual(afterDay.active.map(({ opacity, ...entry }) => entry), beforeDay.active.map(({ opacity, ...entry }) => entry));
    assert.equal(afterDay.active.find(entry => entry.id === "comet").opacity, 0);
    assert.equal(root.visible, false);
    for (const material of resources(root).materials) assert.equal(material.opacity, 0);
    const frozen = pose(events.group);
    for (const value of [0, NaN, Infinity, undefined]) events.setNight(value);
    assert.deepEqual(pose(events.group), frozen);
    for (let i = 0; i < 300; i++) tick(events);
    assert.equal(events.state().counts.comet, beforeDay.counts.comet, "queued night visitors cannot leak into the day bag");
  });
}

test("reset clears counts, ages and visibility, reuses the pool, and restarts the initial delay", t => {
  const { events } = fixture(t, { level: "moon", reducedMotion: true });
  const pool = resources(events.group);
  events.setNight(1);
  events.setPerformanceMode(true);
  for (let i = 0; i < 240; i++) tick(events);
  assert.ok(Object.values(events.state().counts).some(count => count > 0));
  events.reset();
  const reset = events.state();
  assert.equal(reset.time, 0);
  assert.equal(reset.nextIn, 1.5);
  assert.equal(reset.limit, 1, "accessibility/quality configuration survives reset");
  assert.deepEqual(reset.active, []);
  assert.ok(Object.values(reset.counts).every(count => count === 0));
  assert.ok(events.group.children.every(node => !node.visible));
  assert.deepEqual(resources(events.group), pool);
  events.reset();
  assert.deepEqual(events.state(), reset);
  events.update(0, origin);
  for (let i = 0; i < 2; i++) tick(events);
  assert.equal(events.state().active.length, 0);
  tick(events);
  assert.equal(events.state().active.length, 1);
  assert.equal(events.state().active[0].age, 0);
  pose(events.group);
});

test("dispose releases owned resources exactly once, detaches only its group, and makes later calls inert", t => {
  const { events, scene } = fixture(t, { level: "stunt" });
  const unrelated = new THREE.Group();
  scene.add(unrelated);
  for (let i = 0; i < 50; i++) tick(events);
  const pool = resources(events.group), disposals = new Map();
  for (const resource of [...pool.geometries, ...pool.materials, ...pool.textures]) {
    disposals.set(resource, 0);
    resource.addEventListener("dispose", () => disposals.set(resource, disposals.get(resource) + 1));
  }
  events.dispose();
  assert.equal(events.group.parent, null);
  assert.deepEqual(scene.children, [unrelated]);
  assert.equal(events.state().disposed, true);
  assert.deepEqual(events.state().active, []);
  for (const count of disposals.values()) assert.equal(count, 1);
  const disposed = events.state();
  events.dispose();
  events.reset();
  events.setNight(1);
  events.setPerformanceMode(true);
  events.update(1e6, origin);
  assert.deepEqual(events.state(), disposed);
  for (const count of disposals.values()) assert.equal(count, 1);
});

for (const hazard of ["road", "water", "circle collider", "box collider", "steep terrain", "map edge"]) {
  test(`${hazard}: unsafe ground acts are skipped without starving flying events`, t => {
    const course = { halfSize: hazard === "map edge" ? 15 : 1000,
      heightAt: hazard === "steep terrain" ? (x, z) => x + z : () => 0,
      roadDistance: () => hazard === "road" ? 0 : 1000,
      isSafePosition: () => hazard !== "water" };
    const obstacles = hazard === "circle collider" ? [{ x: 0, z: 0, r: 1000 }]
      : hazard === "box collider" ? [{ x: 0, z: 0, hx: 1000, hz: 1000 }] : [];
    const original = structuredClone(obstacles), sites = [{ x: 0, z: 60, radius: 20 }];
    const { events } = fixture(t, { level: "moon", course, obstacles, sites });
    for (let i = 0; i < 300; i++) tick(events);
    const counts = events.state().counts;
    for (const definition of MAP_EVENTS.moon) {
      assert.ok(definition.ground ? counts[definition.id] === 0 : counts[definition.id] > 1, definition.id);
    }
    assert.deepEqual(obstacles, original, "decorative actors do not register or move colliders");
    assert.deepEqual(sites, [{ x: 0, z: 60, radius: 20 }]);
    pose(events.group);
  });
}

test("ground placement checks the swept interior and footprint edges, not just dry endpoints", t => {
  const baseline = fixture(t).events;
  let path;
  for (let i = 0; i < 160 && !path; i++) path = tick(baseline).find(entry => entry.id === "elephant");
  assert.ok(path);
  const x = (path.from[0] + path.to[0]) / 2, z = (path.from[2] + path.to[2]) / 2;
  const definition = MAP_EVENTS.forest.find(event => event.id === "elephant");
  for (const hazard of ["water", "road", "circle", "box", "slope", "wet edge"]) {
    const hx = hazard === "wet edge" ? path.from[0] + definition.radius : x;
    const hz = hazard === "wet edge" ? path.from[2] : z;
    const course = { halfSize: 1000,
      heightAt: hazard === "slope" ? (px, pz) => Math.max(0, 3 - Math.hypot(px - hx, pz - hz)) : () => 0,
      roadDistance: hazard === "road" ? (px, pz) => Math.hypot(px - hx, pz - hz) : () => 1000,
      isSafePosition: (px, pz, margin = 0) => !["water", "wet edge"].includes(hazard)
        || Math.hypot(px - hx, pz - hz) > (hazard === "wet edge" ? 0.4 : 1.5 + margin) };
    const obstacles = hazard === "circle" ? [{ x, z, r: 2 }]
      : hazard === "box" ? [{ x, z, hx: 2, hz: 2 }] : [];
    if (["water", "wet edge"].includes(hazard)) {
      assert.ok(course.isSafePosition(path.from[0], path.from[2], 0));
      assert.ok(course.isSafePosition(path.to[0], path.to[2], 0));
    }
    const { events } = fixture(t, { course, obstacles });
    let placements = 0;
    for (let i = 0; i < 300; i++) for (const entry of tick(events)) {
      if (entry.id !== "elephant") continue;
      placements++;
      assert.notDeepEqual(entry.from, path.from, `${hazard}: original unsafe path rejected`);
      assertGroundPath(entry, definition, course, obstacles);
    }
    assert.ok(placements > 1, `${hazard}: alternative safe paths still spawn`);
  }
});

for (const shape of ["box", "circle"]) {
  test(`flying paths and visible geometry clear tall ${shape} building tops for their entire travel`, t => {
    const course = { halfSize: 1000, heightAt: () => 12, roadDistance: () => 1000 };
    const obstacle = { x: 0, z: 130, y: 12, height: 240,
      ...(shape === "box" ? { hx: 1200, hz: 1200 } : { r: 1500 }) };
    const { events } = fixture(t, { level: "amsterdam", course, obstacles: [obstacle] });
    events.setNight(1);
    const seen = new Set(), top = obstacle.y + obstacle.height;
    for (let i = 0; i < 300; i++) {
      tick(events);
      for (const entry of events.state().active) {
        assert.ok(Math.min(entry.from[1], entry.to[1], entry.position[1]) > top);
        if (entry.opacity <= 0.01) continue;
        const root = events.group.getObjectByName(`ambient-${entry.id}`);
        const bounds = new THREE.Box3().setFromObject(root);
        assert.ok(bounds.min.y > top, `${entry.id}: complete model above building, not just its origin`);
        seen.add(entry.id);
      }
    }
    assert.equal(seen.size, 7, "six flying daytime acts and the night comet checked");
  });
}

for (const level of LEVELS) {
  test(`${level}: real createCourse route samples support the whole lineup and safe placements`, t => {
    const course = createCourse(level), routeBefore = course.route.map(point => point.toArray());
    const samples = Array.from({ length: 12 }, (_, i) => Math.floor(i * course.route.length / 12));
    const obstacles = samples.filter((_, i) => i % 3 === 0).map(index => {
      const point = course.route[index];
      return { x: point.x + 24, z: point.z + 24, y: course.heightAt(point.x + 24, point.z + 24), hx: 7, hz: 9, height: 45 };
    });
    const obstaclesBefore = structuredClone(obstacles);
    const sites = obstacles.map(obstacle => ({ x: obstacle.x, z: obstacle.z, radius: 18 }));
    const { events } = fixture(t, { level, course, obstacles, sites, random: seeded(2026) });
    const seen = new Set(), visited = new Set();
    for (let second = 0; second < 960; second++) {
      const index = samples[Math.floor(second / 20) % samples.length];
      visited.add(index);
      const position = course.route[index], next = course.route[(index + 1) % course.route.length];
      const heading = Math.atan2(next.x - position.x, next.z - position.z);
      for (const entry of tick(events, 1, position, heading)) {
        const definition = MAP_EVENTS[level].find(event => event.id === entry.id);
        if (definition.ground) {
          assertGroundPath(entry, definition, course, obstacles);
          assert.ok(Math.hypot(entry.from[0] - position.x, entry.from[2] - position.z) >= 28, "ground arrivals stay away from car");
          for (const [x, , z] of [entry.from, entry.to]) {
            const dx = x - position.x, dz = z - position.z;
            const ahead = dx * Math.sin(heading) + dz * Math.cos(heading);
            assert.ok(ahead >= 30, "ground paths start and finish in front of the driver");
            assert.ok(Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading)) <= ahead * 0.8);
          }
        }
      }
      for (const entry of events.state().active) {
        if (entry.opacity > 0.01) seen.add(entry.id);
        const definition = MAP_EVENTS[level].find(event => event.id === entry.id);
        if (definition.ground) assert.ok(Math.abs(entry.position[1] - course.heightAt(entry.position[0], entry.position[2]) - 0.12) < 1e-8);
        else assert.ok(entry.position[1] > course.heightAt(entry.position[0], entry.position[2]), `${entry.id}: clears actual terrain`);
      }
      if (second % 80 === 0) pose(events.group);
    }
    assert.equal(visited.size, 12, "followed representative points around the real route");
    assert.deepEqual([...seen].sort(), MAP_EVENTS[level].filter(event => !event.nightOnly).map(event => event.id).sort());
    events.setNight(1);
    let cometVisible = false;
    for (let i = 0; i < 120; i++) {
      tick(events, 1, course.route[0], 0);
      cometVisible ||= events.state().active.some(entry => entry.id === "comet" && entry.opacity > 0.01);
    }
    assert.ok(cometVisible, "real course also supports a visible night comet");
    assert.deepEqual(course.route.map(point => point.toArray()), routeBefore, "read-only cached route remains untouched");
    assert.deepEqual(obstacles, obstaclesBefore);
  });
}

test("integration: event clock follows frame early exits and car motion, before the driving render", async () => {
  const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
  const frame = source.match(/  function frame\(now\) \{([\s\S]*?)\n  function updateCamera\(dt\)/)?.[1];
  assert.ok(frame, "locate the active driving frame, not a different call site");
  const update = frame.indexOf("ambientEvents.update(elapsed, car.position, heading)");
  assert.ok(update >= 0);
  const exits = frame.slice(0, update);
  assert.match(exits, /if \(loading\.active \|\| \(paused && !modifier\.active\) \|\| document\.hidden \|\| contextLost\)[\s\S]*?return;/);
  assert.match(exits, /if \(!allowFrame\(now\)\) return;/);
  assert.match(exits, /if \(modifier\.active\)[\s\S]*?garagePreview\.render\(dt\);\s*return;/);
  assert.ok(update > frame.lastIndexOf("return;"), "all frame early exits precede event advancement");
  for (const motion of ["friendRacers.update(", "car.position.x = motion.x", "car.position.z = motion.z", "car.position.y = flight ?"]) {
    const at = frame.indexOf(motion);
    assert.ok(at >= 0 && at < update, `${motion}: events use the updated car position`);
  }
  assert.ok(update < frame.lastIndexOf("renderFrame();"));
  assert.equal([...source.matchAll(/ambientEvents\.update\(/g)].length, 1, "one simulation-clock owner");
  const render = source.match(/  function renderFrame\(\) \{([\s\S]*?)\n  const keys =/)?.[1];
  assert.ok(render);
  assert.doesNotMatch(render, /ambientEvents\.(?:update|reset)\(/, "paused/resize renders do not advance or restart events");
  const night = render.indexOf("ambientEvents.setNight(lightState.night)");
  assert.ok(night > render.indexOf("const lightState = daylight.update(car.position)"));
  assert.ok(night < render.indexOf("atmosphere.render("), "day changes hide night actors before rendering");
  const controller = await readFile(new URL("./ambient-events.js", import.meta.url), "utf8");
  assert.doesNotMatch(controller, /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(|\b(?:performance|Date)\.now\s*\(/,
    "controller must not own a wall clock or timer");
});

test("integration: construction, reduced motion, reset, initial/live quality and debug exposure are wired", async () => {
  const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
  assert.match(source, /import \{ createAmbientEvents \} from "\.\/ambient-events\.js"/);
  assert.match(source, /const reducedMotion = matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(source, /const ambientEvents = createAmbientEvents\(\{ scene, course, level, obstacles,\s*sites: landmarks\.sites, tablet: device\.tablet, reducedMotion \}\)/);
  const reset = source.match(/  function reset\(restore = false\) \{([\s\S]*?)\n  function saveDrive\(/)?.[1];
  assert.ok(reset);
  assert.match(reset, /ambientEvents\.reset\(\)/);
  assert.ok(reset.indexOf("ambientEvents.reset()") < reset.indexOf("renderFrame()"));
  assert.match(source, /function applyRenderQuality\(\) \{\s*const enabled = renderQuality\.performanceMode;[\s\S]*?ambientEvents\.setPerformanceMode\(enabled\);[^}]*\}\s*applyRenderQuality\(\)/);
  assert.match(source, /if \(renderQuality\.update\([^\n]+\) \{[^}]*applyRenderQuality\(\)/);
  assert.match(source, /window\.gameState = \(\) => \(\{[\s\S]*?ambientEvents: ambientEvents\.state\(\)/);
});
