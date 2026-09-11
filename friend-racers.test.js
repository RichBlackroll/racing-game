import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { friends } from "./friends.js";
import { PARTS } from "./modifier-data.js";
import { createCourse } from "./course.js";
import { createRampCourse } from "./levels.js";
import { createFriendRacers, FRIEND_RACERS } from "./friend-racers.js";
import { computeTuning } from "./modifier-data.js";

function fixture(level = "forest", obstacles = [], course = createCourse(level)) {
  const scene = new THREE.Scene(), labels = [], notices = [];
  const ramps = ["stunt", "moon"].includes(level) ? createRampCourse(new THREE.Scene(), course.route, level === "moon") : [];
  const previous = globalThis.document;
  globalThis.document = { createElement(tag) {
    assert.equal(tag, "canvas");
    return { getContext: () => ({ fillRect() {}, fillText(text) { labels.push(text); } }) };
  } };
  try {
    const field = createFriendRacers({ scene, course, ramps, obstacles, gravity: level === "moon" ? 3.2 : 9.82, onRace: text => notices.push(text) });
    return { field, scene, course, labels, notices };
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}
const absent = new THREE.Vector3(1e5, 0, 1e5);

test("all five existing friends have distinct valid builds, visible parts, and two readable roof faces", () => {
  const { field, scene, labels } = fixture();
  assert.deepEqual(FRIEND_RACERS.map(r => r.name), friends.map(f => f.name));
  assert.deepEqual(Object.fromEntries(FRIEND_RACERS.map(r => [r.name, r.country])), {
    Camilla: "pt", Maxey: "ca", Vincent: "be", Lea: "fr", Loulou: "fr",
  });
  assert.deepEqual(labels, friends.map(f => f.name));
  const states = field.state();
  assert.equal(new Set(states.map(s => JSON.stringify(s.config))).size, 5);
  assert.equal(new Set(states.map(s => s.visuals.paint)).size, 5);
  for (const s of states) {
    for (const part of PARTS) assert.ok(part.options.some(o => o.id === s.config[part.id]));
    assert.equal(s.visuals.wheels.count, 4);
    assert.equal(s.visuals.engine.id, s.config.engine);
    const boosterCount = { none: 0, small: 2, big: 1 }[s.config.rocket];
    assert.deepEqual(s.visuals.rocket, { visible: boosterCount > 0, count: boosterCount,
      scale: s.config.rocket === "big" ? [1.8, 1.8, 1.8] : [1, 1, 1] });
    const car = scene.getObjectByName(`racer-${s.name}`);
    const rocket = car.getObjectByName("car-boosters"), flame = car.getObjectByName("boost-flames");
    assert.equal(flame.parent, rocket);
    assert.equal(flame.visible, false, "constructing a configured friend never starts boost");
    assert.equal(flame.children.length, 3);
    const activeBoosters = rocket.children.filter(node => node !== flame && node.visible);
    assert.deepEqual(activeBoosters.map(node => node.name), s.config.rocket === "small"
      ? ["booster-side-left", "booster-side-right"] : s.config.rocket === "big" ? ["booster-rear"] : []);
    assert.ok(activeBoosters.every(group => !group.children.some(node => node.isMesh)), "configured hardware is frozen into material batches");
    for (const plume of flame.children) {
      assert.equal(plume.children.length, 2, "batching retains every independently animated flame and core");
      assert.ok(plume.children.every(mesh => mesh.isMesh && mesh.name === "booster-plume"));
    }
    const flag = car.getObjectByName("car-flag");
    assert.equal(flag.parent, car, "animated flags are not baked into the static material batches");
    assert.equal(flag.userData.country, friends.find(f => f.name === s.name).country);
    assert.ok(Math.abs(flag.position.y - .72 - s.visuals.height.bodyLift) < 1e-6, "rear bumper mount follows suspension lift");
    assert.equal(flag.position.z, -3.35, "mast stays behind the rearmost wing edge");
    assert.ok(flag.position.x > .7, "corner mount clears the central booster");
    assert.ok(new THREE.Box3().setFromObject(flag.getObjectByName("flag-mount")).max.z > -2.25, "bracket reaches into the rear bumper");
    const sign = car.getObjectByName("taxi-name-sign");
    assert.equal(sign.parent, car, "physical sign is attached to the car, not a floating billboard");
    assert.ok(sign.position.y >= 1.49 + s.visuals.height.bodyLift - 1e-6);
    const front = sign.getObjectByName("name-front"), rear = sign.getObjectByName("name-rear");
    assert.equal(front.material.map, rear.material.map);
    assert.equal(front.material.side, THREE.FrontSide);
    assert.equal(front.rotation.y, 0);
    assert.equal(rear.rotation.y, Math.PI, "rear text is not mirrored");
    assert.ok(front.position.z > 0 && rear.position.z < 0);
    assert.ok(sign.position.y + rear.position.y - .27 > (s.visuals.spoiler.topY ?? 0), "even the mega wing cannot hide the name");
    const badge = car.getObjectByName("friend-name-badge");
    assert.ok(badge.isSprite, "the distant name always faces the camera");
    assert.equal(badge.material.map, front.material.map, "reuse the name texture without extra canvas work");
    assert.ok(badge.position.y > front.position.y + .29, "badge clears the physical roof sign");
    let calls = 0, triangles = 0;
    car.updateMatrixWorld(true);
    car.traverseVisible(node => {
      assert.ok(node.matrixWorld.elements.every(Number.isFinite));
      if (node.isSprite) { calls++; triangles += 2; return; }
      if (!node.isMesh) return;
      assert.ok(node.geometry, "every material batch merged successfully");
      assert.equal(node.castShadow, false, "moving cars never enter the static sun shadow");
      calls++;
      triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    });
    assert.ok(calls <= 40, `${s.name}: ${calls} draw calls`);
    assert.ok(triangles < 16000, `${s.name}: ${triangles} triangles`);
    flame.visible = true;
    let boostedCalls = 0, visiblePlumes = 0;
    car.traverseVisible(node => {
      if (node.isMesh || node.isSprite) boostedCalls++;
      if (node.name === "booster-plume") visiblePlumes++;
    });
    assert.equal(visiblePlumes, boosterCount * 2, "only configured outlets ignite, including none after batching");
    assert.equal(boostedCalls - calls, boosterCount * 2, "boost adds only the selected outer flames and cores, not unbatched hardware");
    flame.visible = false;
  }
  assert.equal(states[2].visuals.wheels.motorHubs, 4);
  assert.ok(states[4].visuals.height.bodyLift > 1);
  assert.ok(states[3].visuals.spoiler.width > states[0].visuals.spoiler.width);
});

test("nearby Elio starts a rolling race without spamming notices; distant and high cars do not", () => {
  const { field, course, notices } = fixture();
  field.update(.05, absent, 0, 0);
  assert.ok(field.state().every(s => s.mode !== "race-player"));
  field.reset();
  const high = course.route[0].clone(); high.y += 100;
  field.update(.05, high, Math.PI / 2, 20);
  assert.ok(field.state().every(s => s.mode !== "race-player"));
  field.reset();
  for (let i = 0; i < 60; i++) {
    const player = course.route[Math.floor(i / (course.length / course.route.length))];
    field.update(.05, player, Math.PI / 2, 20);
  }
  assert.equal(field.state()[0].mode, "race-player");
  assert.ok(field.state()[0].speed > 10, "friend accelerates to race Elio");
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Vincent.*race/);
  for (let i = 0; i < 500; i++) field.update(.05, absent, 0, 0);
  assert.ok(field.state().every(s => s.mode !== "race-player"), "an abandoned challenge expires");
});

