import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as THREE from "three";
import { main } from "./game-source.js";
import { DEFAULTS, PARTS, computeTuning } from "./modifier-data.js";
import { VEHICLES, getVehicle } from "./vehicle-data.js";
import { createVehicleActions } from "./vehicle-actions.js";
import { sampleDrivingSurface } from "./driving-terrain.js";

const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");

test("boost accepts a secondary touch without stealing held controls or double firing on click", () => {
  const listeners = new Map();
  const button = { disabled: false, addEventListener: (name, handler) => listeners.set(name, handler) };
  let activations = 0;
  const binding = source.slice(source.indexOf("  boostButton.onclick"), source.indexOf("  await loading.phase(3"));
  new Function("boostButton", "activateBoost", binding)(button, () => activations++);
  const pointer = (buttonNumber = 0) => {
    const event = Object.assign(new Event("pointerdown", { cancelable: true }), {
      button: buttonNumber, pointerType: "touch", pointerId: 3, isPrimary: false,
    });
    listeners.get("pointerdown")(event);
    return event;
  };
  assert.equal(pointer().defaultPrevented, true, "keep focus and both existing driving pointers");
  assert.equal(activations, 1);
  button.onclick({ detail: 1 });
  assert.equal(activations, 1, "pointer click does not repeat activation");
  button.onclick({ detail: 0 });
  assert.equal(activations, 2, "keyboard and assistive activation still work");
  pointer(2);
  button.disabled = true;
  pointer();
  assert.equal(activations, 2, "secondary mouse buttons and disabled input are ignored");
});

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

// Run the actual longitudinal and steering blocks without loading a WebGL scene.
const drive = new Function("getVehicle", "state", "THREE", `
  let { speed = 0, boosting = false, recovering = false, throttle = 1,
    keys = {}, now = 0, boostEnds = 5000, dt = 1 / 60, offroad = false, tune,
    steer = 0, turn = 0, heading = 0 } = state;
  const handling = getVehicle(state.vehicle ?? "porsche").handling;
  const special = state.special ?? { speedFactor: 1, accelFactor: 1, locked: false, hop: 0 };
  const jumpPhysics = { state: () => ({ airborne: state.airborne ?? false }) };
  const document = { body: { classList: { toggle() {} } } };
  const flame = {}, boostText = {}, boostButton = {};
  const vehicleModel = { visuals: { boosters: { animateFlame() {} } } };
  const itemSystem = { modifiers: () => state.itemEffect ?? { speedFactor: 1, wobble: 0, shield: 0, turbo: 0 } };
  let playerItemFactor = state.playerItemFactor ?? 1, slipX = state.slipX ?? 0, slipZ = state.slipZ ?? 0;
  const show = () => {}, boostLabel = 'Boost';
  let sceneDirty = false;
  ${source.slice(source.indexOf("    const itemEffect ="), source.indexOf("    const forwardX = Math.sin(heading)"))}
  return { ...state, speed, boosting, recovering, disabled: boostButton.disabled,
    cruise: cruiseMax(offroad), boost: boostMax(offroad), playerItemFactor,
    slipX, slipZ, heading, steer };
`).bind(null, getVehicle);

test("item slowdowns cancel boost, preserve steering momentum recovery, and expire", () => {
  const tune = computeTuning(DEFAULTS), itemEffect = { speedFactor: .6, wobble: 1, shield: 0, turbo: 0 };
  let state = drive({ tune, itemEffect, speed: 30, slipX: 5, slipZ: 5, boosting: true }, THREE);
  assert.equal(state.boosting, false);
  assert.equal(state.recovering, false);
  assert.equal(state.slipX, 3);
  const initial = state.speed;
  for (let i = 0; i < 180; i++) state = drive(state, THREE);
  assert.ok(state.speed >= initial, "a persistent slow is not multiplied into a complete stop");
  assert.equal(state.cruise, 32 * tune.top * .6);
  state.itemEffect = { speedFactor: 1, wobble: 0, shield: 0, turbo: 0 };
  for (let i = 0; i < 600; i++) state = drive(state, THREE);
  assert.equal(state.cruise, 32 * tune.top);
  assert.ok(Math.abs(state.speed - state.cruise) < .001);
});

