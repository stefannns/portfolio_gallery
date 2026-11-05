/** Read a saved layout and apply only explicitly versioned, targeted relocations. */
export function loadRoomLayout(storageKey, sanitizeRoomPlacements, migrations = [], storage = globalThis.localStorage) {
  let saved = null, completed = [];
  const migrationKey = `${storageKey}-migrations`;
  try {saved = JSON.parse(storage?.getItem(storageKey) || 'null');} catch {}
  try {
    const value = JSON.parse(storage?.getItem(migrationKey) || '[]');
    if (Array.isArray(value)) completed = value.filter(id => typeof id === 'string');
  } catch {}
  const savedItems = saved?.version >= 2 ? saved.items : saved?.items?.filter(item => item.id !== 'h3-otome');
  let items = sanitizeRoomPlacements(savedItems);
  const pending = (Array.isArray(migrations) ? migrations : []).filter(migration =>
    migration && typeof migration.id === 'string' && migration.id && !completed.includes(migration.id) && Array.isArray(migration.items));
  if (!pending.length) return items;
  // With no saved layout the manifest already provides the new default.
  // Still mark the revision so future user edits remain their own.
  if (savedItems) {
    for (const migration of pending) {
      const changes = new Map(migration.items.filter(item => item && typeof item.id === 'string'
        && Array.isArray(item.position) && item.position.length === 3 && item.position.every(Number.isFinite))
        .map(item => [item.id, item]));
      items = sanitizeRoomPlacements(items.map(item => {
        const patch = changes.get(item.id);
        return patch ? {...item, position: [...patch.position],
          rotationY: Number.isFinite(patch.rotationY) ? patch.rotationY : item.rotationY} : item;
      }));
    }
  }
  // Persist the layout before the marker, so an interrupted write can retry.
  if (persistRoomLayout(storageKey, items, storage)) {
    try {storage.setItem(migrationKey, JSON.stringify([...new Set([...completed, ...pending.map(migration => migration.id)])]));} catch {}
  }
  return items;
}

export function persistRoomLayout(storageKey, items, storage = globalThis.localStorage) {
  try {
    storage.setItem(storageKey, JSON.stringify({version: 2,
      items: items.map(({id, position, rotationY}) => ({id, position, rotationY}))}));
    return true;
  } catch {return false;}
}
