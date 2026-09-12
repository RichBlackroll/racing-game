import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createFinishLine } from "./finish-line.js";
import { moveWithBounces } from "./collision.js";
import { enableGeometryShadows } from "./daylight.js";

test("finish gantry has the exact message, readable panels on both sides, and chequered paint", (t) => {
  const text = [];
  const context = { fillRect() {}, fillText(...args) { text.push(args); } };
  const canvas = { getContext: () => context };
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => originalDocument ? Object.defineProperty(globalThis, "document", originalDocument) : delete globalThis.document);
  globalThis.document = { createElement: () => canvas };
  const scene = new THREE.Scene();
  const group = createFinishLine({ scene, position: new THREE.Vector3(), heading: 0, obstacles: [] });
  assert.equal(group.parent, scene);
  assert.deepEqual(text, [["Daddy is a legend", 1024, 133, 1408]]);
  assert.equal(canvas.width, 2048);
  const front = group.getObjectByName("finish-banner-front");
  const back = group.getObjectByName("finish-banner-back");
  assert.equal(front.material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(front.material, back.material);
  assert.equal(front.rotation.y, Math.PI);
  assert.equal(back.rotation.y, 0);
  assert.ok(front.position.z < -0.575 && back.position.z > 0.575);
  assert.equal(group.children.filter(child => child.geometry?.type === "CircleGeometry").length, 10);
  const paint = group.children.filter(child => child.name === "finish-road-paint");
  assert.equal(paint.length, 2);
  enableGeometryShadows(group);
  assert.ok(paint.every(mesh => mesh.receiveShadow && !mesh.castShadow), "global lighting preserves receive-only road paint");
  assert.ok(group.children.filter(mesh => mesh.name === "finish-structure").every(mesh => mesh.castShadow));
  const bounds = new THREE.Box3();
  paint.forEach(mesh => bounds.union(new THREE.Box3().setFromObject(mesh)));
  assert.ok(Math.abs(bounds.min.x + 5.8) < 1e-5);
  assert.ok(Math.abs(bounds.max.x - 5.8) < 1e-5);
  assert.ok(bounds.min.y > 0.1, "paint sits above the road and kerbs");
  assert.ok(group.children.length < 20, "structure and chequers are batched for mobile");
});

test("supports track the route heading without obstructing the road or changing other obstacles", (t) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => originalDocument ? Object.defineProperty(globalThis, "document", originalDocument) : delete globalThis.document);
  globalThis.document = {
    createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }),
  };
  for (const heading of [0, Math.PI / 2, -1.2]) {
    const position = new THREE.Vector3(20, 0.025, 100);
    const existing = { x: 200, z: 200, r: 1 };
    const obstacles = [existing];
    const group = createFinishLine({ scene: new THREE.Scene(), position, heading, obstacles });
    assert.equal(obstacles[0], existing);
    assert.equal(obstacles.length, 3);
    assert.equal(group.rotation.y, heading);
    group.updateMatrixWorld(true);
    for (const [i, x] of [-7.25, 7.25].entries()) {
      const foot = group.localToWorld(new THREE.Vector3(x, 0, 0));
      assert.ok(Math.abs(foot.x - obstacles[i + 1].x) < 1e-8);
      assert.ok(Math.abs(foot.z - obstacles[i + 1].z) < 1e-8);
    }
    for (const lane of [-4.5, 0, 4.5]) {
      const start = group.localToWorld(new THREE.Vector3(lane, 0, -8));
      const result = moveWithBounces(start, { x: Math.sin(heading) * 16, z: Math.cos(heading) * 16 }, 1, obstacles);
      assert.equal(result.hits, 0);
    }
  }
});
