import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCourse } from "./course.js";
import { createAmsterdamGroundGeometry, createAmsterdamWorld } from "./amsterdam-world.js";
import { AMSTERDAM, waterAt, bridgeAt, isAmsterdamDry, amsterdamPathLength, sampleAmsterdamPath } from "./amsterdam-layout.js";
import { createPeopleField } from "./people.js";
import { createConeField } from "./cones.js";
import { createPlaythings } from "./playthings.js";

const course = createCourse("amsterdam");
function fixture(tablet = false) {
  const scene = new THREE.Scene(), obstacles = [], buildingInfo = [], treeInfo = [];
  const world = createAmsterdamWorld({ scene, terrain: course, obstacles, buildingInfo, treeInfo, tablet });
  scene.updateMatrixWorld(true);
  return { scene, obstacles, buildingInfo, treeInfo, world };
}

test("Amsterdam ground has exact canal holes, upward faces and no submerged land triangles", () => {
  const geometry = createAmsterdamGroundGeometry(), positions = geometry.attributes.position;
  const ground = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  ground.updateMatrixWorld();
  for (let i = 0; i < positions.count; i += 3) {
    const center = new THREE.Vector3();
    for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs(positions.getY(i + j) - AMSTERDAM.landY) < 1e-6);
      center.add(new THREE.Vector3().fromBufferAttribute(positions, i + j));
    }
    center.divideScalar(3);
    assert.equal(waterAt(center.x, center.z), false);
    assert.ok(geometry.attributes.normal.getY(i) > .99);
  }
  for (let x = -315.2; x <= 315; x += 21) for (let z = -311.3; z <= 315; z += 19) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 15, z), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(ground).length > 0, !waterAt(x, z), `${x},${z}`);
  }
  geometry.dispose(); ground.material.dispose();
});

test("Amsterdam has recognisable neighborhoods and landmarks in bounded spatial batches", () => {
  const { world, scene } = fixture();
  try {
    const names = [], materials = new Set();
    scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      assert.ok(mesh.geometry.boundingSphere || mesh.name.startsWith("amsterdam/water/"));
      assert.ok(mesh.frustumCulled);
      materials.add(mesh.material);
      const position = mesh.geometry.attributes.position;
      assert.ok(position.count <= 60000, `${mesh.name} must remain a bounded batch`);
      for (const value of position.array) assert.ok(Number.isFinite(value));
      for (const part of mesh.userData.parts ?? []) {
        assert.ok(part.start >= 0 && part.start + part.count <= position.count);
        names.push(part.name);
      }
    });
    const features = names.join("\n");
    for (const name of ["stepped-gable", "bell-gable", "neck-gable", "pointed-gable", "traditional-hoisting-beam",
      "sash-window-frame", "hand-lettered-shop-sign", "bicycle-spoke", "bicycle-wicker-basket", "houseboat-cabin",
      "tour-boat-curved-glass-roof", "floating-flower-market-deck", "tulip-flower", "cafe-parasol",
      "magere-brug-white-tower", "drawbridge-suspension-chain", "tram-pantograph", "station-clock-face",
      "museum-twin-steep-slate-spire", "amsterdam-crown-blue-velvet", "palace-neoclassical-pediment",
      "nemo-sweeping-oxidized-copper-ship-hull", "mill-tapering-octagonal-timber-body"]) {
      assert.ok(features.includes(name), `missing visible detail: ${name}`);
    }
    assert.equal(world.sites.length, 6);
    assert.ok(world.counts.houses >= 150);
    assert.equal(world.counts.bridges, 16);
    assert.ok(world.counts.bicycles >= 70);
    assert.ok(world.counts.houseboats >= 20);
    assert.equal(world.counts.tourBoats, 3);
    assert.equal(world.counts.marketStalls, 7);
    assert.ok(world.counts.trees >= 60);
    assert.ok(world.counts.meshes < 420);
    assert.ok(world.counts.triangles < 750000);
    assert.ok(materials.size <= 13);
    assert.ok([...materials].every(material => !material.transparent));
    const fills = [], strokes = [];
    let path;
    world.drawMap({
      beginPath() { path = []; },
      moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
      closePath() { path.push(path[0]); },
      fill() { fills.push(path); }, stroke() { strokes.push(path); },
    }, .25);
    assert.deepEqual(fills, AMSTERDAM.canals.map(c => [...c.polygon, c.polygon[0]].map(p => [p.x * .25, -p.z * .25])));
    assert.deepEqual(strokes, AMSTERDAM.streets.map(s => s.points.map(p => [p.x * .25, -p.z * .25])));
  } finally { world.dispose(); }
});

