document.documentElement.lang = 'it';
// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [
    {
      "id": "TIME_LIMIT",
      "kind": "number",
      "label": "Domande per partita",
      "value": 5,
      "default": 5,
      "min": 4,
      "max": 6,
      "step": 1
    },
    {
      "id": "DECAY_RATE",
      "kind": "number",
      "label": "Variazione del destino",
      "value": 1,
      "default": 1,
      "min": 0.1,
      "max": 5,
      "step": 0.1
    },
    {
      "id": "CLICK_POWER",
      "kind": "number",
      "label": "Bonus di forza iniziale",
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
      "label": "Il tuo destino fantastico",
      "value": "Il tuo destino fantastico",
      "default": "Il tuo destino fantastico",
      "max_length": 30
    },
    {
      "id": "TEXT_WEAK",
      "label": "Fragile",
      "value": "Fragile",
      "default": "Fragile",
      "max_length": 20
    },
    {
      "id": "TEXT_AVERAGE",
      "label": "Nella media",
      "value": "Nella media",
      "default": "Nella media",
      "max_length": 20
    },
    {
      "id": "TEXT_STRONG",
      "label": "Forte",
      "value": "Forte",
      "default": "Forte",
      "max_length": 20
    },
    {
      "id": "TEXT_SUPER",
      "label": "Sovrumano",
      "value": "Sovrumano",
      "default": "Sovrumano",
      "max_length": 20
    },
    {
      "id": "TEXT_ABSURD",
      "label": "Potenza leggendaria",
      "value": "Potenza leggendaria",
      "default": "Potenza leggendaria",
      "max_length": 20
    },
    {
      "id": "BTN_RETRY",
      "label": "Riprova",
      "value": "Riprova",
      "default": "Riprova",
      "max_length": 20
    }
  ],
  "images": [
    {
      "id": "BG_MAIN",
      "label": "Carta illustrata del bosco incantato",
      "path": "./assets/fantasy-v1/forest-paper.webp",
      "replaceable": true
    },
    {
      "id": "IMG_TITLE",
      "label": "Emblema del destino",
      "path": "./assets/destiny_emblem.svg",
      "replaceable": true
    },
    {
      "id": "CREST_SHIELD",
      "label": "Stemma del guardiano",
      "path": "./assets/fantasy-v1/crest-shield.webp",
      "replaceable": true
    },
    {
      "id": "CREST_AXE",
      "label": "Stemma del guerriero",
      "path": "./assets/fantasy-v1/crest-axe.webp",
      "replaceable": true
    },
    {
      "id": "CREST_WAND",
      "label": "Stemma della magia",
      "path": "./assets/fantasy-v1/crest-wand.webp",
      "replaceable": true
    },
    {
      "id": "CREST_MASK",
      "label": "Stemma dell’astuzia",
      "path": "./assets/fantasy-v1/crest-mask.webp",
      "replaceable": true
    },
    {
      "id": "CREST_BOW",
      "label": "Stemma dell’esplorazione",
      "path": "./assets/fantasy-v1/crest-bow.webp",
      "replaceable": true
    },
    {
      "id": "CREST_EYE",
      "label": "Stemma dell’oracolo",
      "path": "./assets/fantasy-v1/crest-eye.webp",
      "replaceable": true
    },
    {
      "id": "CREST_COMPASS",
      "label": "Stemma del viandante",
      "path": "./assets/fantasy-v1/crest-compass.webp",
      "replaceable": true
    },
    {
      "id": "CREST_CROWN",
      "label": "Stemma del sovrano",
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
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1,
    "title": "Il tuo destino fantastico"
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
document.documentElement.lang = 'it';
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
  question: "Qual è la tua stirpe?",
  hint: "Scegli la stirpe della tua storia fantastica.",
  options: ["Human", "Elf", "Orc", "Fairy"],
  weights: [0, 0, 0, 0]
}];
var items2 = [{
  id: "birthplace",
  question: "Dove ha inizio la tua storia?",
  hint: "Il primo luogo che chiami casa.",
  options: ["Quiet village", "Ancient forest", "Royal city", "Under the stars"],
  weights: [1, 2, 2, 3]
}, {
  id: "omen",
  question: "Qual è il primo presagio?",
  hint: "Un segno appare nel cielo.",
  options: ["A comet", "A storm", "Golden dawn", "A whisper"],
  weights: [3, 2, 2, 1]
}, {
  id: "gift",
  question: "Quale dono si risveglia?",
  hint: "Il tuo potere nascosto prende forma.",
  options: ["Courage", "Magic", "Speed", "Wisdom"],
  weights: [3, 3, 2, 2]
}, {
  id: "trial",
  question: "Cosa mette alla prova la tua forza?",
  hint: "Ogni destino ha le sue prove.",
  options: ["A dragon", "A maze", "A rival", "A storm"],
  weights: [3, 2, 2, 3]
}, {
  id: "ally",
  question: "Chi parte con te?",
  hint: "Anche le leggende hanno bisogno di compagnia.",
  options: ["A friend", "A mentor", "A whole team", "No one"],
  weights: [2, 2, 3, 1]
}, {
  id: "relic",
  question: "Quale reliquia scegli?",
  hint: "Scegli cosa portare con te.",
  options: ["A sword", "A shield", "A staff", "A map"],
  weights: [3, 2, 2, 1]
}, {
  id: "protect",
  question: "Cosa proteggerai?",
  hint: "La scelta che ti rappresenta.",
  options: ["Your home", "A stranger", "A secret", "Your dream"],
  weights: [3, 3, 2, 2]
}];
var options = {
  id: "fate",
  question: "Quale destino scegli?",
  hint: "L’ultima pagina spetta a te.",
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
const FATE_ITALIAN_ANSWERS = {
  "Human": "Umano",
  "Elf": "Elfo",
  "Orc": "Orco",
  "Fairy": "Fata",
  "Quiet village": "Villaggio tranquillo",
  "Ancient forest": "Foresta antica",
  "Royal city": "Città reale",
  "Under the stars": "Sotto le stelle",
  "A comet": "Una cometa",
  "A storm": "Una tempesta",
  "Golden dawn": "Alba dorata",
  "A whisper": "Un sussurro",
  "Courage": "Coraggio",
  "Magic": "Magia",
  "Speed": "Velocità",
  "Wisdom": "Saggezza",
  "A dragon": "Un drago",
  "A maze": "Un labirinto",
  "A rival": "Un rivale",
  "A friend": "Un amico",
  "A mentor": "Un mentore",
  "A whole team": "Una squadra",
  "No one": "Nessuno",
  "A sword": "Una spada",
  "A shield": "Uno scudo",
  "A staff": "Un bastone",
  "A map": "Una mappa",
  "Your home": "La tua casa",
  "A stranger": "Uno sconosciuto",
  "A secret": "Un segreto",
  "Your dream": "Il tuo sogno",
  "Guardian": "Guardiano",
  "Explorer": "Esploratore",
  "Sage": "Saggio",
  "Legend": "Leggenda"
};
const fateAnswer = answer => FATE_ITALIAN_ANSWERS[answer] || answer;
const FATE_ARCHETYPES = {
  guardian: {name:'Guardiano dell’alba',icon:'shield',description:'Proteggi le persone che ami, anche davanti al pericolo.',affinity:[.55,0,.1,.35]},
  berserker: {name:'Guerriero della tempesta',icon:'axe',description:'Trasformi le difficoltà in una forza inarrestabile.',affinity:[.8,0,.15,.05]},
  spellweaver: {name:'Tessitore di incanti',icon:'wand',description:'Con un po’ di magia apri porte che nessun altro vede.',affinity:[.1,.7,.05,.15]},
  trickster: {name:'Maestro d’astuzia',icon:'mask',description:'Hai sempre un’altra sorpresa nella manica.',affinity:[.1,.15,.35,.4]},
  ranger: {name:'Esploratore del bosco',icon:'bow',description:'Ti fidi del tuo istinto e trovi la tua strada.',affinity:[.15,.05,.6,.2]},
  oracle: {name:'Oracolo delle stelle',icon:'eye',description:'Sai cogliere i segni che agli altri sfuggono.',affinity:[.05,.5,.05,.4]},
  wanderer: {name:'Viandante del cielo',icon:'compass',description:'La prossima grande avventura ti aspetta oltre l’orizzonte.',affinity:[.1,.1,.35,.45]},
  ruler: {name:'Sovrano dorato',icon:'crown',description:'Unisci le persone e trasformi i progetti in leggende.',affinity:[.4,.15,.05,.4]}
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
  const rank=[config.TEXT_WEAK||'Fragile',config.TEXT_AVERAGE||'Nella media',config.TEXT_STRONG||'Forte',config.TEXT_SUPER||'Sovrumano',config.TEXT_ABSURD||'Potenza leggendaria'][strength<35?0:strength<50?1:strength<65?2:strength<82?3:4];
  const archetypeId=Object.keys(FATE_ARCHETYPES).reduce((best,id)=>{
    const score=key=>scores[key]+FATE_ARCHETYPES[key].affinity.reduce((sum,n,i)=>sum+n*stats[i],0)/1000;
    return score(id)>score(best)?id:best;
  },'guardian');
  const archetype=FATE_ARCHETYPES[archetypeId];
  const giftTraits={Courage:'Senza paura',Magic:'Tocco arcano',Speed:'Passo veloce',Wisdom:'Mente acuta'};
  const trialTraits={'A dragon':'Alla prova del drago','A maze':'Trova la via','A rival':'Pronto alla sfida','A storm':'Tempra di tempesta'};
  const traits=[giftTraits[profile.gift],trialTraits[profile.trial]].filter(Boolean);
  if(traits.length<2)traits.push(profile.ally==='No one'?'Spirito libero':'Voglia d’avventura');
  const origins={'Quiet village':'Un tranquillo villaggio ti ha visto crescere','Ancient forest':'La tua storia nasce in una foresta antica','Royal city':'La tua storia nasce in una città reale','Under the stars':'La tua storia comincia sotto le stelle'};
  const trials={'A dragon':'Hai affrontato un drago','A maze':'Hai trovato la via in un labirinto','A rival':'Hai sfidato un rivale','A storm':'Hai superato una tempesta'};
  const species=(profile.race||'traveler').toLowerCase();
  const lineage={Human:'un essere umano',Elf:'un elfo',Orc:'un orco',Fairy:'una fata'};
  const giftPhrase={Courage:'del coraggio',Magic:'della magia',Speed:'della velocità',Wisdom:'della saggezza'};
  const opening=`${origins[profile.birthplace]||'La tua leggenda comincia qui'}. Sei ${lineage[profile.race]||'un viaggiatore'}${profile.gift?', con il dono '+giftPhrase[profile.gift]:''}.`;
  const companion={'No one':' in solitaria','A friend':' con un amico al tuo fianco','A mentor':' con un mentore al tuo fianco','A whole team':' insieme a una squadra'}[profile.ally]||'';
  const relic=profile.relic?', portando '+fateAnswer(profile.relic).toLowerCase():'';
  const purposes={'Your home':'la tua casa','A stranger':'uno sconosciuto','A secret':'un segreto','Your dream':'il tuo sogno'};
  const purpose=profile.protect?' per proteggere '+purposes[profile.protect]:'';
  const journey=profile.trial?`${trials[profile.trial]}${companion}${relic}${purpose}.`:`Il tuo viaggio ti porterà verso ${profile.fate==='Sage'?'la saggezza':profile.fate==='Guardian'?'il coraggio':'nuove scoperte'}${companion}${relic}.`;
  const details=[
    {label:'Stirpe',value:fateAnswer(profile.race),icon:species},
    {label:'Origini',value:fateAnswer(profile.birthplace),icon:'home'},
    {label:'Compagnia',value:profile.ally==='No one'?'In solitaria':fateAnswer(profile.ally),icon:'companion'},
    {label:'Reliquia',value:fateAnswer(profile.relic),icon:({'A sword':'sword','A shield':'shield','A staff':'wand','A map':'map'})[profile.relic]}
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

function loadFateArtwork(path){
  return new Promise(resolve=>{
    const image=new Image();let finished=false;
    const done=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>done(null),4000);
    image.onload=()=>done(image);image.onerror=()=>done(null);
    try{if(new URL(path,location.href).origin!==location.origin)image.crossOrigin='anonymous';}catch(_){}
    image.src=path;
  });
}
function drawFatePaper(ctx,width,height){
  ctx.fillStyle='#fbf7e9';ctx.fillRect(0,0,width,height);
  const wash=ctx.createLinearGradient(0,0,width,height);wash.addColorStop(0,'#edf2e580');wash.addColorStop(1,'#fbf7e900');ctx.fillStyle=wash;ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#45634d0b';for(let y=14;y<height;y+=14)for(let x=14;x<width;x+=14){ctx.beginPath();ctx.arc(x,y,.65,0,Math.PI*2);ctx.fill();}
  ctx.strokeStyle='#45634d55';ctx.lineWidth=1;ctx.strokeRect(26,26,width-52,height-52);
  // Small printed leaves stay in the outer margin, never under live content.
  for(const [x,y,turn] of [[38,38,0],[width-38,height-38,Math.PI]]){
    ctx.save();ctx.translate(x,y);ctx.rotate(turn);ctx.strokeStyle='#6b856a88';ctx.fillStyle='#bdcfb555';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(10,10,12,31);ctx.stroke();
    for(const [a,b,angle] of [[3,8,-.7],[9,15,.6],[11,25,-.7]]){ctx.save();ctx.translate(a,b);ctx.rotate(angle);ctx.beginPath();ctx.ellipse(0,0,3,7,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}
    ctx.restore();
  }
}
async function renderFateCard(result,images){
  await document.fonts?.ready;
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1800;
  const ctx=canvas.getContext('2d');const ink='#253b2b',green='#45634d';
  // Keep text on a transparent layer until the final certificate height is known.
  function caption(copy,y,size=18){ctx.font=`600 ${size}px UIBody,Arial`;ctx.textAlign='center';ctx.fillStyle=green;ctx.fillText(copy,360,y);}
  function paragraph(copy,y,font='26px UIBody,Arial',lineHeight=37,width=580){
    ctx.font=font;ctx.fillStyle=ink;ctx.textAlign='center';const lines=[];let line='';
    for(const word of String(copy).split(/\s+/)){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>width){lines.push(line);line=word;}else line=next;}
    if(line)lines.push(line);for(const value of lines){ctx.fillText(value,360,y);y+=lineHeight;}return y;
  }
  caption('L’ARCHIVIO DEL BOSCO',76,17);ctx.strokeStyle='#45634d66';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(72,96);ctx.lineTo(648,96);ctx.stroke();
  const art=FATE_CRESTS[result.archetype.icon];let crest=null;
  if(art)crest=await loadFateArtwork(images[art.id]||art.path);
  ctx.fillStyle='#e2e9d8';ctx.beginPath();ctx.arc(360,195,69,0,Math.PI*2);ctx.fill();ctx.strokeStyle=green;ctx.lineWidth=1.5;ctx.stroke();
  if(crest)ctx.drawImage(crest,300,135,120,120);
  else{ctx.fillStyle=green;ctx.font='bold 64px Georgia';ctx.textAlign='center';ctx.fillText(result.fate[0],360,218);}
  let y=paragraph(result.fate,315,'bold 48px Georgia',56);caption(result.rank,y+7,20);y+=58;
  y=paragraph(result.archetype.description,y,'25px UIBody,Arial',36);y+=12;
  if(result.traits.length){caption(result.traits.join('  ·  '),y,18);y+=42;}
  const labels=['Forza','Magia','Agilità','Fortuna'];
  for(let i=0;i<4;i++){
    const x=72+(i%2)*308,sy=y+Math.floor(i/2)*104;
    ctx.textAlign='left';ctx.fillStyle=green;ctx.font='19px UIBody,Arial';ctx.fillText(labels[i],x,sy);
    ctx.textAlign='right';ctx.fillStyle=ink;ctx.font='bold 33px Georgia';ctx.fillText(String(result.stats[i]),x+268,sy+2);
    ctx.fillStyle='#dce4d4';ctx.fillRect(x,sy+22,268,8);ctx.fillStyle=green;ctx.fillRect(x,sy+22,268*result.stats[i]/99,8);
  }
  y+=220;
  ctx.strokeStyle='#45634d55';ctx.beginPath();ctx.moveTo(72,y-28);ctx.lineTo(648,y-28);ctx.stroke();
  for(let i=0;i<result.details.length;i++){
    const detail=result.details[i],x=72+(i%2)*308,sy=y+Math.floor(i/2)*76;
    ctx.textAlign='left';ctx.fillStyle=green;ctx.font='16px UIBody,Arial';ctx.fillText(detail.label.toUpperCase(),x,sy);
    ctx.fillStyle=ink;ctx.font='bold 23px Georgia';ctx.fillText(detail.value,x,sy+31,268);
  }
  y+=Math.ceil(result.details.length/2)*76+22;
  caption('LA TUA STORIA',y,17);y+=39;y=paragraph(result.story,y,'24px Georgia',35);y+=32;
  ctx.strokeStyle='#45634d55';ctx.beginPath();ctx.moveTo(72,y);ctx.lineTo(648,y);ctx.stroke();caption('Un pizzico di destino. Una storia tutta tua.',y+35,16);y+=80;
  const output=document.createElement('canvas');output.width=720;output.height=Math.ceil(y);const out=output.getContext('2d');
  drawFatePaper(out,output.width,output.height);
  out.drawImage(canvas,0,0);
  return output;
}
function FateResult({result,onRestart,actionRef,headingRef,retryText,images}) {
  const labels=['Forza','Magia','Agilità','Fortuna'],icons=['sword','wand','agility','luck'];
  const [saving,setSaving]=React.useState(false),[saveMessage,setSaveMessage]=React.useState('');
  const saveRef=React.useRef({request:0,timer:null});
  React.useEffect(()=>()=>{saveRef.current.request++;clearTimeout(saveRef.current.timer);},[]);
  const save=async()=>{
    if(saving)return;const request=++saveRef.current.request;let settled=false;setSaving(true);setSaveMessage('Preparazione della scheda…');
    const done=message=>{if(settled||request!==saveRef.current.request)return;settled=true;clearTimeout(saveRef.current.timer);setSaving(false);setSaveMessage(message);};
    try{
      const card=await renderFateCard(result,images);if(request!==saveRef.current.request)return;
      const dataURL=card.toDataURL('image/png'),filename='my-fairytale-'+result.archetypeId;
      if(typeof window.tt?.saveDataURL==='function'){
        saveRef.current.timer=setTimeout(()=>done('Salvataggio non confermato. Riprova.'),15000);
        window.tt.saveDataURL({dataURL,filename,extension:'png',saveToAlbum:'image',success(){done('Scheda salvata nelle foto.');},fail(){done('Salvataggio non riuscito. Controlla l’accesso alle foto e riprova.');},complete(){if(!settled)done('Salvataggio non confermato. Riprova.');}});
      }else{
        const link=document.createElement('a');link.href=dataURL;link.download=filename+'.png';link.hidden=true;document.body.append(link);link.click();link.remove();done('Download avviato.');
      }
    }catch(_){done('Impossibile salvare la scheda. Riprova.');}
  };
  return <section className="fate-result" aria-labelledby="fate-result-title"> 
    <div className="fate-result-overview">
      <div className="fate-result-edition">L’ARCHIVIO DEL BOSCO</div>
      <header className="fate-result-hero">
        <div className="fate-result-emblem"><FateIcon name={result.archetype.icon} size={50} crest images={images}/></div>
        <div><h1 id="fate-result-title" ref={headingRef} tabIndex={-1}>{result.fate}</h1><p className="fate-result-rank">{result.rank}</p></div>
      </header>
      <p className="fate-result-description">{result.archetype.description}</p>
      <div className="fate-result-traits" aria-label="Tratti distintivi">{result.traits.map(trait=><span key={trait}>{trait}</span>)}</div>
    </div>
    <dl className="fate-result-stats">{labels.map((label,index)=><div key={label} className="fate-result-stat">
        <dt><FateIcon name={icons[index]} size={20}/><span>{label}</span></dt><dd>{result.stats[index]}<span>/99</span></dd>
        <div className="fate-stat-track" aria-hidden="true"><span style={{width:result.stats[index]/99*100+'%'}}/></div>
      </div>)}</dl>
    <div className="fate-result-scroll" tabIndex={0} aria-label="Dettagli e storia del personaggio">
      <dl className="fate-result-details">{result.details.map(detail=><div key={detail.label}>
        <FateIcon name={detail.icon} size={28}/><div><dt>{detail.label}</dt><dd>{detail.value}</dd></div>
      </div>)}</dl>
      <div className="fate-result-story"><h2>La tua storia</h2><p>{result.story}</p></div>
    </div>
    <footer className="fate-result-footer">
      <button ref={actionRef} type="button" className="fate-save" onClick={save} disabled={saving} aria-busy={saving}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg><span>{saving?'Salvataggio…':'Salva scheda'}</span></button>
      <button type="button" className="fate-retry" onClick={onRestart}><FateIcon name="refresh" size={18}/><span>{retryText||'Riprova'}</span></button>
      <p className="fate-save-status" role="status" aria-live="polite">{saveMessage}</p>
    </footer>
  </section>;
}

function GameIp({
  cfg: e
}) {
  const createElement = React.createElement;
  React.useEffect(() => {
    Object.values(FATE_CRESTS).forEach(artwork=>{const image=new Image();image.src=e[artwork.id]||artwork.path;});
  }, [e]);
  const count = Pc(Math.round(Number(e.TIME_LIMIT) || 5), 4, 6);
  const questions = React.useMemo(() => [...items, ...['gift','ally','relic','trial'].slice(0,count-2).map(id=>items2.find(item=>item.id===id)), options], [count]);
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
  const duration = reduced ? 300 : 1450;
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
    setAnnouncement("La ruota sta scegliendo una risposta.");
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
      setAnnouncement(fateAnswer(answer));
      later(() => {
        const next = [...answers.slice(0, step), chosen];
        setAnswers(next);
        setBusy(false);
        stateRef.current.locked = false;
        if (step + 1 >= questions.length) {
          setComplete(true);
          const fate = op(questions, next, e);
          setAnnouncement(fate.fate + ". " + fate.rank + ", " + fate.strength + " su 99. La scheda del tuo personaggio è pronta.");
          sound("result");
        } else {
          setStep(step + 1);
          setRotation(0);
          setSelected(null);
        }
      }, reduced ? 140 : 300);
    }, duration);
  };
  const slice = 360 / question.options.length;
  const point = angle => {
    const radians = angle * Math.PI / 180;
    return [160 + 134 * Math.cos(radians), 160 + 134 * Math.sin(radians)];
  };
  const wrap = label => {
    const words = fateAnswer(label).split(" ");
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
      .fate-round{position:absolute;top:max(30px,env(safe-area-inset-top));left:30px;right:30px;text-align:center;font:500 13px/1.4 UIBody,Arial;color:#45634d}.fate-question{width:100%;max-width:340px;min-height:58px;margin:0;display:grid;place-items:center;font-family:inherit;font-size:25px;font-weight:600;line-height:1.25;text-align:center;text-wrap:balance;overflow-wrap:anywhere}
      .fate-wheel-wrap{position:relative;flex:none;width:min(100%,340px,calc(100svh - 210px));aspect-ratio:1;filter:none}
      .fate-wheel-tap{display:block;position:absolute;inset:0;width:100%;height:100%;min-width:48px;min-height:48px;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;font-family:inherit;color:var(--ink)}
      .fate-wheel-tap:focus-visible{outline:3px solid var(--ink);outline-offset:7px}
      .fate-wheel-tap:active:not(:disabled) .fate-wheel-hub{filter:brightness(.97)}
      .fate-wheel-tap:disabled{cursor:wait;opacity:1}
      .fate-wheel-face{display:block;width:100%;height:100%;overflow:visible;transition:transform 1.45s cubic-bezier(.12,.7,.08,1);transform-origin:center}
      .fate-wheel-label{font-family:var(--font-storybook);transition:transform 1.45s cubic-bezier(.12,.7,.08,1)}
      .fate-wheel-pointer{position:absolute;z-index:2;top:-10px;left:50%;width:26px;height:38px;transform:translateX(-50%);pointer-events:none;overflow:visible}
      .fate-wheel-hub{position:absolute;left:50%;top:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:64px;min-height:64px;width:25%;height:25%;transform:translate(-50%,-50%);border:2px solid #000;border-radius:50%;background:var(--hub);color:#000;box-shadow:none;font-family:var(--font-storybook);font-size:19px;font-weight:700;line-height:1;transition:filter .12s}
      .fate-wheel-hub::before{content:'';position:absolute;inset:5px;border:1px solid #0007;border-radius:50%;pointer-events:none}
      :root .fate-question{font-family:var(--font-storybook);font-weight:700;letter-spacing:.15px}
      .fate-announcement{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
#root .fate-simple.is-complete{gap:0;flex-direction:column;justify-content:center;padding:30px 30px 50px}
#root .fate-result{position:relative;isolation:isolate;width:100%;max-width:370px;max-height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid #45634d88;border-radius:10px;background:radial-gradient(#45634d0c .6px,transparent .8px) 0 0/8px 8px,linear-gradient(130deg,#fbf8ec,#f0f3e6);color:#253b2b;box-shadow:0 5px 20px #142b291c;animation:fate-card-print .2s ease-out}
#root .fate-result-overview{flex:none;padding:14px 16px 10px}
#root .fate-result-edition{margin:0 0 8px;font:600 9px/1.3 UIBody,Arial;letter-spacing:1.8px;color:#567055}
#root .fate-result-hero{display:grid;grid-template-columns:56px minmax(0,1fr);align-items:center;gap:12px;padding:0;text-align:left}
#root .fate-result-emblem{width:56px;height:56px;display:grid;place-items:center;border:1px solid #45634d66;border-radius:50%;background:#e1e9d7;margin:0;outline:none;box-shadow:none}
#root .fate-result-emblem img{display:block;width:50px;height:50px;max-width:50px;max-height:50px;object-fit:contain;pointer-events:none}
#root .fate-result h1{margin:0;font:700 22px/1.12 Palatino,'Palatino Linotype',Georgia,serif;color:#253b2b;letter-spacing:-.2px;text-wrap:balance;overflow-wrap:anywhere}
#root .fate-result h1:focus{outline:none}
#root .fate-result-rank{margin:5px 0 0;font:500 12px/1.3 UIBody,Arial;color:#567055;letter-spacing:.1px}
#root .fate-result-description{margin:9px 0 7px;font:400 12px/1.45 UIBody,Arial;text-wrap:pretty;text-align:left}
#root .fate-result-traits{display:flex;flex-wrap:wrap;gap:5px;margin:0}
#root .fate-result-traits span{border:1px solid #45634d33;border-radius:4px;background:#e6ecdd;padding:3px 7px;font:500 10px/1.3 UIBody,Arial;color:#36563e}
#root .fate-result-stats{flex:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 8px;margin:0 16px 10px}
#root .fate-result-stat{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:5px 4px;padding:7px 8px;border:1px solid #45634d22;border-radius:5px;background:#edf1e5;min-width:0}
#root .fate-result-stat dt{display:flex;align-items:center;gap:4px;min-width:0;font:500 11px/1.3 UIBody,Arial;color:#45634d}
#root .fate-result-stat svg{width:16px;height:16px;flex:none}
#root .fate-result-stat dd{margin:0;font:700 22px/1 Palatino,Georgia,serif;font-variant-numeric:tabular-nums;white-space:nowrap}
#root .fate-result-stat dd span{margin-left:1px;font:400 9px/1 UIBody,Arial;color:#6a785f}
#root .fate-stat-track{grid-column:1/-1;height:4px;border:0;border-radius:2px;background:#d8e1d0;overflow:hidden}
#root .fate-stat-track span{display:block;height:100%;background:#567958}
#root .fate-result-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:10px 16px 12px;border-top:1px solid #45634d33;background:transparent;scrollbar-width:thin;scrollbar-color:#789075 transparent}
#root .fate-result-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;margin:0;padding:0 0 10px;border:0;border-bottom:1px solid #45634d22}
#root .fate-result-details>div{display:flex;align-items:center;gap:6px;min-width:0}
#root .fate-result-details svg{width:23px;height:23px;flex:none}
#root .fate-result-details dt{margin:0 0 3px;font:500 10px/1.3 UIBody,Arial;color:#6a785f}
#root .fate-result-details dd{margin:0;font:700 12px/1.35 Palatino,Georgia,serif;overflow-wrap:anywhere}
#root .fate-result-story{margin:10px 0 0}
#root .fate-result-story h2{margin:0 0 5px;font:700 15px/1.3 Palatino,Georgia,serif}
#root .fate-result-story p{margin:0;font:400 12px/1.5 UIBody,Arial;text-wrap:pretty}
#root .fate-result-footer{position:relative;flex:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:11px 16px 12px;border-top:1px solid #45634d33;background:#f6f7eb}
#root .fate-result-footer button{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;min-width:0;min-height:44px;margin:0;padding:9px 7px;border:1px solid #45634d66;border-radius:5px;box-shadow:none;font:600 14px/1.3 UIBody,Arial;white-space:normal;touch-action:manipulation;cursor:pointer}
#root .fate-result-footer .fate-save{background:#36563e;color:#fbf7e9;border-color:#36563e}
#root .fate-result-footer .fate-retry{background:#edf1e3;color:#36563e}
#root .fate-result-footer button svg{flex:none;width:17px;height:17px}
#root .fate-result-footer button:focus-visible{outline:3px solid #45634d;outline-offset:2px}
#root .fate-result-footer button:active{transform:translateY(1px)}
#root .fate-save-status{grid-column:1/-1;min-height:0;margin:0;text-align:center;font:400 11px/1.35 UIBody,Arial;color:#45634d}
#root .fate-save-status:empty{display:none}
@keyframes fate-card-print{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@media(max-width:350px){#root .fate-result-overview{padding:12px 13px 9px}#root .fate-result h1{font-size:21px}#root .fate-result-stats{margin-left:13px;margin-right:13px}#root .fate-result-stat{padding:7px 6px}#root .fate-result-stat dt{font-size:10px}#root .fate-result-stat dd{font-size:21px}#root .fate-result-stat dd span{display:none}#root .fate-result-scroll{padding-left:13px;padding-right:13px}#root .fate-result-footer{padding-left:13px;padding-right:13px}}
@media(prefers-reduced-motion:reduce){#root .fate-result{animation:none}}

      @media (orientation:landscape) and (max-height:500px){.fate-simple{flex-direction:row;gap:24px;padding:30px 30px 50px}.fate-question{width:42%;max-width:280px}.fate-wheel-wrap{width:min(42vw,calc(100svh - 105px),300px)}}
      @media (prefers-reduced-motion:reduce){.fate-wheel-face,.fate-wheel-label{transition-duration:.35s}}
    `}</style>}
    <main className={'fate-simple'+(complete?' is-complete':'')} style={{backgroundImage:`url("${e.BG_MAIN || './assets/fantasy-v1/forest-paper.webp'}")`}}>
      {complete ? <FateResult result={result} onRestart={restart} actionRef={action} headingRef={resultHeading} retryText={e.BTN_RETRY} images={e}/> : <React.Fragment>
        <div className="fate-round" aria-label="Avanzamento delle domande">{step+1} / {questions.length}</div><h1 id="fate-question" className="fate-question">{question.id==='fate'?'Qual è il tuo destino?':question.question}</h1>
        <div className="fate-wheel-wrap" key={question.id}>
          <svg className="fate-wheel-pointer" viewBox="0 0 26 38" fill="none" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 23 10 13 35 3 10Z" fill="#bbd1b0"/><path d="M13 5v24M6 11h14M9 9l4-4 4 4" strokeWidth=".8"/></svg>
          <button ref={action} type="button" className="fate-wheel-tap" disabled={busy} aria-busy={busy} aria-label={'Gira per una risposta: '+question.question} onClick={spin}>
            {wheel}<span className="fate-wheel-hub" aria-hidden="true">{selected!==null&&!busy?'Ancora':busy?'…':'Gira'}</span>
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
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n:root .fate-simple{gap:28px}\n:root .fate-question{font-size:24px;line-height:1.3}\n";
  document.head.append(uiStyle);
})();


/*
Bundled font/asset license notices (source-only; runtime TXT files omitted).

Files: fonts/dynapuff/OFL.txt
Copyright 2021 The DynaPuff Project Authors (https://github.com/googlefonts/dynapuff)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.


*/
