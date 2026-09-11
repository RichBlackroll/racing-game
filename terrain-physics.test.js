import test from "node:test";
import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import * as THREE from "three";
import { addSceneryBodies, createTerrainBody } from "./terrain-physics.js";
import { createConeField } from "./cones.js";
import { createPlaythings } from "./playthings.js";
import { createPeopleField } from "./people.js";
import { createJumpPhysics } from "./jumps.js";
import { createAmsterdamCourse } from "./amsterdam-course.js";
import { createAmsterdamWorld } from "./amsterdam-world.js";

function assertSceneryMatches(bodies, obstacles, terrain, mask) {
  const remaining = obstacles.slice();
  assert.equal(bodies.reduce((count, body) => count + body.shapes.length, 0), obstacles.length);
  for (const body of bodies) {
    assert.equal(body.mass, 0);
    assert.equal(body.type, CANNON.Body.STATIC);
    assert.equal(body.collisionFilterGroup, 8);
    assert.equal(body.collisionFilterMask, mask);
    for (const [i, shape] of body.shapes.entries()) {
      const position = body.pointToWorldFrame(body.shapeOffsets[i]);
      const orientation = body.quaternion.mult(body.shapeOrientations[i]);
      const index = remaining.findIndex(o => Math.abs(o.x - position.x) < 1e-10 && Math.abs(o.z - position.z) < 1e-10);
      assert.ok(index >= 0, "every constituent corresponds to an original obstacle, exactly once");
      const [o] = remaining.splice(index, 1);
      const originalPosition = new CANNON.Vec3(o.x, (o.y ?? terrain?.heightAt(o.x, o.z) ?? 0) + 1.5, o.z);
      const originalShape = o.hx !== undefined
        ? new CANNON.Box(new CANNON.Vec3(o.hx, 1.5, o.hz))
        : new CANNON.Cylinder(o.r, o.r, 3, 8);
      assert.equal(shape.constructor, originalShape.constructor);
      if (o.hx !== undefined) assert.deepEqual(shape.halfExtents, originalShape.halfExtents);
      else assert.deepEqual(shape.vertices, originalShape.vertices);
      assert.ok(position.distanceTo(originalPosition) < 1e-10);
      assert.deepEqual(orientation, new CANNON.Quaternion(), "record heading and height do not alter legacy shapes");
      const actual = new CANNON.AABB(), expected = new CANNON.AABB();
      shape.calculateWorldAABB(position, orientation, actual.lowerBound, actual.upperBound);
      originalShape.calculateWorldAABB(originalPosition, new CANNON.Quaternion(), expected.lowerBound, expected.upperBound);
      assert.ok(actual.lowerBound.distanceTo(expected.lowerBound) < 1e-10);
      assert.ok(actual.upperBound.distanceTo(expected.upperBound) < 1e-10);
      assert.equal(shape.body, body);
      if (o.kind !== "quay-railing" && o.kind !== "bridge-rail") {
        assert.equal(body.shapes.length, 1, "nonrails remain isolated even inside an occupied rail cell");
        assert.deepEqual(body.position, originalPosition);
        assert.deepEqual(body.shapeOffsets[i], new CANNON.Vec3());
      }
    }
  }
  assert.equal(remaining.length, 0);
}

