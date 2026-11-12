// The duel's rules. No rendering, camera or timers: call update(dtMs), read the state, and
// drain events to drive visuals and sound.
//
// Enemy loop: idle -> telegraph -> (launch hex) -> recover -> idle.
// A fireball landing in idle/recover causes stagger -> ward -> telegraph, and a fireball thrown
// at him while he is idle/recovering often meets a ward he raises as it comes in. A telegraph
// cannot be interrupted, which stops the player from stun-locking the enemy. Skyfall is the
// answer to the ward. A Water Ball that lands while he charges puts the hex out.
//
// He stands still in the middle, and fireballs always home in on him.

import { DUEL_CONFIG } from './config.mjs';

const lerp = (a, b, t) => a + (b - a) * t;

export class Duel {
  constructor({ config = DUEL_CONFIG, random = Math.random } = {}) {
    this.config = config;
    this.random = random;
    this.events = [];
    this.reset();
  }

  reset() {
    const { config } = this;
    this.phase = 'ready'; // ready | fighting | victory | defeat
    this.time = 0;
    this.paused = false;
    this.endedAt = null;
    this.nextId = 1;
    this.projectiles = [];
    this.boltOrigin = null;
    this.player = {
      hp: config.playerHp, maxHp: config.playerHp, x: 0, lane: 0, laneReadyAt: 0,
      shieldUntil: 0, shieldReadyAt: 0, shieldWasUp: false,
      throwReadyAt: 0, skyfallReadyAt: 0, waterReadyAt: 0,
    };
    this.enemy = { hp: config.enemyHp, maxHp: config.enemyHp, x: 0, state: 'idle', stateStart: 0, stateUntil: Infinity, wardAt: null, soakedUntil: 0, attack: null, attacks: 0 };
    this.stats = { hitsLanded: 0, warded: 0, doused: 0, blocks: 0, dodges: 0, hitsTaken: 0 };
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  drainEvents() {
    return this.events.splice(0);
  }

  get rage() {
    return 1 - this.enemy.hp / this.enemy.maxHp;
  }

  get shieldUp() {
    return this.time < this.player.shieldUntil;
  }

  /** Share of the shield's time still left, or 0 when it is down. */
  get shieldFraction() {
    return Math.max(0, this.player.shieldUntil - this.time) / this.config.shield.durationMs;
  }

  cooldownMs(spell) {
    const key = { Throw: 'throwReadyAt', Skyfall: 'skyfallReadyAt', Shield: 'shieldReadyAt', Dodge: 'laneReadyAt', Water: 'waterReadyAt' }[spell];
    return Math.max(0, this.player[key] - this.time);
  }

  /** Milliseconds until the nearest enemy hex reaches the player, or null. */
  get incomingEtaMs() {
    const shot = this.nearestBolt();
    return shot ? shot.etaMs : null;
  }

  nearestBolt() {
    const { playerPlaneZ } = this.config.arena;
    let nearest = null;
    for (const shot of this.projectiles) {
      if (shot.owner !== 'enemy' || shot.crossed) continue;
      const etaMs = ((playerPlaneZ - shot.position.z) / shot.speed) * 1000;
      if (!nearest || etaMs < nearest.etaMs) nearest = { shot, etaMs };
    }
    return nearest;
  }

  /** Like incomingEtaMs, but only for a hex that will reach the lane the player is in now. */
  /** Whether the next hex to reach the player's lane is an unstoppable one. */
  get incomingThreatUnstoppable() {
    const { playerPlaneZ } = this.config.arena;
    let best = null;
    for (const shot of this.projectiles) {
      if (shot.owner !== 'enemy' || shot.crossed || Math.abs(shot.targetX - this.player.x) > this.config.bolt.hitHalfWidth) continue;
      const ms = ((playerPlaneZ - shot.position.z) / shot.speed) * 1000;
      if (!best || ms < best.ms) best = { ms, unstoppable: Boolean(shot.unstoppable) };
    }
    return best?.unstoppable ?? false;
  }

  get incomingThreatEtaMs() {
    const { playerPlaneZ } = this.config.arena;
    let eta = null;
    for (const shot of this.projectiles) {
      if (shot.owner !== 'enemy' || shot.crossed || Math.abs(shot.targetX - this.player.x) > this.config.bolt.hitHalfWidth) continue;
      const ms = ((playerPlaneZ - shot.position.z) / shot.speed) * 1000;
      if (eta === null || ms < eta) eta = ms;
    }
    return eta;
  }

  /**
   * The lanes (-1, 0, 1) his attack will come down: while he charges a double hex, the two he
   * picked; while hexes fly, theirs. null otherwise (a plain charge follows the player).
   */
  get threatenedLanes() {
    const { enemy, config } = this;
    if (enemy.state === 'telegraph' && enemy.attack?.kind === 'double') return enemy.attack.lanes;
    const lanes = this.projectiles.filter(shot => shot.owner === 'enemy' && !shot.crossed).map(shot => Math.round(shot.targetX / config.lanes.offset));
    return lanes.length ? [...new Set(lanes)] : null;
  }

  get canRestart() {
    return this.endedAt !== null && this.time - this.endedAt >= this.config.restartLockMs;
  }

  setPaused(paused) {
    if (this.paused !== paused && this.phase === 'fighting') {
      this.paused = paused;
      this.emit(paused ? 'paused' : 'resumed');
    }
  }

  /** Where the next hex leaves from, when the view knows where the staff's orb is on screen. */
  setBoltOrigin(position) {
    this.boltOrigin = position;
  }

  begin() {
    this.phase = 'fighting';
    this.setEnemyState('idle', this.config.enemy.openingDelayMs);
    this.emit('begin');
  }

  restart() {
    this.reset();
    this.emit('restart');
  }

  /**
   * spell: 'Throw' | 'Water' | 'Skyfall' | 'Shield' | 'Dodge'. Options: origin and aimX (Throw,
   * Water), dir (Dodge: one lane that way).
   * Only attacks (Throw, Water, Skyfall) start or restart a duel, so a stray swipe or block never does.
   */
  cast(spell, { origin = null, aimX = null, dir = 1 } = {}) {
    if (this.paused) return { ok: false, reason: 'paused' };
    if (this.phase === 'victory' || this.phase === 'defeat') {
      if (!['Throw', 'Water', 'Skyfall'].includes(spell) || !this.canRestart) return { ok: false, reason: 'ended' };
      this.restart();
    }
    if (spell === 'Shield') return this.raiseShield();
    if (spell === 'Dodge') return this.moveLane(dir);
    if (this.cooldownMs(spell) > 0) {
      this.emit('fizzle', { spell });
      return { ok: false, reason: 'cooldown' };
    }
    if (this.phase === 'ready') this.begin();
    if (spell === 'Throw') this.launchFireball(origin, aimX);
    else if (spell === 'Water') this.launchFireball(origin, aimX, 'waterball');
    else this.callSkyfall();
    return { ok: true };
  }

  /** Where a fireball lands: the middle of his body, just in front of him. */
  fireballTarget() {
    const { arena } = this.config;
    return { x: this.enemy.x, y: arena.enemyCenterY, z: arena.enemyZ + 0.8 };
  }

  /**
   * A fireball (or Water Ball) leaves the way the throw pointed (aimX) and bends onto the Warden,
   * a curve from the hand ending on him, so it cannot miss.
   */
  launchFireball(origin, aimX, kind = 'fireball') {
    const { config, player, enemy } = this;
    const spec = kind === 'waterball' ? config.water : config.throw;
    player[kind === 'waterball' ? 'waterReadyAt' : 'throwReadyAt'] = this.time + spec.cooldownMs;
    const position = origin ? { ...origin } : { x: player.x + 0.25, y: 1.25, z: -0.5 };
    const target = this.fireballTarget();
    const aimed = { ...target, x: aimX ?? enemy.x };
    const bend = { x: (position.x + aimed.x) / 2, y: (position.y + aimed.y) / 2, z: (position.z + aimed.z) / 2 };
    const distance = Math.hypot(target.x - position.x, target.y - position.y, target.z - position.z);
    const flightMs = (distance / spec.speed) * 1000;
    const shot = { id: this.nextId++, owner: 'player', kind, position, start: { ...position }, bend, ageMs: 0, flightMs };
    this.projectiles.push(shot);
    this.emit(kind === 'waterball' ? 'waterball-cast' : 'fireball-cast', { id: shot.id, position: { ...position } });
    this.maybeWard();
  }

  /** While idle or recovering, he may see a fireball coming and raise his ward in time. */
  maybeWard() {
    const { enemy, config } = this;
    if (enemy.state !== 'idle' && enemy.state !== 'recover') return;
    if (enemy.wardAt !== null) return;
    if (this.random() < lerp(...config.enemy.wardChance, this.rage)) enemy.wardAt = this.time + config.enemy.wardReactMs;
  }

  raiseWard() {
    this.enemy.wardAt = null;
    this.setEnemyState('ward', this.config.enemy.wardMs);
    this.emit('enemy-ward');
  }

  /** Steps one lane and stays there. A hex keeps flying at the lane it was aimed at. */
  moveLane(dir) {
    const { player, config } = this;
    if (this.time < player.laneReadyAt) return { ok: false, reason: 'cooldown' };
    const lane = Math.max(-1, Math.min(1, player.lane + Math.sign(dir)));
    if (lane === player.lane) return { ok: false, reason: 'edge' };
    player.lane = lane;
    player.x = lane * config.lanes.offset;
    player.laneReadyAt = this.time + config.lanes.cooldownMs;
    this.emit('player-move', { lane, dir });
    return { ok: true };
  }

  /** Raising early wastes it: the shield runs its fixed time, then has to recharge. */
  raiseShield() {
    const { player, config } = this;
    if (this.shieldUp) return { ok: false, reason: 'active' };
    if (this.cooldownMs('Shield') > 0) {
      this.emit('fizzle', { spell: 'Shield' });
      return { ok: false, reason: 'cooldown' };
    }
    player.shieldUntil = this.time + config.shield.durationMs;
    player.shieldReadyAt = player.shieldUntil + config.shield.cooldownMs;
    player.shieldWasUp = true;
    this.emit('shield-up');
    return { ok: true };
  }

  callSkyfall() {
    const { player, enemy, config } = this;
    player.skyfallReadyAt = this.time + config.skyfall.cooldownMs;
    const shattered = enemy.state === 'ward';
    this.emit('skyfall', { x: enemy.x, shattered });
    this.damageEnemy(config.skyfall.damage, { x: enemy.x, y: config.arena.enemyCenterY, z: config.arena.enemyZ }, 'skyfall');
    if (this.phase !== 'fighting') return;
    if (shattered) {
      this.emit('ward-broken');
      this.setEnemyState('recover', config.skyfall.stunMs);
    }
  }

  setEnemyState(state, durationMs) {
    const { enemy } = this;
    enemy.state = state;
    enemy.stateStart = this.time;
    enemy.stateUntil = this.time + durationMs / this.enemyPace;
  }

  /** How fast the Warden acts: 1, or slower while soaked by a Water Ball. */
  get enemyPace() {
    return this.soaked ? this.config.water.soakSlow : 1;
  }

  get soaked() {
    return this.time < (this.enemy.soakedUntil ?? 0);
  }

  /** Soaks him: what he is doing now and everything for soakMs runs slower. */
  soak() {
    const { enemy, config } = this;
    if (!this.soaked) {
      // Stretch what is left of his current action, as if it had been slow all along.
      const left = Math.max(0, enemy.stateUntil - this.time);
      enemy.stateUntil = this.time + left / config.water.soakSlow;
      for (const shot of this.projectiles) if (shot.owner === 'enemy') shot.speed *= config.water.soakSlow;
    }
    enemy.soakedUntil = this.time + config.water.soakMs;
    this.emit('enemy-soaked', { untilMs: config.water.soakMs });
  }

  enterTelegraph() {
    const { config, enemy, player } = this;
    let durationMs = lerp(...config.enemy.telegraphMs, this.rage);
    enemy.attacks = (enemy.attacks ?? 0) + 1;
    const double = enemy.attacks > 1 && this.random() < lerp(...config.enemy.double.chance, this.rage);
    if (double) {
      // Spare one lane other than the player's, at random; hit the other two.
      const others = [-1, 0, 1].filter(lane => lane !== player.lane);
      const safe = others[this.random() < 0.5 ? 0 : 1];
      enemy.attack = { kind: 'double', lanes: [-1, 0, 1].filter(lane => lane !== safe), safe };
      durationMs *= config.enemy.double.chargeScale;
    } else {
      enemy.attack = { kind: 'single' };
    }
    this.setEnemyState('telegraph', durationMs);
    this.emit('enemy-telegraph', { durationMs: durationMs / this.enemyPace, attack: enemy.attack });
  }

  enterIdle() {
    const [slow, fast] = this.config.enemy.idleMs;
    const base = lerp(slow, fast, this.rage);
    const durationMs = base * (0.8 + this.random() * 0.4);
    this.setEnemyState('idle', durationMs);
  }

  /**
   * Throws a hex down the lane the player is in now, or for a double hex down both its lanes.
   * Each keeps to its lane whatever the player does.
   */
  launchBolt() {
    const { enemy, player, config } = this;
    const { staffOffset, enemyZ, playerPlaneZ } = config.arena;
    const { height, laneJoin } = config.bolt;
    const origin = this.boltOrigin ? { ...this.boltOrigin } : { x: enemy.x + staffOffset.x, y: staffOffset.y, z: enemyZ + staffOffset.z };
    const speed = lerp(...config.bolt.speed, this.rage) * this.enemyPace;
    const joinMetres = (playerPlaneZ - origin.z) * laneJoin;
    const targets = enemy.attack?.kind === 'double' ? enemy.attack.lanes.map(lane => lane * config.lanes.offset) : [player.x];
    for (const targetX of targets) {
      const shot = { id: this.nextId++, owner: 'enemy', kind: 'bolt', position: { ...origin }, start: { ...origin }, joinMetres, speed, targetX, crossed: false, unstoppable: targets.length > 1 };
      this.projectiles.push(shot);
      this.emit('enemy-release', { id: shot.id, position: { ...origin }, double: targets.length > 1 });
    }
    enemy.attack = null;
  }

  update(dtMs) {
    if (this.paused || dtMs <= 0) return;
    this.time += dtMs;
    this.updateShield();
    if (this.phase === 'fighting') this.updateEnemy();
    if (this.enemy.soakedUntil && !this.soaked) {
      this.enemy.soakedUntil = 0;
      this.emit('enemy-dried');
    }
    this.updateProjectiles(dtMs);
  }

  updateShield() {
    if (this.player.shieldWasUp && !this.shieldUp) {
      this.player.shieldWasUp = false;
      this.emit('shield-down');
    }
  }

  updateEnemy() {
    const { enemy, config } = this;
    if (enemy.wardAt !== null && this.time >= enemy.wardAt) {
      if (enemy.state === 'idle' || enemy.state === 'recover') this.raiseWard();
      else enemy.wardAt = null; // a hit or Skyfall got there first
    }
    if (this.time < enemy.stateUntil) return;
    switch (enemy.state) {
      case 'idle':
        this.enterTelegraph();
        break;
      case 'telegraph':
        this.launchBolt();
        this.setEnemyState('recover', lerp(...config.enemy.recoverMs, this.rage));
        break;
      case 'recover':
        this.enterIdle();
        break;
      case 'stagger':
        this.raiseWard();
        break;
      case 'ward':
        this.enterTelegraph();
        break;
    }
  }

  updateProjectiles(dtMs) {
    this.projectiles = this.projectiles.filter(shot => (shot.owner === 'player' ? this.stepFireball(shot, dtMs) : this.stepBolt(shot, dtMs)));
    if (this.endedAt !== null) this.projectiles = []; // nothing in flight can change a finished duel
  }

  /** Moves a fireball along its curve, which ends on him wherever he is. False once it lands. */
  stepFireball(shot, dtMs) {
    shot.ageMs += dtMs;
    const t = Math.min(1, shot.ageMs / shot.flightMs);
    const end = this.fireballTarget(); // homing reads him each step
    const u = 1 - t;
    for (const axis of ['x', 'y', 'z']) {
      shot.position[axis] = u * u * shot.start[axis] + 2 * u * t * shot.bend[axis] + t * t * end[axis];
    }
    if (t < 1) return true;
    this.fireballLands({ ...shot.position }, shot.kind);
    return false;
  }

  fireballLands(position, kind = 'fireball') {
    const { enemy, config, stats } = this;
    if (this.phase !== 'fighting') return;
    if (enemy.state === 'ward') {
      stats.warded += 1;
      this.emit('enemy-warded', { position });
      return;
    }
    const stateBefore = enemy.state;
    const water = kind === 'waterball';
    this.damageEnemy(water ? config.water.damage : config.throw.damage, position, kind);
    if (this.phase !== 'fighting') return;
    const unstoppable = stateBefore === 'telegraph' && enemy.attack?.kind === 'double';
    if (water && unstoppable) {
      this.emit('enemy-undoused', { position }); // an unstoppable hex cannot be put out
    } else if (water && stateBefore === 'telegraph') {
      // Doused: the charge goes out, no hex this time, and he recovers as if he had cast it.
      stats.doused += 1;
      enemy.attack = null;
      this.setEnemyState('recover', lerp(...config.enemy.recoverMs, this.rage));
      this.emit('enemy-doused', { position });
    } else if (stateBefore === 'idle' || stateBefore === 'recover') {
      this.setEnemyState('stagger', config.enemy.staggerMs);
    }
    if (water) this.soak();
  }

  damageEnemy(damage, position, source) {
    const { enemy, stats } = this;
    enemy.hp = Math.max(0, enemy.hp - damage);
    stats.hitsLanded += 1;
    this.emit('enemy-hit', { position, damage, hp: enemy.hp, source });
    if (enemy.hp === 0) this.finish('victory');
  }

  /**
   * A hex moves toward the player at a steady speed. Its sideways and downward offset from its
   * lane shrinks to nothing by the join point, easing out so it settles into the lane without a
   * kink, then it flies dead straight along the lane.
   */
  stepBolt(shot, dtMs) {
    const { height } = this.config.bolt;
    shot.position.z += shot.speed * (dtMs / 1000);
    const along = Math.min(1, Math.max(0, (shot.position.z - shot.start.z) / shot.joinMetres));
    const left = (1 - along) ** 2;
    shot.position.x = shot.targetX + (shot.start.x - shot.targetX) * left;
    shot.position.y = height + (shot.start.y - height) * left;
    if (!shot.crossed && shot.position.z >= this.config.arena.playerPlaneZ) return this.boltArrives(shot);
    return shot.position.z < 4; // a dodged hex flies past the camera, then disappears
  }

  boltArrives(shot) {
    const { player, config, stats } = this;
    const position = { ...shot.position };
    if (this.phase !== 'fighting') return false;
    if (this.shieldUp && !shot.unstoppable) {
      stats.blocks += 1;
      this.emit('player-blocked', { position });
      return false;
    }
    if (Math.abs(shot.position.x - player.x) > config.bolt.hitHalfWidth) {
      shot.crossed = true;
      stats.dodges += 1;
      this.emit('player-dodged', { position });
      return true;
    }
    const damage = config.bolt.damage;
    player.hp = Math.max(0, player.hp - damage);
    stats.hitsTaken += 1;
    this.emit('player-hit', { position, damage, hp: player.hp, unstoppable: Boolean(shot.unstoppable), throughShield: Boolean(shot.unstoppable && this.shieldUp) });
    if (player.hp === 0) this.finish('defeat');
    return false;
  }

  finish(phase) {
    this.phase = phase;
    this.endedAt = this.time;
    this.enemy.state = phase === 'victory' ? 'defeated' : 'idle';
    this.enemy.stateUntil = Infinity;
    this.enemy.wardAt = null;
    this.player.shieldUntil = this.time;
    this.emit(phase);
  }
}
