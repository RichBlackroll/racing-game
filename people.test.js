import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { createPeopleField } from "./people.js";
import { createAmsterdamCourse } from "./amsterdam-course.js";

function makeField(count = 6, terrain = null) {
  const scene = new THREE.Scene();
  const route = Array.from({ length: 240 }, (_, i) => {
    const t = (i / 240) * Math.PI * 2;
    return new THREE.Vector3(Math.sin(t) * 80, 0.025, Math.cos(t) * 100);
  });
  const field = createPeopleField({
    scene,
    route,
    obstacles: [],
    roadDist: () => 99, // open field: everything is far from the road
    gravity: 9.82,
    count,
    terrain,
    onChange() {},
  });
  return { field, route, scene };
}

function step(field, car, heading, speed, seconds, t0 = 0) {
  const dt = 1 / 120;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    car.x += Math.sin(heading) * speed * dt;
    car.z += Math.cos(heading) * speed * dt;
    field.update(dt, { position: car, heading }, speed, t0 + i * dt);
  }
}

test("pedestrian contacts and the Cannon proxy follow vehicle footprint and height", (t) => {
  let proxy;
  const addBody = CANNON.World.prototype.addBody;
  t.mock.method(CANNON.World.prototype, "addBody", function (body) {
    addBody.call(this, body);
    if (body.collisionFilterGroup === 4) proxy = body;
  });
  const { field } = makeField(1), [x, , z] = field.state().positions[0];
  const position = new THREE.Vector3(x, 0, z - 2.8);
  for (const size of [undefined, [1.7, 1.45, 2.7], [1.6, 1.35, 2.85], undefined]) {
    field.setVehicleSize(size);
    const expected = size ?? [1.05, .55, 2.2], shape = proxy.shapes[0];
    assert.deepEqual(shape.halfExtents.toArray(), expected);
    assert.equal(proxy.shapes.length, 1);
    assert.ok(Math.abs(proxy.boundingRadius - Math.hypot(...expected)) < 1e-9);
    field.setVehicleSize(size); assert.equal(proxy.shapes[0], shape);
    for (const y of [0, -2, 5]) {
      position.y = y; field.reset(position);
      assert.ok(Math.abs(proxy.position.y - y - (.7 + expected[1] - .55)) < 1e-9);
      field.update(1 / 120, { position, heading: 0 }, 3, 0);
      assert.equal(field.state().hits, size && y !== 5 ? 1 : 0, "larger vehicles reach farther and higher, but never hit people below their base");
      assert.equal(proxy.velocity.lengthSquared(), 0);
    }
  }
  assert.throws(() => field.setVehicleSize([1, -1, 2]), RangeError);
});

test("people spawn standing with finite poses and shared instanced draw calls", () => {
  const { field, scene } = makeField(6);
  assert.equal(field.state().count, 6);
  assert.equal(field.state().walking, 6);
  assert.equal(scene.children.filter((m) => m.isInstancedMesh).length > 0, true);
  for (const p of field.state().positions) {
    assert.ok(p.every(Number.isFinite));
    assert.ok(p[1] > 0, "pelvis above ground");
  }
  assert.equal(field.state().hits, 0);
});

test("people walk around on their own and never explode into NaN", () => {
  const { field, scene } = makeField(6);
  const car = new THREE.Vector3(0, 0, 0);
  const origin = field.state().positions[0];
  const head = scene.getObjectByName("pedestrians/head");
  const matrix = new THREE.Matrix4();
  for (let s = 0; s < 12; s += 2) {
    step(field, car, 0, 0, 2, s);
    const st = field.state();
    assert.ok(st.positions.every((p) => p.every(Number.isFinite)));
    head.getMatrixAt(0, matrix);
    const pelvis = st.positions[0];
    assert.ok(Math.hypot(matrix.elements[12] - pelvis[0], matrix.elements[14] - pelvis[2]) < 0.3, "head follows the walking pelvis");
  }
  assert.ok(Math.hypot(field.state().positions[0][0] - origin[0], field.state().positions[0][2] - origin[2]) > 1);
  assert.ok(field.state().walking > 0, "still some walkers after a while");
});

