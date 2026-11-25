// Adapter registry. One adapter per file: adapters/<port>/<name>.js, default-exporting a plain object.
// An unknown or broken name falls back to the port's default and says so in `note`.
export const PORT_NAMES = {
  skin: ['sky', 'glass'],
  cursor: ['ring', 'dot-ring', 'comet', 'star'],
  finish: ['dots', 'clean-letter'],
  juice: ['calm', 'party', 'off']
};
export const DEFAULTS = { skin: 'glass', cursor: 'comet', finish: 'clean-letter', juice: 'party' };
export const PORTS = Object.keys(DEFAULTS);
const cache = {};
export async function loadAdapter(port, name) {
  const want = String(name ?? DEFAULTS[port]);
  try {
    if (!/^[a-z0-9-]+$/.test(want)) throw new Error('bad name');
    const key = port + '/' + want;
    cache[key] ??= (await import(`./adapters/${port}/${want}.js`)).default;
    if (!cache[key] || typeof cache[key] !== 'object') throw new Error('no default export');
    return { name: want, adapter: cache[key], note: '' };
  } catch {
    const d = DEFAULTS[port], key = port + '/' + d;
    cache[key] ??= (await import(`./adapters/${port}/${d}.js`)).default;
    return { name: d, adapter: cache[key], note: `${port} "${want}" not found, using ${d}` };
  }
}
export async function loadAll(names) {
  const out = {}, notes = [], used = {};
  for (const p of PORTS) { const r = await loadAdapter(p, names[p]); out[p] = r.adapter; used[p] = r.name; if (r.note) notes.push(r.note); }
  return { adapters: out, names: used, notes };
}
