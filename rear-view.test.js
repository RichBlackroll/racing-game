import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createRearView } from "./rear-view.js";

function bounds(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function fixture({ tablet = false, ratio = 2, hdr = true } = {}) {
  const scene = new THREE.Scene(), parent = new THREE.Group(), car = new THREE.Group();
  scene.add(parent);
  parent.add(car);
  const visual = new THREE.Group();
  visual.visible = false;
  car.add(visual);
  const element = { rect: bounds(250, 80, 400, 120), getBoundingClientRect() { return this.rect; } };
  // Model r170's logical defaults separately from its active buffer-pixel state.
  const renderer = {
    domElement: { rect: bounds(50, 30, 1000, 600), getBoundingClientRect() { return this.rect; } },
    size: new THREE.Vector2(1000, 600), ratio,
    target: null, face: 0, mip: 0,
    viewport: new THREE.Vector4(9, 13, 800, 500),
    scissor: new THREE.Vector4(21, 25, 760, 460), scissorTest: false,
    activeViewport: new THREE.Vector4(), activeScissor: new THREE.Vector4(), activeScissorTest: false,
    autoClear: true,
    info: { autoReset: true, render: { calls: 7 }, reset() { this.render.calls = 0; } },
    shadowMap: { autoUpdate: true, needsUpdate: true },
    toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.02,
    outputColorSpace: THREE.SRGBColorSpace,
    extensions: { has(name) { assert.equal(name, "EXT_color_buffer_float"); return hdr; } },
    contextLost: false,
    getContext() { return { isContextLost: () => this.contextLost }; },
    getDrawingBufferSize(out) { return out.copy(this.size).multiplyScalar(this.ratio).floor(); },
    getPixelRatio() { return this.ratio; },
    getRenderTarget() { return this.target; },
    getActiveCubeFace() { return this.face; },
    getActiveMipmapLevel() { return this.mip; },
    getViewport(out) { return out.copy(this.viewport); },
    getScissor(out) { return out.copy(this.scissor); },
    getScissorTest() { return this.scissorTest; },
    setViewport(x, y, width, height) {
      if (x.isVector4) this.viewport.copy(x);
      else this.viewport.set(x, y, width, height);
      this.activeViewport.copy(this.viewport).multiplyScalar(this.ratio).round();
    },
    setScissor(x, y, width, height) {
      if (x.isVector4) this.scissor.copy(x);
      else this.scissor.set(x, y, width, height);
      this.activeScissor.copy(this.scissor).multiplyScalar(this.ratio).round();
    },
    setScissorTest(value) { this.scissorTest = this.activeScissorTest = value; },
    setRenderTarget(target, face = 0, mip = 0) {
      this.target = target;
      this.face = face;
      this.mip = mip;
      if (target) {
        this.activeViewport.copy(target.viewport);
        this.activeScissor.copy(target.scissor);
        this.activeScissorTest = target.scissorTest;
      } else {
        this.activeViewport.copy(this.viewport).multiplyScalar(this.ratio).floor();
        this.activeScissor.copy(this.scissor).multiplyScalar(this.ratio).floor();
        this.activeScissorTest = this.scissorTest;
      }
    },
    clears: [], passes: [], fail: null,
    clear(color, depth, stencil) {
      this.clears.push({ target: this.target, color, depth, stencil, scissorTest: this.activeScissorTest });
      assert.ok(this.target, "Never clear the main framebuffer");
    },
    render(renderScene, camera) {
      renderScene.updateMatrixWorld();
      camera.updateMatrixWorld();
      const kind = renderScene === scene ? "world" : "resolve";
      this.passes.push({
        kind, scene: renderScene, camera, target: this.target, carVisible: car.visible,
        viewport: this.activeViewport.clone(), scissor: this.activeScissor.clone(),
        scissorTest: this.activeScissorTest, autoClear: this.autoClear,
        autoReset: this.info.autoReset, shadows: { ...this.shadowMap },
        position: camera.position.clone(), direction: camera.getWorldDirection(new THREE.Vector3()),
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
      });
      if (this.info.autoReset) this.info.reset();
      this.info.render.calls++;
      if (this.shadowMap.autoUpdate || this.shadowMap.needsUpdate) this.shadowMap.needsUpdate = false;
      if (this.fail === kind) throw new Error(`${kind} render failed`);
    },
  };
  renderer.setRenderTarget(null);
  const mirror = createRearView({ renderer, scene, car, tablet, element });
  return { mirror, renderer, scene, parent, car, visual, element };
}

function state(renderer) {
  return {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(), activeViewport: renderer.activeViewport.clone(),
    activeScissor: renderer.activeScissor.clone(), activeScissorTest: renderer.activeScissorTest,
    autoClear: renderer.autoClear, autoReset: renderer.info.autoReset, shadows: { ...renderer.shadowMap },
    toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, outputColorSpace: renderer.outputColorSpace,
  };
}

function near(actual, expected) {
  assert.ok(actual.distanceTo(expected) < 1e-9, `${actual.toArray()} != ${expected.toArray()}`);
}

test("rear camera follows local -Z through turns, pitch, roll, and parent transforms", () => {
  const { mirror, renderer, car, parent, visual, scene } = fixture();
  parent.position.set(30, 4, -15);
  parent.rotation.set(0.1, -0.3, 0.07);
  car.position.set(2, 1, 5);
  for (const [yaw, pitch, roll] of [[0, 0, 0], [Math.PI / 2, 0, 0], [-2.2, 0.4, -0.2], [1.7, -0.6, 0.3]]) {
    car.rotation.set(pitch, yaw, roll, "YXZ");
    const transform = [car.position.toArray(), car.quaternion.toArray(), car.scale.toArray()];
    mirror.invalidate();
    mirror.render(0);
    const pass = renderer.passes.at(-2);
    assert.equal(pass.camera.isPerspectiveCamera, true);
    const orientation = parent.quaternion.clone().multiply(car.quaternion);
    near(pass.direction, new THREE.Vector3(0, 0, -1).applyQuaternion(orientation));
    near(pass.up, new THREE.Vector3(0, 1, 0).applyQuaternion(orientation));
    near(pass.position, car.localToWorld(new THREE.Vector3(0, 1.7, -2.5)));
    assert.equal(pass.carVisible, false);
    assert.equal(renderer.passes.at(-1).carVisible, true, "Hide the car only during the world pass");
    assert.equal(car.visible, true);
    assert.equal(visual.visible, false);
    assert.equal(car.parent, parent);
    assert.deepEqual([car.position.toArray(), car.quaternion.toArray(), car.scale.toArray()], transform);
    assert.deepEqual(scene.children, [parent], "Do not put mirror geometry or cameras in the driving scene");
  }
  mirror.dispose();
});

test("resolve flips only horizontal UVs and tone maps the linear texture on the default framebuffer", () => {
  const { mirror, renderer } = fixture();
  mirror.render(0);
  const [world, resolve] = renderer.passes;
  const quad = resolve.scene.children[0];
  const { position, uv } = quad.geometry.attributes;
  for (let i = 0; i < uv.count; i++) {
    assert.equal(uv.getX(i), (1 - position.getX(i)) / 2);
    assert.equal(uv.getY(i), (1 + position.getY(i)) / 2, "Top remains top");
  }
  assert.equal(world.target.texture.colorSpace, THREE.LinearSRGBColorSpace);
  assert.equal(world.target.texture.type, THREE.HalfFloatType);
  assert.equal(world.target.texture.flipY, false);
  assert.equal(quad.material.isMeshBasicMaterial, true);
  assert.equal(quad.material.map, world.target.texture);
  assert.equal(quad.material.toneMapped, true);
  assert.equal(quad.material.depthTest, false);
  assert.equal(quad.material.depthWrite, false);
  assert.equal(quad.material.blending, THREE.NoBlending);
  assert.equal(resolve.target, null);
  assert.equal(resolve.scene.background, null);
  assert.equal(resolve.autoClear, false);
  assert.equal(resolve.scissorTest, true);
  assert.deepEqual(world.viewport.toArray(), [0, 0, world.target.width, world.target.height]);
  assert.equal(renderer.clears.length, 1);
  assert.equal(renderer.clears[0].target, world.target);
  assert.equal(renderer.clears[0].scissorTest, false);
  mirror.dispose();
});

for (const tablet of [false, true]) {
  test(`${tablet ? "tablet" : "desktop"} caps reusable target resolution and preserves aperture aspect`, () => {
    const { mirror, renderer, element } = fixture({ tablet });
    const maxWidth = tablet ? 320 : 512, maxHeight = tablet ? 120 : 192;
    let target;
    for (const [width, height] of [[400, 120], [900, 200], [100, 500], [700, 500], [20, 10], [0.1, 0.1]]) {
      element.rect = bounds(100, 60, width, height);
      mirror.render(0);
      const world = renderer.passes.at(-2);
      assert.equal(world.kind, "world");
      if (target) assert.equal(world.target, target);
      target = world.target;
      const scale = Math.min(1, maxWidth / (width * renderer.ratio), maxHeight / (height * renderer.ratio));
      assert.equal(target.width, Math.max(1, Math.round(width * renderer.ratio * scale)));
      assert.equal(target.height, Math.max(1, Math.round(height * renderer.ratio * scale)));
      assert.ok(target.width <= maxWidth && target.height <= maxHeight);
      assert.equal(world.camera.aspect, width / height);
      assert.equal(target.samples, 0);
      assert.equal(target.texture.generateMipmaps, false);
      assert.equal(target.texture.minFilter, THREE.LinearFilter);
      assert.equal(target.depthBuffer, true);
    }
    mirror.dispose();
  });

  test(`${tablet ? "20" : "30"} fps world pass, cached composite every call, and forced invalidation`, () => {
    const { mirror, renderer } = fixture({ tablet });
    const interval = 1000 / (tablet ? 20 : 30);
    mirror.render(0);
    mirror.render(1);
    mirror.render(interval - 0.001);
    assert.deepEqual(renderer.passes.map(pass => pass.kind), ["world", "resolve", "resolve", "resolve"]);
    mirror.render(interval);
    assert.equal(renderer.passes.at(-2).kind, "world");
    mirror.invalidate();
    mirror.render(interval + 1);
    assert.equal(renderer.passes.at(-2).kind, "world");
    const calls = renderer.passes.length;
    mirror.render(interval + 2);
    assert.equal(renderer.passes.length, calls + 1, "A successful forced render makes the cache fresh");
    assert.equal(renderer.clears.length, 3);
    mirror.render(0);
    assert.equal(renderer.clears.length, 4, "A restarted clock refreshes immediately");
    mirror.dispose();
  });
}

test("CSS offsets, CSS scaling, and fractional DPR are applied exactly once", () => {
  for (const ratio of [1, 1.5, 2]) {
    const { mirror, renderer } = fixture({ ratio });
    renderer.size.set(500, 300);
    mirror.render(0);
    const resolve = renderer.passes.at(-1);
    assert.deepEqual(resolve.viewport.toArray(), [100, 215, 200, 60].map(n => Math.round(n * ratio)));
    assert.deepEqual(resolve.scissor, resolve.viewport);
    mirror.dispose();
  }
});

test("partially offscreen apertures crop the full viewport instead of squeezing the reflection", () => {
  const { mirror, renderer, element } = fixture();
  for (const [rect, viewport, scissor] of [
    [bounds(0, 0, 200, 100), [-100, 1060, 400, 200], [0, 1060, 300, 140]],
    [bounds(950, 580, 200, 100), [1800, -100, 400, 200], [1800, 0, 200, 100]],
  ]) {
    element.rect = rect;
    mirror.render(0);
    const pass = renderer.passes.at(-1);
    assert.deepEqual(pass.viewport.toArray(), viewport);
    assert.deepEqual(pass.scissor.toArray(), scissor);
    assert.equal(pass.scissorTest, true);
  }
  mirror.dispose();
});

test("empty and offscreen apertures skip all drawing, and becoming visible refreshes the cache", () => {
  const { mirror, renderer, element } = fixture();
  const visible = element.rect;
  mirror.render(0);
  const before = state(renderer);
  for (const rect of [bounds(100, 80, 0, 100), bounds(100, 80, 100, 0),
    bounds(-200, 80, 100, 100), bounds(1050, 80, 100, 100),
    bounds(100, -100, 100, 100), bounds(100, 630, 100, 100)]) {
    element.rect = rect;
    mirror.render(1);
    assert.equal(renderer.passes.length, 2);
    assert.deepEqual(state(renderer), before);
  }
  element.rect = visible;
  mirror.render(1);
  assert.equal(renderer.passes.length, 4);
  renderer.domElement.rect = bounds(0, 0, 0, 0);
  mirror.render(2);
  assert.equal(renderer.passes.length, 4);
  mirror.dispose();
});

test("resize invalidates even at the resolution cap; DPR and context restoration refresh too", () => {
  const { mirror, renderer, element } = fixture();
  mirror.render(0);
  const target = renderer.passes[0].target;
  const dimensions = [target.width, target.height];
  element.rect = bounds(250, 80, 800, 240);
  mirror.render(1);
  assert.equal(renderer.passes.length, 4);
  assert.deepEqual([target.width, target.height], dimensions);
  renderer.ratio = 1;
  mirror.render(2);
  assert.equal(renderer.passes.length, 6);
  renderer.contextLost = true;
  mirror.render(3);
  assert.equal(renderer.passes.length, 6);
  renderer.contextLost = false;
  mirror.invalidate();
  mirror.render(4);
  assert.equal(renderer.passes.length, 8);
  mirror.render(5);
  assert.equal(renderer.passes.length, 9);
  mirror.dispose();
});

for (const offscreen of [false, true]) {
  for (const fail of [null, "world", "resolve"]) {
    test(`restores ${offscreen ? "cube target" : "default framebuffer"} state after ${fail || "successful"} render`, () => {
      const { mirror, renderer, car, visual, parent } = fixture();
      renderer.autoClear = !offscreen;
      renderer.info.autoReset = !offscreen;
      renderer.shadowMap.autoUpdate = !offscreen;
      renderer.shadowMap.needsUpdate = true;
      renderer.setScissorTest(true);
      const previousTarget = offscreen ? new THREE.WebGLCubeRenderTarget(64) : null;
      if (previousTarget) {
        previousTarget.viewport.set(2, 3, 40, 42);
        previousTarget.scissor.set(5, 7, 20, 22);
        previousTarget.scissorTest = false;
      }
      renderer.setRenderTarget(previousTarget, offscreen ? 4 : 0, offscreen ? 2 : 0);
      renderer.fail = fail;
      const before = state(renderer);
      if (fail) assert.throws(() => mirror.render(0), new RegExp(`${fail} render failed`));
      else mirror.render(0);
      assert.deepEqual(state(renderer), before);
      assert.equal(car.visible, true);
      assert.equal(visual.visible, false);
      assert.equal(car.parent, parent);
      assert.equal(renderer.info.render.calls, 7 + renderer.passes.length, "Keep the main frame's counters");
      for (const pass of renderer.passes) {
        assert.equal(pass.autoReset, false);
        assert.deepEqual(pass.shadows, { autoUpdate: false, needsUpdate: false });
      }
      renderer.fail = null;
      const calls = renderer.passes.length;
      mirror.render(1);
      assert.equal(renderer.passes.length - calls, fail === "world" ? 2 : 1,
        "Only a successful world pass marks the cache fresh, even if resolve fails");
      assert.deepEqual(state(renderer), before);
      mirror.dispose();
      previousTarget?.dispose();
    });
  }
}

test("a previously hidden car stays hidden even if the world render throws", () => {
  const { mirror, renderer, car } = fixture();
  car.visible = false;
  renderer.fail = "world";
  assert.throws(() => mirror.render(0), /world render failed/);
  assert.equal(car.visible, false);
  mirror.dispose();
});

test("non-HDR fallback stays linear and dispose releases only owned resources once", () => {
  const { mirror, renderer, car, parent, scene } = fixture({ hdr: false });
  mirror.render(0);
  const target = renderer.passes[0].target;
  const quad = renderer.passes[1].scene.children[0];
  assert.equal(target.texture.type, THREE.UnsignedByteType);
  assert.equal(target.texture.colorSpace, THREE.LinearSRGBColorSpace);
  const disposed = [];
  for (const resource of [target, quad.geometry, quad.material]) {
    resource.addEventListener("dispose", () => disposed.push(resource));
  }
  const before = state(renderer);
  mirror.dispose();
  mirror.dispose();
  mirror.invalidate();
  mirror.render(1000);
  assert.deepEqual(disposed, [target, quad.geometry, quad.material]);
  assert.equal(renderer.passes.length, 2);
  assert.deepEqual(state(renderer), before);
  assert.equal(car.parent, parent);
  assert.deepEqual(scene.children, [parent]);
});
