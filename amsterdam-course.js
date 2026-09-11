import { Vector3 } from "three";
import { AMSTERDAM, amsterdamHeightAt, bridgeAt, isAmsterdamDry } from "./amsterdam-layout.js";

const clamp = t => Math.max(0, Math.min(1, t));
const blend = (a, b, t) => t === 0 ? a : t === 1 ? b : a + (b - a) * t;

/** Same read-only route and X/Z projection contract as createCourse(). */
export function createAmsterdamCourse() {
  const halfSize = AMSTERDAM.halfSize;
  const controls = [[0, 210], [236, 210], [236, -90], [164, -90], [164, -222],
    [-250, -222], [-250, -174], [70, -174], [70, -126], [-80, -126],
    [-80, 66], [-250, 66], [-250, 210]];
  let dense = [];
  for (let i = 0; i < controls.length; i++) {
    const p = new Vector3(controls[i][0], 0, controls[i][1]);
    const a = controls[(i + controls.length - 1) % controls.length], b = controls[(i + 1) % controls.length];
    const incoming = new Vector3(p.x - a[0], 0, p.z - a[1]);
    const outgoing = new Vector3(b[0] - p.x, 0, b[1] - p.z);
    const radius = Math.min(10, incoming.length() * 0.45, outgoing.length() * 0.45);
    incoming.normalize(); outgoing.normalize();
    if (incoming.dot(outgoing) > 0.999) { dense.push(p); continue; }
    const center = p.clone().addScaledVector(incoming, -radius).addScaledVector(outgoing, radius);
    // Circular fillets cannot overshoot the canal-side streets like a spline.
    for (let j = 0; j <= 32; j++) {
      const angle = j / 32 * Math.PI / 2;
      dense.push(center.clone().addScaledVector(outgoing, -radius * Math.cos(angle)).addScaledVector(incoming, radius * Math.sin(angle)));
    }
  }
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
    const along = bridge.axis === "x" ? p.x - bridge.x : p.z - bridge.z;
    const grade = -bridge.rise * Math.PI / (2 * bridge.halfLength) * Math.sin(Math.PI * along / bridge.halfLength);
    return grade * (bridge.axis === "x" ? -dz : dx) / Math.hypot(dx, dz);
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
      const dx = street.x2 - street.x1, dz = street.z2 - street.z1;
      const t = clamp(((x - street.x1) * dx + (z - street.z1) * dz) / (dx * dx + dz * dz));
      distance = Math.min(distance, Math.hypot(x - street.x1 - dx * t, z - street.z1 - dz * t));
    }
    return distance;
  }

  return { route, heightAt: amsterdamHeightAt, roadDistance, nearest, halfSize, length, elevation,
    isSafePosition: isAmsterdamDry };
}
