import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VEHICLES, getVehicle } from "./vehicle-data.js";
import { loadVehicleModel, prepareVehicleModel } from "./vehicle-model.js";
import { DEFAULTS, PARTS } from "./modifier-data.js";

async function asset(id) {
  const bytes = await readFile(new URL(getVehicle(id).file, import.meta.url));
  const loader = new GLTFLoader();
  // The Porsche's embedded images require a browser; geometry and material bindings do not.
  loader.register(() => ({ name: "geometry-only-test", loadTexture: () => Promise.resolve(null) }));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

test("vehicle IDs resolve to local assets, with the original car as the safe default", () => {
  assert.deepEqual(VEHICLES.map(({ id }) => id), ["porsche", "tesla"]);
  for (const vehicle of VEHICLES) {
    assert.equal(getVehicle(vehicle.id), vehicle);
    assert.match(vehicle.file, /^[a-z0-9-]+\.glb$/);
    assert.ok(PARTS.find(({ id }) => id === "engine").options.some(({ id }) => id === vehicle.engine));
  }
  assert.equal(getVehicle("tesla").engine, "electric");
  for (const invalid of [undefined, null, "toString", "__proto__", "golf"]) assert.equal(getVehicle(invalid).id, "porsche");
});

test("the downloaded Tesla retains attribution, contains only the car and needs no external decoder or files", async () => {
  const bytes = await readFile(new URL("./tesla-model-3.glb", import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.ok(bytes.length < 1_000_000, "keep the decoded local asset small for mobile loading");
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(json.asset.extras.attribution.author, "David_Holiday");
  assert.equal(json.asset.extras.attribution.licenseURL, "https://creativecommons.org/licenses/by/4.0/");
  assert.match(json.asset.extras.attribution.source, /123c10f376ec4f18b93c73afc382808b$/);
  assert.ok(json.asset.extras.adaptation.changes.length > 0);
  assert.ok(!(json.extensionsRequired || []).some((name) => /draco|meshopt|basisu/i.test(name)));
  for (const resource of [...json.buffers, ...(json.images || [])]) assert.equal(resource.uri, undefined);
  assert.equal(json.materials.some(({ name }) => name === "White"), false, "showcase props are not part of the game asset");
  assert.equal(json.meshes.length, 39);
  assert.equal(json.extras.wheels.length, 4);
  assert.equal(json.extras.orientation.front, "+Z");
});

for (const vehicle of VEHICLES) test(`${vehicle.name}: production loading binds paint, four grounded wheels and every upgrade`, async () => {
  const { scene } = await asset(vehicle.id);
  const model = prepareVehicleModel(scene, vehicle.id);
  const stock = model.visuals.state();
  const body = model.car.getObjectByName("modifier-body");
  assert.equal(model.wheels.length, 4);
  assert.equal(model.wheels.filter(({ front }) => front).length, 2);
  assert.ok(stock.wheels.corners.every(({ radius, bottomY }) => radius > 0.2 && radius < 0.6 && bottomY >= -0.001 && bottomY < 0.06));
  const importedPaint = body.children.find((object) => object.isMesh && object.material === model.paint);
  assert.ok(importedPaint, "paint controls the imported body, not just the added wing");
  assert.ok(new THREE.Box3().setFromObject(importedPaint).getSize(new THREE.Vector3()).z > 4);
  const resources = new Map();
  for (const part of PARTS) for (const option of part.options) {
    model.visuals.apply({ ...DEFAULTS, engine: vehicle.engine, [part.id]: option.id });
    model.car.updateMatrixWorld(true);
    model.car.traverse((object) => {
      assert.ok(object.matrixWorld.elements.every(Number.isFinite));
      if (!object.isMesh) return;
      assert.equal(object.castShadow, false, "new cars must not enter the cached scenery shadow");
      for (const resource of [object.geometry, object.material]) {
        if (!resources.has(resource)) {
          resources.set(resource, 0);
          resource.addEventListener("dispose", () => resources.set(resource, resources.get(resource) + 1));
        }
      }
    });
    const state = model.visuals.state();
    assert.equal(state.wheels.count, 4);
    assert.ok(state.wheels.corners.every(({ bottomY }, i) => Math.abs(bottomY - stock.wheels.corners[i].bottomY) < 1e-5));
    if (part.id === "color") assert.equal(model.paint.color.getHexString(), option.hex.slice(1));
    if (part.id === "engine") assert.equal(state.engine.electric, option.id === "electric");
    if (part.id === "rocket") assert.equal(model.rocket.visible, option.id !== "none");
  }
  model.visuals.apply({ ...DEFAULTS, engine: vehicle.engine });
  assert.equal(model.flame.visible, false);
  assert.equal(model.housing.material.side, THREE.DoubleSide);
  if (vehicle.id === "tesla") {
    const byMaterial = (name) => body.children.find((object) => object.isMesh && object.material.name === name);
    assert.ok(new THREE.Box3().setFromObject(byMaterial("LED_PHARE")).min.z > 0, "headlights face forward");
    assert.ok(new THREE.Box3().setFromObject(byMaterial("Material.002")).max.z < 0, "rear lights face backward");
    assert.notEqual(byMaterial("Glass").material.color.getHex(), byMaterial("Material.017").material.color.getHex(), "headlight covers are not blacked-out cabin glass");
    for (const wheel of model.wheels) {
      const center = wheel.pivot.position.clone();
      for (const angle of [0, Math.PI / 2, Math.PI]) {
        wheel.tire.rotation.x = angle;
        const bounds = new THREE.Box3().setFromObject(wheel.tire, true);
        assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).y - center.y) < 0.02, "wheel assemblies spin around a common axle");
      }
    }
  }
  assert.ok([...resources.values()].every((count) => count === 0), "editing does not dispose live model resources");
  model.dispose();
  model.dispose();
  assert.ok([...resources.values()].every((count) => count === 1), "swaps release imported and all upgrade resources once, including previously selected caps");
  assert.equal(model.car.children.length, 0);
});

