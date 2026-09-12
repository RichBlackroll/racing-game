import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { createCelestialSky } from "./celestial-sky.js";
import { createAtmosphere } from "./atmosphere.js";
import { sampleDaylight } from "./daylight.js";

function daylight(overrides = {}) {
  const sunDirection = new THREE.Vector3(-0.5, 0.7, 0.3).normalize();
  return {
    hour: 12, daylight: 1, night: 0, twilight: 0, warmGlow: 0, stars: 0,
    sunDirection, moonDirection: sunDirection.clone().negate(),
    horizon: new THREE.Color(0xb7c9dc), zenith: new THREE.Color(0x3678ba), sunColor: new THREE.Color(0xffe8b9),
    ...overrides,
  };
}

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-10, message ?? `${actual} != ${expected}`);
}

// Real Three scene/material/target objects, but no canvas, GPU context or new test dependencies.
function fixture({ level = "forest", tablet = false, hdr = true, samples = [4, 2], failPass = 0 } = {}) {
  const scene = new THREE.Scene();
  const previousFog = new THREE.Fog(0x647989, 10, 400);
  scene.fog = previousFog;
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1600);
  camera.position.set(15, 8, -31);
  const drawingSize = new THREE.Vector2(1280, 720), logicalSize = new THREE.Vector2(640, 360);
  const viewport = new THREE.Vector4(9, 11, 330, 210);
  const borrowedTarget = new THREE.WebGLRenderTarget(3, 5);
  const calls = [];
  let target = borrowedTarget, face = 2, mip = 1, scissor = true, clears = 0, resets = 0;
  const renderer = {
    autoClear: true,
    info: { autoReset: true, reset() { resets++; } },
    extensions: { has: name => name === "EXT_color_buffer_float" && hdr },
    getContext: () => ({ RENDERBUFFER: 1, RGBA16F: 2, DEPTH_COMPONENT24: 3, SAMPLES: 4,
      getInternalformatParameter: () => samples }),
    getDrawingBufferSize: v => v.copy(drawingSize),
    getSize: v => v.copy(logicalSize),
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    getScissorTest: () => scissor,
    getViewport: v => v.copy(viewport),
    setRenderTarget(value, nextFace = 0, nextMip = 0) { target = value; face = nextFace; mip = nextMip; },
    setScissorTest(value) { scissor = value; },
    setViewport(x, y, w, h) { if (x?.isVector4) viewport.copy(x); else viewport.set(x, y, w, h); },
    clear(color, depth, stencil) { assert.ok(color && depth && stencil); clears++; },
    render(renderScene, renderCamera) {
      calls.push({ scene: renderScene, camera: renderCamera, target, scissor, viewport: viewport.clone() });
      if (calls.length === failPass) throw new Error("test render failure");
    },
  };
  const atmosphere = createAtmosphere({ scene, camera, renderer, level, tablet });
  return { scene, camera, renderer, atmosphere, previousFog, drawingSize, logicalSize, calls, borrowedTarget,
    counters: () => ({ clears, resets }),
    dispose() { atmosphere.dispose(); borrowedTarget.dispose(); } };
}

for (const tablet of [false, true]) test(`${tablet ? "tablet" : "desktop"}: sky is a single unshadowed, camera-independent HDR dome`, () => {
  const scene = new THREE.Scene();
  const celestial = createCelestialSky({ scene, level: "forest", tablet });
  const { sky } = celestial;
  assert.deepEqual(scene.children, [sky]);
  assert.equal(sky.name, "AtmosphereSky");
  assert.equal(sky.geometry.type, "SphereGeometry");
  assert.equal(sky.geometry.parameters.radius, 900);
  assert.equal(sky.geometry.parameters.widthSegments, tablet ? 32 : 48);
  assert.equal(sky.geometry.parameters.heightSegments, tablet ? 16 : 24);
  assert.equal(sky.material.isShaderMaterial, true);
  assert.equal(sky.material.defines.SKY_DETAIL, tablet ? 0 : 1);
  assert.equal(sky.material.side, THREE.BackSide);
  assert.equal(sky.material.depthWrite, false);
  assert.equal(sky.material.depthTest, false);
  assert.equal(sky.material.fog, false);
  assert.equal(sky.material.toneMapped, true);
  assert.equal(sky.castShadow, false);
  assert.equal(sky.receiveShadow, false);
  assert.equal(sky.frustumCulled, false);
  assert.equal(sky.renderOrder, -1000);
  assert.ok(Object.values(sky.material.uniforms).every(u => !u.value?.isTexture));
  assert.doesNotThrow(() => { celestial.update(); celestial.update({ state: null }); });
  for (const uniform of ["uTime", "uDaylight", "uNight", "uTwilight", "uWarmGlow", "uStars"]) {
    assert.ok(Number.isFinite(sky.material.uniforms[uniform].value));
  }
  celestial.dispose();
});

