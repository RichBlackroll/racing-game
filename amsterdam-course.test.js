import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { AMSTERDAM, waterAt, bridgeAt, isAmsterdamDry, amsterdamHeightAt, amsterdamPathLength, sampleAmsterdamPath } from "./amsterdam-layout.js";
import { polygonContains, polygonEdges, pointSegmentSquared, regionBoundary } from "./amsterdam-geometry.js";
import { createAmsterdamCourse } from "./amsterdam-course.js";
import { createCourse } from "./course.js";
import { sampleDrivingSurface } from "./driving-terrain.js";

const course = createAmsterdamCourse();
const { route } = course;
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const cross = (a, b, p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
function pointDistance(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
function intersects(a, b, c, d) {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)
      || Math.max(a.z, b.z) < Math.min(c.z, d.z) || Math.max(c.z, d.z) < Math.min(a.z, b.z)) return false;
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}
function segmentDistance(a, b, c, d) {
  return intersects(a, b, c, d) ? 0 : Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b));
}
function bruteNearest(x, z) {
  let best = Infinity, hit, along = 0;
  for (let i = 0; i < route.length; i++) {
    const a = route[i], b = route[(i + 1) % route.length], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const squared = (x - (a.x + dx * t)) ** 2 + (z - (a.z + dz * t)) ** 2;
    const length = a.distanceTo(b);
    if (squared < best) {
      best = squared;
      hit = { distance: Math.sqrt(best), index: i, t, height: a.y + (b.y - a.y) * t, along: (along + length * t) % course.length };
    }
    along += length;
  }
  return hit;
}
function streetDistance(x, z) {
  let distance = Infinity;
  for (const street of AMSTERDAM.streets) for (let i = 1; i < street.points.length; i++) {
    distance = Math.min(distance, pointDistance({ x, z }, street.points[i - 1], street.points[i]));
  }
  return distance;
}

test("Amsterdam exports immutable curved, nested canals and oriented bridges in the shared world", () => {
  assert.equal(AMSTERDAM.halfSize, 320);
  assert.equal(AMSTERDAM.groundHalfSize, 340);
  assert.equal(AMSTERDAM.landY, 2.4);
  assert.equal(AMSTERDAM.waterY, 0.35);
  assert.equal(AMSTERDAM.bedY, -2);
  assert.deepEqual(AMSTERDAM.canals.map(c => c.name), ["Herengracht", "Keizersgracht", "Prinsengracht", "Amstel", "IJ"]);
  const rings = AMSTERDAM.canals.slice(0, 3);
  for (const [i, canal] of rings.entries()) {
    assert.ok(canal.width >= 14 && canal.width <= 18);
    assert.ok(canal.points.length > 100 && Object.isFrozen(canal.points));
    assert.ok(canal.points[0].z > 278 && canal.points[0].x < -90, "western arm joins the IJ");
    assert.ok(polygonContains(AMSTERDAM.canals[3].polygon, canal.points.at(-1).x, canal.points.at(-1).z), "eastern arm joins the Amstel");
    const minimum = Math.min(...canal.points.map(p => p.z));
    assert.ok(minimum < canal.points[0].z - 240 && minimum < canal.points.at(-1).z, "horseshoe bends south then back east");
    if (i) {
      assert.ok(rings[i - 1].points[0].x - canal.points[0].x > 70);
      assert.ok(Math.min(...rings[i - 1].points.map(p => p.z)) - minimum > 90, "broad nested building plots");
    }
    let diagonal = 0;
    for (let j = 1; j < canal.points.length; j++) {
      const a = canal.points[j - 1], b = canal.points[j], length = Math.hypot(b.x - a.x, b.z - a.z);
      if (Math.min(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) / length > .2) diagonal++;
    }
    assert.ok(diagonal > canal.points.length * .4, "substantial non-grid geometry");
  }
  assert.equal(AMSTERDAM.bridges.length, 16);
  assert.equal(AMSTERDAM.bridges.find(b => b.name === "Magere Brug").kind, "drawbridge");
  assert.ok(AMSTERDAM.bridges.filter(b => Math.abs(Math.sin(2 * b.heading)) > .1).length >= 6);
  for (const b of AMSTERDAM.bridges) {
    assert.equal(b.halfWidth, 10);
    assert.equal(b.rise, 0.85);
    assert.ok(Math.abs(b.x) + Math.abs(Math.sin(b.heading)) * b.halfLength + Math.abs(Math.cos(b.heading)) * b.halfWidth < AMSTERDAM.halfSize);
    assert.ok(Math.abs(b.z) + Math.abs(Math.cos(b.heading)) * b.halfLength + Math.abs(Math.sin(b.heading)) * b.halfWidth < AMSTERDAM.halfSize);
  }
  assert.ok(Object.isFrozen(AMSTERDAM));
  for (const collection of [AMSTERDAM.canals, AMSTERDAM.streets, AMSTERDAM.bridges, AMSTERDAM.landmarks]) {
    assert.ok(Object.isFrozen(collection));
    assert.equal(new Set(collection.map(item => item.name)).size, collection.length);
    for (const item of collection) {
      assert.ok(Object.isFrozen(item));
      assert.ok(item.name.length > 0);
      for (const value of Object.values(item)) if (typeof value === "number") assert.ok(Number.isFinite(value));
    }
  }
  for (const collection of [AMSTERDAM.lap, AMSTERDAM.landPolygons, AMSTERDAM.waterBoundary]) assert.ok(Object.isFrozen(collection));
  for (const c of AMSTERDAM.canals) for (const p of c.polygon) assert.ok(Object.isFrozen(p));
});

