import { describe, it, expect } from 'vitest';
import { render, ROTATING_PHASES, SLOTS_ONLY_PHASES, renderName, offlineText, BIO_MAX, NICK_MAX } from '../src/render.js';
import type { Policy } from '../src/render.js';
import type { Snapshot } from '../src/store.js';
import type { WarconLive, WarconPlayer, WarconStatus } from '../src/types.js';

function status(overrides: Partial<WarconStatus> = {}): WarconStatus {
  return {
    serverName: 'NA#2 - TEG.gg',
    map: 'NorthAmerica',
    experiences: ['NorthAmerica_KOTH_01'],
    lighting: 'DayClear',
    alternator: 'ZoneAlternator.NorthAmerica.Houses.Circle',
    scoreCap: null,
    matchSeconds: null,
    playerCount: 99,
    maxPlayers: 100,
    scores: [
      { name: 'Manticore', colorHex: '#4caf50', score: 33 },
      { name: 'Valkyra', colorHex: '#f44336', score: 26 },
      { name: 'Lonestar', colorHex: '#2196f3', score: 24 }
    ],
    ...overrides
  };
}

function player(name: string, kills: number, deaths: number): WarconPlayer {
  return { name, steamId: '', faction: null, kills, deaths, cash: 0, ping: null };
}

function live(overrides: Partial<WarconLive> = {}): WarconLive {
  return {
    serverId: 's1',
    ok: true,
    error: '',
    tier: 'hot',
    build: 'CL-501228',
    gameServerId: '7f3a9c21-4e88-4b1a-9d02-6c5e1f0a8b77',
    startedAt: null,
    reservedSlots: 2,
    throttledUntil: null,
    status: status(),
    players: [player('PlayerOne', 24, 7), player('PlayerTwo', 19, 11), player('PlayerThree', 17, 9)],
    observedAt: '2026-09-21T14:32:00.000Z',
    ...overrides
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    serverId: 's1',
    live: live(),
    fresh: true,
    lastOkAt: Date.parse('2026-09-21T14:32:00.000Z'),
    lastError: null,
    ...overrides
  };
}

const standard: Policy = {
  bioMode: 'factions',
  activityPhases: SLOTS_ONLY_PHASES,
  nameTemplate: '{name}',
  joinCodeFallback: null
};

const variant: Policy = {
  bioMode: 'scoreboard',
  activityPhases: ROTATING_PHASES,
  nameTemplate: 'TEG - NA 2',
  joinCodeFallback: null
};

describe('render — standard bots', () => {
  it('shows slots as the activity', () => {
    expect(render(snapshot(), standard, 0).activity).toBe('99 / 100 +1 reserved online');
  });

  it('ignores the tick', () => {
    for (const tick of [0, 1, 2, 3, 99]) {
      expect(render(snapshot(), standard, tick).activity).toBe('99 / 100 +1 reserved online');
    }
  });

  it('builds the faction bio with the join code first', () => {
    expect(render(snapshot(), standard, 0).bio).toBe(
      [
        'Join code: 7f3a9c21-4e88-4b1a-9d02-6c5e1f0a8b77',
        '▰▰▰▰▰▰▰▰▰▰ 33 Manticore',
        '▰▰▰▰▰▰▰▰▱▱ 26 Valkyra',
        '▰▰▰▰▰▰▰▱▱▱ 24 Lonestar',
        'Zestafona · Day Clear · King of the Hill · Zestafona Houses Circle'
      ].join('\n')
    );
  });

  it('takes the nickname from the live server name', () => {
    expect(render(snapshot(), standard, 0).nickname).toBe('NA#2 - TEG.gg');
  });
});

