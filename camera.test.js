import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCameraClearance } from "./camera.js";
import { createArchitecture } from "./architecture.js";

const anchor = new THREE.Vector3(0, 1.7, 0);

test("unobstructed outdoor chase, overhead, and hood positions are unchanged", () => {
  const clear = createCameraClearance([]);
  for (const desired of [new THREE.Vector3(0, 3.6, -9), new THREE.Vector3(0, 25, -6), new THREE.Vector3(0, 1.95, 1)]) {
    const position = desired.clone();
    assert.equal(clear(anchor, position), position);
    assert.ok(position.distanceTo(desired) < 1e-12);
  }
  assert.deepEqual(clear(anchor, anchor.clone()), anchor);
});

test("camera stays inside a single-sided dome without changing its rendering material", () => {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial());
  dome.position.set(-38, 0, 65);
  const clear = createCameraClearance([dome]);
  const inside = anchor.clone().add(dome.position);
  for (const offset of [new THREE.Vector3(0, 3.6, -9), new THREE.Vector3(0, 25, -6)]) {
    const position = offset.add(dome.position);
    clear(inside, position);
    assert.ok(position.distanceTo(dome.position) < 4.8);
    assert.ok(position.distanceTo(inside) > 1);
  }
  assert.equal(dome.material.side, THREE.FrontSide);
});

test("overhead view drops below low roofs, including when directly above the car", () => {
  const roof = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 30));
  roof.position.y = 3;
  const clear = createCameraClearance([roof]);
  for (const z of [-6, 0]) {
    const position = new THREE.Vector3(0, 25, z);
    clear(anchor, position);
    assert.ok(position.y < 2.6);
    assert.ok(position.y >= anchor.y);
  }
});

test("corner probes keep nearby geometry off the edge of the camera", () => {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4, 0.2));
  wall.position.set(0.3, 2, -4);
  const clear = createCameraClearance([wall]);
  const position = new THREE.Vector3(0, 1.7, -9);
  clear(anchor, position);
  assert.ok(position.z > -3.6);
});

test("post-smoothing clearance snaps out of walls and recovers smoothly outdoors", () => {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 0.2));
  wall.position.set(0, 3, -4);
  const clear = createCameraClearance([wall]);
  const position = new THREE.Vector3(0, 3.6, -9);
  const desired = position.clone();
  for (let i = 0; i < 60; i++) {
    position.lerp(desired, 1 - Math.exp(-5 / 60));
    clear(anchor, position);
    assert.ok(position.z > -3.6);
  }
  const outdoorAnchor = anchor.clone().setX(20);
  position.x = desired.x = 20;
  const before = position.clone();
  position.lerp(desired, 1 - Math.exp(-5 / 60));
  clear(outdoorAnchor, position);
  assert.ok(position.distanceTo(desired) < before.distanceTo(desired));
  assert.ok(position.distanceTo(desired) > 1);
});

test("transformed instanced structures block the camera, hidden meshes do not", () => {
  const group = new THREE.Group();
  group.position.z = -4;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(8, 6, 0.2), new THREE.MeshBasicMaterial(), 1);
  walls.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 3, 0));
  group.add(walls);
  const position = new THREE.Vector3(0, 1.7, -9);
  createCameraClearance([group])(anchor, position);
  assert.ok(position.z > -3.6);
  group.visible = false;
  position.z = -9;
  createCameraClearance([group])(anchor, position);
  assert.equal(position.z, -9);
});

test("nearby walls are detected from inside a large scenery batch's bounds", () => {
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(8, 6, 0.2), new THREE.MeshBasicMaterial(), 3);
  [-4, -30, 30].forEach((z, i) => walls.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, 3, z)));
  const position = new THREE.Vector3(0, 1.7, -9);
  createCameraClearance([walls])(anchor, position);
  assert.ok(position.z > -3.6);
});

test("the production spectator canopy keeps the overhead camera beneath its merged roof", () => {
  for (const tablet of [false, true]) {
    const scene = new THREE.Scene();
    const { group } = createArchitecture({ scene, level: "stunt", obstacles: [], buildingInfo: [], tablet });
    const inside = new THREE.Vector3(0, 4, 60);
    const position = new THREE.Vector3(0, 25, 54);
    createCameraClearance([group])(inside, position);
    assert.ok(position.y > inside.y);
    assert.ok(position.y < 10);
    const materials = new Set();
    group.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.dispose();
      materials.add(object.material);
    });
    materials.forEach((material) => material.dispose());
  }
});
