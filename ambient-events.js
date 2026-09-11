import * as THREE from "three";
import { createAmbientModel } from "./ambient-models.js";

const { lerp, smoothstep, clamp } = THREE.MathUtils;
const TAU = Math.PI * 2;
const actors = {
  balloon: { name: "A waving balloonist", duration: 46, altitude: 21 },
  plane: { name: "Propeller-plane flyby", duration: 25, altitude: 34 },
  helicopter: { name: "Helicopter patrol", duration: 34, altitude: 23 },
  birds: { name: "A flock of winging visitors", duration: 24, altitude: 18 },
  kite: { name: "A runaway rainbow kite", duration: 38, altitude: 27 },
  airship: { name: "The little sky cruiser", duration: 48, altitude: 32 },
  ufo: { name: "An unexpected flying saucer", duration: 29, altitude: 28 },
  satellite: { name: "A tumbling satellite", duration: 35, altitude: 42 },
  comet: { name: "A shooting star", duration: 9, altitude: 65 },
  rocket: { name: "Three, two, one... liftoff!", duration: 22, ground: true, radius: 6 },
  elephant: { name: "An elephant out for a stroll", duration: 28, ground: true, radius: 4.5, distance: 18 },
  astronaut: { name: "An astronaut's giant little leaps", duration: 30, ground: true, radius: 2.5, distance: 14 },
};

// Shuffled independently per visit; every map has at least six daytime surprises.
export const MAP_EVENTS = Object.freeze(Object.fromEntries(Object.entries({
  forest: ["balloon", "elephant", "birds", "plane", "helicopter", "kite", "comet"],
  city: ["airship", "balloon", "plane", "helicopter", "elephant", "rocket", "comet"],
  stunt: ["rocket", "plane", "balloon", "elephant", "helicopter", "ufo", "comet"],
  amsterdam: ["balloon", "birds", "plane", "helicopter", "kite", "airship", "comet"],
  wellington: ["balloon", "birds", "plane", "helicopter", "kite", "airship", "comet"],
  moon: ["rocket", "ufo", "satellite", "comet", "astronaut", "elephant"],
}).map(([level, types]) => [level, Object.freeze(types.map(type => Object.freeze({
  id: type, type, ...actors[type], nightOnly: type === "comet" && level !== "moon",
  name: level === "moon" && type === "elephant" ? "A space elephant on moonwalk" : actors[type].name,
})))])));

/** Decorative only: never adds colliders, steals the camera, or owns a timer.
 * Advance with active elapsed seconds. update(0) and setNight() never advance events.
 */