test("raw water is the inclusive polygon union, including curved junctions, harbor and water below decks", () => {
  const samples = [[219, 277], [219, 278], [1100, 1100], [1100.001, 1100]];
  for (const c of AMSTERDAM.canals) for (const p of c.polygon) samples.push([p.x, p.z]);
  for (let x = -340; x <= 340; x += 5) for (let z = -340; z <= 340; z += 5) samples.push([x, z]);
  for (const [x, z] of samples) {
    const wet = AMSTERDAM.canals.some(c => polygonContains(c.polygon, x, z));
    assert.equal(waterAt(x, z), wet, `water union at ${x},${z}`);
    assert.equal(isAmsterdamDry(x, z), Math.abs(x) <= 320 && Math.abs(z) <= 320 && (!wet || bridgeAt(x, z) !== null));
    if (!bridgeAt(x, z)) assert.equal(amsterdamHeightAt(x, z), wet ? AMSTERDAM.bedY : AMSTERDAM.landY);
  }
  for (const b of AMSTERDAM.bridges) {
    assert.ok(waterAt(b.x, b.z));
    assert.equal(bridgeAt(b.x, b.z), b);
    assert.ok(isAmsterdamDry(b.x, b.z));
    close(amsterdamHeightAt(b.x, b.z), AMSTERDAM.landY + b.rise);
  }
  assert.equal(bridgeAt(0, 0), null);
  for (const c of AMSTERDAM.canals.slice(0, 3)) {
    const p = c.points.at(-1);
    assert.ok(waterAt(p.x, p.z) && !isAmsterdamDry(p.x, p.z), "overlapping canal mouth is still water");
  }
});

test("dry margins protect circular spawns at banks, bridge sides, approaches and gameplay edges", () => {
  for (const b of AMSTERDAM.bridges) {
    assert.ok(isAmsterdamDry(b.x, b.z, b.halfWidth - .001), b.name);
    assert.ok(!isAmsterdamDry(b.x, b.z, b.halfWidth + .001), b.name);
    const side = { x: b.x + Math.cos(b.heading) * b.halfWidth, z: b.z - Math.sin(b.heading) * b.halfWidth };
    assert.ok(isAmsterdamDry(side.x, side.z));
    assert.ok(!isAmsterdamDry(side.x, side.z, .001));
    const end = { x: b.x + Math.sin(b.heading) * b.halfLength, z: b.z + Math.cos(b.heading) * b.halfLength };
    assert.ok(isAmsterdamDry(end.x, end.z, 11), "approach discs can be wider than the deck because land also supports them");
  }
  assert.ok(isAmsterdamDry(0, 270, 7.999));
  assert.ok(!isAmsterdamDry(0, 270, 8));
  assert.ok(isAmsterdamDry(320, 0));
  assert.ok(isAmsterdamDry(-320, 0));
  assert.ok(isAmsterdamDry(314, 0, 6));
  assert.ok(!isAmsterdamDry(314, 0, 6.001));
  assert.ok(!isAmsterdamDry(320.001, 0));
  assert.ok(!isAmsterdamDry(330, 0), "rendered ground is not extra gameplay space");
  assert.ok(!isAmsterdamDry(0, 320));
  for (const [x, z, margin] of [[NaN, 0, 0], [0, Infinity, 0], [0, 0, NaN], [0, 0, Infinity], [0, 0, -1]]) {
    assert.equal(isAmsterdamDry(x, z, margin), false);
  }
  assert.equal(course.isSafePosition, isAmsterdamDry);
  assert.equal(course.heightAt, amsterdamHeightAt);
});

