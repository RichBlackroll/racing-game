export function tabletProfile({
  userAgent = "",
  platform = "",
  maxTouchPoints = 0,
  coarse = false,
}) {
  const ipad =
    /iPad/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  return {
    ipad,
    touch: ipad || coarse || maxTouchPoints > 0,
    tablet: ipad || coarse,
  };
}

export function pixelBudget(width, height, deviceRatio = 1) {
  return Math.min(
    deviceRatio,
    1,
    Math.sqrt(1200000 / Math.max(1, width * height)),
  );
}

// A multi-second window avoids resolution changes on isolated slow frames.
export function adaptiveScale(scale, fps) {
  if (fps < 45) return Math.max(0.65, Math.round((scale - 0.1) * 100) / 100);
  if (fps > 57) return Math.min(1, Math.round((scale + 0.05) * 100) / 100);
  return scale;
}

export function createFrameLimiter(fps = 60) {
  const interval = 1000 / fps;
  let next = null;
  return (now) => {
    // Keep fractional deadlines on 90/144 Hz screens, but never catch up after a stall.
    if (next === null || now - next >= interval) next = now;
    if (now < next - 0.5) return false;
    next += interval;
    return true;
  };
}

export function bindDrivingInput(keys, buttons, win = window, doc = document, enabled = () => true) {
  const keyboard = new Set();
  const pointers = new Map();
  const pad = doc.getElementById?.("steering-pad");
  let steering = 0, steeringPointer = null;
  let padBounds = null, viewportWidth = win.innerWidth;
  function sync() {
    for (const key in keys) keys[key] = false;
    for (const key of keyboard) keys[key] = true;
    for (const { key } of pointers.values()) keys[key] = true;
    keys.steering = -steering;
    for (const button of buttons)
      button.classList.toggle("pressed", Boolean(keys[button.dataset.key]));
    if (pad) {
      padBounds ??= pad.getBoundingClientRect();
      pad.style.setProperty("--steer-x", `${steering * padBounds.width * 0.28}px`);
      pad.classList.toggle("pressed", steeringPointer !== null);
      pad.setAttribute("aria-valuenow", String(Math.round(steering * 100)));
      pad.setAttribute("aria-valuetext", steering === 0 ? "Straight ahead" : `${Math.round(Math.abs(steering) * 100)}% ${steering < 0 ? "left" : "right"}`);
    }
  }
  function layoutChange() {
    const bounds = pad?.getBoundingClientRect();
    const changed = viewportWidth !== win.innerWidth || (padBounds && bounds &&
      ["left", "width", "height"].some((key) => padBounds[key] !== bounds[key]));
    viewportWidth = win.innerWidth;
    padBounds = bounds;
    // Browser chrome often changes only viewport height; captured pedals can stay held.
    if (changed) clear();
  }
  function clear() {
    keyboard.clear();
    const held = [...pointers];
    pointers.clear();
    for (const [id, { button }] of held) {
      if (button.hasPointerCapture?.(id)) button.releasePointerCapture(id);
    }
    const pointer = steeringPointer;
    steeringPointer = null;
    steering = 0;
    if (pointer !== null && pad?.hasPointerCapture(pointer)) pad.releasePointerCapture(pointer);
    sync();
  }
  win.addEventListener("keydown", (event) => {
    if (!enabled()) return;
    if (event.target?.closest?.("select,input,textarea,[role=slider]")) return;
    const key = event.key.toLowerCase();
    // Closing a modal requires a fresh press, not a repeat of a parked pedal.
    if (event.repeat && !keyboard.has(key)) return;
    if (key === ' ' && event.target?.closest?.('button')) return;
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key))
      event.preventDefault();
    keyboard.add(key);
    sync();
  });
  win.addEventListener("keyup", (event) => {
    keyboard.delete(event.key.toLowerCase());
    sync();
  });
  win.addEventListener("blur", clear);
  win.addEventListener("resize", layoutChange);
  win.addEventListener("orientationchange", clear);
  win.screen?.orientation?.addEventListener("change", clear);
  doc.addEventListener("visibilitychange", clear);
  doc.addEventListener("driving-overlay-change", clear);
  win.visualViewport?.addEventListener("resize", layoutChange);
  if (pad) {
    const move = (event) => {
      if (event.pointerId !== steeringPointer) return;
      if (!enabled()) { clear(); return; }
      const bounds = padBounds;
      steering = Math.max(-1, Math.min(1, (event.clientX - bounds.left - bounds.width / 2) / Math.max(1, bounds.width * 0.28)));
      sync();
    };
    const release = (event) => {
      if (event.pointerId !== steeringPointer) return;
      steeringPointer = null;
      steering = 0;
      sync();
    };
    pad.addEventListener("contextmenu", (event) => event.preventDefault());
    pad.addEventListener("pointerdown", (event) => {
      if (!enabled()) return;
      if (steeringPointer !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      padBounds = pad.getBoundingClientRect();
      steeringPointer = event.pointerId;
      pad.setPointerCapture(event.pointerId);
      move(event);
    });
    pad.addEventListener("pointermove", move);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(type, release);
    pad.addEventListener("keydown", (event) => {
      if (!enabled()) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Home") steering = -1;
      else if (event.key === "End") steering = 1;
      else if (event.key === "Escape") steering = 0;
      else steering = Math.max(-1, Math.min(1, Math.round((steering + (["ArrowRight", "ArrowUp"].includes(event.key) ? 0.1 : -0.1)) * 10) / 10));
      sync();
    });
    pad.addEventListener("blur", () => {
      if (steeringPointer !== null) return;
      steering = 0;
      sync();
    });
  }
  for (const button of buttons) {
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("pointerdown", (event) => {
      if (!enabled()) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { key: button.dataset.key, button });
      sync();
    });
    const release = (event) => {
      pointers.delete(event.pointerId);
      sync();
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(type, release);
  }
  return clear;
}
