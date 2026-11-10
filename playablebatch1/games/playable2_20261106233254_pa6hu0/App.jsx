import React, {useState, useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import * as THREE from 'three';

// Keep startup usable when the host stalls the local config request.
async function loadGameConfig() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let deadline;
  try {
    const request = fetch('./game.config.json', { signal: controller?.signal }).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    const timeout = new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('timed out')), 1200);
    });
    const config = await Promise.race([request, timeout]);
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        ['tweaks', 'texts', 'images'].some(key => config[key] != null && !Array.isArray(config[key]))) {
      throw new Error('invalid config');
    }
    return config;
  } catch (error) {
    console.warn('[playable] Using packaged defaults:', error.message);
    return null;
  } finally {
    clearTimeout(deadline);
    controller?.abort();
  }
}

// Some hosts only notify the game through the window resize event.
function watchGameSize(container, resize) {
  resize();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', resize);
  return () => window.removeEventListener('resize', resize);
}

// The feed cover can animate without touching the real game state.
let inFeedCover = window.parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
if (inFeedCover) {
  document.documentElement.dataset.feedCover = 'true';
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    inFeedCover = event.data.active !== true;
    document.documentElement.dataset.feedCover = String(inFeedCover);
  });
}

const CSS = `
@font-face {
  font-family: 'Poppins';
  src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Poppins';
  src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: "Poppins", "PingFang SC", system-ui, sans-serif;
  --font-body:    "Poppins", "PingFang SC", system-ui, sans-serif;
  --font-mono:    ui-monospace, Menlo, monospace;
}
*{box-sizing:border-box} button{font-family:var(--font-body);cursor:pointer;-webkit-tap-highlight-color:transparent} .app{position:relative;width:100%;height:100%;overflow:clip;background:#3d99af;color:#375f56;font-family:var(--font-body);touch-action:none} canvas{display:block;width:100%;height:100%;touch-action:none} .hint{position:absolute;top:22%;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;color:#f3f4e8;pointer-events:none;animation:breathe 3s ease-in-out infinite;text-shadow:0 2px 5px #102f44} @keyframes breathe{50%{opacity:.65}} @media(prefers-reduced-motion:reduce){.hint{animation:none}} .right{position:absolute;right:30px;top:43%;transform:translateY(-30%);display:flex;flex-direction:column;border-radius:22px;background:#f4f3e5f2;box-shadow:0 4px 12px #10394e44;overflow:hidden} .round{border:0;background:transparent;color:#3e5b50;width:44px;height:44px;display:grid;place-items:center} .round:nth-child(3){border-top:1px solid #c8d3c6} .round:disabled{opacity:.4;cursor:default}.round .tool-icon{width:24px;height:24px}.toolbar{position:absolute;bottom:50px;left:50%;transform:translateX(-50%);width:calc(100% - 60px);max-width:440px;background:#fbf8ec;border:1px solid #fffaf0;border-radius:23px;box-shadow:0 9px 28px #397f7650,0 2px 3px #fff inset;display:flex;padding:7px;gap:3px}.tool{min-width:0;flex:1;border:0;border-radius:16px;background:transparent;color:#4b5e50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:44px;padding:8px 1px 7px;font-size:10px;font-weight:700;line-height:1.2}.tool-icon{width:31px;height:31px;display:block;flex:none;background-image:url('./assets/icons/island-toolkit-mono-v2.png');background-size:400% 400%;background-repeat:no-repeat;pointer-events:none}
.tool.active{background:#dce7d3;color:#2d4839;box-shadow:inset 0 0 0 1px #adc1a1}.tray{position:absolute;bottom:134px;left:50%;transform:translateX(-50%);display:flex;gap:6px;background:#fbf8ec;padding:6px;border-radius:18px;box-shadow:0 5px 20px #397f7640}.choice{border:0;border-radius:12px;background:transparent;color:#769689;width:45px;height:42px;display:grid;place-items:center}.choice.active{background:#dbe9d9;color:#477966}.choice .tool-icon{width:32px;height:32px}.menu{position:absolute;bottom:134px;right:30px;z-index:1;width:204px;padding:14px;background:#fbf8ec;border-radius:18px;box-shadow:0 7px 22px #397f7640;color:#55786c;font-size:12px}.menu-title{font-weight:700;margin-bottom:8px}.sizes{display:flex;gap:7px}.sizes button{flex:1;height:34px;border:0;border-radius:10px;color:#66897a;background:#ecf2e7;font-weight:700}.sizes button.active{background:#c8ddc8;color:#416b5b}.reset{border:0;border-top:1px solid #dfe8d9;margin-top:12px;padding:11px 0 0;width:100%;text-align:left;background:none;color:#a56b61;font-size:12px;font-weight:700}.confirm{position:absolute;inset:0;z-index:2;background:#234e4b60;display:flex;align-items:center;justify-content:center}.dialog{width:min(280px, calc(100% - 50px));padding:22px;border-radius:22px;background:#fbf8ec;text-align:center;box-shadow:0 12px 40px #214f4a44}.dialog h2{font-size:17px;margin:0 0 6px}.dialog p{font-size:12px;margin:0 0 18px;color:#789487}.dialog div{display:flex;gap:8px}.dialog button{flex:1;border:0;border-radius:12px;padding:11px;background:#e6eee1;color:#55786c;font-weight:700}.dialog .danger{background:#b97c6d;color:white}
[data-feed-cover="true"] .right,[data-feed-cover="true"] .toolbar,[data-feed-cover="true"] .tray{visibility:hidden}
@media(max-width:350px){.toolbar{width:calc(100% - 44px);padding:5px;gap:1px}.tool{font-size:9px}.tool .tool-icon{width:27px;height:27px}}
`;
const icons=['Build','Lower','Plant','Decorate','Look','more','undo','redo',
  'plus','minus','tree','bush','flower','rock','shell','star'];
