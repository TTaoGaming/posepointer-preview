import { isRecord, readJson } from "./read.js";
function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
// Sample the centreline of each subpath. A move lifts the pen. A close
// returns it to the subpath origin, including for subsequent relative moves.
export function parsePath(source, curveSteps) {
    if (!Number.isSafeInteger(curveSteps) || curveSteps < 1)
        throw new RangeError("curveSteps");
    const token = /[mlhvcqz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iy;
    const separator = /[\s,]+/y;
    const tokens = [];
    let pos = 0;
    while (pos < source.length) {
        separator.lastIndex = pos;
        if (separator.exec(source)) {
            pos = separator.lastIndex;
            continue;
        }
        token.lastIndex = pos;
        const match = token.exec(source);
        if (!match)
            throw new SyntaxError(source.slice(pos));
        tokens.push(match[0]);
        pos = token.lastIndex;
    }
    const result = [];
    let cursor = [0, 0], origin = cursor;
    let stroke = [], command = "", index = 0, hasOrigin = false;
    const isCommand = (s) => /^[a-z]$/i.test(s);
    function number() {
        const s = tokens[index++];
        if (s === undefined || !Number.isFinite(Number(s)))
            throw new SyntaxError(source);
        return Number(s);
    }
    function append(p) {
        const last = stroke.at(-1);
        if (!last || p[0] !== last[0] || p[1] !== last[1])
            stroke.push(p);
        cursor = p;
    }
    function finish() {
        if (stroke.length > 1)
            result.push(stroke);
        stroke = [];
    }
    while (index < tokens.length) {
        if (isCommand(tokens[index]))
            command = tokens[index++];
        const op = command.toUpperCase(), relative = command !== op;
        const [x, y] = cursor;
        const readPoint = () => [number() + (relative ? x : 0), number() + (relative ? y : 0)];
        if (op === "M") {
            finish();
            origin = readPoint();
            append(origin);
            hasOrigin = true;
            command = relative ? "l" : "L"; // subsequent pairs are implicit lines
            continue;
        }
        if (!hasOrigin || !command)
            throw new SyntaxError(source);
        if (!stroke.length)
            append(cursor);
        switch (op) {
            case "L":
                append(readPoint());
                break;
            case "H":
                append([number() + (relative ? x : 0), y]);
                break;
            case "V":
                append([x, number() + (relative ? y : 0)]);
                break;
            case "Z":
                append(origin);
                finish();
                command = "";
                break;
            case "Q":
            case "C": {
                const from = cursor, control = readPoint();
                const control2 = op === "C" ? readPoint() : null;
                const end = readPoint();
                for (let i = 1; i < curveSteps; i++) {
                    const t = i / curveSteps, a = mix(from, control, t);
                    if (control2) {
                        const b = mix(control, control2, t), c = mix(control2, end, t);
                        append(mix(mix(a, b, t), mix(b, c, t), t));
                    }
                    else
                        append(mix(a, mix(control, end, t), t));
                }
                append(end);
                break;
            }
            default: throw new SyntaxError(source);
        }
    }
    finish();
    return result;
}
export function svgpath(url, curveSteps) {
    return { async load() {
            const data = await readJson(url);
            if (!isRecord(data) || !Object.keys(data).length)
                throw new TypeError(url);
            return Object.fromEntries(Object.entries(data).map(([key, item]) => {
                const paths = Array.isArray(item) ? item : [item];
                const strokes = paths.flatMap(path => {
                    if (typeof path !== "string")
                        throw new TypeError(key);
                    return parsePath(path, curveSteps);
                });
                if (!strokes.length)
                    throw new TypeError(key);
                return [key, strokes];
            }));
        } };
}
