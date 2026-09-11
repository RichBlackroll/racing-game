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
    for (const key of ["night", "stars", "twilight", "warmGlow", "blueHour", "daylight"])
      assert.ok(state[key] >= 0 && state[key] <= 1);
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

test("both horizons cross warm sunrise/sunset and a distinct cool blue hour without color jumps", () => {
  for (const level of ["forest", "city", "stunt", "amsterdam", "wellington"]) {
    for (const [hour, period] of [[6, "sunrise"], [18, "sunset"]]) {
      const state = sampleDaylight(hour, level);
      assert.equal(state.period, period);
      assert.ok(state.warmGlow > 0.95 && state.blueHour < 0.05);
      assert.ok(state.horizon.r > state.horizon.b * 2, "amber/rose horizon");
      assert.ok(state.sunColor.r > state.sunColor.b * 2, "warm direct sunlight");
    }
    for (const hour of [5.4, 18.6]) {
      const state = sampleDaylight(hour, level);
      assert.equal(state.period, "blue-hour");
      assert.equal(state.warmGlow, 0, "warm haze and clouds must not wash out blue hour");
      assert.equal(state.blueHour, 1);
      assert.ok(state.horizon.b > state.horizon.r * 3);
      assert.ok(state.zenith.b > state.zenith.r * 3);
      assert.ok(state.zenith.b > sampleDaylight(0, level).zenith.b * 4);
    }
    const previous = sampleDaylight(0, level), current = sampleDaylight(0, level);
    for (let minute = 1; minute <= 1440; minute++) {
      sampleDaylight(minute / 60, level, current);
      for (const key of ["horizon", "zenith", "sunColor"]) for (const channel of ["r", "g", "b"]) {
        assert.ok(Math.abs(current[key][channel] - previous[key][channel]) < 0.04,
          `${level} ${minute}: continuous ${key}.${channel}`);
      }
      sampleDaylight(minute / 60, level, previous);
    }
  }
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
  assert.ok(Math.abs(daylight.state().hour - hour - 24 / 180) < 1e-10,
    "long stalls are limited to one active second, not a skipped night");
  daylight.setCycleMinutes(0); assert.equal(daylight.state().cycleMinutes, 3);
  daylight.setRunning(false);
  const frozen = daylight.state().hour;
  daylight.advance(0.1); daylight.setHour(Infinity);
  assert.equal(daylight.state().hour, frozen);
  daylight.dispose();
});

for (const minutes of [3, 12, 30]) test(`${minutes}-minute days repeatedly return from night through blue hour and sunrise`, () => {
  const { scene, daylight } = setup();
  daylight.setHour(12); daylight.setCycleMinutes(minutes);
  const sun = scene.getObjectByName("DaylightSun"), moon = scene.getObjectByName("DaylightMoon");
  const phases = ["daylight"];
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let frame = 1; frame <= minutes * 60 * 4; frame++) {
      daylight.advance(0.25);
      const state = daylight.state();
      if (phases.at(-1) !== state.period) phases.push(state.period);
      if (frame === minutes * 60 * 2) {
        daylight.update();
        assert.equal(sun.intensity, 0); assert.ok(moon.intensity > 0.5);
      }
    }
    const state = daylight.update();
    assert.ok(Math.abs(state.hour - 12) < 1e-7, "full active day has the configured duration, even at 4 FPS");
    assert.equal(state.daylight, 1); assert.equal(state.stars, 0); assert.equal(state.night, 0);
    assert.ok(sun.intensity > 2.5); assert.equal(moon.intensity, 0);
    assert.equal(sun.shadow.needsUpdate, true); assert.equal(moon.shadow.needsUpdate, false);
    assert.equal(scene.environmentIntensity, 0.7);
  }
  const cycle = ["golden-hour", "sunset", "blue-hour", "night", "blue-hour", "sunrise", "golden-hour", "daylight"];
  assert.deepEqual(phases, ["daylight", ...cycle, ...cycle]);
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