function Icon({name}) {
 const index = icons.indexOf(name);
 return <span className="tool-icon" aria-hidden="true"
   style={{backgroundPosition:`${index%4*100/3}% ${Math.floor(index/4)*100/3}%`}}/>;
}
const play=(name)=>{try{window.SFX?.play(name)}catch(e){}};
const flowerVariantsCount=4;
const clone=o=>JSON.parse(JSON.stringify(o));
const key=(x,z)=>`${x},${z}`;
function makeWaterTexture() {
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = 256;
 const ctx = canvas.getContext('2d');
 const pixels = ctx.createImageData(256, 256);
 for (let y = 0; y < 256; y++) {
   for (let x = 0; x < 256; x++) {
     const u = x * Math.PI / 128;
     const v = y * Math.PI / 128;
     const swell = Math.sin(u + 2 * v + Math.sin(v)) * 4 + Math.sin(3 * u - v) * 2.5;
     const i = (y * 256 + x) * 4;
     pixels.data.set([61 + swell, 153 + swell, 175 + swell, 255], i);
   }
 }
 ctx.putImageData(pixels, 0, 0);
 ctx.fillStyle = '#fff9c958';
 for (let i = 0; i < 166; i++) {
   const x = (i * 97.91 + Math.sin(i * 13.1) * 17 + 256) % 256;
   const y = (i * 61.17 + Math.cos(i * 7.3) * 12 + 256) % 256;
   ctx.fillRect(x, y, 1.2 + i % 4 * .35, .9);
 }
 const texture = new THREE.CanvasTexture(canvas);
 texture.colorSpace = THREE.SRGBColorSpace;
 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
 texture.repeat.set(35, 35);
 texture.anisotropy = 4;
 return texture;
}
const WATER_Y = -.075;
const smooth = THREE.MathUtils.smoothstep;

