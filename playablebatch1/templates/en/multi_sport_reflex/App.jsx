import * as THREE from 'three';

const root = document.getElementById('root');
const style = document.createElement('style');
style.textContent = `*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui,sans-serif;background:#9dd0e6}.game{width:100%;height:100%;position:relative;overflow:hidden;touch-action:manipulation}canvas{width:100%;height:100%;display:block}.hud{position:absolute;top:4%;left:6%;right:6%;display:flex;justify-content:space-between;font-weight:900;font-size:22px;color:#fff;text-shadow:0 2px 4px #173f50}.guide{position:absolute;top:11%;width:100%;text-align:center;color:#fff;font-weight:900;text-shadow:0 2px 5px #234;font-size:18px;pointer-events:none}.feedback{position:absolute;top:28%;width:100%;text-align:center;font-size:35px;font-weight:1000;color:white;text-shadow:0 3px 0 #1d4648;pointer-events:none}.buttons{position:absolute;bottom:4%;left:3%;right:3%;display:flex;gap:5px;justify-content:center}.buttons button{flex:1;max-width:60px;aspect-ratio:1;border-radius:50%;background:#ffffffeb;border:0;padding:3px;box-shadow:0 3px 6px #143e5030;touch-action:manipulation}.buttons img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}.timing-ring{position:absolute;z-index:2;border:3px solid #6dff8e;border-radius:50%;box-shadow:0 0 0 1px #124d2d88,0 0 12px #4dff7966;transform:translate(-50%,-50%);pointer-events:none;display:none}.result{position:absolute;inset:0;background:#122b39aa;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#fff;font-weight:900;font-size:28px}.result button{border:0;border-radius:25px;padding:12px 28px;background:white;color:#174d5c;font-weight:900;font-size:18px}.hidden{display:none}`;
document.head.append(style);
style.textContent += `.buttons button[data-kind="0"] img,.buttons button[data-kind="2"] img{width:76%;height:76%;margin:auto}`;
root.innerHTML=`<div class="game"><canvas aria-label="3D sports court"></canvas><div class="timing-ring" aria-hidden="true"></div><div class="hud"><span class="lives"></span><span class="score"></span></div><div class="guide">Tap the matching ball</div><div class="feedback"></div><div class="buttons"></div><div class="result hidden"><div>Game over</div><p></p><button>Play again</button></div></div>`;
const game=root.querySelector('.game'),timingRing=root.querySelector('.timing-ring');
const canvas=root.querySelector('canvas'),buttons=root.querySelector('.buttons'),livesEl=root.querySelector('.lives'),scoreEl=root.querySelector('.score'),guide=root.querySelector('.guide'),feedback=root.querySelector('.feedback'),result=root.querySelector('.result');
// Flat button art is projected from the same texture used by each 3D ball.
const kinds=[{name:'Baseball',text:'HOME RUN!'},{name:'Soccer',text:'GOAL!'},{name:'Tennis',text:'WINNER!'},{name:'Basketball',text:'BASKET!'},{name:'Volleyball',text:'POINT!'}];
const ballTextures = kinds.map((_,i)=>ballTexture(i));
function flatBallIcon(texture){
  const source=texture.image,sourceContext=source.getContext('2d'),pixels=sourceContext.getImageData(0,0,source.width,source.height).data;
  const icon=document.createElement('canvas');icon.width=icon.height=128;
  const context=icon.getContext('2d'),output=context.createImageData(128,128);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
    const nx=(x+0.5-64)/59,ny=(64-y-0.5)/59,r2=nx*nx+ny*ny;
    if(r2>1)continue;
    const z=Math.sqrt(1-r2),u=Math.atan2(z,-nx)/(Math.PI*2),v=Math.acos(ny)/Math.PI;
    const tx=Math.min(source.width-1,Math.floor(u*source.width)),ty=Math.min(source.height-1,Math.floor(v*source.height));
    const from=(ty*source.width+tx)*4,to=(y*128+x)*4;
    output.data[to]=pixels[from];output.data[to+1]=pixels[from+1];output.data[to+2]=pixels[from+2];output.data[to+3]=Math.min(255,Math.round((1-Math.sqrt(r2))*59*255));
  }
  context.putImageData(output,0,0);return icon.toDataURL('image/png');
}
buttons.innerHTML=kinds.map((k,i)=>`<button aria-label="${k.name}" data-kind="${i}"><img src="${flatBallIcon(ballTextures[i])}" alt="" draggable="false"></button>`).join('');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();scene.background=new THREE.Color('#9bd5ee');scene.fog=new THREE.Fog('#bde0ed',22,48);
const camera=new THREE.PerspectiveCamera(42,1,.1,100);camera.position.set(0,7.4,15.5);camera.lookAt(0,.6,-3.5);
scene.add(new THREE.HemisphereLight(0xffffff,0x75926d,2.3));
const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-6,12,8);scene.add(sun);
const mat=(color)=>new THREE.MeshStandardMaterial({color,roughness:.85});
const palette={green:mat('#67b977'),court:mat('#dba979'),white:mat('#fff8e8'),red:mat('#df5d4e'),skin:mat('#e2ad88'),hair:mat('#49352e'),pants:mat('#365d84'),dark:mat('#252f3a')};
function box(w,h,d,m,x,y,z){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);scene.add(o);return o;}
function sphere(r,m,x,y,z,segments=14){const o=new THREE.Mesh(new THREE.SphereGeometry(r,segments,10),m);o.position.set(x,y,z);scene.add(o);return o;}
function post(x,z,h=2.2){box(.09,h,.09,palette.white,x,h/2,z);}
box(50,.12,60,palette.green,0,-.15,-5);
const stripe=mat('#73c887');for(let z=-23;z<-10;z+=2.6)box(48,.015,1.25,stripe,0,-.075,z);
box(9,.04,21,palette.court,0,-.06,-1);
const NET_Z=-2.05,VOLLEY_NET_TOP=3.25,TENNIS_NET_TOP=1.12;
const courtGreen=mat('#79aa82');box(8.55,.015,16.9,courtGreen,0,-.025,NET_Z);
function courtCircle(x,z,r){const line=new THREE.Mesh(new THREE.RingGeometry(r-.035,r+.035,64),palette.white);line.rotation.x=-Math.PI/2;line.position.set(x,.007,z);scene.add(line)}
courtCircle(0,5.2,2.4);courtCircle(0,NET_Z,1.55);
const plate=meshPlate();function meshPlate(){const shape=new THREE.Shape();shape.moveTo(-.65,0);shape.lineTo(.65,0);shape.lineTo(.65,.35);shape.lineTo(0,.8);shape.lineTo(-.65,.35);shape.closePath();const plate=new THREE.Mesh(new THREE.ShapeGeometry(shape),palette.white);plate.rotation.x=-Math.PI/2;plate.position.set(0,.01,7.05);scene.add(plate);return plate;}
for(const x of [-4.35,4.35])box(.075,.03,20,palette.white,x,-.02,-1);
for(const z of [-10.5,NET_Z,6.4,9])box(8.7,.03,.075,palette.white,0,-.02,z);
box(.06,.03,20,palette.white,0,-.02,-1);
// Sport-specific nets share the exact center of the marked 16.9-unit court.
// Their posts sit outside its sideline; tennis and volleyball never stack together.
function makeCourtNet(top,bottom,paddingColor){
 const group=new THREE.Group();group.position.z=NET_Z;scene.add(group);
 const grid=[],ink=new THREE.LineBasicMaterial({color:'#f3f3e9',transparent:true,opacity:.68});
 for(const x of [-4.3,4.3]){
  mesh(group,new THREE.CylinderGeometry(.065,.075,top+.2,12),palette.white,x,(top+.2)/2,0);
  mesh(group,new THREE.CylinderGeometry(.13,.13,.86,12),mat(paddingColor),x,.43,0);
  mesh(group,new THREE.CylinderGeometry(.21,.24,.05,12),palette.dark,x,.005,0);
  mesh(group,new THREE.SphereGeometry(.078,10,8),palette.white,x,top+.2,0);
 }
 mesh(group,new THREE.BoxGeometry(8.6,.075,.055),palette.white,0,top,0);
 mesh(group,new THREE.BoxGeometry(8.35,.035,.035),palette.white,0,bottom,0);
 for(let x=-4.15;x<=4.16;x+=.18)grid.push(new THREE.Vector3(x,bottom,0),new THREE.Vector3(x,top-.035,0));
 for(let y=bottom+.13;y<top-.035;y+=.13)grid.push(new THREE.Vector3(-4.15,y,0),new THREE.Vector3(4.15,y,0));
 group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(grid),ink));
 return group;
}
const tennisNet=makeCourtNet(TENNIS_NET_TOP,.10,'#39769a');
const volleyballNet=makeCourtNet(VOLLEY_NET_TOP,2.20,'#397d80');
tennisNet.visible=false;