test("pedestrian batches draw only allocated slots through walking, ragdolls, and reset", () => {
  const { field, scene } = makeField(14);
  const car = new THREE.Vector3(300, 0, 300);
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const batches = scene.children.filter((mesh) => mesh.isInstancedMesh).map((mesh) => {
    const visibleSlots = [];
    for (let i = 0; i < mesh.instanceMatrix.count; i++) {
      mesh.getMatrixAt(i, matrix);
      if (matrix.elements[13] > -10) visibleSlots.push(i);
    }
    // Both leg variants have allocated slots, but only the worn variant is shown.
    const allocated = mesh.name === "pedestrians/skinLimbs" ? 8 * field.state().count
      : mesh.name === "pedestrians/pantsLimbs" ? 4 * field.state().count : visibleSlots.length;
    const capacity = mesh.name.endsWith("Limbs") ? 140
      : ["pedestrians/hands", "pedestrians/feet", "pedestrians/eyes"].includes(mesh.name) ? 28 : 14;
    return { mesh, allocated, capacity, visibleSlots, attribute: mesh.instanceMatrix,
      matrices: mesh.instanceMatrix.array, colors: mesh.instanceColor?.array };
  });
  assert.ok(batches.some(({ allocated, capacity }) => allocated < capacity), "exercise spare buffer capacity");
  function checkMeshes() {
    let visible = 0;
    for (const { mesh, allocated, capacity, visibleSlots, attribute, matrices, colors } of batches) {
      assert.equal(mesh.count, allocated, `${mesh.name}: draw only allocated slots`);
      assert.equal(mesh.instanceMatrix.count, capacity, `${mesh.name}: retain buffer capacity`);
      assert.equal(mesh.instanceMatrix, attribute);
      assert.equal(mesh.instanceMatrix.array, matrices);
      assert.equal(mesh.instanceColor?.array, colors);
      assert.ok(mesh.geometry.attributes.position.count > 0);
      assert.ok(mesh.instanceMatrix.array.every(Number.isFinite), "all mesh transforms must be finite");
      const currentSlots = [];
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        point.setFromMatrixPosition(matrix);
        if (point.y < -10) continue; // hidden, allocated leg variants
        currentSlots.push(i);
        visible++;
        assert.ok(Math.abs(matrix.determinant()) < 0.15, "no unused identity-matrix bodies at the origin");
      }
      assert.deepEqual(currentSlots, visibleSlots, `${mesh.name}: visible slot indices stay stable`);
    }
    assert.ok(visible >= field.state().count * 17, "each pedestrian has a complete visible body");
  }
  checkMeshes();
  for (let i = 0; i < 120; i++) {
    field.update(1 / 60, { position: car, heading: 0 }, 0, i / 60);
    checkMeshes();
  }
  const [x, , z] = field.state().positions[0];
  car.set(x, 0, z);
  field.update(1 / 120, { position: car, heading: Math.PI / 2 }, 20, 2);
  assert.ok(field.state().tumbling > 0, "exercise ragdoll transforms after walking");
  checkMeshes();
  car.set(300, 0, 300);
  for (let i = 0; i < 120; i++) {
    field.update(1 / 120, { position: car, heading: 0 }, 0, 2 + i / 120);
    checkMeshes();
  }
  field.reset(car, 0);
  checkMeshes();
});

test("a fast car knocks people into ragdoll tumble, then they get back up", () => {
  const { field, scene } = makeField(1);
  const start = field.state().positions[0];
  const car = new THREE.Vector3(start[0] - 6, 0, start[2]);
  // Sprint straight through the first pedestrian.
  step(field, car, 0, 0, 0.2);
  const heading = Math.atan2(start[0] - car.x, start[2] - car.z);
  step(field, car, heading, 22, 0.7);
  const hit = field.state();
  assert.ok(hit.hits > 0, "car hit the pedestrian");
  assert.ok(hit.tumbling + hit.down > 0, "people tumble after being hit");
  // Move the car away so they can recover.
  car.set(start[0] - 12, 0, start[2]);
  for (let i = 0; i < 16; i++) {
    step(field, car, 0, 0, 1, i + 1);
    for (const mesh of scene.children) {
      assert.ok(mesh.instanceMatrix.array.every(Number.isFinite), "impact/recovery keeps all body meshes visible");
    }
  }
  const recovered = field.state();
  assert.equal(recovered.walking, 1, "the struck pedestrian got back up, not an untouched bystander");
  assert.ok(recovered.positions.every((p) => p.every(Number.isFinite)));
});

