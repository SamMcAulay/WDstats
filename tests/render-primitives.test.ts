import { describe, it, expect } from 'vitest';
import { bar, reservedOverflow, truncate, fitLines, hhmmUtc } from '../src/render.js';

describe('reservedOverflow', () => {
  it('counts the players sitting in reserved slots', () => {
    expect(reservedOverflow(99, 100, 2)).toBe(1);
  });
  it('is zero when the public cap is not exceeded', () => {
    expect(reservedOverflow(40, 100, 2)).toBe(0);
  });
  it('is zero for a server with no reserved slots', () => {
    expect(reservedOverflow(40, 100, 0)).toBe(0);
  });
  it('treats an unknown reserved count as zero', () => {
    expect(reservedOverflow(40, 100, null)).toBe(0);
  });
  it('is zero on an empty server', () => {
    expect(reservedOverflow(0, 100, 2)).toBe(0);
  });
  it('counts every reserved slot on a full server', () => {
    expect(reservedOverflow(100, 100, 2)).toBe(2);
  });
  it('clamps when reserved slots exceed the cap', () => {
    expect(reservedOverflow(3, 2, 5)).toBe(3);
  });
});

describe('bar', () => {
  it('fills completely for the leader', () => {
    expect(bar(33, 33)).toBe('▰▰▰▰▰▰▰▰▰▰');
  });
  it('scales the others against the leader', () => {
    expect(bar(26, 33)).toBe('▰▰▰▰▰▰▰▰▱▱');
    expect(bar(24, 33)).toBe('▰▰▰▰▰▰▰▱▱▱');
  });
  it('renders an empty bar at zero', () => {
    expect(bar(0, 33)).toBe('▱▱▱▱▱▱▱▱▱▱');
  });
  it('renders an empty bar when every score is zero', () => {
    expect(bar(0, 0)).toBe('▱▱▱▱▱▱▱▱▱▱');
  });
  it('is always exactly BAR_WIDTH characters', () => {
    for (const score of [0, 1, 7, 15, 32, 33]) {
      expect([...bar(score, 33)]).toHaveLength(10);
    }
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('short', 20)).toBe('short');
  });
  it('shortens long text with an ellipsis', () => {
    expect(truncate('a'.repeat(30), 20)).toBe('a'.repeat(19) + '…');
    expect(truncate('a'.repeat(30), 20)).toHaveLength(20);
  });
});

describe('fitLines', () => {
  it('joins lines that fit', () => {
    expect(fitLines(['one', 'two'], 400)).toBe('one\ntwo');
  });
  it('drops whole trailing lines rather than cutting mid-line', () => {
    expect(fitLines(['aaaa', 'bbbb', 'cccc'], 9)).toBe('aaaa\nbbbb');
  });
  it('hard-truncates a single over-long line', () => {
    expect(fitLines(['a'.repeat(20)], 10)).toHaveLength(10);
  });
});



describe('hhmmUtc', () => {
  it('formats as zero-padded UTC hours and minutes', () => {
    expect(hhmmUtc(Date.parse('2026-09-21T14:32:00.000Z'))).toBe('14:32');
    expect(hhmmUtc(Date.parse('2026-09-21T04:05:00.000Z'))).toBe('04:05');
  });
});
