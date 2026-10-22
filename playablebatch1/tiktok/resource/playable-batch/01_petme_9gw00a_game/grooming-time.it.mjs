// Five seconds of moving contact, not a pointer hold or pointer-event count.
export const GROOMING_DURATION_MS = 5000;
export function movingContactMs({distance, elapsedMs, scale = 1, onPet = true}) {
  if (!onPet || !Number.isFinite(distance) || !Number.isFinite(elapsedMs) || distance < .5 * scale || elapsedMs <= 0) return 0;
  // Long pauses/jumps cannot be credited as continuous grooming. Very slow
  // movement is credited proportionally so pointer-event frequency is irrelevant.
  return Math.min(80, elapsedMs, distance / (70 * Math.max(.1, scale)) * 1000);
}
