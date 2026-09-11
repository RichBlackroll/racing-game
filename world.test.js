import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { terrainHeight, createLandscape } from "./world.js";
import { stadiumRoute, createLevelScenery } from "./levels.js";
import { createCourse } from "./course.js";

function canvasDocument(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, closePath() {}, fill() {}, ellipse() {},
  }) }) };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
}

function dispose(scene) {
  const geometries = new Set(), materials = new Set();
  scene.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry); materials.add(object.material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => { material.map?.dispose(); material.dispose(); });
  if (scene.background?.isTexture) scene.background.dispose();
}

test("inner scenery heights are the actual course hills, not a flat driving square", () => {
  for (const level of ["forest", "city", "stunt", "moon"]) {
    const course = createCourse(level), boundary = course.halfSize + 20;
    for (let x = -boundary; x <= boundary; x += 40) for (let z = -boundary; z <= boundary; z += 40) {
      assert.equal(terrainHeight(x, z, level, course), course.heightAt(x, z));
    }
    const elevations = course.route.map(p => terrainHeight(p.x, p.z, level, course));
    assert.ok(Math.max(...elevations) - Math.min(...elevations) > (level === "forest" ? 60 : 1));
    for (const p of course.route) assert.equal(terrainHeight(p.x, p.z, level, course), course.heightAt(p.x, p.z));
    for (let x = -1100; x <= 1100; x += 25) for (let z = -1100; z <= 1100; z += 25) {
      assert.ok(Number.isFinite(terrainHeight(x, z, level, course)));
    }
    for (const sign of [-1, 1]) for (let along = -boundary; along <= boundary; along += 40) {
      for (const [x, z, dx, dz] of [[sign * boundary, along, sign, 0], [along, sign * boundary, 0, sign]]) {
        const y = terrainHeight(x, z, level, course);
        assert.equal(y, course.heightAt(x, z));
        assert.ok(Math.abs(terrainHeight(x + dx * .001, z + dz * .001, level, course) - y) < .001);
      }
    }
    assert.ok(terrainHeight(-boundary - 250, 100, level, course) > 20);
    const coast = terrainHeight(boundary + 260, -120, level, course);
    assert.ok(level === "moon" ? coast > 0 : coast < -1);
    assert.equal(terrainHeight(0, 0, level), 0, "standalone scenery defaults to zero ground");
  }
});

test("mountain triangles and sea stay wholly outside the course ground and share its boundary height", (t) => {
  canvasDocument(t);
  for (const level of ["forest", "city", "stunt", "moon"]) {
    const terrain = createCourse(level), boundary = terrain.halfSize + 20;
    const scene = new THREE.Scene();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * boundary, 2 * boundary), new THREE.MeshStandardMaterial());
    scene.add(ground);
    const landscape = createLandscape({ scene, ground, level, terrain, route: terrain.route,
      roadDist: () => 0, obstacles: [], treeInfo: [], buildingInfo: [], tablet: true });
    const geometry = landscape.group.getObjectByName("landscape/continuous-mountain-relief").geometry;
    const positions = geometry.attributes.position, index = geometry.index;
    let edgeVertices = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      assert.ok(Math.max(Math.abs(x), Math.abs(z)) >= boundary);
      assert.ok(geometry.attributes.normal.getY(i) > 0);
      if (Math.max(Math.abs(x), Math.abs(z)) === boundary) {
        assert.ok(Math.abs(y - terrain.heightAt(x, z)) < .0001);
        edgeVertices++;
      }
    }
    assert.ok(edgeVertices > 300);
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      assert.ok(["X", "Z"].some(axis => [-1, 1].some(sign =>
        ids.every(id => positions[`get${axis}`](id) * sign >= boundary))), "triangle has an entirely exterior half-plane");
    }
    const water = landscape.group.getObjectByName("landscape/distant-tidal-water");
    if (level === "moon") assert.equal(water, undefined);
    else assert.ok(new THREE.Box3().setFromObject(water).min.x > boundary);
    dispose(scene);
  }
});

test("stunt landscaping keeps ramps, roads and the pavilion footprint clear", () => {
  const scene = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(580, 580), new THREE.MeshStandardMaterial());
  const route = Array.from({ length: 240 }, () => new THREE.Vector3());
  stadiumRoute(route);
  const roadDist = (x, z) => Math.sqrt(Math.min(...route.map(p => (x - p.x) ** 2 + (z - p.z) ** 2)));
  const obstacles = [], treeInfo = [], buildingInfo = [{ x: 0, z: 60, w: 36, d: 12 }];
  const landscape = createLandscape({ scene, ground, level: "stunt", route, roadDist, obstacles, treeInfo, buildingInfo, tablet: true });
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  let meshes = 0, instances = 0;
  landscape.group.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));
    if (!object.isInstancedMesh) return;
    assert.ok(object.frustumCulled);
    assert.ok(object.instanceMatrix.array.every(Number.isFinite));
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix);
      assert.ok(roadDist(point.x, point.z) >= 6.89);
      assert.ok(Math.abs(point.x) >= 19.19 || Math.abs(point.z - 60) >= 7.19);
      instances++;
    }
  });
  assert.ok(instances > 3000);
  assert.ok(meshes < 80);
  assert.deepEqual(obstacles, []);
  assert.deepEqual(treeInfo, []);
  landscape.animate(2.5);
  dispose(scene);
});

