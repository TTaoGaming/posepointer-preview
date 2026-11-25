import { createDotTracer } from './engine/dot-core.js';
import { createPhaserView } from './view-phaser.js';
import { createHandInput } from './hand.js';
import { pageToFrame, setVideoSize, setMirror } from './pointer-map.js';
import * as sound from './sound.js';
import * as settings from './settings.js';
import { LOOKS } from './looks.js';
import { loadAll, PORTS } from './registry.js';

const qs = new URLSearchParams(location.search);
const core = createDotTracer(); window.__core = core;
core.applyPreset?.('kids');
const set = await fetch('./engine/data/items.json').then(r => r.json());
core.loadItemSet(set);
const LETTERS = Object.keys(set.items).filter(id => id.startsWith('upper-'));
let at = 0;
core.show(LETTERS[0]);

const S = settings.load();
if (Number(qs.get('hold'))) S.hold = Number(qs.get('hold')) / 1000; // address switch: ?hold=800 (ms), not clamped
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// address switches for the four ports: ?skin= ?cursor= ?finish= ?juice=  (juice=0 means off; reduced motion means off)
PORTS.forEach(p => { if (qs.get(p)) S[p] = qs.get(p) === '0' && p === 'juice' ? 'off' : qs.get(p); });
if (reduced && !qs.get('juice')) S.juice = 'off';
const solid = qs.get('solid') === '1' || matchMedia('(prefers-reduced-transparency: reduce)').matches;
const noteEl = document.getElementById('note'); let noteTimer;
const note = text => { noteEl.textContent = text; noteEl.style.display = text ? 'block' : 'none'; clearTimeout(noteTimer); if (text) noteTimer = setTimeout(() => { noteEl.style.display = 'none'; }, 7000); };
let loaded = await loadAll(S); PORTS.forEach(p => { S[p] = loaded.names[p]; }); if (loaded.notes.length) note(loaded.notes.join('; '));
let adaptKey = PORTS.map(p => S[p]).join('|');
async function reloadAdapters() {
  const key = PORTS.map(p => S[p]).join('|'); if (key === adaptKey) return; adaptKey = key;
  loaded = await loadAll(S); PORTS.forEach(p => { S[p] = loaded.names[p]; }); note(loaded.notes.join('; '));
  scene?.setAdapters(loaded.adapters);
}
let scene, started = false, handWasLive = false, lastHand = '';
const video = document.querySelector('#camera'), sky = document.querySelector('#sky');

// ---- mirror layer: one video behind the game
const syncVideo = () => {
  if (video.videoWidth > 0 && video.srcObject) { setVideoSize(video.videoWidth, video.videoHeight); video.classList.add('on'); }
};
video.addEventListener('playing', syncVideo); video.addEventListener('loadedmetadata', syncVideo); video.addEventListener('resize', syncVideo);
const hideVideo = () => { video.classList.remove('on'); setVideoSize(0, 0); };
video.addEventListener('emptied', hideVideo); video.addEventListener('error', hideVideo);

// ---- stand-in video for tests only (code-made, never a person): ?mirror=test&scene=busy|bright|dark
function standIn(kind) {
  const portrait = innerHeight > innerWidth, W = portrait ? 480 : 640, H = portrait ? 640 : 480;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const pal = { busy: ['#e8452c', '#2c7be8', '#f2c230', '#3ab36b', '#9b3fd1'], bright: ['#fff7c2', '#fdfdfd', '#ffe9a8', '#e8f4ff', '#fffbe0'], dark: ['#06080f', '#0b1020', '#101a30', '#05070c', '#0e0e18'] }[kind] || [];
  const draw = ts => {
    const t = ts / 1000;
    g.fillStyle = kind === 'bright' ? '#fdfdf5' : kind === 'dark' ? '#080a12' : '#2a2f3a'; g.fillRect(0, 0, W, H);
    if (kind === 'busy') { const s = 40; for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) { if (((x / s + y / s) & 1) === 0) { g.fillStyle = '#ffffff'; g.fillRect(x, y, s, s); } else { g.fillStyle = '#111'; g.fillRect(x, y, s, s); } } }
    else { const s = 80; g.globalAlpha = .5; for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) if (((x / s + y / s) & 1) === 0) { g.fillStyle = kind === 'bright' ? '#ffffff' : '#1a2240'; g.fillRect(x, y, s, s); } g.globalAlpha = 1; }
    pal.forEach((col, i) => { const x = W * (.5 + .38 * Math.sin(t * (.6 + i * .17) + i * 1.7)), y = H * (.5 + .38 * Math.cos(t * (.5 + i * .13) + i)), r = Math.min(W, H) * (.2 + .05 * Math.sin(t + i)); g.globalAlpha = kind === 'busy' ? .85 : .9; g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); });
    g.globalAlpha = 1; requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return c.captureStream(30);
}
if (qs.get('mirror') === 'test') {
  video.srcObject = standIn(qs.get('scene') || 'busy');
  video.play().catch(() => {});
}

