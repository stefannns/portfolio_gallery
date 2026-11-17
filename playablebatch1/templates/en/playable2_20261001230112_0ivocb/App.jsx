// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [
    {
      "id": "TIME_LIMIT",
      "kind": "number",
      "label": "Questions Per Run",
      "value": 9,
      "default": 9,
      "min": 5,
      "max": 9,
      "step": 1
    },
    {
      "id": "DECAY_RATE",
      "kind": "number",
      "label": "Fate Variation",
      "value": 1,
      "default": 1,
      "min": 0.1,
      "max": 5,
      "step": 0.1
    },
    {
      "id": "CLICK_POWER",
      "kind": "number",
      "label": "Base Strength Bonus",
      "value": 5,
      "default": 5,
      "min": 1,
      "max": 20,
      "step": 1
    }
  ],
  "texts": [
    {
      "id": "GAME_TITLE",
      "label": "Game Title",
      "value": "How Strong Are You?",
      "default": "How Strong Are You?",
      "max_length": 30
    },
    {
      "id": "TEXT_WEAK",
      "label": "Level 1",
      "value": "Weak",
      "default": "Weak",
      "max_length": 20
    },
    {
      "id": "TEXT_AVERAGE",
      "label": "Level 2",
      "value": "Average",
      "default": "Average",
      "max_length": 20
    },
    {
      "id": "TEXT_STRONG",
      "label": "Level 3",
      "value": "Strong",
      "default": "Strong",
      "max_length": 20
    },
    {
      "id": "TEXT_SUPER",
      "label": "Level 4",
      "value": "Superhuman",
      "default": "Superhuman",
      "max_length": 20
    },
    {
      "id": "TEXT_ABSURD",
      "label": "Level 5",
      "value": "Absurdly Powerful",
      "default": "Absurdly Powerful",
      "max_length": 20
    },
    {
      "id": "BTN_RETRY",
      "label": "Retry Button",
      "value": "Try Again",
      "default": "Try Again",
      "max_length": 20
    }
  ],
  "images": [
    {
      "id": "BG_MAIN",
      "label": "Fairy-tale woodland paper",
      "path": "./assets/fantasy-v1/forest-paper.webp",
      "replaceable": true
    },
    {
      "id": "IMG_TITLE",
      "label": "Destiny Emblem",
      "path": "./assets/destiny_emblem.svg",
      "replaceable": true
    },
    {
      "id": "CREST_SHIELD",
      "label": "Shield archetype crest",
      "path": "./assets/fantasy-v1/crest-shield.webp",
      "replaceable": true
    },
    {
      "id": "CREST_AXE",
      "label": "Axe archetype crest",
      "path": "./assets/fantasy-v1/crest-axe.webp",
      "replaceable": true
    },
    {
      "id": "CREST_WAND",
      "label": "Wand archetype crest",
      "path": "./assets/fantasy-v1/crest-wand.webp",
      "replaceable": true
    },
    {
      "id": "CREST_MASK",
      "label": "Mask archetype crest",
      "path": "./assets/fantasy-v1/crest-mask.webp",
      "replaceable": true
    },
    {
      "id": "CREST_BOW",
      "label": "Bow archetype crest",
      "path": "./assets/fantasy-v1/crest-bow.webp",
      "replaceable": true
    },
    {
      "id": "CREST_EYE",
      "label": "Eye archetype crest",
      "path": "./assets/fantasy-v1/crest-eye.webp",
      "replaceable": true
    },
    {
      "id": "CREST_COMPASS",
      "label": "Compass archetype crest",
      "path": "./assets/fantasy-v1/crest-compass.webp",
      "replaceable": true
    },
    {
      "id": "CREST_CROWN",
      "label": "Crown archetype crest",
      "path": "./assets/fantasy-v1/crest-crown.webp",
      "replaceable": true
    }
  ],
  "config_version": "2.0",
  "playable": {
    "post_id": "99279478907671513",
    "version_id": "99279478907604667",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #eaf2e9; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
// Preserve the original fallback when the configuration cannot be fetched.
for (const value of ['playable-inline-config', 'playable-config-inline']) {
  const node = document.createElement('script');
  node.id = value;
  node.type = 'application/json';
  node.textContent = JSON.stringify(DEFAULT_CONFIG);
  document.body.append(node);
}
document.documentElement.lang = 'en';
function ep(config) {
  let options2 = {};
  for (let value of config.tweaks || []) options2[value.id] = value.value;
  for (let value of config.texts || []) options2[value.id] = value.value;
  for (let value of config.images || []) options2[value.id] = value.path;
  for (let value of config.mentions || []) options2[value.id] = value.path || value.value;
  return options2;
}
function Pc(value, otherValue, argument3) {
  return Math.max(otherValue, Math.min(argument3, value));
}
var items = [{
  id: "race",
  question: "What is your species?",
  hint: "Choose a fantasy species for your story.",
  options: ["Human", "Elf", "Orc", "Fairy"],
  weights: [0, 0, 0, 0]
}];
var items2 = [{
  id: "birthplace",
  question: "Where are you born?",
  hint: "The first place you call home.",
  options: ["Quiet village", "Ancient forest", "Royal city", "Under the stars"],
  weights: [1, 2, 2, 3]
}, {
  id: "omen",
  question: "What is the first omen?",
  hint: "A sign appears in the sky.",
  options: ["A comet", "A storm", "Golden dawn", "A whisper"],
  weights: [3, 2, 2, 1]
}, {
  id: "gift",
  question: "What gift awakens?",
  hint: "Your hidden power takes shape.",
  options: ["Courage", "Magic", "Speed", "Wisdom"],
  weights: [3, 3, 2, 2]
}, {
  id: "trial",
  question: "What tests your strength?",
  hint: "No destiny comes without a trial.",
  options: ["A dragon", "A maze", "A rival", "A storm"],
  weights: [3, 2, 2, 3]
}, {
  id: "ally",
  question: "Who joins your journey?",
  hint: "Even legends need a companion.",
  options: ["A friend", "A mentor", "A whole team", "No one"],
  weights: [2, 2, 3, 1]
}, {
  id: "relic",
  question: "Which relic calls to you?",
  hint: "Choose what you will carry forward.",
  options: ["A sword", "A shield", "A staff", "A map"],
  weights: [3, 2, 2, 1]
}, {
  id: "protect",
  question: "What will you protect?",
  hint: "The choice that defines you.",
  options: ["Your home", "A stranger", "A secret", "Your dream"],
  weights: [3, 3, 2, 2]
}];
var options = {
  id: "fate",
  question: "What fate do you choose?",
  hint: "The final page is yours to write.",
  options: ["Guardian", "Explorer", "Sage", "Legend"],
  weights: [2, 2, 2, 3]
};
function useGameFeature1() {
  let stateRef = React.useRef(null);
  return value => {
    try {
      let value2 = window.AudioContext || window.webkitAudioContext;
      if (!value2) return;
      let value3 = stateRef.current || (stateRef.current = new value2());
      if (value3.state === "suspended") {
        value3.resume();
      }
      let currentTime = value3.currentTime;
      let oscillator = value3.createOscillator();
      let gain = value3.createGain();
      oscillator.type = value === "result" ? "triangle" : "sine";
      let value4 = value === "result" ? 523 : value === "back" ? 330 : 440;
      let value5 = value === "result" ? 784 : value === "back" ? 260 : 620;
      oscillator.frequency.setValueAtTime(value4, currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(value5, currentTime + 0.15);
      gain.gain.setValueAtTime(0.0001, currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.24);
      oscillator.connect(gain).connect(value3.destination);
      oscillator.start(currentTime);
      oscillator.stop(currentTime + 0.25);
    } catch {}
  };
}
const FATE_ARCHETYPES = {
  guardian: {name:'Dawn Guardian',icon:'shield',description:'You stand between danger and the people you love.',affinity:[.55,0,.1,.35]},
  berserker: {name:'Storm Berserker',icon:'axe',description:'You turn pressure into unstoppable force.',affinity:[.8,0,.15,.05]},
  spellweaver: {name:'Moon Spellweaver',icon:'wand',description:'A little magic opens doors nobody else can see.',affinity:[.1,.7,.05,.15]},
  trickster: {name:'Velvet Trickster',icon:'mask',description:'You always have one more surprise up your sleeve.',affinity:[.1,.15,.35,.4]},
  ranger: {name:'Wildwood Ranger',icon:'bow',description:'You trust your instincts and find your own way.',affinity:[.15,.05,.6,.2]},
  oracle: {name:'Starbound Oracle',icon:'eye',description:'You spot the signs everyone else misses.',affinity:[.05,.5,.05,.4]},
  wanderer: {name:'Sky Wanderer',icon:'compass',description:'Your next great adventure is just over the horizon.',affinity:[.1,.1,.35,.45]},
  ruler: {name:'Golden Sovereign',icon:'crown',description:'You bring people together and turn plans into legends.',affinity:[.4,.15,.05,.4]}
};

// Every rolled answer contributes. The last spin nudges the result without replacing the journey.
const FATE_AFFINITIES = {
  race:[['ruler','wanderer'],['ranger','spellweaver'],['berserker','guardian'],['trickster','oracle']],
  birthplace:[['guardian','wanderer'],['ranger','spellweaver'],['ruler','trickster'],['oracle','wanderer']],
  omen:[['oracle','spellweaver'],['berserker','guardian'],['ruler','guardian'],['trickster','oracle']],
  gift:[['berserker','guardian'],['spellweaver','oracle'],['ranger','trickster'],['oracle','ruler']],
  trial:[['berserker','guardian'],['trickster','wanderer'],['ranger','berserker'],['guardian','spellweaver']],
  ally:[['guardian','wanderer'],['spellweaver','oracle'],['ruler','guardian'],['trickster','ranger']],
  relic:[['berserker','ruler'],['guardian','ruler'],['spellweaver','oracle'],['wanderer','ranger']],
  protect:[['guardian','ruler'],['ruler','guardian'],['trickster','oracle'],['wanderer','spellweaver']],
  fate:[['guardian','ruler'],['wanderer','ranger'],['oracle','spellweaver'],['ruler','berserker']]
};
const FATE_STAT_WEIGHTS = {
  race:[[2,2,2,3],[1,4,4,2],[4,1,2,2],[1,4,3,4]],
  birthplace:[[2,1,2,3],[1,3,4,2],[3,2,1,3],[1,4,2,4]],
  omen:[[2,4,2,3],[4,2,3,1],[3,2,1,4],[1,4,3,2]],
  gift:[[4,1,2,3],[1,5,2,2],[1,1,5,3],[2,4,1,3]],
  trial:[[5,1,2,2],[1,3,3,3],[3,1,4,2],[3,3,2,2]],
  ally:[[2,1,2,4],[2,4,1,2],[4,1,2,3],[1,2,4,2]],
  relic:[[5,0,2,1],[4,1,1,2],[1,5,1,1],[0,1,4,4]],
  protect:[[4,1,1,3],[3,1,2,4],[1,4,3,1],[1,3,3,4]],
  fate:[[4,1,1,3],[1,1,4,4],[1,5,1,2],[3,2,3,4]]
};

function op(questions, answers, config) {
  const profile = {};
  const scores = Object.fromEntries(Object.keys(FATE_ARCHETYPES).map(id=>[id,0]));
  const totals = [0,0,0,0], maxima = [0,0,0,0];
  let weightedStrength=0, maxStrength=0;
  questions.forEach((question,index)=>{
    const choice=answers[index];
    if(!Number.isInteger(choice)||choice<0||choice>=question.options.length)return;
    profile[question.id]=question.options[choice];
    if(question.id!=='race'){weightedStrength+=(question.weights[choice]||1)-1;maxStrength+=Math.max(...question.weights)-1;}
    const lean=FATE_AFFINITIES[question.id]?.[choice];
    if(lean){scores[lean[0]]+=question.id==='fate'?4:3;scores[lean[1]]+=1;}
    const rows=FATE_STAT_WEIGHTS[question.id];
    if(rows)for(let i=0;i<4;i++){totals[i]+=rows[choice][i];maxima[i]+=Math.max(...rows.map(row=>row[i]));}
  });
  const strength=Pc(Math.round(16+(maxStrength?weightedStrength/maxStrength:0)*73+(Number(config.CLICK_POWER)||5)+(Number(config.DECAY_RATE)||1)),0,99);
  const stats=totals.map((n,i)=>Pc(Math.round(20+(maxima[i]?n/maxima[i]:0)*75),0,99));
  stats[0]=strength;
  const rank=[config.TEXT_WEAK||'Weak',config.TEXT_AVERAGE||'Average',config.TEXT_STRONG||'Strong',config.TEXT_SUPER||'Superhuman',config.TEXT_ABSURD||'Absurdly Powerful'][strength<35?0:strength<50?1:strength<65?2:strength<82?3:4];
  const archetypeId=Object.keys(FATE_ARCHETYPES).reduce((best,id)=>{
    const score=key=>scores[key]+FATE_ARCHETYPES[key].affinity.reduce((sum,n,i)=>sum+n*stats[i],0)/1000;
    return score(id)>score(best)?id:best;
  },'guardian');
  const archetype=FATE_ARCHETYPES[archetypeId];
  const giftTraits={Courage:'Fearless',Magic:'Arcane touch',Speed:'Quick-footed',Wisdom:'Keen mind'};
  const trialTraits={'A dragon':'Dragon-tested','A maze':'Pathfinder','A rival':'Battle-ready','A storm':'Storm-forged'};
  const traits=[giftTraits[profile.gift],trialTraits[profile.trial]].filter(Boolean);
  if(traits.length<2)traits.push(profile.ally==='No one'?'Independent':'Adventure-bound');
  const origins={'Quiet village':'Raised in a quiet village','Ancient forest':'Raised in an ancient forest','Royal city':'Born in a royal city','Under the stars':'Born under the stars'};
  const trials={'A dragon':'You faced a dragon','A maze':'You found a way through a maze','A rival':'You challenged a rival','A storm':'You weathered a storm'};
  const species=(profile.race||'traveler').toLowerCase();
  const article=/^[aeiou]/.test(species)?'an':'a';
  const opening=`${origins[profile.birthplace]||'Born far from here'}, you are ${article} ${species}${profile.gift?' with a gift for '+profile.gift.toLowerCase():''}.`;
  const companion=profile.ally==='No one'?' on your own':profile.ally?' with '+profile.ally.toLowerCase()+' at your side':'';
  const relic=profile.relic?', carrying '+profile.relic.toLowerCase():'';
  const purpose=profile.protect?' to protect '+profile.protect.toLowerCase():'';
  const journey=profile.trial?`${trials[profile.trial]}${companion}${relic}${purpose}.`:`Your journey leads toward a life of ${profile.fate?.toLowerCase()==='sage'?'wisdom':profile.fate?.toLowerCase()==='guardian'?'courage':'discovery'}.`;
  const details=[
    {label:'Kind',value:profile.race,icon:species},
    {label:'Homeland',value:profile.birthplace,icon:'home'},
    {label:'Companion',value:profile.ally==='No one'?'Solo':profile.ally,icon:'companion'},
    {label:'Relic',value:profile.relic,icon:({'A sword':'sword','A shield':'shield','A staff':'wand','A map':'map'})[profile.relic]}
  ].filter(detail=>detail.value);
  return {strength,rank,fate:archetype.name,story:opening+' '+journey,stats,traits:traits.slice(0,2),details,archetypeId,archetype};
}

const FATE_CRESTS = {
  "shield": {
    "id": "CREST_SHIELD",
    "path": "./assets/fantasy-v1/crest-shield.webp"
  },
  "axe": {
    "id": "CREST_AXE",
    "path": "./assets/fantasy-v1/crest-axe.webp"
  },
  "wand": {
    "id": "CREST_WAND",
    "path": "./assets/fantasy-v1/crest-wand.webp"
  },
  "mask": {
    "id": "CREST_MASK",
    "path": "./assets/fantasy-v1/crest-mask.webp"
  },
  "bow": {
    "id": "CREST_BOW",
    "path": "./assets/fantasy-v1/crest-bow.webp"
  },
  "eye": {
    "id": "CREST_EYE",
    "path": "./assets/fantasy-v1/crest-eye.webp"
  },
  "compass": {
    "id": "CREST_COMPASS",
    "path": "./assets/fantasy-v1/crest-compass.webp"
  },
  "crown": {
    "id": "CREST_CROWN",
    "path": "./assets/fantasy-v1/crest-crown.webp"
  }
};

function FateIcon({name,size=24,crest=false,images={}}) {
  const artwork=crest&&FATE_CRESTS[name];
  if(artwork)return <img width={size} height={size} src={images[artwork.id]||artwork.path} alt="" aria-hidden="true" draggable="false" style={{display:'block',objectFit:'contain',flex:'none'}}/>;
  const shapes={
    shield:<><path d="M24 5 39 11v12c0 9-8 16-15 20C17 39 9 32 9 23V11Z" fill="#fff"/><path d="m24 13 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z" fill="#000"/></>,
    axe:<><path d="m14 40 18-29M28 9l7-4 8 12-6 4-9-5-9 1-4-6 9-5Z" fill="#fff"/><path d="m12 39 4 3M24 17l5 4"/></>,
    wand:<><path d="m9 39 19-23 5 4-19 23Z" fill="#fff"/><path d="m31 5 3 6 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z" fill="#000"/><path d="M9 12v7m-3-3h6M39 31v7m-3-3h6"/></>,
    mask:<><path d="M7 14c11 5 23 5 34 0v12c0 11-9 16-17 10C16 42 7 37 7 26Z" fill="#fff"/><path d="m13 23 7 3-7 1m22-4-7 3 7 1M20 32q4 3 8 0"/><path d="m8 16-3-6m35 6 3-6"/></>,
    bow:<><path d="M13 7q33 17 0 34" strokeWidth="4"/><path d="m13 7 13 17-13 17m-4-17h33m-7-6 7 6-7 6"/></>,
    eye:<><path d="M4 24q20-25 40 0-20 25-40 0Z" fill="#fff"/><circle cx="24" cy="24" r="8" fill="#000"/><circle cx="24" cy="24" r="2" fill="currentColor"/><path d="M24 4v5m0 30v5M8 7l4 4m24 26 4 4M40 7l-4 4M12 37l-4 4"/></>,
    compass:<><circle cx="24" cy="25" r="17" fill="#fff"/><path d="m24 11 5 14-5 14-5-14Z" fill="#000"/><path d="m10 25 14-5 14 5-14 5Z" fill="#000"/><circle cx="24" cy="25" r="2" fill="currentColor"/><path d="M21 4h6"/></>,
    crown:<><path d="m6 13 10 9 8-15 8 15 10-9-5 24H11Z" fill="#fff"/><path d="M12 30h24m-22 7v5h20v-5"/><circle cx="24" cy="27" r="2" fill="#000"/></>,
    sword:<><path d="m24 5 6 9v18H18V14Z" fill="#fff"/><path d="M24 11v20M13 32h22m-11 1v10m-4 0h8"/></>,
    agility:<><path d="m25 7-16 22h13l-2 13 19-23H26Z" fill="#fff"/></>,
    luck:<><path d="M24 24c-18 6-18-13-9-13 5 0 7 7 9 13Zm0 0c-6-18 13-18 13-9 0 5-7 7-13 9Zm0 0c18-6 18 13 9 13-5 0-7-7-9-13Zm0 0c6 18-13 18-13 9 0-5 7-7 13-9Z" fill="#fff"/><path d="M24 24q-2 12 8 19"/></>,
    home:<><path d="m6 23 18-15 18 15M11 20v21h26V20" fill="#fff"/><path d="M21 41V29h7v12M13 8V4h8v8"/></>,
    companion:<><circle cx="18" cy="16" r="7" fill="#fff"/><path d="M5 40V31q0-8 13-8t13 8v9Z" fill="#fff"/><path d="M31 9q11 0 9 9-1 4-6 4m0 3q10 0 10 9v6H34"/></>,
    map:<><path d="m5 10 13-4 13 4 12-4v32l-12 4-13-4-13 4Z" fill="#fff"/><path d="M18 7v30m13-26v30M10 27l4-7 9 6 13-9m-3-2 5 1-1 5"/></>,
    human:<><circle cx="24" cy="17" r="10" fill="#fff"/><path d="M7 42q0-15 17-15t17 15M16 12q9 5 17 0"/></>,
    elf:<><path d="m14 19-9-8 5 17 6 2m18-11 9-8-5 17-6 2" fill="#fff"/><ellipse cx="24" cy="19" rx="10" ry="12" fill="#000"/><path d="M11 42q0-13 13-13t13 13M16 15q5 1 8-7 4 7 8 7"/></>,
    orc:<><path d="M10 15q0-10 14-10t14 10v9q0 12-14 12T10 24Z" fill="#fff"/><path d="m13 26 4-6 3 8m15-2-4-6-3 8M16 15h3m10 0h3M12 42l7-7m17 7-7-7"/></>,
    fairy:<><path d="M22 24C0 2 1 38 22 32m4-8C48 2 47 38 26 32" fill="#fff"/><circle cx="24" cy="12" r="6" fill="#000"/><path d="m24 20-8 20h16Zm0 20v5M10 8l2 4m-5 0 4-1" fill="#000"/></>,
    refresh:<><path d="M8 21a16 16 0 1 1 2 14M8 9v12h12"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]||shapes.compass}</svg>;
}

function FateResult({result,onRestart,actionRef,headingRef,retryText,images}) {
  const labels=['Strength','Magic','Agility','Luck'];
  const icons=['sword','wand','agility','luck'];
  return <section className="fate-result" aria-labelledby="fate-result-title">
    <div className="fate-result-scroll">
      <header className="fate-result-hero">
        <div className="fate-result-emblem"><FateIcon name={result.archetype.icon} size={64} crest images={images}/></div>
        <div><h1 id="fate-result-title" ref={headingRef} tabIndex={-1}>{result.fate}</h1><p className="fate-result-rank">{result.rank}</p></div>
      </header>
      <p className="fate-result-description">{result.archetype.description}</p>
      <div className="fate-result-traits" aria-label="Defining traits">{result.traits.map(trait=><span key={trait}>{trait}</span>)}</div>
      <dl className="fate-result-stats">{labels.map((label,index)=><div key={label} className="fate-result-stat">
        <dt><FateIcon name={icons[index]} size={20}/><span>{label}</span></dt><dd>{result.stats[index]}<span>/99</span></dd>
        <div className="fate-stat-track" aria-hidden="true"><span style={{width:result.stats[index]/99*100+'%'}}/></div>
      </div>)}</dl>
      <dl className="fate-result-details">{result.details.map(detail=><div key={detail.label}>
        <FateIcon name={detail.icon} size={28}/><div><dt>{detail.label}</dt><dd>{detail.value}</dd></div>
      </div>)}</dl>
      <div className="fate-result-story"><h2>Your story</h2><p>{result.story}</p></div>
    </div>
    <footer className="fate-result-footer"><button ref={actionRef} type="button" onClick={onRestart}><FateIcon name="refresh" size={20}/><span>{retryText||'Try again'}</span></button></footer>
  </section>;
}

function GameIp({
  cfg: e
}) {
  const createElement = React.createElement;
  React.useEffect(() => {
    Object.values(FATE_CRESTS).forEach(artwork=>{const image=new Image();image.src=e[artwork.id]||artwork.path;});
  }, [e]);
  const count = Pc(Math.round(Number(e.TIME_LIMIT) || 9), 5, 9);
  const questions = React.useMemo(() => [...items, ...items2.slice(0, count - 2), options], [count]);
  const [step, setStep] = React.useState(0);
  const [answers, setAnswers] = React.useState([]);
  const [rotation, setRotation] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [complete, setComplete] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const stateRef = React.useRef({
    locked: false,
    active: true,
    timers: []
  });
  const action = React.useRef(null);
  const resultHeading = React.useRef(null);
  React.useEffect(() => {if(complete)resultHeading.current?.focus({preventScroll:true});}, [complete]);
  const sound = useGameFeature1();
  React.useEffect(() => {
    stateRef.current.active = true;
    return () => {
      stateRef.current.active = false;
      stateRef.current.timers.forEach(clearTimeout);
      stateRef.current.timers = [];
    };
  }, []);
  const question = questions[complete ? questions.length - 1 : step];
  React.useEffect(() => {
    if (!complete && stateRef.current.previousQuestion && (stateRef.current.previousQuestion !== question.id || stateRef.current.previousBusy && !busy)) action.current?.focus({
      preventScroll: true
    });
    stateRef.current.previousQuestion = question.id;
    stateRef.current.previousBusy = busy;
  }, [question.id, busy, complete]);
  const result = complete ? op(questions, answers, e) : null;
  const colors = ["#bbd1b0", "#365c46"];
  const reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 350 : 2200;
  const random = value2 => {
    if (window.crypto?.getRandomValues) {
      const value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      return value[0] % value2;
    }
    return Math.floor(Math.random() * value2);
  };
  const later = (value, otherValue) => {
    const timer = setTimeout(() => {
      stateRef.current.timers = stateRef.current.timers.filter(item => item !== timer);
      if (stateRef.current.active) value();
    }, otherValue);
    stateRef.current.timers.push(timer);
  };
  const restart = () => {
    stateRef.current.timers.forEach(clearTimeout);
    stateRef.current.timers = [];
    stateRef.current.locked = false;
    setStep(0);
    setAnswers([]);
    setRotation(0);
    setBusy(false);
    setSelected(null);
    setComplete(false);
    setAnnouncement("");
  };
  const spin = () => {
    if (stateRef.current.locked) return;
    if (complete) {
      restart();
      return;
    }
    stateRef.current.locked = true;
    setBusy(true);
    setSelected(null);
    setAnnouncement("Spinning for a random answer.");
    sound("choice");
    const chosen = random(question.options.length);
    const slice = 360 / question.options.length;
    const turns = 5 + random(3);
    const landing = (360 - chosen * slice) % 360;
    setRotation(previous => previous + turns * 360 + (landing - previous % 360 + 360) % 360);
    later(() => {
      setSelected(chosen);
      sound("choice");
      const answer = question.options[chosen];
      setAnnouncement(answer);
      later(() => {
        const next = [...answers.slice(0, step), chosen];
        setAnswers(next);
        setBusy(false);
        stateRef.current.locked = false;
        if (step + 1 >= questions.length) {
          setComplete(true);
          const fate = op(questions, next, e);
          setAnnouncement(fate.fate + ". " + fate.rank + ", " + fate.strength + " out of 99. Your character card is ready.");
          sound("result");
        } else {
          setStep(step + 1);
          setRotation(0);
          setSelected(null);
        }
      }, reduced ? 180 : 520);
    }, duration);
  };
  const slice = 360 / question.options.length;
  const point = angle => {
    const radians = angle * Math.PI / 180;
    return [160 + 134 * Math.cos(radians), 160 + 134 * Math.sin(radians)];
  };
  const wrap = label => {
    const words = label.split(" ");
    const lines = [];
    let line = "";
    words.forEach(word => {
      if ((line + " " + word).trim().length > 11 && line) {
        lines.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    });
    if (line) lines.push(line);
    return lines;
  };
  const wheel = <svg viewBox={"0 0 320 320"} width={320} height={320} aria-hidden={true} className={"fate-wheel-face"} style={{
    transform: "rotate(" + rotation + "deg)",
    transitionDuration: duration + "ms"
  }}><defs><pattern id="fate-wheel-engraving" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M-2 3 3-2M0 9 9 0M6 12 12 6" fill="none" stroke="#000" strokeWidth=".5" opacity=".07"/><circle cx="2" cy="5" r=".4" fill="#000" opacity=".08"/></pattern></defs>
    <circle cx="160" cy="160" r="157" fill={colors[0]} stroke="#000" strokeWidth="2.25"/>
    <circle cx="160" cy="160" r="152" fill="none" stroke="#000" strokeWidth=".65"/>
    <circle cx="160" cy="160" r="138" fill="none" stroke="#000" strokeWidth=".65"/>
    {Array.from({length:24},(_,index)=><g key={'vine-'+index} transform={'translate(160 160) rotate('+index*15+')'} fill="none" stroke="#000" strokeWidth=".8" strokeLinecap="round" strokeLinejoin="round" opacity=".65"><path d="M-7-144q7-3 14 0M-1-146q-4-6-8-4 2 6 8 4ZM2-146q4-6 8-4-2 6-8 4Z"/></g>)}
    {question.options.map((label, index) => {
      const start = point(index * slice - 90 - slice / 2);
      const value = point(index * slice - 90 + slice / 2);
      return <path key={"wedge-" + index} d={"M160 160L" + start.join(" ") + "A134 134 0 " + (slice > 180 ? 1 : 0) + " 1 " + value.join(" ") + "Z"} fill={colors[index % colors.length]} stroke="#000" strokeWidth={selected === index ? 2.8 : 1.1} />;
    })}<circle cx="160" cy="160" r="134" fill="url(#fate-wheel-engraving)" pointerEvents="none"/><circle cx="160" cy="160" r="134" fill="none" stroke="#000" strokeWidth="1.7"/>{question.options.map((label, index) => {
      const angle = (index * slice - 90) * Math.PI / 180;
      const x = 160 + 91 * Math.cos(angle);
      const y = 160 + 91 * Math.sin(angle);
      const lines = wrap(label);
      return <text key={label} x={x} y={y} fill={index % 2 === 0 ? "#000" : "#fff"} textAnchor={"middle"} fontSize={18} fontWeight={700} className={"fate-wheel-label"} style={{
        transform: "rotate(" + -rotation + "deg)",
        transformOrigin: x + "px " + y + "px",
        transitionDuration: duration + "ms"
      }}>{lines.map((line, index2) => <tspan key={index2} x={x} dy={index2 === 0 ? 5 - (lines.length - 1) * 10 : 20}>{line}</tspan>)}</text>;
    })}</svg>;
  return <React.Fragment>{<style>{`
      @font-face{font-family:DynaPuff;src:url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');font-weight:600;font-display:swap}
      html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#eaf2e9;overscroll-behavior:none}
      :root{--font-display:UIBody,system-ui,sans-serif}
      *{box-sizing:border-box}
      .fate-simple{--ink:#123b2e;--ground:#eaf2e9;--hub:#bbd1b0;--font-storybook:Palatino,'Palatino Linotype','Book Antiqua',Georgia,serif;position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;padding:max(30px,env(safe-area-inset-top)) 30px max(50px,env(safe-area-inset-bottom));background-color:var(--ground);background-size:cover;background-position:center;background-repeat:no-repeat;color:var(--ink);font-family:var(--font-display);font-weight:700;overflow:hidden}
      .fate-question{width:100%;max-width:340px;min-height:58px;margin:0;display:grid;place-items:center;font-family:inherit;font-size:25px;font-weight:600;line-height:1.25;text-align:center;text-wrap:balance;overflow-wrap:anywhere}
      .fate-wheel-wrap{position:relative;flex:none;width:min(100%,340px,calc(100svh - 210px));aspect-ratio:1;filter:none}
      .fate-wheel-tap{display:block;position:absolute;inset:0;width:100%;height:100%;min-width:48px;min-height:48px;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;font-family:inherit;color:var(--ink)}
      .fate-wheel-tap:focus-visible{outline:3px solid var(--ink);outline-offset:7px}
      .fate-wheel-tap:active:not(:disabled) .fate-wheel-hub{filter:brightness(.97)}
      .fate-wheel-tap:disabled{cursor:wait;opacity:1}
      .fate-wheel-face{display:block;width:100%;height:100%;overflow:visible;transition:transform 2.2s cubic-bezier(.12,.7,.08,1);transform-origin:center}
      .fate-wheel-label{font-family:var(--font-storybook);transition:transform 2.2s cubic-bezier(.12,.7,.08,1)}
      .fate-wheel-pointer{position:absolute;z-index:2;top:-10px;left:50%;width:26px;height:38px;transform:translateX(-50%);pointer-events:none;overflow:visible}
      .fate-wheel-hub{position:absolute;left:50%;top:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:64px;min-height:64px;width:25%;height:25%;transform:translate(-50%,-50%);border:2px solid #000;border-radius:50%;background:var(--hub);color:#000;box-shadow:none;font-family:var(--font-storybook);font-size:19px;font-weight:700;line-height:1;transition:filter .12s}
      .fate-wheel-hub::before{content:'';position:absolute;inset:5px;border:1px solid #0007;border-radius:50%;pointer-events:none}
      :root .fate-question{font-family:var(--font-storybook);font-weight:700;letter-spacing:.15px}
      .fate-announcement{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.fate-simple.is-complete{gap:0;flex-direction:column;justify-content:center;padding:30px 30px 50px}
.fate-result{width:100%;max-width:370px;max-height:100%;min-height:0;display:flex;flex-direction:column;background:#fff;border:2.5px solid #000;border-radius:16px;box-shadow:none;overflow:hidden;animation:fate-card-print .22s ease-out}
.fate-result-scroll{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:18px 18px 16px;scrollbar-width:thin;scrollbar-color:#1bc65a transparent}
.fate-result-hero{display:flex;align-items:center;gap:14px}
.fate-result-emblem{width:72px;height:72px;flex:none;display:grid;place-items:center;background:#bbd1b0;border:2.5px solid #000;border-radius:50%;box-shadow:none}
.fate-result-emblem img{max-width:calc(100% - 6px);max-height:calc(100% - 6px);object-fit:contain;pointer-events:none}
.fate-result h1{margin:0;font:600 22px/1.17 var(--font-display);text-wrap:balance;overflow-wrap:anywhere}
.fate-result h1:focus{outline:none}
.fate-result-rank{margin:7px 0 0;font-size:12px;line-height:1.3;color:#000}
.fate-result-description{margin:14px 0 12px;font-weight:400;font-size:13px;line-height:1.5;text-wrap:pretty}
.fate-result-traits{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}
.fate-result-traits span{padding:5px 8px;border:1.5px solid #000;border-radius:4px;background:#bbd1b0;font-size:11px;line-height:1.3}
.fate-result-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px 18px;margin:0 0 17px}
.fate-result-stat{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px 3px;min-width:0}
.fate-result-stat dt{display:flex;align-items:center;gap:4px;font-size:11px;line-height:1.3;min-width:0}
.fate-result-stat svg{flex:none}
.fate-result-stat dd{margin:0;font-size:19px;font-variant-numeric:tabular-nums;line-height:1}
.fate-result-stat dd span{font-size:9px;margin-left:1px;color:#000}
.fate-stat-track{grid-column:1/-1;height:7px;border:1.5px solid #000;border-radius:2px;background:#fff;overflow:hidden}
.fate-stat-track span{display:block;height:100%;background:#bbd1b0}
.fate-result-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px 12px;margin:0;padding:16px 0;border-top:1.5px solid #000;border-bottom:1.5px solid #000}
.fate-result-details>div{display:flex;align-items:center;gap:7px;min-width:0}
.fate-result-details svg{flex:none}
.fate-result-details dt{margin:0 0 4px;font-size:10px;color:#000;line-height:1.2}
.fate-result-details dd{margin:0;font-size:12px;line-height:1.35;overflow-wrap:anywhere}
.fate-result-story{margin-top:15px}
.fate-result-story h2{margin:0 0 7px;font-size:14px;font-weight:600;line-height:1.3}
.fate-result-story p{margin:0;font-weight:400;font-size:12px;line-height:1.65;text-wrap:pretty}
.fate-result-footer{flex:none;padding:12px 18px 16px;border-top:1.5px solid #000;background:#fff}
.fate-result-footer button{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;min-height:44px;padding:9px 14px;border:2.5px solid #000;border-radius:6px;background:#000;color:#fff;box-shadow:none;font:700 16px/1.3 var(--font-display);touch-action:manipulation;cursor:pointer}
.fate-result-footer button:active{transform:translate(1px,2px);box-shadow:none}
.fate-result-footer button:focus-visible{outline:3px solid #000;outline-offset:4px}
@keyframes fate-card-print{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
@media(max-width:350px){.fate-result-scroll{padding:15px 14px}.fate-result-emblem{width:60px;height:60px}.fate-result-hero{gap:10px}.fate-result h1{font-size:20px}.fate-result-stats{gap:13px 10px}.fate-result-stat dt{gap:2px;font-size:10px}.fate-result-stat dd{font-size:17px}.fate-result-stat dd span{display:none}}
@media(max-height:520px){.fate-simple.is-complete{padding-top:20px;padding-bottom:30px}}
@media(prefers-reduced-motion:reduce){.fate-result{animation:none}}

      @media (orientation:landscape) and (max-height:500px){.fate-simple{flex-direction:row;gap:24px;padding:30px 30px 50px}.fate-question{width:42%;max-width:280px}.fate-wheel-wrap{width:min(42vw,calc(100svh - 105px),300px)}}
      @media (prefers-reduced-motion:reduce){.fate-wheel-face,.fate-wheel-label{transition-duration:.35s}}
    `}</style>}
    <main className={'fate-simple'+(complete?' is-complete':'')} style={{backgroundImage:`url("${e.BG_MAIN || './assets/fantasy-v1/forest-paper.webp'}")`}}>
      {complete ? <FateResult result={result} onRestart={restart} actionRef={action} headingRef={resultHeading} retryText={e.BTN_RETRY} images={e}/> : <React.Fragment>
        <h1 id="fate-question" className="fate-question">{question.id==='fate'?'What is your fate?':question.question}</h1>
        <div className="fate-wheel-wrap" key={question.id}>
          <svg className="fate-wheel-pointer" viewBox="0 0 26 38" fill="none" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 23 10 13 35 3 10Z" fill="#bbd1b0"/><path d="M13 5v24M6 11h14M9 9l4-4 4 4" strokeWidth=".8"/></svg>
          <button ref={action} type="button" className="fate-wheel-tap" disabled={busy} aria-busy={busy} aria-label={'Spin for an answer: '+question.question} onClick={spin}>
            {wheel}<span className="fate-wheel-hub" aria-hidden="true">{selected!==null&&!busy?'Again':busy?'…':'Spin'}</span>
          </button>
        </div>
      </React.Fragment>}
      <span className="fate-announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    </main>
  </React.Fragment>;
}
function App() {
  let [currentValue, setCurrentValue] = React.useState(null);
  React.useEffect(() => {
    let value = !0;
    fetch("./game.config.json", {
      cache: "no-store"
    }).then(response => response.json()).catch(() => ({})).then(response => {
      if (value) {
        setCurrentValue(ep(response));
      }
    });
    return () => {
      value = !1;
    };
  }, []);
  return currentValue ? <GameIp cfg={currentValue} /> : <div style={{
    width: "100%",
    height: "100%",
    background: "#eaf2e9"
  }} />;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": ".fate-wheel-face",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": ".fate-wheel-face",
      "game": ""
    }
  };
  const selector = script?.getAttribute('data-subject') || '#root canvas';
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let observer;
  let animation;
  let entered = false;
  function stop() {
    animation?.cancel();
    animation = null;
  }
  function enter() {
    if (entered || document.hidden) return;
    const subject = document.querySelector(selector);
    if (!subject || subject.closest('[hidden], [aria-hidden="true"]')) return;
    const computed = window.getComputedStyle(subject);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (subject.tagName === 'IMG' && !subject.complete) {
      subject.addEventListener('load', enter, {
        once: true
      });
      return;
    }
    entered = true;
    observer?.disconnect();
    if (media?.matches) return;
    const opacity = Number(window.getComputedStyle(subject).opacity) || 1;
    if (typeof subject.animate === 'function') {
      animation = subject.animate([{
        opacity: opacity * 0.76
      }, {
        opacity
      }], {
        duration: 650,
        easing: 'ease-out'
      });
      animation.onfinish = () => {
        animation = null;
      };
    }
  }
  observer = new MutationObserver(enter);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  enter();
  document.addEventListener('visibilitychange', () => {
    document.documentElement.toggleAttribute('data-feed-background', document.hidden);
    if (document.hidden) stop();else enter();
  });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    stop();
  });
  window.addEventListener('pageshow', () => {
    if (!entered) observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    enter();
  });
  document.addEventListener('pointerdown', stop, {
    capture: true,
    passive: true
  });
  media?.addEventListener?.('change', () => {
    if (media.matches) stop();
  });
})();

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [];
  const copy = new Set([].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  let queued = false;
  let visible = true;
  const action = /^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
  function scan() {
    queued = false;
    for (const [el, a] of running) if (!el.isConnected) {
      a.cancel();
      running.delete(el);
    }
    if (motion.matches) {
      for (const value of running.values()) value.cancel();
      running.clear();
      return;
    }
    const targets = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(item => targets.add(item));
      } catch {}
    }
    for (const value of document.querySelectorAll('p,span,div,label,text')) {
      if (value.children.length || value.closest('button,a,input,select,textarea,[role="button"]')) continue;
      const text = (value.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value);
    }
    for (const value of targets) {
      if (running.has(value) || typeof value.animate !== 'function') continue;
      if ([...targets].some(child => child !== value && value.contains(child))) continue;
      const style = getComputedStyle(value);
      if (/breath/i.test(style.animationName)) continue;
      const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
      const filter = value3 => (base ? base + ' ' : '') + 'opacity(' + value3 + ')';
      const value2 = value.animate([{
        filter: filter(1)
      }, {
        filter: filter(0.65)
      }, {
        filter: filter(1)
      }], {
        duration: 2400,
        iterations: Infinity,
        easing: 'ease-in-out'
      });
      running.set(value, value2);
      if (document.hidden || !visible) value2.pause();
    }
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  const pause = () => {
    for (const value of running.values()) {
      if (document.hidden || !visible) {
        value.pause();
      } else {
        value.play();
      }
    }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries.some(item => item.isIntersecting);
    pause();
  }) : null;
  if (document.body) intersection?.observe(document.body);else document.addEventListener('DOMContentLoaded', () => intersection?.observe(document.body), {
    once: true
  });
  document.addEventListener('visibilitychange', pause);
  motion.addEventListener?.('change', schedule);
  schedule();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    intersection?.disconnect();
    for (const value of running.values()) value.cancel();
    running.clear();
  }, {
    once: true
  });
})();

