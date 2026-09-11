import { createSession, resolveLevel } from "./session.js";

export function createLoadingScreen(doc = document, win = window) {
  const screen = doc.getElementById("loading-screen");
  const ui = doc.getElementById("game-ui");
  const title = doc.getElementById("loading-title");
  const message = doc.getElementById("loading-status");
  const note = doc.getElementById("loading-note");
  const retry = doc.getElementById("loading-retry");
  const drive = doc.getElementById("loading-drive");
  const driveLabel = doc.getElementById("loading-drive-label");
  const garage = doc.getElementById("loading-garage");
  const storage = doc.getElementById("loading-storage");
  const steps = [...screen.querySelectorAll(".loading-step")];
  const maps = [...screen.querySelectorAll(".loading-map[data-map]")];
  const worldNames = new Map(maps.map((map) => [map.dataset.map, map.querySelector("strong").textContent]));
  const session = createSession(win);
  const level = resolveLevel(win.location.search, session.value.level);
  const resuming = !!session.value.drives[level];
  let state = "loading", slowTimer, onEnter, loaded = false, entered = false;
  let phaseIndex = -1, phaseText = "Getting ready...", navigation = 0;
  let previousState, lastError;
  const entryURL = new URL(win.location.href);
  let launchLevel = entryURL.searchParams.get("launch") === "drive" && worldNames.has(entryURL.searchParams.get("level")) ? level : null;
  let launchPainted = false, retryLevel = null;
  if (entryURL.searchParams.get("launch") === "drive") {
    entryURL.searchParams.delete("launch");
    // Launch intent belongs to this navigation, not a later reload or history visit.
    win.history.replaceState(win.history.state, "", entryURL.href);
  }
  session.update({ level });

  function show(selectedLevel, nextState = "loading") {
    win.clearTimeout(slowTimer);
    state = nextState;
    screen.dataset.level = selectedLevel;
    screen.dataset.state = state;
    screen.dataset.mode = launchLevel ? "launch" : "home";
    doc.documentElement.classList.remove("launch-requested");
    screen.hidden = false;
    ui.inert = true;
    ui.setAttribute("aria-busy", String(state !== "selecting"));
    doc.body.classList.remove("app-ready");
    title.textContent = launchLevel ? `Loading ${worldNames.get(selectedLevel)}` : "Pick a world!";
    if (launchLevel) {
      screen.scrollTop = 0;
      title.focus({ preventScroll: true });
    }
    note.textContent = "";
    note.hidden = true;
    storage.hidden = session.persistent;
    storage.textContent = session.persistent ? "" : "This device can't save your changes.";
    drive.disabled = garage.disabled = state !== "selecting";
    driveLabel.textContent = entered || resuming ? "Continue" : "Drive";
    retry.hidden = true;
    maps.forEach((map) => {
      const selected = map.dataset.map === selectedLevel;
      map.setAttribute("aria-pressed", String(selected));
    });
    steps.forEach((step, i) => {
      step.dataset.state = state === "selecting" || (loaded && selectedLevel === level) || (state === "loading" && i < phaseIndex) ? "done"
        : state === "loading" && i === phaseIndex ? "current" : "pending";
    });
    message.classList.toggle("sr-only", state === "selecting");
    message.textContent = state === "selecting" ? "Your world is ready!"
      : state === "leaving" ? "Opening world..." : phaseText;
    if (state !== "selecting") {
      slowTimer = win.setTimeout(() => {
        note.textContent = "Taking a little longer. Wait or try again.";
        note.hidden = false;
        retry.hidden = false;
      }, 30000);
    }
  }

  function unlock() {
    win.clearTimeout(slowTimer);
    screen.hidden = true;
    state = "ready";
    screen.dataset.state = state;
    ui.inert = false;
    ui.setAttribute("aria-busy", "false");
    doc.body.classList.add("app-ready");
  }

  function complete(callback) {
    if (loaded || (state !== "loading" && state !== "leaving") || previousState === "error") return;
    loaded = true;
    onEnter = callback;
    // A departing page can finish booting before it enters the back/forward cache.
    if (state === "loading") {
      if (launchLevel === level) {
        if (launchPainted) enter("drive");
      } else show(level, "selecting");
    }
  }

  function home() {
    if (!loaded || state === "error" || state === "leaving") return;
    navigation++;
    launchLevel = retryLevel = null;
    launchPainted = false;
    show(level, "selecting");
    drive.focus();
  }

  function enter(action) {
    if (state !== "selecting" && !(action === "drive" && state === "loading" && loaded && launchLevel === level && launchPainted)) return;
    const automatic = state === "loading";
    entered = true;
    unlock();
    try {
      const focusTarget = doc.getElementById(doc.body.classList.contains("compact-ui") ? "drive-menu-toggle" : "configure");
      // The launch buttons are now hidden; dialogs need a visible return target.
      if (action === "garage") focusTarget.focus();
      // Explicit Drive/Garage clicks keep activation; auto-entry can unlock audio on the first driving gesture.
      onEnter?.(action, { automatic });
      if (action === "drive" && state === "ready" && !doc.querySelector("dialog[open]")) focusTarget.focus();
      launchLevel = retryLevel = null;
      launchPainted = false;
    } catch (error) {
      fail(error);
    }
  }

  function fail(error) {
    win.clearTimeout(slowTimer);
    navigation++;
    retryLevel = launchLevel;
    launchLevel = null;
    launchPainted = false;
    loaded = false;
    lastError = error;
    state = "error";
    screen.hidden = false;
    screen.dataset.state = state;
    screen.dataset.mode = "home";
    ui.inert = true;
    ui.setAttribute("aria-busy", "false");
    doc.body.classList.remove("app-ready");
    drive.disabled = garage.disabled = true;
    doc.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    title.textContent = "Oops!";
    message.classList.remove("sr-only");
    message.textContent = "Let's try that again.";
    note.textContent = error?.message || "Check your connection and try again. Your browser needs WebGL enabled.";
    note.hidden = false;
    retry.hidden = false;
    retry.focus();
  }

  async function navigate(url, previousLevel = level) {
    if (state !== "leaving") previousState = state;
    screen.dataset.previousLevel = previousLevel;
    const selectedLevel = resolveLevel(url.search, session.value.level);
    url.searchParams.set("launch", "drive");
    launchLevel = selectedLevel;
    retryLevel = null;
    launchPainted = false;
    session.update({ level: selectedLevel });
    show(selectedLevel, "leaving");
    const request = ++navigation;
    await new Promise((resolve) => win.requestAnimationFrame(() => win.setTimeout(resolve, 0)));
    // A second map choice or a failure must cancel a navigation still waiting to paint.
    if (request === navigation && state === "leaving") win.location.assign(url.href);
  }

  async function play(selectedLevel) {
    if (state === "ready") return;
    if (selectedLevel === level && state !== "error" && previousState !== "error") {
      const request = ++navigation;
      launchLevel = level;
      retryLevel = null;
      launchPainted = false;
      previousState = undefined;
      session.update({ level });
      show(level);
      // Even a preloaded world gives the full-screen loader a paint before entry.
      await new Promise((resolve) => win.requestAnimationFrame(() => win.setTimeout(resolve, 0)));
      if (request !== navigation) return;
      launchPainted = true;
      if (loaded) enter("drive");
      return;
    }
    const url = new URL(win.location.href);
    url.searchParams.set("level", selectedLevel);
    await navigate(url, level);
  }
  maps.forEach((map) => map.addEventListener("click", () => { play(map.dataset.map).catch(fail); }));
  drive.addEventListener("click", () => enter("drive"));
  garage.addEventListener("click", () => enter("garage"));
  retry.addEventListener("click", () => {
    if (retryLevel || launchLevel) {
      const url = new URL(win.location.href);
      url.searchParams.set("level", retryLevel || launchLevel);
      navigate(url).catch(fail);
    } else win.location.reload();
  });
  function isolateShortcuts(event) {
    if (state === "ready") return;
    // Block window shortcuts, but preserve native button Enter/Space and tab navigation.
    if (event.key !== "Tab" && !event.target?.closest?.("#loading-screen")) event.preventDefault();
    event.stopImmediatePropagation();
  }
  win.addEventListener("keydown", isolateShortcuts, true);
  win.addEventListener("keyup", isolateShortcuts, true);
  win.addEventListener("pagehide", () => {
    navigation++;
    launchLevel = null;
    launchPainted = false;
  });
  win.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      navigation++;
      launchLevel = null;
      launchPainted = false;
    }
    if (event.persisted && session.refresh()) {
      // A cached world must not overwrite a build edited on a more recent map.
      navigation++;
      show(level, "leaving");
      const url = new URL(win.location.href);
      url.searchParams.set("level", level);
      win.location.replace(url.href);
      return;
    }
    if (event.persisted && (state === "leaving" || state === "loading")) {
      navigation++;
      session.update({ level });
      doc.getElementById("level").value = level;
      show(level, loaded ? "selecting" : "loading");
      if (previousState === "error") fail(lastError);
      else if (loaded) drive.focus();
      previousState = undefined;
    }
  });
  if (launchLevel) play(level).catch(fail);
  else show(level);

  return {
    get level() { return level; },
    get active() { return state !== "ready"; },
    async phase(index, text) {
      if (loaded || (state !== "loading" && state !== "leaving") || previousState === "error") return;
      phaseIndex = index;
      phaseText = text;
      if (state === "loading") {
        message.textContent = text;
        steps.forEach((step, i) => { step.dataset.state = i < index ? "done" : i === index ? "current" : "pending"; });
      }
      // Yield a paint before the next synchronous geometry / lighting pass.
      await new Promise((resolve) => win.requestAnimationFrame(() => win.setTimeout(resolve, 0)));
    },
    complete,
    home,
    fail,
    navigate,
  };
}
