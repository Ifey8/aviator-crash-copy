#!/bin/bash
# ============================================================
# Aviator Docker 空间清理脚本
# 用法: bash clean.sh [--aggressive]
# ============================================================

set -e

log()  { echo -e "[CLEANUP] $1"; }
warn() { echo -e "[CLEANUP] ⚠️  $1"; }

log "📊 当前磁盘使用:"
df -h / | tail -1 | awk '{print "  总计: "$2"  已用: "$3"  可用: "$4"  使用率: "$5}'
echo ""

log "🐳 Docker 空间占用:"
docker system df
echo ""

# ── 清理悬挂镜像 ──
log "🗑️  清理悬挂镜像 (dangling)..."
docker image prune -f 2>/dev/null || true

# ── 清理已停止的容器 ──
log "🗑️  清理已停止的容器..."
docker container prune -f 2>/dev/null || true

# ── 清理未使用的网络 ──
log "🗑️  清理未使用的网络..."
docker network prune -f 2>/dev/null || true

# ── 清理构建缓存 ──
log "🗑️  清理构建缓存..."
docker builder prune -f 2>/dev/null || true

# ── 激进模式：清理所有未使用的镜像和 volumes ──
if [ "$1" = "--aggressive" ]; then
  warn "激进模式：清理所有未使用的镜像..."
  docker image prune -a -f 2>/dev/null || true

  warn "清理未使用的 volumes（不包括正在使用的）..."
  docker volume prune -f 2>/dev/null || true
fi

# ── 清理旧的数据库备份（保留最近 5 个） ──
BACKUP_DIR="/opt/aviator/backup"
if [ -d "$BACKUP_DIR" ]; then
  BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/aviator_*.archive.gz 2>/dev/null | wc -l)
  if [ "$BACKUP_COUNT" -gt 5 ]; then
    log "🗑️  清理旧备份（保留最近 5 个）..."
    ls -1t "$BACKUP_DIR"/aviator_*.archive.gz | tail -n +6 | xargs rm -f
    log "  删除了 $((BACKUP_COUNT - 5)) 个旧备份"
  else
    log "✅ 备份数量 ($BACKUP_COUNT) 未超限，无需清理"
  fi
fi

# ── 清理旧的前端构建缓存 ──
NMOD="/opt/aviator/node_modules/.cache"
if [ -d "$NMOD" ]; then
  log "🗑️  清理 webpack/babel cache ($(du -sh "$NMOD" | cut -f1))..."
  rm -rf "$NMOD" 2>/dev/null || true
fi

# ── 清理系统日志 ──
log "🗑️  清理系统日志..."
journalctl --vacuum-size=100M 2>/dev/null || true

# ── 清理 apt 缓存 ──
apt-get clean 2>/dev/null || true
apt-get autoremove -y 2>/dev/null || true

echo ""
log "📊 清理后磁盘使用:"
df -h / | tail -1 | awk '{print "  总计: "$2"  已用: "$3"  可用: "$4"  使用率: "$5}'
echo ""
log "🐳 清理后 Docker 空间:"
docker system df
echo ""
log "✅ 清理完成！"
echo ""
echo "提示: 如需更深度清理，运行: bash clean.sh --aggressive"
