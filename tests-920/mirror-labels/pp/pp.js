// PosePointer loader, pp@1. The only PosePointer tag an app carries:
//   <script src="/pp/pp.js" data-app="my-app" data-autostart data-preset="pinch-palm-ready" data-view="pip" data-assets="vendor/"></script>
// It reads versions.json beside it with no-store, picks apps[data-app] or the default, and adds the matching
// /pp/pose-pointer-X.Y.Z.js with the same data-* options. Swapping or rolling back any app is one edit to versions.json,
// with no app change. ?pp=X.Y.Z on the page URL tries a listed version for that visit only.
// window.PosePointerReady resolves to { PosePointer, version, source } once the package has run; it rejects if it cannot load.
(() => {
  const FALLBACK = '0.1.6'; // used only when versions.json cannot be read; a test keeps it equal to versions.json default
  const me = document.currentScript, base = new URL('.', me.src), ok = v => /^\d+\.\d+\.\d+$/.test(v || '');
  window.PosePointerReady = (async () => {
    let table = null;
    try { const r = await fetch(new URL('versions.json', base), { cache: 'no-store' }); if (r.ok) table = await r.json(); } catch {}
    const listed = v => ok(v) && (!table || (table.versions || []).includes(v));
    const asked = new URLSearchParams(location.search).get('pp');
    let version = table?.apps?.[me.dataset.app] ?? table?.default ?? FALLBACK, source = table ? 'versions.json' : 'fallback';
    if (asked && listed(asked)) { version = asked; source = '?pp'; }
    if (!listed(version)) throw new Error(`PosePointer ${version} is not a listed version`);
    const tag = document.createElement('script');
    for (const [k, v] of Object.entries(me.dataset)) if (k !== 'app') tag.dataset[k] = v;
    tag.dataset.posepointer = '';
    tag.src = new URL(`pose-pointer-${version}.js`, base).href;
    await new Promise((resolve, reject) => { tag.onload = resolve; tag.onerror = () => reject(new Error(`PosePointer ${version} did not load`)); me.after(tag); });
    window.PosePointerVersion = version;
    return { PosePointer: window.PosePointer, version, source };
  })();
  window.PosePointerReady.catch(() => {}); // callers await it; an unhandled rejection here would only add console noise
})();