test("conifer branches spread around their trunk and keep buildings and roads clear", (t) => {
  // Canvas painting is exercised by browser checks; geometry needs only its surface.
  canvasDocument(t);
  const scene = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(580, 580), new THREE.MeshStandardMaterial());
  const route = Array.from({ length: 240 }, (_, i) => {
    const a = i / 240 * Math.PI * 2;
    return new THREE.Vector3(Math.sin(a) * (80 + 12 * Math.sin(a * 3)), 0, Math.cos(a) * 100);
  });
  const roadDist = (x, z) => Math.sqrt(Math.min(...route.map(p => (x - p.x) ** 2 + (z - p.z) ** 2)));
  const obstacles = [], treeInfo = [], buildingInfo = [{ x: -30, z: 68, w: 16, d: 8 }];
  const landscape = createLandscape({ scene, ground, level: "forest", roadDist, route, obstacles, treeInfo, buildingInfo, tablet: true });
  assert.ok(treeInfo.length > 300);
  for (const tree of treeInfo) {
    assert.equal(tree.y, 0);
    assert.ok(roadDist(tree.x, tree.z) >= 10);
    assert.ok(Math.abs(tree.x + 30) >= 14 || Math.abs(tree.z - 68) >= 10);
  }
  const foliage = landscape.group.children.find(m => m.name.includes("/needles/"));
  const matrix = new THREE.Matrix4(), base = new THREE.Vector3(), tip = new THREE.Vector3();
  const offsets = [];
  for (let i = 0; i < 6; i++) {
    foliage.getMatrixAt(i, matrix);
    base.setFromMatrixPosition(matrix);
    tip.set(0, 1, 0).applyMatrix4(matrix).sub(base);
    offsets.push(tip.clone());
  }
  for (const axis of ["x", "z"]) {
    assert.ok(Math.min(...offsets.map(p => p[axis])) < -.5, axis + " negative branches");
    assert.ok(Math.max(...offsets.map(p => p[axis])) > .5, axis + " positive branches");
  }
  dispose(scene);
});

