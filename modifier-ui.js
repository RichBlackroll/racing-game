import { PARTS, PRESETS, DEFAULTS, computeTuning } from "./modifier-data.js";
import { createSession } from "./session.js";
import { VEHICLES, getVehicle } from "./vehicle-data.js";

const LABELS = {
  color: { name: "Paint", title: "Pick a paint", hint: "Tap a colour. Watch your car change!" },
  wheels: { name: "Wheels", title: "Pick your wheels", hint: "Small, wide, or MONSTER-sized?" },
  suspension: { name: "Springs", title: "Low or high?", hint: "Watch the body move above the wheels." },
  engine: { name: "Engine", title: "Choose your power", hint: "Pick an engine, then tap Hear engine to try its sound!" },
  spoiler: { name: "Wing", title: "Pick a wing", hint: "A bigger wing helps with corners." },
  rocket: { name: "Rocket", title: "Pick a booster", hint: "Two on the sides, or one big rocket at the back!" },
};
const SHORT_NAMES = {
  wheels: { standard: "Road", wide: "Wide", monster: "Monster", hub: "4 motors" },
  suspension: { standard: "Comfy", sport: "Low", lift: "High" },
  engine: { four: "4 cylinders", six: "V6", eight: "V8", electric: "Electric" },
  spoiler: { stock: "Small", big: "Big", mega: "Huge!" },
  rocket: { none: "No rocket", small: "Side pair", big: "Big rear" },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const paths = {
    garage: '<path d="M3 10 12 3l9 7v11H3Z"/><path d="M7 21V11h10v10M7 15h10M7 18h10"/>',
    drive: '<path d="m14 6 6 6-6 6M3 12h17"/>',
    undo: '<path d="m8 3-5 5 5 5M3 8h10a7 7 0 0 1 0 14"/>',
    turn: '<path d="M20 9a8 8 0 1 0-1 9M20 3v6h-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    speak: '<path d="M3 9v6h4l5 4V5L7 9ZM16 8a6 6 0 0 1 0 8M19 4a11 11 0 0 1 0 16"/>',
  };
  const node = el("span", "mod-icon");
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
  return node;
}