test("bridge support uses arbitrary headings and full approaches with smooth analytic crests and no end seams", () => {
  for (const b of AMSTERDAM.bridges) {
    const at = (along, across = 0) => ({ x: b.x + Math.sin(b.heading) * along + Math.cos(b.heading) * across,
      z: b.z + Math.cos(b.heading) * along - Math.sin(b.heading) * across });
    const height = along => { const p = at(along); return amsterdamHeightAt(p.x, p.z); };
    for (let along = -b.halfLength - 1; along <= b.halfLength + 1; along += 0.25) {
      const onBridge = Math.abs(along) <= b.halfLength;
      const expected = AMSTERDAM.landY + (onBridge ? b.rise * Math.cos(Math.PI * along / (2 * b.halfLength)) ** 2 : 0);
      for (const across of [-b.halfWidth, 0, b.halfWidth]) {
        const p = at(along, across);
        close(amsterdamHeightAt(p.x, p.z), expected);
        assert.equal(bridgeAt(p.x, p.z), onBridge ? b : null);
        assert.ok(isAmsterdamDry(p.x, p.z));
      }
      const grade = (height(along + 0.0001) - height(along - 0.0001)) / 0.0002;
      assert.ok(Math.abs(grade) < 0.064, `${b.name}: gentle bridge grade`);
    }
    for (const sign of [-1, 1]) {
      close(height(sign * b.halfLength), AMSTERDAM.landY);
      close(height(sign * b.halfLength - 1e-5), height(sign * b.halfLength + 1e-5), 1e-9);
      close((height(sign * b.halfLength + 1e-4) - height(sign * b.halfLength - 1e-4)) / 2e-4, 0, 1e-6);
      const beyondSide = at(0, sign * (b.halfWidth + 1e-5));
      assert.equal(bridgeAt(beyondSide.x, beyondSide.z), null);
      assert.ok(waterAt(beyondSide.x, beyondSide.z));
      assert.equal(amsterdamHeightAt(beyondSide.x, beyondSide.z), AMSTERDAM.bedY);
    }
    close(height(0), AMSTERDAM.landY + b.rise);
  }
});

test("the deterministic, implicitly closed lap starts exactly eastbound and re-evaluates sampled heights", () => {
  assert.deepEqual(createAmsterdamCourse().route, route);
  assert.deepEqual(createCourse("amsterdam").route, route);
  assert.equal(course.halfSize, 320);
  assert.deepEqual(route[0], new Vector3(0, AMSTERDAM.landY, 210));
  assert.ok(route[1].x > 0 && route[1].z === 210);
  assert.ok(route.at(-1).x < 0 && route.at(-1).z === 210);
  assert.ok(route.length < 1600);
  assert.ok(course.length > 1800 && course.length < 1900);
  const spacing = [];
  let length = 0, gain = 0;
  for (let i = 0; i < route.length; i++) {
    const a = route[i], b = route[(i + 1) % route.length];
    assert.ok(a instanceof Vector3 && [a.x, a.y, a.z].every(Number.isFinite));
    assert.ok(a.x >= -310 && a.x <= 262 && a.z >= -222 && a.z <= 211);
    assert.equal(a.y, course.heightAt(a.x, a.z));
    spacing.push(a.distanceTo(b));
    length += a.distanceTo(b);
    gain += Math.max(0, b.y - a.y);
    close(course.nearest(a.x, a.z).distance, 0);
    close(course.nearest(a.x, a.z).height, a.y);
    close(course.roadDistance(a.x, a.z), 0);
  }
  assert.ok(Math.min(...spacing) > 2.4 && Math.max(...spacing) < 3);
  assert.ok(Math.max(...spacing) / Math.min(...spacing) < 1.01);
  close(course.length, length);
  close(course.elevation.gain, gain);
  close(course.elevation.min, Math.min(...route.map(p => p.y)));
  close(course.elevation.max, Math.max(...route.map(p => p.y)));
  assert.ok(gain > 4.2 && gain <= 4.25, "five gentle bridge crossings");
  const crossed = new Set(route.map(p => bridgeAt(p.x, p.z)?.name).filter(Boolean));
  assert.equal(crossed.size, 5);
  assert.ok(crossed.has("Magere Brug"));
  close(course.elevation.min, AMSTERDAM.landY);
  close(course.elevation.max, AMSTERDAM.landY + 0.85, 0.001);
  const seam = route.at(-1).clone().lerp(route[0], 0.5), hit = course.nearest(seam.x, seam.z);
  assert.equal(hit.index, route.length - 1);
  close(hit.t, 0.5);
  close(hit.along, course.length - spacing.at(-1) / 2);
  close(course.nearest(0, 210).along, 0);
});

