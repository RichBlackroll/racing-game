import * as THREE from "three";
import { getVehicle } from "./vehicle-data.js";

const ACTIONS = new Set(["sprint", "pulse", "hop", "bubbles", "beacon", "dig", "delivery"]);
const DIG_STAGES = [.32, .58, .78];
const DELIVERY_STAGES = [.5];
const SOIL_OFFSETS = [[-.6, 0], [.6, 0], [0, -.6], [0, .6]];
const DEPOSIT_LIFETIME = 30;
const MAX_DEPOSITS = 12;
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const finitePoint = point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
const dimension = (value, fallback, max) => Number.isFinite(value) && value > 0 ? clamp(value, .25, max) : fallback;

/** Advance with gameplay seconds only. Effects never own physics or the car transform. */
export function createVehicleActions({
  scene, car, getModel, heightAt, roadDistance, isSafePosition,
  reducedMotion = false, onMessage = () => {},
}) {
  const root = new THREE.Group();
  root.name = "vehicle-actions";
  scene.add(root);
  const resources = new Set();
  function own(resource) { resources.add(resource); return resource; }
  const sphere = own(new THREE.SphereGeometry(1, 12, 8));
  const box = own(new THREE.BoxGeometry(1, 1, 1));
  const ring = own(new THREE.TorusGeometry(1, .018, 6, 64));
  const disc = own(new THREE.CircleGeometry(1, 18));
  const cylinder = own(new THREE.CylinderGeometry(1, 1, 1, 12));
  function glow(color, opacity) {
    return own(new THREE.MeshBasicMaterial({ color, opacity, transparent: true, depthWrite: false, toneMapped: false }));
  }
  const gold = glow(0xf3ce75, .48), electric = glow(0x83e7ff, .65);
  const amber = glow(0xffb947, .3), mint = glow(0xc9fff2, .6), tape = glow(0xf4ce52, .95);
  const bubbleMaterial = own(new THREE.MeshStandardMaterial({
    color: 0x9ce6ee, emissive: 0x58a8bf, emissiveIntensity: .3,
    roughness: .12, metalness: .25, transparent: true, opacity: .38, depthWrite: false,
  }));
  const soil = own(new THREE.MeshStandardMaterial({ color: 0x795337, roughness: 1, flatShading: true }));
  function mesh(name, geometry, material, parent = root) {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    // Also opt out if the scenery-shadow setup traverses the scene again later.
    object.castShadow = false;
    object.userData.castShadow = false;
    parent.add(object);
    return object;
  }
  const waves = [0, 1].map(i => {
    const object = mesh(`action-wave-${i}`, ring, electric);
    object.rotation.x = -Math.PI / 2;
    object.visible = false;
    return object;
  });
  const beacon = mesh("action-beacon", sphere, amber);
  beacon.scale.set(.18, .23, .18);
  beacon.visible = false;
  const pillars = [0, 1].map(i => {
    const object = mesh(`action-pillar-${i}`, cylinder, amber);
    object.visible = false;
    return object;
  });
  const light = new THREE.PointLight(0x83e7ff, 0, 14, 2);
  light.name = "action-light";
  light.castShadow = false;
  light.visible = false;
  root.add(light);
  const carried = mesh("action-carried-soil", sphere, soil);
  carried.visible = false;
  carried.scale.set(.32, .17, .3);

  const trails = Array.from({ length: reducedMotion ? 4 : 12 }, (_, i) => {
    const object = mesh(`action-trail-${i}`, box, gold);
    object.visible = false;
    return { object, age: 0, life: .48 };
  });
  const bubbles = Array.from({ length: reducedMotion ? 6 : 24 }, (_, i) => {
    const object = mesh(`action-bubble-${i}`, sphere, bubbleMaterial);
    const highlight = mesh("bubble-highlight", sphere, mint, object);
    highlight.position.set(-.32, .5, .72);
    highlight.scale.setScalar(.16);
    object.visible = false;
    return { object, velocity: new THREE.Vector3(), age: 0, life: 2.8, size: .1 };
  });
  // Slots own their fade material; their mark, heap and parcel share it. All
  // geometry and the small parcel straps are shared across the complete pool.
  const deposits = Array.from({ length: MAX_DEPOSITS }, (_, i) => {
    const material = own(new THREE.MeshStandardMaterial({
      color: 0x795337, roughness: 1, flatShading: true,
      transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide,
    }));
    const group = new THREE.Group();
    group.name = `action-deposit-${i}`;
    group.visible = false;
    root.add(group);
    const mark = mesh("dig-ground-mark", disc, material, group);
    mark.rotation.x = -Math.PI / 2;
    const heap = mesh("dig-heap", sphere, material, group);
    const parcel = mesh("delivery-parcel", box, material, group);
    const strap = mesh("parcel-strap", box, tape, parcel);
    strap.scale.set(.16, 1.015, 1.015);
    return {
      group, material, mark, heap, parcel, age: 0, fall: 0, completed: false,
      start: new THREE.Vector3(), end: new THREE.Vector3(), kind: "",
    };
  });

  const point = new THREE.Vector3(), origin = new THREE.Vector3(), site = new THREE.Vector3();
  const waveOrigin = new THREE.Vector3(), normal = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const groundRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const orientation = new THREE.Quaternion(), rootRotation = new THREE.Quaternion();
  let active = null, model = null, elapsed = 0, cooldown = 0, uses = 0, disposed = false;
  let length = 4.6, width = 1.9, height = 1.5;
  let trailIndex = 0, bubbleIndex = 0, depositIndex = 0, stageIndex = 0, currentDeposit = null;

  function definition(currentModel) {
    const vehicle = currentModel?.vehicle;
    if (!vehicle) return null;
    const registered = getVehicle(vehicle.id);
    const action = vehicle.action ?? (registered.id === vehicle.id ? registered.action : null);
    return action && ACTIONS.has(action.id) && Number.isFinite(action.duration) && action.duration > 0
      && Number.isFinite(action.cooldown) && action.cooldown >= 0 ? action : null;
  }
  function dimensions(currentModel) {
    const sizes = currentModel?.car?.userData.dimensions ?? car.userData.dimensions;
    length = dimension(sizes?.length, dimension(currentModel?.vehicle?.length, 4.6, 20), 20);
    width = dimension(sizes?.width, 1.9, 12);
    height = dimension(sizes?.height, 1.5, 10);
  }
  function localPoint(x, y, z, target = point) {
    return car.localToWorld(target.set(x, y, z));
  }
  function anchorPoint(currentModel, id, target = point) {
    const anchor = currentModel?.special?.anchor;
    return anchor?.isObject3D ? anchor.getWorldPosition(target)
      : localPoint(0, id === "dig" ? .2 : .9, -length / 2 - .45, target);
  }
  function parked(action) { return action.parked || action.id === "dig" || action.id === "delivery"; }
  function groundSafe(position, radius) {
    return finitePoint(position) && Number.isFinite(heightAt(position.x, position.z))
      && isSafePosition(position.x, position.z, radius);
  }
  function soilSafe(position) {
    if (!groundSafe(position, .7) || !(roadDistance(position.x, position.z) > 6)) return false;
    const y = heightAt(position.x, position.z);
    // A footprint, not just a center point: avoid steep lips and water edges.
    for (const [dx, dz] of SOIL_OFFSETS) {
      const next = heightAt(position.x + dx, position.z + dz);
      if (!Number.isFinite(next) || Math.abs(next - y) > .6) return false;
    }
    return true;
  }
  function blocked(action, currentModel, speed, airborne) {
    if (!action || disposed) return "Action unavailable";
    if (!parked(action)) return "";
    if (airborne) return "Land before using this action";
    if (!Number.isFinite(speed) || Math.abs(speed) > .5) return "Stop to use this action";
    car.getWorldPosition(origin);
    if (!groundSafe(origin, width / 2)) return action.id === "dig" ? "Find soil to dig" : "Find safe ground to park";
    // Probe the actual articulated reach, then restore the current absolute pose.
    // UI queries do not leave the bucket/doors in their probed pose.
    const special = currentModel?.special;
    const restore = active ? elapsed / active.duration : 0;
    try {
      special?.pose?.(action.id === "dig" ? .32 : .5);
      anchorPoint(currentModel, action.id, site);
    } finally { special?.pose?.(restore); }
    return (action.id === "dig" ? soilSafe(site) : groundSafe(site, .5))
      ? "" : action.id === "dig" ? "Find soil to dig" : "Find safe ground to park";
  }
  function hideCycle() {
    for (const object of waves) object.visible = false;
    for (const object of pillars) object.visible = false;
    beacon.visible = carried.visible = light.visible = false;
    light.intensity = 0;
    if (model?.special?.reset) model.special.reset();
    else model?.special?.pose?.(0);
    currentDeposit = null;
  }
  function takeDeposit(kind) {
    const deposit = deposits[depositIndex];
    depositIndex = (depositIndex + 1) % MAX_DEPOSITS;
    deposit.kind = kind;
    deposit.age = deposit.fall = 0;
    deposit.completed = false;
    deposit.group.visible = true;
    deposit.group.scale.setScalar(1);
    deposit.material.opacity = 1;
    deposit.material.color.setHex(kind === "dig" ? 0x795337 : 0xb9844d);
    deposit.mark.visible = deposit.heap.visible = deposit.parcel.visible = false;
    return deposit;
  }
  function placeOnGround(object, position, offset) {
    object.position.copy(position);
    object.position.y = heightAt(position.x, position.z) + offset;
    root.worldToLocal(object.position);
  }
  function stage(progress) {
    model?.special?.pose?.(progress);
    anchorPoint(model, active.id);
    if (active.id === "dig") {
      if (progress === .32 && soilSafe(point)) {
        currentDeposit = takeDeposit("dig");
        const mark = currentDeposit.mark;
        mark.visible = true;
        placeOnGround(mark, point, .025);
        normal.set(heightAt(point.x - .3, point.z) - heightAt(point.x + .3, point.z), .6,
          heightAt(point.x, point.z - .3) - heightAt(point.x, point.z + .3)).normalize();
        // CircleGeometry's normal is +Z; first align its ground plane, then the slope.
        mark.quaternion.setFromUnitVectors(up, normal);
        mark.quaternion.multiply(groundRotation);
        mark.scale.set(.85, .62, 1);
      } else if (progress === .58 && currentDeposit) {
        carried.visible = true;
      } else if (progress === .78 && currentDeposit) {
        carried.visible = false;
        if (!soilSafe(point)) return;
        const deposit = currentDeposit;
        deposit.completed = deposit.heap.visible = true;
        deposit.start.copy(point);
        root.worldToLocal(deposit.start);
        placeOnGround(deposit.heap, point, .16);
        deposit.end.copy(deposit.heap.position);
        deposit.heap.position.copy(deposit.start);
        deposit.heap.scale.set(.5, .26, .44);
        deposit.fall = 0;
      }
    } else if (groundSafe(point, .5)) {
      const deposit = takeDeposit("delivery");
      deposit.completed = deposit.parcel.visible = true;
      deposit.parcel.scale.set(.58, .42, .48);
      car.getWorldQuaternion(deposit.parcel.quaternion);
      root.getWorldQuaternion(rootRotation).invert();
      deposit.parcel.quaternion.premultiply(rootRotation);
      deposit.start.copy(point);
      root.worldToLocal(deposit.start);
      placeOnGround(deposit.parcel, point, .23);
      deposit.end.copy(deposit.parcel.position);
      deposit.parcel.position.copy(deposit.start);
    }
  }
  function ageEffects(dt) {
    if (dt <= 0) return;
    for (const particle of trails) if (particle.object.visible) {
      particle.age += dt;
      particle.object.visible = particle.age < particle.life;
      const fade = Math.max(0, 1 - particle.age / particle.life);
      particle.object.scale.set(.045 * fade, .035 * fade, .65 * fade);
    }
    for (const particle of bubbles) if (particle.object.visible) {
      particle.age += dt;
      particle.object.visible = particle.age < particle.life;
      if (!particle.object.visible) continue;
      particle.object.position.addScaledVector(particle.velocity, dt);
      particle.object.scale.setScalar(particle.size * (1 - smooth(particle.age, 2, particle.life)));
    }
    for (const deposit of deposits) if (deposit.group.visible) {
      deposit.age += dt;
      if (deposit.age >= DEPOSIT_LIFETIME) { deposit.group.visible = false; continue; }
      const fade = 1 - smooth(deposit.age, 25, DEPOSIT_LIFETIME);
      deposit.material.opacity = fade;
      if (!deposit.completed) continue;
      deposit.fall = Math.min(.65, deposit.fall + dt);
      const object = deposit.kind === "dig" ? deposit.heap : deposit.parcel;
      object.position.lerpVectors(deposit.start, deposit.end, (deposit.fall / .65) ** 2);
      // The strap shares a material, so shrink its whole parcel during the fade.
      if (deposit.kind === "delivery") object.scale.set(.58 * fade, .42 * fade, .48 * fade);
    }
  }
  function emit(from, to) {
    const isTrail = active.id === "sprint";
    if (!isTrail && active.id !== "bubbles") return;
    const rate = isTrail ? (reducedMotion ? 6 : 24) : (reducedMotion ? 2 : 8);
    const pool = isTrail ? trails : bubbles;
    const last = Math.floor(to * rate);
    const count = Math.min(last - Math.floor(from * rate), pool.length);
    car.getWorldQuaternion(orientation);
    root.getWorldQuaternion(rootRotation).invert();
    orientation.premultiply(rootRotation);
    for (let offset = 0; offset < count; offset++) {
      const i = last - count + offset + 1;
      const particle = pool[isTrail ? trailIndex : bubbleIndex];
      if (isTrail) trailIndex = (trailIndex + 1) % pool.length;
      else bubbleIndex = (bubbleIndex + 1) % pool.length;
      particle.age = to - i / rate;
      particle.object.visible = particle.age < particle.life;
      if (!particle.object.visible) continue;
      localPoint(isTrail ? (i % 2 ? -1 : 1) * width * .36 : 0, isTrail ? .28 : height * .55, -length / 2 - .12);
      root.worldToLocal(point);
      particle.object.position.copy(point);
      if (isTrail) {
        particle.object.quaternion.copy(orientation);
        const fade = 1 - particle.age / particle.life;
        particle.object.scale.set(.045 * fade, .035 * fade, .65 * fade);
      } else {
        particle.size = .09 + (i % 5) * .025;
        particle.velocity.set(Math.sin(i * 2.4) * .18, reducedMotion ? .35 : .62, Math.cos(i * 2.4) * .16);
        particle.object.position.addScaledVector(particle.velocity, particle.age);
        particle.object.scale.setScalar(particle.size * (1 - smooth(particle.age, 2, particle.life)));
      }
    }
  }
  function renderCycle() {
    const p = clamp(elapsed / active.duration, 0, 1);
    model?.special?.pose?.(p);
    const envelope = smooth(p, 0, .12) * (1 - smooth(p, .78, 1));
    if (active.id === "dig" && carried.visible) {
      const anchor = model?.special?.anchor;
      // The anchor is the tooth tip; put the load just inside the moving bucket.
      if (anchor?.isObject3D) anchor.localToWorld(point.set(0, .08, -.16));
      else anchorPoint(model, "dig");
      carried.position.copy(point);
      root.worldToLocal(carried.position);
      (anchor ?? car).getWorldQuaternion(carried.quaternion);
      root.getWorldQuaternion(rootRotation).invert();
      carried.quaternion.premultiply(rootRotation);
    } else if (active.id === "pulse" || active.id === "hop") {
      const pulse = active.id === "pulse";
      electric.opacity = .65 * envelope;
      mint.opacity = .6 * envelope;
      for (let i = 0; i < waves.length; i++) {
        const object = waves[i];
        object.visible = pulse ? (!reducedMotion || i === 0) : i === 0;
        object.material = pulse ? electric : mint;
        object.position.copy(waveOrigin);
        object.position.y += i * .14;
        object.scale.setScalar(pulse ? 1.3 + p * (reducedMotion ? 5 : 9) + i * .35 : 1.15 + Math.sin(Math.PI * p) * .4);
      }
      light.visible = pulse;
      light.color.setHex(0x83e7ff);
      light.position.copy(waveOrigin);
      light.position.y += .6;
      light.intensity = envelope * (reducedMotion ? 10 : 24);
    } else if (active.id === "beacon") {
      beacon.visible = light.visible = true;
      localPoint(0, height + .2, 0);
      beacon.position.copy(root.worldToLocal(point));
      light.position.copy(beacon.position);
      light.color.setHex(0xffb947);
      light.intensity = envelope * (reducedMotion ? 8 : 18);
      amber.opacity = .3 * envelope;
      for (let i = 0; i < pillars.length; i++) {
        const object = pillars[i];
        object.visible = !reducedMotion || i === 0;
        const angle = p * Math.PI * (reducedMotion ? .5 : 2) + i * Math.PI;
        localPoint(Math.cos(angle) * (width / 2 + .8), 0, Math.sin(angle) * (length / 2 + .6));
        const ground = heightAt(point.x, point.z);
        point.y = (Number.isFinite(ground) ? ground : point.y) + 1.3;
        object.position.copy(root.worldToLocal(point));
        object.scale.set(.11, 2.5 * envelope + .01, .11);
      }
    }
  }

  function activate({ speed = 0, airborne = false } = {}) {
    if (disposed) return false;
    const currentModel = getModel(), action = definition(currentModel);
    dimensions(currentModel);
    const reason = active ? "Action already active" : cooldown > 0 ? "Action cooling down"
      : blocked(action, currentModel, speed, airborne);
    if (reason) { onMessage(reason); return false; }
    model = currentModel;
    active = { ...action };
    elapsed = stageIndex = 0;
    uses++;
    currentDeposit = null;
    car.getWorldPosition(waveOrigin);
    const ground = heightAt(waveOrigin.x, waveOrigin.z);
    waveOrigin.y = (Number.isFinite(ground) ? ground : waveOrigin.y) + .12;
    root.worldToLocal(waveOrigin);
    mint.opacity = .6;
    renderCycle();
    onMessage(action.label);
    return true;
  }
  function update(dt, { speed = 0, airborne = false } = {}) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    if (active) {
      const reason = blocked(active, model, speed, airborne);
      if (reason) {
        cooldown = active.cooldown;
        hideCycle();
        active = null;
        onMessage(reason);
      }
    }
    if (!active) {
      cooldown = Math.max(0, cooldown - dt);
      ageEffects(dt);
      return;
    }
    const from = elapsed, epsilon = Number.EPSILON * Math.max(1, active.duration) * 8;
    let to = Math.min(active.duration, elapsed + dt);
    if (active.duration - to <= epsilon) to = active.duration;
    let cursor = from;
    const stages = active.id === "dig" ? DIG_STAGES : active.id === "delivery" ? DELIVERY_STAGES : [];
    // Sample every crossed event at its exact pose, even across a long frame.
    for (; stageIndex < stages.length; stageIndex++) {
      const progress = stages[stageIndex];
      const time = progress * active.duration;
      if (to + epsilon < time) break;
      ageEffects(Math.max(0, time - cursor));
      stage(progress);
      cursor = Math.min(time, to);
    }
    ageEffects(to - cursor);
    emit(from, to);
    elapsed = to;
    renderCycle();
    if (elapsed >= active.duration) {
      cooldown = active.cooldown;
      hideCycle();
      active = null;
      const rest = Math.max(0, dt - (to - from));
      cooldown = Math.max(0, cooldown - rest);
      ageEffects(rest);
    }
  }
  function reset() {
    if (disposed) return;
    hideCycle();
    active = model = null;
    elapsed = cooldown = uses = 0;
    trailIndex = bubbleIndex = depositIndex = stageIndex = 0;
    for (const particle of trails) particle.object.visible = false;
    for (const particle of bubbles) particle.object.visible = false;
    for (const deposit of deposits) deposit.group.visible = false;
  }
  function state({ speed = 0, airborne = false } = {}) {
    const currentModel = disposed ? null : getModel();
    const action = active ?? definition(currentModel);
    if (!active) dimensions(currentModel);
    return {
      id: action?.id ?? "", label: action?.label ?? "", description: action?.description ?? "",
      active: !!active, remaining: active ? Math.max(0, active.duration - elapsed) : 0,
      cooldown, blocked: active ? "" : blocked(action, currentModel, speed, airborne), uses,
      deposits: deposits.reduce((count, deposit) => count + Number(deposit.group.visible && deposit.completed), 0),
    };
  }
  function modifiers() {
    return {
      speedFactor: active?.id === "sprint" ? 1.25 : 1,
      accelFactor: active?.id === "sprint" ? 1.6 : 1,
      locked: !!active && !!parked(active),
      hop: active?.id === "hop" ? (reducedMotion ? .28 : .7) * Math.sin(Math.PI * clamp(elapsed / active.duration, 0, 1)) ** 2 : 0,
    };
  }
  function dispose() {
    if (disposed) return;
    reset();
    disposed = true;
    root.removeFromParent();
    root.clear();
    for (const resource of resources) resource.dispose();
    resources.clear();
  }
  return { activate, update, reset, state, modifiers, dispose };
}
