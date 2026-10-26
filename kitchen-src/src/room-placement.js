import surfaceV7 from './room-v7-surfaces.json';
import surfaceV10 from './room-v10-surfaces.json';
import layoutV10 from './room-v10-layout.json';

/** Each room keeps geometry-derived support and collision data in its own coordinate system. */
function createRoomPlacement(surfaceData, version) {
  const ROOM_FLOOR_Y = surfaceData.floorY;
  const ROOM_BOUNDS = Object.freeze({...surfaceData.bounds});
  const CAPYBARA_HEIGHT = 1.35;
  const CHARACTER_HEIGHT = CAPYBARA_HEIGHT;
  const PLAYER_RADIUS = .33;
  const PLAYER_SPEED = 3.8;
  const PLAYER_START = Object.freeze({x: -1.8, y: ROOM_FLOOR_Y + .015, z: version === 10 ? -.9 : -1.3});
  const START_POSITION = PLAYER_START;

  const {minX, minZ, step, width: columns, height: rows} = surfaceData;
  const heights = new Float32Array(columns * rows);
  heights.fill(NaN);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const code = surfaceData.topRows[row].slice(column * 3, column * 3 + 3);
      if (code !== '---') heights[row * columns + column] = parseInt(code, 36) / 1000;
    }
  }

  const finite = value => Number.isFinite(value);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const pointValues = point => Array.isArray(point)
    ? {x: point[0], y: point[1], z: point[2]}
    : {x: point?.x, y: point?.y, z: point?.z};

  function surroundingCells(x, z) {
    const gx = (x - minX) / step, gz = (z - minZ) / step;
    const x0 = Math.floor(gx + 1e-7), x1 = Math.ceil(gx - 1e-7);
    const z0 = Math.floor(gz + 1e-7), z1 = Math.ceil(gz - 1e-7);
    return x0 < 0 || z0 < 0 || x1 >= columns || z1 >= rows ? null : [x0, x1, z0, z1];
  }

  /** Static room clearance is already included in the mask. Optional floor props add circles. */
  function canWalk(x, z, placements = []) {
    if (!finite(x) || !finite(z)) return false;
    const cells = surroundingCells(x, z);
    if (!cells) return false;
    const [x0, x1, z0, z1] = cells;
    if (![surfaceData.walkRows[z0][x0], surfaceData.walkRows[z0][x1], surfaceData.walkRows[z1][x0], surfaceData.walkRows[z1][x1]].every(value => value === '1')) return false;
    for (const item of placements || []) {
      const position = item?.position;
      if (!Array.isArray(position) || Math.abs(position[1] - ROOM_FLOOR_Y) > .08) continue;
      const radius = (finite(item.width) ? item.width : .5) * .3 + PLAYER_RADIUS;
      if (Math.hypot(x - position[0], z - position[2]) < radius) return false;
    }
    return true;
  }

  function getPlayerStart(placements = []) {
    if (canWalk(PLAYER_START.x, PLAYER_START.z, placements)) return {...PLAYER_START};
    for (let ring = 1; ring <= 16; ring++) {
      for (let sample = 0; sample < 32; sample++) {
        const angle = sample / 32 * Math.PI * 2;
        const x = PLAYER_START.x + Math.cos(angle) * ring * step * 2;
        const z = PLAYER_START.z + Math.sin(angle) * ring * step * 2;
        if (canWalk(x, z, placements)) return {x, y: PLAYER_START.y, z};
      }
    }
    // The room props cannot cover the whole room, but keep malformed saved
    // layouts from trapping the player if the local spawn area is crowded.
    let best = null, nearest = Infinity;
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const x = minX + column * step, z = minZ + row * step;
      const distance = Math.hypot(x - PLAYER_START.x, z - PLAYER_START.z);
      if (distance < nearest && canWalk(x, z, placements)) {best = {x, y: PLAYER_START.y, z};nearest = distance;}
    }
    return best || {...PLAYER_START};
  }

  function stepRoomPlayer(position, input, delta, placements = []) {
    const start = finite(position?.x) && finite(position?.z) && canWalk(position.x, position.z, placements) ? position : getPlayerStart(placements);
    const ix = finite(input?.x) ? input.x : 0, iz = finite(input?.z) ? input.z : 0;
    const length = Math.hypot(ix, iz), dt = clamp(finite(delta) ? delta : 0, 0, .05);
    if (length < .04 || !dt) return {x: start.x, z: start.z, moving: false};
    const distance = Math.min(1, length) * PLAYER_SPEED * dt;
    const count = Math.max(1, Math.ceil(distance / .06));
    const dx = ix / length * distance / count, dz = iz / length * distance / count;
    let x = start.x, z = start.z;
    for (let i = 0; i < count; i++) {
      if (canWalk(x + dx, z, placements)) x += dx;
      if (canWalk(x, z + dz, placements)) z += dz;
    }
    return {x, z, moving: Math.hypot(x - start.x, z - start.z) > .00001};
  }

  /** Returns a level upward support patch, never a wall or a narrow ledge. */
  function getRoomSurface(x, z, {radius = .15, maxY = ROOM_FLOOR_Y + 1.12, flatness = .045} = {}) {
    if (!finite(x) || !finite(z)) return null;
    radius = clamp(finite(radius) ? radius : .15, .025, .7);
    maxY = finite(maxY) ? maxY : ROOM_FLOOR_Y + 1.12;
    const centerColumn = Math.round((x - minX) / step), centerRow = Math.round((z - minZ) / step);
    if (centerColumn < 0 || centerRow < 0 || centerColumn >= columns || centerRow >= rows) return null;
    const reach = Math.ceil((radius + step * .71) / step);
    let low = Infinity, high = -Infinity, count = 0;
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (Math.hypot(dx * step, dz * step) > radius + step * .71) continue;
        const column = centerColumn + dx, row = centerRow + dz;
        if (column < 0 || row < 0 || column >= columns || row >= rows) return null;
        const value = heights[row * columns + column];
        if (!finite(value) || value > maxY) return null;
        low = Math.min(low, value);high = Math.max(high, value);count++;
      }
    }
    if (!count || high - low > flatness) return null;
    return {x, y: high + .008, z, kind: Math.abs(high - ROOM_FLOOR_Y) < .06 ? 'floor' : 'surface', supportY: high};
  }

  function snapRoomPoint(x, z, options = {}) {
    const direct = getRoomSurface(x, z, options);
    if (direct) return [direct.x, direct.y, direct.z];
    if (!finite(x) || !finite(z)) return null;
    // A small correction accommodates grid edges while keeping dragging local.
    for (let ring = 1; ring <= 3; ring++) {
      const distance = ring * step;
      for (let i = 0; i < 16; i++) {
        const angle = i / 16 * Math.PI * 2;
        const surface = getRoomSurface(x + Math.cos(angle) * distance, z + Math.sin(angle) * distance, options);
        if (surface) return [surface.x, surface.y, surface.z];
      }
    }
    return null;
  }

  /** Accepts a Three Ray or an equivalent {origin:{x,y,z}, direction:{x,y,z}}. */
  function pickRoomSurface(ray, options = {}) {
    const origin = pointValues(ray?.origin), direction = pointValues(ray?.direction);
    if (![origin.x, origin.y, origin.z, direction.x, direction.y, direction.z].every(finite) || direction.y >= -.00001) return null;
    let nearest = Infinity, result = null;
    for (const level of surfaceData.levels) {
      const distance = (level - origin.y) / direction.y;
      if (distance < 0 || distance > nearest) continue;
      const x = origin.x + direction.x * distance, z = origin.z + direction.z * distance;
      const surface = getRoomSurface(x, z, options);
      if (!surface || Math.abs(surface.supportY - level) > .035) continue;
      const refinedDistance = (surface.y - origin.y) / direction.y;
      if (refinedDistance < 0 || refinedDistance >= nearest) continue;
      const rx = origin.x + direction.x * refinedDistance, rz = origin.z + direction.z * refinedDistance;
      const refined = getRoomSurface(rx, rz, options);
      if (!refined || Math.abs(refined.y - surface.y) > .035) continue;
      nearest = refinedDistance;result = [refined.x, refined.y, refined.z];
    }
    if (!result) return null;
    // Reject rays which pass through a higher room column before reaching the
    // support patch. A rejected narrow ledge must not reveal hidden floor behind it.
    const count = clamp(Math.ceil(nearest * Math.max(Math.abs(direction.x), Math.abs(direction.z)) / (step * .45)), 1, 1024);
    for (let i = 0; i < count; i++) {
      const t = nearest * i / count;
      const x = origin.x + direction.x * t, z = origin.z + direction.z * t;
      const column = Math.round((x - minX) / step), row = Math.round((z - minZ) / step);
      if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
      const height = heights[row * columns + column];
      if (finite(height) && origin.y + direction.y * t < height - .04) return null;
    }
    return result;
  }

  const definitions = version === 10 ? [
    {id: 'seed-squad', asset: 'discovery-groceries-v2', label: 'Groceries', width: .72, position: [-2.15, ROOM_FLOOR_Y, 3.3], rotationY: 0},
    {id: 'smarttester', asset: 'discovery-smarttester-v2', label: 'Recorder', width: .52, position: [0, 1.12, -.4], rotationY: 0},
    {id: 'h3-otome', asset: 'discovery-h3-v2', label: 'Otome notebook', width: .6, position: [0, 1.12, -2.1], rotationY: 0},
    {id: 'games-computer', asset: 'discovery-computer-v2', label: 'Games computer', width: 1.1038849354, position: [3.2, 1.23, 4], rotationY: 0},
    {id: 'a-bot-can-do-better', asset: 'discovery-bot-v3', label: 'Specials chalkboard', width: 1.1, position: [3.05, ROOM_FLOOR_Y, -3.9], rotationY: 0, modelOffset: [-.1200942993, 0, 0]},
  ] : [
    {id: 'seed-squad', asset: 'discovery-groceries-v2', label: 'Groceries', width: .72, position: [-2.25, ROOM_FLOOR_Y, 3.4], rotationY: 0},
    {id: 'smarttester', asset: 'discovery-smarttester-v2', label: 'Review camera', width: .52, position: [.55, 1.14, -1.15], rotationY: 0},
    {id: 'h3-otome', asset: 'discovery-h3-v2', label: 'Otome notebook', width: .6, position: [.55, 1.162, -2.2], rotationY: 0},
    {id: 'toad-defense', asset: 'discovery-toad-v2', label: 'Frog tea pets', width: .42, position: [.55, 1.14, 1.5], rotationY: 0},
    {id: 'games-computer', asset: 'discovery-computer-v2', label: 'Games computer', width: 1.1038849354, position: [2.15, 1.131, 4.25], rotationY: 0},
    {id: 'a-bot-can-do-better', asset: 'discovery-bot-v3', label: 'Specials chalkboard', width: 1.1, position: [3.25, ROOM_FLOOR_Y, -3.7], rotationY: 0, modelOffset: [-.1200942993, 0, 0]},
  ];

  // Published positions are separate from asset definitions. Missing or malformed
  // entries fall back to the original room layout; browser-saved edits still win.
  const publishedLayout = new Map((version === 10 && layoutV10?.version === 1 && Array.isArray(layoutV10.items) ? layoutV10.items : [])
    .filter(item => item && typeof item.id === 'string')
    .map(item => [item.id, item]));
  const ROOM_ITEMS = Object.freeze(definitions.map(item => {
    const published = publishedLayout.get(item.id);
    const validPosition = Array.isArray(published?.position) && published.position.length === 3 && published.position.every(finite);
    const options = {radius: item.width * .3};
    const publishedPosition = validPosition ? snapRoomPoint(published.position[0], published.position[2], options) : null;
    const position = publishedPosition || snapRoomPoint(item.position[0], item.position[2], options) || [...item.position];
    const rotationY = finite(published?.rotationY)
      ? ((published.rotationY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) : item.rotationY;
    return Object.freeze({...item, rotationY, position: Object.freeze(position)});
  }));
  const DEFAULT_PROP_PLACEMENTS = ROOM_ITEMS;

  function snapPropPosition(id, point, options = {}) {
    const item = ROOM_ITEMS.find(value => value.id === id);
    if (!item) return null;
    const value = pointValues(point);
    return snapRoomPoint(value.x, value.z, {radius: item.width * .3, ...options});
  }

  /** Ignore unknown IDs/assets and restore defaults for invalid saved positions. */
  function sanitizeRoomPlacements(saved) {
    const values = Array.isArray(saved) ? saved : saved && typeof saved === 'object'
      ? Object.entries(saved).map(([id, value]) => Array.isArray(value) ? {id, position: value} : {...value, id}) : [];
    const byId = new Map(values.filter(value => value && typeof value.id === 'string').map(value => [value.id, value]));
    return ROOM_ITEMS.map(item => {
      const previous = byId.get(item.id), point = pointValues(previous?.position);
      const position = snapPropPosition(item.id, point) || [...item.position];
      const angle = finite(previous?.rotationY) ? ((previous.rotationY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) : item.rotationY;
      return {...item, position, rotationY: angle};
    });
  }
return Object.freeze({ROOM_FLOOR_Y, ROOM_BOUNDS, CAPYBARA_HEIGHT, CHARACTER_HEIGHT, PLAYER_RADIUS, PLAYER_SPEED, PLAYER_START, START_POSITION, ROOM_ITEMS, DEFAULT_PROP_PLACEMENTS, canWalk, getPlayerStart, stepRoomPlayer, getRoomSurface, snapRoomPoint, pickRoomSurface, snapPropPosition, sanitizeRoomPlacements});
}

const placements = Object.freeze({7: createRoomPlacement(surfaceV7, 7), 10: createRoomPlacement(surfaceV10, 10)});

/** V10 is the current room; V7 remains available without migrating its saved layout. */
export function getRoomPlacement(version = 10) {
  return placements[Number(version) === 7 ? 7 : 10];
}

// Preserve the historical exports for V7 consumers and saved-layout checks.
export const {ROOM_FLOOR_Y, ROOM_BOUNDS, CAPYBARA_HEIGHT, CHARACTER_HEIGHT, PLAYER_RADIUS, PLAYER_SPEED, PLAYER_START, START_POSITION, ROOM_ITEMS, DEFAULT_PROP_PLACEMENTS, canWalk, getPlayerStart, stepRoomPlayer, getRoomSurface, snapRoomPoint, pickRoomSurface, snapPropPosition, sanitizeRoomPlacements} = placements[7];
