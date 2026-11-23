/* DynaPuff font redistribution notice. Kept in source because runtime .txt assets are blocked.
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
    "id": "ANT_SPEED",
    "kind": "number",
    "label": "Ant speed",
    "value": 3,
    "default": 3,
    "min": 1,
    "max": 10,
    "step": 0.5
  }, {
    "id": "REWARD_AMOUNT",
    "kind": "number",
    "label": "Hit reward ($)",
    "value": 10,
    "default": 10,
    "min": 1,
    "max": 100,
    "step": 1
  }, {
    "id": "ADD_ANT_COST",
    "kind": "number",
    "label": "Add ant cost ($)",
    "value": 50,
    "default": 50,
    "min": 0,
    "max": 500,
    "step": 10
  }],
  "texts": [{
    "id": "TITLE_ANTS",
    "label": "Ant count text",
    "value": "Formiche",
    "default": "Formiche",
    "max_length": 15
  }, {
    "id": "BTN_ADD_ANT",
    "label": "Add ant button",
    "value": "Aggiungi",
    "default": "Aggiungi",
    "max_length": 15
  }, {
    "id": "BTN_CLEAR",
    "label": "Clear all button",
    "value": "Cancella tutto",
    "default": "Cancella tutto",
    "max_length": 15
  }, {
    "id": "HINT_TEXT",
    "label": "Hint text",
    "value": "Intrappola le formiche! +$10 a colpo",
    "default": "Intrappola le formiche! +$10 a colpo",
    "max_length": 50
  }],
  "images": [{
    "id": "BG_MAIN",
    "label": "Paper background",
    "path": "./assets/bg_paper_clean.svg",
    "replaceable": true
  }, {
    "id": "CHAR_ANT",
    "label": "Ant sprite",
    "path": "./assets/ant-ink-v2.svg",
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
const PACKAGE_HTML_STYLES = "\n    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }\n    body { background: #050510; -webkit-tap-highlight-color: transparent; }\n    /* Iteration repair: crop baked social-app chrome out of the decorative paper layer. */\n    div[style*=\"bg_paper_clean.svg\"] { background-size: cover !important; background-position: center !important; }\n    button:focus-visible { outline: 3px solid #2563eb; outline-offset: 3px; }\n  \n\n@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}\n.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}\n.feed-first-action[aria-hidden=\"true\"]{animation:none}\nhtml[data-feed-background] .feed-first-action{animation-play-state:paused}\n@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}\n\n/* User override 2026-10-21: favor visual center, not a fixed upper band. */\nhtml:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) [data-ant-playfield]>div{position:fixed!important;top:26%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}\nhtml[data-guide-action-used=\"true\"]:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) [data-ant-playfield]>div{visibility:hidden!important;opacity:0!important}\n\n\n@font-face{font-family:'DynaPuff';src:url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');font-style:normal;font-weight:600;font-display:swap}\n:root:root{--font-display:'DynaPuff',Georgia,serif;--font-body:'DynaPuff',Georgia,serif;--font-mono:'DynaPuff',Georgia,serif;--color-ink:#242322}\nhtml,body,#root{background:#a289cf!important}button{font-family:var(--font-display);-webkit-text-stroke:.12px currentColor}button:focus-visible{outline:3px solid #2858db;outline-offset:3px}\n\n#root>div>div[style*=\"bg_paper_clean.svg\"]{background-size:cover!important}\n[data-ant-playfield]>div{font-family:'DynaPuff',Georgia,serif!important;font-size:18px!important;font-weight:600!important;line-height:1.35!important}\n\n#root header,#root footer button{background-image:url('./assets/paper-grain.svg');background-size:220px 220px}\n[data-ant-playfield]{background-size:220px 220px!important}\n\n\nhtml[data-batch2-idle=\"true\"] [data-preview-hud]{visibility:hidden!important}\n";
// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import Matter from 'matter-js';
import * as Tone from 'tone';
function $T(t) {
  let e = {};
  return (t.tweaks || []).forEach(n => {
    e[n.id] = n.value;
  }), (t.texts || []).forEach(n => {
    e[n.id] = n.value;
  }), (t.images || []).forEach(n => {
    e[n.id] = n.path;
  }), (t.mentions || []).forEach(n => {
    e[n.id] = n.path != null && n.path !== "" ? n.path : n.value;
  }), (t.motions || []).forEach(n => {
    !n || !n.id || (n.base_path != null && n.base_path !== "" && (e[n.id] = n.base_path, e[n.id + "_BASE"] = n.base_path), n.frame_count != null && (e[n.id + "_COUNT"] = n.frame_count));
  }), e;
}
function QT() {
  return <style>{`
    
    :root {
      --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
      --font-body:    -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
      --font-mono:    ui-monospace, Menlo, monospace;
      
      --color-ink: #2a2a2a;
      --color-red: #d32f2f;
      --color-gray: #e0e0e0;
      --color-text-dim: #777;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: #f5eedc;
      user-select: none;
      -webkit-user-select: none;
    }
    * {
      box-sizing: border-box;
    }
  `}</style>;
}
function App() {
  let [t, e] = React.useState(null),
    [n, r] = React.useState(0),
    [o, i] = React.useState(1),
    [s, l] = React.useState(false),
    a = React.useRef(null),
    c = React.useRef(null),
    p = React.useRef(null),
    u = React.useRef(null),
    h = React.useRef([]),
    f = React.useRef(null),
    d = React.useRef(null),
    g = React.useRef(null),
    S = React.useRef(null),
    x = React.useRef(null),
    drawingPointer = React.useRef(null),
    addLock = React.useRef(false);
  React.useEffect(() => {
    let D = true;
    return (async () => {
      let E = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let M = await fetch("./game.config.json", {
          cache: "no-store"
        });
        M.ok && (E = await M.json());
      } catch {
        console.warn("Config load failed, using defaults");
      }
      D && e($T(E));
    })(), () => {
      D = false;
    };
  }, []);
  let v = async () => {
      if (!s) try {
        await Tone.start(), S.current = new Tone.Synth().toDestination(), S.current.volume.value = -10, x.current = new Tone.MembraneSynth().toDestination(), x.current.volume.value = -8, l(true);
      } catch (D) {
        console.warn("Audio init failed:", D);
      }
    },
    m = React.useCallback(() => {
      if (x.current) {
        let D = Tone.now();
        x.current.triggerAttackRelease("C3", "16n", D);
      }
    }, []),
    w = React.useCallback(D => {
      if (s && S.current) {
        let E = Tone.now();
        D === "add" && S.current.triggerAttackRelease("E4", "8n", E), D === "clear" && S.current.triggerAttackRelease("A3", "8n", E);
      }
    }, [s]),
    y = React.useCallback(() => {
      s && S.current && S.current.triggerAttackRelease("C3", "16n", Tone.now());
    }, [s]),
    _ = React.useCallback((D, E, M) => {
      if (!p.current) return;
      let P = Matter.Bodies.circle(D, E, 16, {
          label: "ant",
          friction: 0,
          frictionAir: 0,
          frictionStatic: 0,
          restitution: 1,
          inertia: 1 / 0,
          render: {
            visible: false
          }
        }),
        V = Math.random() * Math.PI * 2;
      Matter.Body.setVelocity(P, {
        x: Math.cos(V) * M,
        y: Math.sin(V) * M
      }), P.lastHitTime = 0, Matter.Composite.add(p.current.world, P);
    }, []),
    C = React.useCallback(() => {
      let D = c.current;
      if (!D || !p.current) return;
      let E = D.getContext("2d"),
        M = D.clientWidth,
        P = D.clientHeight;
      if (window.PlayableIdlePreview.active) {
        E.clearRect(0, 0, M, P);
        window.PlayableIdlePreview.ant(E, M, P, g.current);
        return;
      }
      E.clearRect(0, 0, M, P), E.lineWidth = 6, E.lineCap = "round", E.lineJoin = "round", E.strokeStyle = "#242322", h.current.forEach(F => {
        if (!(F.length < 2)) {
          E.beginPath(), E.moveTo(F[0].x, F[0].y);
          for (let Q = 1; Q < F.length; Q++) E.lineTo(F[Q].x, F[Q].y);
          E.stroke();
        }
      });
      let V = g.current;
      Matter.Composite.allBodies(p.current.world).forEach(F => {
        F.label === "ant" && (E.save(), E.translate(F.position.x, F.position.y), E.rotate(F.angle + Math.PI / 2), V && V.complete && V.naturalWidth > 0 ? E.drawImage(V, -16, -16, 32, 32) : (E.fillStyle = "#000", E.beginPath(), E.arc(0, 0, 10, 0, Math.PI * 2), E.fill()), E.restore());
      });
    }, []);
  React.useEffect(() => {
    if (!t || !a.current || !c.current) return;
    let D = new Image();
    D.src = t.CHAR_ANT || "", D.onload = () => {
      g.current = D;
    };
    let E = Matter.Engine.create();
    E.gravity.y = 0, E.gravity.x = 0, p.current = E;
    let M = a.current.clientWidth,
      P = a.current.clientHeight,
      V = {
        isStatic: true,
        label: "wall",
        friction: 0,
        restitution: 1
      },
      L = 60;
    let bounds = {
        width: M,
        height: P
      },
      walls = [];
    let resizeBounds = (width, height) => {
      if (width <= 36 || height <= 36) return;
      bounds.width = width, bounds.height = height;
      walls.length && Matter.Composite.remove(E.world, walls);
      walls = [Matter.Bodies.rectangle(width / 2, -L / 2, width + L * 2, L, V), Matter.Bodies.rectangle(width / 2, height + L / 2, width + L * 2, L, V), Matter.Bodies.rectangle(-L / 2, height / 2, L, height, V), Matter.Bodies.rectangle(width + L / 2, height / 2, L, height, V)];
      Matter.Composite.add(E.world, walls);
      Matter.Composite.allBodies(E.world).forEach(body => {
        if (body.label === "ant") Matter.Body.setPosition(body, {
          x: Math.max(18, Math.min(width - 18, body.position.x)),
          y: Math.max(18, Math.min(height - 18, body.position.y))
        });
      });
    };
    resizeBounds(M, P);
    _(18 + Math.random() * Math.max(0, M - 36), 18 + Math.random() * Math.max(0, P - 36), t.ANT_SPEED || 3);
    let F = ne => {
      ne.pairs.forEach(z => {
        let oe = z.bodyA,
          te = z.bodyB;
        if (oe.label === "ant" && te.label === "line" || te.label === "ant" && oe.label === "line") {
          let Le = oe.label === "ant" ? oe : te,
            tt = Date.now();
          tt - Le.lastHitTime > 300 && (Le.lastHitTime = tt, r(Oi => Oi + (t.REWARD_AMOUNT || 10)), m());
        }
      });
    };
    Matter.Events.on(E, "collisionStart", F);
    let Q = () => {
      let ne = t.ANT_SPEED || 3;
      Matter.Composite.allBodies(E.world).forEach(oe => {
        if (oe.label === "ant") {
          let bx = Math.max(18, Math.min(bounds.width - 18, oe.position.x)),
            by = Math.max(18, Math.min(bounds.height - 18, oe.position.y));
          if (bx !== oe.position.x || by !== oe.position.y) {
            let vx = oe.velocity.x,
              vy = oe.velocity.y;
            bx !== oe.position.x && (vx = bx === 18 ? Math.abs(vx) : -Math.abs(vx)), by !== oe.position.y && (vy = by === 18 ? Math.abs(vy) : -Math.abs(vy)), Matter.Body.setPosition(oe, {
              x: bx,
              y: by
            }), Matter.Body.setVelocity(oe, {
              x: vx,
              y: vy
            });
          }
          let te = oe.velocity,
            Le = Math.hypot(te.x, te.y);
          if (Le < .1) {
            let tt = Math.random() * Math.PI * 2;
            Matter.Body.setVelocity(oe, {
              x: Math.cos(tt) * ne,
              y: Math.sin(tt) * ne
            });
          } else {
            let tt = ne / Le;
            Matter.Body.setVelocity(oe, {
              x: te.x * tt,
              y: te.y * tt
            }), Matter.Body.setAngle(oe, Math.atan2(te.y, te.x));
          }
        }
      });
    };
    Matter.Events.on(E, "beforeUpdate", Q);
    let re = performance.now(),
      $ = () => {
        u.current = requestAnimationFrame($);
        let ne = performance.now(),
          z = Math.min(ne - re, 50);
        re = ne, !window.PlayableIdlePreview.preview && !document.hidden && Matter.Engine.update(E, z), C();
      };
    $();
    let H = window.devicePixelRatio || 1,
      Y = new ResizeObserver(ne => {
        for (let z of ne) {
          let {
            clientWidth: oe,
            clientHeight: te
          } = z.target;
          if (oe > 0 && te > 0) {
            if (oe !== bounds.width || te !== bounds.height) {
              h.current = [], f.current = null, d.current = null, drawingPointer.current = null;
              Matter.Composite.remove(E.world, Matter.Composite.allBodies(E.world).filter(body => body.label === "line"));
              resizeBounds(oe, te);
            }
            let Le = c.current;
            Le && (Le.width = oe * H, Le.height = te * H, Le.style.width = `${oe}px`, Le.style.height = `${te}px`, Le.getContext("2d", {
              alpha: true
            }).setTransform(H, 0, 0, H, 0, 0));
          }
        }
      });
    return Y.observe(a.current), () => {
      Y.disconnect(), cancelAnimationFrame(u.current), Matter.Events.off(E, "collisionStart", F), Matter.Events.off(E, "beforeUpdate", Q), Matter.Engine.clear(E), Matter.World.clear(E.world);
    };
  }, [t, _, m, C]);
  let point = D => {
      let rect = c.current.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(c.current.clientWidth, (D.clientX - rect.left) * c.current.clientWidth / rect.width)),
        y: Math.max(0, Math.min(c.current.clientHeight, (D.clientY - rect.top) * c.current.clientHeight / rect.height))
      };
    },
    T = D => {
      if (D.isPrimary === false || D.button != null && D.button !== 0 || !c.current || drawingPointer.current !== null) return;
      D.preventDefault(), D.currentTarget.setPointerCapture(D.pointerId), drawingPointer.current = D.pointerId;
      let pos = point(D);
      f.current = [pos], h.current.push(f.current), d.current = pos;
      void v();
    },
    A = D => {
      if (D.pointerId !== drawingPointer.current || !f.current || !p.current || !d.current) return;
      D.preventDefault();
      let pos = point(D),
        L = pos.x - d.current.x,
        F = pos.y - d.current.y,
        Q = Math.hypot(L, F);
      if (Q > 8) {
        f.current.push(pos);
        let re = d.current.x + L / 2,
          $ = d.current.y + F / 2,
          H = Math.atan2(F, L),
          Y = Matter.Bodies.rectangle(re, $, Q + 4, 6, {
            isStatic: true,
            label: "line",
            angle: H,
            friction: .1,
            restitution: .5
          });
        Matter.Composite.add(p.current.world, Y), d.current = pos;
      }
    },
    k = D => {
      if (D && D.pointerId !== drawingPointer.current) return;
      f.current = null, d.current = null, drawingPointer.current = null;
      D && D.currentTarget.hasPointerCapture(D.pointerId) && D.currentTarget.releasePointerCapture(D.pointerId);
    },
    N = async D => {
      D.stopPropagation();
      if (addLock.current) return;
      addLock.current = true;
      try {
        await v();
        let E = t.ADD_ANT_COST ?? 50;
        if (n >= E && a.current) {
          r(V => V - E), i(V => V + 1);
          let M = a.current.clientWidth,
            P = a.current.clientHeight;
          _(18 + Math.random() * Math.max(0, M - 36), 18 + Math.random() * Math.max(0, P - 36), t.ANT_SPEED || 3), w("add");
        } else y();
      } finally {
        addLock.current = false;
      }
    },
    O = async D => {
      if (D.stopPropagation(), await v(), !p.current) return;
      h.current = [], f.current = null, d.current = null;
      let active = drawingPointer.current;
      drawingPointer.current = null;
      if (active !== null && a.current?.hasPointerCapture(active)) a.current.releasePointerCapture(active);
      let M = Matter.Composite.allBodies(p.current.world).filter(P => P.label === "line");
      Matter.Composite.remove(p.current.world, M), w("clear");
    };
  if (!t) return <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#a289cf"
  }} />;
  let b = t.ADD_ANT_COST ?? 50,
    I = n >= b;
  return <div style={{
    width: "100%",
    height: "100%",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "calc(30px + env(safe-area-inset-top, 0px)) 30px calc(50px + env(safe-area-inset-bottom, 0px))",
    containerType: "inline-size"
  }}>{<QT />}{<div style={{
      position: "absolute",
      inset: 0,
      backgroundImage: `url(${t.BG_MAIN})`,
      backgroundSize: "cover",
      opacity: 1,
      zIndex: 0,
      pointerEvents: "none"
    }} />}{<header data-preview-hud={"ant-status"} style={{
      position: "relative",
      zIndex: 2,
      flex: "0 0 auto",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "10px 16px",
      border: "1.6px solid #242322",
      borderRadius: "2px 5px 3px 4px",
      background: "#d8eb61",
      boxShadow: "2px 3px 0 #242322"
    }}>{<div style={{
        fontFamily: "var(--font-display)",
        fontSize: "28px",
        lineHeight: 1.2,
        color: "#2a2a2a"
      }}>{"$"}{n}</div>}{<div style={{
        fontFamily: "var(--font-body)",
        fontSize: "28px",
        lineHeight: 1.2,
        color: "#242322"
      }} aria-label={"Formiche " + o}>{<span style={{
          fontSize: 12,
          marginRight: 6
        }}>{t.TITLE_ANTS}</span>}{o}</div>}</header>}{<div ref={a} data-ant-playfield={true} style={{
      position: "relative",
      flex: "1 1 0",
      minHeight: "120px",
      overflow: "hidden",
      zIndex: 1,
      touchAction: "none",
      border: "1.6px solid #242322",
      borderRadius: "3px 6px 5px 2px",
      backgroundColor: "#fff8df",
      backgroundImage: "url(./assets/paper-grain.svg)",
      backgroundSize: "150px 150px",
      boxShadow: "2px 3px 0 #242322"
    }} onPointerDown={T} onPointerMove={A} onPointerUp={k} onPointerCancel={k} onLostPointerCapture={k}>{<canvas ref={c} style={{
        display: "block",
        touchAction: "none"
      }} />}{<div style={{
        position: "absolute",
        top: "18px",
        left: "16px",
        right: "16px",
        textAlign: "center",
        pointerEvents: "none",
        fontFamily: "var(--font-body)",
        fontSize: "18px",
        lineHeight: 1.3,
        color: "#242322",
        WebkitTextStroke: ".2px currentColor",
        opacity: s ? 0 : 1
      }}>{"Disegna per intrappolare le formiche"}</div>}</div>}{<footer style={{
      position: "relative",
      flex: "0 0 auto",
      display: "flex",
      gap: "12px",
      zIndex: 2
    }}>{<button onClick={N} aria-disabled={!I} style={{
        flex: 1,
        minWidth: 0,
        minHeight: "70px",
        padding: "10px 8px",
        background: I ? "#d8eb61" : "#d7c8e8",
        border: "1.6px solid #242322",
        borderRadius: "3px 5px 2px 4px",
        color: "#242322",
        boxShadow: "2px 3px 0 #242322",
        fontFamily: "var(--font-display)",
        fontSize: "19px",
        lineHeight: 1.15,
        cursor: I ? "pointer" : "not-allowed"
      }}>{<div style={{
          overflowWrap: "anywhere"
        }}>{t.BTN_ADD_ANT}</div>}{<div style={{
          fontFamily: "var(--font-body)",
          fontSize: "12px",
          marginTop: "4px"
        }}>{"$"}{b}</div>}</button>}{<button onClick={O} style={{
        flex: 1,
        minWidth: 0,
        minHeight: "70px",
        padding: "10px 8px",
        background: "#ee94ac",
        border: "1.6px solid #242322",
        borderRadius: "4px 2px 5px 3px",
        color: "#242322",
        fontFamily: "var(--font-display)",
        fontSize: "19px",
        lineHeight: 1.15,
        cursor: "pointer",
        boxShadow: "2px 3px 0 #242322"
      }}>{<div style={{
          overflowWrap: "anywhere"
        }}>{t.BTN_CLEAR}</div>}{<div style={{
          fontFamily: "var(--font-body)",
          fontSize: "12px",
          marginTop: "4px"
        }}>{"Gratis"}</div>}</button>}</footer>}</div>;
}
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
(() => {
  if (new URLSearchParams(location.search).get('feedReview') !== '1') return;
  let active = false,
    alive = true;
  const waiting = new Set(),
    contexts = new Set(),
    media = new Set(),
    streams = new Set();
  const wait = () => alive ? new Promise((resolve, reject) => waiting.add({
    resolve,
    reject
  })) : Promise.reject(new DOMException('Feed closed', 'AbortError'));
  if (navigator.mediaDevices?.getUserMedia) {
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!active) await wait();
      if (!alive) throw new DOMException('Feed closed', 'AbortError');
      const stream = await native(constraints);
      if (!alive || !active) {
        stream.getTracks().forEach(track => track.stop());
        throw new DOMException('Feed inactive', 'AbortError');
      }
      streams.add(stream);
      return stream;
    };
  }
  for (const key of ['AudioContext', 'webkitAudioContext']) {
    const Native = window[key];
    if (!Native) continue;
    window[key] = class FeedAudioContext extends Native {
      constructor(...args) {
        super(...args);
        contexts.add(this);
        if (!active) super.suspend().catch(() => {});
      }
      async resume() {
        if (!active) await wait();
        if (alive) return super.resume();
      }
    };
  }
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = async function (...args) {
    media.add(this);
    if (!active) await wait();
    if (alive) return nativePlay.apply(this, args);
  };
  addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = alive && event.data.active === true;
    if (active) {
      for (const job of waiting) job.resolve();
      waiting.clear();
      for (const context of contexts) if (context.state !== 'closed') context.resume().catch(() => {});
    } else {
      for (const context of contexts) if (context.state !== 'closed') context.suspend().catch(() => {});
      for (const item of media) item.pause();
      for (const stream of streams) stream.getTracks().forEach(track => track.stop());
      streams.clear();
    }
  });
  addEventListener('pagehide', () => {
    alive = false;
    active = false;
    for (const job of waiting) job.reject(new DOMException('Feed closed', 'AbortError'));
    waiting.clear();
    for (const context of contexts) if (context.state !== 'closed') context.close().catch(() => {});
    for (const item of media) item.pause();
    for (const stream of streams) stream.getTracks().forEach(track => track.stop());
  }, {
    once: true
  });
})();
(function () {
  if (window.location.protocol !== 'file:') return;
  var configText = {
    textContent: JSON.stringify(PACKAGE_CONFIG_FALLBACK)
  }.textContent;
  var nativeFetch = window.fetch;
  window.fetch = function (input) {
    var url = typeof input === 'string' ? input : input && input.url || '';
    if (/(^|\/)game\.config\.json(?:[?#]|$)/.test(url)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () {
          return Promise.resolve(JSON.parse(configText));
        },
        text: function () {
          return Promise.resolve(configText);
        }
      });
    }
    return nativeFetch.apply(window, arguments);
  };
})();
ReactDOM.createRoot(document.getElementById("root")).render(<><style>{PACKAGE_HTML_STYLES}</style>{<App />}</>);
(() => {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root canvas"
      }[name] ?? null;
    }
  };
  const actionRoot = "[data-ant-playfield]";
  if (!actionRoot) return;
  const arrowButtons = '';
  const ignored = '';
  const arrowKeys = false;
  const html = document.documentElement;
  const hosted = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !hosted,
    used = false;
  const element = target => target && typeof target.closest === 'function' ? target : null;
  const unrelated = target => !!target.closest('input,select,textarea,a,[contenteditable="true"],[role="button"],[data-settings]');
  function dismiss() {
    if (used) return;
    used = true;
    html.setAttribute('data-guide-action-used', 'true');
  }
  function pointer(event) {
    if (!active || used || event.isTrusted === false || event.isPrimary === false || event.button != null && event.button !== 0) return;
    const target = element(event.target);
    if (!target || unrelated(target) || ignored && target.closest(ignored)) return;
    const arrow = arrowButtons && target.closest(arrowButtons);
    if (target.closest('button') && !arrow) return;
    if (arrow || target.closest(actionRoot)) dismiss();
  }
  function key(event) {
    if (!arrowKeys || !active || used || event.isTrusted === false || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const target = element(event.target);
    if (target && (unrelated(target) || target.closest('input,select,textarea,button'))) return;
    dismiss();
  }
  function message(event) {
    if (!hosted || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
  }
  document.addEventListener('pointerdown', pointer, {
    capture: true,
    passive: true
  });
  if (arrowKeys) document.addEventListener('keydown', key, {
    capture: true,
    passive: true
  });
  addEventListener('message', message);
  addEventListener('pagehide', () => {
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('keydown', key, true);
    removeEventListener('message', message);
  }, {
    once: true
  });
})();
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root canvas"
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
(() => {
  if (parent === window) return;
  const BAND = {
    w: 32,
    h: 12
  };
  const post = (top, bottom) => parent.postMessage({
    type: 'playable-palette',
    top,
    bottom
  }, '*');
  function mainCanvas() {
    const canvases = [...document.querySelectorAll('canvas')].filter(c => c.width && c.height);
    const source = canvases.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    return source && source.clientWidth * source.clientHeight >= innerWidth * innerHeight * 0.3 ? source : null;
  }
  function sampleCanvas(source) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = BAND.w;
      canvas.height = 48;
      const ctx = canvas.getContext('2d', {
        willReadFrequently: true
      });
      for (let node = source; node && node.nodeType === 1; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        const channels = color.match(/[\d.]+/g);
        if (channels && (channels[3] === undefined || Number(channels[3]) > .5)) {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, BAND.w, 48);
          break;
        }
      }
      ctx.drawImage(source, 0, 0, BAND.w, 48);
      const top = Array.from(ctx.getImageData(0, 0, BAND.w, BAND.h).data);
      const bottom = Array.from(ctx.getImageData(0, 48 - BAND.h, BAND.w, BAND.h).data);
      return top.some((v, i) => i % 4 === 3 && v > 0) ? [top, bottom] : null;
    } catch {
      return null;
    }
  }
  function sampleDom() {
    const rgba = el => {
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const match = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
        if (match && (match[3] === undefined || Number(match[3]) > 0.5)) return [+match[0], +match[1], +match[2], 255];
      }
      return null;
    };
    const band = y0 => {
      const out = [];
      for (let row = 0; row < BAND.h; row++) for (let col = 0; col < BAND.w; col++) {
        const x = (col + 0.5) / BAND.w * innerWidth,
          y = y0 + (row + 0.5) / BAND.h * innerHeight * 0.25;
        out.push(...(rgba(document.elementFromPoint(x, y)) ?? rgba(document.body) ?? rgba(document.documentElement) ?? [0, 0, 0, 0]));
      }
      return out;
    };
    const top = band(0),
      bottom = band(innerHeight * 0.75);
    return top.some((v, i) => i % 4 === 3 && v > 0) ? [top, bottom] : null;
  }
  let sampledOnce = false;
  function sample() {
    if (document.documentElement.dataset.playableLoading === 'true') return;
    const land = found => {
      if (found) {
        sampledOnce = true;
        post(...found);
      }
      return !!found;
    };
    const source = mainCanvas();
    if (!source) {
      if (document.body?.childElementCount) land(sampleDom());
      return;
    }
    if (!land(sampleCanvas(source))) requestAnimationFrame(() => land(sampleCanvas(source)));
  }
  const schedule = () => {
    sample();
    setTimeout(schedule, sampledOnce ? 1000 : 250);
  };
  if (document.readyState === 'complete') setTimeout(schedule, 300);else window.addEventListener('load', () => setTimeout(schedule, 300), {
    once: true
  });
})();
(() => {
  const style = document.createElement("style");
  style.textContent = "html[data-batch2-idle=\"true\"] footer{visibility:hidden;pointer-events:none}";
  document.body.append(style);
})();

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = ["[data-ant-playfield]>div"],
    copy = new Set(["Intrappola le formiche! +$10 a colpo"].map(s => s.replace(/\s+/g, ' ').trim().toLowerCase()));
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
