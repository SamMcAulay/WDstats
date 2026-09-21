import { ActivityType, Routes } from 'discord.js';
import type { Client } from 'discord.js';
import type { DiscordTarget, Logger } from './bot.js';

export class DiscordJsTarget implements DiscordTarget {
  /** Last reported reason per guild, so a standing failure warns once. */
  private readonly warned = new Map<string, string>();

  constructor(
    private readonly client: Client,
    private readonly guildIds: string[],
    private readonly log?: Pick<Logger, 'warn'>
  ) {}

  async setActivity(text: string): Promise<void> {
    this.client.user?.setActivity(text, { type: ActivityType.Playing });
  }

  /**
   * Every guild is attempted. A guild the bot has not been invited to yet
   * must not stop the others, so this only rejects when none succeeded —
   * which leaves the field unrecorded and retries it on the next tick.
   */
  async setNickname(text: string): Promise<void> {
    const failures: string[] = [];

    for (const guildId of this.guildIds) {
      try {
        // The userId argument is omitted deliberately: passing '@me' explicitly
        // percent-encodes it to '%40me', while the default is the literal route.
        await this.client.rest.patch(Routes.guildMember(guildId), {
          body: { nick: text }
        });
        this.warned.delete(guildId);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failures.push(`${guildId}: ${reason}`);
        if (this.warned.get(guildId) !== reason) {
          this.warned.set(guildId, reason);
          this.log?.warn(`nickname not set in guild ${guildId}: ${reason}`);
        }
      }
    }

    if (failures.length > 0 && failures.length === this.guildIds.length) {
      throw new Error(failures.join('; '));
    }
  }

  /** "About Me" for a bot is the application description. */
  async setBio(text: string): Promise<void> {
    await this.client.rest.patch(Routes.currentApplication(), {
      body: { description: text }
    });
  }
}
