import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { config } from "./config";
import { connectDb } from "./db/connection";
import { engine } from "./game/engine";
import { initSockets } from "./sockets";
import { authRouter } from "./routes/auth";
import { userRouter } from "./routes/user";
import { adminRouter } from "./routes/admin";
import { rechargeRouter } from "./routes/recharge";
import { cryptoRouter } from "./routes/crypto";
import { withdrawalRouter } from "./routes/withdrawal";
import { startTronWatcher } from "./payment/providers/tron";
import { startTelegramBot } from "./bot/telegram";
import { loadSettings } from "./settings";
import { migratePaymeSettingsToChannel } from "./payment/migrate";

const app = express();
// Trust proxy so req.ip reflects the real client behind nginx (X-Forwarded-For).
// Required for the per-IP register limit to be meaningful.
app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) =>
  res.json({
    status: "ok",
    phase: engine.phase,
    multiplier: engine.multiplier,
    players: engine.players.size,
    historyLen: engine.history.length,
  }),
);

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/recharge", rechargeRouter);
app.use("/api/crypto", cryptoRouter);
app.use("/api/withdrawal", withdrawalRouter);
app.use("/api", userRouter);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
});

const main = async () => {
  await connectDb();
  await loadSettings();
  await migratePaymeSettingsToChannel();
  initSockets(io);
  await engine.start();
  await startTelegramBot();
  startTronWatcher();
  server.listen(config.port, () => {
    console.log(`[api] listening on :${config.port}`);
    console.log(
      `[api] allowDevAuth=${config.allowDevAuth} ` +
        `(prod MUST be false; otherwise tokenless sockets spawn guest users)`,
    );
  });
};

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

const shutdown = (sig: string) => {
  console.log(`[shutdown] ${sig}`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
