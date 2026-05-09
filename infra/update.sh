#!/bin/bash
# ============================================================
# Aviator 生产环境更新脚本
# 用法: bash update.sh [--skip-backup] [--skip-frontend] [--skip-backend]
# ============================================================

set -e

cd /opt/aviator/infra

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[UPDATE]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

SKIP_BACKUP=false
SKIP_FRONTEND=false
SKIP_BACKEND=false

for arg in "$@"; do
  case $arg in
    --skip-backup)   SKIP_BACKUP=true ;;
    --skip-frontend) SKIP_FRONTEND=true ;;
    --skip-backend)  SKIP_BACKEND=true ;;
  esac
done

# ============================================================
# 0. Git pull (在 repo 根)
# ============================================================
cd /opt/aviator
log "📥 拉取最新代码..."
# Auto-stash dirty tree (safety net for hand-tweaks on the server)
if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "工作区有未提交修改，自动 stash"
  git stash push -m "auto-stash by update.sh @ $(date +%FT%T)"
fi
git pull --rebase --autostash
log "✅ 当前 HEAD: $(git log -1 --format='%h %s')"
cd /opt/aviator/infra

# ============================================================
# 1. 备份 Mongo (kidseng 系 postgres 思路, 我哋用 mongodump)
# ============================================================
if [ "$SKIP_BACKUP" = false ]; then
  log "📦 备份 MongoDB..."
  BACKUP_DIR="/opt/aviator/backup"
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/aviator_$(date +%Y%m%d_%H%M%S).archive.gz"

  # 经由 docker-compose exec 跑 mongodump,用 archive 模式直出 stdout
  cd /opt/aviator/aviator-back
  docker compose exec -T mongo mongodump --archive --gzip --db aviator > "$BACKUP_FILE"
  cd /opt/aviator/infra

  BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  log "✅ 备份完成: $BACKUP_FILE ($BACKUP_SIZE)"

  # 保留最近 10 个备份
  BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/aviator_*.archive.gz 2>/dev/null | wc -l)
  if [ "$BACKUP_COUNT" -gt 10 ]; then
    ls -1t "$BACKUP_DIR"/aviator_*.archive.gz | tail -n +11 | xargs rm -f
    log "🗑️  清理旧备份，保留最近 10 个"
  fi
else
  warn "跳过数据库备份"
fi

# ============================================================
# 2. 重建后端容器 (build from ../aviator-back/)
# ============================================================
if [ "$SKIP_BACKEND" = false ]; then
  log "🔨 重建后端容器..."
  cd /opt/aviator/aviator-back

  if [ ! -f .env ]; then
    err "aviator-back/.env 唔见 — 由 .env.example copy 然后填 secrets 先"
    exit 1
  fi

  docker compose up -d --build api
  cd /opt/aviator/infra
  log "✅ 后端已重建"
else
  warn "跳过后端"
fi

# ============================================================
# 3. 重建前端 (CRA build)
# ============================================================
if [ "$SKIP_FRONTEND" = false ]; then
  log "📦 安装/更新前端依赖..."
  cd /opt/aviator
  # --legacy-peer-deps 处理旧 react-app-rewired 依赖链
  npm install --legacy-peer-deps --silent

  log "🔨 构建前端 (~30-60s)..."
  npm run build
  cd /opt/aviator/infra

  BUILD_SIZE=$(du -sh /opt/aviator/build 2>/dev/null | cut -f1)
  log "✅ 前端已构建 ($BUILD_SIZE @ /opt/aviator/build)"
else
  warn "跳过前端"
fi

# ============================================================
# 4. 等待服务健康（最多 60 秒）
# ============================================================
log "⏳ 等待服务启动..."
sleep 3

API_PORT=18805
for i in $(seq 1 12); do
  if curl -sf "http://localhost:$API_PORT/health" > /dev/null 2>&1; then
    log "✅ 服务健康检查通过: $(curl -sf http://localhost:$API_PORT/health)"
    break
  fi

  if [ $i -eq 12 ]; then
    err "❌ 服务启动超时，请检查日志:"
    cd /opt/aviator/aviator-back
    docker compose logs api --tail=30
    exit 1
  fi

  warn "等待中... ($((i * 5))s / 60s)"
  sleep 5
done

# ============================================================
# 5. 显示当前版本信息
# ============================================================
log "📋 当前镜像:"
cd /opt/aviator/aviator-back
docker compose images | grep "api" || true
cd /opt/aviator/infra

echo ""
log "🎉 更新完成！"
echo "   commit:  $(cd /opt/aviator && git log -1 --format='%h %s')"
echo "   build:   /opt/aviator/build"
echo "   api:     http://localhost:$API_PORT/health"
echo "   nginx 直接 serve build/ — 唔需要 reload"
