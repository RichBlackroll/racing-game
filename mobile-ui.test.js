import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createMobileUI } from "./mobile-ui.js";

test("picnic UI is absent while the route map, gifts and standalone people voices remain", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  for (const file of ["index.html", "mobile-ui.js", "mobile-ui.css", "tablet.css", "modifier.css", "experience.css", "cockpit.css"]) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /friend-|delivery-|basket-|picnic-|drive-menu-adventure|friends\.css/i, file);
  }
  assert.equal(existsSync(new URL("./friends.css", import.meta.url)), false);
  assert.match(html, /<details id="drive-menu-route"><summary>Route map<\/summary>/);
  assert.match(html, /<canvas id="map"/);
  assert.match(html, /<section id="item-slot"/);
  assert.match(html, /<button[^>]+id="use-item"/);
  const nav = html.match(/<nav class="top"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  const voice = nav.match(/<button id="people-voice"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(nav, /<button id="sound"[^>]*>[\s\S]*?<\/button>\s*<button id="people-voice"/);
  assert.match(voice, /aria-label="People voices"/);
  assert.match(voice, /aria-pressed="false"/);
  assert.match(voice, /title="Turn people voices on"/);
  assert.match(voice, /<use href="#i-volume"/);
  assert.match(voice, /<span class="toolbar-label" data-label>Voices<\/span>/);
});

// Only the component's DOM surface, including capture/bubble order and deferred close events.
class Element {
  constructor(doc, selector = "") {
    this.ownerDocument = doc;
    this.selector = selector;
    this.id = selector.startsWith("#") ? selector.slice(1) : "";
    this.nodeType = 1;
    this.childNodes = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.hidden = false;
    this.open = false;
    this.scrollTop = 0;
  }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null; }
  insertBefore(node, next) {
    if (node === next) return;
    if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
    this.childNodes.splice(next ? this.childNodes.indexOf(next) : this.childNodes.length, 0, node);
    node.parentNode = this;
  }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  prepend(node) { this.insertBefore(node, this.childNodes[0] ?? null); }
  before(node) { this.parentNode.insertBefore(node, this); }
  after(node) { this.parentNode.insertBefore(node, this.nextSibling); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  closest(selector) {
    const selectors = selector.split(",").map((part) => part.trim());
    for (let node = this; node; node = node.parentNode) if (selectors.includes(node.selector)) return node;
    return null;
  }
  addEventListener(type, listener, options = false) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ listener, capture: options === true || !!options.capture });
  }
  emit(type, fields = {}) {
    const event = Object.assign(new Event(type, { bubbles: ["click", "keydown"].includes(type), cancelable: true }), fields);
    Object.defineProperty(event, "target", { value: this });
    const path = [];
    for (let node = this; node; node = node.parentNode) path.push(node);
    for (const capture of [true, false]) {
      for (const node of capture ? [...path].reverse() : event.bubbles ? path : [this]) {
        for (const entry of node.listeners.get(type) ?? []) {
          if (entry.capture === capture) entry.listener.call(node, event);
        }
        if (event.cancelBubble) return event;
      }
    }
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.emit("click"); }
  showModal() { this.open = true; }
  close() {
    if (!this.open) return;
    this.open = false;
    this.ownerDocument.closeEvents.push(() => this.emit("close"));
  }
}

