import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLoadingScreen } from "./loading.js";
import { createSession } from "./session.js";

function fixture(search = "", { savedLevel, savedDrive, persistent = true, reducedMotion = false } = {}) {
  const elements = new Map(), timers = new Map(), saved = new Map();
  function createClassList() {
    const classes = new Set();
    return {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains: (name) => classes.has(name),
      toggle(name, force = !classes.has(name)) {
        if (force) classes.add(name);
        else classes.delete(name);
        return classes.has(name);
      },
    };
  }
  let nextTimer = 0;
  const steps = Array.from({ length: 5 }, () => ({ dataset: {}, classList: createClassList() }));
  const doc = {
    activeElement: null,
    body: { classList: createClassList() },
    querySelectorAll: () => [...elements.values()].filter((element) => element.open),
    querySelector() { return this.querySelectorAll()[0] || null; },
    getElementById(id) {
      if (!elements.has(id)) {
        const element = new EventTarget();
        Object.assign(element, {
          dataset: {}, hidden: false, disabled: false, textContent: "", attributes: {},
          classList: createClassList(),
          setAttribute(name, value) { this.attributes[name] = value; },
          focus() { doc.activeElement = this; },
          close() { this.open = false; },
          closest: (selector) => selector === "#loading-screen" && (id.startsWith("loading-") || id.startsWith("map-")) ? doc.getElementById("loading-screen") : null,
          querySelector: () => null,
          querySelectorAll: () => [],
        });
        elements.set(id, element);
      }
      return elements.get(id);
    },
  };
  const get = (id) => doc.getElementById(id);
  const maps = ["forest", "city", "stunt", "moon", "amsterdam", "wellington"].map((level) => {
    const map = get(`map-${level}`);
    map.dataset.map = level;
    return map;
  });
  get("loading-screen").querySelectorAll = (selector) => selector === ".loading-step" ? steps : selector === ".loading-map[data-map]" ? maps : [];
  const win = new EventTarget();
  Object.assign(win, {
    location: { search, href: `https://example.com/play/${search}#ride`, assign(url) { this.assigned = url; }, replace(url) { this.replaced = url; }, reload() { this.reloaded = true; } },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { callback(); },
    matchMedia: () => ({ matches: reducedMotion }),
  });
  const localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  };
  Object.defineProperty(win, "localStorage", { get() {
    if (!persistent) throw new Error("Storage blocked");
    return localStorage;
  } });
  if (savedLevel) createSession(win).update({ level: savedLevel });
  if (savedDrive) createSession(win).update({ drives: { [savedLevel ?? "forest"]: savedDrive } });
  const loading = createLoadingScreen(doc, win);
  function tick(delay) {
    for (const [id, timer] of [...timers]) {
      if (timer.delay === delay) { timers.delete(id); timer.callback(); }
    }
  }
  async function paint() {
    tick(0);
    await Promise.resolve();
    await Promise.resolve();
  }
  function pageshow(persisted = true) {
    const event = new Event("pageshow");
    event.persisted = persisted;
    win.dispatchEvent(event);
  }
  function press(key, target = win, type = "keydown") {
    const event = new Event(type, { cancelable: true });
    event.key = key;
    Object.defineProperty(event, "target", { value: target });
    win.dispatchEvent(event);
    return event;
  }
  const click = (id) => get(id).dispatchEvent(new Event("click"));
  return { loading, doc, win, steps, maps, tick, paint, pageshow, press, click, get };
}

