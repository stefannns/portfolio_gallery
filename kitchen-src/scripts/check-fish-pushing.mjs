import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {getLandedFishCollider} from '../src/fish-ground-collision.js';
import {resolveFishPush} from '../src/fish-ground-pushing.js';
import {FISH_DURATION, FISH_BOUNCE_END} from '../src/fish-flop-state.js';

const source = new URL('../src/', import.meta.url);
let placementSource = await fs.readFile(new URL('room-placement.js', source), 'utf8');
for (const [name, file] of [['surfaceV7','room-v7-surfaces.json'],['surfaceV10','room-v10-surfaces.json'],['layoutV10','room-v10-layout.json']]) {
  placementSource = placementSource.replace(new RegExp(`import ${name} from '[^']+';`), `const ${name}=${await fs.readFile(new URL(file, source), 'utf8')};`);
}
const room = (await import(`data:text/javascript;base64,${Buffer.from(placementSource).toString('base64')}`)).getRoomPlacement(10);
const props = room.sanitizeRoomPlacements(null), canWalk = (x,z) => room.canWalk(x,z,props);
const fishAt = (x=3.4,z=0) => {const state={used:true,elapsed:FISH_DURATION};getLandedFishCollider(state);state.ground.x=x;state.ground.z=z;getLandedFishCollider(state);return state;};
const distanceToFish = (point,state) => {const c=getLandedFishCollider(state),[x,,z]=c.position;return Math.hypot(point.x-Math.max(x-c.collisionHalfLength,Math.min(x+c.collisionHalfLength,point.x)),point.z-z);};
const assertSafe = (point,state) => {
  const c=getLandedFishCollider(state),[x,,z]=c.position;
  assert(distanceToFish(point,state)>=c.collisionRadius+room.PLAYER_RADIUS-2e-7,'The player remains outside the fish.');
  assert(canWalk(point.x,point.z),'The player remains on usable room floor.');
  for(const offset of[-c.collisionHalfLength,0,c.collisionHalfLength])assert(canWalk(x+offset,z),'The fish stays clear of room obstacles and slab edges.');
};
const beforeLanding = {used:true,elapsed:FISH_BOUNCE_END-1e-6};
const from={x:3.4,z:-.9},wish={x:3.4,z:-.8,moving:true};
assert.deepEqual(resolveFishPush(beforeLanding,from,wish,{canWalk}),wish);
assert.equal(beforeLanding.ground,undefined,'Airborne fish cannot be pushed.');
const independentA=fishAt(),independentB=fishAt();
assert.notEqual(independentA.ground,independentB.ground);assert.notEqual(getLandedFishCollider(independentA),getLandedFishCollider(independentB));
const colliderA=getLandedFishCollider(independentA),clone={...independentA};
assert.equal(getLandedFishCollider(clone),colliderA,'Remount state keeps the current ground body.');
const idleState=fishAt(),idleBefore=JSON.stringify(idleState.ground);
assert.equal(resolveFishPush(idleState,from,{x:from.x,z:from.z+.0001,moving:false},{canWalk}).moving,false);
assert.equal(JSON.stringify(idleState.ground),idleBefore,'Idle Rapier drift does not move the fish.');
resolveFishPush(idleState,from,wish,{canWalk,paused:true});
assert.equal(JSON.stringify(idleState.ground),idleBefore,'Pause never moves or advances the ground body.');

function walkPush(rate,angle,seconds=.2,{state=fishAt(),start}={}) {
  const dx=Math.cos(angle),dz=Math.sin(angle);let player=start||{x:state.ground.x+.9*dx,z:state.ground.z+.9*dz};
  assertSafe(player,state);
  let elapsed=0;
  while(elapsed<seconds-1e-10){const dt=Math.min(1/rate,seconds-elapsed);const proposed=room.stepRoomPlayer(player,{x:-dx,z:-dz},dt,props);player=resolveFishPush(state,player,proposed,{canWalk,playerRadius:room.PLAYER_RADIUS});assertSafe(player,state);elapsed+=dt;}
  return {state,player};
}
let cases=0;
for(let direction=0;direction<8;direction++) {
  const results=[];
  for(const rate of[30,60,144]) {
    const result=walkPush(rate,direction*Math.PI/4);results.push(result);
    assert(Math.hypot(result.state.ground.x-3.4,result.state.ground.z)>.2,'Walking into the fish moves it.');
    assert(result.state.ground.pushes>0&&result.state.ground.revision>0&&result.state.ground.distance>.2);
    assert.equal(getLandedFishCollider(result.state).position[0],result.state.ground.x);
    assert.equal(getLandedFishCollider(result.state).position[2],result.state.ground.z);cases++;
  }
  for(const result of results.slice(1)) {
    assert(Math.hypot(result.state.ground.x-results[0].state.ground.x,result.state.ground.z-results[0].state.ground.z)<.025,'Push distance stays consistent across frame rates.');
    assert(Math.hypot(result.player.x-results[0].player.x,result.player.z-results[0].player.z)<.025);
  }
}
// Actual front platform and back cabinet clamps, including held input after contact.
const front=walkPush(60,Math.PI,2,{state:fishAt(3.4,0)});
assert(front.state.ground.x>3.8&&front.state.ground.x<=4.4+1e-6,'Front slab clearance clamps the fish.');
const frontX=front.state.ground.x;
let blocked=front.player;
for(let n=0;n<120;n++){const next=room.stepRoomPlayer(blocked,{x:1,z:0},1/60,props);blocked=resolveFishPush(front.state,blocked,next,{canWalk});assertSafe(blocked,front.state);}
assert(Math.abs(front.state.ground.x-frontX)<.001,'Holding into the slab edge cannot push the fish through it.');
assert.equal(blocked.moving,false);
const cabinetState=fishAt(-2.59,-2.78);
const cabinet=walkPush(60,0,1,{state:cabinetState,start:{x:-1.69,z:-2.78}});
assert(cabinet.state.ground.x<-2.63&&cabinet.state.ground.x>-2.91,'The actual back cabinet stops the fish.');
// A glancing diagonal still moves the player when the fish is pinned.
const glancingBefore={...blocked};
const glancingWish=room.stepRoomPlayer(blocked,{x:1,z:1},1/30,props);
const glancing=resolveFishPush(front.state,blocked,glancingWish,{canWalk});assertSafe(glancing,front.state);
assert(glancing.z>glancingBefore.z,'The player can slide around a pinned fish.');
// Bound pathological proposals and reject invalid data without moving the fish.
const large=fishAt(),largePlayer={x:3.4,z:-.9};
const bounded=resolveFishPush(large,largePlayer,{x:3.4,z:10,moving:true},{canWalk});
assert(Math.hypot(bounded.x-largePlayer.x,bounded.z-largePlayer.z)<=.250001);assertSafe(bounded,large);
const unchanged=JSON.stringify(large.ground);
resolveFishPush(large,bounded,{x:NaN,z:0,moving:true},{canWalk});assert.equal(JSON.stringify(large.ground),unchanged);
const saved={...cabinet.state};assert.equal(getLandedFishCollider(saved),getLandedFishCollider(cabinet.state));
assert.equal(saved.ground.x,cabinet.state.ground.x);
assert.equal(independentB.ground.x,3.4,'Moving one fish cannot affect another state.');
console.log(`Fish pushing passed: ${cases} directional/frame-rate cases, consistent movement, glancing slides, actual cabinet/slab limits, pose synchronization, pause/remount and idle drift.`);
