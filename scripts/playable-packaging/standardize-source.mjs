// Consolidate CURRENT entry chains. Historical JSX is never used as runtime input.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {parse} from '@babel/parser';
const scripts=fs.existsSync(path.join(import.meta.dirname,'playable-html-scan.py'))?import.meta.dirname:path.resolve(import.meta.dirname,'..');
const repo=path.resolve(scripts,'..'),library=repo+'/playablebatch1';
const require=createRequire(import.meta.url),model=require(library+'/batch-filter.js');
const page=fs.readFileSync(library+'/index.html','utf8');
const games=JSON.parse(page.match(/^const games = (\[.*\]);$/m)[1]).filter(g=>model.batch1TaskIds.includes(g.taskId));
const output=library+'/templates',only=process.argv.slice(2).map(Number);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const read=file=>fs.readFileSync(file,'utf8');
const files=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
 assert(!e.isSymbolicLink(),'Unexpected source symlink');
 if(e.name.startsWith('.')||/^(?:__MACOSX|node_modules|tests?|backups?)$/i.test(e.name))return[];
 return e.isDirectory()?files(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name];
});
const local=(dir,ref)=>{assert(!/^(?:https?:|data:|blob:|\/)/.test(ref),'External runtime dependency: '+ref);const f=path.resolve(dir,ref.split(/[?#]/)[0]);assert(f.startsWith(dir+path.sep),'Entry dependency escaped its package');return f;};
function readCss(file){
 let css=read(file);
 css=css.replace(/@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/g,(_,ref)=>readCss(local(path.dirname(file),ref)));
 return css;
}
function currentScript(code,index,attrs){
 const ast=parse(code,{sourceType:'unambiguous'}),changes=[];
 function walk(n){if(!n||typeof n!=='object')return;
  if(['MemberExpression','OptionalMemberExpression'].includes(n.type)&&n.object?.type==='Identifier'&&n.object.name==='document'&&(n.property?.name==='currentScript'||n.computed&&n.property?.value==='currentScript'))changes.push({start:n.start,end:n.end});
  for(const[k,v]of Object.entries(n)){if(['loc','extra','comments','tokens','errors'].includes(k))continue;if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
 }walk(ast);
 if(!changes.length)return code;
 const name='__PLAYABLE_TEMPLATE_SCRIPT_'+index;
 for(const p of changes.sort((a,b)=>b.start-a.start))code=code.slice(0,p.start)+name+code.slice(p.end);
 // Metadata-only detached element: no additional scripts are fetched or injected.
 const metadata=Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k,v??'']));
 return 'var '+name+'=(()=>{var node=document.createElement("script");for(var entry of Object.entries('+JSON.stringify(metadata)+'))node.setAttribute(entry[0],entry[1]);return node;})();\n'+code;
}
function compile(game,language){
 const original=path.join(library,'games',game.base,'game.html'),dir=path.dirname(original),entry=language==='it'?original.replace(/\.html$/,'.it.html'):original;
 if(!fs.existsSync(entry))return null;
 const configName=language==='it'?'game.config.it.json':'game.config.json',configBytes=fs.readFileSync(dir+'/'+configName),config=JSON.parse(configBytes);
 const result=spawnSync('python3',[scripts+'/playable-html-scan.py',entry],{encoding:'utf8',maxBuffer:15e6});assert.equal(result.status,0,result.stderr);
 const parsed=JSON.parse(result.stdout);let html=parsed.shell;const omitted=[],runtimeInputs=[{file:path.basename(entry),sha256:sha(fs.readFileSync(entry)),kind:'entry'},{file:configName,sha256:sha(configBytes),kind:'config'}];
 parsed.styles.forEach((style,index)=>{
  const source=local(dir,style.href);
  if(!fs.existsSync(source)){omitted.push({file:style.href,reason:'Missing optional stylesheet; styles already live in the current runtime'});html=html.replace('<!--TEMPLATE_STYLE_'+index+'-->','');return;}
  assert(path.dirname(source)===dir,'Nested stylesheet requires explicit URL rebasing');
  const css=readCss(source);runtimeInputs.push({file:path.basename(source),sha256:sha(fs.readFileSync(source)),kind:'style'});
  const attrs=Object.entries(style).filter(([key])=>!['rel','href','as','integrity','crossorigin'].includes(key)).map(([k,v])=>k+'="'+String(v??'').replaceAll('"','&quot;')+'"').join(' ');
  html=html.replace('<!--TEMPLATE_STYLE_'+index+'-->','<style '+attrs+'>\n'+css+'\n</style>');
 });
 const ordered=[...parsed.scripts.filter(s=>!('defer'in s.attrs)&&s.attrs.type!=='module'),...parsed.scripts.filter(s=>'defer'in s.attrs||s.attrs.type==='module')];
 const blocks=ordered.map((script,index)=>{
  let code=script.code,name='inline-'+index;
  assert(!('async'in script.attrs),'Asynchronous script ordering needs manual handling');
  if(script.attrs.src){const file=local(dir,script.attrs.src);assert(fs.existsSync(file),'Missing script '+script.attrs.src);code=read(file);name=path.basename(file);runtimeInputs.push({file:name,sha256:sha(fs.readFileSync(file)),kind:'script'});}
  assert(script.attrs.type!=='module'&&!/^\s*(?:import|export)\b/m.test(code),'Module entry requires an explicit bundled runtime before export');
  code=code.replace(/^\s*\/\/[#@]\s*sourceMappingURL=.*$/gm,'');
  if(language==='it')code=code.replaceAll('game.config.it.json','game.config.json').replaceAll('game\\\\.config\\\\.it\\\\.json','game\\\\.config\\\\.json').replaceAll('game\\.config\\.it\\.json','game\\.config\\.json');
  return '\n;/* Current runtime segment: '+name+' */\n'+currentScript(code,index,script.attrs)+'\n;';
 });
 assert(/<\/body>/i.test(html),'Entry body missing');html=html.replace(/<\/body>/i,'<script src="./bundle.js"></script>\n</body>');
 html=html.replaceAll('game.config.it.json','game.config.json');
 const source='/* Consolidated CURRENT browser application. Valid JavaScript/JSX-subset source.\n * Rebuild: node check.js --build. No historical authoring version is substituted.\n * External helpers and inline entry code are preserved in their original execution order.\n */\n// TEMPLATE_HTML_BASE64: '+Buffer.from(html).toString('base64')+'\n'+blocks.join('\n')+'\n';
 new vm.Script(source,{filename:'App.jsx'});
 assert(!/\/Users\/|\/private\/var\/|code\.byted\.org/.test(source),'Private source path in consolidated runtime');
 const name=game.base,target=path.join(output,language,name);
 if(fs.existsSync(target)){const m=JSON.parse(read(target+'/asset_manifest.json'));assert(m.task_id===game.taskId&&m.source_kind==='consolidated-current-runtime','Refusing to replace an unmanaged folder');fs.rmSync(target,{recursive:true});}
 fs.mkdirSync(target+'/dist/assets',{recursive:true});
 const combined=source+'\n'+html+'\n'+configBytes.toString(),prefixes=[...combined.matchAll(/assets\/[\w./-]*/g)].map(m=>m[0]);
 const assetRoot=dir+'/assets',all=fs.existsSync(assetRoot)?files(assetRoot):[],chosen=new Set();
 for(const file of all){
  if(/\.meta\.json$|\.(?:map|bak|zip|jsx?|mjs|css|html)$/i.test(file))continue;
  const relative='assets/'+file;
  if(combined.includes(relative)||combined.includes(path.basename(file))||prefixes.some(prefix=>relative.startsWith(prefix))||/(?:license|copyright|OFL)(?:\.|$)/i.test(path.basename(file)))chosen.add(file);
 }
 // Resolve local SVG/JSON resource dependencies without copying unrelated process data.
 for(const file of chosen)if(/\.(?:svg|json|gltf)$/.test(file)){
  const body=read(assetRoot+'/'+file);
  for(const candidate of all)if(body.includes(path.basename(candidate))&&!/\.meta\.json$/.test(candidate))chosen.add(candidate);
 }
 for(const file of chosen){const destination=target+'/dist/assets/'+file;fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(assetRoot+'/'+file,destination);runtimeInputs.push({file:'assets/'+file,sha256:sha(fs.readFileSync(assetRoot+'/'+file)),kind:'asset'});}
 for(const license of fs.readdirSync(dir).filter(f=>/LICENSE|COPYRIGHT|OFL/.test(f)&&/\.txt$/i.test(f))){fs.mkdirSync(target+'/dist/assets/licenses',{recursive:true});fs.copyFileSync(dir+'/'+license,target+'/dist/assets/licenses/'+license);runtimeInputs.push({file:license,sha256:sha(fs.readFileSync(dir+'/'+license)),kind:'license'});}
 fs.writeFileSync(target+'/App.jsx',source);fs.copyFileSync(scripts+'/playable-template-check.js',target+'/check.js');fs.writeFileSync(target+'/dist/game.config.json',configBytes);
 const slotIds=new Map();for(const image of config.images||[]){if(!image.path||/^(?:https?:|data:|blob:)/.test(image.path))continue;const p='dist/'+image.path.replace(/^\.\//,'');slotIds.set(p,[...(slotIds.get(p)||[]),image.id]);}
 const assetRecords=files(target+'/dist/assets').sort().map(file=>{const p='dist/assets/'+file,bytes=fs.readFileSync(target+'/'+p);return{path:p,ids:slotIds.get(p)||[],bytes:bytes.length,sha256:sha(bytes)};});
 const manifest={manifest_version:1,task_id:game.taskId,number:game.number,name:game.name,language,entry:'dist/game.html',source_kind:'consolidated-current-runtime',assets:assetRecords,files:{}};
 fs.writeFileSync(target+'/asset_manifest.json',JSON.stringify(manifest,null,2)+'\n');
 const check=spawnSync(process.execPath,[target+'/check.js','--build'],{encoding:'utf8',maxBuffer:2e6});assert.equal(check.status,0,game.number+' '+language+': '+check.stderr+check.stdout);
 return{number:game.number,taskId:game.taskId,base:game.base,language,folder:path.relative(library,target),assets:assetRecords.length,inputs:runtimeInputs.map(input=>({file:'games/'+game.base+'/'+input.file,sha256:input.sha256})),omittedReferences:omitted};
}
fs.mkdirSync(output,{recursive:true});const reportFile=output+'/registry.json',previous=fs.existsSync(reportFile)?JSON.parse(read(reportFile)).records:[];
const records=only.length?previous.filter(r=>!only.includes(r.number)):[];
for(const game of games.filter(g=>!only.length||only.includes(g.number)))for(const language of ['en','it']){const result=compile(game,language);assert(result,'Missing '+language+' runtime for '+game.number);records.push(result);console.log(game.number+' '+language+' · '+result.assets+' assets');}
records.sort((a,b)=>a.number-b.number||a.language.localeCompare(b.language));
assert.equal(records.length,model.batch1TaskIds.length*2,'Incomplete Batch 1 export registry');
fs.writeFileSync(reportFile,JSON.stringify({version:1,records},null,2)+'\n');
console.log(JSON.stringify({templates:records.length,english:records.filter(r=>r.language==='en').length,italian:records.filter(r=>r.language==='it').length}));