test("startup resolves each map and unknown levels safely; all cards stay available during loading", () => {
  for (const [requested, level] of [["forest", "forest"], ["city", "city"], ["stunt", "stunt"], ["moon", "moon"], ["amsterdam", "amsterdam"], ["wellington", "wellington"], ["unknown", "forest"], ["toString", "forest"]]) {
    const { get, loading, maps, win } = fixture(`?level=${requested}`);
    assert.equal(loading.level, level);
    assert.equal(get("loading-title").textContent, "Pick a world!");
    assert.equal(get("loading-screen").dataset.level, level);
    assert.equal(get("game-ui").inert, true);
    assert.equal(loading.active, true);
    assert.equal(get("loading-drive").disabled, true);
    assert.equal(get("loading-drive-label").textContent, "Drive");
    assert.equal(get("loading-garage").disabled, true);
    assert.equal(get("loading-status").textContent, "Getting ready...");
    assert.equal(get("loading-status").classList.contains("sr-only"), false);
    for (const id of ["loading-note", "loading-storage"]) {
      assert.equal(get(id).textContent, "");
      assert.equal(get(id).hidden, true);
    }
    assert.equal(maps.length, 6);
    for (const map of maps) {
      assert.equal(map.hidden, false);
      assert.equal(map.disabled, false);
      assert.equal(map.attributes["aria-pressed"], String(map.dataset.map === level));
    }
    assert.equal(createSession(win).value.level, level);
  }
});

test("explicit map wins over the saved map; absent or invalid queries use the saved map", () => {
  for (const [search, expected] of [["", "city"], ["?level=unknown", "city"], ["?level=moon", "moon"], ["?level=amsterdam", "amsterdam"]]) {
    const { loading, win } = fixture(search, { savedLevel: "city" });
    assert.equal(loading.level, expected);
    assert.equal(createSession(win).value.level, expected);
  }
});

test("unavailable storage shows a short warning without blocking launch", () => {
  const { loading, get } = fixture("?level=stunt", { persistent: false });
  assert.equal(loading.level, "stunt");
  assert.equal(get("loading-storage").textContent, "This device can't save your changes.");
  assert.equal(get("loading-storage").hidden, false);
  loading.complete(() => {});
  assert.equal(get("loading-storage").textContent, "This device can't save your changes.");
  assert.equal(get("loading-storage").hidden, false);
  assert.equal(get("loading-drive").disabled, false);
});

test("a saved drive offers Continue on a fresh page without automatically starting", () => {
  const { loading, get } = fixture("", { savedDrive: { x: 20, z: 30, heading: 1, checkpoint: 2, lap: 1 } });
  assert.equal(get("loading-drive-label").textContent, "Continue");
  loading.complete(() => assert.fail("A saved session still needs a launch gesture"));
  assert.equal(get("loading-drive-label").textContent, "Continue");
  assert.equal(loading.active, true);
});

test("Amsterdam resumes only its own saved drive and reselecting it does not navigate", async () => {
  const savedDrive = { x: 140, z: -90, heading: 2, checkpoint: 4, lap: 3, lapSeconds: 30, bestLap: 150 };
  for (const [search, expected, label] of [["", "amsterdam", "Continue"], ["?level=amsterdam", "amsterdam", "Continue"], ["?level=unknown", "amsterdam", "Continue"], ["?level=city", "city", "Drive"]]) {
    const { loading, get, win, click, paint } = fixture(search, { savedLevel: "amsterdam", savedDrive });
    assert.equal(loading.level, expected);
    assert.equal(get("loading-screen").dataset.level, expected);
    assert.equal(get("map-amsterdam").attributes["aria-pressed"], String(expected === "amsterdam"));
    assert.deepEqual(createSession(win).value.drives, { amsterdam: savedDrive });
    let entered = 0;
    loading.complete(() => { entered++; });
    click(`map-${expected}`);
    await paint();
    assert.equal(win.location.assigned, undefined);
    assert.equal(get("loading-screen").dataset.state, "selecting");
    assert.equal(get("loading-drive-label").textContent, label);
    assert.equal(entered, 0);
    click("loading-drive");
    assert.equal(entered, 1);
  }
});

test("only real phases advance stages and yield a paint", async () => {
  const { loading, get, steps, paint } = fixture();
  let yielded = false;
  const phase = loading.phase(2, "Polishing your getaway car...").then(() => { yielded = true; });
  assert.deepEqual(steps.map((step) => step.dataset.state), ["done", "done", "current", "pending", "pending"]);
  assert.equal(get("loading-status").textContent, "Polishing your getaway car...");
  assert.equal(get("loading-status").classList.contains("sr-only"), false);
  assert.equal(get("game-ui").inert, true);
  assert.equal(yielded, false);
  await paint();
  await phase;
  assert.equal(yielded, true);
});

