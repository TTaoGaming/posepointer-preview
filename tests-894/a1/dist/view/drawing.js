import { format } from "../settings.js";
export function fitStage(w, h, box) {
    const scale = Math.max(box.minScale, Math.min((w - 2 * box.padding) / box.width, (h - 2 * box.padding) / box.height));
    return { scale, ox: (w - box.width * scale) / 2, oy: (h - box.height * scale) / 2 };
}
function path(ctx, points) {
    ctx.beginPath();
    points.forEach(([x, y], i) => { if (i)
        ctx.lineTo(x, y);
    else
        ctx.moveTo(x, y); });
}
export function drawing(stage, settings, reduced) {
    const ctx = stage.getContext("2d");
    const box = settings.layout, c = settings.canvas;
    const paintLayer = document.createElement("canvas"), mask = document.createElement("canvas");
    for (const layer of [paintLayer, mask]) {
        layer.width = box.width * c.paintScale;
        layer.height = box.height * c.paintScale;
    }
    const brush = paintLayer.getContext("2d"), maskCtx = mask.getContext("2d");
    let w = 0, h = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
    let board, lastPaint, trail = [];
    let hintAt = Infinity, celebrationAt = -Infinity;
    let confetti = [];
    function resize() {
        const rect = stage.getBoundingClientRect();
        w = rect.width;
        h = rect.height;
        dpr = Math.max(1, Math.min(box.maxDpr, window.devicePixelRatio || 1));
        stage.width = Math.round(w * dpr);
        stage.height = Math.round(h * dpr);
        ({ scale, ox, oy } = fitStage(w, h, box));
    }
    function local(clientX, clientY) {
        const rect = stage.getBoundingClientRect();
        return [(clientX - rect.left - ox) / scale, (clientY - rect.top - oy) / scale];
    }
    function line(stroke, color, width) {
        path(ctx, stroke);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
    }
    function circle(x, y, radius, fill) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
    }
    function setup(boardState, hintDelay) {
        board = boardState;
        trail = [];
        confetti = [];
        lastPaint = undefined;
        hintAt = performance.now() + hintDelay;
        celebrationAt = -Infinity;
        brush.setTransform(c.paintScale, 0, 0, c.paintScale, 0, 0);
        brush.clearRect(0, 0, box.width, box.height);
        maskCtx.setTransform(c.paintScale, 0, 0, c.paintScale, 0, 0);
        maskCtx.clearRect(0, 0, box.width, box.height);
        if (board.activity === "fill") {
            maskCtx.lineWidth = board.fill.thick;
            maskCtx.lineJoin = maskCtx.lineCap = "round";
            for (const stroke of board.strokes) {
                path(maskCtx, stroke);
                maskCtx.stroke();
            }
        }
    }
    function paint(point, newDrag) {
        const color = format(c.paintColor, { hue: Math.round(Math.max(0, Math.min(c.maxHue, point[0] * c.hueScale))) });
        brush.lineCap = "round";
        brush.strokeStyle = brush.fillStyle = color;
        brush.lineWidth = board.fill.brush * 2;
        if (lastPaint && !newDrag) {
            path(brush, [lastPaint, point]);
            brush.stroke();
        }
        else {
            brush.beginPath();
            brush.arc(...point, board.fill.brush, 0, 2 * Math.PI);
            brush.fill();
        }
        lastPaint = point;
        brush.save();
        brush.setTransform(1, 0, 0, 1, 0, 0);
        brush.globalCompositeOperation = "destination-in";
        brush.drawImage(mask, 0, 0);
        brush.restore();
    }
    const asPoint = (p) => [p.x, p.y];
    function target() {
        const t = board.trace, points = t.checkpoints[t.strokeIndex];
        return points[t.showDots ? Math.min(t.checkpointIndex + 1, points.length - 1) : 0];
    }
    function hint(now, points) {
        const elapsed = now - hintAt;
        const cycle = c.demonstrationMs + c.demoGapMs;
        if (elapsed < 0 || elapsed >= c.demoLoops * cycle)
            return;
        const f = Math.min(1, (elapsed % cycle) / c.demonstrationMs);
        const at = (f < 0.5 ? 2 * f * f : 1 - ((-2 * f + 2) ** 2) / 2) * (points.length - 1);
        const i = Math.floor(at), a = points[i], b = points[Math.min(i + 1, points.length - 1)];
        const x = a.x + (b.x - a.x) * (at - i), y = a.y + (b.y - a.y) * (at - i);
        line([...points.slice(0, i + 1).map(asPoint), [x, y]], c.demoTrail, c.guideWidth);
        circle(x, y, c.demoRadius / scale, c.demoFill);
        ctx.lineWidth = c.startOutline / scale;
        ctx.strokeStyle = c.startEdge;
        ctx.stroke();
    }
    function numberAt(point, value, fill) {
        ctx.save();
        ctx.translate(...point);
        ctx.scale(1 / scale, 1 / scale);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = c.numberFont;
        ctx.fillStyle = fill;
        ctx.fillText(String(value), 0, 0);
        ctx.restore();
    }
    function trace(now, dwell) {
        const t = board.trace, strokes = board.strokes, points = t.checkpoints[t.strokeIndex];
        const rainbow = ctx.createLinearGradient(0, 0, box.width, box.height);
        c.rainbow.forEach((color, i) => rainbow.addColorStop(i / (c.rainbow.length - 1), color));
        for (const [i, stroke] of strokes.entries()) {
            if (board.complete || i < t.strokeIndex) {
                line(stroke, board.complete ? rainbow : c.done, c.guideWidth);
                continue;
            }
            line(stroke, c.guide, c.guideWidth);
            ctx.setLineDash([c.dashMark / scale, Math.max(c.minDashGap / scale, c.dashGap)]);
            line(stroke, c.dashColor, Math.max(c.minDashWidth / scale, c.dashWidth));
            ctx.setLineDash([]);
        }
        if (board.complete)
            return;
        if (t.checkpointIndex > 0)
            line(points.slice(0, t.checkpointIndex + 1).map(asPoint), c.progress, c.guideWidth);
        for (let i = t.strokeIndex + 1; i < strokes.length; i++) {
            circle(...strokes[i][0], c.numberRadius / scale, c.numberFill);
            numberAt(strokes[i][0], i + 1, c.numberInk);
        }
        if (t.showDots)
            points.forEach((p, i) => circle(p.x, p.y, c.dotRadius, i <= t.checkpointIndex ? c.done : c.numberInk));
        if (t.mode !== "tracing" || t.showDots) {
            const { x, y } = target();
            const radius = Math.max(c.startMin / scale, c.startSize);
            const phase = reduced ? 0.5 : (now % c.haloCycleMs) / c.haloCycleMs;
            ctx.beginPath();
            ctx.arc(x, y, radius * (c.haloMin + phase * c.haloExpand), 0, 2 * Math.PI);
            ctx.strokeStyle = c.halo;
            ctx.lineWidth = c.startOutline / scale;
            ctx.stroke();
            ctx.save();
            ctx.shadowColor = c.shadow;
            ctx.shadowBlur = c.blur;
            circle(x, y, radius, c.startFill);
            ctx.restore();
            ctx.strokeStyle = c.startEdge;
            ctx.stroke();
            if (t.showDots || strokes.length > 1)
                numberAt([x, y], t.showDots ? t.checkpointIndex + 2 : t.strokeIndex + 1, c.startInk);
            if (dwell > 0) {
                ctx.beginPath();
                ctx.arc(x, y, radius * c.haloMin, -Math.PI / 2, -Math.PI / 2 + dwell * 2 * Math.PI);
                ctx.strokeStyle = c.done;
                ctx.stroke();
            }
        }
        hint(now, points);
        if (trail.length > 1)
            line(trail, c.trail, c.trailWidth / scale);
    }
    function draw(now, dwell) {
        if (!board || !w || !h)
            return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.lineCap = ctx.lineJoin = "round";
        for (const ruler of c.rulers) {
            const y = ruler.y * scale + oy;
            ctx.setLineDash(ruler.dash);
            line([[c.rulerInset, y], [w - c.rulerInset, y]], ruler.color, ruler.width);
        }
        ctx.setLineDash([]);
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(scale, scale);
        if (board.activity === "fill") {
            for (const stroke of board.strokes)
                line(stroke, c.bubbleEdge, board.fill.thick + c.bubbleOutline / scale);
            for (const stroke of board.strokes)
                line(stroke, c.bubble, board.fill.thick);
            ctx.drawImage(paintLayer, 0, 0, box.width, box.height);
        }
        else
            trace(now, dwell);
        ctx.restore();
        if (board.activity === "fill") {
            const width = Math.max(0, Math.min(w - 2 * c.barInset, c.barWidth)), left = (w - width) / 2;
            ctx.fillStyle = c.barTrack;
            ctx.fillRect(left, c.barY, width, c.barHeight);
            ctx.fillStyle = c.done;
            ctx.fillRect(left, c.barY, width * Math.min(1, board.fill.coverage() / board.fill.goal), c.barHeight);
        }
        const age = now - celebrationAt;
        if (age < c.confettiMs) {
            const seconds = age / 1000;
            ctx.save();
            ctx.globalAlpha = 1 - age / c.confettiMs;
            for (const p of confetti)
                circle(w / 2 + p.x * seconds, h / 2 + p.y * seconds + c.gravity * seconds ** 2 / 2, p.size, p.color);
            ctx.restore();
        }
    }
    return {
        resize, local, setup, target, draw, paint,
        startHint() { if (!board.complete)
            hintAt = performance.now(); },
        move(point, start) {
            if (start) {
                trail = [];
                hintAt = Infinity;
            }
            trail.push(point);
            if (trail.length > c.trailLimit)
                trail.splice(0, c.trailTrim);
        },
        clearTrail() { trail = []; },
        celebrate() {
            celebrationAt = performance.now();
            trail = [];
            if (!reduced)
                confetti = Array.from({ length: c.confettiCount }, () => {
                    const angle = Math.random() * Math.PI * 2, speed = Math.random() * c.confettiSpeed;
                    return { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed - c.confettiSpeed / 2,
                        size: (1 + Math.random()) * c.confettiSize / 2, color: c.rainbow[Math.floor(Math.random() * c.rainbow.length)] };
                });
        },
        canAdvance() { return performance.now() - celebrationAt > settings.interaction.nextTapMs; }
    };
}
