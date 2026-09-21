interface Entry {
  nextAttemptAt: number;
  failures: number;
}

/**
 * Decides when a server may be fetched again: exponential backoff after
 * failures, and Warcon's own throttledUntil when the listener has asked the
 * panel to slow down (429 with Retry-After).
 */
export class FetchScheduler {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly baseDelayMs: number,
    private readonly maxDelayMs: number,
    private readonly now: () => number = Date.now
  ) {}

  delayFor(failures: number): number {
    if (failures <= 0) return 0;
    const delay = this.baseDelayMs * 2 ** (failures - 1);
    return Math.min(delay, this.maxDelayMs);
  }

  ready(serverId: string): boolean {
    const entry = this.entries.get(serverId);
    return entry === undefined || this.now() >= entry.nextAttemptAt;
  }

  recordSuccess(serverId: string, throttledUntil: string | null): void {
    let nextAttemptAt = 0;
    if (throttledUntil) {
      const parsed = Date.parse(throttledUntil);
      if (Number.isFinite(parsed) && parsed > this.now()) nextAttemptAt = parsed;
    }
    this.entries.set(serverId, { nextAttemptAt, failures: 0 });
  }

  recordFailure(serverId: string): void {
    const failures = (this.entries.get(serverId)?.failures ?? 0) + 1;
    this.entries.set(serverId, {
      nextAttemptAt: this.now() + this.delayFor(failures),
      failures
    });
  }
}
