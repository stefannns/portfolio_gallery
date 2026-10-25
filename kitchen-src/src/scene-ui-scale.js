// Match overlays to the room's projected size in CSS pixels, including camera
// zoom and viewport fitting. A fixed room point keeps walking from resizing UI.
export function getSceneUiScale(camera, size) {
  camera.updateWorldMatrix(true, false);
  const matrix = camera.matrixWorldInverse.elements;
  const depth = -(matrix[6] * .8 + matrix[14]);
  const pixelsPerUnit = size.height * camera.projectionMatrix.elements[5] / 2
    / (camera.isOrthographicCamera ? 1 : Math.max(.01, depth));
  return Math.max(.01, pixelsPerUnit / 100);
}
