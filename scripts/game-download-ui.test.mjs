import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const context={window:{}};vm.runInNewContext(fs.readFileSync(root+'/playablebatch1/game-downloads.js','utf8'),context);
const archives=context.window.PlayableGameDownloads;
function setup(){
 const link={hidden:true,attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k];delete this[k]}};
 const events={},locale={language:'en'},state={game:null};
 const w={PlayableGameDownloads:archives,PlayableReviewLocale:locale,PlayableReviewLibrary:{getCurrent:()=>state.game},addEventListener:(key,fn)=>events[key]=fn};
 vm.runInNewContext(fs.readFileSync(root+'/playablebatch1/game-download-ui.js','utf8'),{window:w,document:{getElementById:()=>link}});
 return{link,w,locale,state,events};
}
test('all 38 Batch 1 games export the language selected on the page',()=>{
 const games=JSON.parse(fs.readFileSync(root+'/playablebatch1/index.html','utf8').match(/^const games = (\[.*\]);$/m)[1]);
 const s=setup();let count=0;
 for(const game of games.filter(g=>archives[g.base].languages)){
  count++;
  for(const lang of ['en','it']){
   s.locale.language=lang;s.state.game=game;s.w.PlayableGameDownloadsUI.reflect(game);
   const expected=archives[game.base].languages[lang];
   assert.equal(s.link.href,expected.url+'?v='+expected.sha256.slice(0,16));
   assert.equal(s.link.download,expected.filename);assert.equal(s.link.hidden,false);
   assert.ok(s.link.title.startsWith(lang==='it'?'Italian':'English'));
  }
 }
 assert.equal(count,38);
});
test('language changes update the existing link immediately without reselecting the game',()=>{
 const s=setup(),base=Object.keys(archives).find(k=>archives[k].languages);
 s.state.game={number:1,name:'Example',base};s.w.PlayableGameDownloadsUI.reflect(s.state.game);
 const english=s.link.href;s.locale.language='it';s.events['playable-review-language-change']();
 assert.notEqual(s.link.href,english);assert.equal(s.link.download,archives[base].languages.it.filename);
 s.locale.language='en';s.events['playable-review-language-change']();assert.equal(s.link.href,english);
});
test('FYP selection changes and missing games cannot keep the previous download',()=>{
 const s=setup(),bases=Object.keys(archives).filter(k=>archives[k].languages);
 s.locale.language='it';s.w.PlayableGameDownloadsUI.reflect({number:1,name:'First',base:bases[0]});
 s.w.PlayableGameDownloadsUI.reflect({number:2,name:'Second',base:bases[1]});
 assert.equal(s.link.download,archives[bases[1]].languages.it.filename);
 s.w.PlayableGameDownloadsUI.reflect({base:'missing'});assert.equal(s.link.hidden,true);assert.equal(s.link.href,undefined);
});
test('Other games retain their existing English download',()=>{
 const s=setup(),base=Object.keys(archives).find(k=>!archives[k].languages);
 s.locale.language='it';s.w.PlayableGameDownloadsUI.reflect({number:4,name:'Other',base});
 assert.equal(s.link.download,archives[base].filename);assert.ok(s.link.title.startsWith('English'));
});
