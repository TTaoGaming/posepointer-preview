import { createFill } from './rules/fill.js';
export class Activity {
    pack;
    rule;
    settings;
    tolerance;
    keys;
    done = new Set();
    key;
    mode = 'trace';
    trace;
    fill;
    painter = null;
    constructor(pack, rule, settings, tolerance) {
        this.pack = pack;
        this.rule = rule;
        this.settings = settings;
        this.tolerance = tolerance;
        this.keys = Object.keys(pack);
        this.key = this.keys.includes(settings.initial.glyph) ? settings.initial.glyph : this.keys[0];
        this.trace = this.newTrace();
    }
    get strokes() { return this.pack[this.key]; }
    get showDots() { return this.rule.showDots; }
    get complete() { return this.fill ? this.fill.fraction >= 1 : this.trace.isComplete; }
    get owner() { return this.fill ? this.painter : this.trace.activePointer; }
    newTrace() { return this.rule.create(this.strokes, { tolerance: this.tolerance }); }
    select(key) {
        if (!this.keys.includes(key))
            return;
        this.key = key;
        this.trace = this.newTrace();
        this.painter = null;
        this.fill = this.mode === 'fill' ? createFill(this.strokes, this.settings.box, this.settings.fill) : undefined;
    }
    next() { this.select(this.keys[(this.keys.indexOf(this.key) + 1) % this.keys.length]); }
    setMode(mode) { this.mode = mode; this.select(this.key); }
    paint([x, y]) {
        if (!this.fill || this.complete)
            return 'ignored';
        this.fill.paint(x, y);
        return this.complete ? 'glyph-complete' : 'paint';
    }
    credit(type) {
        if (type === 'glyph-complete')
            this.done.add(this.key);
        return type;
    }
    down(id, p) {
        if (!this.fill)
            return this.credit(this.trace.pointerDown(id, ...p).type);
        if (this.complete || (this.painter !== null && this.painter !== id))
            return 'ignored';
        this.painter = id;
        this.fill.lift();
        return this.credit(this.paint(p));
    }
    move(id, p) {
        if (!this.fill)
            return this.credit(this.trace.pointerMove(id, ...p).type);
        return this.painter === id ? this.credit(this.paint(p)) : 'ignored';
    }
    release(id, cancelled = false) {
        if (!this.fill) {
            if (cancelled)
                this.trace.pointerCancel(id);
            else
                this.trace.pointerUp(id);
        }
        else if (this.painter === id) {
            this.fill.lift();
            this.painter = null;
        }
    }
}
export async function launch(data, rule, view, settings, tolerance) {
    await view.open(new Activity(await data.load(), rule, settings, tolerance));
}