test("broad curved quays and arbitrary-angle joins have safe radii without harsh grade changes", () => {
  let turns = 0;
  for (let i = 0; i < route.length; i++) {
    const a = route[(i + route.length - 1) % route.length], b = route[i], c = route[(i + 1) % route.length];
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z);
    const area = cross(a, b, c), radius = ab * bc * Math.hypot(c.x - a.x, c.z - a.z) / (2 * Math.abs(area));
    assert.ok(radius > 10, `radius ${radius} at ${i}`);
    if (radius < 1500) turns++;
    const grade = (c.y - b.y) / bc, previous = (b.y - a.y) / ab;
    assert.ok(Math.abs(grade) < 0.064);
    assert.ok(Math.abs(grade - previous) / ((ab + bc) / 2) < 0.02);
    for (const t of [0, 0.5]) {
      const p = b.clone().lerp(c, t);
      assert.ok(streetDistance(p.x, p.z) < .05, "lap uses the actual sampled quay and connector paths");
      close(course.roadDistance(p.x, p.z), 0);
    }
    const before = b.clone().lerp(a, 1e-5), after = b.clone().lerp(c, 1e-5);
    close(course.nearest(before.x, before.z).bank, course.nearest(after.x, after.z).bank, 1e-5);
    close(course.heightAt(before.x, before.z), course.heightAt(after.x, after.z), 1e-5);
  }
  assert.ok(turns > route.length * .4, "curves form a substantial part of the lap");
});

test("the centreline and both 6.5 m road edges have no intersections, folded bends or overlapping corridors", () => {
  const edges = [-6.5, 6.5].map(side => route.map((p, i) => {
    const a = route[(i + route.length - 1) % route.length], b = route[(i + 1) % route.length];
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    return { x: p.x - dz / length * side, z: p.z + dx / length * side };
  }));
  for (const polygon of [route, ...edges]) for (let i = 0; i < route.length; i++) {
    const next = (i + 1) % route.length;
    assert.ok((polygon[next].x - polygon[i].x) * (route[next].x - route[i].x)
      + (polygon[next].z - polygon[i].z) * (route[next].z - route[i].z) > 0, "offset edge never folds backwards");
    for (let j = i + 2; j < route.length; j++) {
      if (i === 0 && j === route.length - 1) continue;
      assert.ok(!intersects(polygon[i], polygon[next], polygon[j], polygon[(j + 1) % route.length]), `intersection ${i}/${j}`);
      if (polygon !== route || Math.min(j - i, route.length - j + i) * course.length / route.length < 24) continue;
      assert.ok(segmentDistance(route[i], route[next], route[j], route[(j + 1) % route.length]) > 13, `nonlocal road overlap ${i}/${j}`);
    }
  }
  for (let i = 0; i < route.length; i++) for (let j = 0; j < route.length; j++) {
    assert.ok(!intersects(edges[0][i], edges[0][(i + 1) % route.length], edges[1][j], edges[1][(j + 1) % route.length]), `opposite road edges ${i}/${j}`);
  }
});

