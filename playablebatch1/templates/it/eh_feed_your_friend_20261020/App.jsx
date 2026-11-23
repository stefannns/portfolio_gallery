/* Font redistribution notices, preserved in the editable source.
Font license notice: fonts
Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


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
document.documentElement.lang = "it";
// Editable Batch 2 game. Rebuild using the platform app/h5_build/build.js.
const PACKAGE_CONFIG_FALLBACK = {
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  },
  "tweaks": [{
    "id": "gameDuration",
    "kind": "number",
    "label": "gameDuration",
    "value": 15,
    "default": 15,
    "min": 10,
    "max": 60,
    "step": 1
  }, {
    "id": "scrollSpeed",
    "kind": "number",
    "label": "scrollSpeed",
    "value": 400,
    "default": 400,
    "min": 100,
    "max": 800,
    "step": 10
  }, {
    "id": "negativePercent",
    "kind": "number",
    "label": "negativePercent",
    "value": 20,
    "default": 20,
    "min": 0,
    "max": 100,
    "step": 1
  }],
  "texts": [{
    "id": "GUIDE",
    "label": "Opening guide",
    "value": "Tocca il piatto per dare da mangiare",
    "max_length": 64
  }],
  "images": [{
    "id": "GOOD_0",
    "label": "Good food 1",
    "path": "./assets/good_0.webp",
    "replaceable": true
  }, {
    "id": "GOOD_1",
    "label": "Good food 2",
    "path": "./assets/good_1.webp",
    "replaceable": true
  }, {
    "id": "GOOD_2",
    "label": "Good food 3",
    "path": "./assets/good_2.webp",
    "replaceable": true
  }, {
    "id": "GOOD_3",
    "label": "Good food 4",
    "path": "./assets/good_3.webp",
    "replaceable": true
  }, {
    "id": "GOOD_4",
    "label": "Good food 5",
    "path": "./assets/good_4.webp",
    "replaceable": true
  }, {
    "id": "GOOD_5",
    "label": "Good food 6",
    "path": "./assets/good_5.webp",
    "replaceable": true
  }, {
    "id": "BAD_0",
    "label": "Bad food 1",
    "path": "./assets/bad_0.webp",
    "replaceable": true
  }, {
    "id": "BAD_1",
    "label": "Bad food 2",
    "path": "./assets/bad_1.webp",
    "replaceable": true
  }, {
    "id": "PLATE",
    "label": "Food target plate",
    "path": "./assets/plate.webp",
    "replaceable": true
  }, {
    "id": "PHOTO_NORMAL",
    "label": "Neutral portrait",
    "path": "./assets/photo_normal.webp",
    "replaceable": true
  }, {
    "id": "PHOTO_SMILE",
    "label": "Happy eating reaction",
    "path": "./assets/photo_smile.webp",
    "replaceable": true
  }, {
    "id": "PHOTO_YELL",
    "label": "Bad food reaction",
    "path": "./assets/photo_yell.webp",
    "replaceable": true
  }, {
    "id": "PHOTO_FULL",
    "label": "Full-cheek result",
    "path": "./assets/photo_full.webp",
    "replaceable": true
  }]
};
const PACKAGE_HTML_STYLES = "@font-face{font-family:Poppins;src:url('./assets/fonts/Poppins-Regular.woff2') format('woff2');font-weight:400;font-display:swap}\n@font-face{font-family:Poppins;src:url('./assets/fonts/Poppins-Bold.woff2') format('woff2');font-weight:700;font-display:swap}\n:root{font-family:Poppins,Arial,sans-serif;color:#fff;background:#222;--ink:#fff;--ui:1;--accent:#ffcf4c}\n*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{overscroll-behavior:none}button{font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}button:focus-visible{outline:3px solid #ffcd45;outline-offset:-5px}button:disabled{cursor:default}\n#stage{position:relative;width:100%;height:100%;isolation:isolate;overflow:hidden;touch-action:manipulation;color:var(--ink)}canvas{position:absolute;inset:0;width:100%;height:100%;display:block}\n#play{position:absolute;inset:0;border:0;background:none;z-index:1;padding:0;touch-action:manipulation;color:transparent}\n.makeover #play{touch-action:none}\n.hud{position:absolute;top:max(calc(30px * var(--ui)),env(safe-area-inset-top));left:calc(30px * var(--ui));right:calc(30px * var(--ui));display:flex;align-items:flex-start;justify-content:space-between;pointer-events:none;z-index:2;text-shadow:0 1px 4px #0009;font-size:calc(28px * var(--ui));font-weight:700;line-height:1.25;letter-spacing:-.6px;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}.hud small{font-size:calc(14px * var(--ui));display:block;line-height:1.4;letter-spacing:0;font-weight:400;margin-top:3px}.hud span:empty{display:none}\n#guide{position:absolute;z-index:2;left:calc(30px * var(--ui));right:calc(30px * var(--ui));bottom:max(calc(62px * var(--ui)),env(safe-area-inset-bottom));font-size:calc(18px * var(--ui));font-weight:700;line-height:1.4;text-align:center;pointer-events:none;text-shadow:0 1px 4px #000a;animation:eh-guide-breathe 2.4s ease-in-out infinite;margin:0}\n#guide[hidden], [hidden]{display:none!important}html[data-feed-preview=\"true\"] #guide,html[data-feed-preview=\"true\"] .controls{visibility:hidden}.controls{position:absolute;z-index:3;left:calc(30px * var(--ui));right:calc(30px * var(--ui));bottom:max(calc(50px * var(--ui)),env(safe-area-inset-bottom));display:flex;align-items:center;justify-content:center;gap:12px;pointer-events:none}\n.control{min-height:48px;min-width:48px;padding:10px 22px;border:0;border-radius:30px;background:#fff;color:#20252b;font-weight:700;font-size:16px;box-shadow:0 2px 10px #0002;pointer-events:auto}.control:active{transform:scale(.97)}#direction{margin-left:auto;border:1px solid #ffffff80;background:#2228;color:#fff;backdrop-filter:blur(8px);padding:10px 13px;display:flex;align-items:center;gap:8px}#direction svg{width:22px;height:22px;transition:transform .2s}\n#result{position:absolute;z-index:2;left:24px;right:24px;bottom:calc(122px * var(--ui));text-align:center;pointer-events:none;font-size:calc(28px * var(--ui));font-weight:700;line-height:1.2;text-shadow:0 2px 8px #0009}#result small{font-size:calc(18px * var(--ui));font-weight:400;display:block;margin-top:8px}\n#loading{position:absolute;inset:0;z-index:6;background:#25272a;display:grid;place-content:center;text-align:center;padding:30px;font-size:18px;line-height:1.5}#loading:before{content:'';width:28px;height:28px;border:3px solid #ffffff35;border-top-color:#fff;border-radius:50%;margin:0 auto 18px;animation:turn .8s linear infinite}#loading.error:before{display:none}.hair-catch{--ink:#30251e}.hair-catch .hud,.hair-catch #guide,.hair-catch #result{text-shadow:none}.hair-catch #guide{bottom:calc(70px * var(--ui))}.hair-catch .hud{top:calc(50px * var(--ui))}.hair-catch #result{bottom:calc(170px * var(--ui))}\n.hair-catch #guide{color:#fff;text-shadow:0 1px 4px #000b}.hair-catch .hud span:not(:empty){background:#fffef7ed;border-radius:24px;padding:6px 18px}.hair-shave #guide{bottom:calc(120px * var(--ui))}.makeover .hud{font-size:calc(24px * var(--ui))}.makeover .hud #left{max-width:75%}#pause{position:absolute;inset:0;z-index:7;background:#15191c90;display:grid;place-content:center;backdrop-filter:blur(4px)}#resume{border:1px solid #ffffff80;background:#fff;color:#222;font-size:18px;padding:15px 25px;border-radius:30px;min-height:50px}\n.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@keyframes float{50%{transform:translateY(-5px)}}@keyframes turn{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){*,*:before{animation:none!important;transition:none!important}}\n\n/* Explicit CTA pulse; centering overrides must not suppress the motion. */\n@keyframes eh-guide-breathe{0%,100%{opacity:1}50%{opacity:.6}}\nhtml[data-batch2-idle-paused=\"true\"] #guide{animation-play-state:paused}\n\n/* User follow-up 2026-11-02: common above-center CTA, above preview artwork. */\nhtml:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p#guide{position:fixed!important;top:26%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}\n\nhtml[data-feed-preview=\"true\"] #stage #guide:not([hidden]){visibility:visible!important;z-index:25!important}\n";
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
function startGame() {
  window.GAME_SPEC = {
    "id": "feed-your-friend",
    "title": "Nutri un amico",
    "settings": {
      "scrollSpeed": 400,
      "itemSpacing": 400,
      "itemScale": 0.8,
      "pickRadius": 100,
      "eatFlyDuration": 0.25,
      "lbPerHit": 10,
      "fatPerHit": 0.1,
      "gameDuration": 15,
      "headSegmentationDuration": 0.6,
      "headSegmentationAngle": 12,
      "badFaceDuration": 1,
      "negativePercent": 20
    },
    "assets": {
      "good": ["GOOD_0", "GOOD_1", "GOOD_2", "GOOD_3", "GOOD_4", "GOOD_5"],
      "bad": ["BAD_0", "BAD_1"],
      "plate": "PLATE",
      "normal": "PHOTO_NORMAL",
      "happy": "PHOTO_SMILE",
      "badFace": "PHOTO_YELL",
      "full": "PHOTO_FULL"
    },
    "photoPoints": {
      "mouth": {
        "x": 0.56,
        "y": 0.463
      },
      "face": {
        "x": 0.54,
        "y": 0.34
      }
    },
    "audio": {}
  };
  (function (root) {
    'use strict';

    class Feeding {
      constructor(settings, rng = Math.random) {
        this.s = settings;
        this.rng = rng;
        this.reset();
      }
      reset() {
        this.state = 'waiting';
        this.remaining = this.s.gameDuration;
        this.initialWeight = 90 + Math.floor(this.rng() * 111);
        this.weight = this.initialWeight;
        this.hits = 0;
        this.reaction = 'normal';
        this.reactionLeft = 0;
        this.items = [];
        this.events = [];
        let last = '';
        const count = Math.max(2, Math.ceil(this.s.scrollSpeed * this.s.gameDuration / this.s.itemSpacing) + 1);
        for (let i = 0; i < count; i++) {
          const good = i === 0 || this.rng() >= this.s.negativePercent / 100;
          let type = Math.floor(this.rng() * (good ? 6 : 2));
          if (last === (good ? 'g' : 'b') + type) type = (type + 1) % (good ? 6 : 2);
          last = (good ? 'g' : 'b') + type;
          this.items.push({
            id: i,
            good,
            type,
            x: -i * this.s.itemSpacing,
            phase: 'scroll',
            age: 0
          });
        }
      }
      hit(id) {
        if (this.state === 'result') return false;
        const item = this.items.find(i => i.id === id && i.phase === 'scroll' && Math.abs(i.x) <= 135);
        if (!item) return false;
        if (this.state === 'waiting') this.state = 'playing';
        item.phase = 'eating';
        item.age = 0;
        item.startX = item.x;
        return true;
      }
      hitPlate() {
        const item = this.items.filter(i => i.phase === 'scroll' && Math.abs(i.x) <= 135).sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0];
        return item ? this.hit(item.id) : false;
      }
      tick(dt) {
        if (this.state !== 'playing') return;
        const step = Math.min(dt, this.remaining);
        this.remaining = Math.max(0, this.remaining - dt);
        this.reactionLeft = Math.max(0, this.reactionLeft - step);
        if (!this.reactionLeft) this.reaction = 'normal';
        for (const item of this.items) {
          if (item.phase === 'scroll') {
            item.x += this.s.scrollSpeed * step;
            if (item.x > 540) item.phase = 'gone';
          } else if (item.phase === 'eating') {
            item.age += step;
            if (item.age >= this.s.eatFlyDuration) {
              item.phase = 'gone';
              if (item.good) {
                this.hits++;
                this.weight += this.s.lbPerHit;
                this.reaction = 'happy';
                this.reactionLeft = this.s.headSegmentationDuration;
              } else {
                this.reaction = 'badFace';
                this.reactionLeft = this.s.badFaceDuration;
              }
              this.events.push({
                type: 'eat',
                good: item.good
              });
            }
          }
        }
        if (!this.remaining) {
          this.state = 'result';
          this.items = [];
          this.events.push({
            type: 'result'
          });
        }
      }
      drain() {
        const e = this.events;
        this.events = [];
        return e;
      }
    }
    root.Feeding = Feeding;
  })(typeof window !== 'undefined' ? window : globalThis);

  /* BATCH2_IDLE_20261102 */
  /* Game-owned, silent demonstration clock. Never dispatches gameplay input. */
  (() => {
    'use strict';

    if (window.PlayableIdlePreview) return;
    const query = new URLSearchParams(location.search);
    const hosted = query.get('feedReview') === '1' || query.get('host') === 'fyp';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let preview = hosted,
      elapsed = 0,
      last = performance.now();
    const listeners = new Set();
    const sync = () => {
      const html = document.documentElement;
      html.dataset.batch2Idle = String(preview);
      html.dataset.batch2IdlePaused = String(document.hidden);
      html.dataset.batch2IdleReduced = String(reduced.matches);
      if (!preview) for (const node of document.querySelectorAll('[data-idle-preview]')) node.dataset.idlePreview = 'off';
      last = performance.now();
      for (const fn of listeners) fn(preview && !document.hidden);
    };
    const clock = () => {
      const now = performance.now();
      if (preview && !document.hidden && !reduced.matches) elapsed += Math.min(64, Math.max(0, now - last));
      last = now;
      return reduced.matches ? 1600 : elapsed;
    };
    const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
    const ease = t => (t = clamp(t), t * t * (3 - 2 * t));
    const trace = (ctx, points, progress = 1) => {
      if (!points.length) return;
      const distances = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
      let left = distances.reduce((a, b) => a + b, 0) * clamp(progress);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1],
          q = points[i],
          d = distances[i - 1];
        const t = Math.min(1, left / Math.max(.01, d));
        ctx.lineTo(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
        left -= d;
        if (left <= 0) break;
      }
      ctx.stroke();
    };
    const onPath = (points, progress) => {
      const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
      let distance = lengths.reduce((a, b) => a + b, 0) * clamp(progress);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          length = lengths[i - 1];
        if (distance <= length || i === points.length - 1) {
          const t = clamp(distance / Math.max(.01, length));
          return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t
          };
        }
        distance -= length;
      }
      return points[0];
    };
    const stamp = (canvas, kind, phase = clock()) => {
      if (!canvas) return;
      canvas.dataset.idlePreview = preview ? kind : 'off';
      canvas.dataset.idlePhase = String(Math.round(phase));
    };
    function ant(ctx, w, h, image) {
      const t = clock() / 1000,
        p = t % 5.4 / 5.4;
      const cx = w * .5,
        cy = h * .51,
        rx = Math.min(w * .29, 105),
        ry = Math.min(h * .16, 78);
      const path = Array.from({
        length: 81
      }, (_, i) => ({
        x: cx + Math.cos(i / 80 * Math.PI * 2) * rx,
        y: cy + Math.sin(i / 80 * Math.PI * 2) * ry
      }));
      ctx.save();
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#242322';
      ctx.globalAlpha = p > .88 ? (1 - p) / .12 : 1;
      trace(ctx, path, ease(p / .48));
      const x = cx + Math.sin(t * 2.1) * rx * .63,
        y = cy + Math.sin(t * 2.8) * ry * .59;
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(Math.cos(t * 2.8) * ry, Math.cos(t * 2.1) * rx) + Math.PI / 2);
      if (image?.complete && image.naturalWidth) ctx.drawImage(image, -17, -17, 34, 34);else {
        ctx.fillStyle = '#242322';
        for (const [y, r] of [[-7, 5], [0, 4], [7, 6]]) {
          ctx.beginPath();
          ctx.ellipse(0, y, r, r * 1.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      stamp(ctx.canvas, 'ant-loop');
    }
    function army(state, w, h) {
      const t = clock() / 1000;
      const players = state.entities.filter(e => e.team === 'player'),
        cx = players.reduce((n, e) => n + e.x, 0) / Math.max(1, players.length),
        cy = players.reduce((n, e) => n + e.y, 0) / Math.max(1, players.length);
      return {
        ...state,
        particles: [],
        playerTarget: {
          x: w * (.5 + Math.sin(t * .8) * .18),
          y: h * (.43 + Math.cos(t * .8) * .04)
        },
        entities: state.entities.map((entity, i) => ({
          ...entity,
          x: entity.team === 'player' ? w * (.5 + Math.sin(t * .8) * .14) + (entity.x - cx) * .7 : entity.x + Math.sin(t * 1.5 + i * .7) * 8,
          y: entity.team === 'player' ? h * (.57 + Math.cos(t * .8) * .04) + (entity.y - cy) * .7 : entity.y + Math.cos(t * 1.5 + i * .7) * 8
        }))
      };
    }
    function blade(ctx, w, h, top, bottom) {
      const t = clock() / 1000,
        p = t % 5.8 / 5.8,
        cx = w / 2,
        cy = (top + bottom) / 2;
      const points = [[-.22, .16], [-.11, .02], [.04, .04], [.17, -.17], [.24, -.11]].map(([x, y]) => ({
        x: cx + x * w,
        y: cy + y * (bottom - top)
      }));
      ctx.save();
      ctx.strokeStyle = '#303936';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = p > .9 ? (1 - p) / .1 : 1;
      if (p < .5) trace(ctx, points, ease(p / .45));else {
        ctx.translate(cx, cy);
        ctx.rotate((p - .5) * Math.PI * 3.4);
        trace(ctx, points.map(v => ({
          x: v.x - cx,
          y: v.y - cy
        })));
        ctx.fillStyle = '#303936';
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      stamp(ctx.canvas, 'draw-and-spin-blade');
    }
    function roadPose(key) {
      const t = clock() / 1000,
        offset = key === 'player' ? 0 : key === 'copL' ? 1.3 : 2.2;
      const q = t * .75 - offset,
        x = 375 + Math.sin(q) * 130,
        y = key === 'player' ? 800 : 1040 + (key === 'copR' ? 60 : 0);
      return {
        x: x + (key === 'copL' ? -85 : key === 'copR' ? 85 : 0),
        y: y + Math.cos(q) * 28,
        angle: -Math.PI / 2 + Math.cos(q) * .18
      };
    }
    function road(ctx) {
      const p = roadPose('player');
      ctx.save();
      ctx.strokeStyle = '#ffffff88';
      ctx.setLineDash([11, 12]);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.bezierCurveTo(p.x + 100, p.y - 100, 340, p.y - 220, 420, p.y - 340);
      ctx.stroke();
      ctx.restore();
      stamp(ctx.canvas, 'escape-route');
    }
    function route(start, end, circles, w) {
      const nodes = [start, end];
      for (const circle of circles) for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6,
          r = circle.circleRadius + 16;
        const p = {
          x: circle.position.x + Math.cos(a) * r,
          y: circle.position.y + Math.sin(a) * r
        };
        if (p.x > 15 && p.x < w - 15) nodes.push(p);
      }
      const distance = nodes.map(() => Infinity),
        previous = nodes.map(() => -1),
        visited = new Set();
      distance[0] = 0;
      const clear = (a, b) => circles.every(c => {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          t = clamp(((c.position.x - a.x) * dx + (c.position.y - a.y) * dy) / Math.max(.01, dx * dx + dy * dy));
        return Math.hypot(a.x + dx * t - c.position.x, a.y + dy * t - c.position.y) > c.circleRadius + 7;
      });
      for (let pass = 0; pass < nodes.length; pass++) {
        let k = -1;
        for (let j = 0; j < nodes.length; j++) if (!visited.has(j) && (k < 0 || distance[j] < distance[k])) k = j;
        if (k < 0 || !Number.isFinite(distance[k])) break;
        if (k === 1) break;
        visited.add(k);
        for (let j = 0; j < nodes.length; j++) {
          if (visited.has(j) || !clear(nodes[k], nodes[j])) continue;
          const d = distance[k] + Math.hypot(nodes[k].x - nodes[j].x, nodes[k].y - nodes[j].y);
          if (d < distance[j]) {
            distance[j] = d;
            previous[j] = k;
          }
        }
      }
      if (previous[1] < 0) return [start, {
        x: 20,
        y: start.y + 24
      }, {
        x: 20,
        y: end.y - 28
      }, end];
      const path = [];
      for (let k = 1; k >= 0; k = previous[k]) {
        path.unshift(nodes[k]);
        if (k === 0) break;
      }
      return path;
    }
    let sodaCache = null;
    function soda(ctx, source, cup, cupW, cupH, bodies, w) {
      if (!source || !cup) return;
      const t = clock() / 1000,
        p = t % 5.6;
      const circles = bodies.filter(b => b.label === 'obstacle'),
        key = JSON.stringify([source, cup, w, circles.map(c => [c.position.x, c.position.y, c.circleRadius])]);
      if (sodaCache?.key !== key) sodaCache = {
        key,
        points: route({
          x: source.x,
          y: source.y + 21
        }, {
          x: cup.x,
          y: cup.y - cupH * .42
        }, circles, w)
      };
      const points = sodaCache.points;
      ctx.save();
      ctx.strokeStyle = '#242322';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = p > 5 ? (5.6 - p) / .6 : 1;
      trace(ctx, points, ease(p / 1.7));
      if (p > 1.4 && p < 5) {
        for (let i = 0; i < 15; i++) {
          const q = (p - 1.4) * .65 - i * .067;
          if (q < 0 || q > 1) continue;
          const at = onPath(points, q);
          ctx.fillStyle = '#59c6b1';
          ctx.strokeStyle = '#242322';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(at.x, at.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
      stamp(ctx.canvas, 'guided-soda-route');
    }
    const style = document.createElement('style');
    style.dataset.batch2IdleStyle = '';
    style.textContent = `
    html[data-batch2-idle=true] .idle-memory-deck{display:block}
    .idle-memory-deck{position:absolute;inset:0;display:none;overflow:hidden;pointer-events:none}
    .idle-memory-deck img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;animation:idle-memory-photo 7.2s linear infinite}
    .idle-memory-deck img:nth-child(2){animation-delay:-4.8s}.idle-memory-deck img:nth-child(3){animation-delay:-2.4s}
    .idle-clean-tool{display:none;position:absolute;z-index:5;left:var(--idle-clean-x,25%);top:var(--idle-clean-y,54%);width:76px;height:95px;pointer-events:none;transform:translate(-50%,-35%)}
    .idle-clean-tool>span{display:none;width:100%;height:100%}.idle-clean-tool img{width:100%;height:100%;object-fit:contain}
    html[data-batch2-idle=true] .idle-clean-tool{display:block}
    [data-idle-clean-tool=spray] .idle-clean-spray,[data-idle-clean-tool=brush] .idle-clean-brush,[data-idle-clean-tool=rinse] .idle-clean-rinse{display:block}
    html[data-batch2-idle=true] .video-window>img{visibility:hidden}
    @keyframes idle-memory-photo{0%,29%{opacity:1;transform:scale(1)}33%,96%{opacity:0;transform:scale(1.035)}100%{opacity:1;transform:scale(1)}}
    html[data-batch2-idle=true] .tool-swing{animation:idle-tool-hit 2.6s ease-in-out infinite!important;transform-origin:70% 75%}
    html[data-batch2-idle=true] .target-art{animation:idle-stick-react 2.6s ease-in-out infinite!important;transform-origin:50% 75%}
    @keyframes idle-tool-hit{0%,32%,100%{transform:translate(10px,5px) rotate(-25deg)}46%{transform:translate(-30px,-8px) rotate(-64deg)}55%,70%{transform:translate(6px,7px) rotate(-20deg)}}
    @keyframes idle-stick-react{0%,45%,72%,100%{transform:rotate(0) scale(1)}50%{transform:translate(-4px,2px) rotate(-3deg) scale(1.025,.97)}60%{transform:rotate(1.5deg) scale(.99,1.01)}}
    html[data-batch2-idle-paused=true] :is(.idle-memory-deck img,.tool-swing,.target-art){animation-play-state:paused!important}
    html[data-batch2-idle-reduced=true] :is(.idle-memory-deck img,.tool-swing,.target-art){animation:none!important}
    html[data-batch2-idle-reduced=true] .idle-memory-deck img:first-child{opacity:1}
  `;
    document.head.append(style);
    window.PlayableIdlePreview = Object.freeze({
      get active() {
        return preview && !document.hidden;
      },
      get preview() {
        return preview;
      },
      get reduced() {
        return reduced.matches;
      },
      get seconds() {
        return clock() / 1000;
      },
      clock,
      ease,
      clamp,
      stamp,
      trace,
      onPath,
      ant,
      army,
      blade,
      road,
      roadPose,
      soda,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
    });
    addEventListener('message', event => {
      if (parent === window || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
      const next = event.data.active !== true;
      if (next !== preview) {
        preview = next;
        elapsed = 0;
      }
      sync();
    });
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener?.('change', sync);
    addEventListener('pagehide', () => {
      preview = false;
      sync();
      listeners.clear();
    }, {
      once: true
    });
    sync();
  })();
  window.createGame = function (R) {
    const {
        ctx: c,
        spec: s
      } = R,
      a = s.assets,
      m = new window.Feeding(s.settings);
    let current = a.normal,
      previous = current,
      blend = 1,
      resultAge = 0,
      burst = 0;
    const guide = R.config.texts.find(t => t.id === 'GUIDE')?.value || "Tocca il piatto per dare da mangiare";
    function reset() {
      m.reset();
      current = previous = a.normal;
      blend = 1;
      resultAge = burst = 0;
      R.guide(guide);
      R.result('');
      R.setAction("Tocca il cibo nel piatto");
    }
    function lane() {
      const scale = R.w / 720;
      return {
        y: R.h * .70,
        k: scale,
        x: R.w / 2,
        plate: 270 * scale,
        food: 200 * s.settings.itemScale * scale
      };
    }
    function change(id) {
      if (id !== current) {
        previous = current;
        current = id;
        blend = 0;
      }
    }
    return {
      reset,
      state: () => ({
        state: m.state,
        remaining: m.remaining,
        weight: m.weight,
        hits: m.hits,
        reaction: m.reaction
      }),
      isPlaying: () => m.state === 'playing',
      action(p) {
        if (m.state === 'result') return;
        const l = lane();
        if (Math.abs(p.x - l.x) <= l.plate / 2 + 10 && Math.abs(p.y - l.y) <= l.plate / 2 + 10 && m.hitPlate()) {
          R.guide('', false);
          R.announce('Feeding');
        }
      },
      update(dt) {
        m.tick(dt);
        blend = Math.min(1, blend + dt / .18);
        burst = Math.max(0, burst - dt);
        if (m.state === 'result') resultAge += dt;
        for (const e of m.drain()) {
          if (e.type === 'eat') {
            R.tone(e.good ? 'good' : 'bad');
            burst = .5;
            R.announce(e.good ? "Boccone dato. Peso: " + m.weight + " libbre" : "Cibo sbagliato!");
          }
          if (e.type === 'result') {
            R.announce("Finito. Peso: " + m.weight + " libbre");
            R.result(m.weight + ' lb', "Hai dato " + m.hits + " bocconi");
          }
        }
        change(m.state === 'result' ? a.full : m.reaction === 'badFace' ? a.badFace : m.reaction === 'happy' ? a.happy : a.normal);
        R.hud(m.state === 'result' ? '' : m.weight + ' lb', m.state === 'result' ? '' : Math.ceil(m.remaining) + 's');
      },
      draw(t) {
        if (window.PlayableIdlePreview.active) {
          const time = window.PlayableIdlePreview.seconds,
            l = lane();
          R.photo(a.normal);
          R.sprite(a.plate, l.x, l.y, l.plate);
          // Use the real food lane, item spacing, size and left-to-right scroll speed.
          // Decorative wrapping does not feed, change the portrait or advance the round.
          const spacing = Math.max(1, s.settings.itemSpacing),
            travel = time * s.settings.scrollSpeed;
          const passed = Math.floor(travel / spacing),
            offset = travel - passed * spacing;
          const foods = [a.good[0], a.good[2], a.good[4], a.bad[0], a.good[1], a.good[3], a.good[5], a.bad[1]];
          const reach = Math.ceil((R.w / 2 + l.food) / Math.max(1, spacing * l.k)) + 1;
          for (let i = -reach; i <= reach; i++) {
            const x = l.x + (i * spacing + offset) * l.k;
            if (x + l.food / 2 < 0 || x - l.food / 2 > R.w) continue;
            const index = ((i - passed) % foods.length + foods.length) % foods.length;
            R.sprite(foods[index], x, l.y, l.food);
          }
          window.PlayableIdlePreview.stamp(R.canvas, 'horizontal-food-belt');
          return;
        }
        R.photo(previous);
        R.photo(current, R.reduced ? 1 : blend);
        if (m.state === 'result') return;
        const l = lane(),
          mouth = R.point(a.normal, s.photoPoints.mouth);
        R.sprite(a.plate, l.x, l.y, l.plate);
        if (m.state === 'waiting' && !R.reduced) {
          c.save();
          c.strokeStyle = '#ffd35b';
          c.lineWidth = 2;
          c.globalAlpha = .45 + .3 * Math.sin(t * 3);
          c.beginPath();
          c.arc(l.x, l.y, l.plate * .43 + 3 * Math.sin(t * 3), 0, Math.PI * 2);
          c.stroke();
          c.restore();
        }
        for (const item of m.items) {
          if (item.phase === 'gone') continue;
          const image = (item.good ? a.good : a.bad)[item.type];
          let x = l.x + item.x * l.k,
            y = l.y,
            w = l.food,
            rot = 0;
          if (item.phase === 'eating') {
            const p = R.ease(Math.min(1, item.age / s.settings.eatFlyDuration));
            x = R.mix(l.x + item.startX * l.k, mouth.x, p);
            y = R.mix(l.y, mouth.y, p) - Math.sin(p * Math.PI) * 45 * l.k;
            w *= 1 - p * .65;
            rot = p * .18;
          }
          R.sprite(image, x, y, w, null, rot);
        }
        if (burst > 0) {
          const p = 1 - burst / .5;
          c.save();
          c.globalAlpha = 1 - p;
          c.fillStyle = m.reaction === 'badFace' ? '#ffb55b' : '#fff';
          c.font = `700 ${20 * l.k * 1.8}px Poppins`;
          c.textAlign = 'center';
          c.fillText(m.reaction === 'badFace' ? "Ops!" : '+' + s.settings.lbPerHit + ' lb', mouth.x, mouth.y - 35 - p * 35);
          c.restore();
        }
      }
    };
  };
  (function () {
    'use strict';

    const el = id => document.getElementById(id),
      canvas = el('canvas'),
      ctx = canvas.getContext('2d', {
        alpha: false
      }),
      spec = window.GAME_SPEC;
    const images = {},
      config = {},
      hosted = new URLSearchParams(location.search).get('host') === 'fyp' || new URLSearchParams(location.search).get('feedReview') === '1';
    let running = false,
      hidden = false,
      hostActive = !hosted,
      paused = false,
      last = 0,
      age = 0,
      app;
    document.documentElement.dataset.feedPreview = String(hosted && !hostActive);
    const soundNodes = new Set(),
      voices = new Set();
    let ac;
    const R = window.Playable = {
      spec,
      images,
      ctx,
      canvas,
      w: 390,
      h: 598,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      config,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      mix: (a, b, p) => a + (b - a) * p,
      ease: p => 1 - Math.pow(1 - p, 3),
      cover(id) {
        const im = images[id],
          f = spec.photoFraming,
          s = Math.max(R.w / im.width, R.h / im.height) * (f?.zoom || 1),
          w = im.width * s,
          h = im.height * s;
        let y = f ? R.h * f.screenY - h * f.y : (R.h - h) / 2;
        if (f?.topLandmark !== undefined) y = Math.max(y, R.h * f.minTop - h * f.topLandmark);
        return {
          x: f ? R.clamp(R.w * .5 - w * f.x, R.w - w, 0) : (R.w - w) / 2,
          y: R.clamp(y, R.h - h, 0),
          w,
          h
        };
      },
      photo(id, alpha = 1) {
        const p = R.cover(id);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(images[id], p.x, p.y, p.w, p.h);
        ctx.restore();
        return p;
      },
      point(id, p) {
        const b = R.cover(id);
        return {
          x: b.x + b.w * p.x,
          y: b.y + b.h * p.y
        };
      },
      sprite(id, x, y, w, h, rotation = 0, alpha = 1, anchor = {
        x: .5,
        y: .5
      }) {
        const im = images[id];
        if (!im || !Number.isFinite(x + y + w)) return;
        h = h ?? w * im.height / im.width;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.globalAlpha = alpha;
        ctx.drawImage(im, -w * anchor.x, -h * anchor.y, w, h);
        ctx.restore();
      },
      frame(ids, t, duration, x, y, w, h, loop = false) {
        if (t < 0 || !loop && t >= duration) return;
        if (loop && R.reduced) t = duration * .5;
        const n = Math.min(ids.length - 1, Math.floor((loop ? t % duration : t) / duration * ids.length));
        R.sprite(ids[n], x, y, w, h);
      },
      hud(left = '', right = '', center = false) {
        el('left').textContent = left;
        el('right').textContent = right;
        el('hud').classList.toggle('center', center);
      },
      guide(text, show = true) {
        el('guide').textContent = text;
        el('guide').hidden = !show;
      },
      result(title, sub = '') {
        el('resultTitle').textContent = title;
        el('resultSub').textContent = sub;
        el('result').hidden = !title;
        el('retry').hidden = !title;
      },
      announce(text) {
        el('status').textContent = text;
      },
      unlock() {
        try {
          ac ??= new (window.AudioContext || window.webkitAudioContext)();
          if (ac.state === 'suspended') ac.resume().catch(() => {});
        } catch {}
      },
      tone(kind = 'good') {
        if (!ac || ac.state !== 'running') return;
        const now = ac.currentTime,
          o = ac.createOscillator(),
          g = ac.createGain();
        o.type = kind === 'bad' ? 'triangle' : 'sine';
        o.frequency.setValueAtTime(kind === 'bad' ? 230 : 650, now);
        o.frequency.exponentialRampToValueAtTime(kind === 'bad' ? 130 : 900, now + .12);
        g.gain.setValueAtTime(.0001, now);
        g.gain.exponentialRampToValueAtTime(0.2, now + .008);
        g.gain.exponentialRampToValueAtTime(.0001, now + .17);
        o.connect(g);
        g.connect(ac.destination);
        o.start();
        o.stop(now + .19);
        voices.add(o);
        o.onended = () => {
          voices.delete(o);
          o.disconnect();
          g.disconnect();
        };
      },
      sound(key, volume = .5, loop = false) {
        const path = spec.audio[key];
        if (!path) return null;
        const a = new Audio(path);
        a.volume = volume;
        a.loop = loop;
        soundNodes.add(a);
        a.addEventListener('ended', () => soundNodes.delete(a), {
          once: true
        });
        a.play().catch(() => {
          soundNodes.delete(a);
        });
        return a;
      },
      stop(a) {
        if (a) {
          a.pause();
          a.currentTime = 0;
          soundNodes.delete(a);
        }
      },
      silence() {
        for (const a of soundNodes) R.stop(a);
        for (const o of voices) {
          try {
            o.stop();
          } catch {}
        }
        voices.clear();
      },
      setAction(label) {
        el('play').setAttribute('aria-label', label);
      },
      releaseInput() {
        endPointer();
      },
      setDirection(show, fn) {
        el('direction').hidden = !show;
        el('direction').onclick = () => {
          if (paused || !hostActive) return;
          R.unlock();
          fn();
        };
      },
      debug: () => ({
        state: app?.state?.(),
        paused,
        hostActive,
        hidden,
        loaded: Object.keys(images).length,
        sounds: soundNodes.size
      })
    };
    function size() {
      const b = canvas.getBoundingClientRect();
      R.w = b.width;
      R.h = b.height;
      const d = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(b.width * d);
      canvas.height = Math.round(b.height * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      document.documentElement.style.setProperty('--ui', Math.min(b.width / 390, b.height / 598));
      app?.resize?.();
    }
    function reset() {
      endPointer();
      R.silence();
      paused = false;
      el('pause').hidden = true;
      R.result('');
      el('direction').hidden = true;
      app.reset();
      R.announce('Ready');
      if (running) app.draw(0);
      last = 0;
    }
    function point(e) {
      const b = canvas.getBoundingClientRect();
      return {
        x: e.clientX - b.left,
        y: e.clientY - b.top
      };
    }
    function canInput() {
      return running && !paused && hostActive && !hidden;
    }
    function action(e) {
      if (!canInput() || app.inputMode === 'drag') return;
      R.unlock();
      const p = e ? point(e) : {
        x: R.w / 2,
        y: R.h * .70
      };
      app.action(p);
    }
    let down = null;
    function endPointer() {
      const d = down;
      down = null;
      app?.pointerEnd?.();
      if (d && el('play').hasPointerCapture?.(d.id)) el('play').releasePointerCapture(d.id);
    }
    el('play').addEventListener('pointerdown', e => {
      if (e.isPrimary === false || e.button !== 0 || !canInput()) return;
      if (app.inputMode === 'drag') {
        R.unlock();
        if (!app.pointerStart(point(e))) return;
        e.preventDefault();
        down = {
          id: e.pointerId
        };
        el('play').setPointerCapture(e.pointerId);
        return;
      }
      down = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY
      };
    });
    el('play').addEventListener('pointermove', e => {
      if (app?.inputMode !== 'drag' || !down || e.pointerId !== down.id) return;
      if (!canInput() || e.buttons === 0) {
        endPointer();
        return;
      }
      e.preventDefault();
      app.pointerMove(point(e));
    });
    el('play').addEventListener('pointercancel', e => {
      if (down && e.pointerId === down.id) endPointer();
    });
    el('play').addEventListener('lostpointercapture', e => {
      if (down && e.pointerId === down.id) endPointer();
    });
    el('play').addEventListener('pointerup', e => {
      if (!down || e.pointerId !== down.id) return;
      const d = down;
      if (app.inputMode === 'drag') {
        endPointer();
        return;
      }
      down = null;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 18) return;
      action(e);
    });
    el('play').addEventListener('click', e => {
      if (e.detail === 0) action();
    });
    el('play').addEventListener('keydown', e => {
      if (!canInput() || !app.keyStroke || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      R.unlock();
      app.keyStroke(e.key);
    });
    el('retry').onclick = () => {
      R.unlock();
      reset();
    };
    el('resume').onclick = () => {
      R.unlock();
      paused = false;
      el('pause').hidden = true;
      app.resume?.();
      last = 0;
    };
    function pause() {
      endPointer();
      R.silence();
      app?.pause?.();
      if (running && app?.isPlaying?.()) {
        paused = true;
        el('pause').hidden = false;
      }
    }
    document.addEventListener('visibilitychange', () => {
      hidden = document.hidden;
      if (hidden) pause();
      last = 0;
    });
    window.addEventListener('blur', pause);
    window.addEventListener('resize', size);
    // Only the parent frame can control activity; never accept commands from sibling windows.
    window.addEventListener('message', e => {
      if (e.source !== parent || parent === window) return;
      const d = e.data;
      if (d?.type === 'playable-active' && typeof d.active === 'boolean') {
        hostActive = d.active;
        document.documentElement.dataset.feedPreview = String(!hostActive);
        if (!hostActive && running) {
          pause();
          reset();
        }
        last = 0;
      }
    });
    function palette() {
      if (parent === window) return;
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 48;
      const x = c.getContext('2d');
      x.drawImage(canvas, 0, 0, 32, 48);
      try {
        parent.postMessage({
          type: 'playable-palette',
          top: Array.from(x.getImageData(0, 0, 32, 12).data),
          bottom: Array.from(x.getImageData(0, 36, 32, 12).data)
        }, location.origin);
      } catch {}
    }
    function loop(t) {
      requestAnimationFrame(loop);
      if (!running || hidden || paused) {
        last = 0;
        return;
      }
      const dt = last ? Math.min(.05, (t - last) / 1000) : 0;
      last = t;
      age += dt;
      if (hostActive) app.update(dt);else app.previewUpdate?.(dt);
      app.draw(age);
      const state = app.state?.().state;
      if (el('stage').dataset.state !== state) el('stage').dataset.state = state;
    }
    async function boot() {
      try {
        const c = await fetch('./game.config.json', {
          cache: 'no-store'
        }).then(r => {
          if (!r.ok) throw Error("Impossibile caricare la configurazione");
          return r.json();
        });
        Object.assign(config, c);
        for (const t of c.tweaks || []) {
          if (typeof t.value === 'number' && Number.isFinite(t.value)) spec.settings[t.id] = R.clamp(t.value, t.min ?? -Infinity, t.max ?? Infinity);
        }
        await Promise.all(c.images.map(async slot => {
          if (!slot.path || /^(https?:|data:)/.test(slot.path)) throw Error("L'immagine deve usare un percorso locale relativo: " + slot.id);
          const im = new Image();
          im.src = slot.path;
          await im.decode();
          images[slot.id] = im;
        }));
        await document.fonts.ready;
        document.title = spec.title;
        el('stage').className = spec.id;
        app = window.createGame(R);
        size();
        reset();
        running = true;
        el('loading').hidden = true;
        app.draw(0);
        document.documentElement.dataset.playableLoading = 'false';
        palette();
        requestAnimationFrame(loop);
      } catch (e) {
        el('loading').classList.add('error');
        el('loading').textContent = "Impossibile caricare il gioco. " + e.message;
        console.error(e);
      }
    }
    boot();
  })();

  /* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
  (() => {
    const selectors = ["p#guide"],
      copy = new Set(["Tocca il piatto per dare da mangiare"].map(s => s.replace(/\s+/g, ' ').trim().toLowerCase()));
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)'),
      running = new Map();
    let queued = false,
      visible = true;
    const action = /^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
    function scan() {
      queued = false;
      for (const [el, a] of running) if (!el.isConnected) {
        a.cancel();
        running.delete(el);
      }
      if (motion.matches) {
        for (const a of running.values()) a.cancel();
        running.clear();
        return;
      }
      const targets = new Set();
      for (const selector of selectors) {
        try {
          document.querySelectorAll(selector).forEach(el => targets.add(el));
        } catch {}
      }
      for (const el of document.querySelectorAll('p,span,div,label,text')) {
        if (el.children.length || el.closest('button,a,input,select,textarea,[role="button"]')) continue;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(el);
      }
      for (const el of targets) {
        if (running.has(el) || typeof el.animate !== 'function') continue;
        if ([...targets].some(child => child !== el && el.contains(child))) continue;
        const style = getComputedStyle(el);
        if (/breath/i.test(style.animationName)) continue;
        const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim(),
          filter = v => (base ? base + ' ' : '') + 'opacity(' + v + ')';
        const a = el.animate([{
          filter: filter(1)
        }, {
          filter: filter(.65)
        }, {
          filter: filter(1)
        }], {
          duration: 2400,
          iterations: Infinity,
          easing: 'ease-in-out'
        });
        running.set(el, a);
        if (document.hidden || !visible) a.pause();
      }
    }
    const schedule = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(scan);
      }
    };
    const pause = () => {
      for (const a of running.values()) document.hidden || !visible ? a.pause() : a.play();
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      visible = entries.some(e => e.isIntersecting);
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
      for (const a of running.values()) a.cancel();
      running.clear();
    }, {
      once: true
    });
  })();
}
function App() {
  React.useEffect(() => {
    startGame();
  }, []);
  return <><main {...{
      "id": "stage"
    }}><canvas {...{
        "id": "canvas",
        "aria-hidden": "true"
      }}></canvas><button {...{
        "id": "play",
        "aria-label": "Gioca"
      }}></button><div {...{
        "id": "hud",
        "className": "hud",
        "aria-hidden": "true"
      }}><span {...{
          "id": "left"
        }}></span><span {...{
          "id": "right"
        }}></span></div><p {...{
        "id": "guide"
      }}></p><div {...{
        "id": "result",
        "hidden": true
      }}><span {...{
          "id": "resultTitle"
        }}></span><small {...{
          "id": "resultSub"
        }}></small></div><div {...{
        "className": "controls"
      }}><button {...{
          "id": "retry",
          "className": "control",
          "hidden": true
        }}>{"Again"}</button><button {...{
          "id": "direction",
          "className": "control",
          "hidden": true,
          "aria-label": "Cambia direzione di rasatura"
        }}><svg {...{
            "viewBox": "0 0 24 24",
            "fill": "none",
            "stroke": "currentColor",
            "strokeWidth": "2",
            "aria-hidden": "true"
          }}><path {...{
              "d": "M6 17V4m-3 3 3-3 3 3m9 0v13m-3-3 3 3 3-3"
            }}></path></svg><span>{"Direction"}</span></button></div><div {...{
        "id": "pause",
        "hidden": true
      }}><button {...{
          "id": "resume"
        }}>{"Tocca per continuare"}</button></div><div {...{
        "id": "loading",
        "role": "status"
      }}>{"Caricamento…"}</div><div {...{
        "id": "status",
        "role": "status",
        "aria-live": "polite",
        "className": "sr"
      }}></div></main></>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<><style>{PACKAGE_HTML_STYLES}</style>{<App />}</>);
