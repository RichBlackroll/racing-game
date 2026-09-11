import * as THREE from "three";
import { friends } from "./friends.js";
import { computeTuning } from "./modifier-data.js";
import { createFriendRacerCar } from "./friend-racer-car.js";
import { sampleDrivingSurface } from "./driving-terrain.js";
import { stepRacerBodies } from "./racer-physics.js";

const builds = [
  { color: "red", wheels: "wide", suspension: "sport", engine: "six", spoiler: "big", rocket: "small" },
  { color: "yellow", wheels: "standard", suspension: "sport", engine: "four", spoiler: "stock", rocket: "big" },
  { color: "blue", wheels: "hub", suspension: "standard", engine: "electric", spoiler: "stock", rocket: "none" },
  { color: "pink", wheels: "wide", suspension: "sport", engine: "eight", spoiler: "mega", rocket: "big" },
  { color: "green", wheels: "monster", suspension: "lift", engine: "six", spoiler: "big", rocket: "small" },
];
export const FRIEND_RACERS = friends.map((friend, i) => ({ ...friend, config: builds[i] }));
const clamp = THREE.MathUtils.clamp;
const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createFriendRacers({ scene, course, obstacles = [], ramps = [], gravity = 9.82, contactTexture = null, onRace = () => {} }) {
  const { route, length, heightAt } = course;
  const distances = [0];
  for (let i = 1; i <= route.length; i++) distances.push(distances[i - 1] + route[i - 1].distanceTo(route[i % route.length]));
  const wrap = (s) => ((s % length) + length) % length;
  const gap = (a, b) => wrap(a - b + length / 2) - length / 2;
  function road(s, lane = 0) {
    s = wrap(s);
    let low = 0, high = route.length - 1;
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (distances[mid] > s) high = mid - 1; else low = mid; }
    const a = route[low], b = route[(low + 1) % route.length];
    const t = (s - distances[low]) / (distances[low + 1] - distances[low]);
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    return { x: a.x + (b.x - a.x) * t + Math.cos(heading) * lane,
      z: a.z + (b.z - a.z) * t - Math.sin(heading) * lane, heading };
  }
  const racers = FRIEND_RACERS.map((friend, i) => {
    const visual = createFriendRacerCar(friend, friend.config);
    scene.add(visual.car);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 6.5, 2, 2),
      new THREE.MeshBasicMaterial({ map: contactTexture, color: contactTexture ? 0xffffff : 0x18212b,
        opacity: contactTexture ? .8 : .15, transparent: true, depthWrite: false }));
    shadow.name = `racer-shadow-${friend.name}`; scene.add(shadow);
    return { ...visual, friend, index: i, tune: computeTuning(friend.config), shadow,
      shadowCoordinates: shadow.geometry.attributes.position.array.slice(),
      body: { x: 0, y: 0, z: 0, vx: 0, vz: 0, radius: i === 4 ? 2.25 : 1.65, mass: i === 4 ? 1.35 : 1 },
      along: 0, lane: 0, speed: 0, heading: 0, mode: "cruise", pack: null, challenge: 0, cooldown: 0, packCooldown: 0,
      boostRemaining: 0, boostCooldown: 0, boosts: 0, recovery: 0, collisions: 0, passLane: 0, passTime: 0,
      verticalSpeed: 0, onRamp: false, airborne: false };
  });
  let packs = [], nextPack = 1, noticeCooldown = 0;
  function pose(r, dt) {
    const p = r.body, oldHeading = r.heading, roadHeading = road(r.along).heading;
    const drift = Math.hypot(p.vx, p.vz) > 1 ? clamp(angle(Math.atan2(p.vx, p.vz) - roadHeading), -.7, .7) : 0;
    r.heading = roadHeading + drift * (r.recovery ? .8 : .3);
    const surface = sampleDrivingSurface(heightAt, p.x, p.z, r.heading);
    let support = surface.height, rampPitch = 0, onRamp = false;
    for (const ramp of ramps) {
      const dx = p.x - ramp.x, dz = p.z - ramp.z;
      const along = dx * Math.sin(ramp.heading) + dz * Math.cos(ramp.heading);
      const across = dx * Math.cos(ramp.heading) - dz * Math.sin(ramp.heading);
      if (along >= 0 && along <= ramp.length && Math.abs(across) < ramp.width / 2) {
        support = Math.max(support, (ramp.y ?? 0) + .075 + along * ramp.height / ramp.length);
        rampPitch = Math.atan2(ramp.height, ramp.length); onRamp = true;
      }
    }
    let y = support, pitch = onRamp ? rampPitch : surface.pitch;
    if (dt && (r.airborne || (r.onRamp && !onRamp))) {
      r.verticalSpeed -= gravity * dt;
      y = Math.max(support, r.car.position.y + r.verticalSpeed * dt);
      r.airborne = y > support + .02;
      if (r.airborne) pitch = clamp(Math.atan2(r.verticalSpeed, Math.max(1, r.speed)), -.3, .3);
    }
    if (!r.airborne) r.verticalSpeed = onRamp ? r.speed * Math.tan(rampPitch) : 0;
    r.onRamp = onRamp;
    r.car.position.set(p.x, y + .08, p.z);
    // Store the root at road height; the .08 m road offset must not accumulate in flight.
    if (r.airborne) r.car.position.y = y;
    r.car.rotation.set(-pitch, r.heading, surface.roll, "YXZ");
    for (const w of r.wheels) {
      w.pivot.rotation.y = w.front && dt ? clamp(angle(r.heading - oldHeading) / dt * .35, -.36, .36) : 0;
      w.tire.rotation.x += r.speed * dt / w.radius; w.hub.rotation.x += r.speed * dt / w.radius;
    }
    p.y = r.car.position.y;
    r.flame.visible = r.boostRemaining > 0;
    r.flame.scale.z = 1 + Math.sin(r.boostRemaining * 35) * .12;
    const positions = r.shadow.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = r.shadowCoordinates[i * 3], z = -r.shadowCoordinates[i * 3 + 1];
      const wx = p.x + Math.cos(r.heading) * x + Math.sin(r.heading) * z;
      const wz = p.z - Math.sin(r.heading) * x + Math.cos(r.heading) * z;
      positions.setXYZ(i, wx, heightAt(wx, wz) + .12, wz);
    }
    positions.needsUpdate = true; r.shadow.geometry.computeBoundingSphere();
    r.shadow.material.opacity = Math.max(.15, .8 - (r.car.position.y - surface.height) * .08);
  }
  function reset(position = route[0]) {
    const start = course.nearest(position.x, position.z).along;
    packs = []; nextPack = 1; noticeCooldown = 0;
    racers.forEach((r, i) => {
      Object.assign(r, { along: wrap(start + [18, 48, 140, 170, 205][i]), lane: i % 2 ? -2.5 : 2.5,
        speed: 0, mode: "cruise", pack: null, challenge: 0, cooldown: 0, packCooldown: 0, verticalSpeed: 0, onRamp: false, airborne: false,
        boostRemaining: 0, boostCooldown: 1 + i * .7, boosts: 0, recovery: 0, collisions: 0, passLane: 0, passTime: 0 });
      const p = road(r.along, r.lane);
      Object.assign(r.body, { x: p.x, z: p.z, vx: 0, vz: 0, hits: 0, staticHits: 0, impact: 0 });
      for (const w of r.wheels) { w.tire.rotation.x = 0; w.hub.rotation.x = 0; }
      pose(r, 0);
    });
  }
  function canSee(a, b) {
    if (a.distanceTo(b) > 62) return false;
    // Tall scenery occludes a sight line; small roadside props do not hide cars.
    for (const o of obstacles) {
      if ((o.height ?? 0) < 2.5) continue;
      for (let i = 1; i < 8; i++) {
        const t = i / 8, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const y = a.y + (b.y - a.y) * t + 1.2;
        if (y < (o.y ?? 0) || y > (o.y ?? 0) + o.height) continue;
        if (o.hx !== undefined ? Math.abs(x - o.x) < o.hx && Math.abs(z - o.z) < o.hz : Math.hypot(x - o.x, z - o.z) < o.r) return false;
      }
    }
    return true;
  }
  function update(dt, player, playerHeading, playerSpeed, velocity = { x: Math.sin(playerHeading) * playerSpeed, z: Math.cos(playerHeading) * playerSpeed }) {
    if (!Number.isFinite(dt) || dt <= 0) return { x: player.x, z: player.z, vx: velocity.x, vz: velocity.z, hits: 0, staticHits: 0 };
    dt = Math.min(dt, .05); noticeCooldown = Math.max(0, noticeCooldown - dt);
    const playerRoad = course.nearest(player.x, player.z);
    for (const r of racers) {
      r.cooldown = Math.max(0, r.cooldown - dt); r.challenge = Math.max(0, r.challenge - dt);
      r.packCooldown = Math.max(0, r.packCooldown - dt);
      if (!r.cooldown && playerRoad.distance < 9 && Math.abs(gap(r.along, playerRoad.along)) < 40 &&
          r.car.position.distanceTo(player) < 28 && canSee(r.car.position, player)) {
        r.challenge = 20; r.cooldown = 24;
        if (!noticeCooldown) { onRace(`${r.friend.name} wants to race! Follow the road!`); noticeCooldown = 8; }
      }
    }
    for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i], b = racers[j];
      if ((a.pack && b.pack) || a.packCooldown || b.packCooldown) continue;
      if (Math.abs(gap(a.along, b.along)) > 65 || Math.cos(a.heading - b.heading) < .35 || !canSee(a.car.position, b.car.position)) continue;
      let pack = packs.find(p => p.id === (a.pack || b.pack));
      if (!pack) { pack = { id: nextPack++, members: [], phase: "gather", time: 0 }; packs.push(pack); }
      if (pack.phase !== "gather") continue;
      for (const r of [a, b]) if (!r.pack) { r.pack = pack.id; pack.members.push(r); }
    }
    for (const pack of packs) {
      pack.time += dt;
      const anchor = pack.members[0].along;
      pack.members.sort((a, b) => gap(b.along, anchor) - gap(a.along, anchor));
      const span = gap(pack.members[0].along, pack.members.at(-1).along);
      if (pack.phase === "gather" && ((span < pack.members.length * 12 + 5 && pack.time > 1.5) || pack.time > 6)) {
        pack.phase = "race"; pack.time = 0;
      }
      if (pack.phase === "race" && pack.time > 32) {
        for (const r of pack.members) { r.pack = null; r.packCooldown = 8; }
      }
    }
    packs = packs.filter(p => p.members[0].pack === p.id);
    const playerPoint = road(playerRoad.along);
    const playerLane = (player.x - playerPoint.x) * Math.cos(playerPoint.heading) - (player.z - playerPoint.z) * Math.sin(playerPoint.heading);
    // Plan overtakes from one snapshot. Racing has no fixed order or convoy tether.
    const plans = racers.map(r => {
      const pack = packs.find(p => p.id === r.pack);
      const challenged = r.challenge > 0 || pack?.members.some(m => m.challenge > 0);
      r.mode = challenged ? "race-player" : pack ? pack.phase === "gather" ? "gather" : "race-friends" : "cruise";
      const racing = r.mode.startsWith("race"), top = 32 * r.tune.top;
      let target = top * (racing ? 1 : .8), lane = r.index % 2 ? -2.5 : 2.5;
      if (pack?.phase === "gather" && !challenged) {
        const rank = pack.members.indexOf(r), lead = pack.members[0];
        const behind = gap(lead.along, r.along);
        lane = rank % 2 ? -2.5 : 2.5;
        target = Math.min(top, 23 + clamp((behind - rank * 10) * .8, -3, 24));
      }
      // Curvature plus braking distance allows full engine/rocket speed on straights.
      let cornerLimit = Infinity;
      // Dense samples must not skip a tight city turn between two long straights.
      for (let ahead = 0; ahead <= Math.max(90, r.speed * r.speed / 64 + 20); ahead += 4) {
        const curvature = Math.abs(angle(road(r.along + ahead + 3).heading - road(r.along + ahead - 3).heading)) / 6;
        const insideCurvature = curvature / Math.max(.3, 1 - Math.abs(r.lane) * curvature);
        cornerLimit = Math.min(cornerLimit, Math.sqrt(24 * r.tune.steer / Math.max(.0001, insideCurvature) + 2 * 30 * ahead));
      }
      const traffic = racers.filter(other => other !== r && Math.abs(other.body.y - r.body.y) < 1.8)
        .map(other => ({ ahead: gap(other.along, r.along), lane: other.lane, speed: other.speed, radius: other.body.radius }));
      if (playerRoad.distance < 9 && Math.abs(player.y - r.body.y) < 1.8) traffic.push({
        ahead: gap(playerRoad.along, r.along), lane: playerLane,
        speed: Math.max(0, velocity.x * Math.sin(playerPoint.heading) + velocity.z * Math.cos(playerPoint.heading)), radius: 1.12,
      });
      const rival = traffic.filter(other => other.ahead > 0 && other.ahead < 90).sort((a, b) => a.ahead - b.ahead)[0];
      r.passTime = Math.max(0, r.passTime - dt);
      if (rival && rival.ahead < Math.max(25, r.speed * 1.2) && Math.abs(r.lane - rival.lane) < r.body.radius + rival.radius + .3) {
        const passingLane = rival.lane >= 0 ? -2.5 : 2.5;
        if (!traffic.some(other => Math.abs(other.ahead) < 12 && Math.abs(other.lane - passingLane) < r.body.radius + other.radius + .2)) {
          r.passLane = passingLane; r.passTime = 3;
        }
      }
      if (r.passTime) lane = r.passLane;
      let trafficLimit = Infinity;
      for (const other of traffic) if (other.ahead > 0 && Math.abs(r.lane - other.lane) < r.body.radius + other.radius + .25) {
        trafficLimit = Math.min(trafficLimit, Math.sqrt(other.speed ** 2 + 2 * 38 * Math.max(0, other.ahead - 5)));
      }
      r.recovery = Math.max(0, r.recovery - dt);
      r.boostCooldown = Math.max(0, r.boostCooldown - dt);
      const safeBoost = racing && !r.recovery && !r.airborne && Math.abs(r.lane) < 4 && cornerLimit > top * 1.08 && trafficLimit > top * 1.05;
      if (r.boostRemaining > 0) {
        r.boostRemaining = safeBoost ? Math.max(0, r.boostRemaining - dt) : 0;
        if (!r.boostRemaining) r.boostCooldown = 5 + r.index * .6;
      }
      if (safeBoost && !r.boostCooldown && !r.boostRemaining && r.friend.config.rocket !== "none" && r.speed > 15) {
        r.boostRemaining = 5 * r.tune.boostTime; r.boosts++;
      }
      if (r.boostRemaining) target = top * 1.5 * r.tune.boostTop;
      target = Math.min(target, cornerLimit, trafficLimit);
      if (Math.abs(r.lane) > 6) target = Math.min(target, 17 * r.tune.offroadTop);
      const thrust = r.boostRemaining ? (24 + 10 * r.tune.accel) * r.tune.boostTop : 12 * r.tune.accel;
      const roadHeading = road(r.along).heading;
      const forwardSpeed = Math.max(0, r.body.vx * Math.sin(roadHeading) + r.body.vz * Math.cos(roadHeading));
      const speed = Math.max(0, forwardSpeed + clamp(target - forwardSpeed, -38 * dt, thrust * dt));
      const aimHeading = road(r.along + Math.min(2, speed * .06)).heading;
      const lateral = clamp((lane - r.lane) * 3, -4.5, 4.5);
      const normalize = Math.max(speed, Math.abs(lateral)) / (Math.hypot(speed, lateral) || 1);
      const vx = (Math.sin(aimHeading) * speed + Math.cos(aimHeading) * lateral) * normalize;
      const vz = (Math.cos(aimHeading) * speed - Math.sin(aimHeading) * lateral) * normalize;
      const dx = vx - r.body.vx, dz = vz - r.body.vz;
      // Impact momentum survives steering. A shunted racer slides out, then drives back.
      const correction = Math.min(1, (r.recovery ? 3.5 : 65 * r.tune.steer) * dt / (Math.hypot(dx, dz) || 1));
      return { vx: r.body.vx + dx * correction, vz: r.body.vz + dz * correction };
    });
    racers.forEach((r, i) => Object.assign(r.body, plans[i]));
    const playerBody = { x: player.x, y: player.y, z: player.z, vx: velocity.x, vz: velocity.z, radius: 1.12, mass: 1.6, hits: 0, staticHits: 0 };
    const bodies = racers.map(r => r.body);
    if (Math.abs(player.x) <= course.halfSize + 10 && Math.abs(player.z) <= course.halfSize + 10) bodies.push(playerBody);
    stepRacerBodies(bodies, dt, obstacles, course.halfSize, course.isSafePosition);
    for (const r of racers) {
      const hit = course.nearest(r.body.x, r.body.z), center = road(hit.along);
      r.along = hit.along;
      r.lane = (r.body.x - center.x) * Math.cos(center.heading) - (r.body.z - center.z) * Math.sin(center.heading);
      r.speed = Math.hypot(r.body.vx, r.body.vz);
      r.collisions += r.body.hits + r.body.staticHits;
      if (r.body.impact > 3 || r.body.staticHits) {
        r.recovery = Math.max(r.recovery, clamp(r.body.impact * .055, .35, 1.6));
        r.boostRemaining = 0; r.boostCooldown = Math.max(r.boostCooldown, 3);
      }
      pose(r, dt);
    }
    return { x: playerBody.x, z: playerBody.z, vx: playerBody.vx, vz: playerBody.vz,
      hits: playerBody.hits + playerBody.staticHits, staticHits: playerBody.staticHits };
  }
  reset();
  return {
    update, reset,
    drawMap(ctx, scale) {
      for (const r of racers) {
        ctx.fillStyle = r.friend.color; ctx.strokeStyle = "#18212b"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(r.car.position.x * scale, -r.car.position.z * scale, r.mode.startsWith("race") ? 4 : 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    },
    state: () => racers.map(r => ({ name: r.friend.name, config: { ...r.friend.config }, position: r.car.position.toArray(),
      heading: r.heading, speed: r.speed, along: r.along, lane: r.lane, mode: r.mode, pack: r.pack, airborne: r.airborne, visuals: r.visuals,
      velocity: { x: r.body.vx, z: r.body.vz }, collisions: r.collisions, recovering: r.recovery > 0,
      boosting: r.boostRemaining > 0, boostRemaining: r.boostRemaining, boostCooldown: r.boostCooldown, boosts: r.boosts, flameVisible: r.flame.visible })),
  };
}
