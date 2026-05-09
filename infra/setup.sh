#!/bin/bash
# ============================================================
# Aviator 生产环境首次部署脚本
# 用法: sudo bash setup.sh <domain> <email>
#   eg: sudo bash setup.sh aviator.example.com admin@example.com
# ============================================================
# Idempotent — 重跑会跳过已完成步骤。
# 跑完之后日常更新只用: bash /opt/aviator/infra/update.sh
# ============================================================

set -e

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "usage: sudo bash setup.sh <domain> <email>"
  echo "  e.g. sudo bash setup.sh aviator.example.com admin@example.com"
  exit 1
fi

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[SETUP]${NC} $1"; }
warn() { echo -e "${YELLOW}[SETUP]${NC} ⚠️  $1"; }
skip() { echo -e "${YELLOW}[SETUP]${NC} ·  $1 (already done)"; }

PROJECT_ROOT="/opt/aviator"

# ============================================================
# 1. 系统包
# ============================================================
log "📦 安装系统依赖 (docker, nginx, certbot, ufw)..."
apt update -qq
DEBIAN_FRONTEND=noninteractive apt install -y -qq \
  docker.io docker-compose-plugin \
  nginx certbot python3-certbot-nginx \
  ufw curl git
log "✅ apt 包已安装"

# ============================================================
# 2. Node.js 20 (via nvm)
# ============================================================
if command -v node >/dev/null 2>&1 && node --version | grep -qE 'v(20|22|24)\.'; then
  skip "node $(node --version) 已安装"
else
  log "📦 安装 Node 20 (nvm)..."
  if [ ! -d "$HOME/.nvm" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm alias default 20
  log "✅ node $(node --version) 已安装"
fi

# ============================================================
# 3. 防火墙
# ============================================================
log "🛡  配置防火墙 (ssh + 80 + 443)..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable >/dev/null
log "✅ ufw 已激活"

# ============================================================
# 4. .env stubs (只在缺失时创建)
# ============================================================
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  log "📄 创建前端 .env stub..."
  cat > "$PROJECT_ROOT/.env" <<EOF
REACT_APP_API_URL=https://$DOMAIN
REACT_APP_REOWN_PROJECT_ID=
EOF
  log "✅ $PROJECT_ROOT/.env (记得编辑填 Reown projectId)"
else
  skip "frontend .env 存在"
fi

if [ ! -f "$PROJECT_ROOT/aviator-back/.env" ]; then
  log "📄 创建后端 .env (从 .env.example)..."
  cp "$PROJECT_ROOT/aviator-back/.env.example" "$PROJECT_ROOT/aviator-back/.env"
  JWT=$(openssl rand -hex 32)
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" "$PROJECT_ROOT/aviator-back/.env"
  sed -i "s|^TELEGRAM_WEBAPP_URL=.*|TELEGRAM_WEBAPP_URL=https://$DOMAIN|" "$PROJECT_ROOT/aviator-back/.env"
  sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://$DOMAIN|" "$PROJECT_ROOT/aviator-back/.env" || true
  sed -i "s|^ALLOW_DEV_AUTH=.*|ALLOW_DEV_AUTH=false|" "$PROJECT_ROOT/aviator-back/.env"
  log "✅ aviator-back/.env (编辑: TELEGRAM_BOT_TOKEN, TRON_*, RAZORPAY_*)"
else
  skip "backend .env 存在"
fi

# ============================================================
# 5. 后端容器 (首次 build)
# ============================================================
log "🐳 启动后端栈 (mongo + api)..."
cd "$PROJECT_ROOT/aviator-back"
docker compose up -d --build
sleep 4
if curl -fsS http://localhost:18805/health >/dev/null 2>&1; then
  log "✅ 后端运行中: $(curl -fsS http://localhost:18805/health)"
else
  warn "后端尚未响应，检查: docker compose logs --tail=50 api"
fi
cd "$PROJECT_ROOT"

# ============================================================
# 6. 前端构建
# ============================================================
log "📦 安装 + 构建前端..."
npm install --legacy-peer-deps --silent
npm run build
log "✅ 前端构建完成 @ $PROJECT_ROOT/build"

# ============================================================
# 7. Nginx site
# ============================================================
NGINX_AVAILABLE="/etc/nginx/sites-available/$DOMAIN"
NGINX_ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

if [ ! -f "$NGINX_AVAILABLE" ]; then
  log "🌐 写 nginx config @ $DOMAIN..."
  sed "s|aviator\.example\.com|$DOMAIN|g" \
    "$PROJECT_ROOT/infra/nginx/nginx.conf" > "$NGINX_AVAILABLE"
  ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
  # 临时禁用 HTTPS block 让 certbot 先拿证书
  sed -i 's|listen 443 ssl;|# listen 443 ssl;|' "$NGINX_AVAILABLE"
  sed -i 's|ssl_certificate |# ssl_certificate |g' "$NGINX_AVAILABLE"
  nginx -t
  systemctl reload nginx
  log "✅ nginx 在 :80 提供 $PROJECT_ROOT/build"
else
  skip "nginx config $NGINX_AVAILABLE 存在"
fi

# ============================================================
# 8. Let's Encrypt (HTTPS)
# ============================================================
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  log "🔐 申请 Let's Encrypt 证书..."
  certbot --nginx -d "$DOMAIN" \
    --non-interactive --agree-tos --email "$EMAIL" --redirect
  log "✅ HTTPS 已激活 @ $DOMAIN"
else
  skip "证书 /etc/letsencrypt/live/$DOMAIN 已存在"
fi

# ============================================================
# Done
# ============================================================
echo ""
log "🎉 setup 完成！"
echo ""
echo "下一步:"
echo "  1. nano $PROJECT_ROOT/aviator-back/.env       # 填 TELEGRAM_BOT_TOKEN, TRON_*, RAZORPAY_*"
echo "  2. nano $PROJECT_ROOT/.env                    # 填 REACT_APP_REOWN_PROJECT_ID"
echo "  3. bash $PROJECT_ROOT/infra/update.sh         # 用新 env 重 build"
echo "  4. open https://$DOMAIN/health                # 应该 return JSON"
echo "  5. @BotFather 设 bot WebApp URL: https://$DOMAIN"
