import { describe, it, expect } from 'vitest';
import { bar, formatSlots, contextLine, truncate, fitLines, topPlayers, hhmmUtc } from '../src/render.js';
import type { WarconPlayer, WarconStatus } from '../src/types.js';

describe('formatSlots', () => {
  it('adds reserved slots on top of the public cap', () => {
    expect(formatSlots(99, 100, 2)).toBe('99 / 100 +1 reserved online');
  });
  it('hides the suffix when nobody is in an overflow slot', () => {
    expect(formatSlots(40, 100, 2)).toBe('40 / 100');
  });
  it('handles a server with no reserved slots', () => {
    expect(formatSlots(40, 100, 0)).toBe('40 / 100');
  });
  it('treats an unknown reserved count as zero', () => {
    expect(formatSlots(40, 100, null)).toBe('40 / 100');
  });
  it('handles an empty server', () => {
    expect(formatSlots(0, 100, 2)).toBe('0 / 100');
  });
  it('handles a full server with every reserved slot taken', () => {
    expect(formatSlots(100, 100, 2)).toBe('100 / 100 +2 reserved online');
  });
  it('clamps when reserved slots exceed the cap', () => {
    expect(formatSlots(3, 2, 5)).toBe('3 / 2 +3 reserved online');
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

describe('topPlayers', () => {
  const players = (...rows: Array<[string, number, number]>): WarconPlayer[] =>
    rows.map(([name, kills, deaths]) => ({ name, steamId: '', faction: null, kills, deaths, cash: 0, ping: null }));

  it('sorts by kills descending', () => {
    const top = topPlayers(players(['low', 1, 0], ['high', 9, 0]));
    expect(top.map((p) => p.name)).toEqual(['high', 'low']);
  });
  it('breaks kill ties on fewer deaths', () => {
    const top = topPlayers(players(['many', 5, 9], ['few', 5, 1]));
    expect(top.map((p) => p.name)).toEqual(['few', 'many']);
  });
  it('breaks remaining ties on name', () => {
    const top = topPlayers(players(['zed', 5, 5], ['alice', 5, 5]));
    expect(top.map((p) => p.name)).toEqual(['alice', 'zed']);
  });
  it('returns at most five', () => {
    expect(topPlayers(players(['a',1,0],['b',2,0],['c',3,0],['d',4,0],['e',5,0],['f',6,0]))).toHaveLength(5);
  });
  it('does not mutate its input', () => {
    const input = players(['a', 1, 0], ['b', 9, 0]);
    topPlayers(input);
    expect(input[0]!.name).toBe('a');
  });
  it('handles an empty roster', () => {
    expect(topPlayers([])).toEqual([]);
  });
});

describe('contextLine', () => {
  const status: WarconStatus = {
    serverName: 'NA#2 - TEG.gg',
    map: 'NorthAmerica',
    experiences: ['NorthAmerica_KOTH_01'],
    lighting: 'DayClear',
    alternator: 'ZoneAlternator.NorthAmerica.Houses.Circle',
    scoreCap: null,
    matchSeconds: null,
    playerCount: 99,
    maxPlayers: 100,
    scores: []
  };

  it('renders the four-part line from the screenshot', () => {
    expect(contextLine(status)).toBe('Zestafona · Day Clear · King of the Hill · Zestafona Houses Circle');
  });

  it('omits parts that are unknown', () => {
    expect(contextLine({ ...status, lighting: '', experiences: [] }))
      .toBe('Zestafona · Zestafona Houses Circle');
  });
});

describe('hhmmUtc', () => {
  it('formats as zero-padded UTC hours and minutes', () => {
    expect(hhmmUtc(Date.parse('2026-09-21T14:32:00.000Z'))).toBe('14:32');
    expect(hhmmUtc(Date.parse('2026-09-21T04:05:00.000Z'))).toBe('04:05');
  });
});
