import { fingerRatios } from '../tracking/poses.mjs';

const $ = id => document.getElementById(id);
const CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const FOE_STATE = {
  telegraph: 'Charging a hex',
  ward: 'Warded: fireballs bounce off',
  stagger: 'Staggered',
  recover: 'Open: strike now',
};

export class Hud {
  constructor() {
    this.cache = new Map();
    this.flashTimer = null;
    this.transient = null;
    this.previewCtx = $('preview-canvas').getContext('2d');
    this.showDebug = false;
  }

  /** Writes only on change, because this runs every frame. */
  put(element, key, value, write) {
    const id = `${element.id}:${key}`;
    if (this.cache.get(id) === value) return;
    this.cache.set(id, value);
    write(value);
  }

  text(element, value) {
    this.put(element, 'text', value, v => { element.textContent = v; });
  }

  attr(element, name, value) {
    this.put(element, name, value, v => element.setAttribute(name, v));
  }

  flag(element, name, on) {
    this.put(element, `class-${name}`, on, v => element.classList.toggle(name, v));
  }

  say(text, tone = 'neutral', ms = 950) {
    this.transient = { text, tone, until: performance.now() + ms };
  }

  flash(kind) {
    const flash = $('flash');
    flash.className = '';
    void flash.offsetWidth;
    flash.className = `show ${kind}`;
  }

  handleEvents(events) {
    for (const event of events) {
      switch (event.type) {
        case 'fireball-cast': this.say('Fireball away', 'fire', 650); break;
        case 'waterball-cast': this.say('Water Ball away', 'ward', 650); break;
        case 'enemy-doused': this.say('Doused his hex', 'ward', 1100); break;
        case 'enemy-soaked': this.say('Soaked! He slows down', 'ward', 1000); break;
        case 'enemy-undoused': this.say("Can't douse it: unstoppable!", 'unstoppable', 1000); break;
        case 'enemy-hit': this.say(`Hit: ${event.damage} damage`, event.source === 'skyfall' ? 'ward' : 'fire'); break;
        case 'skyfall': this.flash('storm'); break;
        case 'ward-broken': this.say('Ward shattered', 'ward'); break;
        case 'shield-up': this.say('Shield up', 'ward', 500); break;
        case 'enemy-warded': this.say('Warded. No damage', 'hex'); break;
        case 'player-blocked': this.say('Blocked', 'ward'); this.flash('ward'); break;
        case 'player-dodged': this.say('Dodged', 'ward'); break;
        case 'player-hit':
          this.say(event.throughShield ? 'Unstoppable: through your Shield!' : `You took ${event.damage} damage`, event.unstoppable ? 'unstoppable' : 'hex');
          this.flash('hex');
          break;
        case 'fizzle': this.say(`${event.spell} is still recharging`, 'neutral', 600); break;
        default: break;
      }
    }
  }

  prompt(duel, gesture, handCount, paused) {
    if (duel.phase === 'victory' || duel.phase === 'defeat') return { text: '', tone: 'neutral' };
    if (paused) return { text: 'Paused. Raise a hand to continue', tone: 'neutral' };
    if (this.transient && performance.now() < this.transient.until) return this.transient;
    this.transient = null;

    if (duel.phase === 'fighting') {
      // The double hex: say where the safe lane is for the whole of his long charge.
      const attack = duel.enemy.state === 'telegraph' ? duel.enemy.attack : null;
      if (attack?.kind === 'double' && !duel.shieldUp) {
        const there = attack.safe === duel.player.lane;
        const where = { '-1': 'left', '0': 'middle', '1': 'right' }[attack.safe];
        return there ? { text: `Unstoppable! Stay in the ${where}`, tone: 'unstoppable-safe' } : { text: `Unstoppable! Get to the ${where}!`, tone: 'unstoppable' };
      }
      const eta = duel.incomingThreatEtaMs;
      if (eta !== null && !duel.shieldUp) {
        if (eta <= duel.config.shield.durationMs) {
          if (duel.incomingThreatUnstoppable) return { text: 'Unstoppable! Dodge!', tone: 'unstoppable' };
          return { text: duel.cooldownMs('Shield') === 0 ? 'Palms up! Shield!' : 'Swipe! Dodge!', tone: 'alarm' };
        }
        return duel.incomingThreatUnstoppable ? { text: 'Unstoppable! Dodge!', tone: 'unstoppable' } : { text: 'Hex incoming!', tone: 'hex' };
      }
      if (duel.enemy.state === 'ward' && duel.cooldownMs('Skyfall') === 0) return { text: 'Fists up, slam down to break the ward', tone: 'ward' };
      if (duel.enemy.state === 'telegraph' && !duel.shieldUp) return { text: 'The Warden is charging', tone: 'hex' };
      return { text: '', tone: 'neutral' };
    }
    if (duel.phase !== 'ready') return { text: '', tone: 'neutral' };

    if (handCount === 0) return { text: 'Raise a hand where the camera can see it', tone: 'neutral' };
    if (gesture?.primed) return { text: 'Snap it forward and open your hand', tone: 'fire' };
    return { text: 'Make a fist and hold it to begin', tone: 'neutral' };
  }

