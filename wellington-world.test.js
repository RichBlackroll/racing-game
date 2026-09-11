import test, { after } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createWellingtonWorld } from "./wellington-world.js";
import { createWellingtonCourse } from "./wellington-course.js";
import { WELLINGTON, isWellingtonLand, projectWellington } from "./wellington-layout.js";

const course = createWellingtonCourse();
const worlds = new Map();
function world(tablet = false) {
  if (!worlds.has(tablet)) {
    const scene = new THREE.Scene(), obstacles = [], buildingInfo = [];
    const result = createWellingtonWorld({ scene, course, obstacles, buildingInfo, tablet });
    scene.updateMatrixWorld(true);
    worlds.set(tablet, { ...result, scene, obstacles, buildingInfo });
  }
  return worlds.get(tablet);
}
function dispose(scene) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) materials.add(o.material);
    if (o.material?.map) textures.add(o.material.map);
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}
after(() => worlds.forEach(w => dispose(w.scene)));

function distance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}
function inside(points, x, z) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.z > z) !== (b.z > z) && x < a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z)) result = !result;
  }
  return result;
}
const polygons = [WELLINGTON.coast, ...WELLINGTON.wharves.map(p => p.points)];
const holes = WELLINGTON.waterHoles.map(p => p.points);
const dry = (x, z) => polygons.some(p => inside(p, x, z)) && !holes.some(p => inside(p, x, z));

function meshTriangles(geometry) {
  const positions = geometry.attributes.position, index = geometry.index;
  const result = [];
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    result.push([0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(i + j) : i + j)));
  }
  return result;
}
function surfaceAt(triangles, x, z) {
  for (const [a, b, c] of triangles) {
    if (x < Math.min(a.x, b.x, c.x) - 1e-6 || x > Math.max(a.x, b.x, c.x) + 1e-6
      || z < Math.min(a.z, b.z, c.z) - 1e-6 || z > Math.max(a.z, b.z, c.z) + 1e-6) continue;
    const determinant = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / determinant;
    const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / determinant;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) return a.y * u + b.y * v + c.y * (1 - u - v);
  }
  return undefined;
}

test("Node startup has exactly the two scene roots and leaves atmosphere and caller arrays alone", () => {
  assert.equal(typeof document, "undefined");
  const w = world();
  assert.deepEqual(w.scene.children, [w.group, w.landscapeGroup]);
  assert.equal(w.scene.background, null); assert.equal(w.scene.fog, null); assert.equal(w.scene.environment, null);
  assert.equal(w.group.name, "wellington/world");
  assert.deepEqual(w.landscapeGroup.children.map(o => o.name).sort(), ["wellington/east-harbour-hills", "wellington/harbour-water"]);
  assert.ok(w.group.getObjectByName("wellington/land"));
  assert.equal(w.counts.labels, 0);
  const scene = new THREE.Scene(), light = new THREE.AmbientLight(), background = new THREE.Color(0x123456);
  scene.add(light); scene.background = background;
  const fog = new THREE.Fog(0x234567, 10, 9000); scene.fog = fog;
  const obstacle = { x: 8000, y: 0, z: 8000, r: 1 }, info = { x: 8000, z: 8000, w: 2, d: 2, h: 3 };
  const obstacles = [obstacle], buildingInfo = [info];
  const other = createWellingtonWorld({ scene, course, obstacles, buildingInfo, tablet: true });
  assert.equal(obstacles[0], obstacle); assert.equal(buildingInfo[0], info); assert.equal(scene.children[0], light);
  assert.equal(scene.background, background); assert.equal(scene.fog, fog);
  assert.equal(other.counts.colliders, obstacles.length - 1); assert.equal(other.counts.buildings, buildingInfo.length - 1);
  dispose(scene);
});

