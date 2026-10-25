const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.z);

/** Check the whole segment, including narrow clearance boundaries between grid cells. */
export function canTraverseRoomSegment(from, to, canWalk, placements = [], interval = .035) {
  if (!finitePoint(from) || !finitePoint(to)) return false;
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const samples = Math.max(1, Math.ceil(distance / interval));
  for (let sample = 0; sample <= samples; sample++) {
    const fraction = sample / samples;
    if (!canWalk(from.x + (to.x - from.x) * fraction, from.z + (to.z - from.z) * fraction, placements)) return false;
  }
  return true;
}

class MinHeap {
  values = [];
  push(value) {
    const values = this.values;
    let index = values.length;
    values.push(value);
    while (index) {
      const parent = (index - 1) >> 1;
      if (values[parent].score <= value.score) break;
      values[index] = values[parent];index = parent;
    }
    values[index] = value;
  }
  pop() {
    const values = this.values, first = values[0], last = values.pop();
    if (values.length) {
      let index = 0;
      while (index * 2 + 1 < values.length) {
        const left = index * 2 + 1, right = left + 1;
        const child = right < values.length && values[right].score < values[left].score ? right : left;
        if (values[child].score >= last.score) break;
        values[index] = values[child];index = child;
      }
      values[index] = last;
    }
    return first;
  }
}

/** Plan against the same padded room mask and floor props used by keyboard movement. */
export function createRoomNavigator({bounds, canWalk, step = .12}) {
  const columns = Math.floor((bounds.maxX - bounds.minX) / step) + 1;
  const rows = Math.floor((bounds.maxZ - bounds.minZ) / step) + 1;
  const length = columns * rows;
  const pointFor = index => ({x: bounds.minX + index % columns * step, z: bounds.minZ + Math.floor(index / columns) * step});

  return {
    findPath(start, requested, placements = []) {
      if (!finitePoint(start) || !finitePoint(requested) || !canWalk(start.x, start.z, placements)) return [];
      if (requested.x < bounds.minX || requested.x > bounds.maxX || requested.z < bounds.minZ || requested.z > bounds.maxZ) return [];
      const traverse = (a, b) => canTraverseRoomSegment(a, b, canWalk, placements);
      if (canWalk(requested.x, requested.z, placements) && traverse(start, requested)) return [{...requested}];
      const walkable = new Int8Array(length);
      const allowed = index => {
        if (!walkable[index]) {const point = pointFor(index);walkable[index] = canWalk(point.x, point.z, placements) ? 1 : -1;}
        return walkable[index] === 1;
      };
      const nearestNode = (point, radius, requireConnection) => {
        const centerX = Math.round((point.x - bounds.minX) / step), centerZ = Math.round((point.z - bounds.minZ) / step);
        const reach = Math.ceil(radius / step);
        let nearest = -1, nearestDistance = Infinity;
        for (let z = Math.max(0, centerZ - reach); z <= Math.min(rows - 1, centerZ + reach); z++) {
          for (let x = Math.max(0, centerX - reach); x <= Math.min(columns - 1, centerX + reach); x++) {
            const index = z * columns + x, candidate = pointFor(index);
            const distance = Math.hypot(candidate.x - point.x, candidate.z - point.z);
            if (distance > radius || distance >= nearestDistance || !allowed(index)) continue;
            if (requireConnection && !traverse(point, candidate)) continue;
            nearest = index;nearestDistance = distance;
          }
        }
        return nearest;
      };
      const startIndex = nearestNode(start, step * 2, true);
      // A click just inside the avatar clearance margin lands on the nearest safe floor.
      const goalIndex = nearestNode(requested, .5, canWalk(requested.x, requested.z, placements));
      if (startIndex < 0 || goalIndex < 0) return [];
      const goal = pointFor(goalIndex);
      const cost = new Float64Array(length);cost.fill(Infinity);
      const parent = new Int32Array(length);parent.fill(-1);
      const closed = new Uint8Array(length);
      const heap = new MinHeap();
      const estimate = index => {const point = pointFor(index);return Math.hypot(point.x - goal.x, point.z - goal.z);};
      cost[startIndex] = 0;heap.push({index: startIndex, score: estimate(startIndex)});
      while (heap.values.length) {
        const {index} = heap.pop();
        if (closed[index]) continue;
        if (index === goalIndex) {
          const route = [];
          for (let current = goalIndex; current !== -1; current = parent[current]) route.push(pointFor(current));
          route.reverse();
          if (canWalk(requested.x, requested.z, placements) && traverse(goal, requested)) route.push({...requested});
          const simplified = [];
          let anchor = start, cursor = 0;
          while (cursor < route.length) {
            let furthest = cursor;
            for (let candidate = cursor + 1; candidate < route.length; candidate++) {
              if (traverse(anchor, route[candidate])) furthest = candidate;
            }
            const next = route[furthest];
            if (Math.hypot(next.x - anchor.x, next.z - anchor.z) > .015) {simplified.push(next);anchor = next;}
            cursor = furthest + 1;
          }
          return simplified;
        }
        closed[index] = 1;
        const x = index % columns, z = Math.floor(index / columns), point = pointFor(index);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dz) || x + dx < 0 || x + dx >= columns || z + dz < 0 || z + dz >= rows) continue;
          const neighbor = (z + dz) * columns + x + dx;
          if (dx && dz && (!allowed(z * columns + x + dx) || !allowed((z + dz) * columns + x))) continue;
          if (closed[neighbor] || !allowed(neighbor)) continue;
          const nextCost = cost[index] + Math.hypot(dx, dz) * step;
          if (nextCost >= cost[neighbor] || !traverse(point, pointFor(neighbor))) continue;
          cost[neighbor] = nextCost;parent[neighbor] = index;
          heap.push({index: neighbor, score: nextCost + estimate(neighbor)});
        }
      }
      return [];
    },
  };
}
