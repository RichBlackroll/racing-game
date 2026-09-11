import * as THREE from "three";
import * as CANNON from "cannon-es";
import { rampShape } from "./jumps.js";
import { addSceneryBodies, createTerrainBody } from "./terrain-physics.js";

const PALETTE = [0xff5f7a, 0xffc94d, 0x3db9f2, 0x7ee887];
const WHITE = 0xfff4ec;

// Unit-size visual geometries; each instance gets its own scale from the matrix.
const PARTS = {
  ball: [
    () => new THREE.SphereGeometry(1, 14, 10),
    () => new THREE.TorusGeometry(0.94, 0.085, 6, 20),
  ],
  block: [() => new THREE.BoxGeometry(1, 1, 1)],
  tire: [
    () => new THREE.TorusGeometry(1, 0.24, 10, 22),
    () => new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12),
  ],
};
const MATERIALS = {
  ball: [
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 }),
    () => new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.6 }),
  ],
  block: [
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.75 }),
  ],
  tire: [
    () => new THREE.MeshStandardMaterial({ color: 0x26292c, roughness: 0.9 }),
    () => new THREE.MeshStandardMaterial({ color: 0xd8d6d2, roughness: 0.7 }),
  ],
};

const DEFAULTS = {
  ball: {
    sizeRange: [0.6, 1.0],
    mass: 1.1,
    restitution: 0.5,
    friction: 0.4,
    linearDamping: 0.12,
    angularDamping: 0.5,
    shape: (s) => new CANNON.Sphere(s),
    restY: (s) => 0.075 + s,
  },
  block: {
    sizeRange: [0.7, 1.15],
    mass: 1.6,
    restitution: 0.22,
    friction: 0.5,
    linearDamping: 0.3,
    angularDamping: 0.6,
    shape: (s) => new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)),
    restY: (s) => 0.075 + s / 2,
  },
  tire: {
    sizeRange: [0.85, 1.1],
    mass: 2.4,
    restitution: 0.3,
    friction: 0.8,
    linearDamping: 0.35,
    angularDamping: 0.25,
    shape: (s) => new CANNON.Cylinder(s, s, 0.55, 14),
    restY: () => 0.075 + 0.275,
  },
};

function axisAngle(ax, ay, az, angle) {
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: c };
}
function qmul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

// A tire lies flat: its torus axis (+z) must be rotated up to +y.
const TIRE_ALIGN = axisAngle(1, 0, 0, -Math.PI / 2);

