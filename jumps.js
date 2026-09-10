import * as CANNON from "cannon-es";

export function rampShape({ width, length, height }) {
  const w = width / 2;
  const vertices = [[-w,0,0],[w,0,0],[-w,0,length],[w,0,length],[-w,height,length],[w,height,length]].map(v => new CANNON.Vec3(...v));
  return new CANNON.ConvexPolyhedron({ vertices, faces: [[0,1,3,2],[0,4,5,1],[2,3,5,4],[0,2,4],[1,5,3]] });
}

export function createJumpPhysics(ramps, gravity = 9.82) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0,-gravity,0) });
  world.defaultContactMaterial.friction = 0;
  world.defaultContactMaterial.restitution = 0;
  world.solver.iterations = 12;
  const floor = new CANNON.Body({ mass: 0 });
  floor.addShape(new CANNON.Plane()); floor.quaternion.setFromEuler(-Math.PI/2,0,0); floor.position.y = 0.075;
  world.addBody(floor);
  ramps.forEach(ramp => {
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(rampShape(ramp)); body.position.set(ramp.x,0.075,ramp.z);
    body.quaternion.setFromEuler(0,ramp.heading,0); world.addBody(body);
  });
  // Horizontal driving stays arcade-friendly; Cannon owns the vertical contacts and flight.
  const car = new CANNON.Body({ mass: 100, fixedRotation: true, linearDamping: 0, allowSleep: false });
  car.addShape(new CANNON.Sphere(0.42)); car.position.y = 0.495; world.addBody(car);
  let previous = {x:0,z:0}, airborne = false, jumps = 0, airtime = 0, longest = 0, pitch = 0;
  function reset(position) {
    previous = {x:position.x,z:position.z};
    car.position.set(position.x,0.495,position.z); car.velocity.setZero(); car.force.setZero();
    car.previousPosition.copy(car.position); car.interpolatedPosition.copy(car.position);
    world.accumulator = 0; airborne = false; jumps = 0; airtime = 0; longest = 0; pitch = 0;
  }
  function update(dt, position) {
    if (dt <= 0) return state();
    const vx = (position.x-previous.x)/dt, vz = (position.z-previous.z)/dt;
    car.position.x = previous.x; car.position.z = previous.z;
    car.velocity.x = vx; car.velocity.z = vz;
    world.step(1/120,Math.min(dt,0.05),8);
    previous.x = position.x; previous.z = position.z;
    const supported = world.contacts.some(c => (c.bi === car || c.bj === car) && Math.abs(c.ni.y) > 0.25);
    const flying = car.position.y > 0.75 && !supported;
    if (flying && !airborne) { jumps++; airtime = 0; }
    if (flying) { airtime += dt; longest = Math.max(longest,airtime); }
    const landed = airborne && !flying;
    airborne = flying;
    const horizontal = Math.hypot(vx,vz);
    const targetPitch = car.position.y > 0.62 && horizontal > 1 ? Math.max(-0.3,Math.min(0.3,Math.atan2(car.velocity.y,horizontal))) : 0;
    pitch += (targetPitch-pitch)*(1-Math.exp(-8*dt));
    return {...state(),landed};
  }
  function state() { return {height:Math.max(0,car.position.y-0.495),verticalSpeed:car.velocity.y,airborne,jumps,airtime,longest,pitch}; }
  return {reset,update,state};
}