// The goal is behind the incoming-ball launch plane, so other sports cannot
// spawn through its crossbar. A complete depth frame supports the rear/side net.
const GOAL_Z=-11.3,goal=new THREE.Group();goal.position.z=GOAL_Z;scene.add(goal);
const goalNetPoints=[];
for(const x of [-2.1,2.1]){
 equipmentRod(goal,[x,0,0],[x,2.3,0],.065,palette.white);
 equipmentRod(goal,[x,.065,0],[x,.065,-1.15],.045,palette.white);
 equipmentRod(goal,[x,2.3,0],[x,2.3,-1.15],.045,palette.white);
 equipmentRod(goal,[x,0,-1.15],[x,2.3,-1.15],.045,palette.white);
 for(let z=-.2;z> -1.16;z-=.2)goalNetPoints.push(new THREE.Vector3(x,.08,z),new THREE.Vector3(x,2.25,z));
 for(let y=.24;y<2.25;y+=.24)goalNetPoints.push(new THREE.Vector3(x,y,0),new THREE.Vector3(x,y,-1.15));
}
equipmentRod(goal,[-2.1,2.3,0],[2.1,2.3,0],.065,palette.white);
equipmentRod(goal,[-2.1,2.3,-1.15],[2.1,2.3,-1.15],.045,palette.white);
equipmentRod(goal,[-2.1,.065,-1.15],[2.1,.065,-1.15],.045,palette.white);
for(let x=-1.98;x<2.1;x+=.22)goalNetPoints.push(new THREE.Vector3(x,.08,-1.15),new THREE.Vector3(x,2.25,-1.15));
for(let y=.24;y<2.25;y+=.24)goalNetPoints.push(new THREE.Vector3(-2.05,y,-1.15),new THREE.Vector3(2.05,y,-1.15));
goal.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(goalNetPoints),new THREE.LineBasicMaterial({color:'#f5f5e8',transparent:true,opacity:.55})));

