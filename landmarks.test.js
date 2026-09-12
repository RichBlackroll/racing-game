import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { createArchitecture } from "./architecture.js";
import { moveWithBounces } from "./collision.js";
import { createCourse } from "./course.js";
import { createLandmarks, inClearing } from "./landmarks.js";
import { createRampCourse, createLevelScenery } from "./levels.js";
import { createLandscape } from "./world.js";

const CAR_RADIUS = 1.12, CAR_HEIGHT = 1.6, EPS = 0.0001;
// Local foundation footprints, not the larger canopy or roof envelopes.
const expected = {
  forest: {
    "mushroom-village": [[-13, -10, 6.48, 6.48], [12, -11, 7.56, 7.56], [-13, 12, 5.76, 5.76]],
    "timber-camp": [[-13, -10, 10, 8]],
    "ranger-lookout": [], "camp-fern": [],
    "woodland-steam-station": [[10, -8, 10, 8]],
  },
  city: {
    "little-wheel-fairground": [[13, -8, 5, 5]],
    "neighborhood-fire-station": [[-11, -9, 15, 10]],
    "toy-railway-depot": [[10, -10, 12, 10]],
    "busy-builders-yard": [], "sundae-market": [[-12, -10, 9, 8]],
  },
  stunt: {
    "Confetti Big Top": [], "Rainbow Truck Tinker Yard": [],
    "Sunshine Spectator Wheel": [[-22, 12, 6, 6]],
    "Happy Hooks Service Garage": [[-12, -7, 7, 19]],
    "Giggle Gear Monster Motor Show": [],
  },
  moon: {
    "Moonbeam Launch Garden": [],
    "Little Orbit Village": [[-13, 0, 8.5, 22], [13, 0, 8.5, 22], [0, -14, 22, 8.5]],
    "Moonberry Biosphere": [], "Six Wheel Discovery Depot": [],
    "Starlight Listening Station": [[-20, 8, 8, 10]],
  },
};
const courses = Object.fromEntries(Object.keys(expected).map(level => [level, createCourse(level)]));
const at = p => `(${p.x.toFixed(3)}, ${p.z.toFixed(3)})`;
const near = (a, b, message) => assert.ok(Math.abs(a - b) < EPS, `${message}: ${a} != ${b}`);

function canvasDocument(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement(tag) {
    assert.equal(tag, "canvas");
    const canvas = { text: [], fills: [], borders: [] };
    const context = {
      fillRect(...args) { canvas.fills.push(args); },
      strokeRect(...args) { canvas.borders.push(args); },
      fillText(...args) { canvas.text.push(args); },
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, closePath() {}, fill() {}, ellipse() {},
    };
    canvas.getContext = kind => { assert.equal(kind, "2d"); return context; };
    return canvas;
  } };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  });
}

function dispose(scene) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    for (const material of [object.material].flat()) {
      materials.add(material);
      if (material.map) textures.add(material.map);
    }
  });
  if (scene.background?.isTexture) textures.add(scene.background);
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
  textures.forEach(texture => texture.dispose());
}

function make(t, level, tablet) {
  const terrain = courses[level], scene = new THREE.Scene(), obstacles = [], buildingInfo = [];
  t.after(() => dispose(scene));
  const ramps = ["stunt", "moon"].includes(level) ? createRampCourse(scene, terrain.route, level === "moon") : [];
  createArchitecture({ scene, level, tablet, terrain, obstacles, buildingInfo });
  const previousObstacles = obstacles.slice(), previousBuildings = buildingInfo.slice();
  const result = createLandmarks({ scene, level, tablet, terrain, obstacles, buildingInfo });
  previousObstacles.forEach((o, i) => assert.equal(obstacles[i], o, "preserve existing architecture colliders"));
  previousBuildings.forEach((b, i) => assert.equal(buildingInfo[i], b, "preserve existing building records"));
  scene.updateMatrixWorld(true);
  return { ...result, scene, terrain, level, tablet, ramps, obstacles, buildingInfo,
    solids: obstacles.slice(previousObstacles.length), buildings: buildingInfo.slice(previousBuildings.length) };
}