test("scenery batching preserves box/cylinder transforms, base semantics, filters and nonrail records", () => {
  const obstacles = Object.freeze([
    { x: 3, z: 4, hx: 2, hz: 3, y: 0, height: 20, heading: 0.7, kind: "building" },
    { x: 2.2, z: 5.8, hx: 0.2, hz: 1.1, kind: "quay-railing", height: 1.35, heading: 0.8 },
    { x: 5.5, z: 7, r: 0.3, y: 0, kind: "bridge-rail" },
    { x: 6, z: 6, r: 2, y: -18, kind: "bridge-railing", name: "quay-railing" },
    { x: -0.001, z: 0.001, hx: 1, hz: 0.3, y: null, kind: "quay-railing" },
    { x: 31.999, z: 32, hx: 1.2, hz: 0.2, y: 18, kind: "bridge-rail" },
    { x: 32, z: 32, r: 0.4, kind: "quay-railing" },
    { x: -32, z: -32, r: 0.4, kind: "bridge-rail" },
    { x: -32.001, z: -32, hx: 0.3, hz: 1, kind: "quay-railing" },
    { x: 1000000, z: -1000000, hx: 0.2, hz: 1, y: -12, kind: "quay-railing" },
    { x: 1000005, z: -1000000, r: 0.4, y: 18, kind: "bridge-rail" },
    { x: 8, z: 9, r: 1 },
  ].map(Object.freeze));
  const before = structuredClone(obstacles), shapes = new Set();
  for (const terrain of [null, { heightAt: (x, z) => -12 + x * 0.04 + z * 0.02 }]) {
    for (const mask of [2, 3, 3 | 16]) {
      const world = new CANNON.World();
      addSceneryBodies(world, [], terrain, mask);
      assert.equal(world.bodies.length, 0, "empty space creates no bodies");
      addSceneryBodies(world, obstacles, terrain, mask);
      assertSceneryMatches(world.bodies, obstacles, terrain, mask);
      assert.equal(world.bodies.length, 10, "only occupied cells are allocated, even for distant rails");
      for (const body of world.bodies) for (const shape of body.shapes) {
        assert.ok(!shapes.has(shape), "worlds never share mutable shapes");
        shapes.add(shape);
      }
    }
  }
  assert.deepEqual(obstacles, before);
});

test("actual Amsterdam scenery retains every shape in sparse bounded cells and bounds SAP pair work", (t) => {
  const terrain = createAmsterdamCourse(), obstacles = [];
  const city = createAmsterdamWorld({ scene: new THREE.Scene(), terrain, obstacles, tablet: true });
  t.after(() => city.dispose());
  const before = structuredClone(obstacles);
  const rails = obstacles.filter(o => o.kind === "quay-railing" || o.kind === "bridge-rail");
  assert.ok(rails.length > 2500, "exercise the dense curved rail layout, not a reduced fixture");
  const cells = new Set(rails.map(o => `${Math.floor(o.x / 32)}/${Math.floor(o.z / 32)}`));
  const world = new CANNON.World();
  world.broadphase = new CANNON.SAPBroadphase(world);
  addSceneryBodies(world, obstacles, terrain, 2);
  assertSceneryMatches(world.bodies, obstacles, terrain, 2);
  assert.deepEqual(obstacles, before);
  const nonrailCount = obstacles.length - rails.length;
  assert.equal(world.bodies.length, nonrailCount + cells.size);
  assert.ok(world.bodies.length <= 500);
  assert.ok(cells.size <= 180);
  // Nonrails are added individually first; rail cells are added when complete.
  for (const body of world.bodies.slice(nonrailCount)) {
    assert.ok(body.shapes.length > 0 && body.shapes.length <= 40);
    body.updateAABB();
    assert.ok(body.aabb.upperBound.x - body.aabb.lowerBound.x <= 36);
    assert.ok(body.aabb.upperBound.z - body.aabb.lowerBound.z <= 36);
    assert.ok(body.boundingRadius < 26, "bounds must be local, not centred at the world origin");
    for (const offset of body.shapeOffsets) {
      assert.ok(offset.x >= -16 && offset.x < 16);
      assert.ok(offset.z >= -16 && offset.z < 16);
    }
  }
  let scans = 0;
  const needCollision = world.broadphase.needBroadphaseCollision;
  t.mock.method(world.broadphase, "needBroadphaseCollision", function (a, b) {
    scans++;
    return needCollision.call(this, a, b);
  });
  const a = [], b = [];
  world.broadphase.collisionPairs(world, a, b);
  assert.equal(a.length, 0);
  assert.equal(b.length, 0);
  assert.equal(scans, world.bodies.length * (world.bodies.length - 1) / 2,
    "Cannon still scans filtered static pairs; reducing bodies fixes the quadratic cost");
  assert.ok(scans < 125000);
  assert.ok(scans < obstacles.length * (obstacles.length - 1) / 2 / 30);
});

