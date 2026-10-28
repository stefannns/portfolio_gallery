// Shared validation for the Batch 1 authoring templates and downloadable ZIPs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
export const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function loadTemplates(library){
 const pool=createRequire(import.meta.url)(library+'/batch-filter.js').batch1TaskIds;
 const registry=JSON.parse(fs.readFileSync(library+'/templates/registry.json','utf8'));
 assert.equal(registry.version,1);assert.equal(registry.records.length,pool.length*2,'Incomplete language exports');
 const seen=new Set();
 for(const row of registry.records){
  assert(pool.includes(row.taskId),'Template outside Batch 1');assert(['en','it'].includes(row.language));
  const key=row.taskId+':'+row.language;assert(!seen.has(key),'Duplicate template');seen.add(key);
  assert.equal(row.folder,'templates/'+row.language+'/'+row.base,'Unexpected template location');
  for(const input of row.inputs){
   assert(!path.isAbsolute(input.file)&&!input.file.split('/').includes('..'),'Invalid provenance path');
   assert.equal(digest(fs.readFileSync(path.join(library,input.file))),input.sha256,'Stale template: '+row.number+' '+row.language+'; run node scripts/standardize-playable-templates.mjs');
  }
 }
 return registry.records;
}
export function checkTemplate(library,row){
 const root=path.resolve(library,row.folder);
 assert.equal(digest(fs.readFileSync(root+'/check.js')),digest(fs.readFileSync(new URL('./playable-template-check.js',import.meta.url))),'Template checker is outdated; regenerate templates');
 const result=spawnSync(process.execPath,[root+'/check.js'],{encoding:'utf8',maxBuffer:1e6});
 assert.equal(result.status,0,'Invalid template '+row.number+' '+row.language+': '+result.stderr);
 const manifest=JSON.parse(fs.readFileSync(root+'/asset_manifest.json','utf8'));
 assert.equal(manifest.task_id,row.taskId);assert.equal(manifest.language,row.language);
 assert.equal(manifest.number,row.number);
 return root;
}
