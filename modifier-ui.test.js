import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createModifier } from "./modifier-ui.js";
import { createModifierCar } from "./modifier-car.js";
import { createGaragePreview } from "./modifier-preview.js";
import { DEFAULTS, PARTS, PRESETS, computeTuning } from "./modifier-data.js";
import { createSession } from "./session.js";

class Element extends EventTarget {
  constructor(doc, tag = "div") {
    super();
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.className = "";
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      toggle: (name, on) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        if (on) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      },
    };
    this.clientWidth = 720;
    this.clientHeight = 420;
    this.offsetTop = 0;
    this.hidden = false;
    this.open = false;
  }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null; }
  get firstElementChild() { return this.children[0]; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { for (const child of [...this.children]) child.remove(); this.text = value; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  replaceChildren(...nodes) { this.textContent = ""; this.append(...nodes); }
  appendChild(node) { this.insertBefore(node, null); }
  insertBefore(node, next) {
    node.remove();
    this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, node);
    node.parentNode = this;
  }
  before(node) { this.parentNode.insertBefore(node, this); }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child.find(predicate);
      if (found) return found;
    }
  }
  querySelector(selector) { return this.find((node) => node.classList.contains(selector.slice(1))); }
  querySelectorAll() {
    return this.children.flatMap((child) => [
      ...((child.tagName === "BUTTON" && !child.disabled) || child.tagName === "SUMMARY" ? [child] : []),
      ...child.querySelectorAll(),
    ]);
  }
  getClientRects() { return this.hidden ? [] : [{}]; }
  closest(selector) {
    let node = this;
    while (node) {
      if (selector === "details:not([open])" && node.tagName === "DETAILS" && !node.open) return node;
      node = node.parentNode;
    }
    return null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  click() { if (!this.disabled) { this.focus(); this.dispatchEvent(new Event("click")); } }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event("close")); }
}

function vehicleModel() {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xc60920 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4.6), paint);
  body.position.y = 1;
  car.add(body);
  const wheels = [];
  for (const x of [-1, 1]) for (const z of [-1.4, 1.4]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.4, z);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 24).rotateZ(Math.PI / 2), paint);
    pivot.add(tire);
    car.add(pivot);
    wheels.push({ pivot, tire, hub: new THREE.Group(), front: z > 0 });
  }
  const rocket = new THREE.Group();
  rocket.position.set(0, 0.8, -2.8);
  rocket.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.8), paint));
  car.add(rocket);
  return { car, body, visuals: createModifierCar({ car, wheels, paint, rocket }) };
}

function garage(t, { localStorage, ...options } = {}) {
  const doc = new EventTarget(), win = new EventTarget();
  doc.defaultView = win;
  doc.createElement = (tag) => new Element(doc, tag);
  doc.body = doc.createElement("body");
  doc.activeElement = doc.body;
  doc.getElementById = (id) => doc.body.find((node) => node.id === id);
  win.matchMedia = () => ({ matches: true });
  win.localStorage = localStorage;
  for (const [name, value] of Object.entries({ document: doc, window: win })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
  }
  const canvas = doc.createElement("canvas"), configure = doc.createElement("button"), panel = doc.createElement("dialog");
  configure.id = "configure";
  panel.id = "modifier";
  doc.body.append(canvas, configure, panel);
  const road = new THREE.Scene(), driving = new THREE.Group(), car = new THREE.Group();
  road.add(driving);
  driving.add(car);
  driving.position.set(80, 1.2, -45);
  driving.rotation.set(0.12, 2.1, 0.08);
  driving.updateMatrix();
  const pose = driving.matrix.clone(), model = vehicleModel();
  const { body, visuals } = model;
  car.add(model.car);
  const renderer = {
    domElement: canvas, size: new THREE.Vector2(1180, 820),
    getSize(out) { return out.copy(this.size); },
    getPixelRatio() { return 1; },
    setSize(w, h, style) { assert.equal(style, false); this.size.set(w, h); },
    render(scene) { this.scene = scene; scene.updateMatrixWorld(true); },
  };
  const preview = createGaragePreview({ renderer, car });
  const changes = [], events = [], toasts = [], vehicleRequests = [];
  doc.addEventListener("driving-overlay-change", (event) => events.push(event.detail));
  const modifier = createModifier({ visuals, preview, show: (text) => toasts.push(text),
    onVehicleChange(id, nextConfig, signal) {
      const next = vehicleModel();
      return new Promise((resolve, reject) => vehicleRequests.push({ id, nextConfig, signal, next, reject,
        resolve() {
          if (!signal.aborted) {
            next.visuals.apply(nextConfig);
            car.clear();
            car.add(next.car);
          }
          resolve(next.visuals);
        },
      }));
    },
    onOpenChange(open) {
      changes.push(open);
      assert.equal(car.parent, driving, "opening callback parks before transfer; closing runs after restoration");
      assert.equal(canvas.parentNode, doc.body);
    },
    ...options,
  });
  return { modifier, panel, configure, preview, doc, win, canvas, driving, car, body, visuals, pose, renderer, changes, events, toasts, vehicleRequests };
}

