// Configurator panel ("Pimp your ride") — DOM UI + 3D visual application.
// Imports the tuning contract from modifier-data.js and owns only the panel.
import * as THREE from "three";
import { PARTS, PRESETS, DEFAULTS, computeTuning } from "./modifier-data.js";

export function createModifier(opts = {}) {
  const { car, wheels = [], paint, rocket, show } = opts;

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

  // ---- captured wheel baseline (guarded; missing assets never crash) ----
  const wheelInfo = (Array.isArray(wheels) ? wheels : []).map((w) => {
    const info = {
      pivot: w && w.pivot,
      tire: w && w.tire,
      baseY: null,
      radius: null,
      emissive: null,
      emissiveIntensity: null,
    };
    try {
      if (info.pivot) info.baseY = info.pivot.position.y;
    } catch {}
    try {
      if (info.tire && info.tire.geometry) {
        info.tire.geometry.computeBoundingSphere();
        const bs = info.tire.geometry.boundingSphere;
        if (bs && isFinite(bs.radius)) info.radius = bs.radius;
      }
    } catch {}
    try {
      const m = info.tire && info.tire.material;
      if (m && m.emissive) {
        info.emissive = m.emissive.getHex();
        info.emissiveIntensity = m.emissiveIntensity;
      }
    } catch {}
    return info;
  });

  // ---- spoiler group, built once, attached to the car ----
  let spoiler = null;
  try {
    if (car) {
      spoiler = new THREE.Group();
      spoiler.position.set(0, 1.02, -1.55);
      const dark = new THREE.MeshStandardMaterial({
        color: 0x111318,
        metalness: 0.4,
        roughness: 0.5,
      });
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.45), dark);
      spoiler.add(wing);
      for (const x of [-0.92, 0.92]) {
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.34, 0.4),
          dark,
        );
        plate.position.set(x, -0.14, 0);
        spoiler.add(plate);
      }
      spoiler.visible = false;
      car.add(spoiler);
    }
  } catch {
    spoiler = null;
  }

  // ---- visual application (each step guarded; re-applied from scratch) ----
  function applyPaint() {
    try {
      const opt = optionOf("color", config.color);
      if (paint && paint.color && opt && opt.hex) paint.color.set(opt.hex);
    } catch {}
  }
  function applyWheels() {
    const id = config.wheels;
    for (const w of wheelInfo) {
      try {
        if (!w.pivot) continue;
        let liftY = w.baseY;
        if (id === "wide") w.pivot.scale.set(1.12, 1.02, 1.02);
        else if (id === "monster") {
          const s = 1.55;
          w.pivot.scale.setScalar(s);
          if (w.radius != null && w.baseY != null)
            liftY = w.baseY + (s - 1) * w.radius;
        } else w.pivot.scale.setScalar(1);
        if (w.baseY != null) w.pivot.position.y = liftY;
      } catch {}
      try {
        const m = w.tire && w.tire.material;
        if (!m || !m.emissive) continue;
        if (id === "hub") {
          m.emissive.set(0x30f6ff); // electric cyan glow
          m.emissiveIntensity = 0.9;
        } else {
          m.emissive.set(w.emissive != null ? w.emissive : 0x000000);
          m.emissiveIntensity =
            w.emissiveIntensity != null ? w.emissiveIntensity : 1;
        }
      } catch {}
    }
  }
  function applySpoiler() {
    try {
      if (!spoiler) return;
      const id = config.spoiler;
      if (id === "big" || id === "mega") {
        spoiler.visible = true;
        spoiler.scale.setScalar(id === "mega" ? 1.45 : 1);
      } else spoiler.visible = false; // stock
    } catch {}
  }
  function applyRocket() {
    try {
      if (!rocket) return;
      const id = config.rocket;
      if (id === "small" || id === "big") {
        rocket.visible = true;
        rocket.scale.setScalar(id === "big" ? 1.5 : 1);
      } else rocket.visible = false; // none
    } catch {}
  }
  function applyVisuals() {
    applyPaint();
    applyWheels();
    applySpoiler();
    applyRocket();
  }

  // ---- panel DOM ----
  const panel = document.getElementById("modifier");
  const configureBtn = document.getElementById("configure");
  let tabsEl, optionsEl, factEls, chipsEl;

  if (panel) {
    // head: title + presets + close
    const head = el("div", "mod-head");
    head.append(el("div", "mod-title", "PIMP YOUR RIDE"));
    const presetsEl = el("div", "mod-presets");
    for (const preset of PRESETS) {
      const b = el("button", null, `${preset.emoji} ${preset.name}`);
      b.type = "button";
      b.addEventListener("click", () => applyPreset(preset));
      presetsEl.append(b);
    }
    head.append(presetsEl);
    const closeBtn = el("button", "mod-close", "Drive ▶");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => api.close());
    head.append(closeBtn);
    panel.append(head);

    // tabs (one per part)
    tabsEl = el("div", "mod-tabs");
    for (const part of PARTS) {
      const b = el("button", "mod-tab", `${part.emoji} ${part.name}`);
      b.type = "button";
      b.dataset.part = part.id;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        selectedPartId = part.id;
        renderTabs();
        renderOptions();
        renderFact();
      });
      tabsEl.append(b);
    }
    panel.append(tabsEl);

    // options of the selected part
    optionsEl = el("div", "mod-options");
    panel.append(optionsEl);

    // fact card
    const fact = el("div", "mod-fact");
    const factEmoji = el("span", "mod-fact-emoji");
    const factName = el("span", "mod-fact-name");
    const factText = el("p", "mod-fact-text");
    const speakBtn = el("button", "mod-speak", "🔊");
    speakBtn.type = "button";
    speakBtn.setAttribute("aria-label", "Read the fact aloud");
    speakBtn.addEventListener("click", () => {
      if (factText.textContent) speak(factText.textContent);
    });
    fact.append(factEmoji, factName, factText, speakBtn);
    panel.append(fact);
    factEls = { factEmoji, factName, factText };

    // chips (one per part: part emoji + selected option name)
    chipsEl = el("div", "mod-chips");
    panel.append(chipsEl);
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
    optionsEl.textContent = "";
    const part = partById(selectedPartId);
    if (!part) return;
    for (const opt of part.options) {
      const b = el("button", "mod-option");
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      const emoji = el("span", null, opt.emoji);
      const name = el("span", null, opt.name);
      const fact = el("small", "mod-option-fact", opt.fact);
      b.append(emoji, name, fact);
      const selected = config[part.id] === opt.id;
      b.classList.toggle("selected", selected);
      b.setAttribute("aria-pressed", selected ? "true" : "false");
      b.addEventListener("click", () => selectOption(part.id, opt.id));
      optionsEl.append(b);
    }
  }
  function renderFact() {
    if (!factEls) return;
    const opt = optionOf(selectedPartId, config[selectedPartId]);
    factEls.factEmoji.textContent = opt ? opt.emoji : "";
    factEls.factName.textContent = opt ? opt.name : "";
    factEls.factText.textContent = opt ? opt.fact : "";
  }
  function renderChips() {
    if (!chipsEl) return;
    chipsEl.textContent = "";
    for (const part of PARTS) {
      const opt = optionOf(part.id, config[part.id]);
      chipsEl.append(
        el("span", null, `${part.emoji} ${opt ? opt.name : config[part.id]}`),
      );
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
      toast(`${opt.emoji} ${opt.name}`);
      speak(opt.fact);
    }
  }
  function applyPreset(preset) {
    config = { ...DEFAULTS, ...preset.config };
    update();
    toast(`${preset.emoji} ${preset.name}`);
    speak(`${preset.name}! Rawr!`);
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
    open() {
      if (panel) panel.hidden = false;
    },
    close() {
      if (panel) panel.hidden = true;
    },
    toggle() {
      if (panel) panel.hidden = !panel.hidden;
    },
  };

  // ---- wiring ----
  if (configureBtn) configureBtn.addEventListener("click", () => api.toggle());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && api.active) api.close();
  });

  // ---- initial state: apply visuals + tuning, render once, stay closed ----
  update();

  return api;
}