test("completion stays in the selecting hub indefinitely, including reduced motion", async () => {
  for (const reducedMotion of [false, true]) {
    const { loading, get, doc, tick, steps, click } = fixture("?level=moon", { reducedMotion });
    let entered = 0;
    click("loading-drive");
    click("loading-garage");
    assert.equal(loading.active, true);
    loading.complete(() => { entered++; });
    loading.complete(() => assert.fail("A duplicate completion replaced the callback"));
    tick(0);
    tick(650);
    tick(30000);
    await loading.phase(1, "A late phase must not replace readiness");
    assert.equal(entered, 0);
    assert.equal(loading.active, true);
    assert.equal(get("loading-screen").dataset.state, "selecting");
    assert.equal(get("loading-screen").hidden, false);
    assert.equal(get("loading-title").textContent, "Pick a world!");
    assert.equal(get("game-ui").inert, true);
    assert.equal(get("game-ui").attributes["aria-busy"], "false");
    assert.equal(get("loading-drive").disabled, false);
    assert.equal(get("loading-drive-label").textContent, "Drive");
    assert.equal(get("loading-garage").disabled, false);
    assert.equal(get("loading-retry").hidden, true);
    assert.ok(steps.every((step) => step.dataset.state === "done"));
    assert.equal(get("loading-status").textContent, "Your world is ready!");
    assert.equal(get("loading-status").classList.contains("sr-only"), true);
    assert.equal(doc.body.classList.contains("sr-only"), false);
    for (const id of ["loading-note", "loading-storage"]) {
      assert.equal(get(id).textContent, "");
      assert.equal(get(id).hidden, true);
    }
    click("loading-drive");
    click("loading-garage");
    assert.equal(entered, 1);
  }
});

test("Drive unlocks immediately, calls onEnter synchronously, and focuses the garage toolbar action", () => {
  const { loading, get, doc, click } = fixture();
  let called = false, insideClick = false;
  loading.complete((action) => {
    called = true;
    assert.equal(insideClick, true);
    assert.equal(action, "drive");
    assert.equal(loading.active, false);
    assert.equal(get("loading-screen").hidden, true);
    assert.equal(get("game-ui").inert, false);
    assert.equal(doc.body.classList.contains("app-ready"), true);
    assert.equal(get("loading-status").classList.contains("app-ready"), false);
  });
  insideClick = true;
  click("loading-drive");
  insideClick = false;
  assert.equal(called, true);
  assert.equal(doc.activeElement, get("configure"));
});

test("Garage unlocks before its synchronous callback and never steals dialog focus", () => {
  const { loading, get, doc, click } = fixture();
  let called = false;
  loading.complete((action) => {
    assert.equal(action, "garage");
    assert.equal(loading.active, false);
    assert.equal(get("game-ui").inert, false);
    get("modifier").open = true;
    get("paint").focus();
    called = true;
  });
  click("loading-garage");
  assert.equal(called, true);
  assert.equal(doc.activeElement, get("paint"));
});

test("completion does not move focus away from a map being explored", () => {
  const { loading, get, doc } = fixture();
  get("map-city").focus();
  loading.complete(() => {});
  assert.equal(doc.activeElement, get("map-city"));
});

test("home restores the loaded map without a prior slow note and preserves the launch callback", () => {
  const { loading, get, doc, click, tick } = fixture("?level=city");
  const actions = [];
  loading.home();
  assert.equal(get("loading-screen").dataset.state, "loading");
  tick(30000);
  assert.equal(get("loading-note").hidden, false);
  loading.complete((action) => actions.push(action));
  assert.equal(get("loading-note").textContent, "");
  assert.equal(get("loading-note").hidden, true);
  click("loading-drive");
  loading.home();
  assert.equal(loading.active, true);
  assert.equal(loading.level, "city");
  assert.equal(get("loading-screen").dataset.state, "selecting");
  assert.equal(get("loading-title").textContent, "Pick a world!");
  assert.equal(get("game-ui").inert, true);
  assert.equal(doc.body.classList.contains("app-ready"), false);
  assert.equal(get("loading-drive-label").textContent, "Continue");
  assert.equal(get("loading-status").textContent, "Your world is ready!");
  assert.equal(get("loading-status").classList.contains("sr-only"), true);
  for (const id of ["loading-note", "loading-storage"]) {
    assert.equal(get(id).textContent, "");
    assert.equal(get(id).hidden, true);
  }
  assert.equal(get("loading-retry").hidden, true);
  assert.equal(doc.activeElement, get("loading-drive"));
  click("loading-garage");
  assert.deepEqual(actions, ["drive", "garage"]);
});

