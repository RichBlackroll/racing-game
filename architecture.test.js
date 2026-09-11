import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { createArchitecture } from "./architecture.js";
import { moveWithBounces } from "./collision.js";
import { createCourse } from "./course.js";

function make(level, tablet = false, terrain) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x123456);
  scene.fog = new THREE.Fog(0x654321, 25, 300);
  scene.environment = new THREE.Texture();
  const background = scene.background, fog = scene.fog, environment = scene.environment;
  const obstacles = [], buildingInfo = [];
  const result = createArchitecture({ scene, level, obstacles, buildingInfo, tablet, terrain });
  assert.equal(scene.background, background);
  assert.equal(scene.background.getHex(), 0x123456);
  assert.equal(scene.fog, fog);
  assert.equal(scene.fog.color.getHex(), 0x654321);
  assert.equal(scene.environment, environment);
  return { scene, obstacles, buildingInfo, ...result };
}

function dispose(world) {
  const materials = new Set();
  world.scene.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    materials.add(object.material);
  });
  materials.forEach((material) => material.dispose());
  world.scene.environment.dispose();
}

function featureBounds(world) {
  const features = new Map();
  world.scene.updateMatrixWorld(true);
  world.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const position = mesh.geometry.attributes.position;
    const point = new THREE.Vector3();
    for (const part of mesh.userData.parts) {
      if (!features.has(part.name)) features.set(part.name, new THREE.Box3());
      const bounds = features.get(part.name);
      for (let i = part.start; i < part.start + part.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        bounds.expandByPoint(point);
      }
    }
  });
  return features;
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${message}: ${actual} != ${expected}`);
}

for (const tablet of [false, true]) {
  test(`city ${tablet ? "tablet" : "desktop"}: 36 exact footprints and a varied 14-65m skyline`, () => {
    const world = make("city", tablet);
    const { counts, buildingInfo, obstacles } = world;
    const features = featureBounds(world);
    assert.equal(counts.blocks, 36);
    assert.equal(buildingInfo.length, 36);
    assert.equal(counts.districts, 9);
    assert.equal(counts.trees, 72);
    assert.equal(counts.lights, 72);
    assert.equal(counts.benches, 36);
    assert.equal(counts.colliders, obstacles.length);
    assert.equal(new Set(buildingInfo.map((b) => `${b.x},${b.z}`)).size, 36);
    assert.ok(new Set(buildingInfo.map((b) => b.h)).size > 15);
    assert.equal(new Set(buildingInfo.map((b) => b.style)).size, 4);
    assert.equal(Math.min(...buildingInfo.map((b) => b.h)), 14);
    assert.equal(Math.max(...buildingInfo.map((b) => b.h)), 65);
    for (const b of buildingInfo) {
      assert.ok([-125, -75, -25, 25, 75, 125].includes(b.x));
      assert.ok([-125, -75, -25, 25, 75, 125].includes(b.z));
      const collision = obstacles.find((o) => o.name === b.name);
      assert.equal(collision.hx, b.w / 2);
      assert.equal(collision.hz, b.d / 2);
      assert.equal(collision.r, Math.hypot(b.w, b.d) / 2);
      const plinth = features.get(`${b.name}/plinth`);
      near(plinth.min.x, b.x - collision.hx, "plinth min x");
      near(plinth.max.x, b.x + collision.hx, "plinth max x");
      near(plinth.min.z, b.z - collision.hz, "plinth min z");
      near(plinth.max.z, b.z + collision.hz, "plinth max z");
      const curb = features.get(`${b.name}/curb`);
      near(curb.max.x - curb.min.x, 37, "curb width");
      near(curb.max.z - curb.min.z, 37, "curb depth");
      const architecture = new THREE.Box3();
      for (const [name, bounds] of features) {
        if (!name.startsWith(`${b.name}/`) || /\/(street-|curb|sidewalk|paving-joints)/.test(name)) continue;
        architecture.union(bounds);
      }
      near(architecture.min.x, plinth.min.x, "all architecture inside footprint min x");
      near(architecture.max.x, plinth.max.x, "all architecture inside footprint max x");
      near(architecture.min.z, plinth.min.z, "all architecture inside footprint min z");
      near(architecture.max.z, plinth.max.z, "all architecture inside footprint max z");
      near(architecture.max.y, b.h, "reported building height");
      assert.ok(world.scene.getObjectByName(b.name).userData.tiers.length >= 1);
    }
    dispose(world);
  });

  test(`city ${tablet ? "tablet" : "desktop"}: the entire 13m road network remains clear`, () => {
    const world = make("city", tablet);
    for (const obstacle of world.obstacles) {
      assert.ok(Object.values(obstacle).filter((v) => typeof v === "number").every(Number.isFinite));
      for (let road = -150; road <= 150; road += 50) {
        assert.ok(Math.abs(obstacle.x - road) - (obstacle.hx ?? obstacle.r) >= 6.5);
        assert.ok(Math.abs(obstacle.z - road) - (obstacle.hz ?? obstacle.r) >= 6.5);
      }
    }
    for (const [name, bounds] of featureBounds(world)) {
      if (name.startsWith("city/intersection-")) {
        assert.ok(bounds.max.y <= 0.121, "road paint is flush and non-solid");
        continue;
      }
      for (let road = -150; road <= 150; road += 50) {
        assert.ok(bounds.max.x <= road - 6.5 + 0.0001 || bounds.min.x >= road + 6.5 - 0.0001, `${name}: x road ${road}`);
        assert.ok(bounds.max.z <= road - 6.5 + 0.0001 || bounds.min.z >= road + 6.5 - 0.0001, `${name}: z road ${road}`);
      }
    }
    for (let road = -150; road <= 150; road += 50) for (const offset of [-5.3, 0, 5.3]) {
      const result = moveWithBounces({ x: -165, z: road + offset }, { x: 330, z: 0 }, 1, world.obstacles);
      assert.equal(result.hits, 0);
      near(result.x, 165, "horizontal road traversal");
      const vertical = moveWithBounces({ x: road + offset, z: -165 }, { x: 0, z: 330 }, 1, world.obstacles);
      assert.equal(vertical.hits, 0);
      near(vertical.z, 165, "vertical road traversal");
    }
    dispose(world);
  });
}

test("solid street furniture and trunks have exact colliders; buildings stop the car", () => {
  const world = make("city");
  const features = featureBounds(world);
  for (const o of world.obstacles.filter((o) => o.kind !== "building")) {
    const solid = new THREE.Box3();
    for (const [name, bounds] of features) {
      if (!name.startsWith(`${o.name}/`)) continue;
      if (o.kind === "tree" && !name.endsWith("/trunk")) continue;
      if (o.kind === "planter" && !name.endsWith("/vessel")) continue;
      if (o.kind === "light" && !name.endsWith("/mast")) continue;
      solid.union(bounds);
    }
    assert.equal(solid.isEmpty(), false, o.name);
    near(solid.min.x, o.x - (o.hx ?? o.r), `${o.name} min x`);
    near(solid.max.x, o.x + (o.hx ?? o.r), `${o.name} max x`);
    near(solid.min.z, o.z - (o.hz ?? o.r), `${o.name} min z`);
    near(solid.max.z, o.z + (o.hz ?? o.r), `${o.name} max z`);
    assert.ok(solid.max.y <= o.height + 0.001);
  }
  for (const b of world.buildingInfo) {
    const o = world.obstacles.find((o) => o.name === b.name);
    const result = moveWithBounces({ x: b.x - b.w / 2 - 3, z: b.z }, { x: 25, z: 0 }, 0.25, [o]);
    assert.ok(result.hits > 0);
    assert.ok(result.x < b.x - b.w / 2);
  }
  dispose(world);
});

test("all levels have finite PBR batches, bounded draw/triangle budgets and no texture/DOM dependency", () => {
  for (const level of ["city", "forest", "stunt"]) for (const tablet of [false, true]) {
    const world = make(level, tablet);
    let meshes = 0, triangles = 0, parts = 0;
    world.scene.traverse((mesh) => {
      assert.equal(Boolean(mesh.isLight), false, "emissive accents do not allocate lights/shadow maps");
      if (!mesh.isMesh) return;
      meshes++;
      assert.ok(mesh.name.includes("/district-"));
      assert.ok(mesh.material.isMeshStandardMaterial);
      assert.equal(Array.isArray(mesh.material), false);
      assert.equal(mesh.material.transparent, false);
      assert.equal(mesh.material.transmission ?? 0, 0);
      assert.equal(mesh.material.map, null);
      assert.equal(mesh.geometry.groups.length, 0);
      assert.ok(mesh.geometry.attributes.position.count <= 60000);
      assert.equal(mesh.frustumCulled, true);
      for (const attribute of Object.values(mesh.geometry.attributes)) {
        assert.ok(attribute.array.every(Number.isFinite));
      }
      const normal = mesh.geometry.attributes.normal;
      for (let i = 0; i < normal.count; i++) {
        const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
        assert.ok(Math.abs(length - 1) < 0.0001, `${mesh.name}: unit normal`);
      }
      assert.ok(Number.isFinite(mesh.geometry.boundingSphere.radius));
      assert.ok(mesh.geometry.boundingSphere.radius > 0);
      let end = 0;
      for (const part of mesh.userData.parts) {
        assert.equal(part.start, end);
        end += part.count;
        parts++;
      }
      assert.equal(end, mesh.geometry.attributes.position.count);
      triangles += end / 3;
    });
    assert.equal(meshes, world.counts.meshes);
    assert.equal(parts, world.counts.parts);
    assert.equal(triangles, world.counts.triangles);
    assert.ok(meshes <= (level === "city" ? 120 : 20), `${level}: ${meshes} draws`);
    assert.ok(triangles <= (level === "city" ? (tablet ? 180000 : 500000) : 20000), `${level}: ${triangles} triangles`);
    dispose(world);
  }
});

test("deterministic geometry and identical tablet skyline/collisions", () => {
  const first = make("city"), second = make("city"), tablet = make("city", true);
  function hash(world) {
    const result = createHash("sha256");
    world.scene.traverse((mesh) => {
      if (!mesh.isMesh) return;
      result.update(mesh.name);
      for (const attribute of Object.values(mesh.geometry.attributes)) {
        result.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
      }
    });
    return result.digest("hex");
  }
  assert.equal(hash(first), hash(second));
  assert.deepEqual(first.counts, second.counts);
  assert.deepEqual(first.obstacles, tablet.obstacles);
  assert.deepEqual(first.buildingInfo, tablet.buildingInfo);
  assert.ok(tablet.counts.triangles < first.counts.triangles * 0.55);
  for (const world of [first, second, tablet]) dispose(world);
});

test("forest shells and stunt canopy stay off routes and inside their plinths", () => {
  for (const level of ["forest", "stunt"]) for (const tablet of [false, true]) {
    const world = make(level, tablet);
    assert.equal(world.buildingInfo.length, level === "forest" ? 2 : 1);
    assert.deepEqual(world.buildingInfo.map((b) => [b.x, b.z]), level === "forest" ? [[-30, 68], [118, 25]] : [[0, 60]]);
    const features = featureBounds(world);
    for (const b of world.buildingInfo) {
      assert.equal(b.w, level === "forest" ? (b.x === -30 ? 16 : 18) : 36);
      assert.equal(b.d, level === "forest" ? (b.x === -30 ? 8 : 10) : 12);
      const bounds = new THREE.Box3();
      for (const [name, feature] of features) if (name.startsWith(`${b.name}/`)) bounds.union(feature);
      near(bounds.min.x, b.x - b.w / 2, "pavilion min x");
      near(bounds.max.x, b.x + b.w / 2, "pavilion max x");
      near(bounds.min.z, b.z - b.d / 2, "pavilion min z");
      near(bounds.max.z, b.z + b.d / 2, "pavilion max z");
      assert.ok(bounds.max.y <= b.h);
      assert.ok(bounds.max.y > 5 && bounds.max.y < 11);
      assert.equal(world.obstacles.find((o) => o.name === b.name).hx, b.w / 2);
      // Test both the base ellipse and the actual three-lobed forest route.
      for (let i = 0; i < 2400; i++) {
        const t = i / 2400 * Math.PI * 2;
        const routes = level === "forest"
          ? [[Math.sin(t) * 80, Math.cos(t) * 100], [Math.sin(t) * (80 + 12 * Math.sin(3 * t)), Math.cos(t) * 100]]
          : [[(Math.sin(t) >= 0 ? 90 : -90) + Math.sin(t) * 100, Math.cos(t) * 100], [-90 + 180 * i / 2400, 100], [-90 + 180 * i / 2400, -100]];
        for (const [x, z] of routes) {
          const dx = Math.max(0, Math.abs(x - b.x) - b.w / 2);
          const dz = Math.max(0, Math.abs(z - b.z) - b.d / 2);
          assert.ok(Math.hypot(dx, dz) > 8, `${b.name}: road edge plus vehicle margin`);
        }
      }
      if (level === "stunt") {
        for (const ramp of [{ x: -60, z: 100 }, { x: 60, z: -100 }]) {
          assert.ok(Math.abs(ramp.z - b.z) - b.d / 2 > 20, "ramp runway is clear");
        }
      }
    }
    assert.ok([...features.keys()].some((name) => /glulam-ribs/.test(name)));
    assert.ok([...features.keys()].some((name) => /eave-light/.test(name)));
    dispose(world);
  }
});

test("moon is a true no-op and supplied arrays are appended, not replaced", () => {
  const scene = new THREE.Scene(), existing = new THREE.Group();
  existing.name = "existing-moon-base";
  scene.add(existing);
  const obstacles = [{ x: 1, z: 2, r: 3 }], buildingInfo = [{ x: 1, z: 2, w: 3, d: 4, h: 5 }];
  const obstacle = obstacles[0], info = buildingInfo[0];
  const moon = createArchitecture({ scene, level: "moon", obstacles, buildingInfo });
  assert.equal(moon.group, null);
  assert.ok(Object.values(moon.counts).every((v) => v === 0));
  assert.deepEqual(scene.children, [existing]);
  assert.equal(obstacles.length, 1);
  assert.equal(buildingInfo.length, 1);
  const forest = createArchitecture({ scene, level: "forest", obstacles, buildingInfo });
  assert.equal(obstacles[0], obstacle);
  assert.equal(buildingInfo[0], info);
  assert.equal(obstacles.length, 3);
  assert.equal(buildingInfo.length, 3);
  assert.equal(forest.counts.buildings, 2);
  assert.equal(scene.children[0], existing);
  scene.environment = new THREE.Texture();
  dispose({ scene });
});

test("constant terrain offsets centered building bounds, roofs and colliders without changing relative heights", () => {
  const terrain = { heightAt: () => 37.5 };
  for (const level of ["city", "forest", "stunt"]) {
    const flat = make(level, true), raised = make(level, true, terrain);
    const original = featureBounds(flat), elevated = featureBounds(raised);
    assert.equal(original.size, elevated.size);
    for (const [name, a] of original) {
      const b = elevated.get(name);
      for (const axis of ["x", "z"]) for (const edge of ["min", "max"]) near(b[edge][axis], a[edge][axis], `${name}: centered ${edge} ${axis}`);
      // Terrain-following joints are top surfaces rather than 4mm solid boxes.
      if (!name.endsWith("/paving-joints")) near(b.min.y, a.min.y + 37.5, `${name}: bottom elevation`);
      near(b.max.y, a.max.y + 37.5, `${name}: top elevation`);
    }
    assert.deepEqual(raised.obstacles, flat.obstacles.map(o => ({ ...o, y: 37.5 })));
    assert.deepEqual(raised.buildingInfo, flat.buildingInfo.map(b => ({ ...b, y: 37.5 })));
    for (const b of raised.buildingInfo) {
      const position = raised.scene.getObjectByName(b.name).getWorldPosition(new THREE.Vector3());
      near(position.x, b.x, "building node world x");
      near(position.y, b.y, "building node world ground y");
      near(position.z, b.z, "building node world z");
    }
    dispose(flat); dispose(raised);
  }
});

for (const tablet of [false, true]) {
  test(`hilly architecture ${tablet ? "tablet" : "desktop"}: level shells, solid foundations and bounded sidewalks`, () => {
    for (const level of ["city", "forest", "stunt"]) {
      const terrain = createCourse(level), world = make(level, tablet, terrain), flat = make(level, tablet);
      const features = featureBounds(world), original = featureBounds(flat);
      for (const o of world.obstacles) {
        assert.equal(o.y, terrain.heightAt(o.x, o.z));
        assert.ok(Object.values(o).filter(v => typeof v === "number").every(Number.isFinite));
        assert.ok(o.height > 0 && o.height <= 65, "collision height stays relative");
      }
      for (const b of world.buildingInfo) {
        const plinth = features.get(`${b.name}/plinth`), obstacle = world.obstacles.find(o => o.name === b.name);
        assert.equal(b.y, terrain.heightAt(b.x, b.z));
        assert.equal(obstacle.height, b.h);
        near(plinth.min.x, b.x - b.w / 2, "foundation min x");
        near(plinth.max.x, b.x + b.w / 2, "foundation max x");
        near(plinth.min.z, b.z - b.d / 2, "foundation min z");
        near(plinth.max.z, b.z + b.d / 2, "foundation max z");
        const datum = plinth.max.y - .64;
        for (const [name, bounds] of features) {
          if (!name.startsWith(`${b.name}/`) || /\/(street-|curb|sidewalk|paving-joints|plinth)/.test(name)) continue;
          const before = original.get(name);
          near(bounds.min.y, before.min.y + datum, `${name}: shared foundation bottom`);
          near(bounds.max.y, before.max.y + datum, `${name}: shared foundation top`);
          assert.ok(bounds.max.y <= b.y + b.h + .0001, `${name}: collider world top`);
        }
        for (let ix = 0; ix <= b.w * 2; ix++) for (let iz = 0; iz <= b.d * 2; iz++) {
          const y = terrain.heightAt(b.x - b.w / 2 + ix / 2, b.z - b.d / 2 + iz / 2);
          assert.ok(plinth.min.y <= y + .001, "foundation is sunk, never floating above the ground");
          assert.ok(plinth.max.y >= y + .039, "entire floor clears the hillside");
        }
        for (const [axis, half] of [["x", b.w / 2], ["z", b.d / 2]]) for (const side of [-1, 1]) {
          const p = { x: b.x, z: b.z }, v = { x: 0, z: 0 };
          p[axis] += side * (half + 3); v[axis] = -side * 25;
          const hit = moveWithBounces(p, v, .3, [obstacle], terrain.halfSize);
          assert.ok(hit.hits > 0 && Math.abs(hit[axis] - b[axis]) >= half, "raised floor footprint prevents entry");
        }
      }
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
      let apronTriangles = 0;
      world.scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
        assert.ok(Number.isFinite(mesh.geometry.boundingSphere.radius));
        const positions = mesh.geometry.attributes.position;
        for (const part of mesh.userData.parts) {
          if (!/\/(curb|sidewalk|paving-joints)$/.test(part.name)) continue;
          for (let i = part.start; i < part.start + part.count; i += 3) {
            a.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
            b.fromBufferAttribute(positions, i + 1).applyMatrix4(mesh.matrixWorld);
            c.fromBufferAttribute(positions, i + 2).applyMatrix4(mesh.matrixWorld);
            normal.subVectors(b, a).cross(c.clone().sub(a)).normalize();
            if (normal.y < .5) continue;
            for (const p of [a, b, c, a.clone().add(b).add(c).multiplyScalar(1 / 3)]) {
              const clearance = p.y - terrain.heightAt(p.x, p.z);
              assert.ok(clearance >= -.0001 && clearance <= .3, `${part.name}: ${clearance}m apron clearance`);
            }
            apronTriangles++;
          }
        }
      });
      if (level === "city") assert.ok(apronTriangles > 1000);
      assert.ok(world.counts.meshes <= (level === "city" ? 120 : 20));
      assert.ok(world.counts.triangles <= (level === "city" ? (tablet ? 180000 : 500000) : 20000), `${level}: ${world.counts.triangles} triangles`);
      dispose(flat); dispose(world);
    }
  });
}

test("spectator foundations extend and lift to accommodate a steep unpadded hillside", () => {
  const terrain = { halfSize: 420, heightAt: (x, z) => 15 + x * .18 + (z - 60) * .14 };
  const world = make("stunt", false, terrain);
  const building = world.buildingInfo[0];
  const plinth = featureBounds(world).get(`${building.name}/plinth`);
  assert.ok(plinth.min.y < building.y - 3);
  assert.ok(plinth.max.y - .64 > building.y + 3);
  for (const x of [-18, 18]) for (const z of [54, 66]) {
    assert.ok(plinth.min.y < terrain.heightAt(x, z) + .001);
    assert.ok(plinth.max.y > terrain.heightAt(x, z));
  }
  dispose(world);
});
