import type { WarconLive } from './types.js';

export interface Snapshot {
  serverId: string;
  /** the last observation that carried a status, which may be stale */
  live: WarconLive | null;
  /** a good observation exists and is within the stale window */
  fresh: boolean;
  lastOkAt: number | null;
  lastError: string | null;
}

interface Entry {
  live: WarconLive | null;
  lastOkAt: number | null;
  lastError: string | null;
}

export class SnapshotStore {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly staleAfterMs: number,
    private readonly now: () => number = Date.now
  ) {}

  recordSuccess(serverId: string, live: WarconLive): void {
    const prev = this.entries.get(serverId);
    if (live.ok && live.status) {
      this.entries.set(serverId, { live, lastOkAt: this.now(), lastError: null });
      return;
    }
    // Warcon answered, but the game server was unreachable at its last look.
    this.entries.set(serverId, {
      live: prev?.live ?? live,
      lastOkAt: prev?.lastOkAt ?? null,
      lastError: live.error || 'server unreachable'
    });
  }

  recordFailure(serverId: string, error: string): void {
    const prev = this.entries.get(serverId);
    this.entries.set(serverId, {
      live: prev?.live ?? null,
      lastOkAt: prev?.lastOkAt ?? null,
      lastError: error
    });
  }

  get(serverId: string): Snapshot {
    const entry = this.entries.get(serverId);
    const lastOkAt = entry?.lastOkAt ?? null;
    const fresh = lastOkAt !== null && this.now() - lastOkAt <= this.staleAfterMs;
    return {
      serverId,
      live: entry?.live ?? null,
      fresh,
      lastOkAt,
      lastError: entry?.lastError ?? null
    };
  }
}
