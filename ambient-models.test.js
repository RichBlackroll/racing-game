import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAmbientModel } from "./ambient-models.js";
import { enableGeometryShadows } from "./daylight.js";

const TYPES = ["balloon", "rocket", "elephant", "plane", "helicopter", "birds", "kite", "airship", "ufo", "satellite", "comet", "astronaut"];

function snapshot(group) {
  const result = [];
  const components = value => value.toArray().map(number => number === 0 ? 0 : number);
  group.traverse(object => {
    result.push({ name: object.name, position: components(object.position), rotation: components(object.quaternion),
      scale: components(object.scale), visible: object.visible,
      instances: object.isInstancedMesh ? Array.from(object.instanceMatrix.array) : null,
      material: object.isMesh ? [object.material.color.toArray(), object.material.emissiveIntensity, object.material.opacity] : null });
  });
  return result;
}

function budget(group) {
  let draws = 0, triangles = 0;
  const materials = new Set(), geometries = new Set();
  group.traverse(object => {
    if (!object.isMesh) return;
    assert.ok(!Array.isArray(object.material), "one material per merged part");
    assert.equal(object.geometry.groups.length, 0, "merging must not retain per-primitive draw groups");
    draws++;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    materials.add(object.material); geometries.add(object.geometry);
  });
  return { draws, triangles, materials, geometries };
}

function assertFinite(group) {
  group.updateMatrixWorld(true);
  group.traverse(object => {
    for (const number of [...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray(), ...object.matrixWorld.elements]) {
      assert.ok(Number.isFinite(number), `${object.name}: finite transform`);
    }
    if (!object.isMesh) return;
    assert.equal(object.castShadow, false);
    assert.equal(object.receiveShadow, false);
    assert.equal(object.userData.castShadow, false);
    assert.equal(object.userData.receiveShadow, false);
    for (const attribute of Object.values(object.geometry.attributes)) {
      for (const number of attribute.array) assert.ok(Number.isFinite(number), `${object.name}: finite geometry`);
    }
    const position = object.geometry.attributes.position;
    assert.ok(position.count > 0);
    if (object.geometry.index) for (const index of object.geometry.index.array) assert.ok(index >= 0 && index < position.count);
    if (object.isInstancedMesh) for (const number of object.instanceMatrix.array) assert.ok(Number.isFinite(number));
    object.geometry.computeBoundingSphere();
    assert.ok(Number.isFinite(object.geometry.boundingSphere.radius));
    assert.ok(object.geometry.boundingSphere.radius > 0);
  });
}

for (const type of TYPES) test(`${type}: headless, finite, resettable, within draw/triangle budgets`, () => {
  for (const tablet of [false, true]) for (const level of ["forest", "city", "stunt", "moon"]) {
    const model = createAmbientModel(type, { tablet, level });
    try {
      assert.ok(model.group.isGroup);
      const initial = snapshot(model.group), resources = budget(model.group);
      assert.ok(resources.draws <= (["rocket", "elephant"].includes(type) ? 32 : 20), `${type}: ${resources.draws} draws`);
      assert.ok(resources.triangles <= 8000, `${type}: ${resources.triangles} triangles`);
      assert.ok(resources.materials.size <= 5, "materials shared across colored parts");
      assert.ok([...resources.materials].some(material => material.isMeshStandardMaterial));
      for (const time of [0, 0.4, 1.2, 2.99, 3, 3.01, 7.25, 16.7, 22, 45, 0]) {
        const input = { time, progress: Math.min(1, time / 22), night: time % 3 / 2 };
        const before = { ...input };
        model.update(input);
        assert.deepEqual(input, before, "input is borrowed");
        assertFinite(model.group);
        assert.deepEqual(model.group.position.toArray(), [0, 0, 0]);
        assert.deepEqual(model.group.rotation.toArray(), [0, 0, 0, "XYZ"]);
        assert.deepEqual(model.group.scale.toArray(), [1, 1, 1]);
        const pose = snapshot(model.group);
        model.update(input);
        assert.deepEqual(snapshot(model.group), pose, "same sample is idempotent");
        model.update({ time: 19, progress: 0.91, night: 1 });
        model.update(input);
        assert.deepEqual(snapshot(model.group), pose, "seeking backwards is history-independent");
      }
      model.update();
      assert.deepEqual(snapshot(model.group), initial, "recurring events reset completely");
      const after = budget(model.group);
      assert.deepEqual(after.geometries, resources.geometries);
      assert.deepEqual(after.materials, resources.materials);
    } finally { model.dispose(); }
  }
});