test("friends gather into smaller gaps, race together, and wind down without Elio", () => {
  const { field } = fixture();
  field.update(.05, absent, 0, 0);
  const initial = field.state();
  assert.equal(initial[0].mode, "gather");
  assert.equal(initial[0].pack, initial[1].pack);
  const initialGap = initial[1].along - initial[0].along;
  let raced = false, rested = false, gathered = false, passed = false;
  for (let i = 0; i < 900; i++) {
    field.update(.05, absent, 0, 0);
    const states = field.state();
    if (states[0].mode === "race-friends" && states[0].pack === initial[0].pack) {
      raced = true;
      assert.equal(states[0].pack, states[1].pack);
      if (Math.abs(states[1].along - states[0].along) < initialGap) gathered = true;
      if (states[0].along > states[1].along) passed = true;
    }
    if (raced && states[0].mode === "cruise") rested = true;
  }
  assert.ok(raced, "gathering must lead to a race, not an endless convoy");
  assert.ok(gathered, "friends close up before competing");
  assert.ok(passed, "faster friends must be able to overtake, not stay in a fixed order");
  assert.ok(rested, "packs have a real cooldown before regrouping");
});

test("tall scenery blocks both friend and player sight lines", () => {
  const obstacles = [], { field, course } = fixture("forest", obstacles);
  const [a, b] = field.state();
  obstacles.push({ x: (a.position[0] + b.position[0]) / 2, z: (a.position[2] + b.position[2]) / 2,
    y: 0, hx: 3, hz: 50, height: 200 });
  field.update(.05, absent, 0, 0);
  assert.equal(field.state()[0].pack, null);
  obstacles[0].x = (a.position[0] + course.route[0].x) / 2;
  field.reset(); field.update(.05, course.route[0], Math.PI / 2, 10);
  assert.notEqual(field.state()[0].mode, "race-player");
});

