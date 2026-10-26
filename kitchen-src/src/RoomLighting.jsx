import React, {useLayoutEffect, useMemo} from 'react';
import {useThree} from '@react-three/fiber';
import {Color} from 'three';

// At the neutral control position these are the existing kitchen light colors.
const colors = {
  sky: ['#fff5e4', '#dbe9ff', '#ffe4bc'],
  ground: ['#aab6ac', '#9cacc4', '#c0aa85'],
  key: ['#fff3dc', '#c9e3ff', '#ffcf91'],
  rim: ['#e8f1f3', '#cce0ff', '#ffe5bf'],
};

export default function RoomLighting({settings, compact}) {
  const {gl, invalidate} = useThree();
  const palette = useMemo(() => {
    const offset = settings.warmth - .55;
    const amount = Math.min(1, Math.abs(offset) / (offset < 0 ? .55 : .45)) * .6;
    return Object.fromEntries(Object.entries(colors).map(([name, [base, cool, warm]]) =>
      [name, new Color(base).lerp(new Color(offset < 0 ? cool : warm), amount)]));
  }, [settings.warmth]);

  useLayoutEffect(() => {
    gl.toneMappingExposure = settings.exposure;
    invalidate();
  }, [gl, invalidate, settings.exposure]);

  return <>
    <color attach="background" args={[settings.background]}/>
    <ambientLight intensity={.7 * settings.fill}/>
    <hemisphereLight args={[palette.sky, palette.ground, 1.5 * settings.fill]}/>
    <directionalLight castShadow position={[-7, 16, 10]} intensity={2.5} color={palette.key}
      shadow-intensity={settings.shadowStrength} shadow-mapSize={compact ? [1024, 1024] : [2048, 2048]}
      shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14}
      shadow-camera-far={60} shadow-normalBias={.025} shadow-bias={-.0001}/>
    <directionalLight position={[8, 8, -6]} intensity={1} color={palette.rim}/>
  </>;
}
