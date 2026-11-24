// Copyright Tao. All rights reserved.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createApp(frame, profile) {
  const canvas = () => {
    const root = frame.contentDocument?.querySelector(profile.shadowRoot)?.shadowRoot;
    const canvases = [...(root?.querySelectorAll(profile.canvas) ?? [])];
    return canvases.reduce((largest, current) => {
      const area = current.clientWidth * current.clientHeight;
      return area > (largest ? largest.clientWidth * largest.clientHeight : 0) ? current : largest;
    }, null);
  };
  const app = { frame, canvas };
  let started;

  async function boot(sink) {
    const url = new URL(profile.iframeUrl, document.baseURI);
    if (url.origin !== location.origin) throw new Error('GCompris needs a same-origin URL.');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        frame.removeEventListener('load', loaded);
        reject(new Error('GCompris page load timed out.'));
      }, profile.start.timeoutMs);
      function loaded() {
        if (frame.contentDocument?.URL !== url.href) return;
        clearTimeout(timer);
        frame.removeEventListener('load', loaded);
        resolve();
      }
      frame.addEventListener('load', loaded);
      frame.src = url.href;
    });

    const doc = frame.contentDocument;
    const button = doc.querySelector(profile.start.selector);
    if (!button) throw new Error(`Missing GCompris start button: ${profile.start.selector}`);
    const win = frame.contentWindow;
    prepareStockApp(win);
    const firstRun = profile.firstRun;
    const log = win.console.log;
    let firstRunInfo;
    win.console.log = (...parts) => {
      const line = parts.map(String).join(' ');
      const match = line.includes(firstRun.qtLogPrefix) && line.match(/run #(\d+), ratio=([\d.]+)/);
      if (match) firstRunInfo = { run: Number(match[1]), ratio: Number(match[2]) };
      log.apply(win.console, parts);
    };

    try {
      button.click();
      const deadline = performance.now() + profile.start.timeoutMs;
      let readyAt;
      while (performance.now() < deadline) {
        const message = doc.querySelector(profile.start.loadMessage)?.textContent;
        if (message?.startsWith('Load error:')) throw new Error(message);
        const target = doc.querySelector(profile.start.ready) && canvas();
        if (target) {
          readyAt ??= performance.now();
          // The QML load timer creates the welcome dialog in the first session.
          if (performance.now() - readyAt >= firstRun.waitAfterReadyMs) {
            if (!firstRunInfo || firstRunInfo.run === 1) {
              await dismissStartupDialogs(win, doc, canvas, sink, profile, firstRunInfo?.ratio || 1);
            }
            return;
          }
        }
        await delay(50);
      }
      throw new Error('GCompris canvas startup timed out.');
    } finally {
      win.console.log = log;
    }
  }

  return { ...app, start: sink => started ??= boot(sink) };
}

async function dismissStartupDialogs(win, doc, canvas, sink, profile, ratio) {
  const probe = doc.createElement('canvas');
  probe.width = probe.height = 16;
  const context = probe.getContext('2d', { willReadFrequently: true });
  const sweep = profile.sweep;
  const scanInsets = sweep.insets.map(inset => inset * ratio);
  const readyCanvas = () => {
    const target = doc.querySelector(profile.start.ready) && canvas();
    if (!target) throw new Error('GCompris canvas unavailable during startup dialogs.');
    return target;
  };

  for (const step of profile.startupDialogs) {
    const target = readyCanvas();
    const layout = target.clientWidth < target.clientHeight ? 'portrait' : 'landscape';
    const inset = step.layouts[layout].closeCenterInset * ratio;
    const candidates = [...new Set([inset, ...scanInsets])];
    const before = await readDialogPaint(win, target, context, candidates);
    // Retain the ordered fallback when Qt clears the buffer before it can be read.
    const close = before?.inset ?? (before || step.onlyIfVisible ? null : inset);
    if (close === null) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      sink.closeDialog(readyCanvas(), close);
      await delay(step.waitAfterCloseMs);
      const after = await readDialogPaint(win, readyCanvas(), context, [close]);
      if (after?.inset == null || (step.verify === 'content-changed' &&
          !before?.content.every((channel, i) => Math.abs(channel - after.content[i]) < 8))) break;
    }
  }

  for (let round = 0; round < sweep.maxRounds; round++) {
    const target = readyCanvas();
    const match = await readDialogPaint(win, target, context, scanInsets);
    if (match?.inset != null) sink.closeDialog(target, match.inset);
    await delay(sweep.waitAfterCloseMs);
  }
}

function readDialogPaint(win, canvas, context, insets) {
  return new Promise(resolve => {
    const frame = win.requestAnimationFrame(() => {
      clearTimeout(timer);
      const { width, height } = canvas.getBoundingClientRect();
      if (!context || !canvas.width || !canvas.height || !width || !height) return resolve(null);
      const sample = (x, y, w, h, size) => {
        context.clearRect(0, 0, 16, 16);
        context.drawImage(canvas, x * canvas.width / width, y * canvas.height / height,
          w * canvas.width / width, h * canvas.height / height, 0, 0, size, size);
        return context.getImageData(0, 0, size, size).data;
      };
      try {
        // Stock GCButtonCancel paints a white X on #d94444 at the inset from the QML geometry.
        const inset = insets.find(candidate => {
          if (candidate <= 0 || 1.7 * candidate > Math.min(width, height)) return false;
          const icon = sample(width - 1.7 * candidate, .3 * candidate, 1.4 * candidate, 1.4 * candidate, 5);
          const white = [48, 49, 50].every(i => icon[i] > 230);
          const red = [2, 10, 14, 22].filter(i => [217, 68, 68].every((value, channel) =>
            Math.abs(icon[4 * i + channel] - value) < 22));
          return white && red.length >= 3;
        });
        const content = sample(width / 4, height / 4, width / 2, height / 2, 16);
        const readable = content.some((channel, i) => i % 4 !== 3 && channel > 0);
        resolve(inset !== undefined || readable ? { inset, content } : null);
      } catch {
        resolve(null);
      }
    });
    const timer = setTimeout(() => {
      win.cancelAnimationFrame(frame);
      resolve(null);
    }, 150);
  });
}

function prepareStockApp(win) {
  // The stock launcher registers a cache worker and mounts IndexedDB. Keep
  // those two operations out of the hosted session and leave Qt's MEMFS in use.
  Object.defineProperty(win.navigator, 'serviceWorker', { value: { register: async () => undefined } });
  const create = win.createGComprisApp;
  if (typeof create !== 'function') throw new Error('Missing GCompris Qt entry point.');
  win.createGComprisApp = function (config) {
    config.preRun = config.preRun.filter(step => step.name !== 'mountPersistentStorage');
    return create.call(this, config);
  };

  // Cover Qt's network entry points on static hosts that ignore _headers.
  const isLocal = resource => new URL(resource?.url ?? resource, win.location.href).origin === win.location.origin;
  const fetch = win.fetch.bind(win);
  win.fetch = (resource, options) => isLocal(resource)
    ? fetch(resource, { ...options, redirect: 'error' })
    : Promise.reject(new TypeError('GCompris resource is outside this site.'));
  const open = win.XMLHttpRequest.prototype.open;
  win.XMLHttpRequest.prototype.open = function (method, url, ...args) {
    if (!isLocal(url)) throw new TypeError('GCompris resource is outside this site.');
    return open.call(this, method, url, ...args);
  };
}
