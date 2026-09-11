const STORAGE_KEY = "wildrun-time-controls-v1";
const CYCLE_MINUTES = [3, 12, 30];

export function validateTimeSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1
    || !Number.isFinite(value.hour) || value.hour < 0 || value.hour >= 24
    || typeof value.running !== "boolean" || !CYCLE_MINUTES.includes(value.cycleMinutes)) return null;
  return { version: 1, hour: value.hour, running: value.running, cycleMinutes: value.cycleMinutes };
}

function clockTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The daylight controller owns defaults and advancement; update() only paints the UI. */
export function createTimeControls({ daylight, onChange = () => {} }) {
  const root = document.getElementById("time-controls");
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const get = (id) => root.querySelector(`#${id}`);
  const toggle = get("time-toggle"), panel = get("time-panel"), close = get("time-close");
  const clock = get("time-clock"), reading = get("time-reading"), period = get("time-period");
  const range = get("time-range"), running = get("time-running"), runningState = get("time-running-state");
  const speed = get("time-cycle-speed"), lights = get("time-lights");
  const presets = [...root.querySelectorAll("[data-time-hour]")];
  const listeners = [];
  let disposed = false, scrubbing = false, restored = false;
  let saved;
  try { saved = validateTimeSettings(JSON.parse(win.localStorage.getItem(STORAGE_KEY))); } catch {}
  if (saved) {
    const state = daylight.state();
    if (state.hour !== saved.hour) { daylight.setHour(saved.hour); restored = true; }
    if (state.running !== saved.running) { daylight.setRunning(saved.running); restored = true; }
    if (state.cycleMinutes !== saved.cycleMinutes) { daylight.setCycleMinutes(saved.cycleMinutes); restored = true; }
  }
  // A speed/run change must not save a later, automatically advanced clock time.
  let selectedHour = daylight.state().hour;

  function listen(target, type, listener) {
    target.addEventListener(type, listener);
    listeners.push(() => target.removeEventListener(type, listener));
  }

  function save() {
    const state = daylight.state();
    try {
      win.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1, hour: selectedHour, running: state.running, cycleMinutes: state.cycleMinutes,
      }));
    } catch {} // Private browsing or full storage must not interrupt the drive.
  }

  function fitPanel() {
    if (!panel.hidden) panel.style.setProperty("--time-panel-top", `${panel.getBoundingClientRect().top}px`);
  }

  function setOpen(open, returnFocus = false) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      update();
      fitPanel();
      range.focus({ preventScroll: true });
    } else {
      scrubbing = false;
      if (returnFocus) toggle.focus({ preventScroll: true });
    }
  }

  function update() {
    if (disposed) return;
    const state = daylight.state();
    const minute = Math.min(1439, Math.floor(state.hour * 60 + 1e-7));
    const text = clockTime(minute);
    if (clock.textContent !== text) clock.textContent = text;
    if (panel.hidden) return;
    if (reading.textContent !== text) reading.textContent = text;
    const phase = state.period.replaceAll("-", " ");
    const phaseText = phase.charAt(0).toUpperCase() + phase.slice(1);
    if (period.textContent !== phaseText) period.textContent = phaseText;
    if (!scrubbing && range.value !== String(minute)) range.value = String(minute);
    const rangeText = `${clockTime(Number(range.value))} game time`;
    if (range.getAttribute("aria-valuetext") !== rangeText) range.setAttribute("aria-valuetext", rangeText);
    const pressed = String(state.running);
    if (running.getAttribute("aria-pressed") !== pressed) running.setAttribute("aria-pressed", pressed);
    const runText = state.running ? "Running" : "Frozen";
    if (runningState.textContent !== runText) runningState.textContent = runText;
    if (speed.value !== String(state.cycleMinutes)) speed.value = String(state.cycleMinutes);
    const lightText = `Night lighting: ${Math.round(state.night * 100)}%`;
    if (lights.textContent !== lightText) lights.textContent = lightText;
    for (const preset of presets) {
      const selected = String(minute === Math.round(Number(preset.dataset.timeHour) * 60));
      if (preset.dataset.selected !== selected) preset.dataset.selected = selected;
    }
  }

  listen(toggle, "click", () => setOpen(panel.hidden));
  listen(close, "click", () => setOpen(false, true));
  listen(root, "keydown", (event) => {
    // Keep native range/select/button keys, but never pass them to driving shortcuts.
    event.stopPropagation();
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  // Keyup deliberately bubbles so an accelerator held before opening can release.
  listen(doc, "pointerdown", (event) => {
    if (!panel.hidden && !root.contains(event.target)) setOpen(false, panel.contains(doc.activeElement));
  });
  listen(doc, "click", (event) => {
    if (!panel.hidden && !root.contains(event.target)) setOpen(false, panel.contains(doc.activeElement));
  });
  listen(root, "focusout", (event) => {
    if (event.relatedTarget && !root.contains(event.relatedTarget)) setOpen(false);
  });
  listen(range, "pointerdown", () => { scrubbing = true; });
  listen(doc, "pointerup", () => { scrubbing = false; });
  listen(doc, "pointercancel", () => { scrubbing = false; });
  listen(range, "blur", () => { scrubbing = false; });
  listen(range, "input", () => {
    const minute = Number(range.value);
    if (range.value === "" || !Number.isInteger(minute) || minute < 0 || minute > 1439) return;
    selectedHour = minute / 60;
    daylight.setHour(selectedHour);
    update();
    onChange();
  });
  listen(range, "change", save);
  for (const preset of presets) listen(preset, "click", () => {
    selectedHour = Number(preset.dataset.timeHour);
    daylight.setHour(selectedHour);
    update();
    save();
    onChange();
  });
  listen(running, "click", () => {
    daylight.setRunning(!daylight.state().running);
    update();
    save();
    onChange();
  });
  listen(speed, "change", () => {
    const minutes = Number(speed.value);
    if (!CYCLE_MINUTES.includes(minutes)) return;
    daylight.setCycleMinutes(minutes);
    update();
    save();
    onChange();
  });
  listen(win, "resize", fitPanel);
  if (win.visualViewport) listen(win.visualViewport, "resize", fitPanel);
  listen(win, "blur", () => setOpen(false));
  listen(doc, "visibilitychange", () => { if (doc.hidden) setOpen(false); });

  toggle.disabled = false;
  setOpen(false);
  update();
  if (restored) onChange();
  return {
    update,
    dispose() {
      if (disposed) return;
      setOpen(false, panel.contains(doc.activeElement));
      disposed = true;
      listeners.forEach((remove) => remove());
      toggle.disabled = true;
    },
  };
}
