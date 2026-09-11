import { ITEMS } from "./item-system.js";

const icons = {
  empty: '<circle cx="32" cy="32" r="23" stroke="currentColor" stroke-width="2" stroke-dasharray="4 5"/><path d="M23 32h18m-9-9v18" stroke="currentColor" stroke-width="2.5"/>',
  banana: '<path d="M31 13c-2 15-10 23-25 29 8 10 19 3 25-9-1 12-3 19-8 24 12 4 18-10 13-24 6 13 15 18 23 11-16-6-22-17-23-31Z" fill="currentColor" stroke="#9b692a" stroke-width="2"/><path d="M31 13c-1 8-1 14 2 21l5-3-2-18" fill="#fff2a1"/><path d="m32 13 1-6 5 1-2 6" fill="#926338"/><path d="M11 43c8-1 14-8 19-15m7 6c5 6 11 10 17 10" stroke="#fff4b0" stroke-width="2.5"/>',
  oil: '<path d="M18 42C2 39 1 53 15 56c12 3 17-1 25 1 18 4 25-11 14-15-10-4-23 2-36 0Z" fill="#7951b8" stroke="#402954" stroke-width="2"/><path d="M33 6S19 23 19 32a14 14 0 0 0 28 0C47 23 33 6 33 6Z" fill="currentColor" stroke="#402954" stroke-width="2"/><path d="M27 25c-4 6-3 10 0 13M14 49h10" stroke="#e2baff" stroke-width="4"/>',
  mine: '<path d="M10 36v12c0 12 44 12 44 0V36" fill="#775be2" stroke="#493167" stroke-width="2"/><ellipse cx="32" cy="36" rx="22" ry="11" fill="currentColor" stroke="#493167" stroke-width="2"/><path d="m32 27 3 6 8 1-6 4 2 6-7-3-7 3 2-6-6-4 8-1Z" fill="#fff178"/><path d="m11 17 4 5m34-4 4-4M31 9v8" stroke="#67e6e5" stroke-width="4"/><path d="m20 7 3 4m18 6 3-5M6 29l4 1" stroke="#fff178" stroke-width="3"/>',
  rocket: '<path d="m18 39-5 17 16-7" fill="#ffd84d" stroke="#ba6d32" stroke-width="2"/><path d="m21 28-10 1-7 17 17-3m15-6 1 16-17 7 1-18" fill="currentColor" stroke="#9c513e" stroke-width="2"/><path d="M20 39C17 24 34 6 56 7c1 21-16 40-31 38Z" fill="#fff6df" stroke="#9c513e" stroke-width="2"/><path d="M41 10c5 1 10 6 12 12l3-15Z" fill="currentColor"/><circle cx="38" cy="25" r="7" fill="currentColor" stroke="#9c513e" stroke-width="2"/><path d="m18 36 10 10" stroke="currentColor" stroke-width="5"/>',
  homing: '<path d="m19 40-5 16 16-7" fill="#fff178"/><path d="m22 29-10 1-7 17 17-3m15-6 1 16-17 7 1-18" fill="currentColor" stroke="#35684b" stroke-width="2"/><path d="M21 40C18 25 35 7 57 8c1 21-16 40-31 38Z" fill="#fff6df" stroke="#35684b" stroke-width="2"/><path d="M40 11c6 1 11 6 14 12l3-15Z" fill="currentColor"/><ellipse cx="35" cy="25" rx="5" ry="6" fill="#fff" stroke="#35684b" stroke-width="1.5"/><ellipse cx="45" cy="29" rx="5" ry="6" fill="#fff" stroke="#35684b" stroke-width="1.5"/><path d="M36 24v3m10 1v3" stroke="#425078" stroke-width="3"/><path d="M5 18V7h11m-11 0 9 9" stroke="currentColor" stroke-width="3"/>',
  ball: '<circle cx="32" cy="31" r="24" fill="currentColor" stroke="#246f9f" stroke-width="2"/><path d="M10 22c17-2 34 7 43 21M23 9c-9 20 7 37 24 41" stroke="#fff178" stroke-width="5"/><path d="M37 12c7 1 12 5 15 12" stroke="#d8f6ff" stroke-width="3"/>',
  balloon: '<path d="M52 26c0 15-13 25-20 25S12 41 12 26a20 21 0 0 1 40 0Z" fill="currentColor" stroke="#327c99" stroke-width="2"/><path d="m32 50-5 9h10Z" fill="currentColor" stroke="#327c99" stroke-width="2"/><path d="M22 25c0-6 3-10 7-11" stroke="#e3ffff" stroke-width="5"/><path d="M28 53h8" stroke="#499ac8" stroke-width="3"/>',
  shield: '<circle cx="32" cy="31" r="27" fill="#a1eeff" fill-opacity=".12" stroke="#a1eeff" stroke-width="1.5"/><path d="m32 10 18 6v16c0 12-18 22-18 22S14 44 14 32V16Z" fill="currentColor" stroke="#4389a8" stroke-width="2"/><path d="m32 16 12 4v12c0 8-12 16-12 16Z" fill="#68bddb"/><path d="m23 31 6 6 13-13" stroke="#fff" stroke-width="4"/><path d="m8 9 3-5m44 43 3 4" stroke="#ede0ff" stroke-width="2.5"/>',
  star: '<path d="m32 4 8 17 19 3-14 14 3 21-16-10-17 10 4-21L5 24l19-3Z" fill="currentColor" stroke="#bc883d" stroke-width="2"/><path d="m32 11 5 13 14 3-17 5Z" fill="#fffbd8"/><path d="m34 32 10 21-12-8-12 8Z" fill="#ffce65"/>',
  lightning: '<path d="M38 4 10 35h18l-4 25 31-35H36l6-21Z" fill="currentColor" stroke="#7861ad" stroke-width="2"/><path d="m37 10-18 21h14l-3 15 17-17H32Z" fill="#fff6b0"/><path d="m10 13 5 3m35 30 5 3" stroke="currentColor" stroke-width="3"/>',
};

