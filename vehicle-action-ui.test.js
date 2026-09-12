import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createVehicleActionUI } from "./vehicle-action-ui.js";

function fixture() {
  const elements = Object.fromEntries(["vehicle-action-slot", "vehicle-action", "vehicle-action-icon", "vehicle-action-label",
    "vehicle-action-state", "vehicle-action-hint", "vehicle-action-status"].map(id => {
    const node = Object.assign(new EventTarget(), { dataset: {}, attributes: {}, writes: 0,
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return this.attributes[key] ?? null; },
      focus() { assert.fail("Action must not move focus away from driving controls"); },
    });
    Object.defineProperty(node, "textContent", { get() { return this.text ?? ""; }, set(value) { this.text = value; this.writes++; } });
    return [id, node];
  }));
  const win = new EventTarget(), live = { enabled: true, uses: 0 };
  const state = { id: "dig", label: "Dig", description: "Lower the bucket and dig a hole.", active: false, remaining: 0, cooldown: 0 };
  const ui = createVehicleActionUI({ doc: { getElementById: id => elements[id] }, win,
    enabled: () => live.enabled, activate: () => { live.uses++; } });
  const emit = (target, type, fields = {}) => {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  };
  return { elements, win, live, state, ui, emit };
}

test("config supplies the practical label and description, with seven distinct inline icons", () => {
  const { elements: e, state, ui } = fixture(), icons = new Set();
  for (const [id, label] of Object.entries({ dig: "Dig", delivery: "Deliver", sprint: "Sprint", pulse: "Pulse", hop: "Hop", bubbles: "Bubbles", beacon: "Beacon" })) {
    ui.update({ ...state, id, label });
    assert.equal(e["vehicle-action-slot"].hidden, false);
    assert.equal(e["vehicle-action"].disabled, false);
    assert.equal(e["vehicle-action-label"].textContent, label);
    assert.equal(e["vehicle-action-state"].textContent, "Ready");
    assert.equal(e["vehicle-action-hint"].textContent, state.description);
    assert.equal(e["vehicle-action"].attributes["aria-label"], `${label}. Ready. Special action: press E or tap.`);
    assert.match(e["vehicle-action-icon"].innerHTML, /currentColor/);
    assert.doesNotMatch(e["vehicle-action-icon"].innerHTML, /<image|<use|https?:/);
    icons.add(e["vehicle-action-icon"].innerHTML);
  }
  assert.equal(icons.size, 7);
  ui.update({ ...state, label: "Scoop", description: "A different configuration." });
  assert.equal(e["vehicle-action-label"].textContent, "Scoop");
  assert.equal(e["vehicle-action-hint"].textContent, "A different configuration.");
  assert.match(e["vehicle-action"].title, /A different configuration.*Scoop: E/);
  ui.update({ ...state, id: "toString", label: "Signal" });
  assert.match(e["vehicle-action-icon"].innerHTML, /<path/);
});

test("pointerdown preserves driving focus, ignores compatibility clicks and supports assistive clicks", () => {
  const { elements: e, state, ui, live, emit } = fixture();
  ui.update(state);
  assert.equal(emit(e["vehicle-action"], "pointerdown", { button: 0, isPrimary: false }).defaultPrevented, true);
  assert.equal(live.uses, 1, "a second thumb can act while a pedal stays held");
  emit(e["vehicle-action"], "click", { detail: 1 });
  emit(e["vehicle-action"], "pointerdown", { button: 1 });
  emit(e["vehicle-action"], "pointerdown", { button: 2 });
  assert.equal(live.uses, 1);
  emit(e["vehicle-action"], "click", { detail: 0 });
  assert.equal(live.uses, 2);
  assert.equal(emit(e["vehicle-action"], "contextmenu").defaultPrevented, true);
});

