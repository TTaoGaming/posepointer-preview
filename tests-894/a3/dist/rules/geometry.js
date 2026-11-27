import defaults from './stroke-defaults.json' with { type: 'json' };
export function dist(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
}
export function resample(points, spacing = defaults.spacing) {
    const out = [{ x: points[0][0], y: points[0][1] }];
    let carry = 0;
    for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i];
        const segment = dist(ax, ay, bx, by);
        if (!segment)
            continue;
        let pos = spacing - carry;
        while (pos <= segment + defaults.distanceEpsilon) {
            const t = pos / segment;
            out.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
            pos += spacing;
        }
        carry = segment - (pos - spacing);
    }
    const [x, y] = points[points.length - 1], tail = out[out.length - 1];
    const remainder = dist(tail.x, tail.y, x, y);
    if (remainder > defaults.endpointEpsilon) {
        if (remainder < spacing / 2 && out.length > 2)
            out[out.length - 1] = { x, y };
        else
            out.push({ x, y });
    }
    return out;
}
export function glyphHeight(strokes) {
    let min = Infinity, max = -Infinity;
    for (const points of strokes)
        for (const [, y] of points) {
            min = Math.min(min, y);
            max = Math.max(max, y);
        }
    return Math.max(defaults.minHeight, max - min);
}
