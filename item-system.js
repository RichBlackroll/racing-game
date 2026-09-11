export const ITEMS = Object.freeze([
  { id: "banana", name: "Banana Peel", action: "Drop", description: "Leave a peel for a short, wobbly slip.", color: "#ffd84d" },
  { id: "oil", name: "Silly Oil", action: "Drop", description: "Leave a slippery puddle that briefly slows friends.", color: "#a781ee" },
  { id: "mine", name: "Confetti Mine", action: "Drop", description: "Pop a confetti surprise that slows nearby friends.", color: "#ff79bf" },
  { id: "rocket", name: "Foam Rocket", action: "Fire", description: "Send a soft foam rocket straight ahead for a brief wobble.", color: "#ff9360" },
  { id: "homing", name: "Buddy Rocket", action: "Fire", description: "Send a soft rocket gently towards a friend ahead.", color: "#7bdc98" },
  { id: "ball", name: "Bouncy Ball", action: "Throw", description: "Toss a bouncing ball that rebounds off scenery.", color: "#55bbff" },
  { id: "balloon", name: "Water Balloon", action: "Throw", description: "Toss a balloon for a splash that briefly slows nearby friends.", color: "#5edce9" },
  { id: "shield", name: "Bubble Shield", action: "Use", description: "Block item effects with a bubble for six seconds.", color: "#a1eeff" },
  { id: "star", name: "Turbo Star", action: "Use", description: "Go faster and block item effects for five seconds.", color: "#fff178" },
  { id: "lightning", name: "Lightning", action: "Zap", description: "Briefly slow every other racer, wherever they are.", color: "#cbb6ff" },
].map(Object.freeze));

const DEFINITIONS = new Map(ITEMS.map(item => [item.id, item]));
const WEIGHTS = [18, 16, 10, 14, 8, 12, 10, 6, 4, 2];
const CLEARANCE = 2.8, MAX_ENTITIES = 32, MAX_EFFECTS = 48;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

// Intersect the horizontal circle interval AND the vertical interval, at the
// same time. Closest-XZ-only checks miss jumping cars or hit cars on bridges.
function sweep(a, b, c, d, radius, vertical) {
  const x = a.x - c.x, z = a.z - c.z, y = a.y - c.y;
  const dx = b.x - a.x - d.x + c.x, dz = b.z - a.z - d.z + c.z;
  const dy = b.y - a.y - d.y + c.y;
  const aa = dx * dx + dz * dz, bb = x * dx + z * dz, cc = x * x + z * z - radius * radius;
  let lo = 0, hi = 1;
  if (aa < 1e-12) { if (cc > 0) return null; }
  else {
    const disc = bb * bb - aa * cc;
    if (disc < 0) return null;
    lo = Math.max(lo, (-bb - Math.sqrt(disc)) / aa);
    hi = Math.min(hi, (-bb + Math.sqrt(disc)) / aa);
  }
  if (Math.abs(dy) < 1e-12) { if (Math.abs(y) > vertical) return null; }
  else {
    const t1 = (-vertical - y) / dy, t2 = (vertical - y) / dy;
    lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
  }
  return lo <= hi ? lo : null;
}

/** Pure simulation. Target Y is the car root, heading 0 is +Z, speed is signed forward m/s.
 * turbo is a boost timer for the driving adapter; speedFactor only represents
 * slows. Obstacles/ramps are static for the lifetime of this instance.
 */
