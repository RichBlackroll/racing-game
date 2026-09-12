import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Scene, Vector3 } from "three";
import { createCourse } from "./course.js";
import { createRampCourse } from "./levels.js";
import { createTerrainBody } from "./terrain-physics.js";

const courses = Object.fromEntries(["forest", "city", "stunt", "moon"].map(level => [level, createCourse(level)]));
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

// The original smooth Moon relief, before off-road detail and road flattening.
function moonRelief(x, z) {
  const hill = (cx, cz, sx, sz) => Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
  const smooth = (a, b, value) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
  const height = 8 + 3 * Math.sin(x / 140) * Math.cos(z / 150)
    + 12 * hill(-155, 15, 85, 100) - 9 * hill(40, -20, 65, 65) + 5 * hill(100, 30, 120, 120)
    + 17 * hill(-290, 280, 140, 130) + 18 * hill(285, -260, 125, 140) - 5 * hill(285, 150, 110, 100);
  return height * (1 - (1 - smooth(145, 295, Math.abs(x))) * (1 - smooth(12, 112, Math.abs(Math.abs(z) - 140))));
}

function bruteNearest(route, x, z) {
  let best = { distance: Infinity };
  for (let i = 0; i < route.length; i++) {
    const a = route[i], b = route[(i + 1) % route.length], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const distance = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
    if (distance < best.distance) best = { distance, index: i, t, height: a.y + (b.y - a.y) * t };
  }
  return best;
}

test("closed courses have exact surface heights, nonduplicate points and measured 3D lengths", () => {
  for (const [level, course] of Object.entries(courses)) {
    const { route, heightAt, nearest, elevation } = course;
    assert.ok(route.length <= 1600, `${level}: bounded route and spatial-cache size`);
    const spacing = [];
    let gain = 0;
    for (let i = 0; i < route.length; i++) {
      const a = route[i], b = route[(i + 1) % route.length];
      assert.ok(a instanceof Vector3);
      assert.equal(a.y, heightAt(a.x, a.z));
      assert.ok(Math.abs(a.x) < course.halfSize - 20 && Math.abs(a.z) < course.halfSize - 20);
      spacing.push(a.distanceTo(b));
      gain += Math.max(0, b.y - a.y);
      const hit = nearest(a.x, a.z);
      close(hit.distance, 0);
      close(hit.height, a.y);
      assert.ok(hit.along >= 0 && hit.along < course.length);
    }
    assert.ok(Math.min(...spacing) > 1.5);
    assert.ok(Math.max(...spacing) <= 4, `${level}: at most four metres per segment`);
    assert.ok(Math.max(...spacing) / Math.min(...spacing) < 1.05);
    close(course.length, spacing.reduce((a, b) => a + b, 0));
    close(elevation.gain, gain);
    close(elevation.min, Math.min(...route.map(p => p.y)));
    close(elevation.max, Math.max(...route.map(p => p.y)));
    const a = route.at(-1), b = route[0];
    const hit = nearest((a.x + b.x) / 2, (a.z + b.z) / 2);
    assert.equal(hit.index, route.length - 1);
    close(hit.t, 0.5);
    close(hit.height, (a.y + b.y) / 2);
  }
});

test("all four laps grow substantially without expanding their driving squares", () => {
  for (const [level, minimum, previous, halfSize] of [
    ["forest", 4700, 3314.45, 620], ["city", 2500, 1578.49, 320],
    ["stunt", 2800, 1591.54, 420], ["moon", 2800, 1702.18, 420],
  ]) {
    const course = courses[level];
    assert.ok(course.length >= minimum && course.length > previous * 1.4, level);
    assert.equal(course.halfSize, halfSize);
    for (const axis of ["x", "z"]) {
      assert.ok(Math.min(...course.route.map(p => p[axis])) < -halfSize * 0.8, `${level}: negative ${axis} excursion`);
      assert.ok(Math.max(...course.route.map(p => p[axis])) > halfSize * 0.8, `${level}: positive ${axis} excursion`);
    }
  }
});

