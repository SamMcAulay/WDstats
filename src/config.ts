import 'dotenv/config';

export type BioMode = 'factions' | 'scoreboard';

export interface BotBinding {
  index: number;
  token: string;
  serverId: string;
  guildIds: string[];
  nameTemplate: string;
  joinCodeFallback: string | null;
  bioMode: BioMode;
}

export interface Config {
  warconBaseUrl: string;
  warconToken: string;
  cfAccessClientId: string | null;
  cfAccessClientSecret: string | null;
  pollIntervalMs: number;
  staleAfterMs: number;
  requestTimeoutMs: number;
  bots: BotBinding[];
}

const BOT_COUNT = 5;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];

  const req = (key: string): string => {
    const value = (env[key] ?? '').trim();
    if (!value) missing.push(key);
    return value;
  };

  const opt = (key: string): string | null => {
    const value = (env[key] ?? '').trim();
    return value === '' ? null : value;
  };

  const num = (key: string, fallback: number): number => {
    const raw = (env[key] ?? '').trim();
    if (raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${key} must be a positive number, got: ${raw}`);
    }
    return parsed;
  };

  const warconBaseUrl = req('WARCON_BASE_URL').replace(/\/+$/, '');
  const warconToken = req('WARCON_TOKEN');

  const bots: BotBinding[] = [];
  for (let i = 1; i <= BOT_COUNT; i++) {
    const token = req(`BOT${i}_TOKEN`);
    const serverId = req(`BOT${i}_SERVER_ID`);
    const guildIds = (env[`BOT${i}_GUILD_IDS`] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (guildIds.length === 0) missing.push(`BOT${i}_GUILD_IDS`);

    bots.push({
      index: i,
      token,
      serverId,
      guildIds,
      nameTemplate: (env[`BOT${i}_NAME_TEMPLATE`] ?? '').trim() || '{name}',
      joinCodeFallback: opt(`BOT${i}_JOIN_CODE`),
      bioMode: i === 1 ? 'scoreboard' : 'factions'
    });
  }

  const cfAccessClientId = opt('CF_ACCESS_CLIENT_ID');
  const cfAccessClientSecret = opt('CF_ACCESS_CLIENT_SECRET');
  if (cfAccessClientId && !cfAccessClientSecret) missing.push('CF_ACCESS_CLIENT_SECRET');
  if (cfAccessClientSecret && !cfAccessClientId) missing.push('CF_ACCESS_CLIENT_ID');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables:\n  ${missing.join('\n  ')}`);
  }

  return {
    warconBaseUrl,
    warconToken,
    cfAccessClientId,
    cfAccessClientSecret,
    pollIntervalMs: num('POLL_INTERVAL_MS', 15000),
    staleAfterMs: num('STALE_AFTER_MS', 90000),
    requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 10000),
    bots
  };
}
