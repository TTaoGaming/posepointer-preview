// CURSOR "ring": today's cursor. White-haloed dot, short white trail (when juice allows), hold ring on the dot.
export default {
  name: 'ring',
  trailMs: 260,
  draw(g, c) {
    const { x, y, r, alpha: a } = c, R = c.ringR, a0 = -Math.PI / 2;
    if (c.visible && a > .01) {
      if (c.trailOn) c.trail.forEach(p => { if (p.age >= 260) return; const k = p.age / 260; g.fillStyle(0xffffff, (1 - k) * .55 * a).fillCircle(p.x, p.y, r * (.9 - k * .6)); });
      g.fillStyle(0x000000, .3 * a).fillCircle(x, y + 3, r * 1.35);
      g.fillStyle(0xffffff, .35 * a).fillCircle(x, y, r * 1.9);
      g.fillStyle(0xffffff, a).fillCircle(x, y, r * 1.1);
      g.fillStyle(c.P.cursor, a).fillCircle(x, y, r * .72);
      g.fillStyle(0xffffff, .9 * a).fillCircle(x - r * .22, y - r * .24, r * .22);
    }
    if (c.hold) {
      const p = c.hold.p;
      g.lineStyle(9, 0x0b1020, .45); g.beginPath(); g.arc(c.hold.x, c.hold.y, R, 0, Math.PI * 2, false); g.strokePath();
      g.lineStyle(11, 0x0b1020, .8); g.beginPath(); g.arc(c.hold.x, c.hold.y, R, a0, a0 + p * Math.PI * 2, false); g.strokePath();
      g.lineStyle(6, 0xffffff, 1); g.beginPath(); g.arc(c.hold.x, c.hold.y, R, a0, a0 + p * Math.PI * 2, false); g.strokePath();
    }
    if (c.flash) { const k = c.flash.k; g.lineStyle(10 * (1 - k) + 2, 0x0b1020, .6 * (1 - k)); g.strokeCircle(c.flash.x, c.flash.y, R * (1 + k * .9)); g.lineStyle(6 * (1 - k) + 1, c.P.sun, 1 - k); g.strokeCircle(c.flash.x, c.flash.y, R * (1 + k * .9)); }
  }
};
