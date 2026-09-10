import test from "node:test";
import assert from "node:assert/strict";
import {
  tabletProfile,
  pixelBudget,
  adaptiveScale,
  bindDrivingInput,
} from "./tablet.js";

test("iPad desktop browser identity and connected trackpad retain tablet mode", () => {
  assert.deepEqual(tabletProfile({ platform: "MacIntel", maxTouchPoints: 5 }), {
    ipad: true,
    touch: true,
    tablet: true,
  });
  assert.equal(
    tabletProfile({ userAgent: "Mozilla/5.0 (iPad)", maxTouchPoints: 5 })
      .tablet,
    true,
  );
  assert.equal(
    tabletProfile({ platform: "MacIntel", maxTouchPoints: 0 }).tablet,
    false,
  );
});
test("render budget caps Retina and external-display pixel load", () => {
  for (const [width, height] of [
    [1180, 820],
    [820, 1180],
    [1366, 1024],
    [2732, 2048],
  ]) {
    const ratio = pixelBudget(width, height, 2);
    assert.ok(width * height * ratio * ratio <= 1200001);
    assert.ok(ratio <= 1);
  }
  assert.equal(adaptiveScale(0.65, 20), 0.65);
  assert.equal(adaptiveScale(1, 60), 1);
  assert.equal(adaptiveScale(1, 30), 0.9);
  assert.equal(adaptiveScale(0.8, 50), 0.8);
});
class Button extends EventTarget {
  constructor(key) {
    super();
    this.dataset = { key };
    this.pressed = false;
    this.classList = {
      toggle: (_, value) => {
        this.pressed = value;
      },
    };
  }
  setPointerCapture() {}
}
function fire(target, type, data = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, data);
  target.dispatchEvent(event);
}
test("simultaneous steering and throttle release independently; interruption clears everything", () => {
  const keys = {},
    win = new EventTarget(),
    doc = new EventTarget(),
    left = new Button("a"),
    go = new Button("w");
  bindDrivingInput(keys, [left, go], win, doc);
  fire(left, "pointerdown", { pointerId: 1, pointerType: "touch" });
  fire(go, "pointerdown", { pointerId: 2, pointerType: "touch" });
  assert.ok(keys.a && keys.w && left.pressed && go.pressed);
  fire(left, "pointercancel", { pointerId: 1 });
  assert.ok(!keys.a && keys.w);
  fire(go, "pointerdown", { pointerId: 3, pointerType: "touch" });
  fire(go, "pointerup", { pointerId: 2 });
  assert.ok(keys.w);
  fire(win, "keydown", { key: "w" });
  fire(go, "lostpointercapture", { pointerId: 3 });
  assert.ok(keys.w);
  fire(win, "keyup", { key: "w" });
  assert.equal(keys.w, false);
  fire(go, "pointerdown", { pointerId: 4, pointerType: "touch" });
  fire(doc, "visibilitychange");
  assert.equal(keys.w, false);
  assert.equal(go.pressed, false);
});
