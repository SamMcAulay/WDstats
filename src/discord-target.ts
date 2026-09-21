import { ActivityType, Routes } from 'discord.js';
import type { Client } from 'discord.js';
import type { DiscordTarget } from './bot.js';

export class DiscordJsTarget implements DiscordTarget {
  constructor(
    private readonly client: Client,
    private readonly guildIds: string[]
  ) {}

  async setActivity(text: string): Promise<void> {
    this.client.user?.setActivity(text, { type: ActivityType.Playing });
  }

  async setNickname(text: string): Promise<void> {
    for (const guildId of this.guildIds) {
      // The userId argument is omitted deliberately: passing '@me' explicitly
      // percent-encodes it to '%40me', while the default is the literal route.
      await this.client.rest.patch(Routes.guildMember(guildId), {
        body: { nick: text }
      });
    }
  }

  /** "About Me" for a bot is the application description. */
  async setBio(text: string): Promise<void> {
    await this.client.rest.patch(Routes.currentApplication(), {
      body: { description: text }
    });
  }
}
