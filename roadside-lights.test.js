import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCourse } from "./course.js";
import { createCourseDetails } from "./course-details.js";
import { createRoadsideLights } from "./roadside-lights.js";
import { createNightLighting } from "./night-lights.js";
import { enableGeometryShadows } from "./daylight.js";
import { inClearing } from "./landmarks.js";
import { moveWithBounces } from "./collision.js";

function dispose(scene) {
  const resources = new Set();
  scene.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    if (object.material) { resources.add(object.material); if (object.material.map) resources.add(object.material.map); }
  });
  for (const resource of resources) resource.dispose();
}

for (const level of ["forest", "city", "stunt", "moon", "amsterdam", "wellington"]) {
  test(`${level}: grounded, instanced roadside hardware leaves roads and water clear`, () => {
    const course = createCourse(level), scene = new THREE.Scene(), obstacles = [];
    const { group, counts } = createRoadsideLights({ scene, course, level, obstacles });
    assert.ok(counts.studs > 50 && counts.guides > 20 && counts.lanterns > 0, JSON.stringify(counts));
    assert.ok(counts.meshes <= 7);
    assert.equal(group.parent, scene);
    assert.equal(group.userData.nightLights.length, counts.lanterns);
    assert.deepEqual(obstacles, [], "studs, guide posts and lanterns are all non-colliding scenery");
    enableGeometryShadows(group);
    let triangles = 0;
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    for (const mesh of group.children) {
      assert.ok(mesh.isInstancedMesh && mesh.receiveShadow);
      triangles += mesh.count * mesh.geometry.index.count / 3;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        assert.ok(matrix.elements.every(Number.isFinite));
        position.setFromMatrixPosition(matrix);
        assert.ok(position.y >= course.heightAt(position.x, position.z) - 0.02);
        if (mesh.name.endsWith("/post") || mesh.name.endsWith("/timber")) {
          assert.ok(course.roadDistance(position.x, position.z) > 7.1);
          assert.ok(!course.isSafePosition || course.isSafePosition(position.x, position.z, 0.18));
          const drive = moveWithBounces({ x: position.x - 2, z: position.z }, { x: 5, z: 0 }, 0.8,
            obstacles, course.halfSize);
          assert.equal(drive.hits, 0);
          assert.ok(Math.abs(drive.x - position.x - 2) < 1e-7, "the car can pass straight through the post");
          assert.equal(drive.vx, 5, "no speed penalty at a light");
        }
      }
      if (mesh.material.userData.nightIntensity) {
        assert.equal(mesh.material.emissiveIntensity, 0);
        assert.equal(mesh.castShadow, false, "lenses never become opaque shadow blockers");
      }
    }
    assert.ok(triangles < 75000, `${triangles} triangles`);
    assert.equal(scene.children.filter(object => object.isLight).length, 0);
    dispose(scene);
  });
}

test("placement is deterministic and respects scenery, access clearings, crossings and existing lamps", () => {
  const course = createCourse("forest"), first = new THREE.Scene();
  const baseline = createRoadsideLights({ scene: first, course, level: "forest" });
  const scene = new THREE.Scene(), nearby = new THREE.Group();
  scene.add(nearby);
  const anchor = baseline.group.userData.nightLights[0];
  nearby.position.fromArray(anchor.position);
  nearby.userData.nightLights = [{ position: [0, 0, 0], intensity: 100, distance: 28 }];
  const obstacles = [{ x: 0, y: 0, z: 340, hx: 22, hz: 22, r: 32, height: 8 }];
  const original = structuredClone(obstacles);
  const clearings = [{ x: 170, z: 380, end: { x: 170, z: 280 }, radius: 8 }];
  const world = createRoadsideLights({ scene, course, level: "forest", obstacles, clearings });
  assert.deepEqual(obstacles, original, "no colliders added and existing colliders remain untouched");
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  for (const mesh of world.group.children.filter(mesh => /\/(post|timber)$/.test(mesh.name))) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
      assert.equal(inClearing(clearings, position.x, position.z, 0.18), false);
      assert.ok(Math.abs(position.x) > 22 || Math.abs(position.z - 340) > 22);
    }
  }
  for (const light of world.group.userData.nightLights) {
    assert.ok(Math.hypot(light.position[0] - anchor.position[0], light.position[2] - anchor.position[2]) >= 40);
  }
  const again = new THREE.Scene();
  const repeat = createRoadsideLights({ scene: again, course, level: "forest" });
  assert.deepEqual(repeat.counts, baseline.counts);
  assert.deepEqual(repeat.group.userData.nightLights, baseline.group.userData.nightLights);
  const blockedScene = new THREE.Scene();
  const blocked = createRoadsideLights({ scene: blockedScene, course: { ...course, isSafePosition: () => false }, level: "forest" });
  assert.deepEqual(blocked.counts, { studs: 0, guides: 0, lanterns: 0, meshes: 0 });
  for (const root of [first, scene, again, blockedScene]) dispose(root);
});

