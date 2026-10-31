import {Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, Vector3} from 'three';

/** Add painted chalk marks in the original Tripo model's coordinate frame. */
export function addChalkCutlery(model) {
  const texture = new TextureLoader().load('/images/scene/chalk-cutlery.svg');
  texture.colorSpace = SRGBColorSpace;
  const geometry = new PlaneGeometry(.32, .38);
  const material = new MeshBasicMaterial({map: texture, transparent: true, opacity: .9,
    depthTest: true, depthWrite: false, alphaTest: .01, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1});
  const drawing = new Mesh(geometry, material);
  drawing.name = 'chalk-spoon-and-fork';
  const normal = new Vector3(.95448, .29827, 0).normalize();
  const right = new Vector3(0, 0, -1);
  const up = new Vector3(-normal.y, normal.x, 0);
  drawing.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal));
  drawing.position.set(-.0139, .12, -.04).addScaledVector(normal, .003);
  drawing.raycast = () => {};
  model.add(drawing);
  return () => {model.remove(drawing);geometry.dispose();material.dispose();texture.dispose();};
}
