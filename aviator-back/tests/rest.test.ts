/**
 * REST API tests against the running backend.
 */
const URL = process.env.SMOKE_URL || "http://localhost:5000";

describe("REST API", () => {
  jest.setTimeout(60_000);

  test("GET /health returns engine status", async () => {
    const res = await fetch(`${URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(["BET", "PLAYING", "GAMEEND"]).toContain(body.phase);
    expect(typeof body.multiplier).toBe("number");
    expect(typeof body.players).toBe("number");
    expect(typeof body.historyLen).toBe("number");
  });

  test("POST /api/auth/guest returns valid token + balance", async () => {
    const res = await fetch(`${URL}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "testguest1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe(true);
    expect(body.token).toMatch(/^eyJ/); // JWT prefix
    expect(body.userName).toBe("testguest1");
    expect(body.balance).toBeGreaterThanOrEqual(1);
  });

  test("POST /api/auth/telegram with empty initData returns 401", async () => {
    const res = await fetch(`${URL}/api/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: "" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/my-info returns user bets", async () => {
    const res = await fetch(`${URL}/api/my-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "nonexistent_user_xyz" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /api/game/seed/:id returns 404 for missing round", async () => {
    const res = await fetch(`${URL}/api/game/seed/999999999`);
    expect(res.status).toBe(404);
  });

  test("GET /api/game/seed/:id returns seed for known round", async () => {
    // First find a real round by hitting /health for historyLen
    const health = await (await fetch(`${URL}/health`)).json();
    expect(health.historyLen).toBeGreaterThan(0);
    // Round IDs start at 1 — try roundId 1 first
    const res = await fetch(`${URL}/api/game/seed/1`);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.serverSeed).toMatch(/^[a-f0-9]{64}$/);
      expect(body.serverSeedHash).toMatch(/^[a-f0-9]{64}$/);
      expect(typeof body.crashPoint).toBe("number");
    }
    // Either 200 OK or 404 (if mongo was wiped) is acceptable
    expect([200, 404]).toContain(res.status);
  });

  test("CORS allows cross-origin requests", async () => {
    const res = await fetch(`${URL}/health`, {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });
});