test("path sampling clamps distance and uses the renderer's local +X heading and +z offsets", () => {
  const points = [{ x: 3, z: 4 }, { x: 15, z: 20 }, { x: 45, z: 20 }];
  close(amsterdamPathLength(points), 50);
  const p = sampleAmsterdamPath(points, 10, 5);
  close(p.x, 5); close(p.z, 15); close(p.heading, Math.atan2(-16, 12));
  assert.deepEqual(sampleAmsterdamPath(points, -1), { x: 3, z: 4, heading: Math.atan2(-16, 12) });
  const end = sampleAmsterdamPath(points, 100, 5);
  close(end.x, 45); close(end.z, 25); close(end.heading, 0);
  assert.deepEqual(sampleAmsterdamPath([{ x: 1, z: 2 }], 10, 3), { x: 1, z: 5, heading: 0 });
  assert.equal(amsterdamPathLength([]), 0);
  assert.throws(() => sampleAmsterdamPath([], 0), RangeError);
  for (const street of AMSTERDAM.streets) {
    const length = amsterdamPathLength(street.points);
    for (let d = .1; d < length; d += 37) {
      const p = sampleAmsterdamPath(street.points, d), q = sampleAmsterdamPath(street.points, d, 7);
      close(q.x - p.x, Math.sin(p.heading) * 7);
      close(q.z - p.z, Math.cos(p.heading) * 7);
      const nearby = sampleAmsterdamPath(street.points, d + 1e-5);
      close((nearby.x - p.x) / 1e-5, Math.cos(p.heading), 1e-6);
      close((nearby.z - p.z) / 1e-5, -Math.sin(p.heading), 1e-6);
    }
  }
});

test("renderer water boundaries exclude union seams but never subtract bridges", () => {
  assert.ok(AMSTERDAM.waterBoundary.length > 500);
  let underDeck = 0;
  for (const { a, b } of AMSTERDAM.waterBoundary) {
    const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, length = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / length * 1e-5, nz = (b.x - a.x) / length * 1e-5;
    assert.notEqual(waterAt(x + nx, z + nz), waterAt(x - nx, z - nz), "every exported edge separates land and the raw water union");
    if (bridgeAt(x, z)) underDeck++;
  }
  assert.ok(underDeck >= AMSTERDAM.bridges.length * 2, "renderer, not land geometry, cuts quays below decks");
});

test("cached circular safety equals exhaustive exposed-boundary distance across cell seams and bridge corners", () => {
  const decks = AMSTERDAM.bridges.map(b => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([side, along]) => ({
    x: b.x + Math.cos(b.heading) * side * b.halfWidth + Math.sin(b.heading) * along * b.halfLength,
    z: b.z - Math.sin(b.heading) * side * b.halfWidth + Math.cos(b.heading) * along * b.halfLength,
  })));
  const boundary = regionBoundary([...AMSTERDAM.canals.map(c => c.polygon), ...decks], (x, z) => waterAt(x, z) && !bridgeAt(x, z));
  const samples = [];
  for (let x = -320; x <= 320; x += 32) for (let z = -320; z <= 320; z += 32) {
    samples.push({ x: x + 1e-7, z: z - 1e-7 });
  }
  for (const deck of decks) for (const p of deck) samples.push(p, { x: p.x + 2, z: p.z - 3 });
  for (const p of samples) {
    const distance = Math.sqrt(Math.min(...boundary.map(e => pointSegmentSquared(p.x, p.z, e.a, e.b))));
    for (const margin of [0, 1.9, 6.5, 12, 31, distance - 1e-6, distance + 1e-6]) {
      if (margin < 0) continue;
      const expected = Math.abs(p.x) + margin <= 320 && Math.abs(p.z) + margin <= 320
        && (!waterAt(p.x, p.z) || bridgeAt(p.x, p.z) !== null) && (margin === 0 || distance > margin);
      assert.equal(isAmsterdamDry(p.x, p.z, margin), expected, `${p.x},${p.z}, margin ${margin}`);
    }
  }
});

