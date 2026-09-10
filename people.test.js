import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createPeopleField } from "./people.js";

function makeField(count = 6) {
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

test("pedestrian meshes have finite, populated transforms at spawn, while walking, and after reset", () => {
  const { field, scene } = makeField(14);
  const car = new THREE.Vector3(300, 0, 300);
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  function checkMeshes() {
    let visible = 0;
    for (const mesh of scene.children) {
      if (!mesh.isInstancedMesh) continue;
      assert.ok(mesh.geometry.attributes.position.count > 0);
      assert.ok(mesh.instanceMatrix.array.every(Number.isFinite), "all mesh transforms must be finite");
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        point.setFromMatrixPosition(matrix);
        if (point.y < -10) continue; // hidden, unallocated slots
        visible++;
        assert.ok(Math.abs(matrix.determinant()) < 0.15, "no unused identity-matrix bodies at the origin");
      }
    }
    assert.ok(visible >= field.state().count * 17, "each pedestrian has a complete visible body");
  }
  checkMeshes();
  for (let i = 0; i < 120; i++) {
    field.update(1 / 60, { position: car, heading: 0 }, 0, i / 60);
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