for (const tablet of [false, true]) test(`${tablet ? "tablet" : "desktop"}: lanterns illuminate the road without self-shadowing or increasing the light budget`, () => {
  const scene = new THREE.Scene(), course = createCourse("forest"), car = new THREE.Group();
  const { group } = createRoadsideLights({ scene, course, level: "forest" });
  scene.add(car);
  enableGeometryShadows(group);
  scene.updateMatrixWorld(true);
  const casters = group.children.filter(mesh => mesh.castShadow);
  const lights = createNightLighting({ scene, tablet });
  const versions = group.children.map(mesh => mesh.material.version);
  for (const anchor of group.userData.nightLights) {
    const position = new THREE.Vector3().fromArray(anchor.position);
    const hit = course.nearest(position.x, position.z), p = course.route[hit.index];
    const target = p.clone(); target.y += 0.075;
    const distance = position.distanceTo(target), direction = target.clone().sub(position).normalize();
    assert.ok(distance < anchor.distance);
    assert.ok(direction.dot(new THREE.Vector3(0, -1, 0)) > Math.cos(Math.PI * 0.42), "road falls inside the lamp cone");
    const ray = new THREE.Raycaster(position, direction, 0.1, distance - 0.05);
    assert.equal(ray.intersectObjects(casters, false).length, 0, "shade and mast leave the road beam unobstructed");
  }
  car.position.fromArray(group.userData.nightLights[0].position);
  car.position.y = course.heightAt(car.position.x, car.position.z);
  for (const night of [0, 0.5, 1, 0]) {
    lights.update({ car, night, snap: true, dt: 0 });
    for (const mesh of group.children) {
      if (mesh.material.userData.nightIntensity) {
        assert.equal(mesh.material.emissiveIntensity, mesh.material.userData.nightIntensity * night);
      } else assert.equal(mesh.material.emissiveIntensity, 1, "reflector PBR keeps its authored default");
    }
    assert.equal(lights.state().shadowedLights, tablet ? 4 : 6);
    assert.equal(lights.state().activeStreetlights > 0, night > 0);
    assert.deepEqual(group.children.map(mesh => mesh.material.version), versions);
  }
  lights.dispose(); dispose(scene);
});

test("chevron textures use the shadow-receiving reflective finish without self emission", t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  }) }) };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const scene = new THREE.Scene();
  const signs = createCourseDetails({ scene, course: createCourse("forest"), obstacles: [] });
  const boards = signs.children.filter(mesh => mesh.material.map);
  assert.ok(boards.length > 0);
  for (const mesh of boards) {
    assert.equal(mesh.receiveShadow, true);
    assert.match(mesh.material.customProgramCacheKey(), /retroreflective/);
    assert.equal(mesh.material.emissive.getHex(), 0);
    assert.equal(mesh.material.userData.nightIntensity, undefined);
  }
  dispose(scene);
});
