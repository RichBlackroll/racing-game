import test from "node:test";
import assert from "node:assert/strict";
import { createSession, resolveLevel } from "./session.js";
import { DEFAULTS } from "./modifier-data.js";

function browser(raw) {
  const entries = new Map([["wildrun-session-v1", raw], ["wildrun-friends-v1", '{"index":2,"collected":1}']]);
  const localStorage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  return { win: { localStorage }, entries };
}

test("URL map selection takes precedence over local session with validated defaults", () => {
  assert.equal(resolveLevel("?level=moon", "city"), "moon");
  assert.equal(resolveLevel("?level=amsterdam", "city"), "amsterdam");
  assert.equal(resolveLevel("?level=wellington", "city"), "wellington");
  assert.equal(resolveLevel("", "wellington"), "wellington");
  assert.equal(resolveLevel("?level=city", "amsterdam"), "city");
  assert.equal(resolveLevel("", "city"), "city");
  assert.equal(resolveLevel("", "amsterdam"), "amsterdam");
  assert.equal(resolveLevel("?level=toString", "stunt"), "stunt");
  assert.equal(resolveLevel("?level=toString", "amsterdam"), "amsterdam");
  assert.equal(resolveLevel("?level=invalid", "invalid"), "forest");
  assert.equal(resolveLevel("?level=Amsterdam", "invalid"), "forest");
});

test("missing, malformed and invalid sessions restore safe defaults", () => {
  for (const raw of [undefined, "{", "null", "[]", '"text"', JSON.stringify({ config: { engine: "toString" }, camera: "2", selectedPart: "bad", drives: { city: { x: Infinity } } })]) {
    const session = createSession(browser(raw).win);
    assert.deepEqual(session.value.config, DEFAULTS);
    assert.equal(session.value.camera, 0);
    assert.equal(session.value.selectedPart, "color");
    assert.deepEqual(session.value.drives, {});
    assert.equal(session.value.sound, true);
    assert.equal(session.value.vehicle, "porsche");
  }
});

test("vehicle choices validate, restore their engine defaults and preserve custom builds", () => {
  for (const vehicle of [undefined, "golf", "toString", "__proto__", null]) {
    const session = createSession(browser(JSON.stringify({ vehicle, config: { color: "blue" } })).win);
    assert.equal(session.value.vehicle, "porsche");
    assert.deepEqual(session.value.config, { ...DEFAULTS, color: "blue" });
  }
  const { win } = browser(JSON.stringify({ vehicle: "tesla" }));
  const session = createSession(win);
  assert.equal(session.value.vehicle, "tesla");
  assert.deepEqual(session.value.config, { ...DEFAULTS, engine: "electric" });
  const drive = { x: 30, z: -40, heading: 1, checkpoint: 2, lap: 1, lapSeconds: 0, bestLap: 0 };
  session.update({ level: "moon", camera: 2, drives: { moon: drive },
    config: { ...session.value.config, color: "blue", wheels: "monster", engine: "eight" } });
  const reloaded = createSession({ localStorage: win.localStorage });
  assert.deepEqual(reloaded.value, session.value);
  assert.equal(reloaded.value.vehicle, "tesla");
  assert.equal(reloaded.value.config.engine, "eight", "a saved custom engine overrides the vehicle default");
  reloaded.update({ vehicle: "porsche" });
  assert.deepEqual(reloaded.value.drives.moon, drive);
  assert.equal(reloaded.value.config.color, "blue");
  assert.equal(reloaded.value.config.wheels, "monster");
});

