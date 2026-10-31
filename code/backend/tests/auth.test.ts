import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { buildAuthTestApp } from "./helpers/auth-app.js";
import { SESSION_COOKIE } from "../src/config/auth.js";
import { TokenManager } from "../src/utils/managers/token.manager.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-secret-not-for-production-123456789";
process.env.FRONTEND_URL = "http://localhost:4321,http://localhost:4322,http://localhost:4323";

const credentials = { firstName: "Camille", lastName: "Martin", email: "camille@example.com", password: "test-password-123" };

for (const [tenant, role] of [["clients", "client"], ["owners", "owner"]] as const) {
  test(`${tenant}: registration, scoped login, cookie session, bearer compatibility and logout`, async (t) => {
    const { app, owners, clients } = await buildAuthTestApp();
    t.after(() => app.close());
    const registration = await app.inject({
      method: "POST", url: `/api/auth/${tenant}/register`,
      payload: { ...credentials, firstName: " Camille ", email: " CAMILLE@EXAMPLE.COM " },
    });
    assert.equal(registration.statusCode, 201, registration.body);
    const result = registration.json();
    assert.equal(result.role, role);
    assert.equal(result.user.firstName, "Camille");
    assert.equal(result.user.email, credentials.email);
    assert.equal(result.user.passwordHash, undefined);
    assert.equal(result.user.password, undefined);
    assert.equal(registration.headers["cache-control"], "no-store");
    const stored = role === "owner" ? owners.records.get(credentials.email) : clients.records.get(credentials.email);
    assert.ok(stored);
    assert.notEqual(stored.passwordHash, credentials.password);
    assert.equal(await bcrypt.compare(credentials.password, stored.passwordHash), true);

    const cookie = registration.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
    assert.ok(cookie);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "Lax");
    assert.equal(cookie.path, "/api");
    assert.equal(cookie.maxAge, 604800);
    const jwt = await TokenManager.verifyToken<{ role: string; userId: string }>(cookie.value);
    assert.equal(jwt.role, role);
    assert.equal(jwt.userId, result.user.id);

    const profile = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: cookie.value } });
    assert.equal(profile.statusCode, 200);
    assert.equal(profile.json().role, role);
    assert.equal(profile.json().passwordHash, undefined);
    const bearer = await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${result.token}` } });
    assert.equal(bearer.statusCode, 200);

    const login = await app.inject({ method: "POST", url: `/api/auth/${tenant}/login`, payload: { email: credentials.email, password: credentials.password } });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().role, role);
    assert.ok(login.cookies.find((cookie) => cookie.name === SESSION_COOKIE));
    const legacy = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: credentials.email, password: credentials.password } });
    assert.equal(legacy.statusCode, 200);
    assert.equal(legacy.json().role, role);

    const otherTenant = tenant === "clients" ? "owners" : "clients";
    const wrongTenant = await app.inject({ method: "POST", url: `/api/auth/${otherTenant}/login`, payload: { email: credentials.email, password: credentials.password } });
    assert.equal(wrongTenant.statusCode, 401);
    assert.equal(wrongTenant.json().code, "INVALID_CREDENTIALS");
    assert.equal(wrongTenant.cookies.length, 0);

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { [SESSION_COOKIE]: cookie.value } });
    assert.equal(logout.statusCode, 204);
    assert.equal(logout.cookies[0].value, "");
    assert.equal(logout.cookies[0].path, "/api");
    const anonymous = await app.inject({ method: "GET", url: "/api/auth/me" });
    assert.equal(anonymous.statusCode, 401);
  });
}

test("rejects invalid registration data before persistence", async (t) => {
  const { app, owners, clients } = await buildAuthTestApp();
  t.after(() => app.close());
  for (const tenant of ["owners", "clients"]) {
    for (const invalid of [{ firstName: "   " }, { lastName: "" }, { email: "invalid" }, { password: "short" }, { password: "😀".repeat(20) }]) {
      const response = await app.inject({ method: "POST", url: `/api/auth/${tenant}/register`, payload: { ...credentials, ...invalid } });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, "VALIDATION_ERROR");
      assert.ok(response.json().details.length);
    }
  }
  assert.equal(owners.records.size, 0);
  assert.equal(clients.records.size, 0);
});

test("rejects duplicate emails in either tenant and never updates the existing account", async (t) => {
  const { app, clients, owners } = await buildAuthTestApp();
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/clients/register", payload: credentials })).statusCode, 201);
  for (const tenant of ["clients", "owners"]) {
    const response = await app.inject({ method: "POST", url: `/api/auth/${tenant}/register`, payload: credentials });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, "EMAIL_EXISTS");
    assert.equal(response.cookies.length, 0);
  }
  assert.equal(clients.records.size, 1);
  assert.equal(owners.records.size, 0);
});

test("wrong passwords and unknown emails produce the same generic response", async (t) => {
  const { app } = await buildAuthTestApp();
  t.after(() => app.close());
  await app.inject({ method: "POST", url: "/api/auth/clients/register", payload: credentials });
  const wrongPassword = await app.inject({ method: "POST", url: "/api/auth/clients/login", payload: { email: credentials.email, password: "wrong-password" } });
  const unknown = await app.inject({ method: "POST", url: "/api/auth/clients/login", payload: { email: "unknown@example.com", password: "wrong-password" } });
  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.deepEqual(wrongPassword.json(), unknown.json());
});

test("rejects forged/expired cookies and does not fall back from a bad Authorization header", async (t) => {
  const { app } = await buildAuthTestApp();
  t.after(() => app.close());
  const registration = await app.inject({ method: "POST", url: "/api/auth/clients/register", payload: credentials });
  const expired = await TokenManager.generateToken({ userId: registration.json().user.id, email: credentials.email, role: "client" }, "-1s");
  for (const value of ["forged", expired]) {
    const response = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: value } });
    assert.equal(response.statusCode, 401);
  }
  const response = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: registration.json().token }, headers: { authorization: "Basic wrong" } });
  assert.equal(response.statusCode, 401);
});

test("checks browser origins for registration, login and cookie mutations", async (t) => {
  const { app, clients } = await buildAuthTestApp();
  t.after(() => app.close());
  for (const path of ["clients/register", "clients/login", "owners/register", "owners/login", "logout"]) {
    const response = await app.inject({ method: "POST", url: `/api/auth/${path}`, headers: { origin: "https://untrusted.example" }, payload: credentials });
    assert.equal(response.statusCode, 403);
  }
  assert.equal(clients.records.size, 0);
  const allowed = await app.inject({ method: "POST", url: "/api/auth/clients/register", headers: { origin: "http://localhost:4322" }, payload: credentials });
  assert.equal(allowed.statusCode, 201);
  assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:4322");
  assert.equal(allowed.headers["access-control-allow-credentials"], "true");
  const cookies = { [SESSION_COOKIE]: allowed.json().token };
  const rejectedMutation = await app.inject({ method: "PUT", url: "/api/auth/clients/preferences", headers: { origin: "https://untrusted.example" }, cookies, payload: { hasPets: true } });
  assert.equal(rejectedMutation.statusCode, 403);
  assert.equal(clients.records.get(credentials.email)?.preferences.hasPets, false);
  const acceptedMutation = await app.inject({ method: "PUT", url: "/api/auth/clients/preferences", headers: { origin: "http://localhost:4322" }, cookies, payload: { hasPets: true } });
  assert.equal(acceptedMutation.statusCode, 200);
  assert.equal(acceptedMutation.json().preferences.hasPets, true);
});

test("owner sessions cannot update client preferences", async (t) => {
  const { app } = await buildAuthTestApp();
  t.after(() => app.close());
  const registration = await app.inject({ method: "POST", url: "/api/auth/owners/register", payload: credentials });
  const response = await app.inject({ method: "PUT", url: "/api/auth/clients/preferences", cookies: { [SESSION_COOKIE]: registration.json().token }, payload: { hasPets: true } });
  assert.equal(response.statusCode, 403);
});

test("limits repeated authentication attempts", async (t) => {
  const { app } = await buildAuthTestApp();
  t.after(() => app.close());
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await app.inject({ method: "POST", url: "/api/auth/clients/login", payload: { email: credentials.email, password: "wrong" } })).statusCode, 401);
  }
  const response = await app.inject({ method: "POST", url: "/api/auth/clients/login", payload: { email: credentials.email, password: "wrong" } });
  assert.equal(response.statusCode, 429);
});

test("production cookies are Secure", async (t) => {
  const { app } = await buildAuthTestApp();
  t.after(() => app.close());
  process.env.NODE_ENV = "production";
  try {
    const response = await app.inject({ method: "POST", url: "/api/auth/owners/register", payload: credentials });
    assert.equal(response.cookies[0].secure, true);
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout" });
    assert.equal(logout.cookies[0].secure, true);
  } finally {
    process.env.NODE_ENV = "test";
  }
});

test("missing JWT configuration cannot create a partial account", async (t) => {
  const { app, clients } = await buildAuthTestApp();
  t.after(() => app.close());
  const secret = process.env.JWT_SECRET;
  const fallback = process.env.ACCESS_TOKEN_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.ACCESS_TOKEN_SECRET;
  try {
    const response = await app.inject({ method: "POST", url: "/api/auth/clients/register", payload: credentials });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error, "Internal server error");
    assert.equal(response.body.includes("JWT_SECRET"), false);
    assert.equal(clients.records.size, 0);
  } finally {
    process.env.JWT_SECRET = secret;
    if (fallback !== undefined) process.env.ACCESS_TOKEN_SECRET = fallback;
  }
});

test("Mongo unique-index races are mapped to a safe 409 response", async (t) => {
  const { app, clients } = await buildAuthTestApp();
  t.after(() => app.close());
  clients.create = async () => { throw Object.assign(new Error("private database details"), { code: 11000 }); };
  const response = await app.inject({ method: "POST", url: "/api/auth/clients/register", payload: credentials });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "EMAIL_EXISTS");
  assert.equal(response.body.includes("private database details"), false);
});
