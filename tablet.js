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
  function sync() {
    for (const key in keys) keys[key] = false;
    for (const key of keyboard) keys[key] = true;
    for (const { key } of pointers.values()) keys[key] = true;
    for (const button of buttons)
      button.classList.toggle("pressed", Boolean(keys[button.dataset.key]));
  }
  function clear() {
    keyboard.clear();
    pointers.clear();
    sync();
  }
  win.addEventListener("keydown", (event) => {
    if (event.target?.closest?.("select,input,textarea")) return;
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
  doc.addEventListener("visibilitychange", clear);
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
