import test from "node:test";
import assert from "node:assert/strict";
import { Scene } from "three";
import { ITEMS, createItemSystem } from "./item-system.js";
import { createCourse } from "./course.js";
import { createArchitecture } from "./architecture.js";
import { createAmsterdamWorld } from "./amsterdam-world.js";
import { createWellingtonWorld } from "./wellington-world.js";

const neutral = { speedFactor: 1, wobble: 0, shield: 0, turbo: 0 };
const flat = (extra = {}) => ({ route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 240 }, { x: 0, y: 0, z: -240 }],
  heightAt: () => 0, roadDistance: x => Math.abs(x), halfSize: 300, ...extra });
const target = (id = "player", x = 0, z = 0, extra = {}) => ({ id, x, y: 0, z, heading: 0, speed: 20, radius: 1.12, ...extra });
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} should be near ${b}`);
function fixture(options = {}) {
  const events = [], course = options.course ?? flat();
  return { system: createItemSystem({ course, ...options, onEvent: e => events.push(e) }), course, events };
}
function collect(system, item, extras = []) {
  assert.equal(system.state().held, null);
  const pickup = system.state().pickups.find(p => p.type === item && p.available);
  assert.ok(pickup, `an actual ${item} pickup exists`);
  const player = target("player", pickup.x, pickup.z, { y: pickup.y - 0.9 });
  system.update(0, [player, ...extras]);
  system.update(0.001, [player, ...extras]);
  assert.equal(system.state().held, item);
  return pickup;
}
function launch(system, item, player = target(), extras = []) {
  collect(system, item);
  system.update(0, [player, ...extras]);
  assert.equal(system.deploy(), true);
  return system.state().entities.at(-1);
}
function advance(system, seconds, targets = []) {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) system.update(seconds / frames, targets);
}
function clearance(o, p) {
  const heading = o.heading ?? 0, c = Math.cos(heading), s = Math.sin(heading);
  const x = c * (p.x - o.x) - s * (p.z - o.z), z = s * (p.x - o.x) + c * (p.z - o.z);
  return o.hx === undefined ? Math.hypot(x, z) - o.r
    : Math.hypot(Math.max(0, Math.abs(x) - o.hx), Math.max(0, Math.abs(z) - o.hz));
}
function verifyPlacement(course, pickups, obstacles = [], ramps = []) {
  assert.equal(pickups.length, 60);
  assert.equal(new Set(pickups.map(p => p.id)).size, 60);
  assert.deepEqual(new Set(pickups.map(p => p.type)), new Set(ITEMS.map(i => i.id)));
  assert.ok(pickups.filter(p => course.roadDistance(p.x, p.z) >= 11).length >= 20);
  assert.ok(pickups.filter(p => course.roadDistance(p.x, p.z) > 35).length >= 1);
  const first = pickups[0], start = course.route[0], ahead = course.route[1];
  assert.ok(Math.hypot(first.x - start.x, first.z - start.z) >= 8);
  assert.ok(Math.hypot(first.x - start.x, first.z - start.z) <= 14);
  assert.ok((first.x - start.x) * (ahead.x - start.x) + (first.z - start.z) * (ahead.z - start.z) > 0);
  assert.ok(course.roadDistance(first.x, first.z) < 5);
  for (const p of pickups) {
    assert.ok(p.available); assert.equal(p.respawn, 0);
    close(p.y, course.heightAt(p.x, p.z) + 0.9);
    assert.ok(Math.abs(p.x) <= course.halfSize - 2.8 && Math.abs(p.z) <= course.halfSize - 2.8);
    if (course.isSafePosition) assert.ok(course.isSafePosition(p.x, p.z, 2.8));
    for (const o of obstacles) assert.ok(clearance(o, p) >= 2.8 - 1e-8, `${o.name ?? "obstacle"} clearance at pickup ${p.id}`);
    for (const r of ramps) {
      const along = (p.x - r.x) * Math.sin(r.heading) + (p.z - r.z) * Math.cos(r.heading);
      const across = (p.x - r.x) * Math.cos(r.heading) - (p.z - r.z) * Math.sin(r.heading);
      assert.ok(Math.hypot(Math.max(0, Math.abs(across) - r.width / 2), Math.max(0, -along, along - r.length)) >= 2.8);
    }
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      assert.ok(Math.abs(course.heightAt(p.x + Math.cos(a) * 2.8, p.z + Math.sin(a) * 2.8) - p.y + 0.9) <= 1.4 + 1e-7);
    }
  }
}
function dispose(scene) {
  const geometries = new Set(), materials = new Set();
  scene.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const m of [o.material].flat()) materials.add(m); });
  geometries.forEach(g => g.dispose()); materials.forEach(m => { m.map?.dispose(); m.dispose(); });
}

test("the public catalog and API are plain, kid-friendly data", () => {
  assert.deepEqual(ITEMS.map(i => [i.id, i.name, i.action]), [
    ["banana", "Banana Peel", "Drop"], ["oil", "Silly Oil", "Drop"], ["mine", "Confetti Mine", "Drop"],
    ["rocket", "Foam Rocket", "Fire"], ["homing", "Buddy Rocket", "Fire"], ["ball", "Bouncy Ball", "Throw"],
    ["balloon", "Water Balloon", "Throw"], ["shield", "Bubble Shield", "Use"], ["star", "Turbo Star", "Use"], ["lightning", "Lightning", "Zap"],
  ]);
  for (const item of ITEMS) {
    assert.deepEqual(Object.keys(item), ["id", "name", "action", "description", "color"]);
    assert.match(item.color, /^#[0-9a-f]{6}$/i);
    assert.ok(item.description.length > 15 && item.description.length < 100);
    assert.doesNotMatch(item.description, /damage|health|kill|eliminat|explosive/i);
  }
  const { system } = fixture();
  assert.deepEqual(Object.keys(system), ["update", "deploy", "modifiers", "state", "reset"]);
  assert.deepEqual(system.modifiers("unknown"), neutral);
  assert.deepEqual(Object.keys(system.state()), ["held", "pickups", "entities", "effects", "statuses"]);
  assert.equal(system.state().held, null); assert.equal(system.deploy(), false);
});

for (const level of ["forest", "city", "stunt", "moon", "amsterdam", "wellington"]) {
  test(`${level}: deterministic placement includes all ten types, remote exploration and a start pickup`, () => {
    const course = createCourse(level);
    const ramps = ["stunt", "moon"].includes(level) ? [
      { x: -280 / 3, z: 140, heading: Math.PI / 2, width: 9.5, length: 18, height: 3 },
      { x: 280 / 3, z: -140, heading: -Math.PI / 2, width: 9.5, length: 18, height: 3 },
    ] : [];
    const system = createItemSystem({ course, ramps });
    const initial = system.state();
    verifyPlacement(course, initial.pickups, [], ramps);
    assert.deepEqual(createItemSystem({ course, ramps }).state(), initial);
    const common = initial.pickups.filter(p => ["banana", "oil", "rocket", "ball", "balloon"].includes(p.type)).length;
    const rare = initial.pickups.filter(p => ["star", "lightning"].includes(p.type)).length;
    assert.ok(common > rare * 2);
    system.update(1 / 60, [target("player", course.route[0].x, course.route[0].z, { y: course.route[0].y })]);
    assert.equal(system.state().held, null, "the start does not auto-equip an item");
  });
}

for (const level of ["city", "amsterdam", "wellington"]) {
  test(`${level}: placement clears the real detailed scenery with bounded terrain queries`, () => {
    const base = createCourse(level), scene = new Scene(), obstacles = [];
    if (level === "city") createArchitecture({ scene, level, terrain: base, obstacles, tablet: true });
    if (level === "amsterdam") createAmsterdamWorld({ scene, terrain: base, obstacles, tablet: true });
    if (level === "wellington") createWellingtonWorld({ scene, course: base, obstacles, tablet: true });
    try {
      let heights = 0, roads = 0, safety = 0;
      const course = { ...base, heightAt(x, z) { heights++; return base.heightAt(x, z); },
        roadDistance(x, z) { roads++; return base.roadDistance(x, z); },
        isSafePosition(x, z, r) { safety++; return !base.isSafePosition || base.isSafePosition(x, z, r); } };
      const system = createItemSystem({ course, obstacles });
      assert.ok(heights < 6000 && roads < 4800 && safety < 4800, `${heights} height / ${roads} road / ${safety} safety calls`);
      verifyPlacement(base, system.state().pickups, obstacles);
      const counts = [heights, roads, safety];
      system.update(1000, []); system.reset();
      assert.deepEqual([heights, roads, safety], counts, "idle updates and resets never rerun placement");
    } finally { dispose(scene); }
  });
}

test("placement rejects water, steep slopes, circles, thin rectangles and rotated ramps", () => {
  const course = flat({ isSafePosition: (x, z, r) => z + r < 100,
    heightAt: (x, z) => x > 90 ? (x - 90) * 2 : z < -100 ? (-100 - z) * 2 : 0 });
  const obstacles = [{ x: 30, z: 30, r: 18 }, { x: 0, z: -70, hx: 600, hz: 0.2 }, { x: -45, z: 40, hx: 5, hz: 25, heading: 0.7 }];
  const ramps = [{ x: 0, z: 35, width: 12, length: 24, height: 4, heading: 0.4 }];
  const { system } = fixture({ course, obstacles, ramps });
  verifyPlacement(course, system.state().pickups, obstacles, ramps);
  assert.ok(system.state().pickups.every(p => p.x < 90 && p.z > -100));
});

test("impossible placement stops searching and never falls back into unsafe terrain", () => {
  let calls = 0;
  const system = createItemSystem({ course: flat({ isSafePosition: () => { calls++; return false; } }) });
  assert.deepEqual(system.state().pickups, []);
  assert.ok(calls <= 4900);
  assert.equal(createItemSystem({ course: flat(), pickupCount: 0 }).state().pickups.length, 0);
  assert.equal(createItemSystem({ course: flat(), pickupCount: 5 }).state().pickups.length, 5);
  assert.equal(createItemSystem({ course: flat(), pickupCount: 10 }).state().pickups.length, 10);
  assert.throws(() => createItemSystem({ course: {} }), TypeError);
});

test("only the player collects, holds one item and deploys once using the latest copied snapshot", () => {
  const { system, events } = fixture();
  const first = system.state().pickups[0];
  system.update(0.1, [target("friend", first.x, first.z)]);
  assert.equal(system.state().held, null);
  assert.equal(system.deploy("friend"), false);
  collect(system, "banana");
  const second = system.state().pickups.find(p => p.type === "oil");
  system.update(0.1, [target("player", second.x, second.z)]);
  assert.equal(system.state().held, "banana");
  assert.equal(system.state().pickups.find(p => p.id === second.id).available, true);
  assert.equal(system.deploy("friend"), false);
  const player = target("player", 50, 50, { heading: Math.PI / 2 });
  system.update(0, [player]);
  player.x = -100; player.heading = 0;
  assert.equal(system.deploy(), true); assert.equal(system.deploy(), false);
  const e = system.state().entities[0];
  close(e.x, 50 - 3.42); close(e.z, 50); close(e.heading, Math.PI / 2);
  assert.equal(e.kind, "hazard"); assert.equal(e.ownerId, "player");
  assert.deepEqual(events.map(e => e.type), ["collect", "deploy"]);
  for (const e of events) { assert.equal(e.target, "player"); assert.ok(e.message.length > 0); }
});

test("a missing owner cannot consume inventory, and dropping into scenery makes only a harmless burst", () => {
  const { system, events } = fixture({ obstacles: [{ x: 0, z: -3.42, r: 1 }] });
  collect(system, "banana");
  system.update(0.1, []);
  assert.equal(system.deploy(), false); assert.equal(system.state().held, "banana");
  system.update(0, [target()]); assert.equal(system.deploy(), true);
  assert.equal(system.state().held, null); assert.deepEqual(system.state().entities, []);
  assert.equal(system.state().effects[0].type, "burst");
  assert.equal(events.filter(e => e.type === "deploy").length, 1);
});

test("deploy messages use natural kid-friendly wording for every item", () => {
  const messages = {
    banana: "Banana Peel dropped!", oil: "Silly Oil dropped!", mine: "Confetti Mine dropped!",
    rocket: "Foam Rocket away!", homing: "Buddy Rocket away!", ball: "Bouncy Ball tossed!",
    balloon: "Water Balloon tossed!", shield: "Bubble Shield activated!", star: "Turbo Star activated!",
    lightning: "Lightning! Every other racer slows for 4 seconds.",
  };
  for (const item of ITEMS) {
    const { system, events } = fixture();
    launch(system, item.id);
    assert.deepEqual(events.filter(e => e.type === "deploy"), [
      { type: "deploy", item: item.id, target: "player", message: messages[item.id] },
    ]);
  }
});

test("pickup sweeps catch fast passes in either direction, but not vertical or teleport passes", () => {
  for (const direction of [-1, 1]) {
    const { system } = fixture({ pickupCount: 1 });
    const p = system.state().pickups[0];
    system.update(0, [target("player", p.x, p.z - direction * 15)]);
    system.update(0.1, [target("player", p.x, p.z + direction * 15)]);
    assert.equal(system.state().held, p.type);
  }
  for (const [distance, y] of [[15, 8], [60, 0]]) {
    const { system } = fixture({ pickupCount: 1 });
    const p = system.state().pickups[0];
    system.update(0, [target("player", p.x, p.z - distance, { y })]);
    system.update(0.1, [target("player", p.x, p.z + distance, { y })]);
    assert.equal(system.state().held, null);
  }
});

test("collection chooses the first swept pickup, not its array order", () => {
  const { system } = fixture();
  const road = system.state().pickups.filter(p => Math.abs(p.x) < 3).sort((a, b) => a.z - b.z);
  const pair = road.slice(1).map((p, i) => [road[i], p]).find(([a, b]) => b.z - a.z > 7 && b.z - a.z < 35 && a.id < b.id);
  assert.ok(pair);
  const [a, b] = pair;
  system.update(0, [target("player", b.x, b.z + 4)]);
  system.update(0.1, [target("player", a.x, a.z - 4)]);
  assert.equal(system.state().held, b.type);
  assert.equal(system.state().pickups.find(p => p.id === b.id).available, false);
  assert.equal(system.state().pickups.find(p => p.id === a.id).available, true);
});

test("pickups respawn after 18 simulation seconds, retain IDs/types and can be collected again", () => {
  const { system } = fixture();
  const p = collect(system, "banana");
  system.update(0, [target()]); system.deploy();
  system.update(17.9, []);
  let current = system.state().pickups.find(q => q.id === p.id);
  assert.equal(current.available, false); close(current.respawn, 0.099);
  system.update(0.11, []);
  current = system.state().pickups.find(q => q.id === p.id);
  assert.equal(current.available, true); assert.equal(current.respawn, 0); assert.equal(current.type, p.type);
  collect(system, "banana");
});

test("pickup cooldown only permits the part of a sweep after respawning, and ages after collection", () => {
  const { system } = fixture({ pickupCount: 1 });
  const p = collect(system, "banana");
  system.update(0, [target("player", 100, 100)]); system.deploy();
  system.update(0, [target("player", p.x, p.z - 5)]);
  system.update(20, [target("player", p.x, p.z + 50)]);
  assert.equal(system.state().held, null, "passing early in a long frame does not collect an unavailable pickup");
  assert.equal(system.state().pickups[0].available, true);
  system.reset();
  system.update(0, [target("player", p.x, p.z)]);
  system.update(10, [target("player", p.x, p.z)]);
  assert.equal(system.state().held, "banana"); close(system.state().pickups[0].respawn, 8);
});

for (const item of ["banana", "oil", "mine"]) {
  test(`${item}: dropped behind, arms gently, sweeps racers and has no airborne/teleport hits`, () => {
    const { system, events } = fixture();
    const e = launch(system, item);
    assert.ok(e.z < 0); assert.equal(e.kind, "hazard");
    system.update(0.1, [target("friend", e.x, e.z)]);
    assert.deepEqual(system.modifiers("friend"), neutral);
    system.update(0.3, []);
    system.update(0, [target("friend", e.x - 20, e.z, { y: 10 })]);
    system.update(0.1, [target("friend", e.x + 20, e.z, { y: 10 })]);
    assert.deepEqual(system.modifiers("friend"), neutral);
    system.update(0, [target("friend", e.x - 60, e.z)]);
    system.update(0.1, [target("friend", e.x + 60, e.z)]);
    assert.deepEqual(system.modifiers("friend"), neutral);
    system.update(0, [target("friend", e.x - 20, e.z)]);
    system.update(0.1, [target("friend", e.x + 20, e.z)]);
    assert.ok(system.modifiers("friend").speedFactor < 1);
    assert.ok(system.modifiers("friend").wobble > 0);
    assert.ok(events.some(e => e.type === "hit" && e.item === item && e.target === "friend"));
    system.update(30, []);
    assert.deepEqual(system.modifiers("friend"), neutral);
    assert.deepEqual(system.state().entities, []); assert.deepEqual(system.state().statuses, []);
  });
}

test("owner arming grace lasts 1.5s, then the player's own trap can cause a temporary slip", () => {
  const { system } = fixture();
  const e = launch(system, "banana");
  const owner = target("player", e.x, e.z);
  system.update(0, [owner]); system.update(1.4, [owner]);
  assert.deepEqual(system.modifiers("player"), neutral);
  system.update(0.2, [owner]);
  assert.ok(system.modifiers("player").speedFactor < 1);
});

test("oil gives a 1.5s grace window instead of reapplying every frame", () => {
  const { system, events } = fixture();
  const e = launch(system, "oil"), racer = target("friend", e.x, e.z);
  system.update(0.4, []); system.update(0.01, [racer]);
  const initial = system.modifiers("friend");
  advance(system, 1.3, [racer]);
  assert.equal(events.filter(e => e.type === "hit").length, 1);
  close(system.modifiers("friend").wobble, 0);
  assert.ok(system.state().statuses[0].slow < initial.wobble + 0.4);
  advance(system, 0.3, [racer]);
  assert.equal(events.filter(e => e.type === "hit").length, 2);
});

test("confetti has a nine-metre area, using target positions at the swept trigger time", () => {
  const { system } = fixture();
  const e = launch(system, "mine");
  system.update(0.4, []);
  const racers = [target("trigger", e.x, e.z), target("near", e.x + 8.5, e.z), target("far", e.x + 12, e.z),
    target("bridge", e.x + 2, e.z, { y: 12 }), target("player", e.x, e.z)];
  system.update(0.01, racers);
  assert.ok(system.modifiers("trigger").speedFactor < 1); assert.ok(system.modifiers("near").speedFactor < 1);
  for (const id of ["far", "bridge", "player"]) assert.deepEqual(system.modifiers(id), neutral);
  assert.equal(system.state().entities.length, 0);
  assert.ok(system.state().effects.some(e => e.type === "burst" && e.item === "mine" && e.radius === 9));
});

test("a confetti sweep splashes crossing bystanders at impact, not at their final positions", () => {
  const { system } = fixture();
  const e = launch(system, "mine");
  system.update(0.4, []);
  system.update(0, [target("trigger", e.x - 20, e.z), target("passing", e.x - 30, e.z + 8)]);
  system.update(1 / 60, [target("trigger", e.x + 20, e.z), target("passing", e.x + 30, e.z + 8)]);
  assert.ok(system.modifiers("trigger").speedFactor < 1);
  assert.ok(system.modifiers("passing").speedFactor < 1);
});

for (const item of ["shield", "star"]) {
  test(`${item}: clears slips, protects the player and expires using update time only`, () => {
    const { system, events } = fixture();
    const trap = launch(system, "oil");
    const atTrap = target("player", trap.x, trap.z);
    system.update(1.6, []); system.update(0.01, [atTrap]);
    assert.ok(system.modifiers("player").speedFactor < 1);
    collect(system, item);
    assert.equal(system.deploy(), true);
    const duration = item === "star" ? 5 : 6;
    assert.deepEqual(system.modifiers("player"), { ...neutral, [item === "star" ? "turbo" : "shield"]: duration });
    system.update(1.51, []);
    system.update(0, [atTrap]); system.update(0.01, [atTrap]);
    assert.equal(system.modifiers("player").speedFactor, 1);
    assert.ok(events.some(e => e.type === "blocked" && e.item === "oil" && e.target === "player"));
    const before = system.modifiers("player");
    system.update(0, [atTrap]); system.update(-1, [atTrap]); system.update(Infinity, [atTrap]); system.update(NaN, [atTrap]);
    assert.deepEqual(system.modifiers("player"), before);
    system.update(duration, []);
    assert.deepEqual(system.modifiers("player"), neutral);
  });
}

test("lightning slows ALL other targets at arbitrary distance/height, excludes the owner and lasts four seconds", () => {
  const { system, events } = fixture();
  const racers = [target("near", 1, 1), target("far", 100000, -100000), target("flying", 5, 5, { y: 200 }), target(42, -900, 800)];
  launch(system, "lightning", target(), racers);
  assert.deepEqual(system.modifiers("player"), neutral);
  for (const r of racers) assert.deepEqual(system.modifiers(r.id), { speedFactor: 0.6, wobble: 0.6, shield: 0, turbo: 0 });
  assert.equal(events.filter(e => e.type === "hit").length, racers.length);
  assert.equal(system.state().effects.filter(e => e.type === "lightning").length, racers.length + 1);
  system.update(3.9, []);
  for (const r of racers) assert.equal(system.modifiers(r.id).speedFactor, 0.6);
  system.update(0.11, []);
  for (const r of racers) assert.deepEqual(system.modifiers(r.id), neutral);
});

test("foam rockets travel forward and sweep moving targets without touching snapshots", () => {
  const { system } = fixture();
  const e = launch(system, "rocket", target("player", 0, 0, { heading: Math.PI / 2 }));
  system.update(0.3, []);
  const moved = system.state().entities[0];
  close(e.speed, 56);
  close(moved.x, e.x + e.speed * 0.3); close(moved.z, 0);
  const before = Object.freeze(target("friend", moved.x + e.speed * 0.05, -15));
  const after = Object.freeze(target("friend", moved.x + e.speed * 0.05, 15));
  system.update(0, Object.freeze([before]));
  system.update(0.1, Object.freeze([after]));
  assert.ok(system.modifiers("friend").speedFactor < 1);
  assert.equal(after.z, 15); assert.equal(system.state().entities.length, 0);
});

for (const item of ["rocket", "homing"]) for (const speed of [64, 120]) for (const fps of [20, 60]) {
  test(`${item}: a ${speed} m/s owner catches a moving faster rival at ${fps} FPS`, () => {
    const { system, events } = fixture({ course: flat({ halfSize: 1500 }) });
    const heading = speed === 64 ? Math.PI / 2 : 0, dx = Math.sin(heading), dz = Math.cos(heading);
    const lane = item === "homing" ? 8 : 0, rivalSpeed = speed + 8;
    const playerAt = t => target("player", dx * speed * t, dz * speed * t, { heading, speed });
    const rivalAt = t => target("rival", dx * (70 + rivalSpeed * t) + dz * lane,
      dz * (70 + rivalSpeed * t) - dx * lane, { heading, speed: rivalSpeed });
    const e = launch(system, item, playerAt(0), [rivalAt(0)]);
    assert.equal(e.speed, speed + (item === "rocket" ? 36 : 30));
    let hitTime = null;
    for (let frame = 1; frame <= 4 * fps; frame++) {
      const time = frame / fps, player = playerAt(time);
      system.update(1 / fps, [player, rivalAt(time)]);
      assert.deepEqual(system.modifiers("player"), neutral, "the owner never catches their own rocket");
      const flying = system.state().entities.find(p => p.id === e.id);
      if (flying) {
        assert.ok((flying.x - player.x) * dx + (flying.z - player.z) * dz > player.radius,
          "the rocket stays ahead throughout the chase, including after owner grace");
        if (item === "homing") assert.equal(flying.targetId, "rival");
      }
      if (system.modifiers("rival").speedFactor < 1) { hitTime = time; break; }
    }
    assert.ok(hitTime > 1.5 && hitTime < 4, `expected a chase hit after owner grace, got ${hitTime}`);
    assert.deepEqual(events.filter(e => e.type === "hit").map(e => [e.item, e.target]), [[item, "rival"]]);
    assert.equal(system.state().entities.some(p => p.id === e.id), false);
  });
}

test("rockets inherit only forward speed, once at launch, and keep their base speed when reversing", () => {
  for (const item of ["rocket", "homing"]) for (const speed of [0, -9, undefined, NaN, Infinity, 120]) {
    const { system } = fixture();
    const e = launch(system, item, target("player", 0, 0, { speed }));
    const expected = (item === "rocket" ? 36 : 30) + (speed === 120 ? 120 : 0);
    assert.equal(e.speed, expected);
    system.update(0.2, [target("player", 0, 0, { speed: 200 })]);
    const flying = system.state().entities[0];
    assert.equal(flying.speed, expected, "later owner acceleration does not accelerate an in-flight rocket");
    close(flying.z, e.z + expected * 0.2);
  }
});

test("boost-speed rockets still hit thin scenery before racers behind it", () => {
  for (const item of ["rocket", "homing"]) {
    const { system, events } = fixture({ obstacles: [{ x: 0, z: 35, hx: 10, hz: 0.05, height: 10 }] });
    const rival = target("behind-wall", 0, 45);
    launch(system, item, target("player", 0, 0, { speed: 120 }), [rival]);
    system.update(0.4, [rival]);
    assert.equal(system.state().entities.length, 0);
    assert.deepEqual(system.modifiers(rival.id), neutral);
    assert.equal(events.some(e => e.type === "hit"), false);
    assert.ok(system.state().effects.some(e => e.type === "burst" && e.item === item && e.z < 35));
  }
});

test("projectiles respect vertical separation and do not sweep teleported racers", () => {
  for (const extra of [{ y: 10, distance: 15 }, { y: 0, distance: 60 }]) {
    const { system } = fixture();
    const e = launch(system, "rocket");
    system.update(0, [target("friend", -extra.distance, e.z + 1.8, { y: extra.y })]);
    system.update(0.1, [target("friend", extra.distance, e.z + 1.8, { y: extra.y })]);
    assert.deepEqual(system.modifiers("friend"), neutral);
    assert.equal(system.state().entities.length, 1);
  }
});

test("Buddy Rocket gently picks a nearby target ahead, never one behind or far overhead", () => {
  const { system } = fixture();
  const racers = [target("behind", 0, -3), target("overhead", 0, 10, { y: 30 }), target("ahead", 9, 40), target("farther", 5, 80)];
  launch(system, "homing", target(), racers);
  system.update(0.1, racers);
  const e = system.state().entities[0];
  assert.equal(e.targetId, "ahead"); assert.ok(e.heading > 0 && e.heading <= 0.13 + 1e-8);
  advance(system, 2, racers);
  assert.ok(system.modifiers("ahead").speedFactor < 1);
  assert.deepEqual(system.modifiers("behind"), neutral);
  assert.deepEqual(system.modifiers("overhead"), neutral);
  const lone = fixture().system;
  launch(lone, "homing"); lone.update(0.2, [target("behind", 1, -10)]);
  assert.equal(lone.state().entities[0].targetId, null); close(lone.state().entities[0].heading, 0);
});

test("water balloons fly an arc, splash at the ground, and affect a seven-metre area", () => {
  const { system } = fixture();
  const e = launch(system, "balloon");
  const racers = [target("near", 6, e.z + 23), target("far", 10, e.z + 23), target("bridge", 0, e.z + 23, { y: 10 })];
  system.update(0.4, racers);
  assert.ok(system.state().entities[0].y > e.y + 2);
  system.update(0.8, racers);
  assert.equal(system.state().entities.length, 0);
  assert.ok(system.modifiers("near").speedFactor < 1);
  assert.deepEqual(system.modifiers("far"), neutral); assert.deepEqual(system.modifiers("bridge"), neutral);
  const splash = system.state().effects.find(e => e.item === "balloon");
  assert.equal(splash.radius, 7); assert.equal(splash.type, "burst"); assert.ok(splash.y < 1);
});

test("boosting leaves ball and balloon trajectories unchanged instead of creating long-range splashes", () => {
  for (const item of ["ball", "balloon"]) {
    const slow = fixture().system, fast = fixture().system;
    for (const [system, speed] of [[slow, 0], [fast, 120]]) {
      const e = launch(system, item, target("player", 0, 0, { speed }));
      assert.equal(e.speed, item === "ball" ? 25 : 20);
      system.update(0.4, []);
      assert.ok(system.state().entities[0].y > e.y, "the throw still follows an upward arc");
    }
    assert.deepEqual(fast.state(), slow.state());
    slow.update(0.8, []); fast.update(0.8, []);
    assert.deepEqual(fast.state(), slow.state());
    if (item === "balloon") {
      const splash = fast.state().effects.find(e => e.item === item);
      assert.ok(splash.z > 20 && splash.z < 30); assert.equal(splash.radius, 7);
    }
  }
});

test("thrown balls and balloons also react to direct racer contact", () => {
  for (const item of ["ball", "balloon"]) {
    const { system } = fixture();
    launch(system, item);
    system.update(0.2, [target("direct", 0, 6), target("beside", 6, 6)]);
    assert.ok(system.modifiers("direct").speedFactor < 1);
    assert.equal(system.state().entities.length, 0);
    if (item === "balloon") assert.ok(system.modifiers("beside").speedFactor < 1);
    else assert.deepEqual(system.modifiers("beside"), neutral);
  }
});

for (const shape of [{ x: 0, z: 15, hx: 20, hz: 0.1, height: 20 }, { x: 0, z: 15, r: 2, height: 20 }]) {
  test(`${shape.r ? "round" : "thin rectangular"} scenery stops rockets and rebounds balls`, () => {
    const obstacles = [shape];
    const { system } = fixture({ obstacles });
    launch(system, "rocket");
    system.update(0.6, [target("behind-wall", 0, 20)]);
    assert.equal(system.state().entities.length, 0);
    assert.deepEqual(system.modifiers("behind-wall"), neutral);
    launch(system, "ball");
    system.update(0.6, []);
    const ball = system.state().entities[0];
    assert.ok(ball.bounces > 0); assert.ok(Math.cos(ball.heading) < 0); assert.ok(ball.z < shape.z);
    assert.equal(ball.kind, "projectile");
  });
}

test("scenery collision includes the muzzle, respects obstacle height, ramps and dry-land boundaries", () => {
  const wall = { x: 0, z: 1.7, hx: 10, hz: 0.1, height: 10 };
  const { system } = fixture({ obstacles: [wall] });
  launch(system, "rocket");
  assert.equal(system.state().entities.length, 0);
  const overhead = fixture({ obstacles: [{ ...wall, y: 10 }] }).system;
  launch(overhead, "rocket"); assert.equal(overhead.state().entities.length, 1);
  const ramp = fixture({ ramps: [{ x: 0, z: 12, heading: 0, width: 10, length: 18, height: 3 }] }).system;
  launch(ramp, "rocket"); ramp.update(0.5, []); assert.equal(ramp.state().entities.length, 0);
  const shore = fixture({ course: flat({ isSafePosition: (x, z, r) => z + r < 15 }) }).system;
  launch(shore, "ball"); shore.update(0.6, []);
  assert.ok(shore.state().entities[0].z < 15); assert.ok(shore.state().entities[0].bounces > 0);
});

test("balls bounce on terrain and are temporary, while projectiles cannot live forever", () => {
  for (const item of ["ball", "rocket", "homing", "balloon"]) {
    const { system } = fixture();
    launch(system, item);
    system.update(1, []);
    if (item === "ball") assert.ok(system.state().entities[0].bounces > 0);
    system.update(1000, []);
    assert.deepEqual(system.state().entities, []); assert.deepEqual(system.state().effects, []);
  }
});

test("effect/active entity caps stay modest even with many racers and rapid deployments", () => {
  const { system } = fixture({ pickupCount: 300 });
  for (let i = 0; i < 40; i++) {
    const pickup = system.state().pickups.find(p => p.available && ["banana", "oil", "mine", "ball", "rocket", "homing"].includes(p.type));
    assert.ok(pickup);
    launch(system, pickup.type, target("player", 80 + i, 100));
  }
  assert.equal(system.state().entities.length, 32);
  const racers = Array.from({ length: 100 }, (_, i) => target(`racer-${i}`, 1000 * i, 10000));
  launch(system, "lightning", target(), racers);
  assert.ok(system.state().effects.length <= 48);
  for (const e of system.state().effects) {
    assert.ok(e.life > 0 && e.life <= 1.2 && e.age >= 0);
    assert.equal(e.color, ITEMS.find(item => item.id === e.item).color);
  }
  assert.equal(racers.filter(r => system.modifiers(r.id).speedFactor < 1).length, 100);
  system.update(1000, []);
  assert.deepEqual(system.state().effects, []); assert.deepEqual(system.state().entities, []); assert.deepEqual(system.state().statuses, []);
});

test("state is detached, modifiers always return full defaults, and reset restores pickups and sweep history", () => {
  const { system } = fixture();
  const initial = system.state();
  launch(system, "star"); launch(system, "oil");
  const copy = system.state();
  copy.pickups[0].x = 9999; copy.entities[0].x = 9999; copy.effects[0].life = 9999; copy.statuses[0].turbo = 9999;
  assert.notEqual(system.state().pickups[0].x, 9999);
  assert.notEqual(system.state().entities[0].x, 9999);
  assert.ok(system.state().effects.every(e => e.life <= 1.2)); assert.ok(system.modifiers("player").turbo <= 5);
  const unknown = system.modifiers("unknown"); unknown.shield = 999;
  assert.deepEqual(system.modifiers("unknown"), neutral);
  const p = initial.pickups[0];
  system.update(0, [target("player", p.x, p.z - 10)]);
  system.reset(); assert.deepEqual(system.state(), initial); assert.equal(system.deploy(), false);
  system.update(0.1, [target("player", p.x, p.z + 10)]);
  assert.equal(system.state().held, null, "reset must not collect along the pre-reset path");
  assert.deepEqual(system.modifiers("player"), neutral);
});

test("identical driving scripts are deterministic and large dt still advances all timers", () => {
  const a = fixture(), b = fixture();
  for (const { system } of [a, b]) {
    launch(system, "banana"); system.update(1.6, []);
    const e = system.state().entities[0];
    system.update(0.2, [target("racer", e.x, e.z)]);
    launch(system, "star"); system.update(0.37, []);
    launch(system, "ball"); system.update(0.61, []);
  }
  assert.deepEqual(a.system.state(), b.system.state()); assert.deepEqual(a.events, b.events);
  a.system.update(30, []); advance(b.system, 30, []);
  assert.deepEqual(a.system.state(), b.system.state());
});