function footprintDistance(p, o) {
  return o.hx === undefined ? Math.hypot(p.x - o.x, p.z - o.z) - o.r
    : Math.hypot(Math.max(0, Math.abs(p.x - o.x) - o.hx), Math.max(0, Math.abs(p.z - o.z) - o.hz));
}

function clearingDistance(p, c) {
  if (!c.end) return Math.hypot(p.x - c.x, p.z - c.z);
  const line = new THREE.Line3(new THREE.Vector3(c.x, 0, c.z), new THREE.Vector3(c.end.x, 0, c.end.z));
  const point = new THREE.Vector3(p.x, 0, p.z);
  return point.distanceTo(line.closestPointToPoint(point, true, new THREE.Vector3()));
}

function drive(world, start, end, label) {
  const length = Math.hypot(end.x - start.x, end.z - start.z), steps = Math.ceil(length / 0.25);
  const velocity = { x: (end.x - start.x) / length, z: (end.z - start.z) / length };
  let position = { ...start };
  for (let i = 1; i <= steps; i++) {
    const y = world.terrain.heightAt(position.x, position.z);
    // Match gameplay: overhead roofs, decks and gondolas are not ground walls.
    const solids = world.obstacles.filter(o => y + CAR_HEIGHT > o.y && y < o.y + o.height);
    const next = { x: start.x + (end.x - start.x) * i / steps, z: start.z + (end.z - start.z) * i / steps };
    const blocking = solids.filter(o => footprintDistance(next, o) < CAR_RADIUS);
    const result = moveWithBounces(position, velocity, length / steps, solids, world.terrain.halfSize, CAR_RADIUS);
    const message = `${label} at ${at(next)}, ground=${y.toFixed(3)}; blockers: ${blocking.map(o =>
      `${o.name ?? "landscape"} ${at(o)} y=[${o.y.toFixed(3)}, ${(o.y + o.height).toFixed(3)}] hx=${o.hx ?? o.r} hz=${o.hz ?? o.r}`).join("; ")}`;
    assert.equal(result.hits, 0, message);
    near(result.x, next.x, message);
    near(result.z, next.z, message);
    position = next;
  }
}

function geometryHash(world) {
  const hash = createHash("sha256");
  world.group.traverse(mesh => {
    hash.update(JSON.stringify([mesh.name, mesh.position.toArray(), mesh.quaternion.toArray(), mesh.scale.toArray()]));
    if (!mesh.isMesh) return;
    hash.update(JSON.stringify([mesh.material.color.getHex(), mesh.material.map?.image.text]));
    for (const attribute of [...Object.values(mesh.geometry.attributes), mesh.geometry.index].filter(Boolean)) {
      hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    }
  });
  return hash.digest("hex");
}

test("inClearing reserves circular sites and finite, rounded path corridors with margins", () => {
  assert.equal(inClearing([], 0, 0, 100), false);
  for (const [x, z, margin, inside] of [[3, 3, 0, true], [3, 4, 0, false], [3, 4, 0.01, true],
    [0, 4.5, -1, false], [100, 0, 0, false]]) {
    assert.equal(inClearing([{ x: 0, z: 0, radius: 5 }], x, z, margin), inside);
  }
  const corridor = { x: -10, z: 5, end: { x: 20, z: 45 }, radius: 4 };
  for (const along of [0, 10, 25, 40, 50]) for (const side of [-1, 1]) {
    for (const [offset, margin, inside] of [[3.99, 0, true], [4.01, 0, false], [5.99, 2, true], [6.01, 2, false]]) {
      const x = -10 + along * 0.6 - side * offset * 0.8, z = 5 + along * 0.8 + side * offset * 0.6;
      assert.equal(inClearing([corridor], x, z, margin), inside, `corridor at (${x}, ${z}), margin ${margin}`);
      assert.equal(inClearing([{ ...corridor.end, end: { x: -10, z: 5 }, radius: 4 }], x, z, margin), inside);
    }
  }
  for (const along of [-4.01, -3.99, 53.99, 54.01]) {
    assert.equal(inClearing([corridor], -10 + along * 0.6, 5 + along * 0.8), along > -4 && along < 54);
  }
  const point = [{ x: 10, z: 20, end: { x: 10, z: 20 }, radius: 3 }];
  assert.equal(inClearing(point, 10, 22.99), true);
  assert.equal(inClearing(point, 10, 23.01), false);
  assert.equal(inClearing(point, 10, 23.01, 1), true);
});

