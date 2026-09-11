export function createMobileUI({ onOpenChange, doc = document, win = window }) {
  const get = (id) => doc.getElementById(id);
  const toolbar = get("mobile-toolbar"), toggle = get("drive-menu-toggle");
  const dialog = get("drive-menu"), close = get("drive-menu-close");
  const tools = get("drive-menu-tools"), route = get("drive-menu-route");
  const nav = doc.querySelector(".top"), pause = get("pause");
  const map = doc.querySelector(".map-card"), credits = doc.querySelector(".credits");
  const compact = win.matchMedia(doc.body.classList.contains("touch-device") ? "all" : "(max-width: 900px), (max-height: 600px)");
  // Move the live controls, rather than duplicating their state and event handlers.
  const origins = new Map([pause, nav, map, credits].map((node) => {
    const marker = doc.createComment("mobile UI return position");
    node.before(marker);
    return [node, marker];
  }));
  let opened = false;
  const restore = (node) => origins.get(node).after(node);

  function finishClose() {
    if (!opened) return;
    opened = false;
    route.open = false;
    toggle.setAttribute("aria-expanded", "false");
    onOpenChange(false);
    // Also gives the garage a visible focus-return target when switching dialogs.
    toggle.focus({ preventScroll: true });
  }
  function dismiss() {
    if (dialog.open) dialog.close();
    finishClose();
  }
  function layout() {
    dismiss();
    doc.body.classList.toggle("compact-ui", compact.matches);
    toolbar.hidden = !compact.matches;
    if (compact.matches) {
      toolbar.append(pause);
      tools.append(nav);
      route.append(map);
      get("drive-menu-footer").append(credits);
    } else {
      for (const node of [pause, nav, map, credits]) restore(node);
      if (doc.activeElement === toggle) pause.focus({ preventScroll: true });
    }
  }
  toggle.addEventListener("click", () => {
    if (!compact.matches || opened) return;
    get("time-close").click();
    dialog.showModal();
    dialog.scrollTop = 0;
    opened = true;
    toggle.setAttribute("aria-expanded", "true");
    onOpenChange(true);
  });
  close.addEventListener("click", dismiss);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); dismiss(); });
  dialog.addEventListener("close", () => { if (!dialog.open) finishClose(); });
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  dialog.addEventListener("click", (event) => {
    // Close before existing launch/garage handlers run; never stack modal dialogs.
    if (event.target.closest("#home, #configure, #camera, #reset")) dismiss();
  }, true);
  compact.addEventListener("change", layout);
  layout();
  return {
    get active() { return opened; },
    get mapVisible() { return !compact.matches || (opened && route.open); },
  };
}
