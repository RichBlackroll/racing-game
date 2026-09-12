import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getVehicle } from "./vehicle-data.js";
import { createVehicleActions } from "./vehicle-actions.js";
import { prepareUtilityVehicleModel } from "./utility-vehicles.js";

// Fixtures are local to getModel: never mutate the registry being edited elsewhere.
const fixtures = [
  ["porsche", "sprint", 3, 8], ["tesla", "pulse", 2, 6], ["golf", "hop", 1.2, 4],
  ["byd-atto-1", "bubbles", 4, 6], ["volvo-ex40", "beacon", 4, 6],
  ["backhoe", "dig", 4.5, 2, true], ["dhl-van", "delivery", 3, 2, true],
];
const neutral = { speedFactor: 1, accelFactor: 1, locked: false, hop: 0 };
function setup(t, id, options = {}) {
  const [vehicleId, actionId, duration, cooldown, parked] = fixtures.find(entry => entry[0] === id);
  const registered = getVehicle(id);
  const action = registered.id === id && registered.action ? registered.action : {
    id: actionId, label: `${actionId} action`, description: `Try ${actionId}`, duration, cooldown, ...(parked ? { parked } : {}),
  };
  const scene = new THREE.Scene(), car = new THREE.Group(), body = new THREE.Group();
  const anchor = new THREE.Object3D();
  scene.add(car); car.add(body); body.add(anchor);
  body.userData.dimensions = options.dimensions ?? { length: 4.6, width: 1.9, height: 1.5 };
  const poses = [], messages = [], ground = { safe: true, road: 20, height: 0 };
  let progress = 0, resets = 0;
  const special = {
    anchor,
    pose(p) {
      progress = p;
      poses.push(p);
      anchor.position.set(actionId === "dig" ? p * 2 : .4, .4 + Math.sin(Math.PI * p), -4 - p);
      anchor.rotation.x = p * .4;
    },
    reset() { resets++; this.pose(0); },
  };
  special.reset();
  const model = { vehicle: { id: vehicleId, action }, special, car: body };
  let currentModel = model;
  const actions = createVehicleActions({
    scene, car, getModel: () => currentModel,
    heightAt: () => ground.height,
    roadDistance: () => ground.road,
    isSafePosition: () => ground.safe,
    onMessage: message => messages.push(message),
    ...options,
  });
  t.after(() => actions.dispose());
  return {
    actions, action, scene, car, body, model, anchor, poses, messages, ground,
    root: scene.getObjectByName("vehicle-actions"),
    get progress() { return progress; }, get resets() { return resets; },
    swap(next) { currentModel = next; },
  };
}
function near(actual, expected, epsilon = 1e-8) { assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`); }
function visible(root, prefix) {
  const found = [];
  root.traverseVisible(object => { if (object.isMesh && object.name.startsWith(prefix)) found.push(object); });
  return found;
}
function snapshot(root) {
  root.updateWorldMatrix(true, true);
  const result = [];
  root.traverse(object => result.push([object.uuid, object.visible, object.matrixWorld.elements.slice(), object.material?.opacity, object.intensity]));
  return result;
}
function finiteScene(root) {
  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    assert.ok(object.matrixWorld.elements.every(Number.isFinite), object.name);
    assert.ok(object.scale.toArray().every(value => Number.isFinite(value) && value >= 0), object.name);
    if (!object.isMesh) return;
    assert.equal(object.castShadow, false);
    assert.equal(object.userData.castShadow, false);
    for (const attribute of Object.values(object.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
    assert.ok(Number.isFinite(object.material.opacity) && object.material.opacity >= 0 && object.material.opacity <= 1);
  });
}

for (const [id, actionId, duration, cooldown, parked] of fixtures) {
  test(`${id}: exact API, single cycle, modifiers, cooldown and reset`, t => {
    const f = setup(t, id), { actions } = f;
    assert.deepEqual(Object.keys(actions).sort(), ["activate", "dispose", "modifiers", "reset", "state", "update"]);
    assert.deepEqual(Object.keys(actions.state()).sort(), ["active", "blocked", "cooldown", "deposits", "description", "id", "label", "remaining", "uses"]);
    assert.equal(actions.state().id, actionId);
    assert.equal(actions.state().blocked, "");
    assert.equal(actions.activate(), true);
    assert.equal(actions.state().remaining, duration);
    assert.equal(actions.state().cooldown, 0);
    assert.equal(actions.state().uses, 1);
    assert.equal(actions.activate(), false);
    actions.update(duration / 2);
    const modifiers = actions.modifiers();
    assert.equal(modifiers.speedFactor, actionId === "sprint" ? 1.25 : 1);
    assert.equal(modifiers.accelFactor, actionId === "sprint" ? 1.6 : 1);
    assert.equal(modifiers.locked, !!parked);
    near(modifiers.hop, actionId === "hop" ? .7 : 0);
    near(actions.state().remaining, duration / 2);
    assert.equal(actions.state().cooldown, 0);
    finiteScene(f.root);
    actions.update(duration / 2);
    assert.equal(actions.state().active, false);
    assert.equal(actions.state().cooldown, cooldown);
    assert.deepEqual(actions.modifiers(), neutral);
    assert.equal(f.progress, 0);
    assert.equal(actions.activate(), false);
    actions.update(cooldown - .01);
    assert.equal(actions.activate(), false);
    actions.update(.02);
    assert.equal(actions.activate(), true);
    assert.equal(actions.state().uses, 2);
    actions.update(duration + cooldown + 35);
    assert.equal(actions.state().active, false);
    assert.equal(actions.state().uses, 2, "no repeated cycle on a long update");
    assert.equal(actions.state().cooldown, 0);
    assert.equal(actions.state().deposits, 0);
    assert.equal(visible(f.root, "action-trail").length + visible(f.root, "action-bubble").length, 0);
    actions.reset();
    assert.equal(actions.state().uses, 0);
    assert.equal(actions.state().deposits, 0);
    assert.equal(actions.state().remaining, 0);
  });

  test(`${id}: zero/invalid dt and UI queries never advance effects, timers or poses`, t => {
    const f = setup(t, id), { actions } = f;
    actions.activate(); actions.update(duration * .65);
    const before = snapshot(f.scene), state = actions.state(), modifiers = actions.modifiers();
    const poseCount = f.poses.length, messageCount = f.messages.length;
    for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, null, "1"]) {
      actions.update(dt, { speed: 100, airborne: true });
      assert.deepEqual(actions.state(), state);
      assert.deepEqual(actions.modifiers(), modifiers);
      assert.deepEqual(snapshot(f.scene), before);
    }
    assert.equal(f.poses.length, poseCount);
    assert.equal(f.messages.length, messageCount);
    actions.reset();
    assert.deepEqual(actions.modifiers(), neutral);
    assert.equal(f.progress, 0);
    assert.equal(visible(f.root, "").length, 0);
  });
}

for (const id of ["backhoe", "dhl-van"]) {
  test(`${id}: live signed speed, ground and terrain checks cannot be bypassed by stale UI`, t => {
    const f = setup(t, id), { actions } = f;
    assert.equal(actions.state().blocked, "");
    for (const speed of [.50001, -.50001, 10, -10, NaN, Infinity]) {
      assert.match(actions.state({ speed }).blocked, /Stop/);
      assert.equal(actions.activate({ speed }), false);
    }
    assert.match(actions.state({ airborne: true }).blocked, /Land/);
    assert.equal(actions.activate({ airborne: true }), false);
    f.ground.safe = false;
    assert.equal(actions.activate(), false);
    f.ground.safe = true;
    for (const height of [NaN, Infinity, undefined]) {
      f.ground.height = height;
      assert.equal(actions.activate(), false);
    }
    f.ground.height = 0;
    for (const speed of [-.5, .5]) {
      assert.equal(actions.activate({ speed }), true);
      assert.equal(actions.modifiers().locked, true);
      actions.reset();
    }
    assert.equal(actions.state().uses, 0);
    assert.ok(f.messages.every(message => typeof message === "string"));
  });

  test(`${id}: losing grounded parking cancels and unlocks without an extra deposit`, t => {
    const f = setup(t, id), { actions } = f;
    for (const conditions of [{ speed: -.6 }, { airborne: true }]) {
      actions.activate(); actions.update(.1);
      actions.update(.1, conditions);
      assert.equal(actions.state().active, false);
      assert.equal(actions.state().deposits, 0);
      assert.equal(actions.modifiers().locked, false);
      assert.equal(f.progress, 0);
      near(actions.state().cooldown, f.action.cooldown - .1);
      actions.reset();
    }
  });
}

test("dig validates the posed rear contact in world space, not the car center or resting bucket", t => {
  const calls = [], f = setup(t, "backhoe", {
    roadDistance: (x, z) => { calls.push([x, z]); return x < 7 ? 5 : 20; },
  });
  f.car.position.set(10, 0, 12);
  f.car.rotation.y = Math.PI / 2;
  const rest = f.anchor.getWorldPosition(new THREE.Vector3());
  f.model.special.pose(.32);
  const contact = f.anchor.getWorldPosition(new THREE.Vector3());
  f.model.special.reset();
  assert.ok(contact.x < 7);
  assert.equal(f.actions.state().blocked, "Find soil to dig");
  assert.equal(f.actions.activate(), false);
  near(calls.at(-1)[0], contact.x); near(calls.at(-1)[1], contact.z);
  assert.ok(f.anchor.getWorldPosition(new THREE.Vector3()).distanceTo(rest) < 1e-8);
  assert.equal(f.actions.state().uses, 0);
});

test("dig rejects roads at <= 6, invalid road distances, unsafe rear reach and steep soil; delivery permits roads", t => {
  const f = setup(t, "backhoe");
  for (const distance of [-1, 0, 6, NaN, undefined]) {
    f.ground.road = distance;
    assert.equal(f.actions.state().blocked, "Find soil to dig");
    assert.equal(f.actions.activate(), false);
  }
  f.ground.road = 6.001;
  assert.equal(f.actions.activate(), true);
  const unsafe = setup(t, "backhoe", { isSafePosition: (x, z) => z > -3 });
  assert.equal(unsafe.actions.activate(), false);
  const steep = setup(t, "backhoe", { heightAt: x => x * 2 });
  assert.equal(steep.actions.activate(), false);
  const van = setup(t, "dhl-van", { roadDistance: () => { throw new Error("Delivery must not require soil"); } });
  assert.equal(van.actions.activate(), true);
});

test("dig contacts at .32, carries at .58 after pose, and drops once at .78", t => {
  const f = setup(t, "backhoe"), { actions } = f, duration = f.action.duration;
  actions.activate();
  actions.update(duration * .32);
  assert.equal(visible(f.root, "dig-ground-mark").length, 1);
  assert.equal(visible(f.root, "dig-heap").length, 0);
  assert.equal(actions.state().deposits, 0);
  actions.update(duration * (.58 - .32));
  const carried = visible(f.root, "action-carried-soil")[0];
  assert.ok(carried);
  const expected = f.anchor.localToWorld(new THREE.Vector3(0, .08, -.16));
  assert.ok(carried.position.distanceTo(expected) < 1e-8);
  actions.update(duration * (.78 - .58));
  assert.equal(carried.visible, false);
  const heap = visible(f.root, "dig-heap")[0];
  assert.ok(heap.position.distanceTo(f.anchor.getWorldPosition(new THREE.Vector3())) < 1e-8);
  assert.equal(actions.state().deposits, 1);
  actions.update(.7);
  near(heap.position.y, .16);
  const depositPosition = heap.position.clone();
  f.car.position.x = 20;
  actions.update(duration);
  assert.ok(heap.position.distanceTo(depositPosition) < 1e-8);
  assert.equal(actions.state().deposits, 1);
  actions.update(20);
  assert.ok(heap.material.opacity < 1 && heap.material.opacity > 0);
  actions.update(6);
  assert.equal(actions.state().deposits, 0);
  assert.equal(visible(f.root, "dig-ground-mark").length, 0);
});

test("delivery samples open doors at .5, drops one parcel and leaves it in world space", t => {
  const f = setup(t, "dhl-van"), { actions } = f;
  f.car.position.set(8, 0, 9);
  f.car.rotation.y = .7;
  actions.activate();
  actions.update(1.49);
  assert.equal(actions.state().deposits, 0);
  actions.update(.01);
  assert.equal(actions.state().deposits, 1);
  const parcel = visible(f.root, "delivery-parcel")[0];
  assert.ok(parcel.position.distanceTo(f.anchor.getWorldPosition(new THREE.Vector3())) < 1e-8);
  actions.update(.7);
  near(parcel.position.y, .23);
  const position = parcel.position.clone(), quaternion = parcel.quaternion.clone();
  f.car.position.set(-30, 0, 21); f.car.rotation.y = 2;
  actions.update(3);
  assert.ok(parcel.position.distanceTo(position) < 1e-8);
  assert.ok(parcel.quaternion.angleTo(quaternion) < 1e-8);
  assert.equal(f.progress, 0);
  assert.equal(actions.state().deposits, 1);
});

test("crossed utility stages produce the same deposits for one long frame and several short frames", t => {
  for (const id of ["backhoe", "dhl-van"]) {
    const a = setup(t, id), b = setup(t, id);
    a.actions.activate(); b.actions.activate();
    a.actions.update(a.action.duration + .4);
    const steps = id === "backhoe" ? [.32, .58, .78, 1] : [.5, 1];
    let last = 0;
    for (const p of steps) { b.actions.update((p - last) * b.action.duration); last = p; }
    b.actions.update(.4);
    assert.equal(a.actions.state().deposits, 1);
    assert.equal(b.actions.state().deposits, 1);
    near(a.actions.state().cooldown, b.actions.state().cooldown);
    for (const name of id === "backhoe" ? ["dig-ground-mark", "dig-heap"] : ["delivery-parcel"]) {
      const first = visible(a.root, name)[0], second = visible(b.root, name)[0];
      assert.ok(first.position.distanceTo(second.position) < 1e-8);
      assert.ok(first.quaternion.angleTo(second.quaternion) < 1e-7);
      near(first.material.opacity, second.material.opacity);
    }
    assert.ok(a.poses.includes(id === "backhoe" ? .78 : .5), "must pose the crossed event, not just the final frame");
  }
});

test("Sprint has restrained gold trails; Pulse expands from a fixed origin without gameplay effects", t => {
  const sprint = setup(t, "porsche");
  sprint.actions.activate({ speed: 20, airborne: true });
  sprint.actions.update(.2, { speed: 20 });
  const trail = visible(sprint.root, "action-trail");
  assert.ok(trail.length > 0 && trail.length <= 12);
  assert.equal(trail[0].material.color.getHex(), 0xf3ce75);
  assert.ok(trail[0].scale.z <= .65);
  const pulse = setup(t, "tesla");
  pulse.actions.activate(); pulse.actions.update(.5);
  const wave = visible(pulse.root, "action-wave")[0];
  const radius = wave.scale.x, position = wave.position.clone();
  pulse.car.position.set(30, 0, 30);
  pulse.actions.update(.5);
  assert.ok(wave.scale.x > radius);
  assert.ok(wave.position.distanceTo(position) < 1e-8);
  assert.deepEqual(pulse.actions.modifiers(), neutral);
  assert.equal(pulse.root.getObjectByName("action-light").castShadow, false);
});

test("Golf hop stays finite within 0..0.7, returns to zero and never writes the car transform", t => {
  const f = setup(t, "golf"), before = f.car.position.clone();
  f.actions.activate();
  for (let i = 0; i < 130; i++) {
    f.actions.update(.01);
    const { hop, speedFactor, accelFactor, locked } = f.actions.modifiers();
    assert.ok(Number.isFinite(hop) && hop >= 0 && hop <= .7);
    assert.equal(speedFactor, 1); assert.equal(accelFactor, 1); assert.equal(locked, false);
    assert.ok(f.car.position.equals(before));
  }
  assert.equal(f.actions.modifiers().hop, 0);
});

test("BYD emits small rising bubbles; Volvo slowly sweeps amber pillars without strobing", t => {
  const byd = setup(t, "byd-atto-1");
  byd.actions.activate(); byd.actions.update(.2);
  const bubble = visible(byd.root, "action-bubble")[0], y = bubble.position.y;
  byd.actions.update(.2);
  assert.ok(bubble.position.y > y);
  assert.ok(bubble.scale.x > 0 && bubble.scale.x < .2);
  const volvo = setup(t, "volvo-ex40");
  volvo.actions.activate(); volvo.actions.update(1);
  const pillar = visible(volvo.root, "action-pillar")[0], position = pillar.position.clone();
  const intensity = volvo.root.getObjectByName("action-light").intensity;
  volvo.actions.update(.5);
  assert.ok(pillar.position.distanceTo(position) > .1);
  assert.equal(pillar.material.color.getHex(), 0xffb947);
  assert.equal(volvo.root.getObjectByName("action-light").intensity, intensity);
  assert.deepEqual(byd.actions.modifiers(), neutral);
  assert.deepEqual(volvo.actions.modifiers(), neutral);
});

test("reduced motion cuts particles/sweep/hop but keeps utility articulation and functional Sprint", t => {
  for (const [id] of fixtures) {
    const full = setup(t, id), reduced = setup(t, id, { reducedMotion: true });
    full.actions.activate(); reduced.actions.activate();
    full.actions.update(full.action.duration * .65);
    reduced.actions.update(reduced.action.duration * .65);
    if (id === "porsche" || id === "byd-atto-1") {
      const name = id === "porsche" ? "action-trail" : "action-bubble";
      assert.ok(visible(reduced.root, name).length < visible(full.root, name).length);
    }
    if (id === "volvo-ex40") assert.equal(visible(reduced.root, "action-pillar").length, 1);
    if (id === "tesla") assert.equal(visible(reduced.root, "action-wave").length, 1);
    if (id === "golf") assert.ok(reduced.actions.modifiers().hop < full.actions.modifiers().hop);
    else assert.deepEqual(reduced.actions.modifiers(), full.actions.modifiers());
    if (id === "backhoe" || id === "dhl-van") near(reduced.progress, .65);
    finiteScene(reduced.root);
  }
});

test("missing, zero, nonfinite and extreme dimensions always produce finite bounded effects", t => {
  for (const [id] of fixtures) for (const dimensions of [
    {}, { length: NaN, width: Infinity, height: -Infinity },
    { length: 0, width: -2, height: 0 }, { length: 1e200, width: 1e200, height: 1e200 },
  ]) {
    const f = setup(t, id, { dimensions });
    f.actions.activate();
    for (let i = 0; i < 10; i++) f.actions.update(f.action.duration / 10);
    finiteScene(f.root);
    const bounds = new THREE.Box3().setFromObject(f.root);
    assert.ok(bounds.getSize(new THREE.Vector3()).length() < 100);
  }
});

test("effects reuse bounded objects/resources, cap at 12 deposits, fade and dispose exactly once", t => {
  const f = setup(t, "dhl-van"), { actions } = f;
  // Accelerate only this mock metadata to exercise eviction before the 30s fade.
  f.model.vehicle.action = { ...f.action, duration: .1, cooldown: 0 };
  const objects = [], resources = new Map();
  f.root.traverse(object => {
    objects.push(object);
    for (const resource of [object.geometry, object.material].filter(Boolean)) {
      if (resources.has(resource)) continue;
      resources.set(resource, 0);
      resource.addEventListener("dispose", () => resources.set(resource, resources.get(resource) + 1));
    }
  });
  for (let i = 0; i < 100; i++) {
    f.car.position.x = i;
    assert.equal(actions.activate(), true);
    actions.update(.1);
    assert.equal(actions.state().deposits, Math.min(i + 1, 12));
    assert.ok(visible(f.root, "delivery-parcel").length <= 12);
  }
  const after = [];
  f.root.traverse(object => after.push(object));
  assert.deepEqual(after, objects);
  assert.ok(resources.size < 30, "resources are pooled, not one geometry/material per particle");
  assert.ok([...resources.values()].every(count => count === 0));
  actions.update(26);
  assert.ok(visible(f.root, "delivery-parcel").some(parcel => parcel.material.opacity < 1));
  const frozen = snapshot(f.root), state = actions.state();
  for (const dt of [0, NaN, -1, Infinity]) {
    actions.update(dt);
    assert.deepEqual(snapshot(f.root), frozen);
    assert.deepEqual(actions.state(), state);
  }
  actions.update(4);
  assert.equal(actions.state().deposits, 0);
  assert.equal(visible(f.root, "delivery-parcel").length, 0);
  actions.activate(); actions.update(.06); actions.reset();
  assert.equal(visible(f.root, "").length, 0);
  actions.dispose(); actions.dispose(); actions.reset(); actions.update(100);
  assert.equal(actions.activate(), false);
  assert.equal(actions.state().id, "");
  assert.deepEqual(actions.modifiers(), neutral);
  assert.equal(f.root.parent, null);
  assert.equal(f.root.children.length, 0);
  assert.equal(f.car.parent, f.scene);
  assert.equal(f.body.parent, f.car);
  assert.ok([...resources.values()].every(count => count === 1));
});

test("reset restores the old model before a swap; missing/invalid metadata never invents actions", t => {
  const f = setup(t, "backhoe");
  f.actions.activate(); f.actions.update(3);
  f.actions.reset();
  assert.equal(f.progress, 0);
  const next = { vehicle: { id: "mock", action: { id: "hop", label: "Hop", description: "Visual hop", duration: 1.2, cooldown: 4 } } };
  f.swap(next);
  assert.equal(f.actions.state().id, "hop");
  assert.equal(f.actions.activate(), true);
  f.actions.reset();
  for (const value of [null, { vehicle: { id: "unknown" } }, { vehicle: { id: "mock", action: { ...next.vehicle.action, id: "invented" } } },
    { vehicle: { id: "mock", action: { ...next.vehicle.action, duration: 0 } } },
    { vehicle: { id: "mock", action: { ...next.vehicle.action, cooldown: NaN } } }]) {
    f.swap(value);
    assert.equal(f.actions.state().id, "");
    assert.equal(f.actions.activate(), false);
    assert.deepEqual(f.actions.modifiers(), neutral);
  }
});

for (const id of ["backhoe", "dhl-van"]) test(`${id}: real utility articulation and anchor drive controller effects`, async t => {
  const f = setup(t, id);
  const vehicle = { id, length: id === "backhoe" ? 8.8 : 5.8, engine: "four", action: f.action };
  const file = id === "backhoe" ? "backhoe-loader.glb" : "dhl-delivery-van.glb";
  const bytes = await readFile(new URL(file, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: "geometry-only-test", loadTexture: () => Promise.resolve(null) }));
  const source = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const model = prepareUtilityVehicleModel(source.scene, vehicle);
  t.after(() => { f.actions.dispose(); model.dispose(); });
  f.body.removeFromParent();
  f.car.add(model.car);
  f.car.position.set(20, 0, 15); f.car.rotation.y = .4;
  f.swap(model);
  const names = id === "backhoe" ? ["shovel", "backhoe-boom", "backhoe-bucket"] : ["van-rear-door--1", "van-rear-door-1"];
  const parts = names.map(name => model.car.getObjectByName(name));
  const rotations = parts.map(part => part.quaternion.clone());
  const anchor = model.special.anchor.getWorldPosition(new THREE.Vector3());
  assert.equal(f.actions.state().blocked, "");
  assert.ok(model.special.anchor.getWorldPosition(new THREE.Vector3()).distanceTo(anchor) < 1e-8, "UI probing restores the real pose");
  assert.equal(f.actions.activate(), true);
  f.actions.update(f.action.duration * .6);
  assert.ok(parts.every((part, i) => part.quaternion.angleTo(rotations[i]) > .01));
  if (id === "backhoe") {
    const carried = visible(f.root, "action-carried-soil")[0];
    assert.ok(carried);
    const bucketLoad = model.special.anchor.localToWorld(new THREE.Vector3(0, .08, -.16));
    assert.ok(carried.position.distanceTo(bucketLoad) < 1e-8);
  } else assert.equal(visible(f.root, "delivery-parcel").length, 1);
  f.actions.update(f.action.duration * .4);
  assert.equal(f.actions.state().deposits, 1);
  assert.ok(parts.every((part, i) => part.quaternion.angleTo(rotations[i]) < 1e-7));
  finiteScene(f.root);
  f.actions.reset();
  assert.equal(visible(f.root, "").length, 0);
});
