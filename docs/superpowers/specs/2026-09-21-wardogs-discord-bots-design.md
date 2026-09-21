# Wardogs Discord Bot Fleet — Design

Date: 2026-09-21
Status: approved, ready for implementation planning

## 1. Overview

A single Node.js process runs five Discord bot accounts. Each bot represents one
Wardogs game server and surfaces that server's live state in the Discord sidebar:

- **Activity** ("Playing …") — player slots, and for Bot 1 a rotating set of values
- **About Me** — the server's join code, plus faction scores (Bots 2–5) or a top-5
  scoreboard (Bot 1)
- **Nickname** — the server's display name, per guild

One process rather than five keeps hosting cost on a basic Railway tier while
preserving five distinct sidebar presences.

## 2. Data source

### 2.1 Decision: Warcon panel API, not the game servers' RCON listeners

`docs/wardogs-api.md` in the Warcon repo documents the **WDRCON listener that runs on
each game server** — plain HTTP on port 7776, bearer token = the RCON admin password.
We do **not** talk to it. Reasons:

- The bearer token is the RCON admin password, granting kick, kill, ban, broadcast and
  `PUT /v1/config`. Unacceptable privilege for a status bot.
- Plain HTTP only; the console "cannot be served over HTTPS".
- Listeners typically bind `127.0.0.1`, so exposing them needs panel access, ini edits
  and a server restart on all five servers.
- It would add a second poller to servers Warcon already polls.

Instead we read the Warcon panel's own JSON API, which serves the worker's stored
snapshot ("never a game request"), adding zero load to the game servers.

### 2.2 Endpoint

`GET {WARCON_BASE_URL}/api/servers/{serverId}/summary`

Returns `{ ok, role, caps, live, status, error? }` where `live` is a `LiveView`.
Requires the `server.view` capability.

### 2.3 Authentication — two layers

The panel sits behind a **Cloudflare Access** application using Google SSO. Cloudflare
intercepts before Warcon sees the request, so a valid Warcon token alone gets a 302 to
the Google login page. Both layers must be satisfied:

```
CF-Access-Client-Id:     <token-id>.access      # Cloudflare Zero Trust service token
CF-Access-Client-Secret: <token-secret>
Authorization:           Bearer <warcon-api-key> # Warcon org API key
```

Warcon explicitly supports this (`src/hooks.server.ts`): *"Bots: an organisation API key
as a bearer token, on the JSON API only. It stands in for the session (cookies are
ignored) and for the CSRF header."* It is honoured on every `/api/*` route.

**Cloudflare setup:** create a service token (Zero Trust → Access → Service Auth), then
add a second policy to the **existing** Access application with action **Service Auth**
selecting that token. Leave the existing Google SSO policy untouched.

> Do **not** create a narrower `/api/*` application with only a Service Auth policy.
> Warcon's own web UI calls `/api/*` from the browser, so that would lock humans out of
> the panel. If tighter scoping is wanted later, that app needs *both* policies.

**Warcon key:** minted at `POST /api/orgs/{id}/keys`, which requires the **owner** org
role. Scope it to capability `server.view` and the five `serverIds` — read-only, five
servers, nothing more. The token is returned once, at creation.

The service token expires (default one year). Expiry manifests as login redirects, which
is why the client detects and names that failure (§8).

### 2.4 Payload fields we consume