test("zero/invalid steps freeze poses, reset is deterministic and follows a restored position across the lap seam", () => {
  const { field, course, scene } = fixture();
  const cloth = scene.getObjectByName("flag-cloth").geometry.attributes.position;
  const parked = cloth.array.slice();
  const initial = field.state();
  for (const dt of [0, -1, NaN, Infinity]) field.update(dt, absent, 0, 0);
  assert.deepEqual(field.state(), initial);
  assert.deepEqual(cloth.array, parked);
  for (let i = 0; i < 80; i++) field.update(.05, absent, 0, 0);
  assert.notDeepEqual(cloth.array, parked);
  field.reset(); assert.deepEqual(field.state(), initial);
  assert.deepEqual(cloth.array, parked);
  const restored = course.route.at(-6);
  field.reset(restored);
  const start = course.nearest(restored.x, restored.z).along;
  for (const [i, s] of field.state().entries()) {
    assert.ok(Math.abs((s.along - start + course.length) % course.length - [18, 48, 140, 170, 205][i]) < 1e-5);
    assert.equal(s.speed, 0); assert.equal(s.pack, null);
    assert.ok(Math.abs(s.position[1] - course.heightAt(s.position[0], s.position[2])) < .4);
  }
});

test("item targets have stable IDs, car-root heights and radii, and detached snapshots", () => {
  const { field } = fixture();
  const initial = field.targets(), saved = structuredClone(initial), states = field.state();
  assert.deepEqual(initial, states.map((s, i) => ({ id: `racer-${i}`, x: s.position[0], y: s.position[1], z: s.position[2],
    heading: s.heading, speed: s.speed, radius: i === 4 ? 2.25 : 1.65 })));
  const edited = field.targets();
  for (const t of edited) Object.assign(t, { id: "changed", x: -1e6, y: -1e6, z: -1e6, heading: 99, speed: 99, radius: 99 });
  edited.pop();
  assert.deepEqual(field.targets(), saved, "callers cannot mutate racer bodies or IDs");
  for (let i = 0; i < 30; i++) field.update(.05, absent, 0, 0);
  assert.deepEqual(initial, saved, "old snapshots never track live racer motion");
  assert.notDeepEqual(field.targets(), saved);
  assert.deepEqual(field.targets().map(t => t.id), saved.map(t => t.id));
  field.reset();
  assert.deepEqual(field.targets(), saved);
});

