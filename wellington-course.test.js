import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import * as layoutExports from "./wellington-layout.js";
import * as courseExports from "./wellington-course.js";

const { WELLINGTON, projectWellington, isWellingtonLand, wellingtonHeightAt } = layoutExports;
const { createWellingtonCourse } = courseExports;
const course = createWellingtonCourse(), { route } = course;
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const cross = (a, b, p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
function distance(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}
function intersects(a, b, c, d) {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)
      || Math.max(a.z, b.z) < Math.min(c.z, d.z) || Math.max(c.z, d.z) < Math.min(a.z, b.z)) return false;
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}
function inside(p, polygon) {
  let result = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (distance(p, a, b) < 1e-8) return true;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < a.x + (b.x - a.x) * (p.z - a.z) / (b.z - a.z)) result = !result;
  }
  return result;
}
function buildingDistance(p, b) {
  const x = p.x - b.x, z = p.z - b.z, c = Math.cos(b.rotation), s = Math.sin(b.rotation);
  return Math.hypot(Math.max(0, Math.abs(c * x - s * z) - b.w / 2), Math.max(0, Math.abs(s * x + c * z) - b.d / 2));
}
function bruteNearest(x, z) {
  let best = { distance: Infinity }, along = 0;
  for (let i = 0; i < route.length; i++) {
    const a = route[i], b = route[(i + 1) % route.length], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz), length = a.distanceTo(b);
    if (d < best.distance) best = { distance: d, index: i, t, height: a.y + (b.y - a.y) * t, along: (along + length * t) % course.length };
    along += length;
  }
  return best;
}

test("Wellington exposes only the agreed interfaces and deeply immutable layout", () => {
  assert.deepEqual(Object.keys(layoutExports).sort(), ["WELLINGTON", "isWellingtonLand", "projectWellington", "wellingtonHeightAt"].sort());
  assert.deepEqual(Object.keys(courseExports), ["createWellingtonCourse"]);
  assert.deepEqual(Object.keys(course).sort(), ["route", "heightAt", "roadDistance", "nearest", "halfSize", "length", "elevation", "isSafePosition"].sort());
  assert.equal(WELLINGTON.halfSize, 1500);
  assert.equal(course.heightAt, wellingtonHeightAt);
  function frozen(value) {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) if (child && typeof child === "object") frozen(child);
  }
  frozen(WELLINGTON);
  for (const collection of [WELLINGTON.wharves, WELLINGTON.waterHoles, WELLINGTON.streets, WELLINGTON.landmarks]) {
    assert.equal(new Set(collection.map(p => p.name)).size, collection.length);
  }
  for (const b of WELLINGTON.landmarks) {
    assert.deepEqual(Object.keys(b).sort(), ["id", "name", "x", "z", "w", "d", "h", "rotation", "type"].sort());
    assert.ok([b.x, b.z, b.w, b.d, b.h, b.rotation].every(Number.isFinite));
    assert.ok(b.w > 0 && b.d > 0 && b.h >= 0 && b.type.length > 0);
  }
});

test("WGS84 projection keeps north positive and real metre-scale separations", () => {
  assert.deepEqual(projectWellington(-41.286, 174.783), { x: 0, z: 0 });
  const east = projectWellington(-41.286, 174.793), north = projectWellington(-41.276, 174.783);
  close(east.x, 837.7, 0.4);
  close(north.z, 1110.6, 0.4);
  assert.equal(east.z, 0);
  assert.equal(north.x, 0);
  const parliament = WELLINGTON.landmarks.find(p => p.id === "parliament"), papa = WELLINGTON.landmarks.find(p => p.id === "tepapa");
  assert.ok(parliament.z > 900 && papa.z < -450);
  assert.ok(-parliament.z < -papa.z, "existing minimap's -z puts Parliament above Te Papa");
  assert.ok(Math.hypot(parliament.x - papa.x, parliament.z - papa.z) > 1400);
});

