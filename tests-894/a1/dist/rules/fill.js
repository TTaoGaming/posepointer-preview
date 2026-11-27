function nearSegment(x, y, [ax, ay], [bx, by], radius) {
    const dx = bx - ax, dy = by - ay, squared = dx * dx + dy * dy;
    const t = squared ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / squared)) : 0;
    return Math.hypot(ax + t * dx - x, ay + t * dy - y) <= radius;
}
export function createFill(strokes, width, height, settings) {
    const { cell, thick, brush, goal } = settings;
    const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
    const mask = new Uint8Array(cols * rows), paint = new Uint8Array(mask.length);
    let maskCount = 0, painted = 0, last;
    for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
            const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
            if (strokes.some(st => st.some((p, k) => k > 0 && nearSegment(x, y, st[k - 1], p, thick / 2)))) {
                mask[j * cols + i] = 1;
                maskCount++;
            }
        }
    function stamp(x, y) {
        const right = Math.min(cols - 1, Math.floor((x + brush) / cell));
        const bottom = Math.min(rows - 1, Math.floor((y + brush) / cell));
        for (let j = Math.max(0, Math.floor((y - brush) / cell)); j <= bottom; j++) {
            for (let i = Math.max(0, Math.floor((x - brush) / cell)); i <= right; i++) {
                const dx = (i + 0.5) * cell - x, dy = (j + 0.5) * cell - y;
                const idx = j * cols + i;
                if (dx * dx + dy * dy <= brush * brush && mask[idx] && !paint[idx]) {
                    paint[idx] = 1;
                    painted++;
                }
            }
        }
    }
    return {
        thick, brush, goal,
        lift() { last = undefined; },
        coverage: () => maskCount ? painted / maskCount : 0,
        paint(point) {
            if (last) {
                const dx = point[0] - last[0], dy = point[1] - last[1];
                const steps = Math.ceil(Math.hypot(dx, dy) / (brush / 2));
                for (let i = 1; i < steps; i++)
                    stamp(last[0] + dx * i / steps, last[1] + dy * i / steps);
            }
            stamp(...point);
            last = point;
        }
    };
}