test("failure disables both launch actions, closes dialogs, and cannot be bypassed by complete or home", async () => {
  const { loading, get, doc, click, tick } = fixture();
  let entered = 0;
  loading.complete(() => { entered++; });
  assert.equal(get("loading-status").classList.contains("sr-only"), true);
  get("modifier").open = true;
  loading.fail(new Error("The car could not download."));
  loading.home();
  loading.complete(() => { entered++; });
  await loading.phase(4, "Not ready");
  click("loading-drive");
  click("loading-garage");
  tick(30000);
  assert.equal(entered, 0);
  assert.equal(get("loading-screen").hidden, false);
  assert.equal(get("loading-screen").dataset.state, "error");
  assert.equal(get("loading-title").textContent, "Oops!");
  assert.equal(get("loading-status").textContent, "Let's try that again.");
  assert.equal(get("loading-status").classList.contains("sr-only"), false);
  assert.equal(get("loading-status").hidden, false);
  assert.equal(get("loading-note").textContent, "The car could not download.");
  assert.equal(get("loading-note").hidden, false);
  assert.equal(get("loading-retry").hidden, false);
  assert.equal(doc.activeElement, get("loading-retry"));
  assert.equal(get("game-ui").inert, true);
  assert.equal(get("game-ui").attributes["aria-busy"], "false");
  assert.equal(get("modifier").open, false);
  assert.equal(get("loading-drive").disabled, true);
  assert.equal(get("loading-garage").disabled, true);
});

test("launch callback failures return to the failure hub and remove the ready UI", () => {
  const { loading, get, doc, click } = fixture();
  loading.complete(() => { throw new Error("Graphics paused."); });
  click("loading-drive");
  assert.equal(loading.active, true);
  assert.equal(get("loading-screen").dataset.state, "error");
  assert.equal(get("loading-note").textContent, "Graphics paused.");
  assert.equal(get("loading-note").hidden, false);
  assert.equal(get("loading-status").classList.contains("sr-only"), false);
  assert.equal(doc.body.classList.contains("app-ready"), false);
  assert.equal(doc.activeElement, get("loading-retry"));
});

test("slow loads offer retry without fabricated progress or enabling launch", () => {
  const { loading, get, win, tick, steps, click } = fixture();
  tick(30000);
  assert.equal(get("loading-note").textContent, "Taking a little longer. Wait or try again.");
  assert.equal(get("loading-note").hidden, false);
  assert.equal(get("loading-retry").hidden, false);
  assert.equal(get("loading-screen").dataset.state, "loading");
  assert.equal(get("loading-title").textContent, "Pick a world!");
  assert.equal(get("loading-status").textContent, "Getting ready...");
  assert.equal(get("loading-status").classList.contains("sr-only"), false);
  assert.ok(steps.every((step) => step.dataset.state === "pending"));
  assert.equal(get("loading-drive").disabled, true);
  assert.equal(get("loading-garage").disabled, true);
  assert.equal(loading.active, true);
  click("loading-retry");
  assert.equal(win.location.reloaded, true);
});

