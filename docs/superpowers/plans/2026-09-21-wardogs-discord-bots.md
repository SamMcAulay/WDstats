# Wardogs Discord Bot Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run five Discord bot accounts from one Node process, each showing one Wardogs server's live player count, faction scores and join code as Discord sidebar presence.

**Architecture:** A single 15-second poll loop reads five servers from the Warcon panel API into a snapshot store. Each bot holds a policy object and a pure render function turning its snapshot into `{ nickname, activity, bio }`; a reconciler diffs that against what was last applied and issues only the Discord calls whose text actually changed. Bot 1's A/B variant is expressed as policy data (a six-element phase array plus `bioMode: 'scoreboard'`), never as a branch in the render path.

**Tech Stack:** Node 20+, TypeScript, discord.js v14, vitest, dotenv. Native `fetch` (no HTTP client dependency).

**Spec:** `docs/superpowers/specs/2026-09-21-wardogs-discord-bots-design.md`

## Global Constraints

- Node 20+ required (native `fetch`, `AbortController`).
- Discord clients use `intents: []` and explicitly zeroed caches. No guild, member, message or presence intents.
- **Never** change a bot's global username or avatar. Nickname is per-guild only.
- Bio (application description) hard cap **400 characters**. Nickname hard cap **32 characters**. Both truncate deterministically, never throw.
- Player names in the scoreboard truncate to **20 characters**.
- Faction bars are **10 characters** wide, `▰` filled, `▱` empty, scaled to the leading faction.
- Slot format: `players / (maxPlayers + reservedSlots)`, suffix `+N reserved online` where `N = max(0, players − maxPlayers)`. **Suffix is omitted entirely when `N == 0`.**
- Top 5 sorted: kills desc, then deaths asc, then name ascending.
- Defaults: `POLL_INTERVAL_MS=15000`, `STALE_AFTER_MS=90000`, `REQUEST_TIMEOUT_MS=10000`.
- All secrets from environment only. `.env` is gitignored; never commit real values.
- The reconciler MUST suppress unchanged writes — `PATCH /applications/@me` has no documented rate limit.
- Zero write operations against game servers. Read-only throughout.
- Every task ends with a commit.

---

### Task 1: Project scaffold and configuration

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): Config`, and types `Config`, `BotBinding`, `BioMode`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "wardogs-discord-bots",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "discord.js": "^14.16.3",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^22.7.5",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.3"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
});
```

- [ ] **Step 4: Create `.env.example`**

```bash
# Warcon panel API
WARCON_BASE_URL=https://panel.example.com
WARCON_TOKEN=

# Cloudflare Access service token (omit both if the panel is not behind Access)
CF_ACCESS_CLIENT_ID=
CF_ACCESS_CLIENT_SECRET=

# Timing (milliseconds)
POLL_INTERVAL_MS=15000
STALE_AFTER_MS=90000
REQUEST_TIMEOUT_MS=10000

# Bot 1 — A/B variant: rotating activity, top-5 scoreboard bio
BOT1_TOKEN=
BOT1_SERVER_ID=
BOT1_GUILD_IDS=
BOT1_NAME_TEMPLATE={name}
BOT1_JOIN_CODE=

# Bots 2-5 — standard: slots activity, faction scores bio
BOT2_TOKEN=
BOT2_SERVER_ID=
BOT2_GUILD_IDS=
BOT2_NAME_TEMPLATE={name}
BOT2_JOIN_CODE=

BOT3_TOKEN=
BOT3_SERVER_ID=
BOT3_GUILD_IDS=
BOT3_NAME_TEMPLATE={name}
BOT3_JOIN_CODE=

BOT4_TOKEN=
BOT4_SERVER_ID=
BOT4_GUILD_IDS=
BOT4_NAME_TEMPLATE={name}
BOT4_JOIN_CODE=

BOT5_TOKEN=
BOT5_SERVER_ID=
BOT5_GUILD_IDS=
BOT5_NAME_TEMPLATE={name}
BOT5_JOIN_CODE=
```

`BOT{i}_JOIN_CODE` is the fallback used when Warcon reports an empty `gameServerId` (older builds do not serve `GET /v1/server-id`). `BOT{i}_GUILD_IDS` is comma-separated.

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Write the failing test**

Create `tests/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

function validEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    WARCON_BASE_URL: 'https://panel.example.com/',
    WARCON_TOKEN: 'warcon-key'
  };
  for (let i = 1; i <= 5; i++) {
    env[`BOT${i}_TOKEN`] = `token-${i}`;
    env[`BOT${i}_SERVER_ID`] = `server-${i}`;
    env[`BOT${i}_GUILD_IDS`] = `guild-${i}`;
  }
  return env;
}

describe('loadConfig', () => {
  it('parses five bot bindings', () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.bots).toHaveLength(5);
    expect(cfg.bots[0]!.serverId).toBe('server-1');
    expect(cfg.bots[4]!.token).toBe('token-5');
  });

  it('strips a trailing slash from the base url', () => {
    expect(loadConfig(validEnv()).warconBaseUrl).toBe('https://panel.example.com');
  });

  it('gives bot 1 the scoreboard variant and the rest factions', () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.bots[0]!.bioMode).toBe('scoreboard');
    expect(cfg.bots[1]!.bioMode).toBe('factions');
    expect(cfg.bots[4]!.bioMode).toBe('factions');
  });

  it('splits comma-separated guild ids and trims them', () => {
    const env = validEnv();
    env.BOT2_GUILD_IDS = ' a , b ,, c ';
    expect(loadConfig(env).bots[1]!.guildIds).toEqual(['a', 'b', 'c']);
  });

  it('defaults the name template to {name}', () => {
    expect(loadConfig(validEnv()).bots[0]!.nameTemplate).toBe('{name}');
  });

  it('applies timing defaults', () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.pollIntervalMs).toBe(15000);
    expect(cfg.staleAfterMs).toBe(90000);
    expect(cfg.requestTimeoutMs).toBe(10000);
  });

  it('lists every missing variable in one error', () => {
    const env = validEnv();
    delete env.WARCON_TOKEN;
    delete env.BOT3_SERVER_ID;
    expect(() => loadConfig(env)).toThrow(/WARCON_TOKEN[\s\S]*BOT3_SERVER_ID/);
  });

  it('rejects a half-configured Cloudflare service token', () => {
    const env = validEnv();
    env.CF_ACCESS_CLIENT_ID = 'id.access';
    expect(() => loadConfig(env)).toThrow(/CF_ACCESS_CLIENT_SECRET/);
  });

  it('accepts both Cloudflare values together', () => {
    const env = validEnv();
    env.CF_ACCESS_CLIENT_ID = 'id.access';
    env.CF_ACCESS_CLIENT_SECRET = 'secret';
    const cfg = loadConfig(env);
    expect(cfg.cfAccessClientId).toBe('id.access');
    expect(cfg.cfAccessClientSecret).toBe('secret');
  });

  it('accepts neither Cloudflare value', () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.cfAccessClientId).toBeNull();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot resolve `../src/config.js`.

- [ ] **Step 8: Write the implementation**

Create `src/config.ts`:

```ts
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
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example src/config.ts tests/config.test.ts
git commit -m "feat: project scaffold and environment configuration

