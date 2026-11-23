/* Font redistribution notices, preserved in the editable source.
Font license notice: silkscreen
Copyright 2001 The Silkscreen Project Authors (https://github.com/googlefonts/silkscreen)

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
    "id": "PLAYER_SPEED",
    "kind": "number",
    "label": "Player Speed",
    "value": 0.6,
    "default": 0.6,
    "min": 0.2,
    "max": 1.5,
    "step": 0.1
  }, {
    "id": "COP_SPEED",
    "kind": "number",
    "label": "Police Speed",
    "value": 0.55,
    "default": 0.55,
    "min": 0.2,
    "max": 1.5,
    "step": 0.1
  }],
  "texts": [{
    "id": "TEXT_GUIDE",
    "label": "Guide Text",
    "value": "DISEGNA LA VIA DI FUGA",
    "default": "DISEGNA LA VIA DI FUGA",
    "max_length": 30
  }, {
    "id": "TEXT_WIN",
    "label": "Win Text",
    "value": "In salvo!",
    "default": "In salvo!",
    "max_length": 20
  }, {
    "id": "TEXT_LOSE",
    "label": "Lose Text",
    "value": "Preso!",
    "default": "Preso!",
    "max_length": 20
  }, {
    "id": "BTN_RETRY_WIN",
    "label": "Win Retry Button",
    "value": "RIGIOCA",
    "default": "RIGIOCA",
    "max_length": 15
  }, {
    "id": "BTN_RETRY_LOSE",
    "label": "Lose Retry Button",
    "value": "RIPROVA",
    "default": "RIPROVA",
    "max_length": 15
  }, {
    "id": "BTN_POST",
    "label": "Post Button",
    "value": "Pubblica la partita",
    "default": "Pubblica la partita",
    "max_length": 20
  }],
  "images": [{
    "id": "PLAYER_CAR",
    "label": "Player Car",
    "path": "./assets/player-pixel.svg",
    "replaceable": true
  }, {
    "id": "COP_LEFT",
    "label": "Police Car (Left)",
    "path": "./assets/police-sedan-pixel.svg",
    "replaceable": true
  }, {
    "id": "COP_RIGHT",
    "label": "Police Car (Right)",
    "path": "./assets/police-sedan-pixel.svg",
    "replaceable": true
  }, {
    "id": "GOAL_AREA",
    "label": "Goal Area",
    "path": "./assets/goal-escape-pixel.svg",
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
const PACKAGE_HTML_STYLES = "\n    @font-face {\n      font-family: \"Silkscreen\";\n      src: url(\"./assets/fonts/silkscreen/Silkscreen-Regular.ttf\") format(\"truetype\");\n      font-style: normal;\n      font-weight: 400;\n      font-display: swap;\n    }\n    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }\n    body { background: #ead3ab; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }\n    #root { isolation: isolate; }\n    #root :is(h1, h2, button) {\n      font-family: \"Silkscreen\", ui-monospace, monospace !important;\n      font-weight: 400 !important;\n    }\n    #root [data-game-cta=\"police-guide\"] {\n      font-size: clamp(14px, 4.4vw, 18px) !important;\n    }\n    canvas { touch-action: none; }\n    button, input, select, textarea { touch-action: manipulation; }\n  \n\n@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}\n.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}\n.feed-first-action[aria-hidden=\"true\"]{animation:none}\nhtml[data-feed-background] .feed-first-action{animation-play-state:paused}\n@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}\n\n:root{--color-bg:#ead3ab;--color-green:#56bd94}";
// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
function ws(s, t) {
  return Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2);
}
function El(s = "light") {
  try {
    typeof window < "u" && window.tt && window.tt.vibrate && window.tt.vibrate({
      style: s
    });
  } catch {}
}
const policeSandDetails = [[17, 245], [47, 344], [23, 544], [47, 662], [15, 904], [43, 1012], [25, 1253], [703, 101], [726, 314], [700, 408], [722, 623], [697, 735], [731, 1005], [707, 1143]];
const policeCacti = [[21, 136, .82], [52, 423, -.8], [27, 771, .95], [48, 1165, -.85], [728, 212, -.82], [700, 501, .82], [725, 857, -.85], [702, 1269, .8]];
const policeCactusOutline = new Path2D("M-8 0v-12h-8v-4h-4v-20h4v-4h8v4h4v-12h4v-4h8v4h4v20h4v-8h4v-4h8v4h4v16h-4v4h-4v4H12V0Z");
const policeCactusFill = new Path2D("M-4-4v-12h-12v-20h8v12h4v4h4v-28h8v28h12v-4h4v-12h4v16h-4v4H8v12Z");
function paintPoliceDesert(ctx) {
  ctx.fillStyle = "#ead3ab";
  ctx.fillRect(0, 0, 750, 1334);
  ctx.fillStyle = "#caa874";
  for (const [x, y] of policeSandDetails) {
    ctx.fillRect(x, y, 8, 4);
    ctx.fillRect(x + 4, y - 4, 8, 4);
    ctx.fillRect(x - 5, y + 12, 4, 4);
  }
  for (const [x, y, size] of policeCacti) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, Math.abs(size));
    ctx.fillStyle = "#be9d6e";
    ctx.fillRect(-16, -3, 40, 7);
    ctx.fillRect(-12, 4, 32, 3);
    ctx.fillStyle = "#42573f";
    ctx.fill(policeCactusOutline);
    ctx.fillStyle = "#6c8555";
    ctx.fill(policeCactusFill);
    ctx.fillStyle = "#9ca56a";
    ctx.fillRect(0, -44, 4, 31);
    ctx.fillRect(-12, -32, 4, 10);
    ctx.restore();
  }
}
function useGameFeature1() {
  let s = typeof window < "u" && window.tt && typeof window.tt.playableRecordingSubmission == "function",
    [t, r] = React.useState(false);
  React.useEffect(() => {
    let l = () => r(false),
      c = () => {
        document.visibilityState === "visible" && l();
      };
    return document.addEventListener("visibilitychange", c), window.addEventListener("pageshow", l), () => {
      document.removeEventListener("visibilitychange", c), window.removeEventListener("pageshow", l);
    };
  }, []);
  let a = React.useCallback(() => {
    t || !s || (r(true), window.tt.playableRecordingSubmission({
      success() {},
      fail(l) {
        console.error("[post_my_play] failed", l && (l.errMsg || l.message)), r(false);
      },
      complete() {}
    }));
  }, [t, s]);
  return {
    canSubmit: s,
    submitting: t,
    submitRecording: a
  };
}
function App() {
  let [s, t] = React.useState(null),
    [r, a] = React.useState("idle"),
    l = React.useRef(null),
    c = React.useRef(null),
    h = React.useRef(false),
    d = React.useRef({}),
    p = React.useRef(null),
    m = React.useRef({}),
    v = React.useRef({
      state: "idle",
      path: [],
      player: {
        x: 375,
        y: 945,
        angle: -Math.PI / 2,
        pathIndex: 0
      },
      cops: [{
        x: 150,
        y: 150,
        angle: Math.PI / 2,
        active: false
      }, {
        x: 600,
        y: 150,
        angle: Math.PI / 2,
        active: false
      }],
      goal: {
        x: 375,
        y: 200,
        radius: 100
      },
      lastTime: 0
    });
  React.useEffect(() => {
    let A = true;
    return (async () => {
      let k = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let W = await fetch("./game.config.json", {
          cache: "no-store"
        });
        W.ok && (k = await W.json());
      } catch {}
      let E = {};
      (k.tweaks || []).forEach(W => {
        E[W.id] = W.value;
      }), (k.texts || []).forEach(W => {
        E[W.id] = W.value;
      }), (k.images || []).forEach(W => {
        E[W.id] = W.path;
      }), (k.mentions || []).forEach(W => {
        E[W.id] = W.path != null && W.path !== "" ? W.path : W.value;
      }), (k.motions || []).forEach(W => {
        !W || !W.id || (W.base_path != null && W.base_path !== "" && (E[W.id] = W.base_path, E[W.id + "_BASE"] = W.base_path), W.frame_count != null && (E[W.id + "_COUNT"] = W.frame_count));
      }), E.PLAYER_SPEED = E.PLAYER_SPEED || .6, E.COP_SPEED = E.COP_SPEED || .55, E.TEXT_GUIDE = E.TEXT_GUIDE || "DISEGNA LA VIA DI FUGA", E.TEXT_WIN = E.TEXT_WIN || "In salvo!", E.TEXT_LOSE = E.TEXT_LOSE || "Preso!", E.BTN_RETRY_WIN = E.BTN_RETRY_WIN || "RIGIOCA", E.BTN_RETRY_LOSE = E.BTN_RETRY_LOSE || "RIPROVA", E.BTN_POST = E.BTN_POST || "Pubblica la partita", E.PLAYER_CAR = E.PLAYER_CAR || "./assets/player-pixel.svg", E.COP_LEFT = E.COP_LEFT || "./assets/police-sedan-pixel.svg", E.COP_RIGHT = E.COP_RIGHT || "./assets/police-sedan-pixel.svg", E.GOAL_AREA = E.GOAL_AREA || "./assets/goal-escape-pixel.svg", A && t(E);
    })(), () => {
      A = false;
    };
  }, []), React.useEffect(() => {
    if (!s) return;
    let A = (k, E) => {
      let W = new Image();
      W.src = E, W.onload = () => {
        m.current[k] = W;
      };
    };
    A("player", s.PLAYER_CAR), A("copL", s.COP_LEFT), A("copR", s.COP_RIGHT), A("goal", s.GOAL_AREA);
  }, [s]), React.useEffect(() => {
    let A = false,
      k = 0;
    const E = () => {
      const X = d.current.siren,
        V = r === "playing" && !document.hidden && !window.PlayableIdlePreview.preview;
      if (X) {
        if (!V) {
          A && X.triggerRelease(), A = false;
          return;
        }
        A || (X.triggerAttack(630), A = true), X.frequency.rampTo(k++ % 2 ? 630 : 1050, .58);
      }
    };
    E();
    const W = setInterval(E, 620);
    return () => {
      clearInterval(W), A && d.current.siren?.triggerRelease();
    };
  }, [r]), React.useEffect(() => () => {
    Object.values(d.current).forEach(A => A?.dispose?.());
  }, []);
  let y = React.useCallback(async () => {
      if (!h.current) try {
        await Tone.start(), d.current.siren = new Tone.Synth({
          oscillator: {
            type: "triangle"
          }
        }).toDestination(), d.current.siren.volume.value = -23, d.current.crash = new Tone.MembraneSynth().toDestination(), d.current.win = new Tone.PolySynth(Tone.Synth).toDestination(), d.current.win.volume.value = -8, h.current = true;
      } catch (A) {
        console.warn("Audio start failed", A);
      }
    }, []),
    _ = React.useCallback(A => {
      if (!c.current || !s) return;
      let k = c.current.getContext("2d"),
        E = v.current,
        W = A - E.lastTime;
      if (W > 100 && (W = 16), E.lastTime = A, E.state === "playing") {
        let V = E.player,
          K = s.PLAYER_SPEED * W;
        for (; V.pathIndex < E.path.length && K > 0;) {
          let ae = E.path[V.pathIndex],
            ee = ws(V, ae);
          ee > 0 && (V.angle = Math.atan2(ae.y - V.y, ae.x - V.x)), ee <= K ? (V.x = ae.x, V.y = ae.y, V.pathIndex++, K -= ee) : (V.x += Math.cos(V.angle) * K, V.y += Math.sin(V.angle) * K, K = 0);
        }
        E.cops.forEach(ae => {
          ae.active || (ae.active = true);
          let ee = Math.atan2(V.y - ae.y, V.x - ae.x) - ae.angle;
          for (; ee > Math.PI;) ee -= Math.PI * 2;
          for (; ee < -Math.PI;) ee += Math.PI * 2;
          ae.angle += ee * (1 - Math.pow(.9, W / (1e3 / 60)));
          let $ = s.COP_SPEED * W;
          ae.x += Math.cos(ae.angle) * $, ae.y += Math.sin(ae.angle) * $;
        });
        let te = 40,
          ie = false;
        E.cops.forEach(ae => {
          ws(V, ae) < te * 1.5 && (ie = true);
        }), ie ? (E.state = "lose", a("lose"), El("heavy"), d.current.crash && d.current.crash.triggerAttackRelease("C2", "8n")) : ws(V, E.goal) < E.goal.radius && (E.state = "win", a("win"), El("notification_success"), d.current.win && d.current.win.triggerAttackRelease(["C4", "E4", "G4"], "4n"));
      }
      if (k.clearRect(0, 0, 750, 1334), paintPoliceDesert(k), k.imageSmoothingEnabled = false, k.fillStyle = "#b4b4b4", k.fillRect(72, 0, 606, 1334), k.strokeStyle = "#50382c", k.lineWidth = 6, k.beginPath(), k.moveTo(72, 0), k.lineTo(72, 1334), k.moveTo(678, 0), k.lineTo(678, 1334), k.stroke(), k.strokeStyle = "#f8fcfb", k.lineWidth = 10, k.setLineDash([30, 40]), k.beginPath(), k.moveTo(375, 0), k.lineTo(375, 1334), k.stroke(), k.setLineDash([]), m.current.goal ? k.drawImage(m.current.goal, E.goal.x - 120, E.goal.y - 120, 240, 240) : (k.fillStyle = "rgba(0, 255, 0, 0.3)", k.beginPath(), k.arc(E.goal.x, E.goal.y, E.goal.radius, 0, Math.PI * 2), k.fill()), E.path.length > 0) {
        window.PlayableIdlePreview.route(k, E.path);
      }
      window.PlayableIdlePreview.active && window.PlayableIdlePreview.road(k, E.player, E.goal);
      let X = (V, K, te) => {
        k.save(), k.translate(K.x, K.y), k.rotate(K.angle + Math.PI / 2), m.current[V] ? k.drawImage(m.current[V], -40, -80, 80, 160) : (k.fillStyle = te, k.fillRect(-30, -50, 60, 100)), k.restore();
      };
      X("player", E.player, "#ff3333"), X("copL", E.cops[0], "#ffffff"), X("copR", E.cops[1], "#ffffff"), p.current = requestAnimationFrame(_);
    }, [s]);
  React.useEffect(() => (s && (p.current = requestAnimationFrame(_)), () => cancelAnimationFrame(p.current)), [s, _]);
  let w = A => {
      if (!c.current) return {
        x: 0,
        y: 0
      };
      let k = c.current.getBoundingClientRect(),
        E = Math.min(k.width / 750, k.height / 1334),
        W = 750 * E,
        X = 1334 * E,
        V = k.left + (k.width - W) / 2,
        K = k.top + (k.height - X) / 2;
      return {
        x: Math.max(0, Math.min(750, (A.clientX - V) / E)),
        y: Math.max(0, Math.min(1334, (A.clientY - K) / E))
      };
    },
    S = A => {
      if (A.isPrimary !== false && A.button === 0 && v.current.state === "idle") {
        y(), A.currentTarget.setPointerCapture?.(A.pointerId);
        let k = w(A);
        v.current.pointerId = A.pointerId, v.current.state = "drawing", a("drawing"), v.current.path = [{
          x: v.current.player.x,
          y: v.current.player.y
        }, k];
      }
    },
    C = A => {
      if (A.isPrimary === false || A.pointerId !== v.current.pointerId || v.current.state !== "drawing") return;
      let k = w(A),
        E = v.current.path;
      if (E.length > 0) {
        let W = E[E.length - 1];
        ws(W, k) > 15 && E.push(k);
      }
    },
    T = A => {
      A.isPrimary === false || A.pointerId !== v.current.pointerId || v.current.state !== "drawing" || (C(A), A.currentTarget.hasPointerCapture?.(A.pointerId) && A.currentTarget.releasePointerCapture(A.pointerId), v.current.pointerId = null, A.isPrimary === false || v.current.state !== "drawing" || (v.current.path.length > 2 ? (v.current.state = "playing", a("playing"), El("light")) : (v.current.state = "idle", a("idle"), v.current.path = [])));
    },
    I = () => {
      v.current = {
        state: "idle",
        path: [],
        player: {
          x: 375,
          y: 945,
          angle: -Math.PI / 2,
          pathIndex: 0
        },
        cops: [{
          x: 150,
          y: 150,
          angle: Math.PI / 2,
          active: false
        }, {
          x: 600,
          y: 150,
          angle: Math.PI / 2,
          active: false
        }],
        goal: {
          x: 375,
          y: 200,
          radius: 100
        },
        lastTime: performance.now()
      }, a("idle");
    },
    {
      canSubmit: U,
      submitting: q,
      submitRecording: B
    } = useGameFeature1();
  if (!s) return <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#222"
  }} />;
  let P = r === "win" || r === "lose";
  return <div ref={l} style={{
    width: "100%",
    height: "100%",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    touchAction: "none"
  }} onPointerDown={S} onPointerMove={C} onPointerUp={T} onPointerCancel={A => {
    A.pointerId === v.current.pointerId && (A.currentTarget.hasPointerCapture?.(A.pointerId) && A.currentTarget.releasePointerCapture(A.pointerId), v.current.state === "drawing" && (v.current.state = "idle", v.current.pointerId = null, v.current.path = [], a("idle")));
  }}>{<style />}{<div style={{
      flex: 1,
      minHeight: 0,
      width: "100%",
      position: "relative"
    }}>{<canvas ref={c} width={750} height={1334} style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        backgroundColor: "var(--color-bg)"
      }} />}</div>}{r === "idle" && <div style={{
      position: "absolute",
      top: "30%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: "calc(100% - 50px)",
      textAlign: "center",
      pointerEvents: "none",
      zIndex: 10,
      backgroundColor: "rgba(255,255,255,.94)",
      padding: "12px 16px",
      borderRadius: "18px",
      boxSizing: "border-box"
    }}>{<h2 data-game-cta={"police-guide"} style={{
        fontFamily: "Arial, sans-serif",
        fontWeight: 900,
        color: "#000000",
        fontSize: "18px",
        lineHeight: 1.3,
        margin: 0,
        textShadow: "none"
      }}>{s.TEXT_GUIDE}</h2>}</div>}{P && <div onPointerDown={A => A.stopPropagation()} onPointerMove={A => A.stopPropagation()} onPointerUp={A => A.stopPropagation()} onClick={A => A.stopPropagation()} style={{
      position: "absolute",
      inset: 0,
      backgroundColor: "rgba(0,0,0,0.88)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 20,
      padding: "calc(40px + env(safe-area-inset-top, 0px)) 25px calc(40px + env(safe-area-inset-bottom, 0px))",
      boxSizing: "border-box"
    }}>{<h1 style={{
        fontFamily: "Arial, sans-serif",
        fontWeight: 900,
        fontSize: "clamp(36px, 9vw, 52px)",
        lineHeight: 1.1,
        textAlign: "center",
        maxWidth: "100%",
        overflowWrap: "anywhere",
        margin: "0 0 28px 0",
        color: r === "win" ? "#4ade80" : "#ff5a5f",
        textShadow: "0 3px 14px rgba(0,0,0,0.9)"
      }}>{r === "win" ? s.TEXT_WIN : s.TEXT_LOSE}</h1>}{<div style={{
        display: "flex",
        gap: "16px",
        flexWrap: "wrap",
        justifyContent: "center"
      }}>{<button onClick={I} style={{
          padding: "16px 32px",
          fontSize: "20px",
          fontFamily: "Arial, sans-serif",
          fontWeight: 900,
          backgroundColor: "#fff",
          color: "#111827",
          border: "none",
          borderRadius: "30px",
          cursor: "pointer",
          flex: "0 0 auto"
        }}>{r === "win" ? s.BTN_RETRY_WIN : s.BTN_RETRY_LOSE}</button>}{U && <button type={"button"} disabled={q} onClick={B} style={{
          padding: "16px 32px",
          fontSize: "20px",
          fontFamily: "Arial, sans-serif",
          fontWeight: 900,
          backgroundColor: "var(--color-green)",
          color: "#000",
          border: "none",
          borderRadius: "30px",
          cursor: "pointer",
          opacity: q ? .6 : 1,
          flex: "0 0 auto"
        }}>{s.BTN_POST}</button>}</div>}</div>}</div>;
}
(() => {
  "use strict";

  if (window.PlayableIdlePreview) return;
  const $a = new URLSearchParams(location.search),
    Ha = $a.get("feedReview") === "1" || $a.get("host") === "fyp",
    Ln = matchMedia("(prefers-reduced-motion: reduce)");
  let nn = Ha,
    ji = 0,
    Wi = performance.now();
  const Be = new Set(),
    Ar = () => {
      const H = document.documentElement;
      if (H.dataset.batch2Idle = String(nn), H.dataset.batch2IdlePaused = String(document.hidden), H.dataset.batch2IdleReduced = String(Ln.matches), !nn) for (const _e of document.querySelectorAll("[data-idle-preview]")) _e.dataset.idlePreview = "off";
      Wi = performance.now();
      for (const _e of Be) _e(nn && !document.hidden);
    },
    It = () => {
      const H = performance.now();
      return nn && !document.hidden && !Ln.matches && (ji += Math.min(64, Math.max(0, H - Wi))), Wi = H, Ln.matches ? 1600 : ji;
    },
    Jn = (H, _e = 0, Me = 1) => Math.max(_e, Math.min(Me, H)),
    Fn = H => (H = Jn(H), H * H * (3 - 2 * H)),
    er = (H, _e, Me = 1) => {
      if (!_e.length) return;
      const Ie = _e.slice(1).map((ke, Ve) => Math.hypot(ke.x - _e[Ve].x, ke.y - _e[Ve].y));
      let me = Ie.reduce((ke, Ve) => ke + Ve, 0) * Jn(Me);
      H.beginPath(), H.moveTo(_e[0].x, _e[0].y);
      for (let ke = 1; ke < _e.length; ke++) {
        const Ve = _e[ke - 1],
          pe = _e[ke],
          Fe = Ie[ke - 1],
          dt = Math.min(1, me / Math.max(.01, Fe));
        if (H.lineTo(Ve.x + (pe.x - Ve.x) * dt, Ve.y + (pe.y - Ve.y) * dt), me -= Fe, me <= 0) break;
      }
      H.stroke();
    },
    Qa = (H, _e) => {
      const Me = H.slice(1).map((me, ke) => Math.hypot(me.x - H[ke].x, me.y - H[ke].y));
      let Ie = Me.reduce((me, ke) => me + ke, 0) * Jn(_e);
      for (let me = 1; me < H.length; me++) {
        const ke = H[me - 1],
          Ve = H[me],
          pe = Me[me - 1];
        if (Ie <= pe || me === H.length - 1) {
          const Fe = Jn(Ie / Math.max(.01, pe));
          return {
            x: ke.x + (Ve.x - ke.x) * Fe,
            y: ke.y + (Ve.y - ke.y) * Fe
          };
        }
        Ie -= pe;
      }
      return H[0];
    },
    Or = (H, _e, Me = It()) => {
      H && (H.dataset.idlePreview = nn ? _e : "off", H.dataset.idlePhase = String(Math.round(Me)));
    };
  function Lo(H, _e, Me, Ie) {
    const me = It() / 1e3,
      ke = me % 5.4 / 5.4,
      Ve = _e * .5,
      pe = Me * .51,
      Fe = Math.min(_e * .29, 105),
      dt = Math.min(Me * .16, 78),
      Ee = Array.from({
        length: 81
      }, (ft, pt) => ({
        x: Ve + Math.cos(pt / 80 * Math.PI * 2) * Fe,
        y: pe + Math.sin(pt / 80 * Math.PI * 2) * dt
      }));
    H.save(), H.lineWidth = 5, H.lineCap = "round", H.lineJoin = "round", H.strokeStyle = "#242322", H.globalAlpha = ke > .88 ? (1 - ke) / .12 : 1, er(H, Ee, Fn(ke / .48));
    const je = Ve + Math.sin(me * 2.1) * Fe * .63,
      Ce = pe + Math.sin(me * 2.8) * dt * .59;
    if (H.translate(je, Ce), H.rotate(Math.atan2(Math.cos(me * 2.8) * dt, Math.cos(me * 2.1) * Fe) + Math.PI / 2), Ie?.complete && Ie.naturalWidth) H.drawImage(Ie, -17, -17, 34, 34);else {
      H.fillStyle = "#242322";
      for (const [ft, pt] of [[-7, 5], [0, 4], [7, 6]]) H.beginPath(), H.ellipse(0, ft, pt, pt * 1.2, 0, 0, Math.PI * 2), H.fill();
    }
    H.restore(), Or(H.canvas, "ant-loop");
  }
  function Fo(H, _e, Me) {
    const Ie = It() / 1e3,
      me = H.entities.filter(pe => pe.team === "player"),
      ke = me.reduce((pe, Fe) => pe + Fe.x, 0) / Math.max(1, me.length),
      Ve = me.reduce((pe, Fe) => pe + Fe.y, 0) / Math.max(1, me.length);
    return {
      ...H,
      particles: [],
      playerTarget: {
        x: _e * (.5 + Math.sin(Ie * .8) * .18),
        y: Me * (.43 + Math.cos(Ie * .8) * .04)
      },
      entities: H.entities.map((pe, Fe) => ({
        ...pe,
        x: pe.team === "player" ? _e * (.5 + Math.sin(Ie * .8) * .14) + (pe.x - ke) * .7 : pe.x + Math.sin(Ie * 1.5 + Fe * .7) * 8,
        y: pe.team === "player" ? Me * (.57 + Math.cos(Ie * .8) * .04) + (pe.y - Ve) * .7 : pe.y + Math.cos(Ie * 1.5 + Fe * .7) * 8
      }))
    };
  }
  function zo(H, _e, Me, Ie, me) {
    const ke = It() / 1e3,
      Ve = ke % 5.8 / 5.8,
      pe = _e / 2,
      Fe = (Ie + me) / 2,
      dt = [[-.22, .16], [-.11, .02], [.04, .04], [.17, -.17], [.24, -.11]].map(([Ee, je]) => ({
        x: pe + Ee * _e,
        y: Fe + je * (me - Ie)
      }));
    H.save(), H.strokeStyle = "#303936", H.lineWidth = 6, H.lineCap = "round", H.lineJoin = "round", H.globalAlpha = Ve > .9 ? (1 - Ve) / .1 : 1, Ve < .5 ? er(H, dt, Fn(Ve / .45)) : (H.translate(pe, Fe), H.rotate((Ve - .5) * Math.PI * 3.4), er(H, dt.map(Ee => ({
      x: Ee.x - pe,
      y: Ee.y - Fe
    }))), H.fillStyle = "#303936", H.beginPath(), H.arc(0, 0, 11, 0, Math.PI * 2), H.fill()), H.restore(), Or(H.canvas, "draw-and-spin-blade");
  }
  function qo(H) {
    const _e = It() / 1e3,
      Me = H === "player" ? 0 : H === "copL" ? 1.3 : 2.2,
      Ie = _e * .75 - Me,
      me = 375 + Math.sin(Ie) * 130,
      ke = H === "player" ? 800 : 1040 + (H === "copR" ? 60 : 0);
    return {
      x: me + (H === "copL" ? -85 : H === "copR" ? 85 : 0),
      y: ke + Math.cos(Ie) * 28,
      angle: -Math.PI / 2 + Math.cos(Ie) * .18
    };
  }
  function paintPoliceRoute(ctx, points, progress = 1) {
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 8;
    ctx.lineCap = "square";
    ctx.lineJoin = "bevel";
    ctx.setLineDash([]);
    er(ctx, points, progress);
    ctx.restore();
  }
  function jo(H, _e, Me) {
    const Ie = It() / 1e3 % 5.4,
      me = [{
        x: _e.x,
        y: _e.y
      }, {
        x: _e.x - 110,
        y: _e.y - 260
      }, {
        x: Me.x + 105,
        y: Me.y + 380
      }, {
        x: Me.x + 65,
        y: Me.y + 175
      }, {
        x: Me.x,
        y: Me.y + Me.radius * .58
      }];
    H.save(), H.globalAlpha = Ln.matches ? 1 : Ie > 4.6 ? (5.4 - Ie) / .8 : 1, paintPoliceRoute(H, me, Ln.matches ? 1 : Fn(Ie / 1.9)), H.restore(), Or(H.canvas, "draw-route-to-escape");
  }
  function Wo(H, _e, Me, Ie) {
    const me = [H, _e];
    for (const Ee of Me) for (let je = 0; je < 12; je++) {
      const Ce = je * Math.PI / 6,
        ft = Ee.circleRadius + 16,
        pt = {
          x: Ee.position.x + Math.cos(Ce) * ft,
          y: Ee.position.y + Math.sin(Ce) * ft
        };
      pt.x > 15 && pt.x < Ie - 15 && me.push(pt);
    }
    const ke = me.map(() => 1 / 0),
      Ve = me.map(() => -1),
      pe = new Set();
    ke[0] = 0;
    const Fe = (Ee, je) => Me.every(Ce => {
      const ft = je.x - Ee.x,
        pt = je.y - Ee.y,
        zn = Jn(((Ce.position.x - Ee.x) * ft + (Ce.position.y - Ee.y) * pt) / Math.max(.01, ft * ft + pt * pt));
      return Math.hypot(Ee.x + ft * zn - Ce.position.x, Ee.y + pt * zn - Ce.position.y) > Ce.circleRadius + 7;
    });
    for (let Ee = 0; Ee < me.length; Ee++) {
      let je = -1;
      for (let Ce = 0; Ce < me.length; Ce++) !pe.has(Ce) && (je < 0 || ke[Ce] < ke[je]) && (je = Ce);
      if (je < 0 || !Number.isFinite(ke[je]) || je === 1) break;
      pe.add(je);
      for (let Ce = 0; Ce < me.length; Ce++) {
        if (pe.has(Ce) || !Fe(me[je], me[Ce])) continue;
        const ft = ke[je] + Math.hypot(me[je].x - me[Ce].x, me[je].y - me[Ce].y);
        ft < ke[Ce] && (ke[Ce] = ft, Ve[Ce] = je);
      }
    }
    if (Ve[1] < 0) return [H, {
      x: 20,
      y: H.y + 24
    }, {
      x: 20,
      y: _e.y - 28
    }, _e];
    const dt = [];
    for (let Ee = 1; Ee >= 0 && (dt.unshift(me[Ee]), Ee !== 0); Ee = Ve[Ee]);
    return dt;
  }
  let Ui = null;
  function Uo(H, _e, Me, Ie, me, ke, Ve) {
    if (!_e || !Me) return;
    const pe = It() / 1e3,
      Fe = pe % 5.6,
      dt = ke.filter(Ce => Ce.label === "obstacle"),
      Ee = JSON.stringify([_e, Me, Ve, dt.map(Ce => [Ce.position.x, Ce.position.y, Ce.circleRadius])]);
    Ui?.key !== Ee && (Ui = {
      key: Ee,
      points: Wo({
        x: _e.x,
        y: _e.y + 21
      }, {
        x: Me.x,
        y: Me.y - me * .42
      }, dt, Ve)
    });
    const je = Ui.points;
    if (H.save(), H.strokeStyle = "#242322", H.lineWidth = 5, H.lineCap = "round", H.lineJoin = "round", H.globalAlpha = Fe > 5 ? (5.6 - Fe) / .6 : 1, er(H, je, Fn(Fe / 1.7)), Fe > 1.4 && Fe < 5) for (let Ce = 0; Ce < 15; Ce++) {
      const ft = (Fe - 1.4) * .65 - Ce * .067;
      if (ft < 0 || ft > 1) continue;
      const pt = Qa(je, ft);
      H.fillStyle = "#59c6b1", H.strokeStyle = "#242322", H.lineWidth = 1, H.beginPath(), H.arc(pt.x, pt.y, 4, 0, Math.PI * 2), H.fill(), H.stroke();
    }
    H.restore(), Or(H.canvas, "guided-soda-route");
  }
  const Bi = document.createElement("style");
  Bi.dataset.batch2IdleStyle = "", Bi.textContent = `
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
  `, document.head.append(Bi), window.PlayableIdlePreview = Object.freeze({
    get active() {
      return nn && !document.hidden;
    },
    get preview() {
      return nn;
    },
    get reduced() {
      return Ln.matches;
    },
    get seconds() {
      return It() / 1e3;
    },
    clock: It,
    ease: Fn,
    clamp: Jn,
    stamp: Or,
    trace: er,
    route: paintPoliceRoute,
    onPath: Qa,
    ant: Lo,
    army: Fo,
    blade: zo,
    road: jo,
    roadPose: qo,
    soda: Uo,
    subscribe(H) {
      return Be.add(H), () => Be.delete(H);
    }
  }), addEventListener("message", H => {
    if (parent === window || H.source !== parent || H.origin !== location.origin || H.data?.type !== "playable-active") return;
    const _e = H.data.active !== true;
    _e !== nn && (nn = _e, ji = 0), Ar();
  }), document.addEventListener("visibilitychange", Ar), Ln.addEventListener?.("change", Ar), addEventListener("pagehide", () => {
    nn = false, Ar(), Be.clear();
  }, {
    once: true
  }), Ar();
})(), ReactDOM.createRoot(document.getElementById("root")).render(<><style>{PACKAGE_HTML_STYLES}</style>{<App />}</>);

/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    }
  };
  const selector = script?.getAttribute('data-subject') || '#root canvas';
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let observer,
    animation,
    entered = false;
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
        opacity: opacity * .76
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

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = ["[data-game-cta]"],
    copy = new Set(["DISEGNA LA VIA DI FUGA"].map(s => s.replace(/\s+/g, ' ').trim().toLowerCase()));
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
