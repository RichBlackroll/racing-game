import { CatmullRomCurve3, Vector3 } from "three";
import { createAmsterdamCourse } from "./amsterdam-course.js";
import { createWellingtonCourse } from "./wellington-course.js";

const clamp = (t) => Math.max(0, Math.min(1, t));
const blend = (a, b, t) => t === 0 ? a : t === 1 ? b : a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hill = (x, z, cx, cz, sx, sz) => Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

/**
 * Coordinates and distances are metres. The route closes implicitly, without a
 * duplicate endpoint; its Y values are the terrain surface, not mesh offsets.
 * nearest() projects in X/Z: height is unbanked centre height, along is 3D lap
 * distance, and bank is dh/dl along the unit cross-road vector (-dz, dx).
 * Treat the returned route as read-only: segment and spatial data are cached.
 */
export function createCourse(level = "forest") {
  if (level === "wellington") return createWellingtonCourse();
  if (level === "amsterdam") return createAmsterdamCourse();
  if (!["forest", "city", "stunt", "moon"].includes(level)) throw new RangeError(`Unknown course: ${level}`);
  const forest = level === "forest", city = level === "city", moon = level === "moon";
  const stadium = !forest && !city;
  const halfSize = forest ? 620 : city ? 320 : 420;

  function rawHeight(x, z) {
    if (forest) return 28 + 0.75 * (6 * Math.sin(x / 210) + 5 * Math.cos(z / 180)
      + 10 * Math.sin(x / 115) * Math.cos(z / 140)
      + 8 * Math.sin(x / 90 + z / 95)
      + 67 * hill(x, z, 310, 170, 180, 200)
      + 68 * hill(x, z, -350, -200, 170, 175)
      + 38 * hill(x, z, 60, -330, 150, 135)
      + 28 * hill(x, z, 330, -270, 85, 85) - 15 * hill(x, z, 300, -80, 100, 100)
      - 12 * hill(x, z, -80, 150, 140, 160))
      + 25 * hill(x, z, 420, 450, 150, 140) + 20 * hill(x, z, -450, 390, 150, 150)
      + 30 * hill(x, z, 300, 100, 260, 300)
      + 12 * Math.sin(x / 110) * hill(x, z, 0, 470, 650, 160);
    if (city) return 8 + 5 * Math.sin(x / 1200) + 3 * Math.sin(z / 1300)
      // Leave downtown and every foundation unchanged; relief starts outside it.
      + smooth(170, 290, Math.abs(x)) * (4 + 2.4 * Math.sin(z / 100))
      + smooth(170, 290, Math.abs(z)) * (2.4 * Math.sin(x / 120) - 1.6);
    const relief = moon
      ? 8 + 3 * Math.sin(x / 140) * Math.cos(z / 150)
        + 12 * hill(x, z, -155, 15, 85, 100) - 9 * hill(x, z, 40, -20, 65, 65)
        + 5 * hill(x, z, 100, 30, 120, 120)
        + 17 * hill(x, z, -290, 280, 140, 130) + 18 * hill(x, z, 285, -260, 125, 140)
        - 5 * hill(x, z, 285, 150, 110, 100)
      : 2 + 14 * hill(x, z, 260, 0, 130, 140) + 10 * hill(x, z, -250, -15, 120, 130)
        + 1.5 * Math.sin(x / 90) * Math.sin(z / 160)
        + 22 * hill(x, z, 260, 300, 145, 145) + 18 * hill(x, z, -280, -260, 140, 140)
        - 5 * hill(x, z, -280, 170, 110, 100);
    // Both 18 m ramps, their full widths, approaches and landings stay at Y=0.
    const flat = (1 - smooth(145, 295, Math.abs(x))) * (1 - smooth(12, 112, Math.abs(Math.abs(z) - 140)));
    return relief * (1 - flat);
  }

  let dense;
  if (!city) {
    // Ridge excursions alternate with the original forest's inset valley bends.
    const controls = forest ? [[0, 340], [130, 350], [280, 440], [430, 510], [545, 420],
      [530, 285], [420, 160], [340, 80], [225, 10], [270, -70], [455, -110],
      [535, -235], [465, -385], [320, -445], [175, -535], [10, -510], [-90, -400],
      [-90, -280], [-75, -180], [-170, -130], [-260, -240], [-355, -385],
      [-500, -460], [-560, -340], [-530, -170], [-425, -70], [-320, -40],
      [-280, 80], [-410, 170], [-540, 240], [-535, 405], [-390, 500], [-230, 435], [-130, 350]]
      // Collinear controls on either side of each runway keep x[-140,140] exact.
      : [[-140, 140], [-80, 140], [80, 140], [140, 140], [180, 140],
        ...(moon ? [[225, 200], [190, 285], [270, 360], [370, 285], [340, 170],
          [270, 90], [310, -10], [370, -125], [330, -275], [235, -350], [160, -310], [175, -255], [210, -195]]
          : [[235, 190], [205, 275], [270, 345], [360, 285], [355, 150],
            [275, 65], [240, -30], [340, -115], [355, -255], [260, -345], [180, -320], [175, -250], [210, -195]]),
        [180, -140], [140, -140], [80, -140], [-80, -140], [-140, -140], [-180, -140],
        ...(moon ? [[-235, -190], [-195, -275], [-280, -355], [-370, -285], [-335, -155],
          [-265, -75], [-300, 25], [-370, 140], [-325, 290], [-235, 355], [-165, 310], [-175, 255], [-210, 195]]
          : [[-230, -190], [-210, -285], [-315, -350], [-375, -250], [-340, -120],
            [-240, -40], [-265, 70], [-355, 160], [-345, 300], [-265, 345], [-200, 290], [-225, 205]]),
        [-180, 140]];
    const curve = new CatmullRomCurve3(controls.map(([x, z]) => new Vector3(x, 0, z)), true, "centripetal");
    dense = curve.getPoints(16384);
  } else {
    const controls = [[0, 150], [100, 150], [100, 100], [-50, 100], [-50, 50], [100, 50],
      [100, 0], [-50, 0], [-50, -50], [100, -50], [100, -100], [150, -100],
      [150, -220], [265, -220], [265, -20], [220, -20], [220, 100], [265, 100],
      [265, 265], [-265, 265], [-265, 60], [-220, 60], [-220, -80], [-265, -80],
      [-265, -265], [-150, -265], [-150, 150]];
    dense = [];
    for (let i = 0; i < controls.length; i++) {
      const p = new Vector3(controls[i][0], 0, controls[i][1]);
      const a = controls[(i + controls.length - 1) % controls.length];
      const b = controls[(i + 1) % controls.length];
      const incoming = new Vector3(p.x - a[0], 0, p.z - a[1]);
      const outgoing = new Vector3(b[0] - p.x, 0, b[1] - p.z);
      // Tight downtown fillets stay inside intersections; outer avenues sweep wider.
      const radius = Math.max(Math.abs(p.x), Math.abs(p.z)) <= 150 ? 4
        : Math.min(28, incoming.length() * 0.45, outgoing.length() * 0.45);
      incoming.normalize(); outgoing.normalize();
      if (incoming.dot(outgoing) > 0.999) { dense.push(p); continue; }
      const center = p.clone().addScaledVector(incoming, -radius).addScaledVector(outgoing, radius);
      for (let j = 0; j <= 32; j++) {
        const angle = j / 32 * Math.PI / 2;
        dense.push(center.clone().addScaledVector(outgoing, -radius * Math.cos(angle)).addScaledVector(incoming, radius * Math.sin(angle)));
      }
    }
    dense.push(dense[0].clone());
    // Subdivide straights before measuring their elevation-aware arc lengths.
    dense = dense.flatMap((p, i) => {
      if (i === dense.length - 1) return [p];
      const next = dense[i + 1], count = Math.max(1, Math.ceil(p.distanceTo(next)));
      return Array.from({ length: count }, (_, j) => p.clone().lerp(next, j / count));
    });
  }
  dense.forEach(p => { p.y = rawHeight(p.x, p.z); });
  const arc = [0];
  for (let i = 1; i < dense.length; i++) arc.push(arc[i - 1] + dense[i].distanceTo(dense[i - 1]));
  const count = Math.ceil(arc[arc.length - 1] / (city ? 2.5 : 3.5));
  let index = 0;
  const route = Array.from({ length: count }, (_, i) => {
    const target = arc[arc.length - 1] * i / count;
    while (arc[index + 1] < target) index++;
    const p = dense[index].clone().lerp(dense[index + 1], (target - arc[index]) / (arc[index + 1] - arc[index]));
    p.y = rawHeight(p.x, p.z);
    return p;
  });

  const banks = route.map((p, i) => {
    const a = route[(i + route.length - 1) % route.length], b = route[(i + 1) % route.length];
    if (city) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const gx = (rawHeight(p.x + 0.1, p.z) - rawHeight(p.x - 0.1, p.z)) / 0.2;
      const gz = (rawHeight(p.x, p.z + 0.1) - rawHeight(p.x, p.z - 0.1)) / 0.2;
      return (-dz * gx + dx * gz) / Math.hypot(dx, dz);
    }
    const ax = p.x - a.x, az = p.z - a.z, bx = b.x - p.x, bz = b.z - p.z;
    const curvature = Math.atan2(ax * bz - az * bx, ax * bx + az * bz) / ((Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2);
    return -0.055 * Math.tanh(curvature * 45);
  });
  const smoothedBanks = banks.map((_, i) => {
    if (city) return banks[i];
    let total = 0;
    for (let j = -4; j <= 4; j++) total += banks[(i + j + banks.length) % banks.length] * (5 - Math.abs(j));
    return total / 25 * (stadium ? smooth(145, 215, Math.abs(route[i].x)) : 1);
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

  // Cache exact candidate sets per 32 m cell. A nearest segment anywhere in a
  // cell is at most (nearest-at-centre + cell diagonal) from its centre. The
  // O(cells * segments) work happens only here, never for terrain/grass queries.
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
    const centerDistance = Math.sqrt(minimum), bound = (centerDistance + Math.SQRT2 * cellSize + 1e-8) ** 2;
    const candidates = [];
    for (let i = 0; i < segments.length; i++) if (distances[i] <= bound) candidates.push(i);
    grid[(gz - low) * width + gx - low] = { candidates, nearRoad: centerDistance <= 20 + cellSize / Math.SQRT2 };
  }
  const all = segments.map((_, i) => i);
  function cellAt(x, z) {
    const gx = Math.floor(x / cellSize), gz = Math.floor(z / cellSize);
    return gx < low || gx > high || gz < low || gz > high ? undefined : grid[(gz - low) * width + gx - low];
  }
  function nearest(x, z) {
    let best = Infinity, index = 0, t = 0;
    for (const i of cellAt(x, z)?.candidates ?? all) {
      const fraction = project(x, z, segments[i]);
      const squared = distanceSquared(x, z, segments[i], fraction);
      if (squared < best) { best = squared; index = i; t = fraction; }
    }
    const segment = segments[index];
    return { distance: Math.sqrt(best), index, t, height: blend(segment.a.y, segment.b.y, t),
      bank: blend(smoothedBanks[index], smoothedBanks[(index + 1) % route.length], t),
      along: (segment.along + segment.length * t) % length };
  }
  function roadDistance(x, z) {
    if (!city) return nearest(x, z).distance;
    const gx = Math.max(-150, Math.min(150, Math.round(x / 50) * 50));
    const gz = Math.max(-150, Math.min(150, Math.round(z / 50) * 50));
    return Math.min(nearest(x, z).distance, Math.hypot(x - gx, Math.max(0, Math.abs(z) - 150)),
      Math.hypot(z - gz, Math.max(0, Math.abs(x) - 150)));
  }

  const pads = forest ? [[-30, 68], [118, 25]].filter(([x, z]) => nearest(x, z).distance > 38)
    : city ? Array.from({ length: 36 }, (_, i) => [-125 + (i % 6) * 50, -125 + Math.floor(i / 6) * 50]) : [];
  const foundations = pads.map(([x, z]) => ({ x, z, height: rawHeight(x, z) }));
  // Sparse off-road impacts: centre X/Z, radius and depth in metres.
  const craters = moon ? [[-100, -25, 30, 5], [100, 30, 26, 4.5], [20, -260, 38, 7],
    [-90, 290, 32, 6], [290, 245, 28, 5], [-285, -250, 30, 5.5],
    [370, 30, 26, 4.5], [-365, -5, 26, 4.5]] : [];
  function heightAt(x, z) {
    let height = rawHeight(x, z);
    if (moon) {
      // Keep rawHeight (and thus route sampling) untouched. Match the runway's
      // exact zero mask, reserve the base, and fade detail beyond the play area.
      const runway = (1 - smooth(145, 295, Math.abs(x))) * (1 - smooth(12, 112, Math.abs(Math.abs(z) - 140)));
      const base = smooth(0, 28, Math.max(-56 - x, x - 40, 12 - z, z - 108));
      const weight = (1 - runway) * base * (1 - smooth(420, 560, Math.max(Math.abs(x), Math.abs(z))));
      if (weight > 0) {
        let detail = 0.85 * Math.sin(x / 17 + 0.7 * Math.sin(z / 29)) * Math.sin(z / 21 - x / 43)
          + 0.45 * Math.sin(x / 8 + z / 13 + 0.6 * Math.sin(z / 19))
          + 0.2 * Math.sin(z / 6 - x / 11) * Math.sin(x / 15 + z / 17);
        for (const [cx, cz, radius, depth] of craters) {
          const dx = x - cx, dz = z - cz, distance = Math.hypot(dx, dz);
          if (distance >= radius * 1.75) continue;
          const angle = Math.atan2(dz, dx), phase = cx * 0.13 + cz * 0.07;
          const r = distance / (radius * (1 + 0.065 * Math.sin(3 * angle + phase) + 0.04 * Math.sin(5 * angle - phase)));
          const bowl = Math.max(0, 1 - r * r) ** 2;
          const rim = smooth(0.65, 1, r) * (1 - smooth(1, 1.55, r));
          detail += depth * (-bowl + 0.36 * rim * (0.85 + 0.15 * Math.sin(4 * angle + phase)));
        }
        height += detail * weight;
      }
    }
    // Entirely distant cells bypass even the bounded nearest-segment query.
    // City streets already share a gentle analytic grade. Keep that common
    // surface at intersections: projecting onto either arm of a tight 4 m turn
    // would introduce a height seam along its inner medial axis.
    if (!city && cellAt(x, z)?.nearRoad) {
      const hit = nearest(x, z);
      if (hit.distance < 20) {
        const segment = segments[hit.index];
        const side = Math.sign(segment.dx * (z - segment.a.z) - segment.dz * (x - segment.a.x));
        const roadHeight = hit.height + hit.bank * hit.distance * side;
        height = blend(roadHeight, height, smooth(6.6, 20, hit.distance));
      }
    }
    for (const pad of foundations) {
      const distance = Math.max(Math.abs(x - pad.x), Math.abs(z - pad.z));
      const outer = city ? 20 : 18;
      if (distance < outer) {
        const weight = (1 - smooth(city ? 17 : 12, outer, distance)) * (city ? smooth(6.6, 8, roadDistance(x, z)) : 1);
        height = blend(height, pad.height, weight);
      }
    }
    return height;
  }

  return { route, heightAt, roadDistance, nearest, halfSize, length, elevation };
}
