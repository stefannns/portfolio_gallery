export const BAR_LAYOUT = {
  roomWidth: 14.5,
  roomRotation: -Math.PI / 2,
  roomOffsetY: -1.78180024993,
  groundY: 0,
  barWidth: 4.8,
  barRotation: 0,
  barPosition: [0, 0, -1.1],
  stoolHeight: 1.05,
  viewHeight: 18.4,
  cameraOffset: [3, 17, 12],
  playerBounds: {minX: -6.45, maxX: 5.4, minZ: -4.35, maxZ: 6.3},
  barObstacle: {minX: -2.4, maxX: 2.4, minZ: -2.662, maxZ: .462},
  interactionRadius: 2,
  stations: [
    {id: 'seed-squad', asset: 'discovery-groceries-v2', label: 'Groceries', position: [-1.5, .02, 1.25], width: 1.45, obstacleRadius: .62, rotationY: -Math.PI / 2},
    {id: 'h3-otome', asset: 'discovery-h3-v2', label: 'Pocket storybook', position: [0, 2.27, -.4], width: 1.15, rotationY: -Math.PI / 2},
    {id: 'smarttester', asset: 'discovery-smarttester-v2', label: 'Review camera', position: [1.55, 2.27, -.4], width: 1.2, rotationY: -Math.PI / 2},
    {id: 'recurve', asset: 'discovery-recurve-v2', label: 'Chipped teacup', position: [-4.25, 1.05, .8], width: 1.05, support: true, rotationY: -Math.PI / 2},
    {id: 'assassin', asset: 'discovery-assassin-v2', label: 'Cassette player', position: [-4.25, 1.05, 3.3], width: 1.1, support: true, rotationY: -Math.PI / 2},
    {id: 'niflheim', asset: 'discovery-niflheim-v2', label: 'Toy car & keys', position: [0, 1.05, 3.65], width: 1.25, support: true, rotationY: -Math.PI / 2},
    {id: 'toad-defense', asset: 'discovery-toad-v2', label: 'Frog tea pets', position: [4.25, 1.05, 3.3], width: 1.1, support: true, rotationY: -Math.PI / 2},
    {id: 'a-bot-can-do-better', asset: 'discovery-bot-v2', label: 'Specials chalkboard', position: [4.45, 0, .55], width: 1.35, rotationY: -Math.PI / 2},
  ],
};

export const PLAYER_SPEED = 4.8;
export const WALK_TIME_SCALE = 1.8;
export const START_POSITION = {x: 0, z: 1.6};