test("reset restores everyone to standing at their origin", () => {
  const { field } = makeField(5);
  const before = field.state().positions;
  const car = new THREE.Vector3(before[0][0] - 5, 0, before[0][2]);
  const heading = Math.atan2(before[0][0] - car.x, before[0][2] - car.z);
  step(field, car, heading, 20, 0.6);
  assert.ok(field.state().hits > 0);
  field.reset(new THREE.Vector3(), 0);
  const st = field.state();
  assert.equal(st.hits, 0);
  assert.equal(st.walking, 5);
  assert.equal(st.tumbling + st.down + st.rising, 0);
  for (const p of st.positions) assert.ok(p.every(Number.isFinite));
  assert.deepEqual(st.positions, before);
});

for (const height of [-20, 20]) {
  test(`walking hips and shoe soles follow local slopes at elevation ${height}`, () => {
    const terrain = { halfSize: 200, heightAt: (x, z) => height + 0.16 * x + 0.08 * z };
    const { field, scene } = makeField(3, terrain);
    const origin = field.state().positions;
    const feet = scene.getObjectByName("pedestrians/feet");
    const matrix = new THREE.Matrix4(), corner = new THREE.Vector3();
    const car = { position: new THREE.Vector3(-180, height, -180), heading: 0 };
    function checkPose() {
      for (const [x, y, z] of field.state().positions) {
        const hips = y - terrain.heightAt(x, z);
        assert.ok(hips > 0.9 && hips < 1.5, `local hip height ${hips}`);
      }
      for (let i = 0; i < feet.count; i++) {
        feet.getMatrixAt(i, matrix);
        for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
          corner.set(x, y, z).applyMatrix4(matrix);
          assert.ok(corner.y >= terrain.heightAt(corner.x, corner.z) + 0.075 - 1e-5, "the uphill shoe does not cut through the ground");
        }
      }
    }
    checkPose();
    for (let i = 0; i < 240; i++) {
      field.update(1 / 60, car, 0, i / 60);
      checkPose();
    }
    assert.ok(Math.hypot(field.state().positions[0][0] - origin[0][0], field.state().positions[0][2] - origin[0][2]) > 2);
    field.reset(car.position);
    assert.deepEqual(field.state().positions, origin);
    checkPose();
  });

  test(`ragdolls contact sloped terrain and recover at local height ${height}`, () => {
    const terrain = { halfSize: 200, heightAt: (x, z) => height + 0.06 * x + 0.03 * z };
    const { field, scene } = makeField(1, terrain);
    const origin = field.state().positions;
    const [x, , z] = origin[0];
    const car = { position: new THREE.Vector3(x, terrain.heightAt(x, z), z), heading: Math.PI / 2 };
    field.update(1 / 120, car, 20, 0);
    assert.equal(field.state().hits, 1);
    assert.equal(field.state().tumbling, 1);
    car.position.set(-150, terrain.heightAt(-150, -150), -150);
    let grounded = false, rising = false;
    for (let i = 0; i < 2400; i++) {
      field.update(1 / 120, car, 0, i / 120);
      const state = field.state(), [px, py, pz] = state.positions[0];
      const clearance = py - terrain.heightAt(px, pz);
      assert.ok(clearance > 0.05, "ragdoll hips cannot fall through the terrain");
      grounded ||= state.down > 0;
      rising ||= state.rising > 0;
      if (i % 60 === 0) for (const mesh of scene.children) assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
    }
    assert.ok(grounded && rising, "ground-relative thresholds allow the full recovery state machine");
    assert.equal(field.state().walking, 1);
    const [px, py, pz] = field.state().positions[0];
    assert.ok(py - terrain.heightAt(px, pz) > 0.9);
    assert.ok(py - terrain.heightAt(px, pz) < 1.5);
    field.reset(car.position);
    assert.deepEqual(field.state().positions, origin);
    assert.equal(field.state().hits, 0);
  });
}

test("an airborne car cannot hit or crush people underneath its XZ footprint", () => {
  const terrain = { halfSize: 200, heightAt: () => -15 };
  const { field } = makeField(1, terrain);
  for (let i = 0; i < 120; i++) {
    const [x, , z] = field.state().positions[0];
    field.update(1 / 120, { position: new THREE.Vector3(x, -7, z), heading: 0 }, 20, i / 120);
  }
  assert.equal(field.state().hits, 0);
  assert.equal(field.state().walking, 1);
  assert.equal(field.state().crushed, 0);
});

