import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as THREE from "three";
import { main } from "./game-source.js";
import { DEFAULTS, PARTS, computeTuning } from "./modifier-data.js";
import { getVehicle } from "./vehicle-data.js";

const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");

test("the car contact shadow faces upward and returns to full opacity after flight", () => {
  const create = new Function("THREE", "contact", "scene", "mesh", `
    let carShadow;
    ${source.slice(source.indexOf("  carShadow = mesh("), source.indexOf("  let frameCount ="))}
    return { carShadow, shadowCoordinates };
  `);
  const { carShadow, shadowCoordinates } = create(THREE, null, new THREE.Scene(),
    (geometry, material) => new THREE.Mesh(geometry, material));
  const update = new Function("car", "carShadow", "shadowCoordinates", "heightAt", "heading",
    source.slice(source.indexOf("    const clearance = Math.max(0, car.position.y"), source.indexOf("    landscape.animate(")));
  const heightAt = (x, z) => 10 + x * 0.1 - z * 0.2;
  const car = new THREE.Group();
  for (const clearance of [0, 5, 0]) for (const heading of [0, Math.PI / 2, -2]) {
    car.position.set(40, heightAt(40, -20) + clearance, -20);
    update(car, carShadow, shadowCoordinates, heightAt, heading);
    carShadow.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(40, 50, -20), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(carShadow);
    assert.ok(hits.length > 0, "shadow must be visible from above, not backface-culled");
    assert.ok(Math.abs(hits[0].point.y - heightAt(40, -20) - 0.115) < 1e-5);
    assert.ok(carShadow.material.opacity > 0);
    if (clearance === 0) assert.equal(carShadow.material.opacity, 1);
  }
  carShadow.geometry.dispose();
  carShadow.material.dispose();
});

// Run the actual longitudinal driving block without loading a WebGL scene.
const drive = new Function("state", "THREE", `
  let { speed = 0, boosting = false, recovering = false, throttle = 1,
    keys = {}, now = 0, boostEnds = 5000, dt = 1 / 60, offroad = false, tune } = state;
  const flame = { scale: { set() {} } }, boostText = {}, boostButton = {};
  const show = () => {}, boostLabel = 'Boost';
  let sceneDirty = false;
  ${source.slice(source.indexOf("    const cruiseMax ="), source.indexOf('    document.body.classList.toggle("boosting"'))}
  return { ...state, speed, boosting, recovering, disabled: boostButton.disabled,
    cruise: cruiseMax(offroad), boost: boostMax(offroad) };
`);

test("engine upgrades reach clearly separated road speeds and improve off-road speed", () => {
  for (const [engine, kmh] of [["four", 115.2], ["six", 172.8], ["electric", 195.84], ["eight", 230.4]]) {
    const tune = computeTuning({ ...DEFAULTS, engine });
    for (const offroad of [false, true]) {
      let state = { tune, offroad };
      for (let i = 0; i < 1200; i++) state = drive(state, THREE);
      assert.ok(Math.abs(state.speed - state.cruise) < 0.001, `${engine} reaches its cap`);
      if (!offroad) assert.ok(Math.abs(state.speed * 3.6 - kmh) < 0.01);
      else if (engine !== "four") assert.ok(state.speed > 17 * 1.15);
    }
  }
});

test("every engine, wheel, suspension and wing combination gets a real rocket speed increase", () => {
  const options = (id) => PARTS.find((part) => part.id === id).options;
  for (const engine of options("engine")) for (const wheels of options("wheels"))
    for (const suspension of options("suspension")) for (const spoiler of options("spoiler"))
      for (const rocket of ["small", "big"]) for (const offroad of [false, true]) {
        const tune = computeTuning({ ...DEFAULTS, engine: engine.id, wheels: wheels.id,
          suspension: suspension.id, spoiler: spoiler.id, rocket });
        let state = drive({ tune, offroad }, THREE);
        state = { ...state, speed: state.cruise, boosting: true };
        for (let i = 0; i < 60; i++) state = drive(state, THREE);
        assert.ok(state.speed >= state.cruise * 1.49, "boost adds at least 49% speed within one second");
        assert.ok(state.speed <= state.boost, "thrust does not overshoot the target");
      }
});

