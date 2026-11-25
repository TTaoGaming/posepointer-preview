// SKIN "sky": today's look. Solid plates, soft shadow, blue edge, sun-yellow fill while held.
const shadow = (g, P, x, y, w, h, r, depth) => { for (let i = 6; i >= 1; i--) g.fillStyle(P.shadow, .026 * depth).fillRoundedRect(x - i * 2.4, y + i * 2.8 + 3, w + i * 4.8, h + i * 3.6, r + i * 2.4); };
export default {
  name: 'sky',
  minTarget: 0,        // smallest button side in px (0 = the layout's own sizes)
  palette: {},         // colour overrides on top of the Look palette
  // pill / bar / panel plate behind a title, status or text
  plate(g, s, c) {
    const P = c.P, fill = s.fill ?? P.plate, edge = s.edge ?? P.edge, ew = s.ew ?? 3, depth = s.depth ?? 1, al = s.al ?? .97;
    shadow(g, P, s.x, s.y, s.w, s.h, s.r, depth);
    g.fillStyle(fill, al).fillRoundedRect(s.x, s.y, s.w, s.h, s.r);
    if (ew) g.lineStyle(ew, edge, 1).strokeRoundedRect(s.x, s.y, s.w, s.h, s.r);
  },
  // a dwell button: b.fill 0..1 is the hold progress (left to right)
  button(g, b, c) {
    const P = c.P; shadow(g, P, b.x, b.y, b.w, b.h, b.r, 1.1);
    g.fillStyle(P.plate, .97).fillRoundedRect(b.x, b.y, b.w, b.h, b.r);
    if (b.fill > .01) g.fillStyle(P.sun, 1).fillRoundedRect(b.x, b.y, Math.min(b.w, Math.max(b.r * 2, b.w * b.fill)), b.h, b.r);
    g.lineStyle(b.hov ? 5 : 3, b.hov ? P.sunEdge : P.edge, 1).strokeRoundedRect(b.x, b.y, b.w, b.h, b.r);
  },
  // settings panel background (and the dim behind it)
  panel(g, p, c) {
    const P = c.P; g.fillStyle(0x000000, .5).fillRect(0, 0, p.screenW, p.screenH);
    shadow(g, P, p.x, p.y, p.w, p.h, p.r, 2);
    g.fillStyle(P.plate, .985).fillRoundedRect(p.x, p.y, p.w, p.h, p.r); g.lineStyle(3, P.edge, 1).strokeRoundedRect(p.x, p.y, p.w, p.h, p.r);
  },
  panelButton(g, b, c) {
    const P = c.P; g.fillStyle(P.plate, 1).fillRoundedRect(b.x, b.y, b.w, b.h, b.r);
    g.fillStyle(P.edge, b.off ? .08 : .14).fillRoundedRect(b.x, b.y, b.w, b.h, b.r);
    if (b.fill > .01) g.fillStyle(P.sun, 1).fillRoundedRect(b.x, b.y, Math.min(b.w, Math.max(b.r * 2, b.w * b.fill)), b.h, b.r);
    g.lineStyle(b.hov ? 5 : 3, b.hov ? P.sunEdge : P.edge, b.off ? .4 : 1).strokeRoundedRect(b.x, b.y, b.w, b.h, b.r);
  }
};
