#!/usr/bin/env bash
# Runs ON THE VPS, piped in over SSH by .github/workflows/deploy.yml.
# Expects a checkout at $DEPLOY_DIR holding a .env that git never tracks.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/debain/wardogs-bots}"
BRANCH="${DEPLOY_BRANCH:-master}"

cd "$DEPLOY_DIR"

if [ ! -f .env ]; then
  echo "no .env in $DEPLOY_DIR — create it before the first deploy" >&2
  exit 1
fi

# .env is gitignored, so a hard reset cannot clobber it.
git fetch --prune origin
git reset --hard "origin/$BRANCH"
echo "deploying $(git rev-parse --short HEAD)"

docker compose build

# Credentials and panel reachability are checked against the NEW image before
# the running fleet is replaced. Read-only: it never writes to Discord.
echo "running preflight…"
docker compose run --rm --no-deps bots node dist/preflight.js

docker compose up -d
docker image prune -f >/dev/null
echo "deployed $(git rev-parse --short HEAD)"
