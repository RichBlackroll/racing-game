import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { bindDrivingInput, createAdaptiveQuality, createFrameLimiter, pixelBudget } from "./tablet.js";
import * as THREE from "three";
import { createDaylight, enableGeometryShadows } from "./daylight.js";

const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
const pause = source.slice(source.indexOf("  function pauseGame(value)"), source.indexOf("  const voiceButton ="));
const graphics = source.slice(source.indexOf('  renderer.domElement.addEventListener("webglcontextlost"'), source.indexOf("  const camera ="));

test("driving has no collection quest controller, saved progress, markers or dialog gates", async () => {
  assert.doesNotMatch(source, /createFriendAdventure|adventure\.|picnic|friend-(hud|dialog|voice)/i);
  const roster = await import("./friends.js");
  assert.deepEqual(Object.keys(roster), ["friends"]);
  assert.deepEqual(roster.friends.map((friend) => friend.name), ["Vincent", "Lea", "Camilla", "Maxey", "Loulou"]);
  assert.match(source, /friendRacers\.drawMap\(map, mapScale\)/);
  assert.match(source, /itemWorld\.drawMap\(map, mapScale\)/);
});

test("people voices restore and toggle independently of the removed quest UI", () => {
  const voices = source.slice(source.indexOf("  const voiceButton ="), source.indexOf("  const soundButton ="));
  for (const supported of [false, true]) for (const initial of [false, true]) {
    const attributes = new Map(), writes = [];
    const button = { setAttribute: (key, value) => attributes.set(key, value) };
    const session = { value: { voice: initial }, update(value) { Object.assign(this.value, value); writes.push(value.voice); } };
    let cancelled = 0;
    const win = supported ? { speechSynthesis: { cancel() { cancelled++; } } } : {};
    runInNewContext(voices, { document: { getElementById(id) { assert.equal(id, "people-voice"); return button; } }, window: win, session });
    assert.equal(button.hidden, !supported);
    assert.equal(attributes.get("aria-pressed"), String(initial));
    assert.equal(button.title, initial ? "Turn people voices off" : "Turn people voices on");
    assert.deepEqual(writes, [], "initialization does not overwrite a saved preference");
    if (!supported) continue;
    for (const voice of [!initial, initial]) {
      button.onclick();
      assert.equal(session.value.voice, voice);
      assert.equal(attributes.get("aria-pressed"), String(voice));
    }
    assert.deepEqual(writes, [!initial, initial]);
    assert.equal(cancelled, 1, "switching off cancels any current speech");
  }
  assert.match(source, /speech: \(\) => session\.value\.voice/);
});

function fixture() {
  const win = new EventTarget(), doc = new EventTarget(), pedal = new EventTarget();
  const keys = {}, captures = new Set();
  Object.assign(pedal, { dataset: { key: "w" }, classList: { toggle() {} },
    setPointerCapture(id) { captures.add(id); }, hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture(id) { captures.delete(id); } });
  doc.hidden = false;
  const c = { paused: false, resumeOnReturn: false, pauseStarted: 0, now: 1000,
    contextLost: false, gameReady: true, graphicsNeedRefresh: false, boosting: true, boostEnds: 6000,
    last: 0, qualityStart: 0, fpsStart: 0, qualityFrames: 20, fpsFrames: 20,
    pauseButton: { setAttribute() {} }, pauseText: {}, document: doc,
    renderer: { domElement: new EventTarget(), shadowMap: { needsUpdate: false } },
    scene: { environment: {} }, sceneDirty: false, isMoon: false,
    loading: { active: false, fail() { assert.fail("Temporary GPU loss must not lock the loading screen"); } },
    modifier: { active: false }, silenced: 0, saves: 0, renders: 0, previews: 0, resized: 0, environments: 0,
    actionSnapshot: { active: true, remaining: 2 }, actionRefreshes: 0,
    addEventListener: win.addEventListener.bind(win),
  };
  c.performance = { now: () => c.now };
  c.actionContext = () => ({ speed: 0, airborne: false });
  c.vehicleActions = { state(context) {
    assert.deepEqual(context, { speed: 0, airborne: false });
    return c.actionSnapshot;
  }, update() { assert.fail("Interrupted frame advanced vehicle actions"); } };
  c.vehicleActionUI = { update(snapshot) { assert.equal(snapshot, c.actionSnapshot); c.actionRefreshes++; } };
  c.audio = { silence() { c.silenced++; } };
  c.saveDrive = () => c.saves++;
  c.show = (message) => { c.message = message; };
  c.resize = () => c.resized++;
  c.renderFrame = () => c.renders++;
  c.updateMoonEnvironment = () => c.environments++;
  c.garagePreview = { render() { c.previews++; }, setEnvironment(env) { c.previewEnvironment = env; } };
  c.clearKeys = bindDrivingInput(keys, [pedal], win, doc,
    () => !c.paused && !doc.hidden && !c.contextLost && !c.loading.active && !c.modifier.active);
  runInNewContext(`${pause}\n${graphics}`, c);
  c.drawMap = () => {};
  c.createMobileUI = (options) => { c.menu = options; return {}; };
  const menuStart = source.indexOf("  let resumeAfterMenu =");
  runInNewContext(source.slice(menuStart, source.indexOf("  renderer.shadowMap.needsUpdate = true;", menuStart)), c);
  const emit = (target, type, fields = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), fields);
    target.dispatchEvent(event);
    return event;
  };
  const visible = (value) => { doc.hidden = !value; emit(doc, "visibilitychange"); };
  return { c, win, doc, pedal, keys, captures, emit, visible };
}