// A sideline basket has real connected supports and a rim mounted inside the
// lower backboard area, rather than floating below it or overlapping the goal.
const hoopX=-3.1,hoopZ=-8.6,rimY=3.35;
box(.68,.13,.78,palette.dark,hoopX,.045,hoopZ-.8);
box(.18,4.4,.18,palette.dark,hoopX,2.2,hoopZ-.8);
box(.16,.16,1.0,palette.dark,hoopX,4.2,hoopZ-.4);
box(2.5,1.45,.16,palette.white,hoopX,3.9,hoopZ);
box(2.28,1.23,.022,mat('#c6e6ef'),hoopX,3.9,hoopZ+.092);
for(const x of [-.43,.43])box(.045,.5,.025,palette.red,hoopX+x,3.65,hoopZ+.11);
for(const y of [3.4,3.9])box(.9,.045,.025,palette.red,hoopX,y,hoopZ+.11);
const rim=new THREE.Mesh(new THREE.TorusGeometry(.45,.045,10,40),palette.red);
rim.rotation.x=Math.PI/2;rim.position.set(hoopX,rimY,hoopZ+.6);scene.add(rim);
box(.12,.12,.11,palette.red,hoopX,rimY,hoopZ+.12);
const netMaterial=new THREE.LineBasicMaterial({color:0xeae9df,transparent:true,opacity:.9});
const netSegments=[];
for(let i=0;i<16;i++){
 const a=i*Math.PI*2/16,b=(i+1)*Math.PI*2/16;
 const top=new THREE.Vector3(hoopX+.44*Math.cos(a),rimY,hoopZ+.6+.44*Math.sin(a));
 const mid=new THREE.Vector3(hoopX+.42*Math.cos(a+.13),rimY-.35,hoopZ+.6+.42*Math.sin(a+.13));
 const bottom=new THREE.Vector3(hoopX+.38*Math.cos(b),rimY-.7,hoopZ+.6+.38*Math.sin(b));
 netSegments.push(top,mid,mid,bottom);
}
for(const [r,y] of [[.42,rimY-.35],[.38,rimY-.7]])for(let i=0;i<16;i++){
 const a=i*Math.PI*2/16,b=(i+1)*Math.PI*2/16;
 netSegments.push(new THREE.Vector3(hoopX+r*Math.cos(a),y,hoopZ+.6+r*Math.sin(a)),new THREE.Vector3(hoopX+r*Math.cos(b),y,hoopZ+.6+r*Math.sin(b)));
}
scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(netSegments),netMaterial));
// A few distant players and spectators give the court the same populated depth as the reference.
function distantPlayer(x,z,shirt){const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);mesh(group,new THREE.CylinderGeometry(.16,.19,.55,8),shirt,0,.85,0);mesh(group,new THREE.SphereGeometry(.18,10,8),palette.skin,0,1.27,0);for(const side of [-1,1]){mesh(group,new THREE.CylinderGeometry(.07,.06,.5,6),palette.dark,side*.11,.28,0);mesh(group,new THREE.CylinderGeometry(.055,.05,.43,6),palette.skin,side*.23,.82,0)}return group;}
const blue=mat('#437fb5'),yellow=mat('#e9b843'),purple=mat('#a477ac');
[[-3.2,-7.6,blue],[3.25,-7.8,purple],[-3.7,-13.8,yellow],[3.8,-14.2,blue],[-6.5,-19,blue],[6,-20,yellow],[-8,-22,purple],[8,-22,blue]].forEach(a=>distantPlayer(...a));

// A jointed athlete, so the hands, equipment and legs share the same motion.
const athlete = new THREE.Group();
athlete.position.set(0, 0, 6.4);
scene.add(athlete);
function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(x, y, z);
  parent.add(result);
  return result;
}
function joint(parent, x = 0, y = 0, z = 0) {
  const result = new THREE.Group();
  result.position.set(x, y, z);
  parent.add(result);
  return result;
}
const torso = joint(athlete, 0, 1.35, 0);
const jerseyProfile=[[.46,0],[.49,.12],[.43,.67],[.46,.91],[.34,1.05],[.22,1.15]].map(([x,y])=>new THREE.Vector2(x,y));
mesh(torso,new THREE.LatheGeometry(jerseyProfile,20),palette.red,0,-.025,0);
mesh(torso,new THREE.CylinderGeometry(.18,.21,.22,14),palette.skin,0,1.18,0);
mesh(torso,new THREE.SphereGeometry(.37,24,16),palette.skin,0,1.47,0);
mesh(torso,new THREE.SphereGeometry(.38,20,12,0,Math.PI*2,0,Math.PI*.45),palette.hair,0,1.47,0);
mesh(torso,new THREE.SphereGeometry(.395,20,12,0,Math.PI*2,0,Math.PI*.40),palette.red,0,1.50,0);
mesh(torso,new THREE.CylinderGeometry(.397,.397,.055,20),palette.red,0,1.62,0);
mesh(torso,new THREE.BoxGeometry(.50,.045,.30),palette.red,0,1.63,-.35);
for(const side of [-1,1]){
 mesh(torso,new THREE.SphereGeometry(.095,12,10),palette.skin,side*.345,1.45,.01);
 mesh(torso,new THREE.SphereGeometry(.025,10,8),palette.dark,side*.12,1.51,-.35);
}
const nose=mesh(torso,new THREE.SphereGeometry(.075,12,10),palette.skin,0,1.42,-.365);nose.scale.set(1,.8,.75);
// Small jersey seams clarify the silhouette during turns without extra UI/text.
for(const side of [-1,1])equipmentRod(torso,[side*.29,.20,.38],[side*.29,.75,.34],.015,palette.white);
mesh(athlete, new THREE.CylinderGeometry(.50, .43, .42, 12), palette.pants, 0, 1.15, 0);

