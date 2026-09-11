import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { sampleDaylight, createDaylight, enableGeometryShadows } from "./daylight.js";

test("solar arc rises in the east, moves overhead and sets in the west with opposite moon", () => {
  assert.ok(sampleDaylight(6).sunDirection.x > 0.99);
  assert.ok(sampleDaylight(12).sunDirection.y > 0.85);
  assert.ok(sampleDaylight(18).sunDirection.x < -0.99);
  for (let hour = 0; hour < 24; hour += 0.05) {
    const state = sampleDaylight(hour);
    assert.ok(Math.abs(state.sunDirection.length() - 1) < 1e-12);
    assert.ok(state.sunDirection.dot(state.moonDirection) < -0.999999);
    for (const key of ["night", "stars", "twilight", "daylight"]) assert.ok(state[key] >= 0 && state[key] <= 1);
  }
  assert.equal(sampleDaylight(12, "wellington").sunDirection.z, -sampleDaylight(12).sunDirection.z);
});

test("lamps fade in at dusk before stars, with cool moonlight and no midnight sunlight", () => {
  const day = sampleDaylight(12), dusk = sampleDaylight(18), night = sampleDaylight(0);
  assert.equal(day.night + day.stars + day.moonIntensity, 0);
  assert.ok(day.sunIntensity > 2.5);
  assert.ok(dusk.night > 0.3 && dusk.night < 0.8);
  assert.equal(dusk.stars, 0);
  assert.equal(night.night, 1); assert.equal(night.stars, 1); assert.equal(night.sunIntensity, 0);
  assert.ok(night.moonIntensity > 0.5);
  assert.ok(dusk.sunColor.r > dusk.sunColor.b * 2);
  assert.ok(night.zenith.b > night.zenith.r);
});

test("clock wraps continuously and state storage is reusable", () => {
  assert.equal(sampleDaylight(-1).hour, 23);
  assert.equal(sampleDaylight(48).hour, 0);
  assert.equal(sampleDaylight(NaN).hour, 16.5);
  const state = sampleDaylight(23.999999), direction = state.sunDirection, horizon = state.horizon;
  const midnight = sampleDaylight(0);
  assert.ok(state.sunDirection.distanceTo(midnight.sunDirection) < 1e-6);
  assert.ok(state.horizon.equals(midnight.horizon));
  assert.equal(sampleDaylight(12, "city", state), state);
  assert.equal(state.sunDirection, direction); assert.equal(state.horizon, horizon);
});

test("lunar world stays in vacuum without disabling the clock or night lamps", () => {
  for (const hour of [0, 6, 12, 18]) {
    const state = sampleDaylight(hour, "moon");
    assert.equal(state.stars, 1);
    assert.equal(state.horizon.getHex(), 0);
    assert.equal(state.zenith.getHex(), 0);
  }
  assert.equal(sampleDaylight(0, "moon").night, 1);
  assert.equal(sampleDaylight(12, "moon").night, 0);
  assert.equal(sampleDaylight(12, "moon").period, "daylight");
  assert.equal(sampleDaylight(0, "moon").period, "night");
});

function setup(tablet = false, reducedMotion = false) {
  const scene = new THREE.Scene(), renderer = { toneMappingExposure: 1.02, shadowMap: { needsUpdate: false } };
  scene.environmentIntensity = 0.7;
  const daylight = createDaylight({ scene, renderer, level: "forest", tablet, reducedMotion });
  return { scene, renderer, daylight };
}

test("clock honors freeze, speed, reduced motion, invalid dt and resume without catch-up", () => {
  const { daylight } = setup(false, true);
  assert.equal(daylight.state().running, false);
  daylight.advance(0.05); assert.equal(daylight.state().hour, 16.5);
  daylight.setRunning(true); daylight.setHour(23.99); daylight.setCycleMinutes(3);
  for (let i = 0; i < 15; i++) daylight.advance(0.05);
  assert.ok(Math.abs(daylight.state().hour - 0.09) < 1e-10);
  const hour = daylight.state().hour;
  for (const dt of [NaN, Infinity, -1, 0]) daylight.advance(dt);
  assert.equal(daylight.state().hour, hour);
  daylight.advance(60);
  assert.ok(daylight.state().hour - hour < 0.02, "a suspended tab never fast-forwards a game day");
  daylight.setCycleMinutes(0); assert.equal(daylight.state().cycleMinutes, 3);
  daylight.setRunning(false);
  const frozen = daylight.state().hour;
  daylight.advance(0.1); daylight.setHour(Infinity);
  assert.equal(daylight.state().hour, frozen);
  daylight.dispose();
});

