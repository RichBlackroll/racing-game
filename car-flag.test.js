import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCarFlag } from "./car-flag.js";
import { enableGeometryShadows } from "./daylight.js";

function sample(vx, vz, heading = 0) {
  const flag = createCarFlag("nz"), positions = flag.cloth.geometry.attributes.position;
  let y = 0, z = 0, x = 0, motion = 0, lastX, lastY, lastZ;
  for (let i = 0; i < 600; i++) {
    flag.update(1 / 60, vx, vz, heading);
    if (i < 300) continue;
    const nextX = positions.getX(10), nextY = positions.getY(10), nextZ = positions.getZ(10);
    x += nextX; y += nextY - positions.getY(0); z += nextZ;
    if (lastX !== undefined) motion += (nextX - lastX) ** 2 + (nextY - lastY) ** 2 + (nextZ - lastZ) ** 2;
    lastX = nextX; lastY = nextY; lastZ = nextZ;
  }
  flag.dispose();
  return { x: x / 300, y: y / 300, z: z / 300, flutter: Math.sqrt(motion / 299) };
}

test("cloth hangs at rest, streams backward with speed, and flutters faster under boost", () => {
  const parked = sample(0, 0), slow = sample(0, 8), cruise = sample(0, 25), boost = sample(0, 60);
  assert.ok(parked.y < -.7, "gravity droops the free edge below the pinned edge");
  assert.ok(cruise.y > parked.y + .4, "air pressure lifts the fabric");
  assert.ok(cruise.z < -.6 && boost.z < -.6, "cloth trails the car, rather than facing the camera");
  assert.ok(cruise.x > .5 && boost.x > .5, "rear-corner outwash exposes the flag's face in chase view");
  assert.ok(slow.flutter > parked.flutter * 2);
  assert.ok(cruise.flutter > slow.flutter * 2);
  assert.ok(boost.flutter > cruise.flutter * 1.5);
});

test("air direction follows reverse, sideways slides, and world-space headings", () => {
  assert.ok(sample(0, -25).z > .6, "reversing blows the flag toward the bonnet");
  assert.ok(sample(25, 0).x < -.6, "lateral collision momentum also drives wind");
  assert.ok(sample(25, 0, Math.PI / 2).z < -.6, "world velocity converts into car-local air");
});

test("pins stay fixed and fabric remains bounded through turns, braking, and extreme speeds", () => {
  for (const country of ["pt", "ca", "be", "fr", "nz", "no"]) {
    const flag = createCarFlag(country), p = flag.cloth.geometry.attributes.position;
    const initial = p.array.slice();
    const width = flag.cloth.geometry.parameters.width;
    for (let frame = 0; frame < 240; frame++) {
      const speed = frame < 80 ? 150 : frame < 160 ? -40 : 0;
      flag.update(.05, speed, speed / 2, frame * .03);
      for (let i = 0; i < p.count; i++) {
        assert.ok([p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite));
        if (i % 11 === 0) for (let axis = 0; axis < 3; axis++) assert.ok(p.array[i * 3 + axis] === initial[i * 3 + axis]);
        const pin = Math.floor(i / 11) * 11;
        assert.ok(Math.hypot(p.getX(i), p.getY(i) - p.getY(pin), p.getZ(i)) < width * 1.2);
      }
    }
    flag.update(.05, .9, .3, 0);
    assert.ok(p.array.every(Number.isFinite), "zero relative wind cannot divide by zero");
    flag.reset(); assert.deepEqual(p.array, initial);
    flag.dispose();
  }
});

test("larger country-proportioned cloth uses the same mesh budget and a rear bumper bracket", () => {
  for (const country of ["pt", "ca", "be", "fr", "nz", "no"]) {
    const flag = createCarFlag(country), geometry = flag.cloth.geometry, image = flag.cloth.material.map.image;
    assert.equal(geometry.parameters.height, .7);
    assert.ok(Math.abs(geometry.parameters.width / geometry.parameters.height - image.width / image.height) < 1e-6);
    assert.equal(geometry.attributes.position.count, 66, "larger flags do not cost more cloth simulation points");
    const mount = flag.group.getObjectByName("flag-mount"), pole = flag.group.getObjectByName("flag-pole");
    assert.equal(pole.geometry.parameters.height, 3);
    assert.ok(mount.position.z + mount.geometry.parameters.depth / 2 > 1.1, "bracket reaches forward into the bumper");
    flag.dispose();
  }
});

test("fixed substeps agree at 30, 60, 120 and 144 fps, and cap long suspended frames", () => {
  let reference;
  for (const fps of [30, 60, 120, 144]) {
    const flag = createCarFlag("ca");
    for (let i = 0; i < fps * 2; i++) flag.update(1 / fps, 0, 25);
    const points = flag.cloth.geometry.attributes.position.array;
    reference ??= points.slice();
    points.forEach((value, i) => assert.ok(Math.abs(value - reference[i]) < 1e-5, `fps ${fps}, vertex ${i}`));
    flag.reset(); flag.update(20, 0, 25);
    const capped = points.slice();
    flag.reset(); flag.update(.05, 0, 25);
    assert.deepEqual(points, capped);
    flag.dispose();
  }
});

test("paused, invalid and reduced-motion updates freeze cloth; resources dispose only once", () => {
  const flag = createCarFlag("fr");
  flag.update(.05, 0, 30);
  const geometry = flag.cloth.geometry, initial = geometry.attributes.position.array.slice();
  for (const dt of [0, -1, NaN, Infinity]) flag.update(dt, 10, 30, 1);
  for (const velocity of [NaN, Infinity, -Infinity]) flag.update(.05, velocity, 30);
  flag.update(.05, 0, 30, NaN);
  flag.update(.05, 0, 30, 1, true);
  assert.deepEqual(geometry.attributes.position.array, initial);
  assert.equal(flag.cloth.material.side, THREE.DoubleSide);
  assert.equal(geometry.attributes.position.usage, THREE.DynamicDrawUsage);
  enableGeometryShadows(flag.group);
  const resources = new Map([[flag.cloth.material.map, 0]]);
  flag.group.traverse(node => {
    if (!node.isMesh) return;
    assert.equal(node.castShadow, false, "animated cloth stays out of the cached scenery shadow");
    resources.set(node.geometry, 0); resources.set(node.material, 0);
  });
  for (const resource of resources.keys()) resource.addEventListener("dispose", () => resources.set(resource, resources.get(resource) + 1));
  const parent = new THREE.Group(); parent.add(flag.group);
  flag.dispose(); flag.dispose(); flag.update(.05, 0, 30);
  assert.equal(parent.children.length, 0);
  assert.ok([...resources.values()].every(count => count === 1));
  assert.deepEqual(geometry.attributes.position.array, initial);
});
