(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e={fighter:`Fighter`,tank:`Tank`,ranged:`Ranged`,support:`Support`},t={fighter:`/farm_td/assets/ui/roles/fighter-white.png`,tank:`/farm_td/assets/ui/roles/tank-white.png`,ranged:`/farm_td/assets/ui/roles/ranged-white.png`,support:`/farm_td/assets/ui/roles/support-white.png`},n={orange:`fighter`,durian:`tank`,corn:`ranged`,chili:`ranged`,pineapple:`ranged`,dragonfruit:`fighter`,coconut:`fighter`,grape:`support`,blueberry:`support`,mint:`support`,cactus:`ranged`},r=`
    <svg class="icon-library" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <symbol id="i-footprint-1x1" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10"/></symbol>
      <symbol id="i-footprint-1x2" viewBox="0 0 24 24"><rect x="7" y="1" width="10" height="10"/><rect x="7" y="13" width="10" height="10"/></symbol>
      <symbol id="i-footprint-2x1" viewBox="0 0 24 24"><rect x="1" y="7" width="10" height="10"/><rect x="13" y="7" width="10" height="10"/></symbol>
      <symbol id="i-footprint-2x2" viewBox="0 0 24 24"><rect x="1" y="1" width="10" height="10"/><rect x="13" y="1" width="10" height="10"/><rect x="1" y="13" width="10" height="10"/><rect x="13" y="13" width="10" height="10"/></symbol>
      <symbol id="i-leaf" viewBox="0 0 24 24"><path d="M20.5 3.5C11 3 4.6 6.2 4.2 13.6c-.2 3.7 2.4 6.8 6.1 6.8 7.7 0 10.7-8.1 10.2-16.9Z"/><path d="M3.6 21c3-6 7.7-9.7 13.7-12.1"/></symbol>
      <symbol id="i-star" viewBox="0 0 24 24"><path d="m12 2.5 2.7 5.6 6.2.9-4.5 4.4 1.1 6.2-5.5-2.9-5.5 2.9 1.1-6.2-4.5-4.4 6.2-.9L12 2.5Z"/></symbol>
      <symbol id="i-crystal" viewBox="0 0 24 24"><path d="M8 2.5 16.5 4 21 10l-4.5 11-9.5-2L3 10l5-7.5Z" fill="#79d9e7" stroke="#211b2e" stroke-width="2" stroke-linejoin="round"/><path d="M3 10h18M8 2.5l2 7.5-3 9m9.5-15-2.5 6 2.5 11M10 10l4 0" fill="none" stroke="#319bb9" stroke-width="1.5" stroke-linejoin="round"/></symbol>
      <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="#ffe077" stroke="#211b2e" stroke-width="2"/><path d="M12 1.5v3m0 15v3M1.5 12h3m15 0h3M4.6 4.6l2.1 2.1m10.6 10.6 2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1" fill="none" stroke="#211b2e" stroke-width="2" stroke-linecap="round"/></symbol>
      <symbol id="i-seed" viewBox="0 0 24 24"><path d="M12 9c-3.8 2.3-6.8 5.3-6.8 8.1A6.8 6.8 0 0 0 12 23a6.8 6.8 0 0 0 6.8-5.9C18.8 14.3 15.8 11.3 12 9Z" fill="#fff0bd" stroke="#211b2e" stroke-width="2"/><path d="M12 10C10.7 6.4 9 3.4 5.5 3c.4 3.7 2.4 5.9 6.5 7Z" fill="#91d16a" stroke="#211b2e" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10c1.2-3.7 3.2-5.7 6.5-6.7-.1 3.7-2.3 6.1-6.5 6.7Z" fill="#69b65f" stroke="#211b2e" stroke-width="1.8" stroke-linejoin="round"/></symbol>
      <symbol id="i-map" viewBox="0 0 24 24"><path d="M4 4.5 9.3 2l5.4 2.5L20 2v17.5L14.7 22l-5.4-2.5L4 22V4.5Z" fill="#f8e3a5" stroke="#211b2e" stroke-width="2" stroke-linejoin="round"/><path d="M4 4.5 9.3 2v17.5L4 22Z" fill="#a3d77a"/><path d="M14.7 4.5 20 2v17.5L14.7 22Z" fill="#8fcbd1"/><path d="M4 4.5 9.3 2l5.4 2.5L20 2v17.5L14.7 22l-5.4-2.5L4 22V4.5ZM9.3 2v17.5M14.7 4.5V22" fill="none" stroke="#211b2e" stroke-width="2" stroke-linejoin="round"/></symbol>
      <symbol id="i-shop" viewBox="0 0 24 24"><path d="M4.2 9.5V21h15.6V9.5" fill="#f7e4b8" stroke="#211b2e" stroke-width="2" stroke-linejoin="round"/><path d="M3 9.5 5 3.5h14l2 6c0 2.1-3.4 3.1-5 1.1-1.6 2-3.4 2-5 0-1.6 2-3.4 1-5-1.1Z" fill="#ffbf56" stroke="#211b2e" stroke-width="2" stroke-linejoin="round"/><path d="M8 3.5 6.8 10.8M16 3.5l1.2 7.3" fill="none" stroke="#dc6a86" stroke-width="2"/><path d="M10 21v-7h4v7" fill="#8bcbd0" stroke="#211b2e" stroke-width="1.6"/></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="m4.5 12.5 5 5L19.5 7"/></symbol>
      <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></symbol>
      <symbol id="i-close" viewBox="0 0 24 24"><path d="M5 5 19 19M19 5 5 19"/></symbol>
      <symbol id="i-back" viewBox="0 0 24 24"><path d="M19 12H5m6-6-6 6 6 6"/></symbol>
      <symbol id="i-heart" viewBox="0 0 24 24"><path d="M12 20.5 4.4 13C-.3 8.3 5.5 1.8 11 7l1 1 1-1c5.5-5.2 11.3 1.3 6.6 6L12 20.5Z"/></symbol>
      <symbol id="i-pause" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><path d="m7 4 13 8-13 8V4Z"/></symbol>
      <symbol id="i-fast" viewBox="0 0 24 24"><path d="m3 5 9 7-9 7V5Zm9 0 9 7-9 7V5Z"/></symbol>
      <symbol id="i-gear" viewBox="0 0 24 24"><path d="M10 2.5h4l.6 2.4 2 1.1 2.3-.9 2 3.5-1.7 1.8v2.3l1.7 1.8-2 3.5-2.3-.9-2 1.1-.6 2.4h-4l-.6-2.4-2-1.1-2.3.9-2-3.5 1.7-1.8v-2.3L3.1 8.6l2-3.5 2.3.9 2-1.1.6-2.4Z"/><circle cx="12" cy="12" r="3"/></symbol>
    </svg>

    <div class="app-shell">
      <header class="topbar">
        <button class="profile-button" id="open-profile" type="button" aria-label="Open profile"><span class="profile-avatar"><img class="profile-photo" src="/farm_td/assets/ui/fruit-quest/profile-seed-avatar.png" alt="" aria-hidden="true" /></span><span class="profile-level">1</span></button>
        <div class="resource-row" aria-label="Resources">
          <div class="resource-pill crystals-count" aria-label="2,460 crystals"><span class="resource-emblem" aria-hidden="true"><img class="resource-icon crystals" src="/farm_td/assets/ui/fruit-quest/crystal-icon.png" alt="" /></span><strong>2,460</strong></div>
          <div class="resource-pill fertilizer-count" aria-label="120 fertilizer"><span class="resource-emblem" aria-hidden="true"><img class="resource-icon fertilizer" src="/farm_td/assets/ui/fruit-quest/fertilizer-icon.png" alt="" /></span><strong>120</strong></div>
        </div>
      </header>

      <main id="main-content" class="content" tabindex="-1">
        <section class="screen screen-levels" data-screen="levels" aria-labelledby="levels-title">
          <h1 id="levels-title" class="sr-only">Levels</h1>
          <button class="tutorial-launch" id="learn-basics" type="button">Learn the basics</button>
          <div class="map-panel" aria-label="Level map">
            <svg class="trail trail-grove" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path class="trail-bank" d="M22 87 C27 79 57 83 70 73 C83 63 64 60 48 52 C32 44 22 41 28 31 C35 21 57 19 72 13"/>
              <path class="trail-outline" d="M22 87 C27 79 57 83 70 73 C83 63 64 60 48 52 C32 44 22 41 28 31 C35 21 57 19 72 13"/>
              <path class="trail-inner" d="M22 87 C27 79 57 83 70 73 C83 63 64 60 48 52 C32 44 22 41 28 31 C35 21 57 19 72 13"/>
            </svg>
            <div class="level-nodes" id="level-nodes"></div>
          </div>
          <div class="level-detail" id="level-detail" aria-live="polite"></div>
          <div class="scene-layout" id="scene-layout" aria-label="Sunny Orchard levels">
            <div class="scene-visual">
              <div class="scene-island-wrap"><img class="scene-island" src="/farm_td/assets/ui/fruit-quest/world-sunlit-grove.png" alt="Floating farm island" /></div>
            </div>
            <div class="scene-controls">
              <div class="scene-selector">
                <button class="scene-arrow" id="scene-prev" type="button" aria-label="Previous level"><svg viewBox="0 0 22 48" aria-hidden="true"><path d="M17 3 5 24l12 21"/></svg></button>
                <div class="scene-level-copy"><h2>Sunny Orchard</h2><span id="scene-level-progress" aria-label="Level 1 of 3">1/3</span></div>
                <button class="scene-arrow" id="scene-next" type="button" aria-label="Next level"><svg viewBox="0 0 22 48" aria-hidden="true"><path d="M17 3 5 24l12 21"/></svg></button>
              </div>
              <button class="primary-button scene-play" id="start-scene-level" type="button">Play <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-arrow"/></svg></button>
            </div>
          </div>
        </section>

        <section class="screen screen-pets" data-screen="pets" aria-labelledby="pets-title" hidden>
          <div class="collection-heading"><h1 id="pets-title">My seeds</h1><span class="collection-count">3 / 6 unlocked</span></div>
          <div class="pet-grid" id="pet-grid"></div>
        </section>

        <section class="screen screen-shop" data-screen="shop" data-active-pack="orchard" aria-labelledby="shop-title" hidden>
          <h1 id="shop-title" class="sr-only">Shop</h1>
          <div class="shop-pack-tabs" role="tablist" aria-label="Pack series"><button class="shop-pack-tab" id="shop-tab-orchard" data-pack-tab="orchard" type="button" role="tab" aria-controls="shop-panel-seeds" aria-selected="true" tabindex="0"><span>Orchard<br />pack</span></button><button class="shop-pack-tab" id="shop-tab-tropical" data-pack-tab="tropical" type="button" role="tab" aria-controls="shop-panel-seeds" aria-selected="false" tabindex="-1"><span>Tropical<br />pack</span></button><button class="shop-pack-tab" id="shop-tab-frost" data-pack-tab="frost" type="button" role="tab" aria-controls="shop-panel-frost" aria-selected="false" tabindex="-1"><span>Frost<br />pack</span></button></div>
          <section class="shop-pack-page shop-pack-basic" id="shop-panel-seeds" role="tabpanel" aria-labelledby="shop-tab-orchard" tabindex="0">
            <div class="shop-heading"><h2 id="seed-pack-title">Orchard pack</h2><button class="shop-pool-trigger" id="open-card-pool" type="button" aria-label="View cards in Orchard pack" aria-haspopup="dialog"><span class="shop-pool-preview" id="shop-pool-preview" aria-hidden="true"></span></button></div>
            <div class="basic-pack-hero"><div class="basic-pack-glow" aria-hidden="true"></div><span class="pack-sparkle pack-sparkle-one" aria-hidden="true"></span><span class="pack-sparkle pack-sparkle-two" aria-hidden="true"></span><span class="pack-sparkle pack-sparkle-three" aria-hidden="true"></span><img src="/farm_td/assets/ui/fruit-quest/seed-packet-single.png" alt="Orchard pack" class="basic-pack-art" /></div>
            <div class="packet-actions"><button class="primary-button packet-pull-button" id="pull-one" type="button" aria-label="Pull 1 character piece for 10 fertilizer">Pull 1×<span class="pull-divider" aria-hidden="true">|</span><span class="packet-cost"><img src="/farm_td/assets/ui/fruit-quest/fertilizer-icon.png" alt="" />10</span></button><button class="primary-button packet-pull-button" id="pull-ten" type="button" aria-label="Pull 10 character pieces for 90 fertilizer">Pull 10×<span class="pull-divider" aria-hidden="true">|</span><span class="packet-cost"><img src="/farm_td/assets/ui/fruit-quest/fertilizer-icon.png" alt="" />90</span></button></div>
          </section>
          <section class="shop-pack-page shop-pack-frost" id="shop-panel-frost" role="tabpanel" aria-labelledby="shop-tab-frost" tabindex="0" hidden>
            <div class="shop-heading"><span class="frost-pack-tier">Advanced pack</span><h2 id="frost-pack-title">Frost pack</h2></div>
            <div class="frost-pack-hero"><img class="frost-pack-art" src="/farm_td/assets/ui/fruit-quest/winter-seed-packet.png" alt="Winter seed packet with snowflakes and a sprout" /></div>
            <p class="frost-pack-status">Coming soon</p>
          </section>
        </section>

        <section class="screen screen-profile flow-screen" data-screen="profile" aria-labelledby="profile-title" hidden>
          <div class="profile-page-header"><button class="icon-button" id="back-profile" type="button" aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-back"/></svg></button><h1 id="profile-title">Profile</h1></div>
          <div class="profile-identity"><div class="profile-picture"><img class="profile-photo" src="/farm_td/assets/ui/fruit-quest/profile-seed-avatar.png" alt="Seed avatar" /></div><div class="profile-name"><span>Garden keeper</span><h2>Player</h2></div></div>
          <div class="profile-stats"><div><span>Levels cleared</span><strong id="profile-levels-cleared">0 / 3</strong></div><div><span>Seeds found</span><strong id="profile-seeds-found">3 / 6</strong></div><div><span>Packet pulls</span><strong id="profile-packet-pulls">0</strong></div></div>
          <div class="profile-account-setting">
            <label class="account-unlock-toggle">
              <span class="account-unlock-copy"><strong id="account-unlock-label">Unlock everything</strong><span id="account-unlock-description">All levels, seeds, branches and augments.</span></span>
              <input id="unlock-everything" type="checkbox" role="switch" aria-labelledby="account-unlock-label" aria-describedby="account-unlock-description" />
              <span class="account-unlock-track" aria-hidden="true"><span class="account-unlock-thumb"></span></span>
            </label>
            <p id="account-unlock-status" role="status"></p>
          </div>
          <div class="profile-collection"><h3>My seeds</h3><div id="profile-seed-list"></div></div>
          <section class="playtest-resources" id="playtest-resources" aria-labelledby="playtest-resources-title" hidden>
            <h3 id="playtest-resources-title">Playtest resources</h3>
            <p id="playtest-resource-totals"></p>
            <button class="primary-button" id="refill-fertilizer" type="button">Add 10,000 fertilizer</button>
            <button class="secondary-button" id="reset-resources" type="button">Reset resources</button>
            <p class="playtest-resource-hint">Reset to 2,460 crystals and 120 fertilizer. Seeds and level progress are kept.</p>
            <p id="playtest-resource-status" role="status"></p>
          </section>
        </section>

        <section class="screen screen-preview flow-screen" data-screen="preview" aria-label="Level preview" hidden>
          <button class="preview-map-toggle" id="preview-map-toggle" type="button" aria-expanded="true" aria-controls="preview-seed-pool preview-actions"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-map"/></svg><span>View map</span></button>
          <div id="preview-board" aria-hidden="true"></div>
          <div class="preview-bottom">
            <div class="preview-upper-row"><div class="preview-conditions-space" aria-hidden="true"></div><div class="selected-lineup squad-slots" id="preview-team" role="group" aria-label="Selected seeds"></div></div>
            <div class="preview-seed-pool" id="preview-seed-pool" role="group" aria-label="Available seeds"><div class="team-count-pill" aria-label="Selected seed slots"><img src="/farm_td/assets/ui/fruit-quest/nav-seeds.png" alt="" aria-hidden="true" /><strong id="preview-team-count" aria-live="polite">4/5</strong></div><p class="sr-only" id="seed-pool-status" role="status">Tap a seed to add or remove it.</p><div class="seed-pool-layout"><button id="seed-pool-prev" type="button" aria-label="Previous seed page"><svg viewBox="0 0 22 48" aria-hidden="true"><path d="M17 3 5 24l12 21"/></svg></button><div class="team-picker" id="team-picker"></div><button id="seed-pool-next" type="button" aria-label="Next seed page"><svg viewBox="0 0 22 48" aria-hidden="true"><path d="M17 3 5 24l12 21"/></svg></button></div><span class="sr-only" id="seed-pool-page" aria-live="polite">1 / 1</span></div>
            <div class="preview-actions" id="preview-actions"><button class="icon-button" data-action="back-levels" type="button" aria-label="Back to levels"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-back"/></svg></button><button class="primary-button flow-primary" id="begin-battle" type="button">Start battle</button></div>
          </div>
        </section>

        <section class="screen screen-battle flow-screen" data-screen="battle" aria-labelledby="battle-title" hidden>
          <h1 id="battle-title" class="sr-only">Battle</h1>
          <div class="battle-topbar">
            <button class="battle-wave-button" id="send-wave" type="button" aria-label="Start wave 1 of 3"><span>WAVE</span><strong id="battle-wave">1 / 3</strong><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-play"/></svg></button>
            <div class="battle-energy" id="battle-energy" aria-label="150 energy"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-sun"/></svg><span><small>ENERGY</small><strong id="battle-sun">150</strong></span></div>
            <button class="battle-speed" id="speed-battle" type="button" aria-label="Speed x1">×1</button>
            <button class="battle-settings" id="pause-battle" type="button" aria-label="Pause and settings" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-gear"/></svg></button>
          </div>
          <div class="battle-scene" id="battle-scene" aria-label="Battle scene"></div>
          <p class="sr-only" id="battle-instruction" role="status">Choose a seed to plant.</p>
          <div class="battle-tray-shell"><div class="battle-tray" id="battle-tray" aria-label="Seeds you can plant"></div></div>
        </section>

        <section class="screen screen-results flow-screen" data-screen="results" aria-labelledby="result-title" hidden>
          <div class="results-card" id="results-content"></div>
        </section>

      </main>

      <nav class="tabbar" aria-label="Main navigation">
        <button class="tab" data-tab="pets" type="button" aria-label="Seeds" aria-current="false"><span class="tab-icon"><img src="/farm_td/assets/ui/fruit-quest/nav-seeds.png" alt="" aria-hidden="true" /></span><span>Seeds</span></button>
        <button class="tab is-active" data-tab="levels" type="button" aria-label="Levels" aria-current="page"><span class="tab-icon"><img src="/farm_td/assets/ui/fruit-quest/nav-levels.png" alt="" aria-hidden="true" /></span><span>Levels</span></button>
        <button class="tab" data-tab="shop" type="button" aria-label="Shop" aria-current="false"><span class="tab-icon"><img src="/farm_td/assets/ui/fruit-quest/nav-shop.png" alt="" aria-hidden="true" /></span><span>Shop</span></button>
      </nav>
      <div class="seed-detail-overlay" id="seed-detail-overlay" hidden>
        <div class="seed-detail-card" role="dialog" aria-modal="true" aria-labelledby="seed-detail-title">
          <button class="seed-detail-close" id="close-seed-detail" type="button" aria-label="Close seed details"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-close"/></svg></button>
          <div id="seed-detail-content"></div>
        </div>
      </div>
      <div class="packet-opening-overlay pack-stage-surface" id="packet-opening-overlay" role="dialog" aria-modal="true" aria-labelledby="packet-opening-title" hidden>
        <h2 class="packet-opening-title" id="packet-opening-title">Opening pack</h2>
        <video class="packet-opening-video" id="packet-opening-video" src="/farm_td/assets/ui/fruit-quest/pack-open-20261005-alpha.webm" muted playsinline preload="auto" aria-hidden="true"></video>
        <button class="packet-opening-skip" id="skip-packet-opening" type="button">Skip</button>
      </div>
      <div class="packet-opening-flash" id="packet-opening-flash" aria-hidden="true" hidden></div>
      <div class="packet-result-overlay pack-stage-surface" id="packet-result-overlay" role="dialog" aria-modal="true" aria-label="Seed rewards" hidden>
        <div class="packet-result-stage">
          <div class="packet-reveal-grid" id="packet-rewards" role="list" aria-label="Seeds received"></div>
          <button class="primary-button packet-done-button" id="packet-done" type="button">Done</button>
        </div>
      </div>
      <div class="card-pool-overlay" id="card-pool-overlay" hidden>
        <div class="card-pool-dialog" role="dialog" aria-modal="true" aria-labelledby="card-pool-title">
          <button class="seed-detail-close" id="close-card-pool" type="button" aria-label="Close card pool"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-close"/></svg></button>
          <h2 id="card-pool-title">Card pool</h2><div class="card-pool-grid" id="card-pool-grid"></div>
        </div>
      </div>
      <div class="battle-menu-overlay" id="battle-menu-overlay" hidden>
        <div class="battle-menu" role="dialog" aria-modal="true" aria-labelledby="battle-menu-title">
          <h2 id="battle-menu-title">Paused</h2>
          <button class="secondary-button battle-sound" id="toggle-battle-sound" type="button" aria-pressed="true">Sound: On</button>
          <button class="primary-button" id="resume-battle" type="button">Resume</button>
          <button class="secondary-button battle-leave" id="forfeit-battle" type="button">Leave battle</button>
        </div>
      </div>
    </div>
`;function i(e,n){let r=document.createElement(n?`button`:`article`);r.className=`combat-choice-card`,r instanceof HTMLButtonElement?r.type=`button`:r.setAttribute(`role`,`group`),n&&r.addEventListener(`click`,n);let i=document.createElement(`strong`);i.id=`${e.id}-title`,i.textContent=e.title;let a=document.createElement(`span`);if(a.className=`augment-emblem`,a.setAttribute(`aria-hidden`,`true`),e.iconSrc){a.classList.add(`has-augment-art`);let t=document.createElement(`img`);t.alt=``,t.className=`augment-illustration`,t.src=e.iconSrc,a.append(t)}else if([...Object.keys(t),`burn`,`frost`,`currency`].includes(e.icon)){let n=document.createElement(`img`);n.alt=``,n.src=e.icon===`currency`?`/farm_td/assets/ui/currency/battle-seed.png`:[`burn`,`frost`].includes(e.icon)?`/farm_td/assets/ui/traits/${e.icon}-black.png`:t[e.icon],e.icon!==`currency`&&(n.className=`augment-glyph`),a.append(n)}else{let t=document.createElementNS(`http://www.w3.org/2000/svg`,`svg`);t.setAttribute(`viewBox`,`0 0 24 24`);let n=document.createElementNS(`http://www.w3.org/2000/svg`,`use`);n.setAttribute(`href`,`#i-${e.icon}`),t.append(n),a.append(t)}let o=document.createElement(`p`);return o.id=`${e.id}-description`,typeof e.copy==`string`?o.textContent=e.copy:e.copy.forEach(e=>{let t=document.createElement(`span`);t.className=`upgrade-bonus`,t.textContent=e,o.append(t)}),r.append(i,a,o),r.setAttribute(`aria-labelledby`,i.id),r.setAttribute(`aria-describedby`,o.id),r}export{n as a,e as i,r as n,t as r,i as t};