test("all other map cards navigate during loading, preserve URL details, and remember the choice", async () => {
  for (const selected of ["forest", "city", "stunt", "moon", "amsterdam", "wellington"]) {
    const original = selected === "forest" ? "moon" : "forest";
    const { loading, get, win, paint, click, maps } = fixture(`?level=${original}&mode=fast`);
    click(`map-${selected}`);
    assert.equal(get("loading-screen").dataset.state, "leaving");
    assert.equal(get("loading-screen").dataset.level, selected);
    assert.equal(get("loading-title").textContent, "Pick a world!");
    assert.equal(get("loading-status").textContent, "Opening world...");
    assert.equal(get("loading-status").classList.contains("sr-only"), false);
    for (const map of maps) {
      assert.equal(map.attributes["aria-pressed"], String(map.dataset.map === selected));
    }
    assert.equal(get("loading-drive").disabled, true);
    assert.equal(get("loading-garage").disabled, true);
    assert.equal(win.location.assigned, undefined);
    assert.equal(createSession(win).value.level, selected);
    assert.equal(loading.level, original);
    assert.ok(maps.every((map) => !map.disabled && !map.hidden));
    await paint();
    assert.equal(win.location.assigned, `https://example.com/play/?level=${selected}&mode=fast#ride`);
  }
});

test("the selected card does not reload; rapid map choices only navigate to the latest selection", async () => {
  const { get, win, paint, click } = fixture();
  click("map-forest");
  await paint();
  assert.equal(win.location.assigned, undefined);
  click("map-city");
  click("map-moon");
  await paint();
  assert.equal(win.location.assigned, "https://example.com/play/?level=moon#ride");
  assert.equal(get("loading-screen").dataset.level, "moon");
});

test("map navigation failures are caught and expose retry instead of launching", async () => {
  const { loading, get, win, paint, click } = fixture();
  loading.complete(() => assert.fail("Failed navigation must not launch"));
  win.location.assign = () => { throw new Error("Navigation blocked."); };
  click("map-city");
  await paint();
  assert.equal(get("loading-screen").dataset.state, "error");
  assert.equal(get("loading-note").textContent, "Navigation blocked.");
  assert.equal(get("loading-note").hidden, false);
  assert.equal(get("loading-status").classList.contains("sr-only"), false);
  assert.equal(get("loading-drive").disabled, true);
  assert.equal(get("loading-garage").disabled, true);
  assert.equal(get("loading-retry").hidden, false);
  assert.equal(loading.active, true);
});

test("fail cancels navigation that is still waiting to paint", async () => {
  const { loading, win, paint } = fixture();
  const navigation = loading.navigate(new URL("https://example.com/?level=moon"), "forest");
  loading.fail(new Error("Graphics lost."));
  await paint();
  await navigation;
  assert.equal(win.location.assigned, undefined);
});

test("BFcache restores a loaded current-map launch hub, not driving or the departing selection", async () => {
  const { loading, get, win, paint, pageshow, click, doc, tick } = fixture("?level=city");
  const actions = [];
  loading.complete((action) => actions.push(action));
  click("loading-drive");
  const url = new URL("https://example.com/?level=moon&mode=fast#play");
  const navigation = loading.navigate(url, "city");
  assert.equal(get("loading-title").textContent, "Pick a world!");
  assert.equal(get("loading-status").textContent, "Opening world...");
  assert.equal(get("loading-status").classList.contains("sr-only"), false);
  assert.equal(get("game-ui").inert, true);
  await paint();
  await navigation;
  assert.equal(win.location.assigned, url.href);
  pageshow(false);
  assert.equal(get("loading-screen").dataset.state, "leaving");
  tick(30000);
  assert.equal(get("loading-note").hidden, false);
  pageshow();
  assert.equal(loading.active, true);
  assert.equal(get("game-ui").inert, true);
  assert.equal(get("loading-screen").dataset.state, "selecting");
  assert.equal(get("loading-title").textContent, "Pick a world!");
  assert.equal(get("loading-status").textContent, "Your world is ready!");
  assert.equal(get("loading-status").classList.contains("sr-only"), true);
  assert.equal(get("loading-note").textContent, "");
  assert.equal(get("loading-note").hidden, true);
  assert.equal(get("loading-retry").hidden, true);
  assert.equal(get("level").value, "city");
  assert.equal(get("map-city").attributes["aria-pressed"], "true");
  assert.equal(createSession(win).value.level, "city");
  assert.equal(doc.activeElement, get("loading-drive"));
  click("loading-drive");
  assert.deepEqual(actions, ["drive", "drive"]);
});

