const reels = 'https://recrjycnqclmqvbcryya.supabase.co/storage/v1/object/public/reels';

export const projects = [
  {
    id: 'dao-arena', title: 'Dao Arena', type: 'First-person talisman survival', collection: 'games',
    image: '/images/projects/dao-arena/gameplay.webp', color: '#91b4aa', recent: true,
    presentation: 'landscape',
    previewAlt: 'A glowing Impact talisman in the foreground of Dao Arena’s lantern-lit palace courtyard, with the gameplay HUD.',
    url: 'https://daoarena.vercel.app/',
    description: 'A browser FPS set in a Daoist palace, built around throwing fulu talismans. Dash and jump through the courtyard, survive enemy waves, and shape your build with new weapons, abilities and augments.',
    design: 'Five talisman weapons cover distinct combat roles: Flow, Cloud Pierce, Petal, Blast and Impact. Raised terraces and connected routes keep movement central, while rewards between waves let the player adapt their loadout.',
    processTitle: 'AI production and development tools',
    process: 'I used AI tools for code and art direction, Tripo for custom enemies and the first-person arm, and Blender to prepare rigs and animation. Dev Studio and Fulu Studio let me tune combat, waves, materials and weapon effects against live previews. The game uses Three.js, TypeScript and Rapier.',
    galleryIntro: 'The custom models, throwing animation, arena layout and tools I built to keep iterating.',
    gallery: [
      {
        "id": "dao-enemies",
        "title": "Enemy characters",
        "caption": "I generated custom enemies with Tripo, then prepared their rigs and animation in Blender. These models show the lantern keeper and the teleporting Red Thread Executioner.",
        "images": [
          {
            "id": "dao-lantern",
            "title": "Lantern keeper",
            "src": "/images/projects/dao-arena/lantern-keeper.webp",
            "width": 1400,
            "height": 1700,
            "presentation": "model",
            "alt": "Tripo-generated lantern keeper in pale robes with jade trim, holding a large red lantern.",
            "caption": "I adjusted the sleeve rig and attached lantern so the prop stayed with the character during animation."
          },
          {
            "id": "dao-executioner",
            "title": "Red Thread Executioner",
            "src": "/images/projects/dao-arena/red-thread-executioner.webp",
            "width": 1400,
            "height": 1700,
            "presentation": "model",
            "alt": "Hooded Red Thread Executioner model with a pale mask, red bindings and a broad execution saber.",
            "caption": "A Tripo-generated melee enemy with a hood, pale mask and execution saber. In the game, it dissolves away and reforms at a marked destination, giving the player a warning before it attacks."
          }
        ]
      },
      {
        "id": "dao-ai-3d-rigging",
        "title": "AI 3D and Rigging",
        "layout": "stacked",
        "caption": "From a Tripo-generated first-person arm to a working talisman throw: I compared hand designs, refined the rig, and timed the fingers, release and recovery.",
        "images": [
          {
            "id": "dao-arm",
            "title": "First-person arm",
            "src": "/images/projects/dao-arena/jade-scholar-arm.webp",
            "width": 1400,
            "height": 1700,
            "presentation": "model",
            "alt": "Generated first-person arm with a dark jade sleeve, cream cuff and open hand.",
            "caption": "I compared generated hand designs before choosing the Jade Scholar sleeve. The arm became part of the throwing rig, with the talisman placed between the fingers and timed to release from the hand."
          },
          {
            "id": "dao-rigging",
            "title": "Throwing rig",
            "src": "/images/projects/dao-arena/hand-rigging.webp",
            "width": 1905,
            "height": 895,
            "alt": "Joint-placement tool showing finger, wrist and forearm anchors on the generated first-person arm.",
            "caption": "I used a joint-placement preview to review the finger, wrist and forearm anchors. The throw needed the fingers to open naturally, release the fulu from the right position, and recover without freezing."
          }
        ]
      },
      {
        "id": "dao-fulu",
        "title": "Five weapon identities",
        "src": "/images/projects/dao-arena/five-fulu.webp",
        "width": 1600,
        "height": 900,
        "alt": "Five fulu designs with distinct purple, blue, green, red and gold energy effects.",
        "caption": "Flow, Cloud Pierce, Petal, Blast and Impact each have a distinct combat role. Generated paper textures are combined with energy strands, trails and particles built in code."
      },
      {
        "id": "dao-layout",
        "title": "Courtyard layout",
        "src": "/images/projects/dao-arena/courtyard-layout.webp",
        "width": 1707,
        "height": 960,
        "alt": "Early palace arena blockout with simple platforms, raised terraces and open movement routes.",
        "caption": "I tested the map with simple blocks before adding the architecture. The courtyard needed room to dash and jump, raised side platforms, and clear routes between different heights."
      },
      {
        "id": "dao-shaders",
        "title": "Shader studies",
        "src": "/images/projects/dao-arena/shader-comparison.webp",
        "width": 1500,
        "height": 1080,
        "alt": "Shader comparison workspace testing rendering treatments on the same palace architecture and enemies.",
        "caption": "I built a comparison scene to test rendering styles on the same buildings and enemies, then chose Ink contours for the world and the player’s hand. Lighting, fog and contrast were tuned for readability."
      },
      {
        "id": "dao-fulu-studio",
        "title": "Fulu Studio",
        "src": "/images/projects/dao-arena/fulu-studio.webp",
        "width": 1440,
        "height": 960,
        "alt": "Early Fulu Studio with a live 3D talisman preview and controls for paper, ink and energy effects.",
        "caption": "An early version of Fulu Studio, a tool I built to tune each weapon’s paper, ink and energy effects against a live 3D preview."
      },
      {
        "id": "dao-waves",
        "title": "Wave editor",
        "src": "/images/projects/dao-arena/wave-editor.webp",
        "width": 1600,
        "height": 798,
        "alt": "Custom Dev Studio wave editor showing enemy composition and progression controls beside the playable arena.",
        "caption": "I built Dev Studio to adjust enemy sets, wave progression, stats, scene placement and visual settings without needing a code change for every tweak. The wave editor keeps the arena visible while I work."
      }
    ],
  },
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
  {
    id: 'skybridge-siege', title: 'Skybridge Siege', type: 'Gesture-controlled spellcasting', collection: 'games',
    image: '/images/projects/skybridge-siege/gameplay.webp', color: '#dfa872', recent: true,
    url: '/skybridge-siege/',
    video: '/videos/skybridge-siege-demo.mp4', videoAspectRatio: '16 / 9',
    previewAlt: 'First-person spellcasting against the Hex Warden on a castle bridge, with hand tracking and a fireball.',
    description: 'A gesture-controlled spellcasting duel against the Hex Warden. Cast fireballs, raise a shield and dodge incoming attacks on a castle bridge.',
    processTitle: 'AI animation',
    process: 'I used MiniMax H3 to create the character and spell animations in Skybridge Siege.',
  },
];

// The computer has an editorial order independent of the room and older galleries.
export const computerProjectIds = [
  'seed-squad', 'smarttester', 'a-bot-can-do-better', 'skybridge-siege', 'h3-otome',
  'recurve', 'assassin', 'niflheim', 'toad-defense',
];

// Dao Arena belongs to the original kitchen; the pond test keeps its own set.
export const originalKitchenProjectIds = [
  'seed-squad', 'smarttester', 'a-bot-can-do-better', 'dao-arena', 'skybridge-siege', 'h3-otome',
  'recurve', 'assassin', 'niflheim', 'toad-defense',
];

// Display order is also the keyboard/swipe order. Recent work opens nearest.
export const homeSlots = {
  'seed-squad': 0, 'h3-otome': -1, 'smarttester': 1,
  'recurve': -2, 'assassin': 2, 'niflheim': -3,
  'toad-defense': 3, 'a-bot-can-do-better': 4,
};