test("land is the exact clipped coast/wharf union with a real lagoon opening and interior hole", () => {
  const w = world(), geometry = w.group.getObjectByName("wellington/land").geometry;
  const triangles = meshTriangles(geometry), loops = w.group.userData.landContours;
  assert.equal(loops.length, 2, "Whairepo joins the outside coast; Te Papa Lagoon stays an interior hole");
  let triangleArea = 0;
  for (const [a, b, c] of triangles) {
    const area = ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
    assert.ok(area < 0, "upward-facing land winding"); triangleArea -= area;
    const x = (a.x + b.x + c.x) / 3, z = (a.z + b.z + c.z) / 3;
    assert.ok(dry(x, z), `land triangle in water at ${x},${z}`);
    for (const p of [a, b, c]) assert.ok(p.y >= 3 && Number.isFinite(p.y));
  }
  const contourArea = loops.reduce((sum, points) => sum + points.reduce((area, a, i) => {
    const b = points[(i + 1) % points.length]; return area + (a.x * b.z - a.z * b.x) / 2;
  }, 0), 0);
  assert.ok(Math.abs(contourArea - triangleArea) < 0.2, "triangulation neither fills holes nor duplicates wharf/land overlap");
  for (const [lat, lon] of [[-41.2886, 174.77905], [-41.28803, 174.77972], [-41.28965, 174.78249], [-41.286, 174.783], [-41.288, 174.788]]) {
    const p = projectWellington(lat, lon);
    assert.equal(dry(p.x, p.z), false, "independent water probe");
    assert.equal(surfaceAt(triangles, p.x, p.z), undefined, `no hidden land slab below water at ${lat},${lon}`);
  }
  for (const wharf of WELLINGTON.wharves) {
    const candidates = [];
    for (let i = 0; i < wharf.points.length; i++) {
      const a = wharf.points[i], b = wharf.points[(i + 1) % wharf.points.length];
      const center = wharf.points.reduce((p, q) => ({ x: p.x + q.x / wharf.points.length, z: p.z + q.z / wharf.points.length }), { x: 0, z: 0 });
      candidates.push({ x: (a.x + b.x + center.x * 2) / 4, z: (a.z + b.z + center.z * 2) / 4 });
    }
    const point = candidates.find(p => isWellingtonLand(p.x, p.z, 0.1));
    assert.ok(point, wharf.name); assert.ok(Math.abs(surfaceAt(triangles, point.x, point.z) - 3) < 1e-4, wharf.name);
  }
  for (let z = -1450; z < 1450; z += 173) for (let x = -1450; x < 1450; x += 157) {
    assert.equal(surfaceAt(triangles, x, z) !== undefined, dry(x, z), `independent geographic coverage ${x},${z}`);
  }
});

test("adaptive inland mesh has <=35m edges, conforming topology and analytic elevation at every inland node", () => {
  const w = world(), geometry = w.group.getObjectByName("wellington/land").geometry;
  const p = geometry.attributes.position, index = geometry.index, edges = new Map();
  let hillVertices = 0, shoreVertices = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    assert.ok(geometry.attributes.normal.getY(i) > 0);
    if (isWellingtonLand(x, z, 0.02)) assert.ok(Math.abs(y - course.heightAt(x, z)) < 0.001, `analytic elevation ${x},${z}`);
    if (y > 25) hillVertices++;
  }
  for (let i = 0; i < index.count; i += 3) for (let j = 0; j < 3; j++) {
    const a = index.getX(i + j), b = index.getX(i + (j + 1) % 3), key = a < b ? `${a}/${b}` : `${b}/${a}`;
    assert.ok(Math.hypot(p.getX(a) - p.getX(b), p.getZ(a) - p.getZ(b)) <= 35.001);
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  const boundary = w.group.userData.landContours.flatMap(loop => loop.map((a, i) => [a, loop[(i + 1) % loop.length]]));
  for (const [key, count] of edges) {
    assert.ok(count <= 2, "no multiply covered seam");
    if (count === 2) continue;
    const [a, b] = key.split("/").map(Number), x = (p.getX(a) + p.getX(b)) / 2, z = (p.getZ(a) + p.getZ(b)) / 2;
    assert.ok(boundary.some(([c, d]) => distance(x, z, c, d) < 0.001), "every open mesh edge lies on the geographic boundary, never a T junction");
    assert.ok(Math.abs(p.getY(a) - 3) < 0.001 && Math.abs(p.getY(b) - 3) < 0.001, "smooth, level shoreline rather than saw-toothed hills");
    shoreVertices++;
  }
  assert.ok(hillVertices > 3000); assert.ok(shoreVertices > 300);
  assert.ok(Math.max(...p.array.filter((_, i) => i % 3 === 1)) > 190, "Mount Victoria relief is present");
});

