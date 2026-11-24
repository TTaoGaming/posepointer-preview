// Copyright Tao. All rights reserved.
const profiles = {
  standard: { width: 640, height: 480, frameRate: 30 },
  low: { width: 480, height: 360, frameRate: 15 }
};
const modelAssetPath = './mp/hand_landmarker.task';
const wasmLoaderPath = './mp/wasm/vision_wasm_internal.js';
const wasmBinaryPath = './mp/wasm/vision_wasm_internal.wasm';
const runtimePath = './mp/runtime.js';

async function requireFile(path, signal) {
  try {
    const response = await fetch(path, { method: 'HEAD', signal, redirect: 'error' });
    if (response.ok) return;
  } catch (error) {
    if (signal.aborted) throw error;
  }
  throw new Error(`Missing MediaPipe file: ${path}`);
}

export function create({ video }, { hands = 1, camera = {}, delegate = 'CPU' }) {
  if (delegate !== 'CPU' && delegate !== 'GPU') {
    throw new Error(`Unsupported tracking delegate: ${delegate} (use CPU or GPU)`);
  }
  const { profile = 'standard' } = camera;
  if (!Object.hasOwn(profiles, profile)) throw new Error(`Unsupported camera profile: ${profile}`);
  const defaults = profiles[profile];
  const { width = defaults.width, height = defaults.height, frameRate = defaults.frameRate } = camera;
  const wanted = { width, height, frameRate };

  let active = false;
  let stream, landmarker, callback, checking;
  const videoFrames = typeof video.requestVideoFrameCallback === 'function';

  function stop() {
    active = false;
    checking?.abort();
    if (callback !== undefined) {
      if (videoFrames) video.cancelVideoFrameCallback(callback);
      else cancelAnimationFrame(callback);
    }
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
      checking = new AbortController();
      for (const path of [modelAssetPath, wasmLoaderPath, wasmBinaryPath, runtimePath]) {
        await requireFile(path, checking.signal);
      }
      const { HandLandmarker } = await import('../mp/runtime.js').catch(() => {
        throw new Error(`Missing MediaPipe file: ${runtimePath}`);
      });
      if (!active) return;
      const model = await HandLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO', numHands: hands
      });
      if (!active) {
        model.close();
        return;
      }
      landmarker = model;
      const captured = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: wanted.width }, height: { ideal: wanted.height },
          frameRate: { ideal: wanted.frameRate, max: wanted.frameRate }, facingMode: { ideal: 'user' }
        }
      });
      if (!active) {
        captured.getTracks().forEach(item => item.stop());
        return;
      }
      stream = captured;
      video.srcObject = stream;
      await video.play();
      if (!active) return;

      const interval = 1000 / wanted.frameRate;
      const minGap = interval * 0.9;
      let lastFrame, lastDetection = -Infinity, nextDue = -Infinity;
      function schedule() {
        callback = videoFrames ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
      }
      function tick(t, metadata) {
        if (!active) return;
        try {
          const frameTime = (metadata?.mediaTime ?? video.currentTime) * 1000;
          const frameId = metadata?.presentedFrames ?? (video.getVideoPlaybackQuality?.().totalVideoFrames || frameTime);
          if (video.readyState >= 2 && frameId !== lastFrame) {
            lastFrame = frameId;
            if (frameTime - lastDetection >= minGap && frameTime >= nextDue - (interval - minGap)) {
              lastDetection = frameTime;
              // Tolerate small timestamp jitter while pacing sustained detections at the requested rate.
              nextDue = Math.max(frameTime + minGap, nextDue + interval);
              const result = model.detectForVideo(video, t);
              onFrame({
                t: performance.now(), mirrored: false, hands: result.landmarks,
                handedness: (result.handedness ?? result.handednesses ?? []).map(labels => labels[0]?.categoryName ?? null)
              });
            }
          }
          if (active) schedule();
        } catch (error) {
          onError(error);
        }
      }
      schedule();
    },
    stop
  };
}
