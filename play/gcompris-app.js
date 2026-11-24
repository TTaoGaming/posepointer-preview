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
    const directory = new URL('.', url).href;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        frame.removeEventListener('load', loaded);
        reject(new Error('GCompris page load timed out.'));
      }, profile.start.timeoutMs);
      function loaded() {
        const loadedUrl = frame.contentDocument?.URL;
        if (loadedUrl !== url.href && loadedUrl !== directory) return;
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
  function readyCanvas() {
    const target = doc.querySelector(profile.start.ready) && canvas();
    if (!target) throw new Error('GCompris canvas unavailable during startup dialogs.');
    return target;
  }
  const { sweep } = profile;
  const sweepInsets = sweep.insets.map(inset => inset * ratio);
  for (const step of profile.startupDialogs) {
    const target = readyCanvas();
    const rect = target.getBoundingClientRect();
    const layout = rect.width < rect.height ? 'portrait' : 'landscape';
    const inset = step.layouts[layout].closeCenterInset * ratio;
    const insets = [...new Set([inset, ...sweepInsets])];
    const before = await readDialogPaint(win, target, context, insets);
    if (step.onlyIfVisible && !before?.close) continue;
    // Qt can clear the drawing buffer before sampling. Keep the stock ordered
    // close points for the two known dialogs when there is no readable paint.
    sink.closeDialog(target, before?.close ?? { right: inset, top: inset });
    await delay(step.waitAfterCloseMs);
    if (before?.close) {
      const next = readyCanvas();
      const after = await readDialogPaint(win, next, context, insets);
      if (after?.close && before.content.every((channel, i) => Math.abs(channel - after.content[i]) < 8)) {
        sink.closeDialog(next, after.close);
        await delay(step.waitAfterCloseMs);
      }
    }
  }

  for (let round = 0; round < sweep.maxRounds; round++) {
    const target = readyCanvas();
    const paint = await readDialogPaint(win, target, context, sweepInsets);
    if (paint?.close) {
      sink.closeDialog(target, paint.close);
      await delay(sweep.waitAfterCloseMs);
    } else if (paint) {
      break;
    } else {
      // A cleared buffer says nothing about which dialogs are visible.
      await delay(sweep.waitAfterCloseMs);
    }
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
        const content = sample(width / 4, height / 4, width / 2, height / 2, 16);
        if (!content.some((channel, i) => i % 4 !== 3 && channel > 0)) return resolve(null);
        // Stock GCButtonCancel paints a white X on #d94444. Probe close to
        // the scaled QML position in both axes for closely spaced layouts.
        for (const inset of insets) {
          for (const [right, top] of [[inset, inset], [inset * .8, inset], [inset * 1.2, inset],
            [inset, inset * .8], [inset, inset * 1.2]]) {
            const radius = inset * .7;
            if (right + radius > width || top + radius > height) continue;
            const icon = sample(width - right - radius, top - radius, 2 * radius, 2 * radius, 5);
            const white = [48, 49, 50].every(i => icon[i] > 230);
            const red = [2, 10, 14, 22].filter(i => [217, 68, 68].every((value, channel) =>
              Math.abs(icon[4 * i + channel] - value) < 22));
            if (white && red.length >= 3) return resolve({ close: { right, top }, content });
          }
        }
        resolve({ content });
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
