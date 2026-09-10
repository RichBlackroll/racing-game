import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as THREE from "three";
import { main } from "./game-source.js";

const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");

test("main remains bootstrap-driven and toolbar updates preserve icons and label nodes", () => {
  assert.equal(typeof main, "function");
  assert.match(source, /export async function main\(loading\)/);
  for (const hook of ["phase", "complete", "navigate", "fail"]) assert.ok(source.includes(`loading.${hook}`));
  assert.doesNotMatch(source, /(?:boostButton|pauseButton|document\.getElementById\("(?:camera|reset)"\))\.(?:textContent|innerHTML)\s*=/);
  assert.match(source, /boostButton\.querySelector\("\[data-label\]"\)/);
  assert.match(source, /pauseButton\.querySelector\("\[data-label\]"\)/);
});

test("driving steering consumes analog input but nonzero keyboard steering takes precedence", () => {
  // Exercise the production expression without constructing WebGL or loading the level.
  const expression = source.match(/\bturn =\s*([\s\S]*?),\s*offroad =/)[1];
  const turn = new Function("keys", "THREE", `return (${expression});`);
  for (const steering of [-1, -0.4, 0, 0.25, 1]) assert.equal(turn({ steering }, THREE), steering);
  for (const steering of [undefined, false, NaN, Infinity, "0.5"]) assert.equal(turn({ steering }, THREE), 0);
  assert.equal(turn({ steering: 3 }, THREE), 1);
  assert.equal(turn({ steering: -3 }, THREE), -1);
  for (const key of ["a", "arrowleft"]) assert.equal(turn({ [key]: true, steering: -0.5 }, THREE), 1);
  for (const key of ["d", "arrowright"]) assert.equal(turn({ [key]: true, steering: 0.5 }, THREE), -1);
  assert.equal(turn({ a: true, d: true, steering: 0.25 }, THREE), 0.25);
});

test("garage frame renders only the preview and keeps wheel spin tied to modified radius", () => {
  const branch = source.match(/if \(modifier\.active\) \{\s*garagePreview\.render\(dt\);\s*return;\s*\}/)?.[0];
  assert.ok(branch, "garage bypasses driving physics and the road camera");
  const render = new Function("modifier", "garagePreview", "dt", `${branch}; throw new Error('Driving frame ran');`);
  let elapsed;
  render({ active: true }, { render(dt) { elapsed = dt; } }, 0.025);
  assert.equal(elapsed, 0.025);
  assert.match(source, /car\.add\(carVisual\)/);
  assert.match(source, /createGaragePreview\(\{\s*renderer, car: carVisual/);
  assert.match(source, /createModifier\(\{\s*car: carVisual/);
  assert.match(source, /if \(modifier\.active\) garagePreview\.resize\(\);\s*else renderer\.setSize/);
  assert.match(source, /w\.tire\.rotation\.x \+= \(speed \* dt\) \/ w\.radius/);
  assert.match(source, /w\.hub\.rotation\.x \+= \(speed \* dt\) \/ w\.radius/);
});

test("production garage lifecycle parks boost, preserves driving pose/pause, and redraws on close", () => {
  const callback = source.slice(source.indexOf("    onOpenChange(open) {"), source.indexOf("  function reset()"));
  const method = callback.slice(0, callback.lastIndexOf("  });"));
  for (const paused of [false, true]) {
    const controls = { camera: {}, reset: {} };
    const context = {
      speed: 25, slipX: 3, slipZ: -2, steer: 0.5, heading: 2.1, paused,
      boosting: true, recovering: true, boostEnds: 9000, flame: { visible: true },
      boostButton: { disabled: true }, boostText: {}, boostLabel: "Boost",
      wheels: [{ pivot: { rotation: { y: 0.3 } } }],
      ui: { speed: {}, gear: {}, meter: { style: {} } },
      document: { getElementById: (id) => controls[id], body: { classList: { remove() {} } } },
      performance: { now: () => 5000 }, last: 0, qualityStart: 0, fpsStart: 0,
      qualityFrames: 10, fpsFrames: 10, clears: 0, resized: 0, rendered: 0,
    };
    context.clearKeys = () => context.clears++;
    context.resize = () => context.resized++;
    context.renderFrame = () => context.rendered++;
    const lifecycle = runInNewContext(`({${method}})`, context);
    lifecycle.onOpenChange(true);
    for (const key of ["speed", "slipX", "slipZ", "steer", "boostEnds"]) assert.equal(context[key], 0);
    assert.equal(context.flame.visible, false);
    assert.equal(context.boosting || context.recovering || context.boostButton.disabled, false);
    assert.equal(context.boostText.textContent, "Boost");
    assert.equal(controls.camera.disabled && controls.reset.disabled, true);
    assert.equal(context.paused, paused);
    assert.equal(context.heading, 2.1);
    lifecycle.onOpenChange(false);
    assert.equal(context.clears, 2);
    assert.equal(context.resized, 1, "current viewport replaces the pre-garage dimensions");
    assert.equal(context.rendered, 1, "paused game must not retain the last garage image");
    assert.equal(controls.camera.disabled || controls.reset.disabled, false);
    assert.equal(context.last, 5000);
    assert.equal(context.qualityStart, 5000);
    assert.equal(context.fpsStart, 5000);
    assert.equal(context.qualityFrames + context.fpsFrames, 0);
    assert.equal(context.paused, paused);
    assert.equal(context.heading, 2.1);
  }
});