function fakeAudio() {
  return {
    requests: [], silences: 0,
    preview(engineId) {
      return new Promise((resolve, reject) => this.requests.push({ engineId, resolve, reject }));
    },
    silence() { this.silences++; },
  };
}

test("garage close resolves a visible focus target after the compact breakpoint changes", (t) => {
  const { modifier, configure, doc } = garage(t);
  const menu = doc.createElement("button");
  menu.id = "drive-menu-toggle";
  doc.body.append(menu);
  for (const compact of [true, false]) {
    const original = compact ? configure : menu;
    original.hidden = false;
    original.focus();
    modifier.open();
    doc.body.classList.toggle("compact-ui", compact);
    configure.hidden = compact;
    menu.hidden = !compact;
    modifier.close();
    assert.equal(doc.activeElement, compact ? menu : configure);
  }
});

test("production panel edits the live model, focuses parts, and restores canvas, pose and focus", (t) => {
  let allowed = false;
  const { modifier, panel, configure, preview, doc, canvas, driving, car, body, pose, renderer, changes, events, toasts } = garage(t, { canOpen: () => allowed });
  const host = panel.querySelector(".mod-viewport");
  assert.ok(panel.contains(host), "preview and controls belong to the same modal");
  const picker = panel.querySelector(".mod-vehicle-picker"), vehicles = panel.querySelector(".mod-vehicles").children;
  assert.equal(panel.querySelector(".mod-workbench").firstElementChild, picker);
  assert.equal(picker.nextSibling, panel.querySelector(".mod-choice-head"), "car choices sit above parts inside the scrolling workbench");
  assert.equal(picker.firstElementChild.textContent, "Choose your car");
  assert.equal(picker.getAttribute("aria-labelledby"), picker.firstElementChild.id);
  assert.equal(picker.getAttribute("aria-busy"), "false");
  assert.deepEqual(vehicles.map((button) => button.dataset.vehicle), ["porsche", "tesla"], "only available models, no placeholder Golf");
  assert.deepEqual(vehicles.map((button) => button.getAttribute("aria-label")), ["Porsche 911 GT3 RS", "Tesla Model 3"]);
  assert.deepEqual(vehicles.map((button) => button.getAttribute("aria-pressed")), ["true", "false"]);
  assert.notEqual(vehicles[0].querySelector(".mod-picture").innerHTML, vehicles[1].querySelector(".mod-picture").innerHTML, "distinct car silhouettes");
  assert.equal(panel.querySelector(".mod-tabs").children.length, 6, "vehicle selection is not a seventh part tab");
  assert.equal(modifier.active, false);
  assert.equal(preview.state().active, false);
  assert.equal(modifier.visuals.engine.cylinders, 4);
  const order = [...doc.body.children];
  configure.click();
  assert.equal(modifier.active, false, "loading or delivery can veto opening");
  assert.deepEqual(changes, []);
  allowed = true;
  configure.click();
  modifier.open();
  assert.deepEqual(changes, [true], "repeated open is idempotent");
  assert.equal(configure.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement.id, "mod-title");
  const summary = panel.querySelector(".mod-builds").firstElementChild;
  assert.equal(summary.textContent, "Try a parts setup");
  summary.focus();
  const tab = new Event("keydown", { cancelable: true });
  Object.assign(tab, { key: "Tab", shiftKey: false });
  panel.dispatchEvent(tab);
  assert.ok(tab.defaultPrevented);
  assert.equal(doc.activeElement, panel.querySelector(".mod-close"), "Tab wraps past closed presets instead of leaving the garage");
  const backTab = new Event("keydown", { cancelable: true });
  Object.assign(backTab, { key: "Tab", shiftKey: true });
  panel.dispatchEvent(backTab);
  assert.equal(doc.activeElement, summary, "Shift+Tab wraps to the last visible control");
  assert.equal(canvas.parentNode, host);
  assert.notEqual(car.parent, driving);
  assert.equal(panel.open, true);
  const bench = panel.querySelector(".mod-workbench"), partsHeading = panel.querySelector(".mod-choice-head");
  assert.equal(bench.scrollTop, 0, "opening makes the car picker discoverable again");
  partsHeading.offsetTop = 250;
  panel.find((node) => node.dataset.option === "blue").click();
  assert.equal(modifier.visuals.paint, "#2a6fdb");
  panel.querySelector(".mod-undo").click();
  assert.equal(modifier.visuals.paint, "#c60920", "Undo restores the actual model as well as selection");
  for (const part of PARTS) {
    panel.find((node) => node.classList.contains("mod-tab") && node.dataset.part === part.id).click();
    assert.equal(preview.state().part, part.id);
    assert.equal(bench.scrollTop, 250, "tabs bring parts into view below the car picker, even in short landscapes");
    for (const option of part.options) {
      panel.find((node) => node.dataset.option === option.id).click();
      assert.equal(modifier.config[part.id], option.id);
      assert.equal(doc.activeElement.dataset.option, option.id, "option rerender preserves focus");
      assert.deepEqual(modifier.tuning, computeTuning(modifier.config));
      preview.render(1);
      assert.equal(renderer.scene.getObjectById(body.id), body, "not a cloned or independent model");
      assert.ok(preview.state().bounds.size.every(Number.isFinite));
    }
  }
  assert.equal(modifier.visuals.engine.electric, true);
  assert.equal(modifier.visuals.wheels.motorHubs, 4);
  assert.equal(modifier.visuals.height.springs, 4);
  const angle = preview.state().angle;
  panel.querySelector(".mod-turn").click();
  assert.notEqual(preview.state().angle, angle);
  for (const preset of PRESETS) {
    const color = modifier.config.color;
    panel.find((node) => node.dataset.preset === preset.id).click();
    assert.deepEqual(modifier.config, { ...DEFAULTS, color, ...preset.config }, "whole-car ideas keep the chosen paint");
    assert.deepEqual(modifier.tuning, computeTuning(modifier.config));
  }
  const edited = modifier.visuals;
  const escape = new Event("cancel", { cancelable: true });
  panel.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  modifier.close();
  assert.deepEqual(changes, [true, false]);
  assert.deepEqual(events, [{ overlay: "modifier", active: true }, { overlay: "modifier", active: false }]);
  assert.deepEqual(doc.body.children, order);
  assert.deepEqual(renderer.size.toArray(), [1180, 820]);
  assert.equal(car.parent, driving);
  driving.updateMatrix();
  assert.deepEqual(driving.matrix, pose);
  assert.deepEqual(modifier.visuals, edited);
  assert.equal(doc.activeElement, configure);
  assert.equal(panel.open, false);
  assert.equal(doc.body.classList.contains("configuring"), false);
  assert.equal(configure.getAttribute("aria-expanded"), "false");
  configure.click();
  panel.querySelector(".mod-close").click();
  assert.deepEqual(changes, [true, false, true, false]);
  configure.click();
  panel.close();
  assert.equal(preview.state().active, false, "external native close restores the renderer too");
  assert.deepEqual(changes, [true, false, true, false, true, false]);
  configure.click();
  panel.dispatchEvent(new Event("close"));
  assert.equal(modifier.active, true, "late close events cannot close a reopened modal");
  assert.equal(preview.state().active, true);
  modifier.close();
  assert.ok(toasts.length > PARTS.length);
});