test("road, park and beach overlays are ground-following and never bridge the harbour cutouts", () => {
  const w = world();
  for (const name of ["street-paving", "streets", "parks", "oriental-bay-beach"]) {
    const object = w.group.getObjectByName(`wellington/${name}`);
    assert.ok(object, name);
    for (const triangle of meshTriangles(object.geometry)) {
      const x = triangle.reduce((n, p) => n + p.x / 3, 0), z = triangle.reduce((n, p) => n + p.z / 3, 0);
      const radius = Math.max(...triangle.map(p => Math.hypot(p.x - x, p.z - z)));
      assert.ok(isWellingtonLand(x, z, Math.max(0, radius - 0.002)), `${name} is wholly over dry terrain`);
      for (const p of triangle) assert.ok(p.y > course.heightAt(p.x, p.z) && p.y - course.heightAt(p.x, p.z) < 0.1);
    }
  }
  const beach = new THREE.Box3().setFromObject(w.group.getObjectByName("wellington/oriental-bay-beach"));
  assert.ok(beach.min.x > 770 && beach.max.x < 1250 && beach.max.z < -300 && beach.min.z > -650);
});

test("landmark massing is georeferenced, named, rotated, height-correct and architecturally distinct", () => {
  const w = world(), bounds = new Map(), features = new Map();
  w.group.traverse(object => {
    if (!object.userData.parts) return;
    const positions = object.geometry.attributes.position;
    for (const part of object.userData.parts) {
      const p = WELLINGTON.landmarks.find(p => p.id === part.id), c = Math.cos(p.rotation), s = Math.sin(p.rotation);
      if (!bounds.has(part.id)) { bounds.set(part.id, new THREE.Box3()); features.set(part.id, new Set()); }
      features.get(part.id).add(part.feature);
      for (let i = part.start; i < part.start + part.count; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(positions, i), dx = vertex.x - p.x, dz = vertex.z - p.z;
        assert.ok(Math.abs(c * dx - s * dz) <= p.w / 2 + 0.5 && Math.abs(s * dx + c * dz) <= p.d / 2 + 0.5, `${p.id} geometry respects the mapped rotated footprint`);
        bounds.get(part.id).expandByPoint(vertex);
      }
    }
  });
  const exterior = WELLINGTON.landmarks.filter(p => p.h && p.type !== "wharenui");
  assert.equal(bounds.size, exterior.length);
  for (const p of exterior) {
    const anchor = w.group.getObjectByName(`wellington/landmark/${p.id}`), box = bounds.get(p.id);
    const info = w.buildingInfo.find(b => b.id === p.id);
    assert.equal(anchor.position.x, p.x); assert.equal(anchor.position.z, p.z); assert.equal(anchor.rotation.y, p.rotation);
    assert.equal(anchor.position.y, info.foundationY);
    assert.ok(Math.abs(box.max.y - info.foundationY - p.h) < 0.001, `${p.id} published/estimated above-foundation height`);
    assert.ok(Math.abs(box.min.y - info.y) < 0.001, `${p.id} foundation connects to ground`);
    assert.ok(box.min.x <= p.x && box.max.x >= p.x && box.min.z <= p.z && box.max.z >= p.z);
    assert.ok(Math.abs(info.y + info.h - box.max.y) < 0.001, `${p.id} collider/shadow top`);
  }
  const expected = {
    beehive: ["tiered-circular-glazing", "circular-floor-bands", "copper-dome"],
    parliament: ["portico-colonnade", "classical-pediment"], railway: ["portico-colonnade"],
    majestic: ["curved-glazed-shaft", "pale-crown-upper"], stateinsurance: ["tower-shaft", "flat-tower-crown"],
    tepapa: ["terracotta-west-volume", "pale-east-volume", "angular-museum-roof"],
    takina: ["curving-gold-facade", "bronze-facade-fins"], michaelfowler: ["sculpted-hall-roof"],
    queensshed1: ["wharf-gabled-roof"], boatsheds: ["wharf-gabled-roof"],
    clydequay: ["long-glazed-apartments", "continuous-balcony-bands"],
    orientalboatsheds: ["blue-boat-shed-row"], stgerard: ["twin-warm-masonry-wings", "church-and-monastery-gables"],
  };
  for (const [id, names] of Object.entries(expected)) for (const name of names) assert.ok(features.get(id).has(name), `${id}/${name}`);
  assert.equal(w.buildingInfo.find(b => b.id === "majestic").architecturalHeight, 116);
  assert.equal(w.buildingInfo.find(b => b.id === "stateinsurance").architecturalHeight, 103);
  assert.equal(w.buildingInfo.filter(b => b.id === "aon").length, 0);
  assert.equal(w.group.getObjectByName("wellington/landmark/wharenui"), undefined);
  assert.equal(w.obstacles.some(o => o.id === "wharenui"), false); assert.equal(bounds.has("wharenui"), false);
  assert.deepEqual(w.group.getObjectByName("wellington/landmark/tepapa").userData.interior, ["wharenui"]);
  const stgerard = w.buildingInfo.find(b => b.id === "stgerard");
  assert.ok(stgerard.foundationY > 3 && stgerard.foundationY >= course.heightAt(stgerard.x, stgerard.z));
});