test("people spawn and walk on the extended course beyond the old 300 m bounds", () => {
  const terrain = { halfSize: 620, heightAt: (x, z) => 15 + x * 0.01 - z * 0.02 };
  const route = Array.from({ length: 960 }, (_, i) => new THREE.Vector3(400 + i / 8, 0, 0));
  const field = createPeopleField({ scene: new THREE.Scene(), route, terrain, count: 3, roadDist: () => 99 });
  assert.equal(field.state().count, 3);
  const car = new THREE.Vector3();
  step(field, car, 0, 0, 10);
  for (const [x, y, z] of field.state().positions) {
    assert.ok(x > 380 && x < terrain.halfSize);
    assert.ok(Math.abs(z) < terrain.halfSize);
    assert.ok(y > terrain.heightAt(x, z));
  }
});

function makeCanalField(count = 3, obstacles = []) {
  const scene = new THREE.Scene();
  const terrain = {
    halfSize: 120,
    heightAt: (_, z) => z >= 0 && z <= 10 ? -2 : 2.4,
    isSafePosition(x, z, margin = 0) {
      return Number.isFinite(x) && Number.isFinite(z)
        && Math.abs(x) + margin <= this.halfSize && Math.abs(z) + margin <= this.halfSize
        && (z + margin < 0 || z - margin > 10);
    },
  };
  const route = Array.from({ length: 240 }, (_, i) => new THREE.Vector3(i / 4 - 30, 0, -12));
  const field = createPeopleField({ scene, route, terrain, obstacles, count, roadDist: () => 99 });
  return { field, terrain, route, scene };
}

test("opt-in walkers spawn beside long quays and never cross a canal during bounded long walks", () => {
  const obstacles = [{ x: 0, z: -0.5, hx: 300, hz: 0.3 }];
  const { field, terrain, route, scene } = makeCanalField(3, obstacles);
  assert.equal(field.state().count, 3, "a narrow quay must not exclude a 300 m circle");
  const origins = field.state().positions;
  const car = { position: new THREE.Vector3(-110, 2.4, -110), heading: 0 };
  const isSafePosition = terrain.isSafePosition;
  let queries = [];
  terrain.isSafePosition = function (x, z, margin) {
    assert.ok(margin >= 0.45 && margin <= 0.65, "use pedestrian clearance, not a point");
    queries.push([x, z]);
    return isSafePosition.call(this, x, z, margin);
  };
  let moved = false, targetChecked = false;
  for (let i = 0; i < 3600; i++) {
    const before = field.state().positions;
    queries = [];
    const dt = i % 120 === 0 ? 10 : 1 / 60;
    field.update(dt, car, 0, i / 60);
    assert.ok(queries.length <= 45, "target retries per update are bounded");
    targetChecked ||= queries.some(([x, z]) => before.every(p => Math.hypot(x - p[0], z - p[2]) > 1));
    for (const [j, p] of field.state().positions.entries()) {
      assert.ok(p.every(Number.isFinite));
      assert.ok(isSafePosition.call(terrain, p[0], p[2], 0.6));
      assert.ok(p[2] < 0, "a dry target across the canal is not a walkable shortcut");
      assert.ok(p[1] > terrain.heightAt(p[0], p[2]));
      const distance = Math.hypot(p[0] - before[j][0], p[2] - before[j][2]);
      assert.ok(distance <= 2.2 * Math.min(dt, 0.05) + 1e-8, "long frames cannot jump the water");
      moved ||= Math.hypot(p[0] - origins[j][0], p[2] - origins[j][2]) > 5;
    }
  }
  assert.ok(moved && targetChecked, "walkers move and check new destinations, not just their current position");
  field.reset(car.position);
  assert.deepEqual(field.state().positions, origins);
  for (const mesh of scene.children) assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));

  const legacy = createPeopleField({ scene: new THREE.Scene(), route, obstacles, count: 3,
    terrain: { halfSize: terrain.halfSize, heightAt: terrain.heightAt }, roadDist: () => 99 });
  assert.equal(legacy.state().count, 0, "without the API the legacy obstacle radius test is unchanged");
});

test("panic steps stop at a canal edge rather than fleeing into water", () => {
  const { field, terrain } = makeCanalField(1);
  const car = { position: new THREE.Vector3(), heading: 0 };
  let panicked = false, blocked = false;
  for (let i = 0; i < 600; i++) {
    const before = field.state().positions[0];
    car.position.set(before[0], 2.4, before[2] - 8);
    field.update(1 / 120, car, 12, i / 120);
    const state = field.state(), [x, y, z] = state.positions[0];
    assert.ok(terrain.isSafePosition(x, z, 0.6));
    assert.ok(Number.isFinite(y) && y > terrain.heightAt(x, z));
    assert.ok(z < 0);
    panicked ||= state.panicking === 1;
    blocked ||= state.panicking === 1 && Math.hypot(x - before[0], z - before[2]) < 1e-10;
  }
  assert.ok(panicked && blocked, "a panicking pedestrian reaches the bank and blocks the unsafe step");
  assert.equal(field.state().hits, 0, "blocking does not knock or reset the walker");
});

