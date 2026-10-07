/* Local, user-directed reference exceptions. Not shared reviewer comments.
 * Evidence records human requests, not an independently verified comparison.
 * A scope exception does not mark a game or its feedback as finished.
 */
(function () {
  'use strict';
  const decisions = {
    playable2_20260927020828_5pmrhn: {
      scope: 'Level selection only',
      note: 'Four levels only, ordered from the old levels 4, 6, 1 and 2.',
      evidence: 'User requested four levels, moving old 4 and 6 first and old 1 and 2 last.'
    },
    playable2_20260927020828_iuyca5: {
      scope: 'Round target only',
      note: '50 dumplings in 15 seconds instead of 100.',
      evidence: 'User: make it 50 in 15 seconds.'
    },
    playable2_20260927020828_9vxaxo: {
      scope: 'Art direction and difficulty',
      note: 'Pixel-art sky islands and ladder, with faster growth, wider gaps and smaller platforms.',
      evidence: 'User requested pixel style throughout, then repeatedly requested harder gameplay.'
    },
    playable2_20260927020828_bnkh36: {
      scope: 'Art direction and food variety',
      note: 'Realistic food and fridge artwork, with more food types.',
      evidence: 'User: add some more food types and redo the style, all to realistic; redo the cover fridge image too.'
    },
    playable2_20260927020825_hjn7q5: {
      scope: 'Custom interface, rendering and playback',
      note: 'Redesigned Replay/Reset UI; shiny, shadow-free lines replay together at a slower pace.',
      evidence: 'User explicitly requested UI/UX design instead of screenshot styling, simultaneous playback, more shine, no shadow and slower playback.'
    },
    playable2_20260927020825_lnwh1h: {
      scope: 'Custom levels and target',
      note: 'Three custom obstacle layouts with a 100-ball target.',
      evidence: 'User requested custom levels, later changed the target to 100 balls and said 17 looks fine.'
    },
    playable2_20260927021136_x3i163: {
      scope: 'Spawn behavior and cube sizes',
      note: 'No automatic spawning; tap blank space to create varied-size cubes.',
      evidence: 'User: no automatics cubes until tapped blank places on the screen.'
    },
    playable2_20260928024805_31g1lw: {
      scope: 'Bounce physics and spawning',
      note: 'Random ball spawns and slower, endless bouncing without momentum loss.',
      evidence: 'User requested infinite momentum, random spawn locations and slower bounce speed.'
    },
    playable2_20260928030642_uthymy: {
      scope: 'Single-level potato challenge',
      note: 'One potato level; peel 100% within five peels to win.',
      evidence: 'User requested one potato level, then changed six peels to five and reduced peeler size by 10%.'
    },
    playable2_20261001225611_0e3wo5: {
      scope: 'Cat assets and free movement',
      note: 'Fruit-cat characters, square food that becomes cats, and free joystick steering instead of four-direction movement.',
      evidence: 'User supplied eight cat memes, requested joystick movement and later renamed meme to cats.'
    },
    playable2_20261001225611_9its9h: {
      scope: 'Combat tuning only',
      note: 'Slower continuous blade rotation, roughly five-hit enemies, and no KO limit.',
      evidence: 'User requested continuous spin, roughly five enemy hits, no KO limit, and later slower spin.'
    },
    playable2_20261001225836_jx30zt: {
      scope: 'Custom random-drift temperature balancing',
      note: 'Custom temperature game: random hot/cold drift, balanced by tapping chili or ice cream instead of the original balance mechanic.',
      evidence: 'Latest user instruction: it should keep drifting randomly. player needs to balance it. write it in dev notes on the platform too, since it is different from original. This supersedes the previous static-between-taps implementation.'
    },
    playable2_20261001225842_2d0kul: {
      scope: 'Mirror count and cooling time',
      note: 'Four mirrored heat sources plus the player, smaller radius, and 1.5-second cooling.',
      evidence: 'User requested four other mirrored balls, smaller radius and 1.5-second fading.'
    },
    playable2_20261001230052_xrken6b: {
      scope: 'Separate custom variant — 57b only',
      note: '57b is a separate top-down variant with gray ground, low radial grass, layered flowers, and simplified controls; No.57 is unchanged.',
      evidence: 'User requested preserving No.57 and adding 57b, iterated its custom visuals, and explicitly cited 57b as a game that need not fully match the original.'
    },
    playable2_20261001230147_id39lj: {
      scope: 'Audio trigger only',
      note: 'Sound only while dragging the aurora, rather than continuous background audio.',
      evidence: 'User: for the sound make it only appear on dragging of the aurora.'
    },
    playable2_20261001230222_8qptsc: {
      scope: 'Simplified waves and interval sound',
      note: 'Simpler wave strands with translucent layers; smooth tones play at intervals instead of a continuous hum.',
      evidence: 'User requested fewer layered lines, smoother interval-triggered hums, then translucent layers between some strands.'
    },
    playable2_20261001230352_h4uxll: {
      scope: 'Rain ambience only',
      note: 'Added rain ambience to the moving-cloud and lightning scene.',
      evidence: 'User: for 66 add some rain sounds.'
    }
  };
  window.PLAYABLE_DEVELOPER_NOTES = decisions;
  const host = document.querySelector('.preview');
  if (!host) return;
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const panel = make('section', 'developer-notes');
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'developer-notes-heading');
  const heading = make('h3', 'developer-notes-heading', 'Developer notes');
  heading.id = 'developer-notes-heading';
  const body = make('p', 'developer-notes-body');
  panel.append(heading, body);
  host.append(panel);
  window.PlayableDeveloperNotes = {
    selectGame(game) {
      const decision = Object.prototype.hasOwnProperty.call(decisions, game?.taskId) ? decisions[game.taskId] : null;
      panel.hidden = !decision;
      body.textContent = decision?.note || '';
      panel.dataset.taskId = decision ? game.taskId : '';
    }
  };
}());
