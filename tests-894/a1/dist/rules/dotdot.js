import { dist, polylineLength, resample } from "./geometry.js";
// Each input sample may claim just the next dot. A lift preserves reached
// dots so the same activity accepts both a continuous drag and individual taps.
export function createDotTracer(strokes, spacing, tolerance) {
    const checkpoints = strokes.map(path => {
        const closed = dist(...path[0], ...path[path.length - 1]) === 0;
        return resample(path, closed ? Math.min(spacing, polylineLength(path) / 3) : spacing);
    });
    let stroke = 0, cp = -1, mode = "idle", owner = null;
    function event(type) { return { type, stroke, cp, mode }; }
    function targetRadius() {
        const list = checkpoints[stroke], target = list[cp + 1];
        let radius = cp < 0 ? tolerance.start : tolerance.corridor;
        for (const neighbor of [list[cp], list[cp + 2]]) {
            if (target && neighbor)
                radius = Math.min(radius, dist(neighbor.x, neighbor.y, target.x, target.y) / 2);
        }
        return radius;
    }
    function reach(x, y, down) {
        const list = checkpoints[stroke], target = list[cp + 1];
        if (dist(x, y, target.x, target.y) > targetRadius()) {
            if (down && cp < 0) {
                mode = "blocked";
                return event("miss-start");
            }
            return event("no-progress");
        }
        cp++;
        if (cp < list.length - 1)
            return event(cp === 0 ? "start" : "progress");
        const finishedStroke = stroke;
        if (stroke === strokes.length - 1) {
            mode = "complete";
            return { ...event("glyph-complete"), finishedStroke };
        }
        stroke++;
        cp = -1;
        mode = "blocked";
        return { ...event("stroke-complete"), finishedStroke };
    }
    function release(id, cancelled) {
        if (owner !== id)
            return event("ignored");
        owner = null;
        if (mode !== "complete")
            mode = "idle";
        return event(cancelled ? "cancelled" : "released");
    }
    return {
        showDots: true, checkpoints, tolerance,
        get targetRadius() { return targetRadius(); },
        pointerDown(id, x, y) {
            if (mode === "complete")
                return event("ignored");
            if (owner !== null)
                return event(owner === id ? "ignored" : "ignored-other-pointer");
            owner = id;
            mode = "tracing";
            return reach(x, y, true);
        },
        pointerMove(id, x, y) {
            if (owner === null)
                return event("ignored-hover");
            if (owner !== id)
                return event("ignored-other-pointer");
            if (mode !== "tracing")
                return event("ignored-blocked");
            return reach(x, y, false);
        },
        pointerUp: id => release(id, false),
        pointerCancel: id => release(id, true),
        reset() { stroke = 0; cp = -1; mode = "idle"; owner = null; },
        get mode() { return mode; },
        get activePointer() { return owner; },
        get strokeIndex() { return stroke; },
        get checkpointIndex() { return cp; },
        get isComplete() { return mode === "complete"; }
    };
}
