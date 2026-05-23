# Telegram Cross-Device Login

> **Stack**: Node + Express + Mongoose + grammy + React  
> **Pattern**: One-time token + bot callback + browser polling  
> Works across devices: desktop browser confirms via phone Telegram (or desktop Telegram app).

---

## 流程概覽

```
Browser                     Server                      Telegram Bot
  │                            │                               │
  │── POST /auth/login-request ──▶│                               │
  │◀── { token: "abc123" } ───────│                               │
  │                            │                               │
  │─ opens t.me/bot?start=auth_abc123 ──────────────────────────▶│
  │                            │                               │
  │── GET /auth/login-poll/abc123 ──▶│                            │
  │◀── { fulfilled: false } ─────────│                            │
  │  (polls every 2s...)        │                               │
  │                            │    User taps "✅ Confirm Login" │
  │                            │◀─── callback_query: login_abc123│
  │                            │─── { status: fulfilled, jwt } ─▶│ (updates DB)
  │                            │                               │
  │── GET /auth/login-poll/abc123 ──▶│                            │
  │◀── { fulfilled: true, jwt } ─────│                            │
  │                            │                               │
  │ localStorage.setItem(jwt)   │                               │
  │ window.location.reload()    │                               │
  ✅ Logged in                  │                               │
```

---

## 1. Mongoose Model

```typescript
// src/db/models/LoginRequest.ts
import { Schema, model } from "mongoose";

export interface LoginRequestDoc {
  token: string;
  status: "pending" | "fulfilled";
  jwt?: string;
  createdAt: Date;
  expiresAt: Date;
}

const LoginRequestSchema = new Schema<LoginRequestDoc>({
  token:     { type: String, required: true, unique: true, index: true },
  status:    { type: String, enum: ["pending", "fulfilled"], default: "pending" },
  jwt:       { type: String },
  createdAt: { type: Date, default: Date.now },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 5 * 60 * 1000), // 5-min TTL
  },
});

// Mongo auto-deletes docs after expiresAt
LoginRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginRequestModel = model<LoginRequestDoc>("LoginRequest", LoginRequestSchema);
```

---

## 2. Auth Session Helper

Add to your auth session module. This creates/upserts a user from the bot callback context (no `initData` validation needed — the callback proves Telegram identity).

```typescript
// src/auth/session.ts  (add this export)
import { UserModel } from "../db/models/User";
import { signToken } from "./jwt";

export const authFromTelegramUser = async (tgUser: {
  id: number;
  username?: string;
  first_name?: string;
}): Promise<{ token: string; userName: string }> => {
  const rawName = tgUser.username || tgUser.first_name || `tg${tgUser.id}`;
  const userName = rawName.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20)
    || `tg${tgUser.id}`;

  let user = await UserModel.findOne({ telegramId: tgUser.id });
  if (!user) {
    user = await UserModel.create({ telegramId: tgUser.id, userName });
  }

  const token = signToken({ userName: user.userName, telegramId: user.telegramId });
  return { token, userName: user.userName };
};
```

---

## 3. Express Routes

```typescript
// src/routes/auth.ts  (add these two endpoints)
import { randomBytes } from "crypto";
import { LoginRequestModel } from "../db/models/LoginRequest";

// Step 1: browser requests a login token
router.post("/auth/login-request", async (_req, res) => {
  const token = randomBytes(10).toString("hex"); // 20-char hex string
  await LoginRequestModel.create({ token });
  res.json({ status: true, token });
});

// Step 3: browser polls for fulfillment
router.get("/auth/login-poll/:token", async (req, res) => {
  const doc = await LoginRequestModel.findOne({ token: req.params.token }).lean();
  if (!doc)                          return res.json({ status: false, message: "Invalid or expired" });
  if (doc.expiresAt < new Date())    return res.json({ status: false, message: "Expired" });
  if (doc.status === "fulfilled" && doc.jwt)
    return res.json({ status: true, fulfilled: true, jwt: doc.jwt });
  res.json({ status: true, fulfilled: false });
});
```

---

## 4. grammy Bot Handler