  update(duel, gesture, handCount, paused) {
    const { player, enemy } = duel;

    this.put($('foe-fill'), 'width', (enemy.hp / enemy.maxHp * 100).toFixed(1), v => { $('foe-fill').style.width = `${v}%`; });
    const double = enemy.state === 'telegraph' && enemy.attack?.kind === 'double';
    const state = duel.phase === 'fighting' ? (double ? 'Unstoppable: two lanes!' : FOE_STATE[enemy.state] ?? '') : '';
    this.flag($('foe'), 'unstoppable', duel.phase === 'fighting' && double);
    this.text($('foe-state'), duel.phase === 'fighting' && duel.soaked ? `Soaked${state ? `, ${state.toLowerCase()}` : ''}` : state);
    this.flag($('foe'), 'soaked', duel.phase === 'fighting' && duel.soaked);
    this.flag($('foe'), 'charging', enemy.state === 'telegraph');
    this.flag($('foe'), 'warded', enemy.state === 'ward');

    this.put($('you-fill'), 'width', (player.hp / player.maxHp * 100).toFixed(1), v => { $('you-fill').style.width = `${v}%`; });
    this.flag($('you'), 'low', player.hp <= 40);
    this.flag($('you'), 'shielding', duel.shieldUp);

    // The spell list: how ready each spell is, which one is forming, a pop when one comes back.
    const shieldLevel = duel.shieldUp ? duel.shieldFraction : 1 - duel.cooldownMs('Shield') / duel.config.shield.cooldownMs;
    const readiness = {
      throw: 1 - duel.cooldownMs('Throw') / duel.config.throw.cooldownMs,
      water: 1 - duel.cooldownMs('Water') / duel.config.water.cooldownMs,
      shield: duel.shieldUp ? 1 : shieldLevel,
      skyfall: 1 - duel.cooldownMs('Skyfall') / duel.config.skyfall.cooldownMs,
      dodge: 1 - duel.cooldownMs('Dodge') / duel.config.lanes.cooldownMs,
    };
    const forming = gesture?.forming ?? null;
    for (const [name, amount] of Object.entries(readiness)) {
      const card = $(`spell-${name}`);
      const ready = Math.max(0, Math.min(1, amount));
      this.put(card, 'ready', ready.toFixed(2), value => card.style.setProperty('--ready', value));
      this.put(card, 'cooling', ready < 1, cooling => {
        card.classList.toggle('cooling', cooling);
        if (!cooling) { card.classList.remove('ready-pop'); void card.offsetWidth; card.classList.add('ready-pop'); }
      });
    }
    this.flag($('spell-throw'), 'active', forming === 'Throw');
    this.flag($('spell-shield'), 'active', duel.shieldUp || forming === 'Shield');
    this.flag($('spell-skyfall'), 'active', forming === 'Skyfall');

    const { text, tone } = this.prompt(duel, gesture, handCount, paused);
    this.text($('prompt'), text);
    this.put($('prompt'), 'tone', tone, value => { $('prompt').dataset.tone = value; });
  }

  setCameraStatus() {}

  setTracking(handCount, sourceKind, detail) {
    this.text($('debug-detail'), detail);
  }

  /** Both hands' tracking drawn over the mirrored camera: inked bones, coloured per hand. */
  drawPreview(video, hands) {
    const canvas = $('preview-canvas');
    const ctx = this.previewCtx;
    if (canvas.width !== 480) {
      canvas.width = 480;
      canvas.height = 270;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const x = p => (1 - p.x) * canvas.width, y = p => p.y * canvas.height;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [side, colour] of [['left', '#7fe6ff'], ['right', '#f2b324']]) {
      const points = hands[side]?.image;
      if (!points) continue;
      for (const [width, stroke] of [[6, '#201714'], [3, colour]]) {
        ctx.lineWidth = width;
        ctx.strokeStyle = stroke;
        ctx.beginPath();
        for (const [a, b] of CONNECTIONS) {
          ctx.moveTo(x(points[a]), y(points[a]));
          ctx.lineTo(x(points[b]), y(points[b]));
        }
        ctx.stroke();
      }
      for (const point of points) {
        ctx.beginPath();
        ctx.arc(x(point), y(point), 3.2, 0, Math.PI * 2);
        ctx.fillStyle = '#fff1d2';
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#201714';
        ctx.stroke();
      }
    }
  }

  /** Per-finger ratios show why a pose was or was not recognised. */
  poseReadout(hands, gesture, poseSource) {
    const check = `${gesture?.shieldCheck ? `\n${gesture.shieldCheck}` : ''}${gesture?.lastCheck ? `\n${gesture.lastCheck}` : ''}`;
    const line = side => {
      const hand = hands[side];
      const ratios = hand ? fingerRatios(poseSource === 'image' ? hand.image : hand.world ?? hand.image) : null;
      const pose = gesture?.poses?.[side] ?? 'missing';
      return `${side[0].toUpperCase()} ${pose.padEnd(7)} ${ratios ? ratios.map(r => r.toFixed(2)).join(' ') : '-'}`;
    };
    return `${line('left')}\n${line('right')}${check}`;
  }

  /** D adds the tracking readouts under the camera window. */
  toggleDebug() {
    this.showDebug = !this.showDebug;
    $('preview').classList.toggle('debug', this.showDebug);
  }

  /** The camera window, top left, whenever the camera is on. */
  setPreviewVisible(visible) {
    $('preview').hidden = !visible;
  }

  gestureHint(failed) {
    if (failed === 'throw-no-snap') this.say('Snap your hand forward as it opens', 'neutral', 1100);
  }

  reset() {
    this.transient = null;
    $('flash').className = '';
  }
}
