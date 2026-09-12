import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { prepareUtilityVehicleModel } from "./utility-vehicles.js";
import { loadVehicleModel, prepareVehicleModel } from "./vehicle-model.js";
import { VEHICLES } from "./vehicle-data.js";
import { DEFAULTS, PARTS } from "./modifier-data.js";

const vehicles = [
  { id: "backhoe", name: "Backhoe Loader", file: "backhoe-loader.glb", utility: true, length: 8.8, engine: "four" },
  { id: "dhl-van", name: "DHL Delivery Van", file: "dhl-delivery-van.glb", utility: true, length: 5.8, engine: "four" },
];
async function asset(vehicle) {
  const bytes = await readFile(new URL(vehicle.file, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: "geometry-only-test", loadTexture: () => Promise.resolve(null) }));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}
function allResources(root) {
  const resources = new Set();
  root.traverse(object => {
    if (!object.isMesh) return;
    resources.add(object.geometry);
    for (const material of [].concat(object.material)) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  return resources;
}
function indexedPoints(object, group) {
  const result = [], geometry = object.geometry;
  for (let i = group.start; i < group.start + group.count; i++) {
    result.push(new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, geometry.index.getX(i)).applyMatrix4(object.matrixWorld));
  }
  return result;
}

for (const vehicle of vehicles) {
  test(`${vehicle.id}: source GLB is self-contained, valid, small and +Z-forward`, async () => {
    const bytes = await readFile(new URL(vehicle.file, import.meta.url));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.ok(bytes.length < 260_000);
    const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
    assert.equal(json.asset.version, "2.0");
    assert.ok(!(json.extensionsRequired || []).some(name => /draco|meshopt|basisu/i.test(name)));
    for (const resource of [...json.buffers, ...json.images]) {
      assert.ok(resource.uri === undefined || /^data:image\/png;base64,/.test(resource.uri));
    }
    assert.equal(json.images.length, 1);
    const png = Buffer.from(json.images[0].uri.split(",")[1], "base64");
    assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a");
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [512, 512]);
    const { scene } = await asset(vehicle);
    try {
      assert.equal(scene.getObjectByName("body").material.name, "colormap");
      for (const position of ["front", "back"]) for (const side of ["left", "right"]) {
        const node = scene.getObjectByName(`wheel-${position}-${side}`);
        assert.ok(node?.isMesh);
        assert.equal(Math.sign(node.position.z), position === "front" ? 1 : -1);
        assert.ok(node.geometry.attributes.position.count > 500, "use real source tires, not proxy cylinders");
      }
      if (vehicle.id === "backhoe") {
        const shovel = scene.getObjectByName("shovel");
        assert.equal(shovel.parent.name, "body");
        assert.ok(shovel.position.z > .6);
      }
      scene.traverse(object => {
        if (!object.isMesh) return;
        for (const attribute of Object.values(object.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
        assert.ok(object.geometry.index.array.every(index => index < object.geometry.attributes.position.count));
      });
    } finally { for (const resource of allResources(scene)) resource.dispose(); }
  });

  test(`${vehicle.id}: binds real grounded wheels, oversized dimensions and isolated atlas paint`, async t => {
    const { scene } = await asset(vehicle);
    const sourceBody = scene.getObjectByName("body"), sourceAtlas = sourceBody.material;
    const sourceWheelGeometry = scene.getObjectByName("wheel-front-left").geometry;
    const sourceShovel = scene.getObjectByName("shovel");
    const model = prepareUtilityVehicleModel(scene, vehicle);
    t.after(() => model.dispose());
    assert.equal(model.car.getObjectByName("body"), sourceBody);
    assert.equal(model.vehicle, vehicle);
    assert.equal(model.paint.color.getHex(), 0xe6c310);
    assert.equal(sourceBody.material[0], sourceAtlas);
    assert.equal(sourceAtlas.color.getHex(), 0xffffff, "do not yellow-tint the shared glass/rubber atlas");
    assert.equal(sourceBody.material[1], model.paint);
    assert.equal(sourceBody.material[2].name, "utility-glass");
    assert.notEqual(sourceBody.material[2], model.paint);
    assert.ok(sourceBody.userData.sourcePaintTriangles > 90);
    assert.equal(model.car.getObjectByName("wheel-front-left").geometry, sourceWheelGeometry);
    assert.equal(model.wheels.length, 4);
    assert.equal(model.wheels.filter(wheel => wheel.front).length, 2);
    const dimensions = model.car.userData.dimensions;
    assert.ok(Math.abs(dimensions.length - vehicle.length) < 1e-6);
    assert.ok(dimensions.width > (vehicle.id === "backhoe" ? 3.4 : 3));
    assert.ok(dimensions.height > (vehicle.id === "backhoe" ? 3.1 : 2.7));
    const stock = model.visuals.state();
    for (const [i, wheel] of model.wheels.entries()) {
      assert.ok(stock.wheels.corners[i].radius > (vehicle.id === "backhoe" ? .5 : .6));
      assert.ok(Math.abs(stock.wheels.corners[i].bottomY) < 1e-6);
      assert.equal(Math.sign(wheel.pivot.position.z), wheel.front ? 1 : -1);
      const center = wheel.pivot.position.clone();
      for (const angle of [0, Math.PI / 2, Math.PI]) {
        wheel.tire.rotation.x = angle;
        const bounds = new THREE.Box3().setFromObject(wheel.tire, true);
        assert.ok(bounds.getCenter(new THREE.Vector3()).distanceTo(center) < 1e-5, "spin around the real common axle");
      }
      wheel.tire.rotation.x = 0;
    }
    if (sourceShovel) {
      assert.equal(model.car.getObjectByName("shovel"), sourceShovel);
      assert.equal(sourceShovel.parent.name, "modifier-body");
      assert.ok(sourceShovel.position.z > 1);
    }
    assert.ok(model.special.anchor.isObject3D);
    assert.ok(model.car.userData.headlights.every(([x, y, z]) => Math.abs(x) > .7 && y > 1 && z > 1.8));
    const groups = sourceBody.geometry.groups;
    const painted = groups.find(group => group.materialIndex === 1);
    const retained = groups.find(group => group.materialIndex === 0);
    assert.ok(painted.count > 0 && retained.count > 0);
    for (let i = painted.start; i < painted.start + painted.count; i++) {
      const vertex = sourceBody.geometry.index.getX(i);
      const u = sourceBody.geometry.attributes.uv.getX(vertex);
      assert.ok(Math.abs(u - .34375) > .01, "rubber swatch must not be painted");
    }
  });

  test(`${vehicle.id}: deterministic finite special cycle, reset and all modifier combinations`, async t => {
    const { scene } = await asset(vehicle);
    const model = prepareUtilityVehicleModel(scene, vehicle);
    t.after(() => model.dispose());
    const rest = model.special.anchor.getWorldPosition(new THREE.Vector3());
    const animated = vehicle.id === "backhoe"
      ? ["shovel", "backhoe-boom", "backhoe-dipper", "backhoe-bucket"]
      : ["van-rear-door--1", "van-rear-door-1"];
    const restRotations = animated.map(name => model.car.getObjectByName(name).rotation.toArray());
    for (let i = 0; i <= 100; i++) {
      model.special.pose(i / 100);
      model.car.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite), object.name));
      const point = model.special.anchor.getWorldPosition(new THREE.Vector3());
      assert.ok(point.y >= 0 && point.y < 4);
      for (const name of animated) assert.ok(new THREE.Box3().setFromObject(model.car.getObjectByName(name), true).min.y > -.001, name);
    }
    model.special.pose(.5);
    assert.ok(animated.every((name, i) => model.car.getObjectByName(name).rotation.toArray().some((value, j) => value !== restRotations[i][j])));
    for (const p of [1, -1, NaN, Infinity, undefined]) {
      model.special.pose(p);
      assert.ok(model.special.anchor.getWorldPosition(new THREE.Vector3()).distanceTo(rest) < 1e-7);
      assert.deepEqual(animated.map(name => model.car.getObjectByName(name).rotation.toArray()), restRotations);
    }
    model.special.pose(.6); model.special.reset(); model.special.reset();
    assert.ok(model.special.anchor.getWorldPosition(new THREE.Vector3()).distanceTo(rest) < 1e-7);
    assert.equal(model.rocket, model.visuals.boosters.rocket);
    assert.equal(model.flame, model.visuals.boosters.flame);
    assert.equal(model.housing, model.visuals.boosters.housing);
    assert.equal(model.flag.group.parent.name, "modifier-body");
    const defaults = { ...DEFAULTS, color: "yellow", engine: "four" };
    for (const part of PARTS) for (const option of part.options) {
      model.visuals.apply({ ...defaults, [part.id]: option.id });
      model.special.pose(.32);
      model.flag.update(1 / 60, 10, 12, .4);
      model.visuals.boosters.animateFlame(1, .9, 1.1);
      model.car.traverse(object => {
        assert.ok(object.matrixWorld.elements.every(Number.isFinite), object.name);
        assert.equal(object.castShadow, false);
      });
      const state = model.visuals.state();
      assert.equal(state.wheels.count, 4);
      assert.ok(state.wheels.corners.every(corner => Math.abs(corner.bottomY) < 1e-6));
      if (part.id === "color") assert.equal(state.paint, option.hex);
      if (part.id === "engine") assert.equal(state.engine.cylinders, { four: 4, six: 6, eight: 8, electric: 0 }[option.id]);
      if (part.id === "rocket") assert.equal(state.rocket.count, { none: 0, small: 2, big: 1 }[option.id]);
    }
    for (const wheels of ["standard", "wide", "monster", "hub"]) for (const suspension of ["standard", "sport", "lift"]) {
      model.visuals.apply({ ...defaults, wheels, suspension, rocket: "big", spoiler: "mega" });
      for (let frame = 0; frame <= 50; frame++) {
        const p = frame / 50;
        model.special.pose(p);
        const nozzle = new THREE.Box3().setFromObject(model.housing, true);
        for (const wheel of model.wheels) {
          assert.equal(nozzle.intersectsBox(new THREE.Box3().setFromObject(wheel.tire, true)), false, "big booster clears upgraded tires");
        }
        const bucketOrDoors = vehicle.id === "backhoe" ? ["shovel", "backhoe-bucket"] : animated;
        for (const name of bucketOrDoors) {
          const bounds = new THREE.Box3().setFromObject(model.car.getObjectByName(name), true);
          assert.equal(nozzle.intersectsBox(bounds), false, `rear booster clears ${name}`);
          assert.ok(bounds.min.y > -.001, `${name} clears ground with ${suspension} suspension`);
        }
      }
    }
    model.visuals.apply({ ...defaults, suspension: "lift" });
    model.special.reset();
    assert.ok(Math.abs(model.special.anchor.getWorldPosition(new THREE.Vector3()).y - rest.y - .68) < 1e-6);
  });

  test(`${vehicle.id}: every source, atlas bitmap, authored part, flag and modifier resource is disposed once`, async () => {
    const { scene } = await asset(vehicle);
    let closes = 0;
    const atlas = new THREE.Texture({ close() { closes++; } });
    scene.getObjectByName("body").material.map = atlas;
    const counts = new Map();
    function track(root) {
      for (const resource of allResources(root)) if (!counts.has(resource)) {
        counts.set(resource, 0);
        resource.addEventListener("dispose", () => counts.set(resource, counts.get(resource) + 1));
      }
    }
    track(scene);
    const model = prepareUtilityVehicleModel(scene, vehicle);
    for (const engine of ["four", "six", "eight", "electric"]) {
      model.visuals.apply({ ...DEFAULTS, engine });
      track(model.car);
    }
    assert.ok([...counts.values()].every(count => count === 0));
    model.dispose(); model.dispose(); model.special.pose(.5); model.special.reset();
    assert.equal(closes, 1);
    assert.ok([...counts.values()].every(count => count === 1));
    assert.equal(model.car.children.length, 0);
    assert.equal(model.car.parent, null);
  });
}

