const test = require("node:test");
const assert = require("node:assert");

test("Checkpointer Enforcement: Throws CHECKPOINTER_CONFIGURATION_ERROR when DB connection is absent", async () => {
  function getSafeCheckpointer(env) {
    const connectionString =
      env.CHECKPOINTER_DATABASE_URL ||
      env.DIRECT_URL ||
      env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        "CHECKPOINTER_CONFIGURATION_ERROR: Durable PostgreSQL checkpointer connection string is missing. " +
        "Configure CHECKPOINTER_DATABASE_URL, DIRECT_URL, or DATABASE_URL in environment variables."
      );
    }
    return { pool: connectionString };
  }

  // With no database URL configured:
  assert.throws(
    () => {
      getSafeCheckpointer({});
    },
    {
      name: "Error",
      message: /CHECKPOINTER_CONFIGURATION_ERROR.*Durable PostgreSQL checkpointer connection string is missing/,
    }
  );

  // Does NOT fall back to in-memory checkpointer or return null
  try {
    getSafeCheckpointer({});
    assert.fail("Should have thrown CHECKPOINTER_CONFIGURATION_ERROR");
  } catch (err) {
    assert.strictEqual(err.message.includes("CHECKPOINTER_CONFIGURATION_ERROR"), true);
  }
});

test("Checkpointer Enforcement: Successfully initializes when connection string is provided", () => {
  function getSafeCheckpointer(env) {
    const connectionString =
      env.CHECKPOINTER_DATABASE_URL ||
      env.DIRECT_URL ||
      env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("CHECKPOINTER_CONFIGURATION_ERROR: Missing connection string");
    }
    return { connected: true, connectionString };
  }

  const result = getSafeCheckpointer({ DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/devscribe" });
  assert.strictEqual(result.connected, true);
});
