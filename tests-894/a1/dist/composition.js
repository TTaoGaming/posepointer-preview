import { run } from "./application.js";
import { pointlist } from "./data/pointlist.js";
import { svgpath } from "./data/svgpath.js";
import { createTracer, PRESETS } from "./rules/stroke-rule.js";
import { createDotTracer } from "./rules/dotdot.js";
import { canvasView } from "./view/canvas.js";
export async function launch(settings, options) {
    const { adapters, sources } = settings;
    const data = {
        pointlist: () => pointlist(sources.pointlist),
        svgpath: () => svgpath(sources.svgpath, settings.curveSteps)
    };
    const rules = {
        stroke: { create: (strokes, tolerance) => createTracer(strokes, { tolerance }) },
        dotdot: { create: (strokes, tolerance) => createDotTracer(strokes, settings.dotSpacing, PRESETS[tolerance]) }
    };
    const views = { canvas: canvasView };
    return run(settings, data[adapters.stroke_data](), rules[adapters.trace_rule], await views[adapters.view](settings), options);
}
