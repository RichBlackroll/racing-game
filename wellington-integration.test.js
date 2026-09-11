import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCourse } from "./course.js";
import { createSession } from "./session.js";
import { stepRacerBodies } from "./racer-physics.js";
import { projectWellington } from "./wellington-layout.js";

test("Wellington is registered and preserves an independent drive across reloads", () => {
  const course = createCourse("wellington"), storage = new Map();
  const localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const session = createSession({ localStorage });
  const city = { x: 10, z: 20, heading: 0, checkpoint: 2, lap: 1 };
  const wellington = { x: course.route[0].x, z: course.route[0].z, heading: 1, checkpoint: 3, lap: 2 };
  session.update({ level: "wellington", drives: { city, wellington } });
  const saved = createSession({ localStorage }).value;
  assert.equal(saved.level, "wellington");
  assert.equal(saved.drives.city.x, city.x);
  assert.equal(saved.drives.wellington.x, wellington.x);
  assert.equal(saved.drives.wellington.checkpoint, 3);
  assert.ok(course.length > 4000 && course.length < 4100);
});

test("cars stop before water even under boost or a lateral collision", () => {
  const body = (x, vx, mass = 1) => ({ x, y: 3, z: 0, vx, vz: 0, mass, radius: 1.65 });
  const safe = (x, z, margin) => x + margin < 0;
  const car = body(-10, 180);
  for (let i = 0; i < 20; i++) {
    stepRacerBodies([car], .05, [], 1500, safe);
    assert.ok(safe(car.x, car.z, 2.5));
  }
  assert.equal(car.vx, 0);
  const shunter = body(-7, 100, 2), shoreCar = body(-2.6, 0);
  stepRacerBodies([shunter, shoreCar], .05, [], 1500, safe);
  assert.ok(safe(shoreCar.x, shoreCar.z, 2.5));
  assert.ok(shoreCar.staticHits > 0);
});

test("the actual Wellington quay masks stop a car before entering the harbour", () => {
  const course = createCourse("wellington"), start = projectWellington(-41.286, 174.7785);
  assert.ok(course.isSafePosition(start.x, start.z, 2.5));
  const car = { ...start, y: 3, vx: 100, vz: 0, radius: 1.12, mass: 1.6 };
  let stopped = false;
  for (let i = 0; i < 100; i++) {
    stepRacerBodies([car], .05, [], course.halfSize, course.isSafePosition);
    assert.ok(course.isSafePosition(car.x, car.z, 2.5));
    if (car.staticHits) { stopped = true; break; }
  }
  assert.ok(stopped);
  assert.equal(car.vx, 0);
});

test("production map wiring uses waterfront geometry and visible attribution", async () => {
  const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.match(source, /isWellington \? createWellingtonWorld\(/);
  assert.match(source, /waterfront\?\.drawMap\(map, mapScale\)/);
  assert.match(source, /if \(site.access\?\.start\)/);
  assert.match(source, /camera.far = isWellington \? 12000/);
  assert.match(html, /data-map="wellington"/);
  assert.match(html, /option value="wellington"/);
  assert.match(html, /id="map-attribution"[\s\S]*openstreetmap.org\/copyright/);
  assert.match(html, /href="WELLINGTON.md"/);
});