Five bot bindings parsed from env, all missing variables reported in one
error. Cloudflare service token values must be set together or not at all."
```

---

### Task 2: Game label helpers

Warcon returns raw ids (`NorthAmerica`, `DayClear`, `KOTH_01`). This ports Warcon's own display helpers so our output matches the panel.

**Files:**
- Create: `src/labels.ts`
- Test: `tests/labels.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `prettify(id)`, `mapName(id)`, `lightingLabel(id)`, `expLabel(id)`, `expSetLabel(ids)`, `zoneLabel(tag)` — all `(string | null | undefined) => string`, except `expSetLabel(ids: string[] | null | undefined)`

- [ ] **Step 1: Write the failing test**

Create `tests/labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prettify, mapName, lightingLabel, expLabel, expSetLabel, zoneLabel } from '../src/labels.js';

describe('prettify', () => {
  it('splits camel case', () => {
    expect(prettify('DayClear')).toBe('Day Clear');
  });
  it('replaces separators', () => {
    expect(prettify('KOTH_InfantryOnly')).toBe('KOTH Infantry Only');
  });
  it('returns empty string for nullish input', () => {
    expect(prettify(null)).toBe('');
    expect(prettify(undefined)).toBe('');
  });
});

describe('mapName', () => {
  it('maps the three known ids to their display names', () => {
    expect(mapName('Kavkazi')).toBe('Bakurani');
    expect(mapName('Europe')).toBe('Ozeti');
    expect(mapName('NorthAmerica')).toBe('Zestafona');
  });
  it('prettifies an unknown id', () => {
    expect(mapName('SomeNewMap')).toBe('Some New Map');
  });
  it('returns a dash for nothing', () => {
    expect(mapName(null)).toBe('—');
  });
});

describe('lightingLabel', () => {
  it('prettifies lighting ids', () => {
    expect(lightingLabel('DayClear')).toBe('Day Clear');
    expect(lightingLabel('DayLateGrayFog')).toBe('Day Late Gray Fog');
  });
  it('returns a dash for nothing', () => {
    expect(lightingLabel(null)).toBe('—');
  });
});

describe('expLabel', () => {
  it('names the King of the Hill mode', () => {
    expect(expLabel('NorthAmerica_KOTH_01')).toBe('King of the Hill');
  });
  it('prettifies modifiers without the KOTH prefix', () => {
    expect(expLabel('KOTH_InfantryOnly')).toBe('Infantry Only');
    expect(expLabel('KOTH_Hardcore')).toBe('Hardcore');
  });
});

describe('expSetLabel', () => {
  it('joins the mode and its modifiers', () => {
    expect(expSetLabel(['NorthAmerica_KOTH_01', 'KOTH_Hardcore'])).toBe('King of the Hill + Hardcore');
  });
  it('handles a mode alone', () => {
    expect(expSetLabel(['NorthAmerica_KOTH_01'])).toBe('King of the Hill');
  });
  it('returns a dash for an empty list', () => {
    expect(expSetLabel([])).toBe('—');
    expect(expSetLabel(null)).toBe('—');
  });
});

describe('zoneLabel', () => {
  it('maps the map segment to its display name', () => {
    expect(zoneLabel('ZoneAlternator.NorthAmerica.Houses.Circle')).toBe('Zestafona Houses Circle');
  });
  it('handles the documented Bakurani example', () => {
    expect(zoneLabel('ZoneAlternator.Bakurani.Default.Circle')).toBe('Bakurani Default Circle');
  });
  it('returns Default for none or nothing', () => {
    expect(zoneLabel('None')).toBe('Default');
    expect(zoneLabel(null)).toBe('Default');
    expect(zoneLabel('')).toBe('Default');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/labels.test.ts`
Expected: FAIL — cannot resolve `../src/labels.js`.

- [ ] **Step 3: Write the implementation**

Create `src/labels.ts`:

```ts
/**
 * Display labels for the raw ids Warcon returns. Ported from Warcon's own
 * src/lib/format.ts so our output matches the panel exactly.
 */

const MAP_DISPLAY: Record<string, string> = {
  Kavkazi: 'Bakurani',
  Europe: 'Ozeti',
  NorthAmerica: 'Zestafona'
};

export function prettify(id: string | null | undefined): string {
  if (!id) return '';
  return String(id)
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapName(id: string | null | undefined): string {
  if (!id) return '—';
  return MAP_DISPLAY[id] ?? prettify(id) ?? '—';
}

export function lightingLabel(id: string | null | undefined): string {
  return prettify(id) || '—';
}

export const isMod = (id: string): boolean => /infantry|hardcore/i.test(id);

export function expLabel(id: string): string {
  if (/koth/i.test(id)) {
    return isMod(id) ? prettify(id.replace(/^KOTH_/i, '')) : 'King of the Hill';
  }
  return prettify(id);
}

export function expSetLabel(ids: string[] | null | undefined): string {
  const list = ids ?? [];
  if (list.length === 0) return '—';
  const mode = list.find((id) => !isMod(id));
  return [mode ? expLabel(mode) : null, ...list.filter(isMod).map(expLabel)]
    .filter((part): part is string => Boolean(part))
    .join(' + ');
}

export function zoneLabel(tag: string | null | undefined): string {
  if (!tag || /^none$/i.test(tag)) return 'Default';
  const parts = String(tag)
    .replace(/^ZoneAlternator\./i, '')
    .split('.')
    .filter(Boolean);
  const mapped = parts.map((part, i) => (i === 0 ? (MAP_DISPLAY[part] ?? part) : part));
  return prettify(mapped.join(' ')) || 'Default';
}
```

> **Verify against real data.** `zoneLabel` maps the first segment through `MAP_DISPLAY` to produce `Zestafona Houses Circle` from the screenshot. This is inferred, not observed — spec §11.2. Adjust once a real `alternator` string is available.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/labels.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/labels.ts tests/labels.test.ts
git commit -m "feat: game label helpers ported from Warcon format.ts

Maps raw ids (NorthAmerica, DayClear, KOTH_01) to the display names the
panel shows, so bot output matches Warcon."
```

---

### Task 3: Warcon API types and client

**Files:**
- Create: `src/types.ts`, `src/warcon.ts`
- Test: `tests/warcon.test.ts`

**Interfaces:**
- Consumes: `Config` from Task 1
- Produces: types `FactionScore`, `WarconStatus`, `WarconPlayer`, `WarconLive`; classes `CloudflareBlockedError`, `WarconAuthError`, `WarconClient` with `fetchServer(serverId: string): Promise<WarconLive>`

- [ ] **Step 1: Create `src/types.ts`**

```ts
/** Mirrors Warcon's src/lib/types.ts for the fields we consume. */

export interface FactionScore {
  name: string;
  colorHex: string;
  score: number;
}

export interface WarconStatus {
  serverName: string;
  map: string;
  experiences: string[];
  lighting: string;
  alternator: string;
  scoreCap: number | null;
  matchSeconds: number | null;
  playerCount: number;
  maxPlayers: number;
  scores: FactionScore[];
}

export interface WarconPlayer {
  name: string;
  steamId: string;
  faction: string | null;
  kills: number;
  deaths: number;
  cash: number;
  ping: number | null;
}