test("all animations preserve controller-owned root placement, orientation, scale and visibility", () => {
  for (const type of TYPES) {
    const model = createAmbientModel(type);
    model.group.position.set(42, 17, -83);
    model.group.rotation.set(0.1, 1.7, -0.3);
    model.group.scale.set(0.8, 1.1, 0.9);
    model.group.visible = false;
    const initial = snapshot(model.group)[0];
    for (const time of [0, 2, 9, 22, 0]) {
      model.update({ time, progress: time / 22, night: 1 });
      assert.deepEqual(snapshot(model.group)[0], initial, type);
    }
    model.dispose();
  }
});

test("the game's later geometry-shadow traversal cannot re-enable decorative actor shadows", () => {
  for (const type of TYPES) {
    const model = createAmbientModel(type, { level: "moon" });
    enableGeometryShadows(model.group);
    assertFinite(model.group);
    model.dispose();
  }
});

test("fresh instances have deterministic geometry/colors and do not depend on update cadence", () => {
  for (const type of TYPES) {
    const direct = createAmbientModel(type), stepped = createAmbientModel(type);
    try {
      const a = [...budget(direct.group).geometries], b = [...budget(stepped.group).geometries];
      assert.equal(a.length, b.length);
      for (let i = 0; i < a.length; i++) {
        for (const name of Object.keys(a[i].attributes)) assert.deepEqual(a[i].attributes[name].array, b[i].attributes[name].array);
        assert.deepEqual(a[i].index?.array, b[i].index?.array);
      }
      for (let frame = 0; frame < 435; frame++) stepped.update({ time: frame / 60, progress: frame / 1320, night: 0.7 });
      const sample = { time: 7.25, progress: 7.25 / 22, night: 0.7 };
      direct.update(sample); stepped.update(sample);
      assert.deepEqual(snapshot(direct.group), snapshot(stepped.group), type);
    } finally { direct.dispose(); stepped.dispose(); }
  }
});

test("named articulated parts move, rather than translating the root or only changing materials", () => {
  const parts = {
    balloon: ["balloon-wave", "balloon-burner"], rocket: ["rocket-body", "rocket-flame-outer", "rocket-flame-inner"],
    elephant: ["elephant-leg-0", "elephant-ear-1", "elephant-trunk-0", "elephant-trunk-2", "elephant-tail"],
    plane: ["plane-propeller"], helicopter: ["helicopter-rotor", "helicopter-tail-rotor"],
    birds: ["bird-0-wing-1", "bird-1-wing--1"], kite: ["kite-ribbon-0-0", "kite-ribbon-0-4"],
    airship: ["airship-propeller-1"], ufo: ["ufo-lights"], satellite: ["satellite-body", "satellite-dish", "satellite-panel-1"],
    comet: ["comet-head", "comet-tail"], astronaut: ["astronaut-body", "astronaut-wave", "astronaut-leg-1"],
  };
  for (const [type, names] of Object.entries(parts)) {
    const model = createAmbientModel(type);
    for (const name of names) {
      const part = model.group.getObjectByName(name);
      assert.ok(part, name);
      model.update();
      const initial = snapshot(part)[0];
      model.update({ time: 7.25, progress: 0.35 });
      assert.notDeepEqual(snapshot(part)[0], initial, name);
    }
    model.dispose();
  }
});

