function segmentDistance(x, y, [ax, ay], [bx, by]) {
    const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
    return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}
export function createFill(strokes, box, { cell, thick, brush, goal }) {
    const nx = Math.ceil(box.width / cell), ny = Math.ceil(box.height / cell);
    const mask = new Uint8Array(nx * ny);
    let total = 0, painted = 0, last = null;
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
            if (strokes.some(path => path.some((p, k) => k > 0 && segmentDistance(x, y, path[k - 1], p) <= thick / 2))) {
                mask[j * nx + i] = 1;
                total++;
            }
        }
    }
    function stamp(x, y) {
        for (let j = Math.max(0, Math.floor((y - brush) / cell)); j <= Math.min(ny - 1, Math.floor((y + brush) / cell)); j++) {
            for (let i = Math.max(0, Math.floor((x - brush) / cell)); i <= Math.min(nx - 1, Math.floor((x + brush) / cell)); i++) {
                const k = j * nx + i;
                if (mask[k] === 1 && Math.hypot((i + 0.5) * cell - x, (j + 0.5) * cell - y) <= brush) {
                    mask[k]++;
                    painted++;
                }
            }
        }
    }
    return {
        get fraction() { return total ? Math.min(1, painted / total / goal) : 0; },
        lift() { last = null; },
        paint(x, y) {
            if (last) {
                const steps = Math.ceil(Math.hypot(x - last[0], y - last[1]) / (brush / 2));
                for (let q = 1; q < steps; q++)
                    stamp(last[0] + (x - last[0]) * q / steps, last[1] + (y - last[1]) * q / steps);
            }
            stamp(x, y);
            last = [x, y];
        }
    };
}
