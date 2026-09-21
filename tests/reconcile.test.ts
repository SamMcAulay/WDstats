import { describe, it, expect } from 'vitest';
import { diff } from '../src/reconcile.js';
import type { Presentation } from '../src/render.js';

const desired: Presentation = { nickname: 'TEG - NA 2', activity: '99 / 100', bio: 'Join code: abc' };

describe('diff', () => {
  it('returns everything when nothing has been applied', () => {
    expect(diff(desired, {})).toEqual(desired);
  });

  it('returns nothing when everything matches', () => {
    expect(diff(desired, { ...desired })).toEqual({});
  });

  it('returns only the changed field', () => {
    expect(diff(desired, { ...desired, activity: '98 / 100' })).toEqual({ activity: '99 / 100' });
  });

  it('suppresses the bio when only the activity moved', () => {
    const changes = diff(desired, { ...desired, activity: 'Manticore 33' });
    expect(changes.bio).toBeUndefined();
    expect(changes.nickname).toBeUndefined();
  });

  it('detects a bio change on its own', () => {
    const changes = diff(desired, { ...desired, bio: 'Join code: old' });
    expect(changes).toEqual({ bio: 'Join code: abc' });
  });

  it('treats an empty string as a real value, not missing', () => {
    expect(diff({ ...desired, bio: '' }, { ...desired, bio: '' })).toEqual({});
  });
});
