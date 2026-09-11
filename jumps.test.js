import test from "node:test";
import assert from "node:assert/strict";
import { createJumpPhysics } from "./jumps.js";
import { createCourse } from "./course.js";
import { Scene } from "three";
import { createRampCourse } from "./levels.js";
function drive(gravity) {
  const jump=createJumpPhysics([{x:0,z:10,heading:0,width:9.5,length:18,height:3}],gravity);
  const car={x:0,y:0,z:0};jump.reset(car);
  let maxHeight=0,airFrames=0,landings=0;
  for(let i=0;i<1200;i++) {
    car.z+=20/120;
    const state=jump.update(1/120,car);
    maxHeight=Math.max(maxHeight,state.height);
    if(state.airborne)airFrames++;
    if(state.landed)landings++;
    assert.ok(Number.isFinite(state.height));
  }
  return {jump,maxHeight,airFrames,landings};
}
test("ramp contact launches the car and lands without a rebound",()=>{
  const run=drive(9.82);
  assert.ok(run.maxHeight>3.2,'car rises above the ramp lip');
  assert.ok(run.airFrames>30);
  assert.equal(run.landings,1);
  assert.equal(run.jump.state().jumps,1);
  assert.ok(run.jump.state().height<0.03);
  assert.ok(Math.abs(run.jump.state().verticalSpeed)<0.1);
});
test("Moon gravity gives longer air time and reset clears flight",()=>{
  const earth=drive(9.82),moon=drive(3.2);
  assert.ok(moon.airFrames>earth.airFrames*1.5);
  assert.ok(moon.maxHeight>earth.maxHeight);
  moon.jump.reset({x:0,z:0});
  assert.equal(moon.jump.state().height,0);
  assert.equal(moon.jump.state().airborne,false);
  assert.equal(moon.jump.state().jumps,0);
});
test("driving beside a ramp never launches the car",()=>{
  const jump=createJumpPhysics([{x:0,z:10,heading:0,width:9.5,length:18,height:3}]);
  const car={x:7,z:0};jump.reset(car);
  for(let i=0;i<480;i++){car.z+=20/120;jump.update(1/120,car);}
  assert.equal(jump.state().jumps,0);assert.ok(jump.state().height<0.03);
});

test("reset uses local ground, not incoming Y or world zero, at either sign of elevation", () => {
  const terrain = { halfSize: 100, heightAt: (x, z) => x * 0.2 - z * 0.1 };
  const jump = createJumpPhysics([], 9.82, terrain);
  for (const p of [{ x: 40, y: -999, z: -20 }, { x: -40, y: 999, z: 20 }]) {
    jump.reset(p);
    const ground = terrain.heightAt(p.x, p.z);
    assert.ok(Math.abs(jump.state().height - ground) < 1e-12);
    assert.equal(jump.state().groundHeight, ground);
    assert.ok(jump.state().clearance < 1e-12);
    assert.equal(jump.state().verticalSpeed, 0);
    assert.equal(jump.state().airborne, false);
    assert.equal(jump.state().jumps, 0);
    assert.equal(jump.state().pitch, 0);
    for (let i = 0; i < 240; i++) jump.update(1 / 120, p);
    assert.ok(jump.state().clearance < 0.03);
    assert.equal(jump.state().jumps, 0);
  }
});

for (const direction of [-1, 1]) {
  test(`supported slopes pitch ${direction > 0 ? "up" : "down"} without counting elevation as flight`, () => {
    const terrain = { halfSize: 160, heightAt: (x, z) => direction * z * 0.15 + x * 0.04 };
    const jump = createJumpPhysics([], 9.82, terrain);
    const car = { x: 0, z: -80 };
    jump.reset(car);
    for (let i = 0; i < 960; i++) {
      car.z += 20 / 120;
      const state = jump.update(1 / 120, car);
      assert.ok(Math.abs(state.groundHeight - terrain.heightAt(car.x, car.z)) < 0.02);
      assert.ok(state.clearance < 0.06);
      assert.ok(Math.abs(state.height - state.groundHeight - state.clearance) < 1e-12);
      assert.equal(state.airborne, false);
      assert.equal(state.landed, false);
    }
    assert.ok(jump.state().pitch * direction > 0.1);
    assert.equal(jump.state().jumps, 0);
    assert.equal(jump.state().airtime, 0);
    assert.equal(jump.state().longest, 0);
  });
}

for (const level of ["forest", "city"]) {
  test(`the entire longer ${level} course stays grounded through hills`, () => {
    const terrain = createCourse(level);
    const jump = createJumpPhysics([], 9.82, terrain);
    jump.reset(terrain.route[0]);
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < terrain.route.length; i++) {
      const a = terrain.route[i], b = terrain.route[(i + 1) % terrain.route.length];
      const frames = Math.ceil(a.distanceTo(b) / (20 / 60));
      for (let f = 1; f <= frames; f++) {
        const state = jump.update(1 / 60, a.clone().lerp(b, f / frames));
        assert.ok(Number.isFinite(state.height));
        assert.ok(state.clearance < 0.2, `car tracks road surface: ${state.clearance}`);
        assert.equal(state.airborne, false);
        low = Math.min(low, state.height); high = Math.max(high, state.height);
      }
    }
    assert.ok(high - low > (level === "forest" ? 60 : 1));
    assert.equal(jump.state().jumps, 0);
  });
}

