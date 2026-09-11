import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createItemUI } from "./item-ui.js";
import { ITEMS } from "./item-system.js";

function fixture() {
  const elements = Object.fromEntries(["item-slot", "use-item", "item-icon", "item-name", "item-action", "item-hint", "item-status", "item-state"]
    .map(id => [id, Object.assign(new EventTarget(), { dataset: {}, style: { setProperty() {} }, attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; } })]));
  const win = new EventTarget();
  const state = { enabled: true, uses: 0, held: null };
  const modifiers = { speedFactor: 1, wobble: 0, shield: 0, turbo: 0 };
  const ui = createItemUI({ doc: { getElementById: id => elements[id] }, win,
    enabled: () => state.enabled, deploy() { state.uses++; state.held = null; ui.update(state, modifiers); } });
  const emit = (target, type, fields = {}) => {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  };
  ui.update(state, modifiers);
  return { elements, win, state, modifiers, ui, emit };
}

test("one slot explains collecting and shows a distinct icon/action for each of ten toys", () => {
  const { elements: e, state, modifiers, ui } = fixture();
  assert.equal(e["use-item"].disabled, true);
  assert.equal(e["item-state"].textContent, "Empty");
  assert.equal(e["item-name"].textContent, "No item");
  assert.match(e["item-icon"].innerHTML, /stroke-dasharray/);
  assert.match(e["item-hint"].textContent, /off-road/);
  const icons = new Set();
  for (const item of ITEMS) {
    state.held = item.id; ui.update(state, modifiers);
    assert.equal(e["use-item"].disabled, false);
    assert.equal(e["item-state"].textContent, "Ready");
    assert.equal(e["item-slot"].dataset.ready, "true");
    assert.equal(e["item-name"].textContent, item.name);
    assert.equal(e["item-action"].textContent, item.action);
    assert.equal(e["item-hint"].textContent, item.description);
    assert.ok(e["use-item"].attributes["aria-label"].includes(item.name));
    assert.match(e["item-icon"].innerHTML, /fill="currentColor"/);
    icons.add(e["item-icon"].innerHTML);
  }
  assert.equal(icons.size, 10);
});

test("touch-down uses once, preserves other controls, and ignores the compatibility click", () => {
  const { elements: e, state, modifiers, ui, emit } = fixture();
  state.held = "banana"; ui.update(state, modifiers);
  assert.equal(emit(e["use-item"], "pointerdown", { button: 0 }).defaultPrevented, true);
  assert.equal(state.uses, 1);
  assert.equal(e["use-item"].disabled, true);
  assert.equal(e["item-state"].textContent, "Empty");
  assert.equal(e["item-name"].textContent, "No item");
  assert.equal(e["item-slot"].dataset.ready, "false");
  assert.match(e["item-status"].textContent, /slot empty/);
  state.held = "rocket"; ui.update(state, modifiers);
  emit(e["use-item"], "click", { detail: 1 });
  emit(e["use-item"], "pointerdown", { button: 2 });
  assert.equal(state.uses, 1);
  emit(e["use-item"], "click", { detail: 0 });
  assert.equal(state.uses, 2, "keyboard and assistive activation remain supported");
});

test("F deploys once and ignores repeats, text fields, sliders, and browser shortcuts", () => {
  const { win, state, modifiers, ui, emit } = fixture();
  state.held = "star"; ui.update(state, modifiers);
  for (const fields of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { target: { closest: () => true } }]) {
    emit(win, "keydown", { key: "f", ...fields });
  }
  assert.equal(state.uses, 0);
  emit(win, "keydown", { key: "F" });
  emit(win, "keydown", { key: "f" });
  assert.equal(state.uses, 1);
});

test("all input paths respect pause/overlays even before the next UI refresh", () => {
  const { elements: e, win, state, modifiers, ui, emit } = fixture();
  state.held = "lightning"; ui.update(state, modifiers);
  state.enabled = false;
  emit(win, "keydown", { key: "f" });
  emit(e["use-item"], "pointerdown", { button: 0 });
  emit(e["use-item"], "click", { detail: 0 });
  assert.equal(state.uses, 0);
  ui.update(state, modifiers);
  assert.equal(e["use-item"].disabled, true);
  state.enabled = true; ui.update(state, modifiers);
  assert.equal(e["use-item"].disabled, false);
});

test("F works immediately after an overlay closes, before the next paint", () => {
  const { win, state, modifiers, ui, emit } = fixture();
  state.held = "star"; state.enabled = false; ui.update(state, modifiers);
  state.enabled = true;
  emit(win, "keydown", { key: "f" });
  assert.equal(state.uses, 1);
});

test("protective item countdowns are readable and clear when their timers expire", () => {
  const { elements: e, state, modifiers, ui } = fixture();
  ui.update(state, { ...modifiers, shield: 5.2 });
  assert.match(e["item-status"].textContent, /Bubble protection: 6s/);
  assert.equal(e["item-slot"].dataset.effect, "true");
  assert.equal(e["item-state"].textContent, "Empty", "active protection is not another held item");
  state.held = "banana";
  ui.update(state, { ...modifiers, turbo: 3.1 });
  assert.match(e["item-status"].textContent, /Turbo \+ protection: 4s/);
  assert.equal(e["item-state"].textContent, "Ready");
  assert.equal(e["item-name"].textContent, "Banana Peel");
  ui.update(state, modifiers);
  assert.match(e["item-status"].textContent, /Banana Peel ready/);
  assert.equal(e["item-slot"].dataset.effect, "false");
  state.held = null; ui.update(state, modifiers);
  assert.match(e["item-status"].textContent, /slot empty/);
});

test("production lifecycle never advances items in a pause, loading screen, garage, or hidden tab", async () => {
  const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
  const frame = source.slice(source.indexOf("  function frame(now)"), source.indexOf("    daylight.advance(dt);")) + "\n}";
  for (const mode of ["paused", "loading", "hidden", "contextLost", "garage"]) {
    const context = { requestAnimationFrame() {}, itemUI: { update() {} }, itemSnapshot: {},
      itemSystem: { modifiers: () => ({}), update() { assert.fail("Paused items advanced"); } },
      loading: { active: mode === "loading" }, paused: mode === "paused", modifier: { active: mode === "garage" },
      document: { hidden: mode === "hidden" }, contextLost: mode === "contextLost",
      audio: { silence() {} }, sceneDirty: false, last: 0, device: { tablet: false }, garagePreview: { render() {} } };
    runInNewContext(`${frame}; frame(1000);`, context);
    assert.equal(context.last, 1000);
  }
  assert.ok(source.indexOf("    itemSystem.update(dt, targets)") > source.indexOf("    const motion = friendRacers.update"));
  const reset = source.slice(source.indexOf("  function reset("), source.indexOf("  function saveDrive("));
  assert.ok(reset.indexOf("resetItems()") > reset.indexOf("friendRacers.reset(car.position)"));
});