// Pictures describe the actual parts, so choosing doesn't depend on reading.
function picture(part, option = "standard", hex) {
  const node = el("span", "mod-picture");
  node.setAttribute("aria-hidden", "true");
  if (part === "color") {
    node.className += " mod-swatch";
    node.style.setProperty("--paint", hex || "#e9b354");
    return node;
  }
  let shapes = "";
  if (part === "vehicle") {
    if (option === "byd-atto-1") {
      shapes = '<path d="M9 42V25l7-12 29 1 15 15 12 5v8Z" fill="#b7cf77"/><path d="m14 25 5-9h23l13 13-40 3Z" fill="#e8f3ee"/><path d="m17 15-3 13m17-12 1 15m-20 7 42-5M30 33l1 8M13 29v5m48-4 6 4M38 35h4M20 36h4"/>';
    } else if (option === "volvo-ex40") {
      shapes = '<path d="M8 42V24l9-11h29l11 13 14 4v12Z" fill="#afbcb9"/><path d="m13 25 6-9h25l9 11-24 1-7-3Z" fill="#e8f3ee"/><path d="M15 13h31m-30-3h26M31 16v12m-1 1v11M9 22v12h5m50-2h6m-2-2v6M18 32h4m16 0h4M8 39h63"/>';
    } else if (option === "golf") {
      shapes = '<path d="M8 42V27l4-14h31l12 14h16v15Z" fill="#cf6555"/><path d="m13 26 3-9h25l8 9Z" fill="#e8f3ee"/><path d="M27 17v10m25 2v11M32 31h5M9 35h61M8 29h4v5H8m58-5h5v5h-5"/>';
    } else if (option === "tesla") {
      shapes = '<path d="M7 32 17 28l10-13h23l15 14 8 5v9H7Z" fill="#a9c8d9"/><path d="m22 28 8-10h18l11 10Z" fill="#e8f3ee"/><path d="M39 18v21m-12-7h4m14 0h4"/>';
    } else {
      shapes = '<path d="m8 29 13-2 10-8h11l12 10 15 3 4 7v4H7Z" fill="#e9b354"/><path d="m27 27 7-6h7l8 7Z" fill="#e8f3ee"/><path d="M7 21h14m-10 0 3 8m49 6h7"/>';
    }
    shapes += '<circle cx="21" cy="42" r="7" fill="#35453d"/><circle cx="60" cy="42" r="7" fill="#35453d"/><circle cx="21" cy="42" r="3" fill="#d3ddd0"/><circle cx="60" cy="42" r="3" fill="#d3ddd0"/>';
  } else if (part === "wheels") {
    const wide = option === "wide" || option === "monster";
    const radius = option === "monster" ? 25 : 20;
    const x = wide ? 19 : 26;
    shapes = `<rect x="${x}" y="${28 - radius}" width="${wide ? 40 : 28}" height="${radius * 2}" rx="12" fill="#35453d"/><ellipse cx="${wide ? 49 : 43}" cy="28" rx="13" ry="${radius}" fill="#233a30"/><ellipse cx="${wide ? 49 : 43}" cy="28" rx="8" ry="${radius * 0.65}" fill="${option === "hub" ? "#49dce6" : "#d3ddd0"}"/><path d="M${x + 5} 16h8m-8 12h8m-8 12h8" stroke="#849383"/>`;
    if (option === "hub") shapes += '<path d="m46 15-9 14h9l-7 12" stroke="#fff"/>';
  } else if (part === "suspension") {
    const low = option === "sport", high = option === "lift";
    const y = low ? 17 : high ? 5 : 10, height = 56 - 2 * y;
    let path = `M40 ${y}`;
    for (let i = 1; i <= 7; i++) path += ` L${i % 2 ? 27 : 53} ${y + height * i / 8}`;
    shapes = `<path d="M26 ${y}h28M26 ${56 - y}h28M40 ${y}v${height}" stroke="#728272"/><path d="${path} L40 ${56 - y}" stroke="${low ? "#e89639" : "#578b36"}" stroke-width="5"/>`;
  } else if (part === "engine") {
    if (option === "electric") {
      shapes = '<rect x="14" y="12" width="51" height="36" rx="6" fill="#82dbcb"/><path d="M24 7h10m12 0h10m-27 9-8 13h12l-8 14"/><path d="M51 24v10m-5-5h10"/>';
    } else {
      const count = option === "eight" ? 8 : option === "six" ? 6 : 4;
      shapes = '<rect x="10" y="16" width="60" height="32" rx="6" fill="#c9d5c8"/>';
      for (let i = 0; i < count; i++) {
        const cols = count / 2;
        shapes += `<circle cx="${21 + (i % cols) * (38 / Math.max(1, cols - 1))}" cy="${i < cols ? 20 : 39}" r="7" fill="${count === 8 ? "#f5a846" : count === 6 ? "#b09cd6" : "#7ab6e6"}"/>`;
      }
    }
  } else if (part === "spoiler") {
    const huge = option === "mega", big = option === "big";
    const x = huge ? 7 : big ? 13 : 22, y = huge ? 9 : big ? 16 : 26;
    shapes = `<path d="M29 ${y + 6}v32m22-32v32M19 50h43" stroke="#859284"/><rect x="${x}" y="${y}" width="${80 - x * 2}" height="8" rx="2" fill="#34513e"/><path d="M${x} ${y - 5}v18m${80 - x * 2} -18v18" stroke="#79a345"/>`;
    if (huge) shapes += '<rect x="11" y="25" width="58" height="6" rx="2" fill="#34513e"/>';
  } else if (part === "rocket") {
    shapes = '<path d="M24 18 14 12v30l10-6" fill="#849585"/><rect x="24" y="14" width="31" height="28" rx="6" fill="#b8c7bd"/><path d="m55 14 15 14-15 14Z" fill="#dc8855"/><circle cx="40" cy="28" r="6" fill="#daece7"/>';
    if (option === "none") shapes = '<circle cx="40" cy="28" r="22" stroke="#a0aaa0"/><path d="m25 43 30-30" stroke="#c46446" stroke-width="5"/>';
    else if (option === "small") shapes = `<g transform="translate(16 0) scale(.58)">${shapes}</g><g transform="translate(16 25) scale(.58)">${shapes}</g>`;
  }
  node.innerHTML = `<svg viewBox="0 0 80 56" fill="none" stroke="#254b37" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
  return node;
}

export function createModifier({ visuals, onVehicleChange, show, preview, audio, session = createSession(), onOpenChange, canOpen = () => true }) {
  const panel = document.getElementById("modifier");
  const configure = document.getElementById("configure");
  const saved = session.value;
  let vehicle = getVehicle(saved?.vehicle), vehicleRequest = null;
  let config = { ...DEFAULTS, engine: vehicle.engine };
  for (const part of PARTS) {
    if (part.options.some((option) => option.id === saved?.config?.[part.id])) config[part.id] = saved.config[part.id];
  }
  let selectedPart = PARTS.some((part) => part.id === saved?.selectedPart) ? saved.selectedPart : "color";
  let tuning = computeTuning(config), opened = false, returnFocus = null, playbackRequest = 0;
  const history = [];
  const optionOf = () => PARTS.find((p) => p.id === selectedPart).options.find((o) => o.id === config[selectedPart]);

  const shell = el("div", "mod-shell");
  const head = el("div", "mod-head");
  const brand = el("div", "mod-brand");
  const wordmark = el("div");
  wordmark.append(el("small", "mod-eyebrow", "ELIOS' WORKSHOP"));
  const title = el("h2", "mod-title", "My garage");
  title.id = "mod-title";
  title.tabIndex = -1;
  wordmark.append(title);
  brand.append(icon("garage"), wordmark);
  const actions = el("div", "mod-head-actions");
  const undo = el("button", "mod-undo");
  undo.type = "button";
  undo.setAttribute("aria-label", "Undo last change");
  undo.append(icon("undo"), el("span", null, "Undo"));
  undo.disabled = true;
  const drive = el("button", "mod-close");
  drive.type = "button";
  drive.append(el("span", null, "Let's drive"), icon("drive"));
  actions.append(undo, drive);
  head.append(brand, actions);

  const stage = el("div", "mod-stage");
  const viewport = el("div", "mod-viewport");
  viewport.id = "mod-viewport";
  viewport.setAttribute("role", "img");
  const stageLabel = el("div", "mod-stage-label", "YOUR CAR. YOUR IDEAS.");
  const feedback = el("div", "mod-feedback");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  const tools = el("div", "mod-preview-tools");
  const turn = el("button", "mod-turn");
  turn.type = "button";
  turn.append(icon("turn"), el("span", null, "Turn car"));
  tools.append(el("span", "mod-drag-hint", "Swipe to look around"), turn);
  stage.append(viewport, stageLabel, feedback, tools);

  const tabs = el("nav", "mod-tabs");
  tabs.setAttribute("aria-label", "Car parts");
  for (const part of PARTS) {
    const button = el("button", "mod-tab");
    button.type = "button";
    button.dataset.part = part.id;
    button.setAttribute("aria-controls", "mod-options");
    button.append(picture(part.id, part.id === "engine" ? "eight" : "standard"), el("span", null, LABELS[part.id].name));
    button.addEventListener("click", () => {
      if (vehicleRequest) return;
      stopAudio();
      selectedPart = part.id;
      session.update({ selectedPart });
      renderOptions();
      renderSelection();
      bench.scrollTop = choiceHead.offsetTop;
      preview?.focus(selectedPart);
    });
    tabs.append(button);
  }

  const bench = el("section", "mod-workbench");
  bench.setAttribute("aria-label", "Car and parts");
  const vehiclePicker = el("section", "mod-vehicle-picker");
  vehiclePicker.setAttribute("aria-labelledby", "mod-vehicles-title");
  const vehicleTitle = el("h3", "mod-choice-title", "Choose your car");
  vehicleTitle.id = "mod-vehicles-title";
  const vehicles = el("div", "mod-vehicles");
  for (const choice of VEHICLES) {
    const button = el("button", "mod-vehicle");
    button.type = "button";
    button.dataset.vehicle = choice.id;
    button.setAttribute("aria-label", choice.name);
    const copy = el("span", "mod-vehicle-copy");
    copy.append(el("strong", "mod-vehicle-name", choice.name), el("small", "mod-vehicle-description", choice.description));
    const check = el("span", "mod-check");
    check.append(icon("check"));
    button.append(picture("vehicle", choice.id), copy, check);
    button.addEventListener("click", () => changeVehicle(choice));
    vehicles.append(button);
  }
  vehiclePicker.append(vehicleTitle, vehicles);
  const choiceHead = el("div", "mod-choice-head");
  const choiceTitle = el("h3", "mod-choice-title");
  choiceTitle.id = "mod-options-title";
  const choiceHint = el("p", "mod-choice-hint");
  choiceHead.append(choiceTitle, choiceHint);
  const options = el("div", "mod-options");
  options.id = "mod-options";
  options.setAttribute("role", "group");
  options.setAttribute("aria-labelledby", "mod-options-title");
  const engineListen = el("button", "mod-engine-listen");
  engineListen.type = "button";
  engineListen.append(icon("speak"), el("span", null, "Hear engine"));
  const fact = el("div", "mod-fact");
  const factCopy = el("div", "mod-fact-copy");
  const factName = el("strong", "mod-fact-name");
  const factText = el("p", "mod-fact-text");
  factCopy.append(factName, factText);
  const listen = el("button", "mod-speak");
  listen.type = "button";
  listen.append(icon("speak"), el("span", null, "Read fact"));
  fact.append(factCopy, listen);
  const builds = el("details", "mod-builds");
  builds.append(el("summary", null, "Try a parts setup"));
  const presets = el("div", "mod-presets");
  for (const preset of PRESETS) {
    const button = el("button", "mod-preset", preset.name);
    button.type = "button";
    button.dataset.preset = preset.id;
    button.addEventListener("click", () => {
      change({ ...DEFAULTS, color: config.color, ...preset.config }, preset.id === "monster" ? "wheels" : "engine", `${preset.name} ready!`);
    });
    presets.append(button);
  }
  builds.append(presets);
  bench.append(vehiclePicker, choiceHead, options, engineListen, fact, builds);
  shell.append(head, stage, tabs, bench);
  panel.replaceChildren(shell);

  function renderOptions() {
    const part = PARTS.find((p) => p.id === selectedPart);
    choiceTitle.textContent = LABELS[selectedPart].title;
    choiceHint.textContent = LABELS[selectedPart].hint;
    engineListen.hidden = selectedPart !== "engine";
    options.dataset.part = selectedPart;
    options.style.setProperty("--option-count", Math.min(4, part.options.length));
    options.replaceChildren();
    for (const option of part.options) {
      const button = el("button", "mod-option");
      button.type = "button";
      button.dataset.part = part.id;
      button.dataset.option = option.id;
      button.setAttribute("aria-label", option.name);
      const check = el("span", "mod-check");
      check.append(icon("check"));
      button.append(picture(selectedPart, option.id, option.hex), el("span", "mod-option-name", SHORT_NAMES[selectedPart]?.[option.id] || option.name), check);
      button.addEventListener("click", () => change({ ...config, [part.id]: option.id }, part.id, `${option.name} fitted!`));
      options.append(button);
    }
  }

  function renderSelection() {
    const loading = vehicleRequest !== null;
    vehiclePicker.setAttribute("aria-busy", String(loading));
    viewport.setAttribute("aria-label", `${vehicle.name} in the garage. Swipe to look around.`);
    for (const button of vehicles.children) {
      const selected = button.dataset.vehicle === vehicle.id;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = loading;
    }
    for (const tab of tabs.children) {
      const selected = tab.dataset.part === selectedPart;
      tab.classList.toggle("selected", selected);
      tab.setAttribute("aria-pressed", String(selected));
      tab.disabled = loading;
    }
    for (const button of options.children) {
      const selected = button.dataset.option === config[selectedPart];
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = loading;
    }
    for (const button of [...presets.children, engineListen, listen]) button.disabled = loading;
    const option = optionOf();
    factName.textContent = option.name;
    factText.textContent = option.fact;
    listen.setAttribute("aria-label", `Read fact about ${option.name}`);
    if (selectedPart === "engine") engineListen.setAttribute("aria-label", `Hear engine: ${option.name}`);
    undo.disabled = loading || history.length === 0;
  }

  async function changeVehicle(nextVehicle) {
    if (!opened || !panel.open || vehicleRequest || nextVehicle.id === vehicle.id) return;
    const request = new AbortController();
    vehicleRequest = request;
    const nextConfig = { ...config, engine: nextVehicle.engine };
    stopAudio();
    renderSelection();
    feedback.textContent = `Loading ${nextVehicle.name}...`;
    try {
      const nextVisuals = await onVehicleChange(nextVehicle.id, nextConfig, request.signal);
      if (vehicleRequest !== request || request.signal.aborted || !opened || !panel.open) return;
      visuals = nextVisuals;
      vehicle = nextVehicle;
      config = nextConfig;
      tuning = computeTuning(config);
      history.length = 0;
      session.update({ vehicle: vehicle.id, config: { ...config }, selectedPart });
      renderOptions();
      preview?.focus(selectedPart);
      const message = `${vehicle.name} ready!`;
      feedback.replaceChildren(icon("check"), el("span", null, message));
      show?.(message);
    } catch {
      if (vehicleRequest === request && !request.signal.aborted && opened && panel.open) {
        feedback.textContent = `Could not load ${nextVehicle.name}. Your car is unchanged. Tap its car button again to retry.`;
      }
    } finally {
      if (vehicleRequest === request) {
        vehicleRequest = null;
        renderSelection();
      }
    }
  }

  function change(next, part, message, remember = true) {
    if (vehicleRequest) return;
    stopAudio();
    const changed = PARTS.some((p) => config[p.id] !== next[p.id]);
    if (remember && changed) {
      history.push({ config: { ...config }, part: selectedPart });
      if (history.length > 20) history.shift();
    }
    const differentPart = selectedPart !== part;
    selectedPart = part;
    config = { ...next };
    session.update({ config: { ...config }, selectedPart });
    tuning = computeTuning(config);
    visuals.apply(config);
    if (differentPart) renderOptions();
    renderSelection();
    preview?.focus(part);
    feedback.replaceChildren(icon("check"), el("span", null, message));
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      feedback.animate?.([{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 220 });
    }
    show?.(message);
  }

  function stopAudio() {
    playbackRequest++;
    audio?.silence();
    try { window.speechSynthesis?.cancel?.(); } catch { /* Speech must not block editing or closing. */ }
    feedback.replaceChildren();
  }

  function playbackFailed(request, message) {
    if (opened && panel.open && request === playbackRequest) feedback.textContent = message;
  }

  function overlayChanged(active) {
    document.dispatchEvent(new CustomEvent("driving-overlay-change", { bubbles: true, detail: { overlay: "modifier", active } }));
  }
  function finishClose() {
    if (!opened) return;
    opened = false;
    vehicleRequest?.abort();
    vehicleRequest = null;
    renderSelection();
    stopAudio();
    preview?.close();
    document.body.classList.toggle("configuring", false);
    configure.setAttribute("aria-expanded", "false");
    onOpenChange?.(false);
    overlayChanged(false);
    const fallback = document.body.classList.contains("compact-ui") ? document.getElementById("drive-menu-toggle") : configure;
    const target = returnFocus?.isConnected && returnFocus !== document.body && returnFocus.getClientRects().length ? returnFocus : fallback;
    target.focus({ preventScroll: true });
    returnFocus = null;
  }

  const api = {
    get active() { return panel.open; },
    get config() { return config; },
    get tuning() { return tuning; },
    get visuals() { return visuals.state(); },
    open() {
      if (panel.open || !canOpen()) return;
      if (opened) finishClose();
      returnFocus = document.activeElement;
      panel.showModal();
      opened = true;
      bench.scrollTop = 0;
      document.body.classList.toggle("configuring", true);
      configure.setAttribute("aria-expanded", "true");
      feedback.replaceChildren();
      onOpenChange?.(true);
      preview?.open(viewport, selectedPart);
      overlayChanged(true);
      title.focus({ preventScroll: true });
    },
    close() {
      if (panel.open) panel.close();
      finishClose();
    },
    toggle() { if (panel.open) api.close(); else api.open(); },
  };

  undo.addEventListener("click", () => {
    if (vehicleRequest) return;
    const previous = history.pop();
    if (previous) change(previous.config, previous.part, "Back to your last idea!", false);
  });
  engineListen.addEventListener("click", async () => {
    if (!opened || !panel.open || vehicleRequest || selectedPart !== "engine") return;
    stopAudio();
    const request = playbackRequest;
    try {
      // Start in this click, before yielding, so browsers can unlock audio.
      if (await audio?.preview(config.engine)) return;
    } catch { /* Rejections and unavailable audio use the same feedback. */ }
    playbackFailed(request, "Engine sound could not play. Try Hear engine again or check your browser's sound settings.");
  });
  listen.addEventListener("click", () => {
    if (!opened || !panel.open || vehicleRequest) return;
    stopAudio();
    const request = playbackRequest;
    const message = "Could not read this fact aloud. Try Read fact again or read the text below.";
    try {
      const synth = window.speechSynthesis, Utterance = window.SpeechSynthesisUtterance;
      if (typeof synth?.speak !== "function" || typeof Utterance !== "function") {
        playbackFailed(request, "Reading aloud is unavailable in this browser. You can read the fact below.");
        return;
      }
      const speech = new Utterance(`${optionOf().name}. ${optionOf().fact}`);
      speech.lang = "en-GB";
      speech.rate = 0.88;
      speech.onerror = (event) => {
        if (event.error !== "canceled" && event.error !== "interrupted") playbackFailed(request, message);
      };
      synth.speak(speech);
    } catch { playbackFailed(request, message); }
  });
  turn.addEventListener("click", () => preview?.turn());
  drive.addEventListener("click", () => api.close());
  configure.addEventListener("click", () => api.open());
  panel.addEventListener("cancel", (event) => { event.preventDefault(); api.close(); });
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const stops = [...panel.querySelectorAll("button:not(:disabled), summary")].filter((node) =>
      node.getClientRects().length && (node.tagName === "SUMMARY" || !node.closest("details:not([open])")),
    );
    const index = stops.indexOf(document.activeElement);
    if ((event.shiftKey && index <= 0) || (!event.shiftKey && (index < 0 || index === stops.length - 1))) {
      event.preventDefault();
      stops[event.shiftKey ? stops.length - 1 : 0]?.focus({ preventScroll: true });
    }
  });
  // A queued close event must not tear down a newly reopened garage.
  panel.addEventListener("close", () => { if (!panel.open) finishClose(); });
  configure.setAttribute("aria-expanded", "false");
  visuals.apply(config);
  renderOptions();
  renderSelection();
  return api;
}
