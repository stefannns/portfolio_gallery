import React, {useEffect, useMemo} from 'react';
import {useGLTF} from '@react-three/drei';
import {Box3, Group, Vector3} from 'three';

const SERVINGS = Object.freeze([
  {id: 'salmon', url: '/models/tripo/kitchen-sushi-salmon-v1.glb', position: [.43, 1.11567, 1.089]},
  {id: 'maki', url: '/models/tripo/kitchen-sushi-maki-v1.glb', position: [.43, 1.11567, -.320]},
  {id: 'tamago', url: '/models/tripo/kitchen-sushi-tamago-v1.glb', position: [.43, 1.11567, -1.679]},
]);
const MODEL_URLS = SERVINGS.map(serving => serving.url);
const SERVING_WIDTH = .72;
const noRaycast = () => {};

/** Real Tripo food-and-plate models, aligned with the three bar stools. */
export default function SushiPlates({onReady, rootRef}) {
  const loaded = useGLTF(MODEL_URLS, '/draco/');
  const models = useMemo(() => loaded.map(({scene}, index) => {
    const clone = scene.clone(true);clone.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(clone);
    const size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
    if (bounds.isEmpty() || Math.max(size.x, size.z) <= 0) throw new Error('Sushi serving contains no visible geometry.');
    clone.position.add(new Vector3(-center.x, -bounds.min.y, -center.z));
    clone.traverse(mesh => {if (mesh.isMesh) {mesh.castShadow = true;mesh.receiveShadow = true;mesh.raycast = noRaycast;}});
    const object = new Group();object.name = `bar-sushi-${SERVINGS[index].id}`;
    object.add(clone);object.scale.setScalar(SERVING_WIDTH / Math.max(size.x, size.z));
    // Long oval/rectangular plates follow the row of stools across the screen.
    object.rotation.y = size.x > size.z * 1.05 ? Math.PI / 2 : 0;
    return object;
  }), [loaded[0].scene, loaded[1].scene, loaded[2].scene]);

  useEffect(() => {
    const root = rootRef?.current;
    if (root?.dataset) {
      root.dataset.sushiPlates = String(models.length);
      root.dataset.sushiPlatePositions = JSON.stringify(SERVINGS.map(({id, position}) => ({id, position})));
    }
    onReady?.();
    return () => {if (root?.dataset) {delete root.dataset.sushiPlates;delete root.dataset.sushiPlatePositions;}};
  }, [models, onReady, rootRef]);

  return <group name="bar-sushi-servings" dispose={null}>
    {models.map((object, index) => <primitive key={SERVINGS[index].id} object={object} position={SERVINGS[index].position} dispose={null}/>)}
  </group>;
}
