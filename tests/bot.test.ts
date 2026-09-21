import { describe, it, expect, vi } from 'vitest';
import { BotRunner } from '../src/bot.js';
import type { DiscordTarget } from '../src/bot.js';
import { SLOTS_ONLY_PHASES } from '../src/render.js';
import type { Policy } from '../src/render.js';
import type { Snapshot } from '../src/store.js';
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
    maxPlayers: 98,
    scores: [
      { name: 'Manticore', colorHex: '#4caf50', score: 33 },
      { name: 'Valkyra', colorHex: '#f44336', score: 26 },
      { name: 'Lonestar', colorHex: '#2196f3', score: 24 }
    ],
    ...overrides
  };
}

function snapshot(st: WarconStatus = status()): Snapshot {
  const live: WarconLive = {
    serverId: 's1', ok: true, error: '', tier: 'hot', build: 'CL-501228',
    gameServerId: 'code-1', startedAt: null, reservedSlots: 2, throttledUntil: null,
    status: st, players: [], observedAt: '2026-09-21T14:32:00.000Z'
  };
  return { serverId: 's1', live, fresh: true, lastOkAt: Date.parse('2026-09-21T14:32:00.000Z'), lastError: null };
}

const policy: Policy = {
  bioMode: 'factions',
  activityPhases: SLOTS_ONLY_PHASES,
  nameTemplate: '{name}',
  joinCodeFallback: null
};

function target() {
  return {
    setActivity: vi.fn(async () => {}),
    setNickname: vi.fn(async () => {}),
    setBio: vi.fn(async () => {})
  } satisfies DiscordTarget;
}

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('BotRunner', () => {
  it('applies all three fields on the first update', async () => {
    const t = target();
    await new BotRunner(t, policy, 'bot1', silentLog).update(snapshot(), 0);
    expect(t.setActivity).toHaveBeenCalledTimes(1);
    expect(t.setNickname).toHaveBeenCalledTimes(1);
    expect(t.setBio).toHaveBeenCalledTimes(1);
  });

  it('applies nothing on an identical second update', async () => {
    const t = target();
    const runner = new BotRunner(t, policy, 'bot1', silentLog);
    await runner.update(snapshot(), 0);
    await runner.update(snapshot(), 0);
    expect(t.setActivity).toHaveBeenCalledTimes(1);
    expect(t.setNickname).toHaveBeenCalledTimes(1);
    expect(t.setBio).toHaveBeenCalledTimes(1);
  });

  it('updates only the activity when only the player count moved', async () => {
    const t = target();
    const runner = new BotRunner(t, policy, 'bot1', silentLog);
    await runner.update(snapshot(), 0);
    await runner.update(snapshot(status({ playerCount: 97 })), 0);
    expect(t.setActivity).toHaveBeenCalledTimes(2);
    expect(t.setBio).toHaveBeenCalledTimes(1);
    expect(t.setNickname).toHaveBeenCalledTimes(1);
  });

  it('updates the bio when a faction score moves', async () => {
    const t = target();
    const runner = new BotRunner(t, policy, 'bot1', silentLog);
    await runner.update(snapshot(), 0);
    const moved = status({ scores: [
      { name: 'Manticore', colorHex: '#4caf50', score: 34 },
      { name: 'Valkyra', colorHex: '#f44336', score: 26 },
      { name: 'Lonestar', colorHex: '#2196f3', score: 24 }
    ] });
    await runner.update(snapshot(moved), 0);
    expect(t.setBio).toHaveBeenCalledTimes(2);
  });

  it('retries a failed field on the next update', async () => {
    const t = target();
    t.setBio.mockRejectedValueOnce(new Error('discord 500'));
    const runner = new BotRunner(t, policy, 'bot1', silentLog);
    await runner.update(snapshot(), 0);
    await runner.update(snapshot(), 0);
    expect(t.setBio).toHaveBeenCalledTimes(2);
  });

  it('still applies the other fields when one fails', async () => {
    const t = target();
    t.setNickname.mockRejectedValueOnce(new Error('missing permission'));
    await new BotRunner(t, policy, 'bot1', silentLog).update(snapshot(), 0);
    expect(t.setActivity).toHaveBeenCalledTimes(1);
    expect(t.setBio).toHaveBeenCalledTimes(1);
  });
});