test("rocket thrust beats engine acceleration and reaches its target at different frame rates", () => {
  for (const engine of PARTS.find((part) => part.id === "engine").options) {
    const tune = computeTuning({ ...DEFAULTS, engine: engine.id, wheels: "hub", rocket: "big" });
    for (const dt of [1 / 120, 1 / 60, 1 / 20]) {
      const normal = drive({ tune, dt }, THREE);
      let boosted = drive({ tune, dt, boosting: true }, THREE);
      assert.ok(boosted.speed > normal.speed * 1.5);
      for (let i = 1; i < 3 / dt; i++) boosted = drive(boosted, THREE);
      assert.ok(Math.abs(boosted.speed - boosted.boost) < 0.001);
    }
  }
});

test("boost expiry and brakes recover safely from the higher speeds", () => {
  const tune = computeTuning({ ...DEFAULTS, engine: "eight", rocket: "big" });
  const state = { tune, speed: 120, boosting: true, dt: 0.05 };
  const expired = drive({ ...state, now: 5000 }, THREE);
  const braked = drive({ ...state, throttle: -1 }, THREE);
  const handbraked = drive({ ...state, keys: { " ": true } }, THREE);
  for (const result of [expired, braked, handbraked]) {
    assert.equal(result.boosting, false);
    assert.equal(result.recovering, true);
    assert.ok(result.speed < state.speed);
  }
  assert.ok(braked.speed < expired.speed);
  assert.ok(handbraked.speed < braked.speed);
  let cooled = expired;
  for (let i = 0; i < 100; i++) cooled = drive(cooled, THREE);
  assert.equal(cooled.speed, cooled.cruise);
  assert.equal(cooled.recovering, false);
});

test("boost activation uses the fitted rocket duration and respects no-rocket selection", () => {
  const activate = source.slice(source.indexOf("  function activateBoost()"), source.indexOf("  boostButton.onclick"));
  for (const [rocket, seconds] of [["small", 5], ["big", 9], ["none", 0]]) {
    const config = { ...DEFAULTS, rocket };
    const context = { modifier: { config, tuning: computeTuning(config) }, paused: false,
      boosting: false, recovering: false, sceneDirty: false, boostEnds: 0,
      performance: { now: () => 1000 }, flame: {}, boostButton: {} };
    context.show = (message) => { context.message = message; };
    runInNewContext(`${activate}; activateBoost();`, context);
    assert.equal(context.boosting, seconds > 0);
    if (seconds) {
      assert.equal(context.boostEnds, 1000 + seconds * 1000);
      assert.ok(context.message.includes(`${seconds} SECONDS`));
    }
  }
});

test("driving camera clears scenery after interpolation and on reset", () => {
  assert.ok(source.indexOf("const cameraScenery =") < source.indexOf("const car ="));
  const cameraFrame = source.slice(source.indexOf("    camera.position.lerp(desired"), source.indexOf("    camera.lookAt(target)"));
  assert.match(cameraFrame, /cameraAnchor\.copy\(car\.position\)\.y \+= 1\.7/);
  assert.match(cameraFrame, /clearCamera\(cameraAnchor, camera\.position\)/);
  const reset = source.slice(source.indexOf("  function reset("), source.indexOf("  function show(s)"));
  assert.match(reset, /clearCamera\(cameraAnchor, camera\.position\)/);
});

test("main remains bootstrap-driven and toolbar updates preserve icons and label nodes", () => {
  assert.equal(typeof main, "function");
  assert.match(source, /export async function main\(loading\)/);
  for (const hook of ["phase", "complete", "navigate", "fail"]) assert.ok(source.includes(`loading.${hook}`));
  assert.doesNotMatch(source, /(?:boostButton|pauseButton|document\.getElementById\("(?:camera|reset)"\))\.(?:textContent|innerHTML)\s*=/);
  assert.match(source, /boostButton\.querySelector\("\[data-label\]"\)/);
  assert.match(source, /pauseButton\.querySelector\("\[data-label\]"\)/);
});

test("driving steering consumes analog input but nonzero keyboard steering takes precedence", () => {
  // Exercise the production expression without constructing WebGL or loading the level.
  const expression = source.match(/\bturn =\s*([\s\S]*?),\s*offroad =/)[1];
  const turn = new Function("keys", "THREE", `return (${expression});`);
  for (const steering of [-1, -0.4, 0, 0.25, 1]) assert.equal(turn({ steering }, THREE), steering);
  for (const steering of [undefined, false, NaN, Infinity, "0.5"]) assert.equal(turn({ steering }, THREE), 0);
  assert.equal(turn({ steering: 3 }, THREE), 1);
  assert.equal(turn({ steering: -3 }, THREE), -1);
  for (const key of ["a", "arrowleft"]) assert.equal(turn({ [key]: true, steering: -0.5 }, THREE), 1);
  for (const key of ["d", "arrowright"]) assert.equal(turn({ [key]: true, steering: 0.5 }, THREE), -1);
  assert.equal(turn({ a: true, d: true, steering: 0.25 }, THREE), 0.25);
});

