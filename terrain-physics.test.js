import test from "node:test";
import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import * as THREE from "three";
import { createTerrainBody } from "./terrain-physics.js";
import { createConeField } from "./cones.js";
import { createPlaythings } from "./playthings.js";
import { createPeopleField } from "./people.js";
import { createJumpPhysics } from "./jumps.js";

test("omitting terrain retains the infinite plane and its road offset and filters", () => {
  const floor = createTerrainBody(null, { collisionFilterGroup: 1, collisionFilterMask: 16 });
  assert.ok(floor.shapes[0] instanceof CANNON.Plane);
  assert.equal(floor.mass, 0);
  assert.equal(floor.collisionFilterGroup, 1);
  assert.equal(floor.collisionFilterMask, 16);
  assert.equal(floor.position.y, 0.075);
  const normal = floor.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
  assert.ok(normal.distanceTo(new CANNON.Vec3(0, 1, 0)) < 1e-12);
});

test("heightfields map both world axes and negative heights correctly, including the boundaries", () => {
  const terrain = { halfSize: 31, heightAt: (x, z) => 0.2 * x - 0.35 * z - 4 };
  const floor = createTerrainBody(terrain);
  const shape = floor.shapes[0];
  assert.ok(shape instanceof CANNON.Heightfield);
  assert.ok(shape.elementSize > 3.8 && shape.elementSize <= 4);
  assert.equal((shape.data.length - 1) * shape.elementSize, 62);
  for (const i of [0, 5, shape.data.length - 1]) {
    for (const j of [0, 9, shape.data.length - 1]) {
      const point = floor.pointToWorldFrame(new CANNON.Vec3(i * shape.elementSize, j * shape.elementSize, shape.data[i][j]));
      assert.ok(Math.abs(point.y - terrain.heightAt(point.x, point.z) - 0.075) < 1e-12);
    }
  }
  const world = new CANNON.World();
  world.addBody(floor);
  for (const [x, z] of [[-30.99, -30.97], [30.97, 30.99], [7.3, -11.7], [-9.1, 19.8]]) {
    const ray = new CANNON.RaycastResult();
    assert.ok(world.raycastClosest(new CANNON.Vec3(x, 50, z), new CANNON.Vec3(x, -50, z), {}, ray));
    assert.ok(Math.abs(ray.hitPointWorld.y - terrain.heightAt(x, z) - 0.075) < 1e-10);
    assert.ok(ray.hitNormalWorld.y > 0.9);
  }
  assert.equal(world.raycastClosest(new CANNON.Vec3(32, 50, 0), new CANNON.Vec3(32, -50, 0), {}, new CANNON.RaycastResult()), false,
    "terrain is bounded, not an object-local floating plane");
});

test("only sampled data is cached by height function and halfSize, never shapes or bodies", () => {
  let calls = 0;
  const heightAt = (x, z) => { calls++; return x * 0.1 + z * 0.2; };
  const a = createTerrainBody({ halfSize: 20, heightAt });
  const sampled = calls;
  const b = createTerrainBody({ halfSize: 20, heightAt });
  assert.equal(calls, sampled);
  assert.notEqual(a, b);
  assert.notEqual(a.shapes[0], b.shapes[0]);
  assert.equal(a.shapes[0].data, b.shapes[0].data);
  const wa = new CANNON.World(), wb = new CANNON.World();
  wa.addBody(a); wb.addBody(b);
  assert.equal(a.world, wa);
  assert.equal(b.world, wb);
  assert.equal(a.shapes[0].body, a);
  assert.equal(b.shapes[0].body, b);
  a.shapes[0].getConvexTrianglePillar(1, 1, false);
  assert.equal(b.shapes[0].getCachedConvexTrianglePillar(1, 1, false), undefined);
  assert.notEqual(createTerrainBody({ halfSize: 24, heightAt }).shapes[0].data, a.shapes[0].data);
  assert.ok(calls > sampled);
  assert.notEqual(createTerrainBody({ halfSize: 20, heightAt: () => 10 }).shapes[0].data, a.shapes[0].data);
});

for (const height of [-20, 20]) {
  test(`a sphere rolls downhill on actual heightfield contacts at elevation ${height}`, () => {
    const terrain = { halfSize: 100, heightAt: (x, z) => height + x * 0.15 + z * 0.08 };
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    world.addBody(createTerrainBody(terrain));
    const ball = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.5),
      position: new CANNON.Vec3(0, height + 1, 0), linearDamping: 0, angularDamping: 0 });
    world.addBody(ball);
    let contacts = 0;
    for (let i = 0; i < 600; i++) {
      world.step(1 / 120);
      contacts += world.contacts.length;
    }
    assert.ok(contacts > 300);
    assert.ok(ball.position.x < -5 && ball.position.z < -2, "both downhill components match the height function");
    assert.ok(ball.angularVelocity.length() > 1, "contact friction produces rolling");
    const clearance = ball.position.y - terrain.heightAt(ball.position.x, ball.position.z);
    assert.ok(Math.abs(clearance - (0.075 + 0.5 * Math.sqrt(1 + 0.15 ** 2 + 0.08 ** 2))) < 0.02);
  });
}

test("every field owns terrain collision and places obstacle and ramp bases at their supplied heights", (t) => {
  const bodies = [];
  const addBody = CANNON.World.prototype.addBody;
  t.mock.method(CANNON.World.prototype, "addBody", function (body) {
    bodies.push(body);
    return addBody.call(this, body);
  });
  const terrain = { halfSize: 100, heightAt: (x, z) => -12 + x * 0.04 + z * 0.02 };
  const route = Array.from({ length: 240 }, (_, i) => new THREE.Vector3(i / 8 - 15, 0, 0));
  const obstacles = [{ x: 30, z: 40, hx: 2, hz: 3 }, { x: -30, z: 40, r: 2, y: 0 }, { x: 30, z: -40, r: 2, y: 18 }];
  const ramps = [{ x: -30, z: -40, y: -5, heading: 0.3, width: 9.5, length: 18, height: 3 }];
  const floors = [];
  for (const create of [createConeField, createPlaythings, createPeopleField]) {
    bodies.length = 0;
    create({ scene: new THREE.Scene(), route, obstacles, ramps, terrain, onChange() {},
      roadDist: () => 99, count: 1, kinds: { ball: { count: 1 } } });
    assert.equal(bodies.filter(b => b.shapes[0] instanceof CANNON.Heightfield).length, 1);
    assert.equal(bodies.filter(b => b.shapes[0] instanceof CANNON.Plane).length, 0);
    floors.push(bodies[0]);
    for (const o of obstacles) {
      const body = bodies.find(b => b.mass === 0 && b.position.x === o.x && b.position.z === o.z);
      assert.equal(body.position.y, (o.y ?? terrain.heightAt(o.x, o.z)) + 1.5);
    }
    const body = bodies.find(b => b.mass === 0 && b.position.x === ramps[0].x && b.position.z === ramps[0].z);
    assert.equal(body.position.y, -5 + 0.075);
    assert.ok(body.shapes[0] instanceof CANNON.ConvexPolyhedron);
  }
  bodies.length = 0;
  createJumpPhysics(ramps, 9.82, terrain);
  floors.push(bodies[0]);
  assert.equal(bodies[1].position.y, -5 + 0.075);
  assert.equal(new Set(floors.map(b => b.world)).size, 4);
  assert.equal(new Set(floors.map(b => b.shapes[0])).size, 4);
  assert.equal(new Set(floors.map(b => b.shapes[0].data)).size, 1);
});