test("forest alternates outer ridges and inset valleys while retaining its starting straight", () => {
  const { route, length, elevation } = courses.forest;
  assert.ok(length >= 4700 && length < 5600);
  assert.ok(elevation.max - elevation.min > 60);
  assert.ok(elevation.gain > 220);
  close(route[0].x, 0);
  close(route[0].z, 340);
  assert.ok(route[1].x > route[0].x && Math.abs(route[1].z - route[0].z) < 0.3 * (route[1].x - route[0].x));
});

test("every course has safe bends, gentle grade changes and both climbs and dips", () => {
  for (const [level, course] of Object.entries(courses)) {
    const { route } = course;
    let climbing = 0, descending = 0, left = 0, right = 0;
    for (let i = 0; i < route.length; i++) {
      const a = route[(i + route.length - 1) % route.length], b = route[i], c = route[(i + 1) % route.length];
      const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z);
      const ac = Math.hypot(c.x - a.x, c.z - a.z);
      const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      const grade = (c.y - b.y) / bc, previousGrade = (b.y - a.y) / ab;
      assert.ok(ab * bc * ac / (2 * Math.abs(cross)) >= (level === "city" ? 3.8 : 18), `${level}: bend radius at ${i}`);
      assert.ok(Math.abs(grade) < (level === "forest" ? 0.32 : level === "city" ? 0.12 : 0.25), `${level}: grade ${grade} at ${i}`);
      assert.ok(Math.abs(grade - previousGrade) / ((ab + bc) / 2) < 0.02, `${level}: crest/dip at ${i}`);
      if (grade > 0.025) climbing += bc;
      if (grade < -0.025) descending += bc;
      if (cross > 0.05) left++;
      if (cross < -0.05) right++;
    }
    assert.ok(climbing > 150 && descending > 150, `${level}: sustained climbs and descents`);
    assert.ok(left > 20 && right > 20, `${level}: bends in both directions`);
  }
});

test("all closed routes are intersection-free with forty-metre nonlocal corridor clearance", () => {
  const cross = (a, b, p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  const pointDistance = (p, a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
  };
  for (const [level, { route, length }] of Object.entries(courses)) {
    for (let i = 0; i < route.length; i++) for (let j = i + 2; j < route.length; j++) {
      const separation = Math.min(j - i, route.length - j + i);
      if (separation === 1) continue;
      const a = route[i], b = route[(i + 1) % route.length], c = route[j], d = route[(j + 1) % route.length];
      const dx = Math.max(Math.min(a.x, b.x) - Math.max(c.x, d.x), Math.min(c.x, d.x) - Math.max(a.x, b.x), 0);
      const dz = Math.max(Math.min(a.z, b.z) - Math.max(c.z, d.z), Math.min(c.z, d.z) - Math.max(a.z, b.z), 0);
      if (Math.hypot(dx, dz) > 40) continue;
      const intersects = dx === 0 && dz === 0 && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
      assert.ok(!intersects, `${level}: intersection ${i}/${j}`);
      if (separation * length / route.length < 60) continue;
      const distance = Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b));
      assert.ok(distance > 40, `${level}: corridor clearance ${distance} at ${i}/${j}`);
    }
  }
});

test("spatial nearest matches exhaustive projection inside, on grid boundaries and far outside", () => {
  for (const course of Object.values(courses)) {
    let seed = 417;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const samples = [[0, 0], [32, -32], [-64, 96], [1e6, -1e6], [-10000, -10000]];
    for (let i = 0; i < 500; i++) samples.push([(random() * 2 - 1) * course.halfSize, (random() * 2 - 1) * course.halfSize]);
    for (const [x, z] of samples) {
      const expected = bruteNearest(course.route, x, z), hit = course.nearest(x, z);
      close(hit.distance, expected.distance);
      close(hit.height, expected.height);
      assert.ok(hit.index >= 0 && hit.index < course.route.length && Number.isInteger(hit.index));
      assert.ok(hit.t >= 0 && hit.t <= 1);
      assert.ok(Number.isFinite(hit.bank) && Math.abs(hit.bank) <= 0.08);
    }
  }
});

