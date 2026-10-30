/* Consolidated CURRENT browser application. Valid JavaScript/JSX-subset source.
 * Rebuild: node check.js --build. No historical authoring version is substituted.
 * External helpers and inline entry code are preserved in their original execution order.
 */
// TEMPLATE_HTML_BASE64: PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9Iml0Ij4KPGhlYWQ+CgogIDxtZXRhIGNoYXJzZXQ9IlVURi04IiAvPgogIDxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsIGluaXRpYWwtc2NhbGU9MS4wLCBtYXhpbXVtLXNjYWxlPTEuMCwgdXNlci1zY2FsYWJsZT1ubyIgLz4KICA8dGl0bGU+RGlzZWduYSB1biB2aXNvPC90aXRsZT4KICA8c3R5bGU+CiAgICBodG1sLCBib2R5LCAjcm9vdCB7IHdpZHRoOiAxMDAlOyBoZWlnaHQ6IDEwMCU7IG1hcmdpbjogMDsgcGFkZGluZzogMDsgb3ZlcmZsb3c6IGhpZGRlbjsgfQogICAgYm9keSB7IGJhY2tncm91bmQ6ICNmZGY4ZWE7IG92ZXJzY3JvbGwtYmVoYXZpb3I6IG5vbmU7IHRvdWNoLWFjdGlvbjogbm9uZTsgdXNlci1zZWxlY3Q6IG5vbmU7IC13ZWJraXQtdXNlci1zZWxlY3Q6IG5vbmU7IC13ZWJraXQtdGFwLWhpZ2hsaWdodC1jb2xvcjogdHJhbnNwYXJlbnQ7IH0KICA8L3N0eWxlPgo8c3R5bGUgaWQ9ImZlZWQtZW50cnktbW90aW9uIj4KQGtleWZyYW1lcyBmZWVkLXByb21wdC1icmVhdGhlezAlLDEwMCV7b3BhY2l0eToxfTUwJXtvcGFjaXR5Oi43OH19Ci5mZWVkLWZpcnN0LWFjdGlvbnthbmltYXRpb246ZmVlZC1wcm9tcHQtYnJlYXRoZSAyLjRzIGVhc2UtaW4tb3V0IGluZmluaXRlfQouZmVlZC1maXJzdC1hY3Rpb25bYXJpYS1oaWRkZW49InRydWUiXXthbmltYXRpb246bm9uZX0KaHRtbFtkYXRhLWZlZWQtYmFja2dyb3VuZF0gLmZlZWQtZmlyc3QtYWN0aW9ue2FuaW1hdGlvbi1wbGF5LXN0YXRlOnBhdXNlZH0KQG1lZGlhKHByZWZlcnMtcmVkdWNlZC1tb3Rpb246cmVkdWNlKXsuZmVlZC1maXJzdC1hY3Rpb257YW5pbWF0aW9uOm5vbmV9fQo8L3N0eWxlPgo8c3R5bGUgZGF0YS1ndWlkZS1icmVhdGhpbmc9IjIwMjYxMDIxIj4KLyogRXhpc3RpbmcgZ3VpZGUgdGV4dCBvbmx5OyBwb3NpdGlvbiwgb3BhY2l0eSBsaWZlY3ljbGUgYW5kIGhpdCByZWdpb25zIHJlbWFpbiBnYW1lLW93bmVkLiAqLwpAa2V5ZnJhbWVzIGJhdGNoLWd1aWRlLWJyZWF0aGV7MCUsMTAwJXtmaWx0ZXI6b3BhY2l0eSgxKX01MCV7ZmlsdGVyOm9wYWNpdHkoLjY1KX19Cmh0bWw6cm9vdDpyb290IDppcyguZmFjZS1nYW1lX19wcm9tcHQpe2FuaW1hdGlvbjpiYXRjaC1ndWlkZS1icmVhdGhlIDIuNHMgZWFzZS1pbi1vdXQgaW5maW5pdGUhaW1wb3J0YW50fQpodG1sW2RhdGEtZ3VpZGUtYnJlYXRoaW5nLXBhdXNlZF06cm9vdDpyb290IDppcyguZmFjZS1nYW1lX19wcm9tcHQpe2FuaW1hdGlvbi1wbGF5LXN0YXRlOnBhdXNlZCFpbXBvcnRhbnR9CkBtZWRpYShwcmVmZXJzLXJlZHVjZWQtbW90aW9uOnJlZHVjZSl7aHRtbDpyb290OnJvb3QgOmlzKC5mYWNlLWdhbWVfX3Byb21wdCl7YW5pbWF0aW9uOm5vbmUhaW1wb3J0YW50fX0KCjwvc3R5bGU+Cgo8c3R5bGUgZGF0YS1pdGFsaWFuLWxheW91dD0iIj4KLyogSXRhbGlhbiBjb3B5IGtlZXBzIHRoZSBhcHByb3ZlZCByb2xlIHNpemVzIGFuZCBtYXkgd3JhcCBpbnN0ZWFkIG9mIGNsaXBwaW5nLiAqLwpodG1sW2xhbmc9Iml0Il0gOmlzKC5tZWV0aW5nLWd1aWRlLC5mZWVkLWZpcnN0LWFjdGlvbiwubWVsb2R5LWd1aWRlLC5wYXJ0aWNsZS1ndWlkZSwuZGl2ZS1ndWlkZSwuc2FuZGJveC1ndWlkZSwua29pLWd1aWRlLC51aS1ndWlkZSwuYmVhZC1ndWlkZSwuY29sb3JpbmctZ3VpZGUsLmxvb2stZ3VpZGUsLnRpbWUtcHJpbnQtZ3VpZGUpe3doaXRlLXNwYWNlOm5vcm1hbDtvdmVyZmxvdy13cmFwOm5vcm1hbDt3b3JkLWJyZWFrOm5vcm1hbDtsaW5lLWhlaWdodDoxLjR9Cmh0bWxbbGFuZz0iaXQiXSA6aXMoYnV0dG9uLC5idG4sLmJ0bi1uZW9uKXtvdmVyZmxvdy13cmFwOm5vcm1hbDt3b3JkLWJyZWFrOm5vcm1hbH0KaHRtbFtsYW5nPSJpdCJdIC5tZWxvZHktY29udHJvbHMgYnV0dG9ue2ZvbnQtc2l6ZToxOHB4O3BhZGRpbmctaW5saW5lOjEycHh9Cmh0bWxbbGFuZz0iaXQiXSAubWVldGluZy1zYW5kLWJhbGwtY291bnR7Z2FwOjZweCFpbXBvcnRhbnR9Cmh0bWxbbGFuZz0iaXQiXSAjcGVvcGxlLWRpYWxvZyBmaWVsZHNldCBsYWJlbHttaW4td2lkdGg6MH0KaHRtbFtsYW5nPSJpdCJdICNwZW9wbGUtZGlhbG9nIGlucHV0e21heC13aWR0aDoxMDAlO21pbi13aWR0aDowfQoKPC9zdHlsZT4KPC9oZWFkPgo8Ym9keT4KICA8ZGl2IGlkPSJyb290Ij48L2Rpdj4KICA8c2NyaXB0IGlkPSJwbGF5YWJsZS1pbmxpbmUtY29uZmlnIiB0eXBlPSJhcHBsaWNhdGlvbi9qc29uIj57InR3ZWFrcyI6W3siaWQiOiJCUlVTSF9TSVpFIiwia2luZCI6Im51bWJlciIsImxhYmVsIjoiQnJ1c2ggU2l6ZSIsInZhbHVlIjo0LCJkZWZhdWx0Ijo0LCJtaW4iOjEsIm1heCI6MjAsInN0ZXAiOjF9XSwidGV4dHMiOlt7ImlkIjoiQlROX0NMRUFSIiwibGFiZWwiOiJDbGVhciBCdXR0b24gVGV4dCIsInZhbHVlIjoiQ0FOQ0VMTEEiLCJkZWZhdWx0IjoiQ0FOQ0VMTEEiLCJtYXhfbGVuZ3RoIjoxMH0seyJpZCI6IkJUTl9ORVhUIiwibGFiZWwiOiJOZXh0IEJ1dHRvbiBUZXh0IiwidmFsdWUiOiJBVkFOVEkiLCJkZWZhdWx0IjoiQVZBTlRJIiwibWF4X2xlbmd0aCI6MTB9LHsiaWQiOiJCVE5fRklOSVNIIiwibGFiZWwiOiJGaW5pc2ggQnV0dG9uIFRleHQiLCJ2YWx1ZSI6IkZBVFRPIiwiZGVmYXVsdCI6IkZBVFRPIiwibWF4X2xlbmd0aCI6MTB9LHsiaWQiOiJCVE5fQkxJTksiLCJsYWJlbCI6IkJsaW5rIEJ1dHRvbiBUZXh0IiwidmFsdWUiOiJTQkFUVEkgTEUgUEFMUEVCUkUiLCJkZWZhdWx0IjoiU0JBVFRJIExFIFBBTFBFQlJFIiwibWF4X2xlbmd0aCI6MTh9LHsiaWQiOiJCVE5fU05JRkYiLCJsYWJlbCI6IlNuaWZmIEJ1dHRvbiBUZXh0IiwidmFsdWUiOiJBTk5VU0EiLCJkZWZhdWx0IjoiQU5OVVNBIiwibWF4X2xlbmd0aCI6MTR9LHsiaWQiOiJCVE5fVEFMSyIsImxhYmVsIjoiVGFsayBCdXR0b24gVGV4dCIsInZhbHVlIjoiUEFSTEEiLCJkZWZhdWx0IjoiUEFSTEEiLCJtYXhfbGVuZ3RoIjoxNH0seyJpZCI6IkJUTl9BR0FJTiIsImxhYmVsIjoiRHJhdyBBZ2FpbiBCdXR0b24gVGV4dCIsInZhbHVlIjoiUklESVNFR05BIiwiZGVmYXVsdCI6IlJJRElTRUdOQSIsIm1heF9sZW5ndGgiOjIwfSx7ImlkIjoiVFhUX1NURVAiLCJsYWJlbCI6IlN0ZXAgTGFiZWwiLCJ2YWx1ZSI6IkZBU0UiLCJkZWZhdWx0IjoiRkFTRSIsIm1heF9sZW5ndGgiOjEyfSx7ImlkIjoiVFhUX09GIiwibGFiZWwiOiJTdGVwIFNlcGFyYXRvciIsInZhbHVlIjoiREkiLCJkZWZhdWx0IjoiREkiLCJtYXhfbGVuZ3RoIjoxMn0seyJpZCI6IlBST01QVF8xIiwibGFiZWwiOiJTdGVwIDEgUHJvbXB0IiwidmFsdWUiOiJEaXNlZ25hIGdsaSBvY2NoaSBhcGVydGkiLCJkZWZhdWx0IjoiRGlzZWduYSBnbGkgb2NjaGkgYXBlcnRpIiwibWF4X2xlbmd0aCI6NDB9LHsiaWQiOiJQUk9NUFRfMiIsImxhYmVsIjoiU3RlcCAyIFByb21wdCIsInZhbHVlIjoiRGlzZWduYSBnbGkgb2NjaGkgY2hpdXNpIiwiZGVmYXVsdCI6IkRpc2VnbmEgZ2xpIG9jY2hpIGNoaXVzaSIsIm1heF9sZW5ndGgiOjQwfSx7ImlkIjoiUFJPTVBUXzMiLCJsYWJlbCI6IlN0ZXAgMyBQcm9tcHQiLCJ2YWx1ZSI6IkRpc2VnbmEgdW4gbmFzbyIsImRlZmF1bHQiOiJEaXNlZ25hIHVuIG5hc28iLCJtYXhfbGVuZ3RoIjo0MH0seyJpZCI6IlBST01QVF80IiwibGFiZWwiOiJTdGVwIDQgUHJvbXB0IiwidmFsdWUiOiJEaXNlZ25hIHVuIG5hc28gcGljY29sbyIsImRlZmF1bHQiOiJEaXNlZ25hIHVuIG5hc28gcGljY29sbyIsIm1heF9sZW5ndGgiOjQwfSx7ImlkIjoiUFJPTVBUXzUiLCJsYWJlbCI6IlN0ZXAgNSBQcm9tcHQiLCJ2YWx1ZSI6IkRpc2VnbmEgbGEgYm9jY2EgYXBlcnRhIiwiZGVmYXVsdCI6IkRpc2VnbmEgbGEgYm9jY2EgYXBlcnRhIiwibWF4X2xlbmd0aCI6NDB9LHsiaWQiOiJQUk9NUFRfNiIsImxhYmVsIjoiU3RlcCA2IFByb21wdCIsInZhbHVlIjoiRGlzZWduYSBsYSBib2NjYSBzb2NjaGl1c2EiLCJkZWZhdWx0IjoiRGlzZWduYSBsYSBib2NjYSBzb2NjaGl1c2EiLCJtYXhfbGVuZ3RoIjo0MH0seyJpZCI6IlBST01QVF83IiwibGFiZWwiOiJTdGVwIDcgUHJvbXB0IiwidmFsdWUiOiJEaXNlZ25hIGxhIGJvY2NhIGNoaXVzYSIsImRlZmF1bHQiOiJEaXNlZ25hIGxhIGJvY2NhIGNoaXVzYSIsIm1heF9sZW5ndGgiOjQwfSx7ImlkIjoiTVNHX0RPTkUiLCJsYWJlbCI6IkRvbmUgTWVzc2FnZSIsInZhbHVlIjoiSUwgVFVPIFZJU08hIiwiZGVmYXVsdCI6IklMIFRVTyBWSVNPISIsIm1heF9sZW5ndGgiOjYwfV0sImltYWdlcyI6W10sImNvbmZpZ192ZXJzaW9uIjoiMi4wIiwicGxheWFibGUiOnsicnVudGltZV90YXJnZXQiOiJoNSIsImg1X3BsYXlzdHlsZV90eXBlIjoiZ2VuZXJhbF9nYW1lIiwiY29udGVudF9sb2NhbGUiOiJpdCIsIm1pbl9jYXBhYmlsaXR5X2xldmVsIjoxLCJmdWxsX2NhcGFiaWxpdHlfbGV2ZWwiOjF9fTwvc2NyaXB0PgogIAogIAoKPCEtLSBDVEFfQlJFQVRISU5HX1NUQVJUIC0tPgoKPCEtLSBDVEFfQlJFQVRISU5HX0VORCAtLT4KPHNjcmlwdCBzcmM9Ii4vYnVuZGxlLmpzIj48L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==

