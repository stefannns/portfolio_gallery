// Looks up the staff orb's position in a clip at a given playback time.

/** track: [[seconds, x, y], ...] in time order. Returns { x, y } or null for an empty track. */
export function orbAt(track, time) {
  if (!track?.length) return null;
  if (time <= track[0][0]) return { x: track[0][1], y: track[0][2] };
  for (let i = 1; i < track.length; i += 1) {
    if (time <= track[i][0]) {
      const [t0, x0, y0] = track[i - 1], [t1, x1, y1] = track[i];
      const f = (time - t0) / (t1 - t0);
      return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f };
    }
  }
  const last = track[track.length - 1];
  return { x: last[1], y: last[2] };
}
