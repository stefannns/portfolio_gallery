// Comprehensive MiniGameAPI implementation with both touch and mouse support
console.log('Initializing MiniGameAPI...');

// Create tt object immediately
class MiniGameAPI {
  constructor() {
    this.isCreateCanvas = false;
    const dpi = 1.0;
    const defaultScreenWidth = 1080;
    const defaultScreenHeight = 1920;
    this.webScale = defaultScreenWidth / 360;
    this.systemInfo = {
      screenWidth: defaultScreenWidth,
      screenHeight: defaultScreenHeight,
      windowWidth: defaultScreenWidth,
      windowHeight: defaultScreenHeight,
      devicePixelRatio: dpi,
      pixelRatio: dpi,
      platform: 'Android',
      system: 'Android 13',
      brand: 'Xiaomi',
      model: 'Redmi Note 12',
      language: 'zh_CN',
      version: '8.0.0',
      SDKVersion: '2.10.4',
    };
    this.AlgoTextureType = {
      Camera: 'camera',
      HandSeg: 'handSeg',
      SkinSeg: 'skinSeg',
      Portrait: 'portrait',
    };
    this.AudioSoundEventType = {
      SPEECH: 'Speech',
      SINGING: 'Singing',
      WHISPERING: 'Whispering',
      LAUGHTER: 'Laughter',
      CRYING_AND_SOBBING: 'CryingAndSobbing',
      YELL: 'Yell',
      WHISTLING: 'Whistling',
      BREATHING: 'Breathing',
      SNORING: 'Snoring',
      COUGH: 'Cough',
      SNEEZE: 'Sneeze',
      HICCUP: 'Hiccup',
      FART: 'Fart',
      FINGER_SNAPPING: 'FingerSnapping',
      CLAPPING: 'Clapping',
      HEART_SOUNDS_AND_HEARTBEAT: 'HeartSoundsAndHeartbeat',
      CHEERING: 'Cheering',
      APPLAUSE: 'Applause',
      DOG: 'Dog',
      CAT: 'Cat',
      MOO: 'Moo',
      PIG: 'Pig',
      SHEEP: 'Sheep',
      CROWING_AND_COCK_A_DOODLE_DOO: 'CrowingAndCockADoodleDoo',
      DUCK: 'Duck',
      CHIRP_AND_TWEET: 'ChirpAndTweet',
      CROW: 'Crow',
      FLY_AND_HOUSEFLY: 'FlyAndHousefly',
      FROG: 'Frog',
      SNAKE: 'Snake',
      MUSIC_BGM: 'MusicBGM',
      EMERGENCY_VEHICLE: 'EmergencyVehicle',
      DOORBELL: 'Doorbell',
      KNOCK: 'Knock',
      TYPING: 'Typing',
      ALARM: 'Alarm',
      TELEPHONE_BELL_RINGING: 'TelephoneBellRinging',
      ALARM_CLOCK: 'AlarmClock',
      GUNSHOT_AND_GUNFIRE: 'GunshotAndGunfire',
      WHITE_NOISE: 'WhiteNoise',
    };
    this.mockMicAudioInfo = {
      volume: -1,
      pitch: -1,
      keywords: [],
      soundEvents: {},
    };
    this.screenCanvas = document.getElementById('gameCanvas');
    if (this.screenCanvas) {
      const canvas = this.screenCanvas;
      canvas.width = this.systemInfo.screenWidth * dpi;
      canvas.height = this.systemInfo.screenHeight * dpi;
    }
    this.fileSystem = {
      /**
       * Read file content synchronously.
       * @param {string} path - File path
       * @returns {string} File content
       */
      readFileSync: (path, encoding = 'utf-8') => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', path, false);
          xhr.send(null);
          if (xhr.status === 200 || xhr.status === 0) {
            return xhr.responseText;
          }
        } catch (e) {
          console.warn(e);
        }
        return null;
      },
    };
  }

  createCanvas() {
    let createCanvas = null;
    if (!this.isCreateCanvas) {
      createCanvas = document.getElementById('gameCanvas');
      this.isCreateCanvas = true;
    } else {
      createCanvas = document.createElement('canvas');
    }
    createCanvas.width = this.systemInfo.screenWidth * this.systemInfo.devicePixelRatio;
    createCanvas.height = this.systemInfo.screenHeight * this.systemInfo.devicePixelRatio;
    return createCanvas;
  }

  createImage() {
    return new Image();
  }

  createInnerAudioContext() {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.destroy = () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
    audio.stop = () => {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch (e) {
        console.warn('Failed to reset audio currentTime:', e);
      }
    };
    audio.seek = position => {
      try {
        audio.currentTime = position;
      } catch (e) {
        console.warn('Failed to seek audio currentTime:', e);
      }
    };
    audio.onEnded = callback => {
      audio.addEventListener('ended', callback);
    };
    return audio;
  }

  createAlgoTexture(type) {
    const video = document.createElement('video');
    video.src = `algo://${type}?useCustomPlayer=true`;
    video.width = this.systemInfo.screenWidth;
    video.height = this.systemInfo.screenHeight;
    video.load = video.load || (() => {});
    video.play = video.play || (() => Promise.resolve());
    return video;
  }

  onKeyDown(callback) {
    document.addEventListener('keydown', callback);
  }

  onKeyUp(callback) {
    document.addEventListener('keyup', callback);
  }

  onTouchStart(callback) {
    console.log('onTouchStart: Binding touchstart event');
    const screenCanvas = this.screenCanvas;
    screenCanvas.addEventListener('touchstart', callback, { passive: false });

    // Also bind mousedown for compatibility
    console.log('onTouchStart: Also binding mousedown event for compatibility');
    screenCanvas.addEventListener('mousedown', e => {
      // Convert client coordinates to canvas coordinates
      const rect = this.screenCanvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      // Create a synthetic touch event for mouse events
      const syntheticEvent = e;
      syntheticEvent.touches = [
        {
          identifier: 0,
          clientX: canvasX * this.webScale,
          clientY: canvasY * this.webScale,
        },
      ];
      syntheticEvent.changedTouches = [
        {
          identifier: 0,
          clientX: canvasX * this.webScale,
          clientY: canvasY * this.webScale,
        },
      ];
      callback(syntheticEvent);
    });
  }

  onTouchEnd(callback) {
    console.log('onTouchEnd: Binding touchend event');
    const screenCanvas = this.screenCanvas;
    screenCanvas.addEventListener('touchend', callback);

    // Also bind mouseup for compatibility
    console.log('onTouchEnd: Also binding mouseup event for compatibility');
    screenCanvas.addEventListener('mouseup', e => {
      // Create a synthetic touch event for mouse events
      console.log('onTouchEnd: mouseup event:', e);
      const rect = this.screenCanvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      const syntheticEvent = {
        touches: [],
        changedTouches: [
          {
            identifier: 0,
            clientX: canvasX * this.webScale,
            clientY: canvasY * this.webScale,
          },
        ],
        targetTouches: [],
        preventDefault: e.preventDefault.bind(e),
      };
      callback(syntheticEvent);
    });
  }

  onTouchMove(callback) {
    console.log('onTouchMove: Binding touchmove event');
    this.screenCanvas.addEventListener(
      'touchmove',
      e => {
        e.preventDefault();
        callback(e);
      },
      { passive: false }
    );

    // Also bind mousemove for compatibility
    console.log('onTouchMove: Also binding mousemove event for compatibility');
    this.screenCanvas.addEventListener('mousemove', e => {
      // Convert client coordinates to canvas coordinates
      const rect = this.screenCanvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      // Create a synthetic touch event for mouse events
      const syntheticEvent = {
        touches: [
          {
            identifier: 0,
            clientX: canvasX * this.webScale,
            clientY: canvasY * this.webScale,
          },
        ],
        preventDefault: e.preventDefault.bind(e),
      };
      callback(syntheticEvent);
    });
  }

  onTouchCancel(callback) {
    console.log('onTouchCancel: Binding touchcancel event');
    this.screenCanvas.addEventListener('touchcancel', callback);
  }
  // eslint-disable-next-line @typescript-eslint/adjacent-overload-signatures, no-dupe-class-members
  createImage() {
    return new Image();
  }

  getSystemInfoSync() {
    return this.systemInfo;
  }

  getFileSystemManager() {
    return {
      readFileSync: (path, encoding) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', path, false);
        try {
          xhr.send();
          // For file:// protocol, status is 0 on success. For http://, it's 200.
          if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) {
            return xhr.responseText;
          } else {
            throw new Error(`File read failed: ${path} (status: ${xhr.status})`);
          }
        } catch (e) {
          // If the browser blocks file:// access completely, we can't do much without a server or flags
          console.error(`Error reading file ${path}:`, e);
          throw new Error(`File not found or access denied: ${path}. Note: Browsers may block file:// access. Try starting Chrome with --allow-file-access-from-files or use a local server.`);
        }
      },
    };
  }

  requestAnimationFrame(callback) {
    return requestAnimationFrame(callback);
  }
  getCurrentTime() {
    return Date.now();
  }
  getHandInfo() {
    return null;
  }
  getHandCount() {
    return 0;
  }
  getFaceCount() {
    return 0;
  }
  getGestureInfo() {
    return null;
  }
  getFaceBaseInfo() {
    return null;
  }
  getMicAudioInfo() {
    const keywords = Array.isArray(this.mockMicAudioInfo.keywords) ? this.mockMicAudioInfo.keywords : [];
    const soundEvents = this.mockMicAudioInfo.soundEvents || {};
    this.mockMicAudioInfo.keywords = [];
    return {
      volume: this.mockMicAudioInfo.volume,
      pitch: this.mockMicAudioInfo.pitch,
      keywords,
      soundEvents(type) {
        return Object.prototype.hasOwnProperty.call(soundEvents, type) ? soundEvents[type] : 0;
      },
    };
  }
  setMockMicAudioInfo(info = {}) {
    this.mockMicAudioInfo = {
      volume: typeof info.volume === 'number' ? info.volume : -1,
      pitch: typeof info.pitch === 'number' ? info.pitch : -1,
      keywords: Array.isArray(info.keywords) ? info.keywords : [],
      soundEvents: info.soundEvents && typeof info.soundEvents === 'object' ? info.soundEvents : {},
    };
  }
  onEffectEvent(_callback) {
    return 0;
  }
  HandAction() {
    return null;
  }
  getFileSystemManager() {
    return this.fileSystem;
  }
}
globalThis.tt = new MiniGameAPI();
globalThis.canvas = tt.createCanvas(); // Simulate the mini-game environment by injecting the global canvas
globalThis.fs = tt.getFileSystemManager();
const oldRequire = globalThis.require;
globalThis.require = module => {
  if (!module || typeof module !== 'string') {
    throw new Error('Module name is required');
  }
  const moduleName = module.toLowerCase().split('/').pop();
  if (moduleName.includes('three.min') || moduleName.includes('three.js')) {
    return globalThis.THREE;
  }
  if (moduleName.includes('tt-adapter') || moduleName.includes('weapp-adapter')) {
    return {};
  }
  if (moduleName.includes('js-yaml')) {
    return globalThis.jsyaml;
  }
  if (moduleName.includes('phaser')) {
    return globalThis.Phaser;
  }
  if (moduleName === 'fs') {
    return tt.getFileSystemManager();
  }
  throw new Error(`Module ${module} not found`);
};
console.log('MiniGameAPI initialized successfully');