test("saved vehicle, configuration and part hydrate before the first render, with invalid values ignored", async (t) => {
  for (const { name, saved, config, part, vehicle = "porsche" } of [
    { name: "valid save", saved: { config: { color: "blue", engine: "six", wheels: "wide" }, selectedPart: "engine" },
      config: { ...DEFAULTS, color: "blue", engine: "six", wheels: "wide" }, part: "engine" },
    { name: "saved Tesla with a customized engine", saved: { vehicle: "tesla", config: { color: "blue", engine: "six", wheels: "wide" }, selectedPart: "engine" },
      config: { ...DEFAULTS, color: "blue", engine: "six", wheels: "wide" }, part: "engine", vehicle: "tesla" },
    { name: "Tesla default engine", saved: { vehicle: "tesla", config: { engine: "invalid" }, selectedPart: "engine" },
      config: { ...DEFAULTS, engine: "electric" }, part: "engine", vehicle: "tesla" },
    { name: "invalid choices", saved: { vehicle: "toString", config: { color: "blue", engine: "toString", wheels: null, extra: "bad" }, selectedPart: "toString" },
      config: { ...DEFAULTS, color: "blue" }, part: "color" },
    { name: "unavailable vehicle", saved: { vehicle: "golf" }, config: DEFAULTS, part: "color" },
    { name: "missing save", saved: undefined, config: DEFAULTS, part: "color" },
  ]) {
    await t.test(name, (t) => {
      const writes = [], session = { value: saved, update: (patch) => writes.push(patch) };
      const { modifier, panel, preview } = garage(t, { session });
      assert.deepEqual(modifier.config, config);
      assert.notEqual(modifier.config, saved?.config, "hydration does not retain a mutable saved config");
      assert.deepEqual(modifier.tuning, computeTuning(config));
      assert.equal(modifier.visuals.engine.cylinders, { four: 4, six: 6, electric: 0 }[config.engine]);
      assert.equal(modifier.visuals.paint, config.color === "blue" ? "#2a6fdb" : "#c60920");
      const selectedVehicle = panel.find((node) => node.dataset.vehicle === vehicle);
      assert.equal(selectedVehicle.getAttribute("aria-pressed"), "true");
      assert.equal(panel.querySelector(".mod-viewport").getAttribute("aria-label"), `${selectedVehicle.getAttribute("aria-label")} in the garage. Swipe to look around.`);
      assert.equal(panel.querySelector(".mod-options").dataset.part, part);
      assert.equal(panel.find((node) => node.dataset.option === config[part]).getAttribute("aria-pressed"), "true");
      assert.equal(panel.querySelector(".mod-undo").disabled, true, "hydration is not an undoable edit");
      modifier.open();
      assert.equal(preview.state().part, part);
      assert.deepEqual(writes, [], "opening must not overwrite saved state");
      modifier.close();
    });
  }
});

