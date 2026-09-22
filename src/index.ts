import { Client, Events, Options } from 'discord.js';
import { loadConfig } from './config.js';
import type { BotBinding } from './config.js';
import { WarconClient, CloudflareBlockedError, WarconAuthError } from './warcon.js';
import { SnapshotStore } from './store.js';
import { FetchScheduler } from './schedule.js';
import { BotRunner } from './bot.js';
import type { Logger } from './bot.js';
import { DiscordJsTarget } from './discord-target.js';
import type { Policy } from './render.js';

const log: Logger = {
  info: (m) => console.log(`[${new Date().toISOString()}] ${m}`),
  warn: (m) => console.warn(`[${new Date().toISOString()}] ${m}`),
  error: (m) => console.error(`[${new Date().toISOString()}] ${m}`)
};

/** Ceiling on per-server backoff: a dead server is still retried every 5 minutes. */
const MAX_BACKOFF_MS = 300_000;

function policyFor(bot: BotBinding): Policy {
  return {
    nameTemplate: bot.nameTemplate,
    joinCodeFallback: bot.joinCodeFallback
  };
}

/** No intents and no caches: we only ever push presence and two REST calls. */
function createClient(): Client {
  return new Client({
    intents: [],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      GuildMemberManager: 0,
      MessageManager: 0,
      PresenceManager: 0,
      UserManager: 0
    })
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const warcon = new WarconClient({
    baseUrl: config.warconBaseUrl,
    token: config.warconToken,
    cfClientId: config.cfAccessClientId,
    cfClientSecret: config.cfAccessClientSecret,
    timeoutMs: config.requestTimeoutMs
  });
  const store = new SnapshotStore(config.staleAfterMs);
  const scheduler = new FetchScheduler(config.pollIntervalMs, MAX_BACKOFF_MS);

  const clients: Client[] = [];
  const runners: Array<{ binding: BotBinding; runner: BotRunner }> = [];

  for (const binding of config.bots) {
    const client = createClient();
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once(Events.ClientReady, () => resolve());
      client.once('error', reject);
      client.login(binding.token).catch(reject);
    });
    log.info(`bot${binding.index} logged in as ${client.user?.tag} → server ${binding.serverId}`);
    runners.push({
      binding,
      runner: new BotRunner(
        new DiscordJsTarget(client, binding.guildIds, log),
        policyFor(binding),
        `bot${binding.index}`,
        log
      )
    });
  }

  const poll = async (): Promise<void> => {
    const serverIds = [...new Set(config.bots.map((b) => b.serverId))];
    await Promise.all(
      serverIds.map(async (serverId) => {
        if (!scheduler.ready(serverId)) return;
        try {
          const live = await warcon.fetchServer(serverId);
          store.recordSuccess(serverId, live);
          scheduler.recordSuccess(serverId, live.throttledUntil);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          store.recordFailure(serverId, reason);
          scheduler.recordFailure(serverId);
          if (err instanceof CloudflareBlockedError) log.error(`[${serverId}] ${reason}`);
          else if (err instanceof WarconAuthError) log.error(`[${serverId}] ${reason}`);
          else log.warn(`[${serverId}] fetch failed: ${reason}`);
        }
      })
    );

    await Promise.all(
      runners.map(({ binding, runner }) => runner.update(store.get(binding.serverId)))
    );
  };

  await poll();
  const timer = setInterval(() => {
    void poll();
  }, config.pollIntervalMs);

  const shutdown = async (signal: string): Promise<void> => {
    log.info(`${signal} received, shutting down`);
    clearInterval(timer);
    await Promise.all(clients.map((c) => c.destroy()));
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
