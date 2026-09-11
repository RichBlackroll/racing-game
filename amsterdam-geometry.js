const EPS = 1e-9;
const cross = (ax, az, bx, bz) => ax * bz - az * bx;

export function pointSegmentSquared(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
}

/** Inclusive, simple polygon containment; polygons need not repeat their first point. */
export function polygonContains(polygon, x, z) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (pointSegmentSquared(x, z, a, b) < EPS * EPS) return true;
    if ((a.z > z) !== (b.z > z) && x < a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}

export function polygonEdges(polygon) {
  return polygon.map((a, i) => ({ a, b: polygon[(i + 1) % polygon.length] }));
}

function intersection(a, b, c, d) {
  const dx = b.x - a.x, dz = b.z - a.z, ex = d.x - c.x, ez = d.z - c.z;
  const denominator = cross(dx, dz, ex, ez);
  if (Math.abs(denominator) < EPS) return null;
  const t = cross(c.x - a.x, c.z - a.z, ex, ez) / denominator;
  const u = cross(c.x - a.x, c.z - a.z, dx, dz) / denominator;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? Math.max(0, Math.min(1, t)) : null;
}

/** Split an arrangement, retaining only edges that separate the supplied two regions. */
export function regionBoundary(polygons, contains) {
  const edges = polygons.flatMap(polygonEdges), result = [], seen = new Set();
  for (const { a, b } of edges) {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < EPS) continue;
    const cuts = [0, 1];
    for (const { a: c, b: d } of edges) {
      if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS || Math.min(a.x, b.x) > Math.max(c.x, d.x) + EPS
          || Math.max(a.z, b.z) < Math.min(c.z, d.z) - EPS || Math.min(a.z, b.z) > Math.max(c.z, d.z) + EPS) continue;
      const t = intersection(a, b, c, d);
      if (t !== null) cuts.push(t);
      // Collinear overlap endpoints are arrangement vertices too.
      if (Math.abs(cross(dx, dz, c.x - a.x, c.z - a.z)) < EPS * length
          && Math.abs(cross(dx, dz, d.x - a.x, d.z - a.z)) < EPS * length) {
        for (const p of [c, d]) {
          const u = ((p.x - a.x) * dx + (p.z - a.z) * dz) / length ** 2;
          if (u > 0 && u < 1) cuts.push(u);
        }
      }
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1], hi = cuts[i];
      if ((hi - lo) * length < EPS) continue;
      const x = a.x + dx * (lo + hi) / 2, z = a.z + dz * (lo + hi) / 2;
      const probe = Math.min(1e-5, (hi - lo) * length * 0.01);
      if (contains(x - dz / length * probe, z + dx / length * probe)
          === contains(x + dz / length * probe, z - dx / length * probe)) continue;
      const p = { x: a.x + dx * lo, z: a.z + dz * lo }, q = { x: a.x + dx * hi, z: a.z + dz * hi };
      const key = [p, q].map(v => `${v.x.toFixed(8)},${v.z.toFixed(8)}`).sort().join("/");
      if (!seen.has(key)) { seen.add(key); result.push({ a: p, b: q }); }
    }
  }
  return result;
}

/** Exact horizontal trapezoid decomposition of the square minus a polygon union. */
export function landPolygons(polygons, halfSize) {
  const square = [{ x: -halfSize, z: -halfSize }, { x: halfSize, z: -halfSize },
    { x: halfSize, z: halfSize }, { x: -halfSize, z: halfSize }];
  const edges = polygons.flatMap(polygonEdges), all = [...edges, ...polygonEdges(square)];
  const levels = [-halfSize, halfSize];
  for (const { a, b } of all) {
    if (a.z > -halfSize && a.z < halfSize) levels.push(a.z);
    for (const { a: c, b: d } of all) {
      const t = intersection(a, b, c, d);
      if (t === null) continue;
      const z = a.z + (b.z - a.z) * t;
      if (z > -halfSize && z < halfSize) levels.push(z);
    }
  }
  levels.sort((a, b) => a - b);
  const zs = levels.filter((z, i) => !i || z - levels[i - 1] > EPS);
  const xAt = (edge, z) => edge.a.x + (edge.b.x - edge.a.x) * (z - edge.a.z) / (edge.b.z - edge.a.z);
  const left = { a: square[0], b: square[3] }, right = { a: square[1], b: square[2] }, result = [];
  for (let i = 1; i < zs.length; i++) {
    const low = zs[i - 1], high = zs[i], mid = (low + high) / 2, intervals = [];
    for (const polygon of polygons) {
      const active = polygonEdges(polygon).filter(({ a, b }) => (a.z > mid) !== (b.z > mid));
      active.sort((a, b) => xAt(a, mid) - xAt(b, mid));
      for (let j = 0; j < active.length; j += 2) intervals.push({ left: active[j], right: active[j + 1] });
    }
    intervals.sort((a, b) => xAt(a.left, mid) - xAt(b.left, mid));
    const gaps = [];
    let cursor = left;
    for (const interval of intervals) {
      if (xAt(interval.right, mid) <= -halfSize || xAt(interval.left, mid) >= halfSize) continue;
      if (xAt(interval.left, mid) > xAt(cursor, mid)) gaps.push([cursor, interval.left]);
      if (xAt(interval.right, mid) > xAt(cursor, mid)) cursor = xAt(interval.right, mid) > halfSize ? right : interval.right;
    }
    if (xAt(cursor, mid) < halfSize) gaps.push([cursor, right]);
    for (const [l, r] of gaps) {
      const polygon = [{ x: xAt(l, low), z: low }, { x: xAt(r, low), z: low },
        { x: xAt(r, high), z: high }, { x: xAt(l, high), z: high }];
      const unique = polygon.filter((p, j) => Math.hypot(p.x - polygon[(j + 1) % 4].x, p.z - polygon[(j + 1) % 4].z) > EPS);
      if (unique.length >= 3) result.push(unique);
    }
  }
  return result;
}

