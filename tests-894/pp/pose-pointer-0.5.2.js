/* PosePointer 0.5.2 */
(function(global){const scriptBase=(document.currentScript&&document.currentScript.src)||location.href;const modules={0:(module,exports,require)=>{
const { createMediaPipeSource } = require(70);const { createReplaySource } = require(69);const { createGestureMachine, mapPoint } = require(66);const { PRESETS, resolvePreset, toEngineOptions } = require(16);const { createStallGuard } = require(15);const { videoBox, visibleZone } = require(14);const { createDOMOutput } = require(13);const skeleton = require(12).default;const anatomy = require(4).default;const { createPresetBar } = require(2);const { createStartButton } = require(3);const { validateApp, buttonItems, cursorShown, rectAt } = require(1);

// Presentation (0.1.3, spatial app library request 2026-10-31): view = onscreen | pip | mirror | none, and
// scene = none | skeleton | anatomy (0.2.0). Presentation never changes pointer events.
const VIEWS = Object.freeze(['onscreen', 'pip', 'mirror', 'none']);
const SCENES = Object.freeze({ none: null, skeleton, anatomy });
// A preset can name its look: visual.layers with "skeleton" draws the wireframe; compositor pip or video picks the view.
const presentationOf = (config, view, scene) => ({
  view: view ?? (config.compositor?.type === 'pip' ? 'pip' : config.compositor?.type === 'video' ? 'mirror' : 'onscreen'),
  scene: scene ?? (config.visual?.layers?.includes('skeleton') ? 'skeleton' : 'none'),
});

const embedScript = document.currentScript;
const embedBase = embedScript?.src || document.baseURI;

// The corner preview scales with the screen: 240x180 on desktops, about a quarter of the width on phones (0.1.6: on a
// Pixel 7 the fixed 240 px box took 57% of the width and covered app controls; mise factory red team, rounds 1-3).
// Anchors that put the cursor beyond the hand (presets.json anchor.type): the package draws the ray to them.
const RAY_ANCHORS = Object.freeze(['fingerRay', 'ray', 'wristRay', 'fixedRay']);
const PIP = 'position:fixed;right:12px;bottom:12px;width:min(240px,max(96px,26vw));height:auto;aspect-ratio:4/3;border-radius:8px;';
const pipWidth = viewportWidth => Math.min(240, Math.max(96, viewportWidth * 0.26));
// The cursor fills clockwise while a dwell (or any hold) is under way, so a user sees a click coming and can move away.
const ring = p => p > 0 ? `conic-gradient(#ff9f2e ${Math.round(p * 360)}deg, rgba(0,0,0,.35) 0)` : 'transparent';

// The drawing layer. Mirror view (0.2.0): the scene canvas and, under frame lock, the frame canvas take exactly the
// rectangle object-fit: cover gives the camera picture (core/overlay/video-box.js), so drawings sit on the hand on any
// screen shape. Before, the scene filled the window and drifted off the hand when the window and camera shapes differed.
const cursorLayer = (container, view, video, frameCanvas, scene0, replay, onZone, pageSceneId = 'none') => {
  if (view === 'none') return { update() {}, draw() {}, setScene() {}, remove() {} };
  const layer = document.createElement('div');
  layer.dataset.posepointerView = view;
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const cursor = document.createElement('i');
  cursor.style.cssText = 'visibility:hidden;position:absolute;width:22px;height:22px;border:3px solid #ff9f2e;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 2px #fff';
  // Ray anchors (0.2.1): a line from the fingertip to the cursor, so a cursor that sits past the finger reads as a pointer.
  const ray = document.createElement('b');
  ray.style.cssText = 'visibility:hidden;position:absolute;left:0;top:0;height:3px;margin-top:-1.5px;border-radius:2px;background:#ff9f2e;box-shadow:0 0 0 1px #fff;transform-origin:0 50%';
  let canvas = null, scene = null, sceneId = 'none', drawn = 0, box = null, token = 0, fitted = '', pending = null, last = null;
  // A replay has no camera picture: it draws in a 16:9 picture, as the mirror does (recorded tracks carry no size).
  const picture = () => replay ? { width: 1280, height: 720 } : { width: video.videoWidth, height: video.videoHeight };
  const size = () => view === 'pip' ? { width: pipWidth(innerWidth), height: pipWidth(innerWidth) * 0.75 } : view === 'mirror' ? (box ? { width: box.width, height: box.height } : null) : { width: innerWidth, height: innerHeight };
  // 0.1.7 (0.5 line): a second wireframe over the whole page while the camera picture stays in the corner (view pip + pageScene).
  const pageCanvas = view === 'pip' && SCENES[pageSceneId] ? document.createElement('canvas') : null;
  if (pageCanvas) { pageCanvas.dataset.posepointerScene = pageSceneId; pageCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; layer.append(pageCanvas); }
  const pageScene = pageCanvas ? SCENES[pageSceneId].create({ canvas: pageCanvas }) : null;
  const fit = () => {
    if (view === 'mirror') {
      const pic = picture(); box = videoBox({ width: innerWidth, height: innerHeight }, pic, 'cover'); fitted = `${pic.width}x${pic.height}`;
      const zone = visibleZone({ width: innerWidth, height: innerHeight }, pic); if (zone) onZone?.(zone);
      for (const el of [canvas, frameCanvas]) if (el) Object.assign(el.style, box ? { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`, visibility: '' } : { visibility: 'hidden' });
    }
    const s = size(); if (scene && s) scene.resize(s.width, s.height, Math.min(devicePixelRatio || 1, 2));
    if (pageScene) pageScene.resize(innerWidth, innerHeight, devicePixelRatio || 1);
  };
  // A new canvas per scene: a canvas that once gave a WebGL context cannot give a 2D one, and the reverse.
  // A look that keeps the scene and its build (anatomy: same hand end and muscle opacity, no newly needed vessels) only
  // restyles it: no new canvas, no flicker, no second WebGL context.
  let built = null;
  const setScene = async (id, options = {}) => {
    // A restyle redraws the last frame at once, so a look switched while stopped shows no stale layers (RT #5).
    if (scene && id === sceneId && SCENES[id]?.restyle?.(scene, built, options)) { built = options; const s = size(); if (last && s) { scene.update(last, s); scene.render(); } return; }
    const mine = ++token; scene?.dispose(); scene = null; canvas?.remove(); canvas = null; sceneId = id; layer.dataset.posepointerScene = id;
    if (!SCENES[id]) return;
    const next = document.createElement('canvas'); next.dataset.posepointerScene = id;
    next.style.cssText = view === 'pip' ? `${PIP}pointer-events:none` : view === 'mirror' ? 'position:absolute;visibility:hidden' : 'position:absolute;inset:0;width:100%;height:100%';
    layer.prepend(next); canvas = next;
    const made = await SCENES[id].create({ canvas: next, opacity: 1, lineWidth: 3, ...options });
    if (mine !== token) { made.dispose(); return; } // a newer look won the race
    scene = made; built = options; fit();
  };
  const ready = setScene(scene0.id, scene0.options);
  addEventListener('resize', fit); video.addEventListener('resize', fit); video.addEventListener('loadedmetadata', fit);
  // The cursor and its ray sit in their own top layer (0.2.2), appended after an app's buttons, so a cursor on a button
  // is drawn over it; the scene stays in the lower layer, under the buttons. Before, the buttons hid the cursor.
  const top = document.createElement('div');
  top.dataset.posepointerView = view; top.dataset.posepointerCursor = '';
  top.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  top.append(ray, cursor); container.append(layer, top);
  if (view === 'mirror' && replay) fit();
  return {
    ready,
    update(e) { cursor.style.left = `${e.x * 100}%`; cursor.style.top = `${e.y * 100}%`; },
    progress(p) { cursor.style.background = ring(p); },
    // Frames that arrive in one task (a replay catching up after a stall) draw once, with the newest frame, at the end of
    // that task: a camera frame still draws in the same task that put its picture on screen (frame lock), and a burst
    // can no longer queue one heavy anatomy render per frame and stall the page.
    draw(frame, pageFrame) {
      if (pageScene) { pageScene.update(pageFrame ?? frame, { width: innerWidth, height: innerHeight }); pageScene.render(); }
      const first = pending === null; pending = frame; if (!first) return;
      queueMicrotask(() => {
        const next = pending; pending = null;
        if (view === 'mirror' && (!box || (!replay && video.videoWidth && fitted !== `${video.videoWidth}x${video.videoHeight}`))) fit();
        const s = size(); if (!scene || !s) return;
        last = next; scene.update(next, s); scene.render(); layer.dataset.posepointerDrawn = String(++drawn);
      });
    },
    // The cursor shows only while a hand is in view (before, it sat in the top-left corner until the first hand).
    showCursor(on) { cursor.style.visibility = on ? '' : 'hidden'; },
    // from and to are screen fractions (0..1); null hides the ray.
    ray(from, to) {
      if (!from || !to) { ray.style.visibility = 'hidden'; return; }
      const x0 = from.x * innerWidth, y0 = from.y * innerHeight, dx = to.x * innerWidth - x0, dy = to.y * innerHeight - y0;
      Object.assign(ray.style, { visibility: '', width: `${Math.hypot(dx, dy)}px`, transform: `translate(${x0}px,${y0}px) rotate(${Math.atan2(dy, dx)}rad)` });
    },
    setScene,
    get sceneId() { return sceneId; },
    raise() { container.append(top); },
    remove() { token++; removeEventListener('resize', fit); scene?.dispose(); pageScene?.dispose(); layer.remove(); top.remove(); },
  };
};

const PosePointer = Object.freeze({
  create({ preset = 'default', presets = PRESETS, container = document.body, assetsBase = '../bridge/vendor/', view: viewOption, scene: sceneOption, pageScene: pageSceneOption, inputMode: inputModeOption, bounds: boundsSelector, postMessage = false, replayUrl, delegate, looks, look: lookOption, cursor: cursorMode = 'hand', cursorRects = () => [] } = {}) {
    const listeners = new Map(), base = new URL(assetsBase, embedBase);
    const first = resolvePreset(presets, preset === 'default' ? presets.default : preset);
    const { view, scene: presetScene } = presentationOf(first, viewOption, looks ? looks[lookOption]?.scene : sceneOption);
    if (!VIEWS.includes(view)) throw new Error(`view must be one of ${VIEWS.join(', ')}`);
    if (looks && !looks[lookOption]) throw new Error(`look ${lookOption} is not one of the looks`);
    const lookOf = id => looks?.[id] ?? { scene: presetScene, videoOpacity: 0.35 };
    if (!(lookOf(lookOption).scene in SCENES)) throw new Error(`scene must be one of ${Object.keys(SCENES).join(', ')}`);
    const video = document.createElement('video');
    video.playsInline = true; video.muted = true; video.hidden = view !== 'pip' && view !== 'mirror';
    // Frame lock in mirror view (the mirror's phone fix, Tao 2026-10-29 22:06Z): the page shows the very frame the
    // landmarks came from, drawn into frameCanvas by the camera port, so drawings never lag the picture. The live video
    // stays composited (almost transparent) because the frame callbacks need it.
    const frameLock = view === 'mirror' && !replayUrl;
    const frameCanvas = frameLock ? document.createElement('canvas') : null;
    // The camera picture is shown mirrored, like a mirror; it never takes pointer events.
    if (view === 'pip') video.style.cssText = `${PIP}object-fit:cover;transform:scaleX(-1);z-index:2147483646;pointer-events:none`;
    if (view === 'mirror') video.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);z-index:2147483646;pointer-events:none';
    if (frameCanvas) { frameCanvas.style.cssText = 'position:fixed;visibility:hidden;transform:scaleX(-1);z-index:2147483646;pointer-events:none'; }
    container.append(video); if (frameCanvas) container.append(frameCanvas);
    let lookId = lookOption ?? null;
    const sceneOptions = look => ({ assetsBase: base.href, look, frameLocked: frameLock });
    const paintLook = look => { if (view !== 'mirror') return; video.style.opacity = frameLock ? '0.001' : String(look.videoOpacity); if (frameCanvas) frameCanvas.style.opacity = String(look.videoOpacity); };
    paintLook(lookOf(lookId));
    // Mirror view: the active area is the part of the picture on screen, so the cursor (and every pointer event) lands
    // where the picture shows the fingertip. Other views keep the preset's zone.
    let mirrorZone = null, machineRef = null, zoneRef = null;
    const onZone = z => { mirrorZone = z; zoneRef = z; machineRef?.setZone(z); };
    // Page wireframe over a corner camera picture: from the option, else from the preset (compositor pip + overlay.page overlay + skeleton layer).
    const pageSceneId = view !== 'pip' ? 'none' : pageSceneOption ?? (first.overlay?.page === 'overlay' && lookOf(lookId).scene === 'skeleton' ? 'skeleton' : 'none');
    if (!(pageSceneId in SCENES)) throw new Error(`pageScene must be one of ${Object.keys(SCENES).join(', ')}`);
    const cursor = cursorLayer(container, view, video, frameCanvas, { id: lookOf(lookId).scene, options: sceneOptions(lookOf(lookId)) }, !!replayUrl, onZone, pageSceneId);
    cursor.ready?.catch(e => emit('error', { where: 'scene', message: e?.message || String(e) }));
    const output = createDOMOutput({ document });
    // 0.5.0-dev.5: if no frame arrives within FRAME_STALL_RELEASE_MS (200 ms), a held press is released, so a source that stops mid-pinch never leaves the page with a stuck press.
    const guard = createStallGuard({ release: () => output.release(), hide: () => cursor.showCursor?.(false), notify: () => emit('stall', { t: performance.now() }) });
    let starting = null, startGen = 0, handSeen = false, machine, zone, inputMode = 'mouse', source, running = false, selected = preset === 'default' ? presets.default : preset;
    const emit = (name, value) => listeners.get(name)?.forEach(fn => fn(value));
    // 0.1.7 (0.5 line): bounds (CSS selector) maps the cursor, the page wireframe and the frame event into that element's rectangle, so a hosted app that only listens inside its board (2048) gets every press there. The zone still picks the area of the camera that is used.
    const toBounds = p => { const el = boundsSelector && document.querySelector(boundsSelector); if (!el) return p; const r = el.getBoundingClientRect(); return { ...p, x: (r.left + p.x * r.width) / innerWidth, y: (r.top + p.y * r.height) / innerHeight }; };
    const deliver = rawEvent => {
      const event = guard.filter(rawEvent); if (!event) return;
      // 0.1.7 (0.5 line): the preset's input.mode "touch" sends the contact as touch events (apps that listen only for touch, such as 2048).
      const placed = Number.isFinite(event.x) && Number.isFinite(event.y) ? toBounds(event) : event;
      output.dispatch(inputMode === 'touch' ? { ...placed, pointerType: 'touch' } : placed); cursor.update(placed);
      if (postMessage) window.postMessage({ type: 'posepointer', ...placed }, '*');
    };
    const configure = id => {
      const config = resolvePreset(presets, id);
      const engine = toEngineOptions(config);
      // cursor: buttons limits dwell to the buttons too: the cursor, its fill and its click all start inside a button.
      // holdProgress starts at 0 on every update (interaction.js), so outside a button the fill is 0.
      if (cursorMode !== 'hand') engine.dwellWhere = p => rectAt(p, cursorRects());
      machine = createGestureMachine(engine); zone = engine.zone; inputMode = inputModeOption ?? engine.inputMode ?? 'mouse';
      machineRef = machine; zoneRef = zone; if (mirrorZone) { machine.setZone(mirrorZone); zoneRef = mirrorZone; }
      const rayAnchor = RAY_ANCHORS.includes(config.anchor?.type);
      source?.stop();
      // On the page the drawing goes through the same zone mapping as the cursor, so the cursor sits on the fingertip;
      // over the camera picture (pip, mirror) it is drawn where the hand is in the picture.
      const place = (p, mirrored) => view === 'onscreen' ? { ...p, ...toBounds(mapPoint(p, zone, mirrored)) } : { ...p, ...mapPoint(p, { x: 0, y: 0, w: 1, h: 1 }, mirrored) };
      const onFrame = frame => {
        guard.feed();
        // signalT marks a real source frame (core/pointer/hand-pointer.js): a hand lost mid-press ends as pointercancel, as POINTER-ABI.md requires, not as a pointerup that would finish a stroke or click.
        const state = machine.update({ ...frame, signalT: frame.t }); state.events.forEach(deliver);
        // cursor: buttons draws the cursor, its ray and its dwell fill only while it is on a button (0.2.2); from 0.5.1 dwell
        // also counts only on a button (dwellWhere), so the fill starts empty on entry and no hidden click lands elsewhere.
        const shown = cursorShown(cursorMode, !!state.hasHand, state.point, cursorMode === 'hand' ? [] : cursorRects());
        const tip = rayAnchor && shown ? state.hands?.[0]?.[8] : null;
        cursor.ray?.(tip ? mapPoint(tip, zoneRef, frame.mirrored) : null, tip ? state.point : null);
        cursor.progress?.(state.pressed ? 0 : state.holdProgress || 0); cursor.showCursor?.(shown); if (!!state.hasHand !== handSeen) emit('hand', handSeen = !!state.hasHand);
        cursor.draw({ ...frame, hands: (frame.hands ?? []).map(h => h.map(p => place(p, frame.mirrored))) }, pageSceneId === 'none' ? undefined : { ...frame, hands: (frame.hands ?? []).map(h => h.map(p => ({ ...p, ...toBounds(mapPoint(p, zone, frame.mirrored)) }))) });
        // Hosts get cursor data only (PRIV-3, RT-GHERKIN-1 #9): no landmarks, pinch states or hand size.
        state.point = toBounds(state.point); emit('frame', { t: state.t, x: state.point.x, y: state.point.y, hasHand: !!state.hasHand, pressed: !!state.pressed, armed: !!state.armed });
      };
      source = replayUrl ? createReplaySource({ url: replayUrl, onFrame }) : createMediaPipeSource({ video, onFrame,
        assetsBase: base.href, loadVision: () => import(new URL('tasks-vision/vision_bundle.mjs', base).href),
        numHands: config.tracker?.hands, pose: config.tracker?.pose, delegate: delegate ?? defaultDelegate(), ...(frameCanvas ? { frameCanvas } : {}) });
      selected = id;
    };
    configure(selected);
    return {
      // A second start() while the first is still opening the camera gets the first one's result (RT-ANATOMY-APP-1 #4),
      // never a success of its own.
      // A stop() or setPreset() while a start is still pending ends that start (its source stops any late camera grant);
      // its result is then returned to its own caller only, so it never marks a newer start as failed.
      start() {
        if (starting) return starting;
        if (running) return Promise.resolve({ ok: true, already: true });
        running = true;
        const g = ++startGen;
        const settle = result => { if (g === startGen) { if (!result?.ok) running = false; emit('start', result); } return result; };
        const p = source.start().then(settle, e => settle({ ok: false, message: e?.message || String(e) })).finally(() => { if (starting === p) starting = null; });
        return (starting = p);
      },
      stop() { startGen++; starting = null; if (running) { running = false; guard.stop(); source.stop(); output.release(); cursor.showCursor?.(false); cursor.ray?.(null, null); emit('stop'); } },
      setPreset(id) { const wasRunning = running; this.stop(); configure(id); emit('preset', id); if (wasRunning) return this.start(); },
      // Looks (0.2.0): what is drawn and how much camera picture shows. Pointer events never change with the look.
      async setLook(id) {
        if (!looks?.[id]) throw new Error(`look ${id} is not one of the looks`);
        lookId = id; paintLook(looks[id]); await cursor.setScene(looks[id].scene, sceneOptions(looks[id])); emit('look', id);
      },
      get look() { return lookId; },
      // Puts the cursor above anything the host added since create() (app buttons, dock, credit).
      raiseCursor() { cursor.raise?.(); },
      get preset() { return selected; },
      on(event, fn) { if (typeof fn !== 'function') throw new TypeError('listener must be a function'); const set = listeners.get(event) ?? new Set(); set.add(fn); listeners.set(event, set); return () => set.delete(fn); },
      destroy() { this.stop(); listeners.clear(); cursor.remove(); video.remove(); frameCanvas?.remove(); },
    };
  },

  // app@1 (0.2.0): a whole app from one JSON config (web/app.js): input preset, view, looks, 2 or 4 big buttons that
  // switch looks or presets (pressed by the cursor's own click, dwell or pinch), a Start button that retries, a credit.
  app(config, { container = document.body, presets = PRESETS, assetsBase, replayUrl, delegate, autostart = false } = {}) {
    const check = validateApp(config, { presets, scenes: SCENES, views: VIEWS });
    if (!check.ok) throw new Error(`app config: ${check.errors.join('; ')}`);
    // RT-ANATOMY-APP-1 #1: assets hold code (three.js, the hand model). A config cannot name them (web/app.js); the
    // default is this bundle's own vendor folder, and only host code (the assetsBase option) may point elsewhere on the site.
    const assets = new URL(assetsBase ?? (embedScript?.src ? 'vendor/' : '../bridge/vendor/'), embedScript?.src || document.baseURI);
    if (assets.origin !== location.origin) throw new Error('app config: assets must be on this site');
    let bar = null;
    // The buttons' rectangles in screen fractions, read each frame (they move with the window and the safe area).
    const cursorRects = () => bar ? [...bar.el.querySelectorAll('[data-posepointer-button]')].map(b => { const r = b.getBoundingClientRect(); return { x0: r.left / innerWidth, y0: r.top / innerHeight, x1: r.right / innerWidth, y1: r.bottom / innerHeight }; }) : [];
    const pp = PosePointer.create({ preset: config.input, presets, container, view: config.view, looks: config.looks, look: config.look,
      assetsBase: assets.href, replayUrl, delegate, cursor: config.cursor ?? 'hand', cursorRects });
    const items = buttonItems(config);
    bar = createPresetBar({ container, place: config.buttons.place, items, active: config.look,
      onPick: item => item.look !== undefined ? pp.setLook(item.look) : pp.setPreset(item.preset) });
    pp.on('look', id => bar.setActive(id));
    pp.on('preset', id => { if (items.some(i => i.preset === id)) bar.setActive(id); });
    const credit = config.credit ? document.createElement('footer') : null;
    if (credit) { credit.textContent = config.credit; credit.style.cssText = 'position:fixed;left:8px;bottom:max(6px,env(safe-area-inset-bottom));z-index:2147483647;max-width:min(560px,calc(100vw - 16px));box-sizing:border-box;padding:3px 8px;border-radius:6px;background:#000c;font:12px/1.3 system-ui,sans-serif;color:#fff;pointer-events:none'; container.append(credit); }
    // With the buttons on top, the credit sits just under them: the arm enters from the bottom of a mirror, so a credit
    // there lies over the forearm (RT-ANATOMY-APP-1 vision, rounds 1 and 3). Elsewhere it stays in the bottom-left corner.
    const placeCredit = () => { if (credit && config.buttons.place === 'top') { credit.style.bottom = 'auto'; credit.style.top = `${Math.round(bar.el.getBoundingClientRect().bottom)}px`; } };
    placeCredit(); addEventListener('resize', placeCredit);
    if (config.title) document.title = config.title;
    // The hint (how to press) and Start sit together in one dock, so they never overlap the credit or each other
    // (RT-ANATOMY-APP-1 round 2 vision #1, #2). Before a start the dock is in the middle of the screen, where nothing
    // else is drawn yet; once the camera runs it moves to the bottom, above the credit, and only the hint is left in it.
    // The hint shows whenever no hand is in view.
    const dock = document.createElement('div');
    const dockAt = middle => { dock.style.cssText = `position:fixed;left:0;right:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;gap:14px;padding:0 16px;box-sizing:border-box;pointer-events:none;${middle ? 'top:50%;transform:translateY(-50%)' : 'bottom:calc(max(6px,env(safe-area-inset-bottom)) + 48px)'}`; };
    const hint = config.hint ? document.createElement('p') : null;
    if (hint) { hint.textContent = config.hint; hint.setAttribute('role', 'status'); hint.style.cssText = 'max-width:min(100%,640px);margin:0;padding:8px 14px;border-radius:10px;background:#000b;color:#fff;font:600 17px/1.35 system-ui,sans-serif;text-align:center'; dock.append(hint); pp.on('hand', on => { hint.hidden = on; }); }
    const start = config.start === false || autostart ? null : createStartButton({ container: dock, inline: true, label: config.start?.label, start: () => pp.start() });
    dockAt(!!start);
    // The dock follows the instance, not the button's own press, so a start that setPreset() restarted also clears it.
    if (start) pp.on('start', result => { if (result?.ok) { start.remove(); dockAt(false); } });
    container.append(dock); pp.raiseCursor();
    if (autostart) queueMicrotask(() => pp.start());
    const destroy = pp.destroy;
    return Object.assign(pp, { app: config.app, buttons: bar, startButton: start,
      destroy() { destroy.call(pp); removeEventListener('resize', placeCredit); bar.remove(); dock.remove(); credit?.remove(); } });
  },
});

// Phone default (Tao 2026-10-29 19:50Z, Galaxy S25 Ultra): the GPU delegate ran but never found a hand, so phones and
// tablets use CPU, like the mirror. Desktops keep GPU (laptop camera-to-input p50 37-59 ms GPU vs 54-95 ms CPU).
function defaultDelegate(nav = globalThis.navigator) {
  const mobile = nav?.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(nav?.userAgent || '');
  return mobile ? 'CPU' : 'GPU';
}

const script = embedScript;
const scriptDelegate = () => ['CPU', 'GPU'].includes((script.dataset.delegate || '').toUpperCase()) ? script.dataset.delegate.toUpperCase() : undefined;
if (script?.dataset.config) {
  // data-config="app.json" (0.2.0): the page is only this tag; the JSON beside the page is the whole app.
  // Same origin only: an app config never comes from another site.
  const configUrl = new URL(script.dataset.config, document.baseURI);
  // mode same-origin also refuses a redirect to another site (RT-ANATOMY-APP-1 #1), and the final URL is checked again.
  window.PosePointerApp = (configUrl.origin === location.origin ? fetch(configUrl, { cache: 'no-store', mode: 'same-origin', credentials: 'same-origin' }) : Promise.reject(new Error('app config must be on this site')))
    .then(r => { if (r.url && new URL(r.url).origin !== location.origin) throw new Error('app config must be on this site'); if (!r.ok) throw new Error(`app config ${script.dataset.config} did not load (${r.status})`);
      // RT-ANATOMY-APP-1 round 2 #2: only a response served as JSON is read as a config.
      if (!/^application\/(?:[\w.-]+\+)?json\s*(?:;|$)/i.test(r.headers.get('content-type') || '')) throw new Error(`app config ${script.dataset.config} is not served as JSON`);
      return r.json(); })
    .then(config => (window.posePointer = PosePointer.app(config, {
      replayUrl: script.dataset.replay, delegate: scriptDelegate(), autostart: script.dataset.autostart !== undefined })));
  window.PosePointerApp.catch(e => { const p = document.createElement('p'); p.setAttribute('role', 'alert'); p.textContent = e.message; p.style.cssText = 'position:fixed;inset:40% 16px auto;color:#fff;background:#000c;padding:12px;border-radius:8px;font:16px system-ui;z-index:2147483647'; document.body.append(p); });
} else if (script?.dataset.autostart !== undefined) {
  const instance = PosePointer.create({ preset: script.dataset.preset || 'default', assetsBase: script.dataset.assets || '../bridge/vendor/',
    view: script.dataset.view || undefined, scene: script.dataset.scene || undefined, pageScene: script.dataset.pageScene || undefined, inputMode: ['mouse', 'touch'].includes(script.dataset.inputMode) ? script.dataset.inputMode : undefined, bounds: script.dataset.bounds || undefined, postMessage: script.dataset.postMessage !== undefined, replayUrl: script.dataset.replay,
    delegate: scriptDelegate() });
  window.posePointer = instance;
  queueMicrotask(() => instance.start());
}

module.exports.default=PosePointer;

exports.defaultDelegate=defaultDelegate;
exports.VIEWS=VIEWS;
exports.SCENES=SCENES;
exports.presentationOf=presentationOf;
exports.pipWidth=pipWidth;
exports.PosePointer=PosePointer;
},
1:(module,exports,require)=>{
// app@1: a whole PosePointer app as one JSON file (Tao 2026-10-31 23:59Z: "this is just 1 simple configuration of
// posepointer. And we can have alot of apps. I dont want a custom coded mess"). An app picks an input preset (how the
// cursor moves and clicks), a view, named looks (what is drawn), and 2 or 4 big buttons that switch looks or presets.
// validateApp is pure, so node tests and the page share it; anything it does not know is refused, not ignored.const { PLACES, BUTTON_COUNTS } = require(2);

const APP_KEYS = Object.freeze(['about', 'app', 'title', 'input', 'view', 'look', 'looks', 'buttons', 'start', 'credit', 'hint', 'cursor']);
// Where the cursor shows (0.2.2, Tao 2026-11-16 00:03Z: "no cursor when hand not in zone, so only when fingertip is in
// the dwell zones does a cursor show"): hand = whenever a hand is tracked (the default, as before); buttons = only while
// the cursor point is on one of the app's buttons. Pointer events and dwell are the same either way: this is the look only.
const CURSOR_MODES = Object.freeze(['hand', 'buttons']);
const LOOK_KEYS = Object.freeze(['label', 'scene', 'videoOpacity', 'layers', 'muscleOpacity', 'handEnd']);
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function validateApp(config, { presets, scenes, views }) {
  const errors = [], err = m => errors.push(m);
  if (!isObj(config)) return { ok: false, errors: ['the app config must be a JSON object'] };
  for (const k of Object.keys(config)) if (!APP_KEYS.includes(k) && k !== 'assets') err(`unknown key "${k}"`);
  if (!ID.test(config.app ?? '')) err('app must be a lowercase id like "anatomy-mirror"');
  if (config.title !== undefined && !text(config.title, 80)) err('title must be text up to 80 characters');
  if (!Object.hasOwn(presets.presets ?? presets, config.input ?? '')) err(`input "${config.input}" is not a PosePointer preset`);
  if (!views.includes(config.view)) err(`view must be one of ${views.join(', ')}`);
  // Assets hold code (three.js, the hand model), so a config never picks them: an app always loads its PosePointer
  // version's own vendor folder, next to the bundle (/pp/vendor/). Round 1 refused other sites, round 2 "..", and the
  // round 3 overnight patches proposed an allowlist; having no setting at all leaves nothing to allowlist.
  if (Object.hasOwn(config, 'assets')) err('assets is not an app setting: an app always uses its PosePointer version\'s own vendor folder');
  if (config.credit !== undefined && !text(config.credit, 300)) err('credit must be text up to 300 characters');
  if (config.cursor !== undefined && !CURSOR_MODES.includes(config.cursor)) err(`cursor must be one of ${CURSOR_MODES.join(', ')}`);
  if (config.hint !== undefined && !text(config.hint, 120)) err('hint must be text up to 120 characters');
  if (config.start !== undefined && config.start !== false && !(isObj(config.start) && Object.keys(config.start).every(k => k === 'label') && text(config.start.label, 40))) err('start must be false or { "label": text }');
  const looks = isObj(config.looks) ? config.looks : (err('looks must be an object of named looks'), {});
  for (const [id, look] of Object.entries(looks)) {
    if (!ID.test(id)) err(`look id "${id}" must be a lowercase id`);
    if (!isObj(look)) { err(`look "${id}" must be an object`); continue; }
    for (const k of Object.keys(look)) if (!LOOK_KEYS.includes(k)) err(`look "${id}": unknown key "${k}"`);
    if (!Object.hasOwn(scenes, look.scene ?? '')) err(`look "${id}": scene must be one of ${Object.keys(scenes).join(', ')}`);
    if (!(typeof look.videoOpacity === 'number' && look.videoOpacity >= 0 && look.videoOpacity <= 1)) err(`look "${id}": videoOpacity must be 0 to 1`);
    if (look.label !== undefined && !text(look.label, 40)) err(`look "${id}": label must be text up to 40 characters`);
    if (look.layers !== undefined && !(isObj(look.layers) && Object.values(look.layers).every(v => typeof v === 'boolean'))) err(`look "${id}": layers must map layer names to true or false`);
    if (look.muscleOpacity !== undefined && !(look.muscleOpacity >= 0 && look.muscleOpacity <= 1)) err(`look "${id}": muscleOpacity must be 0 to 1`);
  }
  if (!Object.hasOwn(looks, config.look ?? '')) err(`look "${config.look}" is not one of the looks`);
  const b = config.buttons;
  if (!isObj(b) || Object.keys(b).some(k => !['place', 'items'].includes(k))) err('buttons must be { "place", "items" }');
  else {
    if (!PLACES.includes(b.place)) err(`buttons.place must be one of ${PLACES.join(', ')}`);
    if (!Array.isArray(b.items) || !BUTTON_COUNTS.includes(b.items.length)) err('buttons.items must hold 2 or 4 buttons (menus are a toggle or a pick of 4)');
    const seen = new Set();
    for (const [i, item] of (Array.isArray(b.items) ? b.items : []).entries()) {
      if (!isObj(item) || Object.keys(item).some(k => !['label', 'look', 'preset', 'title'].includes(k))) { err(`button ${i + 1} may only have label, look or preset, and title`); continue; }
      // A phone fits about 10 characters across a quarter of a 390 px screen at 14 px bold, so 4 buttons take 12 at most.
      const most = b.items.length === 4 ? 12 : 24;
      if (!text(item.label, most)) err(`button ${i + 1}: label must be text up to ${most} characters (big buttons, short words)`);
      if ((item.look === undefined) === (item.preset === undefined)) err(`button ${i + 1}: needs exactly one of look or preset`);
      if (item.look !== undefined && !Object.hasOwn(looks, item.look)) err(`button ${i + 1}: look "${item.look}" is not one of the looks`);
      if (item.preset !== undefined && !Object.hasOwn(presets.presets ?? presets, item.preset)) err(`button ${i + 1}: preset "${item.preset}" is not a PosePointer preset`);
      const id = item.look ?? item.preset; if (seen.has(id)) err(`button ${i + 1}: "${id}" is on two buttons`); seen.add(id);
    }
  }
  return { ok: errors.length === 0, errors };
}

// The buttons as the bar takes them: each gets the id of what it switches.
const buttonItems = config => config.buttons.items.map(item => ({ ...item, id: item.look ?? item.preset }));

// Whether the cursor is drawn this frame. point is in screen fractions (0..1), rects are the buttons' screen rectangles
// in the same fractions ({ x0, y0, x1, y1 }). Pure, so node tests and the page share it.
// The index of the rect that holds point, or null (cursor: buttons uses it as the dwell place key).
function rectAt(point, rects = []) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const i = rects.findIndex(r => point.x >= r.x0 && point.x <= r.x1 && point.y >= r.y0 && point.y <= r.y1);
  return i < 0 ? null : i;
}
function cursorShown(mode, hasHand, point, rects = []) {
  if (!hasHand) return false;
  if ((mode ?? 'hand') === 'hand') return true;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  return rects.some(r => point.x >= r.x0 && point.x <= r.x1 && point.y >= r.y0 && point.y <= r.y1);
}

exports.validateApp=validateApp;
exports.rectAt=rectAt;
exports.cursorShown=cursorShown;
exports.APP_KEYS=APP_KEYS;
exports.CURSOR_MODES=CURSOR_MODES;
exports.LOOK_KEYS=LOOK_KEYS;
exports.buttonItems=buttonItems;
},
2:(module,exports,require)=>{
// Preset buttons (Tao 2026-10-31 23:59Z: "large 4 buttons ... if user places finger cursor dwell"). A reusable package
// part: any app lists its buttons in JSON and never writes button code. They are ordinary <button>s, so the PosePointer
// cursor presses them with whatever click the input preset uses (dwell or pinch), and mouse, touch and keyboard work too.
// Menus have 2 presets (a toggle) or 4 (pick one) (Tao 2026-10-31 16:18Z), so the bar takes 2 or 4 items.
const PLACES = Object.freeze(['top', 'bottom', 'left', 'right']);
const BUTTON_COUNTS = Object.freeze([2, 4]);

const BAR = {
  top: 'top:0;left:0;right:0;grid-auto-flow:column;grid-auto-columns:1fr;padding:max(12px,env(safe-area-inset-top)) 12px 12px',
  bottom: 'bottom:0;left:0;right:0;grid-auto-flow:column;grid-auto-columns:1fr;padding:12px 12px max(12px,env(safe-area-inset-bottom))',
  left: 'left:0;top:0;bottom:0;width:clamp(120px,22vw,240px);grid-auto-rows:1fr;padding:12px 12px 12px max(12px,env(safe-area-inset-left))',
  right: 'right:0;top:0;bottom:0;width:clamp(120px,22vw,240px);grid-auto-rows:1fr;padding:12px max(12px,env(safe-area-inset-right)) 12px 12px',
};
const BUTTON = 'min-width:0;margin:0;padding:4px;border-radius:16px;border:3px solid rgba(255,255,255,.75);' +
  'background:rgba(16,16,16,.72);color:#fff;font-weight:600;line-height:1.15;font-family:system-ui,sans-serif;cursor:pointer;touch-action:manipulation;' +
  'overflow:hidden;white-space:nowrap;text-shadow:0 1px 3px #000';
// Label size before fitting; fit() shrinks from here (and must reset to it, not to '' which means the 13 px default).
const SIZE = 'clamp(18px,2.4vw,26px)';
const ACTIVE = 'background:#ff9f2e;color:#111;border-color:#fff;text-shadow:none';

function createPresetBar({ container = document.body, doc = document, place = 'top', items, active = null, onPick }) {
  if (!PLACES.includes(place)) throw new Error(`buttons.place must be one of ${PLACES.join(', ')}`);
  if (!Array.isArray(items) || !BUTTON_COUNTS.includes(items.length)) throw new Error('buttons.items must hold 2 or 4 buttons');
  const bar = doc.createElement('nav');
  bar.dataset.posepointerButtons = place;
  bar.setAttribute('aria-label', 'Presets');
  bar.style.cssText = `position:fixed;z-index:2147483647;display:grid;gap:12px;box-sizing:border-box;pointer-events:none;${BAR[place]}`;
  const buttons = items.map(item => {
    const b = doc.createElement('button');
    b.type = 'button'; b.textContent = item.label; b.dataset.posepointerButton = item.id;
    if (item.title) b.title = item.title;
    b.addEventListener('click', () => onPick?.(item));
    bar.append(b);
    return b;
  });
  const paint = id => buttons.forEach((b, i) => { const on = items[i].id === id; b.setAttribute('aria-pressed', String(on)); b.style.cssText = `${BUTTON};pointer-events:auto;${on ? ACTIVE : ''}`; });
  // Narrow screens (under 600 px wide) take 4 top or bottom buttons as a 2 x 2 block, so each button is twice as wide and
  // the labels stay large (RT-ANATOMY-APP-1 vision #2: 13-14 px labels in a row of 4 on a phone). tools/app-buttons-geometry.mjs
  // mirrors this layout for the false-press scorer and the replay e2e.
  const layout = () => {
    const compact = (place === 'top' || place === 'bottom') && items.length === 4 && innerWidth < 600;
    bar.style.gridAutoFlow = compact ? 'row' : (place === 'top' || place === 'bottom' ? 'column' : 'row');
    bar.style.gridTemplateColumns = compact ? 'repeat(2,minmax(0,1fr))' : '';
    buttons.forEach(b => { b.style.minHeight = compact ? 'clamp(64px,9vh,100px)' : 'clamp(72px,14vh,140px)'; });
  };
  // Labels never truncate: each shrinks (to 14 px at least) until it fits its button.
  // All labels then take the smallest size, so the row reads as one set.
  const fit = () => {
    const sizes = buttons.map(b => { b.style.fontSize = SIZE; let px = parseFloat(getComputedStyle(b).fontSize) || 16; while (b.scrollWidth > b.clientWidth && px > 14) b.style.fontSize = `${--px}px`; return px; });
    const px = Math.min(...sizes); buttons.forEach(b => { b.style.fontSize = `${px}px`; });
  };
  const paintAndFit = id => { paint(id); layout(); fit(); };
  const relayout = () => { layout(); fit(); };
  container.append(bar);
  paintAndFit(active);
  addEventListener('resize', relayout);
  return { el: bar, buttons, setActive: paintAndFit, remove: () => { removeEventListener('resize', relayout); bar.remove(); } };
}

exports.createPresetBar=createPresetBar;
exports.PLACES=PLACES;
exports.BUTTON_COUNTS=BUTTON_COUNTS;
},
3:(module,exports,require)=>{
// The package-owned Start button (one-posepointer gate, proposed 2026-10-31: "the package should own start and retry").
// The camera prompt only comes after a press. A failed start (busy camera, no camera, denied permission) re-enables the
// button and shows the reason, so it can be tried again; Bounce Wall and the /pp/ demo each hand-wrote this before.
// inline: true leaves placement to the container (app() docks it with the hint); otherwise it is fixed at the bottom.
function createStartButton({ container = document.body, doc = document, label = 'Start hand control', inline = false, start }) {
  const wrap = doc.createElement('div');
  wrap.style.cssText = (inline ? 'pointer-events:auto;' : 'position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483647;') + 'display:grid;justify-items:center;gap:8px;max-width:calc(100vw - 32px)';
  const b = doc.createElement('button');
  b.type = 'button'; b.textContent = label; b.dataset.posepointerStart = '';
  b.style.cssText = 'min-height:64px;min-width:220px;padding:0 28px;border:0;border-radius:32px;background:#ff9f2e;color:#111;font:700 20px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 12px #0008';
  const why = doc.createElement('p');
  why.setAttribute('role', 'status'); why.hidden = true;
  why.style.cssText = 'margin:0;padding:6px 10px;border-radius:8px;background:#000c;color:#fff;font:14px/1.35 system-ui,sans-serif;text-align:center';
  wrap.append(b, why); container.append(wrap);
  b.addEventListener('click', async () => {
    b.disabled = true; why.hidden = true;
    let result;
    try { result = await start(); } catch (e) { result = { ok: false, message: e?.message || String(e) }; }
    if (result?.ok) { wrap.remove(); return; }
    b.textContent = 'Try again'; b.disabled = false;
    why.textContent = result?.message || 'The camera did not start.'; why.hidden = false;
  });
  return { el: wrap, button: b, remove: () => wrap.remove() };
}

exports.createStartButton=createStartButton;
},
4:(module,exports,require)=>{
const { create: createAnatomy, validHandEnd, LAYERS } = require(9);const { anatomySmoother } = require(5);

// The anatomy scene (BodyParts3D, CC BY 4.0) for the package, scene@1 like skeleton but loaded on first use:
// three.js and about 4.6 MB of meshes come from <assets>/three-0.170.0.module.min.js and <assets>/anatomy/, so pages that
// never pick it download nothing extra. Loads are cached per assets URL, so a look switch does not download again.
const THREE_FILE = 'three-0.170.0.module.min.js';
const ANATOMY_FILES = Object.freeze({ arm: 'upper-limb', body: 'body', vessels: 'vessels' });
const ATTRIBUTION = 'Anatomy: BodyParts3D, (c) DBCLS, CC BY 4.0';
const cache = new Map();

function anatomyOptions(look = {}) {
  const layers = { bones: true, muscles: true, arteries: false, veins: false, ...(look.layers || {}) };
  for (const k of Object.keys(layers)) if (!LAYERS.includes(k) || typeof layers[k] !== 'boolean') throw new Error(`anatomy layer ${k} must be one of ${LAYERS.join(', ')} and true or false`);
  const handEnd = look.handEnd ?? 'fade-4';
  if (!validHandEnd(handEnd)) throw new Error(`anatomy handEnd ${handEnd} is not known`);
  const muscleOpacity = look.muscleOpacity ?? 0.6;
  if (!(muscleOpacity >= 0 && muscleOpacity <= 1)) throw new Error('anatomy muscleOpacity must be 0 to 1');
  return { layers, handEnd, muscleOpacity };
}

function load(assetsBase, withVessels, fetchImpl, importImpl) {
  const key = `${assetsBase}|${withVessels}`;
  if (!cache.has(key)) {
    const get = (name, kind) => fetchImpl(new URL(`anatomy/${name}`, assetsBase).href).then(r => { if (!r.ok) throw new Error(`Missing anatomy asset: ${name}`); return r[kind](); });
    const pair = id => Promise.all([get(`${id}.json`, 'json'), get(`${id}.bin`, 'arrayBuffer')]).then(([doc, bin]) => ({ doc, bin }));
    const loading = Promise.all([importImpl(new URL(THREE_FILE, assetsBase).href), pair(ANATOMY_FILES.arm), pair(ANATOMY_FILES.body), withVessels ? pair(ANATOMY_FILES.vessels) : null])
      .then(([THREE, asset, body, vessels]) => ({ THREE, asset, body, vessels }));
    loading.catch(() => cache.delete(key)); // a failed load can be tried again
    cache.set(key, loading);
  }
  return cache.get(key);
}

module.exports.default={
  kind: 'scene', id: 'anatomy', port: 'scene@1', label: 'Anatomy: bones, muscles and vessels (BodyParts3D, CC BY 4.0)', lazy: true,
  // Same build: only the layers change, so the scene is kept and its layers switched.
  restyle(scene, before, after) {
    const a = anatomyOptions(before?.look), b = anatomyOptions(after?.look), vessels = o => o.layers.arteries || o.layers.veins;
    if (a.handEnd !== b.handEnd || a.muscleOpacity !== b.muscleOpacity || (vessels(b) && !vessels(a)) || before?.assetsBase !== after?.assetsBase) return false;
    scene.setLayers(b.layers); return true;
  },
  async create({ canvas, assetsBase, look, frameLocked = false, fetchImpl = (...a) => fetch(...a), importImpl = href => import(new URL(href).href) }) {
    const { layers, handEnd, muscleOpacity } = anatomyOptions(look);
    const { THREE, asset, body, vessels } = await load(assetsBase, layers.arteries || layers.veins, fetchImpl, importImpl);
    return createAnatomy({ THREE, canvas, asset, vessels, body, layers, muscleOpacity, handEnd, smoother: anatomySmoother({ leadMs: frameLocked ? 0 : 40 }) });
  },
};

exports.anatomyOptions=anatomyOptions;
exports.THREE_FILE=THREE_FILE;
exports.ANATOMY_FILES=ANATOMY_FILES;
exports.ATTRIBUTION=ATTRIBUTION;
},
5:(module,exports,require)=>{
const { createOneEuro } = require(8);const { create: createDesp } = require(6);

// Landmark smoother for scenes such as anatomy (same constants as mirror.js): a One Euro filter per axis, then a DESP lead.
// leadMs is 0 under frame lock (the picture on screen is the frame the landmarks came from, so no lead is needed).
function anatomySmoother({ leadMs = 40 } = {}) {
  return n => {
    const make = () => Array.from({ length: n }, () => ({ x: createOneEuro({ minCutoff: 1, beta: 10 }), y: createOneEuro({ minCutoff: 1, beta: 10 }),
      z: createOneEuro({ minCutoff: 1, beta: 10 }), lead: createDesp({ alpha: 0.5, predict_ms: leadMs, max_lead: 0.08, brake: true }) }));
    let filters = make();
    return {
      update(points, t) { return points.map((p, i) => { const f = filters[i], x = f.x.filter(p.x, t), y = f.y.filter(p.y, t), z = f.z.filter(p.z || 0, t), q = f.lead.update({ t, point: { x, y } }); return { ...p, x: q.x, y: q.y, z }; }); },
      reset() { filters = make(); },
    };
  };
}

exports.anatomySmoother=anatomySmoother;
},
6:(module,exports,require)=>{
// Ported from missions/omega/factory/core/filters/desp.js lines 30-188.const { signal } = require(7);
function create({ alpha=.5, predict_ms=0, brake=true, max_lead=.08 }={}) { let s1=null,s2=null,last=null,lag1=0,lag2=0,short={x:0,y:0};
  return { update(frame){if(!frame.point)return signal(frame);const p=frame.point;if(!last){s1={...p};s2={...p};last={...p,t:frame.t};return signal(frame);}
    const dt=Math.max(frame.t-last.t,1),keep=Math.pow(1-alpha,dt/(1000/60)),a=1-keep,ba=1-Math.pow(.3,dt/(1000/60));short={x:short.x+ba*((p.x-last.x)/(dt/1000)-short.x),y:short.y+ba*((p.y-last.y)/(dt/1000)-short.y)};s1={x:a*p.x+keep*s1.x,y:a*p.y+keep*s1.y};s2={x:a*s1.x+keep*s2.x,y:a*s1.y+keep*s2.y};
    lag1=keep*(dt/1000+lag1);lag2=a*lag1+keep*(dt/1000+lag2);const span=lag2-lag1,v=span>1e-9?{x:(s1.x-s2.x)/span,y:(s1.y-s2.y)/span}:{x:0,y:0},pos={x:s1.x+v.x*lag1,y:s1.y+v.y*lag1};let pv={...v};if(brake){const speed=Math.hypot(v.x,v.y),along=speed>1e-9?(short.x*v.x+short.y*v.y)/speed:0,k=along<=0?0:Math.min(1,along/speed);pv={x:v.x*k,y:v.y*k};}let lead={x:pv.x*predict_ms/1000,y:pv.y*predict_ms/1000},n=Math.hypot(lead.x,lead.y);if(n>max_lead)lead={x:lead.x*max_lead/n,y:lead.y*max_lead/n};const out={x:pos.x+lead.x,y:pos.y+lead.y};last={...p,t:frame.t};return signal(frame,out,'valid',v);
  },reset(){s1=s2=last=null;lag1=lag2=0;short={x:0,y:0};} };
}

exports.create=create;
},
7:(module,exports,require)=>{
const stages = new Map();

function register(id, create) {
  if (!id || typeof create !== 'function') throw new TypeError('signal stage requires an id and create function');
  if (stages.has(id)) throw new Error(`signal stage already registered: ${id}`);
  stages.set(id, create);
  return create;
}

function get(id) { return stages.get(id); }
function list() { return [...stages.keys()]; }

function signal(frame, point = frame.point, state = point ? 'valid' : 'lost', velocity = { x: 0, y: 0 }) {
  return { t: frame.t, x: point?.x ?? 0, y: point?.y ?? 0, vx: velocity.x, vy: velocity.y, state };
}

exports.register=register;
exports.get=get;
exports.list=list;
exports.signal=signal;
},
8:(module,exports,require)=>{
// UTC: 2026-10-27T21:13:06Z UTC. Copied unchanged below from factory/core/filters/one-euro.js.
// One Euro filter (Casiez, Roussel, Vogel, CHI 2012): adaptive low-pass that
// smooths hard when the signal is slow and loosens up when it moves fast.
//
// Adapted from TTaoGaming/Tectangle September2025/Tectangle/src/LandmarkSmoothManager.js
// (inlined OneEuroFilter class: alpha formula, warm start on first sample, raw-value
// derivative, 1/60 s fallback for a non-positive dt). Here it is a pure factory:
// no manager, no event bus, no Date.now(); the caller supplies the timestamp.
//
// Units: tMs in milliseconds; `value` in whatever unit the caller uses. For
// normalized screen coordinates the speed is in units/s, so a useful `beta` is
// large (order 1..50), not the 0.007 typical of pixel-space tuning.

const FALLBACK_DT_S = 1 / 60;

function alphaFor(cutoffHz, dtS) {
  const tau = 1 / (2 * Math.PI * Math.max(cutoffHz, 1e-6));
  return 1 / (1 + tau / dtS);
}

function createOneEuro({ minCutoff = 1.0, beta = 0.0, dCutoff = 1.0 } = {}) {
  let x = null; // previous filtered value
  let dx = 0; // previous filtered derivative
  let prevRaw = null; // previous raw value (for the derivative)
  let tPrev = null; // previous timestamp (ms)
  let clockMs = 0; // internal clock used only when the caller passes no timestamp

  function filter(value, tMs) {
    const v = Number(value);
    if (!Number.isFinite(v)) return x === null ? v : x;
    let t;
    if (Number.isFinite(tMs)) {
      t = tMs;
    } else {
      clockMs = tPrev === null ? 0 : tPrev + FALLBACK_DT_S * 1000;
      t = clockMs;
    }
    if (tPrev === null) {
      x = v;
      dx = 0;
      prevRaw = v;
      tPrev = t;
      return v;
    }
    let dt = (t - tPrev) / 1000;
    if (!(dt > 0)) dt = FALLBACK_DT_S;
    const rawDx = (v - prevRaw) / dt;
    const aD = alphaFor(dCutoff, dt);
    const dxHat = aD * rawDx + (1 - aD) * dx;
    const cutoff = minCutoff + beta * Math.abs(dxHat);
    const a = alphaFor(cutoff, dt);
    const xHat = a * v + (1 - a) * x;
    x = xHat;
    dx = dxHat;
    prevRaw = v;
    tPrev = t;
    return xHat;
  }

  function reset() {
    x = null;
    dx = 0;
    prevRaw = null;
    tPrev = null;
    clockMs = 0;
  }

  return { filter, reset };
}

// Same filter on a { x, y } point (independent axes).
function createOneEuro2D(opts = {}) {
  const fx = createOneEuro(opts);
  const fy = createOneEuro(opts);
  return {
    filter(p, tMs) {
      return { x: fx.filter(p.x, tMs), y: fy.filter(p.y, tMs) };
    },
    reset() {
      fx.reset();
      fy.reset();
    },
  };
}

exports.createOneEuro=createOneEuro;
exports.createOneEuro2D=createOneEuro2D;
},
9:(module,exports,require)=>{
// Anatomy scene: three.js meshes for the bones and muscles of each tracked hand, arm and (with a pose) the body,
// drawn in screen pixels over the camera picture. A visual plug-in: it reads a LandmarkFrame and writes a canvas,
// nothing else. It never touches the cursor, the injected input or the page (gate row C9).
//
// Plug-in shape (proposed kind "scene" on port visualization@1; the build thread adds the kind to core):
//   create({ THREE, canvas, asset: { doc, bin }, body?: { doc, bin }, layers?, muscleOpacity?, smoother? }) -> { update(frame, size), render(), resize(w, h, dpr), info(), dispose() }
//   frame: LandmarkFrame { t, mirrored, hands: [21 x {x,y,z}], handedness: ['Right'|'Left'], pose?: [33 x {x,y,z,visibility}] }
//   size: { width, height } of the picture the landmarks are normalized to, in CSS pixels.const { buildRig, decodeAsset, solve, skinPart, toWorld, handSide, armFromPose, vertexNormals, palmSize, SEGMENT_INDEX } = require(11);const { decodeBody, mirrorBody, solveBody, poseHand, BODY_SEGMENTS } = require(10);

const LAYERS = ['bones', 'muscles', 'arteries', 'veins'];
// Smoothing belongs to the filter tile: by default the scene draws the landmarks it is given. A caller may inject
// smoother(n) -> { update(points, tMs) -> points, reset() } (the standalone pages pass src/smooth.js); a hand that
// jumps more than a palm, or any track that drops out for longer than GAP_MS, then starts its filters fresh.
const GAP_MS = 250;
// Hand only (Tao 2026-10-29 23:33Z and 2026-10-30 00:07Z): with no pose elbow the forearm has no landmark to follow, so
// the hand is cut where anatomy ends it, not by a plane: the carpals, metacarpals and phalanges, and only the intrinsic
// hand muscles (both ends inside the hand). Radius, ulna, humerus and every muscle that starts in the forearm or arm
// (the long flexors and extensors with their tendons) are left out whole.
const INTRINSIC = /interosse|lumbrical|flexor pollicis brevis|abductor pollicis brevis|adductor pollicis|opponens|abductor digiti minimi|flexor digiti minimi brevis|palmaris brevis/i;
const ARM_SEGS = new Set([SEGMENT_INDEX.forearm, SEGMENT_INDEX.upperarm]);
// The name rule is for muscles only: the anterior, common and recurrent interosseous arteries run the forearm.
const isVessel = p => p.system === 'arterial' || p.system === 'venous';
const intrinsic = p => !isVessel(p) && INTRINSIC.test(p.name);
const inHand = p => p.seg !== undefined ? !ARM_SEGS.has(p.seg) : intrinsic(p);
const HAND_ENDS = ['whole', 'fade-2', 'fade-4', 'fade-6', 'tendons'];
const validHandEnd = value => HAND_ENDS.includes(value);
const isExtrinsic = p => p.system !== 'skeletal' && !intrinsic(p);

// Signed centimetres from the retinaculum line. Positive is behind the wrist, towards the forearm.
// This small CPU twin of the shader is deliberately exported so the bound and its negative control can be tested
// without pretending that a headless machine has WebGL.
const wristAlpha = (variant, signedCm, cap = true) => {
  if (variant === 'tendons') return signedCm >= 0 ? 0 : cap ? Math.min(1, -signedCm / 0.5) : 1;
  const cm = Number(variant.slice(5));
  return Number.isFinite(cm) ? Math.max(0, Math.min(1, 1 - signedCm / cm)) : 1;
};

function updatePoseLatch(state = {}, candidate, config = {}) {
  const good = !!candidate?.elbow;
  const next = { ...state, good: good ? (state.good || 0) + 1 : 0, bad: good ? 0 : (state.bad || 0) + 1 };
  if (!next.latched && next.good >= (config.acquireFrames ?? 2)) next.latched = true;
  if (next.latched && next.bad >= (config.releaseFrames ?? 3)) next.latched = false;
  if (good) next.arm = candidate;
  return next;
}

function wristMaterial(THREE, source, variant) {
  const material = source.clone();
  // Vessels are opaque, so alpha alone would leave them running up the forearm; blend and drop the faded-out fragments.
  material.transparent = true;
  const state = material.userData.wrist = { point: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0), pxPerCm: 1 };
  material.onBeforeCompile = shader => {
    shader.uniforms.wristPoint = { value: state.point };
    shader.uniforms.wristAxis = { value: state.axis };
    shader.uniforms.wristPxPerCm = { value: state.pxPerCm };
    shader.vertexShader = `varying vec3 vWristPosition;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWristPosition = transformed;');
    const alpha = variant === 'tendons'
      ? 'float wristAlpha = signedCm >= 0.0 ? 0.0 : smoothstep(0.0, 0.5, -signedCm);'
      : `float wristAlpha = clamp(1.0 - signedCm / ${Number(variant.slice(5)).toFixed(1)}, 0.0, 1.0);`;
    shader.fragmentShader = `varying vec3 vWristPosition;\nuniform vec3 wristPoint;\nuniform vec3 wristAxis;\nuniform float wristPxPerCm;\n${shader.fragmentShader}`
      .replace('#include <dithering_fragment>', `float signedCm = dot(vWristPosition - wristPoint, wristAxis) / wristPxPerCm;\n${alpha}\ngl_FragColor.a *= wristAlpha;\nif (gl_FragColor.a < 0.01) discard;\n#include <dithering_fragment>`);
  };
  material.customProgramCacheKey = () => `anatomy-wrist-${variant}`;
  return material;
}

function create({ THREE, canvas, asset, vessels = null, body: bodyAsset = null, layers = { bones: true, muscles: true, arteries: false, veins: false }, muscleOpacity = 0.62,
  smoother = null, handEnd = 'whole', poseAnchor = {} }) {
  if (!validHandEnd(handEnd)) throw Error(`Unknown handEnd: ${handEnd}`);
  const makeSmoother = n => smoother ? smoother(n) : { update: points => points, reset() {} };
  const parts = [...decodeAsset(asset.doc, asset.bin), ...(vessels ? decodeAsset(vessels.doc, vessels.bin) : [])];
  const rigs = { right: buildRig(parts, 'right'), left: buildRig(parts, 'left') };
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -1e5, 1e5);
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x3a2a2a, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-0.4, 0.7, 1); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd8ff, 0.7); fill.position.set(0.6, -0.3, 0.8); scene.add(fill);
  const mats = {
    bone: new THREE.MeshStandardMaterial({ color: 0xf1e3c6, roughness: 0.5, metalness: 0.0 }),
    muscle: new THREE.MeshStandardMaterial({ color: 0xc8463c, roughness: 0.42, metalness: 0.0, transparent: true,
      opacity: muscleOpacity, depthWrite: false, side: THREE.DoubleSide }),
    artery: new THREE.MeshStandardMaterial({ color: 0xd92525, roughness: 0.36 }),
    vein: new THREE.MeshStandardMaterial({ color: 0x2469c7, roughness: 0.36 }),
  };

  function makeGroup(rigParts) {
    const group = new THREE.Group();
    const meshes = rigParts.map(p => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.positions.length), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(p.positions.length), 3));
      g.setIndex(new THREE.BufferAttribute(p.indices, 1));
      const bone = p.system === 'skeletal';
      const extrinsic = isExtrinsic(p);
      const baseMaterial = bone ? mats.bone : p.system === 'arterial' ? mats.artery : p.system === 'venous' ? mats.vein : mats.muscle;
      const material = !bone && extrinsic && handEnd !== 'whole' ? wristMaterial(THREE, baseMaterial, handEnd) : baseMaterial;
      const m = new THREE.Mesh(g, material);
      m.renderOrder = bone ? 0 : 1; m.frustumCulled = false; m.userData.part = p;
      group.add(m);
      return m;
    });
    scene.add(group);
    return { group, meshes };
  }
  const drawPart = (mesh, solvedMats) => {
    const pos = mesh.geometry.attributes.position, nrm = mesh.geometry.attributes.normal;
    skinPart(mesh.userData.part, solvedMats, pos.array, nrm.array);
    pos.needsUpdate = true; nrm.needsUpdate = true;
    return mesh.userData.part.positions.length / 3;
  };
  const layerOn = p => p.system === 'skeletal' ? layers.bones : p.system === 'arterial' ? layers.arteries : p.system === 'venous' ? layers.veins : layers.muscles;

  // Draws one arm (hand, forearm, upper arm) from 21 hand joints plus whatever of the arm the pose gives.
  function drawArm(slot, hand, pose, W, H) {
    const rig = rigs[slot.side];
    const candidate = armFromPose(pose, hand, rig.rest, palmSize(hand) / palmSize(rig.rest), W, H, poseAnchor);
    slot.poseLatch = updatePoseLatch(slot.poseLatch, candidate, poseAnchor);
    const arm = slot.poseLatch.latched ? slot.poseLatch.arm : {};
    const solved = solve(rig.rest, { hand, ...arm });
    if (!solved) { slot.group.visible = false; return { vertices: 0, forearm: false }; } // NaN or collapsed landmarks
    let vertices = 0;
    const wx = hand[0][0], wy = hand[0][1], wz = hand[0][2] || 0;
    const ax = wx - hand[9][0], ay = wy - hand[9][1], az = wz - (hand[9][2] || 0);
    const axisLength = Math.hypot(ax, ay, az) || 1;
    for (const mesh of slot.meshes) {
      const p = mesh.userData.part;
      const upper = p.seg === undefined ? p.upperShare > 0.3 : p.name.toLowerCase().includes('humerus');
      const handOnly = inHand(p) || (handEnd !== 'whole' && isExtrinsic(p));
      mesh.visible = layerOn(p) && (!upper || solved.has.upperarm) && (solved.has.forearm || handOnly);
      const wrist = mesh.material.userData.wrist;
      if (wrist) {
        wrist.point.set(wx, wy, wz); wrist.axis.set(ax / axisLength, ay / axisLength, az / axisLength);
        // Wrist to middle MCP is approximately 8 cm in the source anatomy; scaling it keeps the fade physical.
        wrist.pxPerCm = axisLength / 8;
      }
      if (mesh.visible) vertices += drawPart(mesh, solved.mats);
    }
    slot.group.visible = true;
    return { vertices, forearm: solved.has.forearm };
  }

  // Hand slots (one per tracked hand) and pose-arm slots (an arm whose hand is not tracked), built lazily per side.
  const handSlots = [], armSlots = {};
  const slotFor = (store, key, side) => {
    if (store[key] && store[key].side !== side) { scene.remove(store[key].group); store[key] = null; }
    return store[key] ??= { side, ...makeGroup(rigs[side].parts), smoother: makeSmoother(21), smooth: null, t: null };
  };

  // Body: decoded once, mirrored copy built when a mirrored frame first arrives.
  let body = null;
  const bodyFor = mirrored => {
    if (!bodyAsset) return null;
    body ??= {};
    const key = mirrored ? 'mirrored' : 'plain';
    if (!body[key]) {
      body.base ??= decodeBody(bodyAsset.doc, bodyAsset.bin);
      const src = mirrored ? mirrorBody(body.base) : body.base;
      const prepared = src.parts.map(p => {
        // Weight share per segment: a part is drawn when at least 85% of it rides segments the pose actually shows.
        const share = new Float64Array(BODY_SEGMENTS.length);
        if (p.seg !== undefined) share[p.seg] = 1;
        else { for (let i = 0; i < p.bind.s.length; i++) share[p.bind.s[i]] += p.bind.w[i]; share.forEach((v, i) => { share[i] = v * 2 / p.bind.s.length; }); }
        return { ...p, normals: vertexNormals(p.positions, p.indices), share };
      });
      body[key] = { rest: src.rest, ...makeGroup(prepared) };
    }
    for (const k of ['plain', 'mirrored']) if (body[k]) body[k].group.visible = false;
    return body[key];
  };
  const poseSmoother = makeSmoother(33);
  let poseT = null;

  let lastInfo = { hands: 0, arms: 0, body: false, vertices: 0 };
  function update(frame, size) {
    const W = size.width, H = size.height;
    camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = -H; camera.updateProjectionMatrix();
    const hands = Array.isArray(frame?.hands) ? frame.hands.slice(0, 2) : [];
    let vertices = 0, arms = 0;

    // Pose: through the smoother (if any), reset when the pose drops out.
    const rawPose = Array.isArray(frame?.pose) && frame.pose.length >= 33 ? frame.pose : null;
    if (!rawPose || !(frame.t - poseT <= GAP_MS)) poseSmoother.reset();
    const pose = rawPose ? poseSmoother.update(rawPose, frame.t) : null;
    poseT = rawPose ? frame.t : null;

    // Tracked hands.
    const trackedHands = [];
    for (let i = 0; i < 2; i++) {
      const h = hands[i];
      const valid = h && h.length === 21 && h.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
      if (!valid) { if (handSlots[i]) { handSlots[i].group.visible = false; handSlots[i].smooth = null; } continue; }
      const slot = slotFor(handSlots, i, handSide(frame.handedness?.[i] ?? 'Right', frame.mirrored));
      const raw = h.map(p => toWorld(p, W, H));
      const jump = slot.smooth && Math.hypot(raw[0][0] - slot.smooth[0][0], raw[0][1] - slot.smooth[0][1]) > palmPx(raw);
      if (!slot.smooth || jump || !(frame.t - slot.t <= GAP_MS)) slot.smoother.reset();
      slot.smooth = slot.smoother.update(h, frame.t).map(p => toWorld(p, W, H));
      slot.t = frame.t;
      const r = drawArm(slot, slot.smooth, pose, W, H);
      vertices += r.vertices; if (r.forearm) arms++;
      trackedHands.push(slot.smooth);
    }

    // Body, and arms whose hands are not tracked.
    let bodyOn = false;
    const B = pose && bodyAsset ? bodyFor(!!frame.mirrored) : null;
    const solvedBody = B ? solveBody(B.rest, pose, W, H) : null;
    if (B && solvedBody) {
      bodyOn = true;
      for (const mesh of B.meshes) {
        const p = mesh.userData.part;
        let seenShare = 0;
        p.share.forEach((v, i) => { if (solvedBody.has[BODY_SEGMENTS[i].id] !== false) seenShare += v; });
        mesh.visible = layerOn(p) && seenShare >= 0.85;
        if (mesh.visible) vertices += drawPart(mesh, solvedBody.mats);
      }
      B.group.visible = true;
    }
    for (const side of ['l', 'r']) {
      const slotSide = handSide(side === 'r' ? 'Right' : 'Left', frame.mirrored);
      const wristIdx = side === 'l' ? 15 : 16;
      const covered = pose && trackedHands.some(h => Math.hypot(h[0][0] - pose[wristIdx].x * W, h[0][1] + pose[wristIdx].y * H) < palmPx(h) * 2);
      const hand = solvedBody && !covered ? poseHand(pose, side, rigs[slotSide].rest, solvedBody.scale, W, H) : null;
      if (!hand) { if (armSlots[side]) armSlots[side].group.visible = false; continue; }
      const r = drawArm(slotFor(armSlots, side, slotSide), hand, pose, W, H);
      vertices += r.vertices; if (r.forearm) arms++;
    }
    lastInfo = { hands: hands.length, arms, body: bodyOn, vertices };
    return lastInfo;
  }

  function resize(width, height, dpr = 1) { renderer.setPixelRatio(dpr); renderer.setSize(width, height, false); }
  return {
    update, resize,
    render: () => renderer.render(scene, camera),
    info: () => lastInfo,
    setLayers: next => Object.assign(layers, next),
    dispose: () => {
      scene.traverse(o => o.isMesh && o.geometry.dispose());
      scene.traverse(o => o.isMesh && o.material !== mats.bone && o.material !== mats.muscle && o.material.dispose());
      Object.values(mats).forEach(m => m.dispose()); renderer.dispose();
    },
  };
}

