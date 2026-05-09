# Deploy

Production deploy scripts for the Aviator crash game.

## Files

| File | Purpose |
|------|---------|
| `setup.sh` | First-time bootstrap on a fresh server (apt, docker, nginx, ssl, env stubs, first build) |
| `update.sh` | Pull-and-rebuild script to run after every commit |
| `nginx.aviator.conf.example` | Nginx server block template (substituted by `setup.sh`) |

## First-time setup (run once)

```bash
ssh you@yourserver
cd /var/www
git clone <repo-url> aviator
cd aviator

sudo bash deploy/setup.sh aviator.example.com you@example.com
```

`setup.sh` is **idempotent** — re-running it skips steps that are already done.
It installs Docker, Nginx, Certbot, Node 20, configures the firewall, creates
`.env` stubs, builds the project for the first time, sets up Nginx + HTTPS.

After it finishes, edit secrets:

```bash
nano aviator-back/.env   # TELEGRAM_BOT_TOKEN, TRON_*, RAZORPAY_*, etc
nano .env                # REACT_APP_REOWN_PROJECT_ID

./deploy/update.sh       # rebuild with the new env
```

Then point your Telegram bot's WebApp URL at `https://yourdomain` via @BotFather.

## Routine update (after each commit)

```bash
ssh you@yourserver
cd /var/www/aviator
./deploy/update.sh
```

That's it. The script:

1. `git pull --rebase` (auto-stashes dirty working tree)
2. `docker compose up -d --build api` in `aviator-back/`
3. `npm install --legacy-peer-deps && npm run build`
4. Health-checks `http://localhost:18805/health`

Nginx serves `build/` directly off disk — no reload needed.

### Tunables

```bash
SKIP_FRONTEND=1 ./deploy/update.sh    # backend-only changes
SKIP_BACKEND=1  ./deploy/update.sh    # frontend-only changes
BRANCH=staging  ./deploy/update.sh    # check out a different branch first
API_PORT=20000  ./deploy/update.sh    # if you remapped the port
```

## What lives where

```
/var/www/aviator/                  ← repo
├── build/                          ← CRA static, served by nginx
├── aviator-back/
│   ├── .env                        ← secrets (gitignored)
│   └── docker-compose.yml          ← mongo + api containers
└── deploy/
    ├── setup.sh
    └── update.sh

/etc/nginx/sites-enabled/<domain>   ← nginx server block (HTTPS, reverse-proxy)
/etc/letsencrypt/live/<domain>/     ← SSL cert + key
```

## Rollback

```bash
cd /var/www/aviator
git log --oneline -10                    # find the good commit
git checkout <sha>                       # detached HEAD is fine for emergency
./deploy/update.sh

# Once verified, fix the bug on a branch and force-push to main, OR
git checkout main && git reset --hard <sha> && git push --force-with-lease
```

For backend-only rollbacks of containers: `docker compose images` shows the
build SHA tags — Docker keeps the previous image until it's pruned.

## Mongo backups

The api container does NOT touch mongo data — that lives in a Docker volume
called `aviator-back_mongo_data`. Periodic backup:

```bash
docker compose -f /var/www/aviator/aviator-back/docker-compose.yml \
  exec -T mongo mongodump --archive --gzip > /backups/aviator-$(date +%F).gz
```

Add to crontab for daily.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `update.sh` fails at git pull | `git status` — resolve conflicts manually |
| `502 Bad Gateway` on /api | `docker compose logs --tail=50 api` (in aviator-back) |
| Frontend stale | confirm `build/` modtime: `ls -la build/index.html` |
| Cert expired | `certbot renew --dry-run`; cron should auto-renew every 60d |
| Mongo container restarting | `docker compose logs mongo` — likely disk space |
| API healthy but 404 from frontend | nginx not reloaded after first install — `nginx -t && systemctl reload nginx` |
