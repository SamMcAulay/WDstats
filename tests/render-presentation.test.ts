import { describe, it, expect } from 'vitest';
import { render, renderName, offlineText, BIO_MAX, NICK_MAX } from '../src/render.js';
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
  nameTemplate: '{name}',
  joinCodeFallback: null
};

/** Bot 1 once had its own variant; it now differs only by name template. */
const bot1: Policy = {
  nameTemplate: 'TEG - NA 2',
  joinCodeFallback: null
};

describe('render — standard bots', () => {
  it('shows slots as the activity', () => {
    expect(render(snapshot(), standard).activity).toBe('99 / 100 +1 reserved online');
  });


  it('builds the faction bio with the join code first', () => {
    expect(render(snapshot(), standard).bio).toBe(
      [
        'Join code: 7f3a9c21-4e88-4b1a-9d02-6c5e1f0a8b77',
        '▰▰▰▰▰▰▰▰▰▰ 33 Manticore',
        '▰▰▰▰▰▰▰▰▱▱ 26 Valkyra',
        '▰▰▰▰▰▰▰▱▱▱ 24 Lonestar',
        'Zestafona · Day Clear · King of the Hill · Zestafona Houses Circle'
      ].join('\n')
    );
  });

  it('renders bot 1 exactly like the rest, bar its name template', () => {
    const one = render(snapshot(), bot1);
    const rest = render(snapshot(), standard);
    expect(one.activity).toBe(rest.activity);
    expect(one.bio).toBe(rest.bio);
    expect(one.nickname).toBe('TEG - NA 2');
  });

  it('takes the nickname from the live server name', () => {
    expect(render(snapshot(), standard).nickname).toBe('NA#2 - TEG.gg');
  });
});


describe('render — offline and stale', () => {
  it('shows offline with the last seen time when stale', () => {
    const snap = snapshot({ fresh: false });
    expect(render(snap, standard).activity).toBe('offline · last seen 14:32');
  });

  it('keeps the last known scores with a stale marker', () => {
    const bio = render(snapshot({ fresh: false }), standard).bio;
    expect(bio).toContain('33 Manticore');
    expect(bio).toContain('⚠ offline · last seen 14:32');
  });

  it('shows plain offline when never observed', () => {
    const snap = snapshot({ live: null, fresh: false, lastOkAt: null });
    expect(render(snap, standard).activity).toBe('offline');
  });

  it('still shows the fallback join code when never observed', () => {
    const snap = snapshot({ live: null, fresh: false, lastOkAt: null });
    const policy = { ...standard, joinCodeFallback: 'fallback-code' };
    expect(render(snap, policy).bio).toContain('Join code: fallback-code');
  });
});

describe('render — join code fallback', () => {
  it('prefers the live join code', () => {
    const policy = { ...standard, joinCodeFallback: 'fallback-code' };
    expect(render(snapshot(), policy).bio).toContain('7f3a9c21');
  });

  it('falls back when the build does not serve one', () => {
    const snap = snapshot({ live: live({ gameServerId: '' }) });
    const policy = { ...standard, joinCodeFallback: 'fallback-code' };
    expect(render(snap, policy).bio).toContain('Join code: fallback-code');
  });

  it('says unavailable when there is neither', () => {
    const snap = snapshot({ live: live({ gameServerId: '' }) });
    expect(render(snap, standard).bio).toContain('Join code: unavailable');
  });
});

describe('render — budgets', () => {
  it('never exceeds the bio limit with worst-case faction names', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: 'F'.repeat(40) + i,
      colorHex: '#000000',
      score: 100 - i
    }));
    const snap = snapshot({ live: live({ status: status({ scores: many }) }) });
    expect(render(snap, standard).bio.length).toBeLessThanOrEqual(BIO_MAX);
  });



  it('never exceeds the nickname limit', () => {
    const snap = snapshot({ live: live({ status: status({ serverName: 'N'.repeat(60) }) }) });
    expect(render(snap, standard).nickname.length).toBeLessThanOrEqual(NICK_MAX);
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