test("bank and surface queries stay continuous across vertices, lap seam and road shoulders", () => {
  for (const course of Object.values(courses)) {
    for (let i = 0; i < course.route.length; i++) {
      const p = course.route[i], prev = course.route[(i + course.route.length - 1) % course.route.length];
      const next = course.route[(i + 1) % course.route.length];
      const before = p.clone().lerp(prev, 1e-5), after = p.clone().lerp(next, 1e-5);
      close(course.nearest(before.x, before.z).bank, course.nearest(after.x, after.z).bank, 1e-5);
      close(course.heightAt(before.x, before.z), course.heightAt(after.x, after.z), 1e-3);
      if (i % 4) continue;
      const mid = p.clone().lerp(next, 0.5), tangent = next.clone().sub(p); tangent.y = 0; tangent.normalize();
      const normal = new Vector3(-tangent.z, 0, tangent.x);
      const hit = course.nearest(mid.x, mid.z);
      for (const side of [-1, 1]) {
        const edge = mid.clone().addScaledVector(normal, side * 6);
        const edgeHit = course.nearest(edge.x, edge.z);
        const a = course.route[edgeHit.index], b = course.route[(edgeHit.index + 1) % course.route.length];
        const edgeSide = Math.sign((b.x - a.x) * (edge.z - a.z) - (b.z - a.z) * (edge.x - a.x));
        // City shares an analytic surface across intersections. Its outer hills
        // can curve away from the local tangent plane over a full lane width.
        const cityOuter = course === courses.city && Math.max(Math.abs(edge.x), Math.abs(edge.z)) > 170;
        close(course.heightAt(edge.x, edge.z), edgeHit.height + edgeHit.bank * edgeSide * edgeHit.distance, cityOuter ? 0.08 : course === courses.city ? 0.015 : 1e-7);
        if (course !== courses.city) close(course.heightAt(edge.x, edge.z), hit.height + hit.bank * side * 6, 1e-7);
        for (const distance of [6.6, 20]) {
          const a = mid.clone().addScaledVector(normal, side * (distance - 1e-5));
          const b = mid.clone().addScaledVector(normal, side * (distance + 1e-5));
          close(course.heightAt(a.x, a.z), course.heightAt(b.x, b.z), 1e-3);
        }
      }
    }
  }
});

test("landscapes rise inside the driving square and stay finite and continuous beyond it", () => {
  for (const [level, course] of Object.entries(courses)) {
    const heights = [];
    for (let x = -course.halfSize; x <= course.halfSize; x += 13) for (let z = -course.halfSize; z <= course.halfSize; z += 13) {
      const y = course.heightAt(x, z);
      assert.ok(Number.isFinite(y));
      heights.push(y);
      if (level === "city") {
        assert.ok(y >= 0 && y <= 20);
        const dx = (course.heightAt(x + 0.001, z) - course.heightAt(x - 0.001, z)) / 0.002;
        const dz = (course.heightAt(x, z + 0.001) - course.heightAt(x, z - 0.001)) / 0.002;
        assert.ok(Math.hypot(dx, dz) <= 0.15, `city grade ${x},${z}`);
      }
    }
    assert.ok(Math.max(...heights) - Math.min(...heights) > (level === "forest" ? 65 : level === "city" ? 3 : 5));
    for (const [x, z] of [[-1e6, 1e6], [1e12, -1e12], [course.halfSize, 0], [0, -course.halfSize]]) {
      assert.ok(Number.isFinite(course.heightAt(x, z)));
      close(course.heightAt(x - 1e-5, z), course.heightAt(x + 1e-5, z), 1e-3);
    }
  }
});

