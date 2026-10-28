/* Self-contained current-runtime template. Run node check.js, or node check.js --build. */
(async()=>{
 'use strict';
 const fs=await import('node:fs'),path=await import('node:path'),crypto=await import('node:crypto'),vm=await import('node:vm');
 const root=path.dirname(path.resolve(process.argv[1])),build=process.argv.includes('--build');
 const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
 const expectedRoot=['App.jsx','asset_manifest.json','check.js','dist'],expectedDist=['assets','bundle.js','game.config.json','game.html'];
 const walk=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  if(e.isSymbolicLink())throw Error('Symbolic link: '+prefix+e.name);
  if(e.name.startsWith('.')||/^(?:__MACOSX|node_modules|tests?|backups?|feedback-tracking)$/i.test(e.name)||/\.(?:map|bak|zip|jsx?|mjs|css|html)$/i.test(e.name))throw Error('Extra non-asset file: '+prefix+e.name);
  return e.isDirectory()?walk(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name];
 });
 const assert=(condition,message)=>{if(!condition)throw Error(message);};
 const source=fs.readFileSync(root+'/App.jsx','utf8');
 const encoded=source.match(/^\/\/ TEMPLATE_HTML_BASE64: ([A-Za-z0-9+/=]+)$/m)?.[1];
 assert(encoded,'Missing rebuildable HTML source');
 const config=JSON.parse(fs.readFileSync(root+'/dist/game.config.json','utf8'));
 const render=()=>Buffer.from(encoded,'base64').toString('utf8').replace(/(<script\b[^>]*type=["']application\/json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,(all,a,b,c)=>{
  try{const data=JSON.parse(b);if(Array.isArray(data.texts)&&Array.isArray(data.images))return a+JSON.stringify(config).replaceAll('</script','<\\/script')+c;}catch{}
  return all;
 });
 let manifest=JSON.parse(fs.readFileSync(root+'/asset_manifest.json','utf8'));
 // Git cannot retain an empty directory; restore the required empty assets/
 // folder for a fresh checkout without adding a placeholder to the product.
 if(!fs.existsSync(root+'/dist/assets')&&manifest.assets?.length===0)fs.mkdirSync(root+'/dist/assets',{recursive:true});
 const assetFiles=walk(root+'/dist/assets').sort();
 if(build){
  new vm.Script(source,{filename:'App.jsx'});
  fs.writeFileSync(root+'/dist/bundle.js',source);
  fs.writeFileSync(root+'/dist/game.html',render());
  const previous=new Map((manifest.assets||[]).map(a=>[a.path,a]));
  manifest.assets=assetFiles.map(file=>{const p='dist/assets/'+file,bytes=fs.readFileSync(root+'/'+p);return{...(previous.get(p)||{}),path:p,bytes:bytes.length,sha256:sha(bytes)};});
  manifest.files=Object.fromEntries(['App.jsx','dist/bundle.js','dist/game.html','dist/game.config.json'].map(file=>[file,sha(fs.readFileSync(root+'/'+file))]));
  fs.writeFileSync(root+'/asset_manifest.json',JSON.stringify(manifest,null,2)+'\n');
 }
 assert(JSON.stringify(fs.readdirSync(root).sort())===JSON.stringify(expectedRoot),'Root must contain only App.jsx, check.js, asset_manifest.json and dist/');
 assert(JSON.stringify(fs.readdirSync(root+'/dist').sort())===JSON.stringify(expectedDist),'dist/ must contain only game.html, bundle.js, game.config.json and assets/');
 assert(source===fs.readFileSync(root+'/dist/bundle.js','utf8'),'App.jsx and bundle.js are out of sync; run node check.js --build');
 assert(render()===fs.readFileSync(root+'/dist/game.html','utf8'),'HTML differs from current App.jsx/config source; rebuild required');
 new vm.Script(source,{filename:'App.jsx'});
 const registered=new Set();
 for(const asset of manifest.assets||[]){
  assert(/^dist\/assets\//.test(asset.path)&&!asset.path.split('/').includes('..')&&!path.isAbsolute(asset.path),'Invalid manifest asset path');
  assert(!registered.has(asset.path),'Duplicate manifest asset: '+asset.path);registered.add(asset.path);
  const bytes=fs.readFileSync(root+'/'+asset.path);assert(bytes.length===asset.bytes&&sha(bytes)===asset.sha256,'Asset differs from manifest: '+asset.path);
 }
 assert(registered.size===assetFiles.length,'Unregistered asset file');
 for(const file of assetFiles)assert(registered.has('dist/assets/'+file),'Unregistered asset: '+file);
 for(const[file,digest]of Object.entries(manifest.files||{}))assert(sha(fs.readFileSync(root+'/'+file))===digest,'Stale build hash: '+file);
 for(const image of config.images||[])if(image.path&&!/^(?:https?:|data:|blob:)/.test(image.path)){
  const relative=image.path.split(/[?#]/)[0];assert(!relative.split('/').includes('..'),'Invalid config image path');
  assert(fs.existsSync(path.resolve(root+'/dist',relative)),'Missing config asset: '+relative);
 }
 const html=fs.readFileSync(root+'/dist/game.html','utf8');
 const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)/gi)].map(m=>m[1]);
 assert(scripts.length===1&&scripts[0]==='./bundle.js','Only bundle.js may be loaded as external script');
 assert(!/<link\b[^>]*rel=["']stylesheet["']/i.test(html),'Extra external stylesheet');
 console.log(JSON.stringify({template:path.basename(root),valid:true,assets:assetFiles.length,rebuilt:build}));
})().catch(error=>{console.error(JSON.stringify({valid:false,error:error.message}));process.exitCode=1;});