test("optional item callbacks preserve default driving and receive every stable racer ID", () => {
  const { field } = fixture("forest", [], fastCircuit());
  const { field: explicit } = fixture("forest", [], fastCircuit());
  const neutral = Object.freeze({ speedFactor: 1, wobble: 0, shield: 0, turbo: 0 }), calls = [];
  const modifiers = id => { calls.push(id); return neutral; };
  for (let i = 0; i < 160; i++) {
    calls.length = 0;
    const motion = field.update(.05, absent, .3, 12);
    const other = explicit.update(.05, absent, .3, 12, undefined, modifiers);
    assert.deepEqual(other, motion);
    assert.deepEqual(explicit.state(), field.state());
    assert.deepEqual(calls, field.targets().map(t => t.id));
  }
  calls.length = 0;
  const before = explicit.state();
  for (const dt of [0, -1, NaN, Infinity]) explicit.update(dt, absent, 0, 0, undefined, modifiers);
  assert.deepEqual(calls, [], "paused/invalid steps do not read or apply modifiers");
  assert.deepEqual(explicit.state(), before);
  field.update(.05, absent, 0, 0, { x: 0, z: 0 });
  explicit.update(.05, absent, 0, 0, { x: 0, z: 0 }, () => ({}));
  assert.deepEqual(explicit.state(), field.state(), "omitted modifier fields are neutral");
});

for (const level of ["forest", "city", "stunt", "moon", "amsterdam"]) test(`${level}: racing follows terrain and ramps, stays separated and keeps finite visible transforms`, () => {
  const { field, scene, course } = fixture(level);
  const flying = new Set(), landed = new Set();
  for (let i = 0; i < 2600; i++) {
    field.update(.05, absent, 0, 0);
    if (i % 4) continue;
    const states = field.state();
    for (const s of states) {
      assert.ok(s.position.every(Number.isFinite));
      assert.ok(s.speed >= 0 && s.speed < 125, `${s.name}: bounded speed ${s.speed}`);
      const [x, y, z] = s.position;
      if (!s.collisions) assert.ok(course.nearest(x, z).distance < 5.8, `${s.name} stays on the road without impacts: ${course.nearest(x, z).distance}`);
      assert.ok(Math.abs(x) <= course.halfSize && Math.abs(z) <= course.halfSize);
      assert.ok(y >= course.heightAt(x, z) - .2);
      if (s.airborne) flying.add(s.name);
      else if (flying.has(s.name)) landed.add(s.name);
      assert.equal(s.flameVisible, s.boosting);
      if (s.config.rocket === "none") assert.equal(s.boosting, false);
    }
    for (let a = 0; a < states.length; a++) for (let b = a + 1; b < states.length; b++) {
      if (Math.abs(states[a].position[1] - states[b].position[1]) < 1.5)
        assert.ok(new THREE.Vector3(...states[a].position).distanceTo(new THREE.Vector3(...states[b].position)) > 3.2,
          `side-by-side cars do not overlap: ${states[a].name}/${states[b].name} at ${i}`);
    }
  }
  if (["stunt", "moon"].includes(level)) { assert.ok(flying.size > 0); assert.ok(landed.size > 0); }
  scene.updateMatrixWorld(true);
  scene.traverseVisible(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite)));
});

test("racers pass a stopped player instead of queueing forever; map markers include the whole crew", () => {
  const { field } = fixture();
  const state = field.state()[0];
  const player = new THREE.Vector3(...state.position).add(new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading)).multiplyScalar(10));
  for (let i = 0; i < 200; i++) {
    field.update(.05, player, state.heading, 0);
    assert.ok(new THREE.Vector3(...field.state()[0].position).distanceTo(player) > 4);
  }
  assert.ok(field.state()[0].along > state.along + 40, "friend overtakes the stopped car");
  let markers = 0;
  const outlines = [];
  field.drawMap({ beginPath() {}, arc(x, z, radius) {
    assert.ok(Number.isFinite(x + z)); assert.ok(radius >= 5); markers++;
  }, fill() {}, stroke() { outlines.push([this.strokeStyle, this.lineWidth]); } }, .2);
  assert.equal(markers, 5);
  assert.deepEqual(outlines, friends.flatMap(() => [["#18212b", 4], ["#fff", 2]]));
});

