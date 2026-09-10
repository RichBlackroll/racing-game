// Vehicle studio panel: DOM UI + 3D visual application.
// Imports the tuning contract from modifier-data.js and owns only the panel.
import { createModifierCar } from "./modifier-car.js";
import { PARTS, PRESETS, DEFAULTS, computeTuning } from "./modifier-data.js";

export function createModifier(opts = {}) {
  const { car, wheels = [], paint, rocket, show, preview, onOpenChange } = opts;
  const visuals = createModifierCar({ car, wheels, paint, rocket });

  // ---- tiny DOM helper (textContent only; no user data in innerHTML) ----
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const toast = (msg) => {
    if (typeof show === "function") show(msg);
  };

  // ---- speech (never throws) ----
  function speak(text) {
    try {
      if (!("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.rate = 0.95;
      speechSynthesis.speak(u);
    } catch {
      /* speech unavailable — stay quiet */
    }
  }

  // ---- data lookups ----
  const partById = (id) => PARTS.find((p) => p.id === id);
  const optionOf = (partId, optionId) =>
    partById(partId)?.options.find((o) => o.id === optionId);

  // ---- state ----
  let config = { ...DEFAULTS };
  let tuning = computeTuning(config);
  let selectedPartId = PARTS[0] ? PARTS[0].id : null;

  function applyVisuals() {
    visuals.apply(config);
    preview?.focus(selectedPartId);
  }

  // ---- panel DOM ----
  const panel = document.getElementById("modifier");
  const configureBtn = document.getElementById("configure");
  let tabsEl, optionsEl, optionsTitle, factEls, chipsEl, title, presetsEl;
  let previewHost;
  let returnFocus = null;

  if (panel) {
    if (preview) {
      previewHost = el("section", "mod-preview");
      previewHost.hidden = panel.hidden;
      previewHost.setAttribute("aria-label", "Live vehicle preview");
      const hint = el("p", "mod-preview-hint", "Drag to look around");
      const turn = el("button", "mod-turn", "Turn car");
      turn.type = "button";
      turn.addEventListener("click", () => preview.turn());
      previewHost.append(hint, turn);
      panel.before(previewHost);
    }
    panel.setAttribute("aria-labelledby", "mod-title");
    // Keep the aside non-modal so the vehicle remains available for inspection.
    const head = el("div", "mod-head");
    const heading = el("div", "mod-heading");
    title = el("h2", "mod-title", "Your garage");
    title.id = "mod-title";
    title.tabIndex = -1;
    heading.append(el("p", "mod-eyebrow", "VEHICLE STUDIO"), title);
    head.append(heading);
    const closeBtn = el("button", "mod-close", "Drive");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => api.close());
    head.append(closeBtn);
    panel.append(head);

    const presetSection = el("div", "mod-preset-section");
    const presetTitle = el("h3", "mod-section-title", "Starting points");
    presetTitle.id = "mod-preset-title";
    presetsEl = el("div", "mod-presets");
    presetsEl.setAttribute("role", "group");
    presetsEl.setAttribute("aria-labelledby", presetTitle.id);
    for (const preset of PRESETS) {
      const b = el("button", "mod-preset", preset.name);
      b.type = "button";
      b.dataset.preset = preset.id;
      b.addEventListener("click", () => applyPreset(preset));
      presetsEl.append(b);
    }
    presetSection.append(presetTitle, presetsEl);
    panel.append(presetSection);

    // tabs (one per part)
    tabsEl = el("div", "mod-tabs");
    tabsEl.setAttribute("role", "group");
    tabsEl.setAttribute("aria-label", "Vehicle components");
    for (const part of PARTS) {
      const b = el("button", "mod-tab", part.name);
      b.type = "button";
      b.dataset.part = part.id;
      b.setAttribute("aria-controls", "mod-options");
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        selectedPartId = part.id;
        renderTabs();
        renderOptions();
        renderFact();
        preview?.focus(selectedPartId);
      });
      tabsEl.append(b);
    }
    panel.append(tabsEl);

    // options of the selected part
    const optionsSection = el("section", "mod-options-section");
    optionsTitle = el("h3", "mod-section-title");
    optionsTitle.id = "mod-options-title";
    optionsEl = el("div", "mod-options");
    optionsEl.id = "mod-options";
    optionsEl.setAttribute("role", "group");
    optionsEl.setAttribute("aria-labelledby", optionsTitle.id);
    optionsSection.append(optionsTitle, optionsEl);
    panel.append(optionsSection);

    // fact card
    const fact = el("div", "mod-fact");
    const factName = el("span", "mod-fact-name");
    const factText = el("p", "mod-fact-text");
    const speakBtn = el("button", "mod-speak", "Listen");
    speakBtn.type = "button";
    speakBtn.setAttribute("aria-label", "Listen to the selected option's description");
    speakBtn.addEventListener("click", () => {
      if (factText.textContent) speak(factText.textContent);
    });
    fact.append(factName, factText, speakBtn);
    panel.append(fact);
    factEls = { factName, factText };

    const summary = el("section", "mod-summary");
    summary.append(el("h3", "mod-section-title", "Your specification"));
    chipsEl = el("dl", "mod-chips");
    summary.append(chipsEl);
    panel.append(summary);
  }

  // ---- renderers ----
  function renderTabs() {
    if (!tabsEl) return;
    for (const b of tabsEl.children) {
      const selected = b.dataset.part === selectedPartId;
      b.classList.toggle("selected", selected);
      b.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }
  function renderOptions() {
    if (!optionsEl) return;
    const focused = optionsEl.contains(document.activeElement)
      ? document.activeElement.dataset
      : null;
    optionsEl.textContent = "";
    const part = partById(selectedPartId);
    if (!part) return;
    optionsTitle.textContent = `${part.name} / ${String(part.options.length).padStart(2, "0")} options`;
    let focusTarget;
    for (const [index, opt] of part.options.entries()) {
      const b = el("button", "mod-option");
      b.type = "button";
      b.dataset.part = part.id;
      b.dataset.option = opt.id;
      const marker = el("span", opt.hex ? "mod-option-swatch" : "mod-option-index");
      marker.setAttribute("aria-hidden", "true");
      if (opt.hex) marker.style.setProperty("--mod-paint", opt.hex);
      else marker.textContent = String(index + 1).padStart(2, "0");
      const name = el("span", "mod-option-name", opt.name);
      const fact = el("small", "mod-option-fact", opt.fact);
      b.append(marker, name, fact);
      const selected = config[part.id] === opt.id;
      b.classList.toggle("selected", selected);
      b.setAttribute("aria-pressed", selected ? "true" : "false");
      b.addEventListener("click", () => selectOption(part.id, opt.id));
      optionsEl.append(b);
      if (focused?.part === part.id && focused.option === opt.id) focusTarget = b;
    }
    if (focused) {
      (focusTarget || optionsEl.querySelector(".selected") || optionsEl.firstElementChild)
        ?.focus({ preventScroll: true });
    }
  }
  function renderFact() {
    if (!factEls) return;
    const opt = optionOf(selectedPartId, config[selectedPartId]);
    factEls.factName.textContent = opt ? opt.name : "";
    factEls.factText.textContent = opt ? opt.fact : "";
  }
  function renderChips() {
    if (!chipsEl) return;
    chipsEl.textContent = "";
    for (const part of PARTS) {
      const opt = optionOf(part.id, config[part.id]);
      const chip = el("div", "mod-chip");
      chip.append(
        el("dt", "mod-chip-label", part.name),
        el("dd", "mod-chip-name", opt ? opt.name : config[part.id]),
      );
      chipsEl.append(chip);
    }
    for (const b of presetsEl?.children || []) {
      const preset = PRESETS.find((p) => p.id === b.dataset.preset);
      const presetConfig = { ...DEFAULTS, ...preset.config };
      const selected = PARTS.every((part) => config[part.id] === presetConfig[part.id]);
      b.setAttribute("aria-pressed", String(selected));
    }
  }

  // ---- state updates ----
  function update() {
    tuning = computeTuning(config);
    applyVisuals();
    renderTabs();
    renderOptions();
    renderFact();
    renderChips();
  }
  function selectOption(partId, optionId) {
    config = { ...config, [partId]: optionId };
    tuning = computeTuning(config);
    applyVisuals();
    renderOptions();
    renderFact();
    renderChips();
    const opt = optionOf(partId, optionId);
    if (opt) {
      toast(opt.name);
      if (document.getElementById("friend-voice")?.getAttribute("aria-pressed") === "true")
        speak(opt.fact);
    }
  }
  function applyPreset(preset) {
    config = { ...DEFAULTS, ...preset.config };
    update();
    toast(preset.name);
    if (document.getElementById("friend-voice")?.getAttribute("aria-pressed") === "true")
      speak(`${preset.name} selected.`);
  }

  function setOpen(open) {
    if (!panel || open === !panel.hidden) return;
    if (open) returnFocus = document.activeElement;
    panel.hidden = !open;
    document.body.classList.toggle("configuring", open);
    configureBtn?.setAttribute("aria-expanded", String(open));
    if (previewHost) {
      previewHost.hidden = !open;
      if (!open) preview.close();
    }
    onOpenChange?.(open);
    if (open && previewHost) preview.open(previewHost, selectedPartId);
    // Bubble to both document and window input listeners.
    document.dispatchEvent(new CustomEvent("driving-overlay-change", {
      bubbles: true,
      detail: { overlay: "modifier", active: open },
    }));
    if (open) title?.focus({ preventScroll: true });
    else {
      const target = returnFocus?.isConnected && returnFocus !== document.body
        ? returnFocus
        : configureBtn;
      target?.focus({ preventScroll: true });
      returnFocus = null;
    }
  }

  // ---- public API ----
  const api = {
    get active() {
      return panel ? !panel.hidden : false;
    },
    get config() {
      return config;
    },
    get tuning() {
      return tuning;
    },
    get visuals() {
      return visuals.state();
    },
    open() {
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    toggle() {
      if (panel) setOpen(panel.hidden);
    },
  };

  // ---- wiring ----
  if (configureBtn) {
    configureBtn.setAttribute("aria-controls", "modifier");
    configureBtn.setAttribute("aria-expanded", String(api.active));
    configureBtn.addEventListener("click", () => api.toggle());
  }
  document.body.classList.toggle("configuring", api.active);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && api.active) api.close();
  });

  // ---- initial state: apply visuals + tuning, render once, stay closed ----
  update();

  return api;
}