test("Turbo Star speeds every car without fitted rockets and still allows braking", () => {
  const tune = computeTuning({ ...DEFAULTS, rocket: "none" });
  const itemEffect = { speedFactor: 1, wobble: 0, shield: 0, turbo: 5 };
  for (const offroad of [false, true]) {
    let state = { tune, itemEffect, offroad };
    for (let i = 0; i < 240; i++) state = drive(state, THREE);
    assert.ok(state.speed > (offroad ? 17 * tune.offroadTop : 32 * tune.top) * 1.4);
    assert.ok(drive({ ...state, keys: { " ": true } }, THREE).speed < state.speed);
    assert.ok(drive({ ...state, throttle: -1 }, THREE).speed < state.speed);
    assert.equal(drive({ ...state, speed: 0, throttle: 0 }, THREE).speed, 0);
  }
});

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

test("registry handling keeps the digger below the van and ordinary cars with identical upgrades, terrain and boost", () => {
  for (const { id: engine } of PARTS.find(part => part.id === "engine").options) {
    for (const upgrades of [{}, { wheels: "monster", suspension: "lift", spoiler: "mega" }]) {
      const tune = computeTuning({ ...DEFAULTS, ...upgrades, engine, rocket: "big" });
      for (const offroad of [false, true]) for (const boosting of [false, true]) {
        const results = new Map();
        for (const { id: vehicle } of VEHICLES) {
          let state = { vehicle, tune, offroad, boosting };
          for (let i = 0; i < 1200; i++) state = drive(state, THREE);
          const base = offroad ? 17 * tune.offroadTop : 32 * tune.top;
          const factor = vehicle === "backhoe" ? .52 : vehicle === "dhl-van" ? .78 : 1;
          assert.ok(Math.abs(state.cruise - base * factor) < 1e-10, `${vehicle} uses its road/off-road cap`);
          assert.ok(Math.abs(state.speed - (boosting ? state.boost : state.cruise)) < .001, `${vehicle} reaches its cap`);
          results.set(vehicle, state.speed);
        }
        assert.ok(results.get("backhoe") < results.get("dhl-van"));
        for (const { id } of VEHICLES.filter(vehicle => !vehicle.utility)) {
          assert.ok(results.get("dhl-van") < results.get(id));
          assert.equal(results.get(id), results.get("porsche"), "ordinary-car handling is unchanged");
        }
      }
    }
  }
});

test("backhoe acceleration is 55%, steering is 72% and reverse is capped at 5 m/s", () => {
  for (const engine of ["four", "eight", "electric"]) {
    const tune = computeTuning({ ...DEFAULTS, engine, rocket: "big" });
    for (const boosting of [false, true]) {
      const car = drive({ tune, boosting }, THREE);
      for (const [vehicle, factor] of [["backhoe", .55], ["dhl-van", .75]]) {
        const utility = drive({ vehicle, tune, boosting }, THREE);
        assert.ok(Math.abs(utility.speed / car.speed - factor) < 1e-10, `${vehicle} acceleration, boost=${boosting}`);
      }
    }
    for (const airborne of [false, true]) for (const handbrake of [false, true]) {
      const state = { tune, speed: 4, throttle: 0, turn: 1, airborne, keys: { " ": handbrake } };
      const car = drive(state, THREE);
      assert.ok(car.heading > 0);
      for (const [vehicle, factor] of [["backhoe", .72], ["dhl-van", .86]]) {
        const utility = drive({ ...state, vehicle }, THREE);
        assert.equal(utility.speed, car.speed, "compare steering at the same speed");
        assert.equal(utility.steer, car.steer, "input smoothing is unchanged");
        assert.ok(Math.abs(utility.heading / car.heading - factor) < 1e-10);
      }
    }
    for (const [vehicle, reverse] of [["porsche", 9], ["backhoe", 5], ["dhl-van", 7]]) {
      let state = { tune, vehicle, throttle: -1 };
      for (let i = 0; i < 600; i++) state = drive(state, THREE);
      assert.equal(state.speed, -reverse);
    }
  }
});

