import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createNightLighting, occupiedWindowEmission } from "./night-lights.js";
import { enableGeometryShadows } from "./daylight.js";
import { prepareVehicleModel } from "./vehicle-model.js";
import { getVehicle } from "./vehicle-data.js";
import { DEFAULTS } from "./modifier-data.js";
import { createFriendRacerCar } from "./friend-racer-car.js";
import { createArchitecture } from "./architecture.js";
import { createAmsterdamWorld } from "./amsterdam-world.js";
import { createWellingtonWorld } from "./wellington-world.js";
import { createLandmarks } from "./landmarks.js";
import { createCourse } from "./course.js";
import { createWellingtonCourse } from "./wellington-course.js";
import { AMSTERDAM } from "./amsterdam-layout.js";
import { isWellingtonLand } from "./wellington-layout.js";

function tagged(intensity = 2, color = 0xffcf91) {
  const material = new THREE.MeshStandardMaterial({ emissive: color, emissiveIntensity: 0 });
  material.userData.nightIntensity = intensity;
  return material;
}
function fixture(tablet = false) {
  const scene = new THREE.Scene(), car = new THREE.Group(), visual = new THREE.Group();
  scene.add(car); car.add(visual);
  const root = new THREE.Group(), body = new THREE.Group();
  body.name = "modifier-body"; root.add(body); visual.add(root);
  root.userData.nightVehicle = true;
  root.userData.headlights = [[-0.7, 0.65, 2.2], [0.7, 0.65, 2.2]];
  const head = tagged(1.8, 0xe2f5ff), rear = tagged(1.3, 0xff0011);
  rear.userData.brakeIntensity = 3;
  body.add(new THREE.Mesh(new THREE.BoxGeometry(), [head, rear]));
  const vehicleModel = { car: root };
  return { scene, car, visual, body, head, rear, vehicleModel, tablet };
}
function closeVector(actual, expected) {
  assert.ok(actual.distanceTo(expected) < 1e-6, `${actual.toArray()} != ${expected.toArray()}`);
}
function lights(scene, prefix = "night/") {
  return scene.children.filter(o => o.isLight && o.name.startsWith(prefix));
}
function clearScene(scene) {
  const resources = new Set();
  scene.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) resource.dispose();
}

async function vehicle(id) {
  const bytes = await readFile(new URL(getVehicle(id).file, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: "geometry-only-test", loadTexture: () => Promise.resolve(null) }));
  const { scene } = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return prepareVehicleModel(scene, id);
}

test("paused time jumps settle nearby street lighting in one render, even with zero dt", () => {
  const f = fixture();
  f.scene.userData.nightLights = [
    { position: [0, 5, 0], color: 0xffcf91, intensity: 120, distance: 24 },
    { position: [500, 5, 0], color: 0xffcf91, intensity: 120, distance: 24 },
  ];
  const night = createNightLighting(f);
  night.update({ ...f, night: 1, dt: 0, snap: true });
  assert.equal(night.state().activeStreetlights, 1);
  assert.equal(lights(f.scene, "night/street").find(light => light.intensity > 0).intensity, 120);
  f.car.position.x = 500;
  night.update({ ...f, night: 1, dt: 0, snap: true });
  const active = lights(f.scene, "night/street").filter(light => light.intensity > 0);
  assert.equal(active.length, 1); assert.equal(active[0].position.x, 500);
  night.update({ ...f, night: 0, dt: 0, snap: true });
  assert.equal(night.state().activeStreetlights, 0);
  night.dispose(); clearScene(f.scene);
});

