import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const site=new URL('../playablebatch1/',import.meta.url),read=name=>fs.readFileSync(new URL(name,site),'utf8'),data={window:{}};vm.runInNewContext(read('batch-downloads.js'),data);
function setup(){
 const label={textContent:''},events={},downloads=[],button={disabled:true,dataset:{},attrs:{},querySelector:()=>label,addEventListener:(k,f)=>events['button:'+k]=f,setAttribute(k,v){this.attrs[k]=v}};
 const filter={batch:'batch1',query:''},locale={language:'en'},select={value:'batch1'};
 const document={getElementById:id=>id==='batch-download'?button:select,body:{append(){}},createElement:()=>({click(){downloads.push({url:this.href,filename:this.download})},remove(){}})};
 const window={PlayableBatchDownloads:data.window.PlayableBatchDownloads,PlayableReviewLibrary:{getFilter:()=>filter},PlayableReviewLocale:locale,addEventListener:(k,f)=>events[k]=f};
 vm.runInNewContext(read('batch-download-ui.js'),{window,document,URL,location:{href:'http://localhost/review/index.html'}});
 return{button,label,events,downloads,filter,locale,window};
}
test('Batch 1 ZIP follows English/Italian selection and includes the whole pool despite search',()=>{
 const s=setup();assert.equal(s.button.disabled,false);assert.match(s.button.title,/38 games.*English/);s.events['button:click']();assert.equal(s.downloads[0].filename,'batch-1-en.zip');s.locale.language='it';s.events['playable-review-language-change']();s.events['button:click']();assert.equal(s.downloads[1].filename,'batch-1-it.zip');s.filter.query='no results';s.events['playable-review-filter-change']();assert.equal(s.button.disabled,false);assert.match(s.button.attrs['aria-label'],/all 38 games/);
});
test('Batch 2 has an explicit English fallback and cannot retain the Batch 1 archive',()=>{
 const s=setup();s.locale.language='it';s.filter.batch='batch2';s.events['playable-review-filter-change']();assert.match(s.button.title,/21 games.*English/);assert.equal(s.label.textContent,'Download Batch 2');s.events['button:click']();assert.equal(s.downloads[0].filename,'batch-2-en.zip');
});
test('All/Other disable the action and do not download a stale batch',()=>{
 const s=setup();for(const batch of ['all','other']){s.filter.batch=batch;s.events['playable-review-filter-change']();assert.equal(s.button.disabled,true);assert.equal(s.label.textContent,'Download batch');s.events['button:click']();}assert.equal(s.downloads.length,0);
});
test('Local archive base stays local; production uses the catalog URL',()=>{
 const s=setup();s.events['button:click']();assert.equal(s.downloads[0].url,data.window.PlayableBatchDownloads.batch1.languages.en.url+'?v='+data.window.PlayableBatchDownloads.batch1.languages.en.sha256.slice(0,16));s.button.dataset.downloadBase='../exports/';s.events['button:click']();assert.equal(s.downloads[1].url.split('?')[0],'http://localhost/exports/batch-1-en.zip');
});
