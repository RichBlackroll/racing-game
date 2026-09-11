import test from "node:test";
import assert from "node:assert/strict";
import { filletPath, landPolygons, offsetPath, polygonContains, regionBoundary } from "./amsterdam-geometry.js";

const point = (x, z) => ({ x, z });
const square = (x, z, size) => [point(x, z), point(x + size, z), point(x + size, z + size), point(x, z + size)];
const area = polygon => Math.abs(polygon.reduce((sum, p, i) => {
  const q = polygon[(i + 1) % polygon.length]; return sum + p.x * q.z - q.x * p.z;
}, 0)) / 2;
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("arbitrary-angle fillets preserve requested radii, tangents and mirrored turns", () => {
  for (const angle of [-135, -100, -60, -30, 30, 60, 100, 135]) {
    const theta = angle * Math.PI / 180, radius = 18;
    const input = [point(-100, 0), point(0, 0), point(100 * Math.cos(theta), 100 * Math.sin(theta))];
    const path = filletPath(input, radius), entry = path[1], exit = path.at(-2);
    assert.deepEqual(path[0], input[0]); assert.deepEqual(path.at(-1), input.at(-1));
    close(entry.x, -radius * Math.tan(Math.abs(theta) / 2)); close(entry.z, 0);
    close(exit.x, radius * Math.tan(Math.abs(theta) / 2) * Math.cos(theta));
    close(exit.z, radius * Math.tan(Math.abs(theta) / 2) * Math.sin(theta));
    const center = point(entry.x, Math.sign(angle) * radius);
    for (const p of path.slice(1, -1)) close(Math.hypot(p.x - center.x, p.z - center.z), radius);
    const end = path.at(-1), dx = end.x - exit.x, dz = end.z - exit.z;
    close((exit.x - center.x) * dx + (exit.z - center.z) * dz, 0);
  }
  assert.deepEqual(filletPath([point(0, 0), point(20, 0), point(40, 0)], 18), [point(0, 0), point(20, 0), point(40, 0)]);
});

test("offset paths intersect neighboring offset lines rather than shrinking corners", () => {
  assert.deepEqual(offsetPath([point(0, 0), point(20, 0), point(20, 20)], 4), [point(0, 4), point(16, 4), point(16, 20)]);
  assert.deepEqual(offsetPath([point(0, 0), point(20, 0), point(20, 20)], -4), [point(0, -4), point(24, -4), point(24, 20)]);
});

test("arrangements discard coincident, overlapping and buried edges and retain deck cuts", () => {
  const first = square(0, 0, 4), second = square(2, 0, 4), duplicate = [...first].reverse();
  const polygons = [first, second, duplicate], contains = (x, z) => polygons.some(p => polygonContains(p, x, z));
  const boundary = regionBoundary(polygons, contains);
  close(boundary.reduce((sum, e) => sum + Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z), 0), 20);
  assert.ok(!boundary.some(({ a, b }) => a.x === b.x && (a.x === 2 || a.x === 4)));
  const deck = [point(2, -1), point(3, -1), point(3, 5), point(2, 5)];
  const exposed = regionBoundary([...polygons, deck], (x, z) => contains(x, z) && !polygonContains(deck, x, z));
  close(exposed.reduce((sum, e) => sum + Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z), 0), 26);
  assert.ok(exposed.some(e => e.a.x === 3 && e.b.x === 3));
});

test("horizontal sweep includes crossing-edge levels, clips the square and supports holes and disconnected land", () => {
  const diamond = [point(0, -3), point(3, 0), point(0, 3), point(-3, 0)];
  const shifted = diamond.map(p => point(p.x + 2, p.z));
  // Two 18-unit diamonds overlap in an 8-unit diamond. Their intersections
  // occur at z=+/-2, neither of which is an original polygon vertex level.
  const land = landPolygons([diamond, shifted], 10);
  close(land.reduce((sum, p) => sum + area(p), 0), 400 - (36 - 8));
  assert.ok(land.some(p => p.some(v => Math.abs(v.z) === 2)));
  const spanning = [point(-20, -1), point(20, -1), point(20, 1), point(-20, 1)];
  close(landPolygons([spanning], 5).reduce((sum, p) => sum + area(p), 0), 80);
  const frame = [square(-3, -3, 2), square(-1, -3, 2), square(1, -3, 2), square(-3, -1, 2),
    square(1, -1, 2), square(-3, 1, 2), square(-1, 1, 2), square(1, 1, 2)];
  const island = landPolygons(frame, 5);
  close(island.reduce((sum, p) => sum + area(p), 0), 68);
  assert.equal(island.filter(p => polygonContains(p, 0, 0)).length, 1);
  assert.equal(landPolygons([square(-20, -20, 40)], 5).length, 0);
  close(landPolygons([], 5).reduce((sum, p) => sum + area(p), 0), 100);
});
