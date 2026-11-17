// Editable pre-compilation source. Four-round pass-the-phone couple test.
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
      "id": "START_BTN",
      "label": "Start Button",
      "value": "Start together",
      "default": "Start together",
      "max_length": 34
    },
    {
      "id": "HUD_QUESTION",
      "label": "HUD Question Label",
      "value": "Round",
      "default": "Round",
      "max_length": 25
    },
    {
      "id": "HUD_SCORE",
      "label": "HUD Score Label",
      "value": "Matches",
      "default": "Matches",
      "max_length": 27
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
      "id": "Q1_EXP",
      "label": "Q1 Explanation",
      "value": "Your next date could borrow a little from both picks.",
      "default": "Your next date could borrow a little from both picks.",
      "max_length": 100
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
      "id": "Q2_EXP",
      "label": "Q2 Explanation",
      "value": "There is always room for two favorite snacks.",
      "default": "There is always room for two favorite snacks.",
      "max_length": 100
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
      "id": "Q3_EXP",
      "label": "Q3 Explanation",
      "value": "Different ways of caring can make a lovely team.",
      "default": "Different ways of caring can make a lovely team.",
      "max_length": 100
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
      "id": "Q4_EXP",
      "label": "Q4 Explanation",
      "value": "Keep both ideas. You have two adventures to look forward to.",
      "default": "Keep both ideas. You have two adventures to look forward to.",
      "max_length": 100
    },
    {
      "id": "FB_CORRECT",
      "label": "Feedback Correct Text",
      "value": "Same wavelength!",
      "default": "Same wavelength!",
      "max_length": 36
    },
    {
      "id": "FB_WRONG",
      "label": "Feedback Wrong Text",
      "value": "Two good tastes!",
      "default": "Two good tastes!",
      "max_length": 36
    },
    {
      "id": "BTN_NEXT",
      "label": "Next Button",
      "value": "Next question",
      "default": "Next question",
      "max_length": 33
    },
    {
      "id": "RES_TITLE",
      "label": "Result Title",
      "value": "Your couple mix",
      "default": "Your couple mix",
      "max_length": 35
    },
    {
      "id": "RES_PERFECT",
      "label": "Result Perfect Comment",
      "value": "Two minds, one wavelength.",
      "default": "Two minds, one wavelength.",
      "max_length": 50
    },
    {
      "id": "RES_NORMAL",
      "label": "Result Normal Comment",
      "value": "Different tastes. Still a good team.",
      "default": "Different tastes. Still a good team.",
      "max_length": 56
    },
    {
      "id": "RESTART_BTN",
      "label": "Restart Button",
      "value": "Play together again",
      "default": "Play together again",
      "max_length": 39
    },
    {
      "id": "POST_BTN",
      "label": "Post My Play Button",
      "value": "Post My Play",
      "default": "Post My Play",
      "max_length": 32
    },
    {
      "id": "TURN_ONE",
      "label": "Turn One",
      "max_length": 120,
      "value": "Partner 1 · choose secretly",
      "default": "Partner 1 · choose secretly"
    },
    {
      "id": "TURN_TWO",
      "label": "Turn Two",
      "max_length": 120,
      "value": "Partner 2 · your turn",
      "default": "Partner 2 · your turn"
    },
    {
      "id": "TURN_GUIDE",
      "label": "Turn Guide",
      "max_length": 120,
      "value": "Pick one, then pass the phone",
      "default": "Pick one, then pass the phone"
    },
    {
      "id": "TURN_TWO_GUIDE",
      "label": "Turn Two Guide",
      "max_length": 120,
      "value": "Pick what feels most like you",
      "default": "Pick what feels most like you"
    },
    {
      "id": "HANDOFF_TITLE",
      "label": "Handoff Title",
      "max_length": 120,
      "value": "Pass the phone",
      "default": "Pass the phone"
    },
    {
      "id": "HANDOFF_COPY",
      "label": "Handoff Copy",
      "max_length": 120,
      "value": "Your partner picks next. Keep your answer a secret.",
      "default": "Your partner picks next. Keep your answer a secret."
    },
    {
      "id": "HANDOFF_BTN",
      "label": "Handoff Btn",
      "max_length": 120,
      "value": "Partner 2 is ready",
      "default": "Partner 2 is ready"
    },
    {
      "id": "FIRST_PICK",
      "label": "First Pick",
      "max_length": 120,
      "value": "Partner 1",
      "default": "Partner 1"
    },
    {
      "id": "SECOND_PICK",
      "label": "Second Pick",
      "max_length": 120,
      "value": "Partner 2",
      "default": "Partner 2"
    },
    {
      "id": "RESULT_SAME",
      "label": "Result Same",
      "max_length": 120,
      "value": "Same wavelength",
      "default": "Same wavelength"
    },
    {
      "id": "RESULT_MIX",
      "label": "Result Mix",
      "max_length": 120,
      "value": "A lovely mix",
      "default": "A lovely mix"
    },
    {
      "id": "RESULT_DIFFERENT",
      "label": "Result Different",
      "max_length": 120,
      "value": "Opposites attract",
      "default": "Opposites attract"
    },
    {
      "id": "RESULT_GUIDE",
      "label": "Result Guide",
      "max_length": 120,
      "value": "A playful conversation starter, made for two.",
      "default": "A playful conversation starter, made for two."
    },
    {
      "id": "FINISH_BTN",
      "label": "Finish Btn",
      "max_length": 120,
      "value": "See your couple mix",
      "default": "See your couple mix"
    },
    {
      "id": "RECAP_LABEL",
      "label": "Recap Label",
      "max_length": 120,
      "value": "Your shared picks",
      "default": "Your shared picks"
    },
    {
      "id": "FB_SHARED_DETAIL",
      "label": "Matching picks feedback",
      "value": "You already have your next date idea.",
      "default": "You already have your next date idea.",
      "max_length": 100
    }
  ],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1,
    "title": "Better Together",
    "name": "Couple Compatibility Test"
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
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
document.documentElement.lang = 'en';
function valuesFrom(config){
 const values={};for(const group of ['texts','tweaks','images'])for(const item of config[group]||[])values[item.id]=group==='images'?item.path:item.value;return values;
}
function CoupleMark({single=false}){
 return <svg className={single?'hud-heart':'couple-mark'} viewBox={single?'0 0 28 28':'0 0 48 36'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{single?<path d="M14 23C11 20 3 15 3 9a6 6 0 0 1 11-3A6 6 0 0 1 25 9c0 6-8 11-11 14Z"/>:<><path d="M18 30C14 26 3 19 3 11a8 8 0 0 1 15-4A8 8 0 0 1 32 11c0 8-10 15-14 19Z"/><path d="M31 32c-3-3-10-8-10-14a6 6 0 0 1 10-4 6 6 0 0 1 11 3c0 6-8 12-11 15Z"/></>}</svg>;
}
function useRecordingSubmission(){
 const canSubmit=typeof window.tt?.playableRecordingSubmission==='function';
 const[submitting,setSubmitting]=React.useState(false);
 React.useEffect(()=>{
  const ready=()=>setSubmitting(false),visible=()=>{if(!document.hidden)ready();};
  window.addEventListener('pageshow',ready);document.addEventListener('visibilitychange',visible);
  return()=>{window.removeEventListener('pageshow',ready);document.removeEventListener('visibilitychange',visible);};
 },[]);
 const submit=()=>{if(!canSubmit||submitting)return;setSubmitting(true);window.tt.playableRecordingSubmission({success(){},fail(){setSubmitting(false);},complete(){}});};
 return{canSubmit,submitting,submit};
}
function App(){
 const[config,setConfig]=React.useState(()=>valuesFrom(DEFAULT_CONFIG));
 const[phase,setPhase]=React.useState('playing'),[round,setRound]=React.useState(0),[turn,setTurn]=React.useState(1),[firstPick,setFirstPick]=React.useState(null),[pairs,setPairs]=React.useState([]);
 const actionLock=React.useRef(false),synth=React.useRef(null),audioReady=React.useRef(null);
 const recording=useRecordingSubmission();
 React.useEffect(()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1600);let mounted=true;
  (async()=>{try{const response=await fetch('./game.config.json',{signal:controller.signal});if(!response.ok)return;const data=await response.json();if(mounted)setConfig({...valuesFrom(DEFAULT_CONFIG),...valuesFrom(data)});}catch(_){}finally{clearTimeout(timer);}})();
  return()=>{mounted=false;clearTimeout(timer);controller.abort();};
 },[]);
 React.useEffect(()=>()=>{synth.current?.dispose();},[]);
 const play=React.useCallback(kind=>{
  try{
   if(!audioReady.current)audioReady.current=Promise.resolve(Tone.start()).then(()=>{synth.current=new Tone.Synth().toDestination();Tone.getContext().destination.volume.value=-10;}).catch(()=>{audioReady.current=null;});
   void audioReady.current?.then(()=>{if(!synth.current)return;try{synth.current.triggerAttackRelease(kind==='match'?'C5':'C4',kind==='match'?'8n':'16n',Tone.now());}catch(_){}});
  }catch(_){audioReady.current=null;}
 },[]);
 const questions=React.useMemo(()=>Array.from({length:4},(_,i)=>{
  const key='Q'+(i+1);return{text:config[key+'_TEXT'],options:Array.from({length:4},(_,j)=>config[key+'_O'+j]),detail:config[key+'_EXP']};
 }),[config]);
 const question=questions[round],matches=pairs.filter(pair=>pair.a===pair.b).length,latest=pairs[pairs.length-1],same=latest?.a===latest?.b;
 function choose(index){
  if(phase!=='playing'||actionLock.current||index<0||index>3)return;actionLock.current=true;
  if(turn===1){play('tap');setFirstPick(index);setPhase('handoff');}
  else if(firstPick!==null){const pair={a:firstPick,b:index};setPairs(previous=>[...previous,pair]);play(pair.a===pair.b?'match':'tap');setPhase('feedback');}
 }
 function ready(){if(phase!=='handoff')return;play('tap');actionLock.current=false;setTurn(2);setPhase('playing');}
 function next(){
  if(phase!=='feedback')return;play('tap');
  if(round===questions.length-1)setPhase('result');
  else{actionLock.current=false;setRound(value=>value+1);setFirstPick(null);setTurn(1);setPhase('playing');}
 }
 function restart(){play('tap');actionLock.current=false;setRound(0);setTurn(1);setFirstPick(null);setPairs([]);setPhase('playing');}
 const profile=matches===4?config.RESULT_SAME:matches>=2?config.RESULT_MIX:config.RESULT_DIFFERENT;
 return <main className="couple-screen" data-phase={phase}>
  <header className="couple-hud"><span className="hud-item" aria-label={config.HUD_QUESTION+' '+(round+1)+' / '+questions.length}><span>{round+1}/{questions.length}</span><small className="hud-label">{config.HUD_QUESTION}</small></span><span className="hud-item" aria-label={config.HUD_SCORE+' '+matches}><CoupleMark single/><span>{matches}</span></span></header>
  <section className="couple-main"><div className="couple-content">
   {phase==='playing'&&<>
    <div className="couple-brand"><CoupleMark/><span>{config.GAME_TITLE}</span></div>
    <div className="couple-turn" aria-live="polite">{turn===1?config.TURN_ONE:config.TURN_TWO}</div>
    <h2 className="couple-question">{question.text}</h2>
    <div className="couple-options">{question.options.map((option,index)=><button key={index} className="btn-option" onClick={()=>choose(index)}>{option}</button>)}</div>
    <p className="couple-guide">{turn===1?config.TURN_GUIDE:config.TURN_TWO_GUIDE}</p>
   </>}
   {phase==='handoff'&&<section className="paper-card couple-handoff" aria-label={config.HANDOFF_TITLE}>
    <CoupleMark/><div className="paper-kicker">{config.GAME_TITLE}</div><h2>{config.HANDOFF_TITLE}</h2><p>{config.HANDOFF_COPY}</p><button className="btn-black handoff-button" onClick={ready}>{config.HANDOFF_BTN}</button>
   </section>}
   {phase==='feedback'&&latest&&<section className="paper-card couple-feedback" aria-live="polite">
    <CoupleMark/><h2>{same?config.FB_CORRECT:config.FB_WRONG}</h2>
    <div className="couple-picks"><div className="couple-pick"><small>{config.FIRST_PICK}</small><span>{question.options[latest.a]}</span></div><div className="couple-pick"><small>{config.SECOND_PICK}</small><span>{question.options[latest.b]}</span></div></div>
    <p>{same?config.FB_SHARED_DETAIL:question.detail}</p><button className="btn-black next-button" onClick={next}>{round===questions.length-1?config.FINISH_BTN:config.BTN_NEXT}</button>
   </section>}
   {phase==='result'&&<section className="paper-card couple-result" aria-live="polite">
    <CoupleMark/><h2>{config.RES_TITLE}</h2><div className="couple-result-score">{matches} / {questions.length}<small>{config.HUD_SCORE}</small></div><div className="couple-profile">{profile}</div><p>{matches===questions.length?config.RES_PERFECT:config.RES_NORMAL}</p><p className="couple-fineprint">{config.RESULT_GUIDE}</p><button className="btn-black restart-button" onClick={restart}>{config.RESTART_BTN}</button>{recording.canSubmit&&<button className="btn-black secondary" disabled={recording.submitting} onClick={recording.submit}>{config.POST_BTN}</button>}
   </section>}
  </div></section>
 </main>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