test("all collider chains are inscribed in mapped footprints, with finite vertical metadata", () => {
  const w = world(), byId = new Map(w.buildingInfo.map(b => [b.id, b]));
  for (const o of w.obstacles) {
    for (const key of ["x", "y", "z", "r", "height"]) assert.ok(Number.isFinite(o[key]), `${o.id ?? o.kind}/${key}`);
    assert.ok(o.height > 0 && o.r > 0);
    if (o.kind === "tree") { assert.equal(o.y, course.heightAt(o.x, o.z)); continue; }
    const p = byId.get(o.id); assert.ok(p);
    assert.equal(o.y, p.y); assert.equal(o.height, p.h);
    const c = Math.cos(p.rotation), s = Math.sin(p.rotation), dx = o.x - p.x, dz = o.z - p.z;
    if (o.hx === undefined) {
      assert.ok(Math.abs(c * dx - s * dz) + o.r <= p.w / 2 + 1e-6, p.id);
      assert.ok(Math.abs(s * dx + c * dz) + o.r <= p.d / 2 + 1e-6, p.id);
    } else { assert.equal(p.kind, "urban"); assert.equal(o.hx, p.w / 2); assert.equal(o.hz, p.d / 2); }
  }
});

test("the entire continuous 8.5m route corridor clears every world collider", () => {
  const w = world();
  for (const o of w.obstacles) for (let i = 0; i < course.route.length; i++) {
    const a = course.route[i], b = course.route[(i + 1) % course.route.length];
    if (Math.min(a.x, b.x) > o.x + o.r + 8.5 || Math.max(a.x, b.x) < o.x - o.r - 8.5
      || Math.min(a.z, b.z) > o.z + o.r + 8.5 || Math.max(a.z, b.z) < o.z - o.r - 8.5) continue;
    if (o.hx === undefined) assert.ok(distance(o.x, o.z, a, b) > o.r + 8.5, o.name ?? "tree");
    else {
      // The circumscribed urban clearance used during placement is stronger
      // than rectangle clearance and covers every point of each route segment.
      assert.ok(distance(o.x, o.z, a, b) > o.r + 8.5, o.id);
    }
  }
});