test("tagged bindings deduplicate arrays, preserve unrelated emission, clamp night and restore authored values", () => {
  const f = fixture(), room = tagged(2), untagged = tagged(7), basic = new THREE.MeshBasicMaterial();
  delete untagged.userData.nightIntensity;
  untagged.emissiveIntensity = 5;
  room.emissiveIntensity = 0.25;
  const originalColor = room.emissive.clone(); room.userData.nightColor = 0xff3300;
  basic.userData.nightIntensity = 99;
  f.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), [room, room, untagged, basic]));
  const night = createNightLighting(f), version = room.version;
  assert.equal(night.state().materials, 1, "player resources are not retained in the static collection");
  for (const [input, expected] of [[0, 0], [0.5, 0.5], [1, 1], [2, 1], [-1, 0], [NaN, 0]]) {
    night.update({ ...f, night: input });
    assert.equal(room.emissiveIntensity, 2 * expected);
    assert.equal(f.head.emissiveIntensity, 1.8 * expected);
    assert.equal(f.rear.emissiveIntensity, 1.3 * expected);
    assert.equal(untagged.emissiveIntensity, 5);
    assert.equal(room.emissive.getHex(), 0xff3300);
    assert.equal(night.state().materials, 3);
    assert.equal(room.version, version, "brightness changes never recompile materials");
  }
  night.update({ ...f, night: 0, braking: true });
  assert.equal(f.rear.emissiveIntensity, 3, "brakes remain legible in daylight");
  assert.equal(f.head.emissiveIntensity, 0);
  night.update({ ...f, night: 1, braking: false });
  assert.equal(f.rear.emissiveIntensity, 1.3);
  night.dispose();
  assert.equal(room.emissiveIntensity, 0.25); assert.ok(room.emissive.equals(originalColor));
  assert.equal(f.head.emissiveIntensity, 0); assert.equal(f.rear.emissiveIntensity, 0);
  clearScene(f.scene);
});

for (const tablet of [false, true]) test(`${tablet ? "tablet" : "desktop"}: stable scene-owned lights follow +Z, suspension and parent transforms without traversal`, t => {
  const f = fixture(tablet);
  f.scene.position.set(5, -3, 4); f.scene.rotation.y = 0.2;
  f.car.position.set(12, 7, -23); f.car.rotation.set(-0.13, 1.1, 0.08);
  f.visual.position.set(0.1, 0.2, 0.3); f.visual.rotation.z = 0.04;
  f.vehicleModel.car.scale.setScalar(1.1); f.body.position.y = 0.85;
  const night = createNightLighting(f), all = lights(f.scene), heads = lights(f.scene, "night/player");
  assert.equal(all.length, tablet ? 4 : 6);
  assert.equal(heads.length, 2);
  assert.equal(all.filter(o => o.castShadow).length, all.length);
  assert.equal(night.state().shadowedLights, all.length);
  for (const light of all) {
    assert.equal(light.isSpotLight, true); assert.equal(light.parent, f.scene);
    assert.equal(light.target.parent, f.scene); assert.equal(light.intensity, 0);
    assert.ok(light.distance > 0 && light.decay === 2);
    assert.equal(light.shadow.autoUpdate, false); assert.equal(light.shadow.needsUpdate, false);
    assert.deepEqual(light.shadow.mapSize.toArray(), heads.includes(light) && !tablet ? [1024, 1024] : [512, 512]);
  }
  night.update({ ...f, night: 0.75 });
  const noTraversal = () => assert.fail("steady-state lighting must not traverse a model or scene");
  t.mock.method(f.scene, "traverse", noTraversal);
  t.mock.method(f.vehicleModel.car, "traverse", noTraversal);
  for (let frame = 0; frame < 10; frame++) {
    f.car.rotation.y += 0.05; f.body.position.y += 0.02;
    heads.forEach(light => { light.shadow.needsUpdate = false; }); // renderer consumed last frame
    night.update({ ...f, night: 0.75 });
    heads.forEach((light, i) => {
      const lens = new THREE.Vector3().fromArray(f.vehicleModel.car.userData.headlights[i]);
      closeVector(light.getWorldPosition(new THREE.Vector3()), lens.clone().applyMatrix4(f.body.matrixWorld));
      closeVector(light.target.getWorldPosition(new THREE.Vector3()), lens.add(new THREE.Vector3(0, -1.4, 38)).applyMatrix4(f.body.matrixWorld));
      assert.ok(light.intensity > 0); assert.equal(light.shadow.needsUpdate, true);
    });
    assert.deepEqual(lights(f.scene), all);
  }
  f.car.visible = false;
  const visible = []; f.scene.traverseVisible(o => { if (o.isLight) visible.push(o); });
  assert.ok(heads.every(light => visible.includes(light)), "cockpit hiding cannot hide scene-owned beams");
  night.update({ ...f, night: 0 });
  assert.ok(heads.every(light => light.intensity === 0 && !light.shadow.needsUpdate));
  assert.equal(night.state().modelScans, 1);
  night.dispose(); t.mock.restoreAll(); clearScene(f.scene);
});