test("reduced motion suppresses secondary movement and pulsing, but retains analytic rocket ascent", () => {
  for (const type of TYPES) for (const level of ["forest", "moon"]) {
    const model = createAmbientModel(type, { level, reducedMotion: true });
    try {
      model.update({ time: 4, night: 1 });
      const pose = snapshot(model.group);
      model.update({ time: 8.25, progress: 0.7, night: 1 });
      if (type !== "rocket") assert.deepEqual(snapshot(model.group), pose, `${type}: no bob, flutter, spin or light flicker`);
      else {
        assert.equal(model.group.getObjectByName("rocket-smoke"), undefined);
        assert.equal(model.group.getObjectByName("rocket-body").position.y, (8.25 - 3) ** 2 * 2.4);
        assert.equal(model.group.getObjectByName("rocket-body").position.x, 0);
        model.update({ time: 12, night: 1 });
        const outer = model.group.getObjectByName("rocket-flame-outer"), inner = model.group.getObjectByName("rocket-flame-inner");
        const flames = [snapshot(outer), snapshot(inner)];
        model.update({ time: 13, night: 1 });
        assert.deepEqual([snapshot(outer), snapshot(inner)], flames, "smooth steady exhaust after ignition");
      }
      model.update();
      assertFinite(model.group);
    } finally { model.dispose(); }
  }
});

test("rocket follows the 22-second launch schedule, keeps its pad grounded, and trails bounded pooled smoke", () => {
  for (const tablet of [false, true]) {
    const model = createAmbientModel("rocket", { tablet });
    const body = model.group.getObjectByName("rocket-body"), pad = model.group.getObjectByName("rocket-pad");
    const smoke = model.group.getObjectByName("rocket-smoke"), flame = model.group.getObjectByName("rocket-flame-outer");
    assert.ok(smoke.isInstancedMesh);
    assert.equal(smoke.count, tablet ? 8 : 12);
    assert.equal(smoke.frustumCulled, false, "moving pool cannot use stale instance bounds");
    assert.equal(smoke.visible, false);
    assert.equal(flame.visible, false);
    const padPose = snapshot(pad);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    for (const time of [0, 0.5, 2.99, 3, 3.5, 8, 14, 17, 22]) {
      model.update({ time, progress: time / 22 });
      assert.equal(body.position.y, Math.min(450, Math.max(0, time - 3) ** 2 * 2.4));
      assert.deepEqual(snapshot(pad), padPose);
      if (time < 0.4) continue;
      assert.equal(smoke.visible, true);
      let active = 0;
      for (let i = 0; i < smoke.count; i++) {
        smoke.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
        if (scale.x === 0) continue;
        active++;
        assert.ok(scale.x <= 3.3 && scale.x > 0);
        assert.ok(Math.hypot(position.x, position.z) <= 3.3);
        assert.ok(position.y >= 0 && position.y <= 451);
        if (time >= 8 && time <= 14) assert.ok(position.y < body.position.y, "puffs retain their historical emission altitude");
      }
      assert.ok(active > 0 && active <= smoke.count);
    }
    model.update({ time: 30 });
    assert.equal(smoke.visible, false);
    model.update();
    assert.equal(body.position.y, 0);
    assert.equal(smoke.visible, false);
    for (let i = 0; i < smoke.count; i++) {
      smoke.getMatrixAt(i, matrix);
      assert.equal(matrix.elements[0] ** 2 + matrix.elements[1] ** 2 + matrix.elements[2] ** 2, 0);
    }
    // Flame cone's broad base is at its nozzle, and its narrow tip points down.
    const geometry = flame.children[0].geometry, vertices = geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      assert.ok(vertices.getY(i) <= 1e-6 && vertices.getY(i) >= -1.000001);
      if (vertices.getY(i) < -0.999) assert.ok(Math.hypot(vertices.getX(i), vertices.getZ(i)) < 1e-6);
    }
    model.dispose();
  }
  const moon = createAmbientModel("rocket", { level: "moon" });
  moon.update({ time: 9 });
  assert.equal(moon.group.getObjectByName("rocket-smoke"), undefined);
  assert.equal(moon.group.getObjectByName("rocket-flame-inner").visible, true);
  moon.dispose();
});

