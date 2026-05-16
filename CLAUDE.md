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
aviator-crash-copy/                            # Frontend root
├── src/
│   ├── app.tsx                                # Mounts <MobileApp/>
│   ├── context.tsx                            # ★ Socket.IO hub + game state
│   │                                          #   • myInfo handler syncs server-authoritative
│   │                                          #     f/s.{betted,cashouted,cashAmount,betAmount}
│   │                                          #     while preserving local target/auto
│   │                                          #   • BET-phase listener resets stale cashouted
│   │                                          #     state AND drives auto-bet repeat loop
│   ├── telegram-bootstrap.ts                  # Pre-mount: exchange Telegram initData → JWT
│   ├── mobile-overrides.scss                  # Touch-friendly tweaks for legacy desktop UI
│   └── components/
│       └── Mobile/                            # ★ Active mobile-first crash game UI
│           ├── MobileApp.tsx                  # Root layout; Telegram theme integration
│           ├── MobileHeader.tsx               # 44px header: Plane logo + balance + ⋯
│           ├── HistoryBar.tsx                 # Color-coded crash chips (blue/purple/gold)
│           ├── GameCanvas.tsx                 # ★ Canvas trail + plane RAF animation
│           ├── Plane.tsx                      # ★ Indian-festive plane SVG (Claude Design)
│           ├── BetCard.tsx                    # ★ Single bet card (Bet/Auto modes)
│           ├── BetsListSheet.tsx              # All Bets / My Bets / Top tabs
│           ├── FxLayer.tsx                    # ★ Overlay FX (parachutes, bursts)
│           ├── Effects.tsx                    # ★ Original SVG primitives:
│           │                                  #     Parachute (5 palettes),
│           │                                  #     BurstSuccess, BurstCrash
│           ├── planeTracker.ts                # Module-level shared {x, y, flying} so FxLayer
│           │                                  #   can anchor effects to current plane location
│           └── mobile.scss                    # Full design system + animations
└── aviator-back/                              # Backend (Node + TS)
    ├── src/
    │   ├── index.ts                           # Express + Socket.IO + Mongo + bot bootstrap
    │   ├── config.ts                          # Env vars: PORT, MONGO_URI, JWT_SECRET, TELEGRAM_*
    │   ├── game/
    │   │   ├── engine.ts                      # ★ Game loop, state machine, cashOut
    │   │   ├── provablyFair.ts                # HMAC-SHA256 crash point + multiplier formula
    │   │   └── types.ts                       # PlayerState, BetSide, GamePhase
    │   ├── sockets/index.ts                   # ★ Socket.IO contract impl
    │   ├── routes/{auth,user}.ts              # REST endpoints
    │   ├── auth/{telegram,jwt,session}.ts     # Telegram initData HMAC + JWT
    │   ├── bot/telegram.ts                    # grammy bot, /start opens WebApp
    │   └── db/{connection.ts, models/*}       # Mongoose: User, Bet, Round
    ├── tests/                                 # 36 tests across 5 suites
    └── docker-compose.yml                     # mongo + api containers
```

**Frontend tech**: React 18 + TS, Tailwind/SCSS, Socket.IO Client. (Legacy `Crash/`, `Main/`, `BetUsers/`, `Header/` folders still in repo but unreferenced — kept for the Unity WebGL fallback path if ever needed.)

**Backend tech**: Node + TS + Express + Socket.IO + MongoDB + grammy (Telegram bot).

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
| Event             | Payload                                                  | When                                                    |
|-------------------|----------------------------------------------------------|---------------------------------------------------------|
| `gameState`       | `{ GameState: "BET"\|"PLAYING"\|"GAMEEND", time, currentNum, ... }` | Phase tick (~100ms in PLAYING)              |
| `myInfo`          | `UserType` (full incl. f/s sides)                        | After auth, bet placed, cashout, BET phase reset        |
| `myBetState`      | `UserType` (subset)                                      | After bet placed                                        |
| `bettedUserInfo`  | `BettedUserType[]`                                       | Each new bet OR cashout                                 |
| `previousHand`    | `UserType[]`                                             | After GAMEEND                                           |
| `finishGame`      | `UserType`                                               | After GAMEEND, per-user                                 |
| `history`         | `number[]` (last 30 crash points)                        | After GAMEEND                                           |
| `getBetLimits`    | `{ max, min }`                                           | On connect                                              |
| `recharge`        | `()`                                                     | When balance < minBet                                   |
| `error`           | `{ index: "f"\|"s", message }`                           | Bet rejected                                            |
| `success`         | `string`                                                 | "Bet placed" or "Cashed out @ X.XXx" — drives FxLayer   |

⚠️ **`time` is in SECONDS** (not ms). Multiply by 1000 when anchoring local interpolation.

### REST API
- `POST /api/auth/telegram` body `{ initData }` → `{ token, user }` (Telegram WebApp HMAC validated)
- `POST /api/auth/guest` `{ name? }` → `{ token, user }` (dev only, when ALLOW_DEV_AUTH=true)
- `POST /api/my-info` body `{ name }` → `{ status, data: GameHistory[] }`
- `GET /api/game/seed/:roundId` → `SeedDetailsType` (post-round verify)
- `GET /health` → `{ status, phase, multiplier, players, historyLen }`

---

## 🎮 Game Loop (canonical)

1. **BET phase** (5s, `BET_DURATION_MS`): clients place bets via `playBet`. Server validates phase + balance, deducts, broadcasts `bettedUserInfo`.
2. **PLAYING phase**: server `setInterval(100ms)` ticks `gameState` with rising multiplier. Formula:
   ```
   m(t) = 1 + 0.06·t + (0.06·t)² − (0.04·t)³ + (0.04·t)⁴
   ```
   On each tick, server checks every active auto-bet side; if `m ≥ side.target`, calls `engine.cashOut()` automatically.
3. **Crash**: when ticker reaches the pre-computed crash point → phase = `GAMEEND`. Pay cashed-out players, write Round + Bet docs to MongoDB, emit `finishGame`/`previousHand`/`history`.
4. **Settle**: 3s pause (`SETTLE_DURATION_MS`). Then `beginBetPhase()` resets every player's `f/s = emptySide()` AND emits fresh `myInfo` to each connected socket so clients clear their stale "CASHED OUT" UI.

**Provably fair**: `HMAC-SHA256(serverSeed, clientSeedPool + ":" + nonce)` → first 13 hex → uint52 → Bustabit-style distribution → crash point. Server commits the seed hash before the round begins (`upcomingSeedHash`); the seed is revealed afterward via `GET /api/game/seed/:id` so players can verify.

### 🔒 Server-authoritative — clients cannot cheat
- **Crash point** is committed before the round begins. Frontend NEVER decides when the plane crashes.
- **Multiplier ticker** runs server-side. Frontend interpolates the SAME polynomial locally for 60fps smoothness; it cannot push the multiplier past server.
- **`engine.cashOut()`** validates:
  ```ts
  if (this.phase !== "PLAYING") return { ok: false };
  const at = Math.min(endTarget || this.multiplier, this.multiplier);
  if (at < 1.01) return { ok: false };
  ```
  Server clamps `endTarget` to its OWN `this.multiplier` — a client lying about endTarget gets capped. Cashouts after GAMEEND are rejected.
- **Balance** lives in MongoDB; mutated only by `engine.placeBet()` and `engine.cashOut()`. Client-side optimistic deduct is corrected by the next `myInfo`.

---

## 🛩️ Plane state machine + trajectory math

The `<GameCanvas>` RAF loop runs at 60fps and is the source of truth for plane position + canvas trail. Position is set on `.game-canvas-plane` outer wrapper via inline `transform: translate3d`; the inner `.game-canvas-plane-inner` carries CSS keyframe animations so they don't clobber the inline transform.

### Phase classes on `.game-canvas-wrap`
| Class            | Plane behaviour                                                   |
|------------------|-------------------------------------------------------------------|
| `phase-bet`      | Idle bob (`@keyframes plane-idle-bob`). Plane parked at runway origin. Dashed runway line drawn on canvas. 5s shrinking countdown bar. |
| `phase-playing`  | Takeoff scale-up pop (`plane-takeoff` 480ms). Plane RAF-positioned along the parametric curve. Canvas draws 3-layer trail (fill + glow stroke + bright core + dashed ribbon). |
| `phase-end`      | Fade + drift up-right (`plane-fade-out`). FxLayer drops a `BurstCrash` at planeTracker coords. |

### Trajectory math (concave-UP arc — from current commit `a86aa02`)
```ts
const M_PEAK = 10;
const progress = clamp((m - 1) / (M_PEAK - 1), 0, 1);
const xAt = padX     + (W - 2·padX) * progress^0.45;     // x leads
const yAt = H - padBottom - (H − pads) * progress^1.15;  // y trails (slow start, steeper end)
```
Reference points:
- m=2  → x=39%, y=8%   (lifted off the runway)
- m=4  → x=61%, y=28%
- m=6  → x=76%, y=51%
- m=8  → x=89%, y=75%
- m=10 → corner reached (top-right)

For m > M_PEAK: plane "cruises" at the corner — adds sine wobble (Y±4px, X±2px) plus scrolling speed-line bands on canvas so it never feels frozen.

Slope estimator uses a **fixed-pixel window** (walks back through trail points until ~50px from current position) and **clamps tilt to ≤55°** — without these the plane would point straight up at high m because m-spaced samples cluster vertically.

### Canvas trail layers (drawn each frame in PLAYING)
1. Filled gradient under curve (saffron → gold, bottom → top)
2. Outer glow stroke (8px, blurred 18px shadow)
3. Inner bright core stroke (3.2px, gradient saffron → gold → cream)
4. Animated white dashed ribbon (1.4px, `lineDashOffset` scrolls)
5. Speed lines (only when cruising at corner)

---

## 💸 Bet / cashout flow

### BetCard CTA state machine
```
phase=BET, !betted          → "BET 20.00 INR"  (cta-bet)
phase=BET, mode=auto, !betted → "AUTO BET 20.00 INR · @2.00x"  (cta-bet-auto, gold rim)
phase=BET, betted, !cashouted → "CANCEL 20.00 INR"  (cta-cancel)
phase=PLAYING, betted, !cashouted → "CASH OUT  X.XX INR"  (cta-cashout, pulsing gold)
cashouted (any phase)       → "CASHED OUT +X.XX INR"  (cta-won, disabled)
```

### Auto bet semantics
- Click AUTO BET → `state.userInfo[side].auto=true` AND `userInfo[side].auto=true` (both containers; BetCard reads standalone for the AUTO-ON pill).
- Server stores `side.auto + side.target`. On every tick, if `m ≥ target`, server calls `cashOut()` automatically.
- After round ends, **client-side BET-phase listener** re-emits `playBet` for any side with `auto===true && balance >= betAmount`. The legacy finishGame auto-repeat path was guarded by `!user.f.betted` which is never true at finishGame time (server sends pre-settle snapshot), so we drive it here instead.
- AUTO ON pill (`.auto-on-pill`) — gold pill at bottom of card with pulsing dot + "AUTO ON · @X.XXx ✕ Stop". Tapping STOP flips `auto=false` in both containers → next BET-phase listener pass skips this side. Cancel button during BET phase ALSO calls stopAuto so user mental model matches.

### Critical bugs that bit us — keep these in mind
1. **`time` in seconds vs ms**: Server emits `time: Math.floor((Date.now() - phaseStartedAt) / 1000)`. Frontend MUST `* 1000` when anchoring `phaseStartRef`. Without this, multiplier is permanently stuck at 1.01.
2. **phaseStartRef re-anchoring**: `useEffect([GameState, time, currentNum])` runs on every gameState tick. If you set phaseStartRef inside it unconditionally, you re-anchor every 100ms → elapsed≈0 → multiplier never climbs. Anchor ONLY on phase transitions (track `lastPhaseRef`).
3. **CSS animation overrides inline transform**: `.phase-bet .game-canvas-plane { animation: plane-idle-bob }` would clobber the RAF inline `transform: translate3d`, sending the plane to (0,0). Fix: separate outer (positional, RAF-driven) from inner (state animations, CSS-driven).
4. **`transform-box: fill-box` vs `view-box` for SVG**: propeller spin needs `view-box` so transform-origin is interpreted in viewBox units, not bounding-box units. With fill-box the propeller flies off the plane at ≥414px widths.
5. **Two userInfo containers**: `state.userInfo` (in `state` from `useState`) vs standalone `userInfo` from `setUserInfo`. The myInfo socket handler updates both, but BetCard reads standalone, while the legacy bet watcher reads `state.userInfo`. **Always update BOTH** in placeBet/stopAuto or auto-bet silently breaks.
6. **Cashed-out state stuck across rounds**: `engine.beginBetPhase()` resets `player.f/s = emptySide()` in memory but doesn't broadcast. Without per-player `myInfo` emission on phase change, clients keep showing "CASHED OUT" forever. Fixed in `sockets/index.ts` phaseChange handler.
7. **Auto-cashout silent on socket**: `engine.tick()` calls `cashOut()` directly which only emits the engine event `cashOut`. The socket `success`/`myInfo` were only sent in the user-initiated `socket.on('cashOut')` handler. Fix: hook the engine `cashOut` event in sockets to ALWAYS send success+myInfo to that player. (Side index is now part of the engine event payload.)

---

## 🎨 Visual design — Indian festive aesthetic

Original mascot SVG generated via Claude Design from a custom prompt asking for an original cute cartoon plane (explicitly NOT copying any commercial brand). Stored inline in `Plane.tsx` with id-suffixed gradient defs so multiple plane instances on the page (header logo + game canvas + parachute potentially) don't collide.

### Palette (`mobile.scss` `:root`)
- `--crash-saffron: #FF9933`
- `--crash-gold: #FFC857`, `--crash-gold-deep: #D99000`
- `--crash-marigold: #FFB700`
- `--crash-red-deep: #C12244` (crimson)
- Background: deep navy night `#0A0E1D` → `#131835` with radial saffron glow at bottom + gold tint at top (Diwali sky)
- Text: warm cream `#FFF5DC` (not pure white)
- Brand wordmark: gold → saffron → crimson gradient

### FxLayer overlays (subscribe to existing Context, no new socket events)
| Trigger                              | Effect                                 |
|--------------------------------------|----------------------------------------|
| `success` socket event matching `/bet placed/i` | `BurstSuccess` pop on bet panel area, 600ms |
| `success` matching `/cashed out @ ([\d.]+)/i`   | `Parachute` (mine, large) drops from `planeTracker.{x,y}`, grows scale 0.35 → 1.15 with sway, 4s |
| `bettedUsers` diff: another player's `cashouted` flips false→true | smaller `Parachute` (other) drifts down at random x with masked name + multiplier label |
| Phase transition → `GAMEEND`         | `BurstCrash` (12 spokes + 18 confetti petals, Diwali firework) at planeTracker, 800ms |

`Parachute` has 5 colour palettes (saffron/gold, crimson/gold, navy/saffron, peacock/magenta, magenta/mint) — 8 alternating panels generated procedurally + strings + smiling figure.

---

## 🚀 Production deployment (easyenglish VPS)

- **Host**: `easyenglish` SSH alias (IP `147.93.152.15`, root login)
- **Claude SSH**: `claude-ops@147.93.152.15` — key `~/.ssh/easystudy_key` (sudoers 白名單 docker)
- **Repo on server**: `/opt/aviator` (this same git tree, deployed via git pull)
- **Domain**: `https://aviator.rummydeatly.com` (Let's Encrypt cert via certbot)
- **Telegram bot**: `@crashaviator2026bot`
- **Update workflow** (operator just runs this — script does git pull + backup + rebuild + health check):
  ```bash
  ssh easyenglish
  cd /opt/aviator
  ./update.sh                      # full update
  ./update.sh --skip-frontend      # backend only (faster, ~30s)
  ./update.sh --skip-backup        # skip mongodump
  ```
- **Inspect / debug from SSH**:
  ```bash
  cd /opt/aviator/aviator-back
  docker compose logs --tail=80 api
  docker compose logs --tail=30 mongo
  docker compose ps
  curl https://aviator.rummydeatly.com/health
  docker compose exec mongo mongosh aviator    # interactive Mongo
  ```
- **`.env` on server** (NEVER pushed to git): `aviator-back/.env` holds JWT, TG bot token, `CRYPTO_MASTER_MNEMONIC`, `ALLOW_DEV_AUTH=false` (must stay false on prod), Razorpay/payout creds when integrated. Frontend `.env` (root) holds `REACT_APP_API_URL=https://aviator.rummydeatly.com`.
- **Critical gotcha (`docker-compose.yml` env precedence)**: Compose's inline `environment:` block **overrides** `env_file:`. Don't hard-code prod-sensitive flags (e.g. `ALLOW_DEV_AUTH`, `JWT_SECRET`) in compose's `environment:`; let `.env` be the source of truth. Past bug: `ALLOW_DEV_AUTH: "true"` was hardcoded → `.env`'s `false` was masked → server kept spawning `g*` guest users (commit `ab4427d` removed it).
- **Settings cache + module-load init**: `engine.ts` is `export const engine = new GameEngine()` at module scope, so its constructor runs at import-time, BEFORE `main()` calls `loadSettings()`. Anything called from the constructor (e.g. `provablyFair.computeCrashPoint`) **must use `tryGetSetting(key, fallback)` instead of `getSetting(key)`**, otherwise the cache-not-loaded throw kills the container at boot. See commits `cb92947` (engine houseEdge) and the provablyFair fix.

---

## 💸 Recharge → Wager → Withdrawal economy

A money item lives in one of three buckets, tracked via `User.wagerRequired`:

| Source                    | Balance | wagerRequired | Effect                                         |
|---------------------------|---------|---------------|------------------------------------------------|
| Initial balance (signup)  | +X      | 0             | Free, can be played AND withdrawn immediately  |
| Recharge (fiat or crypto) | +X      | +X × `wagerMultiplier` | Locked behind playthrough               |
| Cashout winnings          | +X      | 0             | Free                                           |
| Referral reward (incoming) | +X     | +X × `wagerMultiplier` | Locked (anti ref-farm — see below)       |

**Withdrawable** = `balance − wagerRequired`. Every bet placed decrements `wagerRequired` by the bet amount (regardless of win/loss), so playthrough naturally completes. Engine has 3 entry points to keep these atomic:
- `engine.creditBalance(user, amount)` — referral / admin / refunds — does NOT add to wager
- `engine.creditRecharge(user, amount)` — fiat + crypto recharge + referral payouts — DOES add to wager
- `engine.placeBet(...)` — atomic `$inc balance, $max(0, wager - bet)` via aggregation pipeline updateOne

`reserveForWithdrawal(user, deduct, net)` and `refundWithdrawal(user, amount)` handle the withdrawal hold + refund-on-fail cycle.

### Withdrawal flow

Two methods, mounted at `/api/withdrawal/*`:
- **bank** — Indian bank transfer (account + IFSC + holder name) → `mockPayout` provider returns status=`processing` → admin marks paid/failed manually. Routes to `defaultPayoutProvider("bank")`, env `PAYOUT_BANK_PROVIDER` selects which provider when integrating Razorpay/Cashfree.
- **usdt** — TRC20 USDT to user-supplied address. Hot wallet broadcasts. If hot wallet USDT < requested → `manual_queue` (admin tops up + marks paid). If `usdtAutoPayoutEnabled=1` AND amount < cap → server auto-broadcasts via `walletOps.autoBroadcastUsdtWithdrawal`.

5% fee on TOP (user requests ₹1000 → balance −₹1050, recipient gets ₹1000). Status state machine: `pending → processing | manual_queue | review → paid | failed | cancelled`. The `review` status (added in `b12d8f8`) holds risky orders without calling the provider until admin clicks Approve.

### Anti-abuse layers

5 layers, all admin-tunable via Settings (live, no redeploy):

1. **Initial balance** (admin Setting): set to 0–20 to kill free-money spam. Admin → Settings → Initial balance.
2. **Wager lock** (`wagerMultiplier`): default 1×; recharge of ₹X must be wagered ₹X before becoming withdrawable. Engine enforces in `reserveForWithdrawal` via atomic `$expr` check on `balance − wagerRequired`.
3. **Referral reward locked** (commit `b12d8f8`): the referrer's ₹100 reward is credited via `creditRecharge` not `creditBalance`, so it goes into the referrer's wagerRequired pool. Anti self-referral cycles must wager through.
4. **Per-IP register limit** (`registerMaxPerIp24h`, default 3): hard cap on `/register` + `/telegram` + `/guest` from the same IP per 24h. Backed by `RegisterAttempt` collection (TTL 7d). Counts only successful new-user creates (TG re-logins of existing users don't count).
5. **Withdrawal review queue** (`withdrawalReviewAboveInr` + `withdrawalReviewNewAccountHours`): orders ≥ ₹5000 OR from accounts < 24h old land in `review` status. Admin must Approve before provider call (auto-payout also bypassed). Reason recorded in `order.meta.reviewReason`.

---

## 🪙 SID + Referral system (acquisition tracking)

### URL-driven first-touch attribution

`?sid=facebook` and `?ref=<userName>` on the landing URL are captured by `src/acquisition.ts` BEFORE Telegram bootstrap reloads, persisted to `localStorage` (first-touch only — never overwritten), and forwarded to `/api/auth/{register, telegram, guest}` on signup. Server's `auth/session.ts` and `auth/password.ts` only persist `sid` + `referrer` on user CREATION; returning users keep their existing values.

Telegram bots can't pass URL params, so we use `start_param` convention: `t.me/<bot>?start=ref_<userName>` → `telegram-bootstrap.ts` strips the `ref_`/`sid_` prefix.

### Referral reward

Each successful recharge OR payout fires `triggerReferralReward(referee, source)` from `payment/referral.ts`. Reward amount is `referralRewardInr` (admin Setting, default ₹100). Idempotency via `ReferralReward` collection's unique `(referrer, sourceType, sourceId)` index — webhook retries / watcher reclaims / admin re-marks all hit the same key, only first one credits.

### Frontend share UI

Top-right `⋯` button (`MobileHeader` → `mobile-header-menu`) opens `ShareSheet` with copy + native share + Telegram t.me deep-link. Out-of-balance modal also surfaces "Share & earn ₹100" CTA before "Top up".

Top-left `🛩 AVIATOR` logo opens `AccountSheet` with username, balances breakdown (total / locked / withdrawable), admin panel link (admin role only), and Sign out.

---

## 🏦 Hot wallet operations

### HD wallet (BIP44 `m/44'/195'/0'/0/N`)

- **Index 0** = hot wallet — operator's main, holds USDT for outgoing user withdrawals + receives sweeps from sub-addresses.
- **Index 1+** = per-order deposit addresses — each crypto recharge order gets a freshly-allocated derived address. Cooldown reuse (1h default via `cryptoAddressReuseCooldownMs`) recycles addresses across orders to keep the pool small + sweep gas low.
- Master mnemonic: `aviator-back/.env` `CRYPTO_MASTER_MNEMONIC`. NEVER pushed to git.

### Admin → Wallets tab (`e4020e1` + `ec99769`)

The whole HD subsystem manageable from the UI:

- **Stat cards**: hot USDT, hot TRX, total deposit USDT (un-swept), un-swept order count, network
- **Hot wallet card**: full address, copy button, 88px QR thumbnail (click for 260px modal — Binance app scannable for top-ups), live balance
- **Sub-addresses table**: index, address, USDT/TRX, paid count, un-swept count, total claimed (un-swept rows red-highlighted)
- **Action bar**:
  - `↻ Refresh balances` — bypass 30s in-memory cache, force fresh TronGrid fetch
  - `Sweep dry-run` — alert preview of what would be swept
  - `Run sweep (N)` — confirm + execute (auto top-up TRX gas + transfer USDT to hot)
  - `Transfer out from hot…` — modal for manual outbound to operator's personal wallet (TronLink / exchange / hardware wallet). Currency switch (USDT / TRX) + dry-run + Tronscan link on success.

All ops go through `aviator-back/src/payment/walletOps.ts` (`listWallets`, `transferOut`, `sweepAddresses`) — server-side TronWeb sign + send, master mnemonic NEVER leaves the api container. CLI fallback in `src/tools/{sweep-deposits,transfer-out}.ts` for SSH ops if UI is broken.

### USDT auto-payout (commit `641dd46`)

Opt-in from admin Settings → "Auto-payout" group:
- `usdtAutoPayoutEnabled` (0/1, default 0 = OFF)
- `usdtAutoPayoutMaxInr` (default ₹2000) — withdrawals ≥ this stay manual

When enabled: USDT withdrawals that pass risk checks (not `review`, not `manual_queue`, under cap, hot wallet has ≥ amount USDT + ≥ 15 TRX) auto-broadcast via `walletOps.autoBroadcastUsdtWithdrawal` (fire-and-forget — user's HTTP response is immediate, broadcast result pushed via socket `withdrawalUpdate`). Tx hash stored, `meta.autoBroadcast=true`. Admin Withdrawals tab shows `⚡ AUTO` badge for auto-paid orders.

Fallback: any failure (broadcast throws, hot wallet thinned by concurrent payouts) → status flips to `manual_queue`, admin tops up + retries. Bank withdrawals always remain manual.

---

## ⚙️ Live admin Settings (DB-backed singleton)

All fields tunable from Admin → Settings, no redeploy. Stored in `Settings` Mongo doc (`_id="default"`), in-memory cache via `settings/index.ts` (`getSetting` throws if cache not loaded; `tryGetSetting(key, fallback)` for module-init paths).

| Group        | Key                              | Default | Notes                                                          |
|--------------|----------------------------------|---------|----------------------------------------------------------------|
| Game         | `maxCrashMultiplier`             | 100     | Cap on payout                                                  |
| Game         | `houseEdge`                      | 0.03    | 3%                                                             |
| Game         | `minBet`                         | 1       |                                                                |
| Game         | `maxBet`                         | 1000    |                                                                |
| Game         | `initialBalance`                 | 1000    | Set 0–20 in prod to deter spam-register                        |
| Crypto       | `cryptoMinUsdt` / `cryptoMaxUsdt`| 10/5000 |                                                                |
| Crypto       | `usdtInrRateFallback`            | 83      | When CoinGecko unreachable                                     |
| Bots         | `botMinCount` / `botMaxCount`    | 5/15    | Room liveliness                                                |
| Referral     | `referralRewardInr`              | 100     | Per recharge/payout, 0 disables                                |
| Withdrawal   | `withdrawalFeePct`               | 0.05    | 5% on top                                                      |
| Withdrawal   | `withdrawalMinInr`               | 300     |                                                                |
| Withdrawal   | `wagerMultiplier`                | 1.0     | 1× rollover on recharge AND incoming referral reward           |
| Anti-abuse   | `withdrawalReviewAboveInr`       | 5000    | Auto-flag for admin review                                     |
| Anti-abuse   | `withdrawalReviewNewAccountHours`| 24      | Account-age trigger for review                                 |
| Anti-abuse   | `registerMaxPerIp24h`            | 3       | Hard cap, 0 disables                                           |
| Auto-payout  | `usdtAutoPayoutEnabled`          | 0       | 0 = manual (default), 1 = auto                                 |
| Auto-payout  | `usdtAutoPayoutMaxInr`           | 2000    | Auto only if amount < this                                     |

---

## 📱 Mobile / Telegram MiniApp

- `public/index.html` has `viewport-fit=cover`, `maximum-scale=1`, `user-scalable=no`, `viewport-fit=cover` and pulls in `https://telegram.org/js/telegram-web-app.js`.
- `MobileApp.tsx` calls `Telegram.WebApp.{ready, expand, setHeaderColor, setBackgroundColor}` and writes `themeParams` into CSS custom props.
- `telegram-bootstrap.ts` runs before mount: if `Telegram.WebApp.initData` is present and no `?cert=` in URL, POST to `/api/auth/telegram` and reload with `?cert=<JWT>`.
- All interactive elements ≥ 44×44px touch targets. Layout uses `safe-area-inset-*` paddings.
- Tablet landscape (`min-width: 768px and orientation: landscape`) gets a side-by-side grid layout.

---

## 🧪 How to Run Locally

**Port scheme** — all in the unprivileged 188xx range, identical local & prod:

| Service  | Port  | Mnemonic               |
|----------|-------|------------------------|
| Frontend | 18803 | last 02 ≈ original 3000 |
| Backend  | 18805 | last 02 ≈ original 5000 |
| MongoDB  | 18827 | last 02 ≈ original 27017 |

```powershell
# Backend (defaults to 188xx; override via env if needed)
cd aviator-back
docker compose up -d --build      # mongo on :18827, api on :18805
curl http://localhost:18805/health

# Frontend
echo "REACT_APP_API_URL=http://localhost:18805" > .env
npm install --legacy-peer-deps    # CRA peer-dep workaround
npm run build                     # production build to ./build
npx serve -s build -l 18803       # or `npm start` for dev (CRA uses 3000 by default)
```

**Override ports** (if 188xx is also taken):
```powershell
API_PORT=20000 MONGO_PORT=20001 docker compose up -d --build
```

For Telegram bot testing: set `TELEGRAM_BOT_TOKEN` in `aviator-back/.env`, expose frontend via ngrok, set `TELEGRAM_WEBAPP_URL`, restart api, `/start` your bot.

### Tests
```powershell
cd aviator-back
npm test                    # 36 tests, 5 suites, ~110s
```

| Suite                         | What it covers |
|-------------------------------|----------------|
| `provablyFair.test.ts` (9)    | HMAC determinism, distribution, multiplier formula |
| `telegramAuth.test.ts` (4)    | initData HMAC validation |
| `rest.test.ts` (7)            | health, auth, my-info, seed, CORS |
| `integration.test.ts` (12)    | single-client gameplay full cycle |
| `multiplayer.test.ts` (4)     | 2-client broadcast + isolation |

---

## ⚠️ Gotchas Learned (cumulative)

- `react-app-rewired` + Node polyfills required in `config-overrides.js` for `ethers`/`crypto-js` (already done).
- Socket.IO transports: client uses `['websocket', 'polling']` — backend must allow both for hot-reload reliability.
- Token auth: frontend grabs `?cert=...` from URL → emits as `enterRoom.token`. Telegram WebApp passes JWT as `cert` after the bootstrap exchange.
- Balance race: backend MUST be source of truth. Frontend optimistic update gets corrected by `myInfo`.
- **Pre-existing build blockers fixed during refactor**: orphan `}` in `src/components/Main/main.scss` line 682 blocked sass production build; `src/components/Main/history.tsx` had `parseFloat(item: number)` type error.
- **CRA install** needs `--legacy-peer-deps` flag (peer-dep conflicts in old deps tree).
- The legacy `Crash/`, `Main/`, `BetUsers/`, `Header/` folders are **dead code** — kept in repo but not imported by `app.tsx`. Don't accidentally edit them thinking they're live.
- The legacy `context.tsx` finishGame handler still has the old auto-repeat logic guarded by `!user.f.betted` — it's a no-op (server sends pre-settle state). The active auto-repeat lives in the BET-phase `socket.on('gameState')` listener.
- **Settings cache race**: `engine.ts` exports `engine = new GameEngine()` at module scope, so the constructor runs at import time, BEFORE `loadSettings()` is awaited in `main()`. ANY `getSetting` call reachable from the constructor (e.g. `provablyFair.computeCrashPoint`) will throw. Use `tryGetSetting(key, fallback)` from `settings/index.ts` instead. Two bugs of this kind already fixed: `engine` constructor's placeholder seed (uses `config.houseEdge`), and `provablyFair.computeCrashPoint` (uses `tryGetSetting("maxCrashMultiplier", ...)`).
- **`docker-compose.yml` env precedence**: Compose's inline `environment:` block always wins over `env_file:`. Past bug — `ALLOW_DEV_AUTH: "true"` was hardcoded in the compose file → `.env`'s `false` was masked → server kept spawning `g*` guest users on every tokenless socket connect. Don't hardcode prod-sensitive flags in compose; let `.env` be the source of truth. Fix landed in `ab4427d`.
- **`config.allowDevAuth` defaults to `false`** (since commit `7513d60`) — dev guest auto-creation OFF unless explicitly enabled. Previously `true`; visitors / TG previews / scrapers all got fresh `User` rows.
- **Telegram start_param convention**: bot deep-link format `t.me/<bot>?start=ref_<userName>` or `?start=sid_<source>` — `telegram-bootstrap.ts` parses these prefixes and forwards as `ref` / `sid` to `/api/auth/telegram` so first-touch attribution works through Telegram link sharing.
- **Initial balance was bypassing admin Settings**: `auth/password.ts` used `config.initialBalance` (env, default 1000) instead of `getSetting("initialBalance")`. Admin's value had no effect for password-registered users, so anyone could spam-register for free credits even after operator changed it. Fixed `7d6430b`. Telegram + dev-guest paths were already correct.
- **`registerLimit` middleware needs `app.set("trust proxy", true)`** — otherwise `req.ip` returns the loopback when running behind nginx, defeating the per-IP cap.
- **`update.sh` working-tree gotcha**: if `.env` is being un-tracked by an incoming commit AND the working tree has local edits, `git pull` refuses. The script's autostash doesn't catch this case (it stashes modifications, but the conflict is "file is being removed from index while working tree differs"). One-time recovery: `cp .env /tmp/x && git checkout .env && git pull && cp /tmp/x .env`.

---

## 🗺️ Session timeline (key commits)

```
e8d2f92  Initial: TG-bot backend, mobile shell, project CLAUDE.md
65d71dd  Comprehensive test suite (36 tests) + frontend bug fixes
ee23251  Mobile-first UI rewrite — original art, smooth canvas plane
283fb7f  Indian-festive plane mascot (Claude Design) + palette refresh
9190075  Fix propeller transform-box: view-box + flaky username regex
8945561  FxLayer (parachute/burst) + plane state machine + button polish
e813e2c  CRITICAL: time*1000 multiplier sync + log y-mapping + parachute
8966ebe  Reset BetCard CTA on new round (server emit + client clear)
b917a5c  Bet UX: full-width amount, plane-anchored FX, cashout sync
91586a9  Better arc (multiplier-parametric), cruising motion, auto row redesign
b966fc4  Concave-UP trajectory: low climb early, sharp rise top-right
9efab7e  (reverted by next) Concave-DOWN
a86aa02  Slightly faster early lift on the concave-UP arc
9b0a784  Fix Auto bet: each-round repeat, parachute fx, AUTO ON pill
... (production deploy + crypto recharge + admin Settings + cap 100x) ...
e92bca0  Quick-bet accumulator + SID tracking + referral system + ./update.sh
9ad096d  Withdrawals: bank + USDT, 5% fee on top, 1x recharge playthrough lock
cb92947  Fix engine constructor calling getSetting before loadSettings
598cef9  Make root update.sh executable
7513d60  allowDevAuth defaults to false + startup log
ab4427d  docker-compose: remove ALLOW_DEV_AUTH=true override
fbb41f5  Fix second module-init getSetting (provablyFair) → tryGetSetting helper
7d6430b  Logo→AccountSheet (incl. logout) + fix initialBalance ignoring admin Settings
b12d8f8  Anti-abuse: lock referral reward + per-IP register limit + withdrawal review queue
33802e2  Add transfer-out CLI: hot wallet → personal/external TRC20 address
e4020e1  Admin Wallets tab: derived sub-addresses + hot wallet + manual transfer
ec99769  Hot wallet: copy button + QR code (Binance-scannable)
641dd46  USDT auto-payout: opt-in + amount cap + manual_queue fallback  ← latest
```

### Day-end summary (2026-05-10)

Today's session added the full money pipeline + acquisition machinery on top of yesterday's deployment:

- **SID + referral**: URL `?sid=`/`?ref=` first-touch, `?` Telegram `start_param` convention, idempotent reward audit, Share modal (logo for account / `⋯` for share) — `e92bca0`
- **Withdrawals**: bank + USDT, 5% fee on top, 1× wagering, balance reservation, refund-on-fail, mock provider + admin override, hot-wallet liquidity check — `9ad096d`
- **Auth/runtime fixes**: 2× module-init `getSetting` race (`cb92947`, `fbb41f5`), `allowDevAuth` default false (`7513d60`) + compose override (`ab4427d`), `update.sh` permissions (`598cef9`), `initialBalance` honoring admin Settings (`7d6430b`)
- **Account sheet**: logo click opens user info + balance breakdown + admin link + sign out (`7d6430b`)
- **Anti-abuse 3 layers**: referral locked into wagerRequired, per-IP register limit, withdrawal review queue with admin Approve action (`b12d8f8`)
- **Hot wallet ops in admin UI**: full Wallets tab with hot/sub-addresses balances, sweep dry-run + run, transfer-out modal — operator no longer needs SSH (`e4020e1`, `ec99769`)
- **USDT auto-payout**: opt-in toggle + amount cap, fire-and-forget broadcast, manual_queue fallback, `⚡ AUTO` admin badge (`641dd46`)

Production cycle: `./update.sh --skip-backup` from `easyenglish` SSH (147.93.152.15:/opt/aviator). Frontend domain `https://aviator.rummydeatly.com`. Telegram bot `@crashaviator2026bot`.

**Next sessions might want**:
- Real bank payout provider integration (Razorpay Payouts / Cashfree adapter implementing `PayoutProvider` interface; webhooks land at `/api/recharge/webhook/<provider>`-style)
- Phone OTP for `/register` (further anti-spam beyond IP cap)
- TRX staking script for hot wallet (cut sweep gas burn ~80%)
- Per-referrer reward velocity caps (e.g. max 10 successful refs per 24h)
- Migrate `tryGetSetting` to all module-init paths defensively
- Tests for the new endpoints (recharge/withdrawal/admin/wallets) — current test suite (36) doesn't cover them