```typescript
// src/bot/telegram.ts  (add inside startOneBot)
import { LoginRequestModel } from "../db/models/LoginRequest";
import { authFromTelegramUser } from "../auth/session";

// ── /start with auth_<token> param ──────────────────────────────────────────
bot.command("start", async (ctx) => {
  const param = (ctx.match || "").trim();

  if (param.startsWith("auth_")) {
    const loginToken = param.slice(5);
    const kb = new InlineKeyboard()
      .text("✅ Confirm Login", `login_${loginToken}`);
    return ctx.reply(
      "Someone is trying to log in from a browser.\n\nIf that's you, tap below to confirm.",
      { reply_markup: kb },
    );
  }

  // ... your existing /start handler
});

// ── Inline button callback ───────────────────────────────────────────────────
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data || "";
  if (!data.startsWith("login_")) return ctx.answerCallbackQuery();

  const loginToken = data.slice(6);
  const tgUser = ctx.from;

  const loginReq = await LoginRequestModel.findOne({
    token: loginToken,
    status: "pending",
  }).lean();

  if (!loginReq || loginReq.expiresAt < new Date()) {
    return ctx.answerCallbackQuery("❌ Link expired. Please try again from the website.");
  }

  const result = await authFromTelegramUser({
    id: tgUser.id,
    username: tgUser.username,
    first_name: tgUser.first_name,
  });

  await LoginRequestModel.updateOne(
    { token: loginToken },
    { status: "fulfilled", jwt: result.token },
  );

  await ctx.answerCallbackQuery("✅ Logged in!");
  await ctx.editMessageText(
    `✅ Logged in as *${result.userName}*\\. Return to your browser — it will refresh automatically\\.`,
    { parse_mode: "MarkdownV2" },
  );
});
```

---

## 5. React Frontend (AuthScreen)

```tsx
// src/components/AuthScreen.tsx
import React from "react";

const API_BASE = process.env.REACT_APP_API_URL + "/api"; // adjust to your config
const TOKEN_KEY = "app_token";
const BOT_USERNAME = "yourbot"; // or fetch from /api/auth/bots

type Stage = "idle" | "waiting" | "done";

export const AuthScreen: React.FC = () => {
  const [stage, setStage] = React.useState<Stage>("idle");
  const [error, setError]   = React.useState<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // cleanup on unmount
  React.useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startLogin = async () => {
    setError(null);
    try {
      // 1. get one-time token
      const r  = await fetch(`${API_BASE}/auth/login-request`, { method: "POST" });
      const j  = await r.json();
      if (!j.status || !j.token) throw new Error("Failed to create login request");

      setStage("waiting");

      // 2. open bot in new tab
      window.open(`https://t.me/${BOT_USERNAME}?start=auth_${j.token}`, "_blank");

      // 3. poll
      let elapsed = 0;
      pollRef.current = setInterval(async () => {
        elapsed += 2000;
        if (elapsed > 5 * 60 * 1000) {          // 5-min timeout
          clearInterval(pollRef.current!);
          setStage("idle");
          setError("Login timed out. Please try again.");
          return;
        }
        try {
          const pr = await fetch(`${API_BASE}/auth/login-poll/${j.token}`);
          const pj = await pr.json();
          if (pj.fulfilled && pj.jwt) {
            clearInterval(pollRef.current!);
            localStorage.setItem(TOKEN_KEY, pj.jwt);
            setStage("done");
            setTimeout(() => window.location.reload(), 500);
          } else if (!pj.status) {
            clearInterval(pollRef.current!);
            setStage("idle");
            setError("Login link expired. Please try again.");
          }
        } catch { /* network hiccup — keep polling */ }
      }, 2000);
    } catch (e: any) {
      setStage("idle");
      setError(e.message || "Something went wrong");
    }
  };

  const cancel = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStage("idle");
    setError(null);
  };

  return (
    <div>
      {stage === "idle" && (
        <button onClick={startLogin}>Log in with Telegram</button>
      )}

      {stage === "waiting" && (
        <div>
          <span>⏳ Waiting for Telegram confirmation…</span>
          <p>Tap "✅ Confirm Login" in the bot</p>
          <button onClick={cancel}>Cancel</button>
        </div>
      )}

      {stage === "done" && <span>✅ Logged in! Redirecting…</span>}

      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
};
```

---

## 適配其他框架

### Vue 3

```typescript
// useLoginWithTelegram.ts
import { ref, onUnmounted } from "vue";

export function useLoginWithTelegram(apiBase: string, botUsername: string) {
  const stage = ref<"idle" | "waiting" | "done">("idle");
  const error = ref<string | null>(null);
  let poll: ReturnType<typeof setInterval> | null = null;
  onUnmounted(() => { if (poll) clearInterval(poll); });

  async function start() {
    error.value = null;
    const r = await fetch(`${apiBase}/auth/login-request`, { method: "POST" });
    const j = await r.json();
    if (!j.status) { error.value = "Failed"; return; }

    stage.value = "waiting";
    window.open(`https://t.me/${botUsername}?start=auth_${j.token}`, "_blank");

    let elapsed = 0;
    poll = setInterval(async () => {
      elapsed += 2000;
      if (elapsed > 300000) { clearInterval(poll!); stage.value = "idle"; error.value = "Timeout"; return; }
      const pr = await fetch(`${apiBase}/auth/login-poll/${j.token}`);
      const pj = await pr.json();
      if (pj.fulfilled) { clearInterval(poll!); localStorage.setItem("token", pj.jwt); stage.value = "done"; setTimeout(() => location.reload(), 500); }
    }, 2000);
  }

  return { stage, error, start, cancel: () => { if (poll) clearInterval(poll); stage.value = "idle"; } };
}
```

### Next.js API Routes

```typescript
// pages/api/auth/login-request.ts
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const token = require("crypto").randomBytes(10).toString("hex");
  await LoginRequestModel.create({ token });
  res.json({ status: true, token });
}

