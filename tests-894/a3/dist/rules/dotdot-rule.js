import { dist, resample } from './geometry.js';
export function dotRule(spacing, radius) {
    function create(strokes) {
        const checkpoints = strokes.map(path => resample(path, spacing));
        let stroke = 0, cp = -1, mode = 'idle', owner = null;
        const event = (type) => ({ type, stroke, cp, mode });
        // Credit at most the next dot per sample. Lifting between dots is allowed.
        function reach(x, y) {
            const list = checkpoints[stroke], next = list[cp + 1];
            if (dist(x, y, next.x, next.y) > radius)
                return event('no-progress');
            cp++;
            mode = 'tracing';
            if (cp < list.length - 1)
                return event(cp === 0 ? 'start' : 'progress');
            const finishedStroke = stroke;
            if (stroke === strokes.length - 1) {
                mode = 'complete';
                return { ...event('glyph-complete'), finishedStroke };
            }
            stroke++;
            cp = -1;
            mode = 'blocked';
            return { ...event('stroke-complete'), finishedStroke };
        }
        function release(id, cancelled) {
            if (owner !== id)
                return event('ignored');
            owner = null;
            if (mode !== 'complete') {
                if (cancelled)
                    cp = -1;
                mode = 'idle';
            }
            return event(cancelled ? 'cancelled' : 'released');
        }
        return {
            strokes, checkpoints,
            get strokeIndex() { return stroke; }, get checkpointIndex() { return cp; },
            get mode() { return mode; }, get activePointer() { return owner; },
            get isComplete() { return mode === 'complete'; },
            pointerDown(id, x, y) {
                if (mode === 'complete')
                    return event('ignored');
                if (owner !== null)
                    return event(owner !== id ? 'ignored-other-pointer' : 'ignored');
                owner = id;
                const result = reach(x, y);
                if (result.type === 'no-progress') {
                    mode = 'blocked';
                    return event(cp < 0 ? 'miss-start' : 'no-progress');
                }
                return result;
            },
            pointerMove(id, x, y) {
                if (owner === null)
                    return event('ignored-hover');
                if (owner !== id)
                    return event('ignored-other-pointer');
                return mode === 'tracing' ? reach(x, y) : event('ignored-blocked');
            },
            pointerUp: id => release(id, false),
            pointerCancel: id => release(id, true),
            reset() { stroke = 0; cp = -1; mode = 'idle'; owner = null; }
        };
    }
    return { showDots: true, create };
}