test("app switching resumes automatic pauses and accepts fresh keyboard and touch input", () => {
  const { c, win, pedal, keys, captures, emit, visible } = fixture();
  emit(win, "keydown", { key: "w" });
  emit(pedal, "pointerdown", { pointerId: 1, pointerType: "touch" });
  assert.equal(keys.w, true);
  emit(win, "blur");
  visible(false);
  emit(win, "pagehide");
  assert.equal(c.paused, true);
  assert.equal(keys.w, false);
  assert.equal(captures.size, 0);
  c.now = 11000;
  emit(win, "focus");
  assert.equal(c.paused, true, "focus alone cannot run a hidden page");
  visible(true);
  emit(win, "pageshow", { persisted: true });
  assert.equal(c.paused, false);
  assert.equal(c.boostEnds, 16000, "background time is excluded exactly once");
  assert.equal(c.last, 11000);
  assert.equal(c.fpsFrames + c.qualityFrames, 0);
  assert.equal(c.pauseText.textContent, "Pause");
  assert.equal(keys.w, false, "returning never restores a held accelerator");
  emit(win, "keydown", { key: "w", repeat: true });
  assert.equal(keys.w, false);
  emit(win, "keydown", { key: "w" });
  assert.equal(keys.w, true);
  emit(win, "keyup", { key: "w" });
  emit(pedal, "pointerdown", { pointerId: 2, pointerType: "touch" });
  assert.equal(keys.w, true);
});

test("focus-only and browser history returns recover without a visibility event", () => {
  for (const [leave, back] of [["blur", "focus"], ["pagehide", "pageshow"]]) {
    const { c, win, emit } = fixture();
    emit(win, leave);
    assert.equal(c.paused, true);
    emit(win, back, { persisted: true });
    assert.equal(c.paused, false);
  }
});

test("manual pauses and garage dialogs survive backgrounding without changing user intent", () => {
  for (const garage of [false, true]) {
    const { c, win, emit, visible } = fixture();
    c.modifier.active = garage;
    c.pauseButton.onclick();
    emit(win, "blur");
    visible(false);
    visible(true);
    emit(win, "focus");
    assert.equal(c.paused, true);
    assert.equal(c.pauseText.textContent, "Resume");
    assert.equal(c.modifier.active, garage);
    c.pauseButton.onclick();
    assert.equal(c.paused, false, "Resume remains clickable");
  }
});

test("graphics restoration unlocks rendering and controls without a fatal loading overlay", () => {
  for (const manualPause of [false, true]) for (const garage of [false, true]) {
    const { c, win, emit, visible } = fixture();
    c.modifier.active = garage;
    c.isMoon = true;
    if (manualPause) c.pauseButton.onclick();
    const lost = emit(c.renderer.domElement, "webglcontextlost");
    assert.equal(lost.defaultPrevented, true);
    assert.equal(c.contextLost, true);
    assert.equal(c.paused, true);
    c.pauseButton.onclick();
    emit(win, "focus");
    assert.equal(c.paused, true, "cannot resume before the GPU is ready");
    visible(false);
    emit(c.renderer.domElement, "webglcontextrestored");
    assert.equal(c.contextLost, false);
    assert.equal(c.renderer.shadowMap.needsUpdate, true);
    assert.equal(c.environments, 1);
    assert.equal(c.previewEnvironment, c.scene.environment);
    assert.equal(c.resized, 0);
    assert.equal(c.renders + c.previews, 0, "hidden pages wait before drawing");
    visible(true);
    assert.equal(c.paused, manualPause);
    assert.equal(c.resized, 1);
    emit(c.renderer.domElement, "webglcontextlost");
    emit(c.renderer.domElement, "webglcontextrestored");
    assert.equal(c.paused, manualPause);
    assert.equal(c.renders, garage ? 0 : 2);
    assert.equal(c.previews, garage ? 2 : 0);
  }
});