function fixture({ width = 800, height = 800, touch = false } = {}) {
  const doc = { closeEvents: [] }, nodes = new Map(), classes = new Set(touch ? ["touch-device"] : []);
  const make = (selector) => {
    const node = new Element(doc, selector);
    nodes.set(selector, node);
    return node;
  };
  const get = (id) => nodes.get(`#${id}`);
  doc.body = make("body");
  doc.body.classList = {
    contains: (name) => classes.has(name),
    toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
  };
  doc.activeElement = doc.body;
  doc.getElementById = get;
  doc.querySelector = (selector) => nodes.get(selector);
  doc.createComment = () => Object.assign(new Element(doc), { nodeType: 8 });
  for (const id of ["mobile-toolbar", "drive-menu-toggle", "drive-menu", "drive-menu-close",
    "drive-menu-tools", "drive-menu-info", "drive-menu-route", "drive-menu-footer",
    "time-close", "pause", "home", "configure", "camera", "reset", "sound", "people-voice"]) make(`#${id}`);
  const nav = make(".top"), map = make(".map-card"), credits = make(".credits");
  const toolbar = get("mobile-toolbar"), toggle = get("drive-menu-toggle"), dialog = get("drive-menu");
  const close = get("drive-menu-close"), pause = get("pause"), info = get("drive-menu-info");
  const route = get("drive-menu-route");
  route.append(new Element(doc, "summary"));
  info.append(route);
  nav.append(get("home"), get("configure"), get("camera"), get("reset"), pause, get("sound"), get("people-voice"), get("time-close"));
  toolbar.append(toggle);
  toolbar.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  dialog.append(close, get("drive-menu-tools"), info, get("drive-menu-footer"));
  doc.body.append(nav, toolbar, dialog, map, credits, make("sentinel"));
  const originals = new Map([doc.body, nav].map((parent) => [parent, [...parent.children]]));
  const media = Object.assign(new EventTarget(), { matches: false, media: "" }), changes = [];
  const matchesViewport = () => media.media === "all" || media.media.split(",").some((part) => {
    const match = part.trim().match(/^\(max-(width|height):\s*(\d+)px\)$/);
    assert.ok(match, `unsupported media query: ${part}`);
    return (match[1] === "width" ? width : height) <= Number(match[2]);
  });
  const win = { matchMedia(query) {
    media.media = query;
    media.matches = matchesViewport();
    return media;
  } };
  const ui = createMobileUI({ doc, win, onOpenChange: (open) => changes.push(open) });
  const resize = (nextWidth, nextHeight = height) => {
    width = nextWidth;
    height = nextHeight;
    const matches = matchesViewport();
    if (media.matches === matches) return;
    media.matches = matches;
    media.dispatchEvent(new Event("change"));
  };
  const flushClose = () => { for (const notify of doc.closeEvents.splice(0)) notify(); };
  return { doc, get, nav, map, credits, toolbar, toggle, dialog, close, pause, route, media, originals, changes, ui, resize, flushClose };
}

function assertRestored({ originals }) {
  for (const [parent, children] of originals) {
    assert.equal(parent.children.length, children.length);
    children.forEach((node, index) => {
      assert.equal(parent.children[index], node, "same live node at its original position");
      assert.equal(node.parentNode, parent);
    });
  }
}

test("desktop controls relocate live into compact containers and restore in their original order", () => {
  const f = fixture({ width: 1200 });
  assertRestored(f);
  assert.equal(f.toolbar.hidden, true);
  assert.equal(f.doc.body.classList.contains("compact-ui"), false);
  f.toggle.emit("click");
  assert.equal(f.ui.active, false);
  assert.equal(f.dialog.open, false);
  let clicks = 0;
  f.pause.setAttribute("aria-pressed", "true");
  f.pause.addEventListener("click", () => { clicks++; });
  for (let cycle = 0; cycle < 2; cycle++) {
    f.resize(800);
    assert.equal(f.toolbar.hidden, false);
    assert.equal(f.doc.body.classList.contains("compact-ui"), true);
    for (const [node, parent] of [[f.pause, f.toolbar], [f.nav, f.get("drive-menu-tools")],
      [f.map, f.route], [f.credits, f.get("drive-menu-footer")]]) {
      assert.equal(node.parentNode, parent);
      assert.ok(parent.children.includes(node));
    }
    f.pause.emit("click");
    assert.equal(f.pause.getAttribute("aria-pressed"), "true");
    f.resize(1200);
    assertRestored(f);
    assert.equal(f.toolbar.hidden, true);
    assert.equal(f.doc.body.classList.contains("compact-ui"), false);
    f.pause.emit("click");
  }
  assert.equal(clicks, 4, "pre-existing handlers survive every move");
  assert.deepEqual(f.changes, [], "layout alone never reports an open/close transition");
});

