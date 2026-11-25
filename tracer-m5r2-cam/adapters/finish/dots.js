// FINISH "dots": today's finish. The dot trail stays as it is; buttons are there at once; the burst comes with the reveal.
export default {
  name: 'dots',
  burstAt: 0,                // ms after the last dot when the juice burst fires
  buttonsAt: 0,              // ms after the last dot when Back/Again/Next show
  trailAlpha(t) { return 1; },   // 0..1: how visible the dot trail, guide and earned line are, t = ms since the last dot
  draw(g, f) { /* nothing extra: the board already shows the traced dots */ }
};