test("controller values copy into stable uniforms without inferring darkness or directions from the hour", () => {
  const celestial = createCelestialSky({ scene: new THREE.Scene(), level: "city" });
  const { uniforms } = celestial.sky.material;
  const initialSun = uniforms.uSunDirection.value, initialHorizon = uniforms.uHorizon.value;
  const materialVersion = celestial.sky.material.version;
  for (const hour of [0, 6, 12, 18, 24]) {
    const state = daylight({ hour, daylight: 0.43, night: 0.71, twilight: 0.86, warmGlow: 0.63, stars: 0.17 });
    const before = structuredClone(state);
    celestial.update({ state, time: 14.25 });
    assert.equal(uniforms.uDaylight.value, 0.43);
    assert.equal(uniforms.uNight.value, 0.71);
    assert.equal(uniforms.uTwilight.value, 0.86);
    assert.equal(uniforms.uWarmGlow.value, 0.63);
    assert.equal(uniforms.uStars.value, 0.17, "astronomical darkness is not the dusk lamp blend");
    assert.equal(uniforms.uTime.value, 14.25);
    for (const [name, key] of [["uSunDirection", "sunDirection"], ["uMoonDirection", "moonDirection"],
      ["uHorizon", "horizon"], ["uZenith", "zenith"], ["uSunColor", "sunColor"]]) {
      assert.ok(uniforms[name].value.equals(state[key]));
      assert.notEqual(uniforms[name].value, state[key]);
    }
    assert.deepEqual(structuredClone(state), before);
    state.sunDirection.set(1, 0, 0); state.horizon.set(0xffffff);
    assert.ok(!uniforms.uSunDirection.value.equals(state.sunDirection));
    assert.ok(!uniforms.uHorizon.value.equals(state.horizon));
  }
  assert.equal(uniforms.uSunDirection.value, initialSun);
  assert.equal(uniforms.uHorizon.value, initialHorizon);
  assert.equal(celestial.sky.material.version, materialVersion);
  celestial.dispose();
});

test("sky and fog recover daylight after blue hour on both sides of repeated nights", () => {
  for (const tablet of [false, true]) {
    const f = fixture({ tablet }), a = f.atmosphere, u = a.sky.material.uniforms;
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const hour of [12, 19.5, 21, 21.7, 0, 4.3, 5, 6.5, 12]) {
        const state = sampleDaylight(hour);
        a.setDaylight(state); a.render();
        assert.equal(u.uWarmGlow.value, state.warmGlow);
        assert.equal(u.uDaylight.value, state.daylight);
        assert.equal(u.uNight.value, state.night);
        assert.equal(u.uStars.value, state.stars);
        assert.ok(u.uHorizon.value.equals(state.horizon));
        assert.ok(u.uZenith.value.equals(state.zenith));
        assert.ok(f.scene.fog.color.equals(state.horizon));
        assert.ok(u.uSunDirection.value.equals(state.sunDirection));
      }
      assert.equal(u.uDaylight.value, 1); assert.equal(u.uNight.value + u.uStars.value + u.uWarmGlow.value, 0);
      assert.equal(a.pollen.visible, true);
    }
    const shader = a.sky.material.fragmentShader;
    assert.match(shader, /horizonHaze \* uWarmGlow/);
    assert.match(shader, /0\.22 \* uWarmGlow/);
    assert.match(shader, /uWarmGlow \* sunward \* 0\.7/);
    f.dispose();
  }
});

