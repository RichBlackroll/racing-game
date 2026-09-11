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

function mountContactFailure(bracket, surfaces, direction) {
  const center = bracket.getWorldPosition(new THREE.Vector3());
  const ray = new THREE.Raycaster(center.clone().addScaledVector(direction, -10), direction.clone(), 0, 20);
  const surface = ray.intersectObjects(surfaces, false)[0];
  const entry = ray.intersectObject(bracket, false)[0];
  ray.set(center.clone().addScaledVector(direction, 10), direction.clone().negate());
  const exit = ray.intersectObject(bracket, false)[0];
  const at = center.toArray().map(value => value.toFixed(4)).join(", ");
  if (!surface) return `${bracket.name} at [${at}]: no body/support surface along the mounting ray`;
  if (!entry || !exit) return `${bracket.name} at [${at}]: mounting ray misses the bracket geometry`;
  // The surface must lie inside the actual bracket's entry/exit interval, not
  // merely inside the car's overall box (which also spans empty wheel arches).
  const gap = Math.max(entry.distance - surface.distance, surface.distance - (20 - exit.distance));
  if (gap > 1e-5) return `${bracket.name} at [${at}]: surface [${surface.point.toArray().map(value => value.toFixed(4)).join(", ")}] is ${gap.toFixed(4)} m outside the bracket`;
  return null;
}

function surfaceCrossing(hardware, tires) {
  const hardwareBounds = new THREE.Box3().setFromObject(hardware, true);
  const ray = new THREE.Raycaster(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const edgeBounds = new THREE.Box3();
  for (const tire of tires) {
    const tireBounds = new THREE.Box3().setFromObject(tire, true);
    if (!hardwareBounds.intersectsBox(tireBounds)) continue;
    // Test edges in both directions and from both meshes so curved tires and
    // diagonal brackets are not rejected just because their AABBs overlap.
    for (const [source, target, targetBounds] of [[hardware, tire, tireBounds], [tire, hardware, hardwareBounds]]) {
      const { position } = source.geometry.attributes, index = source.geometry.index;
      const count = index?.count ?? position.count;
      for (let i = 0; i < count; i += 3) for (let edge = 0; edge < 3; edge++) {
        const from = i + edge, to = i + (edge + 1) % 3;
        a.fromBufferAttribute(position, index ? index.getX(from) : from).applyMatrix4(source.matrixWorld);
        b.fromBufferAttribute(position, index ? index.getX(to) : to).applyMatrix4(source.matrixWorld);
        edgeBounds.makeEmpty().expandByPoint(a).expandByPoint(b);
        if (!edgeBounds.intersectsBox(targetBounds)) continue;
        const length = a.distanceTo(b);
        if (length < 2e-5) continue;
        ray.near = 1e-5; ray.far = length - 1e-5;
        ray.set(a, b.clone().sub(a).normalize());
        let hit = ray.intersectObject(target, false)[0];
        if (!hit) {
          ray.set(b, a.clone().sub(b).normalize());
          hit = ray.intersectObject(target, false)[0];
        }
        if (hit) return hit.point;
      }
    }
  }
  return null;
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
  assert.equal(model.rocket, model.visuals.boosters.rocket);
  assert.equal(model.flame, model.visuals.boosters.flame);
  assert.equal(model.housing, model.visuals.boosters.housing);
  assert.equal(model.rocket.parent, body);
  assert.equal(model.flame.parent, model.rocket);
  assert.equal(model.flag.group.parent, body, "Elio's flag follows body/suspension movement");
  assert.equal(model.flag.group.userData.country, "nz");
  assert.ok(Math.abs(model.flag.group.position.y - .72) < 1e-6, "pole attaches at rear bumper height");
  assert.equal(model.flag.group.position.z, -3.4, "mast clears the swept-back mega wing");
  model.car.updateMatrixWorld(true);
  assert.equal(mountContactFailure(model.flag.group.getObjectByName("flag-mount"),
    body.children.filter(object => object.isMesh), new THREE.Vector3(0, 0, 1)), null, "flag bracket contacts the actual rear bodywork");
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
      for (const resource of [object.geometry, object.material, object.material.map].filter(Boolean)) {
        if (!resources.has(resource)) {
          resources.set(resource, 0);
          resource.addEventListener("dispose", () => resources.set(resource, resources.get(resource) + 1));
        }
      }
    });
    const state = model.visuals.state();
    if (state.spoiler.added) {
      const wing = model.car.getObjectByName("modifier-spoiler");
      assert.equal(surfaceCrossing(model.flag.group.getObjectByName("flag-pole"),
        wing.children.filter(object => object.isMesh && object.visible)), null, "rear flag mast never passes through a spoiler blade");
    }
    assert.equal(state.wheels.count, 4);
    assert.ok(state.wheels.corners.every(({ bottomY }, i) => Math.abs(bottomY - stock.wheels.corners[i].bottomY) < 1e-5));
    if (part.id === "color") assert.equal(model.paint.color.getHexString(), option.hex.slice(1));
    if (part.id === "engine") assert.equal(state.engine.electric, option.id === "electric");
    if (part.id === "rocket") {
      assert.equal(model.rocket.visible, option.id !== "none");
      assert.equal(state.rocket.count, { none: 0, small: 2, big: 1 }[option.id]);
      assert.equal(model.flame.children.filter(plume => plume.visible).length, state.rocket.count);
    }
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