for (const height of [-20, 0, 20]) {
  test(`ramp flight at base ${height} matches the shipped flat ramp trajectory`, () => {
    const terrain = { halfSize: 260, heightAt: () => height };
    const ramp = { x: 0, z: 10, heading: 0, width: 9.5, length: 18, height: 3 };
    const flat = createJumpPhysics([ramp]);
    const elevated = createJumpPhysics([{ ...ramp, y: height }], 9.82, terrain);
    const car = { x: 0, z: 0 };
    flat.reset(car); elevated.reset(car);
    let maxClearance = 0, landings = 0;
    for (let i = 0; i < 1200; i++) {
      car.z += 20 / 120;
      const a = flat.update(1 / 120, car), b = elevated.update(1 / 120, car);
      // The plane has a small settling bounce; the launch and flight must match.
      assert.ok(Math.abs(b.height - height - a.height) < 0.08);
      assert.ok(Math.abs(b.clearance - a.clearance) < 0.08);
      assert.equal(b.airborne, a.airborne);
      assert.equal(b.landed, a.landed);
      if (a.airborne) assert.ok(Math.abs(a.verticalSpeed - b.verticalSpeed) < 1e-6);
      assert.equal(b.groundHeight, height);
      maxClearance = Math.max(maxClearance, b.clearance);
      if (b.landed) landings++;
    }
    assert.ok(maxClearance > 3.2);
    assert.equal(landings, 1);
    assert.equal(elevated.state().jumps, 1);
    assert.ok(elevated.state().clearance < 0.03);
    elevated.reset(car);
    assert.equal(elevated.state().jumps, 0);
    assert.equal(elevated.state().airtime, 0);
    assert.equal(elevated.state().longest, 0);
    assert.ok(Math.abs(elevated.state().height - height) < 1e-12);
  });
}

for (const level of ["stunt", "moon"]) {
  test(`${level} course preserves its flat ramp approach, launch and landing at 30 and 60 fps`, () => {
    const terrain = createCourse(level), gravity = level === "moon" ? 3.2 : 9.82;
    const scene = new Scene(), ramps = createRampCourse(scene, terrain.route, level === "moon");
    scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    for (const ramp of ramps) for (const dt of [1 / 30, 1 / 60]) {
      const flat = createJumpPhysics([ramp], gravity);
      const hills = createJumpPhysics([ramp], gravity, terrain);
      const direction = Math.sign(Math.sin(ramp.heading));
      const car = { x: -140 * direction, z: ramp.z };
      flat.reset(car); hills.reset(car);
      let max = 0, landings = 0;
      for (let i = 0; i < Math.round(9 / dt); i++) {
        car.x += direction * 20 * dt;
        const a = flat.update(dt, car), b = hills.update(dt, car);
        assert.equal(b.groundHeight, 0);
        // Flight matches; terrain contact omits the plane's low-gravity settling bounce.
        if (a.height > 0.255 || b.height > 0.255) assert.ok(Math.abs(a.height - b.height) < 0.01);
        assert.equal(a.airborne, b.airborne);
        assert.equal(a.landed, b.landed);
        max = Math.max(max, b.height);
        if (b.landed) landings++;
      }
      assert.ok(max > ramp.height + 0.3);
      assert.equal(hills.state().jumps, flat.state().jumps);
      assert.ok(landings > 0);
      assert.ok(hills.state().clearance < 0.03);
      assert.ok(Math.abs(hills.state().verticalSpeed) < 0.1);
    }
  });
}

test("a hill landing settles onto the visible terrain instead of the coarse collider", () => {
  const terrain = createCourse("moon");
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const jump = createJumpPhysics([], 3.2, terrain);
    const car = { x: -250, z: 126 };
    jump.reset(car);
    let flew = false, landed = false;
    for (let i = 0; i < 30 / dt; i++) {
      car.x = Math.min(-150, car.x + 32 * dt);
      const state = jump.update(dt, car);
      flew ||= state.airborne;
      landed ||= state.landed;
    }
    assert.ok(flew && landed);
    assert.equal(jump.state().airborne, false);
    assert.ok(Math.abs(jump.state().height - terrain.heightAt(car.x, car.z)) < 0.01);
    assert.ok(jump.state().clearance < 0.01);
  }
});

test("high and uneven frame rates produce one ramp flight and settle after stopping", () => {
  for (const steps of [[1 / 144], [0.011, 0.027, 0.006, 0.05]]) {
    const jump = createJumpPhysics([{ x: 0, z: 10, heading: 0, width: 9.5, length: 18, height: 3 }]);
    const car = { x: 0, z: 0 };
    jump.reset(car);
    let elapsed = 0, frame = 0, landings = 0, peak = 0;
    while (elapsed < 12) {
      const dt = steps[frame++ % steps.length];
      elapsed += dt;
      car.z = Math.min(45, car.z + 20 * dt);
      const state = jump.update(dt, car);
      if (state.landed) landings++;
      peak = Math.max(peak, state.height);
    }
    assert.ok(peak > 3.2);
    assert.equal(jump.state().jumps, 1);
    assert.equal(landings, 1);
    assert.ok(jump.state().height < 0.03);
    assert.ok(Math.abs(jump.state().verticalSpeed) < 0.1);
  }
});