test("bounded coast, wharves and lagoon cutouts are simple nondegenerate polygons", () => {
  assert.ok(WELLINGTON.coast.length > 55);
  assert.ok(WELLINGTON.wharves.length >= 4 && WELLINGTON.waterHoles.length >= 1);
  for (const polygon of [WELLINGTON.coast, ...WELLINGTON.wharves.map(p => p.points), ...WELLINGTON.waterHoles.map(p => p.points)]) {
    assert.ok(polygon.length >= 3);
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.5);
      assert.ok(Math.abs(a.x) <= 1500 && Math.abs(a.z) <= 1500);
      for (let j = i + 2; j < polygon.length; j++) {
        if (i === 0 && j === polygon.length - 1) continue;
        assert.ok(!intersects(a, b, polygon[j], polygon[(j + 1) % polygon.length]), `polygon crossing ${i}/${j}`);
      }
    }
  }
});

test("shared land mask preserves harbour, marina inlets, parks and the lagoon", () => {
  for (const [lat, lon, expected] of [
    [-41.286, 174.783, false], [-41.288652, 174.779037, false],
    [-41.2897, 174.7848, false], [-41.2909, 174.7875, false], [-41.289, 174.793, false],
    [-41.27778, 174.77635, true], [-41.2871, 174.7788, true],
    [-41.29135, 174.78455, true], [-41.2918, 174.794, true],
  ]) {
    const p = projectWellington(lat, lon);
    assert.equal(isWellingtonLand(p.x, p.z), expected, `${lat},${lon}`);
    if (!expected) assert.ok(wellingtonHeightAt(p.x, p.z) < WELLINGTON.waterY);
  }
  for (let x = -1495; x < 1500; x += 29) for (let z = -1491; z < 1500; z += 31) {
    const p = { x, z }, expected = [WELLINGTON.coast, ...WELLINGTON.wharves.map(p => p.points)].some(poly => inside(p, poly))
      && !WELLINGTON.waterHoles.some(hole => inside(p, hole.points));
    assert.equal(isWellingtonLand(x, z), expected, `${x},${z}`);
  }
});

test("circular margins cross wharf attachment seams but never shoreline, lagoon or world edges", () => {
  const wharf = WELLINGTON.wharves[0], a = wharf.points[0], b = wharf.points.at(-1);
  const seam = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  assert.ok(isWellingtonLand(seam.x, seam.z, 10), "union attachment is not exposed water");
  const c = wharf.points[3], d = wharf.points[4];
  assert.ok(!isWellingtonLand((c.x + d.x) / 2, (c.z + d.z) / 2, 0.1));
  assert.ok(isWellingtonLand(-1490, -1400, 9.99));
  assert.ok(!isWellingtonLand(-1490, -1400, 10.01));
  assert.ok(!isWellingtonLand(-1500.01, -1400));
  const hole = WELLINGTON.waterHoles[0].points[3];
  assert.ok(!isWellingtonLand(hole.x, hole.z));
  for (const [x, z, margin] of [[NaN, 0, 0], [0, Infinity, 0], [-1000, -1000, NaN], [-1000, -1000, -1]]) {
    assert.equal(isWellingtonLand(x, z, margin), false);
    assert.equal(course.isSafePosition(x, z, margin), false);
  }
  for (const b of WELLINGTON.landmarks.filter(b => b.h > 0)) assert.ok(!course.isSafePosition(b.x, b.z), b.id);
});