test("day, dusk, astronomical night and dawn blends are continuous and supplied independently", () => {
  const celestial = createCelestialSky({ scene: new THREE.Scene(), level: "wellington" });
  const u = celestial.sky.material.uniforms;
  for (const [day, night, twilight, stars] of [[1, 0, 0, 0], [0.5, 0.7, 1, 0], [0, 1, 0.25, 0.5], [0, 1, 0, 1], [0.3, 0.6, 0.8, 0.1]]) {
    celestial.update({ state: daylight({ daylight: day, night, twilight, stars }) });
    assert.deepEqual([u.uDaylight.value, u.uNight.value, u.uTwilight.value, u.uStars.value], [day, night, twilight, stars]);
  }
  celestial.update({ state: { daylight: -2, night: 5, stars: -1, twilight: 3 }, time: 2 });
  assert.deepEqual([u.uDaylight.value, u.uNight.value, u.uTwilight.value, u.uStars.value], [0, 1, 1, 0]);
  celestial.update({ state: { daylight: NaN, night: Infinity, stars: undefined, twilight: null }, time: NaN });
  assert.deepEqual([u.uDaylight.value, u.uNight.value, u.uTwilight.value, u.uStars.value, u.uTime.value], [0, 1, 1, 0, 2]);
  celestial.dispose();
});

test("sky follows world-space eye under scene transforms without rotating the controller's directions", () => {
  const scene = new THREE.Scene();
  scene.position.set(31, -8, 12); scene.rotation.set(0.1, 0.4, -0.07); scene.scale.set(1.1, 0.9, 1.2);
  const celestial = createCelestialSky({ scene, level: "forest" });
  const state = daylight(), eye = new THREE.Vector3(-123, 14, 250), before = eye.clone();
  celestial.update({ state, eye, time: 7 });
  close(celestial.sky.getWorldPosition(new THREE.Vector3()).distanceTo(eye), 0);
  assert.ok(eye.equals(before));
  assert.ok(celestial.sky.material.uniforms.uSunDirection.value.equals(state.sunDirection));
  celestial.update({ eye: eye.set(400, 7, -83), time: 7 });
  close(celestial.sky.getWorldPosition(new THREE.Vector3()).distanceTo(eye), 0);
  assert.equal(celestial.sky.material.uniforms.uTime.value, 7, "frozen clock remains frozen while the camera moves");
  celestial.dispose();
});

test("five restrained planets keep their ecliptic elongations as the supplied sun moves", () => {
  const celestial = createCelestialSky({ scene: new THREE.Scene(), level: "forest" });
  const { planets } = celestial.sky.userData, u = celestial.sky.material.uniforms;
  assert.deepEqual(planets.map(p => p.name), ["Venus", "Mars", "Jupiter", "Saturn", "Mercury"]);
  const previous = u.uPlanets.value.map(p => p.clone());
  for (const sunDirection of [new THREE.Vector3(0.2, -0.8, 0.5).normalize(), new THREE.Vector3(0, 0.917, -0.399).normalize()]) {
    celestial.update({ state: daylight({ sunDirection, moonDirection: sunDirection.clone().negate() }) });
    const normal = new THREE.Vector3().crossVectors(sunDirection, new THREE.Vector3().copy(u.uPlanets.value[0])).normalize();
    u.uPlanets.value.forEach((p, i) => {
      const direction = new THREE.Vector3(p.x, p.y, p.z);
      close(direction.length(), 1);
      close(direction.dot(sunDirection), Math.cos(THREE.MathUtils.degToRad(planets[i].offset)));
      close(direction.dot(normal), 0, "all bodies share the same ecliptic plane");
      const diameter = THREE.MathUtils.radToDeg(p.w * 2) * (i === 3 ? 2.1 : 1);
      assert.ok(diameter >= 0.5 && diameter <= 1.5);
      assert.ok(!p.equals(previous[i]));
    });
  }
  celestial.dispose();
});

