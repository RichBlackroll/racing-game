import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createPlaythings } from "./playthings.js";

test("toys sit off-road, are pushed by the car, settle, and reset cleanly", () => {
  const scene = new THREE.Scene();
  // Compact straight route keeps every spawn inside the world bounds.
  const route = Array.from({ length: 240 }, (_, i) => new THREE.Vector3(i * 0.25, 0.025, 0));
  const toys = createPlaythings({
    scene,
    route,
    roadDist: (x, z) => Math.abs(z),
    obstacles: [],
    onChange() {},
    kinds: { ball: { count: 12 }, block: { count: 8 } },
  });
  const car = new THREE.Vector3();
  toys.reset(car, Math.PI / 2);
  const first = toys.state().first.slice();
  assert.equal(toys.state().moved, 0);
  // Drive straight through the first toy so the sweep is deterministic.
  car.z = first[2];
  const steps = Math.ceil((first[0] + 4) / (12 / 120));
  for (let i = 0; i < steps; i++) {
    car.x += 12 / 120;
    const x = car.x;
    toys.update(1 / 120, car, Math.PI / 2);
    assert.equal(car.x, x, "lightweight toys never throw the car back");
  }
  assert.ok(toys.state().hits > 0, "the bumper strikes at least one toy");
  assert.ok(toys.state().moved > 0, "toys are knocked away from their origin");
  for (let i = 0; i < 3600; i++) toys.update(1 / 120, car, Math.PI / 2);
  assert.equal(toys.state().awake, 0, "resting toys stop consuming solver work");
  assert.ok(toys.state().first.every(Number.isFinite));
  toys.reset(new THREE.Vector3(), Math.PI / 2);
  assert.deepEqual(toys.state().first, first);
  assert.equal(toys.state().moved, 0);
  assert.equal(toys.state().hits, 0);
});