From `LiveView` / `Status` / `Player` (Warcon's `src/lib/types.ts`):

| Field | Use |
|---|---|
| `gameServerId` | join code — first line of every bio |
| `status.serverName` | nickname source (via template) |
| `status.playerCount` | slots numerator |
| `status.maxPlayers` | total slot cap (reserved slots included) |
| `reservedSlots` | slots held back for reserved players, **inside** `status.maxPlayers` |
| `status.scores[]` | `{name, colorHex, score}` — Manticore / Valkyra / Lonestar |
| `status.map`, `.lighting`, `.experiences[]`, `.alternator` | context line (raw ids) |
| `players[]` | `{name, faction, kills, deaths, cash, ping}` — top-5 board |
| `ok`, `error`, `observedAt`, `tier`, `throttledUntil` | liveness and backoff |
| `startedAt` | optional: twelve-hour restart awareness |

## 3. Architecture

One poll loop, one store, five clients, a pure render layer and a reconciler.

```
  every 15s ──▶ worker: 5 × GET /api/servers/{id}/summary  (parallel, per-request timeout)
                                   │
                                   ▼
                        store: Map<serverId, Snapshot>
                                   │
            ┌──────────────┬───────┴───────┬──────────────┐
            ▼              ▼               ▼              ▼
         bot1           bot2            bot3    …       bot5
      (policy A)     (policy B)      (policy B)      (policy B)
            │
            ▼
   render(snapshot, policy, tick) → { nickname, activity, bio }
            │
            ▼
   reconcile(desired, lastApplied) → issue ONLY changed fields
            │
            ▼
   Discord: setActivity / PATCH nickname / PATCH application description
```

A single tick counter increments once per poll. Bot 1 indexes its six-phase array by
`tick % 6`; Bots 2–5 hold a one-element array and ignore the tick.

### 3.1 Modules

```
src/config.ts      env → typed config; validates all five bindings at boot, exits loudly
src/warcon.ts      authenticated client: three headers, timeout, backoff, CF detection
src/store.ts       latest snapshot per server + staleness clock
src/schedule.ts    per-server fetch backoff + Warcon throttledUntil
src/render.ts      PURE: snapshot + policy + tick → strings. zero I/O
src/reconcile.ts   diff desired vs applied; emit only changed fields
src/bot.ts         one Discord client + its policy object
src/index.ts       wiring, timers, SIGTERM
src/labels.ts      ports of Warcon's mapName / lightingLabel / expSetLabel / zoneLabel
```

`render.ts` is pure by design: every formatting rule is testable from a fixture with no
network and no Discord connection.

### 3.2 Bot 1 as policy, not a fork

Bot 1's A/B variant is expressed as data, not a branch:

```ts
type Policy = {
  bioMode: 'factions' | 'scoreboard';
  activityPhases: Phase[];   // Bot 1: 6 entries; Bots 2–5: 1 entry
};
```

There is no `if (botIndex === 0)` anywhere in the render path.

## 4. Configuration

All secrets come from the environment. `.env.example` is committed with names only;
`.env` holds real values and is gitignored; Railway variables mirror it.

```
WARCON_BASE_URL
WARCON_TOKEN
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET

BOT1_TOKEN   BOT1_SERVER_ID   BOT1_GUILD_IDS   BOT1_NAME_TEMPLATE
…
BOT5_TOKEN   BOT5_SERVER_ID   BOT5_GUILD_IDS   BOT5_NAME_TEMPLATE

POLL_INTERVAL_MS   (default 15000)
STALE_AFTER_MS     (default 90000)
```

If `CF_ACCESS_*` are absent the client omits those headers, so a co-located or
bypass-policy deployment needs no code change.

`NAME_TEMPLATE` defaults to `{name}` (the live server name) and may be overridden with a
literal such as `TEG - NA 2`.

## 5. Rendered output

### 5.1 Bots 2–5

```
Activity:  Playing 99 / 100 +1 reserved online

About Me:  Join code: 7f3a9c21-4e88-4b1a-9d02-6c5e1f0a8b77
           ▰▰▰▰▰▰▰▰▰▰ 33 Manticore
           ▰▰▰▰▰▰▰▰▱▱ 26 Valkyra
           ▰▰▰▰▰▰▰▱▱▱ 24 Lonestar
           Zestafona · Day Clear · King of the Hill · Zestafona Houses Circle

Nickname:  TEG - NA 2
```

### 5.2 Bot 1 (A/B variant)

Six phases at 15s = a 90-second cycle, ratio 3:1:1:1.

```
tick % 6 == 0,1,2 → Playing 99 / 100 +1 reserved online
tick % 6 == 3     → Playing Manticore 33
tick % 6 == 4     → Playing Valkyra 26
tick % 6 == 5     → Playing Lonestar 24

About Me:  Join code: 7f3a9c21-4e88-4b1a-9d02-6c5e1f0a8b77
           1. PlayerOne   24-7
           2. PlayerTwo   19-11
           3. PlayerThree 17-9
           4. PlayerFour  15-12
           5. PlayerFive  12-8
```

### 5.3 Formatting rules

- **Slots:** `players / maxPlayers`; suffix `+N reserved online` where
  `N = max(0, players − (maxPlayers − reservedSlots))`. `maxPlayers` is the **total**
  cap and reserved slots sit **inside** it, confirmed against the live builds, where
  `maxPlayers` reads 100 whether or not slots are reserved. So 100 total with 2 reserved
  gives a public cap of 98, and the 99th player reads `99 / 100 +1 reserved online`. The
  suffix is omitted when `N == 0`, so a quiet server reads plainly `40 / 100` and the
  suffix appears only when it is meaningful.
- **Bars:** 10 characters wide, `▰` filled and `▱` empty, `round(score / maxScore * 10)`.
  Scaling to the leader (not to `scoreCap`, which live builds omit) keeps the ratio
  readable and always fills the leading faction.
- **Faction order:** as returned by `status.scores[]`, preserving Warcon's own ordering.
- **Top 5:** sort by kills desc, then deaths asc, then name — the same ordering Warcon
  applies. Names truncate to 20 characters.
- **Labels:** `map`, `lighting`, `experiences[]` and `alternator` arrive as raw ids
  (`NorthAmerica`, `DayClear`, `KOTH_01`). `src/labels.ts` ports Warcon's helpers so
  output matches the panel, including `MAP_DISPLAY` (`Kavkazi`→Bakurani,
  `Europe`→Ozeti, `NorthAmerica`→Zestafona).
- **Budgets:** bio hard-capped at 400 characters (application description limit),
  nickname at 32. Both truncate deterministically rather than erroring.

## 6. Rate limits

| Call | Budget | Our usage |
|---|---|---|
| Warcon API | 120/min per client IP | ~20/min (5 servers × 4/min) |
| Discord presence update | 5 per 20s per session | 1 per 15s per bot |
| `PATCH /applications/@me` | **undocumented** | only when text changes |
| Nickname `PATCH` | generous | effectively once, at boot |

The reconciler governs the bottom two rows. Bio text changes only when a faction score
moves — minutes apart — so writes drop from a naive ~28,800/day to a few hundred.

## 7. Discord client configuration

- `new Client({ intents: [] })` — no guild, member, message or presence intents.
- Caches explicitly zeroed via `makeCache`, since no cached entity is ever read.
- Expected footprint: well under 200MB for all five clients.
- Each bot requires the **Change Nickname** permission in every guild it is configured
  for. Nickname is set via `PATCH /guilds/{id}/members/@me`.
- About Me is the **application description**, set via `client.application.edit({ description })`,
  falling back to `client.rest.patch(Routes.currentApplication(), …)` if the helper
  proves unreliable. It is global per application, not per guild.
- The bot's **global username is never changed** — Discord caps that at two changes per
  hour, which no live-updating scheme can respect.

## 8. Failure handling

| Condition | Behaviour |
|---|---|
| Redirect to `*.cloudflareaccess.com`, or non-JSON body | log `blocked by Cloudflare Access` — names an expired/misconfigured service token |
| Warcon `401` / `403` | log `warcon auth rejected` — distinct from the above so an expired API key is never confused with an expired CF token |
| `ok: false`, or `observedAt` older than `STALE_AFTER_MS` | activity `offline · last seen 14:32`; bio retains last known scores with a stale marker |
| Transient network error / 5xx | exponential backoff for that server only |
| `throttledUntil` set | respect it; hold that server's next fetch |

One server failing never stalls the loop: fetches run in parallel with individual
timeouts, and the other four continue updating. SIGTERM destroys all clients cleanly.

## 9. Testing

Vitest. No test touches the network or Discord.

`render.ts` carries the bulk, from fixtures matching Warcon's TypeScript shapes:

- slot math: the `98 + 2 = 100` reserved case, zero-reserved, overflow, no-overflow
  (suffix hidden), empty server
- bar scaling, including ties and a zero-score faction
- top-5 sorting, tie-breaks, fewer than five players, name truncation
- the full six-phase Bot 1 sequence across `tick % 6`
- 400-char bio budget under worst-case names; 32-char nickname truncation
- offline and stale rendering

`reconcile.ts` is tested against a stubbed Discord client, asserting **which calls are
suppressed** when input is unchanged.

## 10. Deployment

Single Railway service, Node 20+, no inbound port required. All configuration via
environment variables. Recommended: a calendar reminder for Cloudflare service token
expiry.

## 11. Assumptions to verify before implementation

Derived from reading Warcon's source, not from observed data. One authenticated response
from any one server settles all three — obtainable by opening
`https://<panel>/api/servers/<id>/summary` in a logged-in browser tab, since session
cookies are honoured on `/api/*`.

1. ~~`status.maxPlayers` is the public cap on the live builds in use.~~ **Settled
   2026-09-21: it is the total cap, reserved slots included — always 100 regardless of
   `reservedSlots`. `formatSlots` derives the public cap by subtraction.**
2. The literal `alternator` string format, which feeds `zoneLabel`.
3. Whether `startedAt` and `gameServerId` are populated — both depend on build version
   and optional routes (`GET /v1/health`, `GET /v1/server-id`, the latter new in
   CL-501228). A missing `gameServerId` requires a configured fallback join code.

Also outstanding: the reference file `image_98f088.png` cited in the original brief was
never supplied. The rendered strings above derive from the supplied Discord card
screenshot. If that file shows different team names, map data or slot formatting, §5
needs revisiting.

## 12. Out of scope

- Any write or moderation action against game servers (kick, ban, broadcast, config).
- Slash commands, message handling, or embeds — these bots are sidebar presence only.
- Historical stats, leaderboards beyond the live top-5, or the kill feed.
- Changing bot global usernames or avatars.