test("DHL markings face outward on both sides and both real opening rear doors", async t => {
  const vehicle = vehicles[1], { scene } = await asset(vehicle);
  const model = prepareUtilityVehicleModel(scene, vehicle);
  t.after(() => model.dispose());
  const markings = [];
  model.car.traverse(object => { if (object.isMesh && object.name.startsWith("DHL-")) markings.push(object); });
  assert.equal(markings.length, 4);
  for (const marking of markings) {
    assert.equal(marking.material.name, "DHL-red-marking");
    assert.equal(marking.material.color.getHex(), 0xd40511);
    assert.ok(marking.geometry.index.count > 100);
    const direction = new THREE.Vector3(0, 0, 1).transformDirection(marking.matrixWorld);
    if (marking.name === "DHL-rear") {
      assert.ok(direction.z < -.99);
      assert.match(marking.parent.name, /^van-rear-door-/);
    } else assert.equal(Math.sign(direction.x), Math.sign(marking.getWorldPosition(new THREE.Vector3()).x));
  }
  const from = new THREE.Vector3(.30, 1.7, -6), direction = new THREE.Vector3(0, 0, 1);
  const ray = new THREE.Raycaster(from, direction);
  const doors = [-1, 1].map(side => model.car.getObjectByName(`van-rear-door-${side}`));
  assert.ok(ray.intersectObjects(doors, true).length > 0, "doors close the cargo opening");
  model.special.pose(.5);
  assert.equal(ray.intersectObjects(doors, true).length, 0, "doors swing out of the opening");
  assert.ok(doors.every(door => new THREE.Box3().setFromObject(door, true).max.z < -2.7), "doors open rearward, not into the cargo body");
  const hits = ray.intersectObject(model.car.getObjectByName("body"), false);
  assert.ok(hits.every(hit => hit.point.z > -2), "no fixed rear skin is left behind the opening doors");
  model.visuals.apply({ ...DEFAULTS, color: "blue" });
  assert.ok(markings.every(marking => marking.material.color.getHex() === 0xd40511));
  const body = model.car.getObjectByName("body");
  const paint = body.geometry.groups.find(group => group.materialIndex === 1);
  assert.ok(indexedPoints(body, paint).some(point => point.y > 2.3 && point.z < 0), "cargo panels belong to painted source geometry");
});

