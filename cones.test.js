import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createConeField } from "./cones.js";
import { moveWithBounces } from "./collision.js";

test("solid impacts have a gentle rebound and preserve tangential movement", () => {
  const result = moveWithBounces({ x: 0, z: 0 }, { x: 20, z: 3 }, 0.1, [{ x: 3, z: 0, hx: 0.5, hz: 10 }]);
  assert.ok(result.hits > 0);
  assert.ok(Math.abs(result.vx + 2.4) < 1e-8);
  assert.equal(result.vz, 3);
  assert.ok(result.x <= 1.38);
});

test("cones move when hit, settle to sleep, and reset without affecting the car", () => {
  const scene = new THREE.Scene();
  const route = Array.from({ length: 240 }, (_, i) => new THREE.Vector3(i * 2, 0.025, 0));
  const cones = createConeField({ scene, route, obstacles: [], onChange() {} });
  const car = new THREE.Vector3();
  cones.reset(car, Math.PI / 2);
  const origin = cones.state().first.slice();
  assert.equal(cones.state().awake, 0);
  assert.equal(scene.children.length, 3, "all cones share only three instanced draw calls");
  for (let i = 0; i < 180; i++) {
    car.x += 12 / 120;
    const x = car.x;
    cones.update(1 / 120, car, Math.PI / 2);
    assert.equal(car.x, x, "lightweight cones do not throw the car back");
  }
  assert.ok(cones.state().hits > 0);
  assert.ok(cones.state().moved > 0);
  for (let i = 0; i < 3600; i++) cones.update(1 / 120, car, Math.PI / 2);
  assert.equal(cones.state().awake, 0, "resting cones stop consuming solver work");
  assert.ok(cones.state().first.every(Number.isFinite));
  cones.reset(new THREE.Vector3(), Math.PI / 2);
  assert.deepEqual(cones.state().first, origin);
  assert.equal(cones.state().moved, 0);
  assert.equal(cones.state().hits, 0);
});