export function createItemSystem({ course, obstacles = [], ramps = [], pickupCount = 60, onEvent = () => {} }) {
  if (!course?.route?.length || typeof course.heightAt !== "function" || typeof course.roadDistance !== "function"
    || !Number.isFinite(course.halfSize) || course.halfSize <= CLEARANCE) throw new TypeError("A drivable course is required");
  const count = Number.isFinite(pickupCount) ? Math.max(0, Math.floor(pickupCount)) : 60;
  const heightAt = (x, z) => course.heightAt(x, z);
  const safe = (x, z, r) => Math.abs(x) <= course.halfSize - r && Math.abs(z) <= course.halfSize - r
    && (!course.isSafePosition || course.isSafePosition(x, z, r));
  const grid = new Map(), large = [];
  const shapes = [...obstacles.map(o => ({ ...o, c: Math.cos(o.heading ?? 0), s: Math.sin(o.heading ?? 0) })),
    ...ramps.map(r => ({ x: r.x + Math.sin(r.heading) * r.length / 2, z: r.z + Math.cos(r.heading) * r.length / 2,
      y: r.y, hx: r.width / 2, hz: r.length / 2, height: r.height, c: Math.cos(r.heading), s: Math.sin(r.heading) }))];
  for (const o of shapes) {
    const ex = o.hx === undefined ? o.r : Math.abs(o.c) * o.hx + Math.abs(o.s) * o.hz;
    const ez = o.hx === undefined ? o.r : Math.abs(o.s) * o.hx + Math.abs(o.c) * o.hz;
    const x1 = Math.floor((o.x - ex) / 32), x2 = Math.floor((o.x + ex) / 32);
    const z1 = Math.floor((o.z - ez) / 32), z2 = Math.floor((o.z + ez) / 32);
    // Long quay walls should not allocate a world-sized spatial grid.
    if ((x2 - x1 + 1) * (z2 - z1 + 1) > 128) { large.push(o); continue; }
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      const key = `${x},${z}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(o);
    }
  }
  function nearby(a, b, r) {
    const found = new Set(large);
    for (let z = Math.floor((Math.min(a.z, b.z) - r) / 32); z <= Math.floor((Math.max(a.z, b.z) + r) / 32); z++) {
      for (let x = Math.floor((Math.min(a.x, b.x) - r) / 32); x <= Math.floor((Math.max(a.x, b.x) + r) / 32); x++) {
        for (const o of grid.get(`${x},${z}`) ?? []) found.add(o);
      }
    }
    return found;
  }
  function footprint(o, x, z) {
    const dx = x - o.x, dz = z - o.z;
    return o.hx === undefined ? Math.hypot(dx, dz) - o.r
      : Math.hypot(Math.max(0, Math.abs(o.c * dx - o.s * dz) - o.hx), Math.max(0, Math.abs(o.s * dx + o.c * dz) - o.hz));
  }

  let seed = (0x51f15e + course.route.length + Math.round(course.halfSize * 31 + course.route[0].x * 7 + course.route[0].z * 13)) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pickups = [], arc = [0];
  for (let i = 0; i < course.route.length; i++) {
    const a = course.route[i], b = course.route[(i + 1) % course.route.length];
    arc.push(arc.at(-1) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  function routePoint(distance, offset = 0) {
    distance %= arc.at(-1) || 1;
    let lo = 0, hi = course.route.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (arc[mid + 1] <= distance) lo = mid + 1; else hi = mid; }
    const a = course.route[lo], b = course.route[(lo + 1) % course.route.length], length = arc[lo + 1] - arc[lo] || 1;
    const t = (distance - arc[lo]) / length;
    return { x: a.x + (b.x - a.x) * t - (b.z - a.z) / length * offset,
      z: a.z + (b.z - a.z) * t + (b.x - a.x) / length * offset };
  }
  function place(p, minRoad, maxRoad) {
    if (Math.abs(p.x) > course.halfSize - CLEARANCE || Math.abs(p.z) > course.halfSize - CLEARANCE
      || pickups.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 7)) return false;
    for (const o of nearby(p, p, CLEARANCE)) if (footprint(o, p.x, p.z) < CLEARANCE) return false;
    if (!safe(p.x, p.z, CLEARANCE)) return false;
    const road = course.roadDistance(p.x, p.z);
    if (!Number.isFinite(road) || road < minRoad || road > maxRoad) return false;
    const y = heightAt(p.x, p.z);
    if (!Number.isFinite(y)) return false;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, h = heightAt(p.x + Math.cos(angle) * CLEARANCE, p.z + Math.sin(angle) * CLEARANCE);
      if (!Number.isFinite(h) || Math.abs(h - y) > CLEARANCE * 0.5) return false;
    }
    pickups.push({ id: pickups.length, type: null, x: p.x, y: y + 0.9, z: p.z, available: true, respawn: 0 });
    return true;
  }
  if (count) for (let distance = 10; distance <= 30 && !pickups.length; distance += 2) {
    for (const offset of [0, -1.8, 1.8]) if (place(routePoint(distance, offset), 0, 5)) break;
  }
  // Reserve off-road slots before filling the road. Each phase has a fixed
  // candidate budget, including on maps with no usable remote land.
  const budget = Math.min(12000, Math.max(240, count * 80));
  let offroad = 0;
  for (const phase of ["remote", "offroad", "road"]) {
    const quota = phase === "remote" ? Math.ceil(count / 10) : Math.ceil(count * 0.4);
    for (let attempt = 0; attempt < budget / (phase === "road" ? 2 : 4) && pickups.length < count; attempt++) {
      if (phase !== "road" && offroad >= quota) break;
      const offset = phase === "road" ? (random() - 0.5) * 6
        : (random() < 0.5 ? -1 : 1) * (phase === "remote" ? 40 + random() * 110 : 12 + random() * 35);
      const fallback = phase === "road" && attempt >= budget / 4 && attempt % 2 === 0;
      const p = (phase !== "road" && attempt % 2 === 0) || fallback
        ? { x: (random() * 2 - 1) * (course.halfSize - CLEARANCE), z: (random() * 2 - 1) * (course.halfSize - CLEARANCE) }
        : routePoint(random() * arc.at(-1), offset);
      if (place(p, phase === "remote" ? 35.01 : phase === "offroad" ? 11 : 0, phase === "road" && !fallback ? 5 : Infinity)
        && phase !== "road") offroad++;
    }
  }
  for (const p of pickups) {
    let index = p.id;
    if (index >= ITEMS.length) {
      let roll = random() * WEIGHTS.reduce((a, b) => a + b, 0);
      index = 0;
      while (index < WEIGHTS.length - 1 && (roll -= WEIGHTS[index]) >= 0) index++;
    }
    p.type = ITEMS[index].id;
  }

  let held = null, serial = 0, targets = new Map(), entities = [], effects = [];
  const statuses = new Map();
  const emit = (type, item, target, message) => onEvent({ type, item, target, message });
  function status(id) {
    if (!statuses.has(id)) statuses.set(id, { id, slow: 0, wobble: 0, shield: 0, turbo: 0, grace: 0 });
    return statuses.get(id);
  }
  function modifiers(id) {
    const s = statuses.get(id);
    return { speedFactor: s?.slow > 0 ? 0.6 : 1, wobble: s?.wobble ?? 0, shield: s?.shield ?? 0, turbo: s?.turbo ?? 0 };
  }
  function visual(type, item, p, radius) {
    effects.push({ id: ++serial, type, item, color: DEFINITIONS.get(item).color, x: p.x, y: p.y, z: p.z, age: 0, life: 0.8, radius });
    if (effects.length > MAX_EFFECTS) effects.shift();
  }
  function hit(item, target) {
    const s = status(target.id);
    if (s.grace > 0) return;
    s.grace = 1.5;
    if (s.shield > 0 || s.turbo > 0) {
      emit("blocked", item, target.id, `${DEFINITIONS.get(item).name} blocked by a protective bubble!`);
      return;
    }
    const duration = { banana: 2.5, oil: 2.8, mine: 3, rocket: 2, homing: 2, ball: 2, balloon: 2.5, lightning: 4 }[item];
    s.slow = Math.max(s.slow, duration); s.wobble = Math.max(s.wobble, item === "lightning" ? 0.6 : 1.2);
    emit("hit", item, target.id, `${DEFINITIONS.get(item).name}: a little slow and wobble!`);
  }
  function splash(e, positions, radius) {
    visual("burst", e.type, e, radius);
    for (const t of positions) {
      if (t.id === e.ownerId && e.age < 1.5) continue;
      if (Math.hypot(t.x - e.x, t.z - e.z) <= radius + t.radius && Math.abs(t.y + 0.8 - e.y) <= 2.5) hit(e.type, t);
    }
  }
  function aim(e, positions) {
    let best = null, distance = 100;
    for (const t of positions) {
      if (t.id === e.ownerId || Math.abs(t.y + 0.8 - e.y) > 6) continue;
      const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz);
      if (d < distance && d > 0.01 && (dx * Math.sin(e.heading) + dz * Math.cos(e.heading)) / d > 0.5) { best = t; distance = d; }
    }
    return best;
  }
  function deploy(ownerId = "player") {
    const owner = targets.get(ownerId);
    if (ownerId !== "player" || !owner || !held) return false;
    const item = held;
    held = null;
    if (item === "shield" || item === "star") {
      const s = status(ownerId);
      s.slow = 0; s.wobble = 0;
      if (item === "shield") s.shield = 6; else s.turbo = 5;
      visual("burst", item, owner, 2.5);
    } else if (item === "lightning") {
      visual("lightning", item, owner, 3);
      for (const t of targets.values()) if (t.id !== ownerId) {
        hit(item, t); visual("lightning", item, t, 2.5);
      }
    } else {
      const hazard = ["banana", "oil", "mine"].includes(item), distance = hazard ? -(owner.radius + 2.3) : owner.radius + 1.3;
      const x = owner.x + Math.sin(owner.heading) * distance, z = owner.z + Math.cos(owner.heading) * distance;
      const e = { id: ++serial, type: item, ownerId, kind: hazard ? "hazard" : "projectile", x, z,
        y: hazard ? heightAt(x, z) + 0.2 : owner.y + 0.9, heading: owner.heading, age: 0,
        life: hazard ? 24 : item === "ball" ? 8 : 5, radius: hazard ? (item === "oil" ? 2.3 : 1.2) : 0.55,
        speed: item === "rocket" ? 36 : item === "homing" ? 30 : item === "ball" ? 25 : 20,
        vy: item === "balloon" ? 10 : item === "ball" ? 5 : 0, bounces: 0 };
      // Rockets keep launch momentum to catch fast rivals. Throws stay short
      // and predictable; reversing must not slow a forward-fired rocket.
      if (item === "rocket" || item === "homing") e.speed += Math.max(0, owner.speed);
      if (hazard) {
        if (safe(x, z, e.radius) && ![...nearby(e, e, e.radius)].some(o => footprint(o, x, z) < e.radius)) entities.push(e);
        else visual("burst", item, owner, 2);
      } else {
        // Check the muzzle segment too: firing next to a wall cannot spawn on
        // its far side, and the ball can rebound from that initial contact.
        const start = { x: owner.x, y: e.y, z: owner.z }, contact = scenery(start, e, e.radius);
        if (contact) {
          Object.assign(e, mix(start, e, contact.t));
          if (item === "ball") { bounce(e, contact); entities.push(e); }
          else if (item === "balloon") splash(e, [...targets.values()], 7);
          else visual("burst", item, e, 2);
        } else entities.push(e);
      }
      if (entities.length > MAX_ENTITIES) entities.shift();
    }
    const definition = DEFINITIONS.get(item);
    const message = item === "lightning" ? "Lightning! Every other racer slows for 4 seconds."
      : `${definition.name} ${{ Drop: "dropped", Fire: "away", Throw: "tossed", Use: "activated" }[definition.action]}!`;
    emit("deploy", item, ownerId, message);
    return true;
  }

  function scenery(a, b, r) {
    let best = null;
    for (const o of nearby(a, b, r)) {
      const base = o.y ?? heightAt(o.x, o.z), top = base + (o.height ?? 3);
      const y = (base + top) / 2, vertical = (top - base) / 2 + r;
      let t, nx, nz;
      if (o.hx === undefined) {
        t = sweep(a, b, { x: o.x, y, z: o.z }, { x: o.x, y, z: o.z }, o.r + r, vertical);
        if (t === null) continue;
        const p = mix(a, b, t), len = Math.hypot(p.x - o.x, p.z - o.z) || 1;
        nx = (p.x - o.x) / len; nz = (p.z - o.z) / len;
      } else {
        const x = o.c * (a.x - o.x) - o.s * (a.z - o.z), z = o.s * (a.x - o.x) + o.c * (a.z - o.z);
        const dx = o.c * (b.x - a.x) - o.s * (b.z - a.z), dz = o.s * (b.x - a.x) + o.c * (b.z - a.z);
        let lo = 0, hi = 1, axis = 0, sign = 0;
        for (const [i, p, v, extent] of [[0, x, dx, o.hx + r], [1, z, dz, o.hz + r], [2, a.y - y, b.y - a.y, vertical]]) {
          if (Math.abs(v) < 1e-12) { if (Math.abs(p) > extent) hi = -1; }
          else {
            const t1 = (-extent - p) / v, t2 = (extent - p) / v, entry = Math.min(t1, t2);
            if (entry > lo) { lo = entry; axis = i; sign = -Math.sign(v); }
            hi = Math.min(hi, Math.max(t1, t2));
          }
        }
        if (lo > hi) continue;
        t = lo; nx = axis === 0 ? o.c * sign : axis === 1 ? o.s * sign : 0;
        nz = axis === 0 ? -o.s * sign : axis === 1 ? o.c * sign : 0;
      }
      if (!nx && !nz) { const len = Math.hypot(b.x - a.x, b.z - a.z) || 1; nx = (a.x - b.x) / len; nz = (a.z - b.z) / len; }
      if (!best || t < best.t) best = { t, nx, nz };
    }
    // Sampling is bounded by the 60 Hz projectile step (and a short muzzle).
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (best && t >= best.t) break;
      const p = mix(a, b, t);
      if (!safe(p.x, p.z, r)) {
        const nx = safe(a.x, p.z, r) ? Math.sign(a.x - p.x) : 0;
        const nz = safe(p.x, a.z, r) ? Math.sign(a.z - p.z) : 0;
        const len = Math.hypot(nx, nz) || 1;
        best = { t: Math.max(0, (i - 1) / steps), nx: nx / len, nz: nz / len };
        break;
      }
    }
    return best;
  }
  function bounce(e, contact) {
    let nx = contact.nx, nz = contact.nz;
    if (!nx && !nz) { nx = -Math.sin(e.heading); nz = -Math.cos(e.heading); }
    const vx = Math.sin(e.heading), vz = Math.cos(e.heading), dot = vx * nx + vz * nz;
    e.heading = Math.atan2(vx - 2 * dot * nx, vz - 2 * dot * nz);
    e.x += nx * 0.02; e.z += nz * 0.02; e.bounces++;
  }
  function update(dt, snapshots = []) {
    const next = new Map();
    for (const t of snapshots) if (t && t.id !== undefined && [t.x, t.y, t.z].every(Number.isFinite)) {
      next.set(t.id, { id: t.id, x: t.x, y: t.y, z: t.z, heading: Number.isFinite(t.heading) ? t.heading : 0,
        speed: Number.isFinite(t.speed) ? t.speed : 0, radius: Number.isFinite(t.radius) ? clamp(t.radius, 0.1, 5) : 1.12 });
    }
    const previous = targets;
    targets = next;
    if (!Number.isFinite(dt) || dt <= 0) return;
    const tracks = [...targets.values()].map(t => {
      const old = previous.get(t.id);
      return { end: t, start: old && Math.hypot(t.x - old.x, t.y - old.y, t.z - old.z) <= 80 ? old : t };
    });
    let elapsed = 0;
    while (elapsed < dt) {
      const h = entities.length ? Math.min(1 / 60, dt - elapsed) : dt - elapsed;
      for (const s of statuses.values()) {
        for (const key of ["slow", "wobble", "shield", "turbo", "grace"]) s[key] = Math.max(0, s[key] - h);
        if (!s.slow && !s.wobble && !s.shield && !s.turbo && !s.grace) statuses.delete(s.id);
      }
      for (const e of effects) e.age += h;
      effects = effects.filter(e => e.age < e.life);
      const positions = tracks.map(({ start, end }) => ({ ...end, ...mix(start, end, (elapsed + h) / dt) }));
      const starts = tracks.map(({ start, end }) => ({ ...end, ...mix(start, end, elapsed / dt) }));
      const playerIndex = positions.findIndex(t => t.id === "player");
      let first = null, fraction = Infinity;
      for (const p of pickups) {
        const ready = p.respawn;
        if (!p.available) { p.respawn = Math.max(0, p.respawn - h); p.available = p.respawn === 0; }
        if (!held && playerIndex >= 0 && p.available) {
          const b = positions[playerIndex], begin = clamp(ready / h, 0, 1), a = mix(starts[playerIndex], b, begin);
          const t = sweep({ ...a, y: a.y + 0.8 }, { ...b, y: b.y + 0.8 }, p, p, b.radius + 1.1, 1.6);
          const f = begin + (1 - begin) * t;
          if (t !== null && f < fraction) { first = p; fraction = f; }
        }
      }
      if (first) {
        held = first.type; first.respawn = Math.max(0, 18 - h * (1 - fraction)); first.available = first.respawn === 0;
        emit("collect", held, "player", `${DEFINITIONS.get(held).name}! ${DEFINITIONS.get(held).action} when ready.`);
      }
      const alive = [];
      for (const e of entities) {
        e.age += h;
        if (e.age >= e.life) continue;
        const a = { x: e.x, y: e.y, z: e.z };
        let b = a, contact = null, ground = false;
        if (e.kind === "projectile") {
          if (e.type === "homing") {
            const t = aim(e, positions);
            e.targetId = t?.id ?? null;
            if (t) {
              const angle = Math.atan2(t.x - e.x, t.z - e.z) - e.heading;
              e.heading += clamp(Math.atan2(Math.sin(angle), Math.cos(angle)), -1.3 * h, 1.3 * h);
            }
          }
          b = { x: e.x + Math.sin(e.heading) * e.speed * h, z: e.z + Math.cos(e.heading) * e.speed * h, y: e.y };
          const floor = heightAt(b.x, b.z);
          if (e.type === "ball" || e.type === "balloon") { b.y += e.vy * h - 9 * h * h; e.vy -= 18 * h; }
          else b.y += clamp(floor + 0.9 - e.y, -10 * h, 10 * h);
          contact = scenery(a, b, e.radius);
          if (b.y <= floor + e.radius) {
            const t = clamp((a.y - heightAt(a.x, a.z) - e.radius) / Math.max(1e-9, a.y - heightAt(a.x, a.z) - b.y + floor), 0, 1);
            if (!contact || t < contact.t) { contact = { t, nx: 0, nz: 0 }; ground = true; }
          }
        }
        let victim = null, fraction = contact?.t ?? Infinity;
        for (let i = 0; i < positions.length; i++) {
          const t = positions[i], s = starts[i];
          if ((t.id === e.ownerId && e.age < 1.5) || (e.kind === "hazard" && e.age < 0.35)) continue;
          if (e.type === "oil" && statuses.get(t.id)?.grace > 0) continue;
          const f = sweep(a, b, { ...s, y: s.y + 0.8 }, { ...t, y: t.y + 0.8 }, e.radius + t.radius,
            e.kind === "hazard" ? 1.3 : 1.1 + e.radius);
          if (f !== null && f < fraction) { fraction = f; victim = i; }
        }
        if (victim !== null) {
          Object.assign(e, mix(a, b, fraction));
          if (e.type === "mine" || e.type === "balloon") splash(e, positions.map((t, i) => ({ ...t, ...mix(starts[i], t, fraction) })), e.type === "mine" ? 9 : 7);
          else { hit(e.type, positions[victim]); visual("burst", e.type, e, 2); }
          if (e.type === "oil") alive.push(e);
        } else if (contact) {
          Object.assign(e, mix(a, b, contact.t));
          if (e.type === "ball") {
            if (ground) { e.y = heightAt(e.x, e.z) + e.radius + 0.01; e.vy = Math.max(3, Math.abs(e.vy) * 0.65); e.bounces++; }
            else bounce(e, contact);
            alive.push(e);
          } else if (e.type === "balloon") splash(e, positions.map((t, i) => ({ ...t, ...mix(starts[i], t, contact.t) })), 7);
          else visual("burst", e.type, e, 2);
        } else { Object.assign(e, b); alive.push(e); }
      }
      entities = alive;
      elapsed += h;
    }
  }
  function reset() {
    held = null; serial = 0; targets.clear(); statuses.clear(); entities = []; effects = [];
    for (const p of pickups) { p.available = true; p.respawn = 0; }
  }
  function state() {
    return { held, pickups: pickups.map(p => ({ ...p })), entities: entities.map(e => ({ ...e })),
      effects: effects.map(e => ({ ...e })), statuses: [...statuses.values()].map(s => ({ ...s, ...modifiers(s.id) })) };
  }
  return { update, deploy, modifiers, state, reset };
}