export interface WarconLive {
  serverId: string;
  ok: boolean;
  error: string;
  tier: string;
  build: string;
  /** join code from GET /v1/server-id; '' when the build does not serve it */
  gameServerId: string;
  startedAt: string | null;
  /** MaxReservedSlots — held back ON TOP OF status.maxPlayers */
  reservedSlots: number | null;
  throttledUntil: string | null;
  status: WarconStatus | null;
  players: WarconPlayer[];
  observedAt: string | null;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/warcon.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { WarconClient, CloudflareBlockedError, WarconAuthError } from '../src/warcon.js';
import type { WarconLive } from '../src/types.js';

const live: Partial<WarconLive> = { serverId: 's1', ok: true, gameServerId: 'code-1' };

function client(fetchImpl: typeof fetch) {
  return new WarconClient({
    baseUrl: 'https://panel.example.com',
    token: 'warcon-key',
    cfClientId: 'id.access',
    cfClientSecret: 'secret',
    timeoutMs: 1000,
    fetchImpl
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('WarconClient', () => {
  it('sends all three auth headers', async () => {
    const spy = vi.fn(async () => jsonResponse({ ok: true, live }));
    await client(spy as unknown as typeof fetch).fetchServer('s1');
    const init = spy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer warcon-key');
    expect(headers['CF-Access-Client-Id']).toBe('id.access');
    expect(headers['CF-Access-Client-Secret']).toBe('secret');
  });

  it('omits Cloudflare headers when not configured', async () => {
    const spy = vi.fn(async () => jsonResponse({ ok: true, live }));
    const bare = new WarconClient({
      baseUrl: 'https://panel.example.com',
      token: 'warcon-key',
      fetchImpl: spy as unknown as typeof fetch
    });
    await bare.fetchServer('s1');
    const headers = (spy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['CF-Access-Client-Id']).toBeUndefined();
    expect(headers['Authorization']).toBe('Bearer warcon-key');
  });

  it('builds the summary url', async () => {
    const spy = vi.fn(async () => jsonResponse({ ok: true, live }));
    await client(spy as unknown as typeof fetch).fetchServer('abc-123');
    expect(spy.mock.calls[0]![0]).toBe('https://panel.example.com/api/servers/abc-123/summary');
  });

  it('returns the live payload', async () => {
    const result = await client((async () => jsonResponse({ ok: true, live })) as unknown as typeof fetch)
      .fetchServer('s1');
    expect(result.gameServerId).toBe('code-1');
  });

  it('names a Cloudflare Access redirect', async () => {
    const redirect = async () =>
      new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } });
    await expect(client(redirect as unknown as typeof fetch).fetchServer('s1'))
      .rejects.toThrow(CloudflareBlockedError);
  });

  it('names a Cloudflare Access HTML body', async () => {
    const html = async () =>
      new Response('<!DOCTYPE html><title>Sign in</title>', { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(client(html as unknown as typeof fetch).fetchServer('s1'))
      .rejects.toThrow(/blocked by Cloudflare Access/);
  });

  it('distinguishes a Warcon auth rejection', async () => {
    const denied = async () => jsonResponse({ error: { message: 'nope' } }, 403);
    await expect(client(denied as unknown as typeof fetch).fetchServer('s1'))
      .rejects.toThrow(WarconAuthError);
  });

  it('throws a plain error on 500', async () => {
    const boom = async () => jsonResponse({ error: { message: 'boom' } }, 500);
    const err = await client(boom as unknown as typeof fetch).fetchServer('s1').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CloudflareBlockedError);
    expect(err).not.toBeInstanceOf(WarconAuthError);
  });

  it('throws when the body carries no live data', async () => {
    const empty = async () => jsonResponse({ ok: false, error: { message: 'Not observed yet.' } });
    await expect(client(empty as unknown as typeof fetch).fetchServer('s1'))
      .rejects.toThrow(/Not observed yet/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/warcon.test.ts`
Expected: FAIL — cannot resolve `../src/warcon.js`.

- [ ] **Step 4: Write the implementation**

Create `src/warcon.ts`:

```ts
import type { WarconLive } from './types.js';

/** The panel sits behind Cloudflare Access and our request never reached Warcon. */
export class CloudflareBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudflareBlockedError';
  }
}

/** We reached Warcon and it refused our API key. */
export class WarconAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WarconAuthError';
  }
}

export interface WarconClientOptions {
  baseUrl: string;
  token: string;
  cfClientId?: string | null;
  cfClientSecret?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface SummaryBody {
  ok?: boolean;
  live?: WarconLive;
  error?: { message?: string };
}

export class WarconClient {
  constructor(private readonly opts: WarconClientOptions) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.token}`,
      Accept: 'application/json'
    };
    if (this.opts.cfClientId && this.opts.cfClientSecret) {
      headers['CF-Access-Client-Id'] = this.opts.cfClientId;
      headers['CF-Access-Client-Secret'] = this.opts.cfClientSecret;
    }
    return headers;
  }

  async fetchServer(serverId: string): Promise<WarconLive> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const url = `${this.opts.baseUrl}/api/servers/${encodeURIComponent(serverId)}/summary`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 10000);

    let res: Response;
    try {
      res = await doFetch(url, {
        headers: this.headers(),
        redirect: 'manual',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') ?? '';
      if (/cloudflareaccess\.com/i.test(location)) {
        throw new CloudflareBlockedError(
          `blocked by Cloudflare Access (redirected to ${location}) — service token missing, expired, or no Service Auth policy matches`
        );
      }
      throw new Error(`unexpected redirect ${res.status} to ${location}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new WarconAuthError(
        `warcon auth rejected (${res.status}) — check WARCON_TOKEN and that the key has server.view on this server`
      );
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!/application\/json/i.test(contentType)) {
      throw new CloudflareBlockedError(
        `blocked by Cloudflare Access (non-JSON response, content-type: ${contentType || 'none'})`
      );
    }

    if (!res.ok) {
      throw new Error(`warcon request failed (${res.status})`);
    }

    const body = (await res.json()) as SummaryBody;
    if (!body.live) {
      throw new Error(body.error?.message ?? 'warcon returned no live data');
    }
    return body.live;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/warcon.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/warcon.ts tests/warcon.test.ts
git commit -m "feat: authenticated Warcon client with named failure modes

A Cloudflare Access bounce (redirect or HTML body) and a Warcon auth
rejection produce distinct errors, so an expired service token is never
mistaken for an expired API key."
```

---

### Task 4: Snapshot store

Holds the last good observation per server so a brief outage does not blank the sidebar, and decides when data has gone stale.

**Files:**
- Create: `src/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `WarconLive` from Task 3
- Produces: interface `Snapshot { serverId, live, fresh, lastOkAt, lastError }`; class `SnapshotStore` with `recordSuccess(serverId, live)`, `recordFailure(serverId, error)`, `get(serverId): Snapshot`

- [ ] **Step 1: Write the failing test**

Create `tests/store.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — cannot resolve `../src/store.js`.

- [ ] **Step 3: Write the implementation**

Create `src/store.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: snapshot store with staleness window

A single failed fetch does not blank the sidebar; the last good
observation is retained until STALE_AFTER_MS elapses."
```

---

### Task 5: Render primitives

The formatting rules, as pure functions. This is where the spec's display decisions live.

**Files:**
- Create: `src/render.ts`
- Test: `tests/render-primitives.test.ts`

**Interfaces:**
- Consumes: label helpers from Task 2, types from Task 3
- Produces: constants `BAR_WIDTH = 10`, `BIO_MAX = 400`, `NICK_MAX = 32`, `NAME_MAX = 20`; functions `bar(score, max, width?)`, `formatSlots(playerCount, maxPlayers, reservedSlots)`, `contextLine(status)`, `truncate(text, max)`, `fitLines(lines, max)`, `topPlayers(players, n?)`, `hhmmUtc(ms)`

- [ ] **Step 1: Write the failing test**

Create `tests/render-primitives.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bar, formatSlots, contextLine, truncate, fitLines, topPlayers, hhmmUtc } from '../src/render.js';
import type { WarconPlayer, WarconStatus } from '../src/types.js';

describe('formatSlots', () => {
  it('adds reserved slots on top of the public cap', () => {
    expect(formatSlots(99, 98, 2)).toBe('99 / 100 +1 reserved online');
  });
  it('hides the suffix when nobody is in an overflow slot', () => {
    expect(formatSlots(40, 98, 2)).toBe('40 / 100');
  });
  it('handles a server with no reserved slots', () => {
    expect(formatSlots(40, 100, 0)).toBe('40 / 100');
  });
  it('treats an unknown reserved count as zero', () => {
    expect(formatSlots(40, 100, null)).toBe('40 / 100');
  });
  it('handles an empty server', () => {
    expect(formatSlots(0, 98, 2)).toBe('0 / 100');
  });
  it('handles a full server with every reserved slot taken', () => {
    expect(formatSlots(100, 98, 2)).toBe('100 / 100 +2 reserved online');
  });
});

describe('bar', () => {
  it('fills completely for the leader', () => {
    expect(bar(33, 33)).toBe('▰▰▰▰▰▰▰▰▰▰');
  });
  it('scales the others against the leader', () => {
    expect(bar(26, 33)).toBe('▰▰▰▰▰▰▰▰▱▱');
    expect(bar(24, 33)).toBe('▰▰▰▰▰▰▰▱▱▱');
  });
  it('renders an empty bar at zero', () => {
    expect(bar(0, 33)).toBe('▱▱▱▱▱▱▱▱▱▱');
  });
  it('renders an empty bar when every score is zero', () => {
    expect(bar(0, 0)).toBe('▱▱▱▱▱▱▱▱▱▱');
  });
  it('is always exactly BAR_WIDTH characters', () => {
    for (const score of [0, 1, 7, 15, 32, 33]) {
      expect([...bar(score, 33)]).toHaveLength(10);
    }
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('short', 20)).toBe('short');
  });
  it('shortens long text with an ellipsis', () => {
    expect(truncate('a'.repeat(30), 20)).toBe('a'.repeat(19) + '…');
    expect(truncate('a'.repeat(30), 20)).toHaveLength(20);
  });
});

describe('fitLines', () => {
  it('joins lines that fit', () => {
    expect(fitLines(['one', 'two'], 400)).toBe('one\ntwo');
  });
  it('drops whole trailing lines rather than cutting mid-line', () => {
    expect(fitLines(['aaaa', 'bbbb', 'cccc'], 9)).toBe('aaaa\nbbbb');
  });
  it('hard-truncates a single over-long line', () => {
    expect(fitLines(['a'.repeat(20)], 10)).toHaveLength(10);
  });
});

describe('topPlayers', () => {
  const players = (...rows: Array<[string, number, number]>): WarconPlayer[] =>
    rows.map(([name, kills, deaths]) => ({ name, steamId: '', faction: null, kills, deaths, cash: 0, ping: null }));

  it('sorts by kills descending', () => {
    const top = topPlayers(players(['low', 1, 0], ['high', 9, 0]));
    expect(top.map((p) => p.name)).toEqual(['high', 'low']);
  });
  it('breaks kill ties on fewer deaths', () => {
    const top = topPlayers(players(['many', 5, 9], ['few', 5, 1]));
    expect(top.map((p) => p.name)).toEqual(['few', 'many']);
  });
  it('breaks remaining ties on name', () => {
    const top = topPlayers(players(['zed', 5, 5], ['alice', 5, 5]));
    expect(top.map((p) => p.name)).toEqual(['alice', 'zed']);
  });
  it('returns at most five', () => {
    expect(topPlayers(players(['a',1,0],['b',2,0],['c',3,0],['d',4,0],['e',5,0],['f',6,0]))).toHaveLength(5);
  });
  it('does not mutate its input', () => {
    const input = players(['a', 1, 0], ['b', 9, 0]);
    topPlayers(input);
    expect(input[0]!.name).toBe('a');
  });
  it('handles an empty roster', () => {
    expect(topPlayers([])).toEqual([]);
  });
});

describe('contextLine', () => {
  const status: WarconStatus = {
    serverName: 'NA#2 - TEG.gg',
    map: 'NorthAmerica',
    experiences: ['NorthAmerica_KOTH_01'],
    lighting: 'DayClear',
    alternator: 'ZoneAlternator.NorthAmerica.Houses.Circle',
    scoreCap: null,
    matchSeconds: null,
    playerCount: 99,
    maxPlayers: 98,
    scores: []
  };

  it('renders the four-part line from the screenshot', () => {
    expect(contextLine(status)).toBe('Zestafona · Day Clear · King of the Hill · Zestafona Houses Circle');
  });

  it('omits parts that are unknown', () => {
    expect(contextLine({ ...status, lighting: '', experiences: [] }))
      .toBe('Zestafona · Zestafona Houses Circle');
  });
});

describe('hhmmUtc', () => {
  it('formats as zero-padded UTC hours and minutes', () => {
    expect(hhmmUtc(Date.parse('2026-09-21T14:32:00.000Z'))).toBe('14:32');
    expect(hhmmUtc(Date.parse('2026-09-21T04:05:00.000Z'))).toBe('04:05');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render-primitives.test.ts`
Expected: FAIL — cannot resolve `../src/render.js`.

- [ ] **Step 3: Write the implementation**

Create `src/render.ts`:

```ts
import { mapName, lightingLabel, expSetLabel, zoneLabel } from './labels.js';
import type { WarconPlayer, WarconStatus } from './types.js';

export const BAR_WIDTH = 10;
export const BIO_MAX = 400;
export const NICK_MAX = 32;
export const NAME_MAX = 20;
export const TOP_N = 5;

const FILLED = '▰';
const EMPTY = '▱';

/** A bar scaled to the leading faction, so the leader is always full. */
export function bar(score: number, max: number, width: number = BAR_WIDTH): string {
  if (max <= 0) return EMPTY.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((score / max) * width)));
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

/**
 * maxPlayers is the PUBLIC cap; reservedSlots sit on top of it (Warcon types.ts).
 * 99 players, cap 98, 2 reserved -> "99 / 100 +1 reserved online".
 */
export function formatSlots(
  playerCount: number,
  maxPlayers: number,
  reservedSlots: number | null
): string {
  const reserved = reservedSlots ?? 0;
  const total = maxPlayers + reserved;
  const overflow = Math.max(0, playerCount - maxPlayers);
  const base = `${playerCount} / ${total}`;
  return overflow > 0 ? `${base} +${overflow} reserved online` : base;
}

export function contextLine(status: WarconStatus): string {
  return [
    mapName(status.map),
    lightingLabel(status.lighting),
    expSetLabel(status.experiences),
    zoneLabel(status.alternator)
  ]
    .filter((part) => part && part !== '—')
    .join(' · ');
}

export function truncate(text: string, max: number): string {
  const value = text ?? '';
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)) + '…';
}

/** Drops whole trailing lines to fit the budget rather than cutting mid-line. */
export function fitLines(lines: string[], max: number): string {
  const kept: string[] = [];
  for (const line of lines) {
    if ([...kept, line].join('\n').length > max) break;
    kept.push(line);
  }
  const joined = kept.join('\n');
  return joined.length <= max ? joined : joined.slice(0, max);
}

/** Kills desc, then fewer deaths, then name — the ordering Warcon itself applies. */
export function topPlayers(players: WarconPlayer[], n: number = TOP_N): WarconPlayer[] {
  return [...players]
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name))
    .slice(0, n);
}