function makeArm(side) {
  const shoulder = joint(torso, side * .46, .98, 0);
  mesh(shoulder, new THREE.SphereGeometry(.18, 14, 10), palette.red);
  mesh(shoulder,new THREE.CylinderGeometry(.155,.145,.20,12),palette.red,0,-.09,0);
  mesh(shoulder, new THREE.CylinderGeometry(.12, .105, .45, 10), palette.skin, 0, -.25, 0);
  const elbow = joint(shoulder, 0, -.48, 0);
  mesh(elbow, new THREE.SphereGeometry(.115, 10, 8), palette.skin);
  mesh(elbow, new THREE.CylinderGeometry(.105, .085, .42, 10), palette.skin, 0, -.22, 0);
  const wrist = joint(elbow, 0, -.45, 0);
  mesh(wrist, new THREE.SphereGeometry(.13, 12, 8), palette.skin);
  return { shoulder, elbow, wrist };
}
const leftArm = makeArm(-1);
const rightArm = makeArm(1);
function makeLeg(side) {
  const hip = joint(athlete, side * .23, 1.04, 0);
  mesh(hip, new THREE.CylinderGeometry(.16, .14, .56, 10), palette.pants, 0, -.27, 0);
  const knee = joint(hip, 0, -.55, 0);
  mesh(knee, new THREE.CylinderGeometry(.12, .11, .45, 10), palette.skin, 0, -.22, 0);
  const shoe=joint(knee,0,-.40,-.12);
  const upper=mesh(shoe,new THREE.CapsuleGeometry(.135,.23,4,10),palette.white);upper.rotation.x=Math.PI/2;upper.scale.z=.60;
  mesh(shoe,new THREE.BoxGeometry(.275,.045,.49),palette.pants,0,-.07,0);
  for(const z of [-.10,-.02,.06])mesh(shoe,new THREE.BoxGeometry(.14,.012,.018),palette.dark,0,.075,z);
  const toe=joint(shoe,0,0,-.235);
  return { hip, knee, toe };
}
const leftLeg = makeLeg(-1);
const rightLeg = makeLeg(1);

// Equipment is gripped at the wrist and points away from the forearm.
const racket = joint(leftArm.wrist);
const racketBlue = mat('#249bc7'), batWood = mat('#d7a567');
mesh(racket, new THREE.CylinderGeometry(.045,.045,.46,10),palette.dark,0,.19,0);
mesh(racket, new THREE.CylinderGeometry(.06,.06,.06,10),racketBlue,0,-.04,0);
const frame = mesh(racket,new THREE.TorusGeometry(.34,.035,9,40),racketBlue,0,.98,0);
frame.scale.y=.43/.34;
function equipmentRod(parent,a,b,radius,material){
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
  const rod=mesh(parent,new THREE.CylinderGeometry(radius,radius,delta.length(),8),material);
  rod.position.copy(start).add(end).multiplyScalar(.5);rod.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
}
equipmentRod(racket,[0,.4,0],[-.19,.63,0],.026,racketBlue);
equipmentRod(racket,[0,.4,0],[.19,.63,0],.026,racketBlue);
for(let i=-3;i<=3;i++){
  const x=i*.075,y=i*.09;
  const halfY=.405*Math.sqrt(1-(x/.32)**2),halfX=.32*Math.sqrt(1-(y/.405)**2);
  mesh(racket,new THREE.BoxGeometry(.009,halfY*2,.009),palette.white,x,.98,0);
  mesh(racket,new THREE.BoxGeometry(halfX*2,.009,.009),palette.white,0,.98+y,0);
}
const racketContact = joint(racket, 0, .98, 0);
const bat = joint(rightArm.wrist);
mesh(bat,new THREE.CylinderGeometry(.06,.045,.38,12),palette.dark,0,.16,0);
mesh(bat,new THREE.CylinderGeometry(.115,.055,.68,16),batWood,0,.69,0);
mesh(bat,new THREE.SphereGeometry(.115,16,10),batWood,0,1.03,0);
mesh(bat,new THREE.CylinderGeometry(.07,.07,.055,12),batWood,0,-.035,0);
const batContact = joint(bat, 0, .95, 0);
let equippedKind=-1,equipmentReveal=0;
const playerShadow = new THREE.Mesh(new THREE.CircleGeometry(.68, 28), new THREE.MeshBasicMaterial({color:0x273c32, transparent:true, opacity:.19, depthWrite:false}));
playerShadow.rotation.x = -Math.PI / 2;
playerShadow.position.set(0, .015, 6.4);
scene.add(playerShadow);

