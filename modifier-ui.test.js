import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createModifier } from "./modifier-ui.js";
import { createGaragePreview } from "./modifier-preview.js";
import { DEFAULTS, PARTS, PRESETS, computeTuning } from "./modifier-data.js";

class Element extends EventTarget {
  constructor(doc, tag = "div") {
    super();
    this.ownerDocument = doc;
    this.tagName = tag;
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
    this.hidden = false;
  }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null; }
  get firstElementChild() { return this.children[0]; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  get textContent() { return this.text || ""; }
  set textContent(value) { for (const child of [...this.children]) child.remove(); this.text = value; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
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
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.focus(); this.dispatchEvent(new Event("click")); }
}

test("production panel edits the live model, focuses parts, and restores canvas, pose and focus", (t) => {
  const doc = new EventTarget(), win = new EventTarget();
  doc.defaultView = win;
  doc.createElement = (tag) => new Element(doc, tag);
  doc.body = doc.createElement("body");
  doc.activeElement = doc.body;
  doc.getElementById = (id) => doc.body.find((node) => node.id === id);
  win.matchMedia = () => ({ matches: true });
  for (const [name, value] of Object.entries({ document: doc, window: win })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
  }
  const canvas = doc.createElement("canvas"), configure = doc.createElement("button"), panel = doc.createElement("aside");
  configure.id = "configure";
  panel.id = "modifier";
  panel.hidden = true;
  doc.body.append(canvas, configure, panel);
  const road = new THREE.Scene(), driving = new THREE.Group(), car = new THREE.Group();
  road.add(driving);
  driving.add(car);
  driving.position.set(80, 1.2, -45);
  driving.rotation.set(0.12, 2.1, 0.08);
  driving.updateMatrix();
  const pose = driving.matrix.clone();
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
  const renderer = {
    domElement: canvas, size: new THREE.Vector2(1180, 820),
    getSize(out) { return out.copy(this.size); },
    setSize(w, h, style) { assert.equal(style, false); this.size.set(w, h); },
    render(scene) { this.scene = scene; scene.updateMatrixWorld(true); },
  };
  const preview = createGaragePreview({ renderer, car });
  const changes = [], events = [], toasts = [];
  doc.addEventListener("driving-overlay-change", (event) => events.push(event.detail));
  const modifier = createModifier({ car, wheels, paint, rocket, preview, show: (text) => toasts.push(text),
    onOpenChange(open) {
      changes.push(open);
      assert.equal(car.parent, driving, "opening callback parks before transfer; closing runs after restoration");
      assert.equal(canvas.parentNode, doc.body);
    },
  });
  const host = doc.body.querySelector(".mod-preview");
  assert.equal(host.hidden, true);
  assert.equal(modifier.active, false);
  assert.equal(preview.state().active, false);
  assert.equal(modifier.visuals.engine.cylinders, 4);
  const order = [...doc.body.children];
  configure.click();
  modifier.open();
  assert.deepEqual(changes, [true], "repeated open is idempotent");
  assert.equal(configure.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement.id, "mod-title");
  assert.equal(canvas.parentNode, host);
  assert.notEqual(car.parent, driving);
  assert.equal(host.hidden, false);
  for (const part of PARTS) {
    panel.find((node) => node.classList.contains("mod-tab") && node.dataset.part === part.id).click();
    assert.equal(preview.state().part, part.id);
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
  host.querySelector(".mod-turn").click();
  assert.notEqual(preview.state().angle, angle);
  for (const preset of PRESETS) {
    panel.find((node) => node.dataset.preset === preset.id).click();
    assert.deepEqual(modifier.config, { ...DEFAULTS, ...preset.config });
    assert.deepEqual(modifier.tuning, computeTuning(modifier.config));
  }
  const edited = modifier.visuals;
  const escape = new Event("keydown");
  Object.assign(escape, { key: "Escape" });
  win.dispatchEvent(escape);
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
  assert.equal(host.hidden, true);
  assert.equal(doc.body.classList.contains("configuring"), false);
  assert.equal(configure.getAttribute("aria-expanded"), "false");
  configure.click();
  panel.querySelector(".mod-close").click();
  assert.deepEqual(changes, [true, false, true, false]);
  assert.ok(toasts.length > PARTS.length);
});