test("static descriptors transform once from group-local space and malformed descriptors allocate nothing", () => {
  const f = fixture(true), parent = new THREE.Group(), group = new THREE.Group();
  parent.position.set(12, 5, -8); parent.rotation.y = 0.7;
  group.position.set(-4, 2, 3); group.rotation.z = 0.1; group.scale.set(1.2, 1.4, 1.2);
  parent.add(group); f.scene.add(parent);
  group.userData.nightLights = [
    { position: [2, 6, 1], color: 0xffaa44, intensity: 80, distance: 24 },
    { position: [NaN, 2, 3], intensity: 1, distance: 3 },
    { position: [2, 6, 1], intensity: 1, distance: Infinity },
    { position: [2, 6], intensity: 1, distance: 3 },
  ];
  f.scene.updateMatrixWorld(true);
  const position = new THREE.Vector3(2, 6, 1).applyMatrix4(group.matrixWorld);
  const target = position.clone().add(new THREE.Vector3(0, -1, 0).transformDirection(group.matrixWorld));
  f.car.position.copy(position); f.car.position.y -= 5;
  const night = createNightLighting(f);
  assert.equal(night.state().anchors, 1);
  group.position.x += 200; group.userData.nightLights[0].position[0] += 100;
  for (let i = 0; i < 20; i++) night.update({ ...f, night: 1 });
  const street = lights(f.scene, "night/street").find(o => o.intensity > 0);
  assert.ok(street);
  closeVector(street.position, position); closeVector(street.target.position, target);
  assert.equal(street.color.getHex(), 0xffaa44); assert.equal(street.intensity, 80);
  assert.equal(street.distance, 24); assert.equal(street.castShadow, true);
  assert.equal(street.shadow.needsUpdate, true);
  night.dispose(); clearScene(f.scene);
});

test("headlights share a soft dipped-beam map, retain distance and shadowing, and dispose it once", () => {
  const f = fixture(), night = createNightLighting(f), heads = lights(f.scene, "night/player");
  const map = heads[0].map;
  assert.equal(heads[1].map, map);
  assert.equal(map.isDataTexture, true);
  assert.equal(map.colorSpace, THREE.NoColorSpace);
  assert.equal(map.minFilter, THREE.LinearFilter);
  const brightness = (x, y) => map.image.data[(y * 64 + x) * 4];
  assert.equal(brightness(32, 32), 255);
  assert.equal(brightness(32, 0), 0);
  assert.equal(brightness(32, 63), 0);
  assert.equal(brightness(0, 32), 0);
  assert.ok(brightness(32, 16) > 0 && brightness(32, 16) < 128, "near-road hotspot is attenuated");
  night.update({ ...f, night: 1 });
  for (const light of heads) {
    assert.equal(light.intensity, 650);
    assert.equal(light.distance, 85);
    assert.equal(light.castShadow, true);
    assert.ok(light.penumbra > 0.8);
  }
  let disposals = 0;
  map.addEventListener("dispose", () => { disposals++; });
  night.dispose(); night.dispose();
  assert.equal(disposals, 1);
  clearScene(f.scene);
});

test("street pool fades before reassignment, holds ties, has finite reach and never changes its budget", () => {
  const f = fixture(true), group = new THREE.Group(); f.scene.add(group);
  group.userData.nightLights = [0, 4, 40, 44].map(x => ({ position: [x, 6, 0], color: 0xffcc88, intensity: 100, distance: 30 }));
  const night = createNightLighting(f), all = lights(f.scene), streets = lights(f.scene, "night/street");
  for (let i = 0; i < 20; i++) night.update({ ...f, night: 1 });
  assert.deepEqual(streets.map(o => o.position.x).sort((a, b) => a - b), [0, 4]);
  for (let i = 0; i < 12; i++) {
    f.car.position.x = 22 + (i % 2 ? 0.01 : -0.01);
    night.update({ ...f, night: 1 });
    assert.ok(streets.every(o => o.position.x < 10), "hysteresis holds the boundary assignment");
  }
  f.car.position.x = 44;
  let reassignments = 0;
  for (let i = 0; i < 35; i++) {
    const before = streets.map(o => ({ x: o.position.x, intensity: o.intensity }));
    night.update({ ...f, night: 1 });
    streets.forEach((light, index) => {
      if (before[index].x !== light.position.x) { reassignments++; assert.equal(light.intensity, 0, "never move an illuminated light"); }
      assert.ok(Math.abs(light.intensity - before[index].intensity) < 13, "smooth finite fade step");
      assert.equal(light.shadow.needsUpdate, light.intensity > 0);
    });
    assert.deepEqual(lights(f.scene), all);
  }
  assert.equal(reassignments, 2);
  assert.ok(streets.every(o => o.intensity === 100 && o.position.x >= 40));
  f.car.position.set(1e5, 0, 1e5); night.update({ ...f, night: 1 });
  assert.ok(streets.every(o => o.intensity === 0 && !o.shadow.needsUpdate), "finite camera-distance falloff also stops shadow work");
  night.update({ ...f, night: 0 });
  assert.equal(night.state().activeStreetlights, 0); assert.equal(lights(f.scene).length, 4);
  night.update({ night: 1 });
  assert.ok(all.every(o => o.intensity === 0), "no player never leaves stale beams on");
  night.dispose(); clearScene(f.scene);
});

