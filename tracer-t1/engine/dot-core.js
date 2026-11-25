// STUB dot engine. It follows engine-contract/VIEW-CONTRACT.md (the part a page uses) so the page can run before the
// real engine exists. It is NOT the shipped engine: no magnet, no item validation depth.
// Pure logic: no DOM, no timers, no storage. Time comes only from event t.
const DEFAULTS = { radius: 0.12, radiusBasis: 'screen', areaToScreen: 1, sweep: true, multiCatch: true, forgive: 2, nearRing: 2.5, cornerDeg: 50, dotSpacing: 0.2, liftMs: 250, shape: 'circle' };
const RANGE = { radius: [0.01, 0.5], areaToScreen: [0.05, 2], forgive: [0, 8], nearRing: [1, 6], cornerDeg: [10, 170], dotSpacing: [0.05, 0.6], liftMs: [50, 2000] };
const scale = (a) => (a <= 1 ? [a, 1] : [1, 1 / a]);

function genDots(points, a, s) {
  const [xs, ys] = scale(a);
  const u = points.map((p) => [p[0] * xs, p[1] * ys]);
  const pts = u.filter((p, i) => i === 0 || Math.hypot(p[0] - u[i - 1][0], p[1] - u[i - 1][1]) > 1e-9);
  if (pts.length === 1) return [pts[0]];
  const keep = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    const v1 = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]], v2 = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
    const turn = Math.abs(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1])) * 180 / Math.PI;
    if (turn >= s.cornerDeg) keep.push(i);
  }
  keep.push(pts.length - 1);
  const out = [pts[0]];
  for (let k = 1; k < keep.length; k++) {
    const A = pts[keep[k - 1]], B = pts[keep[k]];
    // length along the original polyline between kept points, split into equal parts no longer than dotSpacing
    let L = 0; for (let i = keep[k - 1] + 1; i <= keep[k]; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const parts = Math.max(1, Math.ceil(L / s.dotSpacing - 1e-9));
    for (let j = 1; j <= parts; j++) {
      const target = (L * j) / parts; let acc = 0, pos = B;
      for (let i = keep[k - 1] + 1; i <= keep[k]; i++) { const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc + seg >= target - 1e-12) { const f = seg ? (target - acc) / seg : 0; pos = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; break; } acc += seg; }
      out.push(j === parts ? B : pos);
    }
  }
  return out.map((p) => [p[0] / xs, p[1] / ys]);
}

