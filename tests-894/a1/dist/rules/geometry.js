import defaults from "../../data/stroke-defaults.json" with { type: "json" };
export function dist(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
}
export function polylineLength(points) {
    let length = 0;
    for (let i = 1; i < points.length; i++)
        length += dist(...points[i - 1], ...points[i]);
    return length;
}
// Carry the unused arc length across each corner, as in old/core.js.
export function resample(points, spacing = defaults.spacing) {
    spacing = spacing || defaults.spacing;
    if (spacing < 0)
        throw new RangeError("spacing");
    const out = [{ x: points[0][0], y: points[0][1] }];
    let carry = 0;
    for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i];
        const length = dist(ax, ay, bx, by);
        if (length === 0)
            continue;
        let pos = spacing - carry;
        while (pos <= length + defaults.epsilon) {
            const t = pos / length;
            out.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
            pos += spacing;
        }
        carry = length - (pos - spacing);
    }
    const [x, y] = points[points.length - 1];
    const tail = out[out.length - 1];
    const endDistance = dist(tail.x, tail.y, x, y);
    if (endDistance > defaults.endpointEpsilon) {
        if (endDistance < spacing / 2 && out.length > 2)
            out[out.length - 1] = { x, y };
        else
            out.push({ x, y });
    }
    return out;
}
export function glyphHeight(strokes) {
    let min = Infinity, max = -Infinity;
    for (const stroke of strokes)
        for (const [, y] of stroke) {
            min = Math.min(min, y);
            max = Math.max(max, y);
        }
    return Math.max(defaults.minHeight, max - min);
}