test("context events during startup do not access uninitialized game state", () => {
  const { c, emit } = fixture();
  c.gameReady = false;
  emit(c.renderer.domElement, "webglcontextlost");
  assert.equal(c.contextLost, true);
  assert.equal(c.saves, 0);
  emit(c.renderer.domElement, "webglcontextrestored");
  assert.equal(c.contextLost, false);
  assert.equal(c.resized, 0);
  assert.equal(c.graphicsNeedRefresh, true, "startup must retain the pending lighting rebuild");
  c.isMoon = true;
  c.gameReady = true;
  c.refreshGraphics();
  assert.equal(c.environments, 1);
  assert.equal(c.previewEnvironment, c.scene.environment);
  assert.equal(c.graphicsNeedRefresh, false);
  assert.ok(source.indexOf("  gameReady = true;\n  refreshGraphics();") < source.indexOf("  loading.complete("));
});

test("pause messages become visible even when the animation loop is paused", () => {
  const show = source.slice(source.indexOf("  function show(s)"), source.indexOf("  function toggle()"));
  const c = { ui: { toast: { style: { opacity: 0 } } }, toastUntil: 0, performance: { now: () => 1000 } };
  runInNewContext(`${show}; show('Paused');`, c);
  assert.equal(c.ui.toast.style.opacity, 1);
  assert.equal(c.toastUntil, 4);
});

test("mobile menu owns pending interruption resumes until it closes", () => {
  for (const manualPause of [false, true]) {
    const { c, win, emit, visible } = fixture();
    if (manualPause) c.pauseButton.onclick();
    emit(c.renderer.domElement, "webglcontextlost");
    c.menu.onOpenChange(true);
    assert.equal(c.paused, true);
    assert.equal(c.resumeOnReturn, false);
    emit(c.renderer.domElement, "webglcontextrestored");
    emit(win, "blur");
    visible(false);
    visible(true);
    emit(win, "focus");
    assert.equal(c.paused, true, "recovery cannot restart driving behind the menu");
    c.menu.onOpenChange(false);
    assert.equal(c.paused, manualPause);
  }
});

test("closing the mobile menu in the background defers resuming until visible", () => {
  const { c, visible } = fixture();
  c.menu.onOpenChange(true);
  visible(false);
  c.menu.onOpenChange(false);
  assert.equal(c.paused, true);
  assert.equal(c.resumeOnReturn, true);
  visible(true);
  assert.equal(c.paused, false);
});

function viewportFixture() {
  const win = new EventTarget();
  win.visualViewport = new EventTarget();
  const pending = [], size = { x: 390, y: 844 };
  const canvas = { clientWidth: 390, clientHeight: 844 };
  const c = {
    window: win, document: { hidden: false }, loading: { active: false }, contextLost: false,
    modifier: { active: false }, cockpit: { resize() {} }, renderSize: {},
    device: { tablet: true }, devicePixelRatio: 3, resolutionScale: 1,
    pixelBudget,
    camera: { aspect: 390 / 844, updateProjectionMatrix() {} },
    sizeChanges: 0, ratioChanges: 0, renders: 0, previews: 0, previewResizes: 0,
    requestAnimationFrame: (fn) => pending.push(fn),
    addEventListener: win.addEventListener.bind(win),
  };
  let ratio = 1;
  c.renderer = {
    domElement: canvas,
    getPixelRatio: () => ratio,
    setPixelRatio(value) { ratio = value; c.ratioChanges++; },
    getSize(target) { Object.assign(target, size); return target; },
    setSize(x, y, updateStyle) {
      assert.equal(updateStyle, false, "CSS, not Three, controls the visible viewport");
      Object.assign(size, { x, y }); c.sizeChanges++;
    },
  };
  c.renderFrame = () => c.renders++;
  c.garagePreview = { resize: () => c.previewResizes++, render: () => c.previews++ };
  const ratioSource = source.slice(source.indexOf("  const applyPixelRatio ="), source.indexOf("  applyPixelRatio();"));
  const resizeSource = source.slice(source.indexOf("  function resize() {"), source.indexOf("  window.gameState ="));
  runInNewContext(`${ratioSource}\n${resizeSource}`, c);
  const notify = () => {
    win.dispatchEvent(new Event("resize"));
    win.visualViewport.dispatchEvent(new Event("resize"));
  };
  const flush = () => { while (pending.length) pending.shift()(); };
  return { c, canvas, size, notify, flush, pending };
}

