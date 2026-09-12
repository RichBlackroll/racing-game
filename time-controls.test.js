import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTimeControls, validateTimeSettings } from "./time-controls.js";
import { sampleDaylight } from "./daylight.js";
import { bindDrivingInput } from "./tablet.js";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const markup = html.slice(html.indexOf('<div id="time-controls">'), html.indexOf("</nav>"));
const css = readFileSync(new URL("./time-controls.css", import.meta.url), "utf8");
const key = "wildrun-time-controls-v1";
const defaults = { version: 1, hour: 16.5, running: true, cycleMinutes: 12 };

// Only the DOM surface used by this component; events bubble through real markup ancestry.
class Element {
  constructor(tagName, parent = null) {
    this.tagName = tagName;
    this.parent = parent;
    this.ownerDocument = parent?.ownerDocument;
    this.children = [];
    parent?.children.push(this);
    this.attributes = {};
    this.dataset = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.top = 90;
    this.style = { setProperty: (name, value) => { this.style[name] = value; } };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, fields = {}, bubbles = true) {
    const event = Object.assign(new Event(type, { bubbles, cancelable: true }), fields);
    Object.defineProperty(event, "target", { value: this });
    for (let node = this; node; node = node.parent) {
      for (const listener of node.listeners.get(type) ?? []) listener(event);
      if (!bubbles || event.cancelBubble) break;
    }
    return event;
  }
  contains(target) {
    for (let node = target; node; node = node.parent) if (node === this) return true;
    return false;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(selector === "[data-time-hour]" ? child.dataset.timeHour !== undefined
        : child.getAttribute("id") === selector.slice(1)) ? [child] : [],
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() { return { top: this.top }; }
  focus() {
    const previous = this.ownerDocument.activeElement;
    this.ownerDocument.activeElement = this;
    if (previous && previous !== this) {
      previous.emit("blur", {}, false);
      previous.emit("focusout", { relatedTarget: this });
    }
  }
}

function fixture({ saved, storage = "ok", reducedMotion = false, initial = {} } = {}) {
  const win = new Element("window"), doc = new Element("document", win);
  doc.ownerDocument = doc;
  doc.defaultView = win;
  doc.activeElement = null;
  doc.getElementById = (id) => doc.querySelector(`#${id}`);
  win.visualViewport = new Element("viewport");
  win.matchMedia = () => ({ matches: reducedMotion });
  const stack = [doc];
  for (const match of markup.matchAll(/<(\/?)(([a-z][\w-]*))\b([^>]*)>|([^<]+)/g)) {
    if (match[5]) { stack.at(-1).textContent += match[5].trim(); continue; }
    if (match[1]) { stack.pop(); continue; }
    const element = new Element(match[2], stack.at(-1));
    for (const [, name, value = ""] of match[4].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
      element.setAttribute(name, value);
      if (name === "hidden" || name === "disabled") element[name] = true;
      if (name === "value") element.value = value;
      if (name === "data-time-hour") element.dataset.timeHour = value;
    }
    if (match[2] !== "input" && !match[4].endsWith("/")) stack.push(element);
  }
  const get = (id) => doc.getElementById(id);
  get("time-cycle-speed").value = "12";
  const values = new Map([["wildrun-session-v1", "unrelated save"]]);
  if (saved !== undefined) values.set(key, typeof saved === "string" ? saved : JSON.stringify(saved));
  const writes = [], calls = [], changes = [];
  const localStorage = {
    getItem(name) { if (storage === "read-error") throw Error("Blocked"); return values.get(name) ?? null; },
    setItem(name, value) {
      if (storage === "quota") throw Error("Full");
      writes.push([name, value]);
      values.set(name, value);
    },
  };
  Object.defineProperty(win, "localStorage", { get() {
    if (storage === "blocked") throw Error("Blocked");
    return localStorage;
  } });
  const state = { hour: 16.5, running: !reducedMotion, cycleMinutes: 12,
    daylight: 1, night: 0, period: "golden-hour", ...initial };
  const daylight = {
    state: () => ({ ...state }),
    setHour(value) { calls.push(["hour", value]); state.hour = value; },
    setRunning(value) { calls.push(["running", value]); state.running = value; },
    setCycleMinutes(value) { calls.push(["cycleMinutes", value]); state.cycleMinutes = value; },
  };
  const create = () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
    try { return createTimeControls({ daylight, onChange: () => changes.push({ ...state }) }); }
    finally {
      if (previous) Object.defineProperty(globalThis, "document", previous);
      else delete globalThis.document;
    }
  };
  const controls = create();
  const click = (element) => {
    const target = typeof element === "string" ? get(element) : element;
    target.emit("pointerdown");
    target.focus();
    target.emit("pointerup");
    target.emit("click");
  };
  const presets = get("time-controls").querySelectorAll("[data-time-hour]");
  return { controls, create, get, click, presets, state, daylight, calls, changes, values, writes, win, doc };
}

