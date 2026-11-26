const test = require("node:test");
const assert = require("node:assert");

let hashApiKey;
let generateApiKey;
let authenticateApiKey;
let resolveUserAuth;
let middleware;
let NextRequest;
let prisma;

test.before(async () => {
  const nextServer = await import("next/server.js");
  NextRequest = nextServer.NextRequest;

  const prismaMod = await import("@/lib/prisma");
  prisma = prismaMod.default;

  const apiKeyMod = await import("@/lib/auth/apiKey");
  hashApiKey = apiKeyMod.hashApiKey;
  generateApiKey = apiKeyMod.generateApiKey;
  authenticateApiKey = apiKeyMod.authenticateApiKey;

  const resolveAuthMod = await import("@/lib/auth/resolveAuth");
  resolveUserAuth = resolveAuthMod.resolveUserAuth;

  const middlewareMod = await import("@/middleware");
  middleware = middlewareMod.middleware;
});

test("API Key Cryptographic Generation (Production Module): SHA-256 hash generation is deterministic and unique", () => {
  const { plaintextKey, keyPrefix, keyHash } = generateApiKey();

  assert.ok(plaintextKey.startsWith("ds_live_"), "Plaintext key must begin with ds_live_");
  assert.strictEqual(keyPrefix, plaintextKey.slice(0, 16));
  assert.strictEqual(keyHash, hashApiKey(plaintextKey), "keyHash must match hashApiKey output");

  // Different invocations produce unique keys
  const key2 = generateApiKey();
  assert.notStrictEqual(key2.plaintextKey, plaintextKey);
  assert.notStrictEqual(key2.keyHash, keyHash);
});

test("API Key Authentication (Production Module): Rejects missing headers and malformed prefixes", async () => {
  // Missing header
  const res1 = await authenticateApiKey(null);
  assert.strictEqual(res1.isValid, false);
  assert.strictEqual(res1.error, "MISSING_HEADER");

  // Malformed scheme (Basic instead of Bearer)
  const res2 = await authenticateApiKey("Basic dXNlcjpwYXNz");
  assert.strictEqual(res2.isValid, false);
  assert.strictEqual(res2.error, "INVALID_FORMAT");

  // Malformed token prefix (not starting with ds_live_)
  const res3 = await authenticateApiKey("Bearer test_secret_token_123");
  assert.strictEqual(res3.isValid, false);
  assert.strictEqual(res3.error, "INVALID_FORMAT");
});

test("API Key Authentication (Production Module): Enforces database status, revocation, expiration, and scopes", async () => {
  const activeKey = generateApiKey();
  const revokedKey = generateApiKey();
  const expiredKey = generateApiKey();
  const limitedKey = generateApiKey();

  const mockDbKeys = new Map([
    [
      activeKey.keyHash,
      {
        id: "key_active_id",
        userId: "user_alice",
        isActive: true,
        expiresAt: new Date(Date.now() + 1000000),
        scopes: ["articles:write", "jobs:read"],
      },
    ],
    [
      revokedKey.keyHash,
      {
        id: "key_revoked_id",
        userId: "user_bob",
        isActive: false,
        expiresAt: new Date(Date.now() + 1000000),
        scopes: ["articles:write"],
      },
    ],
    [
      expiredKey.keyHash,
      {
        id: "key_expired_id",
        userId: "user_charlie",
        isActive: true,
        expiresAt: new Date(Date.now() - 100000), // Expired in past
        scopes: ["articles:write"],
      },
    ],
    [
      limitedKey.keyHash,
      {
        id: "key_limited_id",
        userId: "user_david",
        isActive: true,
        expiresAt: new Date(Date.now() + 1000000),
        scopes: ["jobs:read"], // Missing articles:write
      },
    ],
  ]);

  prisma.apiKey = {
    findUnique: async ({ where }) => mockDbKeys.get(where.keyHash) || null,
    update: async () => ({}),
  };

  // Unknown key in DB
  const resUnknown = await authenticateApiKey("Bearer ds_live_nonexistentkey1234567890abcdef");
  assert.strictEqual(resUnknown.isValid, false);
  assert.strictEqual(resUnknown.error, "KEY_NOT_FOUND");

  // Revoked key
  const resRevoked = await authenticateApiKey(`Bearer ${revokedKey.plaintextKey}`);
  assert.strictEqual(resRevoked.isValid, false);
  assert.strictEqual(resRevoked.error, "KEY_REVOKED");

  // Expired key
  const resExpired = await authenticateApiKey(`Bearer ${expiredKey.plaintextKey}`);
  assert.strictEqual(resExpired.isValid, false);
  assert.strictEqual(resExpired.error, "KEY_EXPIRED");

  // Insufficient scope
  const resScope = await authenticateApiKey(`Bearer ${limitedKey.plaintextKey}`, "articles:write");
  assert.strictEqual(resScope.isValid, false);
  assert.strictEqual(resScope.error, "INSUFFICIENT_SCOPE");

  // Valid key with required scope
  const resValid = await authenticateApiKey(`Bearer ${activeKey.plaintextKey}`, "articles:write");
  assert.strictEqual(resValid.isValid, true);
  assert.strictEqual(resValid.userId, "user_alice");
  assert.strictEqual(resValid.apiKeyId, "key_active_id");
});