test("people voices stay live in the menu and retain their preference on desktop", () => {
  const f = fixture(), voice = f.get("people-voice");
  voice.setAttribute("aria-pressed", "false");
  voice.addEventListener("click", () => voice.setAttribute("aria-pressed", voice.getAttribute("aria-pressed") !== "true"));
  f.toggle.click();
  voice.click();
  assert.equal(f.ui.active, true, "voice preferences do not dismiss the menu");
  assert.equal(voice.getAttribute("aria-pressed"), "true");
  assert.equal(voice.parentNode, f.nav);
  assert.deepEqual(f.changes, [true]);
  f.resize(1200);
  assertRestored(f);
  assert.equal(voice.getAttribute("aria-pressed"), "true");
  voice.click();
  assert.equal(voice.getAttribute("aria-pressed"), "false");
  assert.deepEqual(f.changes, [true, false]);
});

for (const touch of [false, true]) {
  test(`${touch ? "touch tablets stay compact" : "desktop uses inclusive width or height thresholds"} across viewport sizes`, () => {
    const f = fixture({ width: 1366, height: 1024, touch });
    assert.equal(f.media.media, touch ? "all" : "(max-width: 900px), (max-height: 600px)");
    for (const [width, height, desktopCompact] of [
      [1366, 1024, false], [900, 601, true], [901, 601, false],
      [901, 600, true], [901, 601, false], [900, 600, true], [1024, 1366, false],
    ]) {
      f.resize(width, height);
      const compact = touch || desktopCompact;
      assert.equal(f.toolbar.hidden, !compact, `${width}x${height} toolbar visibility`);
      assert.equal(f.doc.body.classList.contains("compact-ui"), compact);
      assert.equal(f.map.parentNode, compact ? f.route : f.doc.body);
      if (!compact) assertRestored(f);
    }
    assert.deepEqual(f.changes, []);
  });
}

test("each menu open starts collapsed, closes time controls and resets dialog scrolling", () => {
  const f = fixture();
  let timeCloses = 0;
  f.get("time-close").addEventListener("click", () => {
    timeCloses++;
    assert.equal(f.dialog.open, false, "time controls close before the menu opens");
  });
  for (let cycle = 0; cycle < 2; cycle++) {
    assert.equal(f.route.open, false);
    f.dialog.scrollTop = 200;
    f.toggle.click();
    assert.equal(f.dialog.open, true);
    assert.equal(f.dialog.scrollTop, 0);
    assert.equal(timeCloses, cycle + 1);
    assert.equal(f.route.open, false);
    assert.equal(f.route.children[0].selector, "summary");
    assert.equal(f.route.children[1], f.map, "live content follows the native summary");
    assert.equal(f.route.children.length, 2);
    f.route.open = true;
    f.dialog.scrollTop = 100;
    f.toggle.click();
    assert.equal(timeCloses, cycle + 1, "an already-open menu does not close time controls again");
    assert.equal(f.dialog.scrollTop, 100, "an already-open menu keeps its scroll position");
    f.close.click();
    assert.equal(f.route.open, false);
    f.flushClose();
  }
  assert.deepEqual(f.changes, [true, false, true, false]);
});

test("map visibility follows compact menus and the collapsed route without layout reads", () => {
  const f = fixture({ width: 1200 });
  assert.equal(f.ui.mapVisible, true);
  f.resize(800);
  assert.equal(f.ui.mapVisible, false);
  f.toggle.click();
  assert.equal(f.ui.mapVisible, false);
  f.route.open = true;
  assert.equal(f.ui.mapVisible, true);
  f.close.click();
  assert.equal(f.ui.mapVisible, false);
  f.resize(1200);
  assert.equal(f.ui.mapVisible, true);
});

