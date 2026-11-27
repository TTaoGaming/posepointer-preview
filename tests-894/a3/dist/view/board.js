export function fit(width, height, { box, layout }) {
    const scale = Math.max(layout.minScale, Math.min((width - 2 * layout.padding) / box.width, (height - 2 * layout.padding) / box.height));
    return { scale, ox: (width - box.width * scale) / 2, oy: (height - box.height * scale) / 2 };
}
export function createBoard(stage, activity, settings, reduced) {
    const { paint: pen, timing, box, fill, ruler, layout } = settings;
    const ctx = stage.getContext('2d');
    let w = 0, h = 0, dpr = 1, transform = fit(w, h, settings);
    let trail = [], hintTime = Infinity;
    const ink = document.createElement('canvas'), mask = document.createElement('canvas');
    ink.width = mask.width = box.width * pen.inkScale;
    ink.height = mask.height = box.height * pen.inkScale;
    const brush = ink.getContext('2d'), stencil = mask.getContext('2d');
    let lastInk = null;
    function resize() {
        const r = stage.getBoundingClientRect();
        if (r.width < layout.minSide || r.height < layout.minSide)
            return;
        w = r.width;
        h = r.height;
        dpr = Math.max(1, Math.min(layout.maxDpr, window.devicePixelRatio || 1));
        stage.width = Math.round(w * dpr);
        stage.height = Math.round(h * dpr);
        transform = fit(w, h, settings);
    }
    function local(clientX, clientY) {
        const r = stage.getBoundingClientRect();
        if (r.width !== w || r.height !== h)
            resize();
        return [(clientX - r.left - transform.ox) / transform.scale, (clientY - r.top - transform.oy) / transform.scale];
    }
    function line(context, points, scale, ox = 0, oy = 0) {
        context.beginPath();
        points.forEach(([x, y], i) => {
            if (i)
                context.lineTo(x * scale + ox, y * scale + oy);
            else
                context.moveTo(x * scale + ox, y * scale + oy);
        });
    }
    function stroke(points, color, width) {
        line(ctx, points, transform.scale, transform.ox, transform.oy);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
    }
    function pixel([x, y]) { return [x * transform.scale + transform.ox, y * transform.scale + transform.oy]; }
    function circle(p, r, color, border) {
        ctx.beginPath();
        ctx.arc(...pixel(p), r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (border) {
            ctx.strokeStyle = border;
            ctx.lineWidth = pen.startWidth;
            ctx.stroke();
        }
    }
    function label(point, n, color, font) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.fillText(String(n), ...pixel(point));
    }
    function reset() {
        trail = [];
        lastInk = null;
        hintTime = performance.now() + timing.demoDelay;
        brush.clearRect(0, 0, ink.width, ink.height);
        stencil.clearRect(0, 0, mask.width, mask.height);
        if (!activity.fill)
            return;
        stencil.lineCap = stencil.lineJoin = 'round';
        stencil.lineWidth = fill.thick * pen.inkScale;
        for (const path of activity.strokes) {
            line(stencil, path, pen.inkScale);
            stencil.stroke();
        }
    }
    function stamp(p) {
        if (!activity.fill)
            return;
        const hue = Math.round(Math.min(1, Math.max(0, p[0] / box.width)) * pen.fillHue);
        brush.fillStyle = brush.strokeStyle = `hsl(${hue} ${pen.fillChroma})`;
        brush.lineCap = 'round';
        brush.lineWidth = fill.brush * 2 * pen.inkScale;
        if (lastInk) {
            line(brush, [lastInk, p], pen.inkScale);
            brush.stroke();
        }
        else {
            brush.beginPath();
            brush.arc(p[0] * pen.inkScale, p[1] * pen.inkScale, fill.brush * pen.inkScale, 0, Math.PI * 2);
            brush.fill();
        }
        brush.globalCompositeOperation = 'destination-in';
        brush.drawImage(mask, 0, 0);
        brush.globalCompositeOperation = 'source-over';
        lastInk = p;
    }
    function drawFill(fraction) {
        const width = fill.thick * transform.scale;
        for (const path of activity.strokes)
            stroke(path, pen.bubbleEdge, width + pen.edgeWidth);
        for (const path of activity.strokes)
            stroke(path, pen.bubble, width);
        ctx.drawImage(ink, transform.ox, transform.oy, box.width * transform.scale, box.height * transform.scale);
        const barWidth = Math.min(w - 2 * layout.padding, pen.barWidth), left = (w - barWidth) / 2;
        ctx.fillStyle = pen.barTrack;
        ctx.fillRect(left, pen.barY, barWidth, pen.barHeight);
        ctx.fillStyle = pen.finished;
        ctx.fillRect(left, pen.barY, barWidth * fraction, pen.barHeight);
    }
    function drawHint(now, points, width) {
        const age = now - hintTime, cycle = timing.demo + timing.demoGap;
        if (age < 0 || age >= cycle * timing.demoLoops)
            return;
        const t = Math.min(1, age % cycle / timing.demo);
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const index = eased * (points.length - 1), k = Math.floor(index);
        const p = points[k], q = points[Math.min(k + 1, points.length - 1)];
        const ball = [p[0] + (q[0] - p[0]) * (index - k), p[1] + (q[1] - p[1]) * (index - k)];
        stroke([...points.slice(0, k + 1), ball], pen.hint, width);
        circle(ball, pen.hintRadius, pen.hintBall, pen.outline);
    }
    function target() {
        const t = activity.trace, list = t.checkpoints[t.strokeIndex];
        const next = activity.showDots ? Math.min(list.length - 1, t.checkpointIndex + 1) : 0;
        return [list[next].x, list[next].y];
    }
    function drawTrace(now, dwell) {
        const t = activity.trace, width = pen.guideWidth * transform.scale;
        const rainbow = ctx.createLinearGradient(...pixel([0, 0]), ...pixel([box.width, box.height]));
        pen.rainbow.forEach((c, i, a) => rainbow.addColorStop(i / (a.length - 1), c));
        activity.strokes.forEach((path, i) => {
            if (t.isComplete || i < t.strokeIndex) {
                stroke(path, t.isComplete ? rainbow : pen.finished, width);
                return;
            }
            stroke(path, pen.guide, width);
            ctx.setLineDash([pen.dash, Math.max(pen.minGap, pen.gap * transform.scale)]);
            stroke(path, pen.center, Math.max(pen.dash, pen.centerWidth * transform.scale));
            ctx.setLineDash([]);
        });
        if (t.isComplete)
            return;
        const points = t.checkpoints[t.strokeIndex].map(({ x, y }) => [x, y]);
        if (t.checkpointIndex > 0)
            stroke(points.slice(0, t.checkpointIndex + 1), pen.progress, width);
        for (let i = t.strokeIndex + 1; i < activity.strokes.length; i++) {
            const p = activity.strokes[i][0];
            circle(p, pen.markerRadius, pen.marker);
            label(p, i + 1, pen.markerText, pen.markerFont);
        }
        if (activity.showDots)
            points.forEach((p, i) => {
                circle(p, pen.dotRadius, i <= t.checkpointIndex ? pen.finished : pen.dotOutline);
            });
        if (t.mode !== 'tracing' || activity.showDots) {
            const p = target(), r = Math.max(pen.minStart, pen.startScale * transform.scale);
            const phase = reduced ? 0.5 : now % timing.halo / timing.halo;
            ctx.save();
            ctx.beginPath();
            ctx.arc(...pixel(p), r * (pen.haloStart + phase * pen.haloGrow), 0, Math.PI * 2);
            ctx.globalAlpha = 1 - phase;
            ctx.strokeStyle = pen.halo;
            ctx.lineWidth = pen.startWidth;
            ctx.stroke();
            ctx.restore();
            ctx.save();
            ctx.shadowBlur = pen.glow;
            ctx.shadowColor = pen.start;
            circle(p, r, pen.start, pen.outline);
            ctx.restore();
            if (activity.strokes.length > 1 || activity.showDots)
                label(p, activity.showDots ? t.checkpointIndex + 2 :
                    t.strokeIndex + 1, pen.number, pen.numberFont.replace('{size}', String(Math.round(r))));
            if (dwell > 0) {
                ctx.beginPath();
                ctx.arc(...pixel(p), r + pen.startWidth, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * dwell);
                ctx.strokeStyle = pen.finished;
                ctx.lineWidth = pen.startWidth;
                ctx.stroke();
            }
        }
        drawHint(now, points, width);
        if (trail.length)
            stroke(trail, pen.trail, pen.trailWidth);
    }
    function draw(now, dwell = 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.lineCap = ctx.lineJoin = 'round';
        for (const rule of ruler.lines) {
            const [, y] = pixel([0, rule.y]);
            ctx.beginPath();
            ctx.moveTo(ruler.inset, y);
            ctx.lineTo(w - ruler.inset, y);
            ctx.strokeStyle = rule.color;
            ctx.lineWidth = rule.width;
            ctx.setLineDash(rule.dash);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        if (activity.fill)
            drawFill(activity.fill.fraction);
        else
            drawTrace(now, dwell);
    }
    return {
        draw, local, target, reset, resize, stamp,
        hint() { hintTime = performance.now(); }, stopHint() { hintTime = Infinity; },
        lift() { lastInk = null; trail = []; },
        trace(p) { trail.push(p); if (trail.length > pen.trailLimit)
            trail.splice(0, pen.trailTrim); }
    };
}
