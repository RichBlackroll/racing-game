import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAtmosphere } from "./atmosphere.js";
import { sampleDaylight } from "./daylight.js";

// Exercise real Three resources without requiring a browser or GPU.
function fixture({ tablet = false, hdr = true, samples = [4, 2] } = {}) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1600);
  const drawingSize = new THREE.Vector2(1280, 720), logicalSize = new THREE.Vector2(640, 360);
  const viewport = new THREE.Vector4(9, 11, 330, 210), calls = [];
  const borrowedTarget = new THREE.WebGLRenderTarget(3, 5);
  const context = { RENDERBUFFER: 1, RGBA16F: 2, DEPTH_COMPONENT24: 3, SAMPLES: 4,
    getInternalformatParameter: () => samples };
  let target = borrowedTarget, face = 2, mip = 1, scissor = true;
  const renderer = {
    toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.12,
    outputColorSpace: THREE.SRGBColorSpace, autoClear: false,
    info: { autoReset: false, reset() {} },
    extensions: { has: () => hdr }, getContext: () => context,
    getDrawingBufferSize: v => v.copy(drawingSize), getSize: v => v.copy(logicalSize),
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    getScissorTest: () => scissor, getViewport: v => v.copy(viewport),
    setRenderTarget(value, nextFace = 0, nextMip = 0) { target = value; face = nextFace; mip = nextMip; },
    setScissorTest(value) { scissor = value; },
    setViewport(x, y, w, h) { if (x?.isVector4) viewport.copy(x); else viewport.set(x, y, w, h); },
    clear() {},
    render(renderScene, renderCamera) {
      calls.push({ scene: renderScene, camera: renderCamera, target,
        toneMapping: this.toneMapping, exposure: this.toneMappingExposure, outputColorSpace: this.outputColorSpace });
    },
  };
  const atmosphere = createAtmosphere({ scene, renderer, camera, level: "forest", tablet });
  return { scene, camera, renderer, atmosphere, drawingSize, logicalSize, calls, borrowedTarget,
    rendererState: () => [target, face, mip, scissor, viewport.toArray(), renderer.autoClear,
      renderer.info.autoReset, renderer.toneMapping, renderer.toneMappingExposure, renderer.outputColorSpace],
    dispose() { atmosphere.dispose(); borrowedTarget.dispose(); } };
}

for (const tablet of [false, true]) test(`${tablet ? "tablet" : "desktop"}: performance mode releases HDR storage, skips resolve and restores current sizing`, t => {
  const f = fixture({ tablet }), a = f.atmosphere, initial = f.rendererState();
  t.after(() => f.dispose());
  a.render(0);
  assert.equal(f.calls.length, 2, "quality defaults to the existing HDR path, including on tablet");
  const target = f.calls[0].target, resolve = f.calls[1].scene.children[0];
  assert.equal(target.texture.type, THREE.HalfFloatType);
  assert.equal(target.samples, tablet ? 0 : 4);
  assert.deepEqual([target.width, target.height], [1280, 720]);
  const resize = t.mock.method(target, "setSize"), bind = t.mock.method(f.renderer, "setRenderTarget");
  let disposals = 0;
  target.addEventListener("dispose", () => disposals++);

  a.setPerformanceMode(false);
  for (const invalid of [undefined, null, 1, "true"]) a.setPerformanceMode(invalid);
  assert.equal(resize.mock.callCount(), 0);
  a.setPerformanceMode(true);
  assert.equal(disposals, 1, "entering low mode releases the full-size GPU attachments");
  assert.deepEqual([target.width, target.height], [1, 1]);
  assert.deepEqual(resolve.material.uniforms.uTexel.value.toArray(), [1, 1]);
  const lowModeResizes = resize.mock.callCount();
  const state = sampleDaylight(0);
  a.setDaylight(state);
  f.camera.position.set(28, 7, -51);
  for (const [width, height] of [[1920, 1080], [800, 600], [960, 540]]) {
    a.setPerformanceMode(true);
    for (const invalid of [undefined, null, 0, "false"]) a.setPerformanceMode(invalid);
    f.drawingSize.set(width, height); f.logicalSize.set(width / 2, height / 2);
    a.resize();
    const count = f.calls.length;
    a.render(count / 60);
    assert.equal(f.calls.length, count + 1);
    assert.equal(f.calls.at(-1).scene, f.scene);
    assert.equal(f.calls.at(-1).camera, f.camera);
    assert.equal(f.calls.at(-1).target, f.borrowedTarget, "direct rendering retains the caller's target");
    assert.deepEqual(f.rendererState(), initial);
    assert.deepEqual([target.width, target.height], [1, 1]);
    assert.equal(a.pollen.material.uniforms.uHeight.value, height);
    assert.equal(a.pollen.material.uniforms.uPixelRatio.value, 2);
  }
  assert.equal(resize.mock.callCount(), lowModeResizes, "low frames and resize callbacks never resize HDR");
  assert.equal(bind.mock.callCount(), 0, "low mode never binds or allocates an HDR framebuffer");
  assert.equal(disposals, 1);
  assert.ok(a.sky.getWorldPosition(new THREE.Vector3()).equals(f.camera.position));
  assert.equal(a.sky.material.uniforms.uNight.value, 1);
  assert.ok(a.sky.material.uniforms.uTime.value > 0);
  assert.ok(f.scene.fog.color.equals(state.horizon));
  assert.equal(a.pollen.visible, false);

  a.setPerformanceMode(false);
  assert.equal(resize.mock.callCount(), lowModeResizes, "recovery is lazy until resize/render");
  const count = f.calls.length;
  a.render(1);
  assert.equal(f.calls.length, count + 2);
  assert.equal(f.calls.at(-2).target, target);
  assert.equal(f.calls.at(-1).target, null);
  assert.equal(f.calls.at(-1).scene.children[0], resolve);
  assert.equal(resolve.material.uniforms.uSource.value, target.texture);
  assert.deepEqual([target.width, target.height], [960, 540]);
  assert.deepEqual(resolve.material.uniforms.uTexel.value.toArray(), [1 / 960, 1 / 540]);
  assert.ok(Math.abs(resolve.material.uniforms.uBloom.value - 0.105) < 1e-12);
  assert.deepEqual(f.rendererState(), initial);
  assert.ok(f.calls.every(call => call.toneMapping === THREE.ACESFilmicToneMapping
    && call.exposure === 1.12 && call.outputColorSpace === THREE.SRGBColorSpace));

  a.setPerformanceMode(true);
  a.setPerformanceMode(false);
  f.drawingSize.set(1, 1); a.render(2);
  assert.deepEqual(resolve.material.uniforms.uTexel.value.toArray(), [1, 1], "1px recovery cannot retain stale texels");
  a.setPerformanceMode(true);
  a.dispose();
  const finalDisposals = disposals, finalResizes = resize.mock.callCount(), finalCalls = f.calls.length;
  a.setPerformanceMode(false); a.resize(); a.render(3); a.dispose();
  assert.equal(disposals, finalDisposals);
  assert.equal(resize.mock.callCount(), finalResizes);
  assert.equal(f.calls.length, finalCalls);
});

