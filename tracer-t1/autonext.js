// AUTO NEXT on a visible timer. Pure logic, no DOM, no timers: the view feeds it the clock and the state every frame and draws `p`.
// After the showcase ends (the Back/Again/Next buttons are shown) a countdown of `lenMs` runs; its drawn part is p = elapsed / lenMs.
// When it reaches 1 it says fire ONCE. A hold on Again or Back during the countdown stops it for that letter. Off: never runs, never fires.
export const AUTO_DEFAULTS = { on: true, lenMs: 4000 };
export function createAutoNext(cfg = {}) {
  const C = { ...AUTO_DEFAULTS, ...cfg }; let startAt = null, fired = false, stopped = false;
  return {
    config: C,
    configure(o) { Object.assign(C, o); },
    // t ms; s = { complete (letter finished), shown (showcase over, buttons visible), holdId (id of the control being held, or null) }
    update(t, { complete, shown, holdId = null }) {
      if (!complete) { startAt = null; fired = false; stopped = false; return { running: false, p: 0, fire: false, stopped: false }; }
      if (!C.on || !shown) { startAt = null; return { running: false, p: 0, fire: false, stopped }; }
      startAt ??= t;
      if (!stopped && (holdId === 'again' || holdId === 'back')) stopped = true;
      if (stopped) return { running: false, p: 0, fire: false, stopped: true };
      const p = Math.max(0, Math.min(1, (t - startAt) / C.lenMs));
      let fire = false; if (p >= 1 && !fired) { fired = true; fire = true; }
      return { running: !fired, p, fire, stopped: false, elapsed: t - startAt };
    }
  };
}
