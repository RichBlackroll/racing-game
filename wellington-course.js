import { Vector3 } from "three";
import { WELLINGTON, isWellingtonLand, wellingtonHeightAt } from "./wellington-layout.js";

const clamp = t => Math.max(0, Math.min(1, t));

/** Read-only, implicitly closed route; X/Z nearest projection, 3D along metres. */
export function createWellingtonCourse() {
  const lapStreets = ["Waterloo Quay", "Customhouse Quay", "Jervois Quay", "Cable Street",
    "Oriental Parade return", "Kent Terrace junction", "Wakefield Street", "Victoria Street",
    "Hunter Street", "Featherston Street", "Bunny Street"];
  const controls = lapStreets.flatMap(name => WELLINGTON.streets.find(s => s.name === name).points.slice(0, -1));
  const rounded = [];
  for (let i = 0; i < controls.length; i++) {
    const p = controls[i], prev = controls[(i + controls.length - 1) % controls.length], next = controls[(i + 1) % controls.length];
    const incoming = new Vector3(p.x - prev.x, 0, p.z - prev.z), outgoing = new Vector3(next.x - p.x, 0, next.z - p.z);
    const available = Math.min(incoming.length(), outgoing.length()) * 0.45;
    incoming.normalize(); outgoing.normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, incoming.dot(outgoing))));
    if (angle < 0.015) { rounded.push(new Vector3(p.x, 0, p.z)); continue; }
    const setback = Math.min(12 * Math.tan(angle / 2), available), radius = setback / Math.tan(angle / 2);
    const start = new Vector3(p.x, 0, p.z).addScaledVector(incoming, -setback);
    const side = Math.sign(incoming.x * outgoing.z - incoming.z * outgoing.x);
    const normal = new Vector3(-incoming.z * side, 0, incoming.x * side);
    const center = start.clone().addScaledVector(normal, radius);
    const steps = Math.ceil(angle * radius / 2);
    for (let j = 0; j <= steps; j++) {
      const theta = angle * j / steps;
      rounded.push(center.clone().addScaledVector(normal, -radius * Math.cos(theta)).addScaledVector(incoming, radius * Math.sin(theta)));
    }
  }

  // Each sparse straight owns its subdivisions. Exact X/Z projection maps
  // directly back to route index/t, without a world-sized cells * route grid.
  const route = [], spans = [];
  for (let i = 0; i < rounded.length; i++) {
    const a = rounded[i], b = rounded[(i + 1) % rounded.length], dx = b.x - a.x, dz = b.z - a.z;
    const squared = dx * dx + dz * dz;
    if (squared < 1e-14) continue;
    const count = Math.ceil(Math.sqrt(squared) / 3);
    spans.push({ a, dx, dz, squared, first: route.length, count });
    for (let j = 0; j < count; j++) {
      const p = a.clone().lerp(b, j / count);
      p.y = wellingtonHeightAt(p.x, p.z);
      route.push(p);
    }
  }
  let length = 0;
  const elevation = { min: Infinity, max: -Infinity, gain: 0 };
  const segments = route.map((a, i) => {
    const b = route[(i + 1) % route.length], segment = { along: length, length: a.distanceTo(b) };
    length += segment.length;
    elevation.min = Math.min(elevation.min, a.y);
    elevation.max = Math.max(elevation.max, a.y);
    elevation.gain += Math.max(0, b.y - a.y);
    return segment;
  });
  const banks = route.map((p, i) => {
    const a = route[(i + route.length - 1) % route.length], b = route[(i + 1) % route.length];
    const dx = b.x - a.x, dz = b.z - a.z, norm = Math.hypot(dx, dz);
    const gx = (wellingtonHeightAt(p.x + 0.1, p.z) - wellingtonHeightAt(p.x - 0.1, p.z)) / 0.2;
    const gz = (wellingtonHeightAt(p.x, p.z + 0.1) - wellingtonHeightAt(p.x, p.z - 0.1)) / 0.2;
    return (-dz * gx + dx * gz) / norm;
  });
  function nearest(x, z) {
    let best = Infinity, span, fraction = 0;
    for (const s of spans) {
      const t = clamp(((x - s.a.x) * s.dx + (z - s.a.z) * s.dz) / s.squared);
      const squared = (x - s.a.x - s.dx * t) ** 2 + (z - s.a.z - s.dz * t) ** 2;
      if (squared < best) { best = squared; span = s; fraction = t; }
    }
    const offset = fraction * span.count, local = Math.min(span.count - 1, Math.floor(offset));
    const index = span.first + local, t = offset - local;
    const a = route[index], b = route[(index + 1) % route.length], segment = segments[index];
    return { distance: Math.sqrt(best), index, t, height: a.y + (b.y - a.y) * t,
      bank: banks[index] + (banks[(index + 1) % route.length] - banks[index]) * t,
      along: (segment.along + segment.length * t) % length };
  }
  const streets = WELLINGTON.streets.flatMap(s => s.points.slice(1).map((b, i) => {
    const a = s.points[i], dx = b.x - a.x, dz = b.z - a.z;
    return { a, dx, dz, squared: dx * dx + dz * dz };
  }));
  function roadDistance(x, z) {
    let distance = nearest(x, z).distance;
    for (const s of streets) {
      const t = clamp(((x - s.a.x) * s.dx + (z - s.a.z) * s.dz) / s.squared);
      distance = Math.min(distance, Math.hypot(x - s.a.x - t * s.dx, z - s.a.z - t * s.dz));
    }
    return distance;
  }
  const buildings = WELLINGTON.landmarks.filter(p => p.h > 0).map(p => ({ ...p, c: Math.cos(p.rotation), s: Math.sin(p.rotation) }));
  function isSafePosition(x, z, margin = 0) {
    if (!isWellingtonLand(x, z, margin)) return false;
    return buildings.every(p => {
      // Inverse of Three.js rotation.y: local x = c*x - s*z.
      const dx = x - p.x, dz = z - p.z;
      const u = Math.abs(p.c * dx - p.s * dz), v = Math.abs(p.s * dx + p.c * dz);
      return Math.hypot(Math.max(0, u - p.w / 2), Math.max(0, v - p.d / 2)) > margin;
    });
  }
  return { route, heightAt: wellingtonHeightAt, roadDistance, nearest,
    halfSize: WELLINGTON.halfSize, length, elevation, isSafePosition };
}
