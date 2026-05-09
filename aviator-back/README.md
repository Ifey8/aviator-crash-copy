# Aviator Backend

Node + TypeScript + Express + Socket.IO + MongoDB + Telegram Bot.

Serves the React frontend in `../` (the parent repo) over Socket.IO and exposes a Telegram bot that opens the game as a Mini App.

## Quick start (Docker)

```bash
cp .env.example .env        # edit TELEGRAM_BOT_TOKEN if you have one
docker compose up -d --build
curl http://localhost:5000/health
```

The API listens on `:5000`. Mongo persists in the `mongo_data` volume.

## Quick start (no Docker)

```bash
npm install
cp .env.example .env
# Make sure mongod is running locally (mongodb://localhost:27017)
npm run dev
```

## Telegram bot

1. Talk to [@BotFather](https://t.me/BotFather), create a bot, copy the token.
2. Set `TELEGRAM_BOT_TOKEN` in `.env`.
3. Set `TELEGRAM_WEBAPP_URL` to a public URL where the React app is hosted (use `ngrok http 3000` for local dev).
4. Restart the backend; `/start` your bot in Telegram, tap the WebApp button.

## Auth modes

| Mode | When | Endpoint |
|------|------|----------|
| Telegram | `initData` is passed (Mini App) | `POST /api/auth/telegram` |
| Dev guest | `ALLOW_DEV_AUTH=true` | `POST /api/auth/guest` |

The frontend grabs the JWT, appends it as `?cert=<token>` to its URL, and emits it on `enterRoom`.

## Tests

```bash
npm test
```

Covers provably-fair determinism + Telegram HMAC validation.

## Endpoints

- `GET /health` — engine state
- `POST /api/auth/telegram` `{initData}` → `{token, ...}`
- `POST /api/auth/guest` `{name?}` → `{token, ...}` (dev only)
- `POST /api/my-info` `{name}` → `{status, data: GameHistory[]}`
- `GET /api/game/seed/:roundId` → `SeedDetailsType`

## Socket.IO contract

See `../CLAUDE.md` for the full event table.