test("active action modifiers amplify the actual handling block without changing neutral driving", () => {
  const tune = computeTuning({ ...DEFAULTS, rocket: "big" });
  for (const boosting of [false, true]) {
    const neutral = drive({ tune, boosting }, THREE);
    const sprint = drive({ tune, boosting, special: { speedFactor: 1.25, accelFactor: 1.6, locked: false, hop: 0 } }, THREE);
    assert.equal(sprint.cruise, neutral.cruise * 1.25);
    assert.equal(sprint.boost, neutral.boost * 1.25);
    assert.ok(Math.abs(sprint.speed / neutral.speed - 1.6) < 1e-10);
  }
});

test("production parked actions stop boost and held driving input until the active cycle ends", (t) => {
  const registration = source.slice(source.indexOf("  const actionContext ="), source.indexOf("  const itemSystem ="));
  const start = source.indexOf("    let throttle =", source.indexOf("  function frame(now)"));
  const driving = source.slice(start, source.indexOf("    const flight = jumpPhysics?.update", start));
  for (const id of ["backhoe", "dhl-van"]) {
    const scene = new THREE.Scene(), car = new THREE.Group(), motions = [], snapshots = [];
    scene.add(car);
    car.position.set(20, 0, 20);
    const c = { THREE, car, vehicleModel: { vehicle: getVehicle(id), car },
      gameReady: true, loading: { active: false }, paused: false, modifier: { active: false, tuning: computeTuning({ ...DEFAULTS, rocket: "big" }) },
      mobileUI: { active: false }, document: { hidden: false, body: { classList: { toggle() {} } } }, contextLost: false,
      speed: .2, slipX: .1, slipZ: -.1, heading: .4, steer: .5, keys: { w: true, a: true },
      boosting: true, recovering: true, boostEnds: 5000, flame: { visible: true },
      boostButton: { disabled: true }, boostText: {}, boostLabel: "Boost", sceneDirty: false,
      dt: 1 / 60, now: 1000, playerItemFactor: 1, surfacePose: null, isMoon: false,
      heightAt: () => 0, roadDist: () => 20, sampleDrivingSurface, show() {},
      jumpPhysics: { state: () => ({ airborne: false }) },
      itemSystem: { modifiers: () => ({ speedFactor: 1, wobble: 0, shield: 0, turbo: 5 }) },
      friendRacers: { update(dt, position, heading, speed, velocity) {
        motions.push({ speed, ...velocity });
        return { x: position.x + velocity.x * dt, z: position.z + velocity.z * dt };
      } },
      createVehicleActionUI(options) { c.controls = options; return { update(snapshot) { snapshots.push(snapshot); } }; },
    };
    c.vehicleActions = createVehicleActions({ scene, car, getModel: () => c.vehicleModel,
      heightAt: c.heightAt, roadDistance: c.roadDist, isSafePosition: () => true });
    t.after(() => c.vehicleActions.dispose());
    runInNewContext(`${registration}\nfunction step() { ${driving} }\napi = { step, actionContext };`, c);
    assert.ok(Math.abs(c.api.actionContext().speed - Math.hypot(.2, .1, -.1)) < 1e-10, "parking checks include lateral momentum");
    assert.equal(c.controls.enabled(), true);
    for (const [owner, key] of [[c, "paused"], [c.loading, "active"], [c.modifier, "active"],
      [c.mobileUI, "active"], [c.document, "hidden"], [c, "contextLost"]]) {
      owner[key] = true;
      assert.equal(c.controls.enabled(), false);
      owner[key] = false;
    }
    c.speed = 1;
    c.controls.activate();
    assert.equal(c.vehicleActions.modifiers().locked, false, "moving vehicles cannot start parked actions");
    assert.equal(c.boosting, true, "a rejected action does not cancel boost");
    assert.equal(snapshots.length, 0);
    c.speed = .2;
    c.controls.activate();
    assert.equal(c.vehicleActions.modifiers().locked, true);
    for (const key of ["speed", "slipX", "slipZ", "boostEnds"]) assert.equal(c[key], 0);
    assert.equal(c.boosting || c.recovering || c.flame.visible || c.boostButton.disabled, false);
    assert.equal(c.boostText.textContent, "Boost");
    assert.equal(c.sceneDirty, true);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].active, true);
    const parked = car.position.clone(), heading = c.heading;
    // Reintroduce harmless residual motion to prove each active frame enforces the lock.
    c.speed = .2; c.slipX = .1; c.slipZ = -.1; c.boosting = c.recovering = c.flame.visible = true;
    c.boostButton.disabled = true;
    for (let i = 0; i < 60; i++) c.api.step();
    assert.equal(c.vehicleActions.modifiers().locked, true);
    assert.ok(Math.abs(c.vehicleActions.state().remaining - (getVehicle(id).action.duration - 1)) < 1e-8);
    assert.ok(car.position.equals(parked), "held accelerator, steering and Turbo Star cannot move a parked action");
    assert.equal(c.heading, heading);
    assert.ok(motions.every(motion => motion.speed === 0 && motion.x === 0 && motion.z === 0));
    assert.equal(c.boosting || c.recovering || c.flame.visible || c.boostButton.disabled, false);
    for (let i = 0; i < 300 && c.vehicleActions.modifiers().locked; i++) c.api.step();
    assert.equal(c.vehicleActions.modifiers().locked, false);
    assert.ok(c.speed > 0, "held driving input resumes only after the action finishes");
    assert.ok(car.position.distanceTo(parked) > 0);
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
    const context = { modifier: { config, tuning: computeTuning(config) }, vehicleActions: { modifiers: () => ({ locked: false }) }, paused: false,
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
  assert.match(cameraFrame, /cameraAnchor\.copy\(car\.position\)\.y \+= profile\.anchor/);
  assert.match(cameraFrame, /clearCamera\(cameraAnchor, camera\.position\)/);
  const reset = source.slice(source.indexOf("  function reset("), source.indexOf("  function show(s)"));
  assert.match(reset, /clearCamera\(cameraAnchor, camera\.position\)/);
});

