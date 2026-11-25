// Copyright Tao. All rights reserved.
const profiles = {
  standard: { width: 640, height: 480, frameRate: 30 },
  low: { width: 480, height: 360, frameRate: 15 }
};
const asset = path => new URL(path, import.meta.url).href;
const modelAssetPath = asset('../mp/hand_landmarker.task');
const runtime = ['../mp/runtime.js', 231706];
const requiredFiles = [
  runtime,
  ['../mp/hand_landmarker.task', 7819105],
  ['../mp/wasm/vision_wasm_internal.js', 336624],
  ['../mp/wasm/vision_wasm_internal.wasm', 14665716]
];

export async function loadTrackingFiles({ external, signal, onProgress }) {
  const files = external ? [runtime] : requiredFiles;
  const total = files.reduce((sum, [, bytes]) => sum + bytes, 0);
  let loaded = 0;
  onProgress(loaded, total);
  await Promise.all(files.map(async ([path, bytes]) => {
    const response = await fetch(asset(path), { redirect: 'error', signal });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    const reader = response.body.getReader();
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        loaded += value.byteLength;
        onProgress(loaded, total);
      }
    } finally {
      reader.releaseLock();
    }
    if (received !== bytes) throw new Error(`${path} returned ${received} bytes, expected ${bytes}`);
  }));
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
  let active = false;
  let stream, landmarker, callback;

  function stop() {
    active = false;
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
      const { FilesetResolver, HandLandmarker } = await import('../mp/runtime.js').catch(error => {
        throw new Error('Missing MediaPipe file: ./mp/runtime.js', { cause: error });
      });
      if (!active) return;
      const fileset = await FilesetResolver.forVisionTasks(asset('../mp/wasm'));
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
