import { render } from './render.js';
import type { Policy, Presentation } from './render.js';
import { diff } from './reconcile.js';
import type { Snapshot } from './store.js';

/** What a bot can change about itself. Stubbed in tests. */
export interface DiscordTarget {
  setActivity(text: string): Promise<void>;
  setNickname(text: string): Promise<void>;
  setBio(text: string): Promise<void>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export class BotRunner {
  private applied: Partial<Presentation> = {};

  constructor(
    private readonly target: DiscordTarget,
    private readonly policy: Policy,
    private readonly label: string,
    private readonly log: Logger
  ) {}

  get appliedState(): Partial<Presentation> {
    return { ...this.applied };
  }

  async update(snapshot: Snapshot, tick: number): Promise<void> {
    const desired = render(snapshot, this.policy, tick);
    const changes = diff(desired, this.applied);

    // Each field is applied independently: one failure must not block the
    // others, and a failed field is left unrecorded so the next tick retries.
    if (changes.activity !== undefined) {
      await this.apply('activity', changes.activity, (v) => this.target.setActivity(v));
    }
    if (changes.nickname !== undefined) {
      await this.apply('nickname', changes.nickname, (v) => this.target.setNickname(v));
    }
    if (changes.bio !== undefined) {
      await this.apply('bio', changes.bio, (v) => this.target.setBio(v));
    }
  }

  private async apply(
    field: keyof Presentation,
    value: string,
    fn: (value: string) => Promise<void>
  ): Promise<void> {
    try {
      await fn(value);
      this.applied[field] = value;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn(`[${this.label}] failed to set ${field}: ${reason}`);
    }
  }
}