test("a cached page reloads its original map when another page has saved newer session data", () => {
  const { loading, win, pageshow, click, get } = fixture();
  loading.complete(() => {});
  click("loading-drive");
  const newer = createSession({ localStorage: win.localStorage });
  newer.update({ level: "moon", config: { ...newer.value.config, engine: "eight" } });
  pageshow();
  assert.equal(win.location.replaced, "https://example.com/play/?level=forest#ride");
  assert.equal(get("game-ui").inert, true);
  assert.equal(loading.active, true, "stale pagehide must not overwrite a newer drive");
  assert.equal(createSession({ localStorage: win.localStorage }).value.config.engine, "eight");
});

test("BFcache during unfinished loading restores honest current-map progress and disabled actions", async () => {
  const { loading, get, paint, pageshow, click, steps } = fixture();
  click("map-moon");
  const phase = loading.phase(2, "Polishing your getaway car...");
  assert.equal(get("loading-status").textContent, "Opening world...");
  assert.ok(steps.every((step) => step.dataset.state === "pending"));
  await paint();
  await phase;
  pageshow();
  assert.equal(get("loading-screen").dataset.state, "loading");
  assert.equal(get("loading-title").textContent, "Pick a world!");
  assert.equal(get("loading-status").textContent, "Polishing your getaway car...");
  assert.deepEqual(steps.map((step) => step.dataset.state), ["done", "done", "current", "pending", "pending"]);
  assert.equal(get("loading-drive").disabled, true);
  loading.complete(() => {});
  assert.equal(get("loading-screen").dataset.state, "selecting");
});

test("completion while departing preserves its callback for a cached return without enabling the next map", async () => {
  const { loading, get, paint, pageshow, click } = fixture();
  let entered = false;
  click("map-moon");
  loading.complete(() => { entered = true; });
  assert.equal(get("loading-screen").dataset.state, "leaving");
  assert.equal(get("loading-drive").disabled, true);
  await paint();
  pageshow();
  assert.equal(get("loading-screen").dataset.state, "selecting");
  assert.equal(get("loading-title").textContent, "Pick a world!");
  assert.equal(entered, false);
  click("loading-drive");
  assert.equal(entered, true);
});

test("BFcache cannot revive a failed map even if a late complete arrives during navigation", async () => {
  const { loading, get, paint, pageshow, click } = fixture();
  loading.fail(new Error("World unavailable."));
  click("map-city");
  loading.complete(() => assert.fail("Failed world must stay locked"));
  await paint();
  pageshow();
  assert.equal(get("loading-screen").dataset.state, "error");
  assert.equal(get("loading-screen").dataset.level, "forest");
  assert.equal(get("loading-note").textContent, "World unavailable.");
  assert.equal(get("loading-note").hidden, false);
  assert.equal(get("loading-title").textContent, "Oops!");
  assert.equal(get("loading-status").classList.contains("sr-only"), false);
  assert.equal(get("loading-drive").disabled, true);
});

test("global keydown and keyup shortcuts are isolated until explicit launch and again on home", () => {
  const { loading, win, press, click } = fixture();
  let received = 0;
  win.addEventListener("keydown", () => { received++; });
  win.addEventListener("keyup", () => { received++; });
  for (const key of ["w", "c", "r", " ", "Shift", "Escape"]) {
    assert.equal(press(key).defaultPrevented, true);
    assert.equal(press(key, win, "keyup").defaultPrevented, true);
  }
  assert.equal(received, 0);
  loading.complete(() => {});
  assert.equal(press("w").defaultPrevented, true);
  assert.equal(received, 0);
  click("loading-drive");
  assert.equal(press("w").defaultPrevented, false);
  assert.equal(press("w", win, "keyup").defaultPrevented, false);
  assert.equal(received, 2);
  loading.home();
  assert.equal(press("w").defaultPrevented, true);
  assert.equal(received, 2);
});

