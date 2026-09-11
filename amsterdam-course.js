import { Vector3 } from "three";
import { AMSTERDAM, amsterdamHeightAt, bridgeAt, isAmsterdamDry } from "./amsterdam-layout.js";

const clamp = t => Math.max(0, Math.min(1, t));
const blend = (a, b, t) => t === 0 ? a : t === 1 ? b : a + (b - a) * t;

/** Same read-only route and X/Z projection contract as createCourse(). */
export function createAmsterdamCourse() {
  const halfSize = AMSTERDAM.halfSize;
  let dense = AMSTERDAM.lap.map(p => new Vector3(p.x, 0, p.z));
  dense.push(dense[0].clone());
  dense = dense.flatMap((p, i) => {
    if (i === dense.length - 1) return [p];
    const next = dense[i + 1], count = Math.max(1, Math.ceil(p.distanceTo(next)));
    return Array.from({ length: count }, (_, j) => p.clone().lerp(next, j / count));
  });
  dense.forEach(p => { p.y = amsterdamHeightAt(p.x, p.z); });
  const arc = [0];
  for (let i = 1; i < dense.length; i++) arc.push(arc[i - 1] + dense[i].distanceTo(dense[i - 1]));
  const count = Math.ceil(arc.at(-1) / 2.5);
  let index = 0;
  const route = Array.from({ length: count }, (_, i) => {
    const target = arc.at(-1) * i / count;
    while (arc[index + 1] < target) index++;
    const p = dense[index].clone().lerp(dense[index + 1], (target - arc[index]) / (arc[index + 1] - arc[index]));
    p.y = amsterdamHeightAt(p.x, p.z);
    return p;
  });

  const banks = route.map((p, i) => {
    const bridge = bridgeAt(p.x, p.z);
    if (!bridge) return 0;
    const a = route[(i + route.length - 1) % route.length], b = route[(i + 1) % route.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const sin = Math.sin(bridge.heading), cos = Math.cos(bridge.heading);
    const along = (p.x - bridge.x) * sin + (p.z - bridge.z) * cos;
    const grade = -bridge.rise * Math.PI / (2 * bridge.halfLength) * Math.sin(Math.PI * along / bridge.halfLength);
    return grade * (-dz * sin + dx * cos) / Math.hypot(dx, dz);
  });
  let length = 0;
  const elevation = { min: Infinity, max: -Infinity, gain: 0 };
  const segments = route.map((a, i) => {
    const b = route[(i + 1) % route.length], dx = b.x - a.x, dz = b.z - a.z;
    const segment = { a, b, dx, dz, squared: dx * dx + dz * dz, length: a.distanceTo(b), along: length };
    length += segment.length;
    elevation.min = Math.min(elevation.min, a.y);
    elevation.max = Math.max(elevation.max, a.y);
    elevation.gain += Math.max(0, b.y - a.y);
    return segment;
  });
  function project(x, z, segment) {
    return clamp(((x - segment.a.x) * segment.dx + (z - segment.a.z) * segment.dz) / segment.squared);
  }
  function distanceSquared(x, z, segment, t) {
    return (x - (segment.a.x + segment.dx * t)) ** 2 + (z - (segment.a.z + segment.dz * t)) ** 2;
  }

  // Fixed-size, exact candidate cache, matching the existing courses. Twice a
  // cell's half-diagonal bounds the change in segment distance anywhere in it.
  const cellSize = 32, low = Math.floor(-halfSize / cellSize), high = Math.floor(halfSize / cellSize);
  const width = high - low + 1, grid = new Array(width * width);
  const distances = new Float64Array(segments.length);
  for (let gz = low; gz <= high; gz++) for (let gx = low; gx <= high; gx++) {
    const x = (gx + 0.5) * cellSize, z = (gz + 0.5) * cellSize;
    let minimum = Infinity;
    for (let i = 0; i < segments.length; i++) {
      distances[i] = distanceSquared(x, z, segments[i], project(x, z, segments[i]));
      minimum = Math.min(minimum, distances[i]);
    }
    const bound = (Math.sqrt(minimum) + Math.SQRT2 * cellSize + 1e-8) ** 2;
    const candidates = [];
    for (let i = 0; i < segments.length; i++) if (distances[i] <= bound) candidates.push(i);
    grid[(gz - low) * width + gx - low] = candidates;
  }
  const all = segments.map((_, i) => i);
  function nearest(x, z) {
    const gx = Math.floor(x / cellSize), gz = Math.floor(z / cellSize);
    const candidates = gx < low || gx > high || gz < low || gz > high ? all : grid[(gz - low) * width + gx - low];
    let best = Infinity, index = 0, t = 0;
    for (const i of candidates) {
      const fraction = project(x, z, segments[i]);
      const squared = distanceSquared(x, z, segments[i], fraction);
      if (squared < best) { best = squared; index = i; t = fraction; }
    }
    const segment = segments[index];
    return { distance: Math.sqrt(best), index, t, height: blend(segment.a.y, segment.b.y, t),
      bank: blend(banks[index], banks[(index + 1) % route.length], t),
      along: (segment.along + segment.length * t) % length };
  }
  function roadDistance(x, z) {
    let distance = nearest(x, z).distance;
    for (const street of AMSTERDAM.streets) {
      for (let i = 1; i < street.points.length; i++) {
        const a = street.points[i - 1], b = street.points[i], dx = b.x - a.x, dz = b.z - a.z;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz));
        distance = Math.min(distance, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
      }
    }
    return distance;
  }

  return { route, heightAt: amsterdamHeightAt, roadDistance, nearest, halfSize, length, elevation,
    isSafePosition: isAmsterdamDry };
}
