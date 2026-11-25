// JUICE "off": no particles, no bounce, no drop-in, no pulse. Sounds are not part of juice and keep working.
export default {
  name: 'off',
  flags: { bounce: false, dropIn: false, trail: false, pop: false, pulse: false },
  onDot() {}, onStroke() {}, onFinish() {}
};