test("native button Enter/Space and Tab keep their default behavior without reaching game shortcuts", () => {
  const { loading, win, get, press } = fixture();
  let received = 0;
  win.addEventListener("keydown", () => { received++; });
  win.addEventListener("keyup", () => { received++; });
  loading.complete(() => {});
  for (const id of ["map-city", "map-amsterdam", "loading-drive", "loading-garage", "loading-retry"]) {
    for (const key of ["Enter", " ", "Tab"]) {
      assert.equal(press(key, get(id)).defaultPrevented, false);
      assert.equal(press(key, get(id), "keyup").defaultPrevented, false);
    }
  }
  assert.equal(press("Tab").defaultPrevented, false);
  assert.equal(received, 0);
});

test("markup provides six inline illustrated map buttons, gated launch actions, and Maps/Sound controls", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const cards = [...html.matchAll(/<button\b[^>]*class="loading-map"[^>]*data-map="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(cards.map((card) => card[1]), ["forest", "city", "stunt", "moon", "amsterdam", "wellington"]);
  assert.deepEqual(cards.map((card) => card[2].replace(/<[^>]*>/g, "").trim()), ["Pine Valley", "Downtown", "Stunt Park", "Moon Run", "Amsterdam", "Wellington"]);
  for (const card of cards) {
    assert.match(card[0], /aria-pressed="(?:true|false)"/);
    assert.match(card[2], /<svg\b[^>]*aria-hidden="true"/);
    assert.match(card[2], /<svg\b[^>]*class="loading-map-check"[^>]*aria-hidden="true"[^>]*focusable="false"[^>]*>\s*<path\b/);
    assert.match(card[2], /class="map-route"/);
    assert.match(card[2], /class="map-landmark"/);
    assert.doesNotMatch(card[0], /\bdisabled\b|<image\b|https?:/);
  }
  const select = html.match(/<select\b[^>]*id="level"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select);
  const options = [...select[1].matchAll(/<option\b[^>]*value="([^"]+)"[^>]*>([^<]+)<\/option>/g)];
  assert.deepEqual(options.map((option) => [option[1], option[2]]), cards.map((card) => [card[1], card[2].replace(/<[^>]*>/g, "").trim()]));
  const drive = html.match(/<button\b[^>]*id="loading-drive"[^>]*\bdisabled\b[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(drive);
  assert.match(drive[1], /<svg\b[^>]*aria-hidden="true"[^>]*focusable="false"[^>]*>\s*<path\b/);
  assert.match(drive[1], /<span\b[^>]*id="loading-drive-label"[^>]*>Drive<\/span>/);
  const garage = html.match(/<button\b[^>]*id="loading-garage"[^>]*\bdisabled\b[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(garage);
  assert.equal(garage[1].replace(/<[^>]*>/g, "").trim(), "My garage");
  assert.match(html, /id="home"[\s\S]*?<use href="#i-location"\s*\/>[\s\S]*?<span>Maps<\/span>/);
  assert.match(html, /id="sound"[^>]*aria-label="Engine sound"[^>]*aria-pressed="true"/);
  assert.match(html, /build\/bootstrap\.js\?v=21/);
});

test("homepage markup omits fine copy, starts with empty hidden notices, and keeps stage text screen-reader-only", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const homepage = html.slice(html.indexOf('<section id="loading-screen"'), html.indexOf('<main id="game-ui"'));
  assert.match(homepage, /<h2\b[^>]*id="loading-title"[^>]*>Pick a world!<\/h2>/);
  assert.doesNotMatch(homepage, /loading-tagline|loading-edition|loading-eyebrow|loading-loop-label|data-map-state/);
  assert.doesNotMatch(homepage, /A LITTLE WORLD OF PLAY|NEXT STOP|TAKING THE SCENIC ROUTE|A little drive\. A big adventure\.|Good things are just around the bend\.|Paint, wheels &amp; engine|Saved on this device/);
  for (const id of ["loading-note", "loading-storage"]) {
    assert.match(homepage, new RegExp(`<p\\b[^>]*id="${id}"[^>]*\\bhidden\\b[^>]*>\\s*</p>`));
  }
  const stages = [...homepage.matchAll(/<span\b[^>]*class="loading-step"[^>]*>\s*<span\b[^>]*class="sr-only"[^>]*>([^<]+)<\/span>\s*<\/span>/g)];
  assert.deepEqual(stages.map((stage) => stage[1]), ["Sky", "World", "Car", "Sunshine", "Friends"]);
});
