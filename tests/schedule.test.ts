import { describe, it, expect } from 'vitest';
import { FetchScheduler } from '../src/schedule.js';

describe('FetchScheduler', () => {
  it('is ready for an unknown server', () => {
    expect(new FetchScheduler(15000, 300000, () => 1000).ready('s1')).toBe(true);
  });

  it('stays ready while fetches succeed', () => {
    const s = new FetchScheduler(15000, 300000, () => 1000);
    s.recordSuccess('s1', null);
    expect(s.ready('s1')).toBe(true);
  });

  it('holds off after a failure', () => {
    let now = 1000;
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordFailure('s1');
    expect(s.ready('s1')).toBe(false);
    now = 1000 + 15000;
    expect(s.ready('s1')).toBe(true);
  });

  it('doubles the delay on consecutive failures', () => {
    const s = new FetchScheduler(15000, 300000, () => 0);
    expect(s.delayFor(1)).toBe(15000);
    expect(s.delayFor(2)).toBe(30000);
    expect(s.delayFor(3)).toBe(60000);
  });

  it('caps the delay', () => {
    const s = new FetchScheduler(15000, 60000, () => 0);
    expect(s.delayFor(10)).toBe(60000);
  });

  it('resets the backoff after a success', () => {
    let now = 1000;
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordFailure('s1');
    s.recordFailure('s1');
    now = 1000 + 300000;
    s.recordSuccess('s1', null);
    s.recordFailure('s1');
    expect(s.delayFor(1)).toBe(15000);
    now = now + 15000;
    expect(s.ready('s1')).toBe(true);
  });

  it('honours throttledUntil from Warcon', () => {
    let now = Date.parse('2026-09-21T14:32:00.000Z');
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordSuccess('s1', '2026-09-21T14:32:30.000Z');
    expect(s.ready('s1')).toBe(false);
    now += 31000;
    expect(s.ready('s1')).toBe(true);
  });

  it('ignores a throttledUntil in the past', () => {
    const now = Date.parse('2026-09-21T14:32:00.000Z');
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordSuccess('s1', '2026-09-21T14:00:00.000Z');
    expect(s.ready('s1')).toBe(true);
  });

  it('ignores an unparseable throttledUntil', () => {
    const now = 1000;
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordSuccess('s1', 'not-a-date');
    expect(s.ready('s1')).toBe(true);
  });

  it('keeps servers independent', () => {
    let now = 1000;
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordFailure('s1');
    expect(s.ready('s1')).toBe(false);
    expect(s.ready('s2')).toBe(true);
  });
});
