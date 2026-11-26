// TEMPLATE: a CURSOR adapter. Copy to dist/adapters/cursor/<yourname>.js and use it with ?cursor=<yourname>.
// Called every frame. Draw the fingertip cursor and the hold ring. It must show the hold filling.
export default {
  name: 'template',
  trailMs: 0,                                   // how long a trail you want kept, in ms (0 = none)
  // c = { visible, x, y, r (cursor radius px), alpha 0..1, ringR (hold ring radius px), t (ms), over (on a button),
  //       trailOn (the juice allows a trail), trail: [{x, y, age ms}] newest last,
  //       hold: null | { p: 0..1, x, y }  (a hold is running, p is the fill),
  //       flash: null | { k: 0..1, x, y }  (the hold just fired),
  //       P: { cursor, sun, sunEdge } colours as numbers }
  draw(g, c) {
    const a0 = -Math.PI / 2;
    if (c.visible && c.alpha > .01) g.fillStyle(c.P.cursor, c.alpha).fillCircle(c.x, c.y, c.r);
    if (c.hold) { g.lineStyle(8, 0xffffff, 1); g.beginPath(); g.arc(c.hold.x, c.hold.y, c.ringR, a0, a0 + c.hold.p * Math.PI * 2, false); g.strokePath(); }   // clockwise from 12 o'clock
    if (c.flash) g.lineStyle(6 * (1 - c.flash.k) + 1, c.P.sun, 1 - c.flash.k).strokeCircle(c.flash.x, c.flash.y, c.ringR * (1 + c.flash.k * .9));
  }
};
