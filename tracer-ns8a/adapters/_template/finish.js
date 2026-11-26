// TEMPLATE: a FINISH adapter. Copy to dist/adapters/finish/<yourname>.js and use it with ?finish=<yourname>.
// Decides what the child sees when the last dot is reached. t is always ms since the last dot.
export default {
  name: 'template',
  burstAt: 0,                 // ms when the juice burst fires
  buttonsAt: 0,               // ms when Back / Again / Next appear (they are hidden and not holdable before)
  trailAlpha(t) { return 1; },   // 0..1: how visible the dot trail, guide, earned line and dots are. 1 = keep them. Fade to 0 to hide them.
  // f = { t, strokes: [[{x,y}]] px points of each stroke (same data as the dots), fh: letter height px,
  //       frame: { left, top, width, height } px, h: screen height px, P: palette numbers }
  draw(g, f) {
    const W = 0.15 * f.fh, a = Math.min(1, f.t / 600);        // keep the stroke width 0.12 to 0.18 of the letter height
    g.lineStyle(W, 0x3b8f4f, a);
    f.strokes.forEach(s => { g.beginPath(); s.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.strokePath(); });
  }
};