test("vehicle swaps preserve parts, lock edits while loading, and use the new live visuals with part-only Undo", async (t) => {
  const session = createSession({}), audio = fakeAudio();
  session.update({ config: { color: "blue", wheels: "monster", suspension: "lift", engine: "six", spoiler: "mega", rocket: "big" }, selectedPart: "engine" });
  const { modifier, panel, preview, car, body, visuals, renderer, driving, vehicleRequests, toasts } = garage(t, { session, audio });
  modifier.open();
  panel.find((node) => node.dataset.option === "eight").click();
  const undo = panel.querySelector(".mod-undo"), hear = panel.querySelector(".mod-engine-listen");
  const porsche = panel.find((node) => node.dataset.vehicle === "porsche"), tesla = panel.find((node) => node.dataset.vehicle === "tesla");
  const picker = panel.querySelector(".mod-vehicle-picker"), feedback = panel.querySelector(".mod-feedback");
  const before = modifier.config, saved = session.value, oldState = visuals.state();
  const apply = t.mock.method(visuals, "apply"), update = t.mock.method(session, "update"), focus = t.mock.method(preview, "focus");
  const silences = audio.silences;
  porsche.click();
  assert.equal(vehicleRequests.length, 0, "choosing the current car is a no-op, even with a customized engine");
  assert.equal(modifier.config, before);
  assert.equal(audio.silences, silences);
  assert.equal(undo.disabled, false);
  hear.click();
  const audition = audio.requests.at(-1);
  tesla.click();
  const request = vehicleRequests[0], nextConfig = { ...before, engine: "electric" };
  assert.equal(request.id, "tesla");
  assert.ok(request.signal instanceof AbortSignal);
  assert.equal(request.signal.aborted, false);
  assert.deepEqual(request.nextConfig, nextConfig);
  assert.notEqual(request.nextConfig, before, "preparing the candidate must not mutate the current config");
  assert.equal(audio.silences, silences + 2, "loading silences the old engine audition");
  assert.equal(picker.getAttribute("aria-busy"), "true");
  assert.match(feedback.textContent, /Loading Tesla Model 3/);
  assert.equal(porsche.getAttribute("aria-pressed"), "true");
  assert.equal(tesla.getAttribute("aria-pressed"), "false");
  assert.equal(car.getObjectById(body.id), body);
  const controls = () => [
    ...panel.querySelector(".mod-vehicles").children, ...panel.querySelector(".mod-tabs").children,
    ...panel.querySelector(".mod-options").children, ...panel.querySelector(".mod-presets").children,
    undo, hear, panel.querySelector(".mod-speak"),
  ];
  for (const button of controls()) {
    assert.equal(button.disabled, true, `${button.className} is disabled during a swap`);
    button.click();
    button.dispatchEvent(new Event("click"));
  }
  assert.equal(vehicleRequests.length, 1, "rapid or synthetic duplicate taps cannot start another load");
  assert.equal(modifier.config, before);
  assert.deepEqual(modifier.visuals, oldState);
  assert.deepEqual(session.value, saved);
  assert.equal(update.mock.callCount(), 0);
  assert.equal(focus.mock.callCount(), 0);
  assert.equal(audio.requests.length, 1);
  audition.resolve(false);
  await Promise.resolve();
  assert.match(feedback.textContent, /Loading Tesla Model 3/, "late audio errors do not overwrite loading feedback");
  assert.ok(!panel.querySelector(".mod-close").disabled);
  const angle = preview.state().angle;
  panel.querySelector(".mod-turn").click();
  assert.notEqual(preview.state().angle, angle, "turning stays available while the old car is visible");
  const nextApply = t.mock.method(request.next.visuals, "apply");
  request.resolve();
  await Promise.resolve();
  assert.deepEqual(modifier.config, nextConfig);
  assert.deepEqual(modifier.tuning, computeTuning(nextConfig));
  assert.deepEqual(session.value, { ...saved, vehicle: "tesla", config: nextConfig });
  assert.deepEqual(update.mock.calls[0].arguments, [{ vehicle: "tesla", config: nextConfig, selectedPart: "engine" }]);
  assert.equal(picker.getAttribute("aria-busy"), "false");
  assert.equal(porsche.getAttribute("aria-pressed"), "false");
  assert.equal(tesla.getAttribute("aria-pressed"), "true");
  assert.match(panel.querySelector(".mod-viewport").getAttribute("aria-label"), /^Tesla Model 3 in the garage/);
  assert.equal(panel.find((node) => node.dataset.option === "electric").getAttribute("aria-pressed"), "true");
  assert.equal(hear.getAttribute("aria-label"), "Hear engine: Electric motor");
  assert.equal(undo.disabled, true, "switching cars clears history rather than becoming an Undo step");
  for (const button of controls().filter((button) => button !== undo)) assert.equal(button.disabled, false);
  assert.equal(focus.mock.callCount(), 1);
  assert.deepEqual(focus.mock.calls[0].arguments, ["engine"]);
  assert.deepEqual(modifier.visuals, request.next.visuals.state());
  assert.equal(modifier.visuals.engine.electric, true);
  assert.equal(modifier.visuals.wheels.id, "monster");
  assert.equal(modifier.visuals.height.springs, 4);
  assert.equal(modifier.visuals.spoiler.added, true);
  assert.deepEqual(modifier.visuals.rocket.scale, [1.8, 1.8, 1.8]);
  assert.equal(modifier.visuals.paint, "#2a6fdb");
  assert.equal(nextApply.mock.callCount(), 1, "the loader applies the candidate before swapping; UI does not apply it twice");
  preview.render(1);
  assert.equal(renderer.scene.getObjectById(request.next.body.id), request.next.body);
  assert.equal(renderer.scene.getObjectById(body.id), undefined);
  assert.equal(toasts.at(-1), "Tesla Model 3 ready!");
  panel.find((node) => node.dataset.option === "six").click();
  assert.equal(request.next.visuals.state().engine.cylinders, 6, "subsequent edits target the returned controller");
  tesla.click();
  assert.equal(vehicleRequests.length, 1);
  assert.equal(modifier.config.engine, "six", "same-car taps do not reset a customized engine");
  undo.click();
  assert.deepEqual(modifier.config, nextConfig);
  assert.equal(undo.disabled, true);
  assert.equal(session.value.vehicle, "tesla", "Undo only changes parts on the new car");
  assert.equal(apply.mock.callCount(), 0, "the old controller never receives another edit");
  assert.deepEqual(visuals.state(), oldState);
  porsche.click();
  vehicleRequests.at(-1).resolve();
  await Promise.resolve();
  assert.deepEqual(modifier.config, { ...nextConfig, engine: "four" });
  assert.equal(session.value.vehicle, "porsche");
  assert.equal(modifier.visuals.engine.cylinders, 4);
  assert.equal(undo.disabled, true);
  modifier.close();
  assert.equal(car.parent, driving, "the preview still restores the stable car holder after multiple swaps");
});

