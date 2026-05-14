# Telegram-Only Registration Design

**Date:** 2026-05-14  
**Status:** Approved  
**Goal:** Block referral-exploit abuse by removing public email/password registration. New accounts can only be created via Telegram (MiniApp or Login Widget). Existing password accounts retain login access.

---

## Problem

Attackers exploit the referral system by:
1. Sharing their own referral link (`?ref=<username>`)
2. Registering unlimited fake accounts via `POST /api/auth/register` (no verification required)
3. Each fake account receives initial balance; the referrer gets `referralRewardInr` (₹60–₹100) per qualifying recharge/withdrawal
4. Small bets can convert that balance to withdrawable funds

Root cause: `POST /api/auth/register` has no identity verification beyond a rate-limit per IP, which is trivially bypassed via VPN/proxy.

---

## Decision

- **Remove** `POST /api/auth/register` — no new password accounts
- **Keep** `POST /api/auth/login` — existing password users are not disrupted
- **Keep** `POST /api/auth/telegram` — MiniApp flow unchanged
- **Add** `POST /api/auth/telegram-widget` — new endpoint for web Telegram Login Widget
- **Frontend** — replace "Create account" tab with Telegram Login Widget as primary CTA; password login kept as secondary

---

## Backend Changes

### 1. Remove `/register` route

In `aviator-back/src/routes/auth.ts`, delete the `POST /register` handler and its import of `registerUser` from `auth/password.ts`.

The `registerUser` function in `auth/password.ts` can be kept (still called by nothing, or deleted — low risk either way). The `loginUser` function stays.

### 2. Add `POST /api/auth/telegram-widget`

New handler in `routes/auth.ts`. Verification logic added to `auth/telegram.ts`.

**Widget hash verification** (differs from MiniApp):

```
secret_key = SHA256(bot_token)           // NOT HMAC("WebAppData", bot_token)
data_check_string = fields sorted alphabetically (excluding "hash"),
                    joined as "key=value\n..."
valid = HMAC-SHA256(secret_key, data_check_string) === payload.hash
```

Additional check: `auth_date` must be within 3600 seconds of `Date.now() / 1000` (prevents replay attacks).

**User upsert:** reuse existing `upsertTelegramUser(telegramId, firstName, username, photoUrl, sid, referrer)` from `auth/session.ts`. No new DB schema needed.

**Response:** same shape as `/telegram` — `{ status: true, token, userName, balance, avatar }`.

**Bot token source:** same multi-bot fallback already in `auth/telegram.ts` (DB bots → env `TELEGRAM_BOT_TOKEN`).

### 3. No other backend changes

`/login`, `/telegram`, `/guest`, `/me` routes unchanged. `auth/password.ts` `loginUser` path untouched.

---

## Frontend Changes

### 1. `AuthScreen.tsx` — replace "Create account" tab

Current: two tabs ("Sign in" | "Create account").

New layout:
- **Primary CTA:** Telegram Login Widget (`<script data-telegram-login="crashaviator2026bot" data-onauth="onTelegramAuth">`)
- **Secondary:** "Already have an account? Sign in with password" — collapsible or small link that reveals the existing password form
- Remove "Create account" tab and all registration form fields entirely

Widget callback (`onTelegramAuth(user)`) POSTs to `/api/auth/telegram-widget`, receives JWT, then follows the same reload-with-`?cert=` path as password login.

### 2. `telegram-bootstrap.ts` — no change

MiniApp auto-login flow is unaffected.

---

## Security Properties After Change

| Attack vector | Before | After |
|---|---|---|
| Fake email registration | ✅ Works (trivial) | ❌ Blocked — endpoint removed |
| VPN/proxy IP rotation | Partially blocked by registerMaxPerIp24h | N/A — registration gone |
| Multiple Telegram accounts | N/A | Still possible but requires real phone numbers (costly at scale) |
| Existing password account abuse | N/A | Existing accounts unaffected; no new ones can be created |

---

## Out of Scope

- Phone OTP registration (future option if Telegram-only proves insufficient)
- Migrating existing password accounts to Telegram identity
- Per-referrer velocity caps (separate anti-abuse layer, independent of this change)

---

## Files Changed

| File | Change |
|---|---|
| `aviator-back/src/routes/auth.ts` | Remove `POST /register` handler |
| `aviator-back/src/auth/telegram.ts` | Add `verifyWidgetHash(payload, botToken)` function |
| `aviator-back/src/routes/auth.ts` | Add `POST /telegram-widget` handler |
| `src/components/Mobile/AuthScreen.tsx` | Remove Create account tab; add Telegram Widget CTA |