const palmPx = J => Math.hypot(J[0][0] - J[9][0], J[0][1] - J[9][1]) * 1.5;

// The plug-in record, for the registry once it has a "scene" kind (see the PR).
module.exports.default={ kind: 'scene', id: 'anatomy', port: 'scene@1', label: 'Anatomy: bones, muscles and vessels (BodyParts3D, CC BY 4.0)', create };

exports.updatePoseLatch=updatePoseLatch;
exports.create=create;
exports.LAYERS=LAYERS;
exports.inHand=inHand;
exports.HAND_ENDS=HAND_ENDS;
exports.validHandEnd=validHandEnd;
exports.isExtrinsic=isExtrinsic;
exports.wristAlpha=wristAlpha;
},
10:(module,exports,require)=>{
// Body rig: trunk, head and legs from BodyParts3D (assets/body.bin, tools/build-body.py) on MediaPipe Pose's 33
// landmarks. The arms are drawn by the upper-limb rig (rig.js); when no hand is tracked, poseHand() builds the 21 hand
// joints from the pose's wrist, index and pinky points so the arm still shows.
// Same conventions as rig.js: world = screen pixels, y up, z toward the viewer; pure math, no three.js.const { palmSize } = require(11);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const lenXY = a => Math.hypot(a[0], a[1]);
const norm = a => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0]; };
const mid = (a, b) => mul(add(a, b), 0.5);

// MediaPipe Pose indices (the person's own left and right).
const POSE = { nose: 0, ear_l: 7, ear_r: 8, shoulder_l: 11, shoulder_r: 12, wrist_l: 15, wrist_r: 16, pinky_l: 17, pinky_r: 18,
  index_l: 19, index_r: 20, hip_l: 23, hip_r: 24, knee_l: 25, knee_r: 26, ankle_l: 27, ankle_r: 28, heel_l: 29, heel_r: 30, toe_l: 31, toe_r: 32 };
// One rigid frame per segment: direction a -> b, roll from a reference axis, pinned at the anchor end.
const BODY_SEGMENTS = [
  { id: 'pelvis', a: 'hips', b: 'shoulders', anchor: 'a', ref: 'hipLat' },
  { id: 'chest', a: 'hips', b: 'shoulders', anchor: 'b', ref: 'shoulderLat' },
  // The head turns with the ear line only: its up axis is the ear line turned 90 degrees in the picture, so a tilted
  // shoulder line or noisy ear depth does not tip the skull.
  { id: 'head', a: 'shoulders', b: 'ears', anchor: 'b', ref: 'earLat', up: true },
  ...['l', 'r'].flatMap(s => [
    { id: `thigh_${s}`, a: `hip_${s}`, b: `knee_${s}`, anchor: 'a', ref: 'hipLat', limb: true },
    { id: `shin_${s}`, a: `knee_${s}`, b: `ankle_${s}`, anchor: 'a', ref: 'hipLat', limb: true },
    { id: `foot_${s}`, a: `ankle_${s}`, b: `toe_${s}`, anchor: 'a', ref: 'hipLat', limb: true },
  ]),
];
const LIMB_STRETCH = [0.75, 1.25];

/** body.json + body.bin -> parts (positions in metres) with their segment or per-vertex binding. */
function decodeBody(doc, buffer) {
  const bytes = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const order = doc.segments.map(id => BODY_SEGMENTS.findIndex(s => s.id === id));
  if (order.some(i => i < 0)) throw new Error('body asset: unknown segment');
  const parts = doc.parts.map(p => {
    const q = new Int16Array(bytes, p.positions, p.vertexCount * 3), positions = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) positions[i] = q[i] * doc.quant;
    const indices = p.index32 ? new Uint32Array(bytes, p.indices, p.indexCount) : new Uint16Array(bytes, p.indices, p.indexCount);
    const part = { id: p.id, name: p.name, system: p.system, positions, indices };
    if (p.seg !== undefined) part.seg = order[p.seg];
    else {
      const raw = new Uint8Array(bytes, p.bind, p.vertexCount * 3), s = new Uint8Array(p.vertexCount * 2), w = new Float32Array(p.vertexCount * 2);
      for (let i = 0; i < p.vertexCount; i++) {
        s[i * 2] = order[raw[i * 3]]; s[i * 2 + 1] = order[raw[i * 3 + 1]];
        w[i * 2] = raw[i * 3 + 2] / 255; w[i * 2 + 1] = 1 - w[i * 2];
      }
      part.bind = { s, w };
    }
    return part;
  });
  return { parts, rest: doc.rest };
}

/** Mirrors the body across x (for a mirrored camera picture): positions, winding, normals and rest joints. */
function mirrorBody({ parts, rest }) {
  const out = parts.map(p => {
    const positions = p.positions.slice(), indices = p.indices.slice();
    for (let i = 0; i < positions.length; i += 3) positions[i] = -positions[i];
    for (let i = 0; i < indices.length; i += 3) { const t = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = t; }
    return { ...p, positions, indices };
  });
  return { parts: out, rest: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, [-v[0], v[1], v[2]]])) };
}

// Joint set with the derived midpoints and lateral axes the segment table names.
function derive(J) {
  const out = { ...J, hips: mid(J.hip_l, J.hip_r), shoulders: mid(J.shoulder_l, J.shoulder_r), ears: mid(J.ear_l, J.ear_r) };
  out.hipLat = norm(sub(J.hip_l, J.hip_r)); out.shoulderLat = norm(sub(J.shoulder_l, J.shoulder_r));
  const ear = sub(J.ear_l, J.ear_r);
  out.earLat = norm([ear[0], ear[1], ear[2] * 0.4]); // pose ear depth is noisy: damp it
  out.headUp = norm([-out.earLat[1], out.earLat[0], 0]);
  if (out.headUp[1] < 0) out.headUp = mul(out.headUp, -1);
  return out;
}

function frame(d, r, fallback) {
  let e2 = sub(r, mul(d, dot(r, d)));
  if (len(e2) < 0.2) e2 = sub(fallback, mul(d, dot(fallback, d)));
  e2 = norm(e2);
  return [d, e2, cross(d, e2)];
}
function matrix(d0, r0, f0, d, r, f, s, k, anchor0, anchor) {
  const F0 = frame(d0, r0, f0), F = frame(d, r, f), M = new Float64Array(12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let v = 0;
    for (let m = 0; m < 3; m++) {
      const rot = F[0][i] * F0[0][m] + F[1][i] * F0[1][m] + F[2][i] * F0[2][m];
      v += rot * ((m === j ? 1 : 0) + (k - 1) * d0[m] * d0[j]);
    }
    M[i * 3 + j] = s * v;
  }
  for (let i = 0; i < 3; i++) M[9 + i] = anchor[i] - (M[i * 3] * anchor0[0] + M[i * 3 + 1] * anchor0[1] + M[i * 3 + 2] * anchor0[2]);
  return M;
}

const seen = (p, margin = 0.1) => p && (p.visibility ?? 1) > 0.5 && p.x > -margin && p.x < 1 + margin && p.y > -margin && p.y < 1 + margin;

/**
 * Pose landmarks -> body joints in world pixels and one matrix per body segment.
 * Returns null when the shoulders are not both in view. has[segment] says which segments were actually observed:
 * with the hips out of the picture the torso is assumed upright and the pelvis and legs are not drawn.
 */