test("settings validation accepts only the complete versioned finite schema", () => {
  assert.deepEqual(validateTimeSettings({ ...defaults, unrelated: "ignored" }), defaults);
  for (const cycleMinutes of [3, 12, 30]) for (const hour of [0, 16.5, 23 + 59 / 60]) {
    const value = { version: 1, hour, running: false, cycleMinutes };
    assert.deepEqual(validateTimeSettings(value), value);
  }
  const invalid = [null, undefined, [], true, 42, "{}", {}, { ...defaults, version: 2 }];
  for (const [field, values] of Object.entries({
    version: [undefined, "1", 0], hour: [undefined, "16.5", null, NaN, Infinity, -Infinity, -0.1, 24],
    running: [undefined, "false", 0, null], cycleMinutes: [undefined, "12", null, 0, -3, 13, 12.5, Infinity],
  })) for (const value of values) invalid.push({ ...defaults, [field]: value });
  for (const value of invalid) assert.equal(validateTimeSettings(value), null);
});

test("initialization preserves controller defaults including reduced motion and custom state", () => {
  for (const reducedMotion of [false, true]) {
    const f = fixture({ reducedMotion });
    assert.equal(f.get("time-toggle").disabled, false);
    assert.equal(f.get("time-toggle").getAttribute("aria-expanded"), "false");
    assert.equal(f.get("time-panel").hidden, true);
    assert.equal(f.get("time-clock").textContent, "16:30");
    f.click("time-toggle");
    assert.equal(f.get("time-running").getAttribute("aria-pressed"), String(!reducedMotion));
    assert.equal(f.get("time-running-state").textContent, reducedMotion ? "Frozen" : "Running");
    assert.deepEqual(f.calls, []);
    assert.equal(f.writes.length + f.changes.length, 0);
    f.controls.dispose();
  }
  const f = fixture({ initial: { hour: 8.25, cycleMinutes: 30, running: false } });
  f.click("time-toggle");
  assert.equal(f.get("time-clock").textContent, "08:15");
  assert.equal(f.get("time-cycle-speed").value, "30");
  assert.deepEqual(f.calls, []);
});

