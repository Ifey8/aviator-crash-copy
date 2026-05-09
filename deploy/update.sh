#!/usr/bin/env bash
# update.sh — pull latest code, rebuild backend container, rebuild frontend.
# Run this on the production server, NOT locally.
#
#   ssh you@easyenglish
#   cd /var/www/aviator        (or wherever you cloned the repo)
#   ./deploy/update.sh
#
# Idempotent: safe to run multiple times. Stops on first error.
#
# Tunables (override via env):
#   SKIP_FRONTEND=1   skip the npm build step (useful for backend-only changes)
#   SKIP_BACKEND=1    skip docker compose rebuild (frontend-only changes)
#   BRANCH=main       which branch to checkout before pull (default: current)
#   API_PORT=18805    backend health-check port

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve paths (works whether script is invoked directly or via symlink).
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

API_PORT="${API_PORT:-18805}"
SKIP_FRONTEND="${SKIP_FRONTEND:-0}"
SKIP_BACKEND="${SKIP_BACKEND:-0}"
BRANCH="${BRANCH:-}"

# ---------------------------------------------------------------------------
# Pretty output
# ---------------------------------------------------------------------------
log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m  %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m  %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Git pull
# ---------------------------------------------------------------------------
log "git pull (project root: $PROJECT_ROOT)"
if [[ -n "$BRANCH" ]]; then
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
fi
# Stash anything dirty so pull doesn't fight; surface if real conflict.
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "  working tree dirty, stashing"
  git stash push -m "auto-stash by update.sh @ $(date +%FT%T)"
fi
git pull --rebase --autostash
ok "git up to date — $(git log -1 --format='%h %s')"

# ---------------------------------------------------------------------------
# 2. Backend (Docker compose)
# ---------------------------------------------------------------------------
if [[ "$SKIP_BACKEND" != "1" ]]; then
  log "rebuilding backend container"
  cd aviator-back

  if [[ ! -f .env ]]; then
    fail "aviator-back/.env missing — copy from .env.example and fill secrets first."
  fi

  docker compose up -d --build api
  cd "$PROJECT_ROOT"
  ok "backend container rebuilt"
else
  log "skipping backend (SKIP_BACKEND=1)"
fi

# ---------------------------------------------------------------------------
# 3. Frontend (CRA build)
# ---------------------------------------------------------------------------
if [[ "$SKIP_FRONTEND" != "1" ]]; then
  log "installing/refreshing frontend deps"
  # --legacy-peer-deps is needed for the older react-app-rewired chain.
  # --silent keeps deploy logs readable; remove if debugging install issues.
  npm install --legacy-peer-deps --silent

  log "building frontend (this takes ~30-60s)"
  npm run build

  ok "frontend built — $(du -sh build 2>/dev/null | cut -f1) at $PROJECT_ROOT/build"
else
  log "skipping frontend (SKIP_FRONTEND=1)"
fi

# ---------------------------------------------------------------------------
# 4. Health check (give the API a moment to come up if it was rebuilt)
# ---------------------------------------------------------------------------
log "health check (curl http://localhost:$API_PORT/health)"
for i in 1 2 3 4 5; do
  if curl -fsS --max-time 3 "http://localhost:$API_PORT/health" >/dev/null 2>&1; then
    ok "$(curl -fsS http://localhost:$API_PORT/health)"
    break
  fi
  if [[ "$i" == "5" ]]; then
    fail "API health endpoint not responding after 5 retries"
  fi
  echo "   waiting for api to come up… ($i/5)"
  sleep 2
done

# ---------------------------------------------------------------------------
# 5. Done
# ---------------------------------------------------------------------------
echo
ok "deploy complete · $(date +%FT%T)"
echo "   commit:  $(git log -1 --format='%h %s')"
echo "   build:   $PROJECT_ROOT/build"
echo "   api:     http://localhost:$API_PORT/health"
echo "   nginx serves /var/www/<host>/build/ directly — no reload needed."