test("street fade-in and fade-out take 0.25 seconds with equivalent uniform or uneven dt and dark reassignment", () => {
  const schedules = [Array(15).fill(1 / 120), [0.02, 0.08, 0.025], [0.0625, 0.0625]];
  for (const steps of schedules) {
    const f = fixture(true), group = new THREE.Group(); f.scene.add(group);
    group.userData.nightLights = [0, 4, 40, 44].map(x => ({ position: [x, 6, 0], intensity: 100, distance: 30 }));
    const night = createNightLighting(f), all = lights(f.scene), streets = lights(f.scene, "night/street");
    let moved = 0;
    // Each phase is 0.125 seconds, irrespective of render cadence. The first
    // update consumes dt too, rather than losing a frame to initial assignment.
    for (const [phase, expected] of [50, 100, 50, 0, 50, 100].entries()) {
      if (phase === 2) f.car.position.x = 44;
      for (const dt of steps) {
        const before = streets.map(light => ({ position: light.position.clone(), intensity: light.intensity }));
        night.update({ ...f, night: 1, dt });
        streets.forEach((light, i) => {
          if (phase >= 2 && !light.position.equals(before[i].position)) {
            moved++;
            assert.equal(light.intensity, 0, "reassign only at the dark endpoint");
          }
          assert.ok(Math.abs(light.intensity - before[i].intensity) <= 100 * 1.5 * dt / 0.25 + 1e-9,
            "brightness change is bounded by elapsed time, not frame count");
          assert.equal(light.shadow.needsUpdate, light.intensity > 0);
        });
        assert.deepEqual(lights(f.scene), all);
      }
      assert.ok(streets.every(light => Math.abs(light.intensity - expected) < 1e-9), `phase ${phase}: ${steps}`);
      if (phase === 3) assert.ok(streets.every(light => light.position.x >= 40), "no extra roundoff frame at 0.25 seconds");
    }
    assert.equal(moved, 2);
    night.dispose(); clearScene(f.scene);
  }
});

for (const tablet of [false, true]) test(`${tablet ? "tablet" : "desktop"}: zero/invalid dt freezes fades, long dt is bounded, and every active street shadow refreshes`, () => {
  const f = fixture(tablet), group = new THREE.Group(); f.scene.add(group);
  group.userData.nightLights = [0, 4, 8, 12].map(x => ({ position: [x, 6, 0], intensity: 100, distance: 30 }));
  const night = createNightLighting(f), all = lights(f.scene), streets = lights(f.scene, "night/street");
  assert.equal(streets.length, tablet ? 2 : 4);
  assert.equal(night.state().shadowedLights, all.length);
  assert.ok(streets.every(light => light.castShadow && light.shadow.mapSize.equals(new THREE.Vector2(512, 512))));
  night.update({ ...f, night: 1, dt: 0 });
  assert.ok(streets.every(light => light.intensity === 0 && !light.shadow.needsUpdate));
  for (const dt of [0, -0.1, NaN, Infinity, -Infinity]) {
    night.update({ ...f, night: 1, dt });
    assert.ok(streets.every(light => light.intensity === 0));
  }
  night.update({ ...f, night: 1, dt: 0.05 });
  assert.ok(streets.every(light => Math.abs(light.intensity - 10.4) < 1e-9));
  const held = streets.map(light => light.intensity);
  for (const dt of [0, -0.1, NaN, Infinity, -Infinity]) {
    all.forEach(light => { light.shadow.needsUpdate = false; }); // renderer consumed the previous request
    night.update({ ...f, night: 1, dt });
    assert.deepEqual(streets.map(light => light.intensity), held);
    assert.ok(all.every(light => light.shadow.needsUpdate && !light.shadow.autoUpdate),
      "even a zero-dt redraw refreshes active shadows for moving geometry");
  }
  night.update({ ...f, night: 1, dt: 10 });
  assert.ok(streets.every(light => Math.abs(light.intensity - 64.8) < 1e-9), "long pauses advance by only 0.1 seconds");
  night.update({ ...f, night: 1, dt: 0.1 });
  assert.ok(streets.every(light => light.intensity === 100));
  assert.equal(night.state().activeStreetlights, streets.length);
  night.update({ ...f, night: 0, dt: 0 });
  assert.ok(all.every(light => light.intensity === 0 && !light.shadow.needsUpdate), "daytime disables stale shadow requests immediately");
  night.update({ ...f, night: 1 });
  const defaultStep = streets.map(light => light.intensity);
  assert.ok(defaultStep.every(intensity => intensity > 0));
  night.update({ ...f, night: 0, dt: 0 });
  night.update({ ...f, night: 1, dt: 1 / 60 });
  assert.deepEqual(streets.map(light => light.intensity), defaultStep, "omitting dt retains the 1/60 default");
  assert.deepEqual(lights(f.scene), all);
  night.dispose();
  assert.equal(night.state().shadowedLights, 0);
  clearScene(f.scene);
});

