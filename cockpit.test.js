import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { createCockpit } from "./cockpit.js";

function fixture(t) {
  const node = () => ({ attributes: {}, classes: new Set(), textContent: "", hidden: false,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    get classList() { return { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) }; },
  });
  const root = { prepend(element) { this.element = element; } };
  const doc = { body: node(), createElement() {
    const element = node();
    element.querySelectorAll = () => element.nodes ??= [...element.innerHTML.matchAll(/data-instrument="([^"]+)"/g)]
      .map(([, instrument]) => Object.assign(node(), { dataset: { instrument } }));
    element.querySelector = () => ({ getBoundingClientRect() { return { width: 0, height: 0 }; } });
    element.remove = () => { root.element = null; };
    return element;
  } };
  root.ownerDocument = doc;
  const cockpit = createCockpit({ root, renderer: { extensions: { has: () => false }, getContext: () => ({ isContextLost: () => true }) }, scene: new THREE.Scene(), car: new THREE.Group() });
  const instruments = Object.fromEntries(root.element.querySelectorAll().map(n => [n.dataset.instrument, n]));
  const state = { speed: 0, steer: 0, travel: 0, handbrake: false, boosting: false, recovering: false, boostRemaining: 0, boostDuration: 5, hasRocket: true };
  t.after(() => cockpit.dispose());
  return { root, doc, cockpit, instruments, update: values => cockpit.update({ ...state, ...values }) };
}

test("cabin is opt-in, leaves input to existing controls and cleans up on disposal", t => {
  const { root, doc, cockpit, update, instruments } = fixture(t);
  assert.equal(root.element.hidden, true);
  update({ speed: 20 });
  assert.equal(instruments.speed.textContent, "");
  cockpit.setActive(true);
  assert.equal(root.element.hidden, false);
  assert.equal(doc.body.classes.has("cockpit-view"), true);
  cockpit.setActive(false);
  assert.equal(root.element.hidden, true);
  assert.equal(doc.body.classes.has("cockpit-view"), false);
  cockpit.dispose();
  assert.equal(root.element, null);
});

test("speedometer uses real km/h, bounded analog sweep, and signed drive gears", t => {
  const { cockpit, update, instruments } = fixture(t);
  cockpit.setActive(true);
  for (const [speed, kmh, gear, angle] of [[0, 0, "N", -130], [20, 72, "D", -92.56], [-9, 32, "R", -113.36], [200, 720, "D", 130]]) {
    update({ speed });
    assert.equal(instruments.speed.textContent, kmh);
    assert.equal(instruments.gear.textContent, gear);
    const rotation = Number(instruments.needle.attributes.transform.match(/rotate\((.*)\)/)[1]);
    assert.ok(Math.abs(rotation - angle) < 1e-6);
  }
});

test("steering, trip and handbrake follow driving state and reset without stale readings", t => {
  const { cockpit, update, instruments } = fixture(t);
  cockpit.setActive(true);
  update({ steer: .5, travel: 1250, handbrake: true });
  assert.equal(instruments.wheel.attributes.transform, "rotate(-52.5 160 160)");
  assert.equal(instruments.trip.textContent, "1.25 KM");
  assert.equal(instruments.brake.classes.has("engaged"), true);
  assert.match(instruments.brake.textContent, /ON/);
  update({ steer: -1 });
  assert.equal(instruments.wheel.attributes.transform, "rotate(105 160 160)");
  assert.equal(instruments.trip.textContent, "0.00 KM");
  assert.equal(instruments.brake.classes.has("engaged"), false);
});

test("rocket dial reflects fitted duration, remaining boost, recovery and no-rocket selection", t => {
  const { cockpit, update, instruments } = fixture(t);
  cockpit.setActive(true);
  update({ boostDuration: 9 });
  assert.equal(instruments.boost.textContent, "READY");
  assert.equal(instruments["boost-detail"].textContent, "9.0 SEC");
  assert.equal(instruments["boost-arc"].attributes["stroke-dashoffset"], "0");
  update({ boosting: true, boostRemaining: 2.5 });
  assert.equal(instruments.boost.textContent, "BOOST");
  assert.equal(instruments["boost-detail"].textContent, "2.5 SEC");
  assert.equal(instruments["boost-arc"].attributes["stroke-dashoffset"], "50");
  update({ boosting: true, boostRemaining: -1 });
  assert.equal(instruments["boost-arc"].attributes["stroke-dashoffset"], "100");
  update({ recovering: true });
  assert.equal(instruments.boost.textContent, "COOL");
  update({ hasRocket: false });
  assert.equal(instruments.boost.textContent, "OFF");
  assert.equal(instruments["boost-detail"].textContent, "NO ROCKET");
});

test("inside view follows the driver seat on turns and grades without altering exterior camera modes", async () => {
  const source = await readFile(new URL("./game-source.js", import.meta.url), "utf8");
  const cameraSource = source.slice(source.indexOf("  function updateCamera(dt)"), source.indexOf("  await loading.phase(4"));
  const update = new Function("THREE", "car", "camera", "camMode", "heading", "surfacePose", "boosting", `
    const hasRamps = false, heightAt = () => 0, clearCamera = () => {}, cameraAnchor = new THREE.Vector3();
    ${cameraSource}; updateCamera(1);
  `);
  for (const heading of [0, 1.5, -2]) {
    const car = new THREE.Group(), camera = new THREE.PerspectiveCamera();
    car.position.set(20, 3, 40);
    car.rotation.set(-.2, heading, .05, "YXZ");
    const eye = new THREE.Vector3(.35, 1.45, .1).applyQuaternion(car.quaternion).add(car.position);
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
    update(THREE, car, camera, 2, heading, { height: 3 }, false);
    assert.ok(camera.position.distanceTo(eye) < 1e-8);
    assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction) < 1e-8);
    update(THREE, car, camera, 1, heading, { height: 3 }, false);
    assert.ok(camera.position.y > car.position.y + 20);
    update(THREE, car, camera, 0, heading, { height: 3 }, false);
    assert.ok(camera.position.y < car.position.y + 5);
  }
});

test("cabin layer is pointer-transparent and hidden in the garage with mobile layouts", async () => {
  const css = await readFile(new URL("./cockpit.css", import.meta.url), "utf8");
  assert.match(css, /#cockpit\s*\{[^}]*pointer-events: none/);
  assert.match(css, /\.configuring #cockpit\s*\{\s*visibility: hidden/);
  assert.match(css, /max-width: 600px/);
  assert.match(css, /orientation: landscape/);
});