;/* Current runtime segment: inline-0 */

// Active only inside the feed reviewer. Ordinary standalone games are unchanged.
(() => {
  if (new URLSearchParams(location.search).get('feedReview') !== '1') return;
  let active=false,alive=true;
  const waiting=new Set(),contexts=new Set(),media=new Set(),streams=new Set();
  const wait=()=>alive ? new Promise((resolve,reject)=>waiting.add({resolve,reject})) : Promise.reject(new DOMException('Feed closed','AbortError'));
  if(navigator.mediaDevices?.getUserMedia){
    const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{
      if(!active)await wait();if(!alive)throw new DOMException('Feed closed','AbortError');
      const stream=await native(constraints);
      if(!alive||!active){stream.getTracks().forEach(track=>track.stop());throw new DOMException('Feed inactive','AbortError');}
      streams.add(stream);return stream;
    };
  }
  for(const key of ['AudioContext','webkitAudioContext']){
    const Native=window[key];if(!Native)continue;
    window[key]=class FeedAudioContext extends Native {
      constructor(...args){super(...args);contexts.add(this);if(!active)super.suspend().catch(()=>{});}
      async resume(){if(!active)await wait();if(alive)return super.resume();}
    };
  }
  const nativePlay=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=async function(...args){media.add(this);if(!active)await wait();if(alive)return nativePlay.apply(this,args);};
  addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='playable-active')return;
    active=alive&&event.data.active===true;
    if(active){for(const job of waiting)job.resolve();waiting.clear();for(const context of contexts)if(context.state!=='closed')context.resume().catch(()=>{});}
    else {for(const context of contexts)if(context.state!=='closed')context.suspend().catch(()=>{});for(const item of media)item.pause();for(const stream of streams)stream.getTracks().forEach(track=>track.stop());streams.clear();}
  });
  addEventListener('pagehide',()=>{alive=false;active=false;for(const job of waiting)job.reject(new DOMException('Feed closed','AbortError'));waiting.clear();for(const context of contexts)if(context.state!=='closed')context.close().catch(()=>{});for(const item of media)item.pause();for(const stream of streams)stream.getTracks().forEach(track=>track.stop());},{once:true});
})();

