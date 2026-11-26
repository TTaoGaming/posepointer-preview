// CURSOR "comet": a bright head with a glowing tail about 0.3 s long. The hold ring surrounds the head.
export default {
  name: 'comet',
  trailMs: 300,
  draw(g, c) {
    const { x, y, r, alpha: a } = c, R = c.ringR, a0 = -Math.PI / 2;
    if (c.visible && a > .01) {
      for (let i = c.trail.length - 1; i >= 0; i--) {
        const p = c.trail[i]; if (p.age >= 300) continue; const k = p.age / 300, f = (1 - k) * a;
        g.fillStyle(c.P.cursor, .16 * f).fillCircle(p.x, p.y, r * (1.9 - k * 1.2));
        g.fillStyle(0xffffff, .5 * f).fillCircle(p.x, p.y, r * (.9 - k * .65));
      }
      g.fillStyle(c.P.cursor, .3 * a).fillCircle(x, y, r * 2.2);
      g.fillStyle(0xffffff, a).fillCircle(x, y, r * 1.1);
      g.fillStyle(c.P.cursor, a).fillCircle(x, y, r * .7);
    }
    if (c.hold) {
      const p = c.hold.p;
      g.lineStyle(11, 0x0b1020, .8); g.beginPath(); g.arc(c.hold.x, c.hold.y, R, a0, a0 + p * Math.PI * 2, false); g.strokePath();
      g.lineStyle(6, 0xffffff, 1); g.beginPath(); g.arc(c.hold.x, c.hold.y, R, a0, a0 + p * Math.PI * 2, false); g.strokePath();
    }
    if (c.flash) { const k = c.flash.k; g.lineStyle(6 * (1 - k) + 1, c.P.sun, 1 - k); g.strokeCircle(c.flash.x, c.flash.y, R * (1 + k * .9)); }
  }
};
