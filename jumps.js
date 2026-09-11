import * as CANNON from "cannon-es";
import { createTerrainBody } from "./terrain-physics.js";

export function rampShape({ width, length, height }) {
  const w = width / 2;
  const vertices = [[-w,0,0],[w,0,0],[-w,0,length],[w,0,length],[-w,height,length],[w,height,length]].map(v => new CANNON.Vec3(...v));
  return new CANNON.ConvexPolyhedron({ vertices, faces: [[0,1,3,2],[0,4,5,1],[2,3,5,4],[0,2,4],[1,5,3]] });
}

export function createJumpPhysics(ramps, gravity = 9.82, terrain = null) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0,-gravity,0) });
  world.defaultContactMaterial.friction = 0;
  world.defaultContactMaterial.restitution = 0;
  world.solver.iterations = 12;
  const floor = createTerrainBody(terrain);
  world.addBody(floor);
  ramps.forEach(ramp => {
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(rampShape(ramp)); body.position.set(ramp.x,(ramp.y ?? 0)+0.075,ramp.z);
    body.quaternion.setFromEuler(0,ramp.heading,0); world.addBody(body);
  });
  // Horizontal driving stays arcade-friendly; Cannon owns the vertical contacts and flight.
  const car = new CANNON.Body({ mass: 100, fixedRotation: true, linearDamping: 0, allowSleep: false });
  let groundHeight = terrain?.heightAt(0, 0) ?? 0;
  car.addShape(new CANNON.Sphere(0.42)); car.position.y = groundHeight + 0.495; world.addBody(car);
  let previous = {x:0,z:0}, onTerrain = true, airborne = false, jumps = 0, airtime = 0, longest = 0, pitch = 0;
  let supported = false, slopeSpeed = 0;
  world.addEventListener("postStep", () => {
    let floorContact = false, rampContact = false;
    supported = false;
    for (const c of world.contacts) {
      if ((c.bi !== car && c.bj !== car) || Math.abs(c.ni.y) <= 0.25) continue;
      supported = true;
      if (c.bi === floor || c.bj === floor) floorContact = true;
      else rampContact = true;
    }
    onTerrain = floorContact && !rampContact;
    // Suppress triangle-seam solver rebound each substep, not ramp launch velocity.
    if (terrain && onTerrain) car.velocity.y = slopeSpeed;
  });
  function reset(position) {
    previous = {x:position.x,z:position.z};
    groundHeight = terrain?.heightAt(position.x, position.z) ?? 0;
    car.position.set(position.x,groundHeight+0.495,position.z); car.velocity.setZero(); car.force.setZero();
    car.aabbNeedsUpdate = true;
    car.previousPosition.copy(car.position); car.interpolatedPosition.copy(car.position);
    world.accumulator = 0; onTerrain = true; supported = false; slopeSpeed = 0;
    airborne = false; jumps = 0; airtime = 0; longest = 0; pitch = 0;
  }
  function update(dt, position) {
    if (dt <= 0) return state();
    const vx = (position.x-previous.x)/dt, vz = (position.z-previous.z)/dt;
    slopeSpeed = terrain ? (terrain.heightAt(position.x, position.z) - terrain.heightAt(previous.x, previous.z)) / dt : 0;
    // Cannon trails render time by its remainder; do not advance that time twice.
    car.position.x = previous.x - vx * world.accumulator;
    car.position.z = previous.z - vz * world.accumulator;
    car.velocity.x = vx; car.velocity.z = vz;
    // Horizontal arcade acceleration must also follow the supported downhill tangent.
    if (terrain && onTerrain) car.velocity.y = slopeSpeed;
    world.step(1/120,Math.min(dt,0.05),8);
    previous.x = position.x; previous.z = position.z;
    groundHeight = terrain?.heightAt(position.x, position.z) ?? 0;
    const clearance = car.position.y - 0.495 - groundHeight;
    const flying = clearance > 0.255 && !supported;
    if (flying && !airborne) { jumps++; airtime = 0; }
    if (flying) { airtime += dt; longest = Math.max(longest,airtime); }
    const landed = airborne && !flying;
    airborne = flying;
    const horizontal = Math.hypot(vx,vz);
    const targetPitch = (supported || clearance > 0.125) && horizontal > 1 ? Math.max(-0.3,Math.min(0.3,Math.atan2(car.velocity.y,horizontal))) : 0;
    pitch += (targetPitch-pitch)*(1-Math.exp(-8*dt));
    return {...state(),landed};
  }
  // height is the absolute car-root Y; groundHeight excludes the road's 0.075 m offset.
  function state() {
    // The coarse collision grid must not leave a landed car above the visible road.
    const height = terrain && onTerrain ? groundHeight : Math.max(groundHeight, car.position.y - 0.495);
    return {height,groundHeight,clearance:height-groundHeight,verticalSpeed:car.velocity.y,airborne,jumps,airtime,longest,pitch};
  }
  return {reset,update,state};
}
