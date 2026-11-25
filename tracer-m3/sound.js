// Web Audio only. No files. One exported function per event so a sound pack can replace each.
let ctx, master, enabled = true, vol = .9;
let played = 0; export const count = () => played;
export function setSound(on, volume) { enabled = !!on; vol = volume; if (master) master.gain.value = enabled ? vol : 0; }
const audio = () => {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = enabled ? vol : 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    master.connect(lp).connect(ctx.destination);
  }
  return ctx;
};
export async function startAudio() { try { await audio().resume(); } catch (e) { /* no audio is fine */ } }

// pentatonic scale in C: soft, never sour
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];

function note(freq, { at = 0, dur = .25, type = 'sine', vol = .08, bell = true, slide = 0 } = {}) {
  let c; try { c = audio(); } catch (e) { return; }
  if (c.state === 'suspended') return;
  const t0 = c.currentTime + at;
  const make = (f, v, tp) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = tp; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t0 + dur);
    g.gain.setValueAtTime(.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + .03);
  };
  make(freq, vol, type);
  if (bell) make(freq * 2, vol * .28, 'sine');
}

// soft note per dot, pitch rises along the stroke (index 0..total-1)
export function dot(index = 0, total = 6) { if (enabled) played++;
  const k = Math.min(SCALE.length - 1, Math.round((index / Math.max(1, total - 1)) * 7));
  note(SCALE[k], { dur: .28, vol: .085 });
}
export function strokeDone() { if (enabled) played++; [0, 2, 4].forEach((k, i) => note(SCALE[k + 2], { at: i * .03, dur: .55, vol: .05, type: 'triangle' })); }
export function letterDone() { if (enabled) played++;
  [5, 7, 6, 8, 9, 11].forEach((k, i) => note(SCALE[k], { at: i * .11, dur: .4, vol: .075, type: 'triangle' }));
  [0, 2, 4].forEach(k => note(SCALE[k + 3], { at: .72, dur: .9, vol: .045 }));
}
export function tick() { if (enabled) played++; note(1500, { dur: .035, vol: .03, bell: false, type: 'triangle' }); }
export function pop() { if (enabled) played++; note(420, { dur: .13, vol: .09, slide: 1.9, bell: false }); }
export function lost() { if (enabled) played++; note(196, { dur: .45, vol: .06, bell: false, slide: .8 }); }
// kept for the older names a pack may use
export const click = () => dot(0, 2);
export const reward = letterDone;