test("failed vehicle loads retain the car, config, saved selection and Undo, and the same button can retry", async (t) => {
  const session = createSession({});
  const { modifier, panel, car, body, vehicleRequests } = garage(t, { session });
  modifier.open();
  panel.find((node) => node.dataset.option === "blue").click();
  const before = modifier.config, tuning = modifier.tuning, visuals = modifier.visuals, saved = session.value;
  const update = t.mock.method(session, "update");
  const tesla = panel.find((node) => node.dataset.vehicle === "tesla"), picker = panel.querySelector(".mod-vehicle-picker");
  const feedback = panel.querySelector(".mod-feedback"), undo = panel.querySelector(".mod-undo");
  tesla.click();
  vehicleRequests[0].reject(new Error("model download failed"));
  await Promise.resolve();
  assert.equal(modifier.config, before);
  assert.equal(modifier.tuning, tuning);
  assert.deepEqual(modifier.visuals, visuals);
  assert.equal(car.getObjectById(body.id), body);
  assert.deepEqual(session.value, saved);
  assert.equal(update.mock.callCount(), 0);
  assert.equal(tesla.getAttribute("aria-pressed"), "false");
  assert.equal(panel.find((node) => node.dataset.vehicle === "porsche").getAttribute("aria-pressed"), "true");
  assert.match(panel.querySelector(".mod-viewport").getAttribute("aria-label"), /^Porsche 911 GT3 RS/);
  assert.equal(picker.getAttribute("aria-busy"), "false");
  assert.equal(tesla.disabled, false);
  assert.equal(undo.disabled, false);
  assert.match(feedback.textContent, /Could not load Tesla Model 3.*unchanged.*again to retry/);
  undo.click();
  assert.equal(modifier.config.color, "red", "failed loads preserve usable part history");
  tesla.click();
  assert.equal(vehicleRequests.length, 2);
  assert.match(feedback.textContent, /^Loading Tesla Model 3/, "retry clears the failure");
  vehicleRequests[1].resolve();
  await Promise.resolve();
  assert.equal(session.value.vehicle, "tesla");
  assert.equal(modifier.config.engine, "electric");
  assert.equal(tesla.getAttribute("aria-pressed"), "true");
  modifier.close();
});