test("model identity swaps rebind only the player; cleanup restores materials and frees owned shadow maps once", () => {
  const f = fixture(), room = tagged(), friend = tagged(1.4);
  f.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), [room, friend]));
  const night = createNightLighting(f), all = lights(f.scene);
  night.update({ ...f, night: 1 });
  const next = fixture(); next.vehicleModel.car.removeFromParent();
  f.visual.remove(f.vehicleModel.car); f.visual.add(next.vehicleModel.car);
  const oldHead = f.head, oldRear = f.rear;
  night.update({ ...f, vehicleModel: next.vehicleModel, night: 0.5, braking: true });
  assert.equal(night.state().modelScans, 2); assert.equal(night.state().materials, 4);
  assert.equal(oldHead.emissiveIntensity, 0); assert.equal(oldRear.emissiveIntensity, 0);
  oldHead.emissiveIntensity = 7;
  for (let i = 0; i < 10; i++) night.update({ ...f, vehicleModel: next.vehicleModel, night: 0.5 });
  assert.equal(oldHead.emissiveIntensity, 7, "retired materials are no longer touched");
  assert.equal(next.head.emissiveIntensity, 0.9); assert.equal(friend.emissiveIntensity, 0.7);
  assert.deepEqual(lights(f.scene), all);
  let shadowDisposals = 0, materialDisposals = 0;
  for (const light of all.filter(o => o.castShadow)) {
    light.shadow.map = new THREE.WebGLRenderTarget(1, 1);
    light.shadow.map.addEventListener("dispose", () => { shadowDisposals++; });
  }
  room.addEventListener("dispose", () => { materialDisposals++; });
  night.dispose(); night.dispose(); night.update({ ...f, night: 1 });
  assert.equal(shadowDisposals, all.length); assert.equal(materialDisposals, 0);
  assert.ok(all.every(o => o.parent === null && o.target.parent === null));
  assert.equal(next.head.emissiveIntensity, 0); assert.equal(room.emissiveIntensity, 0);
  assert.equal(oldHead.emissiveIntensity, 7);
  assert.equal(night.state().materials, 0); assert.equal(night.state().headlights, 0);
  assert.equal(night.state().shadowedLights, 0);
  assert.equal(night.state().anchors, 0); assert.equal(night.state().disposed, true);
  clearScene(f.vehicleModel.car); clearScene(f.scene); clearScene(next.scene);
});