test("garage frame renders only the preview and keeps wheel spin tied to modified radius", () => {
  const branch = source.match(/if \(modifier\.active\) \{\s*garagePreview\.render\(dt\);\s*return;\s*\}/)?.[0];
  assert.ok(branch, "garage bypasses driving physics and the road camera");
  const render = new Function("modifier", "garagePreview", "dt", `${branch}; throw new Error('Driving frame ran');`);
  let elapsed;
  render({ active: true }, { render(dt) { elapsed = dt; } }, 0.025);
  assert.equal(elapsed, 0.025);
  assert.match(source, /car\.add\(carVisual\)/);
  assert.match(source, /createGaragePreview\(\{\s*renderer, car: carVisual/);
  assert.match(source, /createModifier\(\{\s*visuals: vehicleModel\.visuals/);
  assert.match(source, /if \(modifier\.active\) \{\s*garagePreview\.resize\(\);\s*return ratioChanged;\s*\}/);
  assert.match(source, /w\.tire\.rotation\.x \+= \(speed \* dt\) \/ w\.radius/);
  assert.match(source, /w\.hub\.rotation\.x \+= \(speed \* dt\) \/ w\.radius/);
});

test("production garage lifecycle parks boost, preserves driving pose/pause, and redraws on close", () => {
  const callback = source.slice(source.indexOf("    onOpenChange(open) {"), source.indexOf("  function reset("));
  const method = callback.slice(0, callback.lastIndexOf("  });"));
  for (const paused of [false, true]) {
    const controls = { camera: {}, reset: {} };
    const context = {
      speed: 25, slipX: 3, slipZ: -2, steer: 0.5, heading: 2.1, paused,
      loading: { active: false }, contextLost: false,
      audio: { silence() {} }, saveDrive() {},
      boosting: true, recovering: true, boostEnds: 9000, flame: { visible: true },
      boostButton: { disabled: true }, boostText: {}, boostLabel: "Boost",
      wheels: [{ pivot: { rotation: { y: 0.3 } } }],
      ui: { speed: {}, gear: {}, meter: { style: {} } },
      document: { getElementById: (id) => controls[id], body: { classList: { remove() {} } } },
      performance: { now: () => 5000 }, last: 0, qualityStart: 0, fpsStart: 0,
      qualityFrames: 10, fpsFrames: 10, clears: 0, resized: 0, rendered: 0,
    };
    context.clearKeys = () => context.clears++;
    context.resize = () => context.resized++;
    context.renderFrame = () => context.rendered++;
    const lifecycle = runInNewContext(`({${method}})`, context);
    lifecycle.onOpenChange(true);
    for (const key of ["speed", "slipX", "slipZ", "steer", "boostEnds"]) assert.equal(context[key], 0);
    assert.equal(context.flame.visible, false);
    assert.equal(context.boosting || context.recovering || context.boostButton.disabled, false);
    assert.equal(context.boostText.textContent, "Boost");
    assert.equal(controls.camera.disabled && controls.reset.disabled, true);
    assert.equal(context.paused, paused);
    assert.equal(context.heading, 2.1);
    lifecycle.onOpenChange(false);
    assert.equal(context.clears, 2);
    assert.equal(context.resized, 1, "current viewport replaces the pre-garage dimensions");
    assert.equal(context.rendered, 1, "paused game must not retain the last garage image");
    assert.equal(controls.camera.disabled || controls.reset.disabled, false);
    assert.equal(context.last, 5000);
    assert.equal(context.qualityStart, 5000);
    assert.equal(context.fpsStart, 5000);
    assert.equal(context.qualityFrames + context.fpsFrames, 0);
    assert.equal(context.paused, paused);
    assert.equal(context.heading, 2.1);
    context.contextLost = true;
    lifecycle.onOpenChange(false);
    assert.equal(context.rendered, 1, "context-loss cleanup must not render into a lost context");
  }
});

test("production vehicle swaps commit ready models without replacing the driving or preview roots", async () => {
  const start = source.indexOf("    async onVehicleChange(");
  const callback = source.slice(start, source.indexOf("    canOpen:", start));
  assert.ok(start >= 0);
  for (const outcome of ["success", "load failure", "aborted", "closed", "invalid model"]) {
    const car = new THREE.Group(), carVisual = new THREE.Group();
    car.position.set(80, 3, -45);
    car.rotation.y = 1.2;
    car.add(carVisual);
    const makeModel = (id) => ({
      car: new THREE.Group(), vehicle: getVehicle(id), wheels: [{ id }], flame: { visible: false }, disposals: 0,
      visuals: { apply(config) { this.config = config; } },
      dispose() { this.disposals++; this.car.removeFromParent(); },
    });
    const old = makeModel("porsche"), next = makeModel("tesla"), request = new AbortController();
    carVisual.add(old.car);
    let resolve, reject;
    const context = { carVisual, vehicleModel: old, wheels: old.wheels, flame: old.flame, sceneDirty: false,
      modifier: { active: true }, DOMException,
      loadVehicleModel(id, options) {
        assert.equal(id, "tesla");
        assert.equal(options.signal, request.signal);
        return new Promise((yes, no) => { resolve = yes; reject = no; });
      },
    };
    const handler = runInNewContext(`({${callback}})`, context);
    const config = { ...DEFAULTS, engine: "electric", color: "blue" };
    const pending = handler.onVehicleChange("tesla", config, request.signal);
    assert.equal(context.vehicleModel, old, "keep the old car while the request is in flight");
    if (outcome === "aborted") request.abort();
    if (outcome === "closed") context.modifier.active = false;
    if (outcome === "invalid model") next.visuals.apply = () => { throw new Error("Invalid model"); };
    if (outcome === "load failure") reject(new Error("Missing asset"));
    else resolve(next);
    if (outcome === "success") {
      assert.equal(await pending, next.visuals);
      assert.equal(context.vehicleModel, next);
      assert.equal(context.wheels, next.wheels);
      assert.equal(context.flame, next.flame);
      assert.equal(context.sceneDirty, true);
      assert.deepEqual(next.visuals.config, config);
      assert.deepEqual(carVisual.children, [next.car]);
      assert.equal(old.disposals, 1);
      assert.equal(next.disposals, 0);
    } else {
      await assert.rejects(pending);
      assert.equal(context.vehicleModel, old);
      assert.equal(context.wheels, old.wheels);
      assert.equal(context.flame, old.flame);
      assert.equal(context.sceneDirty, false);
      assert.deepEqual(carVisual.children, [old.car]);
      assert.equal(old.disposals, 0);
      assert.equal(next.disposals, outcome === "load failure" ? 0 : 1);
    }
    assert.equal(carVisual.parent, car);
    assert.deepEqual(car.position.toArray(), [80, 3, -45]);
    assert.equal(car.rotation.y, 1.2);
  }
});

test("a missing saved Tesla falls back to the Porsche without losing the rest of the build", async () => {
  const start = source.indexOf("  let vehicleModel, vehicleLoadMessage");
  const initialize = new Function("saved", "session", "loadVehicleModel", "getVehicle", "carVisual", "mat", `
    return (async () => {
      ${source.slice(start, source.indexOf("  const gates =", start))}
      return { vehicleModel, vehicleLoadMessage, wheels, flame };
    })();
  `);
  const saved = { vehicle: "tesla", config: { ...DEFAULTS, color: "blue", engine: "electric", wheels: "monster" } };
  const calls = [], patches = [], carVisual = new THREE.Group();
  const replacement = { car: new THREE.Group(), wheels: [], flame: {} };
  const load = async (id) => {
    calls.push(id);
    if (id === "tesla") throw new Error("Offline");
    return replacement;
  };
  const result = await initialize(saved, { update: (patch) => patches.push(patch) }, load, getVehicle, carVisual, () => ({}));
  assert.deepEqual(calls, ["tesla", "porsche"]);
  assert.equal(result.vehicleModel, replacement);
  assert.equal(result.wheels, replacement.wheels);
  assert.equal(result.flame, replacement.flame);
  assert.match(result.vehicleLoadMessage, /Tesla.*could not load.*Porsche.*garage/);
  assert.deepEqual(patches, [{ vehicle: "porsche", config: { ...saved.config, engine: "four" } }]);
  assert.deepEqual(carVisual.children, [replacement.car]);
  await assert.rejects(initialize({ ...saved, vehicle: "porsche" }, {}, async () => { throw new Error("Offline"); },
    getVehicle, carVisual, () => ({})), /Offline/, "a failed fallback still reaches the normal loading error/retry screen");
});