test("vacuum stays black with perpetual stars and a moving sun, while borrowed Earth/background survive disposal", () => {
  const scene = new THREE.Scene(), earth = new THREE.Mesh(new THREE.SphereGeometry(20), new THREE.MeshStandardMaterial());
  const background = new THREE.Texture(); scene.background = background; scene.add(earth);
  let borrowedDisposals = 0;
  for (const resource of [background, earth.geometry, earth.material]) resource.addEventListener("dispose", () => borrowedDisposals++);
  const celestial = createCelestialSky({ scene, level: "moon" }), u = celestial.sky.material.uniforms;
  for (const night of [0, 0.5, 1]) {
    const state = daylight({ night, stars: 0, twilight: 1, sunDirection: new THREE.Vector3(1 - night, night, 0).normalize() });
    celestial.update({ state });
    assert.equal(u.uVacuum.value, 1);
    assert.equal(u.uStars.value, 1);
    assert.equal(u.uHorizon.value.getHex(), 0);
    assert.equal(u.uZenith.value.getHex(), 0);
    assert.ok(u.uSunDirection.value.equals(state.sunDirection));
    assert.ok(u.uSunColor.value.equals(state.sunColor));
    assert.equal(scene.background, background);
    assert.equal(earth.parent, scene);
  }
  celestial.dispose();
  assert.deepEqual(scene.children, [earth]);
  assert.equal(scene.background, background);
  assert.equal(borrowedDisposals, 0);
  background.dispose(); earth.geometry.dispose(); earth.material.dispose();
});

test("sky disposal is idempotent and later updates cannot mutate released resources", () => {
  const scene = new THREE.Scene(), celestial = createCelestialSky({ scene, level: "forest" });
  const { sky } = celestial;
  let geometryDisposals = 0, materialDisposals = 0;
  sky.geometry.addEventListener("dispose", () => geometryDisposals++);
  sky.material.addEventListener("dispose", () => materialDisposals++);
  celestial.dispose(); celestial.dispose();
  celestial.update({ state: daylight({ night: 1 }), time: 44, eye: new THREE.Vector3(8, 9, 10) });
  assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1);
  assert.equal(sky.parent, null); assert.equal(scene.children.length, 0);
  assert.equal(sky.material.uniforms.uTime.value, 0);
  assert.equal(sky.material.uniforms.uNight.value, 0);
  assert.ok(sky.position.equals(new THREE.Vector3()));
});

test("setDaylight updates fog immediately, strengthens night bloom modestly, and extinguishes pollen", () => {
  const f = fixture(), { atmosphere: a } = f;
  assert.doesNotThrow(() => { a.setDaylight(); a.render(); });
  const resolve = f.calls[1].scene.children[0], u = resolve.material.uniforms;
  const fog = f.scene.fog, density = fog.density;
  close(u.uBloom.value, 0.065);
  for (const night of [0.25, 0.5, 0.75, 1]) {
    const state = daylight({ night, daylight: 1 - night, stars: night, horizon: new THREE.Color(0x0c172b) });
    a.setDaylight(state);
    assert.ok(fog.color.equals(state.horizon));
    assert.notEqual(fog.color, state.horizon);
    assert.equal(fog.density, density);
    close(u.uBloom.value, 0.065 + night * 0.04);
    close(a.pollen.material.uniforms.uDaylight.value, (1 - night) ** 2);
    assert.equal(a.pollen.visible, night < 1);
  }
  assert.ok(u.uBloom.value < 0.12);
  a.setDaylight(daylight());
  assert.equal(a.pollen.visible, true);
  assert.equal(a.pollen.material.uniforms.uDaylight.value, 1);
  a.dispose(); assert.equal(f.scene.fog, f.previousFog);
  f.borrowedTarget.dispose();
});