test("production cameras use larger utility profiles and adapt chase/overhead framing in portrait", () => {
  const start = source.indexOf("  function updateCamera(dt)");
  const cameraSource = source.slice(start, source.indexOf("  await loading.phase(4", start));
  const ordinary = getVehicle("porsche").camera;
  assert.deepEqual(ordinary, { distance: 9, height: 3.6, targetHeight: 1.3, anchor: 1.7, lookAhead: 6, side: 0,
    overhead: 25, eye: [.35, 1.45, .1], mirror: [0, 1.7, -2.5] });
  for (const vehicle of VEHICLES) {
    const profile = vehicle.camera;
    if (vehicle.utility) {
      for (const key of ["distance", "height", "targetHeight", "anchor", "overhead"]) assert.ok(profile[key] > ordinary[key], `${vehicle.id}/${key}`);
      assert.ok(profile.eye[1] > ordinary.eye[1]);
      assert.ok(profile.mirror[1] > ordinary.mirror[1]);
      assert.ok(profile.mirror[2] < ordinary.mirror[2]);
    } else assert.deepEqual(profile, ordinary);
    for (const [aspect, portraitFactor] of [[16 / 9, 1], [1, 1], [.8, 1.25], [390 / 844, 1.5]]) {
      for (const camMode of [0, 1, 2]) for (const hasRamps of [false, true]) {
        const car = new THREE.Group(), camera = new THREE.PerspectiveCamera(55, aspect);
        car.position.set(20, 0, -30);
        car.rotation.set(.1, .7, -.08, "YXZ");
        const cameraAnchor = new THREE.Vector3(), cleared = [];
        let target;
        camera.lookAt = value => { target = value.clone(); };
        const context = { THREE, car, camera, cameraAnchor, camMode, hasRamps, heading: .7, boosting: false,
          vehicleModel: { vehicle }, heightAt: () => 0, surfacePose: { height: 0 },
          clearCamera(anchor, position) { cleared.push([anchor.clone(), position.clone()]); },
        };
        runInNewContext(`${cameraSource}; updateCamera(10);`, context);
        const framing = vehicle.utility ? portraitFactor : 1;
        const forward = new THREE.Vector3(Math.sin(.7), 0, Math.cos(.7));
        const expected = car.position.clone(), look = car.position.clone();
        if (camMode === 0) {
          expected.addScaledVector(forward, -Math.max(hasRamps ? 12 : 9, profile.distance) * framing);
          expected.y += profile.height * framing;
          expected.x += Math.cos(.7) * profile.side * framing;
          expected.z -= Math.sin(.7) * profile.side * framing;
          look.addScaledVector(forward, profile.lookAhead).y = profile.targetHeight;
        } else if (camMode === 1) {
          expected.addScaledVector(forward, -6).y += profile.overhead * framing;
          look.addScaledVector(forward, 4);
        } else {
          expected.fromArray(profile.eye).applyQuaternion(car.quaternion).add(car.position);
          look.set(profile.eye[0], profile.eye[1], profile.eye[2] + 20).applyQuaternion(car.quaternion).add(car.position);
        }
        assert.ok(camera.position.distanceTo(expected) < 1e-8, `${vehicle.id}/${aspect}/${camMode}/${hasRamps}`);
        assert.ok(target.distanceTo(look) < 1e-8);
        assert.equal(cleared.length, 1, "all views still resolve scenery after positioning");
        assert.ok(cleared[0][1].distanceTo(expected) < 1e-8);
        assert.ok(cleared[0][0].distanceTo(car.position.clone().add(new THREE.Vector3(0, profile.anchor, 0))) < 1e-8);
      }
    }
  }
});