test("closing aborts vehicle requests and late results cannot switch cars or unlock a reopened garage's new request", async (t) => {
  for (const [name, close] of [
    ["drive button", ({ panel }) => panel.querySelector(".mod-close").click()],
    ["Escape", ({ panel }) => {
      const event = new Event("cancel", { cancelable: true });
      panel.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    }],
    ["API close", ({ modifier }) => modifier.close()],
    ["native close", ({ panel }) => panel.close()],
    ["native close and reopen before the queued close event", ({ panel, modifier }, t) => {
      t.mock.method(panel, "close", () => { panel.open = false; });
      panel.close();
      modifier.open();
    }],
  ]) {
    for (const reject of [false, true]) await t.test(`${name}, late ${reject ? "rejection" : "success"}`, async (t) => {
      const session = createSession({}), fixture = garage(t, { session });
      const { modifier, panel, car, body, vehicleRequests } = fixture;
      modifier.open();
      panel.find((node) => node.dataset.option === "blue").click();
      const before = modifier.config, saved = session.value, visuals = modifier.visuals;
      const tesla = panel.find((node) => node.dataset.vehicle === "tesla"), picker = panel.querySelector(".mod-vehicle-picker");
      const feedback = panel.querySelector(".mod-feedback"), undo = panel.querySelector(".mod-undo");
      tesla.click();
      const pending = vehicleRequests[0];
      close(fixture, t);
      assert.equal(pending.signal.aborted, true);
      assert.equal(picker.getAttribute("aria-busy"), "false");
      assert.equal(tesla.disabled, false);
      assert.equal(undo.disabled, false, "cancellation retains the old car's history");
      assert.equal(panel.find((node) => node.dataset.option === "red").disabled, false);
      assert.equal(feedback.textContent, "");
      assert.equal(modifier.config, before);
      assert.deepEqual(session.value, saved);
      modifier.open();
      tesla.click();
      const current = vehicleRequests[1];
      assert.notEqual(current.signal, pending.signal);
      panel.dispatchEvent(new Event("close"));
      assert.equal(current.signal.aborted, false, "a queued close event cannot cancel a newly opened request");
      if (reject) pending.reject(new Error("late download failure"));
      else pending.resolve();
      await Promise.resolve();
      assert.equal(modifier.active, true);
      assert.equal(modifier.config, before);
      assert.deepEqual(modifier.visuals, visuals);
      assert.deepEqual(session.value, saved);
      assert.equal(car.getObjectById(body.id), body);
      assert.equal(picker.getAttribute("aria-busy"), "true");
      assert.equal(tesla.disabled, true);
      assert.equal(undo.disabled, true);
      assert.equal(tesla.getAttribute("aria-pressed"), "false");
      assert.match(feedback.textContent, /^Loading Tesla Model 3/);
      current.resolve();
      await Promise.resolve();
      assert.equal(session.value.vehicle, "tesla");
      assert.deepEqual(modifier.config, { ...before, engine: "electric" });
      assert.deepEqual(modifier.visuals, current.next.visuals.state());
      assert.equal(picker.getAttribute("aria-busy"), "false");
      modifier.close();
    });
  }
});

