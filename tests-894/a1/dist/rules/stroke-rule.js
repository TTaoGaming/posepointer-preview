import defaults from "../../data/stroke-defaults.json" with { type: "json" };
import { dist, glyphHeight, resample } from "./geometry.js";
export { dist, glyphHeight, polylineLength, resample } from "./geometry.js";
export const PRESETS = defaults.presets, SPACING = defaults.spacing;
export const JUMP_FRACTION = defaults.jumpFraction, MIN_HEIGHT = defaults.minHeight;
export function createTracer(strokes, opts) {
    const choice = opts?.tolerance;
    const tolerance = choice && typeof choice === "object" ? choice :
        PRESETS[choice || defaults.defaultTolerance] || PRESETS[defaults.defaultTolerance];
    const spacing = opts?.spacing || SPACING;
    const height = glyphHeight(strokes);
    const jumpDistance = JUMP_FRACTION * height;
    const windowSize = Math.max(1, Math.floor(tolerance.skip / spacing));
    const checkpoints = strokes.map(stroke => resample(stroke, spacing));
    let mode, stroke, cp, pointer;
    let lastX, lastY, reason;
    function reset() {
        mode = "idle";
        stroke = 0;
        cp = -1;
        pointer = null;
        lastX = 0;
        lastY = 0;
        reason = "";
    }
    reset();
    function event(type) { return { type, stroke, cp, mode }; }
    function down(id, x, y) {
        if (mode === "complete")
            return event("ignored");
        if (pointer !== null && pointer !== id)
            return event("ignored-other-pointer");
        pointer = id;
        const start = checkpoints[stroke][0];
        if (dist(x, y, start.x, start.y) <= tolerance.start) {
            mode = "tracing";
            cp = 0;
            lastX = x;
            lastY = y;
            reason = "";
            return event("start");
        }
        mode = "blocked";
        reason = "miss";
        cp = -1;
        return event("miss-start");
    }
    function move(id, x, y) {
        if (pointer === null)
            return event("ignored-hover");
        if (pointer !== id)
            return event("ignored-other-pointer");
        if (mode !== "tracing")
            return event("ignored-blocked");
        const jumped = dist(x, y, lastX, lastY) >= jumpDistance;
        lastX = x;
        lastY = y;
        if (jumped) {
            mode = "blocked";
            reason = "jump";
            cp = -1;
            return event("jump-cancel");
        }
        const list = checkpoints[stroke], last = list.length - 1, here = list[cp];
        let best = cp, bestDistance = dist(x, y, here.x, here.y);
        if (bestDistance > tolerance.leash) {
            mode = "blocked";
            reason = "strayed";
            cp = -1;
            return event("strayed-cancel");
        }
        if (last - cp <= defaults.endSlackCheckpoints && dist(x, y, list[last].x, list[last].y) <= tolerance.corridor) {
            best = last;
        }
        else {
            const hi = Math.min(last, cp + windowSize);
            for (let j = cp + 1; j <= hi; j++) {
                const distance = dist(x, y, list[j].x, list[j].y);
                if (distance <= bestDistance + defaults.epsilon) {
                    best = j;
                    bestDistance = distance;
                }
            }
            if (bestDistance > tolerance.corridor)
                best = cp;
        }
        if (best === cp)
            return event("no-progress");
        cp = best;
        if (cp < last)
            return event("progress");
        const finishedStroke = stroke;
        if (stroke === strokes.length - 1) {
            mode = "complete";
            reason = "";
            return { ...event("glyph-complete"), finishedStroke };
        }
        stroke++;
        cp = -1;
        mode = "blocked";
        reason = "lift";
        return { ...event("stroke-complete"), finishedStroke };
    }
    function release(id, cancelled) {
        if (pointer === null || pointer !== id)
            return event("ignored");
        const tracing = mode === "tracing";
        pointer = null;
        if (mode !== "complete") {
            mode = "idle";
            cp = -1;
            reason = "";
        }
        return event(tracing ? (cancelled ? "cancelled" : "released-early") : "released");
    }
    return {
        strokes, checkpoints, tolerance, glyphHeight: height, jumpDistance, spacing,
        pointerDown: down, pointerMove: move,
        pointerUp: (id) => release(id, false),
        pointerCancel: (id) => release(id, true),
        reset,
        get mode() { return mode; },
        get blockReason() { return reason; },
        get strokeIndex() { return stroke; },
        get checkpointIndex() { return cp; },
        get activePointer() { return pointer; },
        get isComplete() { return mode === "complete"; },
        get strokesDone() { return mode === "complete" ? strokes.length : stroke; }
    };
}