test("land trapezoids triangulate the ground square minus the exact raw water union", () => {
  const area = polygon => Math.abs(polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]; return sum + p.x * q.z - q.x * p.z;
  }, 0)) / 2;
  let total = 0;
  for (const polygon of AMSTERDAM.landPolygons) {
    assert.ok(polygon.length === 3 || polygon.length === 4);
    assert.ok(Object.isFrozen(polygon));
    const size = area(polygon); assert.ok(size > 0); total += size;
    for (const p of polygon) assert.ok(Math.abs(p.x) <= 340 + 1e-8 && Math.abs(p.z) <= 340 + 1e-8);
    for (let i = 1; i < polygon.length - 1; i++) {
      const triangle = [polygon[0], polygon[i], polygon[i + 1]];
      const x = triangle.reduce((s, p) => s + p.x, 0) / 3, z = triangle.reduce((s, p) => s + p.z, 0) / 3;
      assert.ok(cross(...triangle) > 0, "consistent convex XZ winding for upward renderer triangulation");
      assert.ok(!waterAt(x, z), "no land triangle over water, even under bridges");
    }
  }
  const clipped = regionBoundary([...AMSTERDAM.canals.map(c => c.polygon),
    [{ x: -340, z: -340 }, { x: 340, z: -340 }, { x: 340, z: 340 }, { x: -340, z: 340 }]],
  (x, z) => Math.abs(x) < 340 && Math.abs(z) < 340 && waterAt(x, z));
  let waterArea = 0;
  for (const { a, b } of clipped) {
    const length = Math.hypot(b.x - a.x, b.z - a.z), x = (a.x + b.x) / 2 - (b.z - a.z) / length * 1e-5;
    const z = (a.z + b.z) / 2 + (b.x - a.x) / length * 1e-5;
    const leftWet = Math.abs(x) < 340 && Math.abs(z) < 340 && waterAt(x, z);
    waterArea += (leftWet ? 1 : -1) * (a.x * b.z - b.x * a.z) / 2;
  }
  close(total + waterArea, 680 ** 2, 1e-6);
  for (let x = -339.123; x < 340; x += 17.13) for (let z = -338.456; z < 340; z += 19.27) {
    const covering = AMSTERDAM.landPolygons.filter(p => z > p[0].z && z < p.at(-1).z && polygonContains(p, x, z));
    assert.equal(covering.length, waterAt(x, z) ? 0 : 1, `exact, nonoverlapping land coverage at ${x},${z}`);
  }
});

test("the complete road corridor and wheel contacts remain dry through every bridge and rounded approach", () => {
  for (let i = 0; i < route.length; i++) {
    const a = route[i], b = route[(i + 1) % route.length], length = Math.hypot(b.x - a.x, b.z - a.z);
    const fx = (b.x - a.x) / length, fz = (b.z - a.z) / length, heading = Math.atan2(fx, fz);
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const p = a.clone().lerp(b, t);
      assert.ok(course.isSafePosition(p.x, p.z, 6.5), `full corridor at ${i}:${t}`);
      for (const side of [-6.5, 0, 6.5]) {
        const x = p.x - fz * side, z = p.z + fx * side;
        assert.ok(isAmsterdamDry(x, z));
        assert.ok(course.heightAt(x, z) >= AMSTERDAM.landY);
      }
      for (const lane of [-4, -1.65, 0, 1.65, 4]) {
        const x = p.x - fz * lane, z = p.z + fx * lane;
        for (const forward of [-1.45, 1.45]) for (const side of [-0.85, 0.85]) {
          const wx = x + fx * forward - fz * side, wz = z + fz * forward + fx * side;
          assert.ok(isAmsterdamDry(wx, wz), `wheel support at ${i}:${t}:${lane}`);
          assert.ok(course.heightAt(wx, wz) >= AMSTERDAM.landY);
        }
        const pose = sampleDrivingSurface(course.heightAt, x, z, heading);
        assert.ok(Object.values(pose).every(Number.isFinite));
        assert.ok(pose.height >= AMSTERDAM.landY && pose.height <= AMSTERDAM.landY + 0.85);
        assert.ok(Math.abs(pose.grade) < 0.1);
      }
    }
  }
});

test("nearest agrees exactly with exhaustive closed-segment projection at cache boundaries and outside the world", () => {
  let seed = 417;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const samples = [[0, 210], [0, 0], [1e6, -1e6], [-1e6, 1e6], [1e12, -1e12], [-10000, -10000]];
  for (let x = -352; x <= 352; x += 32) for (let z = -352; z <= 352; z += 32) {
    samples.push([x, z], [x - 1e-7, z + 1e-7], [x + 1e-7, z - 1e-7]);
  }
  for (let i = 0; i < 600; i++) samples.push([(random() * 2 - 1) * 340, (random() * 2 - 1) * 340]);
  for (let i = 0; i < route.length; i += 7) samples.push([route[i].x, route[i].z]);
  for (const [x, z] of samples) {
    const expected = bruteNearest(x, z), actual = course.nearest(x, z);
    for (const key of ["distance", "height", "t", "along"]) close(actual[key], expected[key]);
    assert.equal(actual.index, expected.index);
    assert.ok(Number.isFinite(actual.bank) && Math.abs(actual.bank) < 0.064);
    assert.ok(actual.along >= 0 && actual.along < course.length);
  }
});