;

;/* Current runtime segment: entry-preview-guide.it.js */
var __PLAYABLE_TEMPLATE_SCRIPT_1=(()=>{var node=document.createElement("script");for(var entry of Object.entries({"src":"./entry-preview-guide.it.js?l10n=64738a20889c&v=entry-batch1-5da9095578fa","data-entry-demo":"face"}))node.setAttribute(entry[0],entry[1]);return node;})();
/* Decorative, game-specific guidance. Never dispatches input or changes game state. */
(() => {
  'use strict';
  const mode = __PLAYABLE_TEMPLATE_SCRIPT_1?.getAttribute('data-entry-demo');
  if (!['face', 'one-stroke', 'dumpling'].includes(mode)) return;
  const html = document.documentElement;
  const host = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let interacted = false, active = !host, layer = null, board = null, resize = null, compactGuide = null;
  const animations = [];
  html.toggleAttribute('data-entry-feed-preview', host);
  const style = document.createElement('style');
  style.textContent = `
    .entry-demo-layer{position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:8}
    .entry-demo-layer svg{display:block;width:100%;height:100%;overflow:visible}
    .entry-demo-guide-path{fill:none;stroke:var(--primary,#6c5ce7);stroke-width:8;stroke-linecap:round;stroke-linejoin:round;opacity:.78}
    .entry-demo-bun{position:absolute;width:40px;height:40px;object-fit:contain;transform:translate(-50%,-50%);opacity:0;pointer-events:none}
    .entry-demo-cursor{position:absolute;width:18px;height:18px;border:2px solid #6f3218;border-radius:50%;background:#fff9;transform:translate(-50%,-50%);pointer-events:none;opacity:0}
    html[data-entry-feed-preview] .face-game__header{position:absolute;top:12%;left:30px;right:30px;padding:0}
    html[data-entry-feed-preview] .face-game__prompt{font-size:18px;line-height:1.4}
    html[data-entry-feed-preview] #draw-workspace{position:absolute;top:27%;bottom:27%;left:30px;right:30px;padding:0}
    html[data-entry-feed-preview] #draw-toolbar{visibility:hidden}
    html[data-entry-feed-preview] .one-stroke-hud{position:absolute!important;top:12%!important;left:30px!important;right:30px!important;width:auto!important;min-height:42px!important;padding:0!important}
    html[data-entry-feed-preview] .one-stroke-hud button{visibility:hidden}
    html[data-entry-feed-preview] .one-stroke-board{position:absolute!important;inset:28% 30px 32% 30px!important;width:auto!important}
    .entry-demo-copy{display:none;pointer-events:none}
    html[data-entry-feed-preview] .one-stroke-guide{visibility:hidden!important}
    html[data-entry-feed-preview] .entry-demo-copy{display:block;position:absolute;top:70%;left:30px;right:30px;margin:0;font-size:18px;line-height:1.5;font-weight:600;text-align:center;color:var(--text-sub)}
    html[data-entry-feed-preview] .dh-hud{top:12%!important;right:30px!important}
    html[data-entry-feed-preview] .dh-hud span[aria-hidden=true]{display:none}
    html[data-entry-feed-preview] .dh-guide{top:23%!important;right:30px!important}
    html[data-entry-feed-preview] .dh-board{inset:36% 30px 26% 30px!important}
    html[data-entry-feed-preview] .dh-dumpling{width:28px!important;height:28px!important}
    html[data-entry-feed-preview] .dh-guide span{font-size:18px;line-height:1.35}
    html[data-entry-demo-stopped] :is(.entry-demo-layer,.entry-demo-copy){display:none}
    @media(prefers-reduced-motion:reduce){.entry-demo-layer *{animation:none!important}}
  `;
  document.head.append(style);
  const cancel = () => { for (const animation of animations.splice(0)) animation.cancel(); };
  function stop() {
    interacted = true;
    html.setAttribute('data-entry-demo-stopped', '');
    cancel();
    if (layer) layer.hidden = true;
    observer.disconnect();
    resize?.disconnect();
  }
  window.PlayableEntryPreview = { stop };
  function drawLine(points, viewBox, width) {
    layer.innerHTML = `<svg class="entry-demo-svg" viewBox="${viewBox}" aria-hidden="true"><path class="entry-demo-guide-path" stroke-width="${width}"/></svg>`;
    const path = layer.querySelector('path');
    path.setAttribute('d', points);
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    if (reduced?.matches || typeof path.animate !== 'function') {
      path.style.strokeDashoffset = String(length * .45);
      return;
    }
    animations.push(path.animate([
      { strokeDashoffset: String(length), opacity: .3, offset: 0 },
      { strokeDashoffset: '0', opacity: .85, offset: .65 },
      { strokeDashoffset: '0', opacity: .85, offset: .85 },
      { strokeDashoffset: '0', opacity: 0, offset: 1 },
    ], { duration: 3700, iterations: Infinity, easing: 'linear' }));
  }
  function render() {
    if (!layer || interacted || (host && active)) return;
    cancel();
    layer.hidden = false;
    if (mode === 'face') {
      drawLine('M210 360 C220 245 355 245 370 360 C355 445 220 445 210 360 M520 360 C535 245 670 245 680 360 C665 445 535 445 520 360', '0 0 900 900', 12);
    } else if (mode === 'one-stroke') {
      const lines = [...board.querySelector('svg')?.querySelectorAll('line') || []];
      if (!lines.length) return;
      const point = (line, suffix) => [Number(line.getAttribute('x' + suffix)), Number(line.getAttribute('y' + suffix))];
      const same = (a, b) => a[0] === b[0] && a[1] === b[1];
      const a = point(lines[0], '1'), b = point(lines[0], '2');
      const next = lines.slice(1).find(line => same(point(line, '1'), b) || same(point(line, '2'), b));
      const c = next ? point(next, same(point(next, '1'), b) ? '2' : '1') : b;
      drawLine(`M${a.join(' ')} L${b.join(' ')} L${c.join(' ')}`, `0 0 ${board.clientWidth} ${board.clientHeight}`, 10);
    } else {
      const target = board.querySelector('.dh-dumpling');
      if (!target) return;
      const config = JSON.parse(document.getElementById('playable-inline-config').textContent);
      const opened = config.images.find(image => image.id === 'IMG_MODIFIED')?.path;
      if (!opened) return;
      layer.replaceChildren();
      const image = document.createElement('img'), cursor = document.createElement('span');
      image.className = 'entry-demo-bun'; image.src = opened; image.alt = ''; image.draggable = false;
      cursor.className = 'entry-demo-cursor';
      for (const element of [image, cursor]) { element.style.left = target.style.left; element.style.top = target.style.top; layer.append(element); }
      if (reduced?.matches || typeof image.animate !== 'function') { image.style.opacity = '.65'; return; }
      animations.push(image.animate([{opacity:0,offset:0},{opacity:0,offset:.3},{opacity:1,offset:.4},{opacity:1,offset:.78},{opacity:0,offset:1}],{duration:3200,iterations:Infinity}));
      animations.push(cursor.animate([{opacity:0,offset:0},{opacity:.9,offset:.2},{opacity:.9,offset:.3},{opacity:0,offset:.45},{opacity:0,offset:1}],{duration:3200,iterations:Infinity}));
    }
    if (document.hidden) for (const animation of animations) animation.pause();
  }
  function attach() {
    if (layer || interacted || (host && active)) return;
    board = document.querySelector(mode === 'face' ? '.face-game__canvas-wrap' : mode === 'one-stroke' ? '.one-stroke-board' : '.dh-board');
    if (!board || (mode === 'one-stroke' && !board.querySelector('svg line'))) return;
    layer = document.createElement('div'); layer.className = 'entry-demo-layer'; layer.setAttribute('aria-hidden', 'true');
    board.append(layer);
    if (mode === 'one-stroke' && host && !compactGuide) {
      compactGuide = document.createElement('p'); compactGuide.className = 'entry-demo-copy';
      compactGuide.textContent = "Unisci con un solo tratto";
      board.parentElement.append(compactGuide);
    }
    observer.disconnect();
    resize = new ResizeObserver(render); resize.observe(board);
    render();
  }
  const observer = new MutationObserver(attach);
  observer.observe(document.getElementById('root'), { childList: true, subtree: true });
  attach();
  window.addEventListener('message', event => {
    if (!host || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    html.toggleAttribute('data-entry-feed-preview', !active);
    if (active) { cancel(); if (layer) layer.hidden = true; }
    else if (!interacted) { attach(); render(); }
  });
  document.addEventListener('visibilitychange', () => {
    for (const animation of animations) document.hidden ? animation.pause() : animation.play();
  });
  reduced?.addEventListener?.('change', render);
  window.addEventListener('pagehide', () => { cancel(); observer.disconnect(); resize?.disconnect(); }, {once:true});
})();

;

;/* Current runtime segment: face-game.it.js */
function computeGroupPlacements({ bounds, slots }) {
  const validBounds = bounds.filter(Boolean);
  if (validBounds.length === 0) return bounds.map(() => null);

  const maxWidth = Math.max(...validBounds.map((item) => item.width));
  const maxHeight = Math.max(...validBounds.map((item) => item.height));

  return bounds.map((item, index) => {
    if (!item) return null;
    const slot = slots[index] || slots[0];
    const scale = Math.min(slot.width / maxWidth, slot.height / maxHeight);
    const width = item.width * scale;
    const height = item.height * scale;
    const centerX = slot.x + slot.width / 2;
    const centerY = slot.y + slot.height / 2;
    const left = centerX - width / 2;
    const top = centerY - height / 2;

    return {
      sourceX: item.x,
      sourceY: item.y,
      sourceWidth: item.width,
      sourceHeight: item.height,
      left,
      top,
      width,
      height,
      centerX,
      centerY,
      right: left + width,
      bottom: top + height
    };
  });
}

(() => {
  "use strict";

  const SIZE = 900;
  const STEP_COUNT = 7;
  const FEATURE_SLOTS = {
    eyes: { x: 170, y: 230, width: 560, height: 170 },
    nose: { x: 330, y: 420, width: 240, height: 140 },
    mouth: { x: 260, y: 590, width: 380, height: 160 }
  };
  const FALLBACK = {
    BRUSH_SIZE: 4,
    BTN_CLEAR: "CANCELLA",
    BTN_NEXT: "AVANTI",
    BTN_FINISH: "FATTO",
    BTN_BLINK: "SBATTI LE PALPEBRE",
    BTN_SNIFF: "ANNUSA",
    BTN_TALK: "PARLA",
    BTN_AGAIN: "RIDISEGNA",
    TXT_STEP: "FASE",
    TXT_OF: "DI",
    MSG_DONE: "IL TUO VISO!",
    PROMPT_1: "Disegna gli occhi aperti",
    PROMPT_2: "Disegna gli occhi chiusi",
    PROMPT_3: "Disegna un naso",
    PROMPT_4: "Disegna un naso piccolo",
    PROMPT_5: "Disegna la bocca aperta",
    PROMPT_6: "Disegna la bocca socchiusa",
    PROMPT_7: "Disegna la bocca chiusa"
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function readConfig(config) {
    const values = { ...FALLBACK };
    ["tweaks", "texts"].forEach((section) => {
      (config[section] || []).forEach((item) => {
        if (item && item.id) values[item.id] = item.value;
      });
    });
    return values;
  }

  function makeLayer() {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    return canvas;
  }

  async function boot() {
    let config = {};
    const inlineConfig = document.getElementById("playable-inline-config");
    if (window.location.protocol === "file:" && inlineConfig) {
      try {
        config = JSON.parse(inlineConfig.textContent);
      } catch (_) {}
    } else {
      try {
        const response = await fetch("./game.config.json?l10n=64738a20889c", { cache: "no-store" });
        if (response.ok) config = await response.json();
      } catch (_) {
        if (inlineConfig) {
          try {
            config = JSON.parse(inlineConfig.textContent);
          } catch (_) {}
        }
      }
    }
    mount(readConfig(config));
  }

  function mount(copy) {
    const root = document.getElementById("root");
    root.innerHTML = `
      <style>
        @font-face { font-family: Poppins; src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2'); font-weight: 400; font-display: swap; }
        @font-face { font-family: Poppins; src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }
        :root { --paper: #fdf8ea; --ink: #303035; --purple: #6c5ce7; --green: #08b894; --red: #dc3035; --guide: #d7cfbc; }
        * { box-sizing: border-box; }
        button { font: 700 clamp(14px, 3.8vw, 18px)/1.2 Poppins, sans-serif; border: 0; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
        .face-game { width: 100%; height: 100%; min-height: 0; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--paper); color: var(--ink); font-family: Poppins, sans-serif; }
        .face-game__header { padding: calc(30px + env(safe-area-inset-top)) 30px 12px; text-align: center; }
        .face-game__step { margin: 0 0 5px; font-size: 28px; letter-spacing: 0; line-height: 1.2; color: #736e64; }
        .face-game__prompt { margin: 0; max-width: 100%; font-size: clamp(19px, 5.4vw, 30px); line-height: 1.15; overflow-wrap: anywhere; }
        .face-game__workspace { min-height: 0; display: grid; place-items: center; padding: 4px 30px 12px; overflow: hidden; container-type: size; }
        .face-game__canvas-wrap { position: relative; width: min(100%, calc(100vh - 280px), 560px); max-width: 100%; max-height: 100%; aspect-ratio: 1; border: 2px dashed var(--guide); border-radius: 22px; overflow: hidden; background: rgba(255,255,255,.08); touch-action: none; }
        .face-game canvas { display: block; width: 100%; height: 100%; }
        #draw-canvas { cursor: crosshair; touch-action: none; }
        .face-game__toolbar { width: min(calc(100% - 60px), 560px); min-height: calc(112px + env(safe-area-inset-bottom)); margin: 0 auto; padding: 8px 0 calc(50px + env(safe-area-inset-bottom)); display: grid; grid-template-columns: minmax(105px,.72fr) 1.28fr; gap: 14px; }
        .face-game__button { min-height: 54px; border-radius: 14px; padding: 11px 18px; box-shadow: 0 7px 17px rgba(54,46,36,.12); transition: transform .12s ease, filter .12s ease; white-space: normal; overflow-wrap: anywhere; }
        .face-game__button:active { transform: translateY(2px) scale(.985); filter: brightness(.96); }
        .face-game__button:disabled { cursor: default; opacity: .42; transform: none; filter: none; }
        .face-game__button--clear { color: var(--ink); background: #fff; border: 2px solid var(--ink); box-shadow: none; }
        .face-game__button--next { color: #fff; background: var(--purple); }
        .face-game__result-title { margin: 0; max-width: 100%; font-size: clamp(24px, 6vw, 34px); line-height: 1.1; overflow-wrap: anywhere; }
        .face-game__result-wrap { position: relative; width: min(100%, calc(100vh - 270px), 620px); max-width: 100%; max-height: 100%; aspect-ratio: 1; }
        .face-game__actions { width: min(calc(100% - 60px), 700px); margin: 0 auto; padding: 10px 0 calc(50px + env(safe-area-inset-bottom)); }
        .face-game__action-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .face-game__action { min-height: clamp(56px, 12vw, 76px); color: #fff; border-radius: 14px; box-shadow: 0 9px 20px rgba(55,45,35,.15); }
        .face-game__action--blink { background: var(--purple); }
        .face-game__action--sniff { background: var(--green); }
        .face-game__action--talk { background: var(--red); }
        .face-game__again { display: block; margin: 13px auto 0; padding: 4px 12px; color: #817c70; background: transparent; text-decoration: underline; box-shadow: none; font-weight: 400; }
        [hidden] { display: none !important; }
        @supports (width: 1cqh) {
          .face-game__canvas-wrap, .face-game__result-wrap { width: min(100%, 100cqh, 620px); }
          .face-game__canvas-wrap { max-width: 560px; }
        }
        @media (max-height: 600px) {
          .face-game__header { padding-bottom: 8px; }
          .face-game__button { min-height: 50px; }
          .face-game__action-row { gap: 8px; }
        }
      </style>
      <main class="face-game">
        <header class="face-game__header" id="draw-header">
          <p class="face-game__step" id="step-label"></p>
          <h1 class="face-game__prompt" id="prompt-label"></h1>
        </header>
        <header class="face-game__header" id="result-header" hidden>
          <h1 class="face-game__result-title" id="result-title"></h1>
        </header>
        <section class="face-game__workspace" id="draw-workspace">
          <div class="face-game__canvas-wrap"><canvas id="draw-canvas" width="${SIZE}" height="${SIZE}" aria-label="Drawing canvas"></canvas></div>
        </section>
        <section class="face-game__workspace" id="result-workspace" hidden>
          <div class="face-game__result-wrap"><canvas id="result-canvas" width="${SIZE}" height="${SIZE}" aria-label="Your animated face"></canvas></div>
        </section>
        <footer class="face-game__toolbar" id="draw-toolbar">
          <button class="face-game__button face-game__button--clear" id="clear-button"></button>
          <button class="face-game__button face-game__button--next" id="next-button"></button>
        </footer>
        <footer class="face-game__actions" id="result-actions" hidden>
          <div class="face-game__action-row">
            <button class="face-game__button face-game__action face-game__action--blink" data-action="blink"></button>
            <button class="face-game__button face-game__action face-game__action--sniff" data-action="sniff"></button>
            <button class="face-game__button face-game__action face-game__action--talk" data-action="talk"></button>
          </div>
          <button class="face-game__again" id="again-button"></button>
        </footer>
      </main>`;

    const layers = Array.from({ length: STEP_COUNT }, makeLayer);
    const drawCanvas = root.querySelector("#draw-canvas");
    const drawContext = drawCanvas.getContext("2d");
    const resultCanvas = root.querySelector("#result-canvas");
    const resultContext = resultCanvas.getContext("2d");
    const stepLabel = root.querySelector("#step-label");
    const promptLabel = root.querySelector("#prompt-label");
    const nextButton = root.querySelector("#next-button");
    const clearButton = root.querySelector("#clear-button");
    const resultTitle = root.querySelector("#result-title");
    const againButton = root.querySelector("#again-button");
    const actionButtons = Array.from(root.querySelectorAll("[data-action]"));
    const hasInk = Array(STEP_COUNT).fill(false);
    let step = 0;
    let drawing = false;
    let lastPoint = null;
    let animationToken = 0;
    let audioContext = null;
    let resultParts = { eyes: 0, nose: 2, mouth: 6 };
    let placementCache = null;

    const actionCopy = {
      blink: copy.BTN_BLINK,
      sniff: copy.BTN_SNIFF,
      talk: copy.BTN_TALK
    };
    actionButtons.forEach((button) => {
      button.textContent = actionCopy[button.dataset.action] || button.dataset.action.toUpperCase();
    });
    againButton.textContent = copy.BTN_AGAIN;

    function ensureAudio() {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return null;
        if (!audioContext) audioContext = new AudioContext();
        if (audioContext.state === "suspended") audioContext.resume();
        return audioContext;
      } catch (_) {
        return null;
      }
    }

    function playTone(frequency, duration, delay = 0, type = "sine") {
      const context = ensureAudio();
      if (!context) return;
      const start = context.currentTime + delay;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.055, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.015);
    }

    function feedback(kind) {
      const patterns = {
        draw: [[420, 0.035]],
        clear: [[180, 0.08]],
        next: [[520, 0.06], [660, 0.08, 0.055]],
        success: [[523, 0.12], [659, 0.12, 0.08], [784, 0.16, 0.16]],
        blink: [[700, 0.06]],
        sniff: [[300, 0.06], [380, 0.08, 0.07]],
        talk: [[220, 0.06], [280, 0.06, 0.06], [340, 0.08, 0.12]],
        again: [[440, 0.08]]
      };
      (patterns[kind] || []).forEach(([frequency, duration, delay = 0]) => {
        playTone(frequency, duration, delay, kind === "clear" ? "triangle" : "sine");
      });
      try {
        if (window.tt && typeof window.tt.vibrate === "function") window.tt.vibrate({ style: "light" });
        else if (navigator.vibrate) navigator.vibrate(kind === "success" ? [12, 30, 16] : 8);
      } catch (_) {}
    }

    function renderDrawing() {
      drawContext.clearRect(0, 0, SIZE, SIZE);
      drawContext.globalAlpha = 1;
      drawContext.drawImage(layers[step], 0, 0);
    }

    function getInkBounds(layer) {
      const pixels = layer.getContext("2d").getImageData(0, 0, SIZE, SIZE).data;
      let minX = SIZE;
      let minY = SIZE;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          if (pixels[(y * SIZE + x) * 4 + 3] < 8) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      if (maxX < minX || maxY < minY) return null;
      const padding = 8;
      const x = Math.max(0, minX - padding);
      const y = Math.max(0, minY - padding);
      const right = Math.min(SIZE, maxX + padding + 1);
      const bottom = Math.min(SIZE, maxY + padding + 1);
      return { x, y, width: right - x, height: bottom - y };
    }

    function buildPlacementCache() {
      const groups = {
        eyes: [0, 1],
        nose: [2, 3],
        mouth: [4, 5, 6]
      };
      const cache = {};

      Object.entries(groups).forEach(([groupName, indexes]) => {
        const slot = FEATURE_SLOTS[groupName];
        const bounds = indexes.map((index) => getInkBounds(layers[index]));
        const placements = computeGroupPlacements({
          bounds,
          slots: indexes.map(() => slot)
        });
        indexes.forEach((layerIndex, placementIndex) => {
          cache[layerIndex] = placements[placementIndex];
        });
      });

      return cache;
    }

    function drawPlacedLayer(layerIndex) {
      const placement = placementCache && placementCache[layerIndex];
      if (!placement) return;
      resultContext.drawImage(
        layers[layerIndex],
        placement.sourceX,
        placement.sourceY,
        placement.sourceWidth,
        placement.sourceHeight,
        placement.left,
        placement.top,
        placement.width,
        placement.height
      );
    }

    function renderResult() {
      resultContext.clearRect(0, 0, SIZE, SIZE);
      resultContext.globalAlpha = 1;
      drawPlacedLayer(resultParts.eyes);
      drawPlacedLayer(resultParts.nose);
      drawPlacedLayer(resultParts.mouth);
    }

    function updateNextAvailability() {
      nextButton.disabled = !hasInk[step];
      nextButton.setAttribute("aria-disabled", String(nextButton.disabled));
      clearButton.hidden = !hasInk[step];
      nextButton.hidden = !hasInk[step];
    }

    function updateStep() {
      stepLabel.textContent = `${step + 1}/${STEP_COUNT}`;
      promptLabel.textContent = copy[`PROMPT_${step + 1}`] || FALLBACK[`PROMPT_${step + 1}`];
      nextButton.textContent = step === STEP_COUNT - 1 ? copy.BTN_FINISH : copy.BTN_NEXT;
      updateNextAvailability();
      renderDrawing();
    }

    function pointFromEvent(event) {
      const rect = drawCanvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * SIZE / rect.width,
        y: (event.clientY - rect.top) * SIZE / rect.height
      };
    }

    drawCanvas.addEventListener("pointerdown", (event) => {
      if (event.isPrimary === false || event.button > 0) return;
      window.PlayableEntryPreview?.stop();
      event.preventDefault();
      drawCanvas.setPointerCapture(event.pointerId);
      drawing = true;
      lastPoint = pointFromEvent(event);
      const context = layers[step].getContext("2d");
      const brushWidth = Math.max(2, Number(copy.BRUSH_SIZE) || 4) * 2.1;
      context.beginPath();
      context.arc(lastPoint.x, lastPoint.y, brushWidth / 2, 0, Math.PI * 2);
      context.fillStyle = "#303035";
      context.fill();
      hasInk[step] = true;
      updateNextAvailability();
      renderDrawing();
      feedback("draw");
    });

    drawCanvas.addEventListener("pointermove", (event) => {
      if (!drawing || !event.isPrimary) return;
      event.preventDefault();
      const current = pointFromEvent(event);
      const context = layers[step].getContext("2d");
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(current.x, current.y);
      context.strokeStyle = "#303035";
      context.lineWidth = Math.max(2, Number(copy.BRUSH_SIZE) || 4) * 2.1;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
      hasInk[step] = true;
      lastPoint = current;
      renderDrawing();
    });

    function endStroke(event) {
      if (!drawing || !event.isPrimary) return;
      drawing = false;
      lastPoint = null;
      if (drawCanvas.hasPointerCapture(event.pointerId)) drawCanvas.releasePointerCapture(event.pointerId);
    }
    drawCanvas.addEventListener("pointerup", endStroke);
    drawCanvas.addEventListener("pointercancel", endStroke);

    clearButton.textContent = copy.BTN_CLEAR;
    clearButton.addEventListener("click", () => {
      layers[step].getContext("2d").clearRect(0, 0, SIZE, SIZE);
      hasInk[step] = false;
      updateNextAvailability();
      renderDrawing();
      feedback("clear");
    });

    nextButton.addEventListener("click", () => {
      if (!hasInk[step]) return;
      if (step < STEP_COUNT - 1) {
        feedback("next");
        step += 1;
        updateStep();
      } else {
        showResult();
      }
    });

    function showResult() {
      animationToken += 1;
      resultParts = { eyes: 0, nose: 2, mouth: 6 };
      placementCache = buildPlacementCache();
      root.querySelector("#draw-header").hidden = true;
      root.querySelector("#draw-workspace").hidden = true;
      root.querySelector("#draw-toolbar").hidden = true;
      root.querySelector("#result-header").hidden = false;
      root.querySelector("#result-workspace").hidden = false;
      root.querySelector("#result-actions").hidden = false;
      resultTitle.textContent = copy.MSG_DONE || FALLBACK.MSG_DONE;
      renderResult();
      feedback("success");
    }

    async function blink() {
      const token = ++animationToken;
      resultParts.eyes = 1;
      renderResult();
      await sleep(230);
      if (token !== animationToken) return;
      resultParts.eyes = 0;
      renderResult();
    }

    async function sniff() {
      const token = ++animationToken;
      for (const frame of [3, 2, 3, 2]) {
        if (token !== animationToken) return;
        resultParts.nose = frame;
        renderResult();
        await sleep(145);
      }
    }

    async function talk() {
      const token = ++animationToken;
      for (const frame of [4, 5, 6, 5, 4, 5, 6]) {
        if (token !== animationToken) return;
        resultParts.mouth = frame;
        renderResult();
        await sleep(135);
      }
    }

    actionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action;
        feedback(action);
        if (action === "blink") blink();
        if (action === "sniff") sniff();
        if (action === "talk") talk();
      });
    });

    againButton.addEventListener("click", () => {
      animationToken += 1;
      layers.forEach((layer) => layer.getContext("2d").clearRect(0, 0, SIZE, SIZE));
      hasInk.fill(false);
      step = 0;
      placementCache = null;
      root.querySelector("#draw-header").hidden = false;
      root.querySelector("#draw-workspace").hidden = false;
      root.querySelector("#draw-toolbar").hidden = false;
      root.querySelector("#result-header").hidden = true;
      root.querySelector("#result-workspace").hidden = true;
      root.querySelector("#result-actions").hidden = true;
      updateStep();
      feedback("again");
    });

    updateStep();
  }

  boot();
})();

