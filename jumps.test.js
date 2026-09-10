import test from "node:test";
import assert from "node:assert/strict";
import { createJumpPhysics } from "./jumps.js";
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
