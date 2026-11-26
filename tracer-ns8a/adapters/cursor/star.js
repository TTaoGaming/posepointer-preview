// CURSOR "star": a small sun-yellow star that turns slowly. The hold ring surrounds it.
const star = (g, x, y, R, r, rot) => { const pts = []; for (let i = 0; i < 10; i++) { const a = rot + i * Math.PI / 5, rr = i % 2 ? r : R; pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr }); } g.fillPoints(pts, true); };
export default {
  name: 'star',
  trailMs: 0,
  draw(g, c) {
    const { x, y, r, alpha: a } = c, R = c.ringR, a0 = -Math.PI / 2, rot = -Math.PI / 2 + c.t * .0012;
    if (c.visible && a > .01) {
      g.fillStyle(0x000000, .3 * a); star(g, x, y + 3, r * 1.9, r * 1.0, rot);
      g.fillStyle(0xffffff, a); star(g, x, y, r * 1.95, r * 1.05, rot);
      g.fillStyle(c.P.sunEdge, a); star(g, x, y, r * 1.6, r * .85, rot);
      g.fillStyle(c.P.sun, a); star(g, x, y, r * 1.4, r * .72, rot);
    }
    if (c.hold) {
      const p = c.hold.p;
      g.lineStyle(11, 0x0b1020, .8); g.beginPath(); g.arc(c.hold.x, c.hold.y, R, a0, a0 + p * Math.PI * 2, false); g.strokePath();
      g.lineStyle(6, 0xffffff, 1); g.beginPath(); g.arc(c.hold.x, c.hold.y, R, a0, a0 + p * Math.PI * 2, false); g.strokePath();
    }
    if (c.flash) { const k = c.flash.k; g.lineStyle(6 * (1 - k) + 1, c.P.sun, 1 - k); g.strokeCircle(c.flash.x, c.flash.y, R * (1 + k * .9)); }
  }
};
