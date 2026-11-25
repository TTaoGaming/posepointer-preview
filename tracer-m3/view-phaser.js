// VIEW ONLY. Reads the core's getters and events; never changes a dot or a pointer position.
// SKY look: soft blue gradient, one white letter plate, coral earned line, sun-yellow next star.
import Phaser from './vendor/phaser.esm.js';
import { LOOKS } from './looks.js';
import { DEFS, summary, TIPS } from './settings.js';

const P = { ...LOOKS.sky };
const rgba = a => `rgba(${a[0]},${a[1]},${a[2]},${a[3]})`;
const C = { white: 0xffffff };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const hex = n => '#' + n.toString(16).padStart(6, '0');
const lerp = (a, b, k) => a + (b - a) * k;
const mix = (c1, c2, k) => { const r = lerp(c1 >> 16, c2 >> 16, k), g = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, k), b = lerp(c1 & 255, c2 & 255, k); return (r << 16) | (g << 8) | (b | 0); };

export function createPhaserView({ core, mount, onControl, onReady, onSetting, onCopy, settings, adapters, solid = false, sfx = {} }) {
  let A = adapters; const JF = () => A.juice.flags; const ctlHex = () => hex(P.ctlInk ?? P.ink);
  const holdMs = () => settings.hold * 1000;
  class TracerScene extends Phaser.Scene {
    create() {
            this.board = this.add.graphics().setDepth(1);
      this.fx = this.add.graphics().setDepth(2); this.gl = this.add.graphics().setDepth(1.5); this.glassList = []; this.glassPool = []; this.glassHost = document.getElementById('glass'); this.look = 'sky'; this.rebuildP();
      this.ui = this.add.graphics().setDepth(3);
      this.cur = this.add.graphics().setDepth(30);
      this.hg = this.add.graphics().setDepth(25); this.handPts = null; this.miss = false; this.flash = null; this.cursorBtn = null; this.enterAt = 0;
      this.pg = this.add.graphics().setDepth(20);
      this.ptexts = {}; this.panelOpen = false; this.panelPage = 0; this.pbtns = []; this.copiedUntil = 0; this.drawn = false;
      const T = (size, depth = 4) => this.add.text(0, 0, '', { fontFamily: FONT, fontSize: size + 'px', fontStyle: 'bold', color: ctlHex() }).setOrigin(.5).setDepth(depth).setResolution(Math.max(1, window.devicePixelRatio || 1));
      this.statusText = T(24); this.title = T(60); this.line1 = T(22); this.line2 = T(22);
      this.btnText = ['Back', 'Again', 'Next'].map(() => T(28)); this.startText = T(30);
      this.btns = ['back', 'again', 'next'].map((id, i) => ({ id, label: ['Back', 'Again', 'Next'][i], x: 0, y: 0, w: 0, h: 0, fill: 0, blocked: false }));
      this.startBtn = { id: 'start', label: 'Start', x: 0, y: 0, w: 0, h: 0, fill: 0, blocked: false };
      this.gear = { id: 'gear', label: '', x: 0, y: 0, w: 0, h: 0, fill: 0, blocked: false };
      this.started = false; this.signal = true; this.cursorPt = null; this.cursorAlpha = 0; this.trail = [];
      this.parts = []; this.popAt = {}; this.itemT0 = -1e9; this.doneAt = -1e9; this.nearBoost = 0; this.lastTick = 0; this.flash = '';
      this.hold = null; this.statusMode = 'trace';
      this.spawn = (x, y, n, speed, color, stars) => this.puff({ x, y }, n, speed, color, stars); this.scale.on('resize', () => this.layout()); this.layout(); onReady(this);
    }

    // ---- layout: one place for every number
    layout() {
      const w = this.scale.width, h = this.scale.height, wide = w > h;
      const item = core.getItem(), aspect = item?.aspect ?? .77;
      let fh = (wide ? .52 : .40) * h, fw = fh * aspect;
      if (fw > w * (wide ? .6 : .8)) { fw = w * (wide ? .6 : .8); fh = fw / aspect; }
      const top = wide ? .175 * h : .20 * h;
      this.frame = { left: (w - fw) / 2, top: top + ((wide ? .52 : .40) * h - fh) / 2, width: fw, height: fh };
      const S = Math.max(fw, fh); core.configure({ areaToScreen: S / Math.min(w, h) });
      const mt = A.skin.minTarget || 0, bh = Math.max(wide ? .12 * h : .115 * h, mt), bw = wide ? .235 * w : .30 * w, gap = wide ? .025 * w : .02 * w;
      const by = Math.max(this.frame.top + fh + .115 * h + bh / 2, 0);
      this.btns.forEach((b, i) => { b.w = bw; b.h = bh; b.x = w / 2 + (i - 1) * (bw + gap); b.y = by; });
      Object.assign(this.startBtn, { w: Math.max(wide ? .28 * w : .62 * w, 1), h: wide ? .13 * h : .115 * h, x: w / 2, y: wide ? .60 * h : .56 * h });
      this.L = { w, h, wide, fh, r: Math.max(12, .042 * fh), lw: Math.max(11, .05 * fh), ui: wide ? h : Math.max(h * .8, w * 1.3) };
      const u = this.L.ui;
      this.btnText.forEach(t => t.setFontSize(Math.round(bh * (wide ? .36 : .27))));
      this.startText.setFontSize(Math.round(this.startBtn.h * .36));
      this.title.setFontSize(Math.round(Math.min(wide ? .1 * h : .13 * w, 90))).setWordWrapWidth(w * .9).setAlign('center');
      this.line1.setFontSize(Math.round(Math.max(15, wide ? .033 * h : .04 * w))); this.line2.setFontSize(this.line1.style.fontSize);
      this.line1.setText('Prepared for The Goddard School of Westminster'); this.line2.setText('Made by PosePointer');
      this.line1.setWordWrapWidth(w * .92).setAlign('center');
      this.btnText.forEach((t, i) => t.setText(this.btns[i].label)); this.startText.setText('Start'); this.title.setText('PosePointer Letters');
      this.layoutGear(); this.layoutPanel();
    }
    shade(t) { if (P.ctlShadow) t.setShadow(0, 1.5, '#0a0e18', 5, false, true); else t.setShadow(0, 0, '#000000', 0, false, false); }
    rebuildP() { Object.keys(P).forEach(k => delete P[k]); Object.assign(P, LOOKS[this.look] || LOOKS.sky, A.skin.palette || {}); if (this.title) [this.statusText, this.title, this.line1, this.line2, this.startText, ...this.btnText, ...Object.values(this.ptexts)].forEach(t => this.shade(t)); }
    setLook(name) { this.look = name; this.rebuildP(); this.looked = name; }
    setAdapters(a) { A = a; this.rebuildP(); this.layout(); this.glassList = []; }
    sctx() { return { P, reduced: solid, open: this.glassOk === false, t: this.time.now, glass: d => { if (this.glassOk) this.glassList.push(d); } }; }
    layoutGear() {
      const { w, h, wide } = this.L, gs = Math.max(wide ? .11 * h : .09 * h, A.skin.minTarget || 0);
      Object.assign(this.gear, wide ? { w: gs, h: gs, x: w - gs / 2 - .03 * h, y: gs / 2 + .03 * h } : { w: gs, h: gs, x: w / 2, y: .915 * h });
    }
    // settings panel geometry: wide = two columns, one page; phone = one column, 4 rows a page
    layoutPanel() {
      const { w, h, wide } = this.L, pad = .012 * h;
      const pn = this.panel = wide ? { x: .05 * w, y: .05 * h, w: .9 * w, h: .9 * h } : { x: .03 * w, y: .03 * h, w: .94 * w, h: .94 * h };
      const mt = A.skin.minTarget || 0, rhW = Math.max(.098 * h, mt * 1.1), per = wide ? (rhW > .098 * h ? 5 : 6) : 4; this.perPage = wide ? per * 2 : 4; this.pages = Math.ceil(DEFS.length / this.perPage); this.panelPage = Math.min(this.panelPage, this.pages - 1);
      const mk = (id, extra) => Object.assign({ id, x: 0, y: 0, w: 0, h: 0, fill: 0, blocked: false }, extra);
      const list = []; this.prow = [];
      const closeW = wide ? .17 * w : .40 * w, closeH = Math.max(wide ? .10 * h : .075 * h, mt);
      list.push(mk('close', { label: 'Close', x: pn.x + pn.w - closeW / 2 - pad * 2, y: pn.y + closeH / 2 + pad * 2, w: closeW, h: closeH }));
      this.ptitle = { x: pn.x + pad * 3, y: list[0].y };
      const rows = DEFS.slice(this.panelPage * this.perPage, this.panelPage * this.perPage + this.perPage);
      if (wide) {
        const top = pn.y + .135 * h, rh = rhW, cw = (pn.w - pad * 6) / 2, mw = .075 * w, bh = Math.max(rh * .88, mt);
        rows.forEach((d, i) => {
          const col = i < per ? 0 : 1, ri = i % per, cx = pn.x + pad * 2 + col * (cw + pad * 2), cy = top + ri * rh + rh / 2;
          const r = { def: d, label: { x: cx + pad, y: cy, w: cw * .34, align: 'left' } };
          const ctlRight = cx + cw - pad;
          if (d.kind === 'step') {
            const plus = mk(d.id + '+', { dir: 1, repeat: true, glyph: 'plus', w: mw, h: bh, x: ctlRight - mw / 2, y: cy });
            const minus = mk(d.id + '-', { dir: -1, repeat: true, glyph: 'minus', w: mw, h: bh, x: ctlRight - mw * 2 - cw * .20 - pad * 2 + mw / 2, y: cy });
            r.value = { x: (minus.x + plus.x) / 2, y: cy }; list.push(minus, plus);
          } else {
            const tw = mw * 2 + cw * .20 + pad * 2, tg = mk(d.id, { dir: 1, glyph: 'toggle', w: tw, h: bh, x: ctlRight - tw / 2, y: cy, def: d });
            r.value = { x: tg.x, y: cy }; list.push(tg);
          }
          this.prow.push(r);
        });
      } else {
        const top = pn.y + .12 * h, rh = .135 * h, cw = pn.w - pad * 4, bh = Math.max(.075 * h, mt);
        rows.forEach((d, i) => {
          const cx = pn.x + pad * 2, ty = top + i * rh, cy = ty + .085 * h;
          const r = { def: d, label: { x: cx + pad, y: ty + .022 * h, w: cw, align: 'left' } };
          if (d.kind === 'step') {
            const mw = cw * .27, minus = mk(d.id + '-', { dir: -1, repeat: true, glyph: 'minus', w: mw, h: bh, x: cx + mw / 2, y: cy }), plus = mk(d.id + '+', { dir: 1, repeat: true, glyph: 'plus', w: mw, h: bh, x: cx + cw - mw / 2, y: cy });
            r.value = { x: (minus.x + plus.x) / 2, y: cy }; list.push(minus, plus);
          } else { const tg = mk(d.id, { dir: 1, glyph: 'toggle', w: cw, h: bh, x: cx + cw / 2, y: cy, def: d }); r.value = { x: tg.x, y: cy }; list.push(tg); }
          this.prow.push(r);
        });
      }
      const fy = wide ? pn.y + .135 * h + per * rhW + .03 * h : pn.y + .12 * h + 4 * .135 * h + .005 * h;
      this.sumPos = { x: pn.x + pn.w / 2, y: fy + (wide ? 0 : .026 * h), w: pn.w * .92 };
      list.push(mk('copy', { label: 'Copy these settings', x: pn.x + pn.w / 2, y: wide ? fy + .08 * h : fy + .105 * h, w: wide ? .3 * w : .7 * w, h: Math.max(wide ? .085 * h : .065 * h, mt) }));
      if (this.pages > 1) {
        const ny = pn.y + pn.h - .06 * h, nw = wide ? .18 * w : .28 * w, nh = Math.max(.075 * h, mt), lx = wide ? pn.x + nw / 2 + pad * 2 : pn.x + pn.w * .27, rx = wide ? pn.x + pn.w - nw / 2 - pad * 2 : pn.x + pn.w * .73;
        list.push(mk('page-prev', { label: 'Back', x: lx, y: ny, w: nw, h: nh, off: this.panelPage === 0 }), mk('page-next', { label: 'More', x: rx, y: ny, w: nw, h: nh, off: this.panelPage === this.pages - 1 }));
        this.pageLabel = { x: pn.x + pn.w / 2, y: ny };
      }
      // keep fill state of buttons that survive a re-layout
      const old = new Map((this.pbtns || []).map(b => [b.id, b])); list.forEach(b => { const o = old.get(b.id); if (o) { b.fill = o.fill; b.blocked = o.blocked; } });
      this.pbtns = list;
    }
    finishGeometry() { return A.finish.geometry && this.finishCtx ? { ...A.finish.geometry(this.finishCtx), fh: this.finishCtx.fh, frame: this.finishCtx.frame, fa: this.fa } : { fa: this.fa }; }
    finishT() { return this.started && core.getState().complete ? this.time.now - this.doneAt : -1; }
    btnsShown() { const t = this.finishT(); return t < 0 || t >= (A.finish.buttonsAt || 0); }
    activeButtons() { return this.panelOpen ? this.pbtns.filter(b => !b.off) : (this.started ? [...(this.btnsShown() ? this.btns : []), this.gear] : [this.startBtn, this.gear]); }
    openPanel() { this.panelOpen = true; this.panelPage = 0; this.layoutPanel(); this.hold = null; this.blockUnderCursor(); }
    closePanel() { this.panelOpen = false; this.hold = null; this.blockUnderCursor(); }
    afterChange() { this.blockUnderCursor(); this.hold = null; this.popAt = {}; this.parts = []; this.statusMode = 'trace'; }
    blockUnderCursor() {
      this.activeButtons().forEach(b => { b.blocked = this.inside(b, this.cursorPt); b.fill = 0; });
    }
    inside(b, p) { return !!p && Math.abs(p.x - b.x) <= b.w / 2 && Math.abs(p.y - b.y) <= b.h / 2; }

    // ---- input from main
    setCursor(p, visible) {
      if (!visible || !p) { this.cursorFade = true; this.hold = null; this.cursorBtn = null; return; }
      this.cursorFade = false; this.cursorPt = p; this.cursorAlpha = 1;
      this.moveAt = performance.now();
      const hb = this.activeButtons().find(b => this.inside(b, p)) || null; if (hb !== this.cursorBtn) { this.cursorBtn = hb; this.enterAt = performance.now(); }
      this.trail.push({ x: p.x, y: p.y, t: this.time.now }); if (this.trail.length > 30) this.trail.shift();
    }
    setMiss(on) { this.miss = on; }
    setHand(pts) { this.handPts = pts; }
    liveFill(b) { const h = this.hold; return h && h.b === b && !b.blocked && !this.miss ? Math.min(1, (performance.now() - h.since) / holdMs()) : b.fill; }
    holdInfo() { const h = this.hold; return h ? { id: h.b.id, p: h.b.fill, restarts: h.restarts, paused: this.miss } : null; }
    setSignal(ok) { this.signal = ok; if (!ok) { this.cursorFade = true; this.hold = null; this.cursorBtn = null; } }
    begin() { this.started = true; this.blockUnderCursor(); this.statusMode = 'trace'; this.itemT0 = this.time.now; }
    directControl(x, y) {
      const b = this.activeButtons().find(v => this.inside(v, { x, y })); if (!b) return false;
      b.blocked = true; this.fire(b); return true;
    }
    fire(b) {
      const id = b.id;
      if (id === 'gear') { this.openPanel(); return; }
      if (id === 'close') { this.closePanel(); return; }
      if (id === 'page-prev' || id === 'page-next') { this.panelPage += id === 'page-next' ? 1 : -1; this.layoutPanel(); this.blockUnderCursor(); return; }
      if (id === 'copy') { Promise.resolve(onCopy?.()).then(() => { this.copiedUntil = this.time.now + 1800; }); this.copiedUntil = this.time.now + 1800; return; }
      if (b.glyph) { onSetting?.(b.glyph === 'toggle' ? b.def.id : b.id.slice(0, -1), b.dir); return; }
      onControl(id);
    }
    event(name, e) {
      const now = this.time.now;
      if (name === 'near') this.nearBoost = 1;
      if (name === 'start') { this.itemT0 = now; this.popAt = {}; this.parts = []; this.statusMode = 'trace'; this.layout(); }
      if (name === 'dot') {
        this.popAt[e.n] = now;
        const d = core.getDots().find(v => v.n === e.n); if (d) { const q = this.fp(d); A.juice.onDot({ x: q.x, y: q.y, index: e.index, total: e.total, c: this.jc() }, this.spawn); }
      }
      if (name === 'stroke') { const s = core.getItem().strokes[e.stroke], m = s[s.length - 1], q = this.fp(m); A.juice.onStroke({ x: q.x, y: q.y, c: this.jc() }, this.spawn); }
      if (name === 'done') { this.doneAt = now; this.statusMode = 'done'; this.burstPending = true; }
    }
    jc() { return { earned: P.earned, sun: P.sun, white: 0xffffff }; }
    puff(p, n, speed, color, stars = false) {
      const now = this.time.now;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (.4 + Math.random() * .8);
        this.parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * .25, born: now, life: 520 + Math.random() * 520, color: Math.random() < .3 ? C.white : color, size: (stars ? 7 : 4) + Math.random() * 5, star: stars && Math.random() < .7, rot: Math.random() * 6 });
      }
    }

    // ---- geometry
    bounce() { if (!JF().bounce) return 1; const k = (this.time.now - this.doneAt) / 560; return k >= 0 && k < 1 ? 1 + .06 * Math.sin(Math.PI * k) * (1 - .4 * k) : 1; }
    fp(p) {
      const f = this.frame, s = this.cs ?? 1, cx = f.left + f.width / 2, cy = f.top + f.height / 2;
      const x = f.left + p.x * f.width, y = f.top + p.y * f.height + (this.dropY ?? 0);
      return { x: cx + (x - cx) * s, y: cy + (y - cy) * s };
    }

    update(t, delta) {
      core.tick(t);
      const dt = Math.min(50, delta) / 1000;
      this.cs = this.bounce();
      const k = JF().dropIn ? Math.min(1, (t - this.itemT0) / 380) : 1;
      this.dropY = (1 - (1 - Math.pow(1 - k, 3))) * -26; this.boardAlpha = JF().dropIn ? Math.min(1, k * 1.6) : 1;
      const ft = this.finishT(); this.fa = ft < 0 ? 1 : A.finish.trailAlpha(ft);
      if (this.burstPending && ft >= (A.finish.burstAt || 0)) { this.burstPending = false; const f = this.frame; A.juice.onFinish({ x: f.left + f.width / 2, y: f.top + f.height / 2, c: this.jc() }, this.spawn); }
      if (this.cursorFade) this.cursorAlpha = Math.max(0, this.cursorAlpha - dt / .35);
      this.updateDwell(t);
      this.nearBoost *= .9;
      this.parts = this.parts.filter(p => { const age = t - p.born; if (age > p.life) return false; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt; p.vx *= .985; return true; });
      this.glassList = []; this.glassOk = true; this.drawBoard(t); this.drawUi(t); this.drawFx(t); this.drawPanel(t); this.drawCursor(t); this.flushGlass(); this.drawn = true;
    }

    updateDwell(t0) {
      // the hold runs on the wall clock (performance.now), one straight line 0 to 1 over the hold time; a slow frame only delays the picture, never the count
      const t = performance.now(), list = this.activeButtons(), hm = holdMs(), dms = this.lastU ? t - this.lastU : 16; this.lastU = t;
      const live = this.cursorAlpha > .3 && !this.cursorFade ? this.cursorPt : null;
      const hit = live && list.find(b => this.inside(b, live));
      list.forEach(b => { if (!this.inside(b, live)) b.blocked = false; });
      list.forEach(b => { if (b !== hit || b.blocked) b.fill = Math.max(0, b.fill - dms / 280); });
      if (!hit || hit.blocked) { this.hold = null; return; }
      const R = .035 * Math.min(this.L.w, this.L.h); // wander radius: his 0.035 of the shorter screen side
      if (!this.hold || this.hold.b !== hit) { this.hold = { b: hit, since: Math.min(t, Math.max(this.enterAt, t - 400)), ox: live.x, oy: live.y, first: this.enterAt, restarts: 0 }; hit.fill = 0; }
      else if (Math.hypot(live.x - this.hold.ox, live.y - this.hold.oy) > R) { this.hold.since = Math.min(t, Math.max(this.moveAt, t - 400)); this.hold.ox = live.x; this.hold.oy = live.y; this.hold.restarts++; hit.fill = 0; }
      if (this.miss) { this.hold.since += dms; return; } // no hand right now: the clock waits, nothing can fire
      const p = Math.min(1, (t - this.hold.since) / hm); hit.fill = p;
      if (p < 1) { clearTimeout(this.fireTimer); this.fireTimer = setTimeout(() => { if (this.hold && this.hold.b === hit) this.updateDwell(); }, Math.max(0, this.hold.since + hm - t) + 1); } // the fire does not wait for a slow frame
      if (t - this.lastTick > 230 && p < 1) { this.lastTick = t; sfx.tick?.(); }
      if (p >= 1) {
        sfx.pop?.();
        (window.__fires ??= []).push({ id: hit.id, at: performance.now(), enter: this.hold.first, restarts: this.hold.restarts, hold: hm, due: this.hold.since + hm, frame: dms });
        this.flash = { x: live.x, y: live.y, t: this.time.now };
        if (hit.repeat) { hit.fill = 0; this.hold = { b: hit, since: t, ox: live.x, oy: live.y, first: t, restarts: 0 }; this.fire(hit); return; } // one step per hold time, never faster
        hit.blocked = true; hit.fill = 1; this.hold = null; this.fire(hit); // re-arms only after the cursor leaves the control
        this.time.delayedCall(260, () => { list.forEach(b => b.fill = 0); });
      }
    }

    // ---- drawing
    txt(t, text, size, color) {
      const key = text + '|' + size + '|' + color; if (t.__k === key) return t; t.__k = key;
      t.setText(text); t.setFontSize(size); t.setColor(color); return t;
    }
    roundRect(g, x, y, w, h, r) { g.fillRoundedRect(x, y, w, h, Math.min(r, w / 2, h / 2)); }
    shadow(g, x, y, w, h, r, depth = 1) {
      for (let i = 6; i >= 1; i--) { g.fillStyle(P.shadow, .026 * depth).fillRoundedRect(x - i * 2.4, y + i * 2.8 + 3, w + i * 4.8, h + i * 3.6, r + i * 2.4); }
    }
    star(g, x, y, R, r, rot = -Math.PI / 2) {
      const pts = []; for (let i = 0; i < 10; i++) { const a = rot + i * Math.PI / 5, rr = i % 2 ? r : R; pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr }); }
      g.fillPoints(pts, true);
    }
    drawBoard(t) {
      const g = this.board; g.clear(); g.setAlpha(1);
      if (this.panelOpen && A.skin.hideBoardUnderPanel) { this.numTexts?.forEach(x => x.setVisible(false)); return; }
      if (!this.started) { this.numTexts?.forEach(x => x.setVisible(false)); return; }
      const { r, lw, w } = this.L, f = this.frame, state = core.getState(), item = core.getItem(); if (!item) return;
      const dots = core.getDots(), a = this.boardAlpha, op = settings.opacity, fa = this.fa ?? 1, af = a * fa;
      const cs = this.cs, pad = this.L.h * .045;
      const padX = Math.min(pad * 2.2, f.left - w * .05), px = f.left - padX, pw = f.width + padX * 2, py = f.top - pad + this.dropY, ph = f.height + pad * 2;
      const cx = f.left + f.width / 2, cy = f.top + f.height / 2;
      const pcx = cx + (px + pw / 2 - cx) * cs, pcy = cy + (py + ph / 2 - cy) * cs, pW = pw * cs, pH = ph * cs;
      const complete = state.complete;
      // the board plate: its opacity is the setting. At 0 nothing is drawn here and the mirror shows through.
      if (op > 0.01) {
        this.shadow(g, pcx - pW / 2, pcy - pH / 2, pW, pH, 34, a * op);
        g.fillStyle(P.plate, .96 * a * op).fillRoundedRect(pcx - pW / 2, pcy - pH / 2, pW, pH, 34);
      }
      g.lineStyle(complete ? 6 : 3, complete ? P.sun : P.plate, a * Math.max(.5, op)).strokeRoundedRect(pcx - pW / 2, pcy - pH / 2, pW, pH, 34);
      // dashed guide along every stroke: a solid halo under a strong colour so it reads over any picture
      const dash = Math.max(10, r * .9), gapL = dash * .85, gw = Math.max(6, lw * .36);
      const dashed = (width, col, al) => {
        item.strokes.forEach(stroke => {
          g.lineStyle(width, col, al * af); g.beginPath();
          for (let i = 0; i < stroke.length - 1; i++) {
            const A = this.fp(stroke[i]), B = this.fp(stroke[i + 1]), L = Math.hypot(B.x - A.x, B.y - A.y), ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
            for (let s = 0; s < L; s += dash + gapL) { const e = Math.min(L, s + dash); g.moveTo(A.x + ux * s, A.y + uy * s); g.lineTo(A.x + ux * e, A.y + uy * e); }
          }
          g.strokePath();
        });
      };
      if (fa > .01) { dashed(gw + 10, P.halo, .85 * (1 - .4 * op)); dashed(gw, P.guide, 1); }
      // earned line: thick, rounded, live to the cursor, with a plate-coloured outline
      const live = this.cursorAlpha > .3 && state.penDown && !complete && this.cursorPt;
      item.strokes.forEach((stroke, si) => {
        const done = dots.filter(d => d.stroke === si && d.done).map(d => this.fp(d));
        const pts = done.slice();
        if (live && si === state.strokeIndex && done.length) {
          const last = done[done.length - 1], c = this.cursorPt, dd = Math.hypot(c.x - last.x, c.y - last.y);
          if (dd < this.L.fh * .75) pts.push({ x: c.x, y: c.y, live: true });
        }
        if (pts.length < 1) return;
        const line = (width, col, al) => {
          g.lineStyle(width, col, al * af); g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.strokePath();
          g.fillStyle(col, al * af); pts.forEach(p => g.fillCircle(p.x, p.y, width / 2));
        };
        if (pts.length > 1 && fa > .01) { line(lw + 9, P.halo, .9); line(lw, P.earned, 1); line(lw * .3, P.earnedLite, .75); }
      });
      // dots: solid plates with an edge, so they read at every opacity
      const hidden = d => !d.done && !d.next && dots.some(o => !o.done && o.n < d.n && Math.hypot(o.x - d.x, o.y - d.y) * f.height < r * 1.6);
      dots.forEach(d => {
        if (hidden(d) || fa <= .01) return;
        const p = this.fp(d), pop = this.popAt[d.n] !== undefined ? (this.time.now - this.popAt[d.n]) / 300 : 2;
        const ps = pop < 1 && JF().pop ? 1 + .55 * Math.sin(Math.PI * pop) : 1;
        if (d.next) return;
        if (d.done) { g.fillStyle(P.plate, af).fillCircle(p.x, p.y, r * 1.12 * ps); g.fillStyle(P.earned, af).fillCircle(p.x, p.y, r * .8 * ps); }
        else { g.fillStyle(P.shadow, .22 * af).fillCircle(p.x, p.y + 2.5, r * 1.12); g.fillStyle(P.plate, af).fillCircle(p.x, p.y, r * 1.05); g.lineStyle(3.5, P.edge, af).strokeCircle(p.x, p.y, r * 1.05); }
      });
      // next dot: a bigger star, pulsing, with a plate-coloured outline
      const nd = dots.find(d => d.next);
      if (nd && !complete) {
        const p = this.fp(nd), pulse = 1 + (JF().pulse ? .09 * Math.sin(t * .007) : 0);
        const R = r * 2.15 * pulse;
        g.fillStyle(P.sun, (.16 + .16 * this.nearBoost) * a).fillCircle(p.x, p.y, R * 1.75);
        g.fillStyle(P.shadow, .28 * a); this.star(g, p.x, p.y + 4, R * 1.12, R * .62);
        g.fillStyle(P.plate, a); this.star(g, p.x, p.y, R * 1.16, R * .68);
        g.fillStyle(P.sunEdge, a); this.star(g, p.x, p.y + 1.5, R * 1.04, R * .56);
        g.fillStyle(P.sun, a); this.star(g, p.x, p.y, R, R * .54);
        if (nd.index === 0) {
          const s = item.strokes[nd.stroke], nx = this.fp(s[1]), L = Math.hypot(nx.x - p.x, nx.y - p.y) || 1, ux = (nx.x - p.x) / L, uy = (nx.y - p.y) / L;
          g.lineStyle(4, P.earned, a).strokeCircle(p.x, p.y, R * 1.32);
          const off = r * 4.3 + (JF().pulse ? 5 * Math.sin(t * .008) : 0), ax = p.x + ux * off, ay = p.y + uy * off, sz = r * 1.15;
          const tri = (k, col) => { g.fillStyle(col, a).fillTriangle(ax + ux * sz * k, ay + uy * sz * k, ax - ux * sz * .6 * k - uy * sz * .85 * k, ay - uy * sz * .6 * k + ux * sz * .85 * k, ax - ux * sz * .6 * k + uy * sz * .85 * k, ay - uy * sz * .6 * k - ux * sz * .85 * k); };
          tri(1.35, P.plate); tri(1, P.earned);
        }
      }
      // numbers: only on the stroke being traced, in the dot plates; text objects pooled
      this.numTexts ??= [];
      let used = 0;
      if (!complete && settings.numbers && !this.panelOpen) dots.forEach(d => {
        if (d.done || hidden(d) || d.stroke !== state.strokeIndex) return;
        const p = this.fp(d); let tx = this.numTexts[used]; if (!tx) { tx = this.numTexts[used] = this.add.text(0, 0, '', { fontFamily: FONT, fontStyle: 'bold' }).setOrigin(.5).setDepth(5).setResolution(Math.max(1, window.devicePixelRatio || 1)); }
        used++; tx.setVisible(true).setAlpha(a).setPosition(p.x, p.y + (d.next ? 1.5 : 0)); this.txt(tx, String(d.index + 1), Math.round(r * (d.next ? 1.25 : 1.0)), d.next ? P.sunInk : hex(P.ink));
      });
      for (let i = used; i < this.numTexts.length; i++) this.numTexts[i].setVisible(false);
    }
    // a solid rounded plate (button, pill)
    plate(g, x, y, w, h, r, o = {}) { A.skin.plate(g, { x, y, w, h, r, ...o }, this.sctx()); }
    drawUi(t) {
      const g = this.ui; g.clear(); const { w, h, wide } = this.L;
      const open = this.panelOpen; this.glassOk = !open;
      if (!this.started) {
        const sb = this.startBtn;
        this.title.setVisible(!open).setColor(ctlHex()); this.title.setPosition(w / 2, wide ? .33 * h : .30 * h);
        const my = (wide ? .17 : .14) * h, ms = wide ? .02 * h : Math.min(.02 * h, .033 * w);
        // plates behind title and lines so they read over a picture
        if (!open) {
          const tw = this.title.width + ms * 4, th = this.title.height + ms * 1.2;
          this.plate(g, w / 2 - tw / 2, this.title.y - th / 2, tw, th, th * .3, { ew: 0, depth: .8, al: .97 });
          this.plate(g, w / 2 - ms * 8.5, my - ms * 8.2, ms * 17, ms * 12.5, ms * 3, { ew: 0, depth: .6, al: .97 });
          g.lineStyle(ms * .8, P.earned, 1); g.beginPath(); g.moveTo(w / 2 - ms * 5, my + ms * 2); g.lineTo(w / 2 - ms * 1.5, my - ms * 2); g.lineTo(w / 2 + ms * 2, my + ms * 2); g.strokePath();
          [[-5, 2], [-1.5, -2], [2, 2]].forEach(([dx, dy]) => { g.fillStyle(P.plate, 1).fillCircle(w / 2 + dx * ms, my + dy * ms, ms * 1.1); g.lineStyle(3, P.edge, 1).strokeCircle(w / 2 + dx * ms, my + dy * ms, ms * 1.1); });
          g.fillStyle(P.sun, 1); this.star(g, w / 2, my - ms * 5.2, ms * 2.2, ms * 1.15);
        }
        this.drawButton(g, sb, this.startText, t);
        this.line1.setPosition(w / 2, sb.y + sb.h / 2 + (wide ? .09 * h : .07 * h)).setVisible(!open).setAlpha(1).setColor(ctlHex());
        this.line2.setPosition(w / 2, this.line1.y + this.line1.height + (wide ? .02 * h : .015 * h)).setVisible(!open).setAlpha(1).setColor(ctlHex());
        if (!open) {
          const lw1 = Math.max(this.line1.width, this.line2.width) + ms * 3, lh = this.line2.y + this.line2.height / 2 - (this.line1.y - this.line1.height / 2) + ms * 1.4;
          const ly = this.line1.y - this.line1.height / 2 - ms * .7; // plate behind both lines (drawn before text objects since texts have higher depth)
          this.plate(g, w / 2 - lw1 / 2, ly, lw1, lh, ms * 1.6, { ew: 0, depth: .5, al: .97 });
        }
        this.drawGear(g, t);
        this.statusText.setVisible(false); this.btnText.forEach(x => x.setVisible(false)); this.startText.setVisible(!open);
        return;
      }
      this.title.setVisible(false); this.line1.setVisible(false); this.line2.setVisible(false); this.startText.setVisible(false);
      const bs = this.btnsShown(); this.btns.forEach((b, i) => { if (bs) this.drawButton(g, b, this.btnText[i], t, i); this.btnText[i].setVisible(!open && bs); });
      this.drawGear(g, t);
      const id = core.getItem()?.id ?? '', ch = id.split('-')[1] ?? '';
      const done = this.statusMode === 'done', lost = !this.signal && !done;
      const text = done ? `Great job! That's ${ch}` : lost ? 'Show your hand' : `Trace the letter ${ch}`;
      const size = Math.round(done ? (wide ? .043 * h : .036 * h) : (wide ? .036 * h : .03 * h));
      this.statusText.setVisible(!open); this.txt(this.statusText, text, size, done ? (P.ctlInkActive ? hex(P.ctlInkActive) : P.sunInk) : ctlHex());
      const badge = done ? size * 1.5 : 0;
      const pw = this.statusText.width + size * 1.8 + badge, ph = size * 1.9, py = wide ? .065 * h : .09 * h;
      this.statusText.setPosition(w / 2 + badge / 2, py);
      this.plate(g, w / 2 - pw / 2, py - ph / 2, pw, ph, ph / 2, { fill: done ? 0xfff3c4 : P.plate, edge: P.sun, ew: done ? 4 : 0, depth: .8, al: .95, kind: done ? 'done' : 'status' });
      if (done) { // a star badge that stays
        const bx = w / 2 - pw / 2 + size * 1.25, R = size * .7;
        g.fillStyle(P.sunEdge, 1); this.star(g, bx, py + 1.5, R * 1.05, R * .56);
        g.fillStyle(P.sun, 1); this.star(g, bx, py, R, R * .54);
      }
    }
    drawGear(g, t) {
      const b = this.gear; if (this.panelOpen) return;
      this.drawButton(g, b, null, t);
      const x = b.x, y = b.y - (b.fill > 0 ? 2 : 0), R = b.h * .3, pts = [];
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; [[-.2, .78], [-.13, 1], [.13, 1], [.2, .78]].forEach(([da, k]) => pts.push({ x: x + Math.cos(a + da) * R * k * 1.12, y: y + Math.sin(a + da) * R * k * 1.12 })); }
      const gc = P.ctlIcon ?? P.edge; g.fillStyle(gc, 1).fillPoints(pts, true); g.fillStyle(gc, 1).fillCircle(x, y, R * .9); g.fillStyle(b.fill > .35 ? P.sun : (P.ctlIcon ? 0x2a3550 : P.plate), 1).fillCircle(x, y, R * .42);
    }
    drawButton(g, b, label, t, i = 0) {
      const x = b.x - b.w / 2, y = b.y - b.h / 2, r = b.h * .36, hov = b.fill > 0;
      const lift = hov ? 2 : 0;
      A.skin.button(g, { x, y: y - lift, w: b.w, h: b.h, r, fill: b.fill, hov, id: b.id }, this.sctx());
      if (!label) return;
      label.setColor(b.fill > .3 ? (P.ctlInkActive ? hex(P.ctlInkActive) : P.sunInk) : ctlHex());
      const noIcon = !this.L.wide && b.id !== 'start', s = noIcon ? 0 : b.h * .17, gapI = noIcon ? 0 : s * 1.6, total = s * 2 + gapI + label.width, ix = b.x - total / 2 + s, iy = b.y - lift;
      label.setVisible(true).setPosition(b.x - total / 2 + s * 2 + gapI + label.width / 2, iy);
      if (noIcon) return;
      g.fillStyle(b.fill > .3 ? 0x5a3300 : (P.ctlIcon ?? P.edge), 1);
      if (b.id === 'back') g.fillTriangle(ix + s, iy - s, ix + s, iy + s, ix - s, iy);
      else if (b.id === 'next' || b.id === 'start') g.fillTriangle(ix - s, iy - s, ix - s, iy + s, ix + s, iy);
      else { g.lineStyle(s * .6, b.fill > .3 ? 0x5a3300 : (P.ctlIcon ?? P.edge), 1); g.beginPath(); g.arc(ix, iy, s, -2.6, 2.4, false); g.strokePath(); g.fillTriangle(ix + s * .6, iy - s * 1.35, ix + s * 1.5, iy - s * .3, ix - s * .1, iy - s * .3); }
    }
    // ---- settings panel
    ptxt(key, text, x, y, size, color, align = .5, wrap = 0) {
      const tx = this.ptexts[key] ?? (this.ptexts[key] = this.add.text(0, 0, '', { fontFamily: FONT, fontStyle: 'bold' }).setDepth(21).setResolution(Math.max(1, window.devicePixelRatio || 1)));
      if (!tx.__shaded) { tx.__shaded = true; this.shade(tx); } tx.__used = true; tx.setVisible(true).setOrigin(align, .5).setPosition(x, y).setWordWrapWidth(wrap || 0).setAlign(align === 0 ? 'left' : 'center');
      this.txt(tx, text, size, color); return tx;
    }
    drawPanel(t) {
      const g = this.pg; g.clear(); this.glassOk = true;
      Object.values(this.ptexts).forEach(tx => { tx.__used = false; });
      if (this.panelOpen) {
        const { w, h, wide } = this.L, pn = this.panel, ink = ctlHex(), fs = wide ? .03 * h : .026 * h;
        A.skin.panel(g, { x: pn.x, y: pn.y, w: pn.w, h: pn.h, r: 30, screenW: w, screenH: h }, this.sctx());
        this.ptxt('title', 'Settings', this.ptitle.x, this.ptitle.y, Math.round(wide ? .055 * h : .04 * h), ink, 0);
        this.prow.forEach(r => {
          const d = r.def;
          this.ptxt('lab-' + d.id, d.label, r.label.x, r.label.y, Math.round(fs * (wide ? 1 : .95)), ink, 0);
          const toggle = d.kind === 'toggle';
          const tb = toggle ? this.pbtns.find(b => b.id === d.id) : null;
          this.ptxt('val-' + d.id, d.show(settings), r.value.x, r.value.y, Math.round(fs * (toggle ? 1.15 : 1.05)), tb && tb.fill > .3 ? (P.ctlInkActive ? hex(P.ctlInkActive) : P.sunInk) : ink, .5);
        });
        this.pbtns.forEach(b => {
          if (b.off) { b.fill = 0; }
          this.drawPanelButton(g, b, fs);
        });
        // the line he can read his numbers back from
        this.ptxt('sum', summary(settings), this.sumPos.x, this.sumPos.y, Math.round(wide ? .022 * h : (A.skin.minTarget ? .0155 : .0185) * h), ink, .5, this.sumPos.w);
        if (this.pages > 1) this.ptxt('pagelab', `${this.panelPage + 1} of ${this.pages}`, this.pageLabel.x, this.pageLabel.y, Math.round(fs), ink, .5);
        if (this.time.now < this.copiedUntil) this.ptxt('copied', 'Copied', this.sumPos.x, this.sumPos.y - (wide ? .045 * h : .06 * h), Math.round(fs), P.ctlIcon ? ctlHex() : hex(P.edge), .5);
      }
      Object.values(this.ptexts).forEach(tx => { if (!tx.__used) tx.setVisible(false); });
    }
    drawPanelButton(g, b, fs) {
      const x = b.x - b.w / 2, y = b.y - b.h / 2, r = Math.min(b.h * .3, 24), hov = b.fill > 0, ink = ctlHex();
      A.skin.panelButton(g, { x, y, w: b.w, h: b.h, r, fill: b.fill, hov, off: !!b.off }, this.sctx());
      const col = b.fill > .3 ? (P.ctlInkActive ? hex(P.ctlInkActive) : P.sunInk) : ink, lc = b.fill > .3 ? 0x5a3300 : (P.ctlIcon ?? P.ink);
      if (b.glyph === 'minus' || b.glyph === 'plus') {
        const s = b.h * .26; g.lineStyle(Math.max(6, b.h * .1), lc, 1);
        g.beginPath(); g.moveTo(b.x - s, b.y); g.lineTo(b.x + s, b.y); if (b.glyph === 'plus') { g.moveTo(b.x, b.y - s); g.lineTo(b.x, b.y + s); } g.strokePath();
      } else if (b.glyph === 'toggle') {
        // the value word sits on the button: redraw it on top by moving its text to the button
        /* value word is drawn in drawPanel with a colour from this button's fill */
      } else if (b.label) {
        this.ptxt('btn-' + b.id, b.label, b.x, b.y, Math.round(fs * 1.1), b.off ? (P.ctlIcon ? '#9aa4b4' : hex(P.edge)) : col, .5);
      }
    }
    drawFx() {
      const g = this.fx; g.clear(); const now = this.time.now;
      this.gl.clear();
      const ft = this.finishT(), item = core.getItem();
      if (A.juice.glow && this.started && item && ft < 0) {
        const dots = core.getDots(), strokes = item.strokes.map((s, si) => ({ pts: dots.filter(d => d.stroke === si && d.done).map(d => this.fp(d)) }));
        A.juice.glow(this.gl, { strokes, lw: this.L.lw, t: now, alpha: this.boardAlpha, c: this.jc() });
      }
      if (ft >= 0 && item) {
        const f = this.frame;
        this.finishCtx = { t: ft, strokes: item.strokes.map(s => s.map(q => this.fp(q))), fh: f.height * (this.cs ?? 1), frame: { left: f.left, top: f.top, width: f.width, height: f.height }, h: this.L.h, P };
        A.finish.draw(g, this.finishCtx);
      }
      this.parts.forEach(p => {
        const k = (now - p.born) / p.life, al = 1 - k * k; g.fillStyle(p.color, al);
        if (p.star) { this.star(g, p.x, p.y, p.size * (1 - k * .4), p.size * .45 * (1 - k * .4), p.rot + k * 3); } else g.fillCircle(p.x, p.y, p.size * (1 - k * .5));
      });
    }
    drawHand(t) {
      const g = this.hg; g.clear(); const pts = this.handPts;
      if (!pts || !settings.outline || pts.length !== 21) return;
      const u = Math.min(this.L.w, this.L.h), tipI = TIPS[settings.tip] ?? 8;
      const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
      const lw = Math.max(3, u * .006);
      g.lineStyle(lw + 5, 0x0b1020, .6); BONES.forEach(([i, j]) => { g.beginPath(); g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[j].x, pts[j].y); g.strokePath(); });
      g.lineStyle(lw, 0xffffff, .95); BONES.forEach(([i, j]) => { g.beginPath(); g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[j].x, pts[j].y); g.strokePath(); });
      const jr = Math.max(4, u * .0085);
      pts.forEach((p, i) => { if (i === tipI) return; g.fillStyle(0x0b1020, .75).fillCircle(p.x, p.y, jr + 2.5); g.fillStyle(0xffffff, 1).fillCircle(p.x, p.y, jr); });
      const c = pts[tipI], tr = jr * 2.3;
      g.fillStyle(0x0b1020, .85).fillCircle(c.x, c.y, tr + 3.5); g.fillStyle(0xffffff, 1).fillCircle(c.x, c.y, tr + 1); g.fillStyle(P.sun, 1).fillCircle(c.x, c.y, tr - 2);
    }
    drawCursor(t) {
      const g = this.cur; g.clear(); this.drawHand(t);
      const base = Math.max(13, Math.min(this.L.w, this.L.h) * .024); let a = this.cursorAlpha, r = base;
      const visible = a > .01 && !!this.cursorPt;
      const over = visible && this.activeButtons().some(b => this.inside(b, this.cursorPt)); if (over) { a *= .5; r *= .6; }
      const keep = A.cursor.trailMs ?? 0, show = Math.max(keep, 260);
      this.trail = this.trail.filter(p => t - p.t < show);
      const h = this.hold, c = this.cursorPt;
      const ring = h && !h.b.blocked && c && h.b.fill > 0.005 ? { p: h.b.fill, x: c.x, y: c.y } : null;
      let flash = null; if (this.flash) { const k = (t - this.flash.t) / 380; if (k >= 1) this.flash = null; else flash = { k, x: this.flash.x, y: this.flash.y }; }
      A.cursor.draw(g, { visible, x: c?.x ?? 0, y: c?.y ?? 0, r, alpha: a, ringR: base * 2.5, t, over, trailOn: JF().trail, trail: this.trail.map(p => ({ x: p.x, y: p.y, age: t - p.t })), hold: ring, flash, P: { cursor: P.cursor, sun: P.sun, sunEdge: P.sunEdge } });
    }
    flushGlass() {
      const host = this.glassHost; if (!host) return; const L = this.glassList, pool = this.glassPool, base = 'position:absolute;pointer-events:none;box-sizing:border-box;box-shadow:0 8px 24px rgba(8,12,24,.18);';
      while (pool.length < L.length) { const d = document.createElement('div'); d.style.cssText = base; host.appendChild(d); pool.push(d); }
      pool.forEach((d, i) => {
        const e = L[i]; if (!e) { if (d.style.display !== 'none') d.style.display = 'none'; return; }
        const css = `left:${e.x.toFixed(1)}px;top:${e.y.toFixed(1)}px;width:${e.w.toFixed(1)}px;height:${e.h.toFixed(1)}px;border-radius:${e.r}px;background:${rgba(e.fill)};border:${e.border}px solid ${rgba(e.borderColor || [255, 255, 255, .3])};backdrop-filter:blur(${e.blur}px) saturate(1.3);-webkit-backdrop-filter:blur(${e.blur}px) saturate(1.3)`;
        if (d.__css !== css) { d.__css = css; d.style.cssText = base + css; }
      });
    }
  }
  const game = new Phaser.Game({ type: new URLSearchParams(location.search).get('r') === 'canvas' ? Phaser.CANVAS : Phaser.AUTO, parent: mount, transparent: true, scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' }, scene: TracerScene, render: { antialias: true } });
  return { game, destroy: () => game.destroy(true) };
}
