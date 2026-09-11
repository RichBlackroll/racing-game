import { createRearView } from "./rear-view.js";

export function createCockpit({ renderer, scene, car, tablet = false, root = document.getElementById("game-ui") }) {
  const doc = root.ownerDocument;
  const element = doc.createElement("div");
  element.id = "cockpit";
  element.hidden = true;
  element.setAttribute("aria-label", "Inside view instruments");
  const ticks = Array.from({ length: 41 }, (_, i) => {
    const angle = -130 + i * 6.5;
    const major = i % 4 === 0;
    const radians = angle * Math.PI / 180;
    return `<path d="M0 -88v${major ? 10 : 5}" transform="rotate(${angle})" class="cockpit-tick${major ? " major" : ""}"/>${major ? `<text x="${Math.sin(radians) * 68}" y="${-Math.cos(radians) * 68 + 4}" class="cockpit-dial-number">${i * 12.5}</text>` : ""}`;
  }).join("");
  element.innerHTML = `
    <div class="cockpit-roof" aria-hidden="true"><i></i><i></i></div>
    <div class="cockpit-pillar cockpit-pillar-left" aria-hidden="true"></div>
    <div class="cockpit-pillar cockpit-pillar-right" aria-hidden="true"></div>
    <div class="cockpit-mirror" role="img" aria-label="Live rear-view mirror showing the road behind you">
      <div class="cockpit-mirror-glass"></div><span>REAR VIEW</span><i></i>
    </div>
    <svg class="cockpit-dash" viewBox="0 0 1440 300" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="dash-leather" x2="0" y2="1"><stop stop-color="#424947"/><stop offset=".14" stop-color="#252c2b"/><stop offset=".48" stop-color="#151b1b"/><stop offset="1" stop-color="#101515"/></linearGradient>
        <linearGradient id="dash-trim" x2="0" y2="1"><stop stop-color="#8c9691"/><stop offset=".3" stop-color="#4a5651"/><stop offset=".55" stop-color="#252e2b"/><stop offset="1" stop-color="#5a655e"/></linearGradient>
      </defs>
      <path d="M0 57Q250 12 440 37Q720 -27 1000 37Q1190 12 1440 57V300H0Z" fill="url(#dash-leather)" stroke="#69726b" stroke-width="2"/>
      <path d="M0 72Q250 30 440 54Q720 -9 1000 54Q1190 30 1440 72" fill="none" stroke="#929a7d" stroke-opacity=".45" stroke-dasharray="4 5"/>
      <path d="M0 161Q250 134 440 151H1000Q1190 134 1440 161V172Q1190 145 1000 162H440Q250 145 0 172Z" fill="url(#dash-trim)"/>
      <path d="M1040 205h315v62h-315m135-58h54" fill="none" stroke="#3e4943" stroke-width="2"/>
      <path d="m85 32 335-12m-210 9 66 15m749-24 330 12m-201-5-65 15" fill="none" stroke="#101817" stroke-width="5" stroke-linecap="round"/>
    </svg>
    <div class="cockpit-vent cockpit-vent-left" aria-hidden="true"><i></i></div>
    <div class="cockpit-vent cockpit-vent-right" aria-hidden="true"><i></i></div>
    <div class="cockpit-passenger-label" aria-hidden="true">WILDRUN <span>TOURING</span></div>
    <svg class="cockpit-instruments" viewBox="0 0 560 215" role="img" aria-label="Dashboard speed, drive gear, boost and trip distance">
      <defs>
        <radialGradient id="dial-face"><stop stop-color="#26332d"/><stop offset=".8" stop-color="#101b17"/><stop offset="1" stop-color="#070d0b"/></radialGradient>
      </defs>
      <path d="M4 200v-55Q4 52 92 49h60Q166 2 280 2t128 47h60q88 3 88 96v55Z" fill="#111716" stroke="#454e48" stroke-width="3"/>
      <g transform="translate(105 127)">
        <circle r="69" class="cockpit-dial"/>
        <path d="M-43 30a52 52 0 1 1 86 0" fill="none" stroke="#35433b" stroke-width="5"/>
        <path data-instrument="boost-arc" d="M-43 30a52 52 0 1 1 86 0" fill="none" stroke="#d4b589" stroke-width="5" pathLength="100" stroke-dasharray="100 100"/>
        <text y="-18" class="cockpit-small">ROCKET</text>
        <text y="12" data-instrument="boost" class="cockpit-boost-value">READY</text>
        <text y="38" data-instrument="boost-detail" class="cockpit-small">5.0 SEC</text>
      </g>
      <g transform="translate(280 106)">
        <circle r="100" class="cockpit-dial"/>
        ${ticks}
        <text y="-31" class="cockpit-small">GROUND SPEED</text>
        <g data-instrument="needle" transform="rotate(-130)"><path d="M-2 -79 0-86 2-79 2 10h-4Z" fill="#e4bd85"/><circle r="6" fill="#727d6c" stroke="#c8d0b2"/></g>
        <rect x="-42" y="15" width="84" height="58" rx="8" fill="#101a15"/>
        <text y="51" data-instrument="speed" class="cockpit-speed-value">0</text>
        <text y="67" class="cockpit-small">KM/H</text>
      </g>
      <g transform="translate(455 127)">
        <circle r="69" class="cockpit-dial"/>
        <text y="-36" data-instrument="brake" class="cockpit-brake">DRIVE</text>
        <text y="6" data-instrument="gear" class="cockpit-gear-value">N</text>
        <text y="29" data-instrument="trip" class="cockpit-trip-value">0.00 KM</text>
        <text y="44" class="cockpit-small">TRIP</text>
      </g>
    </svg>
    <svg class="cockpit-wheel" viewBox="0 0 320 320" aria-hidden="true">
      <defs><linearGradient id="wheel-metal" x2=".8" y2="1"><stop stop-color="#7a8580"/><stop offset=".5" stop-color="#353f3a"/><stop offset="1" stop-color="#171e1b"/></linearGradient></defs>
      <g data-instrument="wheel">
        <circle cx="160" cy="160" r="137" fill="none" stroke="#060c0a" stroke-width="35"/>
        <circle cx="160" cy="160" r="139" fill="none" stroke="#354038" stroke-width="26"/>
        <circle cx="160" cy="160" r="136" fill="none" stroke="#1a241f" stroke-width="22"/>
        <circle cx="160" cy="160" r="147" fill="none" stroke="#96a17e" stroke-opacity=".45" stroke-dasharray="3 5"/>
        <path d="M155 11h10v27h-10Z" fill="#d4b589"/>
        <path d="m36 133 100 14h48l100-14-7 33-80 23-20 100h-34l-20-100-80-23Z" fill="url(#wheel-metal)" stroke="#101814" stroke-width="3"/>
        <path d="m54 142 67 14m78 0 67-14M158 224v47m7-47v47" fill="none" stroke="#85907e" stroke-opacity=".5" stroke-width="2"/>
        <rect x="108" y="128" width="104" height="78" rx="32" fill="#1c2720" stroke="#495346" stroke-width="2"/>
        <path d="m139 151 9 26 12-18 12 18 9-26" fill="none" stroke="#c7ceb2" stroke-width="3"/>
        <text x="160" y="192" class="cockpit-small">WILDRUN</text>
      </g>
    </svg>`;
  root.prepend(element);
  const instruments = Object.fromEntries([...element.querySelectorAll("[data-instrument]")].map(node => [node.dataset.instrument, node]));
  const rearView = createRearView({ renderer, scene, car, tablet, element: element.querySelector(".cockpit-mirror-glass") });
  let active = false;

  function setActive(value) {
    if (active === value) return;
    active = value;
    element.hidden = !value;
    doc.body.classList.toggle("cockpit-view", value);
    if (value) rearView.invalidate();
  }

  function update({ speed, steer, travel, handbrake, boosting, recovering, boostRemaining, boostDuration, hasRocket }) {
    if (!active) return;
    const kmh = Math.round(Math.abs(speed) * 3.6);
    const gear = speed < -0.5 ? "R" : speed > 0.5 ? "D" : "N";
    instruments.speed.textContent = kmh;
    instruments.gear.textContent = gear;
    instruments.needle.setAttribute("transform", `rotate(${-130 + Math.min(500, kmh) / 500 * 260})`);
    instruments.wheel.setAttribute("transform", `rotate(${-Math.max(-1, Math.min(1, steer)) * 105} 160 160)`);
    instruments.trip.textContent = `${(travel / 1000).toFixed(2)} KM`;
    instruments.brake.classList.toggle("engaged", handbrake);
    instruments.brake.textContent = handbrake ? "(P) BRAKE ON" : "DRIVE";
    const remaining = Math.max(0, boostRemaining);
    const fraction = !hasRocket || recovering ? 0 : boosting ? Math.min(1, remaining / Math.max(.1, boostDuration)) : 1;
    instruments["boost-arc"].setAttribute("stroke-dashoffset", 100 * (1 - fraction));
    instruments.boost.textContent = !hasRocket ? "OFF" : boosting ? "BOOST" : recovering ? "COOL" : "READY";
    instruments["boost-detail"].textContent = !hasRocket ? "NO ROCKET" : recovering ? "COOLING" : `${(boosting ? remaining : boostDuration).toFixed(1)} SEC`;
  }

  return {
    setActive, update,
    renderMirror(now) { if (active) rearView.render(now); },
    resize() { rearView.invalidate(); },
    dispose() { setActive(false); rearView.dispose(); element.remove(); },
  };
}
