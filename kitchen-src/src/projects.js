const reels = 'https://recrjycnqclmqvbcryya.supabase.co/storage/v1/object/public/reels';

export const projects = [
  {
    id: 'seed-squad', title: 'Seed Squad', type: 'Garden defense', collection: 'games',
    image: '/images/seed-squad.webp', color: '#b6d2a0', recent: true,
    url: 'https://farmtd.vercel.app/', embedUrl: 'https://farmtd.vercel.app/',
    description: 'Plant seeds that grow a steady stream of tiny fighters. Build a squad, arrange your garden, and defend the farmhouse across Sunny Orchard and Coral Cove.',
    design: 'Garden space is limited, so every seed is a trade-off. Mix fighters, tanks, ranged attackers and support, then shape your defense with growth timing, branching upgrades and wave augments.',
    processTitle: 'Character pipeline',
    process: 'I built a character-generation pipeline that produces a new character in under 4 minutes. It connects AI-generated artwork and animation with transparent sprite sheets and consistent sizing for Phaser, helping me expand the cast while keeping its visual style consistent.',
    galleryIntro: 'A look at how I build levels, develop the cast, and shape the game’s strategic choices.',
    gallery: [
      {
        id: 'level-editor', title: 'Level editor',
        src: '/images/projects/seed-squad/level-editor.jpg', width: 1707, height: 960,
        alt: 'Seed Squad level editor showing a garden map, terrain placement tools, and a selected two-by-two rock with position and size controls.',
        caption: 'I built a map editor to arrange clearable grass, permanent rocks and special soil, then check how players can open space for their garden.',
      },
      {
        id: 'characters', title: 'Character sets',
        src: '/images/projects/seed-squad/character-library.jpg', width: 1707, height: 960,
        alt: 'The 14-seed character roster beside Orange’s attack animation preview, frame controls, and gameplay stats in the content library.',
        caption: 'Portraits, planted forms and combat animations share one character library, with playback and frame-by-frame checks to keep each kit consistent.',
      },
      {
        id: 'world-layouts', title: 'World layouts',
        src: '/images/projects/seed-squad/world-layouts.jpg', width: 1707, height: 960,
        alt: 'Five Coral Cove level layouts side by side, showing two lawns, winding enemy routes, rocks, grass and special soil.',
        caption: 'Coral Cove’s five maps use two lawns, permanent obstacles and special soil to vary expansion choices around a winding enemy route.',
      },
      {
        id: 'waves', title: 'Wave planning',
        src: '/images/projects/seed-squad/wave-planning.jpg', width: 1707, height: 960,
        alt: 'Sunny Orchard level six planning view with its terrain diagram, starting resources, and all nine authored enemy waves.',
        caption: 'I pair each layout with authored enemy waves, starting resources and terrain bonuses, so the challenge develops through both space and pacing.',
      },
      {
        id: 'upgrades', title: 'Upgrade branches',
        src: '/images/projects/seed-squad/upgrade-branches.jpg', width: 1707, height: 960,
        alt: 'Seed upgrade branches comparing tier-three and tier-four choices for Orange, Durian, Corn, Chili and other characters.',
        caption: 'Two upgrade branches for each seed support different builds, from faster attacks and longer range to team protection and healing.',
      },
    ],
    imagePosition: 'center',
  },
  {
    id: 'h3-otome', title: 'Otome Story Engine (Minimax H3)', type: 'Generative narrative', collection: 'games',
    image: '/images/covers/otome-story-engine-v4.png', color: '#d9b1c3', recent: true,
    video: '/videos/h3-otome-demo.mp4', videoAspectRatio: '1920 / 920',
    workflowEmbedUrl: '/workflows/otome-story-engine.html',
    riftFocus: [.47,.73], riftZoom: 1.12,
    github: 'https://github.com/stefannns/lian-yu-h3',
    description: 'A first-person otome game where your choices shape the story. MiniMax H3 (FastH3), accessed through Reactor AI’s API, generates and streams new story scenes at real-time speed.',
    design: 'The design centers on meaningful choices, narrative pacing, and keeping a character recognizable from scene to scene.',
    processTitle: 'Real-time story scenes',
    process: 'I integrated Reactor AI’s FastH3 API with a scene queue: while one clip plays, the next prepares in the background. Character references and the previous clip’s final frame help maintain continuity.',
  },
  {
    id: 'smarttester', title: 'Smarttester', type: 'AI playtest workspace', collection: 'other',
    image: '/images/projects/smarttester-playtest.png', color: '#9fbedc', recent: true,
    url: 'https://smarttester.vercel.app/',
    previewUrl: 'https://smarttester.vercel.app/how-it-works#workflow',
    workflowEmbedUrl: '/workflows/smarttester-api-map.html',
    workflowTitle: 'Full API map',
    workflowPresentation: false,
    workflowLinkLabel: 'Open full map ↗',
    previewImage: '/images/projects/smarttester-playtest.png',
    previewAspectRatio: '1856 / 1606',
    logo: '/images/brands/smarttester-mark.png',
    previewLabel: 'Explore the workflow',
    previewAlt: 'Smarttester playtest review with gameplay, timeline markers, transcript and an evidence-linked analysis report',
    workflow: 'Record → Add context → Analyze → Review',
    description: 'I built a local recording app and an online analysis app for playtests. Together, they turn gameplay, commentary and inputs into evidence-linked findings.',
    design: 'The local recorder captures footage, commentary and inputs, then uploads them to the online analysis and review workspace. A shared timeline and clickable evidence let designers inspect what happened before deciding what to change.',
    processTitle: 'AI workflow',
    process: 'Local code prepares scenes and short audio windows. Gemini transcribes, reviews sampled video, can request closer visual detail, then consolidates the report. Artifact IDs, source ranges and timestamps are checked before findings are saved.',
  },
  {
    id: 'recurve', title: 'Recurve', type: 'Reverse-time puzzles', collection: 'games',
    image: '/images/recurve.webp', color: '#a2c6b7', video: `${reels}/recurve.mp4`,
    description: 'A puzzle game about reverse-time weapons. Arrows repair whatever they pass through on the way back.',
    design: 'Arrows make the flight path readable. Puzzles ask the player to use that reversing trajectory to repair the environment and move forward.',
    process: 'A mechanic-led exploration inspired by Tenet, developed through different uses of the same reversing shot.',
  },
  {
    id: 'assassin', title: 'Assassin’s Weakness is Love', type: 'Rhythm game', collection: 'games',
    image: '/images/assassin.webp', color: '#c2b4e1', video: `${reels}/assassin-l1.mp4`,
    description: 'An assassin keeps getting distracted by his feelings. Run, jump, and duck to slash hearts on the beat, then switch perspectives to pick them off with kunai.',
    design: 'Two modes share one musical rhythm, moving between third-person running and first-person ranged attacks.',
    process: 'The experience brings together level construction, musical timing, and readable feedback.',
    moreVideos: [{label:'Level 1',url:`${reels}/assassin-l1.mp4`},{label:'Level 2',url:`${reels}/assassin-l2.mp4`}],
  },
  {
    id: 'niflheim', title: 'Niflheim Highway', type: 'Cinematic racing', collection: 'games',
    image: '/images/niflheim.webp', color: '#aab9df', video: `${reels}/niflheim.mp4`,
    description: 'A highway keeps shifting into Niflheim’s ruined realm. React to the changing road while undead warriors pursue from behind.',
    design: 'Atmosphere and reaction time meet in the transition between two versions of the same environment.',
    process: 'An interactive adaptation of the Dragon Raja scene in which a Maybach escapes Niflheim.',
  },
  {
    id: 'toad-defense', title: 'Toad Defense Tactics', type: 'Defense roguelike', collection: 'games',
    image: '/images/toad-defense.webp', color: '#b3c989', video: `${reels}/tdt_video.mp4`,
    description: 'Deploy, merge, and evolve frog towers. Build a defense, draft buffs, and adapt to waves of enemies.',
    design: 'Distinct tower roles, a rerollable shop, merging, and random buffs connect combat choices to progression.',
    process: 'A solo project exploring a complete tower-defense system, character attacks, traits, and authored enemy waves.',
  },
  {
    id: 'a-bot-can-do-better', title: 'A Bot Can Do Better', type: 'AI comedy game', collection: 'games',
    image: '/images/a-bot-can-do-better.webp', color: '#d7b995', video: `${reels}/drawguess.mp4`,
    description: 'Draw a prompt against the clock. Then let an AI bot deliver its harsh, hopefully hilarious verdict.',
    design: 'A short drawing challenge sets up the anticipation and surprise of the bot’s response.',
    process: 'Gemini interprets the drawing and generates the roast. The player’s own work becomes the material for the joke.',
  },
];

// The computer has an editorial order independent of the room and older galleries.
export const computerProjectIds = [
  'seed-squad', 'smarttester', 'h3-otome', 'a-bot-can-do-better',
  'recurve', 'assassin', 'niflheim', 'toad-defense',
];

// Display order is also the keyboard/swipe order. Recent work opens nearest.
export const homeSlots = {
  'seed-squad': 0, 'h3-otome': -1, 'smarttester': 1,
  'recurve': -2, 'assassin': 2, 'niflheim': -3,
  'toad-defense': 3, 'a-bot-can-do-better': 4,
};