test("startup low mode stays direct through renderer/context reset and recovers at the new canvas size", t => {
  const f = fixture({ tablet: true }), a = f.atmosphere;
  t.after(() => f.dispose());
  const resize = t.mock.method(THREE.WebGLRenderTarget.prototype, "setSize");
  const bind = t.mock.method(f.renderer, "setRenderTarget");
  a.setPerformanceMode(true);
  a.render(0);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(resize.mock.calls.map(call => call.arguments), [[1, 1]]);
  assert.equal(bind.mock.callCount(), 0);
  // Model the renderer losing/reinitializing its state; the controller owns no GL handles.
  f.renderer.setRenderTarget(null); f.renderer.setViewport(0, 0, 900, 600);
  f.renderer.setScissorTest(false);
  f.drawingSize.set(1800, 1200); f.logicalSize.set(900, 600);
  const restoredState = f.rendererState(), bindings = bind.mock.callCount();
  a.resize(); a.render(1);
  assert.equal(bind.mock.callCount(), bindings);
  assert.equal(resize.mock.callCount(), 1);
  assert.equal(f.calls.at(-1).target, null);
  a.setPerformanceMode(false); a.resize(); a.render(2);
  assert.equal(f.calls.length, 4);
  const target = f.calls.at(-2).target;
  assert.deepEqual([target.width, target.height], [1800, 1200]);
  assert.equal(f.calls.at(-1).scene.children[0].material.uniforms.uSource.value, target.texture);
  assert.deepEqual(f.rendererState(), restoredState);
});

for (const options of [{ hdr: false }, { samples: [] }]) test(`unsupported HDR remains direct across toggles: ${JSON.stringify(options)}`, t => {
  const f = fixture(options);
  t.after(() => f.dispose());
  const initial = f.rendererState();
  for (const enabled of [false, true, true, false]) {
    f.atmosphere.setPerformanceMode(enabled);
    const count = f.calls.length;
    f.atmosphere.render(count);
    assert.equal(f.calls.length, count + 1);
    assert.equal(f.calls.at(-1).scene, f.scene);
    assert.deepEqual(f.rendererState(), initial);
  }
});

test("render failures preserve borrowed state in low mode and after HDR recovery", t => {
  const f = fixture(), initial = f.rendererState();
  t.after(() => f.dispose());
  for (const [enabled, failPass] of [[true, 1], [false, 1], [true, 1], [false, 2]]) {
    f.atmosphere.setPerformanceMode(enabled);
    let passes = 0;
    const render = t.mock.method(f.renderer, "render", () => {
      if (++passes === failPass) throw new Error("render failure");
    });
    assert.throws(() => f.atmosphere.render(1), /render failure/);
    assert.deepEqual(f.rendererState(), initial);
    render.mock.restore();
  }
});