test("a canal-flung ragdoll returns to its own dry origin, then can get up on land and reset", () => {
  const { field, terrain, scene } = makeCanalField(1);
  const origins = field.state().positions;
  const [x, , z] = origins[0];
  const car = { position: new THREE.Vector3(x, 2.4, z), heading: 0 };
  field.update(1 / 120, car, 35, 0);
  assert.equal(field.state().tumbling, 1);
  car.position.set(-110, 2.4, -110);
  for (let i = 0; i < 240 && !field.state().walking; i++) {
    field.update(1 / 120, car, 0, i / 120);
    const [px, py, pz] = field.state().positions[0];
    assert.ok(terrain.isSafePosition(px, pz, 0.6));
    assert.ok(Number.isFinite(py));
    for (const mesh of scene.children) assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
  }
  assert.equal(field.state().walking, 1);
  assert.equal(field.state().hits, 1, "individual recovery does not clear field-wide hits");
  assert.deepEqual(field.state().positions, origins);

  car.position.set(x, 2.4, z);
  car.heading = Math.PI / 2;
  field.update(1 / 120, car, 20, 2);
  assert.equal(field.state().tumbling, 1);
  car.position.set(-110, 2.4, -110);
  let down = false, rising = false;
  for (let i = 0; i < 2400; i++) {
    field.update(1 / 120, car, 0, 2 + i / 120);
    const state = field.state(), [px, py, pz] = state.positions[0];
    assert.ok(terrain.isSafePosition(px, pz, 0.6));
    assert.ok(Number.isFinite(py));
    down ||= state.down === 1;
    rising ||= state.rising === 1;
  }
  assert.ok(down && rising, "safe land still uses the normal get-up sequence");
  assert.equal(field.state().walking, 1);
  field.reset(car.position);
  assert.equal(field.state().hits, 0);
  assert.deepEqual(field.state().positions, origins);
  for (const mesh of scene.children) assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
});

test("unsafe spawn and wandering candidates exhaust bounded attempts without wet fallbacks", () => {
  const { field, terrain, route } = makeCanalField(1);
  const [x, , z] = field.state().positions[0];
  let checks = 0;
  terrain.isSafePosition = (px, pz, margin) => {
    checks++;
    return Math.hypot(px - x, pz - z) + margin < 0.8;
  };
  field.update(1 / 60, { position: new THREE.Vector3(-110, 2.4, -110), heading: 0 }, 0, 0);
  assert.ok(checks >= 12 && checks <= 15);
  assert.equal(field.state().positions[0][0], x);
  assert.equal(field.state().positions[0][2], z);

  checks = 0;
  terrain.isSafePosition = () => { checks++; return false; };
  const scene = new THREE.Scene();
  const empty = createPeopleField({ scene, terrain, route, count: 3, roadDist: () => 99 });
  assert.equal(empty.state().count, 0);
  assert.ok(checks > 0 && checks <= 270);
  empty.reset();
  for (const mesh of scene.children) {
    assert.equal(mesh.count, 0, "failed spawns leave no drawn instances");
    assert.ok(mesh.instanceMatrix.count >= 3, "empty batches retain their allocated buffers");
  }
  assert.deepEqual(empty.state().positions, []);
});

test("the real Amsterdam course supports a populated, dry pedestrian field", () => {
  const terrain = createAmsterdamCourse(), scene = new THREE.Scene();
  const field = createPeopleField({ scene, terrain, route: terrain.route, roadDist: terrain.roadDistance, count: 12 });
  assert.equal(field.state().count, 12);
  const pelvis = scene.getObjectByName("pedestrians/pelvis"), matrix = new THREE.Matrix4();
  const car = { position: new THREE.Vector3(310, 2.4, -310), heading: 0 };
  for (let i = 0; i < 600; i++) {
    field.update(1 / 30, car, 0, i / 30);
    for (let j = 0; j < field.state().count; j++) {
      pelvis.getMatrixAt(j, matrix);
      assert.ok(terrain.isSafePosition(matrix.elements[12], matrix.elements[14], 0.59));
      assert.ok(matrix.elements.every(Number.isFinite));
    }
  }
});