test("surrounding fabric is clustered inland, clears full street widths, parks and all mapped landmarks", () => {
  const w = world(), urban = w.buildingInfo.filter(b => b.kind === "urban");
  assert.ok(urban.length >= 350 && urban.length < 650);
  assert.ok(urban.filter(p => p.x < -360).length > urban.length * 0.8);
  const streetSegments = WELLINGTON.streets.flatMap(s => s.points.slice(1).map((b, i) => ({ a: s.points[i], b, width: s.width })));
  for (const p of urban) {
    const radius = Math.hypot(p.w, p.d) / 2;
    assert.ok(isWellingtonLand(p.x, p.z, radius + 3));
    for (const s of streetSegments) assert.ok(distance(p.x, p.z, s.a, s.b) > s.width / 2 + radius + 2);
    for (const landmark of WELLINGTON.landmarks) {
      const dx = p.x - landmark.x, dz = p.z - landmark.z, c = Math.cos(landmark.rotation), s = Math.sin(landmark.rotation);
      assert.ok(Math.hypot(Math.max(0, Math.abs(c * dx - s * dz) - landmark.w / 2), Math.max(0, Math.abs(s * dx + c * dz) - landmark.d / 2)) > radius + 8);
    }
    assert.ok(p.architecturalHeight >= 10 && p.architecturalHeight < 60);
  }
  for (let i = 0; i < urban.length; i++) for (let j = i + 1; j < urban.length; j++) {
    assert.ok(Math.abs(urban[i].x - urban[j].x) > (urban[i].w + urban[j].w) / 2 || Math.abs(urban[i].z - urban[j].z) > (urban[i].d + urban[j].d) / 2);
  }
});

test("desktop/tablet keep identical safety and skyline with bounded instancing and draw budgets", () => {
  const desktop = world(), tablet = world(true);
  assert.deepEqual(tablet.obstacles, desktop.obstacles); assert.deepEqual(tablet.buildingInfo, desktop.buildingInfo); assert.deepEqual(tablet.sites, desktop.sites);
  assert.ok(tablet.counts.triangles < desktop.counts.triangles * 0.9);
  for (const w of [desktop, tablet]) {
    let meshes = 0, instances = 0, triangles = 0, instancedMeshes = 0;
    w.scene.traverse(o => {
      if (!o.isMesh) return;
      meshes++; assert.ok(!Array.isArray(o.material)); assert.equal(o.geometry.groups.length, 0);
      assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));
      assert.equal(o.material.map, null, "no network or canvas textures needed in Node");
      if (o.isInstancedMesh) {
        instances += o.count; instancedMeshes++;
        assert.ok(o.instanceMatrix.array.every(Number.isFinite)); assert.ok(o.instanceColor.array.every(Number.isFinite));
        assert.ok(Number.isFinite(o.boundingSphere.radius) && o.frustumCulled);
      }
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    });
    assert.equal(meshes, w.counts.meshes); assert.equal(meshes, w.counts.drawCalls);
    assert.equal(instances, w.counts.instances); assert.equal(triangles, w.counts.triangles);
    assert.ok(meshes < 120, `${meshes} draw calls`); assert.ok(triangles < 400000, `${triangles} rendered triangles`);
    assert.ok(instancedMeshes > 20 && instances > 7000); assert.ok(w.counts.terrainTriangles < 80000);
    assert.equal(w.counts.colliders, w.obstacles.length); assert.equal(w.counts.buildings, w.buildingInfo.length);
  }
});

