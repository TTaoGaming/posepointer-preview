// Settings: values, steps, storage. No DOM here except localStorage inside try/catch.
import { PORT_NAMES, DEFAULTS as PORT_DEFAULTS, PORTS } from './registry.js';
const KEY = 'pp-letters-settings-v1';
export const CATCH = { easy: .14, normal: .11, hard: .08 };
const CATCH_NAMES = Object.keys(CATCH);
const LOOKS = ['sky', 'cream', 'slate'];
const HANDS = ['either', 'left', 'right'];
export const TIPS = { index: 8, middle: 12, thumb: 4, ring: 16, pinky: 20 };
const TIP_NAMES = Object.keys(TIPS);
// M5 new: magnet (sticky hold, on), catch/letgo (share of the short side: Tao's pp-052 numbers 0.04 and 0.07), grace (ms), autonext (on), nextlen (seconds, PROPOSED 4)
export const defaults = () => ({ opacity: .35, catchSize: 'easy', hold: .65, outline: true, sound: true, volume: .9, look: 'sky', hand: 'either', tip: 'index', mirror: true, numbers: true, magnet: true, catch: .04, letgo: .07, grace: 400, autonext: true, nextlen: 4, ...PORT_DEFAULTS });
export const RANGES = { catch: [0, .2], letgo: [0, .3], grace: [0, 2000], nextlen: [1, 30] };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;
// hold time: 0.3 to 2.0 s; steps of 0.05 up to 1.0, then 0.1
export const HOLD = { min: .3, max: 2, def: .65 };
export const stepHold = (v, d) => r2(clamp(d > 0 ? (v < 1 - 1e-9 ? v + .05 : v + .1) : (v <= 1 + 1e-9 ? v - .05 : v - .1), HOLD.min, HOLD.max));
const cyc = (list, v, d) => list[(list.indexOf(v) + d + list.length) % list.length];
const onoff = v => v ? 'On' : 'Off';

// kind 'step' = minus/plus, kind 'toggle' = one big button. step(s, dir) mutates; show(s) is the value on screen.
export const DEFS = [
  { id: 'opacity', label: 'Board opacity', kind: 'step', show: s => s.opacity.toFixed(2), step: (s, d) => { s.opacity = clamp(r1(s.opacity + d * .1), 0, 1); } },
  { id: 'hold', label: 'Hold time', kind: 'step', show: s => s.hold.toFixed(2) + ' s', step: (s, d) => { s.hold = stepHold(s.hold, d); } },
  { id: 'outline', label: 'Hand outline', kind: 'toggle', show: s => onoff(s.outline), step: s => { s.outline = !s.outline; } },
  { id: 'mirror', label: 'Mirror', kind: 'toggle', show: s => onoff(s.mirror), step: s => { s.mirror = !s.mirror; } },
  { id: 'look', label: 'Look', kind: 'step', show: s => s.look, step: (s, d) => { s.look = cyc(LOOKS, s.look, d); } },
  { id: 'numbers', label: 'Show numbers', kind: 'toggle', show: s => onoff(s.numbers), step: s => { s.numbers = !s.numbers; } },
  { id: 'catchSize', label: 'Catch size', kind: 'step', show: s => `${s.catchSize} ${CATCH[s.catchSize].toFixed(2)}`, step: (s, d) => { s.catchSize = clamp(CATCH_NAMES.indexOf(s.catchSize) - d, 0, 2) === 0 ? 'easy' : CATCH_NAMES[clamp(CATCH_NAMES.indexOf(s.catchSize) - d, 0, 2)]; } },
  { id: 'hand', label: 'Hand', kind: 'step', show: s => s.hand, step: (s, d) => { s.hand = cyc(HANDS, s.hand, d); } },
  { id: 'tip', label: 'Fingertip', kind: 'step', show: s => s.tip, step: (s, d) => { s.tip = cyc(TIP_NAMES, s.tip, d); } },
  { id: 'magnet', label: 'Sticky hold', kind: 'toggle', show: s => onoff(s.magnet), step: s => { s.magnet = !s.magnet; } },
  { id: 'autonext', label: 'Auto next', kind: 'toggle', show: s => onoff(s.autonext), step: s => { s.autonext = !s.autonext; } },
  { id: 'nextlen', label: 'Next timer', kind: 'step', show: s => s.nextlen + ' s', step: (s, d) => { s.nextlen = clamp(Math.round(s.nextlen + d), RANGES.nextlen[0], RANGES.nextlen[1]); } },
  { id: 'sound', label: 'Sound', kind: 'toggle', show: s => onoff(s.sound), step: s => { s.sound = !s.sound; } },
  { id: 'volume', label: 'Volume', kind: 'step', show: s => String(Math.round(s.volume * 100)), step: (s, d) => { s.volume = clamp(r1(s.volume + d * .1), 0, 1); } },
  ...PORTS.map(p => ({ id: p, label: p[0].toUpperCase() + p.slice(1), kind: 'step', show: s => s[p], step: (s, d) => { const l = PORT_NAMES[p], i = l.indexOf(s[p]); s[p] = cyc(l, l[i < 0 ? 0 : i], d); } }))
];
// catch size: plus = bigger/easier (easy is the largest radius)
DEFS.find(d => d.id === 'catchSize').step = (s, d) => { const i = clamp(CATCH_NAMES.indexOf(s.catchSize) - d, 0, 2); s.catchSize = CATCH_NAMES[i]; };

