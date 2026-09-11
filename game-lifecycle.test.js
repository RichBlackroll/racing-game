import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { bindDrivingInput } from "./tablet.js";

const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
const pause = source.slice(source.indexOf("  function pauseGame(value)"), source.indexOf("  const adventure ="));
const graphics = source.slice(source.indexOf('  renderer.domElement.addEventListener("webglcontextlost"'), source.indexOf("  const camera ="));

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
    addEventListener: win.addEventListener.bind(win),
  };
  c.performance = { now: () => c.now };
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
    pixelBudget: (w, h, dpr) => Math.min(dpr, 1, Math.sqrt(1200000 / (w * h))),
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