test("E supports uppercase, ignores repeats, browser shortcuts, editables and sliders", () => {
  const { state, ui, live, emit, win } = fixture();
  ui.update(state);
  for (const fields of [{ key: "f" }, { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
    { target: { isContentEditable: true } },
    ...["input", "select", "textarea", "[role=slider]", '[contenteditable]:not([contenteditable="false"])']
      .map(selector => ({ target: { closest: selectors => selectors.includes(selector) } }))]) {
    assert.equal(emit(win, "keydown", { key: "e", ...fields }).defaultPrevented, false);
  }
  assert.equal(live.uses, 0);
  assert.equal(emit(win, "keydown", { key: "E" }).defaultPrevented, true);
  assert.equal(live.uses, 1);
  emit(win, "keydown", { key: "e" });
  assert.equal(live.uses, 2);
});

test("every input path uses the live overlay guard rather than last frame's disabled attribute", () => {
  const { elements: e, state, ui, live, emit, win } = fixture();
  ui.update(state);
  live.enabled = false;
  assert.equal(e["vehicle-action"].disabled, false, "last painted state is intentionally stale");
  emit(e["vehicle-action"], "pointerdown", { button: 0 });
  emit(e["vehicle-action"], "click", { detail: 0 });
  assert.equal(emit(win, "keydown", { key: "e" }).defaultPrevented, false);
  assert.equal(live.uses, 0);
  ui.update(state);
  assert.equal(e["vehicle-action"].disabled, true);
  live.enabled = true;
  emit(win, "keydown", { key: "e" });
  assert.equal(live.uses, 1, "works immediately after closing an overlay, before a paint");
  ui.update(state);
  assert.equal(e["vehicle-action"].disabled, false);
});

test("active, cooldown and blocked snapshots disable every activation path with readable state", () => {
  const { elements: e, state, ui, live, emit, win } = fixture();
  for (const [patch, text, mode] of [
    [{ active: true, remaining: 2.1, cooldown: 8 }, "Working 3s", "working"],
    [{ active: true, remaining: 0, blocked: "Stop to dig" }, "Working", "working"],
    [{ cooldown: 2.01 }, "3s", "cooldown"],
    [{ cooldown: 0.01 }, "1s", "cooldown"],
    [{ blocked: "Stop to dig" }, "Stop to dig", "blocked"],
    [{ blocked: "Stop to dig", cooldown: 2 }, "Stop to dig", "blocked"],
  ]) {
    ui.update({ ...state, ...patch });
    assert.equal(e["vehicle-action"].disabled, true);
    assert.equal(e["vehicle-action-state"].textContent, text);
    assert.equal(e["vehicle-action-slot"].dataset.state, mode);
    assert.ok(e["vehicle-action"].attributes["aria-label"].includes(text));
    emit(win, "keydown", { key: "e" });
    emit(e["vehicle-action"], "pointerdown", { button: 0 });
    emit(e["vehicle-action"], "click", { detail: 0 });
  }
  assert.equal(live.uses, 0);
  ui.update({ ...state, cooldown: 0, blocked: "" });
  assert.equal(e["vehicle-action"].disabled, false);
  assert.equal(e["vehicle-action-state"].textContent, "Ready");
});

test("announcements change only on meaningful transitions, never each frame or timer tick", () => {
  const { elements: e, state, ui, live } = fixture(), status = e["vehicle-action-status"];
  ui.update(state);
  for (let frame = 0; frame < 60; frame++) ui.update(state);
  assert.equal(status.writes, 1);
  assert.equal(e["vehicle-action-state"].writes, 1);
  for (const remaining of [3.2, 3.1, 2.2, 1.2, 0.1]) ui.update({ ...state, active: true, remaining });
  assert.equal(status.textContent, "Dig. Working.");
  assert.equal(status.writes, 2);
  for (const cooldown of [5.2, 5.1, 4, 3, 2, 1]) ui.update({ ...state, cooldown });
  assert.equal(status.textContent, "Dig. Cooling down.");
  assert.equal(status.writes, 3);
  ui.update({ ...state, blocked: "Stop to dig" });
  ui.update({ ...state, blocked: "Stop to dig" });
  assert.equal(status.textContent, "Dig. Stop to dig.");
  assert.equal(status.writes, 4);
  live.enabled = false;
  ui.update(state);
  assert.equal(status.writes, 4, "overlays do not produce hidden announcements");
  live.enabled = true;
  ui.update(state);
  assert.equal(status.textContent, "Dig. Ready. Press E or tap.");
  assert.equal(status.writes, 5);
});

test("nothing activates before the first snapshot or when no action is selected", () => {
  const { elements: e, state, ui, live, emit, win } = fixture();
  emit(win, "keydown", { key: "e" });
  emit(e["vehicle-action"], "pointerdown", { button: 0 });
  emit(e["vehicle-action"], "click", { detail: 0 });
  assert.equal(live.uses, 0);
  ui.update({ ...state, id: null });
  assert.equal(e["vehicle-action-slot"].hidden, true);
  assert.equal(e["vehicle-action"].disabled, true);
  emit(win, "keydown", { key: "e" });
  assert.equal(live.uses, 0);
});

test("HTML exposes the action, shortcut, description and polite atomic status within the shared pocket", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /items\.css[\s\S]*href="vehicle-actions\.css"/);
  assert.match(html, /id="drive-actions"[\s\S]*id="item-slot"[\s\S]*id="vehicle-action-slot"/);
  assert.match(html, /id="vehicle-action-slot"[^>]*hidden/);
  assert.match(html, /<button type="button" id="vehicle-action" disabled[^>]*aria-describedby="vehicle-action-hint" aria-keyshortcuts="E"/);
  assert.match(html, /id="vehicle-action-icon"[^>]*aria-hidden="true" focusable="false"/);
  assert.match(html, /id="vehicle-action-status"[^>]*role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /<kbd>E<\/kbd> Special action/);
});

test("gallery pictures explicitly distinguish the backhoe arm and DHL cargo van without registry coupling", async () => {
  const source = await readFile(new URL("./modifier-ui.js", import.meta.url), "utf8");
  const picture = runInNewContext(`${source.slice(source.indexOf("function picture("), source.indexOf("export function createModifier("))}; picture`, {
    el: () => ({ attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }),
  });
  const silhouettes = ["backhoe", "dhl-van", "porsche", "tesla", "golf", "byd-atto-1", "volvo-ex40"].map(id => {
    const node = picture("vehicle", id);
    assert.equal(node.attributes["aria-hidden"], "true");
    assert.match(node.innerHTML, /<svg viewBox="0 0 80 56"/);
    return node.innerHTML;
  });
  assert.equal(new Set(silhouettes).size, 7);
  assert.match(source, /option === "backhoe"/);
  assert.match(source, /option === "dhl-van"/);
  assert.match(silhouettes[0], /stroke-width="6"/);
  assert.match(silhouettes[1], /#f4cf48/);
  assert.match(silhouettes[1], /#c93d39/);
});
