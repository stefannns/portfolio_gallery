import {Color, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, Vector3} from 'three';

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

/** Keep the baked casing intact; only the curved dark-green glass emits light. */
export function addComputerScreenGlow(material, amount) {
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.kitchenScreenAmount = amount;
    shader.uniforms.kitchenScreenTint = {value: new Color('#bce8d2')};
    shader.vertexShader = `varying vec3 vKitchenScreenPosition;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKitchenScreenPosition = position;');
    shader.fragmentShader = `varying vec3 vKitchenScreenPosition;\nuniform float kitchenScreenAmount;\nuniform vec3 kitchenScreenTint;\n${shader.fragmentShader}`
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 screenPosition = vKitchenScreenPosition;
        float glassArea = smoothstep(.005, .022, screenPosition.x) * (1.0 - smoothstep(.065, .085, screenPosition.x));
        glassArea *= smoothstep(.285, .315, screenPosition.y) * (1.0 - smoothstep(.79, .82, screenPosition.y));
        glassArea *= 1.0 - smoothstep(.395, .425, abs(screenPosition.z));
        float glassColor = 1.0 - smoothstep(.23, .36, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
        glassColor *= smoothstep(.005, .035, diffuseColor.g - diffuseColor.r);
        totalEmissiveRadiance += kitchenScreenTint * kitchenScreenAmount * glassArea * glassColor * .9;
      `);
  };
  material.customProgramCacheKey = () => 'kitchen-computer-screen-v1';
}
