# Telegram-Only Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block referral-exploit abuse by removing public email/password registration, keeping password login for existing users, and adding Telegram Login Widget as the only new-account path.

**Architecture:** Backend gains `verifyWidgetHash` (Widget-specific HMAC check using `SHA256(botToken)` secret) and a `/api/auth/telegram-widget` endpoint that reuses the existing `upsertUser` logic. Frontend replaces the "Create account" tab with the official Telegram Login Widget script, with password login kept as a secondary collapsible option.

**Tech Stack:** Node.js + TypeScript (backend), React 18 + TypeScript (frontend), Telegram Login Widget (official script from `telegram.org`), Jest + ts-jest (tests).

---

## Prerequisite: BotFather domain setup (manual, do first)

The Telegram Login Widget requires the bot's domain to be allowlisted in BotFather before it will work on the web page.

```
1. Open Telegram → search @BotFather
2. Send: /setdomain
3. Select @crashaviator2026bot
4. Send the domain: aviator.rummydeatly.com
```

This is a one-time step. The Widget will silently fail to render if skipped.

---

## File Map

| File | Action |
|---|---|
| `aviator-back/src/auth/telegram.ts` | Add `TelegramWidgetPayload` interface + `verifyWidgetHash` function |
| `aviator-back/src/auth/session.ts` | Add `authWithTelegramWidget` function |
| `aviator-back/src/routes/auth.ts` | Remove `/register` handler; add `/telegram-widget` handler |
| `aviator-back/tests/widgetAuth.test.ts` | New unit tests for `verifyWidgetHash` |
| `aviator-back/tests/password-auth.test.ts` | Remove register-dependent tests; add register-returns-404 test |
| `src/auth/AuthProvider.tsx` | Add `TelegramWidgetPayload` export + `loginWithTelegram` method |
| `src/components/Mobile/AuthScreen.tsx` | Remove register tab; add Telegram Widget as primary CTA |

---

## Task 1 — Unit tests for `verifyWidgetHash` (TDD: write test first)

**Files:**
- Create: `aviator-back/tests/widgetAuth.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// aviator-back/tests/widgetAuth.test.ts
import { createHmac, createHash } from "crypto";

// Must be set before the module import so config picks it up
process.env.TELEGRAM_BOT_TOKEN = "TEST_WIDGET_TOKEN";

import { verifyWidgetHash, TelegramWidgetPayload } from "../src/auth/telegram";

/** Build a valid-looking widget payload signed with the given bot token. */
const buildPayload = (
  token: string,
  overrides: Partial<Omit<TelegramWidgetPayload, "hash">> = {},
): TelegramWidgetPayload => {
  const base: Omit<TelegramWidgetPayload, "hash"> = {
    id: 42,
    first_name: "Alice",
    username: "alice",
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  const dataCheckString = (Object.keys(base) as string[])
    .sort()
    .map((k) => `${k}=${(base as any)[k]}`)
    .join("\n");
  const secretKey = createHash("sha256").update(token).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return { ...base, hash };
};

describe("Telegram widget hash verification", () => {
  test("valid payload passes and returns user fields", async () => {
    const payload = buildPayload("TEST_WIDGET_TOKEN");
    const r = await verifyWidgetHash(payload);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.id).toBe(42);
      expect(r.user.username).toBe("alice");
    }
  });

  test("expired auth_date (>3600s ago) fails", async () => {
    const payload = buildPayload("TEST_WIDGET_TOKEN", {
      auth_date: Math.floor(Date.now() / 1000) - 7200,
    });
    const r = await verifyWidgetHash(payload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/i);
  });

  test("tampered hash fails", async () => {
    const payload = buildPayload("TEST_WIDGET_TOKEN");
    const r = await verifyWidgetHash({ ...payload, hash: "0".repeat(64) });
    expect(r.ok).toBe(false);
  });

  test("wrong token fails", async () => {
    const payload = buildPayload("OTHER_TOKEN");
    const r = await verifyWidgetHash(payload);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (function does not exist yet)**

```powershell
cd aviator-back
npx jest tests/widgetAuth.test.ts --no-coverage
```

Expected output: `Cannot find module` or `verifyWidgetHash is not a function` — confirming the test is wired up correctly before we write the implementation.

---

## Task 2 — Implement `verifyWidgetHash` in `auth/telegram.ts`

**Files:**
- Modify: `aviator-back/src/auth/telegram.ts`

- [ ] **Step 1: Add `createHash` to the existing crypto import (line 1)**

Change:
```typescript
import { createHmac } from "crypto";
```
To:
```typescript
import { createHmac, createHash } from "crypto";
```

- [ ] **Step 2: Add `TelegramWidgetPayload` interface and `verifyWidgetHash` after the existing `validateInitData` export**

Append to the end of `aviator-back/src/auth/telegram.ts`:

```typescript
export interface TelegramWidgetPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/**
 * Verify a Telegram Login Widget callback payload.
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * Differs from initData validation:
 *   secret_key = SHA256(bot_token)          ← NOT HMAC("WebAppData", token)
 *   data_check_string = fields sorted alphabetically (excluding hash), "key=value\n..."
 */