for (const level of Object.keys(expected)) {
  test(`${level}: landmark placement and driving contracts`, async t => {
    canvasDocument(t);
    const desktop = make(t, level, false), tablet = make(t, level, true);

    await t.test("repeatable geometry and identical desktop/tablet sites, paths and colliders", () => {
      assert.deepEqual(tablet.sites, desktop.sites);
      assert.deepEqual(tablet.clearings, desktop.clearings);
      assert.deepEqual(tablet.solids, desktop.solids);
      assert.deepEqual(tablet.buildings, desktop.buildings);
      assert.ok(tablet.counts.triangles < desktop.counts.triangles);
      for (const world of [desktop, tablet]) {
        const repeat = make(t, level, world.tablet);
        assert.deepEqual(repeat.sites, world.sites);
        assert.deepEqual(repeat.solids, world.solids);
        assert.deepEqual(repeat.counts, world.counts);
        assert.equal(geometryHash(repeat), geometryHash(world));
      }
    });

    for (const world of [desktop, tablet]) {
      const mode = world.tablet ? "tablet" : "desktop";
      await t.test(`${mode}: five distinct, separated sites and all geometry inside the playable world`, () => {
        assert.equal(world.sites.length, 5);
        assert.equal(world.counts.sites, 5);
        assert.equal(world.group.children.length, 5);
        assert.equal(new Set(world.sites.map(s => s.name)).size, 5);
        assert.equal(new Set(world.sites.map(s => `${s.x},${s.z}`)).size, 5);
        assert.deepEqual(world.sites.map(s => s.name).sort(), Object.keys(expected[level]).sort());
        assert.equal(new Set(world.sites.map(s => `${Math.sign(s.x)},${Math.sign(s.z)}`)).size >= 4, true);
        for (const axis of ["x", "z"]) {
          const values = world.sites.map(s => s[axis]);
          assert.ok(Math.max(...values) - Math.min(...values) > world.terrain.halfSize * 0.8, `distributed along ${axis}`);
        }
        for (const site of world.sites) {
          const name = `${world.group.name}/${site.name}`, node = world.group.getObjectByName(name);
          assert.ok(node, name);
          assert.equal(site.y, world.terrain.heightAt(site.x, site.z));
          assert.deepEqual(node.position.toArray(), [site.x, site.y, site.z]);
          assert.ok(Math.max(Math.abs(site.x), Math.abs(site.z)) + site.radius + 10 <= world.terrain.halfSize, name);
          assert.ok(world.solids.some(o => o.name === name), `${name}: real colliders, not an empty site`);
          for (const other of world.sites) if (other !== site) {
            assert.ok(Math.hypot(site.x - other.x, site.z - other.z) > site.radius + other.radius + 12,
              `${name} ${at(site)} overlaps ${other.name} ${at(other)}`);
          }
          const bounds = new THREE.Box3().setFromObject(node);
          for (const axis of ["x", "z"]) {
            assert.ok(bounds.min[axis] > -world.terrain.halfSize && bounds.max[axis] < world.terrain.halfSize,
              `${name}: ${axis} bounds [${bounds.min[axis]}, ${bounds.max[axis]}]`);
          }
        }
      });

      await t.test(`${mode}: finite PBR geometry, positive bounds and honest render/material budgets including signs`, () => {
        let meshes = 0, triangles = 0, signs = 0;
        const materials = new Set(), palette = new Map();
        world.group.traverse(mesh => {
          assert.ok(!mesh.isLight, "landmarks must not allocate shadow-casting lights");
          assert.ok(mesh.matrixWorld.elements.every(Number.isFinite));
          if (!mesh.isMesh) return;
          meshes++;
          const { geometry, material } = mesh;
          assert.ok(material.isMeshStandardMaterial);
          assert.equal(material.transparent, false);
          assert.equal(mesh.frustumCulled, true);
          assert.ok(material.roughness >= 0 && material.roughness <= 1);
          assert.ok(material.metalness >= 0 && material.metalness <= 1);
          materials.add(material);
          for (const attribute of Object.values(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite), mesh.name);
          const positions = geometry.attributes.position, normals = geometry.attributes.normal;
          assert.ok(positions.count > 0);
          assert.equal(normals.count, positions.count);
          for (let i = 0; i < normals.count; i++) near(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)), 1, `${mesh.name}: normal ${i}`);
          if (geometry.index) for (const i of geometry.index.array) assert.ok(i >= 0 && i < positions.count);
          const count = geometry.index?.count ?? positions.count;
          assert.equal(count % 3, 0);
          triangles += count / 3;
          geometry.computeBoundingBox(); geometry.computeBoundingSphere();
          assert.ok(Number.isFinite(geometry.boundingSphere.radius) && geometry.boundingSphere.radius > 0);
          const size = geometry.boundingBox.getSize(new THREE.Vector3()).toArray();
          assert.ok(size.every(v => Number.isFinite(v) && v >= 0) && size.filter(v => v > 0).length >= 2);
          if (!material.map) {
            assert.equal(geometry.groups.length, 0);
            const color = material.color.getHex();
            if (palette.has(color)) assert.equal(material, palette.get(color), "share each batch material across sites");
            palette.set(color, material);
            return;
          }
          signs++;
          const canvas = material.map.image;
          assert.ok(material.map.isCanvasTexture);
          assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
          assert.equal(material.side, THREE.DoubleSide);
          assert.deepEqual([canvas.width, canvas.height], [768, 128]);
          assert.deepEqual(canvas.fills, [[0, 0, 768, 128]]);
          assert.deepEqual(canvas.borders, [[7, 7, 754, 114]]);
          assert.equal(canvas.text.length, 1);
          assert.ok(canvas.text[0][0].length > 3);
          assert.deepEqual(canvas.text[0].slice(1), [384, 66, 724]);
        });
        assert.equal(meshes, world.counts.meshes);
        assert.equal(triangles, world.counts.triangles);
        assert.ok(meshes <= 60, `${level}/${mode}: ${meshes} meshes`);
        assert.ok(triangles > 10000 && triangles < 110000, `${level}/${mode}: ${triangles} triangles`);
        assert.ok(materials.size <= 20, `${materials.size} materials`);
        assert.equal(signs, level === "forest" || level === "city" ? 10 : 5);
        for (const site of world.sites) {
          const node = world.group.getObjectByName(`${world.group.name}/${site.name}`);
          assert.ok(node.children.some(mesh => mesh.material.map?.image.text[0][0] === site.name.replaceAll("-", " ").toUpperCase()), site.name);
        }
        t.diagnostic(`${level}/${mode}: ${meshes} meshes, ${triangles} triangles, ${materials.size} materials, ${world.solids.length} new solids`);
      });

      await t.test(`${mode}: new solid footprints, including corners, clear every road and ramp runway`, () => {
        for (const o of world.solids) {
          const name = `${o.name} ${at(o)}`;
          assert.ok([o.x, o.y, o.z, o.hx, o.hz, o.r, o.height].every(Number.isFinite), name);
          assert.ok(o.hx > 0 && o.hz > 0 && o.height > 0, name);
          near(o.r, Math.hypot(o.hx, o.hz), `${name}: footprint radius`);
          assert.ok(Math.abs(o.x) + o.hx + CAR_RADIUS < world.terrain.halfSize, name);
          assert.ok(Math.abs(o.z) + o.hz + CAR_RADIUS < world.terrain.halfSize, name);
          const nx = Math.ceil(o.hx * 4), nz = Math.ceil(o.hz * 4);
          for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
            const p = { x: o.x - o.hx + 2 * o.hx * ix / nx, z: o.z - o.hz + 2 * o.hz * iz / nz };
            const distance = world.terrain.roadDistance(p.x, p.z);
            assert.ok(distance >= 6.5 + CAR_RADIUS, `${name}: footprint ${at(p)} only ${distance.toFixed(3)}m from road center`);
          }
          for (const ramp of world.ramps) {
            const corners = [-1, 1].flatMap(x => [-1, 1].map(z => {
              const dx = o.x + x * o.hx - ramp.x, dz = o.z + z * o.hz - ramp.z;
              return { across: dx * Math.cos(ramp.heading) - dz * Math.sin(ramp.heading),
                along: dx * Math.sin(ramp.heading) + dz * Math.cos(ramp.heading) };
            }));
            assert.ok(Math.max(...corners.map(p => p.along)) < -30 || Math.min(...corners.map(p => p.along)) > ramp.length + 60 ||
              Math.max(...corners.map(p => p.across)) < -ramp.width / 2 - 2 || Math.min(...corners.map(p => p.across)) > ramp.width / 2 + 2,
            `${name}: obstructs ramp ${at(ramp)} or its 30m approach / 60m landing`);
          }
        }
      });

      await t.test(`${mode}: rendered foundations enclose terrain over their entire footprints`, () => {
        for (const site of world.sites) for (const [dx, dz, w, d] of expected[level][site.name]) {
          const p = { x: site.x + dx, z: site.z + dz }, name = `${world.group.name}/${site.name}`;
          const matches = world.solids.filter(o => o.name === name && Math.abs(o.x - p.x) < EPS && Math.abs(o.z - p.z) < EPS &&
            Math.abs(o.hx * 2 - w) < EPS && Math.abs(o.hz * 2 - d) < EPS && o.y < world.terrain.heightAt(p.x, p.z) - 0.1);
          assert.equal(matches.length, 1, `${name}: missing foundation ${at(p)} ${w}x${d}`);
          const o = matches[0], corners = [];
          for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [o.y, o.y + o.height]) {
            corners.push(new THREE.Vector3(o.x + x * o.hx, y, o.z + z * o.hz));
          }
          const found = new Set(), vertex = new THREE.Vector3();
          world.group.getObjectByName(name).traverse(mesh => {
            if (!mesh.isMesh) return;
            const positions = mesh.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
              vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
              corners.forEach((corner, j) => { if (vertex.distanceTo(corner) < EPS) found.add(j); });
            }
          });
          assert.equal(found.size, 8, `${name} ${at(p)}: collider must match all eight rendered foundation corners`);
          const nx = Math.ceil(w * 2), nz = Math.ceil(d * 2);
          for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
            const point = { x: o.x - w / 2 + w * ix / nx, z: o.z - d / 2 + d * iz / nz };
            const y = world.terrain.heightAt(point.x, point.z), message = `${name} foundation ${at(p)}, sample ${at(point)}, terrain=${y}, base=${o.y}, top=${o.y + o.height}`;
            assert.ok(o.y <= y + EPS, `floating: ${message}`);
            assert.ok(o.y + o.height >= y + 0.04, `buried floor: ${message}`);
          }
        }
      });

      await t.test(`${mode}: continuous terrain-following 8m paths, clear centerlines and usable full-width lanes`, () => {
        assert.equal(world.clearings.filter(c => c.end).length, 5);
        for (const site of world.sites) {
          const { start, end, length } = site.access, name = `${world.group.name}/${site.name}`;
          near(length, Math.hypot(end.x - start.x, end.z - start.z), `${name}: path length`);
          assert.ok(length >= 10);
          near(world.terrain.roadDistance(start.x, start.z), 0, `${name}: path reaches asphalt`);
          assert.ok(Math.hypot(end.x - site.x, end.z - site.z) <= site.radius + EPS, `${name}: path reaches inside clearing`);
          assert.ok(world.clearings.some(c => c.end && c.x === start.x && c.z === start.z && c.end.x === end.x && c.end.z === end.z && c.radius >= 7));
          const node = world.group.getObjectByName(name);
          const paths = node.children.filter(mesh => !mesh.material.map && mesh.material.color.getHex() === (level === "moon" ? 0x595954 : 0xb2a18a));
          assert.equal(paths.length, 1, `${name}: actual path mesh`);
          const mesh = paths[0], position = mesh.geometry.attributes.position;
          const direction = new THREE.Vector3((end.x - start.x) / length, 0, (end.z - start.z) / length);
          const normal = new THREE.Vector3(-direction.z, 0, direction.x), vertex = new THREE.Vector3();
          let minAlong = Infinity, maxAlong = -Infinity, area = 0;
          const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
          for (let i = 0; i < position.count; i++) {
            vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
            near(vertex.y, world.terrain.heightAt(vertex.x, vertex.z) + 0.12, `${name}: path surface ${at(vertex)}`);
            const dx = vertex.x - start.x, dz = vertex.z - start.z;
            near(Math.abs(dx * normal.x + dz * normal.z), 4, `${name}: path half width ${at(vertex)}`);
            const along = dx * direction.x + dz * direction.z;
            minAlong = Math.min(minAlong, along); maxAlong = Math.max(maxAlong, along);
          }
          near(minAlong, 0, `${name}: rendered path start`);
          near(maxAlong, length, `${name}: rendered path end`);
          for (let i = 0; i < position.count; i += 3) {
            a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
            const signedArea = ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z)) / 2;
            assert.ok(signedArea > 0, `${name}: nondegenerate upward-facing path triangle ${i / 3}`);
            area += signedArea;
          }
          assert.ok(Math.abs(area - length * 8) < 0.002, `${name}: path area ${area} != ${length * 8}`);
          const ray = new THREE.Raycaster(undefined, new THREE.Vector3(0, -1, 0), 0, 20);
          const steps = Math.ceil(length / 0.5);
          for (let i = 1; i < steps; i++) for (const side of [-3.999, 0, 3.999]) {
            const x = start.x + direction.x * length * i / steps + normal.x * side;
            const z = start.z + direction.z * length * i / steps + normal.z * side;
            ray.ray.origin.set(x, world.terrain.heightAt(x, z) + 10, z);
            const hits = ray.intersectObject(mesh);
            assert.ok(hits.length > 0, `${name}: hole in rendered path at (${x}, ${z})`);
            const clearance = hits[0].point.y - world.terrain.heightAt(x, z);
            assert.ok(clearance > -0.02 && clearance < 0.3, `${name}: path ${at(hits[0].point)} floats/sinks by ${clearance}m`);
          }
          for (const offset of [-(4 - CAR_RADIUS), 0, 4 - CAR_RADIUS]) {
            const from = { x: start.x + normal.x * offset, z: start.z + normal.z * offset };
            const to = { x: end.x + normal.x * offset, z: end.z + normal.z * offset };
            drive(world, from, to, `${name} inbound lane ${offset}`);
            drive(world, to, from, `${name} outbound lane ${offset}`);
          }
        }
      });

      if (level === "stunt" || level === "moon") await t.test(`${mode}: big top / biosphere portals are genuine bidirectional drive-throughs`, () => {
        const name = level === "stunt" ? "Confetti Big Top" : "Moonberry Biosphere";
        const site = world.sites.find(s => s.name === name), centerZ = site.z + (level === "moon" ? -3 : 0);
        const reach = level === "stunt" ? 30 : 22;
        const triangles = [], corridor = new THREE.Box3(
          new THREE.Vector3(site.x - 4, -Infinity, centerZ - reach),
          new THREE.Vector3(site.x + 4, Infinity, centerZ + reach));
        world.group.getObjectByName(`${world.group.name}/${name}`).traverse(mesh => {
          if (!mesh.isMesh) return;
          const { position } = mesh.geometry.attributes, index = mesh.geometry.index;
          for (let i = 0; i < (index?.count ?? position.count); i += 3) {
            const vertices = [0, 1, 2].map(j => new THREE.Vector3()
              .fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld));
            const triangle = new THREE.Triangle(...vertices);
            if (corridor.intersectsTriangle(triangle)) triangles.push(triangle);
          }
        });
        assert.ok(triangles.length > 0, "inspect rendered floor and overhead canopy, not just collider metadata");
        for (const offset of [-2.5, 0, 2.5]) {
          const a = { x: site.x + offset, z: centerZ - reach }, b = { x: site.x + offset, z: centerZ + reach };
          drive(world, a, b, `${name} +Z entrance lane ${offset}`);
          drive(world, b, a, `${name} -Z entrance lane ${offset}`);
          for (let z = a.z; z <= b.z; z += 0.5) {
            const y = world.terrain.heightAt(a.x, z), body = new THREE.Box3(
              new THREE.Vector3(a.x - CAR_RADIUS, y + 0.3, z - CAR_RADIUS),
              new THREE.Vector3(a.x + CAR_RADIUS, y + CAR_HEIGHT, z + CAR_RADIUS));
            // Ignore the draped floor at +0.12m, but catch visible walls lacking colliders.
            const blocked = triangles.find(triangle => body.intersectsTriangle(triangle));
            assert.ok(!blocked, `${name}: rendered solid crosses car body at (${a.x}, ${z}), ground=${y}; triangle ${blocked &&
              [blocked.a, blocked.b, blocked.c].map(v => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`).join(" / ")}`);
          }
        }
        if (level === "stunt") {
          const wheel = world.sites.find(s => s.name === "Sunshine Spectator Wheel");
          const p = { x: wheel.x, z: wheel.z - 8 }, y = world.terrain.heightAt(p.x, p.z);
          assert.ok(world.solids.some(o => footprintDistance(p, o) < CAR_RADIUS && o.y > y + CAR_HEIGHT), "exercise real overhead gondola colliders");
          drive(world, { x: p.x, z: p.z - 12 }, { x: p.x, z: p.z + 12 }, "under suspended spectator-wheel gondolas");
        }
      });

      await t.test(`${mode}: landscape trees and rocks respect site and path clearings after scene assembly`, () => {
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * world.terrain.halfSize, 2 * world.terrain.halfSize), new THREE.MeshStandardMaterial());
        world.scene.add(ground);
        const treeInfo = [], before = world.obstacles.length;
        createLandscape({ scene: world.scene, ground, level, terrain: world.terrain, tablet: world.tablet,
          route: world.terrain.route, roadDist: world.terrain.roadDistance, obstacles: world.obstacles,
          buildingInfo: world.buildingInfo, treeInfo, clearings: world.clearings });
        if (level === "moon") createLevelScenery(world.scene, true, world.terrain.roadDistance, world.obstacles, world.terrain, world.clearings);
        const added = world.obstacles.slice(before);
        if (level === "forest") {
          assert.ok(treeInfo.length >= 600);
          assert.ok(added.length > treeInfo.length + 20, "exercise rocks as well as trees");
        } else if (level === "moon") assert.equal(added.length, 120);
        for (const tree of treeInfo) {
          assert.equal(inClearing(world.clearings, tree.x, tree.z, 6), false, `tree ${at(tree)}`);
          for (const clearing of world.clearings) assert.ok(clearingDistance(tree, clearing) >= clearing.radius + 6 - EPS, `tree ${at(tree)} invades ${clearing.end ? "path" : "site"} ${at(clearing)}`);
        }
        for (const o of added) for (const clearing of world.clearings) {
          assert.equal(inClearing([clearing], o.x, o.z, o.r), false, `rock/trunk ${at(o)}`);
          assert.ok(clearingDistance(o, clearing) >= clearing.radius + o.r - EPS, `solid ${at(o)} radius=${o.r} invades ${clearing.end ? "path" : "site"} ${at(clearing)}`);
        }
        world.scene.updateMatrixWorld(true);
        const matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
        let instances = 0;
        world.scene.traverse(mesh => {
          if (!mesh.isInstancedMesh || (level !== "moon" && !mesh.name.includes("/weathered-stone/"))) return;
          const positions = mesh.geometry.attributes.position;
          for (let i = 0; i < mesh.count; i++) {
            instances++;
            mesh.getMatrixAt(i, matrix); matrix.premultiply(mesh.matrixWorld);
            for (let j = 0; j < positions.count; j++) {
              vertex.fromBufferAttribute(positions, j).applyMatrix4(matrix);
              for (const clearing of world.clearings) assert.ok(clearingDistance(vertex, clearing) >= clearing.radius - EPS,
                `rendered ${mesh.name || mesh.geometry.type} instance ${i} at ${at(vertex)} invades clearing ${at(clearing)}`);
            }
          }
        });
        if (level === "forest") assert.ok(instances > 20, "rendered rock footprints are checked independently of colliders");
        if (level === "moon") assert.equal(instances, 480, "basalt outcrops and loose scree all avoid clearings");
        for (const site of world.sites) drive(world, site.access.start, site.access.end, `${site.name}: path after landscaping`);
        if (level === "moon" || level === "stunt") {
          const site = world.sites.find(s => s.name === (level === "moon" ? "Moonberry Biosphere" : "Confetti Big Top"));
          drive(world, { x: site.x, z: site.z - 25 }, { x: site.x, z: site.z + 25 }, `${site.name}: center after landscaping`);
        }
      });
    }
  });
}

test("path-corridor exclusion removes otherwise occupied forest terrain, not just circular site endpoints", t => {
  canvasDocument(t);
  function landscape(clearings) {
    const scene = new THREE.Scene(), terrain = courses.forest, obstacles = [], treeInfo = [];
    t.after(() => dispose(scene));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1240, 1240), new THREE.MeshStandardMaterial());
    scene.add(ground);
    createLandscape({ scene, ground, terrain, level: "forest", tablet: true, route: terrain.route,
      roadDist: terrain.roadDistance, obstacles, treeInfo, buildingInfo: [], clearings });
    return { obstacles, treeInfo };
  }
  const baseline = landscape([]), tree = baseline.treeInfo.find(p => Math.max(Math.abs(p.x), Math.abs(p.z)) < 500);
  assert.ok(tree, "baseline supplies a real tree to exclude");
  const rock = baseline.obstacles.find(o => o.r > 0.5 && Math.hypot(o.x - tree.x, o.z - tree.z) > 80);
  assert.ok(rock, "baseline supplies a real rock to exclude");
  const length = Math.hypot(rock.x - tree.x, rock.z - tree.z), dx = (rock.x - tree.x) / length, dz = (rock.z - tree.z) / length;
  const corridor = { x: tree.x - dx * 20, z: tree.z - dz * 20, end: { x: rock.x + dx * 20, z: rock.z + dz * 20 }, radius: 7 };
  for (const p of [tree, rock]) {
    near(clearingDistance(p, corridor), 0, `baseline witness ${at(p)} on corridor`);
    assert.ok(Math.hypot(p.x - corridor.x, p.z - corridor.z) > 7);
    assert.ok(Math.hypot(p.x - corridor.end.x, p.z - corridor.end.z) > 7);
  }
  const cleared = landscape([corridor]);
  assert.ok(cleared.treeInfo.length >= 600 && cleared.obstacles.length > cleared.treeInfo.length + 20);
  for (const o of cleared.obstacles) assert.ok(clearingDistance(o, corridor) >= corridor.radius + o.r,
    `tree/rock ${at(o)} remains in reserved corridor ${at(corridor)} to ${at(corridor.end)}`);
});

test("headless creation omits only sign boards, never site placement or collision", t => {
  assert.equal(typeof document, "undefined");
  const headless = Object.keys(expected).map(level => make(t, level, true));
  canvasDocument(t);
  for (const original of headless) {
    const signed = make(t, original.level, true);
    assert.deepEqual(signed.sites, original.sites);
    assert.deepEqual(signed.solids, original.solids);
    assert.deepEqual(signed.clearings, original.clearings);
    const signs = original.level === "forest" || original.level === "city" ? 10 : 5;
    assert.equal(signed.counts.meshes - original.counts.meshes, signs);
    assert.equal(signed.counts.triangles - original.counts.triangles, signs * 2);
    assert.equal(signed.counts.parts, original.counts.parts);
  }
});