export function summary(s) {
  return `opacity ${s.opacity.toFixed(2)}, catch ${s.catchSize} ${CATCH[s.catchSize].toFixed(2)}, hold ${s.hold.toFixed(2)}, outline ${s.outline ? 'on' : 'off'}, ` +
    `sticky ${s.magnet ? 'on' : 'off'} (catch ${s.catch}, letgo ${s.letgo}, grace ${s.grace}), auto next ${s.autonext ? 'on ' + s.nextlen + ' s' : 'off'}, sound ${s.sound ? Math.round(s.volume * 100) : 'off'}, look ${s.look}, hand ${s.hand}, tip ${s.tip}, mirror ${s.mirror ? 'on' : 'off'}, numbers ${s.numbers ? 'on' : 'off'}, ` + PORTS.map(p => `${p} ${s[p]}`).join(', ');
}
export function load() {
  const s = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (Number.isFinite(raw.opacity)) s.opacity = clamp(r1(raw.opacity), 0, 1);
      if (CATCH_NAMES.includes(raw.catchSize)) s.catchSize = raw.catchSize;
      if (raw.hv === 2 && Number.isFinite(raw.hold)) s.hold = clamp(Math.round(raw.hold * 20) / 20, HOLD.min, HOLD.max); // older saves (hv missing) carried the 1.6 s default: ignored
      if (typeof raw.outline === 'boolean') s.outline = raw.outline;
      if (typeof raw.sound === 'boolean') s.sound = raw.sound;
      if (Number.isFinite(raw.volume)) s.volume = clamp(r1(raw.volume), 0, 1);
      if (LOOKS.includes(raw.look)) s.look = raw.look;
      if (HANDS.includes(raw.hand)) s.hand = raw.hand;
      if (TIP_NAMES.includes(raw.tip)) s.tip = raw.tip;
      if (typeof raw.mirror === 'boolean') s.mirror = raw.mirror;
      if (typeof raw.numbers === 'boolean') s.numbers = raw.numbers;
      if (typeof raw.magnet === 'boolean') s.magnet = raw.magnet;
      if (typeof raw.autonext === 'boolean') s.autonext = raw.autonext;
      for (const k of Object.keys(RANGES)) if (Number.isFinite(raw[k])) s[k] = clamp(raw[k], RANGES[k][0], RANGES[k][1]);
      PORTS.forEach(p => { if (typeof raw[p] === 'string' && /^[a-z0-9-]+$/.test(raw[p])) s[p] = raw[p]; });
    }
  } catch { /* storage unavailable: defaults */ }
  return s;
}
export function save(s) { try { localStorage.setItem(KEY, JSON.stringify({ ...s, hv: 2 })); } catch { /* fine */ } }
