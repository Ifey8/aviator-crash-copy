# CLAUDE.md — Aviator Crash Game

> 此文件為專案級指示，繼承 user global CLAUDE.md。Karpathy 四大定律放最前，永遠優先。

---

## 🎯 Andrej Karpathy 四大定律（最高優先級）

### 1. Think Before Coding · 落筆前先諗
- 講出假設，不確定就**問**。
- 多種解讀並存時，**列出來** — 唔好默默選一個。
- 有更簡單做法，**講出來**。
- 唔清楚就停低，指出令你混亂嘅地方。

### 2. Simplicity First · 越簡單越好
- 唔加冇人要嘅 feature / 抽象 / 「彈性」。
- 50 行能解決，唔好寫 200 行。
- 唔為極不可能嘅 scenario 寫防禦性代碼。

### 3. Surgical Changes · 外科手術式修改
- 改現有代碼**只動相關部分**，唔順便「改善」鄰近代碼。
- 跟現有 style 寫，即使你會用另一種方式。
- 注意到無關 dead code，**提一句**就好，唔好刪。
- 每行修改都要可追溯到用戶 request。

### 4. Goal-Driven Execution · 目標驅動執行
- 把 task 轉化為可驗證目標：「Add validation」→「寫 test for invalid inputs，跑通」。
- 多步任務先列簡短 plan + verify 條件。
- 強驗證條件令你能獨立 loop。

---

## 📦 Project Architecture

```
aviator-crash-copy/                   # Frontend (this repo root)
├── src/
│   ├── context.tsx                   # ★ Socket.IO hub + game state
│   ├── components/Crash/             # Unity WebGL + plane fallback
│   ├── components/Main/bet.tsx       # Bet UI (dual-bet "f"/"s")
│   ├── components/BetUsers/          # All bets, my bets, top history
│   └── config.ts                     # API URL from REACT_APP_API_URL
└── aviator-back/                     # Backend (sibling, see below)
```

**Tech**: React 18 + TS + Tailwind/SCSS + Socket.IO Client + Unity WebGL.

**Backend lives in `aviator-back/`**: Node + TS + Express + Socket.IO + Mongo + Telegram Bot (grammy).
Connects to frontend via Socket.IO at `REACT_APP_API_URL`. See `aviator-back/README.md`.

---

## 🔌 Socket.IO Contract (Frontend ↔ Backend)

**這是兩端唯一嘅契約。改任何一邊都要對齊另一邊。**

### Client → Server
| Event       | Payload                                              | Purpose                |
|-------------|------------------------------------------------------|------------------------|
| `enterRoom` | `{ token: string }`                                  | Join after socket open |
| `playBet`   | `{ betAmount, target, type: "f"\|"s", auto: bool }`  | Place bet              |
| `cashOut`   | `{ type: "f"\|"s", endTarget: number }`              | Cash out at multiplier |

### Server → Client
| Event             | Payload                                                  | When                          |
|-------------------|----------------------------------------------------------|-------------------------------|
| `gameState`       | `{ GameState: "BET"\|"PLAYING"\|"GAMEEND", time, ... }`  | Phase tick                    |
| `myInfo`          | `UserType` (balance, userType, userName)                 | After auth / balance change   |
| `myBetState`      | `UserType` (subset for f/s.betted)                       | After bet placed              |
| `bettedUserInfo`  | `BettedUserType[]`                                       | Each new bet during BET phase |
| `previousHand`    | `UserType[]`                                             | After GAMEEND                 |
| `finishGame`      | `UserType`                                               | After GAMEEND, per-user       |
| `history`         | `number[]` (last N crash points)                         | After GAMEEND                 |
| `getBetLimits`    | `{ max, min }`                                           | On connect                    |
| `recharge`        | `()`                                                     | When balance < minBet         |
| `error`           | `{ index: "f"\|"s", message }`                           | Bet rejected                  |
| `success`         | `string`                                                 | Bet/cashout OK                |

