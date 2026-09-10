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

export function bindDrivingInput(keys, buttons, win = window, doc = document) {
  const keyboard = new Set();
  const pointers = new Map();
  const pad = doc.getElementById?.("steering-pad");
  let steering = 0, steeringPointer = null;
  function sync() {
    for (const key in keys) keys[key] = false;
    for (const key of keyboard) keys[key] = true;
    for (const { key } of pointers.values()) keys[key] = true;
    keys.steering = -steering;
    for (const button of buttons)
      button.classList.toggle("pressed", Boolean(keys[button.dataset.key]));
    if (pad) {
      pad.style.setProperty("--steer-x", `${steering * pad.getBoundingClientRect().width * 0.28}px`);
      pad.classList.toggle("pressed", steeringPointer !== null);
      pad.setAttribute("aria-valuenow", String(Math.round(steering * 100)));
      pad.setAttribute("aria-valuetext", steering === 0 ? "Straight ahead" : `${Math.round(Math.abs(steering) * 100)}% ${steering < 0 ? "left" : "right"}`);
    }
  }
  function clear() {
    keyboard.clear();
    pointers.clear();
    const pointer = steeringPointer;
    steeringPointer = null;
    steering = 0;
    if (pointer !== null && pad?.hasPointerCapture(pointer)) pad.releasePointerCapture(pointer);
    sync();
  }
  win.addEventListener("keydown", (event) => {
    if (event.target?.closest?.("select,input,textarea,[role=slider]")) return;
    const key = event.key.toLowerCase();
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
  win.addEventListener("resize", clear);
  doc.addEventListener("visibilitychange", clear);
  if (pad) {
    const move = (event) => {
      if (event.pointerId !== steeringPointer) return;
      const bounds = pad.getBoundingClientRect();
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
      if (steeringPointer !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      steeringPointer = event.pointerId;
      pad.setPointerCapture(event.pointerId);
      move(event);
    });
    pad.addEventListener("pointermove", move);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(type, release);
    pad.addEventListener("keydown", (event) => {
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
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { key: button.dataset.key });
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