test("production integration updates only during driving, resets the crew and exposes moving collisions", async () => {
  const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
  const update = source.indexOf("friendRacers.update(dt, car.position, heading, speed, { x: vx, z: vz }");
  assert.ok(update > source.indexOf("garagePreview.render(dt)"));
  assert.ok(update > source.indexOf("if (loading.active || (paused"));
  assert.ok(update < source.indexOf("const flight = jumpPhysics?.update"), "collision displacement reaches ramp physics and terrain grounding");
  assert.match(source, /friendRacers\.reset\(car\.position\)/);
  assert.doesNotMatch(source, /friendRacers\.obstacles/, "friends are no longer immovable scenery");
  assert.match(source, /if \(boosting && motion\.staticHits\)/, "nudging a racer does not cancel Elio's rocket");
  assert.match(source, /friendRacers\.drawMap\(map, mapScale\)/);
});

function fastCircuit() {
  const radius = 900, count = 720;
  const route = Array.from({ length: count }, (_, i) => new THREE.Vector3(radius * Math.sin(i / count * Math.PI * 2), 0, radius * Math.cos(i / count * Math.PI * 2)));
  const segmentLength = route[0].distanceTo(route[1]), length = count * segmentLength;
  return { route, length, halfSize: 1000, heightAt: () => 0, nearest(x, z) {
    const theta = ((Math.atan2(x, z) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const index = Math.floor(theta / (Math.PI * 2) * count), a = route[index], b = route[(index + 1) % count];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
    return { along: (index + t) * segmentLength, distance: Math.hypot(x - a.x - dx * t, z - a.z - dz * t) };
  } };
}

test("friends race at fitted engine speeds and rocket cars boost, cool down, and boost again", () => {
  const { field, scene } = fixture("forest", [], fastCircuit());
  const peak = Array(5).fill(0), durations = Array(5).fill(0), active = Array(5).fill(0), previous = Array(5).fill(false);
  const flames = field.state().map(s => scene.getObjectByName(`racer-${s.name}`).getObjectByName("boost-flames"));
  const anchors = flames.map(flame => flame.children.map(plume => plume.position.toArray()));
  const firstScale = new Map(), flickered = new Set();
  for (let i = 0; i < 1600; i++) {
    field.update(.05, absent, 0, 0);
    field.state().forEach((s, j) => {
      peak[j] = Math.max(peak[j], s.speed);
      const visible = [];
      flames[j].traverseVisible(node => { if (node.isMesh) visible.push(node); });
      assert.equal(visible.length, s.boosting ? s.visuals.rocket.count * 2 : 0, `${s.name}: actual active flames match fitted boosters`);
      assert.deepEqual(flames[j].scale.toArray(), [1, 1, 1], "flicker cannot scale the common root and move side outlets");
      assert.deepEqual(flames[j].children.map(plume => plume.position.toArray()), anchors[j], "outlets remain anchored while the batched car drives");
      if (s.boosting) {
        active[j] += .05;
        assert.ok(s.boostRemaining <= 5 * computeTuning(s.config).boostTime + 1e-8);
        const scale = visible[0].parent.scale.z;
        if (!firstScale.has(j)) firstScale.set(j, scale);
        else if (Math.abs(scale - firstScale.get(j)) > .01) flickered.add(j);
      } else if (previous[j]) { durations[j] = Math.max(durations[j], active[j]); active[j] = 0; assert.ok(s.boostCooldown > 0); }
      previous[j] = s.boosting;
    });
  }
  const states = field.state();
  for (const [i, s] of states.entries()) {
    const top = 32 * computeTuning(s.config).top;
    assert.ok(peak[i] > top * .95, `${s.name} reaches their engine speed: ${peak[i]} / ${top}`);
    if (s.config.rocket === "none") assert.equal(s.boosts, 0);
    else {
      assert.ok(s.boosts >= 2, `${s.name} uses rockets repeatedly`);
      assert.ok(flickered.has(i), `${s.name}: flame children still animate after hardware batching`);
      assert.ok(peak[i] > top * 1.25, `${s.name} gets real boost speed: ${peak[i]} / ${top}`);
      assert.ok(durations[i] <= 5 * computeTuning(s.config).boostTime + .1);
    }
  }
  assert.ok(durations[1] > durations[0] + 1, "a big rocket can burn longer than a small one");
  const before = field.state(); field.update(0, absent, 0, 0); assert.deepEqual(field.state(), before);
  field.reset();
  assert.ok(field.state().every(s => !s.boosting && !s.flameVisible && s.boosts === 0 && !s.recovering));
  assert.ok(flames.every(flame => !flame.visible), "reset extinguishes actual rendered flames too");
});

test("item slows immediately cut momentum, cancel rockets, persist past cooldown, and expire normally", () => {
  const { field } = fixture("forest", [], fastCircuit());
  for (let i = 0; i < 400 && !field.state()[0].boosting; i++) field.update(.05, absent, 0, 0);
  const before = field.state()[0];
  assert.equal(before.boosting, true);
  let speedFactor = .6;
  const modifiers = id => ({ speedFactor: id === "racer-0" ? speedFactor : 1, wobble: 0, shield: 0, turbo: 0 });
  field.update(.05, absent, 0, 0, undefined, modifiers);
  const struck = field.state()[0], top = 32 * computeTuning(struck.config).top;
  assert.ok(struck.speed < before.speed * .7, "the first hit immediately reduces existing momentum");
  assert.equal(struck.boosting, false); assert.equal(struck.flameVisible, false);
  assert.ok(struck.boostCooldown > 0);
  assert.equal(struck.collisions, before.collisions, "items do not cause collision damage or recovery");
  assert.ok(field.state().slice(1).every(s => s.speedFactor === 1), "only the addressed racer is slowed");
  field.update(.05, absent, 0, 0, undefined, modifiers);
  assert.ok(field.state()[0].speed > struck.speed * .9, "the same hit does not multiply momentum down every frame");
  for (let i = 0; i < 180; i++) {
    field.update(.05, absent, 0, 0, undefined, modifiers);
    const s = field.state()[0];
    assert.equal(s.speedFactor, .6);
    assert.equal(s.boosting, false); assert.equal(s.flameVisible, false);
    assert.equal(s.boosts, before.boosts, "rockets cannot restart during a slow");
    if (i > 30) assert.ok(s.speed <= top * .6 + .5, `slow speed remains capped: ${s.speed}`);
  }
  const slowed = field.state()[0];
  assert.equal(slowed.boostCooldown, 0, "the slow outlasted the rocket cooldown");
  assert.ok(slowed.speed > top * .4, "the friend continues driving autonomously while slowed");
  speedFactor = 1;
  field.update(.05, absent, 0, 0, undefined, modifiers);
  assert.ok(field.state()[0].speed < slowed.speed + 4, "expiry restores acceleration, not an instantaneous speed jump");
  let peak = 0;
  for (let i = 0; i < 400; i++) {
    field.update(.05, absent, 0, 0, undefined, modifiers);
    peak = Math.max(peak, field.state()[0].speed);
  }
  assert.ok(peak > top * .95, "the normal engine speed returns after expiry");
  assert.ok(field.state()[0].boosts > before.boosts, "rockets become available again");
  field.update(.05, absent, 0, 0, undefined, () => ({ speedFactor: .6, wobble: 1.2 }));
  field.reset();
  assert.ok(field.state().every(s => s.speedFactor === 1 && s.wobble === 0));
});

test("item wobble is gentle visual yaw and roll without changing geometry or autonomous impact recovery", () => {
  const { field, scene, course } = fixture("forest", [], fastCircuit());
  const { field: steady } = fixture("forest", [], fastCircuit());
  const victim = field.state()[0], car = scene.getObjectByName(`racer-${victim.name}`);
  const scale = car.scale.toArray(), geometry = [];
  car.traverse(node => { if (node.isMesh) geometry.push([node, node.geometry]); });
  const right = new THREE.Vector3(Math.cos(victim.heading), 0, -Math.sin(victim.heading));
  const player = new THREE.Vector3(...victim.position).addScaledVector(right, -6);
  for (const racers of [field, steady]) racers.update(.05, player, victim.heading + Math.PI / 2, 110, { x: right.x * 110, z: right.z * 110 });
  assert.equal(field.state()[0].recovering, true);
  let movedVisually = false, furthest = 0;
  for (let i = 0; i < 600; i++) {
    field.update(.05, absent, 0, 0, undefined, () => ({ speedFactor: .6, wobble: 1.2 }));
    steady.update(.05, absent, 0, 0, undefined, () => ({ speedFactor: .6, wobble: 0 }));
    assert.deepEqual(field.targets(), steady.targets(), "visual wobble never changes physical steering or motion");
    const s = field.state()[0];
    assert.ok(Math.abs(car.rotation.y - s.heading) <= .025 + 1e-8);
    assert.ok(Math.abs(car.rotation.z) <= .04 + 1e-8);
    movedVisually ||= Math.abs(car.rotation.z) > .02 && Math.abs(car.rotation.y - s.heading) > .01;
    furthest = Math.max(furthest, course.nearest(s.position[0], s.position[2]).distance);
    assert.deepEqual(car.scale.toArray(), scale);
    for (const [node, original] of geometry) assert.equal(node.geometry, original);
  }
  const recovered = field.state()[0];
  assert.ok(movedVisually, "the wobble animates both yaw and roll");
  assert.ok(furthest > 8, "the collision still sends the slowed friend off road");
  assert.ok(course.nearest(recovered.position[0], recovered.position[2]).distance < 4);
  assert.ok(recovered.speed > 10 && !recovered.recovering, "the friend drives back even while slowed and wobbling");
  field.update(.05, absent, 0, 0);
  assert.equal(car.rotation.y, field.state()[0].heading);
  assert.equal(car.rotation.z, 0, "visual wobble clears when the modifier expires");
});

test("a swept side hit throws a friend off track, preserves player momentum, and the friend drives back", () => {
  const { field, course } = fixture("forest", [], fastCircuit());
  const victim = field.state()[0], p = new THREE.Vector3(...victim.position);
  const right = new THREE.Vector3(Math.cos(victim.heading), 0, -Math.sin(victim.heading));
  const player = p.clone().addScaledVector(right, -6);
  const motion = field.update(.05, player, victim.heading + Math.PI / 2, 110, { x: right.x * 110, z: right.z * 110 });
  assert.ok(motion.hits > 0, "fast swept side contact is detected");
  assert.equal(motion.staticHits, 0);
  assert.ok(motion.vx * right.x + motion.vz * right.z > 0, "Elio is slowed, not reflected like a wall collision");
  assert.ok(field.state()[0].collisions > 0);
  let furthest = 0;
  for (let i = 0; i < 1400; i++) {
    field.update(.05, absent, 0, 0);
    const s = field.state()[0];
    const distance = course.nearest(s.position[0], s.position[2]).distance;
    furthest = Math.max(furthest, distance);
  }
  const recovered = field.state()[0];
  assert.ok(furthest > 8, `the impact really sends the car off track: ${furthest}`);
  assert.ok(course.nearest(recovered.position[0], recovered.position[2]).distance < 4);
  assert.ok(recovered.speed > 15, "friend rejoins under its own power");
});

test("hitting a boosting friend extinguishes the flame and starts recovery and cooldown", () => {
  const { field } = fixture("forest", [], fastCircuit());
  for (let i = 0; i < 400 && !field.state()[0].boosting; i++) field.update(.05, absent, 0, 0);
  const victim = field.state()[0];
  assert.equal(victim.boosting, true);
  const right = new THREE.Vector3(Math.cos(victim.heading), 0, -Math.sin(victim.heading));
  const player = new THREE.Vector3(...victim.position)
    .add(new THREE.Vector3(victim.velocity.x, 0, victim.velocity.z).multiplyScalar(.03)).addScaledVector(right, -6);
  const motion = field.update(.05, player, victim.heading + Math.PI / 2, 110, { x: right.x * 110, z: right.z * 110 });
  const struck = field.state()[0];
  assert.ok(motion.hits > 0 && struck.collisions > victim.collisions);
  assert.equal(struck.boosting, false); assert.equal(struck.flameVisible, false);
  assert.ok(struck.recovering && struck.boostCooldown >= 3);
});