// ---- apply every setting (idempotent)
function apply() {
  core.configure({ radius: settings.CATCH[S.catchSize] });
  sound.setSound(S.sound, S.volume);
  setMirror(S.mirror); video.classList.toggle('flip', S.mirror);
  const key = S.hand + S.tip; if (key !== lastHand) { lastHand = key; hand.configure({ tip: settings.TIPS[S.tip], preferred: S.hand }); }
  sky.style.background = LOOKS[S.look].css; document.documentElement.style.background = '#' + LOOKS[S.look].plate.toString(16).padStart(6, '0');
  scene?.setLook?.(S.look);
  reloadAdapters();
}
function change(id, dir) {
  const def = settings.DEFS.find(d => d.id === id); if (!def) return;
  def.step(S, dir); apply(); settings.save(S);
}
async function copyText() {
  const text = settings.summary(S);
  try { await navigator.clipboard.writeText(text); } catch { /* the line is on screen anyway */ }
  return text;
}

const go = delta => { at = (at + delta + LETTERS.length) % LETTERS.length; core.show(LETTERS[at]); };
function control(action) {
  if (action === 'start') { started = true; sound.startAudio(); scene.begin(); core.show(LETTERS[at]); return; }
  sound.startAudio();
  if (action === 'again') core.repeat(); else if (action === 'next') go(1); else if (action === 'back') go(-1);
  scene.layout(); scene.afterChange();
}

const frameEvent = event => {
  if (!scene) return;
  if (event.type === 'miss') { scene.setMiss(true); return; }
  scene.setMiss(false);
  if (event.type === 'cancel' || event.x === undefined) { if (event.type === 'cancel' && !scene.panelOpen) core.pointer({ type: 'cancel', x: 0, y: 0, t: event.t }); scene.setCursor(null, false); return; }
  handWasLive = true; scene.setSignal(true);
  scene.setCursor({ x: event.x * innerWidth, y: event.y * innerHeight }, true);
  if (!started || scene.panelOpen) return;
  core.pointer({ type: event.type, ...pageToFrame({ x: event.x * innerWidth, y: event.y * innerHeight }, scene.frame), t: event.t });
};
const hand = createHandInput({
  video, onPoint: frameEvent, onHand: (pts, t) => scene?.setHand(pts ? pts.map(p => ({ x: p.x * innerWidth, y: p.y * innerHeight })) : null), tip: settings.TIPS[S.tip], preferred: S.hand,
  onStatus: text => { if (text === 'signal lost' && handWasLive) { scene?.setSignal(false); sound.lost(); } }
});
lastHand = S.hand + S.tip;
hand.start();

createPhaserView({
  core, mount: 'game', adapters: loaded.adapters, solid, settings: S, onControl: control, onSetting: change, onCopy: copyText,
  onReady: v => { scene = v; window.__scene = v; apply(); },
  sfx: { tick: sound.tick, pop: sound.pop }
});

window.__tracer = {
  get ready() { return !!scene?.drawn; },
  screen: () => !scene || !started ? 'start' : (core.getState().complete ? 'finish' : 'trace'),
  item: () => core.getState().item,
  dots: () => core.getDots().map(d => { const p = scene.fp(d); return { x: p.x, y: p.y, done: d.done, next: !!d.next }; }),
  buttons: () => scene.activeButtons().map(b => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, fill: scene.liveFill(b), drawnFill: b.fill })),
  sounds: () => sound.count(),
  settings: () => ({ ...S, open: !!scene?.panelOpen, page: scene?.panelPage ?? 0, summary: settings.summary(S), catchRadius: settings.CATCH[S.catchSize], effectiveRadius: core.getEffectiveRadius() }),
  hand: () => (S.outline ? scene?.handPts : null) ?? null,
  fires: () => window.__fires ?? [],
  finishT: () => scene?.finishT?.() ?? -1,
  finishGeom: () => scene?.finishGeometry?.() ?? null,
  ports: () => ({ ...loaded.names, solid }),
  glassCount: () => scene?.glassList?.length ?? 0,
  show: id => { core.show(id); scene.layout(); scene.afterChange(); },
  hold: () => scene?.holdInfo?.() ?? null,
  fingertip: () => scene?.cursorPt ? { x: scene.cursorPt.x, y: scene.cursorPt.y } : null,
  video: () => ({ on: video.classList.contains('on'), w: video.videoWidth, h: video.videoHeight, flip: video.classList.contains('flip') })
};

core.on('dot', e => { scene?.event('dot', e); if (!e.silent) sound.dot(e.index, Math.max(3, e.total / 3)); });
core.on('stroke', e => { scene?.event('stroke', e); if (!e.silent) sound.strokeDone(); });
core.on('reveal', e => { scene?.event('reveal', e); if (!e.silent) sound.letterDone(); });
for (const n of ['start', 'near', 'lift', 'restart', 'done']) core.on(n, e => scene?.event(n, e));

// touch and mouse always win
const toCore = (type, e) => { if (started && scene && !scene.panelOpen) core.pointer({ type, ...pageToFrame({ x: e.clientX, y: e.clientY }, scene.frame), t: e.timeStamp }); };
addEventListener('pointerdown', e => {
  hand.noteDirect(e.timeStamp); if (!scene) return; sound.startAudio();
  scene.setCursor({ x: e.clientX, y: e.clientY }, true);
  if (scene.directControl(e.clientX, e.clientY)) return;
  toCore('down', e);
});
addEventListener('pointermove', e => { if (!scene) return; scene.setCursor({ x: e.clientX, y: e.clientY }, true); toCore('move', e); });
addEventListener('pointerup', e => toCore('up', e));
addEventListener('pointercancel', e => { if (started && !scene?.panelOpen) core.pointer({ type: 'cancel', x: 0, y: 0, t: e.timeStamp }); });