test("city serpent and peripheral avenues clear buildings and preserve the complete bounded grid", () => {
  const course = courses.city;
  assert.ok(course.length >= 2500 && course.length < 3800);
  assert.ok(course.elevation.max - course.elevation.min > 10 && course.elevation.gain > 20);
  let turns = 0, peripheralLength = 0;
  for (let i = 0; i < course.route.length; i++) {
    const p = course.route[i], a = course.route[(i + 1) % course.route.length], b = course.route[(i + 2) % course.route.length];
    close(course.roadDistance(p.x, p.z), 0);
    const mid = p.clone().lerp(a, 0.5);
    close(course.roadDistance(mid.x, mid.z), 0);
    if (Math.max(Math.abs(mid.x), Math.abs(mid.z)) > 170) peripheralLength += p.distanceTo(a);
    assert.ok((a.x - p.x) * (b.x - a.x) + (a.z - p.z) * (b.z - a.z) > 0);
    if (Math.abs((a.x - p.x) * (b.z - a.z) - (a.z - p.z) * (b.x - a.x)) > 0.1) turns++;
    for (let x = -125; x <= 125; x += 50) for (let z = -125; z <= 125; z += 50) {
      assert.ok(Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) > 23);
    }
  }
  assert.ok(turns >= 8);
  assert.ok(peripheralLength > 1200, "substantial timed road outside downtown, not just a larger grid");
  for (let grid = -150; grid <= 150; grid += 50) for (let p = -150; p <= 150; p += 5) {
    close(course.roadDistance(grid, p), 0);
    close(course.roadDistance(p, grid), 0);
    close(course.heightAt(grid, p), 8 + 5 * Math.sin(grid / 1200) + 3 * Math.sin(p / 1300));
    close(course.heightAt(p, grid), 8 + 5 * Math.sin(p / 1200) + 3 * Math.sin(grid / 1300));
  }
  close(course.roadDistance(125, 125), 25);
  for (const [x, z] of [[200, 0], [200, 200], [310, -310], [-300, 30]]) {
    const gx = Math.max(-150, Math.min(150, Math.round(x / 50) * 50));
    const gz = Math.max(-150, Math.min(150, Math.round(z / 50) * 50));
    close(course.roadDistance(x, z), Math.min(course.nearest(x, z).distance,
      Math.hypot(x - gx, Math.max(0, Math.abs(z) - 150)), Math.hypot(z - gz, Math.max(0, Math.abs(x) - 150))));
  }
  assert.ok(course.nearest(-100, -150).distance > 40);
  close(course.roadDistance(-100, -150), 0);
});

test("building foundation pads are flat without intruding onto roads", () => {
  for (const [level, centers, inner, outer] of [
    ["forest", [[-30, 68], [118, 25]], 12, 18],
    ["city", Array.from({ length: 36 }, (_, i) => [-125 + i % 6 * 50, -125 + Math.floor(i / 6) * 50]), 17, 20],
  ]) {
    const course = courses[level];
    for (const [x, z] of centers) {
      const height = course.heightAt(x, z);
      for (let dx = -inner; dx <= inner; dx += 2) for (let dz = -inner; dz <= inner; dz += 2) {
        close(course.heightAt(x + dx, z + dz), height);
        assert.ok(course.roadDistance(x + dx, z + dz) >= 8);
      }
      for (const r of [inner, outer]) for (const side of [-1, 1]) {
        close(course.heightAt(x + side * (r - 1e-5), z), course.heightAt(x + side * (r + 1e-5), z), 1e-3);
      }
    }
  }
});

