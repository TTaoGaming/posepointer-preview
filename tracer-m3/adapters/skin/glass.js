// SKIN "glass": controls only. Buttons, title pill, status pill and the settings panel are glass.
// Letter, dots and line are never glass. The blur is a DOM plate behind the canvas (c.glass); the canvas draws only
// the hold fill, a thin border and text on top. With reduced transparency c.reduced is true: solid plates, no blur.
const DARK = [16, 20, 28], AMBER = [255, 176, 46];
const BUTTON = { r: 28, fill: [...DARK, .42], border: 1.5, blur: 18 };
const PANEL_FILL = [...DARK, .82];
export default {
  name: 'glass',
  minTarget: 72,
  hideBoardUnderPanel: true,   // the settings panel is see-through, so the letter board is not drawn while it is open
  palette: { ctlInk: 0xffffff, ctlInkActive: 0x2b1c00, ctlIcon: 0xffffff, ctlShadow: true },
  plate(g, s, c) {
    if (c.open) return;   // main-screen controls are hidden while the panel is open
    const done = s.kind === 'done', fill = done ? [...AMBER, .8] : [...DARK, .42];
    if (c.reduced) { g.fillStyle(done ? 0xd98e12 : 0x10141c, .97).fillRoundedRect(s.x, s.y, s.w, s.h, s.r); g.lineStyle(1.5, 0xffffff, .35).strokeRoundedRect(s.x, s.y, s.w, s.h, s.r); return; }
    c.glass({ x: s.x, y: s.y, w: s.w, h: s.h, r: s.r, fill, border: 1.5, borderColor: [255, 255, 255, .28], blur: 18 });
  },
  button(g, b, c) {
    if (c.open) return;
    const r = BUTTON.r > b.h / 2 ? b.h / 2 : BUTTON.r;
    if (c.reduced) { g.fillStyle(0x10141c, .97).fillRoundedRect(b.x, b.y, b.w, b.h, r); }
    else c.glass({ x: b.x, y: b.y, w: b.w, h: b.h, r, fill: BUTTON.fill, border: BUTTON.border, borderColor: [255, 255, 255, .3], blur: BUTTON.blur });
    if (b.fill > .01) g.fillStyle(0xffb02e, .8).fillRoundedRect(b.x, b.y, Math.min(b.w, Math.max(r * 2, b.w * b.fill)), b.h, r);
    g.lineStyle(b.hov ? 3 : BUTTON.border, b.hov ? 0xffb02e : 0xffffff, b.hov ? 1 : .3).strokeRoundedRect(b.x, b.y, b.w, b.h, r);
  },
  panel(g, p, c) {
    g.fillStyle(0x000000, .35);
    g.fillRect(0, 0, p.screenW, p.y); g.fillRect(0, p.y + p.h, p.screenW, p.screenH - p.y - p.h); g.fillRect(0, p.y, p.x, p.h); g.fillRect(p.x + p.w, p.y, p.screenW - p.x - p.w, p.h);
    if (c.reduced) g.fillStyle(0x10141c, 1).fillRoundedRect(p.x, p.y, p.w, p.h, 30);
    else c.glass({ x: p.x, y: p.y, w: p.w, h: p.h, r: 30, fill: PANEL_FILL, border: 1.5, borderColor: [255, 255, 255, .3], blur: 18 });
    g.lineStyle(1.5, 0xffffff, .3).strokeRoundedRect(p.x, p.y, p.w, p.h, 30);
  },
  panelButton(g, b, c) {
    // a button inside the panel: no glass on glass, so a flat lighter plate
    g.fillStyle(0xffffff, b.off ? .05 : .12).fillRoundedRect(b.x, b.y, b.w, b.h, b.r);
    if (b.fill > .01) g.fillStyle(0xffb02e, .8).fillRoundedRect(b.x, b.y, Math.min(b.w, Math.max(b.r * 2, b.w * b.fill)), b.h, b.r);
    g.lineStyle(b.hov ? 3 : 1.5, b.hov ? 0xffb02e : 0xffffff, b.off ? .2 : b.hov ? 1 : .35).strokeRoundedRect(b.x, b.y, b.w, b.h, b.r);
  }
};
