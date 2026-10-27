/* State-specific layout only. No simulated input or preview demonstration. */
(() => {
  const html = document.documentElement;
  const host = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  html.toggleAttribute('data-ui-batch2-preview', host);
  const style = document.createElement('style');
  style.textContent = `
    .cash-game .hud-score{color:#FFF0BA!important;text-shadow:none!important}
    .cw-header .hud-text{font-variant-numeric:tabular-nums}
    .cw-target .hud-text{font-size:18px!important;line-height:1.5}
    @media(max-height:450px){.string-board>svg{height:calc(100% - 90px)!important}}
    html[data-ui-batch2-preview] .cash-game .hud-panel{top:18%!important}
    html[data-ui-batch2-preview] .cash-game .tip-text{top:67%!important;bottom:auto!important;line-height:1.5}
    html[data-ui-batch2-preview] .string-hud{position:absolute;top:12%;left:30px;right:30px;padding:0!important}
    html[data-ui-batch2-preview] .string-board{position:absolute!important;inset:24% 0 20%}
    html[data-ui-batch2-preview] .string-guide{top:-12px;bottom:auto!important}
    .cw-game .cw-header{position:absolute;top:10%;left:30px;right:30px;padding:0!important}
    .cw-game .cw-target{margin-top:8px!important;padding:4px 16px!important}
    .cw-game .cw-target .hud-text{color:#fff!important;text-shadow:none!important}
    .cw-game .cw-stage{inset:26% 30px 36%}
    .cw-game .cw-guide{top:67%}
  `;
  document.head.append(style);
  window.addEventListener('message', event => {
    if (!host || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    html.toggleAttribute('data-ui-batch2-preview', event.data.active !== true);
  });
})();
