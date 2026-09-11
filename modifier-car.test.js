import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createModifierCar } from "./modifier-car.js";
import { DEFAULTS, PARTS, computeTuning } from "./modifier-data.js";

function close(actual, expected, message, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${message}: ${actual} != ${expected}`);
}

function boundsOf(object) {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

function named(root, name, visible = false) {
  const objects = [];
  root[visible ? "traverseVisible" : "traverse"]((object) => {
    if (object.name === name) objects.push(object);
  });
  return objects;
}

function makeCar({ split = false, width = 0.34, transformed = false } = {}) {
  const root = new THREE.Group();
  root.name = "driving-root";
  if (transformed) {
    root.position.set(23, 0.8, -61);
    root.rotation.set(0.05, 1.2, -0.03);
  }
  const car = new THREE.Group();
  root.add(car);
  const paint = new THREE.MeshStandardMaterial({ color: 0xc60920, roughness: 0.26, metalness: 0.12 });
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x111318, emissive: 0x020304, emissiveIntensity: 0.17 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xaeb4b6, roughness: 0.25, metalness: 0.9 });
  // Include rear bodywork at the sampled booster mount height, not just a cabin.
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 4.6), paint);
  body.position.y = 0.64;
  car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.5, 1.8), paint);
  cabin.position.set(0, 1.05, 0.1);
  car.add(cabin);
  const stockWing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.4), metal);
  stockWing.position.set(0, 1.46, -1.95);
  car.add(stockWing);
  const wheels = [];
  const pieces = [];
  for (const x of [-0.91, 0.91]) {
    for (const z of [-1.42, 1.38]) {
      const geometry = new THREE.CylinderGeometry(0.36, 0.36, width, 32);
      geometry.rotateZ(Math.PI / 2);
      const tire = new THREE.Mesh(geometry, tireMaterial);
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.36, z);
      pivot.add(tire);
      car.add(pivot);
      wheels.push({ pivot, tire, hub: new THREE.Group(), front: z > 0 });
      pieces.push({ mesh: tire, corner: `${x}:${z}` });
      if (split) {
        // Baked material pieces can have different centers, not just widths.
        for (const side of [-1, 1]) {
          const rimGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.035, 24);
          rimGeometry.rotateZ(Math.PI / 2);
          rimGeometry.translate(0, -0.018 * side, 0.012 * side);
          const rim = new THREE.Mesh(rimGeometry, metal);
          const rimPivot = new THREE.Group();
          rimPivot.position.set(x + side * (width / 2 - 0.01), 0.36 + 0.018 * side, z - 0.012 * side);
          rimPivot.add(rim);
          car.add(rimPivot);
          wheels.push({ pivot: rimPivot, tire: rim, hub: new THREE.Group(), front: z > 0 });
          pieces.push({ mesh: rim, corner: `${x}:${z}` });
        }
      } else {
        const rimGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.04, 24);
        rimGeometry.rotateZ(Math.PI / 2);
        const hub = new THREE.Mesh(rimGeometry, metal);
        hub.position.x = Math.sign(x) * width / 2;
        pivot.add(hub);
        wheels[wheels.length - 1].hub = hub;
        pieces.push({ mesh: hub, corner: `${x}:${z}` });
      }
    }
  }
  root.updateMatrixWorld(true);
  const originalMeshes = [];
  car.traverse((object) => {
    if (object.isMesh) originalMeshes.push({ object, geometry: object.geometry, material: object.material, matrix: object.matrixWorld.clone(), visible: object.visible });
  });
  const modifier = createModifierCar({ car, wheels, paint });
  return { modifier, car, root, wheels, paint, tireMaterial, body, cabin, stockWing, originalMeshes, pieces };
}

test("all paint IDs recolor the shared body; rear engines expose 4/6/8 caps or a cyan battery", () => {
  const { modifier, car, paint, body, cabin } = makeCar();
  for (const option of PARTS.find((part) => part.id === "color").options) {
    modifier.apply({ ...DEFAULTS, color: option.id });
    assert.equal(modifier.state().paint, option.hex);
    assert.equal(body.material, paint);
    assert.equal(cabin.material, paint);
    assert.equal(body.material.color.getHexString(), option.hex.slice(1));
  }
  const layout = new Map();
  for (const [engine, expectedCount] of [["four", 4], ["six", 6], ["eight", 8], ["electric", 0]]) {
    const config = Object.freeze({ ...DEFAULTS, engine });
    const tuning = computeTuning(config);
    modifier.apply(config);
    const state = modifier.state();
    const caps = named(car, "modifier-cylinder-cap", true);
    assert.equal(caps.length, expectedCount);
    assert.equal(state.engine.cylinders, expectedCount);
    assert.equal(state.engine.electric, engine === "electric");
    assert.equal(named(car, "modifier-electric-pack", true).length, engine === "electric" ? 1 : 0);
    assert.ok(state.engine.z < -0.8, "engine is on the rear deck, not the front hood");
    car.updateMatrixWorld(true);
    for (const cap of caps) {
      const bounds = boundsOf(cap);
      assert.ok(bounds.min.y > state.engine.deckY + 0.4, "caps are exposed above the sampled deck");
      assert.ok(bounds.max.z < 0, "every cap is on the rear half");
    }
    if (expectedCount > 4) {
      const groups = named(car, "modifier-cylinder", true);
      assert.equal(groups.filter((g) => g.position.x < 0).length, expectedCount / 2);
      assert.equal(groups.filter((g) => g.position.x > 0).length, expectedCount / 2);
      assert.ok(groups.every((g) => g.position.x * g.rotation.z < 0), "two outward tilted V banks");
    }
    if (expectedCount) layout.set(engine, caps[0].material.color.getHex());
    assert.deepEqual(computeTuning(config), tuning, "visual application never changes tuning");
  }
  assert.equal(new Set(layout.values()).size, 3, "combustion options have distinct cap colors too");
  const battery = named(car, "modifier-battery", true)[0];
  assert.ok(battery.material.color.g > battery.material.color.r);
  assert.ok(battery.material.emissiveIntensity > 0.5);
});

test("monster clearance and suspension compose while all four wheel bottoms stay grounded", () => {
  const { modifier, car, wheels, body } = makeCar();
  const stock = modifier.state();
  const originalBodyY = body.getWorldPosition(new THREE.Vector3()).y;
  for (const wheelId of ["standard", "wide", "monster", "hub"]) {
    const lifts = {};
    for (const suspension of ["sport", "standard", "lift"]) {
      modifier.apply({ ...DEFAULTS, wheels: wheelId, suspension });
      const state = modifier.state();
      lifts[suspension] = state.height.bodyLift;
      close(body.getWorldPosition(new THREE.Vector3()).y, originalBodyY + state.height.bodyLift, "body really moves");
      for (let i = 0; i < wheels.length; i++) {
        const bounds = boundsOf(wheels[i].tire);
        close(bounds.min.y, stock.wheels.corners[i].bottomY, "actual tire remains grounded");
        close(state.wheels.corners[i].bottomY, bounds.min.y, "reported ground matches geometry");
      }
      if (wheelId === "monster") {
        assert.ok(state.height.bodyLift > 0.6);
        const bodyBox = boundsOf(body);
        for (let i = 0; i < wheels.length; i++) {
          assert.ok(state.wheels.corners[i].radius > stock.wheels.corners[i].radius * 2);
          assert.ok(Math.abs(wheels[i].pivot.position.x) > Math.abs(stock.wheels.corners[i].center[0]) + 0.5);
          for (const steer of [-0.36, 0, 0.36]) {
            wheels[i].pivot.rotation.y = steer;
            const wheelBox = boundsOf(wheels[i].tire);
            assert.equal(wheelBox.intersectsBox(bodyBox), false, "monster tire clears the body even when steering");
            close(wheelBox.min.y, 0, "steering does not float the wheel");
          }
          wheels[i].pivot.rotation.y = 0;
        }
      }
      if (suspension === "lift" || wheelId === "monster") {
        assert.equal(state.height.springs, 4);
        assert.equal(state.height.axles, 2);
        const coils = named(car, "modifier-coil-spring", true);
        assert.equal(coils.length, 4);
        assert.ok(coils.every((coil) => coil.scale.y > 0.25));
      }
    }
    assert.ok(lifts.sport < lifts.standard - 0.12, "sport visibly lowers the body");
    close(lifts.lift - lifts.standard, 0.68, "lift composes with wheel clearance");
  }
});

test("wide wheels double width; hub motors add exactly four cyan faces without making tires glow", () => {
  const { modifier, car, wheels, tireMaterial } = makeCar({ split: true, width: 0.7 });
  const stock = modifier.state();
  close(stock.wheels.corners[0].radius, 0.36, "rolling radius excludes width");
  const materialState = [tireMaterial.color.getHex(), tireMaterial.emissive.getHex(), tireMaterial.emissiveIntensity];
  modifier.apply({ ...DEFAULTS, wheels: "wide" });
  const wide = modifier.state();
  for (let i = 0; i < wheels.length; i++) {
    const bounds = boundsOf(wheels[i].tire);
    close(bounds.max.x - bounds.min.x, wide.wheels.corners[i].width, "whole wheel widens around one center");
    assert.ok(wide.wheels.corners[i].width > stock.wheels.corners[i].width * 2);
    close(wide.wheels.corners[i].radius, stock.wheels.corners[i].radius, "wide is not taller");
  }
  modifier.apply({ ...DEFAULTS, wheels: "hub", engine: "eight" });
  assert.equal(modifier.state().wheels.motorHubs, 4);
  assert.equal(modifier.state().engine.cylinders, 8, "hub motors can augment the rear engine");
  const hubs = named(car, "modifier-motor-hub", true);
  assert.equal(hubs.length, 4);
  assert.ok(hubs.every((hub) => hub.material.emissiveIntensity >= 0.8));
  assert.ok(hubs.every((hub) => hub.material !== tireMaterial));
  assert.deepEqual([tireMaterial.color.getHex(), tireMaterial.emissive.getHex(), tireMaterial.emissiveIntensity], materialState);
  modifier.apply(DEFAULTS);
  assert.equal(named(car, "modifier-motor-hub", true).length, 0);
  assert.deepEqual(modifier.state().wheels, stock.wheels);
});

test("material-piece records consolidate into four common-center steer/tire/hub assemblies", () => {
  const { modifier, car, wheels, pieces, originalMeshes } = makeCar({ split: true, transformed: true });
  assert.equal(wheels.length, 4);
  assert.equal(modifier.state().wheels.count, 4);
  assert.equal(wheels.filter((w) => w.front).length, 2);
  const partCount = pieces.length / 4;
  for (const wheel of wheels) {
    assert.equal(wheel.tire.parent, wheel.pivot);
    assert.equal(wheel.hub.parent, wheel.pivot, "the old loop must not spin hubs twice");
    assert.notEqual(wheel.tire, wheel.hub);
    assert.equal(wheel.tire.children.length, partCount);
  }
  car.updateWorldMatrix(true, true);
  for (const before of originalMeshes) {
    before.matrix.elements.forEach((value, i) => close(before.object.matrixWorld.elements[i], value, "consolidation preserves imported world transforms"));
  }
  modifier.apply({ ...DEFAULTS, wheels: "monster" });
  for (const wheel of wheels) {
    // This is the original game's frame loop API, including its separate hub spin.
    wheel.pivot.rotation.y = wheel.front ? 0.36 : 0;
    wheel.tire.rotation.x += 0.7;
    wheel.hub.rotation.x += 0.7;
    const angle = wheel.tire.rotation.x;
    modifier.apply({ ...DEFAULTS, wheels: "hub", engine: "six" });
    close(wheel.tire.rotation.x, angle, "option changes retain drive rotation");
    close(wheel.hub.rotation.x, angle, "motor overlay has matching spin");
    const geometryCenters = [];
    for (const pivot of wheel.tire.children) {
      const part = pivot.children[0];
      part.geometry.computeBoundingBox();
      const center = part.geometry.boundingBox.getCenter(new THREE.Vector3());
      part.updateWorldMatrix(true, false);
      center.applyMatrix4(part.matrixWorld);
      wheel.pivot.worldToLocal(center);
      geometryCenters.push(center);
    }
    for (const center of geometryCenters) {
      close(center.y, 0, "rim and tire share the Y spin center");
      close(center.z, 0, "rim and tire share the Z spin center");
    }
  }
});

test("large wings clear the stock wing and mega is double-decker", () => {
  const { modifier, car, stockWing } = makeCar();
  modifier.apply({ ...DEFAULTS, spoiler: "big" });
  const big = modifier.state();
  const stockTop = boundsOf(stockWing).max.y;
  const wing = named(car, "modifier-wing", true)[0];
  assert.ok(boundsOf(wing).min.y > stockTop + 0.45);
  assert.equal(stockWing.visible, true);
  assert.ok(named(car, "modifier-wing-mount", true).every((m) => m.scale.y > 0.7));
  modifier.apply({ ...DEFAULTS, spoiler: "mega", rocket: "big" });
  assert.ok(modifier.state().spoiler.width > big.spoiler.width * 1.3);
  assert.ok(modifier.state().spoiler.topY > big.spoiler.topY + 0.5);
  assert.equal(named(car, "modifier-second-wing", true).length, 1);
  modifier.apply(DEFAULTS);
  assert.equal(named(car, "modifier-wing", true).length, 0);
});

test("owned boosters select twin side nozzles, one big rear nozzle, or no hardware", () => {
  const { modifier, body } = makeCar();
  const { rocket, flame, housing, state, animateFlame } = modifier.boosters;
  assert.equal(typeof animateFlame, "function");
  assert.equal(rocket.name, "car-boosters");
  assert.equal(rocket.parent, body.parent, "boosters attach to the suspended body, not the driving root");
  assert.equal(flame.parent, rocket);
  assert.equal(flame.name, "boost-flames");
  const names = ["booster-side-left", "booster-side-right", "booster-rear"];
  const groups = names.map(name => rocket.getObjectByName(name));
  assert.equal(rocket.children.length, 4, "three prebuilt boosters and one independent flame root");
  assert.deepEqual(flame.children.map(plume => plume.name), names.map(name => `${name}-flame`));
  for (const group of groups) {
    assert.equal(group.parent, rocket);
    assert.equal(named(group, "booster-nozzle").length, 1);
    assert.equal(named(group, "booster-mount").length, group.name === "booster-rear" ? 1 : 2);
    assert.equal(named(group, "booster-mount-foot").length, group.name === "booster-rear" ? 0 : 2);
  }
  assert.equal(housing, groups[2].getObjectByName("booster-nozzle"));
  assert.ok(groups[0].position.x < boundsOf(body).min.x);
  assert.ok(groups[1].position.x > boundsOf(body).max.x);
  close(groups[2].position.x, 0, "big booster is centered at the rear");
  assert.ok(boundsOf(housing).max.z < boundsOf(body).min.z, "big nozzle projects behind the car");
  const positions = groups.map(group => group.position.toArray());
  for (const option of ["small", "big", "none", "small"]) {
    modifier.apply({ ...DEFAULTS, rocket: option });
    const active = option === "small" ? names.slice(0, 2) : option === "big" ? names.slice(2) : [];
    assert.deepEqual(groups.filter(group => group.visible).map(group => group.name), active);
    assert.deepEqual(flame.children.filter(plume => plume.visible).map(plume => plume.name), active.map(name => `${name}-flame`));
    assert.deepEqual(state(), { visible: option !== "none", count: active.length, scale: option === "big" ? [1.8, 1.8, 1.8] : [1, 1, 1] });
    assert.deepEqual(modifier.state().rocket, state());
    assert.deepEqual(rocket.scale.toArray(), [1, 1, 1], "scale belongs to each nozzle, never the shared root");
    assert.deepEqual(groups.map(group => group.position.toArray()), positions, "switching layouts cannot move their mounts");
    assert.equal(flame.visible, false, "configuration does not start boost");
  }
  const beforeLift = groups.map(group => group.getWorldPosition(new THREE.Vector3()).y);
  modifier.apply({ ...DEFAULTS, suspension: "lift" });
  groups.forEach((group, i) => close(group.getWorldPosition(new THREE.Vector3()).y - beforeLift[i], .68, "each booster follows body lift"));
});

test("flame flicker scales each plume at its own outlet, without moving hardware or controlling boost", () => {
  const { modifier, car } = makeCar({ transformed: true });
  const { rocket, flame, animateFlame } = modifier.boosters;
  for (const option of ["small", "big"]) {
    modifier.apply({ ...DEFAULTS, rocket: option, wheels: "monster", suspension: "lift" });
    const state = modifier.state().rocket;
    for (const scale of [[.65, 1.3, .45], [1.4, .75, 1.8], [1, 1, 1]]) {
      car.updateWorldMatrix(true, true);
      const hardware = named(rocket, "booster-nozzle").map(nozzle => nozzle.matrixWorld.toArray());
      animateFlame(...scale);
      assert.equal(flame.visible, false, "animating flicker must not ignite the flame");
      assert.deepEqual(modifier.state().rocket, state, "flame scale is not the reported nozzle scale");
      for (const plume of flame.children) {
        const group = rocket.getObjectByName(plume.name.replace(/-flame$/, ""));
        const nozzle = group.getObjectByName("booster-nozzle");
        nozzle.geometry.computeBoundingBox();
        const outlet = nozzle.localToWorld(new THREE.Vector3(0, 0, nozzle.geometry.boundingBox.min.z));
        close(plume.getWorldPosition(new THREE.Vector3()).distanceTo(outlet), 0, `${plume.name}: origin stays at the nozzle outlet`);
        assert.deepEqual(plume.scale.toArray(), scale.map(value => value * group.scale.x));
        assert.equal(plume.children.length, 2, "outer flame and bright core remain separately anchored meshes");
        for (const mesh of plume.children) {
          mesh.geometry.computeBoundingBox();
          const bounds = mesh.geometry.boundingBox;
          close(bounds.max.z, 0, "plume geometry starts at the outlet, not at the cone midpoint");
          assert.ok(bounds.min.z < 0, "plume points backward");
          close(mesh.localToWorld(new THREE.Vector3(0, 0, bounds.max.z)).distanceTo(outlet), 0, "scaled flame base cannot open a gap");
        }
      }
      car.updateWorldMatrix(true, true);
      assert.deepEqual(named(rocket, "booster-nozzle").map(nozzle => nozzle.matrixWorld.toArray()), hardware);
    }
  }
  flame.visible = true;
  for (const option of ["small", "none", "big", "none"]) {
    modifier.apply({ ...DEFAULTS, rocket: option });
    assert.equal(flame.visible, true, "configuration leaves the driving loop's boost switch alone");
    assert.equal(named(car, "booster-plume", true).length, option === "small" ? 4 : option === "big" ? 2 : 0);
    if (option === "none") assert.ok(flame.children.every(plume => !plume.visible), "none hides every child even during an active boost");
  }
});

test("repeat applications are reversible and idempotent with stable meshes, geometry, materials and root pose", () => {
  const { modifier, car, root, originalMeshes, wheels } = makeCar({ split: true, transformed: true });
  const baseline = modifier.state();
  const rootPosition = root.position.clone();
  const rootRotation = root.quaternion.clone();
  const visualPosition = car.position.clone();
  const visualRotation = car.quaternion.clone();
  const objects = new Set();
  const geometries = new Set();
  const materials = new Set();
  let disposed = 0;
  car.traverse((object) => {
    objects.add(object);
    if (object.isMesh) {
      geometries.add(object.geometry);
      materials.add(object.material);
      object.geometry.addEventListener("dispose", () => disposed++);
      object.material.addEventListener("dispose", () => disposed++);
    }
  });
  // Capture each prebuilt engine material as well as the initially assigned one.
  for (const engine of ["six", "eight", "electric"]) {
    modifier.apply({ ...DEFAULTS, engine });
    car.traverse((object) => { if (object.isMesh) materials.add(object.material); });
  }
  for (let i = 0; i < 24; i++) {
    const config = Object.fromEntries(PARTS.map((part) => [part.id, part.options[i % part.options.length].id]));
    modifier.apply(config);
    const once = modifier.state();
    const transforms = [];
    car.traverse(object => transforms.push([object.position.toArray(), object.quaternion.toArray(), object.scale.toArray(), object.visible]));
    modifier.apply(config);
    assert.deepEqual(modifier.state(), once);
    const repeated = [];
    car.traverse(object => repeated.push([object.position.toArray(), object.quaternion.toArray(), object.scale.toArray(), object.visible]));
    assert.deepEqual(repeated, transforms, "idempotence includes actual mounts and outlet anchors, not just state");
    assert.equal(modifier.boosters.flame.visible, false, "repeated configuration never starts boost");
    let count = 0;
    car.traverse((object) => {
      count++;
      assert.ok(objects.has(object), "no new scene objects per click");
      if (object.isMesh) {
        assert.ok(geometries.has(object.geometry), "no new geometry per click");
        assert.ok(materials.has(object.material), "no new materials per click");
      }
    });
    assert.equal(count, objects.size);
  }
  modifier.apply(DEFAULTS);
  assert.deepEqual(modifier.state(), baseline);
  car.updateWorldMatrix(true, true);
  for (const before of originalMeshes) {
    assert.equal(before.object.geometry, before.geometry);
    assert.equal(before.object.material, before.material);
    assert.equal(before.object.visible, before.visible);
    before.matrix.elements.forEach((value, i) => close(before.object.matrixWorld.elements[i], value, "restored imported transform"));
  }
  assert.deepEqual(root.position, rootPosition);
  assert.deepEqual(root.quaternion.toArray(), rootRotation.toArray());
  assert.deepEqual(car.position, visualPosition);
  assert.deepEqual(car.quaternion.toArray(), visualRotation.toArray());
  assert.equal(wheels.length, 4);
  assert.equal(disposed, 0, "shared imported resources are never disposed");
});

test("the licensed Porsche's actual geometry has grounded corners and an exposed rear engine", async () => {
  const loader = new GLTFLoader();
  // Textures need browser image APIs; this regression test only needs geometry.
  loader.register(() => ({ name: "geometry-only-test", loadTexture: () => Promise.resolve(null) }));
  const bytes = await readFile(new URL("./porsche-gt3-rs.glb", import.meta.url));
  const { scene: model } = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  let bounds = boundsOf(model);
  const size = bounds.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(4.6 / Math.max(size.x, size.z));
  bounds = boundsOf(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -bounds.min.y, -center.z);
  model.updateMatrixWorld(true);
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xc60920, side: THREE.DoubleSide });
  const wheels = [];
  model.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    object.material.side = THREE.DoubleSide;
    const name = object.material.name;
    const material = name.includes("Paint_Material") ? paint : object.material;
    const mesh = new THREE.Mesh(geometry, material);
    if (name.includes("_Wheel1A_")) {
      geometry.computeBoundingBox();
      const center = geometry.boundingBox.getCenter(new THREE.Vector3());
      geometry.translate(-center.x, -center.y, -center.z);
      const pivot = new THREE.Group();
      pivot.position.copy(center);
      pivot.add(mesh);
      car.add(pivot);
      wheels.push({ pivot, tire: mesh, hub: new THREE.Group(), front: center.z > 0 });
    } else car.add(mesh);
  });
  const pieceCount = wheels.length;
  assert.ok(pieceCount > 4, "the real asset has several pieces per physical wheel");
  const modifier = createModifierCar({ car, wheels, paint });
  const stock = modifier.state();
  assert.equal(wheels.length, 4);
  assert.ok(stock.wheels.corners.every((w) => w.radius > 0.2 && w.radius < 0.6));
  modifier.apply({ ...DEFAULTS, suspension: "sport" });
  const sport = modifier.state();
  assert.ok(sport.height.bodyLift < -0.04, "the actual Porsche can visibly lower");
  assert.ok(sport.height.clearance >= 0.025 - 1e-6, "sport keeps the original body above ground");
  modifier.apply({ ...DEFAULTS, wheels: "monster", suspension: "lift", engine: "eight" });
  for (let i = 0; i < wheels.length; i++) {
    close(boundsOf(wheels[i].tire).min.y, stock.wheels.corners[i].bottomY, "real monster wheels remain grounded", 1e-5);
  }
  assert.equal(named(car, "modifier-cylinder-cap", true).length, 8);
  assert.equal(named(car, "modifier-coil-spring", true).length, 4);
  for (const cap of named(car, "modifier-cylinder-cap", true)) {
    assert.ok(boundsOf(cap).min.y > modifier.state().engine.deckY + 0.4);
  }
  const ray = new THREE.Raycaster();
  const eye = new THREE.Vector3(Math.sin(2.45) * Math.cos(0.78), Math.sin(0.78), Math.cos(2.45) * Math.cos(0.78));
  eye.multiplyScalar(8).add(new THREE.Vector3(0, 1.1, 0));
  for (const engine of ["four", "six", "eight"]) {
    for (const spoiler of ["stock", "big", "mega"]) {
      modifier.apply({ ...DEFAULTS, engine, spoiler });
      car.updateMatrixWorld(true);
      const visibleMeshes = [];
      car.traverseVisible((object) => { if (object.isMesh) visibleMeshes.push(object); });
      for (const cap of named(car, "modifier-cylinder-cap", true)) {
        const target = cap.localToWorld(new THREE.Vector3(0, 0.48, 0));
        ray.set(eye, target.sub(eye).normalize());
        const hit = ray.intersectObjects(visibleMeshes, false)[0];
        assert.ok(hit?.object === cap, `${engine}/${spoiler}: cap is obscured by ${hit?.object.name || "imported body"}`);
      }
    }
  }
});