test("sea is blue-green, flat at zero, subtly shader-animated; distant relief stays east/northeast", () => {
  const w = world(), water = w.landscapeGroup.getObjectByName("wellington/harbour-water");
  const bounds = new THREE.Box3().setFromObject(water);
  assert.ok(bounds.min.x <= -4000 && bounds.max.x >= 4000 && bounds.min.z <= -4000 && bounds.max.z >= 4000);
  assert.ok(Math.abs(bounds.min.y) < 1e-8 && Math.abs(bounds.max.y) < 1e-8);
  assert.equal(water.material.color.getHex(), 0x397b83);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  water.material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes("vHarbour =")); assert.ok(shader.fragmentShader.includes("vec3 waterNormal"));
  assert.ok(shader.fragmentShader.includes("#include <fog_fragment>"), "standard atmosphere integration retained");
  assert.ok(shader.fragmentShader.includes("uWellingtonTime * .8"));
  assert.equal(shader.uniforms.uWellingtonTime.value, 0); w.animate(19.5); assert.equal(shader.uniforms.uWellingtonTime.value, 19.5);
  w.animate(NaN); assert.equal(shader.uniforms.uWellingtonTime.value, 19.5);
  const hills = new THREE.Box3().setFromObject(w.landscapeGroup.getObjectByName("wellington/east-harbour-hills"));
  assert.ok(hills.min.x > 3500 && hills.max.z > 6500 && hills.max.y > 250 && hills.max.y < 500);
  assert.ok(hills.min.z > -1500, "not a generic surrounding mountain ring");
});

test("browser labels are optional, modest sprites; reduced motion freezes only the sea", t => {
  const oldDocument = globalThis.document, oldMatchMedia = globalThis.matchMedia, texts = [], preference = { matches: true };
  globalThis.document = { createElement(name) {
    assert.equal(name, "canvas");
    return { width: 0, height: 0, getContext: () => ({ fillRect() {}, fillText(text) { texts.push(text); } }) };
  } };
  globalThis.matchMedia = query => { assert.equal(query, "(prefers-reduced-motion: reduce)"); return preference; };
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldMatchMedia === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = oldMatchMedia;
  });
  const scene = new THREE.Scene(), w = createWellingtonWorld({ scene, course, tablet: true });
  let labels = 0;
  scene.traverse(o => {
    if (!o.isSprite) return;
    labels++; assert.ok(o.scale.x <= 26 && o.scale.y <= 3.25); assert.ok(o.material.map.isCanvasTexture);
    assert.equal(o.material.map.colorSpace, THREE.SRGBColorSpace); assert.equal(o.material.depthTest, true);
  });
  assert.equal(labels, 11); assert.equal(w.counts.labels, labels); assert.equal(w.counts.drawCalls, w.counts.meshes + labels);
  assert.ok(texts.includes("TE PAPA") && texts.includes("AON CENTRE"));
  assert.equal(texts.some(text => text.includes("HAWAIKI")), false, "no invented outside wharenui sign");
  const time = w.landscapeGroup.getObjectByName("wellington/harbour-water").material.userData.time;
  w.animate(5); assert.equal(time.value, 0); preference.matches = false; w.animate(6); assert.equal(time.value, 6);
  dispose(scene);
});

