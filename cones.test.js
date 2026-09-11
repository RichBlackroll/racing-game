import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { createConeField } from "./cones.js";
import { moveWithBounces } from "./collision.js";
import { createAmsterdamCourse } from "./amsterdam-course.js";
import { AMSTERDAM, amsterdamPathLength, sampleAmsterdamPath, waterAt, bridgeAt } from "./amsterdam-layout.js";

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

test("cones cover the entire longer route and reset to positive and negative local terrain heights", () => {
  const scene = new THREE.Scene();
  const terrain = { halfSize: 620, heightAt: (x, z) => x * 0.04 + z * 0.02 };
  const route = Array.from({ length: 960 }, (_, i) => {
    const angle = i / 960 * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * 460, 999, Math.sin(angle) * 460);
  });
  const cones = createConeField({ scene, route, terrain, obstacles: [], onChange() {} });
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  let low = Infinity, high = -Infinity;
  const origins = scene.children[0].instanceMatrix.array.slice();
  for (let i = 0; i < 28; i++) {
    scene.children[0].getMatrixAt(i, matrix);
    point.setFromMatrixPosition(matrix);
    const p = route[(4 + i * 8) * 4];
    assert.ok(Math.hypot(point.x - p.x, point.z - p.z) < 4.5, "proportional index spans the full lap");
    assert.ok(Math.abs(point.y - terrain.heightAt(point.x, point.z) - 0.075) < 1e-5);
    low = Math.min(low, point.y); high = Math.max(high, point.y);
  }
  assert.ok(low < -15 && high > 15);
  const first = cones.state().first;
  const car = new THREE.Vector3(first[0] - 6, terrain.heightAt(first[0] - 6, first[2]), first[2]);
  cones.reset(car, Math.PI / 2);
  for (let i = 0; i < 180; i++) {
    car.x += 0.1; car.y = terrain.heightAt(car.x, car.z);
    cones.update(1 / 120, car, Math.PI / 2);
  }
  assert.ok(cones.state().hits > 0);
  assert.ok(cones.state().moved > 0);
  cones.reset(car);
  assert.deepEqual(scene.children[0].instanceMatrix.array, origins);
  assert.deepEqual(cones.state().first, first);
  assert.equal(cones.state().hits, 0);
});

test("opt-in cones choose the dry side of a canal and bound failed placement attempts", () => {
  const terrain = { halfSize: 120, heightAt: (_, z) => z < 0 ? 2.4 : -2,
    isSafePosition: (x, z, margin = 0) => Number.isFinite(x) && z + margin < 0 };
  const route = Array.from({ length: 240 }, (_, i) => new THREE.Vector3(i / 4 - 30, 0, 0));
  const scene = new THREE.Scene();
  const cones = createConeField({ scene, terrain, route, obstacles: [], onChange() {} });
  assert.equal(cones.state().count, 28);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 28; i++) {
    scene.children[0].getMatrixAt(i, matrix);
    assert.ok(terrain.isSafePosition(matrix.elements[12], matrix.elements[14], 0.65));
    assert.ok(Math.abs(matrix.elements[13] - 2.475) < 1e-5);
  }
  const origins = scene.children.map(mesh => mesh.instanceMatrix.array.slice());
  cones.reset();
  assert.deepEqual(scene.children.map(mesh => mesh.instanceMatrix.array), origins);
  const legacy = createConeField({ scene: new THREE.Scene(), route, obstacles: [], onChange() {},
    terrain: { halfSize: terrain.halfSize, heightAt: terrain.heightAt } });
  assert.ok(legacy.state().first[2] > 0, "without the API the original alternating offsets are unchanged");

  let checks = 0;
  terrain.isSafePosition = () => { checks++; return false; };
  const emptyScene = new THREE.Scene();
  const empty = createConeField({ scene: emptyScene, terrain, route, obstacles: [], onChange() {} });
  assert.equal(empty.state().count, 0);
  assert.ok(checks > 0 && checks <= 28 * 32);
  assert.ok(emptyScene.children.every(mesh => mesh.count === 0), "unplaced cones are not drawn at the origin");
  empty.reset();
  assert.equal(empty.state().first, null);
});

test("Amsterdam cones thrown into water return to their own safe origin and reset cleanly", (t) => {
  const bodies = [], addBody = CANNON.World.prototype.addBody;
  t.mock.method(CANNON.World.prototype, "addBody", function (body) {
    addBody.call(this, body);
    if (body.mass > 0) bodies.push(body);
  });
  const scene = new THREE.Scene(), terrain = createAmsterdamCourse();
  const canal = AMSTERDAM.canals.find(c => c.name === "Prinsengracht");
  const distance = amsterdamPathLength(canal.points) * 0.6;
  const water = sampleAmsterdamPath(canal.points, distance);
  const bank = sampleAmsterdamPath(canal.points, distance, canal.width / 2 + 5);
  const toss = new THREE.Vector3(-Math.sin(water.heading), 0, -Math.cos(water.heading));
  assert.ok(!waterAt(bank.x, bank.z) && terrain.isSafePosition(bank.x, bank.z, 0.65), "toss starts on a dry bank");
  assert.ok(waterAt(water.x, water.z) && !bridgeAt(water.x, water.z), "toss aims across exposed canal water");
  const cones = createConeField({ scene, terrain, route: terrain.route, obstacles: [], onChange() {} });
  assert.equal(cones.state().count, 28);
  const origins = bodies.map(body => body.position.toArray());
  for (const [x, y, z] of origins) {
    assert.ok(terrain.isSafePosition(x, z, 0.65));
    assert.ok(y > terrain.heightAt(x, z));
  }
  const matrices = scene.children.map(mesh => mesh.instanceMatrix.array.slice());
  const car = new THREE.Vector3(310, 2.4, -310);
  cones.reset(car);
  bodies[1].position.set(0, terrain.heightAt(0, 210) + 0.47, 210);
  bodies[1].aabbNeedsUpdate = true;
  const expected = bodies.map(body => body.position.toArray());
  const body = bodies[0];
  let crossedWater = false;
  // Observe the leading clearance edge before recovery resets the body in update().
  body.world.addEventListener("postStep", () => {
    const x = body.position.x + toss.x * 0.65, z = body.position.z + toss.z * 0.65;
    crossedWater ||= waterAt(x, z) && !bridgeAt(x, z);
  });
  body.position.set(bank.x, 8, bank.z);
  body.velocity.set(toss.x * 35, 0, toss.z * 35);
  body.angularVelocity.set(3, 4, 5);
  body.aabbNeedsUpdate = true;
  body.wakeUp();
  for (let i = 0; i < 120 && body.sleepState !== CANNON.Body.SLEEPING; i++) {
    cones.update(1 / 120, car, 0);
    assert.ok(terrain.isSafePosition(body.position.x, body.position.z, 0.65));
    for (const mesh of scene.children) assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
  }
  assert.ok(crossedWater, "the moving cone's footprint crosses exposed water before recovery");
  assert.deepEqual(bodies.map(b => b.position.toArray()), expected, "dry bystanders are not reset");
  assert.equal(body.sleepState, CANNON.Body.SLEEPING);
  assert.equal(body.velocity.lengthSquared(), 0);
  assert.equal(body.angularVelocity.lengthSquared(), 0);
  body.position.set(water.x, -1, water.z);
  cones.reset(car);
  assert.deepEqual(bodies.map(b => b.position.toArray()), origins);
  assert.deepEqual(scene.children.map(mesh => mesh.instanceMatrix.array), matrices);
  assert.equal(cones.state().moved, 0);
  assert.equal(cones.state().hits, 0);
});
