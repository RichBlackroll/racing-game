import { rampShape } from "./jumps.js";
import * as THREE from "three";
import * as CANNON from "cannon-es";

export function createConeField({ scene, route, obstacles, onChange, gravity = 9.82, ramps = [] }) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -gravity, 0), allowSleep: true });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 8;
  world.defaultContactMaterial.friction = 0.65;
  world.defaultContactMaterial.restitution = 0.08;
  const floor = new CANNON.Body({ mass: 0, collisionFilterGroup: 1, collisionFilterMask: 2 });
  floor.addShape(new CANNON.Plane());
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floor.position.y = 0.075;
  world.addBody(floor);
  // Only cones interact with this world; driving retains its existing collision model.
  const carBody = new CANNON.Body({ type: CANNON.Body.KINEMATIC, collisionFilterGroup: 4, collisionFilterMask: 2 });
  carBody.addShape(new CANNON.Box(new CANNON.Vec3(1.05, 0.55, 2.2)));
  world.addBody(carBody);
  for (const o of obstacles) {
    const body = new CANNON.Body({ mass: 0, collisionFilterGroup: 8, collisionFilterMask: 2 });
    body.position.set(o.x, 1.5, o.z);
    body.addShape(o.hx !== undefined
      ? new CANNON.Box(new CANNON.Vec3(o.hx, 1.5, o.hz))
      : new CANNON.Cylinder(o.r, o.r, 3, 8));
    world.addBody(body);
  }
  for (const ramp of ramps) {
    const body = new CANNON.Body({ mass: 0, collisionFilterGroup: 8, collisionFilterMask: 2 });
    body.addShape(rampShape(ramp)); body.position.set(ramp.x,0.075,ramp.z);
    body.quaternion.setFromEuler(0,ramp.heading,0); world.addBody(body);
  }
  const count = 28;
  const orange = new THREE.MeshStandardMaterial({ color: 0xff701e, roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x282b2d, roughness: 1 });
  const parts = [
    [new THREE.BoxGeometry(0.88, 0.15, 0.88).translate(0, 0.075, 0), rubber],
    [new THREE.CylinderGeometry(0.035, 0.33, 0.92, 12).translate(0, 0.61, 0), orange],
    [new THREE.CylinderGeometry(0.12, 0.179, 0.18, 12).translate(0, 0.72, 0), white],
  ].map(([geometry, material]) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  });
  const cones = [];
  let hitCount = 0;
  for (let i = 0; i < count; i++) {
    const n = 4 + i * 8, p = route[n], ahead = route[(n + 1) % route.length];
    const dx = ahead.x - p.x, dz = ahead.z - p.z, length = Math.hypot(dx, dz);
    let offset = i === 0 ? 0.9 : (i % 2 ? 1 : -1) * 4.4;
    for (const ramp of ramps) {
      const along = (p.x-ramp.x)*Math.sin(ramp.heading)+(p.z-ramp.z)*Math.cos(ramp.heading);
      const across = (p.x-ramp.x)*Math.cos(ramp.heading)-(p.z-ramp.z)*Math.sin(ramp.heading);
      if (along > -2 && along < ramp.length+2 && Math.abs(across) < ramp.width)
        offset = Math.sign(offset)*(ramp.width/2+1.5);
    }
    const origin = new CANNON.Vec3(p.x - dz / length * offset, 0.075, p.z + dx / length * offset);
    const body = new CANNON.Body({ mass: 0.8, position: origin.clone(), allowSleep: true,
      sleepSpeedLimit: 0.18, sleepTimeLimit: 0.7, linearDamping: 0.3, angularDamping: 0.45,
      collisionFilterGroup: 2, collisionFilterMask: 1 | 2 | 4 | 8 });
    // The centre of mass is above the base, so a bumper strike naturally tips it.
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.44, 0.075, 0.44)), new CANNON.Vec3(0, -0.32, 0));
    body.addShape(new CANNON.Cylinder(0.035, 0.33, 0.92, 12), new CANNON.Vec3(0, 0.215, 0));
    body.position.y += 0.395;
    body.addEventListener("collide", (event) => { if (event.body === carBody) hitCount++; });
    world.addBody(body);
    cones.push({ body, origin, lastPosition: new CANNON.Vec3(), lastQuaternion: new CANNON.Quaternion() });
  }
  const dummy = new THREE.Object3D(), offset = new THREE.Vector3(0, -0.395, 0);
  const previous = new THREE.Vector3(), worldOffset = new THREE.Vector3();
  function sync(force = false) {
    let changed = false;
    cones.forEach((cone, i) => {
      const b = cone.body, q = b.quaternion, last = cone.lastQuaternion;
      if (!force && b.position.distanceSquared(cone.lastPosition) < 1e-8 && Math.abs(q.x-last.x)+Math.abs(q.y-last.y)+Math.abs(q.z-last.z)+Math.abs(q.w-last.w) < 1e-5) return;
      dummy.quaternion.set(q.x, q.y, q.z, q.w);
      dummy.position.set(b.position.x, b.position.y, b.position.z).add(worldOffset.copy(offset).applyQuaternion(dummy.quaternion));
      dummy.updateMatrix();
      parts.forEach((mesh) => mesh.setMatrixAt(i, dummy.matrix));
      cone.lastPosition.copy(b.position); cone.lastQuaternion.copy(q); changed = true;
    });
    if (changed) { parts.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; }); onChange(); }
  }
  function reset(position = new THREE.Vector3(), heading = 0) {
    hitCount = 0; world.accumulator = 0;
    previous.copy(position);
    carBody.position.set(position.x, position.y + 0.7, position.z);
    carBody.velocity.setZero(); carBody.quaternion.setFromEuler(0, heading, 0); carBody.aabbNeedsUpdate = true;
    cones.forEach(({ body, origin }) => {
      body.position.set(origin.x, origin.y + 0.395, origin.z);
      body.previousPosition.copy(body.position); body.interpolatedPosition.copy(body.position);
      body.quaternion.set(0, 0, 0, 1); body.previousQuaternion.copy(body.quaternion);
      body.velocity.setZero(); body.angularVelocity.setZero(); body.force.setZero(); body.torque.setZero();
      body.aabbNeedsUpdate = true; body.sleep();
    });
    world.broadphase.dirty = true; sync(true);
  }
  function update(dt, position, heading) {
    if (dt <= 0) return;
    if (previous.distanceToSquared(position) < 1e-10 && cones.every(({ body }) => body.sleepState === CANNON.Body.SLEEPING)) return;
    const teleport = previous.distanceToSquared(position) > 144;
    carBody.position.set(teleport ? position.x : previous.x, (teleport ? position.y : previous.y) + 0.7, teleport ? position.z : previous.z);
    carBody.velocity.set(teleport ? 0 : (position.x - previous.x) / dt, teleport ? 0 : (position.y - previous.y) / dt, teleport ? 0 : (position.z - previous.z) / dt);
    carBody.quaternion.setFromEuler(0, heading, 0); carBody.aabbNeedsUpdate = true;
    world.step(1 / 120, Math.min(dt, 0.05), 8);
    previous.copy(position); sync();
  }
  reset();
  return { update, reset, state: () => ({ count, hits: hitCount,
    awake: cones.filter(({ body }) => body.sleepState !== CANNON.Body.SLEEPING).length,
    moved: cones.filter(({ body, origin }) => Math.hypot(body.position.x - origin.x, body.position.z - origin.z) > 0.35).length,
    first: cones[0].body.position.toArray(),
  }) };
}
