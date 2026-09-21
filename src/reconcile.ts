import type { Presentation } from './render.js';

export type Changes = Partial<Presentation>;

/**
 * Only fields whose text actually changed. PATCH /applications/@me has no
 * documented rate limit, so an unchanged bio must never be rewritten.
 */
export function diff(desired: Presentation, applied: Partial<Presentation>): Changes {
  const changes: Changes = {};
  if (desired.nickname !== applied.nickname) changes.nickname = desired.nickname;
  if (desired.activity !== applied.activity) changes.activity = desired.activity;
  if (desired.bio !== applied.bio) changes.bio = desired.bio;
  return changes;
}