// Game helper

/* Batch 3 entry polish. Preview covers are still images in the feed. */
(() => {
  'use strict';

  const number = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "data-batch3-game": "52"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "52"
    }
  }?.dataset.batch3Game);
  const isFeed = new URLSearchParams(location.search).get('feedReview') === '1' && window.parent !== window;
  const root = document.documentElement;
  root.toggleAttribute('data-batch3-preview', isFeed);
  const configurations = {
    12: {
      text: 'Tap to pop the bubbles',
      top: '80px',
      color: '#a2355a',
      action: 'bubble'
    },
    20: {
      text: 'Tap the bug',
      top: '32%',
      color: '#fff',
      action: 'bug'
    },
    27: {
      text: 'Guess their age',
      top: '10.5%',
      color: '#fff',
      action: 'age'
    },
    37: {
      text: 'Tap to add balls',
      top: '24%',
      color: '#fff',
      action: 'add-ball'
    },
    39: {
      text: 'Tap squares to find the animal',
      top: '22%',
      color: '#29202e',
      action: 'cell'
    },
    49: {
      text: 'Guess the hidden code',
      top: '40%',
      color: '#fff',
      action: 'digit'
    },
    60: {
      text: 'Steer into the parking spot',
      top: '34%',
      color: '#fff',
      action: 'drive'
    }
  };
  const previewCSS = {
    8: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    11: 'html[data-batch3-preview] .screen-container div:has(>button.btn-option){transform:translateY(-8vh) scale(.84);transform-origin:center center}',
    13: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    25: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    27: 'html[data-batch3-preview] .age-controls {transform:translateY(-16vh) scale(.9);transform-origin:bottom center}',
    30: 'html[data-batch3-preview] .btn-control {visibility:hidden!important}',
    34: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    37: 'html[data-batch3-preview] #root button {bottom:34%!important}',
    38: 'html[data-batch3-preview] .pendulum-actions {visibility:hidden!important}',
    39: 'html[data-batch3-preview] [aria-label="8 by 8 animal search map"] {transform:scale(.84);transform-origin:center top}',
    43: 'html[data-batch3-preview] .meme-controls {visibility:hidden!important}',
    48: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    49: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    52: 'html[data-batch3-preview] .fate-wheel-wrap {transform:scale(.84)}',
    54: 'html[data-batch3-preview] .control {visibility:hidden!important}',
    56: 'html[data-batch3-preview] .drive-controls {visibility:hidden!important}',
    60: 'html[data-batch3-preview] #root div:has(>div>button[aria-label="Steer left"]) {visibility:hidden!important}',
    73: 'html[data-batch3-preview] #opening .opening-heading p {animation:b3-breathe 2.4s ease-in-out infinite}',
    74: 'html[data-batch3-preview] #photo-controls {visibility:hidden!important}'
  };
  const sharedCSS = `
    .b3-guide{position:fixed;left:30px;right:30px;z-index:120;margin:0;text-align:center;
      font:700 18px/1.3 var(--font-display,system-ui,sans-serif);pointer-events:none;
      text-shadow:0 1px 3px rgba(0,0,0,.25);animation:b3-breathe 2.4s ease-in-out infinite}
    @keyframes b3-breathe{0%,100%{opacity:1}50%{opacity:.68}}
    html[data-b3-hidden] .b3-guide,html[data-b3-hidden] #opening .opening-heading p{animation-play-state:paused!important}
    @media(prefers-reduced-motion:reduce){.b3-guide,html[data-batch3-preview] #opening .opening-heading p{animation:none!important}}
    ${previewCSS[number] || ''}
  `;
  const style = document.createElement('style');
  style.setAttribute('data-batch3-polish', '');
  style.textContent = sharedCSS;
  document.head.append(style);
  let guide;
  let dismissed = false;
  const config = configurations[number];
  function mountGuide() {
    if (!config || guide || dismissed) return;
    guide = document.createElement('p');
    guide.className = 'b3-guide';
    guide.textContent = config.text;
    guide.style.top = config.top;
    guide.style.color = config.color;
    document.body.append(guide);
  }
  function meaningful(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (config?.action === 'bug') return !!target.closest('#root div[tabindex="0"]');
    if (config?.action === 'bubble') {
      if (target.closest('#root div[tabindex="0"],#root canvas')) return true;
      const value = target.closest('button');
      return !!value && /^(Sand Art|Spinner)$/.test(value.textContent.trim());
    }
    if (config?.action === 'age') return !!target.closest('input[type="range"],button.guess');
    const button = target.closest('button');
    if (!button || button.disabled) return false;
    if (config?.action === 'add-ball') return button.textContent.trim() === 'Add Ball';
    if (config?.action === 'cell') return /^Check cell \d+$/.test(button.getAttribute('aria-label') || '');
    if (config?.action === 'digit') return /^\d$/.test(button.textContent.trim());
    if (config?.action === 'drive') return /^(Steer left|Steer right|Drive forward|Reverse)$/.test(button.getAttribute('aria-label') || '');
    return false;
  }
  function dismissOnAction(event) {
    if (root.hasAttribute('data-batch3-preview')) return;
    if (meaningful(event)) {
      dismissed = true;
      guide?.remove();
      guide = null;
    }
  }
  document.addEventListener('pointerdown', dismissOnAction, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') dismissOnAction(event);
  }, true);
  window.addEventListener('message', event => {
    if (!isFeed || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    root.toggleAttribute('data-batch3-preview', event.data.active !== true);
  });
  document.addEventListener('visibilitychange', () => {
    root.toggleAttribute('data-b3-hidden', document.hidden);
  });
  const observer = new MutationObserver(mountGuide);
  const start = () => {
    mountGuide();
    observer.observe(document.getElementById('root') || document.body, {
      childList: true,
      subtree: true
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {
    once: true
  });else start();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
  }, {
    once: true
  });
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n:root .fate-simple{gap:28px}\n:root .fate-question{font-size:24px;line-height:1.3}\n:root .fate-result-scroll{font-family:UIBody,system-ui,sans-serif;padding:20px 18px}\n:root .fate-result h1{font-family:UIBody,system-ui,sans-serif;font-size:24px;line-height:1.25}\n:root .fate-result-rank{font-size:14px;line-height:1.4}\n:root .fate-result-description{font-size:15px;line-height:1.6}\n:root .fate-result-traits span{font-size:12px;line-height:1.4;padding:6px 8px}\n:root .fate-result-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 14px}\n:root .fate-result-stat{grid-template-columns:1fr;gap:8px}\n:root .fate-result-stat dt{font-size:13px;line-height:1.4;gap:6px}\n:root .fate-result-stat dd{font-size:28px;line-height:1.1}\n:root .fate-result-stat dd span{font-size:12px}\n:root .fate-result-details dt{font-size:12px;line-height:1.3}\n:root .fate-result-details dd{font-size:14px;line-height:1.5}\n:root .fate-result-story h2{font-family:UIBody,system-ui,sans-serif;font-size:18px;line-height:1.3}\n:root .fate-result-story p{font-size:14px;line-height:1.7}\n:root .fate-result-footer button{font-family:UIBody,system-ui,sans-serif;font-size:16px}\n@media(max-width:350px){:root .fate-result h1{font-size:22px}:root .fate-result-stat dt{font-size:13px}:root .fate-result-stat dd{font-size:26px}}\n";
  document.head.append(uiStyle);
})();
