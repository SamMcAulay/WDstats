# Wardogs Discord Bots

Six Discord bot accounts in one Node process. Each shows one Wardogs server's
live player count, faction scores and join code as Discord sidebar presence.

All six behave identically. They differ only in which server they watch and
what `BOT{i}_NAME_TEMPLATE` calls them.

```
nickname   EU#1 - TEG.gg
activity   99 / 100 Players on Zestafona
bio        Join code: `1538904f-08f9-41c3-a653-ca87da2904e4`
           ▱▱▱▱▱▱▱▱▱▱  4 Lonestar
           ▱▱▱▱▱▱▱▱▱▱  0 Valkyra
           ▰▰▰▰▱▱▱▱▱▱ 35 Manticore
```

The activity gains ` · +N reserved` when players are occupying reserved
slots. Bars run to the match's win threshold (`scoreCap`, or 100 when the
panel sends none), so a bar fills only when that faction has won. The join
code is backticked so Discord renders it as copyable code.

Design: `docs/superpowers/specs/2026-09-21-wardogs-discord-bots-design.md`

## Requirements

- Node 20 or newer
- A Warcon org API key with the `server.view` capability, scoped to the six
  server ids (minting one requires the **owner** org role)
- A Cloudflare Access service token, if the Warcon panel is behind Access

## Setup

```bash
npm install
cp .env.example .env    # then fill in .env
npm test
npm run preflight       # verify credentials without touching Discord
npm run build
npm start
```

## Preflight — check your credentials before going live

```bash
npm run preflight
```

Validates everything without connecting to the Discord gateway and without
writing anything to Discord. Safe to run against production tokens. It:

- checks each `BOT{i}_TOKEN` with a read-only `GET /users/@me`
- fetches every server's summary, naming a Cloudflare bounce and a Warcon
  rejection as separate failures
- prints the raw payload fields (`maxPlayers`, `reservedSlots`, `alternator`,
  `gameServerId`, `startedAt`) beside the values derived from them
- prints exactly what each bot would display, with every field measured
  against its Discord limit

Exits non-zero if any check fails, so it also works as a deploy gate.

Read the output for two things in particular: a `gameServerId` reported as
empty means that bot needs `BOT{i}_JOIN_CODE` set, and the `alternator` line
shows the raw string beside the label `zoneLabel` produces from it — if the
label looks wrong, that function needs adjusting for the real format.

### Testing without panel access

`scripts/mock-warcon.mjs` serves the same `/api/servers/{id}/summary` shape on
`127.0.0.1:8787`, so the fleet can be exercised end to end when the real panel
is unreachable — no Cloudflare Access service token needed.

```sh
npm run mock                                        # terminal 1
WARCON_BASE_URL=http://127.0.0.1:8787 npm run preflight   # terminal 2
```

The override works without touching `.env`: `dotenv` does not overwrite a
variable that is already set. Edit the `names` map in the script to match your
own server ids. The payloads deliberately cover reserved-slot overflow, a
zero-overflow server, zone alternators and one unreachable server, but the
`gameServerId` and `alternator` values are invented — only a real panel call
confirms those two.

## Deployment

The bots run on the same VPS as the Warcon panel, joined to the panel's own
Docker network. The panel call never leaves the host, so **Cloudflare Access
needs no changes and no service token** — leave `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET` empty. `WARCON_TOKEN` is still required; Access and
Warcon's own API auth are separate layers.

Inside a container `127.0.0.1` is the container itself, so address the panel
by its container name:

```
WARCON_BASE_URL=http://warcon:3000
```

### One-time VPS setup

```sh
git clone https://github.com/SamMcAulay/WDstats.git ~/wardogs-bots
cd ~/wardogs-bots
cp .env.example .env    # then fill it in — this file is never committed
```

Set the panel's network in `docker-compose.yml` (`networks.warcon.name`). To
find it:

```sh
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' <warcon-container>
```

### Auto-deploy on push

`.github/workflows/deploy.yml` runs typecheck and tests, then SSHes in and
executes `scripts/deploy.sh`, which resets the checkout to `origin/master`,
rebuilds the image, **runs preflight against the new image**, and only then
replaces the running fleet. A bad token or an unreachable panel aborts the
deploy instead of taking the bots down — preflight exits non-zero and
`set -e` stops the script before `docker compose up`.

`.env` is gitignored, so `git reset --hard` cannot clobber it.

Every Docker command in the deploy is scoped to this compose project, and the
panel's network is declared `external`, so Compose attaches to it but never
creates, alters or removes it. Nothing in the deploy touches the panel's
containers, images or volumes, and a missing network fails the deploy rather
than changing anything. Old build layers therefore accumulate; clear them by
hand when you choose to.

Repository secrets required:

| Secret | Value |
|---|---|
| `VPS_HOST` | Hostname or IP |
| `VPS_USER` | SSH user that can run `docker` |
| `VPS_SSH_KEY` | Private half of a deploy keypair, whose public half is in that user's `authorized_keys` |
| `VPS_HOST_KEY` | Optional. Pinned host key line; without it the workflow trusts `ssh-keyscan` on first contact |

## Configuration

Every value comes from the environment. `.env` is gitignored — never commit it.

| Variable | Purpose |
|---|---|
| `WARCON_BASE_URL` | Panel origin, e.g. `https://panel.example.com` |
| `WARCON_TOKEN` | Warcon org API key (`server.view`) |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Cloudflare service token; omit both if not behind Access |
| `BOT{1..6}_TOKEN` | Discord bot token |
| `BOT{1..6}_SERVER_ID` | Warcon server id this bot displays |
| `BOT{1..6}_GUILD_IDS` | Comma-separated guild ids for nickname updates |
| `BOT{1..6}_NAME_TEMPLATE` | `{name}` for the live server name, or a literal such as `"EU#1 - TEG.gg"`. Quote any value containing `#` — unquoted, dotenv treats it as a comment and keeps only what precedes it |
| `BOT{1..6}_JOIN_CODE` | Fallback join code for builds that do not serve `GET /v1/server-id` |
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
| Warcon API | 120/min per IP | ~24/min |
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
