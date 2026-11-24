// Copyright Tao. All rights reserved.
const numeric = /^-?\d+(\.\d+)?$/;
const localeName = /^[a-z]{2,3}_[A-Z]{2}$/;
const hasRule = (params, name) => Object.hasOwn(params, name) && !Object.hasOwn(Object.prototype, name);

function parseValue(value, rule) {
  if (rule.type === 'flag') return value === '1' ? true : value === '0' ? false : undefined;
  if (value !== value.trim()) return undefined;
  if (rule.type === 'locale') return localeName.test(value) ? value : undefined;
  if ((rule.type === 'int' || rule.type === 'float') && numeric.test(value)) {
    const number = rule.type === 'int' ? Math.round(Number(value)) : Number(value);
    return Math.max(rule.min, Math.min(rule.max, number));
  }
}

export function parseParams(search = '', spec) {
  const seen = new Set();
  const entries = [];
  const ignored = [];
  for (const [name, raw] of new URLSearchParams(search.split('#', 1)[0])) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (!hasRule(spec.params, name)) {
      ignored.push(name);
      continue;
    }
    const rule = spec.params[name];
    const value = parseValue(raw, rule);
    if (value !== undefined) entries.push([rule.key, value]);
  }
  return { settings: Object.fromEntries(entries), ignored };
}

export function effectiveConfig(binding, settings, _spec) {
  const { interaction, overlays, safety } = binding;
  const get = key => Object.hasOwn(settings, key) ? settings[key] : undefined;
  const dwell = { ...interaction.tap.dwell };
  for (const key of ['dwellMs', 'settleMs', 'settlePx', 'leaveRadius', 'drainRate']) {
    dwell[key] = get(key) ?? dwell[key];
  }
  if (dwell.leaveRadius <= dwell.enterRadius) dwell.leaveRadius = dwell.enterRadius + 0.005;
  return {
    mode: 'pen',
    dwell,
    pen: structuredClone(interaction.pen),
    touchQuietMs: interaction.touchQuietMs,
    mirror: get('mirror') ?? overlays.find(overlay => overlay.id === 'mirror').opacity,
    silent: get('silent') === true,
    level: get('level'),
    locale: get('locale'),
    safety: structuredClone(safety)
  };
}

export function buildLink(href, settings, spec) {
  const params = new URLSearchParams();
  for (const name of Object.keys(spec.params)) {
    if (!hasRule(spec.params, name)) continue;
    const { type, key } = spec.params[name];
    if (Object.hasOwn(settings, key) && settings[key] !== undefined) {
      params.set(name, type === 'flag' ? Number(settings[key]) : settings[key]);
    }
  }
  const query = params.toString();
  return href.split(/[?#]/, 1)[0] + (query ? `?${query}` : '');
}
