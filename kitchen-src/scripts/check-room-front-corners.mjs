import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRoomNavigator,canTraverseRoomSegment} from '../src/room-navigation.js';

const source=new URL('../src/',import.meta.url);
const mask=JSON.parse(await fs.readFile(new URL('room-v10-surfaces.json',source),'utf8'));
async function loadPlacement(surface){
 let text=await fs.readFile(new URL('room-placement.js',source),'utf8');
 for(const[name,file]of[['surfaceV7','room-v7-surfaces.json'],['surfaceV10','room-v10-surfaces.json'],['layoutV10','room-v10-layout.json']]){
  const json=name==='surfaceV10'?JSON.stringify(surface):await fs.readFile(new URL(file,source),'utf8');
  text=text.replace(new RegExp(`import ${name} from '[^']+';`),`const ${name}=${json};`);
 }
 return (await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)).getRoomPlacement(10);
}
const room=await loadPlacement(mask),placements=room.sanitizeRoomPlacements(null);
assert(mask.collisionRefinements.some(item=>item.name==='front-wall-corners-v14'),'The corner mask carries its source geometry record.');
const published=JSON.parse(await fs.readFile(new URL('room-v10-layout.json',source),'utf8'));
for(const item of published.items){
 const actual=room.ROOM_ITEMS.find(value=>value.id===item.id);
 assert(actual,'Every published project remains in the room.');
 item.position.forEach((value,axis)=>assert(Math.abs(actual.position[axis]-value)<1e-6,'Published project coordinates and support heights are unchanged.'));
}
const navigator=createRoomNavigator({bounds:room.ROOM_BOUNDS,canWalk:room.canWalk});
let routes=0;
for(const side of[-1,1]){
 for(const x of[4.4,4.48,4.5,4.55,4.56]){
  const target={x,z:side*5.5};assert(room.canWalk(target.x,target.z,placements),`New corner is reachable at ${x},${target.z}`);
  const start={x,z:side*4.8};assert(canTraverseRoomSegment(start,target,room.canWalk,placements));
  let player={...start};
  for(let frame=0;frame<120;frame++)player=room.stepRoomPlayer(player,{x:0,z:side},1/60,placements);
  assert(side*player.z>=5.47&&side*player.z<=5.52+1e-6,'Held walking reaches the corner and stops before the slab edge.');
  const picked=room.pickRoomSurface({origin:{x,y:10,z:side*5.5},direction:{x:0,y:-1,z:0}},{radius:.08});
  assert(picked&&Math.abs(picked[1]-room.ROOM_FLOOR_Y)<.05,'Floor clicking sees the refreshed corner support.');
  const path=navigator.findPath(room.PLAYER_START,target,placements);assert(path.length,'A click path reaches the corner.');
  let previous=room.PLAYER_START;
  for(const waypoint of path){assert(canTraverseRoomSegment(previous,waypoint,room.canWalk,placements));previous=waypoint;}
  assert(Math.hypot(previous.x-target.x,previous.z-target.z)<.05);routes++;
 }
 for(const point of[{x:4.0,z:side*5.6},{x:4.32,z:side*5.52},{x:4.5,z:side*5.6},{x:4.9,z:side*5.2}])assert(!room.canWalk(point.x,point.z,placements),'Physical wall and platform clearance remain blocked.');
}
assert(!room.canWalk(3.3,4,placements),'Cashier desk still blocks walking.');
assert(!room.canWalk(3.05,-3.9,placements),'Chalkboard still blocks walking.');
console.log(`Front corners passed: ${routes} real click routes, held walking, refreshed floor picking, preserved project layout, desk/chalkboard/walls and slab edge clearance.`);
