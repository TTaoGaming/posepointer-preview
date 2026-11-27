import { dist, glyphHeight, resample } from './geometry.js';
import defaults from './stroke-defaults.json' with { type: 'json' };
export function createTracer(strokes, opts = {}) {
    const fallback = defaults.presets[defaults.tolerance];
    const tolerance = typeof opts?.tolerance === 'object' && opts.tolerance
        ? opts.tolerance : defaults.presets[opts?.tolerance] || fallback;
    const spacing = opts?.spacing || defaults.spacing;
    const height = glyphHeight(strokes), jump = defaults.jumpFraction * height;
    const windowSize = Math.max(1, Math.floor(tolerance.skip / spacing));
    const checkpoints = strokes.map(points => resample(points, spacing));
    let mode, stroke, cp, owner;
    let lastX, lastY, reason;
    function reset() {
        mode = 'idle';
        stroke = 0;
        cp = -1;
        owner = null;
        lastX = 0;
        lastY = 0;
        reason = '';
    }
    reset();
    function event(type) {
        return { type, stroke, cp, mode };
    }
    function block(why, type) {
        mode = 'blocked';
        reason = why;
        cp = -1;
        return event(type);
    }
    function pointerDown(id, x, y) {
        if (mode === 'complete')
            return event('ignored');
        if (owner !== null && owner !== id)
            return event('ignored-other-pointer');
        owner = id;
        const start = checkpoints[stroke][0];
        if (dist(x, y, start.x, start.y) <= tolerance.start) {
            mode = 'tracing';
            cp = 0;
            lastX = x;
            lastY = y;
            reason = '';
            return event('start');
        }
        return block('miss', 'miss-start');
    }
    function pointerMove(id, x, y) {
        if (owner === null)
            return event('ignored-hover');
        if (owner !== id)
            return event('ignored-other-pointer');
        if (mode !== 'tracing')
            return event('ignored-blocked');
        const jumped = dist(x, y, lastX, lastY) >= jump;
        lastX = x;
        lastY = y;
        if (jumped)
            return block('jump', 'jump-cancel');
        const list = checkpoints[stroke], last = list.length - 1, here = list[cp];
        let best = cp, bestDistance = dist(x, y, here.x, here.y);
        if (bestDistance > tolerance.leash)
            return block('strayed', 'strayed-cancel');
        if (last - cp <= defaults.nearEnd && dist(x, y, list[last].x, list[last].y) <= tolerance.corridor) {
            best = last;
        }
        else {
            const end = Math.min(last, cp + windowSize);
            for (let j = cp + 1; j <= end; j++) {
                const d = dist(x, y, list[j].x, list[j].y);
                if (d <= bestDistance + defaults.distanceEpsilon) {
                    best = j;
                    bestDistance = d;
                }
            }
            if (bestDistance > tolerance.corridor)
                best = cp;
        }
        if (best === cp)
            return event('no-progress');
        cp = best;
        if (best !== last)
            return event('progress');
        const finishedStroke = stroke;
        if (stroke === strokes.length - 1) {
            mode = 'complete';
            reason = '';
            return { ...event('glyph-complete'), finishedStroke };
        }
        stroke++;
        return { ...block('lift', 'stroke-complete'), finishedStroke };
    }
    function release(id, cancelled) {
        if (owner === null || owner !== id)
            return event('ignored');
        const wasTracing = mode === 'tracing';
        owner = null;
        if (mode !== 'complete') {
            mode = 'idle';
            cp = -1;
            reason = '';
        }
        return event(wasTracing ? (cancelled ? 'cancelled' : 'released-early') : 'released');
    }
    return {
        strokes, checkpoints, tolerance, glyphHeight: height, jumpDistance: jump, spacing,
        pointerDown, pointerMove, pointerUp: (id) => release(id, false),
        pointerCancel: (id) => release(id, true), reset,
        get mode() { return mode; },
        get blockReason() { return reason; },
        get strokeIndex() { return stroke; },
        get checkpointIndex() { return cp; },
        get activePointer() { return owner; },
        get isComplete() { return mode === 'complete'; },
        get strokesDone() { return mode === 'complete' ? strokes.length : stroke; }
    };
}
