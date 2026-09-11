import * as THREE from "three";

export const friends = [
  { name: "Vincent", color: "#f36b74", shape: "ball", count: 1, symbol: "●" },
  { name: "Lea", color: "#ffd35e", shape: "star", count: 2, symbol: "★" },
  { name: "Camilla", color: "#67c8f1", shape: "cube", count: 3, symbol: "■" },
  { name: "Maxey", color: "#f8a5dd", shape: "ring", count: 4, symbol: "○" },
  { name: "Loulou", color: "#79dfb4", shape: "gem", count: 5, symbol: "◆" },
];
const saveKey = "wildrun-friends-v1";

export function createFriendAdventure({ scene, route, onChange, onStop, session }) {
  let index = 0, collected = 0, counted = 0, modalOpen = false, voice = session?.value.voice ?? false;
  try {
    const saved = JSON.parse(localStorage.getItem(saveKey));
    if (Number.isInteger(saved?.index) && saved.index >= 0 && saved.index <= 5) {
      index = saved.index;
      if (index < 5 && Number.isInteger(saved.collected))
        collected = Math.max(0, Math.min(friends[index].count, saved.collected));
    }
  } catch { /* Storage is optional in private browsing. */ }
  const el = (id) => document.getElementById(id);
  const hud = el("friend-hud"), title = el("friend-title"), clue = el("friend-clue");
  const dots = el("friend-dots"), crew = el("friend-crew"), dialog = el("friend-dialog");
  const dialogTitle = el("delivery-title"), dialogClue = el("delivery-clue");
  const items = el("delivery-items"), basket = el("delivery-basket"), next = el("delivery-next");
  const speaker = el("friend-voice"), repeat = el("friend-repeat");
  const marker = new THREE.Group();
  scene.add(marker);
  const colorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x263742, roughness: 0.65 });
  const add = (geometry, material, x, y, z, parent = marker) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z); parent.add(m); return m;
  };
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 + Math.PI / 2, r = i % 2 ? 0.48 : 1;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  star.closePath();
  const geometries = [new THREE.SphereGeometry(0.85, 16, 12),
    new THREE.ExtrudeGeometry(star, { depth: 0.3, bevelEnabled: false }),
    new THREE.BoxGeometry(1.35, 1.35, 1.35), new THREE.TorusGeometry(0.65, 0.24, 8, 20),
    new THREE.OctahedronGeometry(1)];
  const object = add(geometries[0], colorMaterial, 0, 2.1, 0);
  const halo = add(new THREE.TorusGeometry(2.5, 0.09, 6, 32), colorMaterial, 0, 0.15, 0);
  halo.rotation.x = Math.PI / 2;
  const buddy = new THREE.Group(); marker.add(buddy);
  add(new THREE.CapsuleGeometry(0.48, 0.65, 4, 10), colorMaterial, 0, 1.05, 0, buddy);
  add(new THREE.SphereGeometry(0.6, 16, 12), white, 0, 2.05, 0, buddy);
  const visor = add(new THREE.SphereGeometry(0.48, 12, 8), dark, 0, 2.08, 0.28, buddy);
  visor.scale.set(1, 0.65, 0.65);
  for (const x of [-0.25, 0.25]) add(new THREE.BoxGeometry(0.35, 0.45, 0.55), dark, x, 0.28, 0.12, buddy);
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512; labelCanvas.height = 128;
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  add(new THREE.PlaneGeometry(4.4, 1.1), new THREE.MeshBasicMaterial({ map: labelTexture, side: THREE.DoubleSide }), 0, 3.7, 0);
  const previous = new THREE.Vector3();
  let hasPrevious = false, awaitingExit = false;
  const stampNodes = friends.map((friend) => {
    const stamp = document.createElement("span"); stamp.className = "friend-stamp";
    stamp.style.setProperty("--friend", friend.color);
    stamp.innerHTML = "<b>" + friend.name[0] + "</b><small>" + friend.name + "</small>";
    crew.append(stamp); return stamp;
  });
  function save() {
    try { localStorage.setItem(saveKey, JSON.stringify({ index, collected })); } catch { /* Keep playing without persistence. */ }
  }
  function say(text) {
    if (!voice || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "en-GB"; speech.rate = 0.85;
    speechSynthesis.speak(speech);
  }
  speaker.onclick = () => {
    voice = !voice; speaker.setAttribute("aria-pressed", String(voice));
    session?.update({ voice });
    speaker.title = voice ? "Turn voice off" : "Turn voice on";
    if (voice) say(clue.textContent); else window.speechSynthesis?.cancel();
  };
  speaker.setAttribute("aria-pressed", String(voice));
  speaker.title = voice ? "Turn voice off" : "Turn voice on";
  if (!("speechSynthesis" in window)) speaker.hidden = true;
  repeat.onclick = () => { index = 0; collected = 0; hasPrevious = false; save(); refresh(); };
  function refresh() {
    onChange();
    stampNodes.forEach((stamp, i) => {
      stamp.classList.toggle("earned", i < index); stamp.classList.toggle("current", i === index);
      stamp.setAttribute("aria-label", friends[i].name + (i < index ? ": helped" : ": waiting"));
    });
    marker.visible = index < friends.length; repeat.hidden = index < friends.length;
    if (index === friends.length) {
      title.textContent = "Everyone is ready!"; clue.textContent = "Five friends. One lovely picnic.";
      dots.replaceChildren(); return;
    }
    const f = friends[index], delivering = collected === f.count;
    hud.style.setProperty("--friend", f.color);
    title.textContent = delivering ? "Bring them to " + f.name : "Help " + f.name;
    clue.textContent = delivering ? f.name + " is at the matching flag." : "Find " + f.count + " " + f.shape + (f.count === 1 ? "" : "s") + " for the picnic.";
    dots.replaceChildren();
    for (let i = 0; i < f.count; i++) {
      const dot = document.createElement("span"); dot.textContent = f.symbol;
      dot.className = i < collected ? "found" : ""; dots.append(dot);
    }
    dots.setAttribute("aria-label", collected + " of " + f.count + " collected");
    // Road-centre destinations stay reachable in both worlds.
    const routeIndex = Math.floor((index * 43 + (delivering ? 38 : 8 + collected * 5)) / 240 * route.length);
    marker.position.copy(route[routeIndex]);
    const ahead = route[(routeIndex + 1) % route.length];
    marker.rotation.y = Math.atan2(ahead.x - marker.position.x, ahead.z - marker.position.z) + Math.PI;
    colorMaterial.color.set(f.color); object.geometry = geometries[index];
    object.visible = !delivering; buddy.visible = delivering;
    const ctx = labelCanvas.getContext("2d");
    ctx.fillStyle = "#263742"; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = f.color; ctx.fillRect(0, 112, 512, 16);
    ctx.fillStyle = "white"; ctx.font = "bold 58px Arial"; ctx.textAlign = "center";
    ctx.fillText(delivering ? f.name : f.symbol + "  " + (collected + 1) + " / " + f.count, 256, 83);
    labelTexture.needsUpdate = true;
  }
  function openDelivery() {
    modalOpen = true; counted = 0; onStop();
    const f = friends[index]; dialog.style.setProperty("--friend", f.color);
    dialogTitle.textContent = "A delivery for " + f.name;
    dialogClue.textContent = "Tap each " + f.shape + " into " + f.name + "'s basket.";
    items.replaceChildren(); basket.replaceChildren(); basket.hidden = false; next.hidden = true;
    basket.setAttribute("aria-label", "Empty basket");
    el("basket-label").textContent = f.name + "'s basket";
    el("basket-label").hidden = false;
    for (let i = 0; i < f.count; i++) {
      const button = document.createElement("button"); button.className = "count-item";
      button.textContent = f.symbol; button.setAttribute("aria-label", "Give " + f.shape + " " + (i + 1) + " to " + f.name);
      const slot = document.createElement("span");
      slot.className = "basket-slot"; slot.setAttribute("aria-hidden", "true");
      basket.append(slot);
      button.onclick = () => {
        if (button.disabled) return;
        counted++; button.disabled = true;
        button.setAttribute("aria-label", f.shape + " delivered");
        slot.textContent = f.symbol; slot.classList.add("filled");
        basket.setAttribute("aria-label", counted + " " + f.shape + (counted === 1 ? "" : "s") + " delivered");
        dialogClue.textContent = counted + " " + f.shape + (counted === 1 ? "" : "s") + " for " + f.name + ".";
        if (counted === f.count) finishDelivery();
        else say(String(counted));
      };
      items.append(button);
    }
    dialog.showModal(); say(dialogClue.textContent);
  }
  function finishDelivery() {
    const f = friends[index];
    dialogTitle.textContent = "Thank you, from " + f.name + "!";
    dialogClue.textContent = f.count + " " + f.shape + (f.count === 1 ? "" : "s") + ". All packed!";
    say(dialogClue.textContent);
    index++; collected = 0; save(); refresh();
    next.hidden = false;
    next.textContent = index === 5 ? "Picnic time!" : "Find " + friends[index].name;
    next.focus();
  }
  next.onclick = () => {
    if (index === 5 && next.textContent !== "Keep exploring") {
      dialogTitle.textContent = "Elios & friends"; dialogClue.textContent = "You helped everyone get the picnic ready!";
      items.replaceChildren(); basket.hidden = true; el("basket-label").hidden = true;
      friends.forEach((f) => {
        const stamp = document.createElement("span"); stamp.className = "picnic-friend";
        stamp.style.setProperty("--friend", f.color);
        stamp.innerHTML = "<b>" + f.symbol + "</b><small>" + f.name + "</small>"; items.append(stamp);
      });
      next.textContent = "Keep exploring"; say(dialogClue.textContent); return;
    }
    dialog.close(); modalOpen = false; hasPrevious = false; say(clue.textContent);
  };
  function closeDelivery() {
    dialog.close(); modalOpen = false; hasPrevious = false; awaitingExit = true;
  }
  el("delivery-close").onclick = closeDelivery;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault(); closeDelivery();
  });
  function update(position) {
    if (index === 5 || modalOpen) { previous.copy(position); return; }
    if (awaitingExit) {
      previous.copy(position);
      if (position.distanceTo(marker.position) > 8) awaitingExit = false;
      return;
    }
    if (!hasPrevious) { previous.copy(position); hasPrevious = true; }
    // Sweep the driven segment so boosted passes still collect. Ignore teleport paths.
    const dx = position.x - previous.x, dz = position.z - previous.z, length2 = dx * dx + dz * dz;
    const t = length2 > 900 ? 1 : length2 ? Math.max(0, Math.min(1, ((marker.position.x - previous.x) * dx + (marker.position.z - previous.z) * dz) / length2)) : 0;
    const distance = Math.hypot(marker.position.x - previous.x - dx * t, marker.position.z - previous.z - dz * t);
    previous.copy(position);
    if (distance > 5.5) return;
    const f = friends[index];
    if (collected === f.count) { openDelivery(); return; }
    collected++; save(); refresh();
    say(collected + "! " + (collected === f.count ? "Now find " + f.name + "." : "Keep looking!"));
  }
  refresh();
  return {
    update, busy: () => modalOpen,
    drawMap(ctx, scale = 0.94) {
      if (index === 5) return;
      ctx.fillStyle = friends[index].color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(marker.position.x * scale, -marker.position.z * scale, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    },
    state: () => ({ index, collected, counted, modalOpen, target: marker.position.toArray(), friend: friends[index]?.name ?? null }),
  };
}
