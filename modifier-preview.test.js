import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createGaragePreview } from "./modifier-preview.js";

class Element extends EventTarget {
  constructor(ownerDocument = null) {
    super();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.captured = new Set();
    this.clientWidth = 760;
    this.clientHeight = 430;
    this.style = { position: "fixed", width: "1180px", height: "820px" };
  }
  get nextSibling() {
    return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null;
  }
  appendChild(node) { this.insertBefore(node, null); }
  insertBefore(node, next) {
    node.remove();
    const index = next ? this.children.indexOf(next) : this.children.length;
    assert.ok(index >= 0);
    this.children.splice(index, 0, node);
    node.parentNode = this;
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  addEventListener(type, handler) {
    super.addEventListener(type, handler);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    super.removeEventListener(type, handler);
    this.listeners.get(type)?.delete(handler);
  }
  listenerCount() { return [...this.listeners.values()].reduce((n, handlers) => n + handlers.size, 0); }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
}

function fire(target, type, data = {}) {
  const event = new Event(type, { cancelable: true });
  if (type.includes("pointer")) {
    Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientX: 100, clientY: 100 });
  }
  Object.assign(event, data);
  target.dispatchEvent(event);
}

function fixture() {
  const doc = new Element(), win = new Element();
  doc.defaultView = win;
  const media = { matches: false }, observers = [];
  win.matchMedia = () => media;
  win.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(host) { this.host = host; }
    disconnect() { this.disconnected = true; }
    trigger() { this.callback([]); }
  };
  const host = new Element(doc), canvas = new Element(doc), canvasParent = new Element(doc);
  const beforeCanvas = new Element(doc), afterCanvas = new Element(doc);
  canvasParent.appendChild(beforeCanvas);
  canvasParent.appendChild(canvas);
  canvasParent.appendChild(afterCanvas);
  const renderer = {
    domElement: canvas, size: new THREE.Vector2(1180, 820), sizes: [], renders: 0,
    getSize(out) { return out.copy(this.size); },
    setSize(w, h, style) { assert.equal(style, false); this.size.set(w, h); this.sizes.push([w, h]); },
    setPixelRatio() { assert.fail("Preview must retain the game's pixel ratio"); },
    render(scene, camera) {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      this.scene = scene;
      this.camera = camera;
      this.renders++;
    },
  };
  const road = new THREE.Scene(), driving = new THREE.Group(), car = new THREE.Group();
  driving.position.set(80, 2, -45);
  driving.rotation.set(0.12, 2.1, 0.08);
  road.add(driving);
  driving.add(new THREE.Group(), car, new THREE.Group());
  const material = new THREE.MeshStandardMaterial({ color: 0xc60920 });
  const meshes = [];
  function box(w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    car.add(mesh);
    meshes.push(mesh);
    return mesh;
  }
  const body = box(2.04, 0.7, 4.6, 0, 0.85, 0);
  box(1.65, 0.65, 1.9, 0, 1.45, 0.3);
  box(2.35, 0.1, 0.45, 0, 1.8, -1.9);
  const rocket = box(0.7, 0.7, 1.1, 0, 0.7, -2.7);
  const tires = [];
  const tireGeometry = new THREE.CylinderGeometry(0.46, 0.46, 0.32, 32).rotateZ(Math.PI / 2);
  for (const x of [-1.05, 1.05]) for (const z of [-1.4, 1.4]) {
    const tire = new THREE.Mesh(tireGeometry, material);
    tire.position.set(x, 0.46, z);
    tire.rotation.x = 0.73;
    car.add(tire);
    meshes.push(tire);
    tires.push(tire);
  }
  for (const name of ["flame", "hidden-engine"]) {
    const group = new THREE.Group();
    group.name = name;
    group.visible = false;
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000), material));
    car.add(group);
  }
  for (const props of [{ visible: false }, { transparent: true, opacity: 0 }]) {
    car.add(new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000), new THREE.MeshBasicMaterial(props)));
  }
  const environment = new THREE.Texture(), contactTexture = new THREE.Texture();
  const preview = createGaragePreview({ renderer, car, environment, contactTexture });
  return { preview, renderer, car, driving, road, body, rocket, tires, meshes, host, canvas, canvasParent,
    afterCanvas, doc, win, media, observers, environment, contactTexture };
}