test("both lanes of the entire canal circuit clear buildings, quays and bridge rails", () => {
  const { world, obstacles } = fixture();
  try {
    for (let i = 0; i < course.route.length; i++) {
      const p = course.route[i], next = course.route[(i + 1) % course.route.length];
      const heading = Math.atan2(next.x - p.x, next.z - p.z);
      for (const lane of [-4.5, 0, 4.5]) {
        const x = p.x + Math.cos(heading) * lane, z = p.z - Math.sin(heading) * lane;
        assert.ok(isAmsterdamDry(x, z, 1.9), `dry car clearance at sample ${i}, lane ${lane}`);
        for (const o of obstacles) {
          if (p.y + 1.6 <= o.y || p.y >= o.y + o.height) continue;
          const distance = Math.hypot(Math.max(0, Math.abs(x - o.x) - o.hx), Math.max(0, Math.abs(z - o.z) - o.hz));
          assert.ok(distance >= 1.12, `${o.name} blocks sample ${i}, lane ${lane}`);
        }
      }
    }
  } finally { world.dispose(); }
});

test("radial streets and both sides of every curved quay stay clear of scenery, not only the lap", () => {
  const { world, obstacles } = fixture(true);
  try {
    for (const street of AMSTERDAM.streets) {
      const length = amsterdamPathLength(street.points);
      for (let distance = 0; distance <= length; distance += 3) for (const lane of [-4.5, 0, 4.5]) {
        const p = sampleAmsterdamPath(street.points, distance, lane);
        const height = course.heightAt(p.x, p.z);
        assert.ok(isAmsterdamDry(p.x, p.z, 1.9), `${street.name}: bank clearance`);
        for (const o of obstacles) {
          if (height + 1.6 <= o.y || height >= o.y + o.height) continue;
          const clearance = Math.hypot(Math.max(0, Math.abs(p.x - o.x) - o.hx), Math.max(0, Math.abs(p.z - o.z) - o.hz));
          assert.ok(clearance >= 1.12, `${street.name}: ${o.name} blocks lane ${lane} at ${distance}`);
        }
      }
    }
    world.decoration.traverse(mesh => {
      for (const part of mesh.userData.parts ?? []) {
        const boat = part.name.endsWith("boat-shaped-hull");
        const fixture = /station-bicycle-rack-base|lantern-cast-iron-base|square-tree-grate/.test(part.name);
        if (!boat && !fixture) continue;
        const positions = mesh.geometry.attributes.position;
        for (let i = part.start; i < part.start + part.count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
          if (boat) {
            assert.ok(waterAt(p.x, p.z), `${part.name}: boat must follow the curved canal`);
            assert.equal(bridgeAt(p.x, p.z), null, `${part.name}: mooring must clear bridges`);
          } else assert.ok(isAmsterdamDry(p.x, p.z), `${part.name}: land-based fixture must have dry support`);
        }
      }
    });
  } finally { world.dispose(); }
});

test("all canal crossings have terrain-matched, upward bridge decks, not flat slabs over water", () => {
  const { world } = fixture();
  try {
    let tested = 0;
    world.group.traverse(mesh => {
      for (const part of mesh.userData.parts ?? []) {
        if (!part.name.endsWith("terrain-matched-bridge-deck")) continue;
        const positions = mesh.geometry.attributes.position;
        for (let i = part.start; i < part.start + part.count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
          assert.ok(Math.abs(p.y - course.heightAt(p.x, p.z) - .028) < .0001);
          assert.ok(mesh.geometry.attributes.normal.getY(i) > .98);
          tested++;
        }
      }
    });
    assert.ok(tested > 3500);
  } finally { world.dispose(); }
});