test("API Authorization Resolver (Production Module): resolveUserAuth authenticates valid API key requests", async () => {
  const activeKey = generateApiKey();
  prisma.apiKey = {
    findUnique: async () => ({
      id: "key_valid_1",
      userId: "user_developer_1",
      isActive: true,
      expiresAt: null,
      scopes: ["jobs:write"],
    }),
    update: async () => ({}),
  };

  const req = new NextRequest("http://localhost:3000/api/v1/jobs", {
    headers: {
      authorization: `Bearer ${activeKey.plaintextKey}`,
    },
  });

  const auth = await resolveUserAuth(req, "jobs:write");
  assert.strictEqual(auth.userId, "user_developer_1");
  assert.strictEqual(auth.apiKeyId, "key_valid_1");
});

test("API Authorization Resolver (Production Module): resolveUserAuth rejects unauthenticated requests with 401 without findFirst fallback", async () => {
  const reqNoAuth = new NextRequest("http://localhost:3000/api/v1/jobs");

  await assert.rejects(
    async () => {
      await resolveUserAuth(reqNoAuth);
    },
    (err) => {
      assert.strictEqual(err.statusCode, 401);
      assert.strictEqual(err.errorCode, "UNAUTHORIZED");
      assert.ok(err.message.includes("Missing or invalid authorization credentials"));
      return true;
    }
  );

  const reqInvalidPrefix = new NextRequest("http://localhost:3000/api/v1/jobs", {
    headers: {
      authorization: "Bearer invalid_secret_123",
    },
  });

  await assert.rejects(
    async () => {
      await resolveUserAuth(reqInvalidPrefix);
    },
    (err) => {
      assert.strictEqual(err.statusCode, 401);
      assert.strictEqual(err.errorCode, "UNAUTHORIZED");
      assert.ok(err.message.includes("Production API keys must start with 'ds_live_'"));
      return true;
    }
  );
});

test("Route Middleware Protection (Production Module): Dashboard routes redirect unauthenticated users to /login", async () => {
  const dashboardReq = new NextRequest("http://localhost:3000/dashboard/articles");
  const response = await middleware(dashboardReq);

  // Unauthenticated access to /dashboard must redirect to /login
  assert.ok(response.status === 307 || response.status === 302, "Must return redirect status");
  const location = response.headers.get("location");
  assert.ok(location && location.includes("/login"), "Must redirect to /login");

  // Public health endpoint is allowed through without redirect
  const healthReq = new NextRequest("http://localhost:3000/api/v1/health");
  const healthRes = await middleware(healthReq);
  assert.strictEqual(healthRes.status, 200);
});
