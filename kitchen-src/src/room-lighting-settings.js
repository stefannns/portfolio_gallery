export const ROOM_LIGHTING_STORAGE_KEY = 'stefan-kitchen-lighting-preview-v1';
export const ROOM_LIGHTING_DEFAULTS = Object.freeze({
  exposure: .82,
  warmth: .43,
  fill: 1.2,
  shadowStrength: .96,
  saturation: .96,
  background: '#f4f3e7',
});

const ranges = {exposure: [.5, 1.35], warmth: [0, 1], fill: [.3, 1.7], shadowStrength: [0, 1], saturation: [.6, 1.4]};
const previewStorage = () => {try {return globalThis.localStorage;} catch {return null;}};

/** Keep persisted preview values finite, in range and safe for colors/styles. */
export function sanitizeRoomLightingSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {...ROOM_LIGHTING_DEFAULTS};
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (Number.isFinite(source[key])) result[key] = Math.round(Math.max(min, Math.min(max, source[key])) * 1000) / 1000;
  }
  if (typeof source.background === 'string' && /^#[0-9a-f]{6}$/i.test(source.background)) result.background = source.background.toLowerCase();
  return result;
}

export function loadRoomLightingSettings(storage = previewStorage()) {
  try {
    const saved = JSON.parse(storage?.getItem(ROOM_LIGHTING_STORAGE_KEY) || 'null');
    return sanitizeRoomLightingSettings(saved?.version === 1 ? saved.settings : null);
  } catch {return {...ROOM_LIGHTING_DEFAULTS};}
}

export function saveRoomLightingSettings(settings, storage = previewStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(ROOM_LIGHTING_STORAGE_KEY, JSON.stringify({version: 1, settings: sanitizeRoomLightingSettings(settings)}));
    return true;
  } catch {return false;}
}
