import { createBoard } from './board.js';
import { createVoice } from './voice.js';
function element(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(id);
    return node;
}
function format(template, fields) {
    return template.replace(/\{(\w+)\}/g, (_, key) => String(fields[key]));
}
function starsFrom(key) {
    try {
        const n = Number(localStorage.getItem(key));
        return Number.isSafeInteger(n) && n > 0 ? n : 0;
    }
    catch {
        return 0;
    }
}
export function canvasView(settings, tolerance) {
    return { open: activity => open(activity, settings, tolerance) };
}
async function open(activity, settings, tolerance) {
    const { labels, timing } = settings, query = new URLSearchParams(location.search);
    const stage = element('stage'), tip = element('tip'), live = element('live');
    const picker = element('picker'), ring = element('ring'), nextButton = element('nextBtn');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const board = createBoard(stage, activity, settings, reduced);
    let tipTimer = 0;
    function showTip(text) {
        tip.textContent = live.textContent = text;
        tip.classList.add('show');
        clearTimeout(tipTimer);
        tipTimer = window.setTimeout(() => tip.classList.remove('show'), timing.tip);
    }
    const voice = await createVoice(settings, () => showTip(labels.noVoice));
    let stars = starsFrom(settings.initial.starKey), celebration = Infinity;
    let hover = query.get('input') === 'hover', auto = false, needsLeave = false;
    let position, startTime = null;
    let over = null, heldButton = null;
    let buttonTime = 0, buttonFired = false;
    const pickerButtons = new Map();
    const pressed = (id, on) => element(id).setAttribute('aria-pressed', String(on));
    const lowerCase = (key) => key.length === 1 && key !== key.toUpperCase();
    function nameOf(key) {
        if (!voice.info(key))
            return key;
        return format(lowerCase(key) ? labels.lower : labels.upper, { key: key.toUpperCase() });
    }
    function updatePicker() {
        for (const [key, button] of pickerButtons) {
            if (key === activity.key)
                button.setAttribute('aria-current', 'true');
            else
                button.removeAttribute('aria-current');
            button.classList.toggle('done', activity.done.has(key));
        }
    }
    function buildPicker() {
        const keys = activity.keys.filter(k => lowerCase(k) === lowerCase(activity.key));
        if (!pickerButtons.has(activity.key)) {
            picker.replaceChildren();
            pickerButtons.clear();
            for (const key of keys) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'letter';
                b.setAttribute('aria-label', format(voice.info(key) ? labels.letter : labels.shape, { name: nameOf(key) }));
                const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
                svg.setAttribute('viewBox', settings.layout.pickerBox);
                svg.setAttribute('aria-hidden', 'true');
                for (const path of activity.pack[key]) {
                    const p = document.createElementNS(ns, 'path');
                    p.setAttribute('d', 'M' + path.map(pair => pair.join(' ')).join(' L'));
                    svg.append(p);
                }
                b.append(svg);
                picker.append(b);
                pickerButtons.set(key, b);
                b.addEventListener('click', () => select(key));
            }
        }
        updatePicker();
        pickerButtons.get(activity.key)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
    function resetScreen(speak) {
        const key = activity.key, info = voice.info(key), name = nameOf(key), count = activity.strokes.length;
        voice.stop();
        board.reset();
        startTime = null;
        auto = needsLeave = false;
        position = undefined;
        celebration = Infinity;
        nextButton.classList.remove('pulse');
        element('card').classList.remove('bounce');
        tip.classList.remove('show');
        tip.textContent = '';
        clearTimeout(tipTimer);
        element('card').style.display = info ? '' : 'none';
        element('cardLetters').textContent = key.toUpperCase() + key.toLowerCase();
        element('cardEmoji').textContent = info?.[3] ?? '';
        element('cardWord').textContent = info?.[2] ?? '';
        const small = lowerCase(key);
        pressed('upperBtn', !small);
        pressed('lowerBtn', small);
        element('upperBtn').disabled = !activity.keys.includes(key.toUpperCase());
        element('lowerBtn').disabled = !info || !activity.keys.includes(key.toLowerCase());
        element('hearBtn').disabled = !info;
        document.body.dataset.mode = activity.mode;
        pressed('fillModeBtn', !!activity.fill);
        pressed('traceModeBtn', !activity.fill);
        buildPicker();
        stage.setAttribute('aria-label', format(labels.board, { name, count, unit: count === 1 ? labels.stroke : labels.strokes }));
        live.textContent = name + '. ' + (activity.fill ? labels.fill : activity.showDots ? labels.dots : labels.trace);
        if (speak)
            void voice.play(key);
    }
    function select(key) { activity.select(key); resetScreen(true); }
    function next() { activity.next(); resetScreen(true); }
    function mode(value) {
        if (activity.mode !== value) {
            activity.setMode(value);
            resetScreen(false);
        }
    }
    function clearInput(cancelled) {
        if (activity.owner !== null)
            activity.release(activity.owner, cancelled);
        auto = false;
        startTime = null;
        board.lift();
        ring.classList.remove('pressed');
    }
    function setHover(on) {
        clearInput(true);
        position = undefined;
        needsLeave = false;
        hover = on;
        document.body.classList.toggle('hover-mode', on);
        pressed('hoverBtn', on);
        const text = on ? labels.hoverOn : labels.hoverOff;
        element('hoverBtn').setAttribute('aria-label', text);
        showTip(text);
    }
    function celebrate() {
        celebration = performance.now();
        stars++;
        element('starCount').textContent = String(stars);
        try {
            localStorage.setItem(settings.initial.starKey, String(stars));
        }
        catch { /* Storage is optional. */ }
        nextButton.classList.add('pulse');
        updatePicker();
        element('card').classList.add('bounce');
        live.textContent = format(activity.fill ? labels.filled : labels.traced, { name: nameOf(activity.key) });
        void voice.play(activity.key, true);
    }
    function feedback(type, point) {
        if (activity.fill && (type === 'paint' || type === 'glyph-complete'))
            board.stamp(point);
        switch (type) {
            case 'start':
                board.lift();
                board.stopHint();
                board.trace(point);
                break;
            case 'no-progress':
            case 'progress':
                if (activity.trace.mode === 'tracing')
                    board.trace(point);
                break;
            case 'miss-start':
                showTip(labels.miss);
                break;
            case 'strayed-cancel':
            case 'jump-cancel':
                board.lift();
                showTip(labels.retry);
                break;
            case 'stroke-complete':
                board.lift();
                live.textContent = format(labels.lift, { next: activity.trace.strokeIndex + 1, count: activity.strokes.length });
                break;
            case 'glyph-complete':
                board.lift();
                celebrate();
                break;
        }
        if (auto && (type.endsWith('-complete') || type.endsWith('-cancel') || type === 'miss-start')) {
            clearInput(false);
            needsLeave = true;
        }
    }
    function onButton(id, f) { element(id).addEventListener('click', f); }
    onButton('upperBtn', () => { if (lowerCase(activity.key))
        select(activity.key.toUpperCase()); });
    onButton('lowerBtn', () => { if (!lowerCase(activity.key))
        select(activity.key.toLowerCase()); });
    onButton('hintBtn', board.hint);
    onButton('againBtn', () => { activity.select(activity.key); resetScreen(false); });
    onButton('nextBtn', next);
    onButton('traceModeBtn', () => mode('trace'));
    onButton('fillModeBtn', () => mode('fill'));
    onButton('hoverBtn', () => setHover(!hover));
    onButton('hearBtn', () => { void voice.play(activity.key, false, true); });
    onButton('soundBtn', () => {
        voice.toggle();
        pressed('soundBtn', voice.enabled);
        element('soundBtn').setAttribute('aria-label', voice.enabled ? labels.soundOn : labels.soundOff);
        document.getElementById('soundWaves').style.display = voice.enabled ? '' : 'none';
        if (voice.enabled)
            void voice.play(activity.key, false, true);
    });
    stage.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0)
            return;
        e.preventDefault();
        if (auto || (activity.owner !== null && activity.owner !== e.pointerId))
            return;
        if (activity.complete) {
            if (performance.now() - celebration > timing.nextTap)
                next();
            return;
        }
        const p = board.local(e.clientX, e.clientY);
        try {
            stage.setPointerCapture(e.pointerId);
        }
        catch { /* Dispatched events may have no native capture. */ }
        board.lift();
        board.stopHint();
        feedback(activity.down(e.pointerId, p), p);
    });
    stage.addEventListener('pointermove', e => {
        const id = e.pointerId;
        if (activity.owner !== null && activity.owner !== id)
            return;
        const samples = e.getCoalescedEvents?.() ?? [];
        for (const sample of samples.length ? samples : [e]) {
            const point = board.local(sample.clientX, sample.clientY);
            position = { id, point };
            if (hover && activity.fill && activity.owner === null && !activity.complete) {
                auto = true;
                feedback(activity.down(id, point), point);
            }
            else if (activity.owner === id)
                feedback(activity.move(id, point), point);
        }
    });
    function release(e, cancelled) {
        if (auto || activity.owner !== e.pointerId)
            return;
        clearInput(cancelled);
        if (e.pointerType !== 'mouse')
            position = undefined;
        if (stage.hasPointerCapture(e.pointerId))
            stage.releasePointerCapture(e.pointerId);
    }
    stage.addEventListener('pointerup', e => release(e, false));
    stage.addEventListener('pointercancel', e => {
        if (auto && activity.owner === e.pointerId) {
            clearInput(true);
            position = undefined;
        }
        else
            release(e, true);
    });
    stage.addEventListener('lostpointercapture', e => release(e, true));
    stage.addEventListener('pointerleave', () => {
        if (auto)
            clearInput(true);
        position = undefined;
        needsLeave = false;
        startTime = null;
    });
    stage.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointermove', e => {
        ring.classList.toggle('show', e.pointerType !== 'touch');
        ring.classList.toggle('pressed', activity.owner !== null || e.buttons > 0);
        ring.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
        over = e.target instanceof Element ? e.target.closest('button:enabled') : null;
    }, true);
    document.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch')
        ring.classList.add('pressed'); }, true);
    document.addEventListener('pointerup', () => ring.classList.remove('pressed'), true);
    document.documentElement.addEventListener('pointerleave', () => { over = null; ring.classList.remove('show'); });
    window.addEventListener('blur', () => { clearInput(true); over = null; position = undefined; ring.classList.remove('show'); });
    function dwell(now) {
        const button = hover ? over : null;
        if (button !== heldButton) {
            heldButton?.classList.remove('dwelling');
            heldButton?.style.removeProperty('--dwell');
            buttonTime = now;
            heldButton = button;
            buttonFired = false;
        }
        if (button && !buttonFired) {
            const f = Math.min(1, (now - buttonTime) / timing.dwellButton);
            button.classList.add('dwelling');
            button.style.setProperty('--dwell', String(f));
            if (f >= 1) {
                buttonFired = true;
                button.classList.remove('dwelling');
                button.click();
            }
        }
        if (!hover || !position || activity.owner !== null || activity.fill || activity.complete) {
            startTime = null;
            return 0;
        }
        const [x, y] = board.target(), { point, id } = position;
        const d = Math.hypot(point[0] - x, point[1] - y);
        const radius = activity.showDots ? settings.dots.radius : settings.hover[tolerance];
        if (needsLeave && d > radius * settings.hover.leaveFactor)
            needsLeave = false;
        if (d > radius || needsLeave) {
            startTime = null;
            return 0;
        }
        startTime ??= now;
        const f = Math.min(1, (now - startTime) / timing.dwellStart);
        if (f >= 1) {
            auto = true;
            feedback(activity.down(id, point), point);
            startTime = null;
        }
        return f;
    }
    const first = query.get('letter');
    if (first && activity.keys.includes(first))
        activity.select(first);
    if (query.get('mode') === 'fill')
        activity.setMode('fill');
    element('starCount').textContent = String(stars);
    if (hover)
        setHover(true);
    resetScreen(false);
    board.resize();
    if ('ResizeObserver' in window)
        new ResizeObserver(board.resize).observe(stage);
    window.addEventListener('resize', board.resize);
    function frame(now) { board.draw(now, dwell(now)); requestAnimationFrame(frame); }
    board.draw(performance.now());
    requestAnimationFrame(frame);
    window.tracerState = () => ({ key: activity.key, strokes: structuredClone(activity.strokes) });
}
