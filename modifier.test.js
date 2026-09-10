import { test } from "node:test";
import assert from "node:assert";
import { TUNE_FIELDS, PARTS, DEFAULTS, computeTuning } from "./modifier-data.js";

test("DEFAULTS covers every part and every default option id exists", () => {
  for (const part of PARTS) {
    const chosen = DEFAULTS[part.id];
    assert.ok(chosen, `DEFAULTS is missing part "${part.id}"`);
    assert.ok(
      part.options.some((option) => option.id === chosen),
      `default option "${chosen}" does not exist for part "${part.id}"`,
    );
  }
});

test("every part has at least 3 options with id, name, emoji and a non-empty fact", () => {
  for (const part of PARTS) {
    assert.ok(part.options.length >= 3, `part "${part.id}" has fewer than 3 options`);
    for (const option of part.options) {
      assert.ok(option.id, `an option in part "${part.id}" is missing an id`);
      assert.ok(option.name, `option "${option.id}" is missing a name`);
      assert.ok(option.emoji, `option "${option.id}" is missing an emoji`);
      assert.ok(typeof option.fact === "string" && option.fact.length > 0, `option "${option.id}" is missing a fact`);
    }
  }
});

test("all effects keys are valid tuning fields", () => {
  for (const part of PARTS) {
    for (const option of part.options) {
      for (const key of Object.keys(option.effects ?? {})) {
        assert.ok(TUNE_FIELDS.includes(key), `unknown tune field "${key}" in ${part.id}/${option.id}`);
      }
    }
  }
});

test("computeTuning(DEFAULTS) returns all ones", () => {
  const tuning = computeTuning(DEFAULTS);
  assert.deepEqual(Object.keys(tuning).sort(), [...TUNE_FIELDS].sort());
  for (const field of TUNE_FIELDS) {
    assert.equal(tuning[field], 1, `${field} should be 1`);
  }
});

test("option effects move the tuning numbers the right way", () => {
  const stock = computeTuning(DEFAULTS);

  const v8 = computeTuning({ ...DEFAULTS, engine: "eight" });
  assert.ok(v8.top > stock.top, "V8 top speed beats the stock engine");

  const electric = computeTuning({ ...DEFAULTS, engine: "electric" });
  assert.ok(electric.accel > v8.accel, "electric accelerates harder than a V8");

  const bigRocket = computeTuning({ ...DEFAULTS, rocket: "big" });
  assert.ok(bigRocket.boostTime > 1, "big rocket boosts for longer");
  assert.ok(bigRocket.boostTop > 1, "big rocket boosts faster");

  const monster = computeTuning({ ...DEFAULTS, wheels: "monster" });
  assert.ok(monster.offroadTop > 1, "monster wheels go faster off-road");

  const wide = computeTuning({ ...DEFAULTS, wheels: "wide" });
  assert.ok(wide.steer > 1, "wide wheels steer better");

  const bigWing = computeTuning({ ...DEFAULTS, spoiler: "big" });
  const megaWing = computeTuning({ ...DEFAULTS, spoiler: "mega" });
  assert.ok(megaWing.steer > bigWing.steer, "mega wing steers better than big wing");

  const sport = computeTuning({ ...DEFAULTS, suspension: "sport" });
  assert.ok(sport.bounce < 1, "sport suspension bounces less");
});