test("landmark order, actual tower identities, wharenui context and hill silhouette are retained", () => {
  const b = Object.fromEntries(WELLINGTON.landmarks.map(b => [b.id, b]));
  for (const id of ["beehive", "parliament", "railway", "bowen", "majestic", "stateinsurance", "intercontinental",
    "tsbarena", "queensshed1", "tepapa", "wharenui", "wharewaka", "michaelfowler", "citygallery", "takina", "whairepo", "boatsheds", "stgerard"]) assert.ok(b[id], id);
  assert.equal(b.majestic.h, 116);
  assert.equal(b.stateinsurance.h, 103);
  assert.match(b.stateinsurance.name, /Aon Centre/);
  assert.doesNotMatch(b.majestic.name, /Aon/);
  assert.ok(b.majestic.z < b.stateinsurance.z && b.majestic.x < b.stateinsurance.x);
  assert.equal(b.beehive.h, 72);
  assert.equal(b.bowen.h, 90);
  assert.ok(b.parliament.z > b.beehive.z && b.beehive.z > b.bowen.z);
  assert.ok(b.railway.x > b.parliament.x && b.railway.z > b.queensshed1.z);
  assert.ok(b.queensshed1.z > b.frankkitts.z && b.frankkitts.z > b.whairepo.z && b.whairepo.z > b.tepapa.z);
  assert.ok(b.takina.z < b.tepapa.z && b.stgerard.x > b.waitangi.x);
  assert.match(b.wharenui.name, /inside Te Papa, Level 4/);
  const mount = WELLINGTON.hills[0];
  close(wellingtonHeightAt(mount.x, mount.z), 196);
  assert.ok(wellingtonHeightAt(b.stgerard.x, b.stgerard.z) > 25);
  assert.equal(wellingtonHeightAt(b.frankkitts.x, b.frankkitts.z), WELLINGTON.landY);
  for (const [x, z] of [[1e6, 1e6], [-1e12, 1e12], [1500, 1500]]) assert.ok(Number.isFinite(wellingtonHeightAt(x, z)));
});

test("deterministic closed circuit reports exact route-segment length, elevation and lap seam", () => {
  assert.deepEqual(createWellingtonCourse().route, route);
  assert.ok(course.length > 3800 && course.length < 4400);
  assert.ok(route.length < 1800);
  let length = 0, gain = 0;
  for (let i = 0; i < route.length; i++) {
    const p = route[i], next = route[(i + 1) % route.length], spacing = p.distanceTo(next);
    assert.ok(p instanceof Vector3 && [p.x, p.y, p.z].every(Number.isFinite));
    assert.ok(spacing > 0.05 && spacing <= 3.0000001);
    assert.equal(p.y, course.heightAt(p.x, p.z));
    close(course.nearest(p.x, p.z).distance, 0);
    close(course.roadDistance(p.x, p.z), 0);
    length += spacing;
    gain += Math.max(0, next.y - p.y);
  }
  close(course.length, length);
  close(course.elevation.gain, gain);
  close(course.elevation.min, Math.min(...route.map(p => p.y)));
  close(course.elevation.max, Math.max(...route.map(p => p.y)));
  const seam = route.at(-1).clone().lerp(route[0], 0.5), hit = course.nearest(seam.x, seam.z);
  assert.equal(hit.index, route.length - 1);
  close(hit.t, 0.5);
  close(hit.along, course.length - route.at(-1).distanceTo(route[0]) / 2);
});

test("sparse nearest matches exhaustive resampled-route projection, including distant queries", () => {
  let seed = 7723;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const samples = [[0, 0], [32, -32], [-1500, 1500], [1e6, -1e6], [-1e6, 1e6]];
  for (let i = 0; i < 700; i++) samples.push([3000 * random() - 1500, 3000 * random() - 1500]);
  for (const [x, z] of samples) {
    const hit = course.nearest(x, z), expected = bruteNearest(x, z);
    assert.deepEqual(Object.keys(hit).sort(), ["distance", "index", "t", "height", "bank", "along"].sort());
    close(hit.distance, expected.distance);
    close(hit.height, expected.height);
    assert.ok(Number.isInteger(hit.index) && hit.index >= 0 && hit.index < route.length);
    assert.ok(hit.t >= 0 && hit.t <= 1 && hit.along >= 0 && hit.along < course.length);
    const p = route[hit.index].clone().lerp(route[(hit.index + 1) % route.length], hit.t);
    close(Math.hypot(x - p.x, z - p.z), hit.distance);
    assert.ok(Number.isFinite(hit.bank) && Math.abs(hit.bank) < 0.08);
    close(hit.along, expected.along, 1e-6);
  }
});

