import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VEHICLES, getVehicle } from "./vehicle-data.js";
import { loadVehicleModel, prepareVehicleModel } from "./vehicle-model.js";
import { DEFAULTS, PARTS } from "./modifier-data.js";
import { createBydAtto1 } from "./byd-atto-1.js";
import { createVolvoEx40 } from "./volvo-ex40.js";

async function asset(id) {
  if (id === "byd-atto-1") return { scene: createBydAtto1() };
  if (id === "volvo-ex40") return { scene: createVolvoEx40() };
  const bytes = await readFile(new URL(getVehicle(id).file, import.meta.url));
  const loader = new GLTFLoader();
  // Embedded images require a browser; geometry and material bindings do not.
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

test("vehicle IDs resolve to local assets or authored models, with the original car as the safe default", () => {
  assert.deepEqual(VEHICLES.map(({ id }) => id), ["porsche", "tesla", "golf", "byd-atto-1", "volvo-ex40", "backhoe", "dhl-van"]);
  assert.deepEqual(VEHICLES.filter(vehicle => vehicle.utility).map(({ id }) => id), ["backhoe", "dhl-van"]);
  assert.equal(new Set(VEHICLES.map(vehicle => vehicle.action.id)).size, 7);
  for (const vehicle of VEHICLES) {
    assert.equal(getVehicle(vehicle.id), vehicle);
    if (vehicle.authored) {
      assert.ok(vehicle.length > 3.9 && vehicle.length < 4.5);
      assert.equal(vehicle.engine, "electric");
    } else assert.match(vehicle.file, /^[a-z0-9-]+\.glb$/);
    assert.ok(PARTS.find(({ id }) => id === "engine").options.some(({ id }) => id === vehicle.engine));
    assert.ok(vehicle.action.label && vehicle.action.description);
    assert.ok(vehicle.action.duration > 0 && vehicle.action.cooldown >= 0);
    assert.equal(!!vehicle.action.parked, !!vehicle.utility);
    if (vehicle.utility) assert.equal(vehicle.color, "yellow");
    else assert.deepEqual(vehicle.handling, { top: 1, accel: 1, steer: 1, reverse: 9, radius: 1.12, mass: 1.6,
      height: 1.6, wheelbase: 2.9, track: 1.7, halfExtents: [1.05, .55, 2.2] });
  }
  assert.equal(getVehicle("tesla").engine, "electric");
  assert.equal(getVehicle("golf").engine, "four");
  for (const invalid of [undefined, null, "toString", "__proto__", "unavailable"]) assert.equal(getVehicle(invalid).id, "porsche");
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

test("the downloaded Mk1 GTI retains provenance warnings and four separate wheels without external resources", async () => {
  const bytes = await readFile(new URL("./golf-gti-mk1.glb", import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.ok(bytes.length < 4_000_000, "keep the textured car small enough for mobile loading");
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  const { attribution, adaptation } = json.asset.extras;
  assert.equal(attribution.title, "1976 Volkswagen Golf GTI Mk1");
  assert.equal(attribution.author, "Ddiaz Design");
  assert.equal(attribution.licenseURL, "https://creativecommons.org/licenses/by-nc-sa/4.0/");
  assert.match(attribution.source, /1fc46cb37bd748e3bb9355fcedaf3817$/);
  assert.match(attribution.provenance, /Need For Speed Heat/);
  assert.match(attribution.license, /underlying rights unverified/);
  assert.match(attribution.usage, /Internal evaluation only/);
  assert.equal(adaptation.triangleCount, 48825);
  assert.ok(adaptation.changes.length > 0);
  assert.ok(!(json.extensionsRequired || []).some(name => /draco|meshopt|basisu/i.test(name)));
  for (const resource of [...json.buffers, ...json.images]) assert.equal(resource.uri, undefined);
  assert.equal(json.extras.orientation.front, "+Z");
  assert.equal(json.extras.orientation.wheelAxle, "+X");
  assert.equal(json.extras.wheels.length, 4);
  for (const wheel of json.extras.wheels) {
    assert.equal(wheel.parts.length, 5, "each corner owns its tire, disc, rim, cap and valve");
    for (const name of wheel.parts) assert.ok(json.nodes.some(node => node.name === name));
  }
});

for (const vehicle of VEHICLES.filter(vehicle => !vehicle.utility)) test(`${vehicle.name}: production loading binds paint, four grounded wheels and every upgrade`, async () => {
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
  assert.ok(new THREE.Box3().setFromObject(importedPaint).getSize(new THREE.Vector3()).z > (vehicle.length || 4.6) - 0.3);
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
  }
  if (vehicle.id === "golf") {
    const byMaterial = name => body.children.find(object => object.isMesh && object.material.name === name);
    const headlights = byMaterial("golf-headlights"), rear = byMaterial("vM_LightGlassNormal_OuterRed_Low1");
    assert.ok(new THREE.Box3().setFromObject(headlights).min.z > 2, "round headlight lenses face forward");
    assert.ok(new THREE.Box3().setFromObject(rear).max.z < -2, "red lights face backward");
    assert.equal(headlights.material.userData.nightRole, "headlight");
    assert.equal(headlights.material.opacity, 1);
    assert.equal(headlights.material.depthWrite, true);
    assert.equal(rear.material.userData.nightRole, "taillight");
    assert.equal(rear.material.userData.brakeIntensity, 3);
    assert.equal(byMaterial("vM_LightGlassNormal_Clear_Low1").material.userData.nightRole, undefined, "reversing lenses do not become headlights");
    const glass = byMaterial("vM_Glass_WindowFront_Low1").material;
    assert.equal(glass.userData.nightRole, undefined);
    assert.equal(glass.transparent, false);
    assert.equal(glass.depthWrite, true, "opaque tinted glass occludes the interior despite the source BLEND material");
    assert.ok(model.car.userData.headlights.every(([x, y, z]) => Math.abs(x) > .5 && y > .5 && z > 2));
    assert.ok(byMaterial("breaks"), "brake calipers stay out of spinning wheels");
  }
  if (vehicle.authored || vehicle.id === "tesla" || vehicle.id === "golf") {
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

for (const [id, dimensions, mirrors, signatures] of [
  ["byd-atto-1", [3.99, 1.72, 1.59, 2.5], 2.016,
    ["left-angled-led-bar-6", "full-width-rear-led-bridge", "left-c-pillar-ice-crystal-dots", "tailgate-atto-1-badge"]],
  ["volvo-ex40", [4.44, 1.873, 1.647, 2.702], 2.034,
    ["angular-Thors-hammer-upright-1", "rear-vertical-lamp-inward-hook-LED-1", "body-colour-closed-electric-grille", "rear-EX40-model-badge"]],
]) test(`${id}: authored exterior retains dimensions, distinct details, open arches and a mobile geometry budget`, async (t) => {
  const { scene } = await asset(id), resources = new Set();
  t.after(() => { for (const resource of resources) resource.dispose(); });
  const bounds = new THREE.Box3().setFromObject(scene), size = bounds.getSize(new THREE.Vector3());
  const [length, width, height, wheelbase] = dimensions;
  assert.deepEqual(scene.userData.dimensions, { length, width, height, wheelbase });
  assert.ok(Math.abs(size.z - length) < 0.002);
  assert.ok(Math.abs(size.x - mirrors) < 0.002);
  assert.ok(Math.abs(size.y - height) < 0.002);
  assert.ok(Math.abs(bounds.min.y) < 1e-6);
  assert.match(scene.userData.reference.description, /approximation/i);
  for (const name of signatures) assert.ok(scene.getObjectByName(name)?.isMesh, name);
  let triangles = 0;
  const corners = new Map(), body = [];
  scene.traverse(object => {
    if (!object.isMesh) return;
    resources.add(object.geometry); resources.add(object.material);
    assert.ok(object.geometry.attributes.position.array.every(Number.isFinite), object.name);
    assert.ok(object.geometry.attributes.normal.array.every(Number.isFinite), object.name);
    triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3;
    assert.equal(object.material.map, null, "no network, canvas or font textures");
    if (object.name.startsWith("wheel") && object.name.endsWith("-tire")) corners.set(object.name, object.position);
    if (!object.name.startsWith("wheel")) body.push(object);
  });
  assert.ok(triangles > 10_000 && triangles < 55_000, `source triangles: ${triangles}`);
  assert.equal(corners.size, 4);
  const front = [...corners.values()].find(p => p.z > 0), rear = [...corners.values()].find(p => p.z < 0);
  assert.ok(Math.abs(front.z - rear.z - wheelbase) < 1e-6);
  for (const corner of corners.values()) {
    const side = Math.sign(corner.x);
    const ray = new THREE.Raycaster(new THREE.Vector3(side * (width / 2 + 0.02), corner.y + 0.12, corner.z), new THREE.Vector3(-side, 0, 0), 0, 0.13);
    assert.equal(ray.intersectObjects(body, false).length, 0, "bodywork does not fill the wheel opening");
  }
  const ready = await loadVehicleModel(id);
  t.after(() => ready.dispose());
  assert.equal(ready.car.userData.dimensions.length, length);
  ready.visuals.apply({ ...DEFAULTS, engine: ready.vehicle.engine });
  assert.equal(ready.visuals.state().engine.electric, true);
});

test("authored EV loading is offline and rejects an already cancelled request", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected model request"); });
  for (const id of ["byd-atto-1", "volvo-ex40"]) {
    const model = await loadVehicleModel(id);
    assert.equal(model.vehicle.id, id);
    model.dispose();
    await assert.rejects(loadVehicleModel(id, { signal: AbortSignal.abort() }), { name: "AbortError" });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

for (const vehicle of VEHICLES.filter(vehicle => !vehicle.utility)) test(`${vehicle.name}: production booster mounts contact real surfaces and clear tires and ground`, async (t) => {
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
