import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { AMSTERDAM, waterAt, bridgeAt, isAmsterdamDry, amsterdamHeightAt } from "./amsterdam-layout.js";
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
  return Math.min(...AMSTERDAM.streets.map(s => pointDistance({ x, z }, { x: s.x1, z: s.z1 }, { x: s.x2, z: s.z2 })));
}

test("Amsterdam exports the exact immutable water, street, bridge and world layout", () => {
  assert.equal(AMSTERDAM.halfSize, 320);
  assert.equal(AMSTERDAM.groundHalfSize, 340);
  assert.equal(AMSTERDAM.landY, 2.4);
  assert.equal(AMSTERDAM.waterY, 0.35);
  assert.equal(AMSTERDAM.bedY, -2);
  assert.deepEqual(AMSTERDAM.canals, [
    { name: "Prinsengracht", xMin: -292, xMax: 218, zMin: -161, zMax: -139 },
    { name: "Keizersgracht", xMin: -292, xMax: 218, zMin: -42, zMax: -18 },
    { name: "Herengracht", xMin: -292, xMax: 218, zMin: 77, zMax: 103 },
    { name: "Amstel", xMin: 182, xMax: 218, zMin: -294, zMax: 278 },
    { name: "IJ", xMin: -1100, xMax: 1100, zMin: 278, zMax: 1100 },
  ]);
  assert.deepEqual(AMSTERDAM.streets.map(s => [s.x1, s.z1, s.x2, s.z2]), [
    ...[-150, -30, 90].flatMap(z => [-24, 24].map(dz => [-270, z + dz, 164, z + dz])),
    ...[-250, -80, 70, 164, 236].map(x => [x, -266, x, 210]),
    ...[-222, -90, 30, 210].map(z => [z === -90 ? 150 : z === 30 ? 52 : -270, z, 260, z]),
  ]);
  assert.equal(AMSTERDAM.bridges.length, 16);
  for (const [i, z] of [-150, -30, 90].entries()) for (const x of [-250, -80, 70, 164]) {
    const bridge = AMSTERDAM.bridges.find(b => b.x === x && b.z === z);
    assert.ok(bridge);
    assert.equal(bridge.axis, "z");
    assert.equal(bridge.halfLength, 21 + i);
    assert.equal(bridge.kind, "arch");
    if (x === 164) assert.ok(x + bridge.halfWidth < 182, "quay bridge stays west of the Amstel");
  }
  for (const z of [-222, -90, 30, 210]) {
    const bridge = AMSTERDAM.bridges.find(b => b.x === 200 && b.z === z);
    assert.equal(bridge.axis, "x");
    assert.equal(bridge.halfLength, 28);
    assert.equal(bridge.kind, z === -90 ? "drawbridge" : "arch");
    if (z === -90) assert.equal(bridge.name, "Magere Brug");
  }
  for (const b of AMSTERDAM.bridges) {
    assert.equal(b.halfWidth, 9);
    assert.equal(b.rise, 0.85);
    assert.ok(Math.abs(b.x) + (b.axis === "x" ? b.halfLength : b.halfWidth) < AMSTERDAM.halfSize);
    assert.ok(Math.abs(b.z) + (b.axis === "z" ? b.halfLength : b.halfWidth) < AMSTERDAM.halfSize);
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
});

test("raw water is the inclusive rectangle union, including overlaps, harbor and water below decks", () => {
  const samples = [[182, -150], [218, -30], [200, 278], [219, 277], [219, 278], [1100, 1100], [1100.001, 1100]];
  for (const c of AMSTERDAM.canals) for (const x of [c.xMin - 1e-6, c.xMin, c.xMax, c.xMax + 1e-6]) {
    for (const z of [c.zMin - 1e-6, c.zMin, (c.zMin + c.zMax) / 2, c.zMax, c.zMax + 1e-6]) samples.push([x, z]);
  }
  for (let x = -340; x <= 340; x += 5) for (let z = -340; z <= 340; z += 5) samples.push([x, z]);
  for (const [x, z] of samples) {
    const wet = AMSTERDAM.canals.some(c => x >= c.xMin && x <= c.xMax && z >= c.zMin && z <= c.zMax);
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
  assert.ok(waterAt(174, -150));
  assert.ok(!isAmsterdamDry(174, -150), "water between the west quay bridge and the Amstel is not land");
});

test("dry margins protect circular spawns at banks, bridge sides, approaches and gameplay edges", () => {
  assert.ok(isAmsterdamDry(0, -170, 8.999));
  assert.ok(!isAmsterdamDry(0, -170, 9));
  assert.ok(!isAmsterdamDry(0, -161));
  assert.ok(isAmsterdamDry(-250, -150, 8.999));
  assert.ok(!isAmsterdamDry(-250, -150, 9.001));
  assert.ok(isAmsterdamDry(-241, -150));
  assert.ok(!isAmsterdamDry(-241, -150, 0.001));
  assert.ok(!isAmsterdamDry(-240.999, -150));
  // A disc at the approach end can exceed deck half-width: land also supports it.
  assert.ok(isAmsterdamDry(-250, -171, 13));
  assert.ok(!isAmsterdamDry(-250, -171, 13.46));
  assert.ok(isAmsterdamDry(173, -150));
  assert.ok(!isAmsterdamDry(173.001, -150));
  assert.ok(isAmsterdamDry(200, -90, 8.999));
  assert.ok(!isAmsterdamDry(200, -90, 9.001));
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

test("bridge support covers both axes and full approaches with smooth analytic crests and no end seams", () => {
  for (const b of AMSTERDAM.bridges) {
    const at = (along, across = 0) => b.axis === "x" ? { x: b.x + along, z: b.z + across } : { x: b.x + across, z: b.z + along };
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
  assert.ok(course.length > 2400 && course.length < 2500);
  const spacing = [];
  let length = 0, gain = 0;
  for (let i = 0; i < route.length; i++) {
    const a = route[i], b = route[(i + 1) % route.length];
    assert.ok(a instanceof Vector3 && [a.x, a.y, a.z].every(Number.isFinite));
    assert.ok(a.x >= -250 && a.x <= 236 && a.z >= -222 && a.z <= 210);
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
  assert.ok(gain > 5 && gain <= 5.1, "six gentle bridge crossings");
  close(course.elevation.min, AMSTERDAM.landY);
  close(course.elevation.max, AMSTERDAM.landY + 0.85, 0.001);
  const seam = route.at(-1).clone().lerp(route[0], 0.5), hit = course.nearest(seam.x, seam.z);
  assert.equal(hit.index, route.length - 1);
  close(hit.t, 0.5);
  close(hit.along, course.length - spacing.at(-1) / 2);
  close(course.nearest(0, 210).along, 0);
});

test("ten-metre fillets follow every specified orthogonal turn without overshoot or harsh grade changes", () => {
  for (const [x, z] of [[236, 210], [236, -90], [164, -90], [164, -222], [-250, -222],
    [-250, -174], [70, -174], [70, -126], [-80, -126], [-80, 66], [-250, 66], [-250, 210]]) {
    const distance = course.nearest(x, z).distance;
    assert.ok(distance > 4.1 && distance < 4.3, `10 m fillet at ${x},${z}`);
  }
  let turns = 0;
  for (let i = 0; i < route.length; i++) {
    const a = route[(i + route.length - 1) % route.length], b = route[i], c = route[(i + 1) % route.length];
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z);
    const area = cross(a, b, c), radius = ab * bc * Math.hypot(c.x - a.x, c.z - a.z) / (2 * Math.abs(area));
    assert.ok(radius > 9.7, `radius ${radius} at ${i}`);
    if (Math.abs(area) > 0.1) turns++;
    const grade = (c.y - b.y) / bc, previous = (b.y - a.y) / ab;
    assert.ok(Math.abs(grade) < 0.064);
    assert.ok(Math.abs(grade - previous) / ((ab + bc) / 2) < 0.02);
    for (const t of [0, 0.5]) {
      const p = b.clone().lerp(c, t);
      assert.ok(streetDistance(p.x, p.z) < 3.1, "rounded route remains in the street intersections");
      close(course.roadDistance(p.x, p.z), 0);
    }
    const before = b.clone().lerp(a, 1e-5), after = b.clone().lerp(c, 1e-5);
    close(course.nearest(before.x, before.z).bank, course.nearest(after.x, after.z).bank, 1e-5);
    close(course.heightAt(before.x, before.z), course.heightAt(after.x, after.z), 1e-5);
  }
  assert.ok(turns > 70);
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
    const count = Math.ceil(Math.hypot(s.x2 - s.x1, s.z2 - s.z1));
    for (let i = 0; i <= count; i++) {
      const x = s.x1 + (s.x2 - s.x1) * i / count, z = s.z1 + (s.z2 - s.z1) * i / count;
      close(course.roadDistance(x, z), 0);
      assert.ok(isAmsterdamDry(x, z, 6.5), `${s.name}: full street corridor at ${x},${z}`);
    }
  }
  for (const [x, z] of [[-80, 174], [236, -250], [120, 30], [200, -222]]) {
    assert.ok(course.nearest(x, z).distance > 20);
    close(course.roadDistance(x, z), 0);
  }
  for (const [x, z, expected] of [[-300, -222, 30], [-250, -290, 24], [300, 30, 40], [0, 240, 30]]) {
    close(course.roadDistance(x, z), expected);
  }
  assert.ok(course.roadDistance(0, 30) > 20, "Dam Square is a plaza, not a street through the canal-house blocks");
  assert.ok(course.roadDistance(-150, -90) > 20, "Kerkstraat stops at the Amstel approach");
  for (let x = -400; x <= 400; x += 29) for (let z = -400; z <= 400; z += 31) {
    close(course.roadDistance(x, z), Math.min(streetDistance(x, z), bruteNearest(x, z).distance));
  }
});

test("reserved architectural plots stay on land, within bounds and at least fifteen metres from the entire lap", () => {
  assert.deepEqual(AMSTERDAM.landmarks, [
    { id: "centraal", name: "Amsterdam Centraal", x: 0, z: 251, w: 172, d: 36 },
    { id: "rijksmuseum", name: "Rijksmuseum", x: 0, z: -267, w: 136, d: 40 },
    { id: "westerkerk", name: "Westerkerk", x: -173, z: 158, w: 34, d: 48 },
    { id: "palace", name: "Royal Palace", x: 4, z: 40, w: 60, d: 24 },
    { id: "nemo", name: "NEMO", x: 274, z: 244, w: 56, d: 38 },
    { id: "windmill", name: "De Gooyer", x: 275, z: -263, w: 26, d: 26 },
  ]);
  for (const plot of AMSTERDAM.landmarks) {
    const xMin = plot.x - plot.w / 2, xMax = plot.x + plot.w / 2, zMin = plot.z - plot.d / 2, zMax = plot.z + plot.d / 2;
    assert.ok(xMin > -320 && xMax < 320 && zMin > -320 && zMax < 320);
    for (const water of AMSTERDAM.canals) {
      assert.ok(xMax < water.xMin || xMin > water.xMax || zMax < water.zMin || zMin > water.zMax, `${plot.name}: dry foundation`);
    }
    const corners = [{ x: xMin, z: zMin }, { x: xMax, z: zMin }, { x: xMax, z: zMax }, { x: xMin, z: zMax }];
    for (let i = 0; i < route.length; i++) {
      const a = route[i], b = route[(i + 1) % route.length];
      assert.ok(Math.hypot(Math.max(xMin - a.x, 0, a.x - xMax), Math.max(zMin - a.z, 0, a.z - zMax)) >= 15);
      for (let j = 0; j < corners.length; j++) {
        assert.ok(segmentDistance(a, b, corners[j], corners[(j + 1) % corners.length]) >= 15, `${plot.name}: route setback`);
      }
    }
  }
});
