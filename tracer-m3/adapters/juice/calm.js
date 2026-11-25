// JUICE "calm": today's juice. Small puffs on dots, a star puff at each stroke end, a burst at the finish.
// flags say which motion the view may use. spawn(x, y, count, speed, colour, stars) makes particles.
export default {
  name: 'calm',
  flags: { bounce: true, dropIn: true, trail: true, pop: true, pulse: true },
  onDot(e, spawn) { spawn(e.x, e.y, 6, 90, e.c.earned, false); },
  onStroke(e, spawn) { spawn(e.x, e.y, 16, 170, e.c.sun, true); },
  onFinish(e, spawn) { spawn(e.x, e.y, 54, 420, e.c.sun, true); spawn(e.x, e.y, 24, 300, e.c.earned, false); }
};
