import { readJson } from "../data/read.js";
import { format } from "../settings.js";
import { drawing } from "./drawing.js";
import { pointerInput } from "./pointer.js";
import { createVoice } from "./voice.js";
export async function canvasView(settings) {
    const [lessons, clips] = await Promise.all([
        readJson(settings.sources.lessons),
        readJson(settings.sources.audioManifest).catch(() => ({}))
    ]);
    const voice = createVoice(settings, lessons, clips);
    const el = (id) => document.getElementById(id);
    const stage = el("stage"), picker = el("picker"), tip = el("tip"), live = el("live");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = drawing(stage, settings, reduced);
    const copy = settings.copy, config = settings.interaction;
    const done = new Set();
    const buttons = new Map();
    let stars = 0, pack, controls, board;
    let input, timer;
    let hover = new URLSearchParams(location.search).get("input") === "hover";
    function name(key) {
        if (!lessons[key.toLowerCase()])
            return key;
        return format(key === key.toUpperCase() ? copy.upper : copy.lower, { key: key.toUpperCase() });
    }
    function label(key) {
        return format(lessons[key.toLowerCase()] ? copy.keyLabel : copy.shapeLabel, { key, name: name(key) });
    }
    function message(text) {
        tip.textContent = text;
        tip.classList.add("show");
        clearTimeout(timer);
        timer = setTimeout(() => tip.classList.remove("show"), config.tipMs);
    }
    function press(id, value) { el(id).setAttribute("aria-pressed", String(value)); }
    function hoverMode(on, notify) {
        hover = on;
        input.setHover(on);
        press("hoverBtn", on);
        el("hoverBtn").setAttribute("aria-label", on ? copy.hoverOnLabel : copy.hoverOffLabel);
        if (notify)
            message(on ? copy.hoverOn : copy.hoverOff);
    }
    function markPicker() {
        for (const [key, b] of buttons) {
            if (key === board.key)
                b.setAttribute("aria-current", "true");
            else
                b.removeAttribute("aria-current");
            b.classList.toggle("done", done.has(key));
        }
    }
    function makePicker() {
        const isLower = (key) => key.length === 1 && key !== key.toUpperCase();
        const keys = Object.keys(pack).filter(k => isLower(k) === isLower(board.key));
        if (keys.length !== buttons.size || keys.some(k => !buttons.has(k))) {
            picker.replaceChildren();
            buttons.clear();
            const template = el("pickerGlyph");
            for (const key of keys) {
                const b = document.createElement("button");
                b.type = "button";
                b.className = "letter";
                b.setAttribute("aria-label", label(key));
                const svg = template.content.firstElementChild.cloneNode(true);
                const pen = svg.firstElementChild;
                pen.remove();
                for (const stroke of pack[key]) {
                    const p = pen.cloneNode(false);
                    p.setAttribute("d", "M" + stroke.map(point => point.join(" ")).join(" L"));
                    svg.appendChild(p);
                }
                b.appendChild(svg);
                b.addEventListener("click", () => controls.select(key));
                buttons.set(key, b);
                picker.appendChild(b);
            }
        }
        markPicker();
        buttons.get(board.key)?.scrollIntoView({ block: "nearest", inline: "center", behavior: reduced ? "auto" : "smooth" });
        for (const [id, key] of [["upperBtn", board.key.toUpperCase()], ["lowerBtn", board.key.toLowerCase()]]) {
            const b = el(id);
            b.disabled = board.key.length !== 1 || !Object.hasOwn(pack, key);
            press(id, !b.disabled && key === board.key);
        }
    }
    return {
        mount(glyphs, actions) {
            pack = glyphs;
            controls = actions;
            input = pointerInput(stage, actions, () => board, renderer, config);
            try {
                stars = Math.max(0, parseInt(localStorage.getItem(config.starsKey) || "", 10) || 0);
            }
            catch { /* Optional storage. */ }
            el("starCount").textContent = String(stars);
            const on = (id, fn) => el(id).addEventListener("click", fn);
            on("upperBtn", () => controls.select(board.key.toUpperCase()));
            on("lowerBtn", () => controls.select(board.key.toLowerCase()));
            on("againBtn", controls.restart);
            on("nextBtn", controls.next);
            on("hintBtn", renderer.startHint);
            on("hearBtn", () => voice.play(board.key));
            on("traceModeBtn", () => controls.setActivity("trace"));
            on("fillModeBtn", () => controls.setActivity("fill"));
            on("hoverBtn", () => hoverMode(!hover, true));
            on("soundBtn", () => {
                const enabled = voice.toggle();
                press("soundBtn", enabled);
                el("soundBtn").setAttribute("aria-label", enabled ? copy.soundOn : copy.soundOff);
                el("soundWaves").style.display = enabled ? "" : "none";
                if (enabled)
                    voice.play(board.key);
            });
            hoverMode(hover, false);
            renderer.resize();
            if ("ResizeObserver" in window)
                new ResizeObserver(renderer.resize).observe(el("board"));
            window.addEventListener("resize", renderer.resize);
            function frame(now) { renderer.draw(now, input.tick(now)); requestAnimationFrame(frame); }
            requestAnimationFrame(frame);
        },
        selected(state, quiet) {
            const delay = board && quiet ? config.restartHintMs : config.firstHintMs;
            board = state;
            input.reset();
            renderer.setup(board, delay);
            clearTimeout(timer);
            tip.classList.remove("show");
            document.body.dataset.mode = board.activity;
            press("fillModeBtn", board.activity === "fill");
            press("traceModeBtn", board.activity === "trace");
            el("nextBtn").classList.remove("pulse");
            el("card").classList.remove("bounce");
            const lesson = lessons[board.key.toLowerCase()];
            el("cardLetters").textContent = lesson ? board.key.toUpperCase() + board.key.toLowerCase() : board.key;
            el("cardEmoji").textContent = lesson?.[3] || "";
            el("cardWord").textContent = lesson?.[2] || "";
            makePicker();
            const count = board.strokes.length, title = label(board.key);
            stage.setAttribute("aria-label", format(copy.board, { label: title, count, unit: count === 1 ? copy.stroke : copy.strokes }));
            live.textContent = format(board.activity === "fill" ? copy.startFill : board.trace.showDots ? copy.startDots : copy.start, { label: title });
            if (!quiet)
                voice.play(board.key);
        },
        feedback(event, point) {
            switch (event.type) {
                case "miss-start":
                    message(copy.miss);
                    live.textContent = copy.miss;
                    break;
                case "jump-cancel":
                case "strayed-cancel":
                    renderer.clearTrail();
                    message(copy.retry);
                    live.textContent = copy.retry;
                    break;
                case "stroke-complete":
                    renderer.clearTrail();
                    live.textContent = format(copy.lift, { next: event.stroke + 1, count: board.strokes.length });
                    break;
                case "start":
                case "progress":
                case "no-progress":
                    if (point)
                        renderer.move(point, event.type === "start");
                    break;
                case "released":
                case "released-early":
                case "cancelled":
                    renderer.clearTrail();
                    break;
            }
        },
        paint: renderer.paint,
        celebrate() {
            done.add(board.key);
            stars++;
            el("starCount").textContent = String(stars);
            try {
                localStorage.setItem(config.starsKey, String(stars));
            }
            catch { /* Keep session stars. */ }
            renderer.celebrate();
            markPicker();
            el("nextBtn").classList.add("pulse");
            el("card").classList.add("bounce");
            live.textContent = format(board.activity === "fill" ? copy.filled : copy.traced, { name: name(board.key) });
            voice.play(board.key, copy.praise);
        }
    };
}
