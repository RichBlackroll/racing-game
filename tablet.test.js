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

function steeringFixture() {
  const win = new EventTarget(), doc = new EventTarget(), pad = new Button();
  const attributes = {}, style = {};
  pad.style = { setProperty: (name, value) => { style[name] = value; } };
  pad.setAttribute = (name, value) => { attributes[name] = value; };
  pad.getBoundingClientRect = () => ({ left: 0, width: 200 });
  pad.hasPointerCapture = () => true;
  pad.releasePointerCapture = () => {};
  doc.getElementById = () => pad;
  const go = new Button("w"), keys = {};
  const clear = bindDrivingInput(keys, [go], win, doc);
  return { win, doc, pad, attributes, style, go, keys, clear };
}

test("touch steering is proportional, clamped, and independent of the throttle", () => {
  const { pad, attributes, style, go, keys } = steeringFixture();
  fire(pad, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 72 });
  assert.ok(Math.abs(keys.steering - 0.5) < 1e-12);
  assert.equal(attributes["aria-valuenow"], "-50");
  assert.equal(attributes["aria-valuetext"], "50% left");
  assert.ok(Math.abs(parseFloat(style["--steer-x"]) + 28) < 1e-12);
  fire(go, "pointerdown", { pointerId: 2, pointerType: "touch" });
  assert.equal(keys.w, true);
  assert.ok(Math.abs(keys.steering - 0.5) < 1e-12);
  fire(pad, "pointermove", { pointerId: 99, clientX: 300 });
  assert.ok(Math.abs(keys.steering - 0.5) < 1e-12);
  fire(pad, "pointermove", { pointerId: 1, clientX: 300 });
  assert.equal(keys.steering, -1);
  fire(pad, "pointerup", { pointerId: 1 });
  assert.equal(Math.abs(keys.steering), 0);
  assert.equal(keys.w, true);
});

test("interruption recenters touch steering and clears held pedals", () => {
  for (const interrupt of ["pointercancel", "lostpointercapture", "blur", "resize", "visibilitychange", "clear"]) {
    const { pad, win, doc, go, keys, clear } = steeringFixture();
    fire(pad, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 20 });
    fire(go, "pointerdown", { pointerId: 2, pointerType: "touch" });
    if (interrupt === "clear") clear();
    else if (interrupt === "visibilitychange") fire(doc, interrupt);
    else if (["blur", "resize"].includes(interrupt)) fire(win, interrupt);
    else fire(pad, interrupt, { pointerId: 1 });
    assert.equal(Math.abs(keys.steering), 0, interrupt);
    assert.equal(pad.pressed, false, interrupt);
    if (!["pointercancel", "lostpointercapture"].includes(interrupt)) assert.equal(keys.w, false, interrupt);
  }
});

test("steering slider supports keyboard adjustment and recenters on blur", () => {
  const { pad, keys, attributes } = steeringFixture();
  fire(pad, "keydown", { key: "ArrowLeft" });
  assert.equal(keys.steering, 0.1);
  assert.equal(attributes["aria-valuetext"], "10% left");
  fire(pad, "keydown", { key: "Home" });
  assert.equal(keys.steering, 1);
  fire(pad, "keydown", { key: "End" });
  assert.equal(keys.steering, -1);
  fire(pad, "keydown", { key: "Escape" });
  assert.equal(Math.abs(keys.steering), 0);
  fire(pad, "keydown", { key: "ArrowRight" });
  fire(pad, "blur");
  assert.equal(Math.abs(keys.steering), 0);
});
