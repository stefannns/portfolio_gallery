// Original Catch the Beat game code, combined into one editable source.
// A local, user-controlled crop replaces the unsupported photo worker.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
const GAME_STYLES = "@font-face{font-family:BeatPoppins;src:url('assets/fonts/Poppins-Regular.woff2') format('woff2');font-weight:400;font-display:swap}\n@font-face{font-family:BeatPoppins;src:url('assets/fonts/Poppins-Bold.woff2') format('woff2');font-weight:700;font-display:swap}\n:root{font-family:BeatPoppins,system-ui,sans-serif;color:#222430;background:#f5b3af;font-synthesis:none;--ink:#222430;--paper:#fffaf5;--accent:#ffa095;--u:1px}\n*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{overscroll-behavior:none}\nbutton,input{font:inherit}button{color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}button:focus-visible,input:focus-visible{outline:3px solid #222430;outline-offset:4px}button:disabled{cursor:wait;opacity:.55}[hidden]{display:none!important}\n#game{position:relative;width:100%;height:100%;height:100dvh;isolation:isolate;overflow:hidden;touch-action:none;user-select:none;background:#f5b3af}\n#stage{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}\n#dance{position:absolute;inset:0;border:0;background:none;z-index:1;outline-offset:-8px}\n#guide{position:absolute;top:calc(72% - 13px);left:calc(30 * var(--u));right:calc(30 * var(--u));margin:0;text-align:center;font-size:calc(18 * var(--u));font-weight:700;line-height:1.5;pointer-events:none;z-index:2;animation:guide-float 2.4s ease-in-out infinite;text-wrap:balance}\n#photo-controls{position:absolute;bottom:max(calc(50 * var(--u)),env(safe-area-inset-bottom));left:calc(30 * var(--u));right:calc(30 * var(--u));display:flex;align-items:center;justify-content:center;gap:10px;z-index:3}\nhtml[data-feed-preview=\"true\"] #guide,html[data-feed-preview=\"true\"] #photo-controls{visibility:hidden}\n#photo-button,#default-button{min-height:44px;border-radius:100px;border:1.5px solid #22243026;background:#fffaf5da;padding:10px 16px;display:inline-flex;gap:8px;align-items:center;justify-content:center;font-size:calc(14 * var(--u));font-weight:700;transition:background .15s,box-shadow .15s}\n#photo-button:active,#default-button:active{background:#fffaf5;box-shadow:0 0 0 3px #22243010}svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}\n#result{position:absolute;left:calc(30 * var(--u));right:calc(30 * var(--u));bottom:calc(118 * var(--u));text-align:center;z-index:4;pointer-events:none}\n#result-score{font-size:calc(54 * var(--u));font-weight:700;margin:0;line-height:1.15;letter-spacing:-.06em}\n#result-label{display:block;width:min(100%,calc(240 * var(--u)));height:calc(65 * var(--u));object-fit:contain;margin:calc(12 * var(--u)) auto}\n#retry,#resume,#apply-photo{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:48px;border:0;border-radius:100px;background:var(--ink);color:var(--paper);padding:12px 24px;font-size:16px;font-weight:700;transition:opacity .15s}\n#retry:active,#resume:active,#apply-photo:active{opacity:.8}\n#pause{position:absolute;inset:0;display:grid;place-items:center;background:#f5b3af88;backdrop-filter:blur(6px);z-index:5}\n#notice{position:absolute;left:24px;right:24px;top:calc(30 * var(--u));text-align:center;background:#fffaf5ee;border-radius:18px;padding:12px 16px;font-size:14px;margin:0;z-index:8;pointer-events:none}\n.modal{position:absolute;inset:0;z-index:10;background:#22243080;display:flex;align-items:center;justify-content:center;padding:24px;touch-action:pan-y;user-select:auto}\n.editor-sheet{width:min(100%,340px);max-height:calc(100% - 16px);overflow:auto;background:var(--paper);border-radius:28px;padding:20px;box-shadow:0 18px 60px #22243026;text-align:center}\n.editor-sheet header{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px}\n.editor-sheet h1{font-size:19px;line-height:1.4;margin:0;text-align:left;font-weight:700}.icon-button{width:44px;height:44px;display:grid;place-items:center;background:none;border:0;border-radius:100%}\n#photo-preview{height:min(28dvh,200px);min-height:100px;display:flex;align-items:center;justify-content:center;border-radius:18px;background-color:#f2ebe4;background-image:linear-gradient(45deg,#e8dfd5 25%,transparent 25%),linear-gradient(-45deg,#e8dfd5 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e8dfd5 75%),linear-gradient(-45deg,transparent 75%,#e8dfd5 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}\n#photo-crop{display:block;width:auto;height:92%;max-width:92%;touch-action:none;cursor:grab;filter:drop-shadow(0 4px 3px #22243015)}\n#photo-crop:active{cursor:grabbing}#photo-crop:focus-visible{outline:3px solid #523e3a;outline-offset:3px}\n#photo-status{font-size:14px;line-height:1.5;margin:14px 0;min-height:21px}\n#photo-options{margin:10px 0 14px}#photo-options label{font-size:13px;display:flex;gap:12px;align-items:center;white-space:nowrap}#photo-options label+label{margin-top:4px}#photo-options input{width:100%;min-width:0;accent-color:#222430;min-height:32px}\n#apply-photo{width:100%}.privacy{font-size:11px;line-height:1.5;color:#625b58;margin:12px 0 0}\n@keyframes guide-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}\n@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}\n@media(max-height:450px){#photo-controls{bottom:16px}#guide{top:73%}#result{top:48%}#result-score{font-size:36px}#result-label{height:34px;margin:6px auto}.editor-sheet{padding:12px}#photo-preview{height:90px}.privacy{margin:5px 0}}\n\n/* User override 2026-10-21: favor visual center, not a fixed upper band. */\nhtml:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p#guide{position:fixed!important;top:15%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}\n";
const style = document.createElement('style'); style.textContent = GAME_STYLES; document.head.append(style);
function mountGame() {
// scene-data.js
window.CATCH_BEAT_SCENE = {
  "basis": {
    "width": 720,
    "height": 1280,
    "yAxis": "up",
    "origin": "center"
  },
  "settings": {
    "autoDuration": true,
    "gameDuration": 14.471,
    "difficulty": 4,
    "characterCount": 7,
    "beat": 0.428,
    "holdBeats": 2,
    "scoreBeats": 2,
    "bgIdleBrightness": 0.41,
    "bgRecordBrightness": 1,
    "bgFadeTime": 0.84,
    "danceStateCount": 3,
    "headSize": 1.2,
    "headSegXOffset": 0,
    "headSegYOffset": 0,
    "idleHeadX": 0,
    "idleHeadRotation": 0,
    "s2HeadX": 25,
    "s2HeadRotation": 3.7,
    "s3HeadX": -40,
    "s3HeadRotation": -13,
    "s4HeadX": 18,
    "s4HeadRotation": 5.4,
    "endHeadX": 0,
    "endHeadRotation": 0
  },
  "frames": {
    "intro": [
      "assets/Textures/Char_intro/char_intro_0-compressed.png",
      "assets/Textures/Char_intro/char_intro_1-compressed.png",
      "assets/Textures/Char_intro/char_intro_2-compressed.png",
      "assets/Textures/Char_intro/char_intro_3-compressed.png",
      "assets/Textures/Char_intro/char_intro_4-compressed.png",
      "assets/Textures/Char_intro/char_intro_5-compressed.png",
      "assets/Textures/Char_intro/char_intro_6-compressed.png",
      "assets/Textures/Char_intro/char_intro_7-compressed.png"
    ],
    "s1": [
      "assets/Textures/char_s1/char_s1_0-compressed.png",
      "assets/Textures/char_s1/char_s1_1-compressed.png",
      "assets/Textures/char_s1/char_s1_2-compressed.png",
      "assets/Textures/char_s1/char_s1_3-compressed.png",
      "assets/Textures/char_s1/char_s1_4-compressed.png",
      "assets/Textures/char_s1/char_s1_5-compressed.png",
      "assets/Textures/char_s1/char_s1_6-compressed.png",
      "assets/Textures/char_s1/char_s1_7-compressed.png"
    ],
    "s2": [
      "assets/Textures/Char_s2/char_s2_0-compressed.png",
      "assets/Textures/Char_s2/char_s2_1-compressed.png",
      "assets/Textures/Char_s2/char_s2_2-compressed.png",
      "assets/Textures/Char_s2/char_s2_3-compressed.png",
      "assets/Textures/Char_s2/char_s2_4-compressed.png",
      "assets/Textures/Char_s2/char_s2_5-compressed.png",
      "assets/Textures/Char_s2/char_s2_6-compressed.png",
      "assets/Textures/Char_s2/char_s2_7-compressed.png"
    ],
    "s3": [
      "assets/Textures/Char_s3/char_s3_0-compressed.png",
      "assets/Textures/Char_s3/char_s3_1-compressed.png",
      "assets/Textures/Char_s3/char_s3_2-compressed.png",
      "assets/Textures/Char_s3/char_s3_3-compressed.png",
      "assets/Textures/Char_s3/char_s3_4-compressed.png",
      "assets/Textures/Char_s3/char_s3_5-compressed.png",
      "assets/Textures/Char_s3/char_s3_6-compressed.png",
      "assets/Textures/Char_s3/char_s3_7-compressed.png"
    ],
    "end": [
      "assets/Textures/Char_end/char_end_0-compressed.png",
      "assets/Textures/Char_end/char_end_1-compressed.png",
      "assets/Textures/Char_end/char_end_2-compressed.png",
      "assets/Textures/Char_end/char_end_3-compressed.png",
      "assets/Textures/Char_end/char_end_4-compressed.png",
      "assets/Textures/Char_end/char_end_5-compressed.png",
      "assets/Textures/Char_end/char_end_6-compressed.png",
      "assets/Textures/Char_end/char_end_7-compressed.png"
    ]
  },
  "textures": {
    "introTex": "assets/Textures/TEXT/Text_Intro.png",
    "perfectTex": "assets/Textures/TEXT/Text_Perfect.png",
    "closeTex": "assets/Textures/TEXT/Text_Close.png",
    "missTex": "assets/Textures/TEXT/Text_Miss.png",
    "circle1Tex": "assets/Textures/UI/UI_circle1.png",
    "circle2Tex": "assets/Textures/UI/UI_circle2.png",
    "circleCenterTex": "assets/Textures/UI/UI_Circle_Center.png",
    "hitRingTex": "assets/Textures/UI/UI_hitRing_01.png",
    "uiLineTex": "assets/Textures/UI/UI_Line.png",
    "endText1Tex": "assets/Textures/TEXT/Text_OnBeat.png",
    "resultTopTex": "assets/Textures/TEXT/Text_YouAreIn.png",
    "resultGoodTex": "assets/Textures/TEXT/Text_CallBack.png",
    "resultMidTex": "assets/Textures/TEXT/Text_KeepPracticing.png",
    "resultLowTex": "assets/Textures/TEXT/Text_Next.png",
    "tryAgainTex": "assets/Textures/UI/UI_PlayAgain.png",
    "background": "assets/Textures/BG_color.png",
    "stage": "assets/Textures/BG1.png",
    "head": "assets/User Media Textures/UI_Head.png"
  },
  "audio": {
    "intro": "assets/Audio/IntroSound.mp3",
    "play": "assets/Audio/PlaySound.mp3"
  },
  "characters": [
    {
      "name": "char 0",
      "position": {
        "x": 0.01000214,
        "y": 107.587
      },
      "size": {
        "x": 250.34,
        "y": 391.2721
      },
      "pivot": {
        "x": 0.4820226,
        "y": 0.6193115
      },
      "scale": {
        "x": 1,
        "y": 1,
        "z": 1
      },
      "parent": 24
    },
    {
      "name": "char 1",
      "position": {
        "x": -159.6995,
        "y": 121.6736
      },
      "size": {
        "x": 180,
        "y": 281.3333
      },
      "pivot": {
        "x": 0.46,
        "y": 0.722
      },
      "scale": {
        "x": 1,
        "y": 1,
        "z": 1
      },
      "parent": 24
    },
    {
      "name": "char 2",
      "position": {
        "x": 152.1992,
        "y": 121.6736
      },
      "size": {
        "x": 180,
        "y": 281.3333
      },
      "pivot": {
        "x": 0.46,
        "y": 0.722
      },
      "scale": {
        "x": 1,
        "y": 1,
        "z": 1
      },
      "parent": 24
    },
    {
      "name": "char 3",
      "position": {
        "x": 253.852,
        "y": 256.6736
      },
      "size": {
        "x": 170,
        "y": 265.7037
      },
      "pivot": {
        "x": 0.46,
        "y": 0.722
      },
      "scale": {
        "x": 1,
        "y": 1,
        "z": 1
      },
      "parent": 24
    },
    {
      "name": "char 4",
      "position": {
        "x": -269.3334,
        "y": 256.6736
      },
      "size": {
        "x": 170,
        "y": 265.7037
      },
      "pivot": {
        "x": 0.46,
        "y": 0.722
      },
      "scale": {
        "x": 1,
        "y": 1,
        "z": 1
      },
      "parent": 24
    },
    {
      "name": "char 5",
      "position": {
        "x": -150.0209,
        "y": 365.735
      },
      "size": {
        "x": 165.0007,
        "y": 257.89
      },
      "pivot": {
        "x": 0.46,
        "y": 0.722
      },
      "scale": {
        "x": 1,
        "y": 1,
        "z": 1
      },
      "parent": 24
    },
    {
      "name": "char 6",
      "position": {
        "x": 125.8272,
        "y": 354.8055
      },
      "size": {
        "x": 165.0007,
        "y": 257.89
      },
      "pivot": {
        "x": 0.46,
        "y": 0.722
      },
      "scale": {
        "x": 1,
        "y": 1,
        "z": 1
      },
      "parent": 24
    },
    {
      "name": "char 7",
      "position": {
        "x": -3.99794,
        "y": 394.6798
      },
      "size": {
        "x": 155,
        "y": 242.2592
      },
      "pivot": {
        "x": 0.46,
        "y": 0.722
      },
      "scale": {
        "x": 1,
        "y": 1,
        "z": 1
      },
      "parent": 24
    }
  ],
  "head": {
    "position": {
      "x": -6,
      "y": 48
    },
    "size": {
      "x": 115,
      "y": 115
    },
    "pivot": {
      "x": 0.5,
      "y": 0
    },
    "scale": {
      "x": 1,
      "y": 1,
      "z": 1
    },
    "parent": 69
  },
  "hitColors": {
    "perfect": {
      "r": 1,
      "g": 0.6235294,
      "b": 0.5921569,
      "a": 1
    },
    "close": {
      "r": 0.9137255,
      "g": 0.827451,
      "b": 0.6313726,
      "a": 1
    },
    "miss": {
      "r": 0.5803922,
      "g": 0.7686275,
      "b": 0.8980392,
      "a": 1
    }
  },
  "imageSlots": {
    "IMAGE_0": "assets/Textures/Char_intro/char_intro_0-compressed.png",
    "IMAGE_1": "assets/Textures/Char_intro/char_intro_1-compressed.png",
    "IMAGE_2": "assets/Textures/Char_intro/char_intro_2-compressed.png",
    "IMAGE_3": "assets/Textures/Char_intro/char_intro_3-compressed.png",
    "IMAGE_4": "assets/Textures/Char_intro/char_intro_4-compressed.png",
    "IMAGE_5": "assets/Textures/Char_intro/char_intro_5-compressed.png",
    "IMAGE_6": "assets/Textures/Char_intro/char_intro_6-compressed.png",
    "IMAGE_7": "assets/Textures/Char_intro/char_intro_7-compressed.png",
    "IMAGE_8": "assets/Textures/char_s1/char_s1_0-compressed.png",
    "IMAGE_9": "assets/Textures/char_s1/char_s1_1-compressed.png",
    "IMAGE_10": "assets/Textures/char_s1/char_s1_2-compressed.png",
    "IMAGE_11": "assets/Textures/char_s1/char_s1_3-compressed.png",
    "IMAGE_12": "assets/Textures/char_s1/char_s1_4-compressed.png",
    "IMAGE_13": "assets/Textures/char_s1/char_s1_5-compressed.png",
    "IMAGE_14": "assets/Textures/char_s1/char_s1_6-compressed.png",
    "IMAGE_15": "assets/Textures/char_s1/char_s1_7-compressed.png",
    "IMAGE_16": "assets/Textures/Char_s2/char_s2_0-compressed.png",
    "IMAGE_17": "assets/Textures/Char_s2/char_s2_1-compressed.png",
    "IMAGE_18": "assets/Textures/Char_s2/char_s2_2-compressed.png",
    "IMAGE_19": "assets/Textures/Char_s2/char_s2_3-compressed.png",
    "IMAGE_20": "assets/Textures/Char_s2/char_s2_4-compressed.png",
    "IMAGE_21": "assets/Textures/Char_s2/char_s2_5-compressed.png",
    "IMAGE_22": "assets/Textures/Char_s2/char_s2_6-compressed.png",
    "IMAGE_23": "assets/Textures/Char_s2/char_s2_7-compressed.png",
    "IMAGE_24": "assets/Textures/Char_s3/char_s3_0-compressed.png",
    "IMAGE_25": "assets/Textures/Char_s3/char_s3_1-compressed.png",
    "IMAGE_26": "assets/Textures/Char_s3/char_s3_2-compressed.png",
    "IMAGE_27": "assets/Textures/Char_s3/char_s3_3-compressed.png",
    "IMAGE_28": "assets/Textures/Char_s3/char_s3_4-compressed.png",
    "IMAGE_29": "assets/Textures/Char_s3/char_s3_5-compressed.png",
    "IMAGE_30": "assets/Textures/Char_s3/char_s3_6-compressed.png",
    "IMAGE_31": "assets/Textures/Char_s3/char_s3_7-compressed.png",
    "IMAGE_32": "assets/Textures/Char_end/char_end_0-compressed.png",
    "IMAGE_33": "assets/Textures/Char_end/char_end_1-compressed.png",
    "IMAGE_34": "assets/Textures/Char_end/char_end_2-compressed.png",
    "IMAGE_35": "assets/Textures/Char_end/char_end_3-compressed.png",
    "IMAGE_36": "assets/Textures/Char_end/char_end_4-compressed.png",
    "IMAGE_37": "assets/Textures/Char_end/char_end_5-compressed.png",
    "IMAGE_38": "assets/Textures/Char_end/char_end_6-compressed.png",
    "IMAGE_39": "assets/Textures/Char_end/char_end_7-compressed.png",
    "IMAGE_40": "assets/Textures/TEXT/Text_Intro.png",
    "IMAGE_41": "assets/Textures/TEXT/Text_Perfect.png",
    "IMAGE_42": "assets/Textures/TEXT/Text_Close.png",
    "IMAGE_43": "assets/Textures/TEXT/Text_Miss.png",
    "IMAGE_44": "assets/Textures/UI/UI_circle1.png",
    "IMAGE_45": "assets/Textures/UI/UI_circle2.png",
    "IMAGE_46": "assets/Textures/UI/UI_Circle_Center.png",
    "IMAGE_47": "assets/Textures/UI/UI_hitRing_01.png",
    "IMAGE_48": "assets/Textures/UI/UI_Line.png",
    "IMAGE_49": "assets/Textures/TEXT/Text_OnBeat.png",
    "IMAGE_50": "assets/Textures/TEXT/Text_YouAreIn.png",
    "IMAGE_51": "assets/Textures/TEXT/Text_CallBack.png",
    "IMAGE_52": "assets/Textures/TEXT/Text_KeepPracticing.png",
    "IMAGE_53": "assets/Textures/TEXT/Text_Next.png",
    "IMAGE_54": "assets/Textures/UI/UI_PlayAgain.png",
    "IMAGE_55": "assets/Textures/BG_color.png",
    "IMAGE_56": "assets/Textures/BG1.png",
    "IMAGE_57": "assets/User Media Textures/UI_Head.png"
  }
};

// engine.js
/* Pure rhythm logic. No browser, APJS, media, storage or platform dependencies. */
(function(root,factory){
  const api=factory();
  root.CatchBeatEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
  class Round {
    constructor(settings){this.settings=settings;this.reset();}
    reset(){
      this.state='waiting';this.time=0;this.playerFrame=0;this.perfect=0;this.close=0;
      this.extraMiss=0;this.events=[];this.targets=[];this.result=null;
    }
    start(duration){
      this.reset();this.state='playing';
      this.duration=Math.max(1,duration);
      this.beat=clamp(Number(this.settings.beat)||.428,.05,1);
      this.hold=this.beat*clamp(Math.round(this.settings.holdBeats??2),0,8);
      const difficulty=clamp(Math.round(this.settings.difficulty)||4,1,5);
      this.perfectWindow=this.beat*(.14+(5-difficulty)*.04);
      this.closeWindow=this.beat*(.34+(5-difficulty)*.08);
      for(let t=this.hold+this.beat;t<=this.duration+1e-8;t+=this.beat)
        this.targets.push({time:t,best:Infinity,taps:0,judged:false,grade:'miss'});
      // First gesture has immediate visual meaning, without counting an early miss.
      this.playerFrame=1;return this;
    }
    advancePlayer(){this.playerFrame=this.playerFrame%this.settings.danceStateCount+1;}
    tap(time){
      if(this.state!=='playing')return null;
      const t=clamp(time,0,this.duration);
      this.tick(t);
      if(this.state!=='playing')return null;
      this.advancePlayer();
      if(t<this.hold)return {grade:'count-in',time:t};
      const index=Math.round((t-this.hold)/this.beat)-1;
      const target=this.targets[index];
      if(!target||target.judged){this.extraMiss++;return this.emit('miss',t,true);}
      const error=Math.abs(t-target.time);
      target.taps++;
      target.best=Math.min(target.best,error);
      if(target.taps>1){this.extraMiss++;return this.emit('miss',t,true);}
      const grade=error<=this.perfectWindow?'perfect':error<=this.closeWindow?'close':'miss';
      return this.emit(grade,t,false);
    }
    emit(grade,time,extra){const e={grade,time,extra};this.events.push(e);return e;}
    tick(time){
      if(this.state!=='playing')return;
      this.time=clamp(time,0,this.duration);
      for(const target of this.targets){
        if(target.judged||this.time<Math.min(target.time+this.closeWindow,this.duration))continue;
        target.judged=true;
        target.grade=target.best<=this.perfectWindow?'perfect':target.best<=this.closeWindow?'close':'miss';
        if(target.grade==='perfect')this.perfect++;
        else if(target.grade==='close')this.close++;
        if(target.taps===0)this.emit('miss',this.time,false);
      }
      if(this.time>=this.duration){
        const denominator=Math.max(1,this.targets.length+this.extraMiss);
        const percent=clamp(Math.round(100*(this.perfect+.7*this.close)/denominator),0,100);
        this.result={percent,perfect:this.perfect,close:this.close,miss:this.targets.length-this.perfect-this.close,extraMiss:this.extraMiss,total:this.targets.length,
          tier:percent>=95?'top':percent>=80?'good':percent>=60?'mid':'low'};
        this.state='result';
      }
    }
    bandFrame(){
      if(this.state==='result')return -1;
      const index=Math.floor((this.time-this.hold+1e-8)/this.beat);
      return index<1?0:(index-1)%this.settings.danceStateCount+1;
    }
    drain(){const out=this.events;this.events=[];return out;}
  }
  return {Round};
});

// solo-layout.js
/* Solo presentation; original scene/config assets remain recoverable. */
(function(root){
  'use strict';
  function layout(width,height,result=false){
    const unit=Math.min(width/390,height/598);
    return {x:width/2,y:height*(result?.27:.385),scale:Math.min((width-60*unit)/460,height*.55/460)*(result?.64:1)};
  }
  function assetPaths(scene){
    return [...new Set([...Object.values(scene.frames).map(poses=>poses[0]),...Object.values(scene.textures)])];
  }
  const api={layout,assetPaths};
  root.CatchBeatSolo=api;
})(typeof window!=='undefined'?window:globalThis);

// game.js
/* Effect House APJS adapters rebuilt with Canvas 2D, Web Audio and local WASM. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id),scene=window.CATCH_BEAT_SCENE;
  const root=$('game'),canvas=$('stage'),ctx=canvas.getContext('2d');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const hosted=new URLSearchParams(location.search).get('host')==='fyp';
  document.documentElement.dataset.feedPreview=String(hosted);
  let hostActive=!hosted;
  const settings={...scene.settings},images=new Map(),imageOverrides=new Map();
  const round=new window.CatchBeatEngine.Round(settings);
  const audio=new (window.AudioContext||window.webkitAudioContext)();
  let musicBuffer=null,introBuffer=null,introSource=null,musicSource=null,audioStart=0,clockStart=0,pausedTime=0,paused=false;
  let ready=false,launching=false,finishedAt=0,lastFeedback=null,feedbackAt=-10,now=0,lastTime=0;
  let width=390,height=598,scale=1,localHead=null,headAnchor={x:.5,y:1},headScale=1;
  let pendingPhoto=null,photoJob=0,focusBeforeEditor=null,noticeTimer,cropPointer=null;
  let cropX=0,cropY=0;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  function announce(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,3500);}
  function resize(){
    width=root.clientWidth;height=root.clientHeight;scale=Math.min(width/390,height/598);
    const dpr=Math.min(devicePixelRatio||1,2.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);root.style.setProperty('--u',scale+'px');
    drawScene();
  }
  new ResizeObserver(resize).observe(root);resize();
  function image(path){return images.get(path);}
  async function loadImage(path){
    if(images.has(path))return images.get(path);
    const img=new Image();img.src=imageOverrides.get(path)||path;await img.decode();images.set(path,img);return img;
  }
  async function boot(){
    try{
      let config;try{const response=await fetch('game.config.json');if(response.ok)config=await response.json();}catch{}
      for(const tweak of config?.tweaks||[]){if(tweak.id==='BEAT')settings.beat=tweak.value;if(tweak.id==='DIFFICULTY')settings.difficulty=tweak.value;if(tweak.id==='HOLD_BEATS')settings.holdBeats=tweak.value;}
      for(const item of config?.images||[]){const original=scene.imageSlots[item.id];if(original&&item.path)imageOverrides.set(original,item.path);}
      const guide=config?.texts?.find(t=>t.id==='GUIDE')?.value||'Tap to catch the beat';
      const paths=window.CatchBeatSolo.assetPaths(scene);
      await Promise.all(paths.map(loadImage));
      try{const data=await fetch(scene.audio.play).then(r=>{if(!r.ok)throw Error();return r.arrayBuffer();});musicBuffer=await audio.decodeAudioData(data);}catch{announce('Music is unavailable. You can still play.');}
      fetch(scene.audio.intro).then(r=>r.arrayBuffer()).then(b=>audio.decodeAudioData(b)).then(b=>introBuffer=b).catch(()=>{});
      ready=true;root.dataset.state='waiting';$('guide').textContent=guide;
      drawScene();document.documentElement.dataset.playableLoading='false';sendPalette();
    }catch(error){$('guide').textContent='Your dancer could not load.';announce('Reload to try again.');root.dataset.state='load-error';console.error(error);}
  }
  function stopMusic(){if(musicSource){try{musicSource.stop();}catch{}musicSource.disconnect();musicSource=null;}}
  function stopIntro(){if(introSource){try{introSource.stop();}catch{}introSource.disconnect();introSource=null;}}
  // The original FYP host owns its gradients; provide only pixels from the initial scene.
  function sendPalette(){
    if(!hosted||window.parent===window||!ready)return;
    const sample=document.createElement('canvas');sample.width=32;sample.height=48;
    const context=sample.getContext('2d',{willReadFrequently:true});
    try{context.drawImage(canvas,0,0,32,48);window.parent.postMessage({type:'playable-palette',top:Array.from(context.getImageData(0,0,32,12).data),bottom:Array.from(context.getImageData(0,36,32,12).data)},location.origin);}catch{}
  }
  window.addEventListener('message',event=>{
    if(!hosted||event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='playable-active'||typeof event.data.active!=='boolean')return;
    hostActive=event.data.active;
    document.documentElement.dataset.feedPreview=String(!hostActive);
    if(!hostActive){
      // Same-URL iframe navigation may not reload. Restore an idle cover explicitly.
      pause();stopMusic();stopIntro();round.reset();paused=false;launching=false;finishedAt=0;lastFeedback=null;feedbackAt=-10;
      if(!$('editor').hidden)closeEditor();
      $('guide').hidden=false;$('result').hidden=true;$('pause').hidden=true;$('photo-controls').hidden=false;
      if(ready){root.dataset.state='waiting';drawScene();}
      audio.suspend().catch(()=>{});
    }
    if(ready&&round.state==='waiting')sendPalette();
  });
  async function playIntro(){
    if(round.state!=='waiting'||introSource||!introBuffer)return;
    try{await audio.resume();if(round.state!=='waiting'||audio.state!=='running')return;introSource=audio.createBufferSource();introSource.buffer=introBuffer;const gain=audio.createGain();gain.gain.value=.5;introSource.connect(gain).connect(audio.destination);introSource.start();introSource.onended=()=>introSource=null;}catch{}
  }
  function startMusic(offset=0){
    stopMusic();
    if(musicBuffer&&audio.state==='running'){
      musicSource=audio.createBufferSource();musicSource.buffer=musicBuffer;
      const gain=audio.createGain();gain.gain.value=.84;musicSource.connect(gain).connect(audio.destination);
      audioStart=audio.currentTime+.035-offset;musicSource.start(audio.currentTime+.035,offset);
      console.info('[BeatAudio] local decoded music started; duration='+musicBuffer.duration.toFixed(3)+'s; offset='+offset.toFixed(3));
    }
    clockStart=performance.now()/1000-offset;
  }
  function clock(){return musicSource?Math.max(0,audio.currentTime-audioStart):Math.max(0,performance.now()/1000-clockStart);}
  async function start(){
    if(!hostActive||!ready||launching||!$('editor').hidden)return;
    launching=true;stopIntro();
    try{await audio.resume();}catch{}
    if(!hostActive){launching=false;return;}
    round.start(settings.autoDuration&&musicBuffer?musicBuffer.duration:settings.gameDuration);
    lastFeedback=null;feedbackAt=-10;paused=false;pausedTime=0;finishedAt=0;
    $('guide').hidden=true;$('result').hidden=true;$('pause').hidden=true;$('photo-controls').hidden=true;
    root.dataset.state='playing';startMusic();launching=false;
  }
  function playAction(){
    if(!hostActive||!ready||launching||!$('editor').hidden||round.state==='result')return;
    if(paused){resume();return;}
    if(round.state==='waiting'){start();return;}
    const result=round.tap(clock());
    if(result?.grade==='count-in')feedbackAt=now;
  }
  $('dance').addEventListener('pointerdown',event=>{if(!event.isPrimary||event.button!==0)return;event.preventDefault();playAction();});
  $('dance').addEventListener('click',event=>{if(event.detail===0)playAction();});
  document.addEventListener('keydown',event=>{
    if(!['Space','Enter'].includes(event.code)||event.repeat||!$('editor').hidden||event.target.closest('button,input')&&event.target!==$('dance'))return;
    event.preventDefault();playAction();
  });
  $('retry').addEventListener('click',()=>{round.reset();start();});
  function pause(){
    if(round.state!=='playing'||paused)return;
    pausedTime=clock();round.tick(pausedTime);paused=true;stopMusic();$('pause').hidden=false;root.dataset.state='paused';
  }
  async function resume(){
    if(!hostActive||!paused)return;
    try{await audio.resume();}catch{}
    if(!hostActive)return;
    startMusic(pausedTime);paused=false;$('pause').hidden=true;root.dataset.state='playing';
  }
  $('resume').addEventListener('click',resume);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();stopIntro();}});
  window.addEventListener('pagehide',()=>{pause();stopMusic();stopIntro();pendingPhoto?.close?.();localHead?.close?.();});
  function showResult(){
    if(finishedAt)return;
    finishedAt=now;stopMusic();root.dataset.state='result';
    const result=round.result;$('result-score').textContent=result.percent+'%';
    $('result-label').src=scene.textures[{top:'resultTopTex',good:'resultGoodTex',mid:'resultMidTex',low:'resultLowTex'}[result.tier]];
    $('result-label').alt={top:"You're in!",good:'Callback!',mid:'Keep practicing!',low:'Next!'}[result.tier];
    $('result').hidden=false;$('photo-controls').hidden=false;
    $('result').animate(reduced.matches?[]:[{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,fill:'both'});
  }
  // Scene coordinates are Y-up. Canvas is Y-down. Keep every sprite aspect ratio.
  function sprite(path,x,y,w,h,alpha=1){const img=image(path);if(!img)return;ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(img,x-w/2,y-h/2,w,h);ctx.restore();}
  function fitSprite(path,x,y,maxW,maxH,alpha=1){const img=image(path);if(!img)return;const s=Math.min(maxW/img.width,maxH/img.height);sprite(path,x,y,img.width*s,img.height*s,alpha);}
  function drawSolo(){
    const layout=window.CatchBeatSolo.layout(width,height,round.state==='result'),s=layout.scale;
    const t=scene.characters[0],frame=round.state==='playing'?round.playerFrame:round.state==='result'?-1:0;
    const key=f=>f<0?'end':f===0?'intro':'s'+f;
    const idle=round.state==='waiting'&&!reduced.matches?Math.sin(now*1.7)*2.4*scale:0;
    const x=layout.x,y=layout.y+idle;
    // Only char0 is rendered, including on the result screen. Its head is the local upload.
    sprite(scene.frames[key(frame)][0],x,y,t.size.x*s,t.size.y*s);
    const hx=[settings.idleHeadX,settings.s2HeadX,settings.s3HeadX,settings.s4HeadX];
    const hr=[settings.idleHeadRotation,settings.s2HeadRotation,settings.s3HeadRotation,settings.s4HeadRotation];
    const shift=frame<0?settings.endHeadX:hx[frame]||0,rotation=frame<0?settings.endHeadRotation:hr[frame]||0;
    const ax=x+(scene.head.position.x+shift+settings.headSegXOffset)*s;
    const ay=y-(scene.head.position.y+settings.headSegYOffset)*s;
    const img=localHead||image(scene.textures.head);if(!img)return;
    const naturalWidth=localHead?Math.min(155,115*img.width/img.height):scene.head.size.x;
    const hw=naturalWidth*settings.headSize*s*(localHead?headScale:1),hh=hw*img.height/img.width;
    const anchor=localHead?headAnchor:{x:scene.head.pivot.x,y:1-scene.head.pivot.y};
    ctx.save();ctx.translate(ax,ay);ctx.rotate(-rotation*Math.PI/180);ctx.drawImage(img,-hw*anchor.x,-hh*anchor.y,hw,hh);ctx.restore();
  }
  function drawBeatLane(){
    if(round.state==='result')return;
    const cy=height*.67,cx=width/2,span=Math.min(width-60*scale,300*scale),r=15*scale;
    ctx.save();ctx.strokeStyle='#222430';ctx.lineWidth=2*scale;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(cx-span/2,cy);ctx.lineTo(cx+span/2,cy);ctx.stroke();
    if(round.state==='playing'){
      for(const target of round.targets){const delta=(target.time-round.time)/round.beat;if(delta < -1.1||delta>1.1)continue;
        const x=cx-delta*span/2;
        fitSprite(delta>=0?scene.textures.circle1Tex:scene.textures.circle2Tex,x,cy,r*2,r*2,.9);
      }
    }else if(!reduced.matches){const pulse=(Math.sin(now*2)+1)/2;ctx.globalAlpha=.18+pulse*.18;ctx.fillStyle='#fffaf5';ctx.beginPath();ctx.arc(cx,cy,r*1.8,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
    fitSprite(scene.textures.circleCenterTex,cx,cy,43*scale,43*scale);
    const age=now-feedbackAt;
    if(age>=0&&age<settings.beat*.4&&lastFeedback){
      const p=age/(settings.beat*.4),rr=(14+(1-Math.pow(1-p,3))*25)*scale;
      ctx.strokeStyle={perfect:'#ffa095',close:'#e9d3a1',miss:'#94c4e5'}[lastFeedback];ctx.lineWidth=4*scale;ctx.globalAlpha=1-p;ctx.beginPath();ctx.arc(cx,cy,rr,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
    }
    ctx.restore();
    if(age>=0&&age<settings.beat*1.5&&lastFeedback){
      const p=age/(settings.beat*1.5),fade=p<.45?1:Math.max(0,(1-p)/.55),pop=reduced.matches?1:Math.min(1.14,p*12);
      fitSprite(scene.textures[lastFeedback+'Tex'],cx,cy+54*scale-(reduced.matches?0:p*12*scale),185*scale*pop,48*scale*pop,fade);
    }
  }
  function drawScene(){
    ctx.clearRect(0,0,width,height);
    const bg=image(scene.textures.background);if(bg)ctx.drawImage(bg,0,0,width,height);else{ctx.fillStyle='#f5b3af';ctx.fillRect(0,0,width,height);}
    const stage=image(scene.textures.stage);if(stage){const layout=window.CatchBeatSolo.layout(width,height,round.state==='result'),feet=layout.y+scene.characters[0].size.y*layout.scale/2,ss=(round.state==='result'?160:200)*scale/stage.width;ctx.globalAlpha=.54;ctx.drawImage(stage,width/2-stage.width*ss/2,feet-28*scale-stage.height*ss/2,stage.width*ss,stage.height*ss);ctx.globalAlpha=1;}
    if(ready){drawSolo();drawBeatLane();}
  }
  function frame(ms){
    now=ms/1000;
    if(!document.hidden){
      if(round.state==='playing'&&!paused){round.tick(clock());for(const e of round.drain()){lastFeedback=e.grade;feedbackAt=now;}if(round.state==='result')showResult();}
      drawScene();
    }
    lastTime=now;requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);boot();

  // Local photo personalization. The user frames the face; no remote processing is used.
  function closeEditor(){
    photoJob++;cropPointer=null;pendingPhoto?.close?.();pendingPhoto=null;
    $('editor').hidden=true;focusBeforeEditor?.focus();
  }
  function cropBounds(){
    if(!pendingPhoto)return null;
    const canvas=$('photo-crop'),aspect=canvas.width/canvas.height,zoom=Number($('photo-zoom').value)||1;
    const w=Math.min(pendingPhoto.width,pendingPhoto.height*aspect)/zoom,h=w/aspect;
    cropX=clamp(cropX,w/2,pendingPhoto.width-w/2);cropY=clamp(cropY,h/2,pendingPhoto.height-h/2);
    return {x:cropX-w/2,y:cropY-h/2,w,h};
  }
  function drawCrop(canvas,showOutline=false){
    const bounds=cropBounds();if(!bounds)return;
    const context=canvas.getContext('2d');if(!context)return;
    context.clearRect(0,0,canvas.width,canvas.height);context.save();context.beginPath();
    context.ellipse(canvas.width/2,canvas.height/2,canvas.width/2-2,canvas.height/2-2,0,0,Math.PI*2);
    context.clip();context.drawImage(pendingPhoto,bounds.x,bounds.y,bounds.w,bounds.h,0,0,canvas.width,canvas.height);context.restore();
    if(showOutline){context.beginPath();context.ellipse(canvas.width/2,canvas.height/2,canvas.width/2-2,canvas.height/2-2,0,0,Math.PI*2);context.strokeStyle='#fff';context.lineWidth=3;context.stroke();}
  }
  const cropCanvas=$('photo-crop');
  cropCanvas.addEventListener('pointerdown',event=>{
    if(!pendingPhoto||event.button>0||cropPointer)return;
    cropPointer={id:event.pointerId,x:event.clientX,y:event.clientY};cropCanvas.setPointerCapture(event.pointerId);event.preventDefault();
  });
  cropCanvas.addEventListener('pointermove',event=>{
    if(!cropPointer||event.pointerId!==cropPointer.id)return;
    const bounds=cropBounds(),rect=cropCanvas.getBoundingClientRect();if(!bounds||!rect.width||!rect.height)return;
    cropX-=(event.clientX-cropPointer.x)*bounds.w/rect.width;cropY-=(event.clientY-cropPointer.y)*bounds.h/rect.height;
    cropPointer.x=event.clientX;cropPointer.y=event.clientY;drawCrop(cropCanvas,true);event.preventDefault();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])cropCanvas.addEventListener(type,event=>{if(cropPointer?.id===event.pointerId)cropPointer=null;});
  cropCanvas.addEventListener('keydown',event=>{
    const bounds=cropBounds();if(!bounds)return;
    const step=.04;if(event.key==='ArrowLeft')cropX-=bounds.w*step;else if(event.key==='ArrowRight')cropX+=bounds.w*step;
    else if(event.key==='ArrowUp')cropY-=bounds.h*step;else if(event.key==='ArrowDown')cropY+=bounds.h*step;else return;
    event.preventDefault();drawCrop(cropCanvas,true);
  });
  $('photo-zoom').addEventListener('input',()=>drawCrop(cropCanvas,true));
  $('photo-button').addEventListener('click',()=>{if(!hostActive)return;playIntro();$('photo-input').click();});
  $('editor-close').addEventListener('click',closeEditor);
  $('editor').addEventListener('click',e=>{if(e.target===$('editor'))closeEditor();});
  document.addEventListener('keydown',event=>{
    if($('editor').hidden)return;
    if(event.key==='Escape')closeEditor();
    if(event.key==='Tab'){
      const controls=[...$('editor').querySelectorAll('button:not(:disabled),input')].filter(e=>!e.closest('[hidden]'));
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){last.focus();event.preventDefault();}
      else if(!event.shiftKey&&document.activeElement===last){first.focus();event.preventDefault();}
    }
  });
  $('photo-input').addEventListener('change',async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(file.size>20*1024*1024){announce('Choose a photo smaller than 20 MB.');return;}
    focusBeforeEditor=document.activeElement;$('editor').hidden=false;$('editor-close').focus();
    $('apply-photo').disabled=true;$('photo-options').hidden=true;$('photo-status').textContent='Opening your photo…';
    pendingPhoto?.close?.();pendingPhoto=null;cropCanvas.getContext('2d').clearRect(0,0,cropCanvas.width,cropCanvas.height);
    const id=++photoJob;
    try{
      const original=await createImageBitmap(file,{imageOrientation:'from-image'});
      if(id!==photoJob){original.close();return;}
      const f=Math.min(1,1536/Math.max(original.width,original.height));
      const c=document.createElement('canvas');c.width=Math.round(original.width*f);c.height=Math.round(original.height*f);c.getContext('2d').drawImage(original,0,0,c.width,c.height);original.close();
      const bitmap=await createImageBitmap(c);
      if(id!==photoJob){bitmap.close();return;}
      pendingPhoto=bitmap;cropX=bitmap.width/2;cropY=bitmap.height*.38;
      $('photo-zoom').value='1.2';$('photo-size').value='1';$('photo-options').hidden=false;$('apply-photo').disabled=false;
      $('photo-status').textContent='Drag to position your face, then adjust the zoom.';drawCrop(cropCanvas,true);
    }catch{$('photo-status').textContent='This photo could not open. Try a JPEG, PNG or WebP.';}
  });
  $('apply-photo').addEventListener('click',async()=>{
    if(!pendingPhoto)return;const id=photoJob;$('apply-photo').disabled=true;
    try{
      const cutout=document.createElement('canvas');cutout.width=cropCanvas.width;cutout.height=cropCanvas.height;drawCrop(cutout);
      const bitmap=await createImageBitmap(cutout);if(id!==photoJob){bitmap.close();return;}
      localHead?.close?.();localHead=bitmap;headAnchor={x:.5,y:.94};headScale=Number($('photo-size').value);
      $('default-button').hidden=false;$('photo-button').querySelector('span').textContent='Change photo';closeEditor();
    }catch{$('photo-status').textContent='Could not apply the photo. Please try again.';$('apply-photo').disabled=false;}
  });
  $('default-button').addEventListener('click',()=>{localHead?.close?.();localHead=null;$('default-button').hidden=true;$('photo-button').querySelector('span').textContent='Use your photo';});
})();

}
function App() { React.useLayoutEffect(() => { mountGame(); }, []); return <> <main {...{"id": "game", "aria-label": "Catch the Beat rhythm game"}}><canvas {...{"id": "stage", "role": "img", "aria-label": "Your solo dancer. Upload your photo, then tap to dance to the music."}}></canvas><button {...{"id": "dance", "aria-label": "Dance to the beat. You can also press Space."}}></button><p {...{"id": "guide", "aria-live": "polite"}}>{"Loading your dancer…"}</p><div {...{"id": "photo-controls"}}><button {...{"id": "photo-button", "type": "button"}}><svg {...{"viewBox": "0 0 24 24", "aria-hidden": "true"}}><path {...{"d": "M8 5l1.6-2h4.8L16 5h3a2 2 0 012 2v12H3V7a2 2 0 012-2z"}}></path><circle {...{"cx": "12", "cy": "12", "r": "4"}}></circle></svg><span>{"Use your photo"}</span></button><button {...{"id": "default-button", "type": "button", "hidden": true, "aria-label": "Use the original character"}}>{"Original"}</button></div><input {...{"id": "photo-input", "type": "file", "accept": "image/jpeg,image/png,image/webp,image/heic,image/heif", "hidden": true}} /><div {...{"id": "result", "hidden": true}}><p {...{"id": "result-score", "aria-live": "polite"}}>{"0%"}</p><img {...{"id": "result-label", "alt": ""}} /><button {...{"id": "retry", "type": "button"}}>{"Play again"}<svg {...{"viewBox": "0 0 24 24", "aria-hidden": "true"}}><path {...{"d": "M20 8v6h-6M20 14a8 8 0 11-.8-7.5"}}></path></svg></button></div><div {...{"id": "pause", "hidden": true}}><button {...{"id": "resume", "type": "button"}}>{"Tap to resume"}</button></div><p {...{"id": "notice", "role": "status", "hidden": true}}></p><div {...{"id": "editor", "className": "modal", "role": "dialog", "aria-modal": "true", "aria-labelledby": "editor-title", "hidden": true}}><section {...{"className": "editor-sheet"}}><header><h1 {...{"id": "editor-title"}}>{"Your dance face"}</h1><button {...{"id": "editor-close", "className": "icon-button", "aria-label": "Cancel photo"}}><svg {...{"viewBox": "0 0 24 24", "aria-hidden": "true"}}><path {...{"d": "M6 6l12 12M18 6L6 18"}}></path></svg></button></header><div {...{"id": "photo-preview"}}><canvas {...{"id": "photo-crop", "width": "300", "height": "360", "tabIndex": "0", "role": "img", "aria-label": "Drag your photo to position your face in the oval"}}></canvas></div><p {...{"id": "photo-status", "aria-live": "polite"}}>{"Choose a photo to begin."}</p><div {...{"id": "photo-options", "hidden": true}}><label>{"Zoom"}<input {...{"id": "photo-zoom", "type": "range", "min": "1", "max": "3", "step": ".05", "value": "1.2"}} /></label><label>{"Head size"}<input {...{"id": "photo-size", "type": "range", "min": ".75", "max": "1.45", "step": ".01", "value": "1"}} /></label></div><button {...{"id": "apply-photo", "type": "button", "disabled": true}}>{"Use this photo"}</button><p {...{"className": "privacy"}}>{"Processed on this device. Never uploaded."}</p></section></div></main> </>; }
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(()=>{
 const selectors=["p#guide"],copy=new Set(["Tap to catch the beat"].map(s=>s.replace(/\s+/g,' ').trim().toLowerCase()));
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)'),running=new Map();let queued=false,visible=true;
 const action=/^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
 function scan(){
  queued=false;for(const [el,a]of running)if(!el.isConnected){a.cancel();running.delete(el);}
  if(motion.matches){for(const a of running.values())a.cancel();running.clear();return;}
  const targets=new Set();for(const selector of selectors){try{document.querySelectorAll(selector).forEach(el=>targets.add(el));}catch{}}
  for(const el of document.querySelectorAll('p,span,div,label,text')){
   if(el.children.length||el.closest('button,a,input,select,textarea,[role="button"]'))continue;
   const text=(el.textContent||'').replace(/\s+/g,' ').trim();
   if(text.length>=5&&text.length<=140&&(copy.has(text.toLowerCase())||(!selectors.length&&action.test(text))))targets.add(el);
  }
  for(const el of targets){
   if(running.has(el)||typeof el.animate!=='function')continue;
   if([...targets].some(child=>child!==el&&el.contains(child)))continue;
   const style=getComputedStyle(el);if(/breath/i.test(style.animationName))continue;
   const base=style.filter.replace(/opacity\([^)]*\)/g,'').replace(/^none$/,'').trim(),filter=v=>(base?base+' ':'')+'opacity('+v+')';
   const a=el.animate([{filter:filter(1)},{filter:filter(.65)},{filter:filter(1)}],{duration:2400,iterations:Infinity,easing:'ease-in-out'});running.set(el,a);if(document.hidden||!visible)a.pause();
  }
 }
 const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(scan);}};
 const pause=()=>{for(const a of running.values())document.hidden||!visible?a.pause():a.play();};
 const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
 const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);pause();}):null;
 if(document.body)intersection?.observe(document.body);else document.addEventListener('DOMContentLoaded',()=>intersection?.observe(document.body),{once:true});
 document.addEventListener('visibilitychange',pause);motion.addEventListener?.('change',schedule);schedule();
 window.addEventListener('pagehide',()=>{observer.disconnect();intersection?.disconnect();for(const a of running.values())a.cancel();running.clear();},{once:true});
})();



/* Batch 3 entry polish. Preview covers are still images in the feed. */
(() => {
  'use strict';
  const number = Number(({getAttribute(name){return ({"data-subject": "#root canvas", "data-game": "", "data-batch3-game": "74"})[name]??null;},dataset:{"subject": "#root canvas", "game": "", "batch3Game": "74"}})?.dataset.batch3Game);
  const isFeed = new URLSearchParams(location.search).get('feedReview') === '1' && window.parent !== window;
  const root = document.documentElement;
  root.toggleAttribute('data-batch3-preview', isFeed);
  const configurations = {
    12: {text: 'Tap to pop the bubbles', top: '80px', color: '#a2355a', action: 'bubble'},
    20: {text: 'Tap the bug', top: '32%', color: '#fff', action: 'bug'},
    27: {text: 'Guess their age', top: '10.5%', color: '#fff', action: 'age'},
    37: {text: 'Tap to add balls', top: '24%', color: '#fff', action: 'add-ball'},
    39: {text: 'Tap squares to find the animal', top: '22%', color: '#29202e', action: 'cell'},
    49: {text: 'Guess the hidden code', top: '40%', color: '#fff', action: 'digit'},
    60: {text: 'Steer into the parking spot', top: '34%', color: '#fff', action: 'drive'},
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
    74: 'html[data-batch3-preview] #photo-controls {visibility:hidden!important}',
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
  let guide, dismissed = false;
  const config = configurations[number];
  function mountGuide() {
    if (!config || guide || dismissed) return;
    guide = document.createElement('p'); guide.className = 'b3-guide';
    guide.textContent = config.text; guide.style.top = config.top; guide.style.color = config.color;
    document.body.append(guide);
  }
  function meaningful(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (config?.action === 'bug') return !!target.closest('#root div[tabindex="0"]');
    if (config?.action === 'bubble') {
      if (target.closest('#root div[tabindex="0"],#root canvas')) return true;
      const tab = target.closest('button');
      return !!tab && /^(Sand Art|Spinner)$/.test(tab.textContent.trim());
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
    if (meaningful(event)) { dismissed = true; guide?.remove(); guide = null; }
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
  const start = () => { mountGuide(); observer.observe(document.getElementById('root') || document.body, {childList:true,subtree:true}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
  window.addEventListener('pagehide', () => { observer.disconnect(); }, {once:true});
})();

