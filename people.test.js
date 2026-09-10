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
  const { field } = makeField(6);
  const car = new THREE.Vector3(0, 0, 0);
  for (let s = 0; s < 12; s += 2) {
    step(field, car, 0, 0, 2, s * 120);
    const st = field.state();
    assert.ok(st.positions.every((p) => p.every(Number.isFinite)));
  }
  assert.ok(field.state().walking > 0, "still some walkers after a while");
});

test("a fast car knocks people into ragdoll tumble, then they get back up", () => {
  const { field } = makeField(4);
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
  step(field, car, 0, 0, 8);
  const recovered = field.state();
  assert.ok(recovered.walking > 0, "at least one pedestrian got back up");
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
});