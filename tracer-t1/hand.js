import { create as createCamera } from './shell/adapters/tracer-camera.js';
import { create as createFingertip } from './shell/adapters/fingertip.js';
import { create as createFilter } from './shell/adapters/one-euro.js';
import { create as createExternal } from './shell/adapters/sense-external.js';
import { createTouchWins } from './shell/core/touch-wins.js';
import { cameraToPage } from './pointer-map.js';

export function createHandInput({ video, onPoint, onHand, onStatus, settleMs = 300, graceMs = 300, tip = 8, preferred = 'either' }) {
  let fingertip = createFingertip(null, { tip }, preferred);
  const filter = createFilter(null, { minCutoffHz: 1.8, predictionMs: 30 });
  const touchWins = createTouchWins({ quietMs: 900 });
  const external = createExternal();
  const camera = createCamera({ video }, { hands: 1 });
  let candidateSince = null, live = false, lossTimer, graceTimer, started = false, cameraOn = false, announced = true;   // announced: the loss has been reported once (M5: it used to be reported on every empty frame)

  const lose = () => {
    clearTimeout(graceTimer); graceTimer = null; onHand?.(null);
    candidateSince = null; fingertip.reset(); filter.reset();
    if (live) { live = false; onPoint({ type: 'cancel', t: performance.now() }); }
    if (!announced) { announced = true; onStatus('signal lost'); }
  };
  // a hand missing for less than graceMs (300 ms) keeps the hold; the view pauses its clock meanwhile and draws no outline
  const softMiss = () => {
    onHand?.(null);
    if (!live) { lose(); return; }
    onPoint({ type: 'miss', t: performance.now() });
    if (!graceTimer) graceTimer = setTimeout(lose, graceMs);
  };
  const frame = sample => {
    clearTimeout(lossTimer); lossTimer = setTimeout(softMiss, graceMs);
    if (touchWins.isQuiet(sample.t)) return;
    const selected = fingertip.update(sample, cameraToPage);
    if (!selected) { softMiss(); return; }
    clearTimeout(graceTimer); graceTimer = null;
    onHand?.(selected.points, sample.t);
    candidateSince ??= sample.t;
    if (sample.t - candidateSince < settleMs) return;
    const point = filter.update(selected.tip, sample.t);
    if (!live) { live = true; announced = false; onStatus('hand ready'); onPoint({ type: 'down', ...point, t: sample.t }); }
    else onPoint({ type: 'move', ...point, t: sample.t });
  };

  return {
    // hand and fingertip go to the adapter's own config: a new adapter is built with the new values
    configure({ tip: t2, preferred: p2 }) { fingertip = createFingertip(null, { tip: t2 }, p2); candidateSince = null; },
    noteDirect(t) { const state = touchWins.note(t, true); if (state.release && live) lose(); },
    async startCamera() {
      if (cameraOn) return; cameraOn = true; onStatus('camera starting');
      try { await camera.start(frame, () => onStatus('Camera stopped working. You can still use touch or a pointer.')); if (cameraOn) onStatus('camera on'); }
      catch { cameraOn = false; onStatus('Camera is unavailable or permission was refused. You can still use touch or a pointer.'); }
    },
    stopCamera() { cameraOn = false; camera.stop(); onStatus('camera off'); },
    async start() { if (!started) { started = true; external.start(frame); } return this.startCamera(); },
    stop() { this.stopCamera(); external.stop(); clearTimeout(lossTimer); lose(); started = false; },
    cameraOn() { return cameraOn; }
  };
}