test("silhouettes use metre-scale proportions, forward-facing noses and a rearward comet tail", () => {
  const ranges = {
    balloon: ["y", 13.5, 14.5], plane: ["x", 16.5, 17.5], helicopter: ["z", 12, 15],
    birds: ["x", 13, 15], kite: ["x", 4.5, 5.6], airship: ["z", 19.5, 20.5],
    ufo: ["x", 11.8, 12.2], satellite: ["x", 12.5, 13.5], comet: ["z", 21, 22.5],
    elephant: ["z", 4.7, 6], astronaut: ["y", 2.9, 3.4], rocket: ["y", 11.9, 12.1],
  };
  for (const [type, [axis, min, max]] of Object.entries(ranges)) {
    const model = createAmbientModel(type);
    const bounds = new THREE.Box3().setFromObject(model.group), size = bounds.getSize(new THREE.Vector3());
    assert.ok(size[axis] >= min && size[axis] <= max, `${type}: ${axis}=${size[axis]}`);
    if (["elephant", "astronaut", "rocket", "balloon"].includes(type)) assert.ok(Math.abs(bounds.min.y) < 0.001, `${type}: grounded at rest (${bounds.min.y})`);
    if (type === "comet") { assert.ok(bounds.min.z <= -20); assert.ok(bounds.max.z < 1.5); }
    if (type === "plane") assert.ok(model.group.getObjectByName("plane-propeller").position.z > 5.5);
    model.dispose();
  }
});

test("five/three birds form a V and share a single owned paint material", () => {
  for (const tablet of [false, true]) {
    const model = createAmbientModel("birds", { tablet });
    const birds = model.group.getObjectByName("birds-body").children;
    assert.equal(birds.length, tablet ? 3 : 5);
    assert.equal(birds[0].position.x, 0);
    for (let i = 1; i < birds.length; i += 2) {
      assert.equal(birds[i].position.x, -birds[i + 1].position.x);
      assert.equal(birds[i].position.z, birds[i + 1].position.z);
      assert.ok(birds[i].position.z < birds[0].position.z);
    }
    assert.equal(budget(model.group).materials.size, 1);
    assert.equal(budget(model.group).draws, tablet ? 9 : 15);
    model.dispose();
  }
});

test("elephant feet stay above ground; moon gear/bob and circus rugs are level-specific", () => {
  const models = Object.fromEntries(["forest", "city", "stunt", "moon"].map(level => [level, createAmbientModel("elephant", { level })]));
  try {
    assert.ok(budget(models.city.group).triangles > budget(models.forest.group).triangles);
    assert.equal(budget(models.city.group).triangles, budget(models.stunt.group).triangles);
    assert.ok(models.moon.group.getObjectByName("elephant-helmet"));
    assert.equal(models.forest.group.getObjectByName("elephant-helmet"), undefined);
    for (let time = 0; time < 8; time += 0.17) {
      for (const [level, model] of Object.entries(models)) {
        model.update({ time });
        model.group.updateMatrixWorld(true);
        for (let i = 0; i < 4; i++) {
          const bounds = new THREE.Box3().setFromObject(model.group.getObjectByName(`elephant-leg-${i}`));
          assert.ok(bounds.min.y >= -1e-6, `${level}: foot ${i} at ${bounds.min.y}`);
        }
      }
    }
    assert.equal(models.forest.group.getObjectByName("elephant-body").position.y, 0);
    assert.ok(models.moon.group.getObjectByName("elephant-body").position.y > 0);
  } finally { for (const model of Object.values(models)) model.dispose(); }
});

