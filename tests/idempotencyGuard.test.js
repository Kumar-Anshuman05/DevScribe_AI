const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

let processWithIdempotency;
let prisma;
let ApiError;

test.before(async () => {
  const mod = await import("@/lib/idempotency/guard");
  processWithIdempotency = mod.processWithIdempotency;

  const prismaMod = await import("@/lib/prisma");
  prisma = prismaMod.default || prismaMod;

  const errMod = await import("@/lib/api/error");
  ApiError = errMod.ApiError;
});

test("Idempotency Guard SQL Verification: Raw queries use quoted camelCase column identifiers", async () => {
  // Capture queries sent through Prisma executeRaw
  const capturedQueries = [];
  const mockPrisma = {
    $executeRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      capturedQueries.push(sql);
      return 1;
    },
    $transaction: async (cb) => {
      const tx = {
        $executeRaw: async (strings, ...values) => {
          const sql = strings.join("?");
          capturedQueries.push(sql);
          return 1;
        },
      };
      return cb(tx);
    },
    idempotencyRecord: {
      findUnique: async () => null,
    },
  };

  // Run with isolated test scope to verify generated SQL structure
  // Note: We can inspect the SQL strings directly from the module or execute with a spy
  // Let's test that the SQL in src/lib/idempotency/guard.ts does not contain forbidden snake_case column identifiers
  const fs = require("fs");
  const path = require("path");
  const guardSource = fs.readFileSync(path.resolve(__dirname, "../src/lib/idempotency/guard.ts"), "utf-8");

  // Verify no unquoted or wrong snake_case columns in SQL template literals
  const forbiddenIdentifiers = [
    "user_id",
    "request_hash",
    "ownership_token",
    "lease_expires_at",
    "expires_at",
    "status_code",
    "response_body",
    "created_at",
    "updated_at",
  ];

  for (const forbidden of forbiddenIdentifiers) {
    const regex = new RegExp(`\\b${forbidden}\\b`, "i");
    assert.strictEqual(
      regex.test(guardSource),
      false,
      `Detected forbidden snake_case SQL identifier '${forbidden}' in src/lib/idempotency/guard.ts`
    );
  }

  // Verify mandatory quoted camelCase identifiers are present in the SQL statements
  const mandatoryQuotedIdentifiers = [
    '"userId"',
    '"requestHash"',
    '"ownershipToken"',
    '"leaseExpiresAt"',
    '"expiresAt"',
    '"statusCode"',
    '"responseBody"',
    '"createdAt"',
    '"updatedAt"',
    'ON CONFLICT ("userId", "key")',
  ];

  for (const mandatory of mandatoryQuotedIdentifiers) {
    assert.ok(
      guardSource.includes(mandatory),
      `Expected mandatory quoted identifier or clause '${mandatory}' to be present in src/lib/idempotency/guard.ts`
    );
  }
});

test("Idempotency Guard Database Integration: Executes real queries against PostgreSQL without 42703 error", async () => {
  // Check if real database connection is available
  let isDbAvailable = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    isDbAvailable = true;
  } catch (err) {
    // Database unreachable in this test environment
    console.log("Database connection not reachable, skipping live DB idempotency test:", err.message);
  }

  if (!isDbAvailable) {
    return;
  }

  // Ensure a test user exists
  const testUserId = crypto.randomUUID();
  const testEmail = `test-idemp-${Date.now()}@example.com`;
  
  await prisma.user.create({
    data: {
      id: testUserId,
      email: testEmail,
    },
  });

  const testKey = `test-key-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const requestBody = { topic: "Kafka Partitioning", wordCount: 2500 };

  try {
    // 1. Initial execution: Acquires lease, executes handler, completes
    let handlerCalls = 0;
    const result1 = await processWithIdempotency(
      testUserId,
      testKey,
      requestBody,
      async (tx, token) => {
        handlerCalls++;
        return {
          statusCode: 202,
          payload: { message: "Job accepted", key: testKey },
        };
      }
    );

    assert.strictEqual(handlerCalls, 1);
    assert.strictEqual(result1.isCached, false);
    assert.strictEqual(result1.statusCode, 202);
    assert.strictEqual(result1.payload.message, "Job accepted");

    // 2. Replay with identical payload: Should return cached result without calling handler
    const result2 = await processWithIdempotency(
      testUserId,
      testKey,
      requestBody,
      async (tx, token) => {
        handlerCalls++;
        return { statusCode: 200, payload: { message: "Unexpected" } };
      }
    );

    assert.strictEqual(handlerCalls, 1, "Handler must NOT be called for cached replay");
    assert.strictEqual(result2.isCached, true);
    assert.strictEqual(result2.statusCode, 202);
    assert.strictEqual(result2.payload.message, "Job accepted");

    // 3. Replay with same key but different payload: Must throw 409 IDEMPOTENCY_CONFLICT
    const differentBody = { topic: "Kafka Partitioning", wordCount: 4000 };
    await assert.rejects(
      async () => {
        await processWithIdempotency(
          testUserId,
          testKey,
          differentBody,
          async () => ({ statusCode: 200, payload: {} })
        );
      },
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.errorCode, "IDEMPOTENCY_CONFLICT");
        return true;
      }
    );

    // 4. Failure handling transition
    const failKey = `test-fail-key-${Date.now()}`;
    await assert.rejects(
      async () => {
        await processWithIdempotency(
          testUserId,
          failKey,
          requestBody,
          async () => {
            throw new Error("Simulated business error in handler");
          }
        );
      },
      (err) => {
        assert.strictEqual(err.message, "Simulated business error in handler");
        return true;
      }
    );

    // Verify record transitioned to FAILED in the database
    const failedRecord = await prisma.idempotencyRecord.findUnique({
      where: { userId_key: { userId: testUserId, key: failKey } },
    });
    assert.ok(failedRecord);
    assert.strictEqual(failedRecord.status, "FAILED");

  } finally {
    // Cleanup created test records
    await prisma.idempotencyRecord.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.user.delete({
      where: { id: testUserId },
    }).catch(() => {});
  }
});