function recordingContext() {
  const records = [], stack = [];
  const ctx = {
    records, fillStyle: "original-fill", strokeStyle: "original-stroke", lineWidth: 7, lineCap: "butt", lineJoin: "miter", path: [],
    save() { stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin }); },
    restore() { Object.assign(this, stack.pop()); },
    beginPath() { this.path = []; },
    moveTo(x, y) { this.path.push(["move", x, y]); }, lineTo(x, y) { this.path.push(["line", x, y]); }, closePath() { this.path.push(["close"]); },
    fill(rule) { records.push({ op: "fill", color: this.fillStyle, rule, path: this.path.slice() }); },
    stroke() { records.push({ op: "stroke", color: this.strokeStyle, width: this.lineWidth, path: this.path.slice() }); },
    clip(rule) { records.push({ op: "clip", rule, path: this.path.slice() }); },
    fillRect(...args) { records.push({ op: "rect", color: this.fillStyle, args }); },
    strokeText() {},
    fillText(text, x, y) { records.push({ op: "label", text, x, y }); },
  };
  return ctx;
}
test("minimap contract uses x*scale,-z*scale, exact holes/wharves, rotated footprints and no duplicate markers", () => {
  const w = world(), ctx = recordingContext(), scale = 0.082;
  w.drawMap(ctx, scale);
  assert.equal(ctx.fillStyle, "original-fill"); assert.equal(ctx.strokeStyle, "original-stroke"); assert.equal(ctx.lineWidth, 7);
  assert.equal(ctx.lineCap, "butt"); assert.equal(ctx.lineJoin, "miter");
  assert.deepEqual(ctx.records[0], { op: "rect", color: "#397b83", args: [-8000 * scale, -8000 * scale, 16000 * scale, 16000 * scale] });
  const land = ctx.records.find(r => r.op === "fill" && r.rule === "evenodd");
  assert.ok(land); assert.equal(land.path.filter(p => p[0] === "move").length, 2);
  assert.equal(ctx.records.filter(r => r.op === "clip" && r.rule === "evenodd").length, 1);
  const wharves = ctx.records.filter(r => r.color === "#c2bd9f"); assert.equal(wharves.length, WELLINGTON.wharves.length);
  for (let i = 0; i < wharves.length; i++) assert.deepEqual(wharves[i].path[0], ["move", WELLINGTON.wharves[i].points[0].x * scale, -WELLINGTON.wharves[i].points[0].z * scale]);
  const streets = ctx.records.filter(r => r.op === "stroke"); assert.equal(streets.length, WELLINGTON.streets.length);
  for (let i = 0; i < streets.length; i++) assert.deepEqual(streets[i].path, WELLINGTON.streets[i].points.map((p, j) => [j ? "line" : "move", p.x * scale, -p.z * scale]));
  const buildings = ctx.records.filter(r => r.color === "#856f57"); assert.equal(buildings.length, w.counts.landmarks);
  const p = WELLINGTON.landmarks.find(p => p.id === "railway"), c = Math.cos(p.rotation), s = Math.sin(p.rotation);
  assert.ok(buildings.some(b => Math.abs(b.path[0][1] - (p.x - c * p.w / 2 - s * p.d / 2) * scale) < 1e-9
    && Math.abs(b.path[0][2] + (p.z + s * p.w / 2 - c * p.d / 2) * scale) < 1e-9));
  assert.equal(w.sites.length, WELLINGTON.landmarks.length);
  for (const site of w.sites) {
    const p = WELLINGTON.landmarks.find(p => p.id === site.id);
    assert.equal(site.name, p.name); assert.equal(site.x, p.x); assert.equal(site.z, p.z); assert.ok(site.radius > 0); assert.deepEqual(site.access, []);
  }
  assert.equal(w.sites.find(s => s.id === "wharenui").interior, "tepapa");
  assert.deepEqual(ctx.records.filter(r => r.op === "label").map(r => r.text), ["Parliament", "Queens Wharf", "Te Papa", "Oriental Bay"]);
  assert.ok(w.sites.find(s => s.id === "railway").z > w.sites.find(s => s.id === "tepapa").z, "north is up, no second inversion");
});

test("coarse hill triangles never protrude through mapped coastal roads", () => {
  const land = world().group.getObjectByName("wellington/land");
  land.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  for (const street of WELLINGTON.streets) for (let i = 1; i < street.points.length; i++) {
    const a = street.points[i - 1], b = street.points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
    for (const t of [.2, .5, .8]) for (const side of [-1, 0, 1]) {
      const x = a.x + (b.x - a.x) * t - (b.z - a.z) / length * street.width / 2 * side;
      const z = a.z + (b.z - a.z) * t + (b.x - a.x) / length * street.width / 2 * side;
      if (!isWellingtonLand(x, z, 1)) continue;
      ray.ray.origin.set(x, 400, z);
      const hit = ray.intersectObject(land)[0];
      assert.ok(hit, street.name);
      assert.ok(hit.point.y <= course.heightAt(x, z) + .02, `${street.name}: hill covers road at ${x},${z}`);
    }
  }
});