for (const options of [{}, { tablet: true }, { hdr: false }, { samples: [] }]) {
  test(`atmosphere retains HDR/MSAA fallback and resize/render state: ${JSON.stringify(options)}`, () => {
    const f = fixture(options), { atmosphere: a, renderer } = f;
    a.setDaylight(daylight({ night: 1, daylight: 0, stars: 1 }));
    a.render(1);
    close(a.sky.getWorldPosition(new THREE.Vector3()).distanceTo(f.camera.position), 0);
    const hasTarget = options.hdr !== false && (options.tablet || options.samples?.length !== 0);
    assert.equal(f.calls.length, hasTarget ? 2 : 1);
    if (hasTarget) {
      const target = f.calls[0].target, resolve = f.calls[1].scene.children[0];
      assert.equal(target.texture.type, THREE.HalfFloatType);
      assert.equal(target.texture.colorSpace, THREE.LinearSRGBColorSpace);
      assert.equal(target.samples, options.tablet ? 0 : 4);
      assert.equal(target.width, 1280); assert.equal(target.height, 720);
      assert.equal(resolve.material.uniforms.uSource.value, target.texture);
      assert.equal(f.calls[1].target, null, "HDR target is unbound before resolve samples it");
      assert.equal(f.calls[0].scissor, false); assert.equal(f.calls[1].scissor, false);
      assert.deepEqual(f.calls[1].viewport.toArray(), [0, 0, 640, 360]);
      let targetDisposals = 0, resolveDisposals = 0;
      target.addEventListener("dispose", () => targetDisposals++);
      resolve.material.addEventListener("dispose", () => resolveDisposals++);
      f.drawingSize.set(800, 600); f.logicalSize.set(400, 300); a.resize();
      assert.equal(target.width, 800); assert.equal(target.height, 600);
      assert.deepEqual(resolve.material.uniforms.uTexel.value.toArray(), [1 / 800, 1 / 600]);
      close(resolve.material.uniforms.uRadius.value, 2.4);
      assert.equal(a.pollen.material.uniforms.uHeight.value, 600);
      assert.equal(a.pollen.material.uniforms.uPixelRatio.value, 2);
      const beforeDispose = targetDisposals;
      a.dispose(); a.dispose();
      assert.equal(targetDisposals, beforeDispose + 1); assert.equal(resolveDisposals, 1);
    }
    assert.equal(renderer.getRenderTarget(), f.borrowedTarget);
    assert.equal(renderer.getActiveCubeFace(), 2); assert.equal(renderer.getActiveMipmapLevel(), 1);
    assert.equal(renderer.getScissorTest(), true);
    assert.deepEqual(renderer.getViewport(new THREE.Vector4()).toArray(), [9, 11, 330, 210]);
    assert.equal(renderer.autoClear, true); assert.equal(renderer.info.autoReset, true);
    f.dispose();
  });
}

test("render failures still restore the borrowed renderer state", () => {
  for (const failPass of [1, 2]) {
    const f = fixture({ failPass });
    assert.throws(() => f.atmosphere.render(0), /test render failure/);
    assert.equal(f.renderer.getRenderTarget(), f.borrowedTarget);
    assert.equal(f.renderer.getActiveCubeFace(), 2); assert.equal(f.renderer.getActiveMipmapLevel(), 1);
    assert.equal(f.renderer.getScissorTest(), true);
    assert.deepEqual(f.renderer.getViewport(new THREE.Vector4()).toArray(), [9, 11, 330, 210]);
    assert.equal(f.renderer.autoClear, true); assert.equal(f.renderer.info.autoReset, true);
    f.dispose();
  }
});

test("reduced motion freezes decorative time, not daylight updates or camera centering", t => {
  const previousWindow = globalThis.window, preference = { matches: true };
  globalThis.window = { matchMedia: query => { assert.equal(query, "(prefers-reduced-motion: reduce)"); return preference; } };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const f = fixture({ hdr: false }), { atmosphere: a } = f;
  a.render(10); a.render(20);
  assert.equal(a.sky.material.uniforms.uTime.value, 0);
  preference.matches = false; a.render(20.05);
  close(a.sky.material.uniforms.uTime.value, 0.05);
  a.render(100); close(a.sky.material.uniforms.uTime.value, 0.15, "background gaps stay clamped");
  preference.matches = true;
  f.camera.position.set(-80, 13, 4);
  a.setDaylight(daylight({ daylight: 0, night: 1, stars: 1 })); a.render(101);
  close(a.sky.material.uniforms.uTime.value, 0.15);
  close(a.pollen.material.uniforms.uTime.value, 0.15);
  assert.equal(a.sky.material.uniforms.uNight.value, 1);
  close(a.sky.getWorldPosition(new THREE.Vector3()).distanceTo(f.camera.position), 0);
  a.render(NaN); close(a.sky.material.uniforms.uTime.value, 0.15);
  const calls = f.calls.length;
  a.dispose(); a.setDaylight(daylight()); a.render(102); a.resize();
  assert.equal(f.calls.length, calls);
  f.borrowedTarget.dispose();
});