export function createPlaythings({
  scene,
  route,
  obstacles = [],
  ramps = [],
  roadDist = () => 0,
  gravity = 9.82,
  terrain = null,
  kinds = {},
  onChange = () => {},
}) {
  const order = ["ball", "block", "tire"].filter((k) => kinds[k]?.count);
  const toys = [];
  const hasSafePosition = typeof terrain?.isSafePosition === "function";
  let seed = 2468;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const kind of order) {
    const cfg = kinds[kind];
    const rule = DEFAULTS[kind];
    const lo = cfg.sizeRange?.[0] ?? rule.sizeRange[0];
    const hi = cfg.sizeRange?.[1] ?? rule.sizeRange[1];
    for (let i = 0; i < cfg.count; i++) {
      toys.push({
        kind,
        rule,
        size: lo + rnd() * (hi - lo),
        colorIndex: i % PALETTE.length,
      });
    }
  }
  if (!toys.length) return { update() {}, reset() {}, state: () => ({ count: 0, hits: 0 }) };

  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -gravity, 0),
    allowSleep: true,
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 8;
  world.defaultContactMaterial.friction = 0.55;
  world.defaultContactMaterial.restitution = 0.25;
  const floor = createTerrainBody(terrain, {
    collisionFilterGroup: 1,
    collisionFilterMask: 3,
  });
  world.addBody(floor);
  // The car stays kinematic here, exactly like the cone field.
  const carBody = new CANNON.Body({
    type: CANNON.Body.KINEMATIC,
    collisionFilterGroup: 4,
    collisionFilterMask: 3,
  });
  carBody.addShape(new CANNON.Box(new CANNON.Vec3(1.05, 0.55, 2.2)));
  world.addBody(carBody);
  addSceneryBodies(world, obstacles, terrain, 3);
  for (const ramp of ramps) {
    const body = new CANNON.Body({
      mass: 0,
      collisionFilterGroup: 8,
      collisionFilterMask: 3,
    });
    body.addShape(rampShape(ramp));
    body.position.set(ramp.x, (ramp.y ?? 0) + 0.075, ramp.z);
    body.quaternion.setFromEuler(0, ramp.heading, 0);
    world.addBody(body);
  }

  // One instanced mesh per (kind, colour) group; a toy's parts share that group.
  const groups = new Map();
  for (const t of toys) {
    const key = t.kind + "|" + t.colorIndex;
    if (!groups.has(key)) groups.set(key, { count: 0, used: 0, meshes: [] });
    groups.get(key).count++;
  }
  const allMeshes = [];
  for (const [key, g] of groups) {
    const [kind, ci] = key.split("|");
    g.meshes = PARTS[kind].map((geo, pi) => {
      const mesh = new THREE.InstancedMesh(
        geo(),
        MATERIALS[kind][pi](PALETTE[Number(ci)]),
        g.count,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      allMeshes.push(mesh);
      return mesh;
    });
  }

  function findSpot(t) {
    for (let attempt = 0; attempt < 70; attempt++) {
      const i = Math.floor(rnd() * route.length);
      const p = route[i], a = route[(i + 1) % route.length];
      let nx = a.z - p.z, nz = p.x - a.x;
      const len = Math.hypot(nx, nz);
      if (hasSafePosition && len < 1e-6) continue;
      nx /= len;
      nz /= len;
      const dist = 9.5 + rnd() * (ramps.length ? 22 : 42);
      const side = rnd() < 0.5 ? 1 : -1;
      const x = p.x + nx * dist * side + (rnd() - 0.5) * 14;
      const z = p.z + nz * dist * side + (rnd() - 0.5) * 14;
      const bound = terrain ? terrain.halfSize - t.size : 320;
      if (Math.abs(x) > bound || Math.abs(z) > bound) continue;
      if (hasSafePosition && !terrain.isSafePosition(x, z, t.size)) continue;
      if (roadDist(x, z) < 9.5) continue;
      let onRamp = false;
      for (const ramp of ramps) {
        const along =
          (x - ramp.x) * Math.sin(ramp.heading) + (z - ramp.z) * Math.cos(ramp.heading);
        const across =
          (x - ramp.x) * Math.cos(ramp.heading) - (z - ramp.z) * Math.sin(ramp.heading);
        if (along > -3 && along < ramp.length + 3 && Math.abs(across) < ramp.width / 2 + 2) {
          onRamp = true;
          break;
        }
      }
      if (onRamp) continue;
      if (
        obstacles.some((o) => hasSafePosition && o.hx !== undefined
          ? Math.hypot(Math.max(Math.abs(o.x - x) - o.hx, 0), Math.max(Math.abs(o.z - z) - o.hz, 0)) < t.size + 1.5
          : Math.hypot(o.x - x, o.z - z) < (o.hx ?? o.r) + t.size + 1.5)
      )
        continue;
      return [x, z];
    }
    return null;
  }

  const nodes = [];
  let hits = 0;
  for (const t of toys) {
    const spot = findSpot(t);
    if (!spot) continue;
    const rule = t.rule;
    const body = new CANNON.Body({
      mass: rule.mass,
      allowSleep: true,
      sleepSpeedLimit: 0.2,
      sleepTimeLimit: 0.8,
      linearDamping: rule.linearDamping,
      angularDamping: rule.angularDamping,
      collisionFilterGroup: 3,
      collisionFilterMask: 1 | 2 | 3 | 4 | 8,
      material: new CANNON.Material({ friction: rule.friction, restitution: rule.restitution }),
    });
    body.addShape(rule.shape(t.size));
    body.position.set(spot[0], (terrain?.heightAt(...spot) ?? 0) + rule.restY(t.size), spot[1]);
    body.addEventListener("collide", (event) => {
      if (event.body === carBody) hits++;
    });
    world.addBody(body);
    nodes.push({
      body,
      origin: body.position.toArray(),
      group: groups.get(t.kind + "|" + t.colorIndex),
      instance: groups.get(t.kind + "|" + t.colorIndex).used++,
      kind: t.kind,
      size: t.size,
      roll: 0,
      lastRoll: 0,
      last: new CANNON.Vec3(),
      lq: new CANNON.Quaternion(),
      lo: { x: 0, y: 0, z: 0, w: 1 },
    });
  }
  // Any unplaced slots get shrunk to nothing so the meshes stay deterministic.
  const dummy = new THREE.Object3D();
  for (const g of groups.values())
    for (let i = g.used; i < g.count; i++)
      for (const mesh of g.meshes) {
        dummy.position.set(0, -20, 0);
        dummy.scale.setScalar(0.001);
        dummy.quaternion.set(0, 0, 0, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }

  function sync(force = false) {
    let changed = false;
    for (const node of nodes) {
      const b = node.body, q = b.quaternion;
      if (
        !force &&
        b.position.distanceSquared(node.last) < 1e-8 &&
        Math.abs(q.x - node.lq.x) + Math.abs(q.y - node.lq.y) +
          Math.abs(q.z - node.lq.z) + Math.abs(q.w - node.lq.w) < 1e-5 &&
        Math.abs(node.roll - node.lastRoll) < 1e-4
      )
        continue;
      let o;
      if (node.kind === "ball") {
        const vx = b.velocity.x,
          vz = b.velocity.z,
          sp = Math.hypot(vx, vz);
        o = sp > 1e-3 ? axisAngle(vz / sp, 0, -vx / sp, node.roll) : node.lo;
      } else if (node.kind === "tire") {
        o = qmul({ x: q.x, y: q.y, z: q.z, w: q.w }, TIRE_ALIGN);
      } else {
        o = { x: q.x, y: q.y, z: q.z, w: q.w };
      }
      node.lo = o;
      dummy.quaternion.set(o.x, o.y, o.z, o.w);
      dummy.position.set(b.position.x, b.position.y, b.position.z);
      dummy.scale.set(node.size, node.size, node.size);
      dummy.updateMatrix();
      const m = dummy.matrix;
      for (const mesh of node.group.meshes) mesh.setMatrixAt(node.instance, m);
      node.last.copy(b.position);
      node.lq.copy(q);
      node.lastRoll = node.roll;
      changed = true;
    }
    if (changed) {
      for (const mesh of allMeshes) mesh.instanceMatrix.needsUpdate = true;
      onChange();
    }
  }

  function resetNode(node) {
    const b = node.body;
    b.position.set(node.origin[0], node.origin[1], node.origin[2]);
    b.previousPosition.copy(b.position);
    b.interpolatedPosition.copy(b.position);
    b.quaternion.set(0, 0, 0, 1);
    b.previousQuaternion.copy(b.quaternion);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.force.setZero();
    b.torque.setZero();
    b.aabbNeedsUpdate = true;
    b.sleep();
    node.roll = 0;
    node.lo = { x: 0, y: 0, z: 0, w: 1 };
  }

  function reset(position = new THREE.Vector3(), heading = 0) {
    hits = 0;
    world.accumulator = 0;
    previous.copy(position);
    carBody.position.set(position.x, position.y + 0.7, position.z);
    carBody.velocity.setZero();
    carBody.quaternion.setFromEuler(0, heading, 0);
    carBody.aabbNeedsUpdate = true;
    nodes.forEach(resetNode);
    world.broadphase.dirty = true;
    sync(true);
  }

  const previous = new THREE.Vector3();
  function update(dt, position, heading) {
    if (dt <= 0) return;
    if (
      previous.distanceToSquared(position) < 1e-10 &&
      nodes.every(({ body }) => body.sleepState === CANNON.Body.SLEEPING)
    )
      return;
    const teleport = previous.distanceToSquared(position) > 144;
    carBody.position.set(
      teleport ? position.x : previous.x,
      (teleport ? position.y : previous.y) + 0.7,
      teleport ? position.z : previous.z,
    );
    carBody.velocity.set(
      teleport ? 0 : (position.x - previous.x) / dt,
      teleport ? 0 : (position.y - previous.y) / dt,
      teleport ? 0 : (position.z - previous.z) / dt,
    );
    carBody.quaternion.setFromEuler(0, heading, 0);
    carBody.aabbNeedsUpdate = true;
    world.step(1 / 120, Math.min(dt, 0.05), 8);
    previous.copy(position);
    const step = Math.min(dt, 0.05);
    for (const node of nodes) {
      if (hasSafePosition && !terrain.isSafePosition(node.body.position.x, node.body.position.z, node.size)) {
        resetNode(node);
        world.broadphase.dirty = true;
      }
      if (node.kind === "ball" && node.body.sleepState !== CANNON.Body.SLEEPING) {
        const vx = node.body.velocity.x,
          vz = node.body.velocity.z;
        node.roll += (Math.hypot(vx, vz) * step) / node.size;
      }
    }
    sync();
  }

  reset();
  return {
    update,
    reset,
    state: () => ({
      count: nodes.length,
      hits,
      awake: nodes.filter(({ body }) => body.sleepState !== CANNON.Body.SLEEPING).length,
      moved: nodes.filter(({ body, origin }) =>
        Math.hypot(body.position.x - origin[0], body.position.z - origin[2]) > 0.35
      ).length,
      first: nodes[0]?.body.position.toArray() ?? null,
    }),
  };
}
