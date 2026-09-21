import { describe, it, expect } from 'vitest';
import { assumptionLines, presentationLines, summarise } from '../src/preflight.js';
import type { ProbeResult } from '../src/preflight.js';
import type { WarconLive, WarconStatus } from '../src/types.js';

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
    scores: [],
    ...overrides
  };
}

function live(overrides: Partial<WarconLive> = {}): WarconLive {
  return {
    serverId: 's1',
    ok: true,
    error: '',
    tier: 'hot',
    build: 'CL-501228',
    gameServerId: 'code-1',
    startedAt: null,
    reservedSlots: 2,
    throttledUntil: null,
    status: status(),
    players: [],
    observedAt: '2026-09-21T14:32:00.000Z',
    ...overrides
  };
}

const text = (lines: string[]): string => lines.join('\n');

describe('assumptionLines', () => {
  it('reports the slot maths so the total/public split is visible', () => {
    const out = text(assumptionLines(live()));
    expect(out).toContain('maxPlayers');
    expect(out).toContain('100');
    expect(out).toContain('reservedSlots');
    expect(out).toContain('public cap');
    expect(out).toContain('98');
  });

  it('shows the raw alternator beside the label it produces', () => {
    const out = text(assumptionLines(live()));
    expect(out).toContain('ZoneAlternator.NorthAmerica.Houses.Circle');
    expect(out).toContain('Zestafona Houses Circle');
  });

  it('flags an empty join code with the variable that fixes it', () => {
    const out = text(assumptionLines(live({ gameServerId: '' })));
    expect(out).toContain('JOIN_CODE');
  });

  it('does not flag a populated join code', () => {
    expect(text(assumptionLines(live()))).not.toContain('JOIN_CODE');
  });

  it('survives a status-less payload', () => {
    expect(() => assumptionLines(live({ status: null }))).not.toThrow();
  });
});

describe('presentationLines', () => {
  const presentation = { nickname: 'TEG - NA 2', activity: '99 / 100', bio: 'Join code: abc' };

  it('shows each field with its length against the limit', () => {
    const out = text(presentationLines(presentation));
    expect(out).toContain('TEG - NA 2');
    expect(out).toContain('10/32');
    expect(out).toContain('14/400');
  });

  it('renders a multi-line bio without collapsing it', () => {
    const out = text(presentationLines({ ...presentation, bio: 'one\ntwo' }));
    expect(out).toContain('one');
    expect(out).toContain('two');
  });
});

describe('summarise', () => {
  const ok: ProbeResult = { label: 'server s1', ok: true };
  const bad: ProbeResult = { label: 'bot3 token', ok: false, error: 'invalid' };

  it('reports success when every probe passed', () => {
    const { ok: passed, line } = summarise([ok, { label: 'x', ok: true }]);
    expect(passed).toBe(true);
    expect(line).toContain('2');
  });

  it('reports failure and names the failing probes', () => {
    const { ok: passed, line } = summarise([ok, bad]);
    expect(passed).toBe(false);
    expect(line).toContain('bot3 token');
  });

  it('treats an empty run as a failure rather than a pass', () => {
    expect(summarise([]).ok).toBe(false);
  });
});
