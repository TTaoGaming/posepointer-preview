// Copyright Tao. All rights reserved.
import { launchArgs } from './core/launch-args.js';
import { checkBinding, checkProfile, checkTuning } from './core/profile-check.js';
import { parseParams, effectiveConfig } from './core/url-params.js';

export function loadLegacyBinding(fetchJson) {
  return fetchJson('./bindings/gcompris-web.fingertip-dwell.json');
}

export async function loadAppConfig({ fetchJson, search }) {
  const [binding, profile, tuning] = await Promise.all([
    fetchJson('./binding.json'), fetchJson('./profile.json'), fetchJson('../play/tuning.json')
  ]);
  const errors = [...checkBinding(binding), ...checkProfile(profile), ...checkTuning(tuning)];
  if (errors.length) throw new Error(errors.join(', '));
  const { settings, ignored } = parseParams(search, tuning);
  const config = effectiveConfig(binding, settings, tuning);
  const args = launchArgs(profile, { silent: config.silent, level: config.level, locale: config.locale });
  return { binding, profile, tuning, settings, ignored, config, args };
}
