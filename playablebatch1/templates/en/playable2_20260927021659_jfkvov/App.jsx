// Editable pre-compilation source. One person chooses a shareable date profile.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
const DEFAULT_CONFIG = {
  "tweaks": [],
  "texts": [
    {
      "id": "GAME_TITLE",
      "label": "Game Title",
      "value": "Better Together",
      "default": "Better Together",
      "max_length": 35
    },
    {
      "id": "Q1_TEXT",
      "label": "Q1 Text",
      "value": "Your ideal Friday night together?",
      "default": "Your ideal Friday night together?",
      "max_length": 150
    },
    {
      "id": "Q1_O0",
      "label": "Q1 Option 1",
      "value": "Stay in & cook",
      "default": "Stay in & cook",
      "max_length": 34
    },
    {
      "id": "Q1_O1",
      "label": "Q1 Option 2",
      "value": "Go dancing",
      "default": "Go dancing",
      "max_length": 30
    },
    {
      "id": "Q1_O2",
      "label": "Q1 Option 3",
      "value": "A long walk",
      "default": "A long walk",
      "max_length": 31
    },
    {
      "id": "Q1_O3",
      "label": "Q1 Option 4",
      "value": "Surprise me",
      "default": "Surprise me",
      "max_length": 31
    },
    {
      "id": "Q2_TEXT",
      "label": "Q2 Text",
      "value": "What are you sharing on date night?",
      "default": "What are you sharing on date night?",
      "max_length": 150
    },
    {
      "id": "Q2_O0",
      "label": "Q2 Option 1",
      "value": "Pizza",
      "default": "Pizza",
      "max_length": 30
    },
    {
      "id": "Q2_O1",
      "label": "Q2 Option 2",
      "value": "Ice cream",
      "default": "Ice cream",
      "max_length": 30
    },
    {
      "id": "Q2_O2",
      "label": "Q2 Option 3",
      "value": "Sushi",
      "default": "Sushi",
      "max_length": 30
    },
    {
      "id": "Q2_O3",
      "label": "Q2 Option 4",
      "value": "Popcorn",
      "default": "Popcorn",
      "max_length": 30
    },
    {
      "id": "Q3_TEXT",
      "label": "Q3 Text",
      "value": "A little love looks like…",
      "default": "A little love looks like…",
      "max_length": 150
    },
    {
      "id": "Q3_O0",
      "label": "Q3 Option 1",
      "value": "A helping hand",
      "default": "A helping hand",
      "max_length": 34
    },
    {
      "id": "Q3_O1",
      "label": "Q3 Option 2",
      "value": "A handwritten note",
      "default": "A handwritten note",
      "max_length": 38
    },
    {
      "id": "Q3_O2",
      "label": "Q3 Option 3",
      "value": "A long hug",
      "default": "A long hug",
      "max_length": 30
    },
    {
      "id": "Q3_O3",
      "label": "Q3 Option 4",
      "value": "Time together",
      "default": "Time together",
      "max_length": 33
    },
    {
      "id": "Q4_TEXT",
      "label": "Q4 Text",
      "value": "Pick your next little adventure.",
      "default": "Pick your next little adventure.",
      "max_length": 150
    },
    {
      "id": "Q4_O0",
      "label": "Q4 Option 1",
      "value": "A road trip",
      "default": "A road trip",
      "max_length": 31
    },
    {
      "id": "Q4_O1",
      "label": "Q4 Option 2",
      "value": "A beach afternoon",
      "default": "A beach afternoon",
      "max_length": 37
    },
    {
      "id": "Q4_O2",
      "label": "Q4 Option 3",
      "value": "Museums & coffee",
      "default": "Museums & coffee",
      "max_length": 36
    },
    {
      "id": "Q4_O3",
      "label": "Q4 Option 4",
      "value": "A cabin getaway",
      "default": "A cabin getaway",
      "max_length": 35
    },
    {
      "id": "PROGRESS_LABEL",
      "label": "Progress Label",
      "value": "Question",
      "default": "Question",
      "max_length": 80
    },
    {
      "id": "Q1_LABEL",
      "label": "Q1 Label",
      "value": "Friday",
      "default": "Friday",
      "max_length": 80
    },
    {
      "id": "Q2_LABEL",
      "label": "Q2 Label",
      "value": "Snack",
      "default": "Snack",
      "max_length": 80
    },
    {
      "id": "Q3_LABEL",
      "label": "Q3 Label",
      "value": "Little love",
      "default": "Little love",
      "max_length": 80
    },
    {
      "id": "Q4_LABEL",
      "label": "Q4 Label",
      "value": "Adventure",
      "default": "Adventure",
      "max_length": 80
    },
    {
      "id": "RES_TITLE",
      "label": "Res Title",
      "value": "My date style",
      "default": "My date style",
      "max_length": 80
    },
    {
      "id": "RESTART_BTN",
      "label": "Restart Btn",
      "value": "Try again",
      "default": "Try again",
      "max_length": 80
    },
    {
      "id": "PROFILE0_TITLE",
      "label": "Profile0 Title",
      "value": "Cozy Romantic",
      "default": "Cozy Romantic",
      "max_length": 80
    },
    {
      "id": "PROFILE0_DESC",
      "label": "Profile0 Desc",
      "value": "Good food, soft plans, and time for two.",
      "default": "Good food, soft plans, and time for two.",
      "max_length": 80
    },
    {
      "id": "PROFILE1_TITLE",
      "label": "Profile1 Title",
      "value": "Playful Adventurer",
      "default": "Playful Adventurer",
      "max_length": 80
    },
    {
      "id": "PROFILE1_DESC",
      "label": "Profile1 Desc",
      "value": "A little laughter turns any plan into a date.",
      "default": "A little laughter turns any plan into a date.",
      "max_length": 80
    },
    {
      "id": "PROFILE2_TITLE",
      "label": "Profile2 Title",
      "value": "Thoughtful Explorer",
      "default": "Thoughtful Explorer",
      "max_length": 80
    },
    {
      "id": "PROFILE2_DESC",
      "label": "Profile2 Desc",
      "value": "Meaningful little moments are your kind of magic.",
      "default": "Meaningful little moments are your kind of magic.",
      "max_length": 80
    },
    {
      "id": "PROFILE3_TITLE",
      "label": "Profile3 Title",
      "value": "Spontaneous Spark",
      "default": "Spontaneous Spark",
      "max_length": 80
    },
    {
      "id": "PROFILE3_DESC",
      "label": "Profile3 Desc",
      "value": "Leave room for an unexpected little adventure.",
      "default": "Leave room for an unexpected little adventure.",
      "max_length": 80
    },
    {
      "id": "SHARE_BTN",
      "label": "Share Btn",
      "value": "Share result",
      "default": "Share result",
      "max_length": 80
    },
    {
      "id": "SHARE_INVITE",
      "label": "Share Invite",
      "value": "Your turn—what would you choose?",
      "default": "Your turn—what would you choose?",
      "max_length": 80
    },
    {
      "id": "SHARE_FALLBACK",
      "label": "Share Fallback",
      "value": "Copy your result or save a card to send.",
      "default": "Copy your result or save a card to send.",
      "max_length": 80
    },
    {
      "id": "SHARE_SUCCESS",
      "label": "Share Success",
      "value": "Shared. Your partner gets the next pick.",
      "default": "Shared. Your partner gets the next pick.",
      "max_length": 80
    },
    {
      "id": "COPY_BTN",
      "label": "Copy Btn",
      "value": "Copy result",
      "default": "Copy result",
      "max_length": 80
    },
    {
      "id": "COPY_SUCCESS",
      "label": "Copy Success",
      "value": "Copied. Send it to your partner.",
      "default": "Copied. Send it to your partner.",
      "max_length": 80
    },
    {
      "id": "COPY_MANUAL",
      "label": "Copy Manual",
      "value": "Select and copy your result below.",
      "default": "Select and copy your result below.",
      "max_length": 80
    },
    {
      "id": "SAVE_BTN",
      "label": "Save Btn",
      "value": "Save card",
      "default": "Save card",
      "max_length": 80
    },
    {
      "id": "SAVE_BUSY",
      "label": "Save Busy",
      "value": "Saving…",
      "default": "Saving…",
      "max_length": 80
    },
    {
      "id": "SAVE_SUCCESS",
      "label": "Save Success",
      "value": "Card saved to your photos.",
      "default": "Card saved to your photos.",
      "max_length": 80
    },
    {
      "id": "SAVE_FAILURE",
      "label": "Save Failure",
      "value": "Could not save. You can still copy your result.",
      "default": "Could not save. You can still copy your result.",
      "max_length": 80
    },
    {
      "id": "SAVE_DOWNLOAD",
      "label": "Save Download",
      "value": "Card download started.",
      "default": "Card download started.",
      "max_length": 80
    }
  ],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 3,
    "title": "Better Together",
    "name": "Better Together"
  }
};
const GAME_STYLES = `
@font-face{font-family:PaperType;src:url('./assets/fonts/special-elite/SpecialElite-Regular.ttf') format('truetype');font-weight:400;font-style:normal;font-display:swap}
*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}
body{color:#282723;background:#eed1c4 url('./assets/paper-grain.svg') repeat;font-family:PaperType,Georgia,serif;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}
button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #6e8491;outline-offset:4px}button:disabled{cursor:default;opacity:.5}
.couple-screen{position:absolute;inset:0;display:flex;flex-direction:column;padding:calc(30px + env(safe-area-inset-top,0px)) calc(30px + env(safe-area-inset-right,0px)) calc(50px + env(safe-area-inset-bottom,0px)) calc(30px + env(safe-area-inset-left,0px));color:#282723;background:transparent}
.couple-hud{display:flex;justify-content:space-between;align-items:center;gap:16px;flex:none;min-height:35px;font-size:28px;line-height:1.15;font-variant-numeric:tabular-nums}
.hud-item{display:flex;align-items:center;gap:8px}.hud-label{font-size:11px;line-height:1.2;letter-spacing:.6px}.hud-heart{width:24px;height:24px;flex:none}
.couple-main{display:flex;align-items:center;justify-content:center;flex:1;min-height:0;padding-block:16px}
.couple-content{width:100%;max-width:380px;max-height:100%;padding:4px;overflow:auto;scrollbar-width:thin;display:flex;flex-direction:column;gap:14px;text-align:center}
.couple-brand{display:flex;justify-content:center;align-items:center;gap:10px;font-size:24px;line-height:1.2}.couple-mark{width:38px;height:31px;flex:none}
.couple-turn{align-self:center;font-size:12px;line-height:1.4;letter-spacing:.3px;padding:0 4px 7px;border-bottom:1px solid #28272370;max-width:100%;text-wrap:balance}
.couple-question{font-size:24px;line-height:1.3;letter-spacing:-.02em;font-weight:400;margin:0;text-wrap:balance;overflow-wrap:anywhere}
.couple-options{display:grid;grid-template-columns:1fr;gap:10px;margin:2px 0}
.btn-option{width:100%;min-height:48px;padding:11px 14px;background:#fff7de;color:#282723;border:2px solid #282723;border-radius:4px;box-shadow:2px 3px 0 #282723;font-size:18px;line-height:1.25;text-align:center;overflow-wrap:anywhere;transition:transform .1s,box-shadow .1s}
.btn-option:nth-child(2){background:#e5e58f}.btn-option:nth-child(3){background:#bed3dc}.btn-option:nth-child(4){background:#e7bcc4}.btn-option:active{transform:translate(2px,3px);box-shadow:none}
.couple-guide{margin:0;font-size:13px;line-height:1.4;color:#645b50;text-wrap:balance;animation:couple-breathe 2.4s ease-in-out infinite}
.paper-card{background:#fff7de;border:2px solid #282723;border-radius:6px;box-shadow:3px 4px 0 #2827232b;padding:22px 18px;display:flex;flex-direction:column;gap:16px;align-items:center;text-align:center}
.paper-card h2,.paper-card h3{margin:0;font-size:24px;line-height:1.3;font-weight:400;text-wrap:balance;overflow-wrap:anywhere}.paper-card p{margin:0;font-size:16px;line-height:1.5;text-wrap:balance;overflow-wrap:anywhere}.paper-card .couple-mark{width:56px;height:43px}
.paper-kicker{font-size:11px;line-height:1.3;letter-spacing:1.3px;text-transform:uppercase;color:#645b50}
.btn-black{width:100%;min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 18px;font-size:17px;line-height:1.3;white-space:normal;overflow-wrap:anywhere;background:#e5e58f;border:2px solid #282723;border-radius:4px;box-shadow:2px 3px 0 #282723;color:#282723;font-weight:400}.btn-black:active{transform:translate(2px,3px);box-shadow:none}.btn-black.secondary{background:transparent;box-shadow:none}
.couple-picks{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);width:100%;gap:10px}.couple-pick{background:#eed1c42b;border:1px solid #28272350;border-radius:3px;padding:10px 8px;display:flex;flex-direction:column;justify-content:center;gap:7px;min-height:78px;min-width:0}.couple-pick small{font-size:11px;color:#645b50;line-height:1.3}.couple-pick span{font-size:16px;line-height:1.3;overflow-wrap:anywhere}
.couple-feedback{animation:couple-appear .18s ease-out}.couple-result-score{font-size:48px;line-height:1.1;font-variant-numeric:tabular-nums}.couple-result-score small{display:block;font-size:12px;line-height:1.3;letter-spacing:1px;margin-top:8px}.couple-profile{font-size:20px;line-height:1.3;border-bottom:1px solid #28272370;padding-bottom:8px;text-wrap:balance}.couple-fineprint{font-size:13px!important;color:#645b50}
@keyframes couple-breathe{50%{opacity:.68}}@keyframes couple-appear{from{opacity:.3}to{opacity:1}}
@media(max-height:620px){.couple-main{padding-block:10px}.couple-content{gap:10px}.couple-brand{font-size:22px}.couple-question{font-size:22px;line-height:1.25}.btn-option{min-height:44px;padding:9px 12px;font-size:17px}.couple-options{gap:9px}.paper-card{padding:18px 15px;gap:13px}.paper-card p{font-size:15px}.couple-result-score{font-size:42px}}
@media(max-width:350px){.couple-screen{padding-left:25px;padding-right:25px}.couple-brand{font-size:21px}.couple-question{font-size:22px}.btn-option{font-size:16px}.couple-pick span{font-size:15px}}
@media(prefers-reduced-motion:reduce){.couple-guide,.couple-feedback{animation:none}.btn-option{transition:none}}

.couple-hud .couple-title{font-size:22px;line-height:1.2;font-weight:400;max-width:72%;text-align:right;text-wrap:balance}
.couple-content.solo-playing{gap:18px}.solo-playing .couple-options{margin:0}
.solo-result{padding:18px 16px;gap:12px}.solo-result h2{font-size:24px}.solo-result .profile-copy{font-size:15px;line-height:1.4}
.result-picks{width:100%;margin:0;text-align:left}.result-picks>div{display:grid;grid-template-columns:68px minmax(0,1fr);gap:10px;padding:8px 0;border-bottom:1px solid #28272330}.result-picks dt{font-size:11px;line-height:1.4;color:#645b50}.result-picks dd{margin:0;font-size:15px;line-height:1.3;overflow-wrap:anywhere}
.result-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;width:100%}.result-action{min-height:44px;background:transparent;border:1px solid #28272390;border-radius:4px;padding:7px 3px;font-size:12px;line-height:1.3;color:#282723;white-space:normal;overflow-wrap:anywhere}
.share-status{font-size:13px!important;line-height:1.4!important;color:#645b50}.copy-text{display:block;width:100%;min-height:130px;padding:10px;border:1px solid #28272370;background:#fffdf1;color:#282723;font:13px/1.5 PaperType,Georgia,serif;user-select:text;-webkit-user-select:text;resize:vertical}
@media(max-height:620px){.solo-result{padding:16px 14px;gap:10px}.solo-result h2{font-size:23px}.result-picks>div{padding:6px 0}.couple-content.solo-playing{gap:14px}}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
document.documentElement.lang = 'en';
function valuesFrom(config){
 const values={};for(const group of ['texts','tweaks','images'])for(const item of config[group]||[])values[item.id]=group==='images'?item.path:item.value;return values;
}
// A playful preference profile from this person's own picks, never a compatibility score.
function dateProfile(answers,config){
 const weights=[0,0,0,0];
 for(const [question,map,weight]of [[0,[0,1,2,3],3],[2,[2,2,0,0],1],[3,[3,1,2,0],2]]){
  const pick=answers[question];if(Number.isInteger(pick)&&pick>=0&&pick<4)weights[map[pick]]+=weight;
 }
 let index=Number.isInteger(answers[0])?answers[0]:0;
 for(let i=0;i<weights.length;i++)if(weights[i]>weights[index])index=i;
 return{title:config['PROFILE'+index+'_TITLE'],detail:config['PROFILE'+index+'_DESC']};
}
function resultText(config,questions,answers,profile){
 return[config.GAME_TITLE+' — '+profile.title,profile.detail,...questions.map((q,i)=>q.label+': '+q.options[answers[i]]),config.SHARE_INVITE].join('\n');
}
function drawResultCard(config,questions,answers,profile){
 const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1120;const ctx=canvas.getContext('2d');
 if(!ctx)return null;
 const family='PaperType, Georgia, serif';
 function lines(value,size,maxWidth){
  ctx.font=`${size}px ${family}`;const rows=[];let line='';
  for(const word of String(value).split(/\s+/)){const next=line?line+' '+word:word;if(ctx.measureText(next).width<=maxWidth){line=next;continue;}if(line)rows.push(line);line=word;}
  if(line)rows.push(line);return rows;
 }
 const titleLines=lines(profile.title,40,570),detailLines=lines(profile.detail,25,570);
 const pickLines=questions.map((q,i)=>lines(q.options[answers[i]],29,570));
 const titleY=224,detailY=titleY+titleLines.length*48+12;
 let rowY=detailY+detailLines.length*34+48;
 const positions=pickLines.map(rows=>{const y=rowY;rowY+=30+rows.length*36+30;return y;});
 const height=Math.max(920,rowY+142);canvas.height=height;
 ctx.fillStyle='#eed1c4';ctx.fillRect(0,0,720,height);
 ctx.fillStyle='#28272315';for(let y=8;y<height;y+=18)for(let x=9;x<720;x+=18){ctx.beginPath();ctx.arc(x,y,.8,0,Math.PI*2);ctx.fill();}
 ctx.fillStyle='#fff7de';ctx.strokeStyle='#282723';ctx.lineWidth=3;ctx.beginPath();if(ctx.roundRect)ctx.roundRect(34,144,652,height-180,8);else ctx.rect(34,144,652,height-180);ctx.fill();ctx.stroke();
 ctx.fillStyle='#282723';ctx.textAlign='center';ctx.font=`38px ${family}`;ctx.fillText(config.GAME_TITLE,360,88);
 ctx.font=`18px ${family}`;ctx.fillStyle='#645b50';ctx.fillText(config.RES_TITLE,360,186);
 function write(rows,x,y,size,lineHeight,align='center',color='#282723'){ctx.font=`${size}px ${family}`;ctx.textAlign=align;ctx.fillStyle=color;rows.forEach((line,i)=>ctx.fillText(line,x,y+i*lineHeight));}
 write(titleLines,360,titleY,40,48);write(detailLines,360,detailY,25,34);
 questions.forEach((q,i)=>{const y=positions[i];write([q.label],76,y,19,24,'left','#645b50');write(pickLines[i],76,y+37,29,36,'left');ctx.strokeStyle='#28272335';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(76,y+48+pickLines[i].length*36);ctx.lineTo(644,y+48+pickLines[i].length*36);ctx.stroke();});
 write(lines(config.SHARE_INVITE,21,560),360,height-81,21,28);
 return canvas;
}
function App(){
 const[config,setConfig]=React.useState(()=>valuesFrom(DEFAULT_CONFIG));
 const[phase,setPhase]=React.useState('playing'),[round,setRound]=React.useState(0),[answers,setAnswers]=React.useState([]);
 const[notice,setNotice]=React.useState(''),[copyVisible,setCopyVisible]=React.useState(false),[sharing,setSharing]=React.useState(false),[saving,setSaving]=React.useState(false),[poster,setPoster]=React.useState('');
 const synth=React.useRef(null),audioReady=React.useRef(null),shareFile=React.useRef(null),answerLock=React.useRef(false);
 React.useEffect(()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1600);let mounted=true;
  (async()=>{try{const response=await fetch('./game.config.json',{signal:controller.signal});if(!response.ok)return;const data=await response.json();if(mounted)setConfig({...valuesFrom(DEFAULT_CONFIG),...valuesFrom(data)});}catch(_){}finally{clearTimeout(timer);}})();
  return()=>{mounted=false;clearTimeout(timer);controller.abort();};
 },[]);
 React.useEffect(()=>()=>{synth.current?.dispose();},[]);
 const play=React.useCallback(()=>{
  try{if(!audioReady.current)audioReady.current=Promise.resolve(Tone.start()).then(()=>{synth.current=new Tone.Synth().toDestination();Tone.getContext().destination.volume.value=-10;}).catch(()=>{audioReady.current=null;});void audioReady.current?.then(()=>{if(!synth.current)return;try{synth.current.triggerAttackRelease('C4','16n',Tone.now());}catch(_){}});}catch(_){audioReady.current=null;}
 },[]);
 const questions=React.useMemo(()=>Array.from({length:4},(_,i)=>{const key='Q'+(i+1);return{text:config[key+'_TEXT'],label:config[key+'_LABEL'],options:Array.from({length:4},(_,j)=>config[key+'_O'+j])};}),[config]);
 const profile=React.useMemo(()=>dateProfile(answers,config),[answers,config]);
 const shareText=React.useMemo(()=>phase==='result'?resultText(config,questions,answers,profile):'',[phase,config,questions,answers,profile]);
 React.useEffect(()=>{
  if(phase!=='result')return;let current=true;shareFile.current=null;
  Promise.resolve(document.fonts?.ready).then(()=>{
   if(!current)return;const card=drawResultCard(config,questions,answers,profile);if(!card)return;
   try{setPoster(card.toDataURL('image/png'));card.toBlob(blob=>{if(current&&blob&&typeof File==='function')shareFile.current=new File([blob],'better-together.png',{type:'image/png'});},'image/png');}catch(_){}
  });return()=>{current=false;};
 },[phase,config,questions,answers,profile]);
 React.useEffect(()=>{answerLock.current=false;},[round,phase]);
 function choose(index){
  if(phase!=='playing'||answerLock.current||index<0||index>3)return;answerLock.current=true;play();
  const next=[...answers,index];setAnswers(next);
  if(next.length===questions.length)setPhase('result');else setRound(value=>value+1);
 }
 function restart(){play();answerLock.current=false;setRound(0);setAnswers([]);setPhase('playing');setNotice('');setCopyVisible(false);setPoster('');shareFile.current=null;}
 async function share(){
  if(sharing)return;setSharing(true);setNotice('');
  try{
   if(typeof navigator.share!=='function'){setNotice(config.SHARE_FALLBACK);return;}
   const payload={title:config.GAME_TITLE,text:shareText},file=shareFile.current;
   if(file&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]}))payload.files=[file];
   await navigator.share(payload);setNotice(config.SHARE_SUCCESS);
  }catch(error){if(error?.name!=='AbortError')setNotice(config.SHARE_FALLBACK);}finally{setSharing(false);}
 }
 async function copy(){
  setNotice('');try{if(!navigator.clipboard?.writeText)throw new Error('Copy unavailable');await navigator.clipboard.writeText(shareText);setCopyVisible(false);setNotice(config.COPY_SUCCESS);}catch(_){setCopyVisible(true);setNotice(config.COPY_MANUAL);}
 }
 function save(){
  if(saving)return;let dataURL=poster;
  try{if(!dataURL)dataURL=drawResultCard(config,questions,answers,profile)?.toDataURL('image/png');if(!dataURL)throw new Error('Card unavailable');}catch(_){setNotice(config.SAVE_FAILURE);return;}
  if(typeof window.tt?.saveDataURL==='function'){
   setSaving(true);try{window.tt.saveDataURL({dataURL,filename:'better_together',extension:'png',saveToAlbum:'image',success(){setNotice(config.SAVE_SUCCESS);setSaving(false);},fail(){setNotice(config.SAVE_FAILURE);setSaving(false);},complete(){setSaving(false);}});}catch(_){setSaving(false);setNotice(config.SAVE_FAILURE);}return;
  }
  // The documented SDK permits a normal browser download only when its native album API is absent.
  try{const link=document.createElement('a');link.href=dataURL;link.download='better-together.png';document.body.append(link);link.click();link.remove();setNotice(config.SAVE_DOWNLOAD);}catch(_){setNotice(config.SAVE_FAILURE);}
 }
 return <main className="couple-screen" data-phase={phase}>
  <header className="couple-hud"><span aria-label={config.PROGRESS_LABEL+' '+(round+1)+' / '+questions.length}>{round+1}/{questions.length}</span><span className="couple-title">{config.GAME_TITLE}</span></header>
  <section className="couple-main"><div className={'couple-content'+(phase==='playing'?' solo-playing':'')}>
   {phase==='playing'&&<><h2 className="couple-question">{questions[round].text}</h2><div className="couple-options">{questions[round].options.map((option,index)=><button key={index} className="btn-option" onClick={()=>choose(index)}>{option}</button>)}</div></>}
   {phase==='result'&&<section className="paper-card solo-result" aria-live="polite">
    <h2>{profile.title}</h2><p className="profile-copy">{profile.detail}</p>
    <dl className="result-picks">{questions.map((question,index)=><div key={index}><dt>{question.label}</dt><dd>{question.options[answers[index]]}</dd></div>)}</dl>
    <button className="btn-black share-button" disabled={sharing} onClick={share}>{config.SHARE_BTN}</button>
    <div className="result-actions"><button className="result-action" onClick={copy}>{config.COPY_BTN}</button><button className="result-action" disabled={saving} onClick={save}>{saving?config.SAVE_BUSY:config.SAVE_BTN}</button><button className="result-action" onClick={restart}>{config.RESTART_BTN}</button></div>
    {notice&&<p className="share-status" role="status">{notice}</p>}{copyVisible&&<textarea className="copy-text" aria-label={config.COPY_BTN} readOnly value={shareText} autoFocus onFocus={event=>event.currentTarget.select()}/>}
   </section>}
  </div></section>
 </main>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