test("vehicle, options, tabs, presets and Undo persist through a fresh page without replacing other session data", async (t) => {
  const entries = new Map([["wildrun-friends-v1", '{"index":2,"collected":1}']]), writes = [];
  const localStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem(key, value) { entries.set(key, value); writes.push(JSON.parse(value)); },
  };
  const session = createSession({ localStorage });
  session.update({ config: { ...DEFAULTS, color: "blue", engine: "six" }, selectedPart: "engine",
    level: "moon", camera: 2, voice: true, sound: false,
    drives: { moon: { x: 10, z: 20, heading: 1, checkpoint: 2, lap: 3 } },
  });
  const initial = session.value;
  writes.length = 0;
  let expected;
  await t.test("writes only the edited garage fields", async (t) => {
    const patches = [], update = session.update;
    t.mock.method(session, "update", (patch) => { patches.push(structuredClone(patch)); return update(patch); });
    const { modifier, panel, vehicleRequests } = garage(t, { session });
    modifier.open();
    assert.deepEqual(modifier.config, initial.config);
    assert.equal(writes.length, 0);
    for (const part of PARTS) {
      panel.find((node) => node.classList.contains("mod-tab") && node.dataset.part === part.id).click();
      assert.deepEqual(patches.at(-1), { selectedPart: part.id });
      panel.find((node) => node.dataset.option === part.options.at(-1).id).click();
      assert.deepEqual(patches.at(-1), { config: modifier.config, selectedPart: part.id });
      assert.deepEqual(writes.at(-1).config, modifier.config);
    }
    for (const preset of PRESETS) {
      const previous = { config: { ...modifier.config }, selectedPart: panel.querySelector(".mod-options").dataset.part };
      panel.find((node) => node.dataset.preset === preset.id).click();
      assert.deepEqual(patches.at(-1), { config: { ...DEFAULTS, color: previous.config.color, ...preset.config },
        selectedPart: preset.id === "monster" ? "wheels" : "engine" });
      panel.querySelector(".mod-undo").click();
      assert.deepEqual(patches.at(-1), previous, "Undo saves both the old build and its selected part");
      assert.deepEqual(modifier.config, previous.config);
      assert.equal(panel.querySelector(".mod-options").dataset.part, previous.selectedPart);
    }
    panel.find((node) => node.dataset.preset === "race").click();
    panel.find((node) => node.classList.contains("mod-tab") && node.dataset.part === "rocket").click();
    panel.find((node) => node.dataset.vehicle === "tesla").click();
    vehicleRequests.at(-1).resolve();
    await Promise.resolve();
    assert.deepEqual(patches.at(-1), { vehicle: "tesla", config: modifier.config, selectedPart: "rocket" });
    expected = { ...initial, vehicle: "tesla", config: { ...modifier.config }, selectedPart: "rocket" };
    assert.deepEqual(session.value, expected);
    assert.equal(writes.length, patches.length);
    assert.equal(session.persistent, true);
    modifier.close();
    modifier.open();
    assert.deepEqual(modifier.config, expected.config, "reopening keeps edits rather than rehydrating an old snapshot");
    modifier.close();
  });
  await t.test("new window restores the saved car, build and tab", (t) => {
    const { modifier, panel, preview, win } = garage(t, { localStorage });
    assert.deepEqual(createSession(win).value, expected);
    assert.deepEqual(modifier.config, expected.config);
    assert.deepEqual(modifier.tuning, computeTuning(expected.config));
    assert.equal(modifier.visuals.engine.electric, true);
    assert.equal(modifier.visuals.paint, "#e9edf0");
    assert.equal(panel.find((node) => node.dataset.vehicle === "tesla").getAttribute("aria-pressed"), "true");
    assert.equal(panel.querySelector(".mod-options").dataset.part, "rocket");
    modifier.open();
    assert.equal(preview.state().part, "rocket");
    modifier.close();
    assert.equal(entries.get("wildrun-friends-v1"), '{"index":2,"collected":1}');
  });
});

test("Hear engine auditions only on click, uses the selected profile even when muted, and reports failures", async (t) => {
  const audio = fakeAudio(), session = createSession({});
  session.update({ sound: false });
  const { modifier, panel } = garage(t, { audio, session });
  const hear = panel.querySelector(".mod-engine-listen"), feedback = panel.querySelector(".mod-feedback");
  assert.equal(hear.textContent, "Hear engine");
  assert.equal(panel.querySelector(".mod-speak").textContent, "Read fact");
  assert.equal(panel.querySelector(".mod-options").nextSibling, hear);
  assert.equal(hear.nextSibling, panel.querySelector(".mod-fact"));
  assert.equal(feedback.getAttribute("role"), "status");
  assert.equal(feedback.getAttribute("aria-live"), "polite");
  assert.equal(hear.hidden, true);
  modifier.open();
  hear.click();
  assert.equal(audio.requests.length, 0, "a hidden audition control cannot start audio");
  for (const part of PARTS) {
    panel.find((node) => node.classList.contains("mod-tab") && node.dataset.part === part.id).click();
    assert.equal(hear.hidden, part.id !== "engine");
  }
  panel.find((node) => node.classList.contains("mod-tab") && node.dataset.part === "engine").click();
  assert.match(panel.querySelector(".mod-choice-hint").textContent, /Hear engine/);
  assert.ok(!hear.disabled, "driving mute does not disable auditions");
  for (const option of PARTS.find((part) => part.id === "engine").options) {
    const count = audio.requests.length, silences = audio.silences;
    panel.find((node) => node.dataset.option === option.id).click();
    assert.equal(audio.silences, silences + 1);
    assert.equal(audio.requests.length, count, "fitting an engine never automatically previews it");
    assert.equal(hear.getAttribute("aria-label"), `Hear engine: ${option.name}`);
    hear.click();
    assert.equal(audio.requests.length, count + 1, "preview starts synchronously in the click, without awaiting first");
    assert.equal(audio.requests.at(-1).engineId, option.id);
    audio.requests.at(-1).resolve(true);
    await Promise.resolve();
    assert.equal(feedback.textContent, "");
  }
  assert.equal(session.value.sound, false, "audition does not change driving mute");
  for (const reject of [false, true]) {
    hear.click();
    assert.equal(feedback.textContent, "", "retry clears the previous failure");
    if (reject) audio.requests.at(-1).reject(new Error("audio unavailable"));
    else audio.requests.at(-1).resolve(false);
    await Promise.resolve();
    assert.match(feedback.textContent, /could not play.*Try Hear engine again.*sound settings/);
  }
  t.mock.method(audio, "preview", () => { throw new Error("blocked"); });
  hear.click();
  assert.match(feedback.textContent, /could not play/);
  const silences = audio.silences;
  modifier.close();
  assert.equal(audio.silences, silences + 1);
});

