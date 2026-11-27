import { launch } from './activity.js';
import { pointList } from './data/pointlist.js';
import { svgPath } from './data/svgpath.js';
import { createTracer } from './rules/stroke-rule.js';
import { dotRule } from './rules/dotdot-rule.js';
import { canvasView } from './view/canvas.js';
function select(registry, id) {
    if (!Object.hasOwn(registry, id))
        throw new RangeError(id);
    return registry[id];
}
export function compose(settings, tolerance) {
    const { adapters, files, dots } = settings;
    const packs = {
        pointlist: pointList(files.pointlist), svgpath: svgPath(files.svgpath, settings.curveSteps)
    };
    const rules = {
        stroke: { create: createTracer, showDots: false }, dotdot: dotRule(dots.spacing, dots.radius)
    };
    const views = { canvas: canvasView(settings, tolerance) };
    return launch(select(packs, adapters.stroke_data), select(rules, adapters.trace_rule), select(views, adapters.view), settings, tolerance);
}