export function createDotTracer(options = {}) {
  const set = {}; let order = [];
  const settings = { ...DEFAULTS };
  const listeners = {};
  let cur = null, strokes = [], si = 0, di = 0, done = 0, filled = 0, penDown = false, complete = false, lastP = null, lastT = -Infinity, prevDist = null;
  const emit = (name, data, out) => { const ev = { ...data, event: name, item: cur?.id ?? null }; out?.push(ev); for (const f of listeners[name] ?? []) { try { f(ev); } catch { /* listener errors never break the engine */ } } };
  const eff = () => (settings.radiusBasis === 'screen' ? settings.radius / settings.areaToScreen : settings.radius);
  function build(id) {
    const it = set[id]; const [xs, ys] = scale(it.aspect);
    strokes = it.strokes.map((s, k) => genDots(s.points, it.aspect, settings).map((p, i) => ({ stroke: k, index: i, x: p[0], y: p[1], ux: p[0] * xs, uy: p[1] * ys })));
    let n = 0; for (const s of strokes) for (const d of s) d.n = ++n;
    cur = { id, aspect: it.aspect, total: n };
  }
  function begin(id) { build(id); si = 0; di = 0; done = 0; filled = 0; penDown = false; complete = false; lastP = null; prevDist = null; lastT = -Infinity; emit("start", {}); }
  const api = {
    validateItemSet(o) { const errors = []; if (!o || o.format !== 'dot-tracer-items/1') errors.push('bad format'); if (!o?.items || !Object.keys(o.items).length) errors.push('no items'); return { ok: !errors.length, errors }; },
    loadItemSet(o) { const v = api.validateItemSet(o); if (!v.ok) return { ...v, count: 0 }; for (const k of Object.keys(set)) delete set[k]; Object.assign(set, structuredClone(o.items)); order = Object.keys(set); return { ok: true, errors: [], count: order.length }; },
    listItems: () => order.slice(),
    show(id) { if (!set[id]) return { ok: false, error: 'unknown_item' }; begin(id); return { ok: true, id }; },
    next() { if (!order.length) return { ok: false, error: 'no_items' }; const i = cur ? order.indexOf(cur.id) : -1; return api.show(order[(i + 1) % order.length]); },
    prev() { if (!order.length) return { ok: false, error: 'no_items' }; const i = cur ? order.indexOf(cur.id) : 0; return api.show(order[(i - 1 + order.length) % order.length]); },
    restart() { return cur ? (begin(cur.id), { ok: true, id: cur.id }) : { ok: false, error: 'nothing_shown' }; },
    repeat() { return api.restart(); },
    on(name, fn) { (listeners[name] ??= []).push(fn); return () => { listeners[name] = (listeners[name] ?? []).filter((f) => f !== fn); }; },
    tick() {},
    configure(o = {}) { const ignored = []; for (const [k, v] of Object.entries(o ?? {})) { if (!(k in DEFAULTS) || typeof v !== typeof DEFAULTS[k]) { ignored.push(k); continue; } settings[k] = RANGE[k] ? Math.min(RANGE[k][1], Math.max(RANGE[k][0], v)) : v; if (k === 'forgive') settings[k] = Math.round(settings[k]); } return { ok: true, ignored }; },
    getSettings: () => ({ ...settings }), getEffectiveRadius: eff,
    getItem: () => (cur ? { id: cur.id, aspect: cur.aspect, strokes: strokes.map((s) => s.map((d) => ({ x: d.x, y: d.y }))) } : null),
    getDots() { const out = []; strokes.forEach((s, k) => s.forEach((d) => out.push({ stroke: k, index: d.index, n: d.n, x: d.x, y: d.y, done: k < si || (k === si && d.index < di) || complete, next: !complete && k === si && d.index === di }))); return out; },
    getState: () => ({ item: cur?.id ?? null, strokeIndex: si, dotIndex: di, doneDots: done, filledDots: filled, totalDots: cur?.total ?? 0, strokeCount: strokes.length, complete, penDown, needLift: false, settings: { ...settings } }),
    pointer(ev) {
      const out = [];
      if (!cur || !ev || complete) return { accepted: false, events: out };
      const t = ev.t; if (!Number.isFinite(t) || t < lastT) return { accepted: false, events: out };
      if (ev.type === 'up' || ev.type === 'cancel') { lastT = t; if (penDown) { penDown = false; emit('lift', {}, out); } lastP = null; prevDist = null; return { accepted: true, events: out }; }
      if ((ev.type !== 'down' && ev.type !== 'move') || !Number.isFinite(ev.x) || !Number.isFinite(ev.y)) return { accepted: false, events: out };
      lastT = t;
      const [xs, ys] = scale(cur.aspect); const P = [ev.x * xs, ev.y * ys];
      if (ev.type === 'down') { penDown = true; lastP = null; prevDist = null; } else penDown = true;
      const R = eff();
      const prev = lastP && Math.hypot(P[0] - lastP[0], P[1] - lastP[1]) <= 0.4 ? lastP : null;
      const seg = (d) => { // closest approach of path prev->P to dot d: {dist, s}
        if (!settings.sweep || !prev) return { dist: Math.hypot(P[0] - d.ux, P[1] - d.uy), s: 1 };
        const vx = P[0] - prev[0], vy = P[1] - prev[1], L2 = vx * vx + vy * vy;
        const s = L2 ? Math.max(0, Math.min(1, ((d.ux - prev[0]) * vx + (d.uy - prev[1]) * vy) / L2)) : 1;
        return { dist: Math.hypot(prev[0] + vx * s - d.ux, prev[1] + vy * s - d.uy), s };
      };
      const stroke = strokes[si]; let sPrev = 0, caught = 0;
      const nd0 = stroke[di]; const distNext = Math.hypot(P[0] - nd0.ux, P[1] - nd0.uy);
      const closing = prevDist !== null && distNext < prevDist; prevDist = distNext;
      if (distNext <= settings.nearRing * R) { const dx = P[0] - nd0.ux, dy = P[1] - nd0.uy, m = Math.hypot(dx, dy) || 1; emit('near', { stroke: si, index: di, dist: distNext, dir: [dx / m, dy / m] }, out); }
      for (;;) {
        const here = stroke[di]; if (!here) break;
        let hit = here, skip = [];
        let r0 = seg(here);
        if (!(r0.dist <= R && r0.s >= sPrev) && di > 0 && !closing && settings.forgive > 0 && caught === 0) {
          for (let k = 1; k <= settings.forgive; k++) { const d = stroke[di + k]; if (!d) break; const r = seg(d); if (r.dist <= R && r.s >= sPrev) { hit = d; skip = stroke.slice(di, di + k); r0 = r; break; } }
        }
        if (!(r0.dist <= R && r0.s >= sPrev)) break;
        for (const d of skip) { di++; done++; filled++; emit('dot', { stroke: si, index: d.index, n: d.n, total: cur.total, strokeStart: d.index === 0, filled: true }, out); }
        di++; done++; caught++; sPrev = r0.s;
        emit('dot', { stroke: si, index: hit.index, n: hit.n, total: cur.total, strokeStart: hit.index === 0, filled: false }, out);
        if (di >= stroke.length) {
          emit('stroke', { stroke: si }, out);
          if (si + 1 >= strokes.length) { complete = true; emit('done', {}, out); emit('reveal', { image: set[cur.id].reveal?.image ?? null }, out); }
          else { si++; di = 0; penDown = false; lastP = null; prevDist = null; emit('lift', {}, out); }
          break;
        }
        if (!settings.multiCatch) break;
      }
      if (!complete && penDown) lastP = P;
      return { accepted: true, events: out };
    }
  };
  return api;
}
