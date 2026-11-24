const clamp = n => Math.max(0, Math.min(1, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const validHand = hand => Array.isArray(hand) && hand.length === 21 &&
  Array.from(hand).every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));

export const allInFrame = hand => validHand(hand) &&
  hand.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);

export function pinchRatio(hand, tip = 8, metric = '2d') {
  const depth = p => Number.isFinite(p.z) ? p.z : 0;
  const measure = metric === '3d'
    ? (a, b) => Math.hypot(a.x - b.x, a.y - b.y, depth(a) - depth(b))
    : distance;
  const scale = measure(hand[0], hand[9]);
  return scale > 0 ? measure(hand[4], hand[tip]) / scale : Infinity;
}

const defaults = {
  arm_required: false, arm_hold_ms: 800, armed_ms: 1000, lost_ms: 300,
  close_ratio: 0.25, open_ratio: 0.40, confirm_ms: 100, pinch_click: true,
  dwell: false, dwell_ms: 800, dwell_radius: 0.035, dwell_grace_ms: 300, dwell_press_ms: 50,
  fps_floor_min_frames: 10, fps_floor_window_ms: 1000,
};

/** A hand slot consumes timestamped samples and returns its transitions for that input. */
export function createClock(profile = {}) {
  const p = { ...defaults, ...profile };
  const stages = p.arm_stages ?? (p.arm_required ? [{
    holdMs: p.arm_hold_ms, armedMs: p.armed_ms, refreshOnClick: p.refresh_on_click, disarmMs: p.disarm_ms,
  }] : []);
  const arming = stages.map(stage => ({ ...stage, start: null, off: null, until: -Infinity }));
  let lastT = -Infinity;
  let lastFrame = null;
  let lastValid = null;
  let lastPoint = { x: 0.5, y: 0.5 };
  let lossHandled = false;
  let lowFps = false;
  let focusLost = false;
  let firstFrame = null;
  const frames = [];
  let requireOpen = p.require_open === true;
  let zoneChanged = false;
  let closure = null;
  let press = null;
  let anchor = null;
  let paused = false;
  let pauseSince = null;
  let pauseLatched = false;
  let clickHold = null;
  let openRun = null, openLength = 0, openAt = -Infinity;
  let pendingOpen = null;
  const fingers = {};
  const contact = p.create_contact?.();
  const detector = p.create_detector?.();
  const gates = p.create_gates?.() ?? [];
  let gatesAllow = true;

  const accepts = t => Number.isFinite(t) && t > lastT;
  const pastLoss = t => lastValid !== null && t - lastValid > p.lost_ms;
  const armed = t => arming.every(stage => t < stage.until) && gatesAllow;
  const pointer = (type, t, point, fields) => ({ type, t, ...point, ...fields });

  function release(events, t, point) {
    events.push(pointer('pointerup', t, point, { reason: 'release', source: press.source }));
    press = null;
    for (const stage of arming) {
      if (stage.refreshOnClick !== false && t < stage.until) stage.until = t + stage.armedMs;
    }
    for (const gate of gates) gate.noteClick(t);
  }

  function releaseDue(events, t) {
    if (press?.source === 'dwell' && !p.dwell_toggle && t >= press.t + p.dwell_press_ms) release(events, t, press.point);
  }

  function reset(events, t, reason) {
    requireOpen ||= !!closure || !!press || p.require_open === true;
    if (press) events.push(pointer('pointercancel', t, lastPoint, { reason }));
    press = null;
    breakArming(true);
    if (gates.length) gatesAllow = false;
    for (const gate of gates) gate.reset?.();
    closure = null;
    anchor = null;
    openRun = null;
    openLength = 0;
    openAt = -Infinity;
    pendingOpen = null;
    clickHold = null;
    contact?.reset();
    detector?.reset();
    for (const name of Object.keys(fingers)) delete fingers[name];
  }

  function breakArming(disarm = false) {
    for (const stage of arming) {
      stage.start = null;
      stage.off = null;
      if (disarm) stage.until = -Infinity;
    }
  }

  function floor(t) {
    if (!p.fps_floor_min_frames) return false;
    firstFrame ??= t;
    frames.push(t);
    while (frames.length && t - frames[0] >= p.fps_floor_window_ms) frames.shift();
    return t - firstFrame >= p.fps_floor_window_ms && frames.length < p.fps_floor_min_frames;
  }

  function updateArming(t, sample) {
    arming.forEach((stage, i) => {
      if (sample.armPoses?.[i] ?? sample.armPose ?? sample.palm) {
        stage.start ??= t;
        if (t > stage.start && t - stage.start >= stage.holdMs) stage.until = t + stage.armedMs;
      } else {
        stage.start = null;
      }
      if (sample.disarmPoses?.[i]) {
        stage.off ??= t;
        if (t - stage.off >= stage.disarmMs) stage.until = -Infinity;
      } else {
        stage.off = null;
      }
    });
  }

  function startPress(events, t, source, point) {
    press = { source, point, t, pinned: source === 'pinch' };
    events.push(pointer('pointerdown', t, point, { source }));
  }

  function fireDwell(events, t) {
    if (anchor && !anchor.latched && (!press || p.dwell_toggle) && t - anchor.t >= p.dwell_ms) {
      if (press) release(events, t, anchor.point);
      else startPress(events, t, 'dwell', anchor.point);
      anchor.latched = true;
    }
  }

  function updateDwell(events, t, sample) {
    const key = sample.dwellKey;
    if ((!armed(t) && !(p.dwell_toggle && press)) || sample.allowPress === false || sample.palm || key === null || key === false) {
      anchor = null;
      return;
    }
    if (!anchor || key !== anchor.key || distance(sample.point, anchor.point) > p.dwell_radius) {
      anchor = { point: sample.point, t, key, latched: false };
    }
    fireDwell(events, t);
  }

  function nextClosed(ratio, closed) {
    if (ratio < p.close_ratio) return true;
    if (ratio > p.open_ratio) return false;
    return closed;
  }

  function trackOpening(t, ratio) {
    if (ratio > p.open_ratio) {
      requireOpen = false;
      openRun ??= t;
      openAt = t;
      openLength = t - openRun;
    } else {
      openRun = null;
    }
    if (ratio < p.close_ratio) pendingOpen = null;
  }

  function releasePosition(t, ratio, point) {
    if (!(p.release_ms > 0) || ratio > p.snap_open) return point;
    pendingOpen ??= { t, point };
    return t - pendingOpen.t >= p.release_ms ? pendingOpen.point : null;
  }

  function updateDetector(t, hand, point) {
    const wasClosed = !!closure;
    const detected = detector.update(hand, t, wasClosed, point);
    detector.commit(detected.next, wasClosed);
    return detected;
  }

  function updatePinch(events, t, sample) {
    const { point, hand } = sample;
    const finger = closure?.finger ?? sample.finger;
    const ratio = finger ? sample.ratios[finger] : sample.ratio;
    const touching = contact?.update(hand, hand[4], t);
    const detected = detector ? updateDetector(t, hand, point) : null;
    trackOpening(t, ratio);
    const closed = detected?.next ?? (touching || nextClosed(ratio, !!closure));
    if (!closed || pendingOpen) {
      if (!closed && !p.require_open) requireOpen = false;
      if (press?.source === 'pinch') {
        const end = detected ? detected.openPoint || point : releasePosition(t, ratio, point);
        if (!end) {
          events.push(pointer('pointermove', t, point));
          return;
        }
        release(events, t, end);
      }
      closure = null;
      pendingOpen = null;
      return;
    }
    closure ??= { t, point, finger, decided: false };
    if (press?.source === 'pinch') {
      events.push(pointer('pointermove', t, point));
    } else if (!closure.decided && (!contact || touching) && sample.shapeAllowed !== false &&
               !(p.ready_open_ms > openLength) && !(t - openAt > (p.close_within_ms || Infinity)) &&
               ((p.instant_confirm && p.confirm_ms === 0) || (t > closure.t && t - closure.t >= p.confirm_ms))) {
      closure.decided = true;
      closure.confirmed = (detected || !requireOpen) && armed(t) && sample.allowPress !== false;
      if (closure.confirmed && p.pinch_click) startPress(events, t, 'pinch', closure.point);
    }
  }

  function updateFingers(t, ratios = {}) {
    for (const [name, ratio] of Object.entries(ratios)) {
      const prior = fingers[name];
      const closed = nextClosed(ratio, prior?.closed ?? false);
      fingers[name] = { closed, changedAt: prior?.closed === closed ? prior.changedAt : t, sampledAt: t };
    }
  }

  function advance(t, sample, isFrame) {
    const events = [];
    if (!accepts(t)) return { accepted: false, events };
    lastT = t;
    releaseDue(events, t);

    let resetReason = null;
    if (!lossHandled && pastLoss(t)) {
      lossHandled = true;
      resetReason = 'lost';
    }
    if (isFrame) {
      lastFrame = t;
      focusLost = false;
      const below = floor(t);
      if (below) resetReason = 'lost';
      if (zoneChanged && !resetReason) resetReason = 'zone';
      zoneChanged = false;

      // Loss and floor cancel at the position of the previous valid sample.
      if (resetReason) reset(events, t, resetReason);
      const resetAfter = events.length;
      const valid = validHand(sample?.hand) && Number.isFinite(sample.point?.x) && Number.isFinite(sample.point?.y);
      if (valid) {
        lastPoint = { x: sample.point.x, y: sample.point.y };
        lastValid = t;
        lossHandled = false;
        sample = { ...sample, point: lastPoint };
      }
      if (below && !lowFps) events.push({ type: 'status', t, code: 'low_fps' });
      lowFps = below;
      gatesAllow = gates.map(gate => gate.update(t, valid && !below ? sample.hand : null)).every(Boolean);
      if (!valid || below) {
        breakArming();
        pauseSince = null;
        pauseLatched = false;
        return { accepted: true, events, resetReason, resetAfter, sampled: false };
      }

      updateArming(t, sample);
      updateFingers(t, sample.ratios);
      if (p.palm_pause && sample.pausePalm) {
        pauseSince ??= t;
        if (!pauseLatched && t - pauseSince >= 1000) {
          paused = !paused;
          if (press) release(events, t, lastPoint);
          closure = null;
          anchor = null;
          pauseLatched = true;
        }
      } else {
        pauseSince = null;
        pauseLatched = false;
      }
      if (!paused) {
        if (p.dwell) updateDwell(events, t, sample);
        else updatePinch(events, t, sample);
      }
      return { accepted: true, events, resetReason, resetAfter, sampled: true };
    }

    if (resetReason) reset(events, t, resetReason);
    const resetAfter = events.length;
    if (p.dwell && !paused && lastValid !== null && t - lastValid <= p.dwell_grace_ms && (armed(t) || (p.dwell_toggle && press))) {
      fireDwell(events, t);
    }
    return { accepted: true, events, resetReason, resetAfter };
  }

  function terminal(t, reason) {
    const events = [];
    if (!Number.isFinite(t)) return { accepted: false, events };
    reset(events, t, reason);
    zoneChanged = false;
    paused = false;
    pauseSince = null;
    pauseLatched = false;
    const resetAfter = events.length;
    if (reason === 'focus') {
      focusLost = true;
      events.push({ type: 'status', t, code: 'focus_lost' });
    }
    return { accepted: true, events, resetReason: reason, resetAfter };
  }

  function layer(t) {
    const lost = pastLoss(t);
    return {
      cursor: { ...lastPoint, pressed: !!press, armed: armed(lastFrame ?? -Infinity),
        progress: anchor && !anchor.latched ? clamp((lastFrame - anchor.t) / p.dwell_ms) : 0 },
      hasSample: lastValid !== null,
      status: lowFps ? 'low_fps' : focusLost ? 'focus_lost' : lost ? 'lost' : null,
      lost,
    };
  }

  function motion(t, point, raw, events, visible) {
    const missingMs = visible ? 0 : lastValid === null ? Infinity : t - lastValid;
    const fadeStart = Math.max(300, p.lost_ms);
    if (p.multi_click_ms > 0 && p.multi_click_escape > 0) {
      if (clickHold && (!raw || distance(raw, clickHold.raw) > p.multi_click_escape ||
          t - clickHold.t >= p.multi_click_ms)) clickHold = null;
      if (clickHold) point = clickHold.point;
      if (raw && events.some(e => e.type === 'pointerup')) clickHold = { t, point, raw };
    }
    if (press?.pinned) {
      if (p.pin_radius > 0 && distance(point, press.point) > p.pin_radius) press.pinned = false;
      if (t - press.t < p.pin_ms || (p.pin_radius > 0 && press.pinned)) point = press.point;
    }
    const windows = arming.map(stage => Number.isFinite(stage.armedMs)
      ? clamp((stage.until - t) / stage.armedMs) : Number(t < stage.until));
    return { point, missingMs, opacity: paused ? 0.25 : clamp(1 - (missingMs - fadeStart) / 400),
      paused, armed: armed(t), armLeft: Math.min(1, ...windows, ...gates.map(gate => gate.left(t))) };
  }

  return {
    accepts,
    frame: (t, sample) => advance(t, sample, true),
    tick: t => advance(t, null, false),
    stop: t => terminal(t, 'stop'),
    focusLost: t => terminal(t, 'focus'),
    setZone() { zoneChanged = true; },
    releaseForWheel(t) {
      const events = [];
      if (press?.source === 'pinch') {
        if (press.t === t) press = null;
        else release(events, t, lastPoint);
      }
      return events;
    },
    get pinching() { return !!closure?.confirmed; },
    get fingers() { return { ...fingers }; },
    layer,
    motion,
  };
}
