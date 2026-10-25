import React from 'react';
import {RestaurantModel} from './TripoRestaurant.jsx';

const stool = {url: '/models/tripo/restaurant-stool.glb'};

export default function DiscoveryRoom({assets = {}, layout = {}}) {
  const roomWidth = layout.roomWidth ?? 14.5;
  const groundY = layout.groundY ?? .2;
  const stoolHeight = layout.stoolHeight ?? 1.05;

  return <group name="discovery-sushi-room">
    <RestaurantModel
      entry={assets['sushi-room-v3']}
      dimensions={[roomWidth, null, null]}
      position={[0, layout.roomOffsetY ?? 0, 0]}
      rotationY={layout.roomRotation ?? -Math.PI / 2}
      uniform
    />
    <RestaurantModel
      entry={assets['sushi-prep-bar-v3']}
      dimensions={[layout.barWidth ?? 6.6, null, null]}
      position={layout.barPosition ?? [0, groundY, -1.5]}
      rotationY={layout.barRotation ?? -Math.PI / 2}
      uniform
    />
    {(layout.stations ?? []).filter(station => station.support).map(station => <RestaurantModel
      key={`support-${station.id}`}
      entry={stool}
      dimensions={[null, stoolHeight, null]}
      position={[station.position[0], groundY, station.position[2]]}
      rotationY={station.rotationY ?? -Math.PI / 2}
      uniform
    />)}
  </group>;
}
