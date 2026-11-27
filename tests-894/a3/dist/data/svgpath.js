import { isPack, readJson, record } from './load.js';
/** Each moveto begins its own pen stroke. Relative controls share the segment origin. */
export function parsePath(text, curveSteps) {
    if (!Number.isSafeInteger(curveSteps) || curveSteps < 1)
        throw new RangeError(String(curveSteps));
    const token = /[\s,]*([a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/gy;
    const tokens = [];
    const source = text.trim();
    while (token.lastIndex < source.length) {
        const at = token.lastIndex, match = token.exec(source);
        if (!match)
            throw new SyntaxError(source.slice(at));
        const part = match[1];
        tokens.push(/^[a-z]$/i.test(part) ? part : Number(part));
    }
    let i = 0, command = '', cursor = [0, 0], start = cursor;
    let path = null;
    const strokes = [];
    function number() {
        const n = tokens[i++];
        if (typeof n !== 'number' || !Number.isFinite(n))
            throw new SyntaxError(text);
        return n;
    }
    function append(p) {
        if (!path) {
            path = [cursor];
            strokes.push(path);
        }
        if (cursor[0] !== p[0] || cursor[1] !== p[1])
            path.push(p);
        cursor = p;
    }
    function point(relative) {
        const x = number(), y = number();
        return relative ? [cursor[0] + x, cursor[1] + y] : [x, y];
    }
    function curve(controls) {
        // De Casteljau interpolation works for both quadratic and cubic segments.
        for (let step = 1; step < curveSteps; step++) {
            const t = step / curveSteps;
            let level = controls;
            while (level.length > 1) {
                level = level.slice(1).map(([x, y], k) => [
                    level[k][0] * (1 - t) + x * t, level[k][1] * (1 - t) + y * t
                ]);
            }
            append(level[0]);
        }
        append(controls[controls.length - 1]);
    }
    while (i < tokens.length) {
        const item = tokens[i];
        if (typeof item === 'string') {
            command = item;
            i++;
        }
        const op = command.toUpperCase(), relative = command !== op;
        if (!strokes.length && op !== 'M')
            throw new SyntaxError(text);
        switch (op) {
            case 'M':
                cursor = start = point(relative);
                path = [cursor];
                strokes.push(path);
                command = relative ? 'l' : 'L';
                break;
            case 'L':
                append(point(relative));
                break;
            case 'H':
                append([number() + (relative ? cursor[0] : 0), cursor[1]]);
                break;
            case 'V':
                append([cursor[0], number() + (relative ? cursor[1] : 0)]);
                break;
            case 'Q':
                curve([cursor, point(relative), point(relative)]);
                break;
            case 'C':
                curve([cursor, point(relative), point(relative), point(relative)]);
                break;
            case 'Z':
                append(start);
                path = null;
                command = '';
                break;
            default: throw new SyntaxError(text);
        }
    }
    return strokes.filter(stroke => stroke.length > 1);
}
export function svgPath(url, curveSteps) {
    return { async load() {
            const input = await readJson(url);
            if (!record(input))
                throw new TypeError(url);
            const pack = Object.fromEntries(Object.entries(input).map(([key, paths]) => {
                if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) {
                    throw new TypeError(key);
                }
                return [key, paths.flatMap(p => parsePath(p, curveSteps))];
            }));
            if (!isPack(pack))
                throw new TypeError(url);
            return pack;
        } };
}
