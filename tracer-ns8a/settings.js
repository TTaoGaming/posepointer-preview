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
export const defaults = () => ({ opacity: .35, catchSize: 'easy', hold: .65, outline: true, sound: true, volume: .9, look: 'sky', hand: 'either', tip: 'index', mirror: true, numbers: true, magnet: true, catch: .04, letgo: .07, grace: 400, autonext: true, nextlen: 4, camera: true, ...PORT_DEFAULTS });
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
export const PRESETS = {
  Playful: { skin: 'glass', cursor: 'comet', finish: 'clean-letter', juice: 'party', look: 'sky' },
  Calm: { skin: 'glass', cursor: 'ring', finish: 'clean-letter', juice: 'calm', look: 'cream' },
  Focus: { skin: 'glass', cursor: 'dot-ring', finish: 'clean-letter', juice: 'off', look: 'slate' }
};
const preset = name => ({ id: 'preset-' + name.toLowerCase(), label: name + ' preset', kind: 'toggle', show: () => 'Use', step: s => Object.assign(s, PRESETS[name]) });
// Three fixed pages on a phone: essentials first, then two deliberate-hold advanced pages.
export const DEFS = [
  preset('Playful'), preset('Calm'), preset('Focus'),
  { id: 'camera', label: 'Camera', kind: 'toggle', show: s => onoff(s.camera), step: s => { s.camera = !s.camera; } },
  { id: 'opacity', label: 'Board opacity', kind: 'step', show: s => s.opacity.toFixed(2), step: (s, d) => { s.opacity = clamp(r1(s.opacity + d * .1), 0, 1); } },
  { id: 'hold', label: 'Hold time', kind: 'step', show: s => s.hold.toFixed(2) + ' s', step: (s, d) => { s.hold = stepHold(s.hold, d); } },
  { id: 'outline', label: 'Hand outline', kind: 'toggle', show: s => onoff(s.outline), step: s => { s.outline = !s.outline; } },
  { id: 'mirror', label: 'Mirror', kind: 'toggle', show: s => onoff(s.mirror), step: s => { s.mirror = !s.mirror; } },
  { id: 'numbers', label: 'Show numbers', kind: 'toggle', show: s => onoff(s.numbers), step: s => { s.numbers = !s.numbers; } },
  { id: 'sound', label: 'Sound', kind: 'toggle', show: s => onoff(s.sound), step: s => { s.sound = !s.sound; } },
  ...PORTS.map(p => ({ id: p, label: p[0].toUpperCase() + p.slice(1), kind: 'step', show: s => s[p], step: (s, d) => { const l = PORT_NAMES[p], i = l.indexOf(s[p]); s[p] = cyc(l, l[i < 0 ? 0 : i], d); } }))
];
export function summary(s) {
  return `camera ${s.camera ? 'on' : 'off'}, opacity ${s.opacity.toFixed(2)}, catch ${s.catchSize} ${CATCH[s.catchSize].toFixed(2)}, hold ${s.hold.toFixed(2)}, outline ${s.outline ? 'on' : 'off'}, ` +
    `sticky ${s.magnet ? 'on' : 'off'} (catch ${s.catch}, letgo ${s.letgo}, grace ${s.grace}), auto next ${s.autonext ? 'on ' + s.nextlen + ' s' : 'off'}, sound ${s.sound ? Math.round(s.volume * 100) : 'off'}, look ${s.look}, hand ${s.hand}, tip ${s.tip}, mirror ${s.mirror ? 'on' : 'off'}, numbers ${s.numbers ? 'on' : 'off'}, ` + PORTS.map(p => `${p} ${s[p]}`).join(', ');
}
export function load() {
  return defaults();
}
export function save() {}
