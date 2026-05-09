#!/usr/bin/env bash
# setup.sh — first-time bootstrap of the Aviator project on a fresh server.
# After it succeeds, future updates are just `./deploy/update.sh`.
#
# Assumptions:
#   • Ubuntu 22.04 / 24.04 with sudo (or running as root)
#   • Domain DNS already points to this server (A record proxied via CF / etc)
#   • You have the repo cloned at the current working directory
#
# Usage:
#   sudo bash deploy/setup.sh aviator.example.com you@example.com
#                              ^domain              ^email for Let's Encrypt
#
# Re-runnable: each step checks "already done" before acting.

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "usage: sudo bash deploy/setup.sh <domain> <email>"
  echo "  e.g.  sudo bash deploy/setup.sh aviator.example.com admin@example.com"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m  %s\n' "$*"; }
skip() { printf '\033[1;33m·\033[0m  %s (already done)\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------
log "updating apt + installing base packages"
apt update -qq
DEBIAN_FRONTEND=noninteractive apt install -y -qq \
  docker.io docker-compose-plugin \
  nginx certbot python3-certbot-nginx \
  ufw curl git
ok "apt packages installed"

# ---------------------------------------------------------------------------
# 2. Node.js (via nvm — system-wide install for this user)
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && node --version | grep -qE 'v(20|22|24)\.'; then
  skip "node $(node --version) already installed"
else
  log "installing Node 20 via nvm"
  if [[ ! -d "$HOME/.nvm" ]]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm alias default 20
  ok "node $(node --version) installed"
fi

# ---------------------------------------------------------------------------
# 3. Firewall
# ---------------------------------------------------------------------------
log "configuring firewall (ssh + 80 + 443)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable >/dev/null
ok "ufw active"

# ---------------------------------------------------------------------------
# 4. .env stubs (only if missing — never overwrites)
# ---------------------------------------------------------------------------
if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  log "creating frontend .env stub"
  cat > "$PROJECT_ROOT/.env" <<EOF
REACT_APP_API_URL=https://$DOMAIN
REACT_APP_REOWN_PROJECT_ID=
EOF
  ok "$PROJECT_ROOT/.env (edit me with your Reown projectId)"
else
  skip "frontend .env exists"
fi

if [[ ! -f "$PROJECT_ROOT/aviator-back/.env" ]]; then
  log "creating backend .env from .env.example"
  cp "$PROJECT_ROOT/aviator-back/.env.example" "$PROJECT_ROOT/aviator-back/.env"
  # Generate a JWT_SECRET if blank
  JWT=$(openssl rand -hex 32)
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" "$PROJECT_ROOT/aviator-back/.env"
  sed -i "s|^TELEGRAM_WEBAPP_URL=.*|TELEGRAM_WEBAPP_URL=https://$DOMAIN|" "$PROJECT_ROOT/aviator-back/.env"
  sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://$DOMAIN|" "$PROJECT_ROOT/aviator-back/.env" || true
  sed -i "s|^ALLOW_DEV_AUTH=.*|ALLOW_DEV_AUTH=false|" "$PROJECT_ROOT/aviator-back/.env"
  ok "aviator-back/.env (edit: TELEGRAM_BOT_TOKEN, TRON_*, RAZORPAY_*)"
else
  skip "backend .env exists"
fi

# ---------------------------------------------------------------------------
# 5. Backend container (first build)
# ---------------------------------------------------------------------------
log "starting backend stack (mongo + api)"
cd "$PROJECT_ROOT/aviator-back"
docker compose up -d --build
sleep 4
if curl -fsS http://localhost:18805/health >/dev/null 2>&1; then
  ok "backend up — $(curl -fsS http://localhost:18805/health)"
else
  echo "⚠ backend not responding yet, check: docker compose logs --tail=50 api"
fi
cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# 6. Frontend build
# ---------------------------------------------------------------------------
log "installing + building frontend"
npm install --legacy-peer-deps --silent
npm run build
ok "frontend built at $PROJECT_ROOT/build"

# ---------------------------------------------------------------------------
# 7. Nginx site
# ---------------------------------------------------------------------------
NGINX_AVAILABLE="/etc/nginx/sites-available/$DOMAIN"
NGINX_ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

if [[ ! -f "$NGINX_AVAILABLE" ]]; then
  log "writing nginx config for $DOMAIN"
  sed "s|__DOMAIN__|$DOMAIN|g; s|__ROOT__|$PROJECT_ROOT/build|g" \
    "$SCRIPT_DIR/nginx.aviator.conf.example" > "$NGINX_AVAILABLE"
  ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
  nginx -t
  systemctl reload nginx
  ok "nginx serving HTTP on :80 → $PROJECT_ROOT/build"
else
  skip "nginx config $NGINX_AVAILABLE exists"
fi

# ---------------------------------------------------------------------------
# 8. Let's Encrypt (HTTPS)
# ---------------------------------------------------------------------------
if [[ ! -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  log "obtaining Let's Encrypt certificate"
  certbot --nginx -d "$DOMAIN" \
    --non-interactive --agree-tos --email "$EMAIL" --redirect
  ok "HTTPS active for $DOMAIN"
else
  skip "cert /etc/letsencrypt/live/$DOMAIN already issued"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo
ok "setup complete"
echo
echo "Next steps:"
echo "  1. nano $PROJECT_ROOT/aviator-back/.env       # fill TELEGRAM_BOT_TOKEN, TRON_*, RAZORPAY_*"
echo "  2. nano $PROJECT_ROOT/.env                    # fill REACT_APP_REOWN_PROJECT_ID"
echo "  3. ./deploy/update.sh                         # rebuild with the new env"
echo "  4. open https://$DOMAIN/health                # should return JSON"
echo "  5. Tell @BotFather your bot's WebApp URL: https://$DOMAIN"
