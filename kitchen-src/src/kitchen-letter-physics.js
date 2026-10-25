// Keep the decorative type in a small, separate physics world. The room's
// geometry-derived walking mask still controls where the capybara can go.
let rapierPromise;
const loadRapier = () => rapierPromise ||= import('@dimforge/rapier3d-compat').then(async module => {
  const RAPIER = module.default;
  await RAPIER.init();
  return RAPIER;
});

export const KITCHEN_LETTER_FLOOR = Object.freeze({
  y: .20681837538650943, minX: -4.963588754710896, maxX: 4.963588754710896, minZ: -6, maxZ: 6,
});

const round = value => Math.round(value * 1000) / 1000;

export async function createKitchenLetterPhysics(specifications, {rootRef} = {}) {
  const RAPIER = await loadRapier();
  const world = new RAPIER.World({x: 0, y: -9.81, z: 0});
  const floor = KITCHEN_LETTER_FLOOR;
  // This is a finite slab, so letters really lose support at the room edge.
  world.createCollider(RAPIER.ColliderDesc.cuboid((floor.maxX - floor.minX) / 2, .12, (floor.maxZ - floor.minZ) / 2)
    .setTranslation((floor.minX + floor.maxX) / 2, floor.y - .12, (floor.minZ + floor.maxZ) / 2)
    .setFriction(.6).setRestitution(.05).setCollisionGroups(0x00040001));
  const letters = specifications.map(specification => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...specification.position).setRotation(specification.rotation)
      .setLinearDamping(.35).setAngularDamping(.65).setCcdEnabled(true).setSleeping(true));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(...specification.halfExtents)
      .setMass(.18).setFriction(.48).setRestitution(.08).setCollisionGroups(0x00010007), body);
    return {body, collider, specification, fallen: false};
  });
  const byCollider = new Map(letters.map(letter => [letter.collider.handle, letter]));
  const playerBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(-1.8, floor.y + .58, -.9).setGravityScale(0)
    .enabledTranslations(true, false, true).lockRotations().setCanSleep(false).setCcdEnabled(true));
  const playerCollider = world.createCollider(RAPIER.ColliderDesc.capsule(.25, .33)
    .setMass(6).setFriction(.05).setRestitution(0).setCollisionGroups(0x00020001), playerBody);
  let accumulator = 0, pushes = 0, disposed = false, previousContacts = new Set();
  const fixedStep = 1 / 120;

  function publish(contacts = new Set()) {
    const root = rootRef?.current || rootRef;
    if (!root?.dataset) return;
    root.dataset.letterPhysics = 'ready';
    root.dataset.letterCollisions = String(contacts.size);
    root.dataset.letterPushes = String(pushes);
    root.dataset.lettersFallen = String(letters.filter(letter => letter.fallen).length);
    root.dataset.letterBodies = JSON.stringify(letters.map(({body, specification, fallen}) => {
      const {x, y, z} = body.translation();
      return {letter: specification.character, x: round(x), y: round(y), z: round(z), fallen};
    }));
  }

  function step(player, next, delta, {paused = false} = {}) {
    if (disposed) return next;
    const dt = Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, .05));
    // Rebase from the room-approved position; the room may reject a physics
    // correction that would otherwise nudge the player through a cabinet.
    playerBody.setTranslation({x: player.x, y: floor.y + .58, z: player.z}, true);
    if (paused || !dt) {
      playerBody.setLinvel({x: 0, y: 0, z: 0}, true);
      accumulator = 0;
      publish();
      return {...next, moving: false};
    }
    const vx = (next.x - player.x) / dt, vz = (next.z - player.z) / dt;
    playerBody.setLinvel({x: vx, y: 0, z: vz}, true);
    accumulator += dt;
    const contacts = new Set();
    while (accumulator + 1e-9 >= fixedStep) {
      world.timestep = fixedStep;
      world.step();
      world.contactPairsWith(playerCollider, collider => {
        const letter = byCollider.get(collider.handle);
        if (letter) contacts.add(letter.collider.handle);
      });
      accumulator -= fixedStep;
    }
    for (const handle of contacts) if (!previousContacts.has(handle) && Math.hypot(vx, vz) > .05) pushes++;
    previousContacts = contacts;
    for (const letter of letters) {
      if (letter.body.translation().y < floor.y - .3) letter.fallen = true;
      // Once out of sight, stop solving an object that keeps falling forever.
      if (letter.body.translation().y < -12) letter.body.setEnabled(false);
    }
    publish(contacts);
    const position = playerBody.translation();
    return {...next, x: position.x, z: position.z, moving: Math.hypot(position.x - player.x, position.z - player.z) > .00001};
  }

  function reset() {
    if (disposed) return;
    accumulator = 0;pushes = 0;previousContacts.clear();
    for (const letter of letters) {
      letter.body.setEnabled(true);
      letter.body.setTranslation({x: letter.specification.position[0], y: letter.specification.position[1], z: letter.specification.position[2]}, false);
      letter.body.setRotation(letter.specification.rotation, false);
      letter.body.setLinvel({x: 0, y: 0, z: 0}, false);
      letter.body.setAngvel({x: 0, y: 0, z: 0}, false);
      letter.body.sleep();letter.fallen = false;
    }
    publish();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    world.free();
  }

  publish();
  return {letters, step, reset, dispose};
}
