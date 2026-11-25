// JUICE "party": sparks on each dot, a glow on the earned line, a bigger burst at the finish.
export default {
  name: 'party',
  flags: { bounce: true, dropIn: true, trail: true, pop: true, pulse: true },
  onDot(e, spawn) { spawn(e.x, e.y, 14, 150, e.c.sun, true); spawn(e.x, e.y, 10, 110, e.c.earned, false); },
  onStroke(e, spawn) { spawn(e.x, e.y, 30, 240, e.c.sun, true); },
  onFinish(e, spawn) { spawn(e.x, e.y, 110, 560, e.c.sun, true); spawn(e.x, e.y, 60, 420, e.c.earned, false); spawn(e.x, e.y, 40, 300, 0xffffff, true); },
  // glow: drawn above the board along each earned stretch. e.strokes = [{ pts: [{x,y}] }], e.t ms, e.lw line width px
  glow(g, e) {
    const pulse = .5 + .5 * Math.sin(e.t * .005);
    e.strokes.forEach(s => {
      if (s.pts.length < 2) return;
      [[2.6, .07], [1.9, .1], [1.35, .14]].forEach(([k, al]) => { g.lineStyle(e.lw * k, e.c.sun, al * (.7 + .3 * pulse) * e.alpha); g.beginPath(); s.pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.strokePath(); });
    });
  }
};