test("late audition failures cannot overwrite feedback after changes, cancellation or reopening", async (t) => {
  const audio = fakeAudio();
  const { modifier, panel } = garage(t, { audio });
  const hear = panel.querySelector(".mod-engine-listen"), feedback = panel.querySelector(".mod-feedback");
  for (const [name, transition] of [
    ["option", () => panel.find((node) => node.dataset.option === "eight").click()],
    ["same option", () => panel.find((node) => node.dataset.option === "six").click()],
    ["part", () => panel.find((node) => node.classList.contains("mod-tab") && node.dataset.part === "wheels").click()],
    ["preset", () => panel.find((node) => node.dataset.preset === "monster").click()],
    ["Undo", () => panel.querySelector(".mod-undo").click()],
    ["close", () => modifier.close()],
    ["native close", () => panel.close()],
    ["close and reopen", () => { modifier.close(); modifier.open(); }],
    ["new audition", () => hear.click()],
    ["Read fact", () => panel.querySelector(".mod-speak").click()],
  ]) {
    modifier.open();
    panel.find((node) => node.classList.contains("mod-tab") && node.dataset.part === "engine").click();
    panel.find((node) => node.dataset.option === "six").click();
    hear.click();
    const pending = audio.requests.at(-1), silences = audio.silences;
    transition();
    assert.ok(audio.silences > silences, `${name} silences pending or active audio`);
    const current = feedback.textContent;
    pending.resolve(false);
    await Promise.resolve();
    assert.equal(feedback.textContent, current, `${name} invalidates late audio feedback`);
  }
  modifier.close();
});

test("Read fact guards unavailable speech and reports errors without stale or intentional cancellation feedback", async (t) => {
  const { modifier, panel, win } = garage(t);
  const listen = panel.querySelector(".mod-speak"), feedback = panel.querySelector(".mod-feedback");
  modifier.open();
  listen.click();
  assert.match(feedback.textContent, /Reading aloud is unavailable.*read the fact/);
  panel.find((node) => node.classList.contains("mod-tab") && node.dataset.part === "engine").click();
  panel.querySelector(".mod-engine-listen").click();
  await Promise.resolve();
  assert.match(feedback.textContent, /Engine sound could not play/, "missing audio remains an accessible, recoverable failure");
  const utterances = [];
  let cancellations = 0;
  win.speechSynthesis = {
    cancel() { cancellations++; utterances.at(-1)?.onerror({ error: "interrupted" }); },
    speak(speech) { utterances.push(speech); },
  };
  listen.click();
  assert.match(feedback.textContent, /Reading aloud is unavailable/, "the utterance constructor must also exist");
  win.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  listen.click();
  const speech = utterances.at(-1), option = PARTS.find((part) => part.id === "engine").options[0];
  assert.equal(speech.text, `${option.name}. ${option.fact}`);
  assert.equal(speech.lang, "en-GB");
  assert.equal(speech.rate, 0.88);
  assert.equal(listen.getAttribute("aria-label"), `Read fact about ${option.name}`);
  for (const error of ["canceled", "interrupted"]) {
    speech.onerror({ error });
    assert.equal(feedback.textContent, "");
  }
  speech.onerror({ error: "not-allowed" });
  assert.match(feedback.textContent, /Could not read.*Try Read fact again/);
  listen.click();
  speech.onerror({ error: "network" });
  assert.equal(feedback.textContent, "", "a new reading invalidates the old request");
  const stale = utterances.at(-1);
  panel.find((node) => node.dataset.option === "six").click();
  const fitted = feedback.textContent;
  stale.onerror({ error: "synthesis-failed" });
  assert.equal(feedback.textContent, fitted, "changing the option invalidates speech errors too");
  listen.click();
  const closing = utterances.at(-1);
  modifier.close();
  modifier.open();
  closing.onerror({ error: "audio-busy" });
  assert.equal(feedback.textContent, "");
  assert.ok(cancellations > 0);
  t.mock.method(win.speechSynthesis, "speak", () => { throw new Error("speech blocked"); });
  listen.click();
  assert.match(feedback.textContent, /Could not read this fact aloud/);
  t.mock.method(win.speechSynthesis, "cancel", () => { throw new Error("speech unavailable"); });
  assert.doesNotThrow(() => panel.find((node) => node.dataset.option === "eight").click());
  assert.doesNotThrow(() => modifier.close());
});