function createTerrain(cells, size, middle, terrainMaterial, shallowsMaterial) {
 const entries = Object.entries(cells).filter(([, cell]) => cell.h > 0);
 if (!entries.length) return null;
 const indices = entries.map(([id]) => id.split(',').map(Number));
 const height = (x,z) => cells[key(x,z)]?.h || 0;
 function profile(x,z) {
   const ix = Math.floor(x), iz = Math.floor(z);
   const u = smooth(x - ix, 0, 1), v = smooth(z - iz, 0, 1);
   const a=height(ix,iz), b=height(ix+1,iz), c=height(ix,iz+1), d=height(ix+1,iz+1);
   const wa=(1-u)*(1-v), wb=u*(1-v), wc=(1-u)*v, wd=u*v;
   const coverage = (a?wa:0)+(b?wb:0)+(c?wc:0)+(d?wd:0);
   const total = a*wa+b*wb+c*wc+d*wd;
   const land = smooth(coverage, .09, .90);
   const grain = Math.sin(x * 16.1 + z * 13.4) * Math.cos(z * 21.2 - x * 7.7);
   const y = -.19 + (.24 * (coverage > 0 ? total / coverage : 0) + .17) * land + grain * .013 * land;
   return {y,coverage,grain};
 }
 const x0 = Math.min(...indices.map(([x])=>x))-1, x1 = Math.max(...indices.map(([x])=>x))+1;
 const z0 = Math.min(...indices.map(([,z])=>z))-1, z1 = Math.max(...indices.map(([,z])=>z))+1;
 const subdivisions = 5;
 const columns = (x1-x0)*subdivisions+1, rows = (z1-z0)*subdivisions+1;
 const terrainPositions=[], waterPositions=[], terrainColors=[], waterColors=[], faces=[];
 const sand = new THREE.Color('#efd9a8'), wetSand = new THREE.Color('#b1bd8e');
 const grass = new THREE.Color('#76ba60'), moss = new THREE.Color('#a2d17a');
 const slate = new THREE.Color('#a9a79a'), turquoise = new THREE.Color('#74cebd');
 const foam = new THREE.Color('#d2e6c5'), color = new THREE.Color(), edge = new THREE.Color();
 const samples = Array.from({length:rows*columns},(_,i)=>profile(
   x0+(i%columns)/subdivisions,z0+Math.floor(i/columns)/subdivisions));
 const spacing = size/subdivisions;
 for (let row=0; row<rows; row++) {
   for (let col=0; col<columns; col++) {
     const x = x0+col/subdivisions, z = z0+row/subdivisions;
     const index = row*columns+col;
     const {y,coverage,grain} = samples[index];
     const worldX = (x-middle)*size, worldZ = (z-middle)*size;
     const left = col>0 ? samples[index-1].y : y;
     const right = col<columns-1 ? samples[index+1].y : y;
     const back = row>0 ? samples[index-columns].y : y;
     const front = row<rows-1 ? samples[index+columns].y : y;
     const slope = Math.max(Math.abs(right-left),Math.abs(front-back)) / (2*spacing);
     color.copy(wetSand).lerp(sand,smooth(y,WATER_Y,.15));
     const inland = smooth(y,.23,.55) * smooth(coverage,.59,.98);
     edge.copy(grass).lerp(moss,.47+.3*Math.sin(x*4.3+z*2.7));
     color.lerp(edge,inland);
     color.lerp(slate,smooth(slope,.55,1.8)*smooth(y,.17,.49)*.82);
     color.multiplyScalar(1 + .045*grain + .04*Math.sin(x*7.1-z*6.3));
     terrainPositions.push(worldX,y,worldZ);
     terrainColors.push(color.r,color.g,color.b);
     const shoreLine = 1-smooth(Math.abs(y-WATER_Y),.015,.10);
     const wash = smooth(coverage,.015,.25)*(1-smooth(y,WATER_Y,WATER_Y+.035));
     edge.copy(turquoise).lerp(foam,shoreLine*.74);
     waterPositions.push(worldX,WATER_Y+.006,worldZ);
     waterColors.push(edge.r,edge.g,edge.b,wash*(.21+.30*shoreLine));
     if (row===rows-1 || col===columns-1) continue;
     const a=row*columns+col, b=a+1, c=a+columns, d=c+1;
     faces.push(a,c,b,b,c,d);
   }
 }
 function geometry(positions, colors, colorSize) {
   const result = new THREE.BufferGeometry();
   result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
   result.setAttribute('color',new THREE.Float32BufferAttribute(colors,colorSize));
   result.setIndex(faces);
   return result;
 }
 const terrainGeometry = geometry(terrainPositions,terrainColors,3);
 terrainGeometry.computeVertexNormals();
 return {
   land: new THREE.Mesh(terrainGeometry,terrainMaterial),
   shallows: new THREE.Mesh(geometry(waterPositions,waterColors,4),shallowsMaterial),
   heightAt: (x,z) => profile(x,z).y,
 };
}