function solveBody(rest, pose, W, H) {
  if (!Array.isArray(pose) || pose.length < 33 || !seen(pose[11], 0) || !seen(pose[12], 0)) return null;
  const P = k => { const p = pose[POSE[k]]; return [p.x * W, -p.y * H, -(p.z || 0) * W]; };
  const R = derive(rest);
  const live = {};
  for (const k of ['shoulder_l', 'shoulder_r', 'ear_l', 'ear_r']) live[k] = P(k);
  const hipsSeen = seen(pose[23], 0.05) && seen(pose[24], 0.05);
  const restTorso = len(sub(R.shoulders, R.hips)), restShoulderW = len(sub(rest.shoulder_l, rest.shoulder_r));
  const restHipW = len(sub(rest.hip_l, rest.hip_r));
  let s;
  if (hipsSeen) {
    live.hip_l = P('hip_l'); live.hip_r = P('hip_r');
    const sm = mid(live.shoulder_l, live.shoulder_r), hm = mid(live.hip_l, live.hip_r);
    const widths = (lenXY(sub(live.shoulder_l, live.shoulder_r)) / restShoulderW + lenXY(sub(live.hip_l, live.hip_r)) / restHipW) / 2;
    s = Math.max(widths, lenXY(sub(sm, hm)) / restTorso);
  } else {
    // Upright torso below the shoulders, scaled by shoulder width (desk distance: hips under the desk).
    s = lenXY(sub(live.shoulder_l, live.shoulder_r)) / restShoulderW;
    const drop = [0, -s * (rest.shoulder_l[1] - rest.hip_l[1]), 0];
    live.hip_l = add(add(live.shoulder_l, drop), mul(sub(live.shoulder_r, live.shoulder_l), (restShoulderW - restHipW) / 2 / restShoulderW));
    live.hip_r = add(add(live.shoulder_r, drop), mul(sub(live.shoulder_l, live.shoulder_r), (restShoulderW - restHipW) / 2 / restShoulderW));
  }
  // Legs: each end placed in depth from its foreshortening against the model's bone length.
  const has = { pelvis: hipsSeen, chest: true, head: seen(pose[7], 0) && seen(pose[8], 0) };
  for (const side of ['l', 'r']) {
    let prev = `hip_${side}`, ok = hipsSeen;
    for (const [seg, joint] of [['thigh', `knee_${side}`], ['shin', `ankle_${side}`], ['foot', `toe_${side}`]]) {
      ok = ok && seen(pose[POSE[joint]], 0.05);
      has[`${seg}_${side}`] = ok;
      if (!ok) continue;
      const raw = P(joint), from = live[prev], want = s * len(sub(rest[joint], rest[prev])), flat = lenXY(sub(raw, from));
      const dz = flat < want ? Math.sqrt(want * want - flat * flat) : 0;
      live[joint] = [raw[0], raw[1], from[2] + Math.sign(raw[2] - P(prev)[2] || 1) * dz];
      prev = joint;
    }
  }
  if (!has.head) { live.ear_l = add(live.shoulder_l, mul(sub(R.ear_l, rest.shoulder_l), s)); live.ear_r = add(live.shoulder_r, mul(sub(R.ear_r, rest.shoulder_r), s)); }
  const L = derive(live);
  const mats = new Float64Array(BODY_SEGMENTS.length * 12);
  BODY_SEGMENTS.forEach((seg, i) => {
    // An unseen leg segment keeps its parent's matrix (a straight joint): the thigh rides the pelvis, the shin the
    // thigh, the foot the shin. The caller hides parts that mostly ride unseen segments.
    if (seg.limb && !has[seg.id]) { const parent = i - (seg.id.startsWith('thigh') ? i : 1); mats.set(mats.slice(parent * 12, parent * 12 + 12), i * 12); return; }
    const a0 = R[seg.a], b0 = R[seg.b], a = L[seg.a], b = L[seg.b];
    const k = seg.limb ? Math.max(LIMB_STRETCH[0], Math.min(LIMB_STRETCH[1], len(sub(b, a)) / (s * len(sub(b0, a0)) || 1))) : 1;
    const other = seg.ref === 'hipLat' ? 'shoulderLat' : 'hipLat';
    const d0 = seg.up ? R.headUp : norm(sub(b0, a0)), d = seg.up ? L.headUp : norm(sub(b, a));
    mats.set(matrix(d0, R[seg.ref], R[other], d, L[seg.ref], L[other], s, k,
      seg.anchor === 'a' ? a0 : b0, seg.anchor === 'a' ? a : b), i * 12);
  });
  if (!mats.every(Number.isFinite) || !(s > 0)) return null; // a NaN or collapsed pose draws no body
  return { mats, has, scale: s, joints: L };
}

/**
 * 21 hand joints for an arm whose hand is not tracked: the rest hand of the upper-limb rig, turned to the pose's
 * wrist -> knuckles direction and pinky -> index axis, at the body scale. side: 'l' or 'r' (the person's).
 */
function poseHand(pose, side, restHand, scale, W, H) {
  const ids = side === 'l' ? [15, 17, 19] : [16, 18, 20];
  if (!ids.every(i => seen(pose?.[i], 0.05))) return null;
  const [w, p, x] = ids.map(i => [pose[i].x * W, -pose[i].y * H, -(pose[i].z || 0) * W]);
  const R0 = restHand;
  const d0 = norm(sub(mid(R0[5], R0[17]), R0[0])), l0 = norm(sub(R0[5], R0[17]));
  const d = norm(sub(mid(x, p), w)), l = norm(sub(x, p));
  const n0 = cross(d0, l0), n = cross(d, l);
  const F0 = frame(d0, l0, n0), F = frame(d, l, n);
  const rot = v => [0, 1, 2].map(i => F[0][i] * dot(F0[0], v) + F[1][i] * dot(F0[1], v) + F[2][i] * dot(F0[2], v));
  return Array.from({ length: 21 }, (_, j) => add(w, mul(rot(sub(R0[j], R0[0])), scale)));
}

exports.palmSize=palmSize;

exports.decodeBody=decodeBody;
exports.mirrorBody=mirrorBody;
exports.solveBody=solveBody;
exports.poseHand=poseHand;
exports.POSE=POSE;
exports.BODY_SEGMENTS=BODY_SEGMENTS;
},
11:(module,exports,require)=>{
// Anatomy rig: puts BodyParts3D bones and muscles (right upper limb, mirrored for the other side) onto MediaPipe hand
// landmarks, with the elbow and shoulder from MediaPipe Pose when the frame has them.
// Pure math, no three.js and no DOM, so it runs the same in the page, in node tests and in the GIF renderer.
//
// How it works:
// 1. Rest skeleton. Each bone mesh gets a long axis (principal component) and two ends; a joint is the midpoint of
//    the two bone ends that meet there. That gives the 21 hand landmarks, the elbow and the shoulder in the model.
// 2. Segments. Each finger bone, metacarpal, the palm, the forearm and the upper arm is one rigid segment from one
//    joint to the next. A frame = segment direction + a reference axis (across the knuckles for fingers, the palm
//    normal for the thumb). The rotation takes the rest frame to the live frame; scale = hand size in pixels per
//    metre; each finger bone may stretch along its own axis (clamped) so the knuckles land on the landmarks.
// 3. Skinning. A bone mesh follows its own segment. A muscle vertex blends its two nearest segments by inverse
//    distance in the rest pose (linear blend skinning), so tendons bend with the fingers.
// World space is screen pixels with y up and z toward the viewer: [x * W, -y * H, -z * W] from MediaPipe's normalized
// coordinates. That map is a rotation, so a mirrored camera picture turns a right hand into a geometric left hand;
// handSide() picks the model side from the handedness label and the mirrored flag.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0]; };
const mid = (a, b) => mul(add(a, b), 0.5);
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));

const FINGERS = [
  { key: 'index', mc: 'second metacarpal', joints: [5, 6, 7, 8] },
  { key: 'middle', mc: 'third metacarpal', joints: [9, 10, 11, 12] },
  { key: 'ring', mc: 'fourth metacarpal', joints: [13, 14, 15, 16] },
  { key: 'little', mc: 'fifth metacarpal', joints: [17, 18, 19, 20] },
];
const CARPALS = ['capitate', 'hamate', 'lunate', 'pisiform', 'scaphoid', 'trapezium', 'trapezoid', 'triquetral'];

// Segment table. a, b: joint keys (hand landmark index, 'elbow' or 'shoulder'). anchor: which end is pinned to its
// landmark. ref: reference axis for roll ('lat' = across the knuckles, 'nrm' = palm normal). stretch: may lengthen.
const SEGMENTS = [
  { id: 'palm', a: 0, b: 9, anchor: 'a', ref: 'lat', stretch: false },
  { id: 'mc1', a: 1, b: 2, anchor: 'b', ref: 'nrm', stretch: true },
  { id: 'pp1', a: 2, b: 3, anchor: 'a', ref: 'nrm', stretch: true },
  { id: 'dp1', a: 3, b: 4, anchor: 'a', ref: 'nrm', stretch: true },
  ...FINGERS.flatMap((f, i) => [
    { id: `mc${i + 2}`, a: 0, b: f.joints[0], anchor: 'b', ref: 'lat', stretch: false },
    { id: `pp${i + 2}`, a: f.joints[0], b: f.joints[1], anchor: 'a', ref: 'lat', stretch: true },
    { id: `mp${i + 2}`, a: f.joints[1], b: f.joints[2], anchor: 'a', ref: 'lat', stretch: true },
    { id: `dp${i + 2}`, a: f.joints[2], b: f.joints[3], anchor: 'a', ref: 'lat', stretch: true },
  ]),
  { id: 'forearm', a: 'elbow', b: 0, anchor: 'b', ref: 'lat', stretch: true },
  { id: 'upperarm', a: 'shoulder', b: 'elbow', anchor: 'b', ref: 'arm', stretch: true },
];
const SEGMENT_INDEX = Object.fromEntries(SEGMENTS.map((s, i) => [s.id, i]));
const STRETCH = [0.7, 1.4];      // a finger bone may be 30% shorter or 40% longer than the model's before we stop
const ARM_STRETCH = [0.75, 1.25];

/** Which segment a bone mesh rides on, from its BodyParts3D name; null for a muscle. */
function boneSegment(name) {
  const n = name.toLowerCase();
  if (CARPALS.some(c => n.includes(c))) return 'palm';
  if (n.includes('radius') || n.includes('ulna')) return 'forearm';
  if (n.includes('humerus')) return 'upperarm';
  if (n.includes('first metacarpal')) return 'mc1';
  if (n.includes('phalanx') && n.includes('thumb')) return n.includes('proximal') ? 'pp1' : 'dp1';
  for (const [i, f] of FINGERS.entries()) {
    if (n.includes(f.mc)) return `mc${i + 2}`;
    if (n.includes('phalanx') && n.includes(`${f.key} finger`)) {
      return (n.includes('proximal') ? 'pp' : n.includes('middle phalanx') ? 'mp' : 'dp') + (i + 2);
    }
  }
  return null;
}

/** Asset JSON + binary -> parts with Float32Array positions in metres and typed index arrays. */
function decodeAsset(doc, buffer) {
  const bytes = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return doc.parts.map(p => {
    const q = new Int16Array(bytes, p.positions, p.vertexCount * 3);
    const positions = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) positions[i] = q[i] * doc.quant;
    const indices = p.index32 ? new Uint32Array(bytes, p.indices, p.indexCount) : new Uint16Array(bytes, p.indices, p.indexCount);
    return { id: p.id, name: p.name, system: p.system, positions, indices };
  });
}

/** The asset is the right limb; 'left' mirrors it across x and flips the triangle winding. */
function mirrorParts(parts) {
  return parts.map(p => {
    const positions = p.positions.slice();
    for (let i = 0; i < positions.length; i += 3) positions[i] = -positions[i];
    const indices = p.indices.slice();
    for (let i = 0; i < indices.length; i += 3) { const t = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = t; }
    return { ...p, positions, indices };
  });
}

function centroid(pos) {
  const c = [0, 0, 0], n = pos.length / 3;
  for (let i = 0; i < pos.length; i += 3) { c[0] += pos[i]; c[1] += pos[i + 1]; c[2] += pos[i + 2]; }
  return mul(c, 1 / n);
}

/** Long axis of a mesh (power iteration on the covariance) and its two ends on that axis. */
function boneAxis(pos) {
  const c = centroid(pos), C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < pos.length; i += 3) {
    const d = [pos[i] - c[0], pos[i + 1] - c[1], pos[i + 2] - c[2]];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r * 3 + k] += d[r] * d[k];
  }
  let v = [0.3, 0.9, 0.2];
  for (let it = 0; it < 60; it++) v = norm([dot(C.slice(0, 3), v), dot(C.slice(3, 6), v), dot(C.slice(6, 9), v)]);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const t = (pos[i] - c[0]) * v[0] + (pos[i + 1] - c[1]) * v[1] + (pos[i + 2] - c[2]) * v[2];
    if (t < lo) lo = t; if (t > hi) hi = t;
  }
  return { c, axis: v, ends: [add(c, mul(v, lo)), add(c, mul(v, hi))] };
}

/** Rest joints in model space (metres): 0..20 like MediaPipe Hands, plus elbow and shoulder. */
function restSkeleton(parts) {
  const find = words => parts.find(p => p.system === 'skeletal' && words.every(w => p.name.toLowerCase().includes(w)));
  const need = words => { const p = find(words); if (!p) throw new Error(`rest skeleton: no bone named ${words.join(' ')}`); return p; };
  const lunate = centroid(need(['lunate']).positions), capitate = centroid(need(['capitate']).positions);
  // Ends ordered [proximal, distal] by distance to the lunate (the middle of the wrist).
  const ends = words => {
    const { ends: [e0, e1] } = boneAxis(need(words).positions);
    return len(sub(e0, lunate)) <= len(sub(e1, lunate)) ? [e0, e1] : [e1, e0];
  };
  const J = {};
  // For the forearm bones the end nearer the lunate is the wrist end: [wrist, elbow].
  const radius = ends(['radius']), ulna = ends(['ulna']);
  // MediaPipe's wrist point sits at the heel of the hand, between the forearm bones and the carpus.
  J[0] = lerp(mid(radius[0], ulna[0]), capitate, 0.35);
  const mc1 = ends(['first metacarpal']), pp1 = ends(['proximal phalanx', 'thumb']), dp1 = ends(['distal phalanx', 'thumb']);
  J[1] = mc1[0]; J[2] = mid(mc1[1], pp1[0]); J[3] = mid(pp1[1], dp1[0]); J[4] = dp1[1];
  for (const f of FINGERS) {
    const mc = ends([f.mc]), pp = ends(['proximal phalanx', `${f.key} finger`]);
    const mp = ends(['middle phalanx', `${f.key} finger`]), dp = ends(['distal phalanx', `${f.key} finger`]);
    const [m, p, d, t] = f.joints;
    J[m] = mid(mc[1], pp[0]); J[p] = mid(pp[1], mp[0]); J[d] = mid(mp[1], dp[0]); J[t] = dp[1];
  }
  const humerus = find(['humerus']);
  if (humerus) {
    const { ends: [h0, h1] } = boneAxis(humerus.positions);
    const [hp, hd] = len(sub(h0, lunate)) > len(sub(h1, lunate)) ? [h0, h1] : [h1, h0];
    J.elbow = mid(hd, radius[1]); J.shoulder = hp;
  } else {
    J.elbow = mid(radius[1], ulna[1]);
  }
  return J;
}

// Reference axes of a set of joints: lateral (little-finger knuckle -> index knuckle) and palm normal.
function refAxes(J) {
  const lat = norm(sub(J[5], J[17]));
  const nrm = norm(cross(sub(J[5], J[0]), sub(J[17], J[0])));
  return { lat, nrm };
}

function frame(d, r, fallback) {
  let e2 = sub(r, mul(d, dot(r, d)));
  if (len(e2) < 0.2) e2 = sub(fallback, mul(d, dot(fallback, d)));
  e2 = norm(e2);
  return [d, e2, cross(d, e2)];
}

/** Hand size: the summed palm edges, in the units of J. */
function palmSize(J) {
  return len(sub(J[0], J[5])) + len(sub(J[0], J[17])) + len(sub(J[5], J[17])) + len(sub(J[0], J[9]));
}

// Segment matrix as 12 numbers: row-major 3x3 linear part L, then translation t. world = L * v + t.
function segmentMatrix(seg, R0, R, s, k) {
  const [F0, F] = [frame(...R0), frame(...R)];
  const Lm = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    // rotation R = F * F0^T, columns of F are its three axes
    Lm[r * 3 + c] = F[0][r] * F0[0][c] + F[1][r] * F0[1][c] + F[2][r] * F0[2][c];
  }
  const d0 = R0[0];
  const out = new Float64Array(12);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    // s * Rot * (I + (k - 1) d0 d0^T)
    let v = 0;
    for (let m = 0; m < 3; m++) v += Lm[r * 3 + m] * ((m === c ? 1 : 0) + (k - 1) * d0[m] * d0[c]);
    out[r * 3 + c] = s * v;
  }
  return out;
}
const apply = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2] + M[9],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2] + M[10],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2] + M[11],
];
function pin(M, from, to) { const w = apply(M, from); M[9] += to[0] - w[0]; M[10] += to[1] - w[1]; M[11] += to[2] - w[2]; return M; }

/**
 * Live joints -> one matrix per segment. live: { hand: 21 world points, elbow?, shoulder? }.
 * Returns { mats: Float64Array(SEGMENTS.length * 12), scale, has: { forearm, upperarm } }.
 */
function solve(rest, live) {
  const H = live?.hand;
  if (!Array.isArray(H) || H.length < 21 || !H.slice(0, 21).every(finite)) return null;
  const s = palmSize(H) / palmSize(rest);
  if (!(s > 1e-6) || !Number.isFinite(s)) return null; // a collapsed hand (all points on one spot) has no size
  const A0 = refAxes(rest), A = refAxes(H);
  const mats = new Float64Array(SEGMENTS.length * 12);
  const elbow = finite(live.elbow) ? live.elbow : null, shoulder = elbow && finite(live.shoulder) ? live.shoulder : null;
  live = { ...live, elbow, shoulder };
  const has = { forearm: !!elbow, upperarm: !!shoulder };
  const J = { ...H, elbow: live.elbow, shoulder: live.shoulder };
  SEGMENTS.forEach((seg, i) => {
    let M;
    if ((seg.id === 'forearm' && !has.forearm) || (seg.id === 'upperarm' && !has.upperarm)) {
      // No pose: the forearm keeps a straight wrist (rides on the palm); the upper arm keeps a straight elbow.
      M = mats.slice(SEGMENT_INDEX[seg.id === 'forearm' ? 'palm' : 'forearm'] * 12, SEGMENT_INDEX[seg.id === 'forearm' ? 'palm' : 'forearm'] * 12 + 12);
    } else {
      const a0 = rest[seg.a], b0 = rest[seg.b], a = J[seg.a], b = J[seg.b];
      const d0 = norm(sub(b0, a0)), d = norm(sub(b, a));
      let r0, r;
      if (seg.ref === 'arm') {
        // Upper arm roll: the elbow's bending plane, or the palm normal when the arm is straight.
        r0 = cross(d0, norm(sub(rest[0], rest.elbow))); r = cross(d, norm(sub(H[0], live.elbow)));
        if (len(r) < 0.15 || len(r0) < 0.15) { r0 = A0.nrm; r = A.nrm; }
      } else { r0 = A0[seg.ref]; r = A[seg.ref]; }
      const other = seg.ref === 'lat' ? 'nrm' : 'lat';
      const lim = seg.id === 'forearm' || seg.id === 'upperarm' ? ARM_STRETCH : STRETCH;
      const k = seg.stretch ? Math.max(lim[0], Math.min(lim[1], len(sub(b, a)) / (s * len(sub(b0, a0)) || 1))) : 1;
      M = segmentMatrix(seg, [d0, r0, A0[other]], [d, r, A[other]], s, k);
      const anchor0 = seg.anchor === 'a' ? a0 : b0, anchor = seg.anchor === 'a' ? a : b;
      M[9] = M[10] = M[11] = 0; pin(M, anchor0, anchor);
    }
    mats.set(M, i * 12);
  });
  // Degenerate input (a finger folded onto itself, a zero-width palm) can still make a NaN axis: draw nothing then.
  return mats.every(Number.isFinite) ? { mats, scale: s, has } : null;
}

const finite = p => Array.isArray(p) && p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);

/** Distance from p to the segment a-b. */
function segDist(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, mul(ab, t))));
}

/**
 * Binds every part. A bone rides on one segment; a muscle vertex blends its two nearest segments
 * (weights 1/d^4 in the rest pose). Returns { side, rest, parts: [{ ...part, normals, seg?, bind? }] }.
 */
function buildRig(parts, side = 'right') {
  const src = side === 'left' ? mirrorParts(parts) : parts;
  const rest = restSkeleton(src);
  const lines = SEGMENTS.map(s => [rest[s.a], rest[s.b]]).map(l => l[0] && l[1] ? l : null);
  const out = src.map(p => {
    const normals = vertexNormals(p.positions, p.indices);
    const seg = p.system === 'skeletal' ? boneSegment(p.name) : null;
    if (seg) return { ...p, normals, seg: SEGMENT_INDEX[seg] };
    const n = p.positions.length / 3, bind = { s: new Uint8Array(n * 2), w: new Float32Array(n * 2) };
    let upper = 0;
    for (let i = 0; i < n; i++) {
      const v = [p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]];
      let b1 = -1, d1 = Infinity, b2 = -1, d2 = Infinity;
      lines.forEach((l, j) => {
        if (!l) return;
        const d = segDist(v, l[0], l[1]);
        if (d < d1) { b2 = b1; d2 = d1; b1 = j; d1 = d; } else if (d < d2) { b2 = j; d2 = d; }
      });
      const w1 = 1 / (d1 + 0.002) ** 4, w2 = b2 >= 0 ? 1 / (d2 + 0.002) ** 4 : 0;
      bind.s[i * 2] = b1; bind.s[i * 2 + 1] = Math.max(0, b2);
      bind.w[i * 2] = w1 / (w1 + w2); bind.w[i * 2 + 1] = w2 / (w1 + w2);
      if (b1 === SEGMENT_INDEX.upperarm) upper++;
    }
    return { ...p, normals, bind, upperShare: upper / n };
  });
  return { side, rest, parts: out };
}

function vertexNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const f = cross(e1, e2);
    for (const k of [a, b, c]) { n[k] += f[0]; n[k + 1] += f[1]; n[k + 2] += f[2]; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** Writes one part's posed positions and normals into outPos / outNrm (Float32Array, same length as positions). */
function skinPart(part, mats, outPos, outNrm) {
  const P = part.positions, N = part.normals, n = P.length / 3;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
    const count = part.bind ? 2 : 1;
    for (let j = 0; j < count; j++) {
      const w = part.bind ? part.bind.w[i * 2 + j] : 1;
      if (!w) continue;
      const o = (part.bind ? part.bind.s[i * 2 + j] : part.seg) * 12;
      px += w * (mats[o] * x + mats[o + 1] * y + mats[o + 2] * z + mats[o + 9]);
      py += w * (mats[o + 3] * x + mats[o + 4] * y + mats[o + 5] * z + mats[o + 10]);
      pz += w * (mats[o + 6] * x + mats[o + 7] * y + mats[o + 8] * z + mats[o + 11]);
      qx += w * (mats[o] * nx + mats[o + 1] * ny + mats[o + 2] * nz);
      qy += w * (mats[o + 3] * nx + mats[o + 4] * ny + mats[o + 5] * nz);
      qz += w * (mats[o + 6] * nx + mats[o + 7] * ny + mats[o + 8] * nz);
    }
    const l = Math.hypot(qx, qy, qz) || 1;
    outPos[i * 3] = px; outPos[i * 3 + 1] = py; outPos[i * 3 + 2] = pz;
    outNrm[i * 3] = qx / l; outNrm[i * 3 + 1] = qy / l; outNrm[i * 3 + 2] = qz / l;
  }
}

/** Normalized MediaPipe point -> world pixels (y up, z toward the viewer). */
const toWorld = (p, W, H) => [p.x * W, -p.y * H, -(p.z || 0) * W];

/**
 * The model side to draw for a hand. The asset is a right limb. A mirrored picture shows a right hand as a
 * geometric left hand, so the label and the mirror flag together pick the side.
 */
function handSide(label, mirrored) {
  const right = String(label).toLowerCase() === 'right';
  return right !== !!mirrored ? 'right' : 'left';
}

/**
 * Elbow and shoulder for a hand from a MediaPipe Pose frame, in world pixels. The pose arm is the one whose wrist
 * (15 or 16) is nearest the hand's wrist. The pose z is too noisy to trust, so the depth of each arm bone is taken
 * from its foreshortening against the model's bone length, with the sign from the pose z.
 */
function armFromPose(pose, handWorld, rest, scale, W, H, trust = {}) {
  if (!Array.isArray(pose) || pose.length < 17) return {};
  const wrist = handWorld[0];
  // An elbow a little below the picture is still a good forearm direction; a shoulder must be in the picture.
  const visibility = trust.visibility ?? 0.65, wristPalm = trust.wristPalm ?? 1;
  const seen = (p, margin) => p && (p.visibility ?? 1) >= visibility && p.x > -margin && p.x < 1 + margin && p.y > -margin && p.y < 1 + margin;
  const pick = [[15, 13, 11], [16, 14, 12]].map(ids => ids.map(i => pose[i]))
    .filter(([w, e]) => seen(w, 0.15) && seen(e, 0.15) && Number.isFinite(w.x) && Number.isFinite(w.y))
    .map(arm => ({ arm, d: Math.hypot(arm[0].x * W - wrist[0], -arm[0].y * H - wrist[1]) }))
    .sort((a, b) => a.d - b.d)[0];
  if (!pick || pick.d > palmSize(handWorld) * wristPalm) return {};
  const [pw, pe, ps] = pick.arm.map(p => toWorld(p, W, H));
  const place = (from, toXY, poseFrom, poseTo, restLen) => {
    const dx = toXY[0] - from[0], dy = toXY[1] - from[1], want = restLen * scale, flat = Math.hypot(dx, dy);
    const dz = flat < want ? Math.sqrt(want * want - flat * flat) : 0;
    return [toXY[0], toXY[1], from[2] + Math.sign(poseTo[2] - poseFrom[2] || 1) * dz];
  };
  const elbow = place(wrist, pe, pw, pe, len(sub(rest.elbow, rest[0])));
  const out = { elbow };
  if (rest.shoulder && seen(pick.arm[2], 0) && seen(pick.arm[1], 0)) out.shoulder = place(elbow, ps, pe, ps, len(sub(rest.shoulder, rest.elbow)));
  return out;
}