for (const vehicle of VEHICLES) test(`${vehicle.name}: production booster mounts contact real surfaces and clear tires and ground`, async (t) => {
  const { scene } = await asset(vehicle.id);
  const model = prepareVehicleModel(scene, vehicle.id);
  t.after(() => model.dispose());
  const body = model.car.getObjectByName("modifier-body");
  const imported = body.children.filter(object => object.isMesh);
  assert.ok(imported.length > 0, "mounting rays must hit imported GLB surfaces, never generated upgrades");
  const attachments = new Map();
  model.car.updateMatrixWorld(true);
  const inverseBody = body.matrixWorld.clone().invert();
  model.rocket.traverse(node => {
    if (node.isMesh && node.name !== "booster-plume") attachments.set(node,
      new THREE.Matrix4().multiplyMatrices(inverseBody, node.matrixWorld));
  });
  for (const rocket of ["small", "big"]) {
    for (const { id: wheels } of PARTS.find(part => part.id === "wheels").options) {
      for (const { id: suspension } of PARTS.find(part => part.id === "suspension").options) {
        await t.test(`${vehicle.id}/${rocket}/${wheels}/${suspension}`, () => {
          model.visuals.apply({ ...DEFAULTS, rocket, wheels, suspension });
          model.car.updateMatrixWorld(true);
          const failures = [], groups = model.rocket.children.filter(node => node !== model.flame && node.visible);
          assert.equal(groups.length, rocket === "small" ? 2 : 1, "check every configured booster, not an empty hierarchy");
          const inverse = body.matrixWorld.clone().invert();
          for (const group of groups) {
            const feet = group.children.filter(node => node.name === "booster-mount-foot");
            const mounts = group.children.filter(node => node.name === "booster-mount");
            const barrel = group.getObjectByName("booster-barrel");
            assert.equal(mounts.length, rocket === "small" ? 2 : 1);
            assert.equal(feet.length, rocket === "small" ? 2 : 0);
            assert.ok(barrel?.isMesh);
            for (const bracket of feet.length ? feet : mounts) {
              const failure = mountContactFailure(bracket, imported, feet.length ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1));
              if (failure) failures.push(`${group.name}: body contact: ${failure}`);
            }
            for (const [i, mount] of mounts.entries()) {
              const towardBarrel = new THREE.Vector3(0, 0, feet.length ? 1 : -1).transformDirection(mount.matrixWorld);
              const housingFailure = mountContactFailure(mount, [barrel], towardBarrel);
              if (housingFailure) failures.push(`${group.name}: housing attachment: ${housingFailure}`);
              if (feet.length) {
                const footFailure = mountContactFailure(mount, [feet[i]], towardBarrel.clone().negate());
                if (footFailure) failures.push(`${group.name}: foot attachment: ${footFailure}`);
              }
            }
            for (const mesh of group.children.filter(node => node.isMesh)) {
              const relative = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
              assert.ok(relative.elements.every((value, i) => Math.abs(value - attachments.get(mesh).elements[i]) < 1e-6), `${group.name}/${mesh.name}: hardware must stay fixed to the suspended body`);
              const bottom = new THREE.Box3().setFromObject(mesh, true).min.y;
              if (bottom < -1e-5) failures.push(`${group.name}/${mesh.name}: ${(-bottom).toFixed(4)} m below ground`);
              for (const wheel of model.wheels) {
                const tires = [];
                wheel.tire.traverse(node => { if (node.isMesh) tires.push(node); });
                for (const steer of wheel.front ? [-.36, 0, .36] : [0]) {
                  wheel.pivot.rotation.y = steer;
                  wheel.pivot.updateWorldMatrix(true, true);
                  const hit = surfaceCrossing(mesh, tires);
                  if (hit) failures.push(`${group.name}/${mesh.name}: intersects ${wheel.pivot.name} at steer ${steer}, point [${hit.toArray().map(value => value.toFixed(4)).join(", ")}]`);
                }
                wheel.pivot.rotation.y = 0;
              }
            }
          }
          assert.deepEqual(failures, [], "production booster geometry must remain attached and clear of the wheels/road");
        });
      }
    }
  }
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