export function hhmmUtc(ms: number): string {
  const date = new Date(ms);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/render-primitives.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts tests/render-primitives.test.ts
git commit -m "feat: render primitives for slots, bars and labels

Slot suffix is omitted when no one occupies an overflow slot. Bars scale
to the leading faction so the ratio reads at a glance."
```

---

### Task 6: Presentation rendering

Assembles primitives into the three strings each bot displays, including the Bot 1 variant and offline handling.

**Files:**
- Modify: `src/render.ts` (append)
- Test: `tests/render-presentation.test.ts`

**Interfaces:**
- Consumes: everything from Task 5, `Snapshot` from Task 4
- Produces: types `Phase`, `Policy`, `Presentation`; constants `SLOTS_ONLY_PHASES`, `ROTATING_PHASES`; functions `renderName(template, live)`, `activityText(live, phase)`, `offlineText(lastOkAt)`, `factionLines(joinCode, status)`, `scoreboardLines(joinCode, players)`, `render(snapshot, policy, tick): Presentation`

- [ ] **Step 1: Write the failing test**

Create `tests/render-presentation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { render, ROTATING_PHASES, SLOTS_ONLY_PHASES, renderName, offlineText, BIO_MAX, NICK_MAX } from '../src/render.js';
import type { Policy } from '../src/render.js';
import type { Snapshot } from '../src/store.js';
import type { WarconLive, WarconPlayer, WarconStatus } from '../src/types.js';

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

function player(name: string, kills: number, deaths: number): WarconPlayer {
  return { name, steamId: '', faction: null, kills, deaths, cash: 0, ping: null };
}

function live(overrides: Partial<WarconLive> = {}): WarconLive {
  return {
    serverId: 's1',
    ok: true,
    error: '',
    tier: 'hot',
    build: 'CL-501228',
    gameServerId: '7f3a9c21-4e88-4b1a-9d02-6c5e1f0a8b77',
    startedAt: null,
    reservedSlots: 2,
    throttledUntil: null,
    status: status(),
    players: [player('PlayerOne', 24, 7), player('PlayerTwo', 19, 11), player('PlayerThree', 17, 9)],
    observedAt: '2026-09-21T14:32:00.000Z',
    ...overrides
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    serverId: 's1',
    live: live(),
    fresh: true,
    lastOkAt: Date.parse('2026-09-21T14:32:00.000Z'),
    lastError: null,
    ...overrides
  };
}

const standard: Policy = {
  bioMode: 'factions',
  activityPhases: SLOTS_ONLY_PHASES,
  nameTemplate: '{name}',
  joinCodeFallback: null
};

const variant: Policy = {
  bioMode: 'scoreboard',
  activityPhases: ROTATING_PHASES,
  nameTemplate: 'TEG - NA 2',
  joinCodeFallback: null
};

describe('render — standard bots', () => {
  it('shows slots as the activity', () => {
    expect(render(snapshot(), standard, 0).activity).toBe('99 / 100 +1 reserved online');
  });

  it('ignores the tick', () => {
    for (const tick of [0, 1, 2, 3, 99]) {
      expect(render(snapshot(), standard, tick).activity).toBe('99 / 100 +1 reserved online');
    }
  });

  it('builds the faction bio with the join code first', () => {
    expect(render(snapshot(), standard, 0).bio).toBe(
      [
        'Join code: 7f3a9c21-4e88-4b1a-9d02-6c5e1f0a8b77',
        '▰▰▰▰▰▰▰▰▰▰ 33 Manticore',
        '▰▰▰▰▰▰▰▰▱▱ 26 Valkyra',
        '▰▰▰▰▰▰▰▱▱▱ 24 Lonestar',
        'Zestafona · Day Clear · King of the Hill · Zestafona Houses Circle'
      ].join('\n')
    );
  });

  it('takes the nickname from the live server name', () => {
    expect(render(snapshot(), standard, 0).nickname).toBe('NA#2 - TEG.gg');
  });
});

describe('render — bot 1 variant', () => {
  it('cycles slots three times then each faction once', () => {
    const activities = [0, 1, 2, 3, 4, 5].map((t) => render(snapshot(), variant, t).activity);
    expect(activities).toEqual([
      '99 / 100 +1 reserved online',
      '99 / 100 +1 reserved online',
      '99 / 100 +1 reserved online',
      'Manticore 33',
      'Valkyra 26',
      'Lonestar 24'
    ]);
  });

  it('wraps around after six ticks', () => {
    expect(render(snapshot(), variant, 6).activity).toBe(render(snapshot(), variant, 0).activity);
    expect(render(snapshot(), variant, 9).activity).toBe('Manticore 33');
  });

  it('lists the top five with the join code first', () => {
    expect(render(snapshot(), variant, 0).bio).toBe(
      [
        'Join code: 7f3a9c21-4e88-4b1a-9d02-6c5e1f0a8b77',
        '1. PlayerOne 24-7',
        '2. PlayerTwo 19-11',
        '3. PlayerThree 17-9'
      ].join('\n')
    );
  });

  it('uses its configured literal nickname', () => {
    expect(render(snapshot(), variant, 0).nickname).toBe('TEG - NA 2');
  });

  it('says so when nobody is online', () => {
    const snap = snapshot({ live: live({ players: [] }) });
    expect(render(snap, variant, 0).bio).toContain('No players online');
  });
});

describe('render — offline and stale', () => {
  it('shows offline with the last seen time when stale', () => {
    const snap = snapshot({ fresh: false });
    expect(render(snap, standard, 0).activity).toBe('offline · last seen 14:32');
  });

  it('keeps the last known scores with a stale marker', () => {
    const bio = render(snapshot({ fresh: false }), standard, 0).bio;
    expect(bio).toContain('33 Manticore');
    expect(bio).toContain('⚠ offline · last seen 14:32');
  });

  it('shows plain offline when never observed', () => {
    const snap = snapshot({ live: null, fresh: false, lastOkAt: null });
    expect(render(snap, standard, 0).activity).toBe('offline');
  });

  it('still shows the fallback join code when never observed', () => {
    const snap = snapshot({ live: null, fresh: false, lastOkAt: null });
    const policy = { ...standard, joinCodeFallback: 'fallback-code' };
    expect(render(snap, policy, 0).bio).toContain('Join code: fallback-code');
  });
});

describe('render — join code fallback', () => {
  it('prefers the live join code', () => {
    const policy = { ...standard, joinCodeFallback: 'fallback-code' };
    expect(render(snapshot(), policy, 0).bio).toContain('7f3a9c21');
  });

  it('falls back when the build does not serve one', () => {
    const snap = snapshot({ live: live({ gameServerId: '' }) });
    const policy = { ...standard, joinCodeFallback: 'fallback-code' };
    expect(render(snap, policy, 0).bio).toContain('Join code: fallback-code');
  });

  it('says unavailable when there is neither', () => {
    const snap = snapshot({ live: live({ gameServerId: '' }) });
    expect(render(snap, standard, 0).bio).toContain('Join code: unavailable');
  });
});

describe('render — budgets', () => {
  it('never exceeds the bio limit with worst-case names', () => {
    const many = Array.from({ length: 20 }, (_, i) => player('W'.repeat(40) + i, 50 - i, i));
    const snap = snapshot({ live: live({ players: many }) });
    expect(render(snap, variant, 0).bio.length).toBeLessThanOrEqual(BIO_MAX);
  });

  it('truncates player names to twenty characters', () => {
    const snap = snapshot({ live: live({ players: [player('A'.repeat(40), 9, 0)] }) });
    expect(render(snap, variant, 0).bio).toContain('1. ' + 'A'.repeat(19) + '…');
  });

  it('never exceeds the nickname limit', () => {
    const snap = snapshot({ live: live({ status: status({ serverName: 'N'.repeat(60) }) }) });
    expect(render(snap, standard, 0).nickname.length).toBeLessThanOrEqual(NICK_MAX);
  });
});

describe('renderName', () => {
  it('substitutes the live server name', () => {
    expect(renderName('{name}', live())).toBe('NA#2 - TEG.gg');
  });
  it('supports a literal template', () => {
    expect(renderName('TEG - EU 1', live())).toBe('TEG - EU 1');
  });
  it('falls back when no name is known', () => {
    expect(renderName('{name}', null)).toBe('Wardogs');
  });
});

describe('offlineText', () => {
  it('reports the last seen time', () => {
    expect(offlineText(Date.parse('2026-09-21T14:32:00.000Z'))).toBe('offline · last seen 14:32');
  });
  it('omits the time when never seen', () => {
    expect(offlineText(null)).toBe('offline');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render-presentation.test.ts`
Expected: FAIL — `render` is not exported.

- [ ] **Step 3: Append the implementation to `src/render.ts`**

```ts
import type { Snapshot } from './store.js';
import type { BioMode } from './config.js';
import type { WarconLive, WarconPlayer, WarconStatus } from './types.js';

export type Phase = { kind: 'slots' } | { kind: 'faction'; index: number };

/** Bots 2-5: slots only. */
export const SLOTS_ONLY_PHASES: Phase[] = [{ kind: 'slots' }];

/** Bot 1: the 3:1:1:1 ratio as six phases. */
export const ROTATING_PHASES: Phase[] = [
  { kind: 'slots' },
  { kind: 'slots' },
  { kind: 'slots' },
  { kind: 'faction', index: 0 },
  { kind: 'faction', index: 1 },
  { kind: 'faction', index: 2 }
];

export interface Policy {
  bioMode: BioMode;
  activityPhases: Phase[];
  nameTemplate: string;
  joinCodeFallback: string | null;
}

export interface Presentation {
  nickname: string;
  activity: string;
  bio: string;
}

export function renderName(template: string, live: WarconLive | null): string {
  const serverName = live?.status?.serverName ?? '';
  const rendered = template.replace(/\{name\}/g, serverName).trim();
  return rendered || serverName || 'Wardogs';
}

export function offlineText(lastOkAt: number | null): string {
  return lastOkAt === null ? 'offline' : `offline · last seen ${hhmmUtc(lastOkAt)}`;
}

export function activityText(live: WarconLive, phase: Phase): string {
  const status = live.status!;
  const slots = formatSlots(status.playerCount, status.maxPlayers, live.reservedSlots);
  if (phase.kind === 'slots') return slots;
  const faction = status.scores[phase.index];
  return faction ? `${faction.name} ${faction.score}` : slots;
}

function joinCodeLine(live: WarconLive | null, fallback: string | null): string {
  const code = (live?.gameServerId || '').trim() || fallback || '';
  return `Join code: ${code || 'unavailable'}`;
}

export function factionLines(joinLine: string, status: WarconStatus): string[] {
  const lines = [joinLine];
  const max = Math.max(0, ...status.scores.map((s) => s.score));
  for (const faction of status.scores) {
    lines.push(`${bar(faction.score, max)} ${faction.score} ${faction.name}`);
  }
  const context = contextLine(status);
  if (context) lines.push(context);
  return lines;
}

export function scoreboardLines(joinLine: string, players: WarconPlayer[]): string[] {
  const lines = [joinLine];
  const top = topPlayers(players);
  if (top.length === 0) {
    lines.push('No players online');
    return lines;
  }
  top.forEach((p, i) => {
    lines.push(`${i + 1}. ${truncate(p.name, NAME_MAX)} ${p.kills}-${p.deaths}`);
  });
  return lines;
}

export function render(snapshot: Snapshot, policy: Policy, tick: number): Presentation {
  const live = snapshot.live;
  const nickname = truncate(renderName(policy.nameTemplate, live), NICK_MAX);
  const joinLine = joinCodeLine(live, policy.joinCodeFallback);

  if (!live || !live.status) {
    return {
      nickname,
      activity: offlineText(snapshot.lastOkAt),
      bio: fitLines([joinLine], BIO_MAX)
    };
  }

  const phases = policy.activityPhases.length > 0 ? policy.activityPhases : SLOTS_ONLY_PHASES;
  const phase = phases[tick % phases.length]!;

  const lines =
    policy.bioMode === 'scoreboard'
      ? scoreboardLines(joinLine, live.players)
      : factionLines(joinLine, live.status);

  if (!snapshot.fresh) {
    lines.push(`⚠ ${offlineText(snapshot.lastOkAt)}`);
  }

  return {
    nickname,
    activity: snapshot.fresh ? activityText(live, phase) : offlineText(snapshot.lastOkAt),
    bio: fitLines(lines, BIO_MAX)
  };
}
```

> Move the three `import` lines to the top of the file alongside the existing imports; they are shown here together for readability.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/render-presentation.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts tests/render-presentation.test.ts
git commit -m "feat: presentation rendering with bot 1 variant

Bot 1's 3:1:1:1 rotation is a six-element phase array indexed by tick, so
both variants share one render path. Stale snapshots keep their last known
scores behind an offline marker."
```

---

### Task 7: Reconciler

**Files:**
- Create: `src/reconcile.ts`
- Test: `tests/reconcile.test.ts`

**Interfaces:**
- Consumes: `Presentation` from Task 6
- Produces: type `Changes = Partial<Presentation>`; function `diff(desired: Presentation, applied: Partial<Presentation>): Changes`

- [ ] **Step 1: Write the failing test**

Create `tests/reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diff } from '../src/reconcile.js';
import type { Presentation } from '../src/render.js';

const desired: Presentation = { nickname: 'TEG - NA 2', activity: '99 / 100', bio: 'Join code: abc' };

describe('diff', () => {
  it('returns everything when nothing has been applied', () => {
    expect(diff(desired, {})).toEqual(desired);
  });

  it('returns nothing when everything matches', () => {
    expect(diff(desired, { ...desired })).toEqual({});
  });

  it('returns only the changed field', () => {
    expect(diff(desired, { ...desired, activity: '98 / 100' })).toEqual({ activity: '99 / 100' });
  });

  it('suppresses the bio when only the activity moved', () => {
    const changes = diff(desired, { ...desired, activity: 'Manticore 33' });
    expect(changes.bio).toBeUndefined();
    expect(changes.nickname).toBeUndefined();
  });

  it('detects a bio change on its own', () => {
    const changes = diff(desired, { ...desired, bio: 'Join code: old' });
    expect(changes).toEqual({ bio: 'Join code: abc' });
  });

  it('treats an empty string as a real value, not missing', () => {
    expect(diff({ ...desired, bio: '' }, { ...desired, bio: '' })).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reconcile.test.ts`
Expected: FAIL — cannot resolve `../src/reconcile.js`.

- [ ] **Step 3: Write the implementation**

Create `src/reconcile.ts`:

```ts
import type { Presentation } from './render.js';

export type Changes = Partial<Presentation>;

/**
 * Only fields whose text actually changed. PATCH /applications/@me has no
 * documented rate limit, so an unchanged bio must never be rewritten.
 */
export function diff(desired: Presentation, applied: Partial<Presentation>): Changes {
  const changes: Changes = {};
  if (desired.nickname !== applied.nickname) changes.nickname = desired.nickname;
  if (desired.activity !== applied.activity) changes.activity = desired.activity;
  if (desired.bio !== applied.bio) changes.bio = desired.bio;
  return changes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reconcile.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/reconcile.ts tests/reconcile.test.ts
git commit -m "feat: reconciler suppressing unchanged Discord writes"
```

---

### Task 8: Bot runner

**Files:**
- Create: `src/bot.ts`
- Test: `tests/bot.test.ts`

**Interfaces:**
- Consumes: `render`, `Policy`, `Presentation` (Task 6), `diff` (Task 7), `Snapshot` (Task 4)
- Produces: interface `DiscordTarget { setActivity, setNickname, setBio }`; interface `Logger`; class `BotRunner` with `update(snapshot, tick): Promise<void>` and readonly `appliedState`

- [ ] **Step 1: Write the failing test**

Create `tests/bot.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot.test.ts`
Expected: FAIL — cannot resolve `../src/bot.js`.

- [ ] **Step 3: Write the implementation**

Create `src/bot.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/bot.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/bot.ts tests/bot.test.ts
git commit -m "feat: bot runner applying only reconciled changes

Fields apply independently so one failure neither blocks the others nor
records itself as applied, leaving the next tick to retry it."
```

---

### Task 9: Fetch scheduling — backoff and throttle

Spec §8 requires exponential backoff per server and respecting Warcon's
`throttledUntil`. Without this the loop hammers a failing server every 15s and
ignores a listener that has asked the panel to slow down.

**Files:**
- Create: `src/schedule.ts`
- Test: `tests/schedule.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: class `FetchScheduler` with `ready(serverId): boolean`, `recordSuccess(serverId, throttledUntil: string | null)`, `recordFailure(serverId)`, `delayFor(failures): number`

- [ ] **Step 1: Write the failing test**

Create `tests/schedule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FetchScheduler } from '../src/schedule.js';

describe('FetchScheduler', () => {
  it('is ready for an unknown server', () => {
    expect(new FetchScheduler(15000, 300000, () => 1000).ready('s1')).toBe(true);
  });

  it('stays ready while fetches succeed', () => {
    const s = new FetchScheduler(15000, 300000, () => 1000);
    s.recordSuccess('s1', null);
    expect(s.ready('s1')).toBe(true);
  });

  it('holds off after a failure', () => {
    let now = 1000;
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordFailure('s1');
    expect(s.ready('s1')).toBe(false);
    now = 1000 + 15000;
    expect(s.ready('s1')).toBe(true);
  });

  it('doubles the delay on consecutive failures', () => {
    const s = new FetchScheduler(15000, 300000, () => 0);
    expect(s.delayFor(1)).toBe(15000);
    expect(s.delayFor(2)).toBe(30000);
    expect(s.delayFor(3)).toBe(60000);
  });

  it('caps the delay', () => {
    const s = new FetchScheduler(15000, 60000, () => 0);
    expect(s.delayFor(10)).toBe(60000);
  });

  it('resets the backoff after a success', () => {
    let now = 1000;
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordFailure('s1');
    s.recordFailure('s1');
    now = 1000 + 300000;
    s.recordSuccess('s1', null);
    s.recordFailure('s1');
    expect(s.delayFor(1)).toBe(15000);
    now = now + 15000;
    expect(s.ready('s1')).toBe(true);
  });

  it('honours throttledUntil from Warcon', () => {
    let now = Date.parse('2026-09-21T14:32:00.000Z');
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordSuccess('s1', '2026-09-21T14:32:30.000Z');
    expect(s.ready('s1')).toBe(false);
    now += 31000;
    expect(s.ready('s1')).toBe(true);
  });

  it('ignores a throttledUntil in the past', () => {
    const now = Date.parse('2026-09-21T14:32:00.000Z');
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordSuccess('s1', '2026-09-21T14:00:00.000Z');
    expect(s.ready('s1')).toBe(true);
  });

  it('ignores an unparseable throttledUntil', () => {
    const now = 1000;
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordSuccess('s1', 'not-a-date');
    expect(s.ready('s1')).toBe(true);
  });

  it('keeps servers independent', () => {
    let now = 1000;
    const s = new FetchScheduler(15000, 300000, () => now);
    s.recordFailure('s1');
    expect(s.ready('s1')).toBe(false);
    expect(s.ready('s2')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schedule.test.ts`
Expected: FAIL — cannot resolve `../src/schedule.js`.

- [ ] **Step 3: Write the implementation**

Create `src/schedule.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/schedule.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/schedule.ts tests/schedule.test.ts
git commit -m "feat: per-server fetch backoff and throttle handling

Exponential backoff after failures, capped, and Warcon's throttledUntil is
honoured so a listener asking the panel to slow down is not ignored."
```

---

### Task 10: Discord target and entry point

**Files:**
- Create: `src/discord-target.ts`, `src/index.ts`
- Test: `tests/discord-target.test.ts`

**Interfaces:**
- Consumes: everything above, including `FetchScheduler` from Task 9
- Produces: `DiscordJsTarget implements DiscordTarget`, `createClient()`, `main()`

- [ ] **Step 1: Write the failing test**

Create `tests/discord-target.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DiscordJsTarget } from '../src/discord-target.js';

function fakeClient() {
  return {
    user: { setActivity: vi.fn() },
    rest: { patch: vi.fn(async () => ({})) }
  };
}

describe('DiscordJsTarget', () => {
  it('sets a Playing activity', async () => {
    const client = fakeClient();
    await new DiscordJsTarget(client as never, ['g1']).setActivity('99 / 100');
    expect(client.user.setActivity).toHaveBeenCalledWith('99 / 100', { type: 0 });
  });

  it('patches the nickname in every configured guild', async () => {
    const client = fakeClient();
    await new DiscordJsTarget(client as never, ['g1', 'g2']).setNickname('TEG - NA 2');
    expect(client.rest.patch).toHaveBeenCalledTimes(2);
    expect(client.rest.patch).toHaveBeenCalledWith('/guilds/g1/members/@me', { body: { nick: 'TEG - NA 2' } });
    expect(client.rest.patch).toHaveBeenCalledWith('/guilds/g2/members/@me', { body: { nick: 'TEG - NA 2' } });
  });

  it('patches the application description for the bio', async () => {
    const client = fakeClient();
    await new DiscordJsTarget(client as never, ['g1']).setBio('Join code: abc');
    expect(client.rest.patch).toHaveBeenCalledWith('/applications/@me', { body: { description: 'Join code: abc' } });
  });

  it('never touches the global username', async () => {
    const client = fakeClient();
    const target = new DiscordJsTarget(client as never, ['g1']);
    await target.setNickname('TEG - NA 2');
    await target.setBio('x');
    const paths = client.rest.patch.mock.calls.map((c) => c[0]);
    expect(paths).not.toContain('/users/@me');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discord-target.test.ts`
Expected: FAIL — cannot resolve `../src/discord-target.js`.

- [ ] **Step 3: Write `src/discord-target.ts`**

```ts
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
      await this.client.rest.patch(Routes.guildMember(guildId, '@me'), {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/discord-target.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write `src/index.ts`**

```ts
import { Client, Events, Options } from 'discord.js';
import { loadConfig } from './config.js';
import type { BotBinding } from './config.js';
import { WarconClient, CloudflareBlockedError, WarconAuthError } from './warcon.js';
import { SnapshotStore } from './store.js';
import { FetchScheduler } from './schedule.js';
import { BotRunner } from './bot.js';
import type { Logger } from './bot.js';
import { DiscordJsTarget } from './discord-target.js';
import { ROTATING_PHASES, SLOTS_ONLY_PHASES } from './render.js';
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
    bioMode: bot.bioMode,
    activityPhases: bot.bioMode === 'scoreboard' ? ROTATING_PHASES : SLOTS_ONLY_PHASES,
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
        new DiscordJsTarget(client, binding.guildIds),
        policyFor(binding),
        `bot${binding.index}`,
        log
      )
    });
  }

  let tick = 0;

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
      runners.map(({ binding, runner }) => runner.update(store.get(binding.serverId), tick))
    );
    tick += 1;
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
```

- [ ] **Step 6: Verify the whole suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Verify it fails cleanly with no configuration**

Run: `node --experimental-strip-types src/index.ts 2>&1 | head -20` or `npx tsx src/index.ts`
Expected: exits non-zero listing every missing environment variable. This confirms fail-fast behaviour without needing real credentials.

- [ ] **Step 8: Commit**

```bash
git add src/discord-target.ts src/index.ts tests/discord-target.test.ts
git commit -m "feat: discord target and process entry point

Clients start with no intents and zeroed caches. One poll loop serves all
five bots; SIGTERM destroys every client cleanly."
```

---

### Task 11: Documentation and deployment

**Files:**
- Create: `README.md`
- Modify: `.gitignore` (verify `node_modules/` and `dist/` present)

**Interfaces:**
- Consumes: everything
- Produces: nothing consumed by code

- [ ] **Step 1: Write `README.md`**

````markdown
# Wardogs Discord Bots

Five Discord bot accounts in one Node process. Each shows one Wardogs server's
live player count, faction scores and join code as Discord sidebar presence.

- **Bots 2-5** — activity shows player slots; About Me shows the join code,
  faction score bars and the map/lighting/mode line.
- **Bot 1** (A/B variant) — activity rotates 3:1:1:1 across slots, Manticore,
  Valkyra and Lonestar; About Me shows the join code and the top five players
  by kills.

Design: `docs/superpowers/specs/2026-09-21-wardogs-discord-bots-design.md`

## Requirements

- Node 20 or newer
- A Warcon org API key with the `server.view` capability, scoped to the five
  server ids (minting one requires the **owner** org role)
- A Cloudflare Access service token, if the Warcon panel is behind Access

## Setup

```bash
npm install
cp .env.example .env    # then fill in .env
npm test
npm run build
npm start
```

## Configuration

Every value comes from the environment. `.env` is gitignored — never commit it.

| Variable | Purpose |
|---|---|
| `WARCON_BASE_URL` | Panel origin, e.g. `https://panel.example.com` |
| `WARCON_TOKEN` | Warcon org API key (`server.view`) |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Cloudflare service token; omit both if not behind Access |
| `BOT{1..5}_TOKEN` | Discord bot token |
| `BOT{1..5}_SERVER_ID` | Warcon server id this bot displays |
| `BOT{1..5}_GUILD_IDS` | Comma-separated guild ids for nickname updates |
| `BOT{1..5}_NAME_TEMPLATE` | `{name}` for the live server name, or a literal such as `TEG - NA 2` |
| `BOT{1..5}_JOIN_CODE` | Fallback join code for builds that do not serve `GET /v1/server-id` |
| `POLL_INTERVAL_MS` | Default `15000` |
| `STALE_AFTER_MS` | Default `90000` |
| `REQUEST_TIMEOUT_MS` | Default `10000` |

## Discord setup, per bot

1. Create the application and bot at <https://discord.com/developers/applications>.
2. Leave **all** privileged intents **off** — none are used.
3. Invite it with the `bot` scope and the **Change Nickname** permission.
4. Copy the bot token into `.env`.

The bot's **global username is never changed** (Discord allows only two changes
per hour). Only the per-guild nickname is updated.

## Cloudflare Access

If the panel is behind Access, create a service token in Zero Trust →
Access → Service Auth, then add a second policy to the **existing** Access
application with action **Service Auth** selecting that token. Do not create a
Service-Auth-only application on `/api/*` — Warcon's own web UI calls those
routes from the browser and would be locked out.

Verify with:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  "$WARCON_BASE_URL/api/health"
```

A `401` or `403` from Warcon means success — you cleared Cloudflare and Warcon
is correctly refusing a request with no API key. A `302` to
`*.cloudflareaccess.com` means the policy is not matching.

**The service token expires** (default one year). When it does, the logs will
say `blocked by Cloudflare Access`. Set a calendar reminder.

## Deploying to Railway

One service, no inbound port. Set every variable above in the Railway
dashboard; the start command is `npm start`.

## Rate limits

| Call | Budget | Usage |
|---|---|---|
| Warcon API | 120/min per IP | ~20/min |
| Discord presence | 5 per 20s | 1 per 15s per bot |
| `PATCH /applications/@me` | undocumented | only when text changes |

The reconciler suppresses unchanged writes, which is what keeps the bottom row
safe.

## Troubleshooting

| Log line | Cause |
|---|---|
| `blocked by Cloudflare Access` | Service token missing, expired, or no Service Auth policy matches |
| `warcon auth rejected` | `WARCON_TOKEN` invalid, or the key lacks `server.view` on that server |
| `failed to set nickname` | The bot lacks **Change Nickname** in that guild |
| `Join code: unavailable` | Warcon reported no `gameServerId`; set `BOT{i}_JOIN_CODE` |
````

- [ ] **Step 2: Verify the build and full suite one last time**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS, no type errors, `dist/` produced.

- [ ] **Step 3: Confirm no secrets are tracked**

Run: `git status --short && git ls-files | grep -E '^\.env$' && echo "PROBLEM: .env tracked" || echo "OK: .env not tracked"`
Expected: `OK: .env not tracked`.

- [ ] **Step 4: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: setup, Cloudflare Access and troubleshooting guide"
```

---

## After implementation

Before the first real deployment, settle the three assumptions in spec §11 from
one live response:

```bash
curl -sS -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
        -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
        -H "Authorization: Bearer $WARCON_TOKEN" \
        "$WARCON_BASE_URL/api/servers/<id>/summary" | jq '.live | {gameServerId, reservedSlots, startedAt, status: {maxPlayers, playerCount, alternator}}'
```

1. `status.maxPlayers` should be the **public** cap (98 where `MaxPlayers=100`
   and `MaxReservedSlots=2`). If it is already the total, drop the addition in
   `formatSlots`.
2. `status.alternator` should match `ZoneAlternator.<Map>.<Zone>.<Shape>`. If it
   differs, fix `zoneLabel` in `src/labels.ts` and its tests.
3. `gameServerId` empty means the build does not serve `GET /v1/server-id`; set
   `BOT{i}_JOIN_CODE` for each affected bot.