test("opening focuses the labeled range and paints the current period and night blend", () => {
  const f = fixture();
  f.state.hour = 23;
  f.state.period = "night";
  f.state.night = 0.84;
  f.click("time-toggle");
  assert.equal(f.doc.activeElement, f.get("time-range"));
  assert.equal(f.get("time-panel").hidden, false);
  assert.equal(f.get("time-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(f.get("time-range").value, "1380");
  assert.equal(f.get("time-range").getAttribute("aria-valuetext"), "23:00 game time");
  assert.equal(f.get("time-period").textContent, "Night");
  assert.equal(f.get("time-lights").textContent, "Night lighting: 84%");
  assert.equal(f.get("time-panel").style["--time-panel-top"], "90px");
  assert.equal(f.presets[3].dataset.selected, "true");
});

test("render updates paint minute boundaries and midnight without callbacks or persistence", () => {
  const f = fixture();
  f.click("time-toggle");
  for (const [hour, expected] of [[0, "00:00"], [0.9999, "00:59"], [12, "12:00"], [23.9999, "23:59"], [0, "00:00"]]) {
    f.state.hour = hour;
    f.controls.update();
    assert.equal(f.get("time-clock").textContent, expected);
    assert.equal(f.get("time-range").getAttribute("aria-valuetext"), `${expected} game time`);
  }
  // Identical frames do not even rewrite visible text or accessibility attributes.
  for (const id of ["time-clock", "time-reading", "time-period", "time-running-state", "time-lights"]) {
    const element = f.get(id), value = element.textContent;
    Object.defineProperty(element, "textContent", { get: () => value, set() { assert.fail(`Rewrote ${id}`); } });
  }
  for (const id of ["time-range", "time-running"]) f.get(id).setAttribute = () => assert.fail(`Rewrote ${id} ARIA`);
  for (let i = 0; i < 120; i++) f.controls.update();
  assert.deepEqual(f.calls, []);
  assert.equal(f.writes.length + f.changes.length, 0);
});

test("range input previews immediately, saves on commit, and never freezes the cycle", () => {
  const f = fixture();
  f.click("time-toggle");
  const range = f.get("time-range");
  for (const minute of [0, 345, 1439]) {
    range.value = String(minute);
    range.emit("input");
    assert.equal(f.state.hour, minute / 60);
    assert.equal(f.changes.at(-1).hour, minute / 60);
    assert.equal(f.state.running, true);
  }
  assert.equal(f.writes.length, 0);
  range.emit("change");
  assert.equal(f.writes.length, 1);
  assert.deepEqual(JSON.parse(f.values.get(key)), { ...defaults, hour: 1439 / 60 });
  assert.equal(f.changes.length, 3);
});

test("an automatic tick never moves a thumb during scrubbing; release and cancellation resync", () => {
  const f = fixture();
  f.click("time-toggle");
  const range = f.get("time-range");
  for (const end of ["pointerup", "pointercancel", "blur"]) {
    range.emit("pointerdown");
    range.value = "360";
    range.emit("input");
    f.state.hour = 6.25;
    f.controls.update();
    assert.equal(range.value, "360");
    assert.equal(range.getAttribute("aria-valuetext"), "06:00 game time");
    assert.equal(f.get("time-clock").textContent, "06:15");
    range.emit(end, {}, end !== "blur");
    f.controls.update();
    assert.equal(range.value, "375");
  }
});

test("every preset, run toggle, and speed choice applies before notifying and saving", () => {
  const f = fixture();
  f.click("time-toggle");
  for (const [i, hour] of [5, 12, 19.5, 23].entries()) {
    f.click(f.presets[i]);
    assert.equal(f.state.hour, hour);
    assert.equal(f.changes.at(-1).hour, hour);
    assert.equal(f.state.running, true);
    assert.equal(JSON.parse(f.values.get(key)).hour, hour);
    for (const level of ["forest", "city", "stunt", "amsterdam", "wellington", "moon"])
      assert.equal(sampleDaylight(hour, level).period, ["sunrise", "daylight", "golden-hour", "night"][i]);
  }
  f.click("time-running");
  assert.equal(f.state.running, false);
  assert.equal(f.get("time-running").getAttribute("aria-pressed"), "false");
  assert.equal(f.get("time-running-state").textContent, "Frozen");
  f.click("time-running");
  assert.equal(f.state.running, true);
  for (const minutes of [3, 30, 12]) {
    f.get("time-cycle-speed").value = String(minutes);
    f.get("time-cycle-speed").emit("change");
    assert.equal(f.changes.at(-1).cycleMinutes, minutes);
    assert.equal(JSON.parse(f.values.get(key)).cycleMinutes, minutes);
  }
  assert.equal(f.changes.length, 9);
  assert.equal(f.writes.length, 9);
  assert.equal(f.values.get("wildrun-session-v1"), "unrelated save");
});

test("invalid input and speed values cannot reach the controller", () => {
  const f = fixture();
  f.click("time-toggle");
  for (const value of ["", "-1", "1440", "0.5", "nope", "Infinity"]) {
    f.get("time-range").value = value;
    f.get("time-range").emit("input");
  }
  for (const value of ["", "-3", "0", "13", "Infinity"]) {
    f.get("time-cycle-speed").value = value;
    f.get("time-cycle-speed").emit("change");
  }
  assert.deepEqual(f.calls, []);
  assert.equal(f.changes.length + f.writes.length, 0);
});

test("native range keys and all toolbar shortcuts stay local while keyup releases held driving keys", () => {
  const f = fixture(), keys = {};
  bindDrivingInput(keys, [], f.win, f.doc);
  let shortcuts = 0;
  f.win.addEventListener("keydown", () => { shortcuts++; });
  f.win.emit("keydown", { key: "w" });
  assert.equal(keys.w, true);
  f.click("time-toggle");
  f.get("time-range").emit("keyup", { key: "w" });
  assert.equal(keys.w, false, "Do not trap a held accelerator on keyup");
  for (const id of ["time-range", "time-running", "time-cycle-speed", "time-toggle", "time-close"]) {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", " ", "Shift", "w", "r", "c", "Tab", "Enter"]) {
      const event = f.get(id).emit("keydown", { key });
      assert.equal(event.defaultPrevented, false, `${id}: ${key} retains native behavior`);
    }
  }
  assert.equal(shortcuts, 1);
  assert.equal(Object.values(keys).some(Boolean), false);
  const escape = f.get("time-range").emit("keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(shortcuts, 1);
  assert.equal(f.get("time-panel").hidden, true);
  assert.equal(f.doc.activeElement, f.get("time-toggle"));
});

test("close, toggle, outside pointer/click, and tab-out dismiss without stealing external focus", () => {
  const f = fixture();
  const outside = new Element("button", f.doc);
  for (const closeId of ["time-close", "time-toggle"]) {
    f.click("time-toggle");
    f.click(closeId);
    assert.equal(f.get("time-panel").hidden, true);
    assert.equal(f.get("time-toggle").getAttribute("aria-expanded"), "false");
    assert.equal(f.doc.activeElement, f.get("time-toggle"));
  }
  for (const type of ["pointerdown", "click"]) {
    f.click("time-toggle");
    f.get("time-range").emit(type);
    assert.equal(f.get("time-panel").hidden, false);
    outside.emit(type);
    assert.equal(f.get("time-panel").hidden, true);
    assert.equal(f.doc.activeElement, f.get("time-toggle"));
  }
  f.click("time-toggle");
  outside.focus();
  assert.equal(f.get("time-panel").hidden, true);
  assert.equal(f.doc.activeElement, outside);
  f.click("time-toggle");
  f.click(outside);
  assert.equal(f.doc.activeElement, outside);
  assert.equal(f.writes.length + f.changes.length, 0);
});

test("preset taps survive Safari moving range focus to the ancestor mobile dialog", () => {
  const f = fixture();
  const dialog = new Element("dialog", f.doc);
  dialog.setAttribute("id", "drive-menu");
  const nav = new Element("nav", dialog);
  nav.setAttribute("class", "top");
  const root = f.get("time-controls");
  root.parent.children.splice(root.parent.children.indexOf(root), 1);
  root.parent = nav;
  nav.children.push(root);
  f.click("time-toggle");
  assert.equal(f.doc.activeElement, f.get("time-range"));

  const preset = f.presets[3];
  preset.emit("pointerdown");
  dialog.focus(); // Safari taps do not focus buttons, even inside a native dialog.
  assert.equal(f.get("time-panel").hidden, false, "Focusout must not hide the pending click target");
  preset.emit("pointerup");
  assert.equal(f.get("time-panel").hidden, false);
  preset.emit("click");
  assert.equal(f.doc.activeElement, dialog);
  assert.equal(f.get("time-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(f.get("time-range").value, "1380");
  assert.equal(preset.dataset.selected, "true");
  assert.deepEqual(f.calls, [["hour", 23]]);
  assert.equal(f.changes.length, 1);
  assert.equal(f.changes[0].hour, 23);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(JSON.parse(f.values.get(key)), { ...defaults, hour: 23 });
});

test("document pointer release and cancellation restore keyboard tab-out dismissal", () => {
  for (const end of ["pointerup", "pointercancel"]) {
    const f = fixture();
    const outside = new Element("button", f.doc);
    f.click("time-toggle");
    f.presets[0].emit("pointerdown");
    outside.focus();
    assert.equal(f.get("time-panel").hidden, false);
    outside.emit(end);
    f.get("time-range").focus();
    f.get("time-range").emit("keydown", { key: "Tab" });
    outside.focus();
    assert.equal(f.get("time-panel").hidden, true, end);
    assert.equal(f.doc.activeElement, outside);
    assert.equal(f.writes.length + f.changes.length, 0);
  }
});

test("Escape and outside dismissal reset an unfinished internal pointer gesture", () => {
  for (const dismiss of ["Escape", "pointerdown", "click"]) {
    const f = fixture();
    const outside = new Element("button", f.doc);
    f.click("time-toggle");
    f.presets[0].emit("pointerdown");
    if (dismiss === "Escape") f.get("time-range").emit("keydown", { key: "Escape" });
    else outside.emit(dismiss);
    assert.equal(f.get("time-panel").hidden, true, dismiss);
    assert.equal(f.doc.activeElement, f.get("time-toggle"));
    // Reopen without pointer events so a missed release cannot mask a stale guard.
    f.get("time-toggle").emit("click");
    outside.focus();
    assert.equal(f.get("time-panel").hidden, true, `${dismiss} must reset the gesture`);
    assert.equal(f.doc.activeElement, outside);
    assert.equal(f.writes.length + f.changes.length, 0);
  }
});

test("valid saved settings restore once, but automatic time is never saved by update or later toggles", () => {
  const saved = { version: 1, hour: 22, running: true, cycleMinutes: 3 };
  const f = fixture({ saved, reducedMotion: true });
  assert.equal(f.changes.length, 1);
  assert.deepEqual(f.calls, [["hour", 22], ["running", true], ["cycleMinutes", 3]]);
  assert.equal(f.get("time-clock").textContent, "22:00");
  assert.equal(f.writes.length, 0);
  f.state.hour = 23.75;
  for (let i = 0; i < 100; i++) f.controls.update();
  f.click("time-toggle");
  f.click("time-running");
  f.get("time-cycle-speed").value = "30";
  f.get("time-cycle-speed").emit("change");
  assert.deepEqual(JSON.parse(f.values.get(key)), { ...saved, running: false, cycleMinutes: 30 });
  assert.equal(f.state.hour, 23.75);
  const next = fixture({ saved: f.values.get(key) });
  assert.equal(next.state.hour, 22);
  assert.equal(next.state.running, false);
  assert.equal(next.state.cycleMinutes, 30);
  const unchanged = fixture({ saved: defaults });
  assert.deepEqual(unchanged.calls, []);
  assert.equal(unchanged.changes.length, 0);
});

test("corrupt, unknown-version, and incomplete saves preserve defaults; blocked storage stays playable", () => {
  for (const saved of ["{", "null", "[]", "false", { ...defaults, version: 7 }, { hour: 22 }, { ...defaults, hour: 24 }]) {
    const f = fixture({ saved, reducedMotion: true });
    assert.equal(f.state.hour, 16.5);
    assert.equal(f.state.running, false);
    assert.deepEqual(f.calls, []);
    assert.equal(f.writes.length + f.changes.length, 0);
  }
  for (const storage of ["blocked", "read-error", "quota"]) {
    const f = fixture({ storage });
    f.click("time-toggle");
    f.click(f.presets[3]);
    f.click("time-running");
    assert.equal(f.state.hour, 23);
    assert.equal(f.state.running, false);
    assert.equal(f.changes.length, 2);
  }
});

test("resize updates panel bounds, interruptions close it, and disposal removes every listener", () => {
  const f = fixture();
  f.click("time-toggle");
  f.get("time-panel").top = 140;
  f.win.emit("resize");
  assert.equal(f.get("time-panel").style["--time-panel-top"], "140px");
  f.get("time-panel").top = 70;
  f.win.visualViewport.emit("resize");
  assert.equal(f.get("time-panel").style["--time-panel-top"], "70px");
  f.win.emit("blur", {}, false);
  assert.equal(f.get("time-panel").hidden, true);
  f.click("time-toggle");
  f.doc.hidden = true;
  f.doc.emit("visibilitychange");
  assert.equal(f.get("time-panel").hidden, true);
  f.doc.hidden = false;
  f.click("time-toggle");
  f.controls.dispose();
  f.controls.dispose();
  assert.equal(f.get("time-toggle").disabled, true);
  assert.equal(f.get("time-panel").hidden, true);
  assert.equal(f.doc.activeElement, f.get("time-toggle"));
  const nodes = (node) => [node, ...node.children.flatMap(nodes)];
  for (const node of [...nodes(f.win), f.win.visualViewport]) {
    assert.equal([...node.listeners.values()].reduce((n, listeners) => n + listeners.size, 0), 0);
  }
  f.state.hour = 3;
  f.controls.update();
  f.get("time-running").emit("click");
  assert.equal(f.get("time-clock").textContent, "16:30");
  assert.equal(f.writes.length + f.changes.length, 0);
  const next = f.create();
  assert.equal(f.get("time-clock").textContent, "03:00");
  f.click("time-toggle");
  f.click("time-running");
  assert.equal(f.changes.length, 1, "Reinitializing must not duplicate listeners");
  next.dispose();
});

test("markup has native accessible controls and scoped responsive styling without live announcements", () => {
  assert.match(html, /cockpit\.css[\s\S]*rel="stylesheet" href="time-controls\.css"/);
  assert.match(markup, /id="time-panel" role="dialog" aria-modal="false" aria-labelledby="time-title" hidden/);
  assert.match(markup, /<label for="time-range">Game time<\/label>/);
  assert.match(markup, /id="time-range" type="range" min="0" max="1439" step="1"/);
  assert.match(markup, /for="time-cycle-speed">Minutes \/ day/);
  assert.doesNotMatch(markup, /aria-live|role="(?:status|alert)"|<output\b/);
  const buttons = [...markup.matchAll(/<button\b[^>]*>/g)];
  assert.equal(buttons.length, 7);
  assert.ok(buttons.every(([tag]) => tag.includes('type="button"')));
  assert.match(css, /max-height: calc\(100dvh/);
  assert.match(css, /overflow: auto; overscroll-behavior: contain/);
  assert.match(css, /@media \(max-width: 480px\) and \(orientation: portrait\)/);
  assert.match(css, /#time-range:focus-visible/);
  assert.doesNotMatch(css, /@import|font-family|\.touch\s*\{|\.pedal\s*\{/);
});
