import {AnimationClip, PropertyBinding} from 'three';

export const CAPYBARA_BODY_WALK_RATE = 1.8;
export const CAPYBARA_LEG_WALK_RATE = 2.9;

const legBone = /^(L|R)_(Thigh|Calf|Knee|Foot|Toe)/;

/** Give the legs their own clock; each animated property belongs to one action. */
export function splitCapybaraWalk(clip) {
  const body = [], legs = [];
  for (const track of clip.tracks) {
    const binding = PropertyBinding.parseTrackName(track.name);
    (legBone.test(binding.nodeName) ? legs : body).push(track);
  }
  if (!legs.length || !body.length) throw new Error('The capybara walk needs both body and leg tracks.');
  return {
    body: new AnimationClip(`${clip.name}-body`, clip.duration, body, clip.blendMode),
    legs: new AnimationClip(`${clip.name}-quicker-steps`, clip.duration, legs, clip.blendMode),
  };
}
