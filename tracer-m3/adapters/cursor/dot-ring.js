// CURSOR "dot-ring": a solid dot with a thin hold ring always around it; the ring fills clockwise while holding.
export default {
  name: 'dot-ring',
  trailMs: 0,
  draw(g, c) {
    const { x, y, r, alpha: a } = c, R = c.ringR * .8, a0 = -Math.PI / 2;
    if (c.visible && a > .01) {
      g.fillStyle(0x000000, .3 * a).fillCircle(x, y + 3, r * 1.1);
      g.fillStyle(0xffffff, a).fillCircle(x, y, r * .95);
      g.fillStyle(c.P.cursor, a).fillCircle(x, y, r * .72);
      g.lineStyle(5, 0x0b1020, .5 * a); g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2, false); g.strokePath();
      g.lineStyle(2.5, 0xffffff, .9 * a); g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2, false); g.strokePath();
    }
    if (c.hold) {
      const p = c.hold.p, hx = c.hold.x, hy = c.hold.y, Rh = c.ringR * .8;
      g.lineStyle(11, 0x0b1020, .8); g.beginPath(); g.arc(hx, hy, Rh, a0, a0 + p * Math.PI * 2, false); g.strokePath();
      g.lineStyle(6.5, c.P.sun, 1); g.beginPath(); g.arc(hx, hy, Rh, a0, a0 + p * Math.PI * 2, false); g.strokePath();
    }
    if (c.flash) { const k = c.flash.k; g.lineStyle(8 * (1 - k) + 2, c.P.sun, 1 - k); g.strokeCircle(c.flash.x, c.flash.y, c.ringR * (1 + k * .9)); }
  }
};
