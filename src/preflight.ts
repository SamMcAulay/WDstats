/**
 * Credential and payload check. Talks to Warcon and to Discord's REST API
 * read-only, logs into no gateway and writes nothing, so it is safe to run
 * against production tokens before the bots have ever started.
 *
 *   npm run preflight
 */
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import type { BotBinding, Config } from './config.js';
import { WarconClient, CloudflareBlockedError, WarconAuthError } from './warcon.js';
import { SnapshotStore } from './store.js';
import { zoneLabel } from './labels.js';
import { render, ROTATING_PHASES, SLOTS_ONLY_PHASES, BIO_MAX, NICK_MAX } from './render.js';
import type { Policy, Presentation } from './render.js';
import type { WarconLive } from './types.js';

export interface ProbeResult {
  label: string;
  ok: boolean;
  error?: string;
  /** Human-readable identity on success, e.g. the bot's username. */
  detail?: string;
}

const DISCORD_API = 'https://discord.com/api/v10';

function pad(label: string): string {
  return label.padEnd(16, ' ');
}

/**
 * The raw fields behind the open assumptions in spec section 11, printed
 * beside the values we derive from them.
 */
export function assumptionLines(live: WarconLive): string[] {
  const status = live.status;
  const reserved = live.reservedSlots ?? 0;
  const lines: string[] = [];

  if (status) {
    const publicCap = Math.max(0, status.maxPlayers - reserved);
    lines.push(`${pad('maxPlayers')}${status.maxPlayers}  (total, reserved included)`);
    lines.push(`${pad('reservedSlots')}${live.reservedSlots ?? '(none)'}`);
    lines.push(`${pad('→ public cap')}${publicCap}  = ${status.maxPlayers} − ${reserved}`);
    lines.push(`${pad('playerCount')}${status.playerCount}`);
    lines.push(`${pad('alternator')}${status.alternator || '(empty)'}`);
    lines.push(`${pad('→ zoneLabel')}${zoneLabel(status.alternator)}`);
  } else {
    lines.push(`${pad('status')}(none — server unreachable at last observation)`);
  }

  const joinCode = (live.gameServerId || '').trim();
  lines.push(
    `${pad('gameServerId')}${joinCode || '(empty — set BOT{i}_JOIN_CODE for this bot)'}`
  );
  lines.push(`${pad('startedAt')}${live.startedAt ?? '(none)'}`);
  lines.push(`${pad('observedAt')}${live.observedAt ?? '(none)'}`);
  lines.push(`${pad('tier')}${live.tier || '(none)'}`);
  lines.push(`${pad('throttledUntil')}${live.throttledUntil ?? '(none)'}`);
  return lines;
}

/** What the bot would display, with each field measured against its cap. */
export function presentationLines(p: Presentation): string[] {
  const count = (text: string): number => [...text].length;
  const lines = [
    `${pad('nickname')}${p.nickname}   [${count(p.nickname)}/${NICK_MAX}]`,
    `${pad('activity')}Playing ${p.activity}`,
    `${pad('bio')}[${count(p.bio)}/${BIO_MAX}]`
  ];
  for (const line of p.bio.split('\n')) lines.push(`                  ${line}`);
  return lines;
}

export function summarise(results: ProbeResult[]): { ok: boolean; line: string } {
  const failed = results.filter((r) => !r.ok);
  if (results.length === 0) {
    return { ok: false, line: 'no checks ran' };
  }
  if (failed.length === 0) {
    return { ok: true, line: `all ${results.length} checks passed` };
  }
  return {
    ok: false,
    line: `${failed.length} of ${results.length} checks failed: ${failed
      .map((f) => `${f.label} (${f.error ?? 'unknown'})`)
      .join(', ')}`
  };
}

function policyFor(bot: BotBinding): Policy {
  return {
    bioMode: bot.bioMode,
    activityPhases: bot.bioMode === 'scoreboard' ? ROTATING_PHASES : SLOTS_ONLY_PHASES,
    nameTemplate: bot.nameTemplate,
    joinCodeFallback: bot.joinCodeFallback
  };
}

/** GET /users/@me — read-only, no gateway connection, no presence written. */
async function checkDiscordToken(
  bot: BotBinding,
  fetchImpl: typeof fetch = fetch
): Promise<ProbeResult> {
  const label = `bot${bot.index} token`;
  try {
    const res = await fetchImpl(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bot ${bot.token}` }
    });
    if (res.status === 401) {
      return { label, ok: false, error: 'rejected by Discord — check BOT%d_TOKEN'.replace('%d', String(bot.index)) };
    }
    if (!res.ok) return { label, ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { username?: string; id?: string };
    return { label, ok: true, detail: `${body.username ?? '(unnamed)'}  id ${body.id ?? '?'}` };
  } catch (err) {
    return { label, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error('\nCopy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const results: ProbeResult[] = [];

  console.log('\n── Discord tokens ' + '─'.repeat(42));
  for (const bot of config.bots) {
    const result = await checkDiscordToken(bot);
    results.push(result);
    console.log(
      result.ok
        ? `  bot${bot.index}  ✓ ${result.detail ?? ''}`
        : `  bot${bot.index}  ✗ ${result.error ?? 'failed'}`
    );
  }

  console.log('\n── Warcon panel ' + '─'.repeat(44));
  console.log(`  ${config.warconBaseUrl}`);
  console.log(
    `  Cloudflare Access headers: ${config.cfAccessClientId ? 'configured' : 'not configured'}`
  );

  const warcon = new WarconClient({
    baseUrl: config.warconBaseUrl,
    token: config.warconToken,
    cfClientId: config.cfAccessClientId,
    cfClientSecret: config.cfAccessClientSecret,
    timeoutMs: config.requestTimeoutMs
  });
  const store = new SnapshotStore(config.staleAfterMs);

  const serverIds = [...new Set(config.bots.map((b) => b.serverId))];
  for (const serverId of serverIds) {
    const label = `server ${serverId}`;
    try {
      const live = await warcon.fetchServer(serverId);
      store.recordSuccess(serverId, live);
      console.log(`\n  ${serverId}  ✓ ${live.status?.serverName ?? '(unreachable)'}`);
      for (const line of assumptionLines(live)) console.log(`    ${line}`);
      results.push({ label, ok: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      store.recordFailure(serverId, reason);
      const kind =
        err instanceof CloudflareBlockedError
          ? 'CLOUDFLARE'
          : err instanceof WarconAuthError
            ? 'WARCON AUTH'
            : 'FETCH';
      console.log(`\n  ${serverId}  ✗ [${kind}] ${reason}`);
      results.push({ label, ok: false, error: kind });
    }
  }

  console.log('\n── Rendered output ' + '─'.repeat(41));
  for (const bot of config.bots) {
    const policy = policyFor(bot);
    const snapshot = store.get(bot.serverId);
    console.log(`\n  bot${bot.index}  (${bot.bioMode}, server ${bot.serverId})`);
    if (bot.bioMode === 'scoreboard') {
      // Bot 1 rotates across six ticks; show the whole cycle.
      for (const tick of [0, 3, 4, 5]) {
        console.log(`    tick ${tick} → Playing ${render(snapshot, policy, tick).activity}`);
      }
    }
    for (const line of presentationLines(render(snapshot, policy, 0))) {
      console.log(`    ${line}`);
    }
  }

  const { ok, line } = summarise(results);
  console.log('\n' + '─'.repeat(60));
  console.log(ok ? `✓ ${line}` : `✗ ${line}`);
  process.exit(ok ? 0 : 1);
}

// Only run when invoked directly, so importing the helpers above (in tests,
// or from another module) does not fire a live credential check.
const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
