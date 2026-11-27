// All coordinates entering the application are glyph units. Dwell uses the
// same down/move/release interface as a press and tracks the physical pointer.
export function pointerInput(stage, controls, board, renderer, config) {
    const ring = document.getElementById("ring");
    let owner = null, dwelling = false, hover = false;
    let hoverPoint = null;
    let since = null, needLeave = false;
    let over = null, buttonSince = 0;
    let button = null, fired = null;
    function clearButton() {
        button?.classList.remove("dwelling");
        button?.style.removeProperty("--dwell");
        button = null;
    }
    function release(cancelled) {
        const id = owner;
        owner = null;
        dwelling = false;
        since = null;
        if (id !== null) {
            controls.release(id, cancelled);
            if (stage.hasPointerCapture(id))
                stage.releasePointerCapture(id);
        }
        ring.classList.remove("pressed");
    }
    function reset() {
        release(true);
        hoverPoint = null;
        since = null;
        needLeave = false;
        clearButton();
        over = null;
        fired = null;
    }
    function afterSample() {
        if (!dwelling)
            return;
        const trace = board().trace;
        if (trace.mode === "blocked" || trace.isComplete) {
            release(false);
            needLeave = true;
        }
    }
    function local(event) { return renderer.local(event.clientX, event.clientY); }
    stage.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0)
            return;
        if (dwelling || (owner !== null && owner !== event.pointerId))
            return;
        event.preventDefault();
        if (board().complete) {
            if (renderer.canAdvance())
                controls.next();
            return;
        }
        owner = event.pointerId;
        since = null;
        try {
            stage.setPointerCapture(owner);
        }
        catch { /* Input may come from a DOM dispatcher. */ }
        controls.down(owner, local(event));
    });
    stage.addEventListener("pointermove", event => {
        if (owner !== null && owner !== event.pointerId)
            return;
        const samples = event.getCoalescedEvents?.() || [];
        for (const sample of samples.length ? samples : [event]) {
            const point = local(sample);
            hoverPoint = { id: event.pointerId, point };
            if (owner === event.pointerId) {
                controls.move(owner, point);
                afterSample();
            }
            else if (hover && event.pointerType !== "touch")
                controls.hoverPaint(point);
        }
        if (event.pointerType === "touch")
            hoverPoint = null;
    });
    function end(event, cancelled) {
        if (owner !== event.pointerId || dwelling)
            return;
        release(cancelled);
        if (event.pointerType === "touch")
            hoverPoint = null;
    }
    stage.addEventListener("pointerup", e => end(e, false));
    stage.addEventListener("pointercancel", e => {
        if (dwelling && owner === e.pointerId)
            release(true);
        else
            end(e, true);
        hoverPoint = null;
    });
    stage.addEventListener("lostpointercapture", e => end(e, true));
    stage.addEventListener("pointerleave", e => {
        if (hoverPoint && hoverPoint.id !== e.pointerId)
            return;
        if (dwelling)
            release(true);
        if (hover && owner === null)
            controls.release(e.pointerId, true);
        hoverPoint = null;
        since = null;
    });
    stage.addEventListener("contextmenu", e => e.preventDefault());
    document.addEventListener("pointermove", event => {
        if (owner !== null && event.pointerId !== owner)
            return;
        const show = event.pointerType !== "touch";
        ring.classList.toggle("show", show);
        ring.classList.toggle("pressed", owner !== null || event.buttons > 0);
        ring.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
        over = show && event.target instanceof Element ? event.target.closest("button") : null;
    }, true);
    document.addEventListener("pointerdown", e => { if (e.pointerType !== "touch")
        ring.classList.add("pressed"); }, true);
    document.addEventListener("pointerup", () => ring.classList.remove("pressed"), true);
    document.documentElement.addEventListener("pointerleave", () => { over = null; ring.classList.remove("show"); });
    window.addEventListener("blur", () => { reset(); ring.classList.remove("show"); });
    function buttons(now) {
        if (fired !== over)
            fired = null;
        const next = over !== fired && !over?.disabled ? over : null;
        if (next !== button) {
            clearButton();
            button = next;
            buttonSince = now;
        }
        if (!button)
            return;
        const part = Math.min(1, (now - buttonSince) / config.dwellButtonMs);
        button.classList.add("dwelling");
        button.style.setProperty("--dwell", String(part));
        if (part >= 1) {
            const clicked = button;
            clearButton();
            fired = clicked;
            clicked.click();
        }
    }
    return {
        reset,
        setHover(on) { reset(); hover = on; document.body.classList.toggle("hover-mode", on); },
        tick(now) {
            if (!hover)
                return 0;
            buttons(now);
            if (!hoverPoint || owner !== null || board().activity !== "trace" || board().complete)
                return 0;
            const target = renderer.target(), { id, point } = hoverPoint;
            const distance = Math.hypot(point[0] - target.x, point[1] - target.y);
            const trace = board().trace;
            const radius = (trace.targetRadius ?? trace.tolerance.start) * config.dwellRadius;
            if (needLeave && distance > radius * config.dwellLeave)
                needLeave = false;
            if (needLeave || distance > radius) {
                since = null;
                return 0;
            }
            since ??= now;
            const part = Math.min(1, (now - since) / config.dwellStartMs);
            if (part === 1) {
                since = null;
                dwelling = true;
                owner = id;
                controls.down(id, point);
                afterSample();
            }
            return part;
        }
    };
}