// pages/api/auth/login-poll/[token].ts
export default async function handler(req, res) {
  const doc = await LoginRequestModel.findOne({ token: req.query.token }).lean();
  if (!doc) return res.json({ status: false });
  if (doc.status === "fulfilled") return res.json({ status: true, fulfilled: true, jwt: doc.jwt });
  res.json({ status: true, fulfilled: false });
}
```

### Python / FastAPI

```python
# routes/auth.py
import secrets
from datetime import datetime, timedelta

@router.post("/auth/login-request")
async def login_request(db: AsyncSession):
    token = secrets.token_hex(10)  # 20 chars
    req = LoginRequest(token=token, expires_at=datetime.utcnow() + timedelta(minutes=5))
    db.add(req); await db.commit()
    return {"status": True, "token": token}

@router.get("/auth/login-poll/{token}")
async def login_poll(token: str, db: AsyncSession):
    req = await db.get(LoginRequest, token)
    if not req or req.expires_at < datetime.utcnow():
        return {"status": False, "message": "Expired"}
    if req.status == "fulfilled":
        return {"status": True, "fulfilled": True, "jwt": req.jwt}
    return {"status": True, "fulfilled": False}
```

### Python Bot (python-telegram-bot)

```python
from telegram import InlineKeyboardButton, InlineKeyboardMarkup

async def start(update, context):
    args = context.args or []
    if args and args[0].startswith("auth_"):
        token = args[0][5:]
        keyboard = [[InlineKeyboardButton("✅ Confirm Login", callback_data=f"login_{token}")]]
        await update.message.reply_text(
            "Tap below to confirm login.",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return
    # ... normal start

async def button_callback(update, context):
    query = update.callback_query
    data = query.data or ""
    if not data.startswith("login_"):
        return
    token = data[6:]
    user = query.from_user

    req = await db.get_login_request(token)
    if not req or req.expired:
        await query.answer("❌ Link expired.")
        return

    jwt = create_jwt(user.id, user.username)
    await db.fulfill_login_request(token, jwt)
    await query.answer("✅ Logged in!")
    await query.edit_message_text(f"✅ Logged in as {user.username}. Return to your browser.")
```

---

## 安全注意事項

| 風險 | 緩解 |
|------|------|
| Token 被截獲 | TTL 5 分鐘，用後即廢 |
| CSRF | Token 是隨機的，無 session binding |
| 偽造 callback | Bot callback 由 Telegram 服務器推送，身份由 Telegram 保證 |
| 暴力枚舉 | Token 是 20 位 hex（2^80 空間）；可加 rate limit |
| Token 重放 | `status: "pending"` 限制只能用一次，fulfilled 後拒絕 |

Rate limit 加法（Express example）：

```typescript
import rateLimit from "express-rate-limit";

router.use("/auth/login-request", rateLimit({ windowMs: 60_000, max: 5 }));
router.use("/auth/login-poll",    rateLimit({ windowMs: 60_000, max: 120 }));
```

---

## 配置清單（新項目 checklist）

- [ ] 安裝 grammy（或其他 bot 框架）
- [ ] 創建 `LoginRequest` 模型（或等效 DB schema）
- [ ] 添加 `POST /auth/login-request` endpoint
- [ ] 添加 `GET /auth/login-poll/:token` endpoint
- [ ] 在 bot 的 `/start` handler 中處理 `auth_<token>` 參數
- [ ] 在 bot 中添加 `callback_query` handler 處理 `login_<token>`
- [ ] 前端添加 polling logic + waiting UI
- [ ] 在 bot `.env` 設置正確的 `BOT_TOKEN`
- [ ] 確認 `/auth/login-request` 不需要 auth（public endpoint）
- [ ] （可選）添加 rate limiting

---

*Generated from the Aviator Crash Game project — `src/bot/telegram.ts`, `src/routes/auth.ts`, `src/components/Mobile/AuthScreen.tsx`*