test("roadDistance covers every finite street, not just the lap, and all street corridors have bridge support", () => {
  for (const s of AMSTERDAM.streets) {
    const length = amsterdamPathLength(s.points), count = Math.ceil(length * 2);
    for (let i = 0; i <= count; i++) {
      const { x, z } = sampleAmsterdamPath(s.points, length * i / count);
      close(course.roadDistance(x, z), 0);
      assert.ok(isAmsterdamDry(x, z, 6.5), `${s.name}: full street corridor at ${x},${z}`);
    }
  }
  for (const name of ["Herengracht Inner Quay", "Keizersgracht Outer Quay", "Leidsestraat"]) {
    const street = AMSTERDAM.streets.find(s => s.name === name), p = sampleAmsterdamPath(street.points, amsterdamPathLength(street.points) / 2);
    assert.ok(course.nearest(p.x, p.z).distance > 20);
    close(course.roadDistance(p.x, p.z), 0);
  }
  assert.ok(course.roadDistance(12, 116) > 20, "Dam Square remains a plaza");
  for (let x = -400; x <= 400; x += 29) for (let z = -400; z <= 400; z += 31) {
    close(course.roadDistance(x, z), Math.min(streetDistance(x, z), bruteNearest(x, z).distance));
  }
});

test("reserved architectural plots stay on land, within bounds and at least fifteen metres from the entire lap", () => {
  assert.deepEqual(AMSTERDAM.landmarks, [
    { id: "centraal", name: "Amsterdam Centraal", x: 0, z: 251, w: 172, d: 36 },
    { id: "rijksmuseum", name: "Rijksmuseum", x: 0, z: -267, w: 136, d: 40 },
    { id: "westerkerk", name: "Westerkerk", x: -43, z: 143, w: 34, d: 48 },
    { id: "palace", name: "Royal Palace", x: 12, z: 116, w: 60, d: 24 },
    { id: "nemo", name: "NEMO", x: 274, z: 244, w: 56, d: 38 },
    { id: "windmill", name: "De Gooyer", x: 275, z: -263, w: 26, d: 26 },
  ]);
  for (const plot of AMSTERDAM.landmarks) {
    const xMin = plot.x - plot.w / 2, xMax = plot.x + plot.w / 2, zMin = plot.z - plot.d / 2, zMax = plot.z + plot.d / 2;
    assert.ok(xMin > -320 && xMax < 320 && zMin > -320 && zMax < 320);
    const corners = [{ x: xMin, z: zMin }, { x: xMax, z: zMin }, { x: xMax, z: zMax }, { x: xMin, z: zMax }];
    for (const canal of AMSTERDAM.canals) {
      for (const p of corners) assert.ok(!polygonContains(canal.polygon, p.x, p.z), `${plot.name}: dry foundation corner`);
      for (const p of canal.polygon) assert.ok(p.x < xMin || p.x > xMax || p.z < zMin || p.z > zMax, `${plot.name}: no enclosed water`);
      for (const edge of polygonEdges(canal.polygon)) for (const side of polygonEdges(corners)) {
        assert.ok(!intersects(edge.a, edge.b, side.a, side.b), `${plot.name}: no water crosses a foundation edge`);
      }
    }
    for (const street of AMSTERDAM.streets) for (let i = 1; i < street.points.length; i++) {
      const a = street.points[i - 1], b = street.points[i];
      assert.ok(!polygonContains(corners, a.x, a.z), `${plot.name}: no street through its plot`);
      for (const side of polygonEdges(corners)) assert.ok(segmentDistance(a, b, side.a, side.b) > 6.5,
        `${plot.name}: ${street.name} corridor clears its foundation`);
    }
    for (let i = 0; i < route.length; i++) {
      const a = route[i], b = route[(i + 1) % route.length];
      assert.ok(Math.hypot(Math.max(xMin - a.x, 0, a.x - xMax), Math.max(zMin - a.z, 0, a.z - zMax)) >= 15);
      for (let j = 0; j < corners.length; j++) {
        assert.ok(segmentDistance(a, b, corners[j], corners[(j + 1) % corners.length]) >= 15, `${plot.name}: route setback`);
      }
    }
  }
});
