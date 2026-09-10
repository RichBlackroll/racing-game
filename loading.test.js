import test from "node:test";
import assert from "node:assert/strict";
import { createLoadingScreen } from "./loading.js";

function fixture(search = "", reducedMotion = false) {
  const elements = new Map(), timers = new Map();
  let nextTimer = 0;
  const steps = Array.from({ length: 5 }, () => ({ dataset: {} }));
  const doc = {
    body: { classList: { add() {}, remove() {} } },
    querySelectorAll: () => [],
    getElementById(id) {
      if (!elements.has(id)) {
        const element = new EventTarget();
        Object.assign(element, {
          dataset: {}, hidden: false, textContent: "", attributes: {},
          setAttribute(name, value) { this.attributes[name] = value; },
          focus() { this.focused = true; },
          querySelectorAll: () => steps,
        });
        elements.set(id, element);
      }
      return elements.get(id);
    },
  };
  const win = new EventTarget();
  Object.assign(win, {
    location: { search, assign(url) { this.assigned = url; }, reload() { this.reloaded = true; } },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { callback(); },
    matchMedia: () => ({ matches: reducedMotion }),
  });
  const loading = createLoadingScreen(doc, win);
  function tick(delay) {
    for (const [id, timer] of [...timers]) {
      if (timer.delay === delay) { timers.delete(id); timer.callback(); }
    }
  }
  return { loading, doc, win, steps, tick, get: (id) => doc.getElementById(id) };
}

test("loader selects each destination and safely falls back for unknown levels", () => {
  for (const [level, title] of [["forest", "Pine Valley"], ["city", "Downtown"], ["stunt", "Stunt Park"], ["moon", "Moon Run"], ["unknown", "Pine Valley"]]) {
    const { get, loading } = fixture(`?level=${level}`);
    assert.equal(get("loading-title").textContent, title);
    assert.equal(get("game-ui").inert, true);
    assert.equal(loading.active, true);
  }
});

test("real phases advance stages; only completion and its reveal unlock input", async () => {
  const { loading, get, steps, tick } = fixture();
  const phase = loading.phase(2, "Polishing your getaway car...");
  tick(0);
  await phase;
  assert.deepEqual(steps.map((step) => step.dataset.state), ["done", "done", "current", "pending", "pending"]);
  assert.equal(get("loading-status").textContent, "Polishing your getaway car...");
  assert.equal(get("game-ui").inert, true);
  loading.complete();
  assert.equal(loading.active, true);
  loading.complete();
  tick(650);
  assert.equal(loading.active, false);
  assert.equal(get("loading-screen").hidden, true);
  assert.equal(get("game-ui").inert, false);
  assert.equal(get("game-ui").attributes["aria-busy"], "false");
});

test("reduced motion completes without a cinematic delay", () => {
  const { loading, tick } = fixture("?level=moon", true);
  loading.complete();
  tick(0);
  assert.equal(loading.active, false);
});

test("failures cancel a pending reveal and expose a keyboard-accessible retry", () => {
  const { loading, get, win, tick } = fixture();
  loading.complete();
  loading.fail(new Error("The car could not download."));
  tick(650);
  assert.equal(get("loading-screen").hidden, false);
  assert.equal(get("loading-screen").dataset.state, "error");
  assert.equal(get("loading-note").textContent, "The car could not download.");
  assert.equal(get("loading-retry").focused, true);
  assert.equal(get("game-ui").inert, true);
  get("loading-retry").dispatchEvent(new Event("click"));
  assert.equal(win.location.reloaded, true);
});

test("slow loads offer recovery without claiming a failure or inventing progress", () => {
  const { loading, get, tick, steps } = fixture();
  tick(30000);
  assert.equal(get("loading-retry").hidden, false);
  assert.equal(get("loading-screen").dataset.state, "loading");
  assert.ok(steps.every((step) => step.dataset.state === "pending"));
  assert.equal(loading.active, true);
});

test("navigation paints the destination before leaving and restores cached pages", async () => {
  const { loading, get, win, tick } = fixture();
  loading.complete();
  tick(650);
  const url = new URL("https://example.com/?level=moon&mode=fast#play");
  const navigation = loading.navigate(url, "forest");
  assert.equal(get("loading-title").textContent, "Moon Run");
  assert.equal(get("game-ui").inert, true);
  assert.equal(win.location.assigned, undefined);
  tick(0);
  await navigation;
  assert.equal(win.location.assigned, url.href);
  const event = new Event("pageshow");
  event.persisted = true;
  win.dispatchEvent(event);
  assert.equal(loading.active, false);
  assert.equal(get("game-ui").inert, false);
  assert.equal(get("level").value, "forest");
});

test("global driving shortcuts are blocked while loading, but work when ready", () => {
  const { loading, win, tick } = fixture();
  let received = 0;
  win.addEventListener("keydown", () => { received++; });
  const press = () => {
    const event = new Event("keydown", { cancelable: true });
    event.key = "w";
    win.dispatchEvent(event);
    return event;
  };
  assert.equal(press().defaultPrevented, true);
  assert.equal(received, 0);
  loading.complete();
  tick(650);
  assert.equal(press().defaultPrevented, false);
  assert.equal(received, 1);
});
