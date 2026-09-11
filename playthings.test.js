import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { createPlaythings } from "./playthings.js";
import { createAmsterdamCourse } from "./amsterdam-course.js";
import { AMSTERDAM, amsterdamPathLength, sampleAmsterdamPath, waterAt, bridgeAt } from "./amsterdam-layout.js";

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

for (const height of [-20, 20]) {
  test(`all toy kinds spawn and reset above terrain at ${height}, beyond the old world bounds`, () => {
    const scene = new THREE.Scene();
    const terrain = { halfSize: 620, heightAt: (x, z) => height + (x - 450) * 0.03 + z * 0.01 };
    const route = Array.from({ length: 960 }, (_, i) => new THREE.Vector3(430 + i / 24, 999, 0));
    const toys = createPlaythings({ scene, route, terrain, roadDist: (_, z) => Math.abs(z),
      kinds: { ball: { count: 1, sizeRange: [1, 1] }, block: { count: 1, sizeRange: [1, 1] }, tire: { count: 1, sizeRange: [1, 1] } } });
    assert.equal(toys.state().count, 3);
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    for (const [index, restY] of [[0, 1.075], [2, 0.575], [3, 0.35]]) {
      scene.children[index].getMatrixAt(0, matrix);
      point.setFromMatrixPosition(matrix);
      assert.ok(point.x > 400);
      assert.ok(Math.abs(point.y - terrain.heightAt(point.x, point.z) - restY) < 1e-5);
      assert.ok(Math.abs(point.x) < terrain.halfSize && Math.abs(point.z) < terrain.halfSize);
    }
    const origins = scene.children.map(m => m.instanceMatrix.array.slice());
    const first = toys.state().first;
    const car = new THREE.Vector3(first[0] - 6, terrain.heightAt(first[0] - 6, first[2]), first[2]);
    toys.reset(car, Math.PI / 2);
    for (let i = 0; i < 180; i++) {
      car.x += 0.1; car.y = terrain.heightAt(car.x, car.z);
      toys.update(1 / 120, car, Math.PI / 2);
    }
    assert.ok(toys.state().hits > 0);
    assert.ok(toys.state().moved > 0);
    toys.reset(car);
    assert.deepEqual(toys.state().first, first);
    assert.deepEqual(scene.children.map(m => m.instanceMatrix.array), origins);
    assert.equal(toys.state().hits, 0);
    assert.equal(toys.state().awake, 0);
  });
}

test("opt-in toy placement uses dry clearance and precise long-quay rectangles", () => {
  const scene = new THREE.Scene();
  const terrain = { halfSize: 120, heightAt: (_, z) => z < 0 ? 2.4 : -2,
    isSafePosition: (x, z, margin = 0) => Number.isFinite(x) && z + margin < 0 };
  const route = Array.from({ length: 240 }, (_, i) => new THREE.Vector3(i / 4 - 30, 0, -12));
  const obstacles = [{ x: 0, z: 0, hx: 300, hz: 0.3 }];
  const kinds = { ball: { count: 4, sizeRange: [1, 1] }, block: { count: 4, sizeRange: [1, 1] }, tire: { count: 4, sizeRange: [1, 1] } };
  const toys = createPlaythings({ scene, terrain, route, obstacles, kinds, roadDist: () => 99 });
  assert.equal(toys.state().count, 12);
  const matrix = new THREE.Matrix4();
  for (const mesh of scene.children) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    assert.ok(terrain.isSafePosition(matrix.elements[12], matrix.elements[14], 1));
    assert.ok(matrix.elements[13] > 2.4);
    assert.ok(matrix.elements[14] < -2.8, "the real rectangle still excludes overlapping placements");
  }
  const origins = scene.children.map(mesh => mesh.instanceMatrix.array.slice());
  toys.reset();
  assert.deepEqual(scene.children.map(mesh => mesh.instanceMatrix.array), origins);
  const legacy = createPlaythings({ scene: new THREE.Scene(), route, obstacles, kinds, roadDist: () => 99,
    terrain: { halfSize: terrain.halfSize, heightAt: terrain.heightAt } });
  assert.equal(legacy.state().count, 0, "legacy obstacle placement stays unchanged without the safety API");

  let checks = 0;
  terrain.isSafePosition = () => { checks++; return false; };
  const empty = createPlaythings({ scene: new THREE.Scene(), terrain, route, kinds, roadDist: () => 99 });
  assert.equal(empty.state().count, 0);
  assert.ok(checks > 0 && checks <= 12 * 70);
  empty.reset();
  assert.equal(empty.state().first, null);
});