// Wrap matching sport markings around actual three-dimensional balls.
function ballTexture(kind) {
  const paint=document.createElement('canvas');paint.width=512;paint.height=256;
  const c=paint.getContext('2d');
  c.fillStyle=['#f6f5f2','#f8f8f6','#c9e62e','#e87b20','#f7f7f2'][kind];c.fillRect(0,0,512,256);c.lineCap='round';c.lineJoin='round';
  if(kind===0){
    c.strokeStyle='#b62632';c.lineWidth=5;
    for(const x of [35,290]){c.beginPath();c.moveTo(x,-10);c.bezierCurveTo(x+115,65,x+115,195,x,265);c.stroke();for(let y=12;y<252;y+=18){const xx=x+78*Math.sin(y*Math.PI/256);c.beginPath();c.moveTo(xx-8,y-5);c.lineTo(xx+9,y+5);c.stroke();}}
  }else if(kind===1){
    c.fillStyle='#21242a';c.strokeStyle='#555c60';c.lineWidth=2;
    for(let row=0;row<3;row++)for(let col=0;col<5;col++){const x=col*110+(row%2)*55,y=row*90+37;c.beginPath();for(let i=0;i<5;i++){const a=-Math.PI/2+i*2*Math.PI/5,px=x+25*Math.cos(a),py=y+25*Math.sin(a);i?c.lineTo(px,py):c.moveTo(px,py);}c.closePath();c.fill();c.stroke();}
  }else if(kind===2){
    c.strokeStyle='#f8f9e9';c.lineWidth=9;for(const off of [-256,0,256,512]){c.beginPath();c.moveTo(off+30,-10);c.bezierCurveTo(off+180,15,off+15,220,off+170,266);c.stroke();}
  }else if(kind===3){
    c.strokeStyle='#352d2a';c.lineWidth=7;for(const x of [0,128,256,384,512]){c.beginPath();c.moveTo(x,0);c.lineTo(x,256);c.stroke();}c.beginPath();c.moveTo(0,128);c.lineTo(512,128);c.stroke();c.beginPath();c.moveTo(0,20);c.bezierCurveTo(100,30,100,220,0,236);c.moveTo(256,20);c.bezierCurveTo(356,30,356,220,256,236);c.stroke();
  }else{
    c.fillStyle='#f7c52d';c.fillRect(0,0,512,75);c.fillRect(0,171,512,42);c.fillStyle='#2255a8';c.fillRect(0,78,512,45);c.fillRect(0,215,512,41);c.strokeStyle='#e0e1dc';c.lineWidth=3;for(let x=0;x<=512;x+=128){c.beginPath();c.moveTo(x,0);c.quadraticCurveTo(x+35,128,x,256);c.stroke();}
  }
  const texture=new THREE.CanvasTexture(paint);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
const ballMaterials=ballTextures.map(texture=>new THREE.MeshStandardMaterial({map:texture,roughness:.75}));
const ballGeometry=new THREE.SphereGeometry(1,24,16);
const ballRadii = [.125, .32, .115, .35, .32];
const shadowGeometry = new THREE.CircleGeometry(1, 20);
const shadowMaterial = new THREE.MeshBasicMaterial({color:0x263d32, transparent:true, opacity:.22, depthWrite:false});
function createBall(kind) {
  const object = new THREE.Mesh(ballGeometry, ballMaterials[kind]);
  object.scale.setScalar(ballRadii[kind]); scene.add(object);
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  return { mesh: object, shadow };
}
function removeBall(item) { if (!item) return; scene.remove(item.mesh, item.shadow); }
function updateShadow(item) {
  const h = Math.max(0, item.mesh.position.y);
  const size = ballRadii[item.kind] * Math.max(.42, 1.0 - h * .09);
  item.shadow.position.set(item.mesh.position.x, .018, item.mesh.position.z);
  item.shadow.scale.setScalar(size);
}
function updateEquipment(kind,dt=0) {
  if(kind!==equippedKind){equippedKind=kind;equipmentReveal=0;}
  equipmentReveal=Math.min(1,equipmentReveal+dt/.18);
  const reveal=.08+.92*ease(equipmentReveal);
  racket.visible = kind === 2 && equipmentReveal>0;
  bat.visible = kind === 0 && equipmentReveal>0;
  racket.scale.setScalar(reveal);bat.scale.setScalar(reveal);
}
const contactPoint = new THREE.Vector3();
const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
function contactFor(kind, output) {
  athlete.updateMatrixWorld(true);
  if (kind === 0) batContact.getWorldPosition(output);
  else if (kind === 2) racketContact.getWorldPosition(output);
  else if (kind === 1) rightLeg.toe.getWorldPosition(output);
  else {
    leftArm.wrist.getWorldPosition(tempA); rightArm.wrist.getWorldPosition(tempB);
    output.copy(tempA).add(tempB).multiplyScalar(.5);
  }
  // Keep the ball surface against equipment or both hands rather than
  // embedding its center in the palms. These same points drive the flight.
  if(kind===3||kind===4){
    const halfSpan=tempA.distanceTo(tempB)*.5;
    output.z-=Math.sqrt(Math.max(.01,(ballRadii[kind]+.125)**2-halfSpan*halfSpan));
  }else output.z-=ballRadii[kind]+.045;
  return output;
}
function flightPosition(out,start,target,elapsed,duration,gravity,bounceAt=0,radius=0){
  const t=elapsed/duration;
  out.set(start.x+(target.x-start.x)*t,0,start.z+(target.z-start.z)*t);
  if(bounceAt){
    const first=duration*bounceAt,second=duration-first,floor=radius+.035;
    if(elapsed<=first){
      const vertical=(floor-start.y+.5*gravity*first*first)/first;
      out.y=start.y+vertical*elapsed-.5*gravity*elapsed*elapsed;
    }else{
      const after=elapsed-first,vertical=(target.y-floor+.5*gravity*second*second)/second;
      out.y=floor+vertical*after-.5*gravity*after*after;
    }
  }else{
    const vertical=(target.y-start.y+.5*gravity*duration*duration)/duration;
    out.y=start.y+vertical*elapsed-.5*gravity*elapsed*elapsed;
  }
  return out;
}
const HIT_TIME=.12;
const HIT_WINDOW_STARTS=[.86,.88,.86,.87,.88];
const STRIKE_WINDUPS=[.09,.10,.10,.12,.11];
const hitWindowStart=kind=>HIT_WINDOW_STARTS[kind];
const timingProjection = new THREE.Vector3();
const timingCameraPosition = new THREE.Vector3();
const ACTION_DURATION=.48;
let active = !String(new URLSearchParams(location.search).get('review') || '').startsWith('batch');
const hitRingGeometry = new THREE.RingGeometry(.22, .28, 32);
let started = active, lives = 3, score = 0, ball = null, shots = [], hitEffects = [], action = null, last = 0, feedbackTime = 0, ended = false, playTime = 0, spawnDelay = 0;
function hud() { livesEl.textContent = '● '.repeat(lives) + '○ '.repeat(3 - lives); scoreEl.textContent = score; }
function ease(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
function poseAthlete(dt=0,prediction=null) {
  const kind=prediction?.kind ?? action?.kind ?? ball?.kind ?? -1;
  if(prediction){bat.scale.setScalar(1);racket.scale.setScalar(1);}else updateEquipment(kind,dt);
  const ready=prediction?1:ease(equipmentReveal);
  const t=prediction?HIT_TIME:action? action.elapsed:-1;
  const contactTime=prediction?HIT_TIME:action?.contactTime||HIT_TIME;
  const swing=t<0?0:t<contactTime?ease(t/contactTime):1-ease((t-contactTime)/(ACTION_DURATION-contactTime));
  const load=t<0?0:t<contactTime?Math.sin(Math.PI*t/contactTime):0;
  const idle=prediction||action?0:Math.sin(playTime*2.4);
  athlete.position.y=Math.abs(idle)*.018+(kind===4?swing*.28:kind===3?swing*.08:0);
  torso.rotation.set(0,idle*.025,idle*.016);
  leftArm.shoulder.rotation.set(.12,0,-.35);rightArm.shoulder.rotation.set(.12,0,.35);
  leftArm.elbow.rotation.set(-.32,0,0);rightArm.elbow.rotation.set(-.32,0,0);
  leftLeg.hip.rotation.set(idle*.035,0,0);rightLeg.hip.rotation.set(-idle*.035,0,0);
  leftLeg.knee.rotation.x=0;rightLeg.knee.rotation.x=0;
  if(kind===0){ // Step into a bat swing and rotate through contact.
    torso.rotation.y=-.18*ready-.5*load+.85*swing; rightLeg.hip.rotation.x=-.16*load+.12*swing;
    rightArm.shoulder.rotation.set(.12+.4*ready+1.0*swing,-.55*load+.4*swing,.35+.35*ready-.9*swing);
    rightArm.elbow.rotation.x=-.32-.48*ready-.5*swing;leftArm.shoulder.rotation.z=-.35-.18*swing;
    bat.rotation.set(.18,0,-Math.PI/2+.35*swing);
  }else if(kind===1){ // Plant the left foot and kick forward with the right.
    torso.rotation.z=-.15*swing;rightLeg.hip.rotation.x=-.38*load+1.22*swing;
    rightLeg.knee.rotation.x=.38*load-.35*swing;leftArm.shoulder.rotation.z=-.35-.35*swing;rightArm.shoulder.rotation.z=.35+.35*swing;
  }else if(kind===2){ // Tennis forehand with a racket follow-through.
    torso.rotation.y=.5*load-.75*swing;
    leftArm.shoulder.rotation.set(.12+.25*ready+1.2*swing,.4*load-.5*swing,-.35-.25*ready+1.05*swing);
    leftArm.elbow.rotation.x=-.55-.65*swing;rightArm.shoulder.rotation.z=.35+.18*swing;
    racket.rotation.set(.12,0,Math.PI*.72-.3*swing);
  }else if(kind===3){ // Two-handed basketball set shot towards the hoop.
    leftArm.shoulder.rotation.set(.3+2.45*swing,0,-.35+.55*swing);
    rightArm.shoulder.rotation.set(.3+2.45*swing,0,.35-.55*swing);
    leftArm.elbow.rotation.x=-.7+.5*swing;rightArm.elbow.rotation.x=-.7+.5*swing;
    leftLeg.knee.rotation.x=-.22*load;rightLeg.knee.rotation.x=-.22*load;
  }else if(kind===4){ // Jump and extend both hands to volley the ball.
    leftArm.shoulder.rotation.set(.35+2.65*swing,0,-.35+.62*swing);
    rightArm.shoulder.rotation.set(.35+2.65*swing,0,.35-.62*swing);
    leftArm.elbow.rotation.x=-.38+.26*swing;rightArm.elbow.rotation.x=-.38+.26*swing;
    leftLeg.knee.rotation.x=-.3*swing;rightLeg.knee.rotation.x=-.3*swing;
  }
}
function reset() {
  removeBall(ball); shots.forEach(removeBall); hitEffects.forEach(effect => { scene.remove(effect.mesh); effect.mesh.material.dispose(); }); ball = null; shots = []; hitEffects = []; action = null;
  lives = 3; score = 0; ended = false; started = active; last = 0; playTime = 0; spawnDelay = 0;
  athlete.position.set(0, 0, 6.4); torso.rotation.set(0, 0, 0);
  feedback.textContent = ''; guide.classList.remove('hidden'); result.classList.add('hidden');
  hud(); poseAthlete(); render();
}
function spawn() {
  const kind = Math.floor(Math.random() * kinds.length);
  const item = createBall(kind);
  const lane = (Math.random() - .5) * 3.1;
  const pace=1+Math.min(score*.018,.35);
  ball = {...item,kind,progress:0,elapsed:0,phase:'incoming',duration:[1.44,1.60,1.50,1.65,1.65][kind]/pace,
    gravity:[3.8,7.6,8.6,7.4,7][kind],bounceAt:[0,.64,.75,0,0][kind],
    start:new THREE.Vector3(lane,[2.4,.8,2.7,2.3,3.2][kind]+Math.random()*.15,-10.5),target:new THREE.Vector3()};
  // Aim once at the actual future strike pose. The thrown ball then follows a
  // fixed flight rather than chasing a moving wrist or pausing in mid-air.
  poseAthlete(0,{kind});contactFor(kind,ball.target);poseAthlete(0);
  ball.mesh.position.copy(ball.start); updateShadow(ball);
}
function finish() { ended = true; result.querySelector('p').textContent = `Score: ${score}`; result.classList.remove('hidden'); }
function showImpact(position) {
  const material = new THREE.MeshBasicMaterial({color:0xffe8a0, transparent:true, opacity:.85, depthWrite:false, side:THREE.DoubleSide});
  const ring = new THREE.Mesh(hitRingGeometry, material); ring.position.copy(position); ring.quaternion.copy(camera.quaternion); scene.add(ring);
  hitEffects.push({mesh:ring, elapsed:0});
}
function addShot(item, start) {
  const targets = [new THREE.Vector3(-1.7, 5.2, -14), new THREE.Vector3(0, 1.0, GOAL_Z-.6), new THREE.Vector3(-1.7, 1.2, -8.7), new THREE.Vector3(hoopX, rimY + .13, hoopZ + .6), new THREE.Vector3(1.5, 1.4, -8.2)];
  const target = targets[item.kind];
  shots.push({...item,start:start.clone(),target,elapsed:0,justCreated:true,duration:[.68,.78,.70,.90,.90][item.kind],gravity:[10,6,8,12,14][item.kind]});
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
}
function updateTimingRing() {
  // Close onto the ball at the same moment the matching-button input opens.
  if (!ball || ended || ball.progress < .28 || ball.progress > 1.08) {
    timingRing.style.display = 'none'; return;
  }
  timingProjection.copy(ball.mesh.position).project(camera);
  timingCameraPosition.copy(ball.mesh.position).applyMatrix4(camera.matrixWorldInverse);
  if (timingProjection.z < -1 || timingProjection.z > 1 || timingCameraPosition.z >= 0) {
    timingRing.style.display = 'none'; return;
  }
  const w=canvas.clientWidth,h=canvas.clientHeight;
  const focus=ease((ball.progress-.28)/(hitWindowStart(ball.kind)-.28));
  const radius=ballRadii[ball.kind]*h/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*(-timingCameraPosition.z));
  const diameter=2*(radius+6+52*(1-focus));
  timingRing.style.display='block';
  timingRing.style.left=`${(timingProjection.x*.5+.5)*w}px`;
  timingRing.style.top=`${(-timingProjection.y*.5+.5)*h}px`;
  timingRing.style.width=timingRing.style.height=`${diameter}px`;
  timingRing.style.opacity=String(ease((ball.progress-.28)/.13)*(1-ease((ball.progress-1)/.08))*(.5+.5*focus));
  timingRing.dataset.ready=String(ball.progress>=hitWindowStart(ball.kind)&&ball.progress<=1);
}
function render() {
  resize();
  // Keep a return's net until the ball has cleared it, then prepare the next sport.
  const crossing=shots.find(shot=>(shot.kind===2||shot.kind===4)&&shot.mesh.position.z>NET_Z-.6);
  const netKind=crossing?.kind??ball?.kind??action?.kind??4;
  tennisNet.visible=netKind===2;volleyballNet.visible=netKind===4;
  renderer.render(scene,camera);updateTimingRing();
}
function flightVelocity(out,item,elapsed){
  out.set((item.target.x-item.start.x)/item.duration,0,(item.target.z-item.start.z)/item.duration);
  if(item.bounceAt){
    const first=item.duration*item.bounceAt,second=item.duration-first,floor=ballRadii[item.kind]+.035;
    if(elapsed<=first)out.y=(floor-item.start.y+.5*item.gravity*first*first)/first-item.gravity*elapsed;
    else out.y=(item.target.y-floor+.5*item.gravity*second*second)/second-item.gravity*(elapsed-first);
  }else out.y=(item.target.y-item.start.y+.5*item.gravity*item.duration*item.duration)/item.duration-item.gravity*elapsed;
  return out;
}
function strikeFlightPosition(out,item,u){
  const t=Math.max(0,Math.min(1,u)),t2=t*t,t3=t2*t;
  return out.copy(item.strikeStart).multiplyScalar(2*t3-3*t2+1)
    .addScaledVector(item.strikeStartVelocity,(t3-2*t2+t)*item.contactDelay)
    .addScaledVector(item.target,-2*t3+3*t2)
    .addScaledVector(item.strikeEndVelocity,(t3-t2)*item.contactDelay);
}
function beginHit(){
  if(!ball||ball.phase!=='incoming'||ball.progress>1)return;
  // Start the attack on this click, and join the remaining approach smoothly
  // to the actual future contact pose over a short, sport-specific windup.
  ball.phase='queued';ball.queuedElapsed=0;ball.queuedProgress=ball.progress;
  ball.contactDelay=Math.max(.001,Math.min(STRIKE_WINDUPS[ball.kind],ball.duration-ball.elapsed));
  ball.strikeStart=ball.mesh.position.clone();
  ball.strikeStartVelocity=flightVelocity(new THREE.Vector3(),ball,ball.elapsed);
  ball.strikeEndVelocity=flightVelocity(new THREE.Vector3(),ball,ball.duration);
  action={kind:ball.kind,elapsed:0,contactTime:ball.contactDelay};
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, .05) : 0; last = now;
  if (active && !document.hidden && !ended && started) {
    playTime += dt;
    if (action) { action.elapsed += dt; if (action.elapsed >= ACTION_DURATION) action = null; }
    poseAthlete(dt);
    if (!ball) { spawnDelay -= dt; if (spawnDelay <= 0) spawn(); }
    if (ball) {
      ball.elapsed+=dt;ball.progress=ball.elapsed/ball.duration;
      if(ball.phase==='queued'){
        ball.queuedElapsed+=dt;const arrival=Math.min(1,ball.queuedElapsed/ball.contactDelay);
        ball.progress=ball.queuedProgress+(1-ball.queuedProgress)*arrival;
        strikeFlightPosition(ball.mesh.position,ball,arrival);
      }else flightPosition(ball.mesh.position,ball.start,ball.target,ball.elapsed,ball.duration,ball.gravity,ball.bounceAt,ballRadii[ball.kind]);
      if(ball.phase==='queued'&&ball.progress>=1){
        action=action||{kind:ball.kind,elapsed:0,contactTime:HIT_TIME};action.elapsed=action.contactTime;poseAthlete(0);
        contactFor(ball.kind,contactPoint);
        const impact=ball.mesh.position.clone();game.dataset.lastImpactGap=impact.distanceTo(contactPoint).toFixed(4);game.dataset.lastHit=kinds[ball.kind].name;
        showImpact(impact);score++;hud();feedback.textContent=kinds[ball.kind].text;feedbackTime=.7;
        addShot(ball,impact);ball=null;spawnDelay=.22;
      }else if(ball.progress>1.08){removeBall(ball);ball=null;spawnDelay=.22;lives--;hud();if(lives<=0)finish();}
      if(ball){ball.mesh.rotation.x+=dt*[13,8,18,6,4.5][ball.kind];ball.mesh.rotation.y+=dt*(ball.kind===0?4:1.4);updateShadow(ball);}
    }
    for (let i = shots.length - 1; i >= 0; i--) {
      const shot = shots[i]; if (shot.justCreated) shot.justCreated = false; else shot.elapsed += dt;
      if(shot.kind===3&&shot.elapsed>shot.duration){
        const through=shot.elapsed-shot.duration;shot.mesh.position.copy(shot.target);shot.mesh.position.y-=1.1*through+6*through*through;
      }else flightPosition(shot.mesh.position,shot.start,shot.target,Math.min(shot.elapsed,shot.duration),shot.duration,shot.gravity);
      shot.mesh.rotation.x += dt * 5; shot.mesh.rotation.z += dt * 2; updateShadow(shot);
      if(shot.elapsed>=shot.duration+(shot.kind===3?.34:0)){removeBall(shot);shots.splice(i,1);}
    }
    for (let i = hitEffects.length - 1; i >= 0; i--) {
      const effect = hitEffects[i]; effect.elapsed += dt; const t = Math.min(effect.elapsed / .28, 1);
      effect.mesh.scale.setScalar(.65 + t * 1.25); effect.mesh.material.opacity = .75 * (1 - t);
      if (t >= 1) { scene.remove(effect.mesh); effect.mesh.material.dispose(); hitEffects.splice(i, 1); }
    }
    if (feedbackTime > 0 && (feedbackTime -= dt) <= 0) feedback.textContent = '';
  }
  game.dataset.ballKind = ball ? kinds[ball.kind].name : '';
  game.dataset.ballProgress = ball ? ball.progress.toFixed(3) : '';
  game.dataset.ballPhase = ball?.phase || '';
  render(); requestAnimationFrame(tick);
}
buttons.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !active || ended) return;
  guide.classList.add('hidden'); started = true;
  if (!ball || ball.phase !== 'incoming' || ball.progress < hitWindowStart(ball.kind)) return;
  if (+b.dataset.kind === ball.kind) beginHit();
  else { removeBall(ball); ball = null; spawnDelay = .25; lives--; hud(); feedback.textContent = 'MISS'; feedbackTime = .6; if (lives <= 0) finish(); }
});
result.querySelector('button').onclick = reset;
window.addEventListener('message', e => {
  if (e.source === parent && e.data?.type === 'playable-active') { active = !!e.data.active; if (active && !ended) started = true; last = 0; }
});
window.addEventListener('resize', render); reset(); requestAnimationFrame(tick);

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n@font-face{font-family:UIPlay;src:url('./assets/ui/DynaPuff-SemiBold.woff2') format('woff2');font-weight:600;font-display:swap}\n.hud{top:30px;left:30px;right:30px;font-family:UIPlay,UIBody,sans-serif;font-size:28px;font-weight:600}\n.guide{top:12.5%;left:30px;right:30px;width:auto;font-family:UIPlay,UIBody,sans-serif;font-size:18px;font-weight:600}\n.feedback{top:28%;left:30px;right:30px;width:auto;font-family:UIPlay,UIBody,sans-serif;font-size:28px;font-weight:600}\n.buttons{left:30px;right:30px;bottom:50px;gap:7px}\n.buttons button{min-width:44px;min-height:44px;max-width:60px;border:2px solid #fff;padding:4px;box-shadow:0 3px 0 #346b7e55}\n.buttons button:active{transform:translateY(2px);box-shadow:0 1px 0 #346b7e55}\n.result{padding:30px 30px 50px;font-family:UIPlay,UIBody,sans-serif;font-size:24px;text-align:center}\n.result p{font:600 44px/1.2 UIPlay,UIBody,sans-serif;margin:18px 0 26px}\n.result button{font:700 16px/1.3 UIBody,system-ui,sans-serif;min-height:48px}\n";
  document.head.append(uiStyle);
})();