function assertFramed(f) {
  const { renderer, meshes, preview } = f;
  preview.render(0);
  const { width, height, top, bottom, side } = preview.state().view;
  const projected = new THREE.Box3(), point = new THREE.Vector3();
  let lowest = Infinity;
  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      lowest = Math.min(lowest, point.y);
      point.project(renderer.camera);
      assert.ok(point.z > -1 && point.z < 1, "Car is inside the camera's clipping planes");
      projected.expandByPoint(point);
    }
  }
  const left = (projected.min.x + 1) * width / 2, right = (projected.max.x + 1) * width / 2;
  const upper = (1 - projected.max.y) * height / 2, lower = (1 - projected.min.y) * height / 2;
  assert.ok(left >= side - 0.01 && right <= width - side + 0.01, `Horizontal fit: ${left}, ${right}, ${width}`);
  assert.ok(upper >= top - 0.01 && lower <= height - bottom + 0.01, `Overlay clearance: ${upper}, ${lower}, ${height}`);
  const fill = Math.max((right - left) / (width - 2 * side), (lower - upper) / (height - top - bottom));
  assert.ok(fill > 0.72, `Car fills the available view, not a miniature: ${fill} (${width}x${height}, ${preview.state().part})`);
  assert.ok(Math.abs(lowest) < 1e-6, `Actual spun tire vertices touch the pedestal: ${lowest}`);
}

test("same visuals and canvas return to their original parents and order without losing edits", () => {
  const f = fixture(), { preview, car, driving, canvas, canvasParent, renderer } = f;
  car.position.set(0.1, 0.2, -0.1);
  car.rotation.set(0.01, 0.08, 0.02);
  car.scale.setScalar(1.1);
  car.updateMatrix();
  driving.updateMatrix();
  const carTransform = car.matrix.clone(), rootTransform = driving.matrix.clone();
  const roadOrder = [...driving.children], canvasOrder = [...canvasParent.children], style = { ...canvas.style };
  preview.open(f.host);
  const opened = preview.state();
  preview.open(f.host);
  assert.deepEqual(preview.state(), opened);
  assert.equal(f.observers.length, 1);
  assert.equal(f.host.listenerCount(), 5);
  assert.equal(car.parent.parent.isScene, true);
  assert.notEqual(car.parent.parent, f.road);
  assert.equal(canvas.parentNode, f.host);
  preview.render(0);
  assert.equal(renderer.scene.environment, f.environment);
  assert.equal(renderer.scene.getObjectById(driving.id), undefined);
  renderer.scene.traverse((node) => { if (node.isLight) assert.ok(!node.castShadow); });
  f.body.material.color.set(0x2a6fdb);
  f.rocket.scale.setScalar(1.5);
  preview.focus("rocket", true);
  car.updateMatrix();
  driving.updateMatrix();
  assert.deepEqual(car.matrix, carTransform);
  assert.deepEqual(driving.matrix, rootTransform);
  const otherHost = new Element(f.doc);
  preview.open(otherHost, "engine");
  assert.equal(f.host.listenerCount(), 0);
  assert.equal(canvas.parentNode, otherHost);
  preview.close();
  preview.close();
  assert.deepEqual(driving.children, roadOrder);
  assert.deepEqual(canvasParent.children, canvasOrder);
  assert.deepEqual(renderer.size.toArray(), [1180, 820]);
  assert.deepEqual(canvas.style, style);
  assert.equal(f.body.material.color.getHex(), 0x2a6fdb);
  assert.equal(f.rocket.scale.x, 1.5);
  car.updateMatrix();
  assert.deepEqual(car.matrix, carTransform);
  assert.equal(otherHost.listenerCount() + f.win.listenerCount() + f.doc.listenerCount(), 0);
  assert.ok(f.observers.every((observer) => observer.disconnected));
  const renders = renderer.renders;
  preview.render(1);
  assert.equal(renderer.renders, renders);
  preview.open(f.host);
  f.afterCanvas.remove();
  preview.close();
  assert.equal(canvasParent.children.at(-1), canvas);
  car.removeFromParent();
  canvas.remove();
  preview.open(f.host);
  preview.close();
  assert.equal(car.parent, null);
  assert.equal(canvas.parentNode, null);
});

test("visible parts fill landscape and portrait views, with grounded monster tires and a big rocket", () => {
  const f = fixture();
  f.preview.open(f.host);
  for (const monster of [false, true]) {
    if (monster) {
      for (const tire of f.tires) tire.scale.set(1.75, 1.65, 1.65);
      f.rocket.scale.setScalar(1.9);
      f.body.position.y += 0.25;
    }
    for (const [width, height] of [[920, 480], [680, 360], [380, 500], [320, 240], [1024, 300]]) {
      f.host.clientWidth = width;
      f.host.clientHeight = height;
      f.preview.resize();
      for (const part of ["color", "wheels", "suspension", "engine", "spoiler", "rocket"]) {
        f.preview.focus(part, true);
        assertFramed(f);
        assert.equal(f.preview.state().part, part);
        assert.ok(f.preview.state().bounds.size.every((n) => n < 10), "Hidden meshes do not affect fitting");
        if (["engine", "spoiler", "rocket"].includes(part)) assert.ok(f.renderer.camera.position.z < 0);
        if (part === "engine") assert.ok(f.preview.state().elevation > 0.7);
        if (["wheels", "suspension"].includes(part)) assert.ok(Math.abs(Math.cos(f.preview.state().angle)) < 0.3);
      }
    }
  }
  f.preview.close();
});

