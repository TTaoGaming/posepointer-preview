// TEMPLATE: a SKIN adapter. Copy to dist/adapters/skin/<yourname>.js, rename `name`, and use it with ?skin=<yourname>.
// A skin decides how the CONTROLS look: buttons, pills, the settings panel. It never draws the letter, dots or line.
// g is a drawing surface (fillStyle, lineStyle, fillRoundedRect, strokeRoundedRect, fillCircle, fillRect, ... see PORTS.md).
export default {
  name: 'template',        // lowercase letters, digits, dashes; same as the file name
  minTarget: 0,            // smallest button side in px (0 = the layout's own sizes, 72 = glass)
  palette: {},             // optional colour overrides: ctlInk (text on controls), ctlInkActive, ctlIcon
  // a pill or bar behind a title or status line. s = { x, y, w, h, r, kind: 'status'|'done'|undefined, fill?, edge?, ew?, depth?, al? } (x,y = top-left)
  plate(g, s, c) {
    g.fillStyle(c.P.plate, .97).fillRoundedRect(s.x, s.y, s.w, s.h, s.r);          // c.P: palette numbers (plate, edge, sun, sunEdge, shadow ...)
  },
  // a hold button. b = { x, y, w, h, r, fill: 0..1 hold progress (left to right), hov: true while held, id }
  button(g, b, c) {
    g.fillStyle(c.P.plate, .97).fillRoundedRect(b.x, b.y, b.w, b.h, b.r);
    if (b.fill > .01) g.fillStyle(c.P.sun, 1).fillRoundedRect(b.x, b.y, Math.max(b.r * 2, b.w * b.fill), b.h, b.r);   // the hold fill MUST show
    g.lineStyle(3, b.hov ? c.P.sunEdge : c.P.edge, 1).strokeRoundedRect(b.x, b.y, b.w, b.h, b.r);
  },
  // the settings panel and the dim behind it. p = { x, y, w, h, r, screenW, screenH }
  panel(g, p, c) {
    g.fillStyle(0x000000, .5).fillRect(0, 0, p.screenW, p.screenH);
    g.fillStyle(c.P.plate, .985).fillRoundedRect(p.x, p.y, p.w, p.h, p.r);
  },
  // a button inside the panel. b = { x, y, w, h, r, fill, hov, off }
  panelButton(g, b, c) {
    g.fillStyle(c.P.edge, b.off ? .08 : .14).fillRoundedRect(b.x, b.y, b.w, b.h, b.r);
    if (b.fill > .01) g.fillStyle(c.P.sun, 1).fillRoundedRect(b.x, b.y, Math.max(b.r * 2, b.w * b.fill), b.h, b.r);
  }
  // Glass: call c.glass({ x, y, w, h, r, fill: [r,g,b,a], border, borderColor: [r,g,b,a], blur }) instead of drawing a plate,
  // but only when c.reduced is false. When c.reduced is true draw a solid plate with g. See adapters/skin/glass.js.
};
