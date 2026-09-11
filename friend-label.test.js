import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createFriendLabel } from "./friend-label.js";

test("friend badges stay readable across distance, boost FOV, and desktop/mobile viewports", () => {
  const texture = new THREE.Texture({ width: 512, height: 160 });
  const label = createFriendLabel(texture);
  const parent = new THREE.Group(); parent.add(label);
  parent.rotation.set(.15, Math.PI / 2, -.1);
  const scene = new THREE.Scene(); scene.add(parent);
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390], [320, 568]]) {
    const renderer = { getSize: target => target.set(width, height) };
    for (const fov of [55, 68]) for (const distance of [10, 50, 100, 200, 400, 1000]) {
      const camera = new THREE.PerspectiveCamera(fov, width / height, .1, 1600);
      camera.position.z = distance; camera.updateMatrixWorld();
      scene.updateMatrixWorld(true);
      label.onBeforeRender(renderer, scene, camera);
      const modelView = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, label.matrixWorld);
      const depth = -modelView.elements[14];
      const worldScale = new THREE.Vector3().setFromMatrixScale(label.matrixWorld);
      // Match Three's non-attenuated sprite vertex projection, including camera depth.
      const pixelWidth = worldScale.x * depth * camera.projectionMatrix.elements[0] / depth * width / 2;
      const pixelHeight = worldScale.y * depth * camera.projectionMatrix.elements[5] / depth * height / 2;
      assert.ok(Math.abs(pixelWidth - Math.min(120, width * .3)) < 1e-8);
      assert.ok(Math.abs(pixelHeight / pixelWidth - 160 / 512) < 1e-8);
      assert.ok(pixelHeight >= 30, "even a narrow phone retains readable text");
    }
  }
  assert.equal(label.material.sizeAttenuation, false);
  assert.equal(label.material.fog, false, "fog must not wash out distant names");
  assert.equal(label.material.toneMapped, false);
  assert.equal(label.material.depthTest, true, "buildings still occlude badges");
  assert.equal(label.material.depthWrite, false);
  assert.equal(label.frustumCulled, false, "screen-sized badges survive near viewport edges");
  assert.deepEqual(label.center.toArray(), [.5, 0], "names sit above, not over, the friend");
});

test("picnic labels preserve their wider aspect ratio and refreshable texture", () => {
  const texture = new THREE.Texture({ width: 512, height: 128 });
  const label = createFriendLabel(texture, 144);
  const camera = new THREE.PerspectiveCamera(55, 2, .1, 1600);
  label.onBeforeRender({ getSize: target => target.set(1200, 600) }, new THREE.Scene(), camera);
  assert.equal(label.material.map, texture);
  assert.ok(Math.abs(label.scale.y / label.scale.x - .25) < 1e-8);
  assert.ok(Math.abs(label.scale.x * camera.projectionMatrix.elements[0] * 600 - 144) < 1e-8);
});
