import { describe, it, expect } from 'vitest';
import { SnapshotStore } from '../src/store.js';
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

function live(overrides: Partial<WarconLive> = {}): WarconLive {
  return {
    serverId: 's1',
    ok: true,
    error: '',
    tier: 'hot',
    build: '++Wardogs+Live-CL-501228',
    gameServerId: '7f3a9c21-4e88-4b1a-9d02-6c5e1f0a8b77',
    startedAt: null,
    reservedSlots: 2,
    throttledUntil: null,
    status: status(),
    players: [],
    observedAt: '2026-09-21T14:32:00.000Z',
    ...overrides
  };
}

describe('SnapshotStore', () => {
  it('reports an unknown server as not fresh', () => {
    const store = new SnapshotStore(90000, () => 1000);
    const snap = store.get('s1');
    expect(snap.live).toBeNull();
    expect(snap.fresh).toBe(false);
    expect(snap.lastOkAt).toBeNull();
  });

  it('records a good observation as fresh', () => {
    const store = new SnapshotStore(90000, () => 1000);
    store.recordSuccess('s1', live());
    const snap = store.get('s1');
    expect(snap.fresh).toBe(true);
    expect(snap.lastOkAt).toBe(1000);
    expect(snap.live!.status!.playerCount).toBe(99);
  });

  it('goes stale once the window passes', () => {
    let now = 1000;
    const store = new SnapshotStore(90000, () => now);
    store.recordSuccess('s1', live());
    now = 1000 + 90001;
    expect(store.get('s1').fresh).toBe(false);
  });

  it('keeps the last good live payload after a fetch failure', () => {
    let now = 1000;
    const store = new SnapshotStore(90000, () => now);
    store.recordSuccess('s1', live());
    now = 2000;
    store.recordFailure('s1', 'network down');
    const snap = store.get('s1');
    expect(snap.live!.status!.playerCount).toBe(99);
    expect(snap.fresh).toBe(true);
    expect(snap.lastError).toBe('network down');
  });

  it('treats an unreachable server as not fresh but keeps its last content', () => {
    let now = 1000;
    const store = new SnapshotStore(90000, () => now);
    store.recordSuccess('s1', live());
    now = 2000;
    store.recordSuccess('s1', live({ ok: false, status: null, error: 'connection refused' }));
    const snap = store.get('s1');
    expect(snap.live!.status!.playerCount).toBe(99);
    expect(snap.lastOkAt).toBe(1000);
    expect(snap.lastError).toBe('connection refused');
  });

  it('clears the error once a good observation returns', () => {
    let now = 1000;
    const store = new SnapshotStore(90000, () => now);
    store.recordFailure('s1', 'network down');
    now = 2000;
    store.recordSuccess('s1', live());
    const snap = store.get('s1');
    expect(snap.lastError).toBeNull();
    expect(snap.fresh).toBe(true);
  });

  it('keeps servers independent', () => {
    const store = new SnapshotStore(90000, () => 1000);
    store.recordSuccess('s1', live());
    store.recordFailure('s2', 'network down');
    expect(store.get('s1').fresh).toBe(true);
    expect(store.get('s2').fresh).toBe(false);
  });
});