test("production vehicle lenses bind front versus rear without whitening the Porsche's rear atlas", async () => {
  for (const id of ["tesla", "porsche"]) {
    const model = await vehicle(id), scene = new THREE.Scene(), car = new THREE.Group();
    const heads = new Set(), rears = new Set(), others = new Map();
    car.add(model.car); scene.add(car);
    model.car.traverse(object => {
      assert.ok(!object.isLight, "vehicle builders allocate no actual lights");
      const material = object.material;
      if (!material) return;
      if (material.userData.nightRole === "headlight") {
        heads.add(material);
        object.geometry.computeBoundingBox();
        assert.ok(object.geometry.boundingBox.min.z > 1.2);
      } else if (material.userData.nightRole === "taillight") rears.add(material);
      else others.set(material, material.emissiveIntensity);
    });
    assert.ok(heads.size > 0 && rears.size > 0, id);
    assert.ok([...heads, ...rears].every(m => m.emissiveIntensity === 0));
    assert.equal(model.car.userData.headlights.length, 2);
    for (const [i, position] of model.car.userData.headlights.entries()) {
      assert.ok(position.every(Number.isFinite)); assert.equal(Math.sign(position[0]), i ? 1 : -1);
      assert.ok(position[1] > 0.3 && position[1] < 1.1 && position[2] > 2);
    }
    const night = createNightLighting({ scene });
    for (const suspension of ["stock", "sport", "lift"]) {
      model.visuals.apply({ ...DEFAULTS, suspension });
      car.rotation.set(-0.1, 0.7, 0.03); car.position.set(23, 9, 41);
      night.update({ night: 1, car, vehicleModel: model });
      for (const material of [...heads, ...rears]) assert.equal(material.emissiveIntensity, material.userData.nightIntensity);
      for (const [material, initial] of others) assert.equal(material.emissiveIntensity, initial);
      const body = model.car.getObjectByName("modifier-body");
      lights(scene, "night/player").forEach((light, i) => {
        closeVector(light.position, new THREE.Vector3().fromArray(model.car.userData.headlights[i]).applyMatrix4(body.matrixWorld));
      });
    }
    night.update({ night: 0, car, vehicleModel: model, braking: true });
    assert.ok([...heads].every(m => m.emissiveIntensity === 0));
    assert.ok([...rears].every(m => m.emissiveIntensity === 3));
    night.dispose(); model.dispose();
  }
});

test("friend racer emissive lenses survive batching and never dim the separate name sign", t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const racer = createFriendRacerCar({ name: "Test", color: "#aaff88" }, DEFAULTS), scene = new THREE.Scene();
  scene.add(racer.car);
  const lenses = new Set(), signs = new Set();
  racer.car.traverse(o => { if (o.material?.userData.nightIntensity) lenses.add(o.material); });
  racer.sign.traverse(o => { if (o.material) signs.add(o.material); });
  assert.equal(lenses.size, 2); assert.ok([...lenses].every(m => m.isMeshStandardMaterial));
  assert.ok([...signs].every(m => !lenses.has(m) && m.userData.nightIntensity === undefined));
  const night = createNightLighting({ scene });
  night.update({ night: 1 });
  assert.ok([...lenses].every(m => m.emissiveIntensity === m.userData.nightIntensity));
  night.update({ night: 0 });
  assert.ok([...lenses].every(m => m.emissiveIntensity === 0));
  assert.equal(lights(scene).length, 6);
  night.dispose(); clearScene(scene);
});

test("occupied-room shader composes existing hooks and masks emission for instanced and merged glass without textures", () => {
  const material = new THREE.MeshStandardMaterial();
  let compiled = 0;
  material.onBeforeCompile = shader => { compiled++; shader.uniforms.previous = { value: 2 }; };
  material.customProgramCacheKey = () => "original";
  occupiedWindowEmission(material);
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader);
  assert.equal(compiled, 1); assert.equal(shader.uniforms.previous.value, 2);
  assert.match(material.customProgramCacheKey(), /original\/occupied-rooms/);
  assert.match(shader.vertexShader, /roomPosition = instanceMatrix \* roomPosition/);
  assert.match(shader.fragmentShader, /totalEmissiveRadiance \*= occupied \* inset\.x \* inset\.y/);
  assert.match(shader.fragmentShader, /step\(0\.35, abs\(vRoomNormal\.y\)\)/, "horizontal glass never emits");
  assert.match(shader.fragmentShader, /fwidth\(room\)/, "anti-aliased pane edges");
  assert.equal(material.map, null); assert.equal(material.emissiveIntensity, 0);
  assert.ok(material.emissive.getHex() !== 0 && material.userData.nightIntensity > 0);
  material.dispose();
});

