// TEMPLATE: a JUICE adapter. Copy to dist/adapters/juice/<yourname>.js and use it with ?juice=<yourname>.
// Juice is particles and motion. Sounds are not juice and always keep working.
export default {
  name: 'template',
  flags: { bounce: true, dropIn: true, trail: true, pop: true, pulse: true },   // which built-in motions stay on (all false = silent)
  // e = { x, y, index, total, c: { earned, sun, white } colours as numbers }.  spawn(x, y, count, speed px/s, colour, stars:boolean)
  onDot(e, spawn) { spawn(e.x, e.y, 6, 90, e.c.earned, false); },
  onStroke(e, spawn) { spawn(e.x, e.y, 16, 170, e.c.sun, true); },
  onFinish(e, spawn) { spawn(e.x, e.y, 54, 420, e.c.sun, true); },
  // OPTIONAL glow(g, e) drawn every frame over the board: e = { strokes: [{ pts: [{x,y}] }] earned stretch, lw line width px, t ms, alpha, c }
};