export const verifyWidgetHash = async (
  payload: TelegramWidgetPayload,
): Promise<{ ok: true; user: TelegramUser } | { ok: false; reason: string }> => {
  if (Date.now() / 1000 - payload.auth_date > 3600) {
    return { ok: false, reason: "auth_date expired" };
  }

  const { hash, ...fields } = payload;
  const dataCheckString = (Object.keys(fields) as (keyof typeof fields)[])
    .sort()
    .filter((k) => fields[k] !== undefined)
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

  const tokens: string[] = [];
  try {
    const bots = await TelegramBotModel.find({ enabled: true }).select("token").lean();
    for (const b of bots) {
      if (b.token) tokens.push(b.token);
    }
  } catch {
    // No DB connection (e.g. unit test env) — fall through to env token
  }
  if (config.telegramBotToken) tokens.push(config.telegramBotToken);

  if (tokens.length === 0) {
    return { ok: false, reason: "No bot configured (add one in admin → Bots)" };
  }

  for (const token of tokens) {
    const secretKey = createHash("sha256").update(token).digest();
    const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (expected === hash) {
      return {
        ok: true,
        user: {
          id: payload.id,
          username: payload.username,
          first_name: payload.first_name,
          last_name: payload.last_name,
          photo_url: payload.photo_url,
        },
      };
    }
  }

  return { ok: false, reason: "Invalid hash (no bot token matched)" };
};
```

- [ ] **Step 3: Run tests to confirm they pass**

```powershell
npx jest tests/widgetAuth.test.ts --no-coverage
```

Expected: `4 passed, 4 total`

- [ ] **Step 4: Commit**

```powershell
git add aviator-back/src/auth/telegram.ts aviator-back/tests/widgetAuth.test.ts
git commit -m "feat: add verifyWidgetHash for Telegram Login Widget"
```

---

## Task 3 — Add `authWithTelegramWidget` to `session.ts`

**Files:**
- Modify: `aviator-back/src/auth/session.ts`

- [ ] **Step 1: Add `verifyWidgetHash` and `TelegramWidgetPayload` to the import from `./telegram`**

Change line 5:
```typescript
import { validateInitData } from "./telegram";
```
To:
```typescript
import { validateInitData, verifyWidgetHash, TelegramWidgetPayload } from "./telegram";
```

- [ ] **Step 2: Append `authWithTelegramWidget` to the end of `auth/session.ts`**

```typescript
export const authWithTelegramWidget = async (
  payload: TelegramWidgetPayload,
  attribution?: { sid?: string; referrer?: string },
): Promise<AuthResult | null> => {
  const v = await verifyWidgetHash(payload);
  if (!v.ok) return null;
  const tg = v.user;
  const baseName = tg.username || tg.first_name || `tg${tg.id}`;
  const user = await upsertUser({
    telegramId: tg.id,
    userName: baseName,
    avatar: tg.photo_url ? "av-1.png" : undefined,
    sid: attribution?.sid,
    referrer: attribution?.referrer,
  });
  const token = signToken({
    userName: user.userName,
    telegramId: user.telegramId,
    userType: user.userType,
  });
  return {
    token,
    userName: user.userName,
    telegramId: user.telegramId,
    userType: user.userType,
    balance: user.balance,
    avatar: user.avatar,
  };
};
```

- [ ] **Step 3: Confirm TypeScript compiles without errors**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```powershell
git add aviator-back/src/auth/session.ts
git commit -m "feat: add authWithTelegramWidget session helper"
```

---

## Task 4 — Wire `/telegram-widget` route and remove `/register`

**Files:**
- Modify: `aviator-back/src/routes/auth.ts`
- Modify: `aviator-back/tests/password-auth.test.ts`

- [ ] **Step 1: Add `authWithTelegramWidget` to the import in `routes/auth.ts` (line 2)**

Change:
```typescript
import { authWithTelegram, authDevGuest } from "../auth/session";
```
To:
```typescript
import { authWithTelegram, authWithTelegramWidget, authDevGuest } from "../auth/session";
```

- [ ] **Step 2: Remove `registerWithPassword` from the password import (line 3)**

Change:
```typescript
import { registerWithPassword, loginWithPassword, profileFromUserName } from "../auth/password";
```
To:
```typescript
import { loginWithPassword, profileFromUserName } from "../auth/password";
```

- [ ] **Step 3: Delete the entire `/register` handler block (lines 52–68)**

Delete these lines entirely:
```typescript
authRouter.post("/register", async (req, res) => {
  const { userName, password, phone, sid, ref, referrer } = req.body || {};

  const ipCheck = await checkRegisterIpLimit(req);
  if (!ipCheck.ok) return sendIpLimitExceeded(res, ipCheck);

  const r = await registerWithPassword({
    userName,
    password,
    phone,
    sid,
    referrer: ref || referrer,
  });
  if (!r.ok) return res.status(400).json({ status: false, message: r.reason });
  await recordRegisterAttempt(req, r.result.userName, "register");
  res.json({ status: true, ...r.result });
});
```

- [ ] **Step 4: Add the `/telegram-widget` handler after the existing `/telegram` handler (after line 34)**

Insert after the closing `});` of the `/telegram` handler:

```typescript
authRouter.post("/telegram-widget", async (req, res) => {
  const { sid, ref, referrer, ...payload } = req.body || {};

  const ipCheck = await checkRegisterIpLimit(req);
  if (!ipCheck.ok) return sendIpLimitExceeded(res, ipCheck);

  const result = await authWithTelegramWidget(payload, { sid, referrer: ref || referrer });
  if (!result) {
    return res.status(401).json({ status: false, message: "Invalid Telegram widget auth" });
  }

  const u = await UserModel.findOne({ userName: result.userName }).select("createdAt").lean();
  const isNew = u && Date.now() - new Date(u.createdAt).getTime() < 30_000;
  if (isNew) await recordRegisterAttempt(req, result.userName, "telegram");

  res.json({ status: true, ...result });
});
```

- [ ] **Step 5: Update `password-auth.test.ts` — remove register-dependent tests, add 404 check**

Replace the entire file content of `aviator-back/tests/password-auth.test.ts` with:

```typescript
/**
 * Tests for username/password login + /me endpoint.
 * Registration is intentionally disabled — POST /register returns 404.
 */
