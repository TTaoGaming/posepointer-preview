// FINISH "clean-letter": the dot trail cross-fades (0.6 s) to one clean fat letter built from the same stroke points:
// a smooth curve through each stroke, round ends and joins, one flat colour, an outline and a soft shadow. No dots, no numbers.
// It holds still 1.5 s, then three stars and the juice burst, then the buttons.
const FADE = 600, STARS_AT = 400, BUTTONS = 2800;
const FILL = 0xff5c8a, OUTLINE = 0x8f2748, WIDTH = 0.15;   // stroke width / letter height
const smooth = (pts, step) => {                              // Catmull-Rom through the points, sampled about every `step` px
  if (pts.length < 2) return pts.slice();
  const out = [], P = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), L = Math.hypot(p2.x - p1.x, p2.y - p1.y), n = Math.max(2, Math.ceil(L / step));
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; out.push({ x: .5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3), y: .5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3) }); }
  }
  out.push(pts[pts.length - 1]); return out;
};
const starBox = f => f.starBox || { cx: f.frame.left + f.frame.width / 2, cy: f.frame.top + f.frame.height + f.h * .1, s: f.h * .05 };
const star = (g, x, y, R, r, rot = -Math.PI / 2) => { const pts = []; for (let i = 0; i < 10; i++) { const a = rot + i * Math.PI / 5, rr = i % 2 ? r : R; pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr }); } g.fillPoints(pts, true); };
const pass = (g, curves, w, col, al, dy = 0, caps = true) => { g.lineStyle(w, col, al); curves.forEach(c => { g.beginPath(); c.forEach((p, i) => i ? g.lineTo(p.x, p.y + dy) : g.moveTo(p.x, p.y + dy)); g.strokePath(); }); g.fillStyle(col, al); if (caps) curves.forEach(c => (al >= .99 ? c : [c[0], c[c.length - 1]]).forEach(p => g.fillCircle(p.x, p.y + dy, w / 2))); };   // round joins everywhere on solid passes; translucent passes only need the round ends (no bead marks)
export default {
  name: 'clean-letter',
  burstAt: STARS_AT,
  buttonsAt: BUTTONS,
  widthRatio: WIDTH, fillColor: FILL,
  trailAlpha(t) { return t < 0 ? 1 : Math.max(0, 1 - t / FADE); },
  // f: { t ms since last dot, strokes [[{x,y}]] in px, fh letter height px, frame {left,top,width,height}, h screen height, P palette }
  draw(g, f) {
    const a = Math.min(1, f.t / FADE), W = WIDTH * f.fh, curves = f.strokes.map(s => smooth(s, Math.max(3, W / 5)));
    const ol = Math.max(3, W * .1);
    for (let i = 3; i >= 1; i--) pass(g, curves, W + ol * 2 + i * W * .12, 0x1b2a4a, .07 * a, W * .09);   // soft shadow, drawn under
    pass(g, curves, W + ol * 2, OUTLINE, a);
    pass(g, curves, W, FILL, a);
    pass(g, curves, W * .22, 0xffd1de, .55 * a, -W * .18, false);                                                 // soft highlight, same colour family
    if (f.t >= STARS_AT) {
      const k = Math.min(1, (f.t - STARS_AT) / 600), B = starBox(f), cx = B.cx, y = B.cy, s = B.s;
      [-1, 0, 1].forEach((d, i) => { const kk = Math.max(0, Math.min(1, k * 1.6 - i * .2)), sz = s * (i === 1 ? 1.35 : 1) * (kk < .7 ? kk / .7 * 1.2 : 1.2 - (kk - .7) / .3 * .2);
        g.fillStyle(0x5a3300, kk); star(g, cx + d * s * 3.4, y + 1.5, sz * 1.1, sz * .6); g.fillStyle(f.P.sun, kk); star(g, cx + d * s * 3.4, y, sz, sz * .5); });
    }
  },
  // where the three finish stars sit when fully grown (for the overlap test): [{x,y,r}]
  stars(f) { const B = starBox(f); return [-1, 0, 1].map((d, i) => ({ x: B.cx + d * B.s * 3.4, y: B.cy, r: B.s * (i === 1 ? 1.35 : 1) * 1.2 * 1.1 })); },
  // used by the proofs: the centre-line length and the stroke width the finish uses, in px
  geometry(f) { const W = WIDTH * f.fh, c = f.strokes.map(s => smooth(s, Math.max(3, W / 5))); let len = 0; c.forEach(cv => { for (let i = 1; i < cv.length; i++) len += Math.hypot(cv[i].x - cv[i - 1].x, cv[i].y - cv[i - 1].y); }); return { width: W, length: len }; }
};