test("camera transitions finish in a quarter second, honor reduced motion, and never auto-spin", () => {
  const f = fixture(), { preview } = f;
  preview.open(f.host);
  const initial = preview.state();
  for (let i = 0; i < 60; i++) preview.render(1 / 60);
  assert.deepEqual(preview.state(), initial);
  preview.turn();
  preview.render(0.125);
  assert.ok(preview.state().angle > initial.angle && preview.state().angle < initial.angle + Math.PI / 2);
  assertFramed(f);
  preview.render(0.125);
  assert.ok(Math.abs(preview.state().angle - initial.angle - Math.PI / 2) < 0.001);
  assert.equal(preview.state().transitioning, false);
  const turned = preview.state();
  preview.render(10);
  assert.deepEqual(preview.state(), turned);
  preview.open(f.host);
  assert.deepEqual(preview.state(), turned, "Repeated open retains the user's chosen orbit");
  preview.focus("engine");
  for (let i = 0; i < 16; i++) { preview.render(1 / 60); assertFramed(f); }
  assert.equal(preview.state().transitioning, false);
  f.media.matches = true;
  preview.focus("rocket");
  assert.equal(preview.state().angle, 2.8);
  assert.equal(preview.state().transitioning, false);
  preview.turn();
  assert.equal(preview.state().transitioning, false);
  f.media.matches = false;
  preview.focus("color");
  f.media.matches = true;
  preview.render(0);
  assert.equal(preview.state().angle, initial.angle);
  assert.equal(preview.state().transitioning, false);
  preview.close();
});

test("primary drag releases on interruption and observers ignore zero or closed hosts", () => {
  const f = fixture(), { preview, host, renderer } = f;
  host.clientWidth = host.clientHeight = 0;
  preview.open(host);
  preview.render(1);
  assert.equal(renderer.renders, 0);
  assert.deepEqual(renderer.size.toArray(), [1180, 820]);
  host.clientWidth = 600;
  host.clientHeight = 400;
  f.observers[0].trigger();
  assert.deepEqual(renderer.size.toArray(), [600, 400]);
  assert.equal(preview.state().camera.aspect, 1.5);
  fire(host, "pointerdown", { isPrimary: false });
  assert.equal(preview.state().dragging, false);
  fire(host, "pointerdown");
  const angle = preview.state().angle;
  fire(host, "pointermove", { pointerId: 2, clientX: 200 });
  assert.equal(preview.state().angle, angle);
  fire(host, "pointercancel", { pointerId: 2 });
  assert.equal(preview.state().dragging, true);
  fire(host, "pointermove", { clientX: 150 });
  assert.notEqual(preview.state().angle, angle);
  for (const [target, type] of [[host, "pointercancel"], [host, "lostpointercapture"], [f.win, "blur"], [f.win, "pointerup"]]) {
    fire(target, type);
    assert.equal(preview.state().dragging, false);
    assert.equal(host.captured.size, 0);
    fire(host, "pointerdown");
  }
  f.doc.hidden = true;
  fire(f.doc, "visibilitychange");
  assert.equal(preview.state().dragging, false);
  f.doc.hidden = false;
  fire(host, "pointerdown");
  fire(host, "pointermove", { pointerType: "mouse", buttons: 0 });
  assert.equal(preview.state().dragging, false);
  const capture = host.setPointerCapture;
  host.setPointerCapture = () => { throw new Error("Pointer was already cancelled"); };
  fire(host, "pointerdown");
  assert.equal(preview.state().dragging, false);
  host.setPointerCapture = capture;
  fire(host, "pointerdown");
  host.releasePointerCapture = (id) => { host.captured.delete(id); throw new Error("Capture was lost"); };
  preview.close();
  assert.equal(host.captured.size, 0);
  const sizes = renderer.sizes.length;
  f.observers[0].trigger();
  fire(host, "pointerdown");
  assert.equal(renderer.sizes.length, sizes);
  assert.equal(preview.state().dragging, false);
});
