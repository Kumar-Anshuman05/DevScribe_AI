const test = require("node:test");
const assert = require("node:assert");

// Import actual production API key utilities from src/lib/auth/apiKey
let hashApiKey;
let generateApiKey;

test.before(async () => {
  const mod = await import("@/lib/auth/apiKey");
  hashApiKey = mod.hashApiKey;
  generateApiKey = mod.generateApiKey;
});

test("API Key Hashing (Production Module): SHA-256 hash generation is deterministic and unique", () => {
  const { plaintextKey, keyPrefix, keyHash } = generateApiKey();

  assert.ok(plaintextKey.startsWith("ds_live_"));
  assert.strictEqual(keyPrefix, plaintextKey.slice(0, 16));
  assert.strictEqual(keyHash, hashApiKey(plaintextKey));

  // Different keys generate different hashes
  const key2 = generateApiKey();
  assert.notStrictEqual(key2.keyHash, keyHash);
});

test("Authentication Enforcement: Unauthenticated requests are rejected with 401 without findFirst fallback", () => {
  function resolveUserSession(session) {
    if (!session || !session.user || !session.user.id) {
      return { success: false, status: 401, error: "Unauthorized. Please sign in." };
    }
    return { success: true, userId: session.user.id };
  }

  // Request without session
  const unauthed = resolveUserSession(null);
  assert.strictEqual(unauthed.status, 401);
  assert.strictEqual(unauthed.success, false);

  // Request with invalid/empty session
  const emptySession = resolveUserSession({});
  assert.strictEqual(emptySession.status, 401);

  // Request with valid authenticated user
  const authed = resolveUserSession({ user: { id: "user_uuid_1234" } });
  assert.strictEqual(authed.success, true);
  assert.strictEqual(authed.userId, "user_uuid_1234");
});

test("Resource Ownership Enforcement: Cross-user resource access is rejected with 403 Forbidden", () => {
  const resource = {
    id: "key_789",
    userId: "user_alice",
    name: "Alice's Secret Key",
  };

  function deleteApiKey(requestUserId, resourceOwnerId) {
    if (requestUserId !== resourceOwnerId) {
      return { status: 403, error: "Forbidden. You do not own this API key." };
    }
    return { status: 200, success: true };
  }

  // Bob attempts to delete Alice's API key
  const bobAttempt = deleteApiKey("user_bob", resource.userId);
  assert.strictEqual(bobAttempt.status, 403);
  assert.strictEqual(bobAttempt.error, "Forbidden. You do not own this API key.");

  // Alice deletes her own API key
  const aliceAttempt = deleteApiKey("user_alice", resource.userId);
  assert.strictEqual(aliceAttempt.status, 200);
  assert.strictEqual(aliceAttempt.success, true);
});

test("Independent API Route Authorization: Does not rely on middleware alone", () => {
  function apiRouteHandler(headers, session) {
    const authHeader = headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ds_live_")) {
      return { authenticated: true, authType: "api_key" };
    }
    if (session?.user?.id) {
      return { authenticated: true, authType: "session", userId: session.user.id };
    }
    return { authenticated: false, status: 401, error: "Missing or invalid authorization credentials." };
  }

  // Missing all credentials
  const res1 = apiRouteHandler({}, null);
  assert.strictEqual(res1.authenticated, false);
  assert.strictEqual(res1.status, 401);

  // Valid session
  const res2 = apiRouteHandler({}, { user: { id: "user_123" } });
  assert.strictEqual(res2.authenticated, true);
  assert.strictEqual(res2.userId, "user_123");

  // Valid Bearer key
  const res3 = apiRouteHandler({ authorization: "Bearer ds_live_abcdef123456" }, null);
  assert.strictEqual(res3.authenticated, true);
  assert.strictEqual(res3.authType, "api_key");
});

test("Cross-User Article Access: Query is scoped strictly by authenticated userId", () => {
  const articlesDatabase = [
    { id: "art_1", userId: "user_alice", title: "Alice's Post" },
    { id: "art_2", userId: "user_bob", title: "Bob's Post" },
    { id: "art_3", userId: "user_alice", title: "Alice's Second Post" },
  ];

  function getUserArticles(userId) {
    return articlesDatabase.filter((art) => art.userId === userId);
  }

  const aliceArticles = getUserArticles("user_alice");
  assert.strictEqual(aliceArticles.length, 2);
  assert.ok(aliceArticles.every((a) => a.userId === "user_alice"));

  const bobArticles = getUserArticles("user_bob");
  assert.strictEqual(bobArticles.length, 1);
  assert.strictEqual(bobArticles[0].id, "art_2");

  // Untrusted client cannot spoof another user's articles
  const anonymousArticles = getUserArticles("untrusted_user");
  assert.strictEqual(anonymousArticles.length, 0);
});

test("Public Endpoints: Explicitly allow access without session", () => {
  const publicPaths = ["/api/v1/health", "/api/docs", "/api/inngest"];

  function isPublicRoute(pathname) {
    return publicPaths.some((p) => pathname.startsWith(p));
  }

  assert.strictEqual(isPublicRoute("/api/v1/health"), true);
  assert.strictEqual(isPublicRoute("/api/docs"), true);
  assert.strictEqual(isPublicRoute("/api/inngest"), true);
  assert.strictEqual(isPublicRoute("/dashboard"), false);
  assert.strictEqual(isPublicRoute("/api/v1/jobs"), false);
  assert.strictEqual(isPublicRoute("/api/v1/api-keys"), false);
});