test("stunt and moon extend the circuit with compound bends while keeping safe ramp runs", () => {
  for (const level of ["stunt", "moon"]) {
    const course = courses[level];
    assert.ok(course.length >= 2800 && course.length < 4000);
    assert.ok(course.elevation.max - course.elevation.min > 24 && course.elevation.gain > 50);
    for (let x = -120; x <= 120; x += 4) for (const side of [-1, 1]) for (let dz = -12; dz <= 12; dz += 2) {
      close(course.heightAt(x, side * 140 + dz), 0);
      close(course.nearest(x, side * 140).bank, 0);
      close(course.nearest(x, side * 140).distance, 0);
    }
    // Reindexing and coarser sampling must not relocate a ramp into an outer bend.
    for (const route of [course.route, [...course.route.slice(137), ...course.route.slice(0, 137)].filter((_, i) => i % 2 === 0)]) {
      const scene = new Scene(), ramps = createRampCourse(scene, route, level === "moon");
      assert.equal(ramps.length, 2);
      for (const [i, ramp] of ramps.entries()) {
        const direction = i === 0 ? 1 : -1;
        close(ramp.x, direction * -280 / 3);
        close(ramp.z, direction * 140);
        close(ramp.heading, direction * Math.PI / 2);
        for (let distance = -25; distance <= 180; distance += 2) {
          for (const side of [-ramp.width / 2, 0, ramp.width / 2]) {
            close(course.heightAt(ramp.x + direction * distance, ramp.z + side), 0);
          }
        }
      }
      scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    }
  }
  assert.notDeepEqual(courses.stunt.route, courses.moon.route, "distinct hill and crater layouts");
});

test("course creation is deterministic and rejects unknown levels", () => {
  for (const [level, course] of Object.entries(courses)) assert.deepEqual(createCourse(level).route, course.route);
  assert.throws(() => createCourse("unknown"), RangeError);
});

test("lunar detail preserves shipped route samples, banks and non-Moon surfaces", () => {
  // Quantized pre-detail fingerprints cover every route vertex and a terrain grid.
  const digest = data => createHash("sha256").update(JSON.stringify(data)).digest("hex");
  for (const [level, routeHash, surfaceHash] of [
    ["forest", "b7c4add6520685df2060eb308f39a3ee64d8722a8bcd2fa2d3729965f049e7ec", "232799de8f65a6e19229015a6fe23e2e410d56ab267d3dfaf293d4881e42e8b9"],
    ["city", "0dc49589806bf7bbd712b2275a1400cc982c15a5ecd4ae33d3d5e6c6599429e3", "d9821fa7fbe20898e1d2859b4e486ccb506b5bf6941529d11e8b25f8b8f99cdc"],
    ["stunt", "974864dec064b2cf9cbd7ba5b6976a0adc3744a109dfb261b61887e3370937f3", "817217d1536df3fafba63aa749ad6aef92ca218f0ea2cf6d59edca7d59f174a3"],
    ["moon", "ac20be61ebb4677ce4304b4f632d457eaf621fad525607f481411fcfdd6f8823"],
  ]) {
    const course = courses[level];
    assert.equal(digest(course.route.map(p => [...p.toArray(), course.nearest(p.x, p.z).bank].map(n => +n.toFixed(8)))), routeHash, level);
    if (!surfaceHash) continue;
    const samples = [];
    for (let x = -course.halfSize; x <= course.halfSize; x += 37) for (let z = -course.halfSize; z <= course.halfSize; z += 41) {
      samples.push(+course.heightAt(x, z).toFixed(8));
    }
    assert.equal(digest(samples), surfaceHash, `${level}: untouched terrain`);
  }
  close(courses.moon.length, 3630.791125751489);
  assert.equal(courses.moon.route.length, 1038);
});