describe('render — bot 1 variant', () => {
  it('cycles slots three times then each faction once', () => {
    const activities = [0, 1, 2, 3, 4, 5].map((t) => render(snapshot(), variant, t).activity);
    expect(activities).toEqual([
      '99 / 100 +1 reserved online',
      '99 / 100 +1 reserved online',
      '99 / 100 +1 reserved online',
      'Manticore 33',
      'Valkyra 26',
      'Lonestar 24'
    ]);
  });

  it('wraps around after six ticks', () => {
    expect(render(snapshot(), variant, 6).activity).toBe(render(snapshot(), variant, 0).activity);
    expect(render(snapshot(), variant, 9).activity).toBe('Manticore 33');
  });

  it('lists the top five with the join code first', () => {
    expect(render(snapshot(), variant, 0).bio).toBe(
      [
        'Join code: 7f3a9c21-4e88-4b1a-9d02-6c5e1f0a8b77',
        '1. PlayerOne 24-7',
        '2. PlayerTwo 19-11',
        '3. PlayerThree 17-9'
      ].join('\n')
    );
  });

  it('uses its configured literal nickname', () => {
    expect(render(snapshot(), variant, 0).nickname).toBe('TEG - NA 2');
  });

  it('says so when nobody is online', () => {
    const snap = snapshot({ live: live({ players: [] }) });
    expect(render(snap, variant, 0).bio).toContain('No players online');
  });
});

describe('render — offline and stale', () => {
  it('shows offline with the last seen time when stale', () => {
    const snap = snapshot({ fresh: false });
    expect(render(snap, standard, 0).activity).toBe('offline · last seen 14:32');
  });

  it('keeps the last known scores with a stale marker', () => {
    const bio = render(snapshot({ fresh: false }), standard, 0).bio;
    expect(bio).toContain('33 Manticore');
    expect(bio).toContain('⚠ offline · last seen 14:32');
  });

  it('shows plain offline when never observed', () => {
    const snap = snapshot({ live: null, fresh: false, lastOkAt: null });
    expect(render(snap, standard, 0).activity).toBe('offline');
  });

  it('still shows the fallback join code when never observed', () => {
    const snap = snapshot({ live: null, fresh: false, lastOkAt: null });
    const policy = { ...standard, joinCodeFallback: 'fallback-code' };
    expect(render(snap, policy, 0).bio).toContain('Join code: fallback-code');
  });
});

describe('render — join code fallback', () => {
  it('prefers the live join code', () => {
    const policy = { ...standard, joinCodeFallback: 'fallback-code' };
    expect(render(snapshot(), policy, 0).bio).toContain('7f3a9c21');
  });

  it('falls back when the build does not serve one', () => {
    const snap = snapshot({ live: live({ gameServerId: '' }) });
    const policy = { ...standard, joinCodeFallback: 'fallback-code' };
    expect(render(snap, policy, 0).bio).toContain('Join code: fallback-code');
  });

  it('says unavailable when there is neither', () => {
    const snap = snapshot({ live: live({ gameServerId: '' }) });
    expect(render(snap, standard, 0).bio).toContain('Join code: unavailable');
  });
});

describe('render — budgets', () => {
  it('never exceeds the bio limit with worst-case names', () => {
    const many = Array.from({ length: 20 }, (_, i) => player('W'.repeat(40) + i, 50 - i, i));
    const snap = snapshot({ live: live({ players: many }) });
    expect(render(snap, variant, 0).bio.length).toBeLessThanOrEqual(BIO_MAX);
  });

  it('truncates player names to twenty characters', () => {
    const snap = snapshot({ live: live({ players: [player('A'.repeat(40), 9, 0)] }) });
    expect(render(snap, variant, 0).bio).toContain('1. ' + 'A'.repeat(19) + '…');
  });

  it('never exceeds the nickname limit', () => {
    const snap = snapshot({ live: live({ status: status({ serverName: 'N'.repeat(60) }) }) });
    expect(render(snap, standard, 0).nickname.length).toBeLessThanOrEqual(NICK_MAX);
  });
});

describe('renderName', () => {
  it('substitutes the live server name', () => {
    expect(renderName('{name}', live())).toBe('NA#2 - TEG.gg');
  });
  it('supports a literal template', () => {
    expect(renderName('TEG - EU 1', live())).toBe('TEG - EU 1');
  });
  it('falls back when no name is known', () => {
    expect(renderName('{name}', null)).toBe('Wardogs');
  });
});

describe('offlineText', () => {
  it('reports the last seen time', () => {
    expect(offlineText(Date.parse('2026-09-21T14:32:00.000Z'))).toBe('offline · last seen 14:32');
  });
  it('omits the time when never seen', () => {
    expect(offlineText(null)).toBe('offline');
  });
});