for (const tablet of [false, true]) test(`${tablet ? "tablet" : "desktop"}: performance shadows release old maps, follow moving rigs and restore quality`, t => {
  const { scene, renderer, daylight } = setup(tablet);
  t.after(() => daylight.dispose());
  const sun = scene.getObjectByName("DaylightSun"), moon = scene.getObjectByName("DaylightMoon");
  const lights = [sun, moon], highSizes = tablet ? [2048, 1024] : [4096, 2048];
  const position = new THREE.Vector3(2800, 46, -1700);
  daylight.setHour(12); daylight.update(position);
  let disposals = 0;
  for (const enabled of [true, false, true, false]) {
    for (const light of lights) {
      for (const key of ["map", "mapPass"]) {
        light.shadow[key] = new THREE.WebGLRenderTarget(light.shadow.mapSize.x, light.shadow.mapSize.y);
        light.shadow[key].addEventListener("dispose", () => disposals++);
      }
      light.shadow.needsUpdate = false;
    }
    renderer.shadowMap.needsUpdate = false;
    const before = disposals, hour = daylight.state().hour;
    const lighting = [sun.intensity, moon.intensity, scene.environmentIntensity, renderer.toneMappingExposure];
    daylight.setPerformanceMode(enabled);
    assert.equal(disposals, before + 4, "both depth and optional VSM targets are released");
    assert.deepEqual(lights.map(light => light.shadow.mapSize.toArray()),
      (enabled ? [1024, 512] : highSizes).map(size => [size, size]));
    assert.ok(lights.every(light => light.shadow.map === null && light.shadow.mapPass === null));
    assert.ok(lights.every(light => light.castShadow && !light.shadow.autoUpdate));
    assert.equal(renderer.shadowMap.needsUpdate, true);
    assert.equal(daylight.state().hour, hour);
    assert.deepEqual([sun.intensity, moon.intensity, scene.environmentIntensity, renderer.toneMappingExposure], lighting);
    assert.equal(sun.shadow.needsUpdate, true); assert.equal(moon.shadow.needsUpdate, false);
    for (const direction of [daylight.state().sunDirection, daylight.state().moonDirection]) {
      const light = direction === daylight.state().sunDirection ? sun : moon;
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
      const texel = (tablet ? 95 : 140) * 2 / light.shadow.mapSize.x;
      assert.ok(Math.abs(light.target.position.dot(right) / texel - Math.round(position.dot(right) / texel)) < 1e-8);
    }
    lights.forEach(light => { light.shadow.needsUpdate = false; });
    renderer.shadowMap.needsUpdate = false;
    daylight.setPerformanceMode(enabled);
    for (const invalid of [undefined, null, 1, "false"]) daylight.setPerformanceMode(invalid);
    assert.equal(disposals, before + 4);
    assert.equal(renderer.shadowMap.needsUpdate, false, "repeated/invalid setters are no-ops");

    for (const hour of [12, 0, 0, 12]) {
      position.x += 10; position.z -= 5;
      lights.forEach(light => { light.shadow.needsUpdate = false; });
      renderer.shadowMap.needsUpdate = false;
      daylight.setHour(hour); daylight.update(position);
      const active = hour === 12 ? sun : moon, dark = hour === 12 ? moon : sun;
      assert.equal(active.shadow.needsUpdate, true, "moving rigs refresh on every update, even at a frozen hour");
      assert.equal(dark.shadow.needsUpdate, false);
      assert.equal(renderer.shadowMap.needsUpdate, true);
      assert.ok(active.intensity > 0.5);
      assert.ok(active.target.position.distanceTo(position) < 0.5);
      assert.ok(active.position.clone().sub(active.target.position).normalize()
        .dot(hour === 12 ? daylight.state().sunDirection : daylight.state().moonDirection) > 0.99999);
    }
  }
  daylight.setHour(0); daylight.update(position);
  daylight.setPerformanceMode(true); daylight.setPerformanceMode(false);
  assert.equal(sun.shadow.needsUpdate, false); assert.equal(moon.shadow.needsUpdate, true, "night recovery invalidates the moon");
  daylight.dispose();
  const before = disposals;
  daylight.setPerformanceMode(true); daylight.dispose();
  assert.equal(disposals, before, "released shadow maps are not disposed twice");
  assert.deepEqual(lights.map(light => light.shadow.mapSize.x), highSizes);
  assert.equal(scene.children.length, 0);
});

test("game coordinates lights before cockpit hiding and advances time only in active driving", async () => {
  const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
  const render = source.slice(source.indexOf("  function renderFrame()"), source.indexOf("  const keys ="));
  assert.ok(render.indexOf("daylight.update(car.position)") < render.indexOf("car.visible = carVisible && !inside"));
  assert.ok(render.indexOf("nightLighting.update(") < render.indexOf("atmosphere.render("));
  assert.ok(render.indexOf("atmosphere.setDaylight(") < render.indexOf("atmosphere.render("));
  const frame = source.slice(source.indexOf("  function frame(now)"), source.indexOf("  function updateCamera(dt)"));
  assert.ok(frame.indexOf("daylight.advance(elapsed)") > frame.indexOf("garagePreview.render(dt)"));
  assert.match(frame, /sceneDirty && gameReady[\s\S]*renderFrame\(\)/);
  assert.doesNotMatch(source, /reflectedLight\.directDiffuse \*=|t\.x \+ t\.h \* 0\.8/);
});