test("Moon impacts have shallow depressed basins and raised irregular rims off road", () => {
  const course = courses.moon;
  for (const [x, z, radius] of [[-100, -25, 30], [100, 30, 26], [20, -260, 38], [-90, 290, 32],
    [290, 245, 28], [-285, -250, 30], [370, 30, 26], [-365, -5, 26]]) {
    assert.ok(course.roadDistance(x, z) > radius * 1.75 + 15, "impact support clears the driving lanes");
    const center = course.heightAt(x, z), depression = moonRelief(x, z) - center;
    assert.ok(depression > 3 && depression < 8, `shallow basin at ${x},${z}: ${depression}`);
    const rims = [];
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8, px = x + radius * Math.cos(angle), pz = z + radius * Math.sin(angle);
      const y = course.heightAt(px, pz);
      assert.ok(y > center + 1.5, `basin enclosed even on the downhill rim at ${x},${z}, angle ${i}`);
      rims.push(y - moonRelief(px, pz));
      for (const r of [0, 0.65, 1, 1.55, 1.75]) {
        const before = radius * r - 1e-5, after = radius * r + 1e-5;
        close(course.heightAt(x + before * Math.cos(angle), z + before * Math.sin(angle)),
          course.heightAt(x + after * Math.cos(angle), z + after * Math.sin(angle)), 1e-3);
      }
    }
    assert.ok(rims.filter(y => y > 0.3).length >= 12, `raised ejecta at ${x},${z}`);
    assert.ok(Math.max(...rims) - Math.min(...rims) > 0.5, "rim is not a uniform ring");
  }
});

test("Moon regolith is deterministic, bounded and continuous across masks, rims and shoulders", () => {
  const course = courses.moon, repeat = createCourse("moon");
  let broken = 0;
  for (let x = -420; x <= 420; x += 7) for (let z = -420; z <= 420; z += 7) {
    const y = course.heightAt(x, z);
    assert.equal(y, repeat.heightAt(x, z));
    assert.ok(Number.isFinite(y) && Math.abs(y - moonRelief(x, z)) < 10);
    const dx = (course.heightAt(x + 0.001, z) - course.heightAt(x - 0.001, z)) / 0.002;
    const dz = (course.heightAt(x, z + 0.001) - course.heightAt(x, z - 0.001)) / 0.002;
    assert.ok(Math.hypot(dx, dz) < 1, `bounded terrain grade at ${x},${z}: ${Math.hypot(dx, dz)}`);
    if (course.roadDistance(x, z) > 40) {
      const curvature = course.heightAt(x - 4, z) + course.heightAt(x + 4, z) - 2 * y;
      if (Math.abs(curvature) > 0.1) broken++;
    }
  }
  assert.ok(broken > 1000, `metre-scale undulations, not just smooth macro hills: ${broken}`);
  for (const [x, z] of [[-100, -25], [130, 30], [145, 128], [295, 152], [-56, 12], [40, 108],
    [68, 60], [420, 30], [560, 30], [-1e6, 1e6], [1e12, -1e12], [Number.MAX_VALUE, -Number.MAX_VALUE]]) {
    assert.ok(Number.isFinite(course.heightAt(x, z)));
    for (const [dx, dz] of [[1e-5, 0], [0, 1e-5]]) close(course.heightAt(x - dx, z - dz), course.heightAt(x + dx, z + dz), 1e-3);
    if (Math.max(Math.abs(x), Math.abs(z)) >= 560) assert.equal(course.heightAt(x, z), moonRelief(x, z));
  }
});

test("Moon detail leaves the central base and full ramp corridors exactly unchanged", () => {
  const course = courses.moon;
  for (let x = -56; x <= 40; x += 4) for (let z = 12; z <= 108; z += 4) assert.equal(course.heightAt(x, z), moonRelief(x, z));
  for (let x = -140; x <= 140; x += 2.5) for (const side of [-1, 1]) for (let dz = -12; dz <= 12; dz++) {
    assert.equal(course.heightAt(x, side * 140 + dz), 0, `exact runway at ${x},${side * 140 + dz}`);
  }
});

test("Moon collision heightfield samples the same rugged surface, including crater floors and rims", () => {
  const course = courses.moon, body = createTerrainBody(course), shape = body.shapes[0];
  assert.equal(shape.elementSize, 4);
  for (let i = 0; i < shape.data.length; i++) for (let j = 0; j < shape.data[i].length; j++) {
    const x = -course.halfSize + i * shape.elementSize, z = course.halfSize - j * shape.elementSize;
    assert.equal(shape.data[i][j], course.heightAt(x, z));
  }
  assert.equal(body.position.y, 0.075, "only the existing contact offset is added");
});