### REST API
- `POST /api/my-info` body `{ name }` → `{ status, data: GameHistory[] }`
- `GET /api/game/seed/:id` Bearer JWT → `SeedDetailsType`
- `POST /api/auth/telegram` body `{ initData }` → `{ token, user }`

---

## 🎮 Game Loop (canonical)

1. **BET phase** (5s): clients place bets via `playBet`. Server validates balance, deducts, broadcasts `bettedUserInfo`.
2. **PLAYING phase**: server ticks every ~100ms emitting `gameState` with rising multiplier. Formula:
   `multiplier = 1 + 0.06t + (0.06t)² − (0.04t)³ + (0.04t)⁴`
3. **Crash**: server pre-computed crash multiplier from provably-fair seed. When ticker reaches it → `GAMEEND`.
4. **Settle**: pay cashed-out players, emit `finishGame`/`previousHand`/`history`. 3s pause → goto 1.

**Provably fair**: HMAC-SHA256(serverSeed, clientSeedPool + ":" + nonce) → first 13 hex → uint52 → distribution → crash point.

### 🔒 Server-authoritative — clients cannot cheat
- **Crash point** is committed by the server BEFORE the round begins
  (`buildRoundSeed` in `engine.ts`). The serverSeed hash is published in
  advance via `upcomingSeedHash` (verifiable after the round when the seed
  is revealed). The frontend NEVER decides when the plane crashes.
- **Multiplier ticker** is driven by a server `setInterval`. The frontend
  runs the SAME polynomial locally only for visual smoothness between
  ticks — it cannot push the multiplier past the server's value.
- **Cashout** validation in `engine.cashOut()`:
  ```ts
  if (this.phase !== "PLAYING") return { ok: false }
  const at = Math.min(endTarget || this.multiplier, this.multiplier);
  if (at < 1.01) return { ok: false }
  ```
  The server clamps `endTarget` to its OWN `this.multiplier`, so a client
  lying about endTarget gets capped to whatever the server has actually
  ticked. Cashout requests after the server has crashed are rejected
  because the phase has already flipped to GAMEEND.
- **Balance** lives in MongoDB, mutated only by `engine.placeBet()` and
  `engine.cashOut()`. Client-side optimistic deduct is corrected by the
  next `myInfo` emit if it ever drifts.

---

## 📱 Mobile Notes (post-2026-05-09 refactor)

- Viewport meta tag in `public/index.html` (was missing).
- All modals: `max-width: 95vw` + `max-height: 90vh; overflow-y: auto`.
- Bet panel: stacks vertically on `<560px`, dual-bet → tabs on `<414px`.
- Touch targets ≥ 44×44px on mobile (per Apple HIG).
- Unity canvas: aspect-ratio preserved, `width: 100%; height: auto`.

---

## 🧪 How to Run Locally

```powershell
# Backend (in aviator-back/)
docker-compose up -d              # starts Mongo + node backend on :5000

# Frontend (this repo root)
echo "REACT_APP_API_URL=http://localhost:5000" > .env
npm install
npm start                         # opens http://localhost:3000
```

For Telegram bot testing: set `TELEGRAM_BOT_TOKEN` in `aviator-back/.env`, then `/start` your bot.

---

## ⚠️ Gotchas Learned

- **`react-app-rewired`** + Node polyfills required in `config-overrides.js` for `ethers`/`crypto-js` (already done).
- **Socket.IO transports**: client uses `['websocket', 'polling']` — backend must allow both for hot-reload reliability.
- **`react-unity-webgl`** loads Unity build files from `public/unity/`. If 404, check that build exists.
- **Token auth**: frontend grabs `?cert=...` from URL → emits as `enterRoom.token`. Telegram WebApp passes initData as `cert`.
- **Balance race condition**: backend MUST be source of truth for balance. Frontend optimistic update gets corrected by `myInfo` emit.