function createPropModels() {
 const models = {};
 const materials = [], geometries = [];
 const treeVariants = [], flowerVariants = [];
 function mat(color, extra={}) {
   const material = new THREE.MeshStandardMaterial({color,roughness:.92,flatShading:true,...extra});
   materials.push(material);
   return material;
 }
 function shape(geometry) {
   geometries.push(geometry);
   return geometry;
 }
 function lumpy(detail, seed) {
   const geometry = new THREE.IcosahedronGeometry(1, detail);
   const positions = geometry.attributes.position;
   for (let i=0; i<positions.count; i++) {
     const x=positions.getX(i), y=positions.getY(i), z=positions.getZ(i);
     const scale = 1 + Math.sin(x*9+z*6+seed)*Math.cos(y*8-z*4)*.105;
     positions.setXYZ(i,x*scale,y*scale,z*scale);
   }
   // Flat materials show the triangular facets across foliage and rocks.
   geometry.computeVertexNormals();
   return shape(geometry);
 }
 const crown=lumpy(1,2.3), shrub=lumpy(1,5.1), stone=lumpy(1,9.2);
 const stem=shape(new THREE.CylinderGeometry(.70,1,1,7));
 const petal=shape(new THREE.IcosahedronGeometry(1,0));
 const bark=mat('#9a6b42'), pine=mat('#4c9c53'), pineLight=mat('#80c968'), sage=mat('#6ea85d');
 const foliage=mat('#65ae66'), paleLeaf=mat('#a6cf76'), slate=mat('#a8a99e',{flatShading:true});
 const quartz=mat('#d8cbb4',{flatShading:true}), blossom=mat('#fff3c9'), pollen=mat('#e7ad45');
 const shellMaterial=mat('#f5d8bc',{side:THREE.DoubleSide});
 const flowerPink=mat('#f1a5a8'), flowerLilac=mat('#bca7df'), flowerYellow=mat('#ffcf62');
 const coral=mat('#b46854');
 function add(group,geometry,material,x,y,z,sx,sy,sz) {
   const mesh = new THREE.Mesh(geometry,material);
   mesh.position.set(x,y,z);
   mesh.scale.set(sx,sy,sz);
   group.add(mesh);
   return mesh;
 }
 function branch(group,from,to,width,material) {
   const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
   const direction = end.clone().sub(start);
   const mid = start.clone().lerp(end,.5);
   const mesh = add(group,stem,material,mid.x,mid.y,mid.z,width,direction.length(),width);
   mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
   return mesh;
 }
 // Each tree is real faceted geometry, with a visible trunk and a full crown.
 // Three silhouettes make the planted island feel varied at every angle.
 const cone=shape(new THREE.ConeGeometry(1,1,7));
 for (let variant=0; variant<3; variant++) {
   const tree=new THREE.Group();
   branch(tree,[0,0,0],[0,.78,0],.055,bark);
   if (variant===2) {
     for (let tier=0; tier<3; tier++) {
       const scale=.34-tier*.075;
       add(tree,cone,tier===1?pineLight:pine,0,.48+tier*.205,0,scale,.43,scale);
     }
   } else {
     branch(tree,[0,.40,0],[-.17,.69,.02],.025,bark);
     branch(tree,[0,.45,0],[.16,.73,-.04],.025,bark);
     add(tree,crown,pine,0,.72,0,.27,.27,.25);
     add(tree,crown,pineLight,-.16,.72,.03,.20,.20,.19);
     add(tree,crown,foliage,.16,.76,-.035,.19,.21,.19);
     add(tree,crown,pineLight,.025,.91,.025,.18,.19,.18);
     if (variant===1) {
       add(tree,crown,foliage,.02,.68,-.18,.20,.18,.18);
       tree.scale.set(1.05,.9,1.05);
     }
   }
   treeVariants.push(tree);
 }
 models.tree=treeVariants[0];
 const bush=models.bush=new THREE.Group();
 for (let i=0; i<7; i++) {
   const angle=i*2.40, radius=i===0?0:.11+i*.015;
   add(bush,shrub,i%3===0?paleLeaf:foliage,Math.cos(angle)*radius,.12+(i%3)*.024,
     Math.sin(angle)*radius,.12+(i%2)*.032,.10+(i%3)*.025,.11);
 }
 const rock=models.rock=new THREE.Group();
 add(rock,stone,slate,-.048,.103,.02,.19,.13,.14).rotation.set(.15,.7,-.21);
 add(rock,stone,quartz,.12,.054,-.05,.11,.073,.09).rotation.y=1.2;
 add(rock,stone,slate,.11,.041,.12,.068,.052,.06).rotation.y=-.65;
 // Different flowers are chosen at planting and kept stable as the island redraws.
 for (let variety=0; variety<4; variety++) {
   const flowers=new THREE.Group();
   const petals=[blossom,flowerPink,flowerLilac,flowerYellow][variety];
   const petalCount=variety===2?6:5;
   for (let i=0; i<3; i++) {
     const x=(i-1)*.107, y=.19+i%2*.076, z=i===1?-.088:.061;
     branch(flowers,[x*.58,0,z*.55],[x,y,z],.011,sage);
     const leaf=add(flowers,petal,paleLeaf,x-.029,y*.48,z,.054,.016,.026);
     leaf.rotation.z=.46;
     for (let j=0; j<petalCount; j++) {
       const angle=j*Math.PI*2/petalCount;
       const radius=variety===3?.035:.043;
       const p=add(flowers,petal,petals,x+Math.cos(angle)*radius,y,z+Math.sin(angle)*radius,
         variety===2?.031:.040,.015,variety===1?.034:.026);
       p.rotation.y=-angle;
     }
     add(flowers,petal,pollen,x,y+.014,z,.029,.019,.029);
   }
   flowerVariants.push(flowers);
 }
 models.flower=flowerVariants[0];
 // A small faceted shell, scaled down to sit naturally alongside the trees.
 const shell=models.shell=new THREE.Group();
 const shellPositions=[],shellFaces=[];
 for(let row=0;row<=6;row++) {
   const r=row/6;
   for(let col=0;col<=16;col++) {
     const u=col/16,a=(u-.5)*2.33,rib=Math.cos(u*Math.PI*16),edge=.217+r*r*.008*rib;
     shellPositions.push(Math.sin(a)*r*edge,.021+.088*Math.sin(Math.PI*r)*(.74+.22*Math.cos(a))+.011*r*(1+rib),.125-Math.cos(a)*r*edge*1.37);
     if(row===6 || col===16)continue;
     const i=row*17+col;shellFaces.push(i,i+17,i+1,i+1,i+17,i+18);
   }
 }
 const shellGeometry=shape(new THREE.BufferGeometry());
 shellGeometry.setAttribute('position',new THREE.Float32BufferAttribute(shellPositions,3));
 shellGeometry.setIndex(shellFaces);shellGeometry.computeVertexNormals();
 add(shell,shellGeometry,shellMaterial,0,0,0,1,1,1);
 shell.scale.setScalar(.55);
 const star=models.star=new THREE.Group();
 const starShape=new THREE.Shape();
 for (let i=0; i<10; i++) {
   const a=i*Math.PI/5+Math.PI/2;
   const r=i%2 ? .083 : .184+(i%3)*.011;
   if (i===0) starShape.moveTo(Math.cos(a)*r,Math.sin(a)*r);
   else starShape.lineTo(Math.cos(a)*r,Math.sin(a)*r);
 }
 starShape.closePath();
 const starGeometry=shape(new THREE.ExtrudeGeometry(starShape,{
   depth:.021,bevelEnabled:true,bevelSize:.016,bevelThickness:.012,bevelSegments:2,
 }));
 starGeometry.rotateX(-Math.PI/2);
 add(star,starGeometry,coral,0,.014,0,1,1,1);
 for (let i=0; i<5; i++) {
   const a=i*Math.PI*2/5+Math.PI/2;
   for (let j=0; j<2; j++) {
     const r=.051+j*.049;
     add(star,petal,pollen,Math.cos(a)*r,.052,-Math.sin(a)*r,.012,.006,.012);
   }
 }

 star.scale.setScalar(.58);

 const shadowCanvas=document.createElement('canvas');
 shadowCanvas.width=shadowCanvas.height=32;
 const ctx=shadowCanvas.getContext('2d');
 const radial=ctx.createRadialGradient(16,16,0,16,16,16);
 radial.addColorStop(0,'#293a2f73');
 radial.addColorStop(.50,'#293a2f40');
 radial.addColorStop(1,'#293a2f00');
 ctx.fillStyle=radial;ctx.fillRect(0,0,32,32);
 const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
 shadowTexture.colorSpace=THREE.SRGBColorSpace;
 const shadowMaterial=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
 materials.push(shadowMaterial);
 const shadowGeometry=shape(new THREE.PlaneGeometry(.61,.61));
 shadowGeometry.rotateX(-Math.PI/2);

 return {
   add(group,item,x,y,z,ix,iz,flowerVariant) {
     const variation=(Math.sin(ix*127.1+iz*311.7)+1)/2;
     const template=item==='tree' && treeVariants.length
       ? treeVariants[Math.min(treeVariants.length-1, Math.floor(variation*treeVariants.length))]
       : item==='flower' ? flowerVariants[Number.isInteger(flowerVariant) ? Math.abs(flowerVariant)%flowerVariants.length : Math.min(flowerVariants.length-1,Math.floor(variation*flowerVariants.length))]
       : models[item];
     if (!template) return;
     const model=template.clone(true);
     model.position.set(x,y-.006,z);
     model.rotation.y=variation*Math.PI*2;
     model.scale.multiplyScalar(.88+variation*.24);
     group.add(model);
     const shadowScale=(item==='shell'||item==='star') ? .46 : 1;
     add(group,shadowGeometry,shadowMaterial,x,y+.017,z,shadowScale,1,shadowScale);
   },
   dispose() {
     shadowTexture.dispose();
     geometries.forEach(geometry=>geometry.dispose());
     materials.forEach(material=>material.dispose());
   },
 };
}
function App(){
 const [cfg,setCfg]=useState(null),[mode,setMode]=useState('Build'),[choice,setChoice]=useState('tree'),[hint,setHint]=useState(true),[menu,setMenu]=useState(false),[confirm,setConfirm]=useState(false),[brush,setBrush]=useState(1),[version,setVersion]=useState(0); const host=useRef(null),state=useRef(null),engine=useRef(null),modeRef=useRef(mode),choiceRef=useRef(choice),brushRef=useRef(brush); modeRef.current=mode;choiceRef.current=choice;brushRef.current=brush;
 useEffect(()=>{window.SFX?.register({click:'./assets/sfx_click.mp3',plop:'./assets/sfx_plop.mp3',earth:'buzzer',foliage:'./assets/sfx_leaves.mp3',rotate:'buzzer',history:'buzzer'});loadGameConfig().then(config=>{const d=config||{};const c={GRID_SIZE:17,MAX_HEIGHT:4,BRUSH_SIZE:1,HINT:'Drag to build land'};for(const a of [...(d.tweaks||[]),...(d.texts||[])])c[a.id]=a.value;setCfg(c);setBrush(c.BRUSH_SIZE)})},[]);
 useEffect(()=>{if(!cfg||!host.current)return;const n=cfg.GRID_SIZE, size=.64, mid=(n-1)/2;let saved;try{saved=JSON.parse(localStorage.getItem('island-sandbox-v1')||'null')}catch(e){};
 const migratedCells={};
 if(saved?.cells && Number.isInteger(saved.n)) {
  const offset=Math.floor((n-saved.n)/2);
  for(const [id,cell] of Object.entries(saved.cells)) {
   const [x,z]=id.split(',').map(Number), nx=x+offset, nz=z+offset;
   if(nx>=0&&nx<n&&nz>=0&&nz<n) {
    migratedCells[key(nx,nz)]={...cell,item:cell.item==='umbrella'?null:cell.item};
   }
  }
 }
 state.current={cells:migratedCells,undo:[],redo:[],started:!!saved?.started};if(state.current.started)setHint(false);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#3d99af');scene.fog=new THREE.Fog('#3d99af',20,38);const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;host.current.appendChild(renderer.domElement);
 const camera=new THREE.OrthographicCamera(-5,5,5,-5,.1,100);let angle=.76,zoom=1;const updateCamera=()=>{let w=host.current.clientWidth,h=host.current.clientHeight;let aspect=w/h;let span=Math.max(10.8,(8.5*Math.sqrt(n/11))/aspect)/zoom;camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.position.set(Math.sin(angle)*11,10,Math.cos(angle)*11);camera.lookAt(0,0,0);camera.updateProjectionMatrix()};
 scene.add(new THREE.HemisphereLight('#fff8e7','#b5c695',1.65));
 const sun=new THREE.DirectionalLight('#fff3cb',2.35);
 sun.position.set(-5,10,6);
 scene.add(sun);
 const waterTexture=makeWaterTexture();
 const water=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshBasicMaterial({map:waterTexture}));
 water.rotation.x=-Math.PI/2;
 water.position.y=WATER_Y;
 scene.add(water);

 const terrainMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,flatShading:true});
 const shallowsMaterial=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,depthWrite:false});
 const propModels=createPropModels();
 const terrain=new THREE.Group();
 scene.add(terrain);
 let surface=null;
 function placeModels(group, cells, terrainSurface) {
   for (const [id,cell] of Object.entries(cells)) {
     if (!cell.h || !cell.item) continue;
     const [ix,iz]=id.split(',').map(Number);
     propModels.add(group,cell.item,(ix-mid)*size,terrainSurface.heightAt(ix,iz),(iz-mid)*size,ix,iz,cell.flowerVariant);
   }
 }
 function releaseSurface(surface) {
   if (!surface) return;
   surface.land.geometry.dispose();
   surface.shallows.geometry.dispose();
 }
 function renderTerrain() {
   releaseSurface(surface);
   terrain.clear();
   const cells=state.current.cells;
   surface=createTerrain(cells,size,mid,terrainMaterial,shallowsMaterial);
   if (!surface) return;
   terrain.add(surface.land,surface.shallows);
   placeModels(terrain,cells,surface);
   terrain.updateMatrixWorld(true);
 }
 const outlineBox=new THREE.BoxGeometry(size*.95,.025,size*.95);
 const outline=new THREE.LineSegments(new THREE.EdgesGeometry(outlineBox),
   new THREE.LineBasicMaterial({color:'#edf1cc',transparent:true,opacity:.88}));
 outlineBox.dispose();
 outline.visible=false;
 scene.add(outline);

 // The feed shows a small island rising; the actual editable water remains empty.
 const preview=new THREE.Group();
 const previewCells={};
 for (let x=-2; x<=2; x++) {
   for (let z=-2; z<=2; z++) {
     const d=Math.hypot(x-.24,z+.15);
     if (d>2.32) continue;
     const item=x===0&&z===-1?'tree':x===1&&z===0?'bush':x===-1&&z===1?'rock':null;
     previewCells[key(Math.floor(mid)+x,Math.floor(mid)+z)]={h:d<.78?3:d<1.57?2:1,item};
   }
 }
 const previewSurface=createTerrain(previewCells,size,mid,terrainMaterial,shallowsMaterial);
 preview.add(previewSurface.land);
 const previewProps = new THREE.Group();
 preview.add(previewProps);
 placeModels(previewProps,previewCells,previewSurface);
 scene.add(preview,previewSurface.shallows);
 const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
 let raf;const resize=()=>{const w=host.current.clientWidth,h=host.current.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);updateCamera()};const unwatchSize=watchGameSize(host.current,resize);renderTerrain();
 function loop(t){
   raf=requestAnimationFrame(loop);
   if(document.hidden)return;
   const showingPreview = inFeedCover && !state.current.started;
   preview.visible=showingPreview;
   const rise=reducedMotion.matches ? 1 : .22+.78*smooth((t%5500)/1000,.20,1.45)*(1-.82*smooth((t%5500)/1000,4.25,5.42));
   preview.scale.y=rise;
   preview.position.y=WATER_Y*(1-rise);
   previewSurface.shallows.visible=showingPreview && rise>.90;
   renderer.render(scene,camera);
 }
 raf=requestAnimationFrame(loop);
 const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-WATER_Y),vec=new THREE.Vector3();function hit(clientX,clientY){const r=renderer.domElement.getBoundingClientRect();ndc.set((clientX-r.left)/r.width*2-1,-(clientY-r.top)/r.height*2+1);ray.setFromCamera(ndc,camera);const landHit=surface && ray.intersectObject(surface.land,false)[0];
 const point=landHit?.point.y>WATER_Y ? landHit.point : ray.ray.intersectPlane(plane,vec);
 if (!point) return null;
 let x=Math.round(point.x/size+mid),z=Math.round(point.z/size+mid);return x>=0&&z>=0&&x<n&&z<n?[x,z]:null}
 function showOutline(cell){if(!cell){outline.visible=false;return}let [x,z]=cell;outline.position.set((x-mid)*size,Math.max(WATER_Y,surface?.heightAt(x,z)??WATER_Y)+.047,(z-mid)*size);outline.visible=modeRef.current!=='Look'}
 function save(){try{localStorage.setItem('island-sandbox-v1',JSON.stringify({n,cells:state.current.cells,started:state.current.started}))}catch(e){}}
 function begin(){state.current.started=true;setHint(false)}
 function applyCell(cell,visited){if(!cell)return false;let changed=false;const [cx,cz]=cell,rad=brushRef.current-1;for(let dx=-rad;dx<=rad;dx++)for(let dz=-rad;dz<=rad;dz++){if(rad&&dx*dx+dz*dz>rad*rad)continue;let x=cx+dx,z=cz+dz,k=key(x,z);if(x<0||z<0||x>=n||z>=n||visited.has(k))continue;visited.add(k);let v=state.current.cells[k]||{h:0,item:null};if(modeRef.current==='Build'&&v.h<cfg.MAX_HEIGHT){state.current.cells[k]={...v,h:v.h+1};changed=true}else if(modeRef.current==='Lower'&&v.h>0){state.current.cells[k]={...v,h:v.h-1,item:v.h===1?null:v.item};changed=true}else if((modeRef.current==='Plant'||modeRef.current==='Decorate')&&v.h>0&&v.item!==choiceRef.current){state.current.cells[k]={...v,item:choiceRef.current,flowerVariant:choiceRef.current==='flower'?Math.floor(Math.random()*flowerVariantsCount):undefined};changed=true}}
 return changed}
 let pointers=new Map(),stroke=null,pinch=0;const canvas=renderer.domElement;
 function down(e){if(inFeedCover||e.button>0)return;if(e.isPrimary===false&&e.pointerType!=='touch')return;canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){if(stroke?.changed){state.current.cells=stroke.before;state.current.started=stroke.wasStarted;setHint(!stroke.wasStarted);renderTerrain()}stroke=null;let a=[...pointers.values()];pinch=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);return}if(pointers.size>1)return;let cell=hit(e.clientX,e.clientY);showOutline(cell);stroke={before:clone(state.current.cells),wasStarted:state.current.started,visited:new Set(),last:cell,x:e.clientX,y:e.clientY,changed:false,rotated:false};if(modeRef.current!=='Look'){stroke.changed=applyCell(cell,stroke.visited);if(stroke.changed){begin();renderTerrain();showOutline(cell)}}}
 function move(e){if(!pointers.has(e.pointerId)){showOutline(hit(e.clientX,e.clientY));return}const prev=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size>=2){let a=[...pointers.values()];let d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);if(pinch){zoom=Math.max(.55,Math.min(1.7,zoom*d/pinch));updateCamera()}pinch=d;return}if(!stroke)return;if(modeRef.current==='Look'){let dx=e.clientX-prev.x;if(Math.abs(dx)>0){angle-=dx*.008;updateCamera();stroke.rotated=true}return}let c=hit(e.clientX,e.clientY);showOutline(c);if(c){let changed=false;let last=stroke.last||c,steps=Math.max(Math.abs(c[0]-last[0]),Math.abs(c[1]-last[1]),1);for(let i=1;i<=steps;i++){let v=[Math.round(last[0]+(c[0]-last[0])*i/steps),Math.round(last[1]+(c[1]-last[1])*i/steps)];if(applyCell(v,stroke.visited))changed=true}if(changed){stroke.changed=true;begin();renderTerrain();showOutline(c)}stroke.last=c}}
 function up(e){pointers.delete(e.pointerId);if(pointers.size===0){if(stroke?.changed){state.current.undo.push(stroke.before);if(state.current.undo.length>40)state.current.undo.shift();state.current.redo=[];save();setVersion(v=>v+1);play(modeRef.current==='Build'?'plop':modeRef.current==='Lower'?'earth':modeRef.current==='Plant'?'foliage':'click');console.log('island stroke',modeRef.current,Object.keys(state.current.cells).length)}else if(stroke?.rotated){play('rotate');save()}else if(pinch){play('rotate')}stroke=null;pinch=0}outline.visible=false}
 function wheel(e){e.preventDefault();zoom=Math.max(.55,Math.min(1.7,zoom*(e.deltaY<0?1.1:.9)));updateCamera();play('rotate')}
 canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('lostpointercapture',up);canvas.addEventListener('wheel',wheel,{passive:false});
 engine.current={renderTerrain,save,zoom:(factor)=>{zoom=Math.max(.55,Math.min(1.7,zoom*factor));updateCamera()},getZoom:()=>zoom};
 return()=>{cancelAnimationFrame(raf);unwatchSize();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('lostpointercapture',up);canvas.removeEventListener('wheel',wheel);renderer.dispose();releaseSurface(surface);releaseSurface(previewSurface);
   terrainMaterial.dispose();shallowsMaterial.dispose();propModels.dispose();
   outline.geometry.dispose();outline.material.dispose();
   water.geometry.dispose();water.material.dispose();waterTexture.dispose();if(canvas.parentNode)canvas.parentNode.removeChild(canvas);engine.current=null};
 },[cfg]);
 function selectMode(m){if(m===mode)return;setMode(m);if(m==='Plant')setChoice('tree');if(m==='Decorate')setChoice('rock');setMenu(false);play('click')}
 function history(dir){let s=state.current;if(!s||!s[dir].length)return;let other=dir==='undo'?'redo':'undo';s[other].push(clone(s.cells));s.cells=s[dir].pop();engine.current.renderTerrain();engine.current.save();setVersion(v=>v+1);play('history');console.log('island',dir)}
 function reset(){state.current.cells={};state.current.undo=[];state.current.redo=[];state.current.started=false;engine.current.renderTerrain();engine.current.save();setHint(true);setConfirm(false);setMenu(false);setVersion(v=>v+1);play('history');console.log('island reset')}
 let choices=mode==='Plant'?['tree','bush','flower']:['rock','shell','star'];
 return <div className="app" ref={host} data-version={version} data-mode={mode}><style>{CSS}</style>{hint&&<div className="hint">{cfg?.HINT||'Drag to build land'}</div>}<div className="right"><button className="round" aria-label="Undo" disabled={!state.current?.undo.length} onClick={()=>history('undo')}><Icon name="undo"/></button><button className="round" aria-label="Redo" disabled={!state.current?.redo.length} onClick={()=>history('redo')}><Icon name="redo"/></button><button className="round" aria-label="Zoom in" onClick={()=>{engine.current?.zoom(1.15);play('rotate')}}><Icon name="plus"/></button><button className="round" aria-label="Zoom out" onClick={()=>{engine.current?.zoom(1/1.15);play('rotate')}}><Icon name="minus"/></button></div>{menu&&<div className="menu"><div className="menu-title">Brush size</div><div className="sizes">{[1,2,3].map(v=><button key={v} className={brush===v?'active':''} onClick={()=>{if(v!==brush){setBrush(v);play('click')}}}>{v}</button>)}</div><button className="reset" onClick={()=>{setConfirm(true);play('click')}}>Reset island</button></div>}{(mode==='Plant'||mode==='Decorate')&&<div className="tray">{choices.map(c=><button key={c} aria-label={c} className={`choice ${choice===c?'active':''}`} onClick={()=>{if(c!==choice){setChoice(c);play('click')}}}><Icon name={c}/></button>)}</div>}<div className="toolbar">{['Build','Lower','Plant','Decorate','Look'].map(m=><button key={m} className={`tool ${mode===m?'active':''}`} aria-label={m} onClick={()=>selectMode(m)}><Icon name={m}/><span>{m}</span></button>)}<button className={'tool '+(menu?'active':'')} aria-label="More" aria-expanded={menu} onClick={()=>{setMenu(!menu);play('click')}}><Icon name="more"/><span>More</span></button></div>{confirm&&<div className="confirm"><div className="dialog"><h2>Reset island?</h2><p>This will clear your changes.</p><div><button onClick={()=>{setConfirm(false);play('click')}}>Cancel</button><button className="danger" onClick={reset}>Reset</button></div></div></div>}</div>
}
createRoot(document.getElementById('root')).render(<App/>);
