# Infra

Aviator 生产部署脚本(参照 easy_english `/opt/easy_english/infra/` pattern)。

## 文件

| File | Purpose |
|------|---------|
| `setup.sh` | 首次 server bootstrap(apt/docker/nginx/certbot/node/防火墙/build/SSL) |
| `update.sh` | 日常更新(git pull + mongo backup + rebuild + 健康检查) |
| `clean.sh` | Docker 空间清理 |
| `nginx/nginx.conf` | Nginx 配置(HTTP→HTTPS redirect + reverse proxy + WebSocket) |

## 路径约定

```
/opt/aviator/                   ← repo
├── build/                       ← CRA 构建产物,nginx 直接 serve
├── aviator-back/
│   ├── .env                     ← 后端 secrets (gitignored)
│   └── docker-compose.yml       ← mongo + api 容器
├── infra/
│   ├── setup.sh
│   ├── update.sh
│   ├── clean.sh
│   └── nginx/nginx.conf
├── backup/                      ← mongodump 备份(自动保留最近 10 个)
└── .env                         ← 前端 secrets (REACT_APP_*)
```

## 首次部署(一次性)

```bash
ssh easyenglish
cd /opt
git clone <你 repo URL> aviator
cd aviator

sudo bash infra/setup.sh aviator.yourdomain.com you@email.com
```

`setup.sh` 是 **idempotent** — 重跑会跳过已完成步骤。完成后:

```bash
nano aviator-back/.env       # 填 TELEGRAM_BOT_TOKEN, TRON_*, RAZORPAY_*
nano .env                    # 填 REACT_APP_REOWN_PROJECT_ID
bash infra/update.sh         # 用新 env 重新 build
```

@BotFather 设你 bot 的 WebApp URL = `https://aviator.yourdomain.com`。

## 日常更新(每次提交后)

```bash
ssh easyenglish
cd /opt/aviator
bash infra/update.sh
```

完。脚本自动:

1. `git pull --rebase`(脏 working tree 自动 stash)
2. `mongodump --archive --gzip` 备份 mongo(/opt/aviator/backup/aviator_YYYYMMDD_HHMMSS.archive.gz)
3. `cd aviator-back && docker compose up -d --build api`
4. `npm install --legacy-peer-deps && npm run build`
5. curl `/health` 健康检查(最多重试 12 × 5s = 60s)

带颜色 log,失败立即 stop。

### Flags

```bash
bash infra/update.sh --skip-backup       # 跳过 mongodump(快)
bash infra/update.sh --skip-frontend     # 仅后端改动
bash infra/update.sh --skip-backend      # 仅前端改动
```

## 数据库备份恢复

```bash
# 备份(update.sh 自动做)
docker compose -f /opt/aviator/aviator-back/docker-compose.yml \
  exec -T mongo mongodump --archive --gzip --db aviator > /opt/aviator/backup/manual_$(date +%F).gz

# 恢复(--drop 先清空再灌)
gunzip -c /opt/aviator/backup/aviator_<TIMESTAMP>.archive.gz | \
  docker compose -f /opt/aviator/aviator-back/docker-compose.yml \
  exec -T mongo mongorestore --archive --gzip --drop
```

## Docker 空间清理

```bash
bash infra/clean.sh                # 安全清理(dangling images, stopped containers, build cache)
bash infra/clean.sh --aggressive   # 加 unused images + volumes
```

## 回滚

```bash
cd /opt/aviator
git log --oneline -10              # 揾 good commit
git checkout <sha>                 # detached HEAD ok for emergency
bash infra/update.sh --skip-backup # 不需要再 backup,前一步刚做过
```

## 常见问题

| 症状 | 检查 |
|------|------|
| `update.sh` 卡 git pull | `git status` 解 conflict 后 retry |
| `502 Bad Gateway` on /api | `cd aviator-back && docker compose logs --tail=50 api` |
| 前端 stale | `ls -la /opt/aviator/build/index.html` 看 modtime |
| 证书过期 | `certbot renew --dry-run`;cron 应自动续 60d |
| Mongo 容器反复重启 | `docker compose logs mongo` — 通常是磁盘满 |
| API healthy 但前端 404 | `nginx -t && systemctl reload nginx` |

## 与 easy_english 主要差异

| 项 | easy_english | aviator |
|----|--------------|---------|
| 路径 | `/opt/easy_english/` | `/opt/aviator/` |
| DB | postgres + redis | mongo |
| 备份 | `pg_dump | gzip` | `mongodump --archive --gzip` |
| 镜像源 | ghcr.io 预 build | 本地 `docker compose --build` |
| 前端 | Next.js (容器化) | CRA (静态文件 + nginx) |
| 健康端点 | `:3000/api/health` | `:18805/health` |

未来如果接 GitHub Actions + ghcr.io,`update.sh` 改成 `docker compose pull` 即可。