test("utility chase views keep rear work and deposits above the bottom HUD in desktop and both phone orientations", () => {
  const start = source.indexOf("  function updateCamera(dt)");
  const cameraSource = source.slice(start, source.indexOf("  await loading.phase(4", start));
  for (const id of ["backhoe", "dhl-van"]) for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    const car = new THREE.Group(), camera = new THREE.PerspectiveCamera(55, width / height);
    const context = { THREE, car, camera, cameraAnchor: new THREE.Vector3(), camMode: 0,
      hasRamps: false, heading: 0, boosting: false, surfacePose: { height: 0 },
      vehicleModel: { vehicle: getVehicle(id) }, heightAt: () => 0, clearCamera() {} };
    runInNewContext(`${cameraSource}; updateCamera(10);`, context);
    camera.updateMatrixWorld(true);
    const rear = id === "backhoe" ? -6.4 : -4.3;
    for (const x of [-1.6, 0, 1.6]) for (const y of [0, 1]) {
      const projected = new THREE.Vector3(x, y, rear).project(camera);
      assert.ok(Math.abs(projected.x) < .95, `${id}/${width}: work stays inside horizontal frame`);
      assert.ok(projected.y > -.4 && projected.y < .95, `${id}/${width}: rear work stays above the bottom controls`);
    }
  }
});

test("main remains bootstrap-driven and toolbar updates preserve icons and label nodes", () => {
  assert.equal(typeof main, "function");
  assert.match(source, /export async function main\(loading\)/);
  for (const hook of ["phase", "complete", "navigate", "fail"]) assert.ok(source.includes(`loading.${hook}`));
  assert.doesNotMatch(source, /(?:boostButton|pauseButton|document\.getElementById\("(?:camera|reset)"\))\.(?:textContent|innerHTML)\s*=/);
  assert.match(source, /boostButton\.querySelector\("\[data-label\]"\)/);
  assert.match(source, /pauseButton\.querySelector\("\[data-label\]"\)/);
});

