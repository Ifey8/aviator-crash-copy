/**
 * Tests for username/password registration + login + /me endpoint.
 * Hits the live backend on $SMOKE_URL.
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

const uniq = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe("Password auth (register/login/me)", () => {
  jest.setTimeout(30_000);

  test("register a new user → returns token + balance + isAdmin=false", async () => {
    const userName = uniq();
    const r = await post("/api/auth/register", { userName, password: "secret123" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe(true);
    expect(r.body.token).toMatch(/^eyJ/);
    expect(r.body.userName).toBe(userName);
    expect(r.body.isAdmin).toBe(false);
    expect(r.body.balance).toBeGreaterThanOrEqual(1);
  });

  test("register with too-short password fails", async () => {
    const r = await post("/api/auth/register", { userName: uniq(), password: "abc" });
    expect(r.status).toBe(400);
    expect(r.body.status).toBe(false);
    expect(r.body.message).toMatch(/password/i);
  });

  test("register with bad username fails", async () => {
    const r = await post("/api/auth/register", { userName: "ab", password: "secret123" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/username/i);
  });

  test("register duplicate username fails", async () => {
    const userName = uniq();
    await post("/api/auth/register", { userName, password: "secret123" });
    const second = await post("/api/auth/register", { userName, password: "secret123" });
    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/already taken/i);
  });

  test("login with correct credentials returns token", async () => {
    const userName = uniq();
    await post("/api/auth/register", { userName, password: "secret123" });
    const login = await post("/api/auth/login", { userName, password: "secret123" });
    expect(login.status).toBe(200);
    expect(login.body.token).toMatch(/^eyJ/);
  });

  test("login with wrong password rejected", async () => {
    const userName = uniq();
    await post("/api/auth/register", { userName, password: "secret123" });
    const login = await post("/api/auth/login", { userName, password: "wrongpass" });
    expect(login.status).toBe(401);
    expect(login.body.message).toMatch(/invalid/i);
  });

  test("/me returns profile when given valid token", async () => {
    const userName = uniq();
    const reg = await post("/api/auth/register", { userName, password: "secret123" });
    const me = await get("/api/auth/me", reg.body.token);
    expect(me.status).toBe(200);
    expect(me.body.userName).toBe(userName);
    expect(me.body.isAdmin).toBe(false);
  });

  test("/me with bad token returns 401", async () => {
    const me = await get("/api/auth/me", "not.a.valid.jwt");
    expect(me.status).toBe(401);
  });
});

describe("Admin routes (gated by isAdmin)", () => {
  jest.setTimeout(30_000);

  test("/api/admin/users without token returns 401", async () => {
    const r = await get("/api/admin/users");
    expect(r.status).toBe(401);
  });

  test("/api/admin/users with non-admin token returns 403", async () => {
    const userName = uniq();
    const reg = await post("/api/auth/register", { userName, password: "secret123" });
    const r = await get("/api/admin/users", reg.body.token);
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/admin/i);
  });

  // (Smoke test that requires an actual admin user is in admin-flow.test.ts
  //  — skipped here so this suite stays standalone.)
});
