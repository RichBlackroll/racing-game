import test from "node:test";
import assert from "node:assert/strict";
import { createCourse } from "./course.js";
import { sampleDrivingSurface } from "./driving-terrain.js";

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