test("local shadow rig follows the car, switches light source and dims environment reflections", () => {
  for (const tablet of [false, true]) {
    const { scene, renderer, daylight } = setup(tablet);
    const sun = scene.getObjectByName("DaylightSun"), moon = scene.getObjectByName("DaylightMoon");
    assert.equal(sun.shadow.mapSize.x, tablet ? 2048 : 4096);
    assert.equal(sun.shadow.autoUpdate, false);
    const position = new THREE.Vector3(2800, 46, -1700);
    daylight.setHour(12); daylight.update(position);
    assert.ok(sun.target.position.distanceTo(position) < 0.2);
    assert.ok(sun.position.clone().sub(sun.target.position).normalize().dot(daylight.state().sunDirection) > 0.99999);
    assert.equal(sun.shadow.needsUpdate, true); assert.equal(moon.shadow.needsUpdate, false);
    assert.equal(renderer.shadowMap.needsUpdate, true);
    const dayEnvironment = scene.environmentIntensity;
    daylight.setHour(0); daylight.update(position);
    assert.equal(sun.shadow.needsUpdate, false); assert.equal(moon.shadow.needsUpdate, true);
    assert.ok(scene.environmentIntensity < dayEnvironment * 0.15);
    assert.ok(moon.position.y > position.y);
    assert.equal(scene.children.filter(object => object.isLight).length, 3);
    daylight.dispose(); daylight.dispose();
    assert.equal(scene.children.length, 0);
    assert.equal(scene.environmentIntensity, 0.7); assert.equal(renderer.toneMappingExposure, 1.02);
  }
});

test("physical geometry including cutout foliage casts and receives shadows, not sky/water/decals", () => {
  const root = new THREE.Group();
  const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshPhysicalMaterial(),
    new THREE.MeshStandardMaterial({ alphaTest: 0.5, transparent: true }),
    new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 }),
    new THREE.MeshStandardMaterial({ depthWrite: false }), new THREE.MeshBasicMaterial(), new THREE.ShaderMaterial()];
  materials.forEach(material => root.add(new THREE.Mesh(new THREE.BoxGeometry(), material)));
  enableGeometryShadows(root);
  root.children.forEach((object, i) => {
    assert.equal(object.castShadow, i < 3); assert.equal(object.receiveShadow, i < 3);
  });
  root.children[0].userData.castShadow = false;
  enableGeometryShadows(root);
  assert.equal(root.children[0].castShadow, false, "explicit receive-only scenery keeps its overdraw budget");
  assert.equal(root.children[0].receiveShadow, true);
  root.children.forEach(object => {
    object.geometry.dispose(); object.material.dispose();
  });
});

test("game coordinates lights before cockpit hiding and advances time only in active driving", async () => {
  const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
  const render = source.slice(source.indexOf("  function renderFrame()"), source.indexOf("  const keys ="));
  assert.ok(render.indexOf("daylight.update(car.position)") < render.indexOf("car.visible = carVisible && !inside"));
  assert.ok(render.indexOf("nightLighting.update(") < render.indexOf("atmosphere.render("));
  assert.ok(render.indexOf("atmosphere.setDaylight(") < render.indexOf("atmosphere.render("));
  const frame = source.slice(source.indexOf("  function frame(now)"), source.indexOf("  function updateCamera(dt)"));
  assert.ok(frame.indexOf("daylight.advance(dt)") > frame.indexOf("garagePreview.render(dt)"));
  assert.match(frame, /sceneDirty && gameReady[\s\S]*renderFrame\(\)/);
  assert.doesNotMatch(source, /reflectedLight\.directDiffuse \*=|t\.x \+ t\.h \* 0\.8/);
});