test("whole 6.5 m shoulders plus 2 m reserve clear land edges and every rotated building", () => {
  const buildings = WELLINGTON.landmarks.filter(b => b.h > 0);
  for (let i = 0; i < route.length; i++) {
    const a = route[i], b = route[(i + 1) % route.length], length = a.distanceTo(b);
    const count = Math.ceil(length / 0.5), reserve = 8.5 + length / count / 2;
    for (let j = 0; j <= count; j++) {
      const p = a.clone().lerp(b, j / count);
      // Extra half-sample clearance proves the intervening segment is safe too.
      assert.ok(isWellingtonLand(p.x, p.z, reserve), `land clearance at ${i}:${j}`);
      for (const building of buildings) assert.ok(buildingDistance(p, building) > reserve, `${building.id} at ${i}:${j}`);
      assert.ok(course.isSafePosition(p.x, p.z, 8.5), `spawn corridor ${i}:${j}`);
      for (const side of [-8.5, 8.5]) {
        const x = p.x - (b.z - a.z) / length * side, z = p.z + (b.x - a.x) / length * side;
        close(course.heightAt(x, z), p.y);
      }
    }
  }
});

test("lap and offset shoulders do not fold or intersect and follow the actual street controls", () => {
  const edges = [-8.5, 8.5].map(side => route.map((p, i) => {
    const prev = route[(i + route.length - 1) % route.length], next = route[(i + 1) % route.length];
    const dx = next.x - prev.x, dz = next.z - prev.z, norm = Math.hypot(dx, dz);
    return { x: p.x - dz / norm * side, z: p.z + dx / norm * side };
  }));
  for (const polygon of [route, ...edges]) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    assert.ok((b.x - a.x) * (route[(i + 1) % route.length].x - route[i].x)
      + (b.z - a.z) * (route[(i + 1) % route.length].z - route[i].z) > 0);
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue;
      assert.ok(!intersects(a, b, polygon[j], polygon[(j + 1) % polygon.length]), `route/edge crossing ${i}/${j}`);
    }
  }
  const arc = [0];
  for (let i = 1; i < route.length; i++) arc.push(arc[i - 1] + route[i - 1].distanceTo(route[i]));
  for (let i = 0; i < route.length; i++) for (let j = i + 2; j < route.length; j++) {
    const separation = Math.min(arc[j] - arc[i], course.length - arc[j] + arc[i]);
    if (separation < 40) continue;
    const a = route[i], b = route[(i + 1) % route.length], c = route[j], d = route[(j + 1) % route.length];
    const dx = Math.max(Math.min(a.x, b.x) - Math.max(c.x, d.x), Math.min(c.x, d.x) - Math.max(a.x, b.x), 0);
    const dz = Math.max(Math.min(a.z, b.z) - Math.max(c.z, d.z), Math.min(c.z, d.z) - Math.max(a.z, b.z), 0);
    if (Math.hypot(dx, dz) > 17) continue;
    assert.ok(Math.min(distance(a, c, d), distance(b, c, d), distance(c, a, b), distance(d, a, b)) > 17,
      `nonlocal 8.5 m corridors overlap at ${i}/${j}`);
  }
  for (const s of WELLINGTON.streets) for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1], b = s.points[i];
    close(course.roadDistance((a.x + b.x) / 2, (a.z + b.z) / 2), 0);
  }
  for (const p of route) {
    let minimum = Infinity;
    for (const s of WELLINGTON.streets.slice(0, 11)) for (let i = 1; i < s.points.length; i++) minimum = Math.min(minimum, distance(p, s.points[i - 1], s.points[i]));
    assert.ok(minimum < 12, "only small junction fillets, no promenade shortcuts");
  }
  const bay = projectWellington(-41.2913304, 174.7940910);
  assert.ok(course.nearest(bay.x, bay.z).distance > 600, "full bay street is scenery, not a duplicate timed out-and-back");
  close(course.roadDistance(bay.x, bay.z), 0);
});
