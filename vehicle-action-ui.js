const icons = {
  dig: '<path d="m14 39 13-25 9 4 9 22" stroke="currentColor" stroke-width="7"/><circle cx="29" cy="16" r="4" fill="#fff2c5"/><path d="m35 37 19-5v15c-9 9-19 7-25-2Z" fill="currentColor" stroke="#805e36" stroke-width="2"/><path d="M9 54h46m-40-7 5 2m34-29 3 5" stroke="currentColor" stroke-width="3"/>',
  delivery: '<path d="m10 22 22-11 22 11v27L32 59 10 49Z" fill="currentColor" stroke="#805e36" stroke-width="2"/><path d="m10 22 22 11 22-11M32 33v26M22 16l22 11v11l-9 4V31" stroke="#805e36" stroke-width="2.5"/><path d="M6 9h15M3 15h9m4 28 8 4" stroke="currentColor" stroke-width="3"/>',
  sprint: '<path d="m36 6-24 29h17l-3 23 27-32H36l5-20Z" fill="currentColor" stroke="#805e36" stroke-width="2"/><path d="M7 15h13M4 45h11" stroke="currentColor" stroke-width="3"/>',
  pulse: '<circle cx="32" cy="32" r="7" fill="currentColor"/><path d="M21 17a19 19 0 0 0 0 30m22-30a19 19 0 0 1 0 30M14 8a30 30 0 0 0 0 48M50 8a30 30 0 0 1 0 48" stroke="currentColor" stroke-width="4"/>',
  hop: '<path d="M17 39c0-29 30-29 30 0m-8-7 8 8 8-8" stroke="currentColor" stroke-width="4"/><path d="M9 52h46m-39-7h7m19 0h7" stroke="currentColor" stroke-width="3"/><path d="m12 35 7-3 6 5v7H12Z" fill="currentColor"/>',
  bubbles: '<circle cx="25" cy="38" r="17" fill="currentColor" fill-opacity=".35" stroke="currentColor" stroke-width="3"/><circle cx="46" cy="17" r="10" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="3"/><circle cx="48" cy="48" r="6" fill="currentColor"/><path d="M16 36c0-5 3-8 7-9m18-11 3-3" stroke="#e8f9f2" stroke-width="3"/>',
  beacon: '<path d="M17 45V31a15 15 0 0 1 30 0v14" fill="currentColor" stroke="#805e36" stroke-width="2"/><rect x="12" y="45" width="40" height="9" rx="3" fill="currentColor"/><path d="M32 5v6M9 16l5 5m41-5-5 5M24 33v7" stroke="currentColor" stroke-width="4"/>',
};

export function createVehicleActionUI({ activate, enabled, doc = document, win = window }) {
  const slot = doc.getElementById("vehicle-action-slot"), button = doc.getElementById("vehicle-action");
  const icon = doc.getElementById("vehicle-action-icon"), label = doc.getElementById("vehicle-action-label");
  const stateText = doc.getElementById("vehicle-action-state"), hint = doc.getElementById("vehicle-action-hint");
  const status = doc.getElementById("vehicle-action-status");
  let available = false, shown, announcement;
  function use() {
    // Overlay changes must take effect before the next frame updates disabled.
    if (available && enabled()) activate();
  }
  button.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    // Preserve held steering/pedal focus, including additional touch pointers.
    event.preventDefault();
    use();
  });
  button.addEventListener("click", event => { if (event.detail === 0) use(); });
  button.addEventListener("contextmenu", event => event.preventDefault());
  win.addEventListener("keydown", event => {
    if (event.key?.toLowerCase() !== "e" || event.repeat || event.altKey || event.ctrlKey || event.metaKey
      || event.target?.isContentEditable
      || event.target?.closest?.('input,select,textarea,[role=slider],[contenteditable]:not([contenteditable="false"])')) return;
    if (!available || !enabled()) return;
    event.preventDefault();
    use();
  });
  return {
    update(state) {
      const { id, label: actionLabel, description, active, remaining, cooldown, blocked } = state;
      const mode = active ? "working" : blocked ? "blocked" : cooldown > 0 ? "cooldown" : "ready";
      available = !!id && mode === "ready";
      const live = enabled();
      button.disabled = !live || !available;
      slot.hidden = !id;
      slot.dataset.state = mode;
      if (shown !== id) {
        shown = id;
        icon.innerHTML = Object.hasOwn(icons, id) ? icons[id] : icons.beacon;
      }
      const text = active ? `Working${remaining > 0 ? ` ${Math.ceil(remaining)}s` : ""}`
        : blocked || (cooldown > 0 ? `${Math.ceil(cooldown)}s` : "Ready");
      if (label.textContent !== actionLabel) label.textContent = actionLabel;
      if (hint.textContent !== description) hint.textContent = description;
      if (stateText.textContent !== text) stateText.textContent = text;
      const accessible = `${actionLabel}. ${text}. Special action: press E or tap.`;
      if (button.getAttribute("aria-label") !== accessible) button.setAttribute("aria-label", accessible);
      const title = `${description} (${actionLabel}: E). ${text}`;
      if (button.title !== title) button.title = title;
      // Announce transitions, not countdown ticks, and stay quiet behind overlays.
      const message = `${actionLabel}. ${active ? "Working." : blocked ? `${blocked}.`
        : cooldown > 0 ? "Cooling down." : "Ready. Press E or tap."}`;
      if (live && id && message !== announcement) {
        announcement = message;
        status.textContent = message;
      }
    },
  };
}