;

;/* Current runtime segment: inline-3 */

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(()=>{
 const selectors=[".face-game__prompt"],copy=new Set([].map(s=>s.replace(/\s+/g,' ').trim().toLowerCase()));
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


;

;/* Current runtime segment: guide-breathing.it.js */
/* Decorative guide visibility only: no inputs, timers, sound or game state. */
(() => {
  const root=document.documentElement;
  let intersecting=true;
  const update=()=>root.toggleAttribute('data-guide-breathing-paused',document.hidden||!intersecting);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    intersecting=entries.some(entry=>entry.isIntersecting);update();
  }):null;
  if(document.body)observer?.observe(document.body);
  document.addEventListener('visibilitychange',update);update();
  window.addEventListener('pagehide',()=>{observer?.disconnect();document.removeEventListener('visibilitychange',update);},{once:true});
})();

;

;/* Current runtime segment: feed-entry-motion.it.js */
var __PLAYABLE_TEMPLATE_SCRIPT_5=(()=>{var node=document.createElement("script");for(var entry of Object.entries({"defer":"","src":"./feed-entry-motion.it.js?l10n=64738a20889c&v=feed-first-20261008-1","data-subject":"#draw-canvas"}))node.setAttribute(entry[0],entry[1]);return node;})();
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';
  const script = __PLAYABLE_TEMPLATE_SCRIPT_5;
  const selector = script?.getAttribute('data-subject') || '#root canvas';
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let observer, animation, entered = false;
  function stop() { animation?.cancel(); animation = null; }
  function enter() {
    if (entered || document.hidden) return;
    const subject = document.querySelector(selector);
    if (!subject || subject.closest('[hidden], [aria-hidden="true"]')) return;
    const computed = window.getComputedStyle(subject);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (subject.tagName === 'IMG' && !subject.complete) {
      subject.addEventListener('load', enter, { once: true });
      return;
    }
    entered = true;
    observer?.disconnect();
    if (media?.matches) return;
    const opacity = Number(window.getComputedStyle(subject).opacity) || 1;
    if (typeof subject.animate === 'function') {
      animation = subject.animate([{ opacity: opacity * .76 }, { opacity }], { duration: 650, easing: 'ease-out' });
      animation.onfinish = () => { animation = null; };
    }
  }
  observer = new MutationObserver(enter);
  observer.observe(document.body, { childList: true, subtree: true });
  enter();
  document.addEventListener('visibilitychange', () => {
    document.documentElement.toggleAttribute('data-feed-background', document.hidden);
    if (document.hidden) stop(); else enter();
  });
  window.addEventListener('pagehide', () => { observer.disconnect(); stop(); });
  window.addEventListener('pageshow', () => {
    if (!entered) observer.observe(document.body, { childList: true, subtree: true });
    enter();
  });
  document.addEventListener('pointerdown', stop, { capture: true, passive: true });
  media?.addEventListener?.('change', () => { if (media.matches) stop(); });
})();

;
