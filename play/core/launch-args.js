// Copyright Tao. All rights reserved.
export function launchArgs(profile, { silent, level, locale } = {}) {
  const { game, commonArgs, muteArg } = profile.launch;
  const args = ['--launch', game, ...commonArgs];
  if (silent === true) args.push(muteArg);
  if (Number.isInteger(level)) args.push('--start-level', String(level));
  if (typeof locale === 'string') args.push('--locale', locale);
  return args;
}