test("automatic map entry waits for a driving gesture before unlocking audio", () => {
  const start = source.indexOf("  loading.complete(");
  const registration = source.slice(start, source.indexOf("  requestAnimationFrame(frame);", start));
  for (const [action, automatic] of [["drive", true], ["drive", false], ["garage", false]]) {
    let enter, unlocks = 0, garages = 0;
    const context = {
      loading: { complete(callback) { enter = callback; } }, clearKeys() {},
      performance: { now: () => 5000 }, last: 0, qualityStart: 0, fpsStart: 0,
      qualityFrames: 10, fpsFrames: 10, resumeOnReturn: true, contextLost: false,
      unlockAudio() { unlocks++; }, pauseGame(value) { context.paused = value; },
      modifier: { open() { garages++; } },
    };
    runInNewContext(registration, context);
    enter(action, { automatic });
    assert.equal(unlocks, automatic ? 0 : 1);
    assert.equal(context.paused, false);
    assert.equal(garages, action === "garage" ? 1 : 0);
    assert.equal(context.last, 5000);
  }
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
  const start = source.indexOf("    if (modifier.active) {", source.indexOf("  function frame(now)"));
  const branch = source.slice(start, source.indexOf("    daylight.advance(", start));
  assert.ok(branch, "garage bypasses driving physics and the road camera");
  const render = new Function("modifier", "garagePreview", "dt", "itemUI", "itemSnapshot", "itemSystem", `${branch}; throw new Error('Driving frame ran');`);
  let elapsed;
  render({ active: true }, { render(dt) { elapsed = dt; } }, 0.025, { update() {} }, {}, { modifiers: () => ({}) });
  assert.equal(elapsed, 0.025);
  assert.match(source, /car\.add\(carVisual\)/);
  assert.match(source, /createGaragePreview\(\{\s*renderer, car: carVisual/);
  assert.match(source, /createModifier\(\{\s*visuals: vehicleModel\.visuals/);
  assert.match(source, /if \(modifier\.active\) \{\s*garagePreview\.resize\(\);\s*return ratioChanged;\s*\}/);
  assert.match(source, /w\.tire\.rotation\.x \+= \(speed \* dt\) \/ w\.radius/);
  assert.match(source, /w\.hub\.rotation\.x \+= \(speed \* dt\) \/ w\.radius/);
});

test("Elio's flag uses resolved velocity only during driving and honors reduced motion", () => {
  const call = "vehicleModel.flag.update(dt, motion.vx, motion.vz, heading, reducedMotion);";
  assert.ok(source.indexOf(call) > source.indexOf("const motion = friendRacers.update"));
  assert.ok(source.indexOf(call) > source.indexOf("garagePreview.render(dt)"));
  const args = [];
  const update = new Function("vehicleModel", "dt", "motion", "heading", "reducedMotion", call);
  update({ flag: { update(...values) { args.push(values); } } }, .025, { vx: -12, vz: 8 }, 1.2, true);
  assert.deepEqual(args, [[.025, -12, 8, 1.2, true]]);
  assert.match(source, /contactTexture: contact, reducedMotion, onRace/);
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
      carVisual: { position: { y: .7 } },
      vehicleActions: { resets: 0, reset() { this.resets++; } },
      boostButton: { disabled: true }, boostText: {}, boostLabel: "Boost",
      wheels: [{ pivot: { rotation: { y: 0.3 } } }],
      vehicleModel: { flag: { resets: 0, reset() { this.resets++; } } },
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
    assert.equal(context.vehicleModel.flag.resets, 1, "parking in the garage removes wind momentum");
    assert.equal(context.vehicleActions.resets, 1, "opening cancels the active action and its effects");
    assert.equal(context.carVisual.position.y, 0, "opening clears the visual hop offset");
    assert.equal(context.boosting || context.recovering || context.boostButton.disabled, false);
    assert.equal(context.boostText.textContent, "Boost");
    assert.equal(controls.camera.disabled && controls.reset.disabled, true);
    assert.equal(context.paused, paused);
    assert.equal(context.heading, 2.1);
    lifecycle.onOpenChange(false);
    assert.equal(context.vehicleActions.resets, 1, "closing does not reset the new model's actions again");
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
  for (const id of ["tesla", "backhoe", "dhl-van"]) for (const outcome of ["success", "load failure", "aborted", "closed", "invalid model"]) {
    const car = new THREE.Group(), carVisual = new THREE.Group();
    car.position.set(80, 3, -45);
    car.rotation.y = 1.2;
    car.add(carVisual);
    const makeModel = (id) => ({
      car: new THREE.Group(), vehicle: getVehicle(id), wheels: [{ id }], flame: { visible: false }, disposals: 0,
      visuals: { apply(config) { this.config = config; } },
      dispose() { this.disposals++; this.car.removeFromParent(); },
    });
    const old = makeModel("porsche"), next = makeModel(id), request = new AbortController();
    carVisual.add(old.car);
    let resolve, reject;
    const lifecycle = [];
    const context = { carVisual, vehicleModel: old, wheels: old.wheels, flame: old.flame, sceneDirty: false,
      modifier: { active: true }, DOMException,
      vehicleActions: { reset() {
        assert.equal(context.vehicleModel, old, "reset the old action before replacing its model");
        assert.equal(old.disposals, 0);
        lifecycle.push("reset");
      } },
      syncVehicleSize() {
        assert.equal(context.vehicleModel, next);
        assert.equal(context.wheels, next.wheels);
        assert.equal(old.disposals, 0, "synchronize the new bounds before disposing the previous model");
        lifecycle.push("size");
      },
      loadVehicleModel(requested, options) {
        assert.equal(requested, id);
        assert.equal(options.signal, request.signal);
        return new Promise((yes, no) => { resolve = yes; reject = no; });
      },
    };
    const handler = runInNewContext(`({${callback}})`, context);
    const config = { ...DEFAULTS, engine: getVehicle(id).engine, color: getVehicle(id).color ?? "blue" };
    const pending = handler.onVehicleChange(id, config, request.signal);
    assert.equal(context.vehicleModel, old, "keep the old car while the request is in flight");
    assert.deepEqual(lifecycle, [], "pending loads leave actions and collision sizes intact");
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
      assert.deepEqual(lifecycle, ["reset", "size"]);
    } else {
      await assert.rejects(pending);
      assert.equal(context.vehicleModel, old);
      assert.equal(context.wheels, old.wheels);
      assert.equal(context.flame, old.flame);
      assert.equal(context.sceneDirty, false);
      assert.deepEqual(carVisual.children, [old.car]);
      assert.equal(old.disposals, 0);
      assert.equal(next.disposals, outcome === "load failure" ? 0 : 1);
      assert.deepEqual(lifecycle, [], "rejected candidates cannot reset the current action or change its bounds");
    }
    assert.equal(carVisual.parent, car);
    assert.deepEqual(car.position.toArray(), [80, 3, -45]);
    assert.equal(car.rotation.y, 1.2);
  }
});

test("production size synchronization updates collision fields, mirror profile and contact shadow on every vehicle swap", () => {
  const start = source.indexOf("  function syncVehicleSize()");
  const sync = source.slice(start, source.indexOf("  const vehicleActions =", start));
  const sizes = [[], [], []], car = new THREE.Group();
  for (const vehicle of [...VEHICLES, getVehicle("porsche")]) {
    const dimensions = vehicle.utility ? { width: vehicle.id === "backhoe" ? 3.5 : 3.2, length: vehicle.length } : undefined;
    const shadowCoordinates = new Float32Array(12);
    const c = { car, vehicleModel: { vehicle, car: { userData: { dimensions } } }, shadowCoordinates,
      carShadow: { geometry: { attributes: { position: { count: 4 } } } },
      ...Object.fromEntries(["coneField", "playField", "peopleField"].map((name, index) => [name,
        { setVehicleSize(value) { sizes[index].push(value); } }])),
    };
    runInNewContext(sync, c);
    assert.equal(car.userData.cameraProfile, vehicle.camera);
    for (const calls of sizes) assert.equal(calls.at(-1), vehicle.handling.halfExtents);
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(shadowCoordinates[i * 3] - (i % 2 ? 1 : -1) * (dimensions ? dimensions.width * .8 : 1.75)) < 1e-6);
      assert.ok(Math.abs(shadowCoordinates[i * 3 + 1] - (i < 2 ? 1 : -1) * (dimensions ? dimensions.length * .6 : 3.05)) < 1e-6);
    }
  }
  assert.ok(sizes.every(calls => calls.length === 8));
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