test("world builders publish fixture anchors and night-only bindings while retaining geometry-only budgets", t => {
  for (const tablet of [false, true]) for (const level of ["city", "amsterdam", "wellington"]) {
    const scene = new THREE.Scene(), course = level === "wellington" ? createWellingtonCourse() : createCourse(level);
    const obstacles = [], args = { scene, tablet, course, terrain: course, level, obstacles };
    const world = level === "city" ? createArchitecture(args) : level === "amsterdam" ? createAmsterdamWorld(args) : createWellingtonWorld(args);
    const bindings = new Set();
    let actualLights = 0;
    scene.traverse(object => {
      if (object.isLight) actualLights++;
      if (object.material?.userData.nightIntensity > 0) bindings.add(object.material);
    });
    assert.equal(actualLights, 0); assert.ok(bindings.size > 0);
    assert.ok(obstacles.every(o => !/light|lamp|lantern/.test(o.kind ?? "")), "street lamps never enter shared physics obstacles");
    assert.ok([...bindings].every(m => m.emissiveIntensity === 0 && m.emissive.getHex() !== 0));
    const anchors = world.group.userData.nightLights;
    assert.ok(anchors.length > 20, `${level}: fixtures exist`);
    assert.equal(anchors.length, world.counts.lights);
    for (const anchor of anchors) {
      assert.ok(anchor.position.every(Number.isFinite)); assert.ok(anchor.distance > 0 && anchor.intensity > 0);
      const [x, y, z] = anchor.position;
      if (level === "amsterdam") assert.equal(y, AMSTERDAM.landY + 4.35);
      if (level === "wellington") { assert.ok(isWellingtonLand(x, z)); assert.ok(Math.abs(y - course.heightAt(x, z) - 6.86) < 0.3); }
    }
    if (level === "city" || level === "wellington") {
      assert.ok([...bindings].some(m => m.customProgramCacheKey().includes("occupied-rooms")));
    } else {
      let occupied = 0, unoccupied = 0;
      world.group.traverse(object => {
        for (const part of object.userData.parts ?? []) if (part.name.endsWith("recessed-window-glazing")) {
          if (object.material.userData.nightIntensity) occupied++; else unoccupied++;
        }
      });
      assert.ok(occupied > 0 && unoccupied > occupied * 5, "Amsterdam lights selected panes, not entire facades");
      enableGeometryShadows(scene);
      scene.updateMatrixWorld(true);
      const casters = [];
      scene.traverse(object => { if (object.isMesh && object.castShadow) casters.push(object); });
      for (const anchor of anchors) {
        const ray = new THREE.Raycaster(new THREE.Vector3().fromArray(anchor.position), new THREE.Vector3(0, -1, 0), 0.1, 2);
        assert.equal(ray.intersectObjects(casters, false).length, 0, "lantern sources clear their own opaque masts");
      }
    }
    const night = createNightLighting({ scene, tablet }); night.update({ night: 1 });
    assert.equal(night.state().anchors, anchors.length);
    assert.equal(lights(scene).length, tablet ? 4 : 6);
    assert.ok([...bindings].every(m => m.emissiveIntensity === m.userData.nightIntensity));
    t.diagnostic(`${level}/${tablet ? "tablet" : "desktop"}: ${anchors.length} fixtures, ${world.counts.meshes} meshes, ${world.counts.triangles} triangles`);
    night.dispose(); clearScene(scene);
  }
});

test("landmark occupied panes share palette batches but leave non-window geometry unlit", () => {
  for (const level of ["forest", "city", "stunt", "moon"]) {
    const scene = new THREE.Scene(), terrain = createCourse(level);
    const world = createLandmarks({ scene, level, terrain, obstacles: [], buildingInfo: [], tablet: true });
    const values = new Set(), materials = new Set();
    world.group.traverse(object => {
      assert.ok(!object.isLight);
      if (!object.material?.userData.nightIntensity) return;
      materials.add(object.material);
      for (const value of object.geometry.attributes.nightEmission.array) values.add(value);
      assert.equal(object.material.emissiveIntensity, 0);
    });
    assert.ok(materials.size > 0, level);
    assert.deepEqual([...values].sort(), [0, 1], "emission is authored per pane, not per shared palette color");
    for (const material of materials) {
      const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      material.onBeforeCompile(shader);
      assert.match(shader.fragmentShader, /totalEmissiveRadiance \*= vNightEmission/);
    }
    const night = createNightLighting({ scene }); night.update({ night: 1 });
    assert.ok([...materials].every(m => m.emissiveIntensity > 0));
    night.update({ night: 0 }); assert.ok([...materials].every(m => m.emissiveIntensity === 0));
    night.dispose(); clearScene(scene);
  }
});