test("night emission stays modest and UFO lights cycle slowly without flashing", () => {
  for (const type of TYPES) {
    const model = createAmbientModel(type);
    const paint = [...budget(model.group).materials].find(material => material.name === "ambient-paint");
    model.update({ night: 1 });
    assert.ok(paint.emissiveIntensity >= 0.15 && paint.emissiveIntensity <= 0.3);
    model.update({ night: 0 });
    assert.equal(paint.emissiveIntensity, 0.06);
    model.dispose();
  }
  const model = createAmbientModel("ufo");
  const glow = [...budget(model.group).materials].find(material => material.name === "ambient-glow");
  let previous;
  for (let frame = 0; frame < 600; frame++) {
    model.update({ time: frame / 60, night: 1 });
    assert.ok(glow.color.r >= 1.575 && glow.color.r <= 1.925);
    if (previous !== undefined) assert.ok(Math.abs(glow.color.r - previous) < 0.003);
    previous = glow.color.r;
  }
  model.dispose();
});

test("temporary primitives and every owned resource are disposed exactly once, without touching other models", () => {
  const created = new Set(), disposals = new Map();
  const setAttribute = THREE.BufferGeometry.prototype.setAttribute, geometryDispose = THREE.BufferGeometry.prototype.dispose;
  THREE.BufferGeometry.prototype.setAttribute = function (...args) { created.add(this); return setAttribute.apply(this, args); };
  THREE.BufferGeometry.prototype.dispose = function () {
    disposals.set(this, (disposals.get(this) ?? 0) + 1);
    return geometryDispose.call(this);
  };
  try {
    for (const type of TYPES) for (const level of ["forest", "moon"]) {
      const model = createAmbientModel(type, { level }), other = createAmbientModel(type, { level });
      const scene = new THREE.Scene();
      scene.add(model.group, other.group);
      const resources = budget(model.group), otherResources = budget(other.group);
      let borrowedDisposals = 0;
      for (const resource of [...otherResources.materials, ...otherResources.geometries]) resource.addEventListener("dispose", () => borrowedDisposals++);
      const counts = new Map();
      const watched = [...resources.materials, ...resources.geometries];
      model.group.traverse(object => { if (object.isInstancedMesh) watched.push(object); });
      for (const resource of watched) resource.addEventListener("dispose", () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
      const heldPart = model.group.getObjectByName(`${type}-body`), heldPose = snapshot(heldPart);
      model.dispose(); model.dispose();
      model.update({ time: 12, night: 1 });
      assert.deepEqual(snapshot(heldPart), heldPose, "post-disposal updates are inert");
      assert.equal(model.group.parent, null);
      assert.equal(model.group.children.length, 0);
      assert.deepEqual(scene.children, [other.group]);
      for (const resource of watched) assert.equal(counts.get(resource), 1, `${type}: ${resource.type}`);
      assert.equal(borrowedDisposals, 0);
      for (const geometry of resources.geometries) assert.ok(!otherResources.geometries.has(geometry));
      for (const mat of resources.materials) assert.ok(!otherResources.materials.has(mat));
      other.dispose();
    }
    assert.ok(created.size > 100, "instrumentation observes temporary primitives and baked geometry");
    for (const geometry of created) assert.equal(disposals.get(geometry), 1, `geometry ${geometry.id} (${geometry.type}) was released once`);
  } finally {
    THREE.BufferGeometry.prototype.setAttribute = setAttribute;
    THREE.BufferGeometry.prototype.dispose = geometryDispose;
  }
});

test("unsupported types fail explicitly and malformed clock inputs cannot poison reusable actors", () => {
  for (const type of ["Balloon", "airplane", "bird", "", null, undefined, "toString"]) assert.throws(() => createAmbientModel(type), RangeError);
  for (const type of TYPES) {
    const model = createAmbientModel(type);
    const initial = snapshot(model.group);
    model.update({ time: NaN, progress: Infinity, night: NaN });
    assert.deepEqual(snapshot(model.group), initial);
    model.update({ time: -10, progress: -1, night: -1 });
    assert.deepEqual(snapshot(model.group), initial);
    model.dispose();
  }
});