exports.boneSegment=boneSegment;
exports.decodeAsset=decodeAsset;
exports.mirrorParts=mirrorParts;
exports.boneAxis=boneAxis;
exports.restSkeleton=restSkeleton;
exports.palmSize=palmSize;
exports.solve=solve;
exports.buildRig=buildRig;
exports.vertexNormals=vertexNormals;
exports.skinPart=skinPart;
exports.handSide=handSide;
exports.armFromPose=armFromPose;
exports.SEGMENTS=SEGMENTS;
exports.SEGMENT_INDEX=SEGMENT_INDEX;
exports.toWorld=toWorld;
},
12:(module,exports,require)=>{
const EDGES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

module.exports.default={
  kind: 'scene', id: 'skeleton', port: 'scene@1', label: 'Hand skeleton wireframe',
  create({ canvas, opacity = 0.8, lineWidth = 1 }) {
    const ctx = canvas.getContext('2d'); let frame = null, size = { width: 1, height: 1 };
    return {
      update(next, nextSize) { frame = next; size = nextSize; },
      resize(w, h, dpr = 1) { canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); },
      render() { ctx.clearRect(0, 0, size.width, size.height); ctx.globalAlpha = opacity; ctx.lineWidth = lineWidth; ctx.strokeStyle = '#b8ffe2'; ctx.beginPath(); for (const hand of frame?.hands ?? []) for (const [a,b] of EDGES) { const from = hand?.[a], to = hand?.[b]; if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) continue; ctx.moveTo(from.x * size.width, from.y * size.height); ctx.lineTo(to.x * size.width, to.y * size.height); } ctx.stroke(); ctx.globalAlpha = 1; },
      info: () => ({ hands: frame?.hands?.length ?? 0 }), setLayers() {}, dispose() { ctx.clearRect(0, 0, canvas.width, canvas.height); },
    };
  },
};


},
13:(module,exports,require)=>{
// DOM output adapter for pages which embed PosePointer. Synthetic browser events
// are intentionally isTrusted=false; privileged injection remains the extension's job.
const buttons = { left: 0, middle: 1, right: 2 };
const masks = { left: 1, right: 2, middle: 4 };

function createDOMOutput({ document, multiClickMs = 500, multiClickPx = 8, now = () => Date.now() } = {}) {
  if (!document?.elementFromPoint) throw new TypeError('dom@1 needs a document');
  const win = document.defaultView ?? globalThis;
  const contacts = new Map();
  let lastClick = null;
  const pixel = event => ({
    x: Math.max(0, Math.min(1, Number(event.x) || 0)) * Math.max(1, (win.innerWidth ?? 1) - 1),
    y: Math.max(0, Math.min(1, Number(event.y) || 0)) * Math.max(1, (win.innerHeight ?? 1) - 1),
  });
  const fire = (target, EventType, type, init) => {
    const event = new EventType(type, { bubbles: true, cancelable: true, composed: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  // A moving contact reports where it is now: replace its Touch with one at the new point (same identifier and target).
  const moveTouch = (contact, target, x, y) => {
    const old = contact.touch, next = win.Touch ? new win.Touch({ identifier: old.identifier, target: old.target ?? target, clientX: x, clientY: y }) : { identifier: old.identifier, target: old.target ?? target, clientX: x, clientY: y };
    contact.touch = next;
  };
  const touch = (target, type, init) => {
    if (!win.TouchEvent) return;
    // Per the Touch Events spec, touchend and touchcancel list only the contacts that remain; the lifted one is in changedTouches.
    const ending = type === 'touchend' || type === 'touchcancel';
    const active = [...contacts.values()].map(c => c.touch).filter(t => !(ending && t === init.touch));
    fire(target, win.TouchEvent, type, { touches: active, targetTouches: active.filter(t => t.target === target), changedTouches: [init.touch] });
  };
  // Web components (model-viewer, Lit, Shoelace, Ionic) listen inside their shadow root, and document.elementFromPoint
  // stops at the shadow host (spatial-apps turntable, 2026-10-31: golden 05 turned model-viewer 0 degrees). Walk down
  // through open shadow roots to the innermost element; a closed root keeps its host as the target.
  const deepest = (x, y) => {
    let target = document.elementFromPoint(x, y);
    for (let depth = 0; target?.shadowRoot?.elementFromPoint && depth < 32; depth++) {
      const inner = target.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === target) break;
      target = inner;
    }
    return target;
  };
  function dispatch(event) {
    if (!event || !['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'wheel'].includes(event.type)) return [];
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return [];
    const { x, y } = pixel(event), id = event.pointerId ?? 1;
    const held = contacts.get(id);
    const target = held?.target ?? deepest(x, y);
    if (!target) return [];
    const buttonName = event.button ?? held?.button ?? 'left';
    const button = buttons[buttonName] ?? 0;
    if (event.type === 'wheel') {
      fire(target, win.WheelEvent, 'wheel', { clientX: x, clientY: y, deltaX: Number(event.deltaX) || 0, deltaY: event.deltaY });
      return ['wheel'];
    }
    const pointerType = event.pointerType ?? (id > 1 ? 'touch' : 'mouse');
    const common = { clientX: x, clientY: y, pointerId: id, pointerType, button, buttons: held || event.type === 'pointerdown' ? masks[buttonName] : 0 };
    fire(target, win.PointerEvent, event.type, common);
    if (event.type === 'pointerdown') {
      const touchPoint = win.Touch ? new win.Touch({ identifier: id, target, clientX: x, clientY: y }) : { identifier: id, target, clientX: x, clientY: y };
      contacts.set(id, { target, button: buttonName, touch: touchPoint });
      target.setPointerCapture?.(id);
      if (pointerType === 'touch') touch(target, 'touchstart', { touch: touchPoint });
      else fire(target, win.MouseEvent, 'mousedown', common);
    } else if (event.type === 'pointermove') {
      if (pointerType === 'touch' && held) { moveTouch(held, target, x, y); touch(target, 'touchmove', { touch: held.touch }); }
      else fire(target, win.MouseEvent, 'mousemove', common);
    } else {
      target.releasePointerCapture?.(id);
      if (pointerType === 'touch') { if (held) moveTouch(held, held.target, x, y); touch(target, event.type === 'pointercancel' ? 'touchcancel' : 'touchend', { touch: held?.touch }); }
      else {
        fire(target, win.MouseEvent, 'mouseup', { ...common, buttons: 0 });
        if (event.type === 'pointerup') {
          const t = Number.isFinite(event.t) ? event.t : now();
          const close = lastClick && t - lastClick.t <= multiClickMs && Math.hypot(x - lastClick.x, y - lastClick.y) <= multiClickPx && buttonName === lastClick.button;
          const detail = close ? lastClick.detail + 1 : 1;
          lastClick = { t, x, y, button: buttonName, detail };
          fire(target, win.MouseEvent, buttonName === 'right' ? 'contextmenu' : 'click', { ...common, buttons: 0, detail });
          if (buttonName === 'left' && detail === 2) fire(target, win.MouseEvent, 'dblclick', { ...common, buttons: 0, detail });
        }
      }
      contacts.delete(id);
    }
    return [event.type];
  }
  function release() {
    for (const [pointerId, c] of [...contacts]) dispatch({ type: 'pointercancel', pointerId, pointerType: pointerId > 1 ? 'touch' : 'mouse', x: c.touch.clientX / win.innerWidth, y: c.touch.clientY / win.innerHeight });
  }
  return { dispatch, release };
}

module.exports.default={ kind: 'output', id: 'dom', port: 'output@1', label: 'In-page DOM events', create: createDOMOutput };

exports.createDOMOutput=createDOMOutput;
},
14:(module,exports,require)=>{
// One mapping from the camera picture to the screen (Tao 2026-10-29 21:05Z: the anatomy drifted off his hand on a
// phone; visuals and landmarks must stay together on every video format). videoBox returns the rectangle CSS
// object-fit gives a <video> of size video inside container, so a visual drawn in that rectangle at x * width,
// y * height sits on the same pixel as the camera picture. Proven against Chromium's own object-fit by
// tools/video-box-e2e.mjs (4:3, 16:9, 9:16, portrait and landscape screens, cover and contain, mirrored, mid-stream
// size changes). Landmarks from mediapipe-source are already mirrored (x = 1 - x) with the video shown flipped.
function videoBox(container, video, fit = 'cover') {
  const W = container?.width, H = container?.height, vw = video?.width, vh = video?.height;
  if (!(W > 0 && H > 0 && vw > 0 && vh > 0)) return null; // no picture yet: draw nothing rather than guess an aspect
  const s = fit === 'contain' ? Math.min(W / vw, H / vh) : Math.max(W / vw, H / vh);
  const width = vw * s, height = vh * s;
  return { x: (W - width) / 2, y: (H - height) / 2, width, height };
}

// A normalized point (0..1 of the picture) to container pixels.
const toScreen = (box, p) => ({ x: box.x + p.x * box.width, y: box.y + p.y * box.height });

// The part of the camera picture a cover-fitted mirror shows, as a zone (x, y, w, h of the picture): with it as the
// active area, a landmark maps to the screen pixel where the picture shows it, so the cursor sits on the fingertip the
// person sees (Tao 2026-11-01 13:50Z: the mirror's cursor moved oddly; it used the 80% active area, not the picture).
function visibleZone(container, video) {
  const box = videoBox(container, video, 'cover');
  if (!box) return null;
  return { x: -box.x / box.width, y: -box.y / box.height, w: container.width / box.width, h: container.height / box.height };
}

exports.videoBox=videoBox;
exports.visibleZone=visibleZone;
exports.toScreen=toScreen;
},
15:(module,exports,require)=>{
// Frame-stall watchdog. If no frame arrives within FRAME_STALL_RELEASE_MS, onStall() runs once (the page releases a held press).
// 200 ms: the 13 real clips (8,636 frames, hands and empty-hand frames alike) never have a gap over 34 ms, so 200 ms is about 6 times the largest
// recorded gap and 6 frames at 30 fps; short enough that a stuck press clears before a person notices, long enough that one slow frame does not cut a stroke.
// NOT measured: stall lengths on a live camera (the clips are recorded every frame).
const FRAME_STALL_RELEASE_MS = 200;
function createFrameWatchdog({ limitMs = FRAME_STALL_RELEASE_MS, onStall, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = id => clearTimeout(id) } = {}) {
  let id = null;
  const clear = () => { if (id !== null) { clearTimer(id); id = null; } };
  return {
    feed() { clear(); id = setTimer(() => { id = null; onStall?.(); }, limitMs); },
    stop: clear,
  };
}

// createStallGuard: the web wrapper's use of the watchdog. It remembers whether the machine has a press down, releases the page's press on a stall, and swallows the machine's
// late pointerup/pointercancel for that already-released press (the DOM output would otherwise fire a stray mouseup and click). A later pointerdown passes, so a resumed pinch presses again.
function createStallGuard({ release, hide, notify, limitMs = FRAME_STALL_RELEASE_MS, setTimer, clearTimer } = {}) {
  let pressed = false, orphan = false;
  const wd = createFrameWatchdog({ limitMs, setTimer, clearTimer, onStall() { if (pressed) { release?.(); pressed = false; orphan = true; } hide?.(); notify?.(); } });
  return {
    feed: () => wd.feed(),
    stop: () => wd.stop(),
    filter(event) {
      if (event?.type === 'pointerdown') { pressed = true; orphan = false; }
      else if (event?.type === 'pointerup' || event?.type === 'pointercancel') { if (orphan) { orphan = false; return null; } pressed = false; }
      return event;
    },
  };
}

exports.createFrameWatchdog=createFrameWatchdog;
exports.createStallGuard=createStallGuard;
exports.FRAME_STALL_RELEASE_MS=FRAME_STALL_RELEASE_MS;
},
16:(module,exports,require)=>{
// One JSON config for every swappable part (Tao 2026-10-28 17:57Z): presets.json -> gesture engine options.
// A preset may name another with "extends"; its own keys replace the parent's stage by stage.const PRESETS = require(65).default;
// User menus: 2 options (a toggle) or 4 (a choice), each with an Advanced control. tools/menu-lint.mjs checks the counts.const MENUS = require(64).default;const { PLUGINS } = require(17);
exports.PRESETS=PRESETS;
exports.PLUGINS=PLUGINS;
exports.MENUS=MENUS;

// The anatomy mirror and the config tile share this exact tracker JSON contract.  Keep this
// independent of the menu so malformed Expert/import data can be rejected before it reaches UI.
const MIRROR_QUALITIES = Object.freeze(['low', 'medium', 'high', 'ultra']);
const MIRROR_RESOLUTIONS = Object.freeze(['360p', '480p', '720p', '1080p']);
const mirrorUnit = n => Number.isFinite(n) && n >= 0.1 && n <= 0.9;
function validateTrackerSettings(t) {
  const keys = ['preset', 'drawing', 'delegate', 'resolution', 'fps', 'numHands', 'pose', 'poseVisibility', 'poseWristPalm',
    'poseAcquireFrames', 'poseReleaseFrames', 'minDetection', 'minPresence', 'minTracking', 'facingMode', 'deviceId'];
  const problems = [];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return { ok: false, problems: ['tracker must be an object'] };
  const unknown = Object.keys(t).filter(k => !keys.includes(k));
  const missing = keys.filter(k => !Object.hasOwn(t, k));
  if (unknown.length) problems.push(`tracker.${unknown[0]} is not allowed`);
  if (missing.length) problems.push(`tracker.${missing[0]} is required`);
  if (![...MIRROR_QUALITIES, 'custom'].includes(t.preset)) problems.push('tracker.preset must be low, medium, high, ultra or custom');
  // 'wireframe' is the light tier drawn without a scene plug-in; any registered scene id picks that scene (G4: core names none).
  const drawings = ['wireframe', ...PLUGINS.ids('scene')];
  if (!drawings.includes(t.drawing)) problems.push(`tracker.drawing must be one of ${drawings.join(', ')}`);
  if (!['CPU', 'GPU'].includes(t.delegate)) problems.push('tracker.delegate must be CPU or GPU');
  if (!MIRROR_RESOLUTIONS.includes(t.resolution)) problems.push('tracker.resolution must be 360p, 480p, 720p or 1080p');
  if (![15, 30, 60].includes(t.fps)) problems.push('tracker.fps must be 15, 30 or 60');
  if (!Number.isInteger(t.numHands) || t.numHands < 1 || t.numHands > 4) problems.push('tracker.numHands must be an integer from 1 to 4');
  if (!['off', 'lite', 'full'].includes(t.pose)) problems.push('tracker.pose must be off, lite or full');
  if (!mirrorUnit(t.poseVisibility)) problems.push('tracker.poseVisibility must be a number from 0.1 to 0.9');
  if (!Number.isFinite(t.poseWristPalm) || t.poseWristPalm < 0.25 || t.poseWristPalm > 2) problems.push('tracker.poseWristPalm must be a number from 0.25 to 2');
  for (const k of ['poseAcquireFrames', 'poseReleaseFrames']) if (!Number.isInteger(t[k]) || t[k] < 1 || t[k] > 30) problems.push(`tracker.${k} must be an integer from 1 to 30`);
  for (const k of ['minDetection', 'minPresence', 'minTracking']) if (!mirrorUnit(t[k])) problems.push(`tracker.${k} must be a number from 0.1 to 0.9`);
  if (!['user', 'environment'].includes(t.facingMode)) problems.push('tracker.facingMode must be user or environment');
  if (typeof t.deviceId !== 'string') problems.push('tracker.deviceId must be a string');
  return { ok: problems.length === 0, problems };
}

const CAMERA_RESOLUTIONS = Object.freeze({ '360p': { width: 640, height: 360 }, '480p': { width: 640, height: 480 },
  '720p': { width: 1280, height: 720 }, '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 }, '2160p': { width: 3840, height: 2160 } });
function cameraOptions(camera = {}) {
  const resolution = camera.resolution ?? '480p', fps = camera.fps, auto = camera.auto ?? 'off';
  if (!CAMERA_RESOLUTIONS[resolution]) throw new Error(`camera.resolution must be one of ${Object.keys(CAMERA_RESOLUTIONS).join(', ')}`);
  if (fps !== undefined && !['max', 120, 90, 60, 30, 15].includes(fps)) throw new Error('camera.fps must be one of max, 120, 90, 60, 30, 15');
  if (!['off', 'auto30', 'auto60'].includes(auto)) throw new Error('camera.auto must be one of off, auto30, auto60');
  const facingMode = oneOf(camera.facingMode ?? 'user', ['user', 'environment'], 'camera.facingMode');
  if (camera.deviceId !== undefined && typeof camera.deviceId !== 'string') throw new Error('camera.deviceId must be a string');
  if (typeof (camera.mirrored ?? true) !== 'boolean') throw new Error('camera.mirrored must be a boolean');
  return { resolution, fps, auto, facingMode, deviceId: camera.deviceId, mirrored: camera.mirrored ?? true, ...CAMERA_RESOLUTIONS[resolution] };
}

const STAGES = ['camera', 'tracker', 'refinery', 'predictor', 'stabilizer', 'interaction', 'output', 'session', 'anchor', 'filter', 'guards', 'dwell', 'zone', 'overlay', 'visual', 'compositor', 'pinch', 'input', 'arming', 'gates', 'label', 'tier'];
const oneOf = (v, list, name) => {
  if (!list.includes(v)) throw new Error(`${name} must be one of ${list.join(', ')}`);
  return v;
};
const num = (v, lo, hi, name) => {
  if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} must be a number from ${lo} to ${hi}`);
  return v;
};

// Active area (Tao 19:18Z): { x, y, width, height } of the camera picture as the panel shows it (mirrored), each 0..1.
// The old { margin } form still works and means the same rectangle shrunk evenly from every edge.
function activeArea(z = {}) {
  if (z.width === undefined && z.height === undefined && z.x === undefined && z.y === undefined) {
    const m = num(z.margin ?? 0.1, 0, 0.35, 'zone.margin');
    if (!z.rotate) return m;
    z = { width: 1 - 2 * m, height: 1 - 2 * m, rotate: z.rotate };
  }
  const w = num(z.width ?? 0.8, 0.1, 1, 'zone.width'), h = num(z.height ?? 0.8, 0.1, 1, 'zone.height');
  const x = num(z.x ?? (1 - w) / 2, 0, 0.9, 'zone.x'), y = num(z.y ?? (1 - h) / 2, 0, 0.9, 'zone.y');
  if (x + w > 1.0001) throw new Error('zone.x + zone.width must be at most 1');
  if (y + h > 1.0001) throw new Error('zone.y + zone.height must be at most 1');
  // zone.rotate: degrees clockwise about the box centre (ergonomic trackpad zone, Tao 16:18Z). Left out when 0.
  const rotate = num(z.rotate ?? 0, -180, 180, 'zone.rotate');
  return rotate ? { x, y, w, h, rotate } : { x, y, w, h };
}

function resolvePreset(file, name) {
  const seen = new Set();
  const walk = id => {
    if (seen.has(id)) throw new Error(`preset ${id} extends itself`);
    seen.add(id);
    const p = file.presets?.[id];
    if (!p) throw new Error(`no preset named ${id}`);
    const base = p.extends ? walk(p.extends) : {};
    const out = { ...base };
    for (const k of STAGES) if (p[k] !== undefined) out[k] = typeof p[k] === 'object' && !Array.isArray(p[k]) ? { ...p[k] } : p[k];
    return out;
  };
  return walk(name);
}

/** Validated config -> createGestureMachine options. Throws a readable error on a bad value. */
function toEngineOptions(c, plugins = PLUGINS) {
  const tracker = c.tracker || {};
  if (c.session?.followTab !== undefined && typeof c.session.followTab !== 'boolean') throw new Error('session.followTab must be a boolean');
  const trackerOptions = {
    // Up to 4 hands (Tao 20:58Z: two users, four hands is a stretch goal; each hand its own cursor in touch mode).
    hands: num(tracker.hands ?? 2, 1, 4, 'tracker.hands'),
    pose: oneOf(tracker.pose ?? 'off', ['off', 'lite', 'full'], 'tracker.pose'),
  };
  cameraOptions(c.camera);
  // Plug-ins (core/ports/registry.js): the filter, the interaction and the cursor look are ids in the catalogue.
  const interactionStage = typeof c.interaction === 'object' ? c.interaction : {};
  const interactionId = typeof c.interaction === 'object' ? c.interaction.type : c.interaction;
  const interaction = plugins.get('interaction', interactionId);
  if (!interaction) throw new Error(`interaction must be one of ${plugins.ids('interaction').join(', ')}`);
  const smoother = plugins.get('filter', c.filter?.type ?? 'oneEuro');
  if (!smoother) throw new Error(`filter.type must be one of ${plugins.ids('filter').join(', ')}`);
  const refineryStage = c.refinery ?? { type: 'oneEuro' };
  const refinery = plugins.get('refinery', refineryStage.type ?? 'oneEuro');
  if (!refinery) throw new Error(`refinery.type must be one of ${plugins.ids('refinery').join(', ')}`);
  const a = c.anchor || {}, f = c.filter || {}, g = c.guards || {}, d = c.dwell || {}, z = c.zone || {}, overlay = c.overlay || {}, output = c.output || {};
  const legacyPlacement = { cursor: 'page', overlay: 'page', pip: 'pip', highlight: 'page' };
  const visual = c.visual ?? { layers: ['cursor', ...(overlay.page === 'overlay' || overlay.page === 'pip' ? ['skeleton'] : [])] };
  const compositor = c.compositor ?? { type: legacyPlacement[overlay.page ?? 'cursor'], videoOpacity: 1 };
  if (!Array.isArray(visual.layers) || !visual.layers.length || visual.layers.some(id => !/^[a-zA-Z0-9_-]{1,32}$/.test(id))) throw new Error('visual.layers must be a non-empty list of plug-in ids');
  if (c.visual) for (const id of visual.layers) if (!plugins.get('cursor', id === 'cursor' ? overlay.cursor ?? 'arrow' : id) && !plugins.get('scene', id)) throw new Error(`visual layer ${id} is not registered`);
  if (c.compositor && !plugins.get('compositor', compositor.type)) throw new Error(`compositor.type must be one of ${plugins.ids('compositor').join(', ')}`);
  num(compositor.videoOpacity ?? 1, 0, 1, 'compositor.videoOpacity');
  if (typeof (overlay.ray ?? true) !== 'boolean') throw new Error('overlay.ray must be a boolean');
  num(overlay.rayWidth ?? 3, 0.5, 20, 'overlay.rayWidth');
  // On-page view (Tao 20:34Z): cursor (ring only), overlay (skeleton over the page), pip (corner box) or highlight (old square).
  oneOf(overlay.page ?? 'cursor', ['cursor', 'overlay', 'pip', 'highlight'], 'overlay.page');
  num(overlay.pageOpacity ?? 0.6, 0.1, 1, 'overlay.pageOpacity');
  // Cursor look: the id of a skin plugin (core/overlay/skins). An unknown id falls back to the default on the page.
  if (!plugins.get('cursor', overlay.cursor ?? 'arrow')) throw new Error(`overlay.cursor must be one of ${plugins.ids('cursor').join(', ')}`);
  const anchor = plugins.get('anchor', a.type);
  if (!anchor) throw new Error(`anchor.type must be one of ${plugins.ids('anchor').join(', ')}`);
  const o = {
    createRefinery: () => refinery.create({ ...f, ...refineryStage }),
    tracker: trackerOptions,
    session: { followTab: c.session?.followTab === true },
    visual: { ...visual, compositor: { ...compositor } },
    zone: activeArea(z),
    filter: { minCutoff: num(f.minCutoff ?? 1, 0.01, 1000, 'filter.minCutoff'), beta: num(f.beta ?? 10, 0, 1000, 'filter.beta') },
    predictionMs: num(f.predictionMs ?? 20, 0, 100, 'filter.predictionMs'),
    lookahead: oneOf(f.lookahead ?? 'linear', ['linear', 'desp'], 'filter.lookahead'),
    desp: { alpha: num(f.desp?.alpha ?? 0.5, 0.01, 1, 'filter.desp.alpha'), predictMs: num(f.desp?.predictMs ?? 40, 0, 150, 'filter.desp.predictMs'),
      maxLead: num(f.desp?.maxLead ?? 0.08, 0, 0.3, 'filter.desp.maxLead'), brake: f.desp?.brake !== false },
    maxSpeed: num(f.maxSpeed ?? 2, 0.1, 100, 'filter.maxSpeed'),
    rejectTeleports: g.teleport !== false && g.teleport !== 0,
    teleport: num(g.teleport || 0.25, 0.01, 2, 'guards.teleport'),
    sizeJump: num(g.sizeJump ?? 0.35, 0.01, 5, 'guards.sizeJump'),
    dedupe: num(g.dedupe ?? 0.6, 0, 3, 'guards.dedupe'),
    coastMs: num(g.coastMs ?? 1000, 0, 1500, 'guards.coastMs'),
    // Lock-on (Tao 20:54Z, UX-15): for lockMs after the user's hand was last seen, only a hand near where it was
    // (lockRadius, image units) and not much smaller (lockMinScale of its size) can drive the cursor, so a passer-by's
    // hand cannot take it. 0 = off (older presets unchanged).
    lockMs: num(g.lockMs ?? 0, 0, 10000, 'guards.lockMs'), lockRadius: num(g.lockRadius ?? 0.25, 0.01, 1, 'guards.lockRadius'),
    lockMinScale: num(g.lockMinScale ?? 0.5, 0, 1, 'guards.lockMinScale'),
    coastTauMs: num(g.coastTauMs ?? 150, 0, 1000, 'guards.coastTauMs'),
    palmPause: false,
    // Two-hand multitouch (Tao 18:18Z): 'touch' gives each hand its own cursor and touch contact; 'mouse' is one cursor.
    inputMode: oneOf(c.input?.mode ?? 'mouse', ['mouse', 'touch'], 'input.mode'),
    // predictor (negative latency, charter chunk 4): a predictor@1 plug-in moves landmarks forward horizonMs before
    // the pointer and pinch see them. Absent = none, so older presets are unchanged.
    createPredictor: (() => { const pr = c.predictor || {};
      if ((pr.type ?? 'none') === 'none') return null;
      const p = plugins.get('predictor', pr.type);
      if (!p) throw new Error(`predictor.type must be one of ${plugins.ids('predictor').join(', ')}`);
      const stage = { ...pr, horizonMs: num(pr.horizonMs ?? 0, 0, 300, 'predictor.horizonMs') };
      return () => p.create(stage); })(),
    // stabilizer (Tao 17:15Z, hand tremor while still): a stabilizer@1 plug-in holds the cursor against small jitter.
    // Absent = none, so older presets are unchanged.
    createStabilizer: (() => { const st = c.stabilizer || {};
      if ((st.type ?? 'none') === 'none') return null;
      const p = plugins.get('stabilizer', st.type);
      if (!p) throw new Error(`stabilizer.type must be one of ${plugins.ids('stabilizer').join(', ')}`);
      const stage = { ...st };
      for (const k of ['radius', 'releaseRadius']) if (st[k] !== undefined) stage[k] = num(st[k], 0, 0.1, `stabilizer.${k}`);
      if (st.holdMs !== undefined) stage.holdMs = num(st.holdMs, 0, 2000, 'stabilizer.holdMs');
      return () => p.create(stage); })(),
    // output.type: the injector@1 plug-in the session sends through (seed step 3): cdp (default) or recording (dry run).
    outputType: plugins.get('injector', output.type ?? 'cdp') ? output.type ?? 'cdp' : (() => { throw new Error(`output.type must be one of ${plugins.ids('injector').join(', ')}`); })(),
    multiClickMs: num(output.multiClickMs ?? 500, 0, 2000, 'output.multiClickMs'),
    multiClickPx: num(output.multiClickPx ?? 8, 0, 100, 'output.multiClickPx'),
    // 0 = mouse rule (window from the last press); above 0 = pinch rule (window from the last release), see cdp-dispatch.js.
    multiClickGapMs: num(output.multiClickGapMs ?? 0, 0, 1000, 'output.multiClickGapMs'),
    multiClickEscape: num(interactionStage.multiClickEscape ?? 0.06, 0, 1, 'interaction.multiClickEscape'),
  };
  const anchorOptions = anchor.configure(a, { num, oneOf });
  Object.assign(o, anchorOptions);
  o.anchorAim = anchor.create(anchorOptions).aim;
  // The smoothing filter plug-in gets the validated stage; pose-pointer calls createFilter in place of One Euro.
  const stage = { ...f, minCutoff: o.filter.minCutoff, beta: o.filter.beta };
  o.filter.createFilter = () => smoother.create(stage);
  if (!interaction.builtin) {
    Object.assign(o, interaction.configure(c, { num, oneOf }));
    if (interaction.createMulti) o.createMultiInteraction = options => interaction.createMulti(options);
    else o.createInteraction = (options, signal) => interaction.create(options, signal);
  } else if (interactionId === 'dwell_cursor') {
    Object.assign(o, { pinchClick: false, pinchScale: true, dwell: true, dwellMs: num(d.ms ?? 800, 200, 3000, 'dwell.ms'),
      dwellRadius: num(d.radius ?? 0.035, 0.005, 0.2, 'dwell.radius'), dwellGraceMs: num(d.graceMs ?? 300, 0, 2000, 'dwell.graceMs'),
      requirePoint: d.requirePoint !== false });
  } else {
    const p = c.pinch || {};
    // pinch@1 detector (seed step 2, hex audit O1): a plug-in id, so a new contact model is a JSON edit, not a core edit.
    const detector = plugins.get('pinch', p.type ?? 'gap');
    if (!detector) throw new Error(`pinch.type must be one of ${plugins.ids('pinch').join(', ')}`);
    o.createPinch = detector.create;
    if (p.sphere !== undefined) {
      const s = p.sphere, ids = (v, k) => { if (!Array.isArray(v) || v.some(i => !Number.isInteger(i) || i < 0 || i > 20)) throw new Error(`pinch.sphere.${k} must be landmark numbers 0-20`); return [...v]; };
      if (p.type !== 'sphere') throw new Error('pinch.sphere needs pinch.type sphere');
      const radius = { default: num(s.radius?.default ?? 0.125, 0.01, 0.5, 'pinch.sphere.radius.default') };
      for (const [k, v] of Object.entries(s.radius || {})) if (k !== 'default') { if (!/^([0-9]|1[0-9]|20)$/.test(k)) throw new Error('pinch.sphere.radius keys are default or 0-20'); radius[k] = num(v, 0.01, 0.5, `pinch.sphere.radius.${k}`); }
      if (s.targets !== undefined && (!s.targets.length || s.targets.some(i => ![8, 12, 16, 20].includes(i)) || new Set(s.targets).size !== s.targets.length)) throw new Error('pinch.sphere.targets must be 1-4 distinct fingertips: 8 index, 12 middle, 16 ring, 20 pinky');
      o.sphere = { radius, targets: ids(s.targets ?? [8], 'targets'), match: oneOf(s.match ?? 'any', ['any', 'all'], 'pinch.sphere.match'), rejectTargets: ids(s.rejectTargets ?? [], 'rejectTargets'),
        openGap: num(s.openGap ?? 0.15, 0, 2, 'pinch.sphere.openGap'), impactMs: num(s.impactMs ?? 0, 0, 3000, 'pinch.sphere.impactMs'),
        holdMs: num(s.holdMs ?? 0, 0, 1000, 'pinch.sphere.holdMs'), ttiMs: num(s.ttiMs ?? 0, 0, 500, 'pinch.sphere.ttiMs') };
    }
    if (!['index', 'middle', 'ring', 'pinky', 'any'].includes(p.finger ?? 'middle')) throw new Error('pinch.finger must be index, middle, ring, pinky or any');
    const on = num(p.closeAt ?? 0.25, 0.05, 1, 'pinch.closeAt'), off = num(p.openAt ?? 0.6, 0.05, 1.5, 'pinch.openAt');
    if (off <= on) throw new Error('pinch.openAt must be larger than pinch.closeAt (hysteresis)');
    if (p.chords && p.chords.enabled) throw new Error('pinch.chords are not built yet; leave chords.enabled false');
    Object.assign(o, { pinchClick: true, dwell: false, requirePoint: false, clickFinger: p.finger ?? 'middle',
      pinMs: num(p.pinMs ?? 200, 0, 1000, 'pinch.pinMs'), pinRadius: num(p.pinRadius ?? 0, 0, 0.2, 'pinch.pinRadius'), pinchReleaseMs: num(p.releaseMs ?? 0, 0, 500, 'pinch.releaseMs'),
      // Snap-open (instant release on a wide open) is off by default (2 hand sizes is never reached): at 0.85 it split
      // Tao's drags on clip 11 and added a false re-press on the 02 sweep (C1 freeze). A preset opts in with a lower value.
      pinchSnapOpen: num(p.snapOpen ?? 2, 0.05, 2, 'pinch.snapOpen'),
      pinchScale: p.handScaled !== false, pinchOn: on, pinchOff: off, pinchRequireOpen: p.requireOpen !== false });
    // PINCH-SHAPE-1 layers (Tao 2026-10-31): each blocks only a new press; absent = off, so older presets are unchanged.
    const L = p.layers || {}, on_ = k => L[k] && L[k].enabled !== false;
    if (p.metric !== undefined && !['2d', '3d'].includes(p.metric)) throw new Error('pinch.metric must be 2d or 3d');
    if (p.handScaled === false && (p.metric === '3d' || p.ready || Object.values(L).some(l => l && l.enabled !== false))) throw new Error('pinch.metric 3d, pinch.ready and pinch.layers need handScaled (they are in hand-size units)');
    Object.assign(o, { pinchMetric: p.metric ?? '2d',
      pinchReadyOpenMs: num(p.ready?.openForMs ?? 0, 0, 2000, 'pinch.ready.openForMs'),
      pinchCloseWithinMs: on_('closingGate') ? num(L.closingGate.ms ?? 500, 50, 3000, 'pinch.layers.closingGate.ms') : 0,
      pinchFingerGate: on_('fingerGate') ? num(L.fingerGate.straightAtLeast ?? 1.7, 0.5, 3, 'pinch.layers.fingerGate.straightAtLeast') : 0,
      pinchTipCue: on_('tipCue'),
      pinchConfirmMs: on_('confirm') ? num(L.confirm.ms ?? 33, 0, 500, 'pinch.layers.confirm.ms') : 0,
      // Palm cone (Tao 17:32Z): a new press only while the palm plane faces the camera within this many degrees.
      pinchPalmConeDeg: on_('palmCone') ? num(L.palmCone.deg ?? 60, 5, 90, 'pinch.layers.palmCone.deg') : 0 });
    if (p.chord !== undefined) {
      const f = ['index', 'middle', 'ring', 'pinky'];
      if (!Array.isArray(p.chord) || !p.chord.length || p.chord.length > 4 || p.chord.some(x => !f.includes(x)) || new Set(p.chord).size !== p.chord.length) throw new Error('pinch.chord must be 1-4 different fingers from index, middle, ring, pinky');
      if (p.type === 'sphere' || p.finger === 'any') throw new Error('pinch.chord needs pinch.type gap and a named finger');
      Object.assign(o, { pinchChord: [...p.chord], clickFinger: p.chord[0], pinchChordStraightAtLeast: num(p.chordStraightAtLeast ?? 1.2, 0.5, 3, 'pinch.chordStraightAtLeast') });
    }
  }
  // Click-intent gates (gate@1, Tao 18:23Z: every click gate is one hexagonal seam). "gates" is a list of gate@1 plug-ins
  // by type; a new press counts only while every gate allows it, and a held press is never cut. Older keys map onto
  // the same seam: "arming" (Tao 21:51Z) is gate "arming", pinch.layers.palmCone is gate "palm-cone".
  const poses = ['point', 'palm', 'palm-scaled', 'fist'];
  const armingStage = (ar, k) => {
    const a = { pose: oneOf(ar.pose ?? 'point', poses, `${k}.pose`), holdMs: num(ar.holdMs ?? 300, 0, 3000, `${k}.holdMs`),
      armedMs: num(ar.armedMs ?? 10000, 300, 120000, `${k}.armedMs`), refreshOnClick: ar.refreshOnClick !== false,
      disarm: oneOf(ar.disarm ?? 'none', ['none', ...poses], `${k}.disarm`), disarmMs: num(ar.disarmMs ?? 500, 0, 3000, `${k}.disarmMs`) };
    if (a.disarm === a.pose) throw new Error(`${k}.disarm must be a different pose from ${k}.pose`);
    return a;
  };
  const gateStage = (g, k) => {
    if (!g || typeof g !== 'object' || !plugins.get('gate', g.type)) throw new Error(`${k}.type must be one of ${plugins.ids('gate').join(', ')}`);
    if (g.type === 'arming') return { type: 'arming', ...armingStage(g, k) };
    if (g.type === 'palm-cone') return { type: 'palm-cone', deg: num(g.deg ?? 60, 5, 90, `${k}.deg`) };
    return { type: g.type };
  };
  const gates = [];
  const ar = c.arming;
  if (ar && ar.pose !== 'none') { const arming = armingStage(ar, 'arming'); gates.push({ type: 'arming', ...arming }); Object.assign(o, { arming }); }
  if (o.pinchPalmConeDeg > 0) { gates.push({ type: 'palm-cone', deg: o.pinchPalmConeDeg }); delete o.pinchPalmConeDeg; }
  if (c.gates !== undefined) {
    if (!Array.isArray(c.gates) || c.gates.length > 8) throw new Error('gates must be a list of at most 8 gate@1 stages');
    c.gates.forEach((g, i) => gates.push(gateStage(g, `gates[${i}]`)));
  }
  if (gates.some(g => g.type === 'arming')) o.requirePoint = false;
  if (gates.length) Object.assign(o, { gates, createGates: () => gates.map(g => { const { type, ...stage } = g; return plugins.get('gate', type).create(stage); }) });
  return o;
}

exports.validateTrackerSettings=validateTrackerSettings;
exports.cameraOptions=cameraOptions;
exports.activeArea=activeArea;
exports.resolvePreset=resolvePreset;
exports.toEngineOptions=toEngineOptions;
exports.MIRROR_QUALITIES=MIRROR_QUALITIES;
exports.MIRROR_RESOLUTIONS=MIRROR_RESOLUTIONS;
exports.CAMERA_RESOLUTIONS=CAMERA_RESOLUTIONS;
exports.STAGES=STAGES;
},
17:(module,exports,require)=>{
// The plug-in catalogue: every swappable smoothing filter, interaction and cursor look, by id. Adding one = a file in
// this folder plus one line here; a preset then names its id ("filter": {"type": id}, "interaction": id,
// "overlay": {"cursor": id}). Nothing under core/ changes (gate row G4 checks it). docs/PLUGINS.md has the schema.const { createRegistry } = require(63);const { SKINS } = require(59);const oneEuro = require(58).default;const kalman = require(57).default;const dwellDrag = require(54).default;const pinchPull = require(53).default;const spotlight = require(52).default;const landmark = require(51).default;const ray = require(50).default;const fixedRay = require(49).default;const fingerRay = require(48).default;const wristRay = require(46).default;const anatomy = require(9).default;const skeleton = require(12).default;const page = require(45).default;const pip = require(44).default;const video = require(42).default;const refineryOneEuro = require(41).default;const refineryRaw = require(40).default;const dom = require(13).default;const gapPinch = require(39).default;const spherePinch = require(38).default;const cdpInjector = require(34).default;const recordingInjector = require(33).default;const predictNone = require(32).default;const predictDesp = require(31).default;const predictPhysics = require(30).default;const predictKalman = require(28).default;const stabilizeNone = require(27).default;const stabilizeDeadzone = require(26).default;const stabilizeStillLock = require(25).default;const gateArming = require(22).default;const gatePalmCone = require(19).default;const gateAlways = require(18).default;

const cursor = skin => ({ kind: 'cursor', port: 'visualization@1', ...skin });
const builtinInteraction = (id, label) => ({ kind: 'interaction', port: 'interaction@1', builtin: true, id, label });

const PLUGINS = createRegistry([
  oneEuro,
  builtinInteraction('dwell_cursor', 'Dwell: hold still to click (core interaction tile)'),
  builtinInteraction('stable_pointer_pinch_chords', 'Pinch: thumb + finger clicks (core interaction tile)'),
  ...Object.values(SKINS).map(cursor),
  kalman, dwellDrag, pinchPull, spotlight, skeleton, anatomy, page, pip, video,
  landmark, ray, fixedRay, fingerRay, wristRay, refineryOneEuro, refineryRaw,
  dom, gapPinch, spherePinch, cdpInjector, recordingInjector,
  predictNone, predictDesp, predictPhysics, predictKalman,
  stabilizeNone, stabilizeDeadzone, stabilizeStillLock,
  gateAlways, gateArming, gatePalmCone,
]);

exports.PLUGINS=PLUGINS;
},
18:(module,exports,require)=>{
// gate@1 "always": every press counts (the plain pinch, "Active"). Same as listing no gates; here so a swap test and a
// tournament can name it.
module.exports.default={ kind: 'gate', id: 'always', port: 'gate@1', label: 'No gate: every press counts',
  create: () => ({ update: () => true, noteClick() {}, left: () => 1 }) };


},
19:(module,exports,require)=>{
// gate@1 "palm-cone" (Tao 2026-10-31 17:32Z): new presses count only while the palm plane faces the camera axis within
// deg degrees. Measured against the camera axis, so the same gate means "palm down" for a camera under the hand.
// Tournament: alone it cut idle false clicks 49 -> 5.7/h at 30 deg, but only 52% of natural pointing frames sit in that
// cone (wrist cost), and on top of the palm latch it added nothing.const { palmAngle } = require(20);
module.exports.default={ kind: 'gate', id: 'palm-cone', port: 'gate@1', label: 'Palm cone: palm must face the camera',
  create: ({ deg = 60 } = {}) => ({ update: (t, hand) => !!hand && palmAngle(hand) <= deg, noteClick() {}, left: () => 1 }) };


},
20:(module,exports,require)=>{
// pinch@1 adapter "gap" (PosePointer seed step 2, hex audit O1): the thumb-to-finger gap with hysteresis, release grace,
// requireOpen, the fist guard and the PINCH-SHAPE-1 layers. Moved unchanged out of hand-pointer.js, which now asks a
// pinch@1 detector whether the pinch is closed and keeps only the cursor, hand loss and the Pointer ABI events.
// Contract (core/ports/registry.js pinch@1): create(options) -> { update(hand, t, pressed, point) -> { next, openPoint,
// lost }, commit(next, wasPressed), cancel(), reset() }. hand has an index tip; point is the filtered cursor.const { createHysteresis } = require(21);

const FINGER_TIPS = Object.freeze({ index: 8, middle: 12, ring: 16, pinky: 20 });

// Palm plane angle to the camera axis, in degrees (0 = palm or back of the hand square to the camera), from the wrist and
// the index and pinky knuckles with MediaPipe's image z. A mono camera cannot tell palm from back without handedness.
function palmAngle(hand) {
  const [w, a, b] = [hand[0], hand[5], hand[17]];
  if (![w, a, b].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return Infinity;
  const z = p => (Number.isFinite(p.z) ? p.z : 0);
  const u = [a.x - w.x, a.y - w.y, z(a) - z(w)], v = [b.x - w.x, b.y - w.y, z(b) - z(w)];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(...n);
  return len > 0 ? Math.acos(Math.min(1, Math.abs(n[2]) / len)) * 180 / Math.PI : Infinity;
}

function createGapPinch(o) {
  // pinch.chord (Tao 17:33Z): 1-4 fingers that must all touch the thumb; the gap is the widest of them.
  const chord = o.pinchChord?.length ? o.pinchChord : [o.clickFinger];
  const gateFingers = [[12, 9], [16, 13], [20, 17]].filter(([tip]) => !chord.some(f => FINGER_TIPS[f] === tip));
  let pressed = false;
  const pinch = createHysteresis({
    on: -(o.pinchScale ? (o.scaledOn ?? 0.25) : o.pinchOn),
    off: -(o.pinchScale ? (o.scaledOff ?? 0.40) : o.pinchOff),
  });
  let missingThumbFrames = 0;
  let openSince = null;
  let openPoint = null;
  let snapped = false;
  // requireOpen: a pinch only starts after the finger was seen open (past the release threshold). Tao's golden clips
  // show why: in a pointing fist the thumb rests on the curled middle finger (0.2 hand sizes apart), which reads as a
  // held pinch; a deliberate pinch from an open hand goes from about 1.2 to under 0.15.
  let seenOpen = false;
  let activeFinger = null;
  const openFingers = new Set();
  // Pinch layers (PINCH-SHAPE-1, Tao 2026-10-31 04:58Z: plain pinch to click). All off unless a preset sets them.
  // gap: closing speed state for closeWithinMs, open run for readyOpenMs, closed run for confirmMs.
  let gapOpenAt = -Infinity, gapOpenStart = null, gapOpenLen = 0, closedSince = null;

  // Gates that only ever block a new press; a held press is never cut by them.
  function pinchLayers(next, distance, hand, thumb, t) {
    const off = o.scaledOff ?? 0.40;
    if (distance > off) { gapOpenAt = t; if (gapOpenStart === null) gapOpenStart = t; gapOpenLen = t - gapOpenStart; }
    else gapOpenStart = null;
    closedSince = next && !pressed ? (closedSince ?? t) : null;
    // Contact model hook (Tao 14:56Z sphere model): an adapter may replace the gap test for a new press. A held press
    // still releases by the gap hysteresis and release grace below.
    if (o.contact && !pressed) return o.contact.update(hand, thumb, t);
    if (pressed || !next) return next;
    if (o.pinchCloseWithinMs > 0 && t - gapOpenAt > o.pinchCloseWithinMs) return false;
    if (o.pinchReadyOpenMs > 0 && gapOpenLen < o.pinchReadyOpenMs) return false;
    if (o.pinchFingerGate > 0 && gateFingers.length) {
      if (![0, 9, 12, 13, 16, 17, 20].every(i => hand[i] && Number.isFinite(hand[i].x) && Number.isFinite(hand[i].y))) return false;
      const w = hand[0], r = (tip, knuckle) => Math.hypot(hand[tip].x - w.x, hand[tip].y - w.y) / Math.hypot(hand[knuckle].x - w.x, hand[knuckle].y - w.y);
      if (gateFingers.reduce((a, [tip, k]) => a + r(tip, k), 0) / gateFingers.length < o.pinchFingerGate) return false;
    }
    if (o.pinchTipCue && !(Math.hypot(thumb.x - hand[8].x, thumb.y - hand[8].y) < Math.hypot(thumb.x - hand[6].x, thumb.y - hand[6].y))) return false;
    if (o.pinchConfirmMs > 0 && t - closedSince < o.pinchConfirmMs) return false;
    return true;
  }

  function update(hand, t, wasPressed, point) {
    pressed = wasPressed;
    // Any finger can be the click button (Tao 18:12Z); index and middle were the original two.
    const clickTip = hand[FINGER_TIPS[activeFinger || o.clickFinger] ?? 8];
    const thumb = hand[4];
      let next = pressed;
      if (o.clickFinger === 'any' && thumb && Number.isFinite(thumb.x) && Number.isFinite(thumb.y)) {
        const wrist = hand[0], knuckle = hand[5], scale = wrist && knuckle && Math.hypot(wrist.x - knuckle.x, wrist.y - knuckle.y);
        const distances = Object.fromEntries(Object.entries(FINGER_TIPS).map(([finger, i]) => [finger, hand[i] && scale > 0 ? Math.hypot(hand[i].x - thumb.x, hand[i].y - thumb.y) / scale : Infinity]));
        for (const [finger, d] of Object.entries(distances)) if (d > (o.scaledOff ?? 0.40)) openFingers.add(finger);
        if (!pressed && !activeFinger) {
          const candidate = Object.keys(FINGER_TIPS).find(finger => distances[finger] < (o.scaledOn ?? 0.25) && (!o.requireOpen || openFingers.has(finger)));
          if (candidate) {
            const fist = Object.values(distances).every(d => d < (o.scaledOff ?? 0.40));
            if (!o.requireOpen || !fist) { activeFinger = candidate; next = true; }
          }
        } else if (activeFinger) {
          const on = o.scaledOn ?? 0.25, off = o.scaledOff ?? 0.40;
          const distance = distances[activeFinger], open = distance > off;
          next = !open;
          if (pressed && o.releaseMs > 0) {
            if (distance > (o.snapOpen ?? off + 0.25)) { next = false; snapped = true; }
            else if (openSince !== null) { next = distance >= on && t - openSince < o.releaseMs; }
            else if (open) next = true;
            if (open && openSince === null) { openSince = t; openPoint = { ...point }; }
            else if (distance < on) { openSince = null; openPoint = null; next = true; }
          }
        }
      } else if (thumb && clickTip && Number.isFinite(thumb.x) && Number.isFinite(thumb.y) &&
          Number.isFinite(clickTip.x) && Number.isFinite(clickTip.y)) {
        missingThumbFrames = 0;
        const tips = chord.length > 1 ? chord.map(f => hand[FINGER_TIPS[f]]) : [clickTip];
        const ok = q => q && Number.isFinite(q.x) && Number.isFinite(q.y);
        let distance = tips.every(ok) ? Math.max(...tips.map(q => Math.hypot(q.x - thumb.x, q.y - thumb.y))) : Infinity;
        if (o.pinchScale) {
          const wrist = hand[0], knuckle = hand[5];
          let scale = wrist && knuckle && Math.hypot(wrist.x - knuckle.x, wrist.y - knuckle.y);
          // metric 3d: the image z of MediaPipe uses roughly the x scale, so foreshortened fingers no longer touch.
          if (o.pinchMetric === '3d' && wrist && knuckle) {
            const z = p => (Number.isFinite(p.z) ? p.z : 0);
            scale = Math.hypot(wrist.x - knuckle.x, wrist.y - knuckle.y, z(wrist) - z(knuckle));
            distance = tips.every(ok) ? Math.max(...tips.map(q => Math.hypot(q.x - thumb.x, q.y - thumb.y, z(q) - z(thumb)))) : Infinity;
          }
          distance = scale > 0 ? distance / scale : Infinity;
        }
        next = pinch.update(-distance);
        if (o.pinchScale) next = pinchLayers(o.contact && !pressed ? true : next, distance, hand, thumb, t);
        const open = distance > (o.pinchScale ? (o.scaledOff ?? 0.40) : o.pinchOff);
        if (pressed && o.releaseMs > 0) {
          const on = o.pinchScale ? (o.scaledOn ?? 0.25) : o.pinchOn;
          const snapOpen = o.snapOpen ?? (o.pinchScale ? (o.scaledOff ?? 0.40) + 0.25 : o.pinchOff + 0.25);
          if (distance > snapOpen) { next = false; snapped = true; }
          else if (openSince !== null) next = distance >= on && t - openSince < o.releaseMs;
          else if (open) next = true;
          if (open && openSince === null) { openSince = t; openPoint = { ...point }; }
          else if (distance < on) { openSince = null; openPoint = null; next = true; }
        }
        if (open) seenOpen = true;
        if (o.requireOpen && next && !pressed && !seenOpen) next = false;
        // Fist guard: when the other curled fingers also sit at the thumb, the hand is a fist, not a pinch.
        if (o.requireOpen && next && !pressed && o.pinchScale) {
          const others = Object.entries(FINGER_TIPS).filter(([f]) => f !== 'index' && f !== o.clickFinger && !chord.includes(f)).map(([, i]) => hand[i]);
          const near = others.filter(p => p && Math.hypot(p.x - thumb.x, p.y - thumb.y) / Math.hypot(hand[0].x - hand[5].x, hand[0].y - hand[5].y) < (o.scaledOff ?? 0.40)).length;
          // A chord that uses every other finger has no finger left to tell a fist; the curl check below takes over.
          if (others.length && near === others.length) next = false;
          if (!others.length && chord.length > 1) {
            const w = hand[0], ext = f => { const tip = hand[FINGER_TIPS[f]], k = hand[FINGER_TIPS[f] - 3]; return Math.hypot(tip.x - w.x, tip.y - w.y) / Math.hypot(k.x - w.x, k.y - w.y); };
            if (chord.reduce((a, f) => a + ext(f), 0) / chord.length < (o.pinchChordStraightAtLeast ?? 1.2)) next = false;
          }
        }
      } else if (pressed && o.releaseMs > 0) {
        if (openSince === null) { openSince = t; openPoint = { ...point }; }
        next = t - openSince < o.releaseMs;
      } else if (!o.pinchScale || ++missingThumbFrames > 4) {
        next = o.pinchScale ? pinch.update(-Number.MAX_VALUE) : pinch.update(-Infinity);
      }
    const lost = !thumb || !clickTip || !Number.isFinite(thumb.x) || !Number.isFinite(thumb.y) || !Number.isFinite(clickTip.x) || !Number.isFinite(clickTip.y);
    return { next, openPoint, lost };
  }

  // A snap-open release is a deliberate wide open, so the next pinch may follow at once (fast double pinch). A grace
  // release may be jitter that read open for releaseMs, so requireOpen still wants a fresh open before re-grabbing.
  function commit(next, wasPressed) {
    if (next && !wasPressed) snapped = false;
    if (!next && wasPressed) { if (!snapped) seenOpen = false; openSince = null; openPoint = null; activeFinger = null; }
  }
  // Hand lost past lostAfterMs: the press is cancelled by the pointer.
  function cancel() {
    o.contact?.reset(); pinch.reset(); openSince = null; openPoint = null;
    seenOpen = false; activeFinger = null; openFingers.clear(); gapOpenAt = -Infinity; gapOpenStart = null; gapOpenLen = 0; closedSince = null;
  }
  function reset() { o.contact?.reset(); pinch.reset(); missingThumbFrames = 0; openSince = null; openPoint = null; snapped = false; seenOpen = false; activeFinger = null; openFingers.clear(); gapOpenAt = -Infinity; gapOpenStart = null; gapOpenLen = 0; closedSince = null; }
  return { update, commit, cancel, reset };
}

exports.palmAngle=palmAngle;
exports.createGapPinch=createGapPinch;
exports.FINGER_TIPS=FINGER_TIPS;
},
21:(module,exports,require)=>{
// UTC: 2026-10-27T21:13:06Z UTC. Copied unchanged below from factory/core/hysteresis.js.
// Hysteresis (Schmitt trigger) and tracking-loss debounce.
//
// Adapted from TTaoGaming/Tectangle September2025/Tectangle/src/PinchRecognitionManager.js
// (two-threshold trigger/release FSM: triggerRatio 0.4 / releaseRatio 0.8, state
// held between the thresholds). Here the polarity is "high value = on" and the
// state is a pure function of the input stream; no events, no controller map.
//
// createHysteresis: turns on at value >= on, off at value <= off, and holds its
// state in between, so a signal wobbling inside the band cannot chatter.
//
// createTrackingLoss: "ok" until the pose has been missing for `lostAfterMs`;
// "lost" until it has been present continuously for `recoverAfterMs`. A gap
// shorter than lostAfterMs never flips the state, and a gap during recovery
// restarts the recovery timer, so one-frame dropouts cannot make it flap.
// Starts "ok" (a replay that opens with a pose must not open with a pause).

function createHysteresis({ on, off, initial = false } = {}) {
  if (!(Number.isFinite(on) && Number.isFinite(off) && on > off)) {
    throw new Error('createHysteresis requires finite thresholds with on > off');
  }
  let state = !!initial;
  return {
    update(value) {
      if (Number.isFinite(value)) {
        if (value >= on) state = true;
        else if (value <= off) state = false;
      }
      return state;
    },
    get state() {
      return state;
    },
    reset() {
      state = !!initial;
    },
  };
}

function createTrackingLoss({ lostAfterMs = 250, recoverAfterMs = 150 } = {}) {
  let state = 'ok';
  let missingSince = null;
  let presentSince = null;
  return {
    update(hasPose, tMs) {
      if (hasPose) {
        missingSince = null;
        if (presentSince === null) presentSince = tMs;
        if (state === 'lost' && tMs - presentSince >= recoverAfterMs) state = 'ok';
      } else {
        presentSince = null;
        if (missingSince === null) missingSince = tMs;
        if (state === 'ok' && tMs - missingSince >= lostAfterMs) state = 'lost';
      }
      return state;
    },
    get state() {
      return state;
    },
    reset() {
      state = 'ok';
      missingSince = null;
      presentSince = null;
    },
  };
}

exports.createHysteresis=createHysteresis;
exports.createTrackingLoss=createTrackingLoss;
},
22:(module,exports,require)=>{
// gate@1 "arming": a pose held holdMs opens a window of armedMs in which new presses count; clicks restart the window
// (refreshOnClick). Poses: point, palm, palm-scaled (open palm in hand sizes, works for a far hand), fist. This is the
// open-palm latch that won the pinch-gate tournament (RECEIPT-PINCH-GATES-1) with pose palm-scaled, 300 ms, 1 s.const { createArmingGate } = require(23);
module.exports.default={ kind: 'gate', id: 'arming', port: 'gate@1', label: 'Pose latch: a pose arms clicks for a while',
  create: stage => createArmingGate(stage) };


},
23:(module,exports,require)=>{
// Arming gate (Tao 21:51Z): clicks only count while the hand is armed. Holding the arming pose for `holdMs` arms it for
// `armedMs`; holding the pose keeps restarting that window, and so does every click when `refreshOnClick` is on, so a
// user who keeps interacting stays armed. An optional disarm pose held for `disarmMs` ends the window at once.
// Pure: (t, hand) in, armed out. The interaction tile gates dwell and pinch through it; null spec = always armed.const { isPointing, isOpenPalm, isOpenPalmScaled, isFist } = require(24);

// Arming asks for a clearly straight index (tip 1.25x as far from the wrist as its middle joint). On Tao's clips real
// pointing sits at 1.28-1.36 (10th percentile and up); a chin-resting hand in 09-no-pointing reads 1.18-1.19 and passed
// the looser 1.15 test for 4.8 s.
const ARM_POSES = Object.freeze({ point: h => isPointing(h, 1.25), palm: isOpenPalm, 'palm-scaled': isOpenPalmScaled, fist: isFist });

function createArmingGate(spec = null) {
  if (!spec) return { update: () => true, noteClick() {}, left: () => 1 };
  const { pose = 'point', holdMs = 300, armedMs = 10000, refreshOnClick = true, disarm = 'none', disarmMs = 500 } = spec;
  const arms = ARM_POSES[pose], disarms = disarm === 'none' ? null : ARM_POSES[disarm];
  let since = null, offSince = null, until = -Infinity, last = 0;
  return {
    update(t, hand) {
      // A suspended tab or corrupt source clock must not turn two observed frames into a completed hold.
      // The signal tile coasts for 300 ms by default, so a larger gap starts both holds over.
      if (!Number.isFinite(t) || t < last || t - last > 300) { since = null; offSince = null; }
      last = t;
      const arming = !!hand && arms(hand);
      if (arming) { if (since === null) since = t; if (t - since >= holdMs) until = t + armedMs; } else since = null;
      if (disarms && hand && !arming && disarms(hand)) { if (offSince === null) offSince = t; if (t - offSince >= disarmMs) until = -Infinity; }
      else offSince = null;
      return t < until;
    },
    noteClick(t) { if (refreshOnClick && t < until) until = t + armedMs; },
    // Fraction of the armed window left, for the cursor look.
    left(t = last) { return Math.max(0, Math.min(1, (until - t) / armedMs)); },
  };
}

exports.createArmingGate=createArmingGate;
exports.ARM_POSES=ARM_POSES;
},
24:(module,exports,require)=>{
// Hand geometry shared by the signal and interaction tiles (moved out of gestures.js so neither tile imports the
// engine that composes them). Pure functions of landmarks; gestures.js re-exports every name for its old API.
const clamp = n => Math.max(0, Math.min(1, n));
const valid = h => Array.isArray(h) && h.length === 21 && h.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
const trackable = h => Array.isArray(h) && h.length === 21 && [0, 5, 8].every(i => h[i] && Number.isFinite(h[i].x) && Number.isFinite(h[i].y));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const handSize = h => distance(h[0], h[5]);
const palmCentre = h => ({ x: [0, 5, 9, 13, 17].reduce((a, i) => a + h[i].x, 0) / 5, y: [0, 5, 9, 13, 17].reduce((a, i) => a + h[i].y, 0) / 5 });
// MediaPipe sometimes reports one hand twice (13% of frames in Tao's 2026-10-28 still clip). On those clips duplicates sit
// 0.07-0.29 hand sizes apart and real second hands about 1.9, so anything closer than 0.6 hand sizes is the same hand.
function dedupeHands(hands, limit = 0.6) {
  const kept = [];
  for (const h of hands) if (!kept.some(k => distance(palmCentre(k), palmCentre(h)) < limit * Math.max(handSize(k), 1e-6))) kept.push(h);
  return kept;
}
// The cursor point for dwell_cursor, in camera coordinates: `offset` hand sizes past the index tip, along knuckle -> tip.
// The panel preview draws the same ray, so what Tao sees is what drives the cursor.
function fingerRayPoint(hand, offset) {
  const dx = hand[8].x - hand[5].x, dy = hand[8].y - hand[5].y, len = Math.hypot(dx, dy);
  const reach = len > 1e-6 ? Math.max(0, Math.min(3, offset)) * handSize(hand) / len : 0;
  return { x: hand[8].x + dx * reach, y: hand[8].y + dy * reach };
}
// Index straight, and at least two of middle, ring and little finger curled toward the wrist. `reach` is how much
// farther from the wrist the index tip must be than its middle joint; the arming gate asks for 1.25 (see arming.js).
function isPointing(h, reach = 1.15) {
  if (!valid(h)) return false;
  const out = (tip, pip, k = 1.15) => distance(h[tip], h[0]) > distance(h[pip], h[0]) * k;
  const curled = [[12, 10], [16, 14], [20, 18]].filter(([tip, pip]) => !out(tip, pip)).length;
  return out(8, 6, reach) && curled >= 2;
}
const RAY_LANDMARKS = Object.freeze({ 5: [5], 9: [9], 8: [8], palm: [0, 5, 9, 13, 17] });
// The active area (Tao 19:18Z): a rectangle of the camera picture, in the same mirrored view the panel shows, that
// maps onto the whole screen. A number is the old symmetric margin; an object is { x, y, w, h } (or width, height).
function zoneRect(zone = 0.1) {
  if (typeof zone === 'number') { const z = Math.max(0, Math.min(0.35, zone)); return { x: z, y: z, w: 1 - 2 * z, h: 1 - 2 * z }; }
  const w = Math.max(0.05, Math.min(1, zone.w ?? zone.width ?? 0.8)), h = Math.max(0.05, Math.min(1, zone.h ?? zone.height ?? 0.8));
  const r = { x: Math.max(0, Math.min(1 - w, zone.x ?? (1 - w) / 2)), y: Math.max(0, Math.min(1 - h, zone.y ?? (1 - h) / 2)), w, h };
  // Trackpad zone rotation (Tao 2026-10-31 16:18Z): degrees clockwise as the panel shows the box, about its centre.
  const rotate = Number(zone.rotate) || 0;
  if (rotate) r.rotate = Math.max(-180, Math.min(180, rotate));
  return r;
}
// Rotation is applied in the picture's 0..1 coordinates, so on a 4:3 or 16:9 camera a turned box is slightly skewed.
const turn = (dx, dy, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return { x: dx * c - dy * s, y: dx * s + dy * c }; };
function mapPoint(p, zone = 0.1, mirrored = false) {
  const r = zoneRect(zone), x = (mirrored ? p.x : 1 - p.x);
  if (!r.rotate) return { x: clamp((x - r.x) / r.w), y: clamp((p.y - r.y) / r.h) };
  const d = turn(x - (r.x + r.w / 2), p.y - (r.y + r.h / 2), -r.rotate);
  return { x: clamp(d.x / r.w + 0.5), y: clamp(d.y / r.h + 0.5) };
}
// Screen point (0..1) back into the camera view, so the panel can draw the cursor on the hand.
function unmapPoint(p, zone = 0.1) {
  const r = zoneRect(zone);
  if (!r.rotate) return { x: r.x + p.x * r.w, y: r.y + p.y * r.h };
  const d = turn((p.x - 0.5) * r.w, (p.y - 0.5) * r.h, r.rotate);
  return { x: r.x + r.w / 2 + d.x, y: r.y + r.h / 2 + d.y };
}
function isOpenPalm(h) {
  return valid(h) && distance(h[4], h[8]) > 0.065 &&
    [[8, 6], [12, 10], [16, 14], [20, 18]].every(([tip, pip]) => distance(h[tip], h[0]) > distance(h[pip], h[0]) + 0.07);
}
// The same open palm in hand sizes (wrist to index knuckle), so a far or small hand can show it too. The image-unit
// version above needs about 0.07 of the frame and never passes for a hand far from the camera (golden 13: hand size
// 0.05). At the median desk hand (0.18) the two agree: 0.065 / 0.18 = 0.36 and 0.07 / 0.18 = 0.39 hand sizes.
function isOpenPalmScaled(h) {
  if (!valid(h)) return false;
  const s = handSize(h); if (!(s > 0)) return false;
  return distance(h[4], h[8]) > 0.36 * s && [[8, 6], [12, 10], [16, 14], [20, 18]].every(([tip, pip]) => distance(h[tip], h[0]) > distance(h[pip], h[0]) + 0.39 * s);
}
// All four fingers curled: every fingertip nearer the wrist than its middle joint.
function isFist(h) {
  return valid(h) && [[8, 6], [12, 10], [16, 14], [20, 18]].every(([tip, pip]) => distance(h[tip], h[0]) < distance(h[pip], h[0]));
}

exports.dedupeHands=dedupeHands;
exports.fingerRayPoint=fingerRayPoint;
exports.isPointing=isPointing;
exports.zoneRect=zoneRect;
exports.mapPoint=mapPoint;
exports.unmapPoint=unmapPoint;
exports.isOpenPalm=isOpenPalm;
exports.isOpenPalmScaled=isOpenPalmScaled;
exports.isFist=isFist;
exports.distance=distance;
exports.handSize=handSize;
exports.RAY_LANDMARKS=RAY_LANDMARKS;
},
25:(module,exports,require)=>{
// stabilizer@1 "still-lock": locks the cursor once the hand has been still (within `radius`) for `holdMs`, and lets
// go only when the point moves `releaseRadius` away from the lock; while moving it follows the filter exactly, so it
// adds no lag in motion. Radii are screen fractions.
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
module.exports.default={
  kind: 'stabilizer', id: 'still-lock', port: 'stabilizer@1', label: 'Lock when still',
  create({ radius = 0.008, holdMs = 150, releaseRadius = 0.02 } = {}) {
    let anchor = null, since = null, lock = null;
    return {
      update(p, t) {
        if (lock) { if (dist(p, lock) <= releaseRadius) return { ...lock }; lock = null; anchor = { ...p }; since = t; return { ...p }; }
        if (!anchor || dist(p, anchor) > radius) { anchor = { ...p }; since = t; return { ...p }; }
        if (t - since >= holdMs) { lock = { ...anchor }; return { ...lock }; }
        return { ...p };
      },
      reset() { anchor = null; since = null; lock = null; },
    };
  },
};


},
26:(module,exports,require)=>{
// stabilizer@1 "deadzone": a rubber-band dead zone (Tao 2026-10-31 17:15Z: hand tremor while holding still).
// The cursor stays put while the filtered point is within `radius` of it; past that it is pulled along, trailing by
// exactly `radius`, so there is never a jump. Radius is a screen fraction (0.006 is about 8 px on a 1280 px screen).
// Trade-off: every movement starts `radius` late, and the cursor ends `radius` short of where the hand stops.
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
module.exports.default={
  kind: 'stabilizer', id: 'deadzone', port: 'stabilizer@1', label: 'Dead zone (rubber band)',
  create({ radius = 0.006 } = {}) {
    let held = null;
    return {
      update(p) {
        if (!held) { held = { ...p }; return { ...held }; }
        const d = dist(p, held);
        if (d > radius) { const k = (d - radius) / d; held = { x: held.x + (p.x - held.x) * k, y: held.y + (p.y - held.y) * k }; }
        return { ...held };
      },
      reset() { held = null; },
    };
  },
};


},
27:(module,exports,require)=>{
// stabilizer@1 "none": the cursor as the filter gives it (the baseline every stabilizer is scored against).
module.exports.default={ kind: 'stabilizer', id: 'none', port: 'stabilizer@1', label: 'No dead zone', create: () => ({ update: p => p, reset() {} }) };


},
28:(module,exports,require)=>{
// predictor@1 "kalman": constant-velocity Kalman filter per landmark coordinate, process noise from an acceleration
// spectral density (per ms), so the same settings hold at 15 and 120 fps. Lead = filtered position + velocity x horizon.const { landmarkPredictor, capLead } = require(29);

const axis = (q, r) => {
  let x = null, v = 0, P = [[1, 0], [0, 1]];
  return (m, dt) => {
    if (x === null) { x = m; P = [[r, 0], [0, 1e-4]]; return [x, v]; }
    x += v * dt;
    const [[a, b], [, d]] = P, q11 = q * dt ** 3 / 3, q12 = q * dt ** 2 / 2, q22 = q * dt;
    P = [[a + 2 * dt * b + dt * dt * d + q11, b + dt * d + q12], [b + dt * d + q12, d + q22]];
    const S = P[0][0] + r, k0 = P[0][0] / S, k1 = P[1][0] / S, y = m - x;
    x += k0 * y; v += k1 * y;
    P = [[(1 - k0) * P[0][0], (1 - k0) * P[0][1]], [P[1][0] - k1 * P[0][0], P[1][1] - k1 * P[0][1]]];
    return [x, v];
  };
};
const point = o => {
  const q = o.accelNoise ?? 2e-8, r = o.measureNoise ?? 2e-5, maxLead = o.maxLead ?? 0.08;
  const ax = { x: axis(q, r), y: axis(q, r), z: axis(q, r) }; let last = null;
  return (p, t, H) => {
    const dt = last === null ? 33 : Math.max(1, t - last); last = t;
    const z = Number.isFinite(p.z) ? p.z : 0;
    const [x, vx] = ax.x(p.x, dt), [y, vy] = ax.y(p.y, dt), [zz, vz] = ax.z(z, dt);
    return capLead({ x, y }, { x: x + vx * H, y: y + vy * H, z: zz + vz * H }, maxLead);
  };
};
module.exports.default={ kind: 'predictor', id: 'kalman', port: 'predictor@1', label: 'Kalman: constant velocity', create: landmarkPredictor(point) };


},
29:(module,exports,require)=>{
// Shared shell for predictor@1 adapters (negative latency, charter chunk 4). A predictor moves every landmark of every
// hand forward by horizonMs, so the cursor and the pinch detector both see where the hand will be. Time is in ms from
// frame.t, never in frames, so a 15 fps and a 120 fps camera feed the same model (Tao 16:05Z). A hand slot restarts
// when the hand count or its left/right label changes. z is predicted like x and y.
function landmarkPredictor(makePoint) {
  return (options = {}) => {
    const horizonMs = options.horizonMs ?? 0;
    let slots = [], key = null, lastId = null, lastOut = null;
    const reset = () => { slots = []; key = null; lastId = null; lastOut = null; };
    function update(frame) {
      const hands = frame?.hands;
      if (!Array.isArray(hands) || !hands.length) { if (hands && !hands.length) { slots = []; key = null; } return frame; }
      const id = frame.signalId ?? frame.signalT ?? frame.t;
      if (id === lastId && lastOut) return { ...frame, hands: lastOut };
      const k = hands.length + ':' + (frame.handedness || []).join();
      if (k !== key) { slots = []; key = k; }
      const t = frame.signalT ?? frame.t;
      const out = hands.map((hand, h) => {
        slots[h] ??= hand.map(() => makePoint(options));
        return hand.map((p, i) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { ...p, ...slots[h][i](p, t, horizonMs) } : p));
      });
      lastId = id; lastOut = out;
      return { ...frame, hands: out };
    }
    return { update, reset };
  };
}
// Lead is capped so a wrong guess can never throw the cursor across the screen (normalized units, same as DESP).
const capLead = (p, q, maxLead) => {
  const dx = q.x - p.x, dy = q.y - p.y, n = Math.hypot(dx, dy);
  return n > maxLead ? { x: p.x + dx * maxLead / n, y: p.y + dy * maxLead / n, z: q.z } : q;
};

exports.landmarkPredictor=landmarkPredictor;
exports.capLead=capLead;
},
30:(module,exports,require)=>{
// predictor@1 "physics": a point mass per landmark (alpha-beta-gamma tracker: position, velocity, acceleration). Gains are
// the fading-memory set for one time constant memoryMs (theta = exp(-gap / memoryMs)), which is stable at any frame gap,
// so 15 and 120 fps behave alike. The lead is the distance the mass covers in horizonMs.
// A hand that is slowing (acceleration against velocity) brakes: the lead stops where the mass would stop. Acceleration
// along the motion is never extrapolated, so a speeding hand is not overshot. Lead is capped at maxLead.const { landmarkPredictor, capLead } = require(29);

const point = o => {
  const memoryMs = o.memoryMs ?? 60, maxLead = o.maxLead ?? 0.08;
  let s = null, last = null;
  return (p, t, H) => {
    const z = Number.isFinite(p.z) ? p.z : 0, m = { x: p.x, y: p.y, z };
    if (!s) { s = { x: { p: p.x, v: 0, a: 0 }, y: { p: p.y, v: 0, a: 0 }, z: { p: z, v: 0, a: 0 } }; last = t; return m; }
    const dt = Math.max(1, t - last); last = t;
    const th = Math.exp(-dt / memoryMs), ka = 1 - th ** 3, kb = 1.5 * (1 - th * th) * (1 - th) / dt, kg = 2 * 0.5 * (1 - th) ** 3 / (dt * dt);
    for (const c of ['x', 'y', 'z']) {
      const st = s[c], pp = st.p + st.v * dt + 0.5 * st.a * dt * dt, pv = st.v + st.a * dt, r = m[c] - pp;
      st.p = pp + ka * r; st.v = pv + kb * r; st.a += kg * r;
    }
    const sp = Math.hypot(s.x.v, s.y.v), along = sp > 1e-12 ? (s.x.a * s.x.v + s.y.a * s.y.v) / sp : 0;
    const brake = along < 0 ? -along : 0, tau = brake > 0 ? Math.min(H, sp / brake) : H;
    const go = c => s[c].p + s[c].v * tau - (brake > 0 && sp > 0 ? 0.5 * brake * tau * tau * s[c].v / sp : 0);
    return capLead({ x: s.x.p, y: s.y.p }, { x: go('x'), y: go('y'), z: s.z.p + s.z.v * tau }, maxLead);
  };
};
module.exports.default={ kind: 'predictor', id: 'physics', port: 'predictor@1', label: 'Physics: point mass that brakes when the hand slows', create: landmarkPredictor(point) };


},
31:(module,exports,require)=>{
// predictor@1 "desp": double exponential smoothing prediction per landmark (the earlier cursor champion, now on every
// landmark). Reuses the DESP stage in core/signal/desp.js unchanged for x and y; z follows the same lead ratio.const { create: createDesp } = require(6);const { landmarkPredictor } = require(29);

const point = o => {
  const d = createDesp({ alpha: o.alpha ?? 0.5, predict_ms: o.horizonMs ?? 0, brake: o.brake !== false, max_lead: o.maxLead ?? 0.08 });
  let lastZ = null, lastT = null, vz = 0;
  return (p, t) => {
    const s = d.update({ t, point: { x: p.x, y: p.y } });
    const z = Number.isFinite(p.z) ? p.z : 0;
    if (lastT !== null && t > lastT) vz += 0.5 * ((z - lastZ) / (t - lastT) - vz);
    lastZ = z; lastT = t;
    return { x: s.x, y: s.y, z: z + vz * (o.horizonMs ?? 0) };
  };
};
module.exports.default={ kind: 'predictor', id: 'desp', port: 'predictor@1', label: 'DESP: double exponential smoothing lead', create: landmarkPredictor(point) };


},
32:(module,exports,require)=>{
// predictor@1 "none": no prediction (the baseline every other predictor is scored against).
module.exports.default={ kind: 'predictor', id: 'none', port: 'predictor@1', label: 'No prediction', create: () => ({ update: f => f, reset() {} }) };


},
33:(module,exports,require)=>{
// injector@1 "recording": a dry run. It keeps every Pointer ABI event it is given and sends no input to the page, so a
// preset can be tried on a live tab (or in a test) without clicking anything. log holds the events, newest last.
const recorder = () => {
  const log = []; let pressed = false;
  return { log, dispatch(event) { if (event?.type === 'pointerdown') pressed = true; if (event?.type === 'pointerup' || event?.type === 'pointercancel') pressed = false; log.push(event); return []; },
    release() { pressed = false; return []; }, abandon() { pressed = false; }, configure() {}, get pressed() { return pressed; } };
};
module.exports.default={ kind: 'injector', id: 'recording', port: 'injector@1', label: 'Recording (dry run: sends no input)',
  createMouse: recorder, createTouch: recorder };


},
34:(module,exports,require)=>{
// injector@1 "cdp": the Chrome DevTools Protocol mouse and touch dispatchers (the extension's real input path).const { createCDPDispatcher } = require(36);const { createTouchDispatch } = require(35);
module.exports.default={ kind: 'injector', id: 'cdp', port: 'injector@1', label: 'Chrome DevTools input (mouse, or touch for two hands)',
  createMouse: options => createCDPDispatcher(options), createTouch: () => createTouchDispatch() };


},
35:(module,exports,require)=>{
// Map the two-pointer ABI to Chrome DevTools Protocol touch commands. State is
// local to this adapter so every command contains the complete contact set.const { createCDPDispatcher } = require(36);

const TYPES = new Set(['pointerdown', 'pointermove', 'pointerup', 'pointercancel']);
const validViewport = viewport => Number.isFinite(viewport?.width) && viewport.width >= 1
  && Number.isFinite(viewport?.height) && viewport.height >= 1;

function createTouchDispatch() {
  const contacts = new Map();

  function dispatch(event, viewport) {
    if (!event || !TYPES.has(event.type) || !validViewport(viewport)) return [];
    if ((event.pointerId !== 0 && event.pointerId !== 1)
      || !Number.isFinite(event.x) || !Number.isFinite(event.y)
      || event.x < 0 || event.x > 1 || event.y < 0 || event.y > 1) return [];

    const pressed = contacts.has(event.pointerId);
    if (event.type === 'pointerdown' && pressed) return [];
    if (event.type !== 'pointerdown' && !pressed) return [];

    const point = {
      id: event.pointerId,
      x: event.x * Math.max(1, viewport.width - 1),
      y: event.y * Math.max(1, viewport.height - 1),
    };
    let type;
    if (event.type === 'pointerdown') {
      contacts.set(event.pointerId, point);
      type = 'touchStart';
    } else if (event.type === 'pointermove') {
      contacts.set(event.pointerId, point);
      type = 'touchMove';
    } else {
      contacts.delete(event.pointerId);
      type = event.type === 'pointerup' ? 'touchEnd' : 'touchCancel';
      if (type === 'touchCancel') {
        // CDP rejects a touchCancel that names contacts. Chromium's empty
        // cancel ends every contact. With survivors, end only the lost contact by name.
        if (contacts.size) return [{ method: 'Input.dispatchTouchEvent', params: { type: 'touchEnd', touchPoints: [point] } }];
        return [{ method: 'Input.dispatchTouchEvent', params: { type, touchPoints: [] } }];
      }
      // Chromium (checked with tools/touch-canary.mjs) lifts the contacts NAMED in a touchEnd or touchCancel. Sending the
      // surviving contacts instead lifted the wrong finger and left the lifted one down.
      return [{ method: 'Input.dispatchTouchEvent', params: { type, touchPoints: [point] } }];
    }

    return [{
      method: 'Input.dispatchTouchEvent',
      params: { type, touchPoints: [...contacts.values()].sort((a, b) => a.id - b.id) },
    }];
  }

  // Lifts every finger at once (hand loss, Stop, tab change): one touchCancel with no contacts left.
  function release() {
    if (!contacts.size) return [];
    contacts.clear();
    return [{ method: 'Input.dispatchTouchEvent', params: { type: 'touchCancel', touchPoints: [] } }];
  }

  return { dispatch, release, get pressed() { return contacts.size > 0; } };
}

// Policy boundary: a single cursor retains the established mouse adapter;
// simultaneous cursors select the multi-contact touch adapter.
function chooseDispatch(cursorCount) {
  return cursorCount >= 2 ? createTouchDispatch() : createCDPDispatcher();
}

exports.createTouchDispatch=createTouchDispatch;
exports.chooseDispatch=chooseDispatch;
},
36:(module,exports,require)=>{
// UTC: 2026-10-27. Adapted from factory/core/pointer/dispatch.js:
// preserve normalized coordinate clamping and button lifecycle; replace DOM
// dispatch with CDP Input.dispatchMouseEvent. No page script or content access.const { clamp01, toViewportPixels } = require(37);
exports.toViewportPixels=toViewportPixels; // kept for existing importers; new code imports it from ./viewport.js

function createCDPDispatcher(options = {}) {
  let pressed = false;
  let pressedButton = 'left', pressedCount = 1;
  let lastPress = null;
  let multiClickMs = options.multiClickMs ?? 500, multiClickPx = options.multiClickPx ?? 8, multiClickGapMs = options.multiClickGapMs ?? 0;
  let point = { x: 0.5, y: 0.5 };
  let lastGood = null;
  const usable = v => Number.isFinite(v?.width) && v.width >= 1 && Number.isFinite(v?.height) && v.height >= 1;
  function dispatch(event, viewport) {
    // A collapsed viewport sends nothing, except that a held button is still released at the last usable size.
    if (!usable(viewport)) {
      const releasing = pressed && lastGood && (event?.type === 'pointerup' || event?.type === 'pointercancel');
      if (!releasing) return [];
      viewport = lastGood;
    }
    lastGood = { width: viewport.width, height: viewport.height };
    if (!event || !['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'wheel'].includes(event.type)) return [];
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return [];
    point = { x: clamp01(event.x), y: clamp01(event.y) };
    const p = {
      ...toViewportPixels(point, viewport),
      pointerType: 'mouse', buttons: pressed ? ({ left: 1, right: 2, middle: 4 }[pressedButton] ?? 1) : 0,
    };
    if (event.type === 'pointerdown') {
      if (pressed) return [];
      const button = ['left', 'right', 'middle'].includes(event.button) ? event.button : 'left';
      const at = Number.isFinite(event.t) ? event.t : Date.now();
      // Two repeat rules. Mouse (default): the next press within multiClickMs of the last PRESS, as desktop systems do.
      // Pinch (multiClickGapMs > 0, CURSOR-REAL-1): the next press within multiClickGapMs of the last RELEASE. A pinch is
      // held 300 ms or more before hysteresis lets it open, so a press-to-press window never fits a double pinch, while
      // a wide one turns separate taps (clip 05: 333-400 ms apart) into doubles. Chromium's own double tap uses a
      // release-to-press window of about 300 ms (tools/touch-tap-limits.mjs).
      const since = multiClickGapMs > 0 ? (lastPress?.upAt ?? Infinity) : lastPress?.t;
      const limit = multiClickGapMs > 0 ? multiClickGapMs : multiClickMs;
      const close = lastPress && limit > 0 && at - since <= limit &&
        Math.hypot(p.x - lastPress.x, p.y - lastPress.y) <= multiClickPx && button === lastPress.button;
      pressedCount = close ? Math.min(3, lastPress.count + 1) : 1;
      lastPress = { t: at, x: p.x, y: p.y, button, count: pressedCount };
      pressedButton = button;
      pressed = true;
      return [{ method: 'Input.dispatchMouseEvent', params: { ...p, type: 'mousePressed', button, buttons: { left: 1, right: 2, middle: 4 }[button], clickCount: pressedCount } }];
    }
    if (event.type === 'pointerup' || event.type === 'pointercancel') {
      if (!pressed) return [];
      pressed = false;
      if (lastPress) lastPress.upAt = Number.isFinite(event.t) ? event.t : Date.now();
      // CDP has no mouse-cancel command. mouseReleased synthesizes pointerup
      // and may click, while a zero-button move clears Chrome's held state
      // without presenting a successful release to the page.
      if (event.type === 'pointercancel') return [{ method: 'Input.dispatchMouseEvent', params: {
        ...p, type: 'mouseMoved', button: 'none', buttons: 0,
      } }];
      return [{ method: 'Input.dispatchMouseEvent', params: { ...p, type: 'mouseReleased', button: pressedButton, buttons: 0, clickCount: pressedCount } }];
    }
    if (event.type === 'wheel') {
      if (!Number.isFinite(event.deltaY)) return [];
      return [{ method: 'Input.dispatchMouseEvent', params: { ...p, type: 'mouseWheel', modifiers: event.ctrlKey ? 2 : 0,
        deltaX: Math.max(-120, Math.min(120, Number(event.deltaX) || 0)), deltaY: Math.max(-120, Math.min(120, event.deltaY)) } }];
    }
    return [{ method: 'Input.dispatchMouseEvent', params: { ...p, type: 'mouseMoved', button: pressed ? 'left' : 'none' } }];
  }
  // Administrative teardown (Stop, tab change) must physically release CDP's
  // button. Gesture cancellation uses the non-clicking path above instead.
  function release(viewport) { return dispatch({ type: 'pointerup', ...point }, viewport); }
  // Forget a held button when Chrome has already changed or detached the
  // document. Sending mouseReleased at that point could click the new page.
  function abandon() { pressed = false; pressedButton = 'left'; pressedCount = 1; }
  function configure(next = {}) {
    multiClickMs = next.multiClickMs ?? multiClickMs;
    multiClickPx = next.multiClickPx ?? multiClickPx;
    multiClickGapMs = next.multiClickGapMs ?? multiClickGapMs;
  }
  return { dispatch, release, abandon, configure, get pressed() { return pressed; } };
}

exports.createCDPDispatcher=createCDPDispatcher;
},
37:(module,exports,require)=>{
// UTC: 2026-11-01. Viewport geometry shared by every injector and by the session. It holds no injector code, so a
// session that swaps output.type to a non-CDP injector loads no CDP module (hex audit O4).
const clamp01 = n => Math.max(0, Math.min(1, Number(n) || 0));

/** Normalized point -> the CSS pixel the pointer is injected at. The on-page cursor is drawn at this same pixel. */
function toViewportPixels(point, viewport) {
  return { x: clamp01(point.x) * Math.max(1, viewport.width - 1), y: clamp01(point.y) * Math.max(1, viewport.height - 1) };
}

exports.toViewportPixels=toViewportPixels;
exports.clamp01=clamp01;
},
38:(module,exports,require)=>{
// pinch@1 "sphere": Tao's contact model (2026-10-31 14:56Z). A sphere sits on each landmark, larger than the tracked dot
// because a fingertip is wider than its landmark; radius is in hand sizes (wrist 0 to index knuckle 5, with z).
// A new press is a contact between the thumb-tip sphere and a target sphere that also passes the physics checks:
//   rejectTargets: the thumb also touching these spheres (middle finger 10-12) means a curled hand, not a pinch;
//   impactMs: contact must come within this long of the gap last being open (openGap);
//   holdMs: contact held this long; ttiMs: optional time-to-impact lookahead (off: it fired on closings that never
//   finished on the goldens). The finger gate (pinch.layers.fingerGate) still applies, to the fingers that are not targets.
// targets is any JSON list of fingertips (Tao 20:10Z: index 8, middle 12, ring 16, pinky 20). match 'any' (default):
// the thumb touching any one is a press; 'all': a chord, the thumb must touch every target at once.
// Releases use the gap adapter's hysteresis and release grace, so a held drag behaves exactly like "gap".
// Bench (posepointer-ship/pinch-2026-10-31/sphere-bench.txt, S9): tuning 1-2, held-out 1 false presses at 15-120 fps.const { createGapPinch } = require(20);

const z = q => (Number.isFinite(q.z) ? q.z : 0);
const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, z(a) - z(b));
const ok = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);

function createSphereContact(o) {
  const S = { radius: { default: 0.125 }, targets: [8], match: 'any', rejectTargets: [], openGap: 0.15, impactMs: 0, holdMs: 0, ttiMs: 0, ...(o.sphere || {}) };
  // Finger gate: the other fingers must be straight (a curled hand is not a pinch). Tip/knuckle pairs not used as targets.
  const gateFingers = [[8, 5], [12, 9], [16, 13], [20, 17]].filter(([tip]) => !S.targets.includes(tip));
  const pick = S.match === 'all' ? Math.max : Math.min;
  let g0 = null, t0 = null, v = 0, openAt = -Infinity, armed = false, contactSince = null;
  function update(hand, thumb, t) {
    // A frame with bad geometry is no contact, so it also ends any hold in progress (second-family review 17:32Z).
    const reject = () => { contactSince = null; return false; };
    if (!ok(thumb) || !ok(hand[0]) || !ok(hand[5]) || !S.targets.every(i => ok(hand[i]))) return reject();
    const scale = D(hand[0], hand[5]); if (!(scale > 0)) return reject();
    if (o.pinchFingerGate > 0 && ![0, ...gateFingers.flat()].every(i => ok(hand[i]))) return reject();
    const r = i => (S.radius[i] ?? S.radius.default) * scale, gapTo = i => D(thumb, hand[i]) - r(4) - r(i);
    const g = pick(...S.targets.map(gapTo)) / scale;
    if (g0 !== null && t > t0) v += 0.5 * ((g - g0) / (t - t0) - v);
    g0 = g; t0 = t; if (g > S.openGap) { openAt = t; armed = true; }
    const tti = v < 0 ? g / -v : Infinity;
    let contact = g <= 0 || (S.ttiMs > 0 && tti <= S.ttiMs && g < S.openGap);
    if (contact && S.rejectTargets.some(i => ok(hand[i]) && gapTo(i) <= 0)) contact = false;
    if (contact && S.impactMs > 0 && t - openAt > S.impactMs) contact = false;
    if (contact && o.requireOpen && !armed) contact = false;
    // The finger gate runs before the hold, so a frame that fails it is no contact and restarts the hold (review 17:51Z).
    if (contact && o.pinchFingerGate > 0 && gateFingers.length) {
      const w = hand[0], rr = (tip, knuckle) => Math.hypot(hand[tip].x - w.x, hand[tip].y - w.y) / Math.hypot(hand[knuckle].x - w.x, hand[knuckle].y - w.y);
      if (gateFingers.reduce((a, [tip, k]) => a + rr(tip, k), 0) / gateFingers.length < o.pinchFingerGate) contact = false;
    }
    contactSince = contact ? (contactSince ?? t) : null;
    if (contact && S.holdMs > 0 && t - contactSince < S.holdMs) contact = false;
    if (contact) armed = false;
    return contact;
  }
  function reset() { g0 = null; t0 = null; v = 0; openAt = -Infinity; armed = false; contactSince = null; }
  return { update, reset };
}

module.exports.default={ kind: 'pinch', id: 'sphere', port: 'pinch@1', label: 'Sphere contact: fingertip spheres with physics checks (Tao)',
  configure: o => o, create: o => createGapPinch({ ...o, contact: createSphereContact(o) }) };

exports.createSphereContact=createSphereContact;
},
39:(module,exports,require)=>{
// pinch@1 "gap": the thumb-to-finger gap detector with hysteresis and the PINCH-SHAPE-1 layers (the shipped behaviour).const { createGapPinch } = require(20);
module.exports.default={ kind: 'pinch', id: 'gap', port: 'pinch@1', label: 'Gap: thumb-to-finger distance with hysteresis', create: createGapPinch };


},
40:(module,exports,require)=>{
module.exports.default={
  kind: 'refinery', id: 'raw', port: 'refinery@1', label: 'Raw landmark passthrough',
  create: () => ({ update: frame => frame, reset() {} }),
};


},
41:(module,exports,require)=>{
const { createOneEuro2D } = require(8);

// One filter per landmark: hands and body pose cross the same guarded seam.
module.exports.default={
  kind: 'refinery', id: 'oneEuro', port: 'refinery@1', label: 'One Euro landmark refinery',
  create(stage = {}) {
    const banks = new Map();
    const refine = (points, key, t) => Array.isArray(points) ? points.map((point, i) => {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      const id = `${key}:${i}`;
      if (!banks.has(id)) banks.set(id, createOneEuro2D(stage));
      return { ...point, ...banks.get(id).filter(point, t) };
    }).filter(Boolean) : [];
    return {
      update(frame = {}) {
        const t = Number.isFinite(frame.t) ? frame.t : 0;
        return { ...frame, t, hands: (frame.hands ?? []).map((h, i) => refine(h, `hand:${i}`, t)),
          pose: frame.pose ? refine(frame.pose, 'pose', t) : frame.pose, refined: true };
      },
      reset() { for (const filter of banks.values()) filter.reset(); banks.clear(); },
    };
  },
};


},
42:(module,exports,require)=>{
const { createPlacement } = require(43);
module.exports.default=createPlacement('video', 'position:absolute;inset:0;width:100%;height:100%');


},
43:(module,exports,require)=>{
function createPlacement(type, style) {
  return { kind: 'compositor', id: type, port: 'compositor@1', label: `${type} canvas`, create({ document, host, video, videoOpacity = 1 }) {
    const canvas = document.createElement('canvas');
    canvas.dataset.touchlessScene = type;
    canvas.style.cssText = `pointer-events:none;${style}`;
    if (video) video.style.opacity = String(videoOpacity);
    host.append(canvas);
    return { canvas, resize(w, h, dpr = 1) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; canvas.width = w * dpr; canvas.height = h * dpr; }, remove() { canvas.remove(); } };
  } };
}

exports.createPlacement=createPlacement;
},
44:(module,exports,require)=>{
const { createPlacement } = require(43);
module.exports.default=createPlacement('pip', 'position:absolute;right:16px;bottom:16px;width:260px;aspect-ratio:4/3');


},
45:(module,exports,require)=>{
const { createPlacement } = require(43);
// The panel's preview of the on-page view. Like every panel placement, the canvas sits inside the preview host, in the
// same coordinates the scene draws in; drawing on the target website itself is the session's page layer
// (core/session.js drawLayer). It was position:fixed at the panel corner, which shifted the skin off the hand by the
// preview's offset and let it float over the panel menu (VISUAL-SYNC-1, Tao 2026-10-29 15:44Z).
module.exports.default=createPlacement('page', 'position:absolute;inset:0;width:100%;height:100%');


},
46:(module,exports,require)=>{
const { distance, plugin, rayVector } = require(47);
module.exports.default=plugin('wristRay', 'Wrist through index knuckle', (a, { num }) => ({ reach: num(a.reach ?? 1, 0.3, 3, 'anchor.reach') }),
  (hand, zone, o) => { const wrist = hand[0], knuckle = hand[5], vector = rayVector(wrist, knuckle); if (!vector) return null; const span = Math.max(vector.length, distance(knuckle, hand[17])); const gain = o.reach * span / vector.length; return { x: knuckle.x + vector.dx * gain, y: knuckle.y + vector.dy * gain }; });


},
47:(module,exports,require)=>{
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rayVector = (from, to) => {
  if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) return null;
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  return length > 1e-6 ? { dx, dy, length } : null;
};
const zoneRect = z => typeof z === 'number' ? { x: z, y: z, w: 1 - 2 * z, h: 1 - 2 * z } : z;
const plugin = (id, label, configure, aim) => ({
  kind: 'anchor', id, label, port: 'anchor@1', configure,
  create(options) { return { aim: (hand, zone) => aim(hand, zone, options) }; },
});

exports.distance=distance;
exports.rayVector=rayVector;
exports.zoneRect=zoneRect;
exports.plugin=plugin;
},
48:(module,exports,require)=>{
const { plugin, distance } = require(47);
module.exports.default=plugin('fingerRay', 'Finger ray', (a, { num }) => ({ aim: 'fingerRay', fingerOffset: num(a.offsetInches ?? 2, 0, 10, 'anchor.offsetInches') / 3.5 }),
  (hand, zone, o) => { const a = hand[5], b = hand[8], len = distance(a, b), gain = len > 1e-6 ? o.fingerOffset * distance(hand[0], hand[5]) / len : 0; return { x: b.x + (b.x - a.x) * gain, y: b.y + (b.y - a.y) * gain }; });


},
49:(module,exports,require)=>{
const { plugin, zoneRect } = require(47);
module.exports.default=plugin('fixedRay', 'Fixed ray', (a, { num }) => {
  const [x, y] = Array.isArray(a.direction) ? a.direction : [0, -1];
  return { aim: 'fixedRay', rayLandmark: num(a.landmark ?? 5, 0, 20, 'anchor.landmark'), fixedDir: { x: num(x, -1, 1, 'anchor.direction[0]'), y: num(y, -1, 1, 'anchor.direction[1]') }, rayReach: num(a.reach ?? 0.05, 0, 0.5, 'anchor.reach') };
}, (hand, zone, o) => {
  const at = hand[o.rayLandmark] || hand[5], n = Math.hypot(o.fixedDir.x, o.fixedDir.y) || 1, r = zoneRect(zone);
  return { x: at.x + o.fixedDir.x / n * o.rayReach * r.w, y: at.y + o.fixedDir.y / n * o.rayReach * r.h };
});


},
50:(module,exports,require)=>{
const { distance, plugin, rayVector } = require(47);
const ray = plugin('ray', 'Landmark ray', (a, { num }) => {
  const src = num(a.from ?? 0, 0, 20, 'anchor.from'), to = num(a.to ?? 5, 0, 20, 'anchor.to');
  if (src === to) throw new Error('anchor.from and anchor.to must be different landmarks');
  return { aim: 'landmarkRay', rayFrom: src, rayLandmark: to, rayLength: num(a.length ?? 0.5, 0, 3, 'anchor.length') };
}, (hand, zone, o) => {
  const from = hand[o.rayFrom] || hand[0], to = hand[o.rayLandmark] || hand[5], vector = rayVector(from, to);
  if (!vector) return null;
  const gain = o.rayLength * distance(hand[0], hand[5]) / vector.length;
  return { x: to.x + vector.dx * gain, y: to.y + vector.dy * gain };
});
module.exports.default=ray;


},
51:(module,exports,require)=>{
const { plugin } = require(47);
module.exports.default=plugin('landmark', 'Landmark', (a, { num }) => ({ aim: 'landmark', rayLandmark: num(a.landmark ?? 8, 0, 20, 'anchor.landmark') }),
  (hand, zone, o) => hand[o.rayLandmark] || hand[5]);


},
52:(module,exports,require)=>{
// Spotlight cursor look (visualization@1) for brand showcases: a soft glowing dot whose core fills amber as the dwell
// runs and turns solid when pressed. Select it in presets.json: "overlay": { "cursor": "spotlight" }.
// The draw function is serialized into the page: it must use only its arguments (no imports, no closures).
module.exports.default={
  kind: 'cursor', id: 'spotlight', port: 'visualization@1', label: 'Spotlight (glowing dot)',
  draw(ctx, x, y, s) {
    ctx.globalAlpha = (s.alpha ?? 1) * (s.holding ? 0.55 : 1) * (s.armed === false ? 0.5 : 1);
    const r = s.primary ? 16 : 9, glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
    glow.addColorStop(0, 'rgba(255,255,255,0.85)'); glow.addColorStop(0.35, 'rgba(120,200,255,0.45)'); glow.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 2, 0, 6.2832); ctx.fill();
    const fill = s.pressed ? 1 : Math.max(0, Math.min(1, s.progress || 0));
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, 6.2832); ctx.fill();
    if (fill > 0) { ctx.fillStyle = '#ff9f2e'; ctx.beginPath(); ctx.arc(x, y, r * 0.35 + r * 0.45 * fill, 0, 6.2832); ctx.fill(); }
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 1;
  },
};


},
53:(module,exports,require)=>{
// Two-hand pinch-pull. The per-hand machines retain ownership of their pointer ids;
// this small coordinator only describes the compound gesture. Consumers may use
// the two pointer streams directly, or the ctrl-wheel event as a zoom fallback.
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function createPinchPull({ wheelScale = 1000, minHoldMs = 1500 } = {}) {
  let previous = null, heldSince = null, active = false;
  return {
    update(cursors, t = 0) {
      const held = cursors.filter(cursor => cursor.state?.pressed).sort((a, b) => a.pointerId - b.pointerId);
      const moves = cursors.filter(cursor => cursor.pointerId >= 0).map(cursor =>
        ({ type: 'pointermove', ...cursor.point, t, pointerId: cursor.pointerId }));
      if (held.length !== 2) {
        const releases = active ? cursors.filter(cursor => cursor.pointerId >= 0).map(cursor =>
          ({ type: 'pointerup', ...cursor.point, t, pointerId: cursor.pointerId })) : [];
        previous = null; heldSince = null; active = false;
        // Keep the page cursor attached while two visible hands are deciding
        // whether to pinch. The coordinator owns their streams to prevent
        // accidental clicks, so dropping these moves caused a visible freeze.
        return cursors.length >= 2 ? [...moves, ...releases] : releases;
      }
      const a = held[0].point, b = held[1].point;
      const sample = { distance: distance(a, b), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      heldSince ??= t;
      if (!active && t - heldSince < minHoldMs) { previous = sample; return moves; }
      const starts = !active ? held.map(cursor => ({ type: 'pointerdown', ...cursor.point, t, pointerId: cursor.pointerId })) : [];
      active = true;
      if (!previous) { previous = sample; return [...moves, ...starts]; }
      const event = { type: 'wheel', x: sample.x, y: sample.y, t,
        deltaX: -(sample.x - previous.x) * wheelScale,
        deltaY: -(sample.distance - previous.distance) * wheelScale,
        distanceChange: sample.distance - previous.distance,
        ctrlKey: true, pointers: held.map(cursor => cursor.pointerId) };
      previous = sample;
      return [...moves, ...starts, event];
    },
    reset() { previous = null; }
  };
}

module.exports.default={
  kind: 'interaction', id: 'pinch_pull', port: 'interaction@1', label: 'Two-hand pinch-pull: stretch to zoom, midpoint to pan',
  configure(c, { num }) {
    const p = c.pinch || {};
    const pinchOn = num(p.closeAt ?? .25, .05, 1, 'pinch.closeAt');
    const pinchOff = num(p.openAt ?? .6, .05, 1.5, 'pinch.openAt');
    if (pinchOff <= pinchOn) throw new Error('pinch.openAt must be larger than pinch.closeAt (hysteresis)');
    return { pinchClick: true, dwell: false, requirePoint: false, clickFinger: p.finger ?? 'middle',
      pinMs: num(p.pinMs ?? 200, 0, 1000, 'pinch.pinMs'), pinchReleaseMs: num(p.releaseMs ?? 0, 0, 500, 'pinch.releaseMs'),
      pinchSnapOpen: num(p.snapOpen ?? 2, .05, 2, 'pinch.snapOpen'), pinchScale: p.handScaled !== false,
      pinchOn, pinchOff, pinchRequireOpen: p.requireOpen !== false,
      twoHandWheelScale: num(c.pinchPull?.wheelScale ?? 1000, 100, 4000, 'pinchPull.wheelScale'),
      twoHandMinHoldMs: num(c.pinchPull?.minHoldMs ?? 1500, 0, 3000, 'pinchPull.minHoldMs') };
  },
  // The ordinary interaction machine supplies each independent cursor.
  create() { throw new Error('pinch_pull is a coordinated interaction'); },
  createMulti(options) { return createPinchPull({ wheelScale: options.twoHandWheelScale, minHoldMs: options.twoHandMinHoldMs }); }
};

exports.createPinchPull=createPinchPull;
},
54:(module,exports,require)=>{
// Dwell-drag interaction (interaction@1): hold still to grab, move to drag, hold still again to drop. Covers sliders,
// drawing and moving things with no pinch (gap: "dwell cannot drag"). After a grab the hand must move off the spot
// before a second hold can drop, so a hand that stays still keeps holding. Honors the "arming" stage like the core tile.
// Select it in presets.json: "interaction": "dwell_drag", with "dwell": { "ms", "radius" }.const { createSignalTile } = require(55);const { createArmingGate } = require(23);

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

module.exports.default={
  kind: 'interaction', id: 'dwell_drag', port: 'interaction@1', label: 'Dwell drag: hold still to grab, hold still again to drop',
  configure(c, { num }) {
    const d = c.dwell || {};
    return { pinchClick: false, dwell: true, requirePoint: false, dwellMs: num(d.ms ?? 800, 200, 3000, 'dwell.ms'),
      dwellRadius: num(d.radius ?? 0.035, 0.005, 0.2, 'dwell.radius') };
  },
  create(o, signal = createSignalTile(o)) {
    const gate = createArmingGate(o.arming ?? null);
    let pressed = false, anchor = null, since = null, latched = false;
    let cancelPress = false;
    function update(frame = {}) {
      let armed = true;
      const s = signal.update(frame, { beforeMotion(pre) { armed = gate.update(pre.t, pre.hand); return { paused: false, pinching: false }; } });
      const { t, hasHand, holding, point, lastSeen, coastMs } = s;
      const events = [...s.events];
      if (cancelPress) { cancelPress = false; if (pressed) events.push({ type: 'pointercancel', reason: 'zone', ...point, t }); pressed = false; }
      let holdProgress = 0;
      if (!hasHand && !holding) {
        if (pressed) events.push({ type: 'pointerup', ...point, t });
        pressed = false; anchor = null; latched = false;
      } else if (hasHand) {
        if (!anchor || distance(point, anchor) > o.dwellRadius) { anchor = { ...point }; since = t; latched = false; }
        if (!latched && (armed || pressed)) {
          holdProgress = Math.min(1, Math.max(0, (t - since) / o.dwellMs));
          if (t - since >= o.dwellMs) {
            events.push({ type: pressed ? 'pointerup' : 'pointerdown', ...point, t });
            pressed = !pressed; latched = true; gate.noteClick(t);
          }
        }
      }
      const missingMs = hasHand ? 0 : lastSeen === null ? Infinity : t - lastSeen;
      const opacity = missingMs <= Math.max(300, coastMs) ? 1 : Math.max(0, 1 - (missingMs - Math.max(300, coastMs)) / 400);
      return { events, point: { ...point }, raw: s.raw, aim: s.aim, hands: s.hands, hasHand, holding, pressed, paused: false, zooming: false,
        opacity, missingMs, holdProgress, armed };
    }
    // Screen points stored for the dwell belong to the old area: clear them and cancel a drag in progress.
    function setZone(zone) {
      const changed = signal.setZone(zone);
      if (changed === false) return false;
      anchor = null; since = null; latched = false;
      if (pressed) cancelPress = true;
      return true;
    }
    return { update, setZone };
  },
};


},
55:(module,exports,require)=>{
const { createPosePointer, POSE_POINTER_PRESET } = require(56);const { create: createDesp } = require(6);const { dedupeHands, fingerRayPoint, mapPoint, unmapPoint, RAY_LANDMARKS, zoneRect } = require(24);

const clamp = n => Math.max(0, Math.min(1, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const trackable = h => Array.isArray(h) && h.length === 21 && [0, 5, 8].every(i => h[i] && Number.isFinite(h[i].x) && Number.isFinite(h[i].y));
const handSize = h => distance(h[0], h[5]);

/** Stage 2: landmark frames to guarded, mapped and smoothed cursor signal. */
function createSignalTile(options = {}) {
  const o = { zone: 0.1, maxSpeed: 2, predictionMs: 20, aim: 'knuckle', rayGain: 2.5, rayLandmark: 5,
    rayReach: 0.05, fingerOffset: 0, rejectTeleports: false, teleport: 0.25, sizeJump: 0.35, filter: {}, ...options };
  const zone0 = zoneRect(o.zone); let zoneNow = zone0; // see the speed limit in update()
  const coastMs = o.coastMs ?? 300;
  const makeMotion = () => createPosePointer({ ...POSE_POINTER_PRESET, mode: 'raise', coastMs, coastTauMs: o.coastTauMs ?? 150,
    lostAfterMs: Math.max(500, coastMs), ...o.filter });
  let motion = makeMotion();
  const desp = o.lookahead === 'desp' ? createDesp({ alpha: o.desp?.alpha ?? 0.5, predict_ms: o.desp?.predictMs ?? 40,
    max_lead: o.desp?.maxLead ?? 0.08, brake: o.desp?.brake ?? true }) : null;
  const stabilizer = o.createStabilizer ? o.createStabilizer() : null;
  let point = { x: 0.5, y: 0.5 }, raw = null, previousMotion = null, previousTime = null;
  let lastSeen = null, previousWrist = null, velocity = { x: 0, y: 0 };
  let lock = null; // { wrist, size, t }: the user's hand, while lockMs runs
  let accepted = null, suspect = null, suspectCount = 0;
  let lastSignalId = null;

  function aimPoint(hand) {
    if (o.anchorAim) return o.anchorAim(hand, o.zone);
    if (o.aim === 'tip') return hand[8];
    if (o.aim === 'fingerRay') return fingerRayPoint(hand, o.fingerOffset);
    if (o.aim === 'fixedRay') {
      const at = hand[o.rayLandmark] || hand[5], d = o.fixedDir || { x: 0, y: -1 }, n = Math.hypot(d.x, d.y) || 1;
      const r = zoneRect(o.zone), reach = Math.max(0, Math.min(0.5, o.rayReach));
      return { x: at.x + d.x / n * reach * r.w, y: at.y + d.y / n * reach * r.h };
    }
    if (o.aim === 'landmark') return hand[o.rayLandmark] || hand[5];
    if (o.aim === 'landmarkRay') {
      const from = hand[o.rayFrom ?? 0] || hand[0], to = hand[o.rayLandmark] || hand[5];
      const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
      const reach = len > 1e-6 ? Math.max(0, Math.min(3, o.rayLength ?? 0.5)) * handSize(hand) / len : 0;
      return { x: to.x + dx * reach, y: to.y + dy * reach };
    }
    if (o.aim === 'wristRay') {
      const ids = RAY_LANDMARKS[o.rayLandmark] || RAY_LANDMARKS[5];
      const pts = ids.map(i => hand[i]).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
      if (!pts.length) pts.push(hand[5]);
      const at = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
      const dx = at.x - hand[0].x, dy = at.y - hand[0].y, len = Math.hypot(dx, dy);
      const r = zoneRect(o.zone), reach = len > 1e-6 ? Math.max(0, Math.min(0.5, o.rayReach)) * (r.w + r.h) / 2 / len : 0;
      return { x: at.x + dx * reach, y: at.y + dy * reach };
    }
    if (o.aim === 'ray') return { x: hand[5].x + (hand[8].x - hand[5].x) * o.rayGain, y: hand[5].y + (hand[8].y - hand[5].y) * o.rayGain };
    if (o.aim === 'pinch' && hand[4] && Number.isFinite(hand[4].x) && Number.isFinite(hand[4].y))
      return { x: hand[8].x + (hand[4].x - hand[8].x) * 0.8, y: hand[8].y + (hand[4].y - hand[8].y) * 0.8 };
    return hand[5];
  }

  function update(frame = {}, controls = {}) {
    const t = Number.isFinite(frame.t) ? frame.t : 0;
    let hands = dedupeHands((frame.hands || []).filter(trackable), o.dedupe ?? 0.6);
    if (o.lockMs > 0 && lock && t - lock.t <= o.lockMs)
      hands = hands.filter(h => distance(h[0], lock.wrist) <= o.lockRadius && handSize(h) >= o.lockMinScale * lock.size)
        .sort((a, b) => distance(a[0], lock.wrist) - distance(b[0], lock.wrist));
    hands = hands.slice(0, 2);
    if (o.anchorAim) hands = hands.filter(hand => finitePoint(aimPoint(hand)));
    if (previousWrist && hands.length === 2 && distance(hands[1][0], previousWrist) < distance(hands[0][0], previousWrist)) hands = [hands[1], hands[0]];
    if (o.rejectTeleports && hands[0]) {
      const h = hands[0], aim = aimPoint(h), size = handSize(h), fresh = accepted && t - accepted.t <= 150;
      const jumped = fresh && (distance(aim, accepted.aim) > o.teleport || Math.abs(size - accepted.size) > o.sizeJump * accepted.size);
      if (jumped) {
        suspectCount = suspect && distance(aim, suspect) < 0.05 ? suspectCount + 1 : 1; suspect = aim;
        if (suspectCount < 3) hands = hands.slice(1, 1); else { suspect = null; suspectCount = 0; }
      } else { suspect = null; suspectCount = 0; }
      if (hands[0]) accepted = { t, aim, size };
    }
    const hand = hands[0], hasHand = !!hand;
    const holding = !hand && lastSeen !== null && t - lastSeen <= coastMs;
    const aim = hand ? aimPoint(hand) : null;
    if (hand) { previousWrist = hand[0]; lastSeen = t; raw = mapPoint(aim, o.zone, frame.mirrored); if (o.lockMs > 0) {
      // The size is sticky: a hand leaving through the frame edge shrinks for a few frames, and that sliver must not lower the bar for a far stranger.
      const live = lock && t - lock.t <= o.lockMs;
      lock = { wrist: hand[0], size: live ? Math.max(handSize(hand), lock.size * 0.99) : handSize(hand), t };
    } }
    const before = controls.beforeMotion?.({ t, hands, hand, hasHand, holding, aim, raw, point: { ...point }, lastSeen, coastMs }) || controls;
    const events = [];
    if (!before.paused) {
      const signalId = frame.signalId ?? frame.signalT ?? t;
      const changed = signalId !== lastSignalId;
      const moves = changed || !hasHand ? motion.update({ t: frame.signalT ?? t, point: hasHand ? raw : null, active: false }) : [];
      if (changed) lastSignalId = signalId;
      const move = moves.find(e => e.type === 'pointermove');
      if (move) {
        const dt = previousTime === null ? 16 : Math.max(1, Math.min(50, t - previousTime));
        if (hasHand && previousMotion && previousTime !== null) {
          const delta = Math.max(1, t - previousTime);
          velocity = { x: (move.x - previousMotion.x) / delta, y: (move.y - previousMotion.y) / delta };
        }
        let target;
        if (desp) {
          const d = hasHand ? desp.update({ t, point: { x: move.x, y: move.y } }) : null;
          if (!hasHand) desp.reset();
          target = d && !before.pinching ? { x: clamp(d.x), y: clamp(d.y) } : { x: move.x, y: move.y };
        } else {
          const predict = hasHand && !before.pinching ? o.predictionMs : 0;
          target = { x: clamp(move.x + velocity.x * predict), y: clamp(move.y + velocity.y * predict) };
        }
        // maxSpeed is set for the preset's own active area. When setZone changes the area (the mirror view shows a cropped,
        // magnified picture), the limit keeps its speed on the camera picture, so the cursor no longer trails a fast
        // fingertip on a phone (Tao 2026-11-01 13:50Z: "a weird moving cursor"). Without setZone this is unchanged.
        const sx = zoneNow.w / zone0.w, sy = zoneNow.h / zone0.h;
        const d = Math.hypot((target.x - point.x) * sx, (target.y - point.y) * sy), limit = o.maxSpeed * dt / 1000, scale = d > limit ? limit / d : 1;
        point = { x: point.x + (target.x - point.x) * scale, y: point.y + (target.y - point.y) * scale };
        if (stabilizer) { if (hasHand) point = stabilizer.update(point, t); else stabilizer.reset(); }
        previousMotion = move;
        events.push({ type: 'pointermove', ...point, t });
      }
      previousTime = t;
    }
    return { t, hands, hand, hasHand, holding, aim, raw, point: { ...point }, events, lastSeen, coastMs };
  }

  function replacePoint(next, events = []) {
    point = { ...next };
    for (const event of events) if (event.type === 'pointermove') Object.assign(event, point);
  }
  // A new active area (the mirror after a resize or rotation) rebases the pointer: the cursor keeps its place on the
  // camera picture and the filter starts fresh there, so the first frame after the change does not glide in from where
  // the old mapping put it (RT-ANATOMY-CURSOR-1: 186 px on a portrait-to-landscape turn). The rebase goes through the
  // displayed (mirrored) view on both sides, so it does not depend on frame.mirrored.
  function setZone(zone) {
    // Resize events repeat the same area with float noise from the cover-fit division; those are not a change.
    const next = zoneRect(zone), same = ['x', 'y', 'w', 'h', 'rotate'].every(k => Math.abs((next[k] ?? 0) - (zoneNow[k] ?? 0)) < 1e-6);
    if (!same) {
      const rebase = p => p && mapPoint(unmapPoint(p, o.zone), zone, true);
      point = rebase(point); previousMotion = rebase(previousMotion); raw = rebase(raw); velocity = { x: 0, y: 0 };
      motion = makeMotion(); desp?.reset(); stabilizer?.reset();
    }
    o.zone = zone; zoneNow = next;
    return !same; // the interaction tiles clear their screen-space state when this is true
  }
  return { update, replacePoint, setZone };
}

exports.createSignalTile=createSignalTile;
},
56:(module,exports,require)=>{
// UTC: 2026-10-27T21:13:06Z UTC. Copied unchanged below from factory/core/pointer/pose-pointer.js.const { createOneEuro2D } = require(8);

const TORSO = [11, 12, 23, 24];

const POSE_POINTER_PRESET = Object.freeze({
  minCutoff: 0.35,
  beta: 3,
  dCutoff: 1,
  minVisibility: 0.5,
  lostAfterMs: 500,
  coastMs: 300,
  dwellRadius: 0.035,
  dwellMs: 650,
  raiseMs: 0,
});

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function torsoCentre(pose, { mirrored = false, minVisibility = 0.5 } = {}) {
  if (!Array.isArray(pose)) return null;
  let x = 0;
  let y = 0;
  let weight = 0;
  for (const index of TORSO) {
    const p = pose[index];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const v = p.visibility === undefined ? 1 : clamp01(Number(p.visibility) || 0);
    if (v < minVisibility) continue;
    x += p.x * v;
    y += p.y * v;
    weight += v;
  }
  if (!weight) return null;
  const point = { x: clamp01(x / weight), y: clamp01(y / weight) };
  if (mirrored) point.x = 1 - point.x;
  return point;
}

/** Landmark frames -> normalized W3C-pointer transitions. Timing only uses frame.t. */
function createPosePointer(options = {}) {
  const o = { ...POSE_POINTER_PRESET, ...options };
  // createFilter: the smoothing plug-in chosen in presets.json (filter@1); One Euro when none is given.
  const filter = o.createFilter ? o.createFilter() : createOneEuro2D(o);
  let point = null;
  let lastSeen = null;
  let cancelled = false;
  let pressed = false;
  let gestureSince = null;
  let dwellAnchor = null;
  let progress = 0;
  let seenPoint = null;
  let velocity = { x: 0, y: 0 };

  function release(type, t, out) {
    if (pressed) out.push({ type, ...point, t, progress: 0 });
    pressed = false;
    gestureSince = null;
    dwellAnchor = null;
    progress = 0;
  }

  function update(frame = {}) {
    const t = Number.isFinite(frame.t) ? frame.t : 0;
    const adapted = frame.point && Number.isFinite(frame.point.x) && Number.isFinite(frame.point.y)
      ? { x: clamp01(frame.point.x), y: clamp01(frame.point.y) } : null;
    const raw = adapted || torsoCentre(frame.pose, {
      mirrored: o.mirrored === true && frame.mirrored !== true,
      minVisibility: o.minVisibility,
    });
    const out = [];
    if (!raw) {
      if (point && lastSeen !== null && !cancelled && t - lastSeen <= o.coastMs) {
        const coast = Math.min(Math.max(0, t - lastSeen), o.coastMs);
        // coastTauMs (Bridge): the glide decays, so a long coast settles and holds instead of flying on.
        const travel = o.coastTauMs > 0 ? o.coastTauMs * (1 - Math.exp(-coast / o.coastTauMs)) : coast;
        point = {
          x: clamp01(seenPoint.x + velocity.x * travel),
          y: clamp01(seenPoint.y + velocity.y * travel),
        };
        out.push({ type: 'pointermove', ...point, t, progress });
      }
      if (lastSeen !== null && !cancelled && t - lastSeen > o.lostAfterMs) {
        if (point) out.push({ type: 'pointercancel', ...point, t, progress: 0 });
        pressed = false;
        cancelled = true;
        gestureSince = null;
        dwellAnchor = null;
        progress = 0;
      }
      return out;
    }

    cancelled = false;
    const previousPoint = seenPoint;
    const previousSeen = lastSeen;
    lastSeen = t;
    point = filter.filter(raw, t);
    if (previousPoint && previousSeen !== null && t > previousSeen) {
      velocity = {
        x: (point.x - previousPoint.x) / (t - previousSeen),
        y: (point.y - previousPoint.y) / (t - previousSeen),
      };
    }
    seenPoint = { ...point };
    out.push({ type: 'pointermove', ...point, t, progress });

    let active = false;
    let holdMs = o.dwellMs;
    if (o.mode === 'raise') {
      active = typeof frame.active === 'boolean' ? frame.active : !!frame.pose && [15, 16].some((i) => {
        const wrist = frame.pose[i];
        const shoulder = frame.pose[i === 15 ? 11 : 12];
        return wrist && shoulder && (wrist.visibility ?? 1) >= o.minVisibility
          && (shoulder.visibility ?? 1) >= o.minVisibility && wrist.y < shoulder.y;
      });
      holdMs = o.raiseMs;
    } else {
      if (!dwellAnchor) dwellAnchor = { ...point };
      const distance = Math.hypot(point.x - dwellAnchor.x, point.y - dwellAnchor.y);
      if (distance <= o.dwellRadius) active = true;
      else {
        if (pressed) release('pointerup', t, out);
        dwellAnchor = { ...point };
        gestureSince = null;
        active = true;
      }
    }

    if (active) {
      if (gestureSince === null) gestureSince = t;
      progress = clamp01((t - gestureSince) / Math.max(1, holdMs));
      out[0].progress = progress;
      if (!pressed && t - gestureSince >= holdMs) {
        pressed = true;
        out.push({ type: 'pointerdown', ...point, t, progress: 1 });
      }
    } else {
      release('pointerup', t, out);
    }
    return out;
  }

  function reset() {
    filter.reset(); point = null; seenPoint = null; velocity = { x: 0, y: 0 }; lastSeen = null; cancelled = false; pressed = false;
    gestureSince = null; dwellAnchor = null; progress = 0;
  }
  return { update, reset, get progress() { return progress; } };
}

exports.torsoCentre=torsoCentre;
exports.createPosePointer=createPosePointer;
exports.POSE_POINTER_PRESET=POSE_POINTER_PRESET;
},
57:(module,exports,require)=>{
// Constant-velocity Kalman smoother (filter@1), a drop-in for One Euro. Each axis tracks position and velocity;
// processNoise is how fast the hand may change speed (screen widths per s², squared), measurementNoise is the landmark
// jitter variance. Larger processNoise follows faster with more jitter; larger measurementNoise is smoother and lags.
// Select it in presets.json: "filter": { "type": "kalman", "processNoise": 40, "measurementNoise": 0.00002 }.
module.exports.default={
  kind: 'filter', id: 'kalman', port: 'filter@1', label: 'Kalman (constant velocity)',
  create(stage = {}) {
    const q = Number.isFinite(stage.processNoise) ? Math.max(1e-6, stage.processNoise) : 40;
    const r = Number.isFinite(stage.measurementNoise) ? Math.max(1e-9, stage.measurementNoise) : 0.00002;
    const axis = () => ({ p: null, v: 0, P00: r, P01: 0, P11: 1 });
    let ax = axis(), ay = axis(), last = null, estimate = null;
    function step(a, z, dt) {
      if (a.p === null) { a.p = z; return z; }
      // Predict.
      a.p += a.v * dt;
      const P00 = a.P00 + dt * 2 * a.P01 + dt * dt * a.P11 + q * dt ** 4 / 4;
      const P01 = a.P01 + dt * a.P11 + q * dt ** 3 / 2;
      const P11 = a.P11 + q * dt * dt;
      // Correct with the measured position.
      const k0 = P00 / (P00 + r), k1 = P01 / (P00 + r), y = z - a.p;
      a.p += k0 * y; a.v += k1 * y;
      a.P00 = (1 - k0) * P00; a.P01 = (1 - k0) * P01; a.P11 = P11 - k1 * P01;
      return a.p;
    }
    return {
      filter(point, tMs) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(tMs))
          return estimate ? { ...estimate } : { x: 0, y: 0 };
        const dt = last === null ? 0 : Math.max(0.001, Math.min(0.1, (tMs - last) / 1000));
        last = tMs;
        estimate = { x: step(ax, point.x, dt), y: step(ay, point.y, dt) };
        return { ...estimate };
      },
      reset() { ax = axis(); ay = axis(); last = null; estimate = null; },
    };
  },
};


},
58:(module,exports,require)=>{
// One Euro smoothing (Casiez et al. 2012), the default cursor filter. Wraps core/filters/one-euro.js.const { createOneEuro2D } = require(8);

module.exports.default={
  kind: 'filter', id: 'oneEuro', port: 'filter@1', label: 'One Euro (adaptive low-pass)',
  create: stage => createOneEuro2D({ minCutoff: stage.minCutoff ?? 1, beta: stage.beta ?? 10, dCutoff: stage.dCutoff ?? 1 }),
};


},
59:(module,exports,require)=>{
// Cursor skin registry. Adding a look = one file here plus one line below; nothing else in the pipeline changes.const arrow = require(62).default;const arrowRing = require(61).default;const ring = require(60).default;

const DEFAULT_SKIN = 'arrow';
const SKINS = Object.freeze({ [arrow.id]: arrow, [arrowRing.id]: arrowRing, [ring.id]: ring });

exports.DEFAULT_SKIN=DEFAULT_SKIN;
exports.SKINS=SKINS;
},
60:(module,exports,require)=>{
// Cursor skin plugin (visualization port v1): the 0.2.8 look, a ring with a centre dot and a dwell arc.
// The draw function is serialized into the page: it must use only its arguments (no imports, no closures).
module.exports.default={
  id: 'ring',
  label: 'Ring only',
  draw(ctx, x, y, s) {
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.lineWidth = 3; ctx.strokeStyle = s.pressed ? '#ffc987' : '#b8ffe2'; ctx.fillStyle = s.pressed ? 'rgba(255,201,135,.45)' : 'rgba(16,24,30,.25)';
    ctx.beginPath(); ctx.arc(x, y, 16, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#10181e'; ctx.beginPath(); ctx.arc(x, y, 18, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = s.holding ? '#9db5b0' : '#e8fff5'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.2832); ctx.fill();
    if (s.progress > 0) { ctx.lineWidth = 5; ctx.strokeStyle = '#ffc987'; ctx.beginPath(); ctx.arc(x, y, 22, -1.5708, -1.5708 + s.progress * 6.2832); ctx.stroke(); }
    ctx.globalAlpha = 1;
  },
};


},
61:(module,exports,require)=>{
// Cursor skin plugin (visualization port v1). The default since 0.2.9 (Tao 21:01Z: "a default commercial ... mouse
// cursor with ... a ring for dwell"). Pattern from dwell tools (Windows Eye Control, Tobii Dwell, TouchFree): a
// normal arrow whose tip is the click point, inside a ring that fills clockwise during the dwell and closes in when
// the button goes down. White arrow with a dark edge reads on light and dark pages.
// The draw function is serialized into the page: it must use only its arguments (no imports, no closures).
module.exports.default={
  id: 'arrow-ring',
  label: 'Arrow with dwell ring',
  draw(ctx, x, y, s) {
    ctx.globalAlpha = s.alpha ?? 1;
    const r = s.pressed ? 13 : 22;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(16,24,30,.45)'; ctx.fillStyle = s.pressed ? 'rgba(255,201,135,.55)' : 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); ctx.stroke();
    if (s.progress > 0 && !s.pressed) { ctx.lineWidth = 4; ctx.strokeStyle = '#ff9f2e'; ctx.beginPath(); ctx.arc(x, y, r, -1.5708, -1.5708 + s.progress * 6.2832); ctx.stroke(); }
    if (s.primary) {
      const arrow = [[0, 0], [0, 21], [5, 16], [8.5, 24], [12, 22.5], [8.5, 15], [15, 15]];
      ctx.beginPath(); arrow.forEach(([ax, ay], i) => (i ? ctx.lineTo(x + ax, y + ay) : ctx.moveTo(x + ax, y + ay))); ctx.closePath();
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
      ctx.fillStyle = s.holding ? '#c9d3d1' : '#ffffff'; ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.lineJoin = 'round'; ctx.lineWidth = 1.5; ctx.strokeStyle = '#111'; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
};


},
62:(module,exports,require)=>{
// Cursor skin plugin (visualization port v1). The default since 0.2.10 (Tao 21:28Z: likes the arrow, not the ring
// around it). A plain arrow whose tip is the click point; the dwell shows inside the arrow, filling amber from the
// tip down, and the arrow dips slightly when the button goes down. Second hands get a small dot. With an arming gate
// (presets "arming" stage) a disarmed arrow is grey and see-through: it moves but will not click.
// The draw function is serialized into the page: it must use only its arguments (no imports, no closures).
module.exports.default={
  id: 'arrow',
  label: 'Arrow (dwell fills the arrow)',
  draw(ctx, x, y, s) {
    ctx.globalAlpha = (s.alpha ?? 1) * (s.holding ? 0.55 : 1) * (s.armed === false ? 0.6 : 1);
    if (!s.primary) {
      ctx.fillStyle = s.pressed ? '#ff9f2e' : '#ffffff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.2832); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1; return;
    }
    const k = s.pressed ? 0.85 : 1, h = 24 * k;
    const arrow = [[0, 0], [0, 21], [5, 16], [8.5, 24], [12, 22.5], [8.5, 15], [15, 15]];
    const path = () => { ctx.beginPath(); arrow.forEach(([ax, ay], i) => (i ? ctx.lineTo(x + ax * k, y + ay * k) : ctx.moveTo(x + ax * k, y + ay * k))); ctx.closePath(); };
    path(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    ctx.fillStyle = s.armed === false ? '#b9bec4' : '#ffffff'; ctx.fill(); ctx.shadowColor = 'transparent';
    const fill = s.pressed ? 1 : Math.max(0, Math.min(1, s.progress || 0));
    if (fill > 0) { ctx.save(); path(); ctx.clip(); ctx.fillStyle = '#ff9f2e'; ctx.fillRect(x - 1, y - 1, 17 * k, h * fill + 1); ctx.restore(); }
    path(); ctx.lineJoin = 'round'; ctx.lineWidth = 1.5; ctx.strokeStyle = '#111'; ctx.stroke();
    ctx.globalAlpha = 1;
  },
};


},
63:(module,exports,require)=>{
// Plug-in registry (Tao 22:04Z: MOSA mosaic tiles; swapping One Euro for Kalman, an interaction or a cursor look must
// be a JSON change, never a core edit). A plug-in is a plain object { kind, id, label, port, ... }. They are listed once
// in plugins/index.js, presets.json names them by id, and the config tile turns the ids into engine options, so core
// code never imports a plug-in. Like the rest of ports/, this file imports nothing.
const PLUGIN_PORTS = Object.freeze({
  refinery: 'refinery@1',       // { create(stage) -> { update(LandmarkFrame) -> LandmarkFrame, reset() } }
  filter: 'filter@1',           // { create(stage) -> { filter({x, y}, tMs) -> {x, y}, reset() } }; stage = the preset's "filter" object
  interaction: 'interaction@1', // { configure(config, check) -> engine options, create(options, signal) -> { update(frame) -> state, setZone } }
  cursor: 'visualization@1',    // { draw(ctx, x, y, s) } serialized into the page: arguments only, no imports or closures
  anchor: 'anchor@1',          // { configure(stage), create(options) -> { aim(hand, zone) -> {x, y} } }
  scene: 'scene@1',             // { create(options) -> { update(frame, size), render(), resize(), dispose() } }
  compositor: 'compositor@1',   // { create(host options) -> canvas lifecycle }; placement, never rendering
  output: 'output@1',           // { create(options) -> { dispatch(event), release() } }
  injector: 'injector@1',       // { createMouse(options), createTouch() } -> { dispatch(event, viewport) -> commands[], release(viewport) -> commands[], abandon?(), configure?(o), pressed }
  stabilizer: 'stabilizer@1',   // { create(options) -> { update(point, t) -> point, reset() } }: hand-still jitter (dead zone)
  predictor: 'predictor@1',     // { create({ horizonMs, ... }) -> { update(LandmarkFrame) -> LandmarkFrame moved forward horizonMs, reset() } }
  pinch: 'pinch@1',             // { create(options) -> { update(hand, t, pressed, point) -> { next, openPoint, lost }, commit(next, wasPressed), cancel(), reset() } }
  gate: 'gate@1',               // { create(stage) -> { update(t, hand) -> may a new press count now, noteClick(t), left(t) -> 0..1 } }: click intent (Tao 18:23Z: one seam)
});

function checkPlugin(p) {
  if (!p || typeof p !== 'object') return 'not an object';
  if (!Object.hasOwn(PLUGIN_PORTS, p.kind)) return `kind must be one of ${Object.keys(PLUGIN_PORTS).join(', ')}`;
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(p.id ?? '')) return 'id must be 1-32 letters, digits, - or _';
  if (p.port !== PLUGIN_PORTS[p.kind]) return `port must be ${PLUGIN_PORTS[p.kind]}`;
  if (p.kind === 'filter' && typeof p.create !== 'function') return 'a filter needs create(stage)';
  if (p.kind === 'refinery' && typeof p.create !== 'function') return 'a refinery needs create(stage)';
  // The two built-in interactions are the core interaction tile itself; plug-ins bring their own state machine.
  if (p.kind === 'interaction' && !p.builtin && (typeof p.configure !== 'function' || typeof p.create !== 'function')) return 'an interaction needs configure() and create()';
  if (p.kind === 'cursor' && typeof p.draw !== 'function') return 'a cursor look needs draw(ctx, x, y, s)';
  if (p.kind === 'anchor' && (typeof p.configure !== 'function' || typeof p.create !== 'function')) return 'an anchor needs configure(stage) and create(options)';
  if (p.kind === 'scene' && typeof p.create !== 'function') return 'a scene needs create(options)';
  if (p.kind === 'compositor' && typeof p.create !== 'function') return 'a compositor needs create(options)';
  if (p.kind === 'output' && typeof p.create !== 'function') return 'an output needs create(options)';
  if (p.kind === 'injector' && (typeof p.createMouse !== 'function' || typeof p.createTouch !== 'function')) return 'an injector needs createMouse() and createTouch()';
  if (p.kind === 'predictor' && typeof p.create !== 'function') return 'a predictor needs create(options)';
  if (p.kind === 'stabilizer' && typeof p.create !== 'function') return 'a stabilizer needs create(options)';
  if (p.kind === 'pinch' && typeof p.create !== 'function') return 'a pinch detector needs create(options)';
  if (p.kind === 'gate' && typeof p.create !== 'function') return 'a gate needs create(stage)';
  return null;
}

function createRegistry(plugins = []) {
  const byKind = Object.fromEntries(Object.keys(PLUGIN_PORTS).map(k => [k, new Map()]));
  const register = p => {
    const why = checkPlugin(p);
    if (why) throw new Error(`plug-in ${p?.kind ?? '?'}/${p?.id ?? '?'}: ${why}`);
    if (byKind[p.kind].has(p.id)) throw new Error(`plug-in ${p.kind}/${p.id} is registered twice`);
    byKind[p.kind].set(p.id, p);
  };
  plugins.forEach(register);
  return {
    register,
    swap(kind, id, candidate) {
      const required = PLUGIN_PORTS[kind];
      const requiredMajor = required?.match(/@(\d+)/)?.[1];
      const candidateMajor = candidate?.port?.match(/@(\d+)/)?.[1];
      if (requiredMajor !== candidateMajor) {
        return { ok: false, reason: `port major mismatch: ${required} required, got ${candidate?.port ?? 'none'}` };
      }
      if (!byKind[kind]?.has(id)) return { ok: false, reason: `plug-in ${kind}/${id} is not registered` };
      const why = checkPlugin(candidate);
      if (why) return { ok: false, reason: `plug-in ${candidate?.kind ?? '?'}/${candidate?.id ?? '?'}: ${why}` };
      byKind[kind].set(id, candidate);
      return { ok: true };
    },
    get: (kind, id) => byKind[kind]?.get(id) ?? null,
    ids: kind => [...(byKind[kind]?.keys() ?? [])],
    list: kind => [...(byKind[kind]?.values() ?? [])],
    // Cursor looks as the { id: skin } map the page layer serializes.
    skins: () => Object.fromEntries([...byKind.cursor.values()].map(p => [p.id, p])),
  };
}

exports.checkPlugin=checkPlugin;
exports.createRegistry=createRegistry;
exports.PLUGIN_PORTS=PLUGIN_PORTS;
},
64:(module,exports,require)=>{
module.exports.default={
  "about": "User menus (Tao 2026-10-31 16:18-16:20Z): a 2-option menu is a toggle, a 4-option menu is a choice of 4, and every menu has an Advanced control that opens all the knobs (progressive disclosure). tools/menu-lint.mjs warns on any other count.",
  "trackpadZone": {
    "label": "Trackpad zone",
    "advanced": "zone-advanced",
    "options": [
      {
        "id": "whole",
        "label": "Whole picture",
        "zone": {
          "x": 0.1,
          "y": 0.1,
          "width": 0.8,
          "height": 0.8
        }
      },
      {
        "id": "small",
        "label": "Small trackpad in the middle",
        "zone": {
          "x": 0.25,
          "y": 0.25,
          "width": 0.5,
          "height": 0.5
        }
      },
      {
        "id": "rest-right",
        "label": "Resting arm, low on the right",
        "zone": {
          "x": 0.5,
          "y": 0.45,
          "width": 0.45,
          "height": 0.45
        }
      },
      {
        "id": "sideways",
        "label": "Turned a quarter (hand or camera on its side)",
        "zone": {
          "x": 0.2,
          "y": 0.2,
          "width": 0.6,
          "height": 0.6,
          "rotate": 90
        }
      }
    ]
  },
  "dragMode": {
    "label": "Pinch-drag acts like",
    "advanced": "advanced",
    "options": [
      {
        "id": "mouse",
        "label": "A mouse: drag, draw, select text",
        "input": {
          "mode": "mouse"
        }
      },
      {
        "id": "touch",
        "label": "A finger: scroll and pan pages",
        "input": {
          "mode": "touch"
        }
      }
    ]
  },
  "pinchStart": {
    "label": "Click style",
    "advanced": "advanced",
    "options": [
      {
        "id": "active",
        "label": "Active: just pinch",
        "gates": []
      },
      {
        "id": "stable",
        "label": "Stable: open palm first (far fewer false clicks)",
        "gates": [
          {
            "type": "arming",
            "pose": "palm-scaled",
            "holdMs": 300,
            "armedMs": 1000,
            "refreshOnClick": true
          }
        ]
      }
    ]
  },
  "smoothing": {
    "label": "Smoothing",
    "advanced": "advanced",
    "about": "Motion tuning 2026-10-31 (tools/motion-tune.mjs, receipts/RECEIPT-MOTION-TUNE-1.md): One Euro tuned on IPN Hand pointing spans and Tao's still goldens. Both keep the lead menu's choice.",
    "options": [
      {
        "id": "smooth",
        "label": "Smooth: steadiest when still",
        "filter": {
          "minCutoff": 0.25,
          "beta": 40
        }
      },
      {
        "id": "snappy",
        "label": "Snappy: follows fast moves closest",
        "filter": {
          "minCutoff": 0.25,
          "beta": 160
        }
      }
    ]
  },
  "lead": {
    "label": "Lead: how far ahead the cursor guesses",
    "advanced": "advanced",
    "about": "Time-based (ms), the same at any camera rate. Past 50 ms the cursor flies past stops by 100+ px and a pinch-drag can split in two, so there is no 100-200 ms choice.",
    "options": [
      {
        "id": "off",
        "label": "Off: no guessing, lowest jitter",
        "predictor": {
          "type": "none"
        },
        "filter": {
          "predictionMs": 0
        }
      },
      {
        "id": "20",
        "label": "20 ms: catches up to the camera",
        "predictor": {
          "type": "desp",
          "horizonMs": 20
        },
        "filter": {
          "predictionMs": 0
        }
      },
      {
        "id": "35",
        "label": "35 ms: a little ahead, clicks land 13 ms early",
        "predictor": {
          "type": "desp",
          "horizonMs": 35
        },
        "filter": {
          "predictionMs": 0
        }
      },
      {
        "id": "50",
        "label": "50 ms: most ahead, clicks land 28 ms early, overshoots stops",
        "predictor": {
          "type": "desp",
          "horizonMs": 50
        },
        "filter": {
          "predictionMs": 0
        }
      }
    ]
  }
}
;
},
65:(module,exports,require)=>{
module.exports.default={
  "version": 1,
  "default": "dwell-fingertip",
  "note": "One file for every swappable part. Each preset fills the stages of PIPELINE.md: anchor (the cursor: one landmark, or a ray from one landmark through another) and filter and guards (stage 2), interaction (stage 3), zone (the active area: x, y, width, height of the camera picture that maps to the whole screen), overlay (stage 6). Scores: missions/omega/bridge/goldens/2026-10-28/bakeoff.txt. arming (opt-in): a pose (point, palm or fist) held holdMs arms dwell and pinch for armedMs; clicks keep it armed; disarm is an optional pose that ends it at once. Scores: tools/arming-score.mjs.",
  "presets": {
    "dwell-fingertip": {
      "label": "Dwell, fingertip cursor (default)",
      "extends": "dwell-knuckle",
      "anchor": {
        "type": "landmark",
        "landmark": 8
      }
    },
    "dwell-pose": {
      "label": "Dwell, fingertip with body pose",
      "tier": "experimental",
      "extends": "dwell-fingertip",
      "tracker": { "hands": 2, "pose": "lite" }
    },
    "point-dwell": {
      "label": "Dwell, point to arm for 10 s (a fist disarms)",
      "extends": "dwell-fingertip",
      "arming": {
        "pose": "point",
        "holdMs": 300,
        "armedMs": 10000,
        "refreshOnClick": true,
        "disarm": "fist",
        "disarmMs": 500
      }
    },
    "mirror-dwell": {
      "label": "Mirror dwell: point-dwell with the cursor kept on a fast fingertip (speed limit 8)",
      "extends": "point-dwell",
      "filter": {
        "type": "oneEuro",
        "minCutoff": 1,
        "beta": 10,
        "predictionMs": 20,
        "maxSpeed": 8
      }
    },
    "mirror-dwell-ray": {
      "label": "Mirror dwell, cursor on a short ray past the fingertip",
      "extends": "mirror-dwell",
      "anchor": {
        "type": "fingerRay",
        "offsetInches": 2
      }
    },
    "dwell-knuckle": {
      "label": "Dwell, knuckle cursor (steadiest)",
      "camera": { "resolution": "480p", "auto": "off" },
      "interaction": "dwell_cursor",
      "tracker": { "hands": 2, "pose": "off" },
      "refinery": { "type": "oneEuro" },
      "anchor": {
        "type": "landmark",
        "landmark": 5
      },
      "filter": {
        "type": "oneEuro",
        "minCutoff": 1,
        "beta": 10,
        "predictionMs": 20,
        "maxSpeed": 2
      },
      "guards": {
        "teleport": 0.25,
        "sizeJump": 0.35,
        "dedupe": 0.6,
        "coastMs": 1000,
        "coastTauMs": 150
      },
      "dwell": {
        "ms": 800,
        "radius": 0.035,
        "graceMs": 300,
        "requirePoint": false
      },
      "zone": {
        "x": 0.1,
        "y": 0.1,
        "width": 0.8,
        "height": 0.8
      },
      "overlay": {
        "pageCursor": true,
        "panelRay": true,
        "ray": true,
        "rayWidth": 3,
        "page": "cursor",
        "pageOpacity": 0.6
      }
    },
    "dwell-ray-knuckle": {
      "label": "Dwell, ray: wrist to knuckle",
      "extends": "dwell-knuckle",
      "anchor": {
        "type": "ray",
        "from": 0,
        "to": 5,
        "length": 0.5
      }
    },
    "dwell-ray-fingertip": {
      "label": "Dwell, ray: wrist to fingertip",
      "extends": "dwell-knuckle",
      "anchor": {
        "type": "ray",
        "from": 0,
        "to": 8,
        "length": 0.5
      }
    },
    "pinch-index": {
      "label": "Pinch: index + thumb clicks (like Quest / Vision Pro)",
      "extends": "dwell-knuckle",
      "interaction": "stable_pointer_pinch_chords",
      "anchor": {
        "type": "landmark",
        "landmark": 5
      },
      "pinch": {
        "finger": "index",
        "closeAt": 0.25,
        "openAt": 0.6,
        "releaseMs": 150,
        "requireOpen": true,
        "pinMs": 200,
        "handScaled": true,
        "chords": {
          "enabled": false,
          "fingers": [
            "middle",
            "ring",
            "pinky"
          ],
          "windowMs": 80,
          "map": {
            "M": "left",
            "R": "right",
            "P": "middle",
            "M+R": null,
            "M+P": null,
            "R+P": null,
            "M+R+P": null
          }
        }
      }
    },
    "pinch-index-ray05": { "label": "Pinch index, wrist ray 0.5 (experimental)", "tier": "experimental", "extends": "pinch-index", "anchor": { "type": "wristRay", "reach": 0.5 }, "pinch": { "finger": "index", "closeAt": 0.25, "openAt": 0.6, "releaseMs": 150, "requireOpen": true, "pinMs": 0, "handScaled": true, "chords": { "enabled": false } } },
    "ray-pinch": {
      "label": "Ray + pinch, one cursor per hand",
      "extends": "pinch-index",
      "anchor": { "type": "wristRay", "reach": 1 },
      "filter": { "type": "oneEuro", "minCutoff": 1, "beta": 10, "predictionMs": 20, "maxSpeed": 2 },
      "pinch": { "finger": "index", "closeAt": 0.25, "openAt": 0.6, "releaseMs": 150, "requireOpen": true, "pinMs": 0, "handScaled": true,
        "chords": { "enabled": false, "fingers": ["middle", "ring", "pinky"], "windowMs": 80, "map": {} } },
      "input": { "mode": "touch" }
    },
    "pinch-baseline": {
      "label": "Pinch to click (baseline from visionOS, Quest, TouchFree, MRTK; cursor always on)", "extends": "ray-pinch",
      "input": { "mode": "mouse" }, "output": { "multiClickGapMs": 250, "multiClickPx": 28 },
      "pinch": { "finger": "index", "closeAt": 0.25, "openAt": 0.6, "releaseMs": 150, "requireOpen": true, "pinMs": 0, "pinRadius": 0.04, "handScaled": true, "metric": "3d",
        "ready": { "openForMs": 150 },
        "layers": { "fingerGate": { "enabled": true, "straightAtLeast": 1.7 }, "closingGate": { "enabled": true, "ms": 500 }, "tipCue": { "enabled": false }, "confirm": { "enabled": false, "ms": 33 } } }
    },
    "pinch-baseline-grip": {
      "label": "Pinch to click, grip style (other fingers curled)", "extends": "pinch-baseline",
      "pinch": { "finger": "index", "closeAt": 0.25, "openAt": 0.6, "releaseMs": 150, "requireOpen": true, "pinMs": 0, "pinRadius": 0.04, "handScaled": true, "metric": "3d",
        "ready": { "openForMs": 150 },
        "layers": { "fingerGate": { "enabled": false }, "closingGate": { "enabled": true, "ms": 500 }, "tipCue": { "enabled": true }, "confirm": { "enabled": true, "ms": 33 } } }
    },
    "pinch-sphere": {"label": "Pinch to click, sphere contact model (Tao): fingertip spheres, reject a curled hand", "extends": "pinch-baseline", "pinch": {"type": "sphere", "finger": "index", "closeAt": 0.25, "openAt": 0.6, "releaseMs": 150, "requireOpen": true, "pinMs": 0, "pinRadius": 0.04, "handScaled": true, "metric": "3d", "ready": {"openForMs": 0}, "layers": {"fingerGate": {"enabled": true, "straightAtLeast": 1.7}, "closingGate": {"enabled": false}, "tipCue": {"enabled": false}, "confirm": {"enabled": false}}, "sphere": {"radius": {"default": 0.125}, "targets": [8], "rejectTargets": [12, 11, 10], "openGap": 0.15, "impactMs": 500, "holdMs": 33}}},
    "doodle-trace": {"label": "Doodle trace: pinch index and thumb to draw, open to lift. No arming, one hand, a smoother line than pointing, a pinch under 120 ms leaves no dot", "extends": "pinch-sphere", "tracker": {"hands": 1, "pose": "off"}, "anchor": {"type": "landmark", "landmark": 8}, "filter": {"type": "oneEuro", "minCutoff": 2, "beta": 6, "predictionMs": 0, "maxSpeed": 2}, "guards": {"teleport": 0.25, "sizeJump": 0.35, "dedupe": 0.6, "coastMs": 250, "coastTauMs": 150}, "output": {"multiClickMs": 0, "multiClickPx": 8, "multiClickGapMs": 0}, "pinch": {"type": "sphere", "finger": "index", "closeAt": 0.25, "openAt": 0.6, "releaseMs": 150, "requireOpen": true, "pinMs": 0, "pinRadius": 0, "handScaled": true, "metric": "3d", "ready": {"openForMs": 0}, "layers": {"fingerGate": {"enabled": true, "straightAtLeast": 1.7}, "closingGate": {"enabled": false}, "tipCue": {"enabled": false}, "confirm": {"enabled": false}}, "sphere": {"radius": {"default": 0.125}, "targets": [8], "rejectTargets": [12, 11, 10], "openGap": 0.15, "impactMs": 500, "holdMs": 120}}},
    "doodle-trace-smooth": {"label": "Doodle trace, smoother: steadier line, about 10 ms more lag", "extends": "doodle-trace", "filter": {"type": "oneEuro", "minCutoff": 1.5, "beta": 4, "predictionMs": 0, "maxSpeed": 2}},
    "pinch-palm-ready": {"label": "Stable pinch: open palm first (tournament 2026-10-31): sphere contact, clicks count for 1 s after an open hand", "extends": "pinch-sphere", "gates": [{"type": "arming", "pose": "palm-scaled", "holdMs": 300, "armedMs": 1000, "refreshOnClick": true}]},
    "pinch-lock": {
      "label": "Stable pinch with crowd lock-on (Tao 20:54Z, UX-15): for 5 s after your hand was last seen, only a hand near it and not much smaller can take the cursor",
      "tier": "experimental",
      "extends": "pinch-palm-ready",
      "guards": { "teleport": 0.25, "sizeJump": 0.35, "dedupe": 0.6, "coastMs": 1000, "coastTauMs": 150, "lockMs": 5000, "lockRadius": 0.25, "lockMinScale": 0.5 }
    },
    "two-users-touch": {"label": "Two users, four hands (stretch, Tao 20:58Z): Stable pinch, each hand its own touch cursor; MediaPipe tracks up to 4 hands, which costs frame rate", "tier": "experimental", "extends": "pinch-palm-ready", "tracker": {"hands": 4, "pose": "off"}, "input": {"mode": "touch"}},
    "pinch-deliberate": {"label": "Middle pinch, no palm step (tournament 2026-10-31 round 7): sphere contact that must close within 250 ms of an open hand (gap 0.25) and hold 100 ms; clicks land ~100 ms later than Active", "extends": "pinch-sphere", "pinch": {"type": "sphere", "finger": "index", "closeAt": 0.25, "openAt": 0.6, "releaseMs": 150, "requireOpen": true, "pinMs": 0, "pinRadius": 0.04, "handScaled": true, "metric": "3d", "ready": {"openForMs": 0}, "layers": {"fingerGate": {"enabled": true, "straightAtLeast": 1.7}, "closingGate": {"enabled": false}, "tipCue": {"enabled": false}, "confirm": {"enabled": false}}, "sphere": {"radius": {"default": 0.125}, "targets": [8], "rejectTargets": [12, 11, 10], "openGap": 0.25, "impactMs": 250, "holdMs": 100}}},
    "two-hand-pinch-pull": {
      "label": "Two hands: pinch-pull zoom and midpoint pan",
      "extends": "ray-pinch",
      "interaction": "pinch_pull",
      "pinchPull": { "wheelScale": 1000, "minHoldMs": 1500 }
    },
    "pinch-index-knuckle": { "label": "Pinch index, knuckle (experimental)", "tier": "experimental", "extends": "pinch-index", "anchor": { "type": "landmark", "landmark": 5 } },
    "pinch-chords": {
      "label": "Pinch: thumb + middle clicks (stable pointer)",
      "extends": "dwell-knuckle",
      "interaction": "stable_pointer_pinch_chords",
      "anchor": {
        "type": "landmark",
        "landmark": 8
      },
      "pinch": {
        "finger": "middle",
        "closeAt": 0.25,
        "openAt": 0.6,
        "releaseMs": 150,
        "requireOpen": true,
        "pinMs": 200,
        "handScaled": true,
        "chords": {
          "enabled": false,
          "fingers": [
            "middle",
            "ring",
            "pinky"
          ],
          "windowMs": 80,
          "map": {
            "M": "left",
            "R": "right",
            "P": "middle",
            "M+R": null,
            "M+P": null,
            "R+P": null,
            "M+R+P": null
          }
        }
      }
    },
    "point-pinch-chords": {
      "label": "Pinch: point to arm for 10 s, then thumb + middle clicks",
      "extends": "pinch-chords",
      "arming": {
        "pose": "point",
        "holdMs": 300,
        "armedMs": 10000,
        "refreshOnClick": true,
        "disarm": "fist",
        "disarmMs": 500
      }
    },
    "dwell-desp": {
      "label": "Dwell, snappy: DESP lookahead 40 ms (testing)",
      "interaction": "dwell_cursor",
      "anchor": {
        "type": "landmark",
        "landmark": 5
      },
      "filter": {
        "type": "oneEuro",
        "minCutoff": 1,
        "beta": 10,
        "predictionMs": 20,
        "maxSpeed": 2,
        "lookahead": "desp",
        "desp": {
          "alpha": 0.5,
          "predictMs": 40,
          "maxLead": 0.08
        }
      },
      "guards": {
        "teleport": 0.25,
        "sizeJump": 0.35,
        "dedupe": 0.6,
        "coastMs": 1000,
        "coastTauMs": 150
      },
      "dwell": {
        "ms": 800,
        "radius": 0.035,
        "graceMs": 300,
        "requirePoint": false
      },
      "zone": {
        "x": 0.1,
        "y": 0.1,
        "width": 0.8,
        "height": 0.8
      },
      "overlay": {
        "pageCursor": true,
        "panelRay": true,
        "page": "cursor",
        "pageOpacity": 0.6
      }
    },
    "two-hand-touch": {
      "label": "Two hands, touch: pinch middle finger + thumb to touch (multitouch)",
      "extends": "pinch-chords",
      "input": {
        "mode": "touch"
      }
    },
    "dwell-kalman": {
      "label": "Dwell, Kalman smoothing (plug-in)",
      "extends": "dwell-fingertip",
      "refinery": { "type": "raw" },
      "compositor": { "type": "pip", "videoOpacity": 1 },
      "filter": {
        "predictionMs": 20,
        "maxSpeed": 2,
        "type": "kalman",
        "processNoise": 40,
        "measurementNoise": 0.0001
      }
    },
    "dwell-drag": {
      "label": "Dwell drag: hold still to grab, again to drop (plug-in)",
      "extends": "dwell-fingertip",
      "interaction": "dwell_drag"
    },
    "showcase-anatomy": {
      "label": "Showcase: cursor and anatomy on page",
      "extends": "point-dwell",
      "tier": "experimental",
      "visual": { "layers": ["cursor", "anatomy"], "smoothing": { "type": "oneEuro", "predictMs": 40, "maxLead": 0.08 } },
      "compositor": { "type": "page", "videoOpacity": 1 },
      "overlay": { "pageCursor": true, "panelRay": true, "page": "overlay", "pageOpacity": 0.6 }
    },
    "showcase-anatomy-video": {
      "label": "Showcase: skeleton and anatomy over video",
      "extends": "point-dwell",
      "tier": "experimental",
      "visual": { "layers": ["skeleton", "anatomy"], "smoothing": { "type": "oneEuro", "predictMs": 40, "maxLead": 0.08 } },
      "compositor": { "type": "video", "videoOpacity": 0.5 }
    },
    "showcase-spotlight": {
      "label": "Showcase: spotlight cursor, point to arm (plug-in)",
      "extends": "point-dwell",
      "overlay": {
        "pageCursor": true,
        "panelRay": true,
        "ray": true,
        "rayWidth": 3,
        "page": "cursor",
        "pageOpacity": 0.6,
        "cursor": "spotlight"
      }
    }
  }
}
;
},
66:(module,exports,require)=>{
// UTC: 2026-10-27. Reuses factory/core/pointer/hand-pointer.js for pinch,
// factory/core/pointer/pose-pointer.js for One Euro smoothing and 300 ms coast.
// Filters and hysteresis implementations are copied, not rewritten.

exports.dedupeHands=require(24).dedupeHands;
exports.fingerRayPoint=require(24).fingerRayPoint;
exports.isPointing=require(24).isPointing;
exports.RAY_LANDMARKS=require(24).RAY_LANDMARKS;
exports.zoneRect=require(24).zoneRect;
exports.mapPoint=require(24).mapPoint;
exports.unmapPoint=require(24).unmapPoint;
exports.isOpenPalm=require(24).isOpenPalm;
const DISTANCE_PRESET = { dwell: true, dwellMs: 650, dwellRadius: 0.035, zone: 0.15 };
// stable_pointer_pinch_chords (Tao 2026-10-28): the index tip is a steady pointer and never pinches; thumb + middle
// clicks today. Ring, little finger and chords are specced in ROADMAP.md item 4.
const STABLE_POINTER_PINCH_CHORDS_PRESET = Object.freeze({ aim: 'tip', clickFinger: 'middle', pinMs: 200, pinchScale: true });
// dwell_cursor, the primary mode (Tao 2026-10-28): one fixed landmark, nudged a short way along the wrist -> landmark ray
// (rayReach = fraction of the screen), hold still 0.8 s to click, no pinch. Short dropouts keep the dwell timer.
// dwell_cursor 0.2.2 (Tao 17:43Z): point to arm; the cursor can sit a fixed offset beyond the index fingertip along
// the finger, in hand-size units so it is the same at any distance; hold still to click. The open-palm pause is off,
// and one-frame teleports or sudden hand-size jumps are dropped and coasted through.
const HAND_SIZE_INCHES = 3.5; // wrist to index knuckle on an adult hand, roughly
// Default offset 0 = the fingertip itself (Tao 17:46Z: start from the fingertip, no ray); the offset stays a setting.
const DWELL_CURSOR_PRESET = Object.freeze({ aim: 'fingerRay', fingerOffset: 0, requirePoint: true,
  // One Euro beta 10 (was 3): same stillness on synthetic jitter, no catch-up drift after the hand stops (sweep 17:5xZ).
  filter: { minCutoff: 0.35, beta: 10 }, rejectTeleports: true, pinchClick: false, pinchScale: true, dwell: true, dwellMs: 800, dwellRadius: 0.035, dwellGraceMs: 300,
  palmPause: false });const { createSignalTile } = require(55);const { createInteractionTile } = require(68);const { createHandPointer } = require(67);

function createGestureMachine(options = {}) {
  const signal = createSignalTile(options);
  const hooks = {
    createHandPointer,
    releasePinch(pinches, release) { if (!pinches[0]) release(); },
    releaseLoss(release, state, frame) {
      let { zooming, zoomDistance } = state;
      if (frame?.signalT === undefined) { release(); zooming = false; zoomDistance = null; }
      else { release('pointercancel', 'lost'); zooming = false; zoomDistance = null; }
      Object.assign(state, { zooming, zoomDistance });
    },
    wheelDelta(next, zoomDistance) { return -600 * Math.log(next / zoomDistance); },
  };
  // An interaction plug-in (presets.json "interaction") brings its own state machine on the same signal tile.
  const interaction = options.createInteraction ? options.createInteraction(options, signal) : createInteractionTile(options, signal, hooks);
  // Negative latency (charter chunk 4): a predictor@1 plug-in, when the preset names one, moves landmarks forward first.
  const predictor = options.createPredictor ? options.createPredictor() : null;
  return { update: predictor ? frame => interaction.update(predictor.update(frame)) : interaction.update, setZone: interaction.setZone ?? signal.setZone };
}

exports.createGestureMachine=createGestureMachine;
exports.DISTANCE_PRESET=DISTANCE_PRESET;
exports.STABLE_POINTER_PINCH_CHORDS_PRESET=STABLE_POINTER_PINCH_CHORDS_PRESET;
exports.HAND_SIZE_INCHES=HAND_SIZE_INCHES;
exports.DWELL_CURSOR_PRESET=DWELL_CURSOR_PRESET;
},
67:(module,exports,require)=>{
// UTC: 2026-10-27T21:13:06Z UTC. Copied from factory/core/pointer/hand-pointer.js. Seed step 2 (2026-10-31): the pinch
// decision moved to a pinch@1 detector (core/pointer/pinch-gap.js is the default "gap" adapter; a preset picks another
// with pinch.type, and config passes it in as createPinch).const { createOneEuro2D } = require(8);const { createGapPinch, FINGER_TIPS } = require(20);
exports.FINGER_TIPS=FINGER_TIPS;

const HAND_POINTER_PRESET = Object.freeze({
  minCutoff: 1,
  beta: 12,
  dCutoff: 1,
  pinchOn: 0.045,
  pinchOff: 0.065,
  lostAfterMs: 500,
});

/** MediaPipe hand frames -> normalized pointer transitions (index tip + pinch). */
function createHandPointer(options = {}) {
  const o = { pinchScale: false, clickFinger: 'index', ...HAND_POINTER_PRESET, ...options };
  // Source-mutant tests which alter the legacy preset must still exercise it.
  if (o.pinchScale && (o.pinchOn !== 0.045 || o.pinchOff !== 0.065)) o.pinchScale = false;
  const filter = createOneEuro2D(o);
  const detector = (o.createPinch ?? createGapPinch)(o);
  let point = null;
  let pressed = false;
  let lastSeen = null;
  let cancelled = false;
  let lastSignalId = null;

  function update(frame = {}) {
    const t = Number.isFinite(frame.t) ? frame.t : 0;
    const hand = frame.hands && frame.hands[0];
    const index = hand && hand[8];
    const out = [];
    if (!index || !Number.isFinite(index.x) || !Number.isFinite(index.y)) {
      if (lastSeen !== null && !cancelled && t - lastSeen > o.lostAfterMs) {
        if (point) out.push({ type: 'pointercancel', reason: 'lost', ...point, t });
        pressed = false; cancelled = true; detector.cancel(); filter.reset();
      }
      return out;
    }
    if (cancelled) filter.reset();
    cancelled = false;
    lastSeen = t;
    const signalId = frame.signalId ?? frame.signalT ?? t;
    if (signalId !== lastSignalId) {
      point = filter.filter({ x: o.mirrored ? 1 - index.x : index.x, y: index.y }, frame.signalT ?? t);
      lastSignalId = signalId;
    }
    out.push({ type: 'pointermove', ...point, t });
    const { next, openPoint, lost } = detector.update(hand, t, pressed, point);
    if (next && !pressed) out.push({ type: 'pointerdown', ...point, t });
    if (!next && pressed) {
      const legacy = frame.signalT === undefined;
      out.push({ type: lost && !legacy ? 'pointercancel' : 'pointerup', reason: lost ? 'lost' : 'release', ...(openPoint || point), t });
    }
    detector.commit(next, pressed);
    pressed = next;
    return out;
  }

  function reset() { filter.reset(); detector.reset(); point = null; pressed = false; lastSeen = null; cancelled = false; lastSignalId = null; }
  return { update, reset };
}

exports.createHandPointer=createHandPointer;
exports.HAND_POINTER_PRESET=HAND_POINTER_PRESET;
},
68:(module,exports,require)=>{
const { createHandPointer, FINGER_TIPS } = require(67);const { isOpenPalm, isPointing } = require(24);const { createSignalTile } = require(55);const { createArmingGate } = require(23);

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Engine options -> hand-pointer options (one mapping, shared by the tile and tools/pinch-bench.mjs). */
const pinchOptionsOf = o => ({ pinchScale: o.pinchScale, clickFinger: o.clickFinger, scaledOn: o.pinchOn, scaledOff: o.pinchOff,
    requireOpen: o.pinchRequireOpen, releaseMs: o.pinchReleaseMs, snapOpen: o.pinchSnapOpen, lostAfterMs: o.coastMs,
    pinchMetric: o.pinchMetric, pinchReadyOpenMs: o.pinchReadyOpenMs, pinchCloseWithinMs: o.pinchCloseWithinMs, pinchFingerGate: o.pinchFingerGate,
    pinchTipCue: o.pinchTipCue, pinchConfirmMs: o.pinchConfirmMs, createPinch: o.createPinch, sphere: o.sphere,
    pinchChord: o.pinchChord, pinchChordStraightAtLeast: o.pinchChordStraightAtLeast });

/** Stage 3: cursor signal plus hands to dwell, pinch, pause, zoom and ABI events. */
function createInteractionTile(options = {}, suppliedSignal = null, hooks = {}) {
  const o = { dwell: false, dwellMs: 800, dwellRadius: 0.025, pinMs: 200, dwellGraceMs: 0, palmPause: true,
    requirePoint: false, armMs: 100, disarmMs: 300, pinchClick: true, pinchScale: true, clickFinger: 'index', ...options };
  const signal = suppliedSignal || createSignalTile(o);
  const pinchOptions = pinchOptionsOf(o);
  const pointerFactory = hooks.createHandPointer || createHandPointer;
  const primary = pointerFactory(pinchOptions), secondary = pointerFactory(pinchOptions);
  let pinches = [false, false], pinchCancels = [null, null], pressed = false, paused = false, zooming = false, zoomDistance = null;
  let palmSince = null, palmLatched = false, dwellAnchor = null, dwellSince = null, dwellLatched = false, dwellKey = null;
  let pinSince = null, pinnedPoint = null, pinEscaped = false, armed = false, pointSince = null, unpointSince = null;
  let clickHold = null;
  let cancelPress = false; // a zone change cancels an active press at the next frame
  // After a zone change a pinch that is still closed must open before it presses again, so it never clicks in the new area.
  // Per hand: 'first' = the next frame with that hand decides (a pinch detected closed is the held one, an open hand clears it),
  // 'held' = a closed pinch was swallowed and the latch lasts until it opens, is cancelled or the hand is lost.
  let pinchLatch = [false, false];
  const fingerHistory = [{}, {}];
  // Click-intent gates (gate@1): config hands over the factories; every gate must allow a new press. All gates are
  // updated every frame (no short-circuit), so a latch keeps its own clock while another gate says no.
  const gateList = o.createGates ? o.createGates() : o.arming ? [createArmingGate(o.arming)] : [];
  const gate = gateList.length ? {
    update: (t, hand) => gateList.map(g => g.update(t, hand)).every(Boolean),
    noteClick: t => { for (const g of gateList) g.noteClick(t); },
    left: t => Math.min(...gateList.map(g => g.left(t))),
  } : null;

  // Public interaction-port data for optional consumers such as a chord recognizer. This deliberately reports every
  // finger rather than interpreting a chord in core. changedAt is stable until that finger crosses a threshold.
  function samplePinches(hands, t) {
    return hands.map((hand, handIndex) => {
      const thumb = hand[4], scale = distance(hand[0], hand[5]);
      const fingers = {};
      for (const [finger, landmark] of Object.entries(FINGER_TIPS)) {
        const ratio = thumb && hand[landmark] && scale > 0 ? distance(thumb, hand[landmark]) / scale : Infinity;
        const previous = fingerHistory[handIndex][finger];
        const closed = ratio < o.pinchOn ? true : ratio > o.pinchOff ? false : previous?.closed ?? false;
        fingers[finger] = { closed, changedAt: previous?.closed === closed ? previous.changedAt : t, sampledAt: t };
      }
      fingerHistory[handIndex] = fingers;
      return { handIndex, sampledAt: t, fingers };
    });
  }

  function update(frame = {}) {
    let pending = [], pointBeforeFrame;
    const releaseAt = (point, t) => { if (pressed) pending.push({ type: 'pointerup', reason: 'release', ...point, t }); pressed = false; };
    const s = signal.update(frame, { beforeMotion(pre) {
      const { t, hand, hands } = pre;
      pointBeforeFrame = { ...pre.point };
      if (cancelPress) {
        cancelPress = false;
        if (pressed) pending.push({ type: 'pointercancel', reason: 'zone', ...pre.point, t });
        pressed = false; primary.reset(); secondary.reset(); pinches = [false, false]; zooming = false; zoomDistance = null; pinchLatch = ['first', 'first'];
      }
      if (gate) armed = gate.update(t, hand);
      else if (o.requirePoint) {
        if (hand && isPointing(hand)) { unpointSince = null; if (pointSince === null) pointSince = t; if (t - pointSince >= o.armMs) armed = true; }
        else { pointSince = null; if (unpointSince === null) unpointSince = t; if (t - unpointSince >= o.disarmMs) armed = false; }
      } else armed = true;
      const palm = o.palmPause && hands.length === 1 && isOpenPalm(hand);
      if (palm) {
        if (palmSince === null) palmSince = t;
        if (!palmLatched && t - palmSince >= 1000) {
          paused = !paused; palmLatched = true; releaseAt(pre.point, t);
          primary.reset(); secondary.reset(); pinches = [false, false]; zooming = false; zoomDistance = null;
          dwellAnchor = null; dwellSince = null; dwellLatched = false;
        }
      } else { palmSince = null; palmLatched = false; }
      return { paused, pinching: pinches[0] };
    }});
    const { t, hands, hand, hasHand, holding, aim, raw, lastSeen, coastMs } = s;
    let point = s.point, events = [...pending, ...s.events], holdProgress = 0;
    const release = (type = 'pointerup', reason = 'release') => { if (pressed) events.push({ type, reason, ...point, t }); pressed = false; };
    const palm = o.palmPause && hands.length === 1 && isOpenPalm(hand);
    if (!paused) {
      [primary, secondary].forEach((p, i) => {
        const latchPhase = pinchLatch[i]; let swallowed = false;
        for (const e of p.update({ t, signalT: frame.signalT, signalId: frame.signalId, hands: hands[i] ? [hands[i]] : [] })) {
          // A pinch that closes while disarmed stays ignored until it opens again (no click when the window opens mid-pinch).
          // A pinch that closes while disarmed is ignored until it opens again, so the window opening mid-pinch never clicks.
          if (e.type === 'pointerup' || e.type === 'pointercancel') pinchLatch[i] = false;
          if (e.type === 'pointerdown' && pinchLatch[i]) { swallowed = true; pinchLatch[i] = 'held'; continue; }
          if (e.type === 'pointerdown' && armed) { pinches[i] = true; pinchCancels[i] = null; if (i === 0 && (o.pinMs > 0 || o.pinRadius > 0)) { pinSince = t; pinnedPoint = pointBeforeFrame; pinEscaped = false; } }
          if (e.type === 'pointerup') { pinches[i] = false; pinchCancels[i] = null; }
          if (e.type === 'pointercancel') { pinches[i] = false; pinchCancels[i] = e.reason || 'lost'; }
        }
        if (latchPhase === 'first' && hands[i] && !swallowed) pinchLatch[i] = false;
        if (!hands[i] && (i > 0 || lastSeen === null || t - lastSeen > coastMs)) { pinches[i] = false; p.reset(); pinchLatch[i] = false; }
      });
      if (o.pinchClick === false) pinches = [false, false];
      // Onset pin (CURSOR-REAL-1): the press point holds for pinMs, and with pinRadius > 0 also until the cursor moves
      // pinRadius away from it (a drag threshold, like touch slop). Closing a pinch moves the aim 7 to 12 px; without the
      // pin that motion reaches the page as a pressed move, which Chromium can turn into a text drag that eats the release.
      if (pinnedPoint && pinches[0] && o.pinRadius > 0 && !pinEscaped && distance(point, pinnedPoint) > o.pinRadius) pinEscaped = true;
      // The radius pin also covers the release tick (pressed is still true here), so the click ends where it began.
      const pinHeld = pinnedPoint && ((pinches[0] && t - pinSince < o.pinMs) || (o.pinRadius > 0 && !pinEscaped && (pinches[0] || pressed)));
      if (pinHeld) {
        point = { ...pinnedPoint }; signal.replacePoint(point, events);
      } else if (!pinches[0] || t - pinSince >= o.pinMs) { pinSince = null; pinnedPoint = null; }
      if (!hasHand && holding) holdProgress = 0;
      else if (!hasHand) {
        const state = { zooming, zoomDistance };
        if (hooks.releaseLoss) hooks.releaseLoss(release, state, frame); else { release('pointercancel', 'lost'); state.zooming = false; state.zoomDistance = null; }
        ({ zooming, zoomDistance } = state);
        if (lastSeen === null || t - lastSeen > o.dwellGraceMs) { dwellAnchor = null; dwellSince = null; dwellLatched = false; }
      } else if (hands.length === 2 && pinches.every(Boolean)) {
        if (pinchCancels.some(Boolean)) release('pointercancel', pinchCancels.find(Boolean)); else release();
        zooming = true;
        const next = distance(hands[0][8], hands[1][8]);
        if (zoomDistance !== null && next > 0.01 && zoomDistance > 0.01) {
          const deltaY = hooks.wheelDelta ? hooks.wheelDelta(next, zoomDistance) : -600 * Math.log(next / zoomDistance);
          if (Math.abs(deltaY) >= 0.5) events.push({ type: 'wheel', ...point, deltaY: Math.max(-120, Math.min(120, deltaY)), t });
        }
        zoomDistance = next;
      } else if (zooming) {
        if (pinchCancels.some(Boolean)) release('pointercancel', pinchCancels.find(Boolean)); else release();
        zoomDistance = null;
        if (!pinches.some(Boolean)) zooming = false;
      } else {
        if (pinches[0] && !pressed) { events.push({ type: 'pointerdown', ...point, t }); pressed = true; gate?.noteClick(t); }
        if (pinchCancels[0]) release('pointercancel', pinchCancels[0]);
        else if (hooks.releasePinch) hooks.releasePinch(pinches, release); else if (!pinches[0]) release();
        // dwellWhere (0.5.1, Tao 11-16 01:23Z): an app can limit dwell to its own places (cursor: "buttons" = the dwell buttons).
        // Outside them nothing counts, so the fill starts empty and a click can come only from inside one.
        // dwellWhere returns the place's key (a button index, 0 included) or null outside every place. A new key starts a new
        // dwell, so moving from one button straight onto the next inside dwellRadius never carries the fill or a click over.
        const where = o.dwellWhere ? o.dwellWhere(point) : true;
        if (o.dwell && armed && !pinches[0] && !palm && (hands.length === 1 || o.pinchClick === false) && where !== null && where !== undefined && where !== false) {
          if (!dwellAnchor || where !== dwellKey || distance(point, dwellAnchor) > o.dwellRadius) { dwellAnchor = { ...point }; dwellSince = t; dwellLatched = false; dwellKey = where; }
          if (!dwellLatched) holdProgress = Math.min(1, Math.max(0, (t - dwellSince) / o.dwellMs));
          if (!dwellLatched && t - dwellSince >= o.dwellMs) {
            events.push({ type: 'pointerdown', ...point, t }, { type: 'pointerup', reason: 'release', ...point, t }); dwellLatched = true; gate?.noteClick(t);
          }
        } else { dwellAnchor = null; dwellSince = null; dwellLatched = false; dwellKey = null; }
      }
      pinchCancels = [null, null];
    }
    const missingMs = hasHand ? 0 : lastSeen === null ? Infinity : t - lastSeen;
    if (o.multiClickMs > 0 && o.multiClickEscape > 0) {
      if (clickHold && (!raw || distance(raw, clickHold.raw) > o.multiClickEscape || t - clickHold.t >= o.multiClickMs)) clickHold = null;
      if (clickHold) { point = { ...clickHold.point }; signal.replacePoint(point, events); }
      const clicked = events.some(e => e.type === 'pointerup');
      if (clicked && raw) clickHold = { point: { ...point }, raw: { ...raw }, t };
    }
    const pinchStates = samplePinches(hands, t);
    const opacity = paused ? 0.25 : missingMs <= Math.max(300, coastMs) ? 1 : Math.max(0, 1 - (missingMs - Math.max(300, coastMs)) / 400);
    return { events, point: { ...point }, raw, aim, hands, pinchStates, hasHand, holding, pressed, paused, zooming, opacity, missingMs, holdProgress, armed, armLeft: gate ? gate.left(t) : armed ? 1 : 0 };
  }
  // A new active area changes what every stored screen point means. The pin, the dwell in progress and the multi-click
  // hold keep old-zone coordinates, so they are cleared, and a press in progress is cancelled (RT-ANATOMY-CURSOR-2).
  function setZone(zone) {
    const changed = signal.setZone(zone);
    if (changed === false) return false;
    pinSince = null; pinnedPoint = null; pinEscaped = false;
    dwellAnchor = null; dwellSince = null; dwellLatched = false; clickHold = null;
    if (pressed) cancelPress = true;
    return true;
  }
  return { update, setZone };
}

exports.createInteractionTile=createInteractionTile;
exports.pinchOptionsOf=pinchOptionsOf;
},
69:(module,exports,require)=>{
// Stage 0+1 adapter: recorded landmark frames (a golden-master .hands.ndjson track) instead of camera + MediaPipe.
// Same contract as createMediaPipeSource: start() resolves { ok } and onFrame receives
// { t, source, mirrored, pose, hands } in real time, so everything downstream runs exactly as it does live.
// Privacy (sell-thread review 2026-10-29): the track URL comes from extension storage, so only a file packaged with the
// extension (same origin as the panel) may be fetched; anything else is refused before any request is made.
function packagedOnly(url, base = globalThis.location?.href) {
  if (!base) return true;
  // protocol + host, not origin: a chrome-extension: URL's origin can read as the opaque 'null' outside Chrome.
  try { const a = new URL(url, base), b = new URL(base); return a.protocol === b.protocol && a.host === b.host && a.host !== ''; } catch { return false; }
}
// landmarkFrame@2: keep the recorded left/right labels like the camera adapter does; a track without them gives null.
const handednessOf = f => (f.hands ?? []).map((_, i) => (f.handedness?.[i] === 'Left' || f.handedness?.[i] === 'Right' ? f.handedness[i] : null));

function createReplaySource({ url, onFrame, loop = false, fetchImpl = (...a) => fetch(...a), clock = () => performance.now(),
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = id => clearTimeout(id), allowUrl = packagedOnly, catchUp = true } = {}) {
  let frames = null, timer = null, running = false, startedAt = 0, index = 0;
  function pump() {
    if (!running) return;
    const elapsed = clock() - startedAt;
    // A replay is a camera substitute, not a video clock. In the whole-extension gate, preserve every recorded
    // detection when a throttled renderer wakes late. A live camera would produce those detections slowly; emitting
    // an entire overdue burst in one task only overwrites tracker.js's latest-frame slot before it can tick.
    while (index < frames.length && frames[index].t <= elapsed) {
      const f = frames[index++];
      onFrame?.({ t: f.t, source: 'replay', mirrored: f.mirrored !== false, pose: f.pose ?? null, hands: f.hands ?? [], handedness: handednessOf(f), capturedAt: clock(), captureClock: 'replay' });
      if (!catchUp) { startedAt += Math.max(0, elapsed - f.t); break; }
    }
    if (index >= frames.length) {
      if (!loop) { running = false; return; }
      index = 0; startedAt = clock();
    }
    timer = setTimer(pump, Math.max(0, Math.min(33, frames[index].t - (clock() - startedAt))));
  }
  async function start() {
    if (running) return { ok: true };
    try {
      if (!allowUrl(url)) throw new Error('replay track must be packaged with the extension');
      const text = await (await fetchImpl(url)).text();
      frames = text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(f => Number.isFinite(f.t));
      const poseUrl = String(url).replace(/\.hands\.ndjson(?=$|\?)/, '.pose.ndjson');
      if (poseUrl !== String(url)) {
        try {
          const poseText = await (await fetchImpl(poseUrl)).text();
          const poses = poseText.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
          const byTime = new Map(poses.filter(f => Number.isFinite(f.t)).map(f => [f.t, f.pose ?? f.landmarks ?? null]));
          frames = frames.map(f => byTime.has(f.t) ? { ...f, pose: byTime.get(f.t) } : f);
        } catch { /* A companion pose track is optional. */ }
      }
      if (!frames.length) throw new Error('replay track is empty');
    } catch (e) {
      return { ok: false, code: 'ReplayError', message: String(e.message), fallback: 'mouse' };
    }
    running = true; startedAt = clock(); index = 0; pump();
    return { ok: true };
  }
  function stop() { running = false; if (timer !== null) clearTimer(timer); timer = null; }
  return { start, stop, get running() { return running; } };
}

exports.packagedOnly=packagedOnly;
exports.createReplaySource=createReplaySource;
},
70:(module,exports,require)=>{
// UTC: 2026-10-27. Adapted from factory/core/adapters/mediapipe-source.js.
// Camera ownership, error mapping, VIDEO scheduling, and cleanup reuse Tao's source.
// Changes: HandLandmarker, two mirrored hands, local-only assets, dated WASM names.
// External API reference: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_jsconst { STOP_STATUS, stopResult } = require(71);
const CAMERA_RESOLUTIONS = { '360p': { width: 640, height: 360 }, '480p': { width: 640, height: 480 },
  '720p': { width: 1280, height: 720 }, '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 }, '2160p': { width: 3840, height: 2160 } };
const RESOLUTION_ORDER = ['2160p', '1440p', '1080p', '720p', '480p', '360p'];
function autoResolutionStep({ resolution, measuredFps, mode, now, lastChange = -Infinity, aboveSince = null }) {
  const target = mode === 'auto60' ? 60 : mode === 'auto30' ? 30 : 0;
  if (!target) return { resolution, lastChange, aboveSince: null };
  const index = RESOLUTION_ORDER.indexOf(resolution);
  if (now - lastChange < 10000) return { resolution, lastChange, aboveSince };
  if (measuredFps < target && index < RESOLUTION_ORDER.length - 1) return { resolution: RESOLUTION_ORDER[index + 1], lastChange: now, aboveSince: null };
  const since = measuredFps >= target * 1.15 ? (aboveSince ?? now) : null;
  if (since !== null && now - since >= 10000 && index > 0) return { resolution: RESOLUTION_ORDER[index - 1], lastChange: now, aboveSince: null };
  return { resolution, lastChange, aboveSince: since };
}

/** Permit only packaged extension fetches, including the model and WASM. */
function blockTelemetry(scope = typeof window !== 'undefined' ? window : undefined) {
  if (!scope || typeof scope.fetch !== 'function' || scope.fetch.hfoGuard) return false;
  const original = scope.fetch;
  const guarded = function(input, init) {
    try {
      const value = typeof input === 'string' ? input : input?.url || String(input);
      const base = new URL(scope.location.href);
      const target = new URL(value, base);
      if (base.protocol !== 'chrome-extension:' || target.protocol !== base.protocol || target.host !== base.host) {
        return Promise.reject(new TypeError('Only packaged extension assets may be fetched'));
      }
    } catch {
      return Promise.reject(new TypeError('Invalid asset URL'));
    }
    return original.call(this, input, init);
  };
  guarded.hfoGuard = true;
  scope.fetch = guarded;
  return true;
}

const DEFAULT_WASM_PATH = '../../vendor/tasks-vision/wasm';
const DEFAULT_MODEL_PATH = '../../vendor/models/hand_landmarker-20261027UTC.task';
const POSE_MODELS = {
  lite: '../../vendor/models/pose_landmarker_lite-20261029UTC.task',
  full: '../../vendor/models/pose_landmarker_full-20261029UTC.task',
};

function resolveUrl(path) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/')) return path;
  return new URL(path, scriptBase).href;
}

// Turns a getUserMedia / model-load failure into a stable, user-presentable object.
// The tracker displays `message`; the operator can still use the physical mouse.
function describeCameraError(err) {
  const name = (err && err.name) || '';
  const base = { ok: false, fallback: 'mouse', name, detail: err && err.message ? String(err.message) : '' };
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return {
      ...base,
      code: 'camera-denied',
      message: 'Camera access was denied. Hand control needs camera access.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { ...base, code: 'no-camera', message: 'No camera was found. Connect a camera and try Start again.' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { ...base, code: 'camera-busy', message: 'The camera is busy or unavailable. Close other camera apps and try Start again.' };
  }
  if (name === 'UnsupportedError') {
    return {
      ...base,
      code: 'unsupported',
      message: 'Camera capture is unavailable in this browser.',
    };
  }
  if (name === 'ModelLoadError') {
    return { ...base, code: 'model-load-failed', message: 'The local hand model could not load. Reopen the tracker and try Start again.' };
  }
  return { ...base, code: 'camera-error', message: 'The camera could not start. Try Start again.' };
}

function namedError(name, message) {
  const e = new Error(message);
  e.name = name;
  return e;
}

function createMediaPipeSource({
  video,
  modelAssetPath = DEFAULT_MODEL_PATH,
  wasmPath = DEFAULT_WASM_PATH,
  assetsBase,
  loadVision,
  onFrame,
  delegate = 'GPU',
  numHands = 2,
  pose = 'off',
  facingMode = 'user',
  deviceId,
  mirrored = true,
  width = 640,
  height = 480,
  fps,
  auto = 'off',
  resolution = '480p',
  onMetrics,
  gpuCheck = false,
  minDetection = 0.5,
  minPresence = 0.5,
  minTracking = 0.5,
  frameCanvas,
  onDelegateChange,
} = {}) {
  let landmarker = null;
  let lastError = null; // the last per-frame detect error, so a page can say why frames carry no hands
  // GPU self-check (Tao 2026-10-29 19:50Z, Galaxy S25 Ultra): on some phones the GPU delegate runs without errors but
  // never finds a hand (Google's own demo too), while CPU works. Until the GPU has found a hand, a CPU landmarker checks
  // the same frame every 2 s; if CPU sees a hand that GPU missed, the source switches to CPU for good. Off by default
  // (Tao 20:40Z: no automatic switching yet; CPU is the default and GPU a menu choice, calibration will recommend).
  let activeDelegate = delegate, gpuSawHand = false, lastCheck = 0, checking = false, makeLandmarker = null;
  let poseLandmarker = null;
  let stream = null;
  let running = false;
  // Each start() takes a generation and stop() ends it. A start whose generation ended while it awaited the camera
  // prompt or the model stops the tracks it got and reports AbortError, so a late camera grant never keeps the camera on.
  let generation = 0;
  let rafId = null;
  let rvfcId = null;
  let startNow = null;
  let lastVideoTime = -1;
  let samples = [], windowStart = 0, quality = { resolution, lastChange: -Infinity, aboveSince: null };
  const assetUrl = path => {
    if (!assetsBase) return resolveUrl(path);
    const relative = path.startsWith('../../vendor/') ? path.slice('../../vendor/'.length) : path;
    return new URL(relative, assetsBase).href;
  };

  function releaseCamera() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (video) video.srcObject = null;
  }

  let firstDetect = null;

  function toFrame(result, poseResult, now) {
    const hands = (result?.landmarks || []).map(hand => hand.map(p => ({
      x: mirrored ? 1 - p.x : p.x, y: p.y, z: p.z || 0, visibility: 1,
    })));
    const body = poseResult?.landmarks?.[0]?.map(p => ({ x: mirrored ? 1 - p.x : p.x, y: p.y, z: p.z || 0, visibility: p.visibility ?? 1 })) ?? null;
    // MediaPipe's label per hand ('Left' | 'Right'); the anatomy scene needs it to draw the matching left or right hand.
    const handedness = hands.map((_, i) => { const v = result?.handedness?.[i]?.[0]?.categoryName; return v === 'Left' || v === 'Right' ? v : 'Right'; });
    return { t: now - startNow, source: 'camera', mirrored, pose: body, hands, handedness };
  }

  function process(now, meta) {
    if (!running || !landmarker) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      let nextFrame;
      try {
        // MediaPipe needs a strictly increasing timestamp; `now` is the display clock.
        const detectStart = performance.now();
        // frameCanvas (Tao 2026-10-29 22:41Z, Galaxy S25: the raw landmark dots sat off his hand in the very frame they
        // came from). The model read the <video> directly, and on Android that upload can differ from what drawImage
        // shows (a camera crop to the asked aspect, rotation, coded-size padding). With frameCanvas the frame is drawn
        // once with drawImage and the model reads that canvas, so the landmarks are normalized to the exact pixels shown.
        let input = video;
        if (frameCanvas) {
          if (frameCanvas.width !== video.videoWidth || frameCanvas.height !== video.videoHeight) { frameCanvas.width = video.videoWidth; frameCanvas.height = video.videoHeight; }
          frameCanvas.getContext('2d').drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height); input = frameCanvas;
        }
        const result = landmarker.detectForVideo(input, now);
        if (result?.landmarks?.length) gpuSawHand = true;
        else if (activeDelegate === 'GPU' && gpuCheck && !gpuSawHand && !checking && now - lastCheck >= 2000) crossCheck(now);
        const poseResult = poseLandmarker?.detectForVideo(input, now) ?? null;
        samples.push(performance.now() - detectStart);
        if (!windowStart) windowStart = now;
        if (now - windowStart >= 3000) {
          const elapsed = now - windowStart, sorted = [...samples].sort((a, b) => a - b);
          const metrics = { fps: samples.length * 1000 / elapsed, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
            width: video.videoWidth, height: video.videoHeight };
          onMetrics?.(metrics);
          const next = autoResolutionStep({ ...quality, measuredFps: metrics.fps, mode: auto, now });
          if (next.resolution !== quality.resolution) stream?.getVideoTracks?.()[0]?.applyConstraints?.({
              width: { ideal: CAMERA_RESOLUTIONS[next.resolution].width }, height: { ideal: CAMERA_RESOLUTIONS[next.resolution].height },
          });
          quality = next;
          samples = []; windowStart = now;
        }
        nextFrame = toFrame(result, poseResult, now);
        // Real-hand latency (charter P1): when the camera took this image, on the performance clock. Chrome gives
        // captureTime for camera streams; otherwise the frame callback time is the closest we have (it is later).
        nextFrame.capturedAt = Number.isFinite(meta?.captureTime) ? meta.captureTime : now;
        nextFrame.captureClock = Number.isFinite(meta?.captureTime) ? 'camera' : 'callback';
        if (firstDetect) { firstDetect(); firstDetect = null; }
      } catch (err) {
        // A single bad frame must not kill the loop; report it as a dropout.
        lastError = String(err && err.message ? err.message : err);
        nextFrame = { t: now - startNow, source: 'camera', mirrored, pose: null, hands: null };
      }
      try { if (onFrame) onFrame(nextFrame); } catch (err) { lastError = String(err?.message || err); }
    }
    schedule();
  }

  async function crossCheck(now) {
    checking = true; lastCheck = now;
    try {
      const cpu = await makeLandmarker('CPU');
      // A new graph: the frame clock it starts on only has to rise from here, which the loop's later frames do.
      const probe = running && video.readyState >= 2 ? cpu.detectForVideo(frameCanvas || video, now) : null;
      if (running && activeDelegate === 'GPU' && !gpuSawHand && probe?.landmarks?.length) {
        try { landmarker.close(); } catch { /* ignore */ }
        landmarker = cpu; activeDelegate = 'CPU';
        onDelegateChange?.({ from: 'GPU', to: 'CPU', reason: 'gpu-empty' });
      } else cpu.close();
    } catch (err) { lastError = String(err && err.message ? err.message : err); }
    lastCheck = performance.now(); checking = false;
  }

  function schedule() {
    if (!running) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      rvfcId = video.requestVideoFrameCallback((now, meta) => {
        if (startNow === null) startNow = now;
        process(now, meta);
      });
    } else {
      rafId = requestAnimationFrame((now) => {
        if (startNow === null) startNow = now;
        process(now);
      });
    }
  }

  // Resolves { ok: true } once frames are flowing, or { ok: false, code, message, fallback }.
  async function start() {
    if (running) return { ok: true };
    const gen = ++generation;
    let own = null;
    const alive = () => { if (gen !== generation) throw namedError('AbortError', 'the camera was stopped while it was starting'); };
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw namedError('UnsupportedError', 'navigator.mediaDevices.getUserMedia is not available');
      }
      if (!video) throw namedError('UnsupportedError', 'no <video> element given');
      const videoConstraints = { facingMode, width: { ideal: width }, height: { ideal: height } };
      if (deviceId) videoConstraints.deviceId = { exact: deviceId };
      if (fps !== undefined && fps !== 'max') videoConstraints.frameRate = { ideal: fps };
      own = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      alive();
      stream = own;
      if (fps === 'max') {
        const track = stream.getVideoTracks?.()[0], maximum = track?.getCapabilities?.().frameRate?.max;
        if (maximum) await track.applyConstraints({ frameRate: { ideal: maximum } });
      }
      try {
        if (!assetsBase) blockTelemetry();
        const vision = await (loadVision ? loadVision() : import(resolveUrl('../../vendor/tasks-vision/vision_bundle.mjs')));
        const fileset = await vision.FilesetResolver.forVisionTasks(assetUrl(wasmPath));
        // Binary filenames carry UTC without modifying the WASM bytes.
        fileset.wasmBinaryPath = fileset.wasmBinaryPath.replace('.wasm', '-20261027UTC.wasm');
        const create = (Cls, path, extra, use) => Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath: assetUrl(path), delegate: use }, runningMode: 'VIDEO', ...extra });
        const make = async (Cls, path, extra) => {
          try { return await create(Cls, path, extra, delegate); }
          catch { if (Cls === vision.HandLandmarker) activeDelegate = 'CPU'; return create(Cls, path, extra, 'CPU'); }
        };
        const handOptions = { numHands, minHandDetectionConfidence: minDetection, minHandPresenceConfidence: minPresence, minTrackingConfidence: minTracking };
        // Models load into locals and are kept only if this start is still current: a stale start's late model must not
        // replace a newer start's model, which a later stop() could then never close (RT-ANATOMY-APP-1 round 4).
        const hand = await make(vision.HandLandmarker, modelAssetPath, handOptions);
        if (gen !== generation) { try { hand.close(); } catch {} alive(); }
        const body = pose !== 'off' ? await make(vision.PoseLandmarker, POSE_MODELS[pose], { numPoses: 1 }) : null;
        if (gen !== generation) { for (const m of [hand, body]) try { m?.close(); } catch {} alive(); }
        makeLandmarker = use => create(vision.HandLandmarker, modelAssetPath, handOptions, use);
        landmarker = hand;
        if (body) poseLandmarker = body;
      } catch (err) {
        alive();
        throw namedError('ModelLoadError', err && err.message ? err.message : 'model load failed');
      }
      alive();
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      alive();
      running = true;
      startNow = null;
      lastVideoTime = -1;
      // The first detect compiles the GPU graph and can block the page for seconds. Wait for it here, before the
      // caller attaches to a tab, so the session watchdog (2 s without frames) never sees that stall.
      const warmed = new Promise(resolve => { firstDetect = resolve; });
      schedule();
      await Promise.race([warmed, new Promise(resolve => setTimeout(resolve, 20000))]);
      firstDetect = null;
      if (!running) throw namedError('AbortError', 'camera stopped while the hand model was warming up');
      return { ok: true };
    } catch (err) {
      // A start that a stop() overtook only releases what it got itself; a newer start may own the source by now.
      if (gen !== generation) { for (const track of own?.getTracks?.() ?? []) track.stop(); return describeCameraError(namedError('AbortError', 'the camera was stopped while it was starting')); }
      stop();
      return describeCameraError(err);
    }
  }

  function stop() {
    generation++;
    const tracks = stream?.getTracks?.() ?? [];
    const modelErrors = [];
    running = false;
    if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
    if (rvfcId !== null && video && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(rvfcId);
    }
    rafId = null;
    rvfcId = null;
    if (landmarker) {
      try {
        landmarker.close();
      } catch (e) {
        modelErrors.push(String(e?.message || e));
      }
      landmarker = null;
    }
    if (poseLandmarker) { try { poseLandmarker.close(); } catch (e) { modelErrors.push(String(e?.message || e)); } poseLandmarker = null; }
    releaseCamera();
    const trackStates = tracks.map(track => track.readyState || 'UNKNOWN');
    return stopResult([
      { step: 'camera tracks', status: trackStates.every(state => state === 'ended') ? STOP_STATUS.CLEAN : STOP_STATUS.UNVERIFIED,
        detail: tracks.length ? `readyState after stop: ${trackStates.join(', ')}` : 'no owned tracks' },
      { step: 'model close', status: modelErrors.length ? STOP_STATUS.PARTIAL : STOP_STATUS.CLEAN,
        detail: modelErrors.join('; ') || 'hand and pose models closed or not open' },
    ]);
  }

  return {
    start,
    stop,
    get lastError() {
      return lastError;
    },
    get delegate() {
      return activeDelegate;
    },
    get running() {
      return running;
    },
  };
}

exports.autoResolutionStep=autoResolutionStep;
exports.blockTelemetry=blockTelemetry;
exports.describeCameraError=describeCameraError;
exports.createMediaPipeSource=createMediaPipeSource;
},
71:(module,exports,require)=>{
// Port contracts (docs/SEAMS.md). Each port has a version and a conformance check. A tile may import this file;
// it imports nothing. Changing a contract means bumping its version here and in docs/SEAMS.md.
const finite = (...v) => v.every(Number.isFinite);
const fail = (port, why) => ({ ok: false, port, why });
const pass = port => ({ ok: true, port });

const PORTS = Object.freeze({
  camera: 'camera@1',             // source: { start() -> {ok}, stop() } calling onFrame(LandmarkFrame)
  landmarkFrame: 'landmarkFrame@2', // { t, source, mirrored, pose, hands: [21 x {x, y, z}], handedness?: ['Left'|'Right'|null, parallel to hands] }
  signal: 'signal@1',             // stage: { update({t, point}) -> {t, x, y, vx, vy, state}, reset() }
  interaction: 'interaction@1',   // tile: { update(LandmarkFrame) -> state with Pointer ABI events }, fed by a signal tile
  engine: 'engine@1',             // machine: { update(LandmarkFrame) -> EngineState, setZone(zone) }
  pointer: 'pointer@1',           // Pointer ABI events (POINTER-ABI.md)
  injector: 'injector@1',         // dispatcher: { dispatch(event, viewport) -> commands[], release(viewport) }
  visualization: 'visualization@1', // { port, sanitize(raw) -> clean|null, bootstrap, draw(clean) -> string, remove }
  stopResult: 'stop.result@1',       // { ok, steps: [{ step, status: CLEAN | PARTIAL | UNVERIFIED, detail }] }
});

const STOP_STATUS = Object.freeze({ CLEAN: 'CLEAN', PARTIAL: 'PARTIAL', UNVERIFIED: 'UNVERIFIED' });
function stopResult(steps) {
  const clean = steps.every(step => step.status === STOP_STATUS.CLEAN);
  // Deliberate negative-control switch used only by the C-stop gate.
  const okRegardless = globalThis.process?.env?.TB_STOP_OK_REGARDLESS === '1';
  return { port: PORTS.stopResult, ok: okRegardless || clean, steps };
}

function checkStopResult(value) {
  if (value?.port !== PORTS.stopResult || !Array.isArray(value.steps) || !value.steps.length) return fail(PORTS.stopResult, 'needs steps');
  if (value.steps.some(s => typeof s?.step !== 'string' || !Object.values(STOP_STATUS).includes(s.status) || typeof s.detail !== 'string')) return fail(PORTS.stopResult, 'bad step');
  if (value.ok !== value.steps.every(s => s.status === STOP_STATUS.CLEAN)) return fail(PORTS.stopResult, 'ok must mean every step is CLEAN');
  return pass(PORTS.stopResult);
}

function checkLandmarkFrame(f) {
  if (!f || !finite(f.t) || typeof f.mirrored !== 'boolean' || !Array.isArray(f.hands)) return fail(PORTS.landmarkFrame, 'needs t, mirrored, hands');
  for (const h of f.hands) if (!Array.isArray(h) || h.length !== 21 || !h.every(p => p && finite(p.x, p.y))) return fail(PORTS.landmarkFrame, 'each hand has 21 finite points');
  // @2 (seed step 4, hex audit O3): handedness is optional; when present it is parallel to hands, one label per hand.
  if (f.handedness !== undefined) {
    if (!Array.isArray(f.handedness) || f.handedness.length !== f.hands.length) return fail(PORTS.landmarkFrame, 'handedness has one entry per hand');
    if (f.handedness.some(v => v !== 'Left' && v !== 'Right' && v !== null)) return fail(PORTS.landmarkFrame, 'handedness entries are Left, Right or null');
  }
  return pass(PORTS.landmarkFrame);
}

function checkCameraSource(s) {
  return s && typeof s.start === 'function' && typeof s.stop === 'function' ? pass(PORTS.camera) : fail(PORTS.camera, 'needs start() and stop()');
}

const POINTER_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel'];
function checkPointerEvent(e) {
  if (!e || !POINTER_TYPES.includes(e.type)) return fail(PORTS.pointer, `type ${e?.type}`);
  if (!finite(e.x, e.y) || e.x < 0 || e.x > 1 || e.y < 0 || e.y > 1) return fail(PORTS.pointer, 'x, y finite in 0..1');
  if (e.button !== undefined && !['left', 'right', 'middle'].includes(e.button)) return fail(PORTS.pointer, 'button must be left, right or middle');
  if (e.type === 'wheel' && !finite(e.deltaY)) return fail(PORTS.pointer, 'wheel needs deltaY');
  return pass(PORTS.pointer);
}

function checkEngineState(s) {
  if (!s || !Array.isArray(s.events) || !s.point || !finite(s.point.x, s.point.y) || typeof s.hasHand !== 'boolean') return fail(PORTS.engine, 'needs events[], point, hasHand');
  for (const e of s.events) { const r = checkPointerEvent(e); if (!r.ok) return r; }
  return pass(PORTS.engine);
}

function checkInjector(d) {
  return d && typeof d.dispatch === 'function' && typeof d.release === 'function' ? pass(PORTS.injector) : fail(PORTS.injector, 'needs dispatch() and release()');
}

function checkVisualization(v) {
  if (!v || v.port !== PORTS.visualization) return fail(PORTS.visualization, `port must be ${PORTS.visualization}`);
  if (typeof v.sanitize !== 'function' || typeof v.draw !== 'function' || typeof v.bootstrap !== 'string' || typeof v.remove !== 'string') return fail(PORTS.visualization, 'needs sanitize(), draw(), bootstrap, remove');
  return pass(PORTS.visualization);
}

exports.stopResult=stopResult;
exports.checkStopResult=checkStopResult;
exports.checkLandmarkFrame=checkLandmarkFrame;
exports.checkCameraSource=checkCameraSource;
exports.checkPointerEvent=checkPointerEvent;
exports.checkEngineState=checkEngineState;
exports.checkInjector=checkInjector;
exports.checkVisualization=checkVisualization;
exports.PORTS=PORTS;
exports.STOP_STATUS=STOP_STATUS;
}},cache={};const require=id=>{if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};modules[id](module,module.exports,require);return module.exports};global.PosePointer=require(0).PosePointer;})(window);
