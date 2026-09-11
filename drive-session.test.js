import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as THREE from "three";
import { moveWithBounces } from "./collision.js";
import { sampleDrivingSurface } from "./driving-terrain.js";

const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
const functions = source.slice(source.indexOf("  function reset("), source.indexOf("  function show(s)"));

function fixture() {
  const drive = { x: 420, z: -40, heading: 1.2, checkpoint: 3, lap: 2, lapSeconds: 42, bestLap: 180 };
  const writes = [], resets = [];
  let flight = { airborne: false, clearance: 0 };
  const field = { reset(position) { resets.push(position.clone()); } };
  const context = {
    gameReady: false,
    saved: { drives: { forest: drive } }, level: "forest",
    session: { value: { drives: { moon: { ...drive, x: 80 } } }, update(value) { this.value = value; writes.push(value); } },
    sceneDirty: false, boosting: true, recovering: true, boostEnds: 4000,
    flame: { visible: true }, boostButton: {}, boostText: {}, boostLabel: "Boost",
    car: new THREE.Group(), camera: new THREE.PerspectiveCamera(), cameraAnchor: new THREE.Vector3(),
    start: new THREE.Vector3(0, 0, 0), route: [new THREE.Vector3(), new THREE.Vector3(1, 0, 0)],
    speed: 20, slipX: 2, slipZ: 1, collisionCount: 3, steer: .5, heading: 0,
    surfacePose: null, checkpoint: 1, lap: 1, travel: 20, lapSeconds: 0, bestLap: 0,
    heightAt: (x, z) => x * .02 + z * .01, obstacles: [], course: { halfSize: 620 },
    coneField: field, playField: field, peopleField: field, friendRacers: field,
    vehicleModel: { flag: { resets: 0, reset() { this.resets++; } } },
    jumpPhysics: { reset() { flight = { airborne: false, clearance: 0 }; }, state: () => flight },
    moveWithBounces, sampleDrivingSurface, clearCamera() {}, show() {}, resetItems() {},
  };
  const api = runInNewContext(`${functions}; ({ reset, saveDrive });`, context);
  return { context, drive, writes, resets, api, flight(value) { flight = value; } };
}

test("startup restores per-map pose, checkpoint and lap timing on current terrain, with no momentum", () => {
  const { api, context: c, drive, writes, resets } = fixture();
  api.reset(true);
  assert.equal(c.car.position.x, drive.x);
  assert.equal(c.car.position.z, drive.z);
  assert.equal(c.car.position.y, c.heightAt(drive.x, drive.z));
  for (const key of ["heading", "checkpoint", "lap", "lapSeconds", "bestLap"]) assert.equal(c[key], drive[key]);
  for (const key of ["speed", "slipX", "slipZ", "steer", "boostEnds"]) assert.equal(c[key], 0);
  assert.equal(c.boosting || c.recovering || c.flame.visible, false);
  assert.equal(resets.length, 4);
  assert.equal(c.vehicleModel.flag.resets, 1);
  assert.ok(resets.every((position) => position.equals(c.car.position)));
  assert.equal(writes[0].drives.moon.x, 80, "saving this map preserves the other maps");
});

test("restoration resolves static collisions and bounds, while Reset explicitly starts a new lap", () => {
  const { api, context: c } = fixture();
  c.obstacles = [{ x: 420, z: -40, r: 3 }];
  c.course.halfSize = 300;
  api.reset(true);
  assert.ok(c.car.position.x <= 300 - 1.12);
  assert.ok(Math.hypot(c.car.position.x - 420, c.car.position.z + 40) > 4.12);
  api.reset();
  assert.ok(c.car.position.equals(c.start));
  assert.equal(c.checkpoint, 1);
  assert.equal(c.lap, 1);
  assert.equal(c.lapSeconds, 0);
  assert.equal(c.session.value.drives.forest.x, 0);
});

test("airborne or ramp-supported positions cannot replace the last safe driving save", () => {
  const { api, writes, flight } = fixture();
  api.reset(true);
  for (const state of [{ airborne: true, clearance: 3 }, { airborne: false, clearance: 2 }]) {
    flight(state);
    api.saveDrive();
  }
  assert.equal(writes.length, 1);
  flight({ airborne: false, clearance: .05 });
  api.saveDrive();
  assert.equal(writes.length, 2);
});

test("longer courses preserve saved cars but retire incompatible checkpoints and best laps", () => {
  const { api, context: c, drive, writes } = fixture();
  c.course.length = 5098.3;
  api.reset(true);
  assert.equal(c.car.position.x, drive.x);
  assert.equal(c.car.position.z, drive.z);
  assert.equal(c.checkpoint, 1);
  assert.equal(c.lap, 1);
  assert.equal(c.lapSeconds, 0);
  assert.equal(c.bestLap, 0);
  assert.equal(writes[0].drives.forest.courseLength, 5098);
  drive.courseLength = 5098;
  api.reset(true);
  assert.equal(c.checkpoint, drive.checkpoint);
  assert.equal(c.bestLap, drive.bestLap);
});

test("restoring beneath a raised lookout does not collide with its overhead deck", () => {
  const { api, context: c, drive } = fixture();
  c.obstacles = [{ x: drive.x, z: drive.z, y: c.heightAt(drive.x, drive.z) + 12, hx: 6, hz: 6, height: 1 }];
  api.reset(true);
  assert.equal(c.car.position.x, drive.x);
  assert.equal(c.car.position.z, drive.z);
});

test("waterfront saves never restore or persist a position in water or a landmark", () => {
  const { api, context: c, writes } = fixture();
  c.course.isSafePosition = (x, z, margin) => Math.hypot(x, z) + margin < 50;
  api.reset(true);
  assert.ok(c.car.position.equals(c.start), "an unsafe saved pose falls back to the starting road");
  assert.equal(c.checkpoint, 1);
  assert.equal(c.lapSeconds, 0);
  assert.equal(writes.length, 1);
  c.car.position.set(80, 0, 0);
  api.saveDrive();
  assert.equal(writes.length, 1, "do not replace the last safe save");
});

test("interrupting an already paused garage still silences previews and saves", () => {
  const pause = source.slice(source.indexOf("  function pauseGame(value)"), source.indexOf("  pauseButton.onclick"));
  let silenced = 0, saved = 0;
  runInNewContext(`${pause}; pauseGame(true);`, { paused: true, loading: { active: false }, audio: { silence() { silenced++; } }, saveDrive() { saved++; } });
  assert.equal(silenced, 1);
  assert.equal(saved, 1);
});