/** Mitered parallel path, positive offset on the local +z side of the +X tangent. */
export function offsetPath(points, offset) {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const before = Math.hypot(p.x - a.x, p.z - a.z), after = Math.hypot(b.x - p.x, b.z - p.z);
    const nx = before ? -(p.z - a.z) / before : -(b.z - p.z) / after;
    const nz = before ? (p.x - a.x) / before : (b.x - p.x) / after;
    const mx = after ? -(b.z - p.z) / after : nx, mz = after ? (b.x - p.x) / after : nz;
    const scale = offset / (1 + nx * mx + nz * mz);
    return { x: p.x + (nx + mx) * scale, z: p.z + (nz + mz) * scale };
  });
}

/** Cubic chains use one start followed by groups of two controls and an endpoint. */
export function cubicPath(controls, spacing = 2) {
  const result = [{ x: controls[0][0], z: controls[0][1] }];
  for (let i = 1; i < controls.length; i += 3) {
    const p = controls[i - 1], a = controls[i], b = controls[i + 1], q = controls[i + 2];
    const count = Math.ceil((Math.hypot(a[0] - p[0], a[1] - p[1]) + Math.hypot(b[0] - a[0], b[1] - a[1])
      + Math.hypot(q[0] - b[0], q[1] - b[1])) / spacing);
    for (let j = 1; j <= count; j++) {
      const t = j / count, s = 1 - t;
      result.push({ x: s ** 3 * p[0] + 3 * s * s * t * a[0] + 3 * s * t * t * b[0] + t ** 3 * q[0],
        z: s ** 3 * p[1] + 3 * s * s * t * a[1] + 3 * s * t * t * b[1] + t ** 3 * q[1] });
    }
  }
  return result;
}

/** Circular fillets for arbitrary-angle turns, never a right-angle-only spline. */
export function filletPath(points, radius, spacing = 0.5) {
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], p = points[i], b = points[i + 1];
    const before = Math.hypot(p.x - a.x, p.z - a.z), after = Math.hypot(b.x - p.x, b.z - p.z);
    const ux = (p.x - a.x) / before, uz = (p.z - a.z) / before;
    const vx = (b.x - p.x) / after, vz = (b.z - p.z) / after;
    const angle = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz))), sign = Math.sign(cross(ux, uz, vx, vz));
    if (angle < 1e-6) { result.push(p); continue; }
    const tangent = Math.tan(angle / 2);
    const r = Math.min(radius, before * (i === 1 ? 1 : 0.49) / tangent, after * (i === points.length - 2 ? 1 : 0.49) / tangent);
    const entry = { x: p.x - ux * r * tangent, z: p.z - uz * r * tangent };
    const center = { x: entry.x - uz * sign * r, z: entry.z + ux * sign * r };
    const dx = entry.x - center.x, dz = entry.z - center.z, count = Math.ceil(angle * r / spacing);
    for (let j = 0; j <= count; j++) {
      const t = sign * angle * j / count;
      result.push({ x: center.x + dx * Math.cos(t) - dz * Math.sin(t), z: center.z + dx * Math.sin(t) + dz * Math.cos(t) });
    }
  }
  result.push(points.at(-1));
  return result.filter((p, i) => !i || Math.hypot(p.x - result[i - 1].x, p.z - result[i - 1].z) > EPS);
}