test("viewport notifications coalesce and unchanged dimensions never clear a paused canvas", () => {
  const { c, canvas, size, notify, flush, pending } = viewportFixture();
  notify();
  assert.equal(pending.length, 1);
  flush();
  assert.equal(c.sizeChanges + c.ratioChanges + c.renders, 0);
  // The canvas's CSS viewport, not a stale innerHeight, is authoritative.
  canvas.clientWidth = 844;
  canvas.clientHeight = 390;
  notify();
  flush();
  assert.deepEqual(size, { x: 844, y: 390 });
  assert.equal(c.camera.aspect, 844 / 390);
  assert.equal(c.sizeChanges, 1);
  assert.equal(c.renders, 1, "rotation redraws without running any physics");
  notify();
  flush();
  assert.equal(c.renders, 1);
});

test("resolution-only changes redraw once and respect the mobile drawing budget", () => {
  const { c, canvas, notify, flush } = viewportFixture();
  c.resolutionScale = 0.8;
  notify();
  flush();
  assert.equal(c.ratioChanges, 1);
  assert.equal(c.renders, 1);
  assert.equal(c.sizeChanges, 0);
  canvas.clientWidth = 2048;
  canvas.clientHeight = 1536;
  notify();
  flush();
  assert.ok(canvas.clientWidth * canvas.clientHeight * c.renderer.getPixelRatio() ** 2 <= 1200000);
});

test("viewport redraws honor menus, backgrounding, and graphics loss", () => {
  for (const state of ["loading", "hidden", "contextLost", "garage"]) {
    const { c, canvas, notify, flush } = viewportFixture();
    c.loading.active = state === "loading";
    c.document.hidden = state === "hidden";
    c.contextLost = state === "contextLost";
    c.modifier.active = state === "garage";
    canvas.clientHeight = 500;
    notify();
    flush();
    assert.equal(c.renders, 0, state);
    assert.equal(c.previews, state === "garage" ? 1 : 0, state);
    assert.equal(c.previewResizes, state === "garage" ? 1 : 0, state);
    if (state === "contextLost") assert.equal(c.sizeChanges + c.ratioChanges, 0);
  }
});

test("the driving loop adapts desktop and touch quality but excludes non-driving frames", () => {
  const start = source.indexOf("  function frame(now)");
  const frame = source.slice(start, source.indexOf("    let throttle =", start)) + "\n  }";
  const qualityStart = source.indexOf("  function applyRenderQuality()");
  const apply = source.slice(qualityStart, source.indexOf("  const timeControls =", qualityStart));
  for (const tablet of [false, true]) {
    const modes = { atmosphere: [], daylight: [], nightLighting: [], ambientEvents: [] };
    const c = {
      requestAnimationFrame() {}, itemUI: { update() {} }, itemSnapshot: {}, itemSystem: { modifiers: () => ({}) },
      actionContext: () => ({}), vehicleActions: { state: () => ({}) }, vehicleActionUI: { update() {} },
      loading: { active: false }, paused: false, modifier: { active: false }, document: { hidden: false },
      contextLost: false, audio: { silence() {} }, sceneDirty: false, gameReady: true,
      allowFrame: createFrameLimiter(), last: 0, qualityFrames: 0, qualityStart: 0,
      renderQuality: createAdaptiveQuality(tablet), resolutionScale: 1,
      applyPixelRatio() {}, garagePreview: { render() {} }, renderer: { shadowMap: {} },
    };
    for (const name of Object.keys(modes)) c[name] = { setPerformanceMode: enabled => modes[name].push(enabled), advance() {} };
    runInNewContext(`${apply}\n${frame}`, c);
    for (let i = 1; i <= 90; i++) c.frame(i * 1000 / 30);
    assert.equal(c.resolutionScale, 0.9);
    for (const values of Object.values(modes)) assert.deepEqual(values, [tablet, true]);
    assert.equal(c.renderer.shadowMap.needsUpdate, true);
    for (const reason of ["pause", "garage", "hidden", "contextLost", "loading"]) {
      c.paused = reason === "pause";
      c.modifier.active = reason === "garage";
      c.document.hidden = reason === "hidden";
      c.contextLost = reason === "contextLost";
      c.loading.active = reason === "loading";
      c.frame(c.last + 30000);
      assert.equal(c.qualityFrames, 0, reason);
      assert.equal(c.resolutionScale, 0.9, reason);
    }
  }
});