test("Moon atmosphere enforces vacuum fog and never owns scenery; cleanup respects later fog owners", () => {
  const f = fixture({ level: "moon" });
  assert.equal(f.scene.fog, null); assert.equal(f.atmosphere.pollen, null);
  f.atmosphere.setDaylight(daylight({ night: 1, stars: 0 })); f.atmosphere.render(0);
  assert.equal(f.scene.fog, null);
  close(f.calls[1].scene.children[0].material.uniforms.uBloom.value, 0);
  f.atmosphere.setDaylight(daylight({ night: 0, stars: 1 })); f.atmosphere.render(1);
  close(f.calls.at(-1).scene.children[0].material.uniforms.uBloom.value, 0);
  f.dispose(); assert.equal(f.scene.fog, f.previousFog);
  const g = fixture();
  const replacement = new THREE.Fog(0x123456, 1, 100); g.scene.fog = replacement;
  g.dispose(); assert.equal(g.scene.fog, replacement);
});

test("source smoke: deterministic procedural detail, derivative AA, vacuum masks and one HDR output transform", async () => {
  const source = await readFile(new URL("./celestial-sky.js", import.meta.url), "utf8");
  const atmosphereSource = await readFile(new URL("./atmosphere.js", import.meta.url), "utf8");
  const a = createCelestialSky({ scene: new THREE.Scene(), level: "forest" });
  const b = createCelestialSky({ scene: new THREE.Scene(), level: "forest" });
  const shader = a.sky.material.fragmentShader;
  assert.equal(shader, b.sky.material.fragmentShader);
  assert.deepEqual(a.sky.geometry.attributes.position.array, b.sky.geometry.attributes.position.array);
  assert.doesNotMatch(source, /Math\.random|TextureLoader|fetch\(|document\.|window\.|state\.hour/);
  const hash = shader.slice(shader.indexOf("vec3 hash3"), shader.indexOf("float noise"));
  assert.doesNotMatch(hash, /uTime|sin\(/);
  assert.match(shader, /starLayer\(starUV, face, [\d.]+, [\d.]+, 731\.0\)/);
  assert.match(shader, /fwidth\(p\)/);
  assert.match(shader, /fwidth\(sunDistance\)/);
  assert.match(shader, /fwidth\(moonUV\)/);
  assert.match(shader, /fwidth\(ringR\)/);
  assert.match(shader, /fwidth\(phase\)/);
  assert.match(shader, /exp\(-rimDistance \* rimDistance\)/);
  assert.doesNotMatch(shader, /pow\(\(r -/);
  assert.match(shader, /length\(d - uSunDirection\)/);
  assert.match(shader, /bodyUV\(d, uMoonDirection, 0\.0065\)/);
  assert.match(shader, /if \(uVacuum < 0\.5 && uStars > 0\.0\)/);
  assert.match(shader, /smoothstep\(0\.1745, 0\.22, altitude\)/);
  assert.match(shader, /smoothstep\(0\.60, 0\.6981, altitude\)/);
  assert.match(shader, /moonVisibility = \(1\.0 - uVacuum\)/);
  assert.match(shader, /if \(uStars > 0\.0 \|\| uTwilight > 0\.0 \|\| uVacuum > 0\.5\)/);
  assert.match(shader, /crater\(moonUV/);
  assert.match(shader, /ringR, 2\.1, ringAA/);
  assert.match(shader, /vec3 color = vec3\(0\.0\)/);
  assert.match(a.sky.material.vertexShader, /vDirection = mat3\(modelMatrix\) \* position/);
  assert.match(a.sky.material.vertexShader, /gl_Position\.z = gl_Position\.w/);
  assert.equal(shader.match(/#include <tonemapping_fragment>/g).length, 1);
  assert.equal(shader.match(/#include <colorspace_fragment>/g).length, 1);
  assert.doesNotMatch(shader, /#include <(?:fog|shadowmap)_/);
  assert.match(atmosphereSource, /celestial\.update\(\{ time: animationTime, eye \}\)/);
  assert.match(atmosphereSource, /vOpacity \*= uDaylight/);
  assert.doesNotMatch(atmosphereSource, /new THREE\.SphereGeometry|toneMappingExposure\s*=|scene\.environment\s*=/);
  a.dispose(); b.dispose();
});