test("utility metadata routes production preparation/loading without flattening; cancellation and failure release the scene", async t => {
  // Register fixtures only when running independently of the parallel registry edit.
  for (const vehicle of vehicles) if (!VEHICLES.some(entry => entry.id === vehicle.id)) {
    VEHICLES.push(vehicle);
    t.after(() => VEHICLES.splice(VEHICLES.indexOf(vehicle), 1));
  }
  for (const vehicle of vehicles) {
    const { scene } = await asset(vehicle);
    const ready = prepareVehicleModel(scene, vehicle.id);
    assert.equal(ready.vehicle.id, vehicle.id);
    assert.ok(ready.special.anchor.isObject3D);
    ready.dispose();
  }
  const vehicle = vehicles[0];
  const bytes = await readFile(new URL(vehicle.file, import.meta.url));
  const fetch = t.mock.method(globalThis, "fetch", async file => {
    assert.equal(file, vehicle.file);
    return new Response(bytes);
  });
  const { scene: loaded } = await asset(vehicle);
  const { scene: cancelled } = await asset(vehicle);
  const parser = t.mock.method(GLTFLoader.prototype, "parseAsync", async () => ({ scene: loaded }));
  const ready = await loadVehicleModel(vehicle.id);
  assert.ok(ready.special);
  ready.dispose();
  await assert.rejects(loadVehicleModel(vehicle.id, { signal: AbortSignal.abort() }), { name: "AbortError" });
  fetch.mock.mockImplementation(async () => new Response(null, { status: 404 }));
  await assert.rejects(loadVehicleModel(vehicle.id), /404/);
  fetch.mock.mockImplementation(async () => new Response(bytes));
  const controller = new AbortController();
  let closes = 0;
  cancelled.getObjectByName("body").material.map = new THREE.Texture({ close() { closes++; } });
  parser.mock.mockImplementation(async () => { controller.abort(); return { scene: cancelled }; });
  await assert.rejects(loadVehicleModel(vehicle.id, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(closes, 1, "aborting during parsing closes the uninstalled scene's atlas bitmap");
});

test("invalid utility geometry releases resources even if preparation fails partway through", async () => {
  const { scene } = await asset(vehicles[0]);
  scene.getObjectByName("wheel-back-right").name = "invalid-wheel";
  const counts = new Map([...allResources(scene)].map(resource => [resource, 0]));
  for (const resource of counts.keys()) resource.addEventListener("dispose", () => counts.set(resource, counts.get(resource) + 1));
  assert.throws(() => prepareUtilityVehicleModel(scene, vehicles[0]), /missing wheel-back-right/);
  assert.ok([...counts.values()].every(count => count === 1));
});
