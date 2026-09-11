import { ITEMS } from "./item-system.js";

const icons = {
  gift: '<path d="M5 11h22v17H5zM3 7h26v6H3zM16 7v21M16 7C6 8 7 0 12 3l4 4Zm0 0c10 1 9-7 4-4l-4 4Z"/>',
  banana: '<path d="M17 4c-1 9-5 13-13 17 5 5 10 2 13-3 2 7 7 8 12 5-8-4-10-10-10-19Z"/><path d="m17 4 2-2M17 18l-5 10"/>',
  oil: '<path d="M18 3s-6 6-6 10a6 6 0 0 0 12 0c0-4-6-10-6-10Z"/><path d="M8 18c-8 1-7 10 2 10h12c10 0 10-7 4-8M8 24h7"/>',
  mine: '<ellipse cx="16" cy="23" rx="11" ry="5"/><path d="M5 23v-5c0-6 22-6 22 0v5M16 3v5M4 7l4 4M28 7l-4 4m-9 7 1-3 1 3 3 1-3 1-1 3-1-3-3-1Z"/>',
  rocket: '<path d="M12 21C9 14 17 4 27 4c0 10-10 18-17 15Zm0-6H6l-3 8 7-1m7-2v6l-8 3 1-7"/><circle cx="21" cy="10" r="3"/><path d="m7 25-3 3"/>',
  homing: '<path d="M13 21C10 14 18 4 28 4c0 10-10 18-17 15Zm0-6H7l-3 8 7-1m7-2v6l-8 3 1-7"/><path d="M20 9v2m4-2v2M3 3v6h6M3 9l6-6"/>',
  ball: '<circle cx="16" cy="15" r="11"/><path d="M7 8c4 1 13 10 17 16M11 5c-1 8 6 13 15 12M4 29h24"/>',
  balloon: '<path d="M26 13c0 7-7 12-10 12S6 20 6 13a10 10 0 0 1 20 0Zm-10 12-3 4h6l-3-4M11 11c0-2 1-3 3-4"/>',
  shield: '<path d="m16 3 11 4v9c0 7-11 13-11 13S5 23 5 16V7L16 3Z"/><path d="m10 15 4 4 8-8"/>',
  star: '<path d="m16 2 4 9 10 1-8 7 2 11-8-6-8 6 2-11-8-7 10-1Z"/>',
  lightning: '<path d="M19 2 5 18h10l-2 12L28 12H17l2-10Z"/>',
};

export function createItemUI({ deploy, enabled, doc = document, win = window }) {
  const slot = doc.getElementById("item-slot"), button = doc.getElementById("use-item");
  const icon = doc.getElementById("item-icon"), name = doc.getElementById("item-name");
  const action = doc.getElementById("item-action"), hint = doc.getElementById("item-hint");
  const status = doc.getElementById("item-status");
  let shown, statusText;
  function use() {
    // The live guard, not last frame's disabled state, owns overlay transitions.
    if (shown && enabled()) deploy();
  }
  // Deploy on touch-down without taking focus away from held steering/pedals.
  button.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    use();
  });
  button.addEventListener("click", event => { if (event.detail === 0) use(); });
  button.addEventListener("contextmenu", event => event.preventDefault());
  win.addEventListener("keydown", event => {
    if (event.key.toLowerCase() !== "f" || event.repeat || event.altKey || event.ctrlKey || event.metaKey
      || event.target?.closest?.("input,select,textarea,[role=slider],[contenteditable=true]")) return;
    if (!enabled()) return;
    event.preventDefault();
    use();
  });
  return {
    update(snapshot, modifiers) {
      const item = ITEMS.find(item => item.id === snapshot.held);
      button.disabled = !item || !enabled();
      if (shown !== (item?.id ?? null)) {
        shown = item?.id ?? null;
        slot.dataset.ready = String(!!item);
        slot.style.setProperty("--item-color", item?.color ?? "#bbcfba");
        icon.innerHTML = icons[item?.id ?? "gift"];
        name.textContent = item?.name ?? "Find a gift";
        action.textContent = item?.action ?? "Collect";
        hint.textContent = item ? item.description : "Drive through a glowing gift. Try off-road too!";
        button.setAttribute("aria-label", item ? `${item.action} ${item.name}. Press F or tap.` : "Find a glowing gift to collect an item");
        button.title = item ? `${item.description} (${item.action}: F)` : "One item at a time. Gifts return after a little while.";
      }
      const text = modifiers.turbo > 0 ? `Turbo + protection: ${Math.ceil(modifiers.turbo)}s`
        : modifiers.shield > 0 ? `Bubble protection: ${Math.ceil(modifiers.shield)}s`
          : modifiers.speedFactor < 1 ? "A little wobble! Keep driving."
            : item ? "Ready! Tap or press F" : "10 surprises to discover";
      if (text !== statusText) { statusText = text; status.textContent = text; }
    },
  };
}