test("all three fields use the same scenery grouping with their own filters and shape ownership", (t) => {
  const bodies = [], addBody = CANNON.World.prototype.addBody;
  t.mock.method(CANNON.World.prototype, "addBody", function (body) {
    if (body.collisionFilterGroup === 8) bodies.push(body);
    return addBody.call(this, body);
  });
  const terrain = { halfSize: 100, heightAt: (x, z) => -12 + x * 0.04 + z * 0.02 };
  const route = Array.from({ length: 240 }, (_, i) => new THREE.Vector3(i / 8 - 15, 0, 0));
  const obstacles = Object.freeze([
    { x: 40, z: 40, hx: 0.2, hz: 2, kind: "quay-railing" },
    { x: 44, z: 40, r: 0.3, y: 0, kind: "bridge-rail" },
    { x: 42, z: 44, hx: 2, hz: 3, y: 18 },
  ].map(Object.freeze));
  const expected = new CANNON.World();
  addSceneryBodies(expected, obstacles, terrain, 2);
  const layout = list => list.map(body => [body.position.toArray(), body.shapeOffsets.map(offset => offset.toArray())]);
  const shapes = new Set(expected.bodies.flatMap(body => body.shapes));
  for (const [create, mask] of [[createConeField, 2], [createPlaythings, 3], [createPeopleField, 3 | 16]]) {
    bodies.length = 0;
    create({ scene: new THREE.Scene(), route, obstacles, terrain, onChange() {},
      roadDist: () => 99, count: 1, kinds: { ball: { count: 1 } } });
    assertSceneryMatches(bodies, obstacles, terrain, mask);
    assert.deepEqual(layout(bodies), layout(expected.bodies));
    for (const body of bodies) for (const shape of body.shapes) {
      assert.ok(!shapes.has(shape));
      shapes.add(shape);
    }
  }
});

test("real balls, blocks and tires contact compound rail boxes/cylinders but pass through gaps", (t) => {
  const bodies = [], addBody = CANNON.World.prototype.addBody;
  t.mock.method(CANNON.World.prototype, "addBody", function (body) {
    bodies.push(body);
    return addBody.call(this, body);
  });
  const obstacles = [
    { x: 40, z: 36, hx: 0.2, hz: 1.5, kind: "quay-railing" },
    { x: 40, z: 42, r: 0.6, kind: "bridge-rail" },
    { x: 40, z: 52, hx: 0.2, hz: 1.5, kind: "quay-railing" },
  ];
  const field = createPlaythings({ scene: new THREE.Scene(), gravity: 0, obstacles, roadDist: () => 99,
    route: Array.from({ length: 240 }, (_, i) => new THREE.Vector3(i / 8 - 15, 0, 0)),
    kinds: Object.fromEntries(["ball", "block", "tire"].map(kind => [kind, { count: 1, sizeRange: [0.5, 0.5] }])) });
  assert.equal(field.state().count, 3);
  const rail = bodies.find(body => body.collisionFilterGroup === 8);
  assert.equal(rail.shapes.length, 3);
  assert.ok(rail.shapeOffsets.every(offset => offset.length() > 1));
  const toys = bodies.filter(body => body.mass > 0), world = rail.world;
  for (const toy of toys) for (const z of [36, 42, 47]) {
    for (const [i, body] of toys.entries()) {
      body.position.set(-100 - i * 5, 1.5, -100);
      body.velocity.setZero(); body.angularVelocity.setZero();
      body.quaternion.set(0, 0, 0, 1);
      body.aabbNeedsUpdate = true; body.sleep();
    }
    toy.position.set(37, 1.5, z);
    toy.velocity.set(6, 0, 0); toy.linearDamping = 0;
    toy.wakeUp(); world.broadphase.dirty = true;
    const touched = new Set();
    for (let frame = 0; frame < 120; frame++) {
      world.step(1 / 120);
      for (const contact of world.contacts) {
        if ((contact.bi === toy && contact.bj === rail) || (contact.bj === toy && contact.bi === rail)) {
          for (const shape of [contact.si, contact.sj]) if (rail.shapes.includes(shape)) touched.add(shape);
        }
      }
    }
    if (z === 47) {
      assert.equal(touched.size, 0, "a compound's enclosing bounds are not solid geometry");
      assert.ok(toy.position.x > 42, "the original gap stays traversable");
    } else {
      assert.ok(touched.has(rail.shapes[z === 36 ? 0 : 1]), "narrowphase contacts the original constituent shape");
      assert.ok(toy.position.x < 40, "the real toy cannot pass through the rail");
      assert.ok(toy.velocity.x < 0.2, "the contact solver stops or rebounds the toy");
    }
  }
});

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