export function createAmbientEvents({ scene, course, level = "forest", obstacles = [], sites = [],
  tablet = false, reducedMotion = false, random = Math.random }) {
  const catalog = MAP_EVENTS[level];
  if (!catalog) throw new RangeError(`Unknown ambient map: ${level}`);
  const group = new THREE.Group();
  group.name = "ambient-events";
  scene.add(group);
  const models = new Map(), active = [], counts = Object.fromEntries(catalog.map(e => [e.id, 0]));
  let bag = [], lastId, time = 0, nextIn = 1.5, night = 0, disposed = false, performanceMode = tablet;
  const limit = () => reducedMotion ? 1 : performanceMode ? 2 : 3;
  const range = (a, b) => lerp(a, b, random());

  for (const event of catalog) {
    const model = createAmbientModel(event.type, { level, tablet, reducedMotion });
    const materials = new Map();
    model.group.traverse(object => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (materials.has(material)) continue;
        materials.set(material, material.opacity);
        // One precompiled transparent variant lets arrivals fade, rather than pop into existence.
        material.transparent = true;
        // Ground fog should not erase aircraft above it; depth testing still hides them behind scenery.
        if (!event.ground) material.fog = false;
      }
    });
    model.group.visible = false;
    group.add(model.group);
    models.set(event.id, { ...model, materials });
  }

  function nearObstacle(x, z, radius, obstacle) {
    return obstacle.hx === undefined
      ? Math.hypot(x - obstacle.x, z - obstacle.z) < (obstacle.r ?? 0) + radius
      : Math.hypot(Math.max(0, Math.abs(x - obstacle.x) - obstacle.hx),
        Math.max(0, Math.abs(z - obstacle.z) - obstacle.hz)) < radius;
  }

  function groundPath(event, position, heading) {
    const radius = event.radius, distance = event.distance ?? 0;
    const nearby = sites.filter(site => Math.hypot(site.x - position.x, site.z - position.z) < 170);
    for (let attempt = 0; attempt < 64; attempt++) {
      const angle = heading + range(-0.5, 0.5), ahead = range(36, 120);
      let x = position.x + Math.sin(angle) * ahead, z = position.z + Math.cos(angle) * ahead;
      if (attempt < nearby.length * 4) {
        const site = nearby[attempt % nearby.length], a = range(0, TAU), r = (site.radius ?? 20) + radius + 5;
        x = site.x + Math.sin(a) * r; z = site.z + Math.cos(a) * r;
      }
      if (Math.hypot(x - position.x, z - position.z) < 28) continue;
      const direction = heading + (random() < 0.5 ? -1 : 1) * Math.PI / 2 + range(-0.35, 0.35);
      const from = new THREE.Vector3(x, 0, z);
      const to = new THREE.Vector3(x + Math.sin(direction) * distance, 0, z + Math.cos(direction) * distance);
      const forwardX = Math.sin(heading), forwardZ = Math.cos(heading);
      if ([from, to].some(p => {
        const dx = p.x - position.x, dz = p.z - position.z;
        const ahead = dx * forwardX + dz * forwardZ;
        return ahead < 30 || Math.abs(dx * forwardZ - dz * forwardX) > ahead * 0.8;
      })) continue;
      let safe = true, previousY;
      // Check the entire swept footprint, not just endpoints, so visitors avoid water and roads.
      const steps = Math.max(1, Math.ceil(distance / 1.5));
      for (let i = 0; i <= steps && safe; i++) {
        const px = lerp(from.x, to.x, i / steps), pz = lerp(from.z, to.z, i / steps);
        const y = course.heightAt(px, pz);
        safe = Number.isFinite(y) && Math.max(Math.abs(px), Math.abs(pz)) + radius < course.halfSize
          && (!course.isSafePosition || course.isSafePosition(px, pz, radius))
          && course.roadDistance(px, pz) > 8 + radius
          && !obstacles.some(o => nearObstacle(px, pz, radius + 1, o))
          && (previousY === undefined || Math.abs(y - previousY) < 0.65);
        for (let j = 0; j < 8 && safe; j++) {
          const a = j * TAU / 8, xx = px + Math.sin(a) * radius, zz = pz + Math.cos(a) * radius;
          safe = Math.abs(course.heightAt(xx, zz) - y) < 0.85
            && (!course.isSafePosition || course.isSafePosition(xx, zz, 0.5));
        }
        previousY = y;
      }
      if (safe) {
        from.y = course.heightAt(from.x, from.z) + 0.12;
        to.y = course.heightAt(to.x, to.z) + 0.12;
        return { from, to, heading: direction };
      }
    }
    return null;
  }

  function skyPath(event, position, heading) {
    const angle = heading + range(-0.16, 0.16), direction = random() < 0.5 ? -1 : 1;
    let forward = range(190, 230);
    const span = event.type === "comet" ? 235 : 160;
    const dx = Math.cos(angle) * span * direction, dz = -Math.sin(angle) * span * direction;
    const from = new THREE.Vector3(), to = new THREE.Vector3();
    const altitude = event.altitude + range(0, 5), top = event.type === "balloon" ? 14 : 8;
    let floor, scale;
    for (let attempt = 0; attempt < 5; attempt++) {
      const cx = position.x + Math.sin(angle) * forward, cz = position.z + Math.cos(angle) * forward;
      from.set(cx - dx, 0, cz - dz); to.set(cx + dx, 0, cz + dz);
      scale = Math.min(1.8, Math.max(1, forward / 220));
      floor = Math.max(position.y, 0);
      for (let i = 0; i <= 40; i++) {
        const x = lerp(from.x, to.x, i / 40), z = lerp(from.z, to.z, i / 40);
        floor = Math.max(floor, course.heightAt(x, z));
        for (const o of obstacles) if (nearObstacle(x, z, 14 * scale, o))
          floor = Math.max(floor, (o.y ?? course.heightAt(o.x, o.z)) + (o.height ?? 18));
      }
      // Tall skylines need a more distant corridor, not a flyby clipped above the driving view.
      // Enlarge distant toy silhouettes a little without attaching them to the moving camera.
      const needed = Math.min(720, (floor + altitude + top * scale - position.y) / Math.tan(10 * Math.PI / 180));
      if (needed <= forward + 5 || attempt === 4) break;
      forward = needed;
    }
    from.y = floor + altitude;
    to.y = from.y + (event.type === "comet" ? -24 : range(-2, 4));
    return { from, to, scale, heading: Math.atan2(dx, dz) };
  }

  function start(position, heading) {
    if (!bag.length) {
      bag = catalog.filter(e => !e.nightOnly || night > 0.45).slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    for (let i = 0; i < bag.length; i++) {
      const event = bag[i];
      if ((event.nightOnly && night <= 0.45) || active.some(e => e.id === event.id)
        || (event.id === lastId && bag.length > 1)) continue;
      const path = event.ground ? groundPath(event, position, heading) : skyPath(event, position, heading);
      if (!path) continue;
      bag.splice(i, 1);
      const model = models.get(event.id);
      const entry = { ...event, ...path, age: 0, model, opacity: 0 };
      model.group.position.copy(path.from);
      model.group.rotation.set(0, path.heading, 0);
      model.group.scale.setScalar(path.scale ?? 1);
      active.push(entry);
      counts[event.id]++;
      lastId = event.id;
      paint(entry);
      return true;
    }
    // Daytime can leave only night visitors, or a crowded district can block a ground act.
    // Retry the full lineup next time instead of starving all remaining sky activity.
    bag = [];
    return false;
  }

  function paint(entry) {
    const p = clamp(entry.age / entry.duration, 0, 1), node = entry.model.group;
    node.position.lerpVectors(entry.from, entry.to, p);
    if (entry.ground) node.position.y = course.heightAt(node.position.x, node.position.z) + 0.12;
    else if (!reducedMotion && entry.type !== "comet") node.position.y += Math.sin(p * Math.PI) * 2.5;
    if (entry.type === "comet") node.rotation.x = Math.atan2(entry.from.y - entry.to.y,
      Math.hypot(entry.to.x - entry.from.x, entry.to.z - entry.from.z));
    const fadeSeconds = entry.type === "comet" ? 0.7 : 1.8;
    entry.opacity = smoothstep(entry.age, 0, fadeSeconds) * (1 - smoothstep(entry.age, entry.duration - fadeSeconds, entry.duration))
      * (entry.nightOnly ? smoothstep(night, 0.1, 0.5) : 1)
      * (entry.fadeOut === undefined ? 1 : smoothstep(entry.fadeOut, 0, 1.8));
    node.visible = entry.opacity > 0.001;
    entry.model.update({ time: entry.age, progress: p, night });
    for (const [material, opacity] of entry.model.materials) material.opacity = opacity * entry.opacity;
  }

  function setNight(value) {
    if (disposed || !Number.isFinite(value)) return;
    const next = clamp(value, 0, 1);
    if (night === next) return;
    if (night <= 0.45 && next > 0.45) {
      for (const event of catalog) if (event.nightOnly && !bag.includes(event)) bag.unshift(event);
    }
    night = next;
    for (const entry of active) paint(entry);
  }

  return {
    group,
    setNight,
    update(dt, position, heading = 0) {
      if (disposed || !Number.isFinite(dt) || dt <= 0 || !position
        || ![position.x, position.y, position.z, heading].every(Number.isFinite)) return;
      const step = Math.min(dt, 1) * (reducedMotion ? 0.5 : 1);
      time += step;
      nextIn -= step;
      for (let i = active.length - 1; i >= 0; i--) {
        const entry = active[i];
        entry.age += step;
        if (entry.fadeOut !== undefined) entry.fadeOut -= step;
        if (entry.age >= entry.duration || entry.fadeOut <= 0) {
          entry.model.group.visible = false;
          active.splice(i, 1);
        } else paint(entry);
      }
      if (nextIn <= 0 && active.length < limit()) {
        const started = start(position, heading);
        nextIn = started ? range(performanceMode ? 13 : 8, performanceMode ? 19 : 14) : 3;
      }
    },
    setPerformanceMode(enabled) {
      if (disposed || typeof enabled !== "boolean") return;
      performanceMode = enabled;
      // Finish surplus visitors with their normal fade rather than removing them abruptly.
      for (let i = limit(); i < active.length; i++) active[i].fadeOut ??= 1.8;
    },
    reset() {
      if (disposed) return;
      for (const model of models.values()) model.group.visible = false;
      active.length = 0;
      bag = [];
      lastId = undefined;
      time = 0; nextIn = 1.5;
      for (const id of Object.keys(counts)) counts[id] = 0;
    },
    state: () => ({ time, nextIn: Math.max(0, nextIn), limit: limit(), disposed,
      catalog: catalog.map(e => e.id), counts: { ...counts },
      active: active.map(e => ({ id: e.id, name: e.name, age: e.age, duration: e.duration,
        position: e.model.group.position.toArray(), from: e.from.toArray(), to: e.to.toArray(), opacity: e.opacity })) }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const model of models.values()) model.dispose();
      models.clear(); active.length = 0; bag = [];
      group.removeFromParent();
    },
  };
}
