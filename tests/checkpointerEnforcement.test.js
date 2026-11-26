const test = require("node:test");
const assert = require("node:assert");

// Import actual production checkpointer directly from src/lib/agents/checkpointer
let getSafeCheckpointer;

test.before(async () => {
  const mod = await import("@/lib/agents/checkpointer");
  getSafeCheckpointer = mod.getSafeCheckpointer;
});

test("Checkpointer Enforcement (Production Module): Throws CHECKPOINTER_CONFIGURATION_ERROR when DB connection is absent", async () => {
  // Save original env
  const origCheckpointer = process.env.CHECKPOINTER_DATABASE_URL;
  const origDirect = process.env.DIRECT_URL;
  const origDb = process.env.DATABASE_URL;

  delete process.env.CHECKPOINTER_DATABASE_URL;
  delete process.env.DIRECT_URL;
  delete process.env.DATABASE_URL;

  try {
    await assert.rejects(
      async () => {
        await getSafeCheckpointer();
      },
      {
        name: "Error",
        message: /CHECKPOINTER_CONFIGURATION_ERROR.*Durable PostgreSQL checkpointer connection string is missing/,
      }
    );
  } finally {
    // Restore env
    if (origCheckpointer) process.env.CHECKPOINTER_DATABASE_URL = origCheckpointer;
    if (origDirect) process.env.DIRECT_URL = origDirect;
    if (origDb) process.env.DATABASE_URL = origDb;
  }
});