test("tablet detail retains the same city, landmarks and collisions with less geometry", () => {
  const desktop = fixture(), tablet = fixture(true);
  try {
    assert.deepEqual(tablet.obstacles, desktop.obstacles);
    assert.deepEqual(tablet.buildingInfo, desktop.buildingInfo);
    assert.deepEqual(tablet.treeInfo, desktop.treeInfo);
    assert.deepEqual(tablet.world.sites, desktop.world.sites);
    for (const key of ["houses", "bridges", "houseboats", "tourBoats", "landmarks", "trees", "cafes", "marketStalls"]) {
      assert.equal(tablet.world.counts[key], desktop.world.counts[key]);
    }
    assert.ok(tablet.world.counts.triangles < desktop.world.counts.triangles * .69);
    assert.ok(tablet.world.counts.triangles < 435000);
    assert.ok(tablet.world.counts.meshes < 420);
  } finally { desktop.world.dispose(); tablet.world.dispose(); }
});

test("the detailed city still permits dry pedestrians, toys and cones to spawn", () => {
  const { world, scene, obstacles } = fixture(true);
  try {
    const common = { scene, route: course.route, obstacles, terrain: course, roadDist: course.roadDistance, onChange() {} };
    const people = createPeopleField({ ...common, count: 8 });
    const cones = createConeField(common);
    const toys = createPlaythings({ ...common, kinds: { ball: { count: 8 }, block: { count: 10 } } });
    assert.equal(people.state().count, 8);
    assert.equal(cones.state().count, 28);
    assert.ok(toys.state().count >= 12);
  } finally { world.dispose(); }
});

test("canal animation respects changing reduced-motion preferences and disposal preserves borrowed resources", () => {
  const previousWindow = globalThis.window, query = { matches: false };
  globalThis.window = { matchMedia: () => query };
  const scene = new THREE.Scene(), borrowed = new THREE.Group(); scene.add(borrowed);
  const firstObstacle = { x: -500, z: -500, r: 1 }, firstBuilding = { name: "borrowed" }, firstTree = { name: "borrowed" };
  const obstacles = [firstObstacle], buildingInfo = [firstBuilding], treeInfo = [firstTree];
  const world = createAmsterdamWorld({ scene, terrain: course, obstacles, buildingInfo, treeInfo });
  try {
    const water = world.decoration.getObjectByName("amsterdam/water/Amstel");
    const shader = { uniforms: {}, vertexShader: "#include <begin_vertex>", fragmentShader: "#include <normal_fragment_maps>" };
    water.material.onBeforeCompile(shader);
    world.animate(1); world.animate(1.05);
    const t = shader.uniforms.uCanalTime.value;
    assert.ok(t > 0);
    query.matches = true; world.animate(2); world.animate(3);
    assert.equal(shader.uniforms.uCanalTime.value, t);
    query.matches = false; world.animate(3.05);
    assert.ok(shader.uniforms.uCanalTime.value > t);
    const later = { x: 900, z: 900, r: 1 }; obstacles.push(later);
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const root of [world.group, world.decoration]) root.traverse(o => {
      if (!o.isMesh) return;
      geometries.add(o.geometry); materials.add(o.material);
      if (o.material.map) textures.add(o.material.map);
    });
    const calls = new Map();
    for (const resource of [...geometries, ...materials, ...textures]) {
      resource.addEventListener("dispose", () => calls.set(resource, (calls.get(resource) ?? 0) + 1));
    }
    world.dispose(); world.dispose(); world.animate(4);
    assert.equal(calls.size, geometries.size + materials.size + textures.size);
    assert.ok([...calls.values()].every(count => count === 1));
    assert.deepEqual(scene.children, [borrowed]);
    assert.deepEqual(obstacles, [firstObstacle, later]);
    assert.deepEqual(buildingInfo, [firstBuilding]); assert.deepEqual(treeInfo, [firstTree]);
  } finally { world.dispose(); globalThis.window = previousWindow; }
});
