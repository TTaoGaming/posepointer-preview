// Copyright Tao. All rights reserved.
const profiles = {
  standard: { width: 640, height: 480, frameRate: 30 },
  low: { width: 480, height: 360, frameRate: 15 }
};
const modelAssetPath = './mp/hand_landmarker.task';
const requiredFiles = [
  modelAssetPath, './mp/wasm/vision_wasm_internal.js', './mp/wasm/vision_wasm_internal.wasm', './mp/runtime.js'
];

async function checkFile(path, signal) {
  try {
    const response = await fetch(path, { method: 'HEAD', redirect: 'error', signal });
    if (response.ok) return;
    throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`Missing MediaPipe file: ${path}`, { cause: error });
  }
}

export function create({ video }, { hands = 1, camera = {}, delegate = 'CPU' }) {
  if (delegate !== 'CPU' && delegate !== 'GPU') {
    throw new Error(`Unsupported tracking delegate: ${delegate} (use CPU or GPU)`);
  }
  const profile = camera.profile ?? 'standard';
  if (!Object.hasOwn(profiles, profile)) throw new Error(`Unsupported camera profile: ${profile}`);
  const { width, height, frameRate } = profiles[profile];
  const wanted = {
    width: camera.width ?? width, height: camera.height ?? height, frameRate: camera.frameRate ?? frameRate
  };
  for (const [key, min, max] of [['width', 160, 1920], ['height', 120, 1080], ['frameRate', 5, 60]]) {
    if (!Number.isFinite(wanted[key]) || wanted[key] < min || wanted[key] > max ||
        (key !== 'frameRate' && !Number.isInteger(wanted[key]))) {
      throw new Error(`Unsupported camera ${key}: ${wanted[key]} (use ${min} to ${max})`);
    }
  }
  const framePeriod = 1000 / wanted.frameRate;
  const nativeFrames = typeof video.requestVideoFrameCallback === 'function';
  const checks = new AbortController();
  let active = false;
  let stream, landmarker, callback;

  function stop() {
    active = false;
    checks.abort();
    if (nativeFrames) video.cancelVideoFrameCallback(callback);
    else cancelAnimationFrame(callback);
    stream?.getTracks().forEach(item => item.stop());
    if (video.srcObject === stream) video.srcObject = null;
    stream = null;
    const ending = landmarker;
    landmarker = null;
    ending?.close();
  }

  return {
    async start(onFrame, onError) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera needs HTTPS or localhost.');
      active = true;
      await Promise.all(requiredFiles.map(path => checkFile(path, checks.signal)));
      if (!active) return;
      const { FilesetResolver, HandLandmarker } = await import('../mp/runtime.js').catch(error => {
        throw new Error('Missing MediaPipe file: ./mp/runtime.js', { cause: error });
      });
      if (!active) return;
      const fileset = await FilesetResolver.forVisionTasks('./mp/wasm');
      if (!active) return;
      const model = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO', numHands: hands
      });
      if (!active) {
        model.close();
        return;
      }
      landmarker = model;
      const camera = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: wanted.width }, height: { ideal: wanted.height },
          frameRate: { ideal: wanted.frameRate, max: wanted.frameRate }, facingMode: { ideal: 'user' }
        }
      });
      if (!active) {
        camera.getTracks().forEach(item => item.stop());
        return;
      }
      stream = camera;
      video.srcObject = stream;
      await video.play();
      if (!active) return;

      let lastFrame = -1, lastDetection = -Infinity, nextDetection = -Infinity;
      function queueFrame() {
        callback = nativeFrames ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
      }
      function tick(t, metadata) {
        if (!active) return;
        try {
          const frame = metadata?.presentedFrames ?? ((video.getVideoPlaybackQuality?.().totalVideoFrames ||
            video.webkitDecodedFrameCount) || video.currentTime);
          if (video.readyState >= 2 && frame !== lastFrame) {
            lastFrame = frame;
            const tolerance = framePeriod * 0.1;
            if (t - lastDetection >= framePeriod * 0.9 && t + tolerance >= nextDetection) {
              lastDetection = t;
              nextDetection = Math.max(t - tolerance, nextDetection) + framePeriod;
              const result = model.detectForVideo(video, t);
              onFrame({
                t: performance.now(), mirrored: false, hands: result.landmarks,
                handedness: (result.handedness ?? result.handednesses ?? []).map(labels => labels[0]?.categoryName ?? null)
              });
            }
          }
          if (active) queueFrame();
        } catch (error) {
          onError(error);
        }
      }
      queueFrame();
    },
    stop
  };
}
