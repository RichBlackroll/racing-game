import test from "node:test";
import assert from "node:assert/strict";
import { stepRacerBodies } from "./racer-physics.js";

const body = (x, z, vx, vz, mass = 1) => ({ x, y: 0, z, vx, vz, mass, radius: 1.5 });
const momentum = cars => cars.reduce((sum, b) => sum + b.vx * b.mass, 0);
const energy = cars => cars.reduce((sum, b) => sum + b.mass * (b.vx ** 2 + b.vz ** 2) / 2, 0);

test("vehicle heights gate overhead scenery and asymmetric racer contacts", () => {
  for (const height of [undefined, 2.85, 3.15]) {
    const car = { ...body(-4, 0, 100, 0), height };
    stepRacerBodies([car], .05, [{ x: 0, z: 0, hx: 1, hz: 10, y: 2, height: 1 }], 500);
    assert.equal(car.staticHits > 0, height !== undefined);
    for (const reversed of [false, true]) for (const upperY of [2.4, 5]) {
      const lower = { ...body(-4, 0, 100, 0), height }, upper = { ...body(0, 0, 0, 0), y: upperY, height: 3.15 };
      stepRacerBodies(reversed ? [upper, lower] : [lower, upper], .05, [], 500);
      assert.equal(lower.hits > 0, height !== undefined && upperY === 2.4, "only the lower car's height can close the vertical gap");
    }
  }
  for (const y of [1.79, 1.81]) {
    const a = body(-4, 0, 100, 0), b = { ...body(0, 0, 0, 0), y };
    stepRacerBodies([a, b], .05, [], 500);
    assert.equal(a.hits > 0, y < 1.8, "stock vertical tolerance stays unchanged");
  }
});

test("car impacts transfer momentum in either direction without adding energy", () => {
  for (const direction of [-1, 1]) for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
    const a = body(-8 * direction, 0, 100 * direction, 0, 1.6), b = body(0, 0, 0, 0);
    const cars = [a, b], before = momentum(cars), kinetic = energy(cars);
    let hits = 0;
    for (let i = 0; i < Math.ceil(.2 / dt); i++) { stepRacerBodies(cars, dt, [], 500); hits += a.hits; }
    assert.ok(hits > 0);
    assert.ok(a.vx * direction > 0, "striking car is not reflected backward");
    assert.ok(b.vx * direction > 50, "struck car takes the impulse");
    assert.ok(Math.abs(momentum(cars) - before) < 1e-6);
    assert.ok(energy(cars) <= kinetic);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 3);
  }
});

test("boost-speed head-on contacts cannot tunnel and glancing hits retain tangential momentum", () => {
  const a = body(-5, .6, 120, 5), b = body(5, -.6, -120, 5);
  const before = energy([a, b]);
  stepRacerBodies([a, b], .05, [], 500);
  assert.ok(a.hits > 0 && b.hits > 0);
  assert.ok(a.x < b.x);
  assert.ok(energy([a, b]) <= before);
  assert.ok(Math.abs(a.vz + b.vz - 10) < 1e-6);
});

test("airborne cars clear grounded racers, while static scenery and world edges still stop cars", () => {
  const a = body(-4, 0, 120, 0), b = body(0, 0, 0, 0); a.y = 5;
  stepRacerBodies([a, b], .05, [], 500);
  assert.equal(a.hits, 0); assert.equal(b.vx, 0);
  const c = body(-4, 0, 100, 0);
  stepRacerBodies([c], .05, [{ x: 0, z: 0, hx: 1, hz: 10, height: 4 }], 500);
  assert.ok(c.staticHits > 0); assert.ok(c.x <= -2.5);
  const edge = body(498, 0, 100, 0);
  stepRacerBodies([edge], .05, [], 500);
  assert.ok(edge.x <= 498.5 && edge.vx <= 0);
});

test("standing overlaps separate without impulses, and zero-time steps freeze all bodies", () => {
  const a = body(0, 0, 0, 0), b = body(0, 0, 0, 0);
  for (const dt of [0, -1, NaN]) {
    const before = structuredClone([a, b]); stepRacerBodies([a, b], dt, [], 500); assert.deepEqual([a, b], before);
  }
  stepRacerBodies([a, b], .05, [], 500);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 3);
  assert.equal(energy([a, b]), 0);
});
