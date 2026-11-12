// Plain-language directions for camera and tracking start-up failures.

const CAMERA_MESSAGES = {
  NotAllowedError: 'Camera access is blocked. Allow the camera for this page in your browser and in System Settings > Privacy & Security > Camera, then start again.',
  SecurityError: 'Camera access is blocked. Open the game from http://localhost, allow the camera, then start again.',
  NotFoundError: 'No camera was found. Connect one and start again, or play with the keyboard.',
  OverconstrainedError: 'This camera does not support the requested video mode. Try another camera, or play with the keyboard.',
  NotReadableError: 'Another app is using the camera. Close that app and start again.',
  AbortError: 'The camera did not start. Check that no other app is using it and start again.',
};

export function describeStartError(error, stage) {
  if (stage === 'camera') {
    return CAMERA_MESSAGES[error?.name] ?? `The camera did not start (${error?.message ?? 'unknown error'}). Start again, or play with the keyboard.`;
  }
  if (stage === 'model') {
    return `Hand tracking did not load (${error?.message ?? 'unknown error'}). It downloads on first start, so check your internet connection and start again.`;
  }
  return `The game could not start (${error?.message ?? 'unknown error'}). Start again.`;
}
