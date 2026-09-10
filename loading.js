const destinations = {
  forest: ["Pine Valley", "Take the scenic route.", "A little drive. A big adventure."],
  city: ["Downtown", "The city is your playground.", "New streets. Same curious spirit."],
  stunt: ["Stunt Park", "Less gravity. More grinning.", "Follow the arrows. Find your next jump."],
  moon: ["Moon Run", "One small drive for you.", "Low gravity. Very high spirits."],
};

export function createLoadingScreen(doc = document, win = window) {
  const screen = doc.getElementById("loading-screen");
  const ui = doc.getElementById("game-ui");
  const title = doc.getElementById("loading-title");
  const message = doc.getElementById("loading-status");
  const note = doc.getElementById("loading-note");
  const retry = doc.getElementById("loading-retry");
  const steps = [...screen.querySelectorAll(".loading-step")];
  let state = "loading", revealTimer, slowTimer;

  function show(level, leaving = false) {
    win.clearTimeout(revealTimer);
    win.clearTimeout(slowTimer);
    const destination = destinations[level] || destinations.forest;
    state = leaving ? "leaving" : "loading";
    screen.dataset.level = destinations[level] ? level : "forest";
    screen.dataset.state = state;
    screen.hidden = false;
    ui.inert = true;
    ui.setAttribute("aria-busy", "true");
    doc.body.classList.remove("app-ready");
    title.textContent = destination[0];
    doc.getElementById("loading-tagline").textContent = destination[1];
    note.textContent = destination[2];
    retry.hidden = true;
    steps.forEach((step) => { step.dataset.state = "pending"; });
    message.textContent = leaving ? "Taking the next turn..." : "Waking up the engine...";
    slowTimer = win.setTimeout(() => {
      note.textContent = "Still unpacking your world. Larger adventures can take a moment.";
      retry.hidden = false;
    }, 30000);
  }

  function unlock() {
    screen.hidden = true;
    state = "ready";
    screen.dataset.state = state;
    ui.inert = false;
    ui.setAttribute("aria-busy", "false");
    doc.body.classList.add("app-ready");
  }

  function complete() {
    if (state !== "loading") return;
    win.clearTimeout(slowTimer);
    state = "revealing";
    screen.dataset.state = state;
    message.textContent = "Your adventure is ready.";
    steps.forEach((step) => { step.dataset.state = "done"; });
    // A timer also completes the reveal when animation events are unavailable.
    revealTimer = win.setTimeout(unlock, win.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650);
  }

  function fail(error) {
    win.clearTimeout(revealTimer);
    win.clearTimeout(slowTimer);
    state = "error";
    screen.hidden = false;
    screen.dataset.state = state;
    ui.inert = true;
    ui.setAttribute("aria-busy", "false");
    doc.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    title.textContent = "A small detour.";
    doc.getElementById("loading-tagline").textContent = "Let's get you back on the road.";
    message.textContent = "This adventure couldn't start.";
    note.textContent = error?.message || "Check your connection and try again. Your browser needs WebGL enabled.";
    retry.hidden = false;
    retry.focus();
  }

  retry.addEventListener("click", () => win.location.reload());
  win.addEventListener("keydown", (event) => {
    if (state === "ready") return;
    // Inert blocks UI interaction, but driving also listens on window.
    if (event.key !== "Tab" && !event.target?.closest?.("#loading-screen")) event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  win.addEventListener("pageshow", (event) => {
    if (event.persisted && state === "leaving") {
      win.clearTimeout(slowTimer);
      unlock();
      doc.getElementById("level").value = screen.dataset.previousLevel;
    }
  });
  show(new URLSearchParams(win.location.search).get("level"));

  return {
    get active() { return state !== "ready"; },
    async phase(index, text) {
      if (state !== "loading") return;
      message.textContent = text;
      steps.forEach((step, i) => { step.dataset.state = i < index ? "done" : i === index ? "current" : "pending"; });
      // Yield a paint before the next synchronous geometry / lighting pass.
      await new Promise((resolve) => win.requestAnimationFrame(() => win.setTimeout(resolve, 0)));
    },
    complete,
    fail,
    async navigate(url, previousLevel) {
      screen.dataset.previousLevel = previousLevel;
      show(url.searchParams.get("level"), true);
      await new Promise((resolve) => win.requestAnimationFrame(() => win.setTimeout(resolve, 0)));
      win.location.assign(url.href);
    },
  };
}
