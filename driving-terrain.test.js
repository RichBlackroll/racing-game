import test from "node:test";
import assert from "node:assert/strict";
import { createCourse } from "./course.js";
import { sampleDrivingSurface } from "./driving-terrain.js";

test("vehicle wheelbase and track control contact spacing with independent stock defaults", () => {
  for (const dimensions of [{}, { wheelbase: 3.1, track: 2.5 }, { wheelbase: 3.55, track: 2.65 }, { wheelbase: 4 }, { track: 3 }]) {
    const wheelbase = dimensions.wheelbase ?? 2.9, track = dimensions.track ?? 1.7;
    for (const heading of [0, .7, Math.PI / 2]) {
      const samples = [], heightAt = (x, z) => x * x + z * z * z;
      const pose = sampleDrivingSurface((x, z) => { samples.push([x, z]); return heightAt(x, z); }, 5, 7, heading, dimensions);
      const expected = [[Math.sin(heading) * wheelbase / 2, Math.cos(heading) * wheelbase / 2],
        [-Math.sin(heading) * wheelbase / 2, -Math.cos(heading) * wheelbase / 2],
        [Math.cos(heading) * track / 2, -Math.sin(heading) * track / 2],
        [-Math.cos(heading) * track / 2, Math.sin(heading) * track / 2]].map(([x, z]) => [5 + x, 7 + z]);
      assert.deepEqual(samples, expected);
      const [front, rear, right, left] = expected.map(([x, z]) => heightAt(x, z));
      assert.deepEqual(pose, { height: (front + rear + right + left) / 4,
        pitch: Math.atan2(front - rear, wheelbase), roll: Math.atan2(right - left, track), grade: (front - rear) / wheelbase });
    }
  }
  const heightAt = (x, z) => x * x + z * z;
  assert.deepEqual(sampleDrivingSurface(heightAt, 2, 3, .7), sampleDrivingSurface(heightAt, 2, 3, .7, {}));
});

test("chassis follows altitude, longitudinal grade, and banking in either direction", () => {
  const heightAt = (x, z) => 40 + x * .12 + z * .2;
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const pose = sampleDrivingSurface(heightAt, 35, -10, heading);
    assert.ok(Math.abs(pose.height - heightAt(35, -10)) < 1e-9);
    assert.ok(Math.abs(pose.grade - (.12 * Math.sin(heading) + .2 * Math.cos(heading))) < 1e-9);
    assert.ok(Math.abs(Math.tan(pose.roll) - (.12 * Math.cos(heading) - .2 * Math.sin(heading))) < 1e-9);
  }
});

test("complete hilly lap gives finite grounded chassis poses and both climbs and descents", () => {
  const course = createCourse("forest");
  let climbing = 0, descending = 0, banked = 0;
  course.route.forEach((p, i) => {
    const next = course.route[(i + 1) % course.route.length];
    const pose = sampleDrivingSurface(course.heightAt, p.x, p.z, Math.atan2(next.x - p.x, next.z - p.z));
    assert.ok(Object.values(pose).every(Number.isFinite));
    assert.ok(Math.abs(pose.height - p.y) < .2);
    if (pose.grade > .08) climbing++;
    if (pose.grade < -.08) descending++;
    if (Math.abs(pose.roll) > .025) banked++;
  });
  assert.ok(climbing > 100 && descending > 100 && banked > 100);
});
