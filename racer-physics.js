import { moveWithBounces } from "./collision.js";

// All cars advance in the same swept steps and exchange momentum, not wall bounces.
export function stepRacerBodies(bodies, dt, obstacles, limit, isSafePosition) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, .05);
  const steps = Math.max(1, Math.ceil(Math.max(...bodies.map(b => Math.hypot(b.vx, b.vz)), 0) * dt / .4));
  const nearby = bodies.map(b => {
    b.hits = b.staticHits = b.impact = 0;
    const reach = Math.hypot(b.vx, b.vz) * dt + b.radius + 8;
    return obstacles.filter(o => b.y + 1.6 > (o.y ?? -Infinity) && b.y < (o.y ?? 0) + (o.height ?? Infinity) &&
      Math.abs(o.x - b.x) < reach + (o.hx ?? o.r) && Math.abs(o.z - b.z) < reach + (o.hz ?? o.r));
  });
  for (let step = 0; step < steps; step++) {
    const previous = isSafePosition ? bodies.map(b => ({ x: b.x, z: b.z })) : null;
    bodies.forEach((b, i) => {
      const motion = moveWithBounces(b, { x: b.vx, z: b.vz }, dt / steps, nearby[i], limit, b.radius);
      b.x = motion.x; b.z = motion.z; b.vx = motion.vx; b.vz = motion.vz;
      b.staticHits += motion.hits;
    });
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (Math.abs(a.y - b.y) > 1.8) continue;
      const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
      if (distance >= a.radius + b.radius) continue;
      const nx = distance > 1e-8 ? dx / distance : 1, nz = distance > 1e-8 ? dz / distance : 0;
      const inverseA = 1 / a.mass, inverseB = 1 / b.mass, inverseTotal = inverseA + inverseB;
      const depth = a.radius + b.radius - distance + .002;
      a.x -= nx * depth * inverseA / inverseTotal; a.z -= nz * depth * inverseA / inverseTotal;
      b.x += nx * depth * inverseB / inverseTotal; b.z += nz * depth * inverseB / inverseTotal;
      const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (closing <= 0) continue;
      const impulse = closing * 1.08 / inverseTotal;
      a.vx -= impulse * nx * inverseA; a.vz -= impulse * nz * inverseA;
      b.vx += impulse * nx * inverseB; b.vz += impulse * nz * inverseB;
      for (const car of [a, b]) { car.hits++; car.impact = Math.max(car.impact, closing); }
    }
    // A car pushed beside a wall still has to clear the wall and world boundary.
    bodies.forEach((b, i) => {
      const motion = moveWithBounces(b, { x: b.vx, z: b.vz }, 0, nearby[i], limit, b.radius);
      b.x = motion.x; b.z = motion.z; b.vx = motion.vx; b.vz = motion.vz;
      b.staticHits += motion.hits;
    });
    if (isSafePosition) bodies.forEach((b, i) => {
      const a = previous[i], distance = Math.hypot(b.x - a.x, b.z - a.z);
      // Check shunts as well as driving: neither may cross a narrow water cutout.
      const samples = Math.max(1, Math.ceil(distance / .4));
      for (let j = 1; j <= samples; j++) {
        if (isSafePosition(a.x + (b.x - a.x) * j / samples, a.z + (b.z - a.z) * j / samples, Math.max(2.5, b.radius))) continue;
        b.impact = Math.max(b.impact, Math.hypot(b.vx, b.vz));
        b.x = a.x; b.z = a.z; b.vx = b.vz = 0; b.staticHits++;
        break;
      }
    });
  }
}