for (const method of ["button", "Escape", "native close"]) {
  test(`${method} closes once, collapses the route map and returns focus`, () => {
    const f = fixture();
    assert.equal(f.toolbar.hidden, false);
    assert.equal(f.ui.active, false);
    assert.deepEqual(f.changes, []);
    f.toggle.emit("click");
    f.toggle.emit("click");
    assert.equal(f.ui.active, true);
    assert.equal(f.dialog.open, true);
    assert.equal(f.toggle.getAttribute("aria-expanded"), "true");
    assert.equal(f.route.children[1], f.map);
    assert.deepEqual(f.changes, [true]);
    f.route.open = true;
    f.close.focus();
    if (method === "button") f.close.emit("click");
    else if (method === "Escape") {
      let shortcuts = 0;
      f.doc.body.addEventListener("keydown", () => { shortcuts++; });
      f.close.emit("keydown", { key: "Escape" });
      assert.equal(shortcuts, 0, "dialog keys do not reach driving shortcuts");
      assert.equal(f.dialog.emit("cancel").defaultPrevented, true);
    } else {
      f.dialog.close();
      f.flushClose();
    }
    assert.equal(f.ui.active, false);
    assert.equal(f.dialog.open, false);
    assert.equal(f.route.open, false);
    assert.equal(f.toggle.getAttribute("aria-expanded"), "false");
    assert.equal(f.map.parentNode, f.route);
    assert.equal(f.doc.activeElement, f.toggle);
    assert.deepEqual(f.changes, [true, false]);
    f.flushClose();
    f.close.emit("click");
    f.dialog.emit("cancel");
    assert.deepEqual(f.changes, [true, false], "late or repeated dismissal does not notify twice");
  });
}

for (const action of ["home", "configure", "camera", "reset"]) {
  test(`${action} handler runs after synchronous close and keeps its new focus`, () => {
    const f = fixture(), button = f.get(action), icon = new Element(f.doc);
    const nextDialog = new Element(f.doc);
    f.doc.body.append(nextDialog);
    button.append(icon);
    let calls = 0;
    button.addEventListener("click", () => {
      calls++;
      assert.equal(f.dialog.open, false);
      assert.equal(f.ui.active, false);
      assert.equal(f.toggle.getAttribute("aria-expanded"), "false");
      assert.deepEqual(f.changes, [true, false]);
      assert.equal(f.doc.activeElement, f.toggle);
      nextDialog.showModal();
      nextDialog.focus();
    });
    f.toggle.emit("click");
    icon.emit("click");
    assert.equal(calls, 1, "nested click still reaches the existing control handler");
    f.flushClose();
    assert.equal(f.doc.activeElement, nextDialog);
    assert.deepEqual(f.changes, [true, false]);
  });
}

test("resizing an open menu to desktop closes once, restores controls and focuses visible pause", () => {
  const f = fixture();
  f.toggle.emit("click");
  f.route.open = true;
  f.close.focus();
  f.resize(1200);
  assert.equal(f.ui.active, false);
  assert.equal(f.dialog.open, false);
  assert.equal(f.route.open, false);
  assert.equal(f.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(f.toolbar.hidden, true);
  assert.equal(f.doc.body.classList.contains("compact-ui"), false);
  assertRestored(f);
  assert.equal(f.doc.activeElement, f.pause);
  f.flushClose();
  assert.equal(f.doc.activeElement, f.pause);
  assert.deepEqual(f.changes, [true, false]);
  f.resize(800);
  assert.equal(f.ui.active, false);
  assert.equal(f.map.parentNode, f.route);
  f.toggle.emit("click");
  assert.equal(f.dialog.open, true);
  assert.equal(f.map.parentNode, f.route);
  assert.deepEqual(f.changes, [true, false, true]);
});

test("desktop focus moves off the hidden toggle without stealing unrelated focus", () => {
  for (const focusedToggle of [true, false]) {
    const f = fixture(), target = focusedToggle ? f.toggle : f.get("configure");
    target.focus();
    f.resize(1200);
    assert.equal(f.doc.activeElement, focusedToggle ? f.pause : target);
    assert.deepEqual(f.changes, []);
  }
});

test("a delayed close event cannot dismiss a reopened dialog or steal its focus", () => {
  const f = fixture();
  f.toggle.emit("click");
  f.close.emit("click");
  assert.equal(f.doc.closeEvents.length, 1);
  f.toggle.emit("click");
  f.close.focus();
  f.flushClose();
  assert.equal(f.ui.active, true);
  assert.equal(f.dialog.open, true);
  assert.equal(f.toggle.getAttribute("aria-expanded"), "true");
  assert.equal(f.map.parentNode, f.route);
  assert.equal(f.doc.activeElement, f.close);
  assert.deepEqual(f.changes, [true, false, true]);
  f.close.emit("click");
  f.flushClose();
  assert.equal(f.ui.active, false);
  assert.equal(f.map.parentNode, f.route);
  assert.equal(f.doc.activeElement, f.toggle);
  assert.deepEqual(f.changes, [true, false, true, false]);
});
