// Copyright Tao. All rights reserved.
import { checkDwellConfig, dwellRanges } from './dwell-core.js';
import { checkKeys, inRange } from './input-rules.js';
import { checkPenConfig } from './pen-core.js';
import { validQuietMs } from './touch-wins.js';

const tuningRules = {
  dwell: ['int', 'dwellMs'], settle: ['int', 'settleMs'], settledist: ['float', 'settlePx'],
  leave: ['float', 'leaveRadius'], drain: ['float', 'drainRate'], mirror: ['float', 'mirror'],
  silent: ['flag', 'silent'], level: ['int', 'level'], locale: ['locale', 'locale']
};
const nonemptyString = value => typeof value === 'string' && value.trim().length > 0;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const positive = value => Number.isFinite(value) && value > 0;

export function checkTuning(tuning) {
  const errors = checkKeys(tuning, ['schema', 'params'], 'tuning');
  if (tuning?.schema !== 1) errors.push('tuning schema must be 1');
  errors.push(...checkKeys(tuning?.params, Object.keys(tuningRules), 'tuning params'));
  for (const [name, [type, key]] of Object.entries(tuningRules)) {
    const rule = tuning?.params?.[name];
    const numeric = type === 'int' || type === 'float';
    errors.push(...checkKeys(rule, numeric ? ['type', 'key', 'min', 'max'] : ['type', 'key'], name));
    if (rule?.type !== type || rule?.key !== key) errors.push(`${name} must use ${type} and target ${key}`);
    const validBound = type === 'int' ? Number.isInteger : Number.isFinite;
    const [min, max] = dwellRanges[key] ?? (key === 'mirror' ? [0, 1] : [1, Number.MAX_SAFE_INTEGER]);
    if (numeric && (!validBound(rule?.min) || !validBound(rule?.max) || rule.min > rule.max ||
        rule.min < min || rule.max > max)) {
      errors.push(`${name} has invalid bounds`);
    }
  }
  return errors;
}

export function checkBinding(binding) {
  const errors = checkKeys(binding, [
    'schema', 'product', 'app', 'sense', 'cursor', 'filter', 'interaction', 'sink', 'overlays', 'safety'
  ], 'binding');
  if (binding?.schema !== 1 || binding.product !== 'posepointer-classroom' || binding.app !== 'gcompris-web') {
    errors.push('binding must describe PosePointer Classroom and GCompris');
  }
  if (!['mediapipe-hands', 'external-frames'].includes(binding?.sense?.id)) errors.push('invalid sense adapter');
  if (binding?.sense?.id === 'mediapipe-hands' &&
      (binding.sense.hands !== 1 || binding.sense.pose !== 'off' ||
       !['standard', 'low'].includes(binding.sense.camera?.profile) ||
       !['CPU', 'GPU'].includes(binding.sense.delegate))) errors.push('invalid hand camera configuration');
  if (binding?.cursor?.id !== 'fingertip' || ![4, 8, 12, 16, 20].includes(binding.cursor.tip)) {
    errors.push('invalid fingertip configuration');
  }
  const filter = binding?.filter;
  if (filter?.id !== 'one-euro' || !inRange(filter.predictionMs, 0, 100) ||
      (filter.minCutoffHz !== undefined && !positive(filter.minCutoffHz))) {
    errors.push('invalid cursor filter');
  }
  if (binding?.sink?.id !== 'dom-mouse-pointer') errors.push('invalid sink adapter');

  const interaction = binding?.interaction;
  errors.push(...checkKeys(interaction, ['id', 'hand', 'mode', 'touchQuietMs', 'pen', 'tap'], 'interaction'));
  if (interaction?.id !== 'modes' || interaction.mode !== 'pen') errors.push('interaction must use modes and pen');
  if (!['right', 'left', 'either'].includes(interaction?.hand)) errors.push('invalid interaction hand');
  if (!validQuietMs(interaction?.touchQuietMs)) errors.push('invalid touchQuietMs');
  errors.push(...checkKeys(interaction?.tap, ['dwell'], 'tap'));
  errors.push(...checkPenConfig(interaction?.pen), ...checkDwellConfig(interaction?.tap?.dwell));

  const overlays = binding?.overlays;
  if (!Array.isArray(overlays) || overlays.some(item => !['mirror', 'hand-skin', 'cursor-ring'].includes(item?.id))) {
    errors.push('invalid overlays');
  } else {
    const ids = overlays.map(item => item.id);
    if (new Set(ids).size !== ids.length) errors.push('duplicate overlays');
    if (!inRange(overlays.find(item => item.id === 'mirror')?.opacity, 0, 1)) errors.push('invalid mirror opacity');
    if (overlays.find(item => item.id === 'hand-skin')?.skin !== 'wireframe' || !ids.includes('cursor-ring')) {
      errors.push('overlays must include the wireframe and cursor ring');
    }
  }
  const safety = binding?.safety;
  errors.push(...checkKeys(safety, ['activeHandLock', 'killSwitch', 'stallRelease', 'stallMs'], 'safety'));
  if (safety?.activeHandLock !== true || safety.killSwitch !== true || safety.stallRelease !== true ||
      !Number.isInteger(safety.stallMs) || !inRange(safety.stallMs, 50, 500)) errors.push('invalid binding safety');
  return errors;
}

export function checkProfile(profile) {
  const errors = checkKeys(profile, [
    'copyright', 'iframeUrl', 'shadowRoot', 'canvas', 'start', 'firstRun', 'startupDialogs', 'sweep', 'launch'
  ], 'profile');
  if (profile?.iframeUrl !== '../play/gcompris/index.html') errors.push('profile must use the stock iframe URL');
  if (!nonemptyString(profile?.shadowRoot) || !nonemptyString(profile?.canvas)) errors.push('invalid canvas selectors');
  const start = profile?.start;
  if (!['selector', 'ready', 'loadMessage'].every(key => nonemptyString(start?.[key])) ||
      !positive(start?.timeoutMs)) errors.push('invalid start configuration');
  if (!nonemptyString(profile?.firstRun?.qtLogPrefix) || !nonnegative(profile?.firstRun?.waitAfterReadyMs)) {
    errors.push('invalid first-run configuration');
  }
  if (!Array.isArray(profile?.startupDialogs) || profile.startupDialogs.some(step =>
    !nonnegative(step?.waitAfterCloseMs) ||
    !['landscape', 'portrait'].every(layout => positive(step?.layouts?.[layout]?.closeCenterInset)))) {
    errors.push('invalid startup dialogs');
  }
  const sweep = profile?.sweep;
  if (!Number.isInteger(sweep?.maxRounds) || !nonnegative(sweep.maxRounds) ||
      !nonnegative(sweep.waitAfterCloseMs) || !Array.isArray(sweep.insets) || !sweep.insets.every(positive)) {
    errors.push('invalid startup sweep');
  }
  const launch = profile?.launch;
  errors.push(...checkKeys(launch, ['game', 'commonArgs', 'muteArg'], 'launch'));
  if (launch?.game !== 'drawletters' || launch.muteArg !== '--mute') errors.push('invalid letter tracer launch');
  if (!Array.isArray(launch?.commonArgs) || !launch.commonArgs.every(nonemptyString) ||
      !launch.commonArgs.includes('--hide-home-button') || launch.commonArgs.includes(launch.muteArg)) {
    errors.push('launch arguments must hide the stock Home button and keep sound on by default');
  }
  return errors;
}