for (const tablet of [false, true]) {
  test(`forest ${tablet ? "tablet" : "desktop"}: bounded vegetation follows the entire elevated course`, (t) => {
    canvasDocument(t);
    const terrain = createCourse("forest"), scene = new THREE.Scene();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1280, 1280), new THREE.MeshStandardMaterial());
    scene.add(ground);
    const obstacles = [], treeInfo = [], buildingInfo = [{ x: -30, z: 68, w: 16, d: 8 }, { x: 118, z: 25, w: 18, d: 10 }];
    const landscape = createLandscape({ scene, ground, level: "forest", roadDist: terrain.roadDistance,
      route: terrain.route, obstacles, treeInfo, buildingInfo, tablet, terrain });
    assert.equal(treeInfo.length, tablet ? 650 : 900);
    assert.equal(landscape.group.userData.trees, treeInfo.length);
    const key = (x, z) => `${Math.fround(x)},${Math.fround(z)}`;
    const trees = new Map(treeInfo.map(tree => [key(tree.x, tree.z), tree]));
    const solids = new Map(obstacles.map(obstacle => [key(obstacle.x, obstacle.z), obstacle]));
    let verges = 0;
    for (const tree of treeInfo) {
      assert.equal(tree.y, terrain.heightAt(tree.x, tree.z));
      assert.ok(Object.values(tree).every(Number.isFinite));
      assert.ok(Math.max(Math.abs(tree.x), Math.abs(tree.z)) < terrain.halfSize - 5);
      assert.ok(terrain.roadDistance(tree.x, tree.z) >= 10);
      if (terrain.roadDistance(tree.x, tree.z) <= 40) verges++;
      for (const b of buildingInfo) assert.ok(Math.abs(tree.x - b.x) >= b.w / 2 + 6 || Math.abs(tree.z - b.z) >= b.d / 2 + 6);
    }
    assert.ok(verges > treeInfo.length * .65, "most trees occupy the 10-40m verges");
    assert.ok(Math.max(...treeInfo.map(tree => tree.y)) - Math.min(...treeInfo.map(tree => tree.y)) > 60);
    for (let i = 0; i < terrain.route.length; i += 8) {
      const p = terrain.route[i];
      assert.ok(treeInfo.some(tree => Math.hypot(tree.x - p.x, tree.z - p.z) < 60), `vegetation at route sample ${i}`);
    }
    for (const obstacle of obstacles) {
      assert.equal(obstacle.y, terrain.heightAt(obstacle.x, obstacle.z));
      assert.ok(Object.values(obstacle).every(Number.isFinite));
      assert.ok(obstacle.height > 0 && obstacle.height < 30, "height is relative, never a world-space top");
    }
    const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), scale = new THREE.Vector3(), vertex = new THREE.Vector3();
    let trunks = 0, meadow = 0, stones = 0, meshes = 0;
    for (const mesh of landscape.group.children) {
      if (!mesh.isMesh) continue;
      meshes++;
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
      if (!mesh.isInstancedMesh) continue;
      assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
      assert.ok(Number.isFinite(mesh.boundingSphere.radius));
      assert.ok(mesh.frustumCulled);
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix); p.setFromMatrixPosition(matrix); scale.setFromMatrixScale(matrix);
        if (mesh.name.includes("/trunks/")) {
          const tree = trees.get(key(p.x, p.z));
          assert.ok(tree);
          assert.ok(Math.abs(p.y - scale.y / 2 - tree.y) < .0001);
          assert.ok(Math.abs(solids.get(key(p.x, p.z)).height - scale.y) < .0001);
          trunks++;
        } else if (mesh.name.includes("/needles/")) {
          const tree = trees.get(key(p.x, p.z));
          assert.ok(tree && p.y >= tree.y + tree.h * .19 - .0001 && p.y < tree.y + tree.h);
        } else if (mesh.name.includes("/meadow/")) {
          assert.ok(Math.abs(p.y - terrain.heightAt(p.x, p.z) - .01) < .0001);
          assert.ok(terrain.roadDistance(p.x, p.z) >= 6.8999);
          meadow++;
        } else if (mesh.name.includes("/weathered-stone/")) {
          const obstacle = solids.get(key(p.x, p.z));
          assert.ok(Math.abs(p.y - obstacle.y - scale.x * .32) < .0001);
          const positions = mesh.geometry.attributes.position;
          let top = -Infinity;
          for (let j = 0; j < positions.count; j++) top = Math.max(top, vertex.fromBufferAttribute(positions, j).applyMatrix4(matrix).y);
          assert.ok(Math.abs(top - obstacle.y - obstacle.height) < .0001);
          stones++;
        }
      }
    }
    assert.equal(trunks, treeInfo.length);
    assert.ok(meadow > (tablet ? 3000 : 6000) && meadow <= (tablet ? 8500 : 17000));
    assert.ok(stones > 30 && stones <= 100);
    assert.ok(meshes <= (tablet ? 220 : 360), `${meshes} spatial batches`);
    landscape.animate(12);
    dispose(scene);
  });
}

test("Moon props retain their designs and relative heights on lunar terrain; Earth stays in world space", (t) => {
  canvasDocument(t);
  const terrain = createCourse("moon"), flat = new THREE.Scene(), elevated = new THREE.Scene();
  const flatObstacles = [], obstacles = [];
  createLevelScenery(flat, true, terrain.roadDistance, flatObstacles);
  createLevelScenery(elevated, true, terrain.roadDistance, obstacles, terrain);
  assert.equal(flat.children.length, elevated.children.length);
  assert.equal(obstacles.length, 70);
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    assert.deepEqual(o, { ...flatObstacles[i], y: terrain.heightAt(o.x, o.z) });
    assert.equal(flatObstacles[i].y, 0);
  }
  const a = new THREE.Matrix4(), b = new THREE.Matrix4();
  let instances = 0, earth = 0;
  for (let i = 0; i < flat.children.length; i++) {
    const original = flat.children[i], placed = elevated.children[i];
    assert.equal(original.type, placed.type);
    if (placed.isInstancedMesh) {
      assert.equal(original.count, placed.count);
      for (let j = 0; j < placed.count; j++) {
        original.getMatrixAt(j, a); placed.getMatrixAt(j, b);
        const x = a.elements[12], z = a.elements[14];
        assert.ok(Math.abs(b.elements[13] - a.elements[13] - terrain.heightAt(x, z)) < .0001);
        for (let k = 0; k < 16; k++) if (k !== 13) assert.equal(a.elements[k], b.elements[k]);
        instances++;
      }
    } else {
      const isEarth = placed.geometry?.parameters.radius === 20;
      const offset = isEarth ? 80 : terrain.heightAt(placed.position.x, placed.position.z);
      assert.equal(placed.position.x, original.position.x);
      assert.equal(placed.position.z, original.position.z);
      assert.ok(Math.abs(placed.position.y - original.position.y - offset) < .0001);
      assert.deepEqual(placed.rotation.toArray(), original.rotation.toArray());
      if (isEarth) { assert.equal(placed.position.y, 105); earth++; }
    }
  }
  assert.equal(instances, 137);
  assert.equal(earth, 1);
  dispose(flat); dispose(elevated);
});