test("solar clock uses active elapsed time rather than the capped physics step and excludes interruptions", () => {
  const start = source.indexOf("  function frame(now)");
  const frame = source.slice(start, source.indexOf("    qualityFrames++;", start)) + "\n  }";
  for (const fps of [60, 10, 4]) {
    const { c } = fixture();
    const daylight = createDaylight({ scene: new THREE.Scene(), renderer: c.renderer, level: "forest", reducedMotion: false });
    Object.assign(c, { requestAnimationFrame() {}, itemUI: { update() {} }, itemSnapshot: {},
      itemSystem: { modifiers: () => ({}) }, allowFrame: createFrameLimiter(), daylight });
    runInNewContext(frame, c);
    daylight.setHour(4.6); daylight.setCycleMinutes(3);
    for (let i = 1; i <= fps * 10; i++) c.frame(i * 1000 / fps);
    assert.ok(Math.abs(daylight.state().hour - (4.6 + 10 * 24 / 180)) < 0.005, `${fps} FPS reaches sunrise on schedule`);
    assert.equal(daylight.state().period, "golden-hour");
    for (const reason of ["pause", "garage", "hidden", "contextLost", "loading"]) {
      const hour = daylight.state().hour;
      c.paused = reason === "pause"; c.modifier.active = reason === "garage";
      c.document.hidden = reason === "hidden"; c.contextLost = reason === "contextLost";
      c.loading.active = reason === "loading";
      c.frame(c.last + 30000);
      assert.equal(daylight.state().hour, hour, reason);
      assert.equal(c.actionSnapshot.remaining, 2, "action timers are not advanced by interrupted frames");
      assert.ok(c.actionRefreshes > 0, "action controls still refresh while interrupted");
      c.paused = c.modifier.active = c.document.hidden = c.contextLost = c.loading.active = false;
      c.frame(c.last + 100);
      assert.ok(Math.abs(daylight.state().hour - hour - 0.1 * 24 / 180) < 1e-10, "resume has no catch-up");
    }
    daylight.dispose();
  }
});

test("hidden compact maps do not repaint in the driving loop and refresh when visible", () => {
  const start = source.indexOf("    if (now - lastMap > 100");
  const map = source.slice(start, source.indexOf("    if (now - lastSave", start));
  let draws = 0;
  const c = { now: 1000, lastMap: 0, mobileUI: { mapVisible: false }, drawMap: () => draws++ };
  runInNewContext(map, c);
  assert.equal(draws, 0);
  assert.equal(c.lastMap, 0);
  c.mobileUI.mapVisible = true;
  runInNewContext(map, c);
  assert.equal(draws, 1);
  assert.equal(c.lastMap, 1000);
  runInNewContext(map, c);
  assert.equal(draws, 1);
});

test("only lunar terrain casts relief shadows after global shadow initialization", () => {
  const ground = source.slice(source.indexOf("  const groundSize ="), source.indexOf("  groundTex.repeat.setScalar"));
  for (const tablet of [false, true]) for (const isMoon of [false, true]) {
    const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial();
    const c = { THREE, scene, device: { tablet }, course: { halfSize: 20 }, isWellington: false,
      isAmsterdam: false, isCity: false, isMoon, heightAt: () => 0, roadDist: () => 0, groundmat: material,
      enableGeometryShadows,
      mesh(geometry, mat) { const mesh = new THREE.Mesh(geometry, mat); mesh.castShadow = true; scene.add(mesh); return mesh; },
    };
    runInNewContext(`${ground}\nenableGeometryShadows(scene); result = ground;`, c);
    assert.equal(c.result.castShadow, isMoon);
    assert.equal(c.result.receiveShadow, true);
    c.result.geometry.dispose(); material.dispose();
  }
});