const URL = process.env.SMOKE_URL || "http://localhost:18805";

const post = async (path: string, body: any, token?: string) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const get = async (path: string, token?: string) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${URL}${path}`, { headers });
  return { status: res.status, body: await res.json() };
};

describe("Registration disabled", () => {
  jest.setTimeout(30_000);

  test("POST /api/auth/register returns 404 (registration removed)", async () => {
    const r = await post("/api/auth/register", {
      userName: "anyuser",
      password: "secret123",
    });
    expect(r.status).toBe(404);
  });
});

describe("Admin routes (gated by isAdmin)", () => {
  jest.setTimeout(30_000);

  test("/api/admin/users without token returns 401", async () => {
    const r = await get("/api/admin/users");
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 6: Confirm TypeScript compiles without errors**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Run full test suite (unit tests only — no running server needed)**

```powershell
npx jest --testPathPattern="widgetAuth|telegramAuth|provablyFair" --no-coverage
```

Expected: all tests in those three files pass.

- [ ] **Step 8: Commit**

```powershell
git add aviator-back/src/routes/auth.ts aviator-back/tests/password-auth.test.ts
git commit -m "feat: add /telegram-widget route, remove /register"
```

---

## Task 5 — Frontend: add `loginWithTelegram` to `AuthProvider.tsx`

**Files:**
- Modify: `src/auth/AuthProvider.tsx`

- [ ] **Step 1: Add `TelegramWidgetPayload` export interface (after the `AuthUser` interface, around line 13)**

Insert after the closing `}` of `AuthUser`:

```typescript
export interface TelegramWidgetPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}
```

- [ ] **Step 2: Add `loginWithTelegram` to the `AuthValue` interface (after the `register` entry, around line 26)**

Change:
```typescript
  register: (
    userName: string,
    password: string,
    phone?: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  logout: () => void;
```
To:
```typescript
  register: (
    userName: string,
    password: string,
    phone?: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  loginWithTelegram: (user: TelegramWidgetPayload) => Promise<{ ok: true } | { ok: false; reason: string }>;
  logout: () => void;
```

- [ ] **Step 3: Add `loginWithTelegram` implementation inside `AuthProvider` (after the `register` function, before `logout`)**

Insert after the closing `};` of `register`:

```typescript
  const loginWithTelegram: AuthValue["loginWithTelegram"] = async (widgetUser) => {
    setLoading(true);
    try {
      const { sid, ref } = getAttribution();
      const res = await fetch(`${apiBase}/auth/telegram-widget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...widgetUser, sid, ref }),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, reason: body.message || "Telegram auth failed" };
      finishAuth(body);
      return { ok: true };
    } finally { setLoading(false); }
  };
```

- [ ] **Step 4: Add `loginWithTelegram` to the context Provider value (line 137)**

Change:
```typescript
    <Ctx.Provider value={{ token, user, loading, hydrating, login, register, logout }}>
```
To:
```typescript
    <Ctx.Provider value={{ token, user, loading, hydrating, login, register, loginWithTelegram, logout }}>
```

- [ ] **Step 5: Confirm TypeScript compiles**

```powershell
cd ..   # back to repo root
npx tsc --noEmit
```

Expected: no errors (if there are errors related to other parts of the codebase that pre-existed, ignore them — only fix new errors caused by this change).

- [ ] **Step 6: Commit**

```powershell
git add src/auth/AuthProvider.tsx
git commit -m "feat: add loginWithTelegram to AuthProvider"
```

---

## Task 6 — Frontend: rewrite `AuthScreen.tsx`

**Files:**
- Modify: `src/components/Mobile/AuthScreen.tsx`

- [ ] **Step 1: Replace the entire content of `AuthScreen.tsx`**

```tsx
import React from "react";
import { useAuth, TelegramWidgetPayload } from "../../auth/AuthProvider";
import { Plane } from "./Plane";

const BOT_NAME = "crashaviator2026bot";

export const AuthScreen: React.FC = () => {
  const { login, loginWithTelegram, loading } = useAuth();
  const [showPassword, setShowPassword] = React.useState(false);
  const [userName, setUserName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Keep callback stable across renders via ref so the widget script
  // (loaded once) always calls the latest version of loginWithTelegram.
  const loginWithTelegramRef = React.useRef(loginWithTelegram);
  loginWithTelegramRef.current = loginWithTelegram;

  React.useEffect(() => {
    (window as any).onTelegramAuth = async (user: TelegramWidgetPayload) => {
      const r = await loginWithTelegramRef.current(user);
      if (!r.ok) setError(r.reason);
    };

    const container = document.getElementById("tg-widget-container");
    if (!container) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", BOT_NAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;
    container.appendChild(script);

    return () => {
      delete (window as any).onTelegramAuth;
      container.innerHTML = "";
    };
  }, []);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await login(userName, password);
    if (!r.ok) setError(r.reason);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <Plane size={48} static halo={false} />
          <h1>AVIATOR</h1>
          <p className="auth-tag">FESTIVE CRASH GAME</p>
        </div>

        <div id="tg-widget-container" className="auth-tg-widget" />

        {error && <div className="auth-error">⚠ {error}</div>}

        {!showPassword ? (
          <div className="auth-footer">
            <button type="button" onClick={() => { setShowPassword(true); setError(null); }}>
              Sign in with password
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submitPassword}>
            <label className="auth-field">
              <span>Username</span>
              <input
                type="text"
                autoComplete="username"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                minLength={3}
                maxLength={20}
                required
                autoFocus
              />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "…" : "SIGN IN"}
            </button>
            <div className="auth-footer">
              <button type="button" onClick={() => { setShowPassword(false); setError(null); }}>
                ← Back
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Confirm TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors from this file.

- [ ] **Step 3: Commit**

```powershell
git add src/components/Mobile/AuthScreen.tsx
git commit -m "feat: replace register form with Telegram Login Widget"
```

---

## Task 7 — Smoke test the full change

These steps require the backend running locally (`docker compose up -d`) and the frontend dev server.

- [ ] **Step 1: Run the backend test suite**

```powershell
cd aviator-back
npx jest --no-coverage
```

Expected output shows no regressions. The `password-auth.test.ts` "Registration disabled" test requires a live backend at port 18805 — skip it if no backend is running locally (it will be validated on the server).

- [ ] **Step 2: Verify `/register` is gone**

```powershell
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18805/api/auth/register -H "Content-Type: application/json" -d '{"userName":"test","password":"pass123"}'
```

Expected: `404`

- [ ] **Step 3: Verify `/login` still works**

```powershell
curl -s -X POST http://localhost:18805/api/auth/login -H "Content-Type: application/json" -d '{"userName":"existinguser","password":"theirpassword"}'
```

Expected: `200` with token (use a real username/password from your DB).

- [ ] **Step 4: Deploy to production and verify via health check**

```bash
ssh easyenglish
cd /opt/aviator
./update.sh
curl https://aviator.rummydeatly.com/health
```

Expected: `{"status":"ok",...}`

- [ ] **Step 5: Final commit message for the branch**

All commits were made per-task. Verify with:

```powershell
git log --oneline origin/master..HEAD
```

Expected (in order):
```
feat: replace register form with Telegram Login Widget
feat: add loginWithTelegram to AuthProvider
feat: add /telegram-widget route, remove /register
feat: add authWithTelegramWidget session helper
feat: add verifyWidgetHash for Telegram Login Widget
docs: add Telegram-only auth design spec
```
