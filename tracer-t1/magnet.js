// STICKY MAGNET DWELL. Pure logic: no DOM, no timers, no storage. The view feeds it the cursor and the controls every frame.
// Tao's own numbers from his pp-052 snap.js (units: share of the screen's short side): catch 0.04, let go 0.07, lock speed 0.08.
//  - A control CATCHES the cursor when the cursor is inside it, or within `catchR` of its edge while moving slower than `lockSpeed`.
//  - Once caught the fill keeps growing while the cursor stays within `letGo` of the control's edge. Tremor, drift and small steps outside never reset it.
//  - Beyond `letGo`: the fill PAUSES for up to `graceMs`; if the cursor comes back in time it carries on, else the control lets go (the view drains the fill).
//  - A hand that is missing right now (`miss`) pauses the fill; it does not reset it. A hidden cursor (finger lifted, hand gone for good) lets go at once.
//  - The cursor strictly inside ANOTHER control, and not inside the caught one, switches the catch (fresh fill): two controls never fill together.
//  - A pass-by cannot fire: the fill only grows with time spent near the control, 300 ms of crossing is under any hold time.
// The drawn cursor may ease toward the caught control's centre (`pull` in the result); the real pointer is never moved.
export const MAGNET_DEFAULTS = { on: true, catchR: 0.04, letGo: 0.07, graceMs: 400, lockSpeed: 0.08 };
export const distToRect = (p, r) => Math.hypot(Math.max(Math.abs(p.x - r.x) - r.w / 2, 0), Math.max(Math.abs(p.y - r.y) - r.h / 2, 0));
export function createMagnet(cfg = {}) {
  const C = { ...MAGNET_DEFAULTS, ...cfg };
  let caught = null, prog = 0, outFor = 0, last = null, lastPt = null, lastT = null, restarts = 0;
  const release = () => { if (caught) restarts++; caught = null; prog = 0; outFor = 0; };
  return {
    config: C,
    // t ms (any clock), cursor {x,y} or null, targets [{id,x,y,w,h,blocked,enterAt}] (x,y = centre), short = the screen's short side, holdMs, miss = hand missing this instant
    update(t, cursor, targets, { short, holdMs, miss = false }) {
      const dt = last === null ? 0 : Math.max(0, Math.min(250, t - last)); last = t;
      let speed = 0; if (cursor && lastPt && lastT !== null && t > lastT) speed = Math.hypot(cursor.x - lastPt.x, cursor.y - lastPt.y) / short / ((t - lastT) / 16.667); if (cursor) { lastPt = cursor; lastT = t; } else { lastPt = null; lastT = null; }
      const out = { caught: null, p: 0, fired: null, paused: false, pull: null, released: false, restarts };
      const live = targets.filter(b => !b.blocked), by = id => targets.find(b => b.id === id);
      if (caught) {
        const tg = by(caught);
        if (!tg || tg.blocked || !cursor) { release(); out.released = true; }
        else {
          const d = distToRect(cursor, tg), other = d > 0 ? live.find(o => o.id !== caught && distToRect(cursor, o) === 0) : null;
          if (other) { release(); out.released = true; caught = other.id; prog = Math.max(0, Math.min(400, other.enterAt != null ? t - other.enterAt : 0)); outFor = 0; }
          else if (d <= C.letGo * short) { if (!miss) prog += dt; outFor = 0; }
          else { if (!miss) outFor += dt; out.paused = true; if (outFor > C.graceMs) { release(); out.released = true; } }
        }
      }
      if (!caught && cursor) {
        let best = null, bd = Infinity;
        let bc = Infinity; for (const b of live) { const d = distToRect(cursor, b); const ok = d === 0 || (d <= C.catchR * short && speed <= C.lockSpeed); const cd = Math.hypot(cursor.x - b.x, cursor.y - b.y); if (ok && (d < bd || (d === bd && cd < bc))) { best = b; bd = d; bc = cd; } }   // R2: nearest plate wins; a tie goes to the nearer centre (M5 took the first in list order)
        if (best) { caught = best.id; prog = bd === 0 && best.enterAt != null ? Math.max(0, Math.min(400, t - best.enterAt)) : 0; outFor = 0; }
      }
      if (caught) {
        const tg = by(caught); out.caught = caught; out.p = Math.min(1, prog / holdMs); if (miss) out.paused = true; out.pull = tg ? { x: tg.x, y: tg.y } : null;
        if (prog >= holdMs) { out.fired = caught; out.firedLate = prog - holdMs; caught = null; prog = 0; outFor = 0; }
      }
      out.restarts = restarts; return out;
    },
    // fill 0..1 right now without moving the clock (for a read between frames)
    peek: holdMs => ({ caught, p: Math.min(1, prog / holdMs) }),
    reset() { release(); last = null; }
  };
}
