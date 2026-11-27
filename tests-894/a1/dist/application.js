import { createFill } from "./rules/fill.js";
export async function run(settings, source, rule, view, options) {
    const pack = await source.load(), keys = Object.keys(pack);
    let key, trace, fill;
    let activity = options.activity, complete = false, fillOwner = null, newDrag = true;
    const board = {
        get key() { return key; }, get strokes() { return pack[key]; },
        get trace() { return trace; }, get fill() { return fill; },
        get activity() { return activity; }, get complete() { return complete; }
    };
    function select(next, quiet = false) {
        if (!Object.hasOwn(pack, next))
            return;
        key = next;
        trace = rule.create(pack[key], options.tolerance);
        fill = createFill(pack[key], settings.layout.width, settings.layout.height, settings.fill);
        complete = false;
        fillOwner = null;
        newDrag = true;
        view.selected(board, quiet);
    }
    function finish() {
        if (complete)
            return;
        complete = true;
        view.celebrate();
    }
    function feedback(event, point) {
        view.feedback(event, point);
        if (event.type === "glyph-complete")
            finish();
    }
    function paint(point) {
        if (complete)
            return;
        fill.paint(point);
        view.paint(point, newDrag);
        newDrag = false;
        if (fill.coverage() >= fill.goal)
            finish();
    }
    const controls = {
        select,
        next() { select(keys[(keys.indexOf(key) + 1) % keys.length]); },
        restart() { select(key, true); },
        setActivity(next) {
            if (activity === next)
                return;
            activity = next;
            select(key, true);
        },
        down(id, point) {
            if (activity === "trace")
                return feedback(trace.pointerDown(id, ...point), point);
            if (fillOwner !== null && fillOwner !== id)
                return;
            fillOwner = id;
            fill.lift();
            newDrag = true;
            paint(point);
        },
        move(id, point) {
            if (activity === "trace")
                return feedback(trace.pointerMove(id, ...point), point);
            if (id === fillOwner)
                paint(point);
        },
        release(id, cancelled) {
            if (activity === "trace")
                return feedback(cancelled ? trace.pointerCancel(id) : trace.pointerUp(id));
            if (fillOwner === id || fillOwner === null) {
                fillOwner = null;
                fill.lift();
                newDrag = true;
            }
        },
        hoverPaint(point) { if (activity === "fill" && fillOwner === null)
            paint(point); }
    };
    view.mount(pack, controls);
    const first = options.letter && Object.hasOwn(pack, options.letter) ? options.letter : settings.defaultGlyph;
    select(Object.hasOwn(pack, first) ? first : keys[0], true);
    return () => ({ key, strokes: structuredClone(pack[key]) });
}