test("choices and per-map safe drive snapshots survive a new page without touching picnic progress", () => {
  const { win, entries } = browser();
  const session = createSession(win);
  const drive = { x: 420, z: -32, heading: 1.5, checkpoint: 3, lap: 2, lapSeconds: 20, bestLap: 110 };
  assert.equal(session.update({ level: "moon", config: { ...DEFAULTS, color: "blue", engine: "eight" }, camera: 2, voice: true, sound: false, selectedPart: "engine", drives: { moon: drive } }), true);
  const restored = createSession({ localStorage: win.localStorage });
  assert.deepEqual(restored.value, session.value);
  assert.equal(restored.value.config.engine, "eight");
  assert.deepEqual(restored.value.drives.moon, drive);
  assert.equal(entries.get("wildrun-friends-v1"), '{"index":2,"collected":1}');
  assert.equal(createSession(win), session, "loader and game share state, not stale copies");
  session.update({ camera: 1 });
  assert.equal(session.value.config.engine, "eight");
  const snapshot = session.value;
  snapshot.config.engine = "four";
  assert.equal(session.value.config.engine, "eight");
});

test("Amsterdam keeps an independent saved drive and restores its selection on reload", () => {
  const { win, entries } = browser();
  const session = createSession(win);
  const city = { x: -20, z: 50, heading: 1, checkpoint: 2, lap: 1, lapSeconds: 12, bestLap: 0 };
  const amsterdam = { x: 140, z: -90, heading: 2, checkpoint: 4, lap: 3, lapSeconds: 30, bestLap: 150 };
  session.update({ level: "city", drives: { city } });
  session.update({ level: "amsterdam", drives: { ...session.value.drives, amsterdam } });
  const restored = createSession({ localStorage: win.localStorage });
  assert.equal(restored.value.level, "amsterdam");
  assert.deepEqual(restored.value.drives, { city, amsterdam });
  restored.update({ level: "city", drives: { ...restored.value.drives, city: { ...city, x: 80 } } });
  restored.update({ level: "amsterdam" });
  const reloaded = createSession({ localStorage: win.localStorage });
  assert.equal(reloaded.value.level, "amsterdam");
  assert.deepEqual(reloaded.value.drives, { city: { ...city, x: 80 }, amsterdam });
  assert.deepEqual([...entries.keys()], ["wildrun-session-v1", "wildrun-friends-v1"]);
  assert.equal(entries.get("wildrun-friends-v1"), '{"index":2,"collected":1}');
});

test("untrusted driving coordinates and checkpoint counts are rejected", () => {
  const valid = { x: 12, z: 5, heading: 1, checkpoint: 2, lap: 1, lapSeconds: 0, bestLap: 0 };
  for (const patch of [{ x: 2001 }, { x: "2" }, { heading: NaN }, { checkpoint: 8 }, { checkpoint: -1 }, { lap: 0 }, { lap: 1.5 }]) {
    const session = createSession(browser().win);
    session.update({ drives: { forest: { ...valid, ...patch }, amsterdam: { ...valid, ...patch }, moon: valid } });
    assert.equal(session.value.drives.forest, undefined);
    assert.equal(session.value.drives.amsterdam, undefined);
    assert.deepEqual(session.value.drives.moon, valid);
  }
});

test("blocked or full storage remains playable and reports failed persistence", () => {
  const blocked = { get localStorage() { throw new Error("blocked"); } };
  const full = { localStorage: { getItem() { return null; }, setItem() { throw new Error("quota"); } } };
  for (const win of [blocked, full, {}]) {
    const session = createSession(win);
    assert.equal(session.update({ config: { ...DEFAULTS, engine: "electric" } }), false);
    assert.equal(session.persistent, false);
    assert.equal(session.value.config.engine, "electric");
    assert.equal(createSession(win).value.config.engine, "electric");
  }
});

test("course lengths survive saving so lap records cannot migrate between circuit layouts", () => {
  const { win } = browser();
  const session = createSession(win);
  const drive = { x: 0, z: 0, heading: 1, checkpoint: 2, lap: 1, courseLength: 5098 };
  session.update({ drives: { forest: drive } });
  assert.equal(createSession({ localStorage: win.localStorage }).value.drives.forest.courseLength, 5098);
  for (const courseLength of [-1, 0, Infinity, "5098"]) {
    session.update({ drives: { forest: { ...drive, courseLength } } });
    assert.equal(session.value.drives.forest.courseLength, undefined);
  }
});