test("Amsterdam toys thrown into a canal recover individually to their safe original positions", (t) => {
  const bodies = [], addBody = CANNON.World.prototype.addBody;
  t.mock.method(CANNON.World.prototype, "addBody", function (body) {
    addBody.call(this, body);
    if (body.mass > 0) bodies.push(body);
  });
  const terrain = createAmsterdamCourse(), scene = new THREE.Scene();
  const canal = AMSTERDAM.canals.find(c => c.name === "Prinsengracht");
  const distance = amsterdamPathLength(canal.points) * 0.6;
  const water = sampleAmsterdamPath(canal.points, distance);
  const bank = sampleAmsterdamPath(canal.points, distance, canal.width / 2 + 5);
  const toss = new THREE.Vector3(-Math.sin(water.heading), 0, -Math.cos(water.heading));
  assert.ok(!waterAt(bank.x, bank.z) && terrain.isSafePosition(bank.x, bank.z, 1), "toss starts on a dry bank");
  assert.ok(waterAt(water.x, water.z) && !bridgeAt(water.x, water.z), "toss aims across exposed canal water");
  const toys = createPlaythings({ scene, terrain, route: terrain.route, roadDist: terrain.roadDistance,
    kinds: { ball: { count: 1, sizeRange: [1, 1] }, block: { count: 1, sizeRange: [1, 1] }, tire: { count: 1, sizeRange: [1, 1] } } });
  assert.equal(toys.state().count, 3);
  const origins = bodies.map(body => body.position.toArray());
  const matrices = scene.children.map(mesh => mesh.instanceMatrix.array.slice());
  const car = new THREE.Vector3(310, 2.4, -310);
  toys.reset(car);
  bodies[2].position.set(0, terrain.heightAt(0, 210) + 0.35, 210);
  bodies[2].aabbNeedsUpdate = true;
  const expected = bodies.map(body => body.position.toArray());
  for (const [i, body] of bodies.entries()) {
    assert.ok(terrain.isSafePosition(body.position.x, body.position.z, 1));
    let crossedWater = false;
    // Observe the leading clearance edge before recovery resets the body in update().
    body.world.addEventListener("postStep", () => {
      const x = body.position.x + toss.x, z = body.position.z + toss.z;
      crossedWater ||= waterAt(x, z) && !bridgeAt(x, z);
    });
    body.position.set(bank.x, 8, bank.z);
    body.velocity.set(toss.x * 35, 0, toss.z * 35);
    body.angularVelocity.set(3, 4, 5);
    body.aabbNeedsUpdate = true;
    body.wakeUp();
    for (let frame = 0; frame < 120 && body.sleepState !== CANNON.Body.SLEEPING; frame++) {
      toys.update(1 / 120, car, 0);
      assert.ok(terrain.isSafePosition(body.position.x, body.position.z, 1));
      for (const mesh of scene.children) assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
    }
    assert.ok(crossedWater, "each moving toy's footprint crosses exposed water before recovery");
    assert.deepEqual(body.position.toArray(), origins[i]);
    assert.equal(body.sleepState, CANNON.Body.SLEEPING);
    assert.equal(body.velocity.lengthSquared(), 0);
    assert.equal(body.angularVelocity.lengthSquared(), 0);
    expected[i] = origins[i];
    assert.deepEqual(bodies.map(b => b.position.toArray()), expected, "dry bystanders are not reset");
  }
  bodies[0].position.set(water.x, -1, water.z);
  toys.reset(car);
  assert.deepEqual(bodies.map(body => body.position.toArray()), origins);
  assert.deepEqual(scene.children.map(mesh => mesh.instanceMatrix.array), matrices);
  assert.equal(toys.state().moved, 0);
  assert.equal(toys.state().hits, 0);
});
