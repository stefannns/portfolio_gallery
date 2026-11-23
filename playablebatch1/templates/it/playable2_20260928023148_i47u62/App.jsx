/* Font redistribution notices, preserved in the editable source.
Font license notice: dynapuff
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
document.documentElement.lang = "it";
// Editable Batch 2 game. Rebuild using the platform app/h5_build/build.js.
const PACKAGE_CONFIG_FALLBACK = {
  "tweaks": [{
    "id": "ENEMY_SPAWN_INTERVAL",
    "kind": "number",
    "label": "Enemy Spawn Interval",
    "value": 1500,
    "default": 1500,
    "min": 500,
    "max": 3000,
    "step": 100
  }, {
    "id": "MAX_ENEMIES",
    "kind": "number",
    "label": "Max Enemies",
    "value": 40,
    "default": 40,
    "min": 10,
    "max": 100,
    "step": 5
  }, {
    "id": "PLAYER_SPEED",
    "kind": "number",
    "label": "Player Speed",
    "value": 0.15,
    "default": 0.15,
    "min": 0.05,
    "max": 0.3,
    "step": 0.01
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Comanda l'esercito",
    "default": "Comanda l'esercito",
    "max_length": 30
  }, {
    "id": "TXT_VICTORY",
    "label": "Victory Text",
    "value": "VITTORIA",
    "default": "VITTORIA",
    "max_length": 20
  }, {
    "id": "TXT_TRY_AGAIN",
    "label": "Try Again Button",
    "value": "Riprova",
    "default": "Riprova",
    "max_length": 20
  }, {
    "id": "TXT_POST",
    "label": "Post Button",
    "value": "Pubblica la partita",
    "default": "Pubblica la partita",
    "max_length": 20
  }, {
    "id": "TXT_ALL_CLEARED",
    "label": "Victory Subtext",
    "value": "Nemici sconfitti!",
    "default": "Nemici sconfitti!",
    "max_length": 50
  }],
  "images": [{
    "id": "UI_DEFEAT_PANEL",
    "label": "Defeat Panel",
    "path": "./assets/ui_defeat_panel.png",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const PACKAGE_HTML_STYLES = "\n    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }\n    body { background: #f5f4ef; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }\n    #root { isolation: isolate; }\n    canvas { touch-action: none; }\n    button, input, select, textarea { touch-action: manipulation; }\n  \n\n@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.68}}\n.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}\n.feed-first-action[aria-hidden=\"true\"]{animation:none}\nhtml[data-feed-background] .feed-first-action{animation-play-state:paused}\n@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}\n\n/* User decision 2026-11-02: use the higher Batch 1 guide position. */\nhtml:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.feed-first-action{position:fixed!important;top:26%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}\nhtml:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.feed-first-action{color:#38474e!important;text-shadow:none!important}\n\n\nhtml[data-batch2-idle=\"true\"] [data-preview-hud]{visibility:hidden!important}\n";
// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
function QP(t) {
  let e = {};
  return (t.tweaks || []).forEach(r => {
    e[r.id] = r.value;
  }), (t.texts || []).forEach(r => {
    e[r.id] = r.value;
  }), (t.images || []).forEach(r => {
    e[r.id] = r.path;
  }), (t.mentions || []).forEach(r => {
    e[r.id] = r.path != null && r.path !== "" ? r.path : r.value;
  }), (t.motions || []).forEach(r => {
    !r || !r.id || (r.base_path != null && r.base_path !== "" && (e[r.id] = r.base_path, e[r.id + "_BASE"] = r.base_path), r.frame_count != null && (e[r.id + "_COUNT"] = r.frame_count));
  }), e;
}
var IT = Tone.getContext().destination;
function useGameFeature1() {
  let t = typeof window < "u" && typeof window.tt < "u" && typeof window.tt.playableRecordingSubmission == "function",
    [e, r] = React.useState(false);
  React.useEffect(() => {
    let o = () => r(false),
      l = () => {
        document.visibilityState === "visible" && o();
      };
    return document.addEventListener("visibilitychange", l), window.addEventListener("pageshow", o), () => {
      document.removeEventListener("visibilitychange", l), window.removeEventListener("pageshow", o);
    };
  }, []);
  let a = React.useCallback(() => {
    e || !t || (r(true), window.tt.playableRecordingSubmission({
      success() {},
      fail(o) {
        console.error("[post_my_play] playableRecordingSubmission failed", o && (o.errMsg || o.message)), r(false);
      },
      complete() {}
    }));
  }, [e, t]);
  return {
    canSubmit: t,
    submitting: e,
    submitRecording: a
  };
}
function GP() {
  return <style>{`
    @font-face {
      font-family: 'DynaPuff';
      src: url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');
      font-weight: 600;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "DynaPuff", "Trebuchet MS", sans-serif;
      --font-body:    "DynaPuff", "Trebuchet MS", sans-serif;
      --font-mono:    "DynaPuff", "Trebuchet MS", sans-serif;
      --color-bg:     #e5f5d8;
      --color-player: #167a61;
      --color-enemy:  #ec625a;
    }
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: var(--color-bg); font-family: var(--font-body); }
    * { box-sizing: border-box; touch-action: none; user-select: none; -webkit-user-drag: none; }
    button { font-family: var(--font-body); }
  `}</style>;
}
function KP({
  cfg: t
}) {
  let e = React.useRef(null),
    r = React.useRef(null),
    a = React.useRef(null),
    o = React.useRef(null),
    l = React.useRef(performance.now()),
    [u, h] = React.useState("playing"),
    [d, p] = React.useState(null),
    [v, g] = React.useState({
      current: 0,
      total: t.MAX_ENEMIES
    }),
    y = React.useRef({
      entities: [],
      particles: [],
      enemySpawned: 0,
      playerTarget: null,
      dragging: false,
      gameState: "playing"
    }),
    _ = React.useRef(0),
    w = React.useRef(0),
    S = React.useRef({
      ready: false,
      synthShoot: null,
      synthHit: null,
      synthWin: null,
      synthLose: null,
      lastTime: {},
      lastShootReal: 0
    }),
    x = async () => {
      if (!S.current.ready) try {
        await Tone.start();
        let T = S.current;
        T.synthShoot = new Tone.PolySynth(Tone.Synth).toDestination(), T.synthShoot.volume.value = -12, T.synthHit = new Tone.MembraneSynth().toDestination(), T.synthHit.volume.value = -15, T.synthWin = new Tone.PolySynth(Tone.Synth).toDestination(), T.synthWin.volume.value = -8, T.synthLose = new Tone.MembraneSynth().toDestination(), T.synthLose.volume.value = -8, IT.volume.value = -5, T.ready = true;
      } catch (T) {
        console.warn("Audio init failed", T);
      }
    },
    C = React.useCallback(T => {
      let M = S.current,
        B = Tone.now(),
        k = M.lastTime[T] || 0,
        U = B > k ? B : k + .001;
      return M.lastTime[T] = U, U;
    }, []),
    R = React.useCallback(() => {
      if (!S.current.ready) return;
      let T = Date.now();
      T - S.current.lastShootReal < 60 || (S.current.lastShootReal = T, S.current.synthShoot.triggerAttackRelease("G5", "32n", C("shoot")));
    }, [C]),
    D = React.useCallback(() => {
      S.current.ready && S.current.synthWin.triggerAttackRelease(["C4", "E4", "G4", "C5"], "2n", Tone.now());
    }, []),
    F = React.useCallback(() => {
      S.current.ready && S.current.synthLose.triggerAttackRelease("G2", "2n", Tone.now());
    }, []),
    A = React.useCallback(() => {
      if (N.current = false, P(false), y.current = {
        entities: [],
        particles: [],
        enemySpawned: 0,
        neutralTotal: 0,
        neutralCap: 9,
        neutralPending: 0,
        neutralNextAt: 0,
        playerTarget: null,
        dragging: false,
        gameState: "playing"
      }, e.current) {
        let T = e.current.clientWidth,
          M = e.current.clientHeight;
        for (let B = 0; B < 15; B++) y.current.entities.push({
          id: Math.random(),
          team: "player",
          x: T / 2 + (Math.random() - .5) * 80,
          y: M / 2 + 150 + (Math.random() - .5) * 80,
          r: 8,
          hp: 30,
          maxHp: 30,
          speed: t.PLAYER_SPEED || .12,
          atkDamage: 5,
          atkRange: 40,
          atkCooldown: 600,
          lastAtk: 0
        });
        y.current.neutralTotal = 3, y.current.entities.push(...[[.25, .56], [.75, .47], [.52, .33]].map(([B, k]) => ({
          id: Math.random(),
          team: "player",
          x: T * B,
          y: M * k,
          r: 8,
          hp: 75,
          maxHp: 75,
          speed: 0,
          atkDamage: 0,
          atkRange: 0,
          atkCooldown: 600,
          lastAtk: 0,
          __neutralTroop: true,
          recruited: false
        })));
      }
      h("playing"), p(null), g({
        current: 0,
        total: t.MAX_ENEMIES
      }), _.current = 0, w.current = 0, l.current = performance.now();
    }, [t]),
    [I, P] = React.useState(false),
    N = React.useRef(false);
  React.useEffect(() => {
    A();
  }, [A]);
  let X = React.useCallback(T => {
      let M = y.current;
      if (!e.current || M.gameState !== "playing") return;
      let B = e.current.clientWidth,
        k = e.current.clientHeight;
      if (_.current += T, M.enemySpawned < t.MAX_ENEMIES && _.current - w.current > t.ENEMY_SPAWN_INTERVAL) {
        w.current = _.current;
        for (let H = 0; H < 2 && !(M.enemySpawned >= t.MAX_ENEMIES); H++) M.entities.push({
          id: Math.random(),
          team: "enemy",
          x: Math.random() * B,
          y: -20,
          r: 8,
          hp: 20,
          maxHp: 20,
          speed: .08,
          atkDamage: 5,
          atkRange: 40,
          atkCooldown: 800,
          lastAtk: 0
        }), M.enemySpawned++;
      }
      let U = Date.now();
      for (let H of M.entities) H.__neutralTroop && !H.recruited && M.entities.some(oe => oe.team === "player" && !oe.__neutralTroop && oe.hp > 0 && Math.hypot(oe.x - H.x, oe.y - H.y) <= 42) && (H.recruited = true, H.speed = t.PLAYER_SPEED || .12, H.atkDamage = 5, H.atkRange = 40, H.hp = H.maxHp, M.neutralTotal + M.neutralPending < M.neutralCap && (M.neutralPending++, M.neutralNextAt || (M.neutralNextAt = _.current + 4e3)));
      if (M.neutralPending > 0 && M.neutralTotal < M.neutralCap && _.current >= M.neutralNextAt && M.entities.filter(H => H.__neutralTroop && !H.recruited && H.hp > 0).length < 3) {
        let H = null;
        for (let oe = 0; oe < 32; oe++) {
          let te = 45 + Math.random() * Math.max(1, B - 90),
            de = 90 + Math.random() * Math.max(1, k - 150);
          if (!M.entities.some(be => be.hp > 0 && Math.hypot(be.x - te, be.y - de) < (be.__neutralTroop && !be.recruited ? 60 : be.team === "player" ? 100 : 35))) {
            H = {
              x: te,
              y: de
            };
            break;
          }
        }
        H ? (M.entities.push({
          id: Math.random(),
          team: "player",
          x: H.x,
          y: H.y,
          r: 8,
          hp: 75,
          maxHp: 75,
          speed: 0,
          atkDamage: 0,
          atkRange: 0,
          atkCooldown: 600,
          lastAtk: 0,
          __neutralTroop: true,
          recruited: false
        }), M.neutralTotal++, M.neutralPending--, M.neutralNextAt = M.neutralPending ? _.current + 4e3 : 0) : M.neutralNextAt = _.current + 500;
      }
      for (let H of M.entities) {
        if (H.hp <= 0 || H.__neutralTroop && !H.recruited) continue;
        let oe = null,
          te = 1 / 0;
        for (let de of M.entities) if (de.team !== H.team && de.hp > 0 && (!de.__neutralTroop || de.recruited)) {
          let be = de.x - H.x,
            Pe = de.y - H.y,
            zt = Math.sqrt(be * be + Pe * Pe);
          zt < te && (te = zt, oe = de);
        }
        if (oe && te <= H.atkRange) {
          if (U - H.lastAtk > H.atkCooldown) {
            oe.hp -= H.atkDamage, H.lastAtk = U;
            for (let de = 0; de < 3; de++) M.particles.push({
              x: oe.x,
              y: oe.y,
              vx: (Math.random() - .5) * .6,
              vy: (Math.random() - .5) * .6,
              life: 300,
              maxLife: 300,
              color: "#ffaa00"
            });
            R();
          }
        } else if (H.team === "enemy" && oe && (H.targetPos = {
          x: oe.x,
          y: oe.y
        }), H.team === "player" && M.playerTarget && (H.targetPos = M.playerTarget), H.targetPos) {
          let de = H.targetPos.x - H.x,
            be = H.targetPos.y - H.y,
            Pe = Math.sqrt(de * de + be * be);
          Pe > H.speed * T ? (H.x += de / Pe * H.speed * T, H.y += be / Pe * H.speed * T) : (H.x = H.targetPos.x, H.y = H.targetPos.y, H.team === "player" && (H.targetPos = null));
        }
        H.x = Math.max(H.r, Math.min(B - H.r, H.x)), H.y = Math.max(H.r, Math.min(k - H.r, H.y));
      }
      for (let H = 0; H < M.entities.length; H++) for (let oe = H + 1; oe < M.entities.length; oe++) {
        let te = M.entities[H],
          de = M.entities[oe];
        if (te.hp <= 0 || de.hp <= 0) continue;
        let be = te.x - de.x,
          Pe = te.y - de.y,
          zt = be * be + Pe * Pe,
          Br = te.r + de.r;
        if (zt < Br * Br && zt > .001) {
          let se = Math.sqrt(zt),
            ye = (Br - se) * .5,
            rt = be / se,
            He = Pe / se;
          te.x += rt * ye, te.y += He * ye, de.x -= rt * ye, de.y -= He * ye;
        }
      }
      for (let H = M.particles.length - 1; H >= 0; H--) {
        let oe = M.particles[H];
        oe.x += oe.vx * T, oe.y += oe.vy * T, oe.life -= T, oe.life <= 0 && M.particles.splice(H, 1);
      }
      M.entities = M.entities.filter(H => H.hp > 0);
      let ue = M.entities.filter(H => H.team === "player" && (!H.__neutralTroop || H.recruited)).length,
        J = M.entities.filter(H => H.team === "enemy").length;
      ue === 0 ? (M.gameState = "over", F(), p("lose"), h("over")) : M.enemySpawned >= t.MAX_ENEMIES && J === 0 && (M.gameState = "over", D(), p("win"), h("over")), g(H => {
        let oe = M.enemySpawned - J;
        return H.current !== oe ? {
          current: oe,
          total: t.MAX_ENEMIES
        } : H;
      });
    }, [t, R, D, F]),
    Y = React.useCallback(() => {
      let T = a.current;
      if (!T || !e.current) return;
      let M = e.current.clientWidth,
        B = e.current.clientHeight;
      T.clearRect(0, 0, M, B);
      let k = window.PlayableIdlePreview.active ? window.PlayableIdlePreview.army(y.current, M, B) : y.current;
      window.PlayableIdlePreview.stamp(r.current, "troop-command"), k.playerTarget && (T.save(), T.translate(k.playerTarget.x, k.playerTarget.y), T.strokeStyle = "rgba(22,122,97,.3)", T.lineWidth = 2, T.beginPath(), T.arc(0, 0, 14, 0, Math.PI * 2), T.stroke(), T.fillStyle = "#167a61", T.beginPath(), T.moveTo(0, 10), T.bezierCurveTo(-2, 7, -7, 2, -7, -3), T.arc(0, -3, 7, Math.PI, 0), T.bezierCurveTo(7, 2, 2, 7, 0, 10), T.closePath(), T.fill(), T.fillStyle = "#e5f5d8", T.beginPath(), T.arc(0, -3, 2.5, 0, Math.PI * 2), T.fill(), T.restore());
      for (let U of k.entities) if (T.fillStyle = U.__neutralTroop && !U.recruited ? "#b6c7bc" : U.team === "player" ? "#167a61" : "#ec625a", T.beginPath(), T.arc(U.x, U.y, U.r, 0, Math.PI * 2), T.fill(), U.__neutralTroop && !U.recruited && (T.strokeStyle = "#8da69c", T.lineWidth = 1.5, T.stroke()), U.hp < U.maxHp) {
        let ue = U.r * 2.5,
          J = 3,
          H = U.x - ue / 2,
          oe = U.y - U.r - 6;
        T.fillStyle = "rgba(0,0,0,0.4)", T.fillRect(H, oe, ue, J), T.fillStyle = U.team === "player" ? "#43c6a0" : "#ec625a", T.fillRect(H, oe, ue * (U.hp / U.maxHp), J);
      }
      for (let U of k.particles) T.fillStyle = U.color, T.globalAlpha = Math.max(0, U.life / U.maxLife), T.beginPath(), T.arc(U.x, U.y, 2, 0, Math.PI * 2), T.fill(), T.globalAlpha = 1;
    }, []),
    z = React.useCallback(() => {
      o.current = requestAnimationFrame(z);
      let T = performance.now(),
        M = T - l.current;
      M > 100 && (M = 16), l.current = T, y.current.gameState === "playing" && (!window.PlayableIdlePreview.preview && !document.hidden && N.current && X(M), Y());
    }, [X, Y]);
  React.useEffect(() => {
    let T = new ResizeObserver(M => {
      for (let B of M) {
        let {
            width: k,
            height: U
          } = B.contentRect,
          ue = window.devicePixelRatio || 1;
        r.current && k > 0 && U > 0 && (r.current.width = k * ue, r.current.height = U * ue, r.current.style.width = k + "px", r.current.style.height = U + "px", a.current = r.current.getContext("2d"), a.current.scale(ue, ue));
      }
    });
    return e.current && T.observe(e.current), o.current = requestAnimationFrame(z), () => {
      T.disconnect(), cancelAnimationFrame(o.current);
    };
  }, [z]);
  let Q = T => {
      if (!r.current) return;
      N.current = true, P(true);
      let M = r.current.getBoundingClientRect();
      y.current.playerTarget = {
        x: T.clientX - M.left,
        y: T.clientY - M.top
      };
    },
    ee = T => {
      var M, B;
      T.isPrimary !== false && (x(), u === "playing" && (y.current.dragging = true, (B = (M = T.currentTarget).setPointerCapture) == null || B.call(M, T.pointerId), Q(T)));
    },
    ie = T => {
      T.isPrimary === false || !y.current.dragging || u !== "playing" || Q(T);
    },
    le = T => {
      var M, B;
      T.isPrimary !== false && (y.current.dragging = false, (B = (M = T.currentTarget).hasPointerCapture) != null && B.call(M, T.pointerId) && T.currentTarget.releasePointerCapture(T.pointerId));
    },
    {
      canSubmit: re,
      submitting: $,
      submitRecording: V
    } = useGameFeature1();
  return <div ref={e} style={{
    width: "100%",
    height: "100%",
    position: "relative",
    containerType: "size",
    background: "#e5f5d8",
    backgroundSize: "72px 72px,54px 54px,100% 100%"
  }}>{<GP />}{!I && u === "playing" && <p className={"feed-first-action"} style={{
      position: "absolute",
      top: "26%",
      left: 30,
      right: 30,
      zIndex: 12,
      margin: 0,
      fontFamily: "var(--font-display)",
      fontWeight: 600,
      fontSize: 18,
      lineHeight: 1.35,
      textAlign: "center",
      pointerEvents: "none",
      color: "#252627"
    }}>{"Trascina per guidare le truppe"}</p>}{<canvas ref={r} style={{
      position: "relative",
      zIndex: 1,
      width: "100%",
      height: "100%",
      display: "block"
    }} onPointerDown={ee} onPointerMove={ie} onPointerUp={le} onPointerCancel={le} />}{<div style={{
      position: "absolute",
      zIndex: 2,
      top: "calc(30px + env(safe-area-inset-top, 0px))",
      left: "30px",
      right: "30px",
      pointerEvents: "none",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }}>{<div style={{
        margin: "0 auto",
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        borderRadius: "22px",
        padding: "8px 18px",
        fontFamily: "var(--font-mono)",
        color: "#252627",
        fontSize: "18px",
        fontWeight: 700,
        border: "0",
        boxShadow: "none"
      }} data-preview-hud={"enemy-count"} aria-label={"Nemici rimasti " + Math.max(0, v.total - v.current)}>{<span style={{
          fontSize: 14,
          marginRight: 8
        }}>{"Enemies"}</span>}{<span style={{
          fontSize: 28,
          lineHeight: 1.2
        }}>{Math.max(0, v.total - v.current)}</span>}</div>}</div>}{<Motion.AnimatePresence>{u === "over" && <Motion.motion.div initial={{
        opacity: 0,
        scale: .95
      }} animate={{
        opacity: 1,
        scale: 1
      }} exit={{
        opacity: 0,
        scale: .95
      }} style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(16,61,48,0.72)",
        backdropFilter: "blur(6px)",
        padding: "calc(40px + env(safe-area-inset-top, 0px)) 25px calc(40px + env(safe-area-inset-bottom, 0px))",
        boxSizing: "border-box"
      }}>{d === "lose" ? <div style={{
          width: "min(82%, 420px)",
          padding: "clamp(24px, 7vw, 40px)",
          background: "#e5f5d8",
          borderRadius: "28px",
          border: "2px solid rgba(239,68,68,.18)",
          textAlign: "center",
          marginBottom: "32px",
          boxShadow: "0 24px 70px rgba(0,0,0,.28)"
        }}>{<div style={{
            width: "72px",
            height: "72px",
            margin: "0 auto 18px",
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "rgba(239,68,68,.12)",
            color: "#d84348",
            fontSize: "42px",
            fontWeight: 900
          }}>{"!"}</div>}{<h1 style={{
            fontFamily: "var(--font-display)",
            color: "#d84348",
            fontSize: "clamp(36px, 10vw, 48px)",
            lineHeight: 1,
            margin: 0
          }}>{"SCONFITTA"}</h1>}{<p style={{
            fontFamily: "var(--font-body)",
            color: "#475569",
            fontSize: "18px",
            lineHeight: 1.45,
            margin: "14px 0 0"
          }}>{"Il tuo esercito è stato sconfitto."}</p>}</div> : <div style={{
          width: "min(82%, 420px)",
          padding: "clamp(24px, 7vw, 40px)",
          background: "#e5f5d8",
          borderRadius: "28px",
          textAlign: "center",
          marginBottom: "32px",
          boxShadow: "0 24px 70px rgba(0,0,0,.28)"
        }}>{<h1 style={{
            fontFamily: "var(--font-display)",
            color: "#167a61",
            fontSize: "clamp(36px, 10vw, 48px)",
            lineHeight: 1,
            margin: 0
          }}>{t.TXT_VICTORY}</h1>}{<p style={{
            fontFamily: "var(--font-body)",
            color: "#4a5568",
            fontSize: "18px",
            lineHeight: 1.45,
            margin: "14px 0 0"
          }}>{t.TXT_ALL_CLEARED}</p>}</div>}{<div style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          justifyContent: "center",
          width: "100%",
          padding: "0 20px"
        }}>{<button onClick={A} style={{
            flex: "1 1 auto",
            minWidth: "130px",
            padding: "16px 20px",
            fontFamily: "var(--font-body)",
            fontSize: "18px",
            fontWeight: "bold",
            color: "white",
            backgroundColor: "#167a61",
            border: "none",
            borderRadius: "32px",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(22,122,97,0.22)"
          }}>{t.TXT_TRY_AGAIN}</button>}{re && <button onClick={V} disabled={$} style={{
            flex: "1 1 auto",
            minWidth: "130px",
            padding: "16px 20px",
            fontFamily: "var(--font-body)",
            fontSize: "18px",
            fontWeight: "bold",
            color: "white",
            backgroundColor: "#ec625a",
            border: "none",
            borderRadius: "32px",
            cursor: $ ? "not-allowed" : "pointer",
            opacity: $ ? .6 : 1,
            boxShadow: "0 4px 12px rgba(236,98,90,0.22)"
          }}>{t.TXT_POST}</button>}</div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>;
}
function App() {
  let [t, e] = React.useState(null);
  return React.useEffect(() => {
    let r = true;
    return (async () => {
      let a = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let o = await fetch("./game.config.json", {
          cache: "no-store"
        });
        o.ok && (a = await o.json());
      } catch {}
      r && e(QP(a));
    })(), () => {
      r = false;
    };
  }, []), t ? <KP cfg={t} /> : <div style={{
    width: "100%",
    height: "100%",
    background: "#e5f5d8"
  }} />;
}
(() => {
  (() => {
    "use strict";

    var ao;
    if (window.PlayableIdlePreview) return;
    let ft = new URLSearchParams(location.search),
      Tt = ft.get("feedReview") === "1" || ft.get("host") === "fyp",
      We = matchMedia("(prefers-reduced-motion: reduce)"),
      Be = Tt,
      Ct = 0,
      Nt = performance.now(),
      Jt = new Set(),
      Ne = () => {
        let G = document.documentElement;
        if (G.dataset.batch2Idle = String(Be), G.dataset.batch2IdlePaused = String(document.hidden), G.dataset.batch2IdleReduced = String(We.matches), !Be) for (let Se of document.querySelectorAll("[data-idle-preview]")) Se.dataset.idlePreview = "off";
        Nt = performance.now();
        for (let Se of Jt) Se(Be && !document.hidden);
      },
      Wt = () => {
        let G = performance.now();
        return Be && !document.hidden && !We.matches && (Ct += Math.min(64, Math.max(0, G - Nt))), Nt = G, We.matches ? 1600 : Ct;
      },
      he = (G, Se = 0, Ue = 1) => Math.max(Se, Math.min(Ue, G)),
      Xe = G => (G = he(G), G * G * (3 - 2 * G)),
      _e = (G, Se, Ue = 1) => {
        if (!Se.length) return;
        let $e = Se.slice(1).map((Ae, De) => Math.hypot(Ae.x - Se[De].x, Ae.y - Se[De].y)),
          Te = $e.reduce((Ae, De) => Ae + De, 0) * he(Ue);
        G.beginPath(), G.moveTo(Se[0].x, Se[0].y);
        for (let Ae = 1; Ae < Se.length; Ae++) {
          let De = Se[Ae - 1],
            ke = Se[Ae],
            Oe = $e[Ae - 1],
            ut = Math.min(1, Te / Math.max(.01, Oe));
          if (G.lineTo(De.x + (ke.x - De.x) * ut, De.y + (ke.y - De.y) * ut), Te -= Oe, Te <= 0) break;
        }
        G.stroke();
      },
      yn = (G, Se) => {
        let Ue = G.slice(1).map((Te, Ae) => Math.hypot(Te.x - G[Ae].x, Te.y - G[Ae].y)),
          $e = Ue.reduce((Te, Ae) => Te + Ae, 0) * he(Se);
        for (let Te = 1; Te < G.length; Te++) {
          let Ae = G[Te - 1],
            De = G[Te],
            ke = Ue[Te - 1];
          if ($e <= ke || Te === G.length - 1) {
            let Oe = he($e / Math.max(.01, ke));
            return {
              x: Ae.x + (De.x - Ae.x) * Oe,
              y: Ae.y + (De.y - Ae.y) * Oe
            };
          }
          $e -= ke;
        }
        return G[0];
      },
      li = (G, Se, Ue = Wt()) => {
        G && (G.dataset.idlePreview = Be ? Se : "off", G.dataset.idlePhase = String(Math.round(Ue)));
      };
    function Tu(G, Se, Ue, $e) {
      let Te = Wt() / 1e3,
        Ae = Te % 5.4 / 5.4,
        De = Se * .5,
        ke = Ue * .51,
        Oe = Math.min(Se * .29, 105),
        ut = Math.min(Ue * .16, 78),
        Ve = Array.from({
          length: 81
        }, (Et, At) => ({
          x: De + Math.cos(At / 80 * Math.PI * 2) * Oe,
          y: ke + Math.sin(At / 80 * Math.PI * 2) * ut
        }));
      G.save(), G.lineWidth = 5, G.lineCap = "round", G.lineJoin = "round", G.strokeStyle = "#242322", G.globalAlpha = Ae > .88 ? (1 - Ae) / .12 : 1, _e(G, Ve, Xe(Ae / .48));
      let Ge = De + Math.sin(Te * 2.1) * Oe * .63,
        Re = ke + Math.sin(Te * 2.8) * ut * .59;
      if (G.translate(Ge, Re), G.rotate(Math.atan2(Math.cos(Te * 2.8) * ut, Math.cos(Te * 2.1) * Oe) + Math.PI / 2), $e != null && $e.complete && $e.naturalWidth) G.drawImage($e, -17, -17, 34, 34);else {
        G.fillStyle = "#242322";
        for (let [Et, At] of [[-7, 5], [0, 4], [7, 6]]) G.beginPath(), G.ellipse(0, Et, At, At * 1.2, 0, 0, Math.PI * 2), G.fill();
      }
      G.restore(), li(G.canvas, "ant-loop");
    }
    function Cu(G, Se, Ue) {
      let $e = Wt() / 1e3,
        Te = Oe => Oe.team === "player" && (!Oe.__neutralTroop || Oe.recruited),
        Ae = G.entities.filter(Te),
        De = Ae.reduce((Oe, ut) => Oe + ut.x, 0) / Math.max(1, Ae.length),
        ke = Ae.reduce((Oe, ut) => Oe + ut.y, 0) / Math.max(1, Ae.length);
      return {
        ...G,
        particles: [],
        playerTarget: {
          x: Se * (.5 + Math.sin($e * .8) * .18),
          y: Ue * (.43 + Math.cos($e * .8) * .04)
        },
        entities: G.entities.map(Oe => Te(Oe) ? {
          ...Oe,
          x: Se * (.5 + Math.sin($e * .8) * .14) + (Oe.x - De) * .7,
          y: Ue * (.57 + Math.cos($e * .8) * .04) + (Oe.y - ke) * .7
        } : Oe)
      };
    }
    function Eu(G, Se, Ue, $e, Te) {
      let Ae = Wt() / 1e3,
        De = Ae % 5.8 / 5.8,
        ke = Se / 2,
        Oe = ($e + Te) / 2,
        ut = [[-.22, .16], [-.11, .02], [.04, .04], [.17, -.17], [.24, -.11]].map(([Ve, Ge]) => ({
          x: ke + Ve * Se,
          y: Oe + Ge * (Te - $e)
        }));
      G.save(), G.strokeStyle = "#167a61", G.lineWidth = 6, G.lineCap = "round", G.lineJoin = "round", G.globalAlpha = De > .9 ? (1 - De) / .1 : 1, De < .5 ? _e(G, ut, Xe(De / .45)) : (G.translate(ke, Oe), G.rotate((De - .5) * Math.PI * 3.4), _e(G, ut.map(Ve => ({
        x: Ve.x - ke,
        y: Ve.y - Oe
      }))), G.fillStyle = "#167a61", G.beginPath(), G.arc(0, 0, 11, 0, Math.PI * 2), G.fill()), G.restore(), li(G.canvas, "draw-and-spin-blade");
    }
    function io(G) {
      let Se = Wt() / 1e3,
        Ue = G === "player" ? 0 : G === "copL" ? 1.3 : 2.2,
        $e = Se * .75 - Ue,
        Te = 375 + Math.sin($e) * 130,
        Ae = G === "player" ? 800 : 1040 + (G === "copR" ? 60 : 0);
      return {
        x: Te + (G === "copL" ? -85 : G === "copR" ? 85 : 0),
        y: Ae + Math.cos($e) * 28,
        angle: -Math.PI / 2 + Math.cos($e) * .18
      };
    }
    function Au(G) {
      let Se = io("player");
      G.save(), G.strokeStyle = "#ffffff88", G.setLineDash([11, 12]), G.lineWidth = 5, G.beginPath(), G.moveTo(Se.x, Se.y), G.bezierCurveTo(Se.x + 100, Se.y - 100, 340, Se.y - 220, 420, Se.y - 340), G.stroke(), G.restore(), li(G.canvas, "escape-route");
    }
    function Mu(G, Se, Ue, $e) {
      let Te = [G, Se];
      for (let Ve of Ue) for (let Ge = 0; Ge < 12; Ge++) {
        let Re = Ge * Math.PI / 6,
          Et = Ve.circleRadius + 16,
          At = {
            x: Ve.position.x + Math.cos(Re) * Et,
            y: Ve.position.y + Math.sin(Re) * Et
          };
        At.x > 15 && At.x < $e - 15 && Te.push(At);
      }
      let Ae = Te.map(() => 1 / 0),
        De = Te.map(() => -1),
        ke = new Set();
      Ae[0] = 0;
      let Oe = (Ve, Ge) => Ue.every(Re => {
        let Et = Ge.x - Ve.x,
          At = Ge.y - Ve.y,
          mr = he(((Re.position.x - Ve.x) * Et + (Re.position.y - Ve.y) * At) / Math.max(.01, Et * Et + At * At));
        return Math.hypot(Ve.x + Et * mr - Re.position.x, Ve.y + At * mr - Re.position.y) > Re.circleRadius + 7;
      });
      for (let Ve = 0; Ve < Te.length; Ve++) {
        let Ge = -1;
        for (let Re = 0; Re < Te.length; Re++) !ke.has(Re) && (Ge < 0 || Ae[Re] < Ae[Ge]) && (Ge = Re);
        if (Ge < 0 || !Number.isFinite(Ae[Ge]) || Ge === 1) break;
        ke.add(Ge);
        for (let Re = 0; Re < Te.length; Re++) {
          if (ke.has(Re) || !Oe(Te[Ge], Te[Re])) continue;
          let Et = Ae[Ge] + Math.hypot(Te[Ge].x - Te[Re].x, Te[Ge].y - Te[Re].y);
          Et < Ae[Re] && (Ae[Re] = Et, De[Re] = Ge);
        }
      }
      if (De[1] < 0) return [G, {
        x: 20,
        y: G.y + 24
      }, {
        x: 20,
        y: Se.y - 28
      }, Se];
      let ut = [];
      for (let Ve = 1; Ve >= 0 && (ut.unshift(Te[Ve]), Ve !== 0); Ve = De[Ve]);
      return ut;
    }
    let ui = null;
    function Pu(G, Se, Ue, $e, Te, Ae, De) {
      if (!Se || !Ue) return;
      let ke = Wt() / 1e3,
        Oe = ke % 5.6,
        ut = Ae.filter(Re => Re.label === "obstacle"),
        Ve = JSON.stringify([Se, Ue, De, ut.map(Re => [Re.position.x, Re.position.y, Re.circleRadius])]);
      (ui == null ? void 0 : ui.key) !== Ve && (ui = {
        key: Ve,
        points: Mu({
          x: Se.x,
          y: Se.y + 21
        }, {
          x: Ue.x,
          y: Ue.y - Te * .42
        }, ut, De)
      });
      let Ge = ui.points;
      if (G.save(), G.strokeStyle = "#242322", G.lineWidth = 5, G.lineCap = "round", G.lineJoin = "round", G.globalAlpha = Oe > 5 ? (5.6 - Oe) / .6 : 1, _e(G, Ge, Xe(Oe / 1.7)), Oe > 1.4 && Oe < 5) for (let Re = 0; Re < 15; Re++) {
        let Et = (Oe - 1.4) * .65 - Re * .067;
        if (Et < 0 || Et > 1) continue;
        let At = yn(Ge, Et);
        G.fillStyle = "#59c6b1", G.strokeStyle = "#242322", G.lineWidth = 1, G.beginPath(), G.arc(At.x, At.y, 4, 0, Math.PI * 2), G.fill(), G.stroke();
      }
      G.restore(), li(G.canvas, "guided-soda-route");
    }
    let qa = document.createElement("style");
    qa.dataset.batch2IdleStyle = "", qa.textContent = `
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
  `, document.head.append(qa), window.PlayableIdlePreview = Object.freeze({
      get active() {
        return Be && !document.hidden;
      },
      get preview() {
        return Be;
      },
      get reduced() {
        return We.matches;
      },
      get seconds() {
        return Wt() / 1e3;
      },
      clock: Wt,
      ease: Xe,
      clamp: he,
      stamp: li,
      trace: _e,
      onPath: yn,
      ant: Tu,
      army: Cu,
      blade: Eu,
      road: Au,
      roadPose: io,
      soda: Pu,
      subscribe(G) {
        return Jt.add(G), () => Jt.delete(G);
      }
    }), addEventListener("message", G => {
      var Ue;
      if (parent === window || G.source !== parent || G.origin !== location.origin || ((Ue = G.data) == null ? void 0 : Ue.type) !== "playable-active") return;
      let Se = G.data.active !== true;
      Se !== Be && (Be = Se, Ct = 0), Ne();
    }), document.addEventListener("visibilitychange", Ne), (ao = We.addEventListener) == null || ao.call(We, "change", Ne), addEventListener("pagehide", () => {
      Be = false, Ne(), Jt.clear();
    }, {
      once: true
    }), Ne();
  })();
  (() => {
    var Wt;
    if (new URLSearchParams(location.search).get("feedReview") !== "1") return;
    let ft = false,
      Tt = true,
      We = new Set(),
      Be = new Set(),
      Ct = new Set(),
      Nt = new Set(),
      Jt = () => Tt ? new Promise((he, Xe) => We.add({
        resolve: he,
        reject: Xe
      })) : Promise.reject(new DOMException("Feed closed", "AbortError"));
    if ((Wt = navigator.mediaDevices) != null && Wt.getUserMedia) {
      let he = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async Xe => {
        if (ft || (await Jt()), !Tt) throw new DOMException("Feed closed", "AbortError");
        let _e = await he(Xe);
        if (!Tt || !ft) throw _e.getTracks().forEach(yn => yn.stop()), new DOMException("Feed inactive", "AbortError");
        return Nt.add(_e), _e;
      };
    }
    for (let he of ["AudioContext", "webkitAudioContext"]) {
      let Xe = window[he];
      Xe && (window[he] = class extends Xe {
        constructor(...yn) {
          super(...yn), Be.add(this), ft || super.suspend().catch(() => {});
        }
        async resume() {
          if (ft || (await Jt()), Tt) return super.resume();
        }
      });
    }
    let Ne = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = async function (...he) {
      if (Ct.add(this), ft || (await Jt()), Tt) return Ne.apply(this, he);
    }, addEventListener("message", he => {
      var Xe;
      if (!(he.source !== parent || he.origin !== location.origin || ((Xe = he.data) == null ? void 0 : Xe.type) !== "playable-active")) if (ft = Tt && he.data.active === true, ft) {
        for (let _e of We) _e.resolve();
        We.clear();
        for (let _e of Be) _e.state !== "closed" && _e.resume().catch(() => {});
      } else {
        for (let _e of Be) _e.state !== "closed" && _e.suspend().catch(() => {});
        for (let _e of Ct) _e.pause();
        for (let _e of Nt) _e.getTracks().forEach(yn => yn.stop());
        Nt.clear();
      }
    }), addEventListener("pagehide", () => {
      Tt = false, ft = false;
      for (let he of We) he.reject(new DOMException("Feed closed", "AbortError"));
      We.clear();
      for (let he of Be) he.state !== "closed" && he.close().catch(() => {});
      for (let he of Ct) he.pause();
      for (let he of Nt) he.getTracks().forEach(Xe => Xe.stop());
    }, {
      once: true
    });
  })();
  (() => {
    if (window.location.protocol !== "file:" || !window.fetch) return;
    let ft = {
      textContent: JSON.stringify(PACKAGE_CONFIG_FALLBACK)
    };
    if (!ft) return;
    let Tt;
    try {
      Tt = JSON.parse(ft.textContent);
    } catch {
      return;
    }
    let We = window.fetch.bind(window);
    window.fetch = (Be, Ct) => {
      let Nt = typeof Be == "string" ? Be : Be && Be.url;
      return Nt === "./game.config.json" || Nt === "game.config.json" ? Promise.resolve(new Response(JSON.stringify(Tt), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })) : We(Be, Ct);
    };
  })();
  ReactDOM.createRoot(document.getElementById("root")).render(<><style>{PACKAGE_HTML_STYLES}</style>{<App />}</>);
  (function () {
    "use strict";

    var Wt, he;
    let ft = {
        getAttribute(name) {
          return {
            "data-subject": "#root canvas"
          }[name] ?? null;
        }
      },
      Tt = "#root canvas",
      We = (Wt = window.matchMedia) == null ? void 0 : Wt.call(window, "(prefers-reduced-motion: reduce)"),
      Be,
      Ct,
      Nt = false;
    function Jt() {
      Ct == null || Ct.cancel(), Ct = null;
    }
    function Ne() {
      if (Nt || document.hidden) return;
      let Xe = document.querySelector(Tt);
      if (!Xe || Xe.closest('[hidden], [aria-hidden="true"]')) return;
      let _e = window.getComputedStyle(Xe);
      if (_e.display === "none" || _e.visibility === "hidden") return;
      if (Xe.tagName === "IMG" && !Xe.complete) {
        Xe.addEventListener("load", Ne, {
          once: true
        });
        return;
      }
      if (Nt = true, Be == null || Be.disconnect(), We != null && We.matches) return;
      let yn = Number(window.getComputedStyle(Xe).opacity) || 1;
      typeof Xe.animate == "function" && (Ct = Xe.animate([{
        opacity: yn * .76
      }, {
        opacity: yn
      }], {
        duration: 650,
        easing: "ease-out"
      }), Ct.onfinish = () => {
        Ct = null;
      });
    }
    Be = new MutationObserver(Ne), Be.observe(document.body, {
      childList: true,
      subtree: true
    }), Ne(), document.addEventListener("visibilitychange", () => {
      document.documentElement.toggleAttribute("data-feed-background", document.hidden), document.hidden ? Jt() : Ne();
    }), window.addEventListener("pagehide", () => {
      Be.disconnect(), Jt();
    }), window.addEventListener("pageshow", () => {
      Nt || Be.observe(document.body, {
        childList: true,
        subtree: true
      }), Ne();
    }), document.addEventListener("pointerdown", Jt, {
      capture: true,
      passive: true
    }), (he = We == null ? void 0 : We.addEventListener) == null || he.call(We, "change", () => {
      We.matches && Jt();
    });
  })();
})();

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = ["p.feed-first-action"],
    copy = new Set([].map(s => s.replace(/\s+/g, ' ').trim().toLowerCase()));
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