export function createItemUI({ deploy, enabled, doc = document, win = window }) {
  const slot = doc.getElementById("item-slot"), button = doc.getElementById("use-item");
  const icon = doc.getElementById("item-icon"), name = doc.getElementById("item-name");
  const action = doc.getElementById("item-action"), hint = doc.getElementById("item-hint");
  const status = doc.getElementById("item-status");
  const state = doc.getElementById("item-state");
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
        slot.style.setProperty("--item-color", item?.color ?? "#a6b0a9");
        icon.innerHTML = icons[item?.id ?? "empty"];
        state.textContent = item ? "Ready" : "Empty";
        name.textContent = item?.name ?? "No item";
        action.textContent = item?.action ?? "Find a pickup";
        hint.textContent = item ? item.description : "Drive through a floating item to collect it. Try off-road too!";
        button.setAttribute("aria-label", item ? `${item.name} ready. ${item.action}: press F or tap.` : "Item slot empty. Drive through a floating item to collect it.");
        button.title = item ? `${item.description} (${item.action}: F)` : "Empty slot. Drive through a floating collectible. Carry one item at a time.";
      }
      const effect = modifiers.turbo > 0 ? `Turbo + protection: ${Math.ceil(modifiers.turbo)}s`
        : modifiers.shield > 0 ? `Bubble protection: ${Math.ceil(modifiers.shield)}s`
          : modifiers.speedFactor < 1 ? "A little wobble! Keep driving."
            : "";
      const text = effect || (item ? `${item.name} ready. ${item.action}: press F or tap.` : "Item slot empty. Drive through a floating item to collect it.");
      if (text !== statusText) {
        statusText = text; status.textContent = text;
        slot.dataset.effect = String(!!effect);
      }
    },
  };
}
