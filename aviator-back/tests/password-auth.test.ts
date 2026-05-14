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