test("model cleanup closes discarded and shared decoded images exactly once without breaking retained textures", async () => {
  const { scene } = await asset("tesla");
  let usedClosed = 0, discardedClosed = 0;
  const used = { close() { usedClosed++; } }, discarded = { close() { discardedClosed++; } };
  scene.traverse((object) => {
    if (!object.isMesh) return;
    if (object.material.name === "CAR_PAINT") {
      object.material.map = new THREE.Texture(discarded);
      object.material.emissiveMap = new THREE.Texture(used);
    }
    if (object.material.name === "PLASTIC") object.material.map = new THREE.Texture(used);
  });
  const model = prepareVehicleModel(scene, "tesla");
  assert.equal(discardedClosed, 1);
  assert.equal(usedClosed, 0, "a bitmap shared with retained materials stays open");
  model.dispose();
  model.dispose();
  assert.equal(usedClosed, 1);
  assert.equal(discardedClosed, 1);
});

test("loading requests only the selected local model and reports HTTP failures and cancellation", async (t) => {
  const bytes = await readFile(new URL("./tesla-model-3.glb", import.meta.url));
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", async (file, options) => {
    assert.equal(file, "tesla-model-3.glb");
    assert.equal(options.signal, controller.signal);
    return new Response(bytes);
  });
  const model = await loadVehicleModel("tesla", { signal: controller.signal });
  assert.equal(model.vehicle.id, "tesla");
  assert.equal(fetch.mock.callCount(), 1);
  model.dispose();
  fetch.mock.mockImplementation(async () => new Response(null, { status: 404 }));
  await assert.rejects(loadVehicleModel("tesla"), /Tesla Model 3.*404/);
  fetch.mock.mockImplementation(async () => new Response(bytes));
  controller.abort();
  await assert.rejects(loadVehicleModel("tesla", { signal: controller.signal }), { name: "AbortError" });

  const pending = new AbortController(), { scene } = await asset("tesla");
  let closed = 0;
  scene.getObjectByName("Capot_001_CAR_PAINT_0").material.map = new THREE.Texture({ close() { closed++; } });
  t.mock.method(GLTFLoader.prototype, "parseAsync", async () => {
    pending.abort();
    return { scene };
  });
  await assert.rejects(loadVehicleModel("tesla", { signal: pending.signal }), { name: "AbortError" });
  assert.equal(closed, 1, "closing during parsing disposes decoded images instead of installing a late model");
});
