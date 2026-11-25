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
  let candidateSince = null, live = false, lossTimer, graceTimer, started = false;

  const lose = () => {
    clearTimeout(graceTimer); graceTimer = null; onHand?.(null);
    candidateSince = null; fingertip.reset(); filter.reset();
    if (live) { live = false; onPoint({ type: 'cancel', t: performance.now() }); }
    onStatus('signal lost');
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
    if (!live) { live = true; onStatus('hand ready'); onPoint({ type: 'down', ...point, t: sample.t }); }
    else onPoint({ type: 'move', ...point, t: sample.t });
  };

  return {
    // hand and fingertip go to the adapter's own config: a new adapter is built with the new values
    configure({ tip: t2, preferred: p2 }) { fingertip = createFingertip(null, { tip: t2 }, p2); candidateSince = null; },
    noteDirect(t) { const state = touchWins.note(t, true); if (state.release && live) lose(); },
    async start() {
      if (started) return; started = true; external.start(frame);
      // the real camera is opt-in (?camera=1): it needs MediaPipe files under shell/mp/. Without them: quiet, pointer only.
      if (new URLSearchParams(location.search).get('camera') !== '1') return;
      try { await camera.start(frame, () => onStatus('nocamera')); }
      catch { onStatus('nocamera'); }
    },
    stop() { camera.stop(); external.stop(); clearTimeout(lossTimer); lose(); started = false; }
  };
}
