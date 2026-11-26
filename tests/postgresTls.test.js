const test = require("node:test");
const assert = require("node:assert");

// Import actual production PostgreSQL SSL configuration resolver directly from src/lib/agents/checkpointer
let getPoolSslConfig;

test.before(async () => {
  const mod = await import("@/lib/agents/checkpointer");
  getPoolSslConfig = mod.getPoolSslConfig;
});

test("PostgreSQL TLS (Production Module): Production strictly requires rejectUnauthorized: true", () => {
  const prodConfig = getPoolSslConfig({ NODE_ENV: "production" });
  assert.strictEqual(typeof prodConfig, "object");
  assert.strictEqual(prodConfig.rejectUnauthorized, true);
});

test("PostgreSQL TLS (Production Module): Production never permits rejectUnauthorized: false", () => {
  // Even if an insecure override is attempted in production, it must still enforce true
  const prodConfig = getPoolSslConfig({
    NODE_ENV: "production",
    DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
  });
  assert.strictEqual(prodConfig.rejectUnauthorized, true);
});

test("PostgreSQL TLS (Production Module): Production passes custom CA certificate when provided", () => {
  const customCa = "-----BEGIN CERTIFICATE-----\nMIIC...MOCK_CA\n-----END CERTIFICATE-----";
  const prodConfig = getPoolSslConfig({
    NODE_ENV: "production",
    DATABASE_SSL_CERT: customCa,
  });
  assert.strictEqual(prodConfig.rejectUnauthorized, true);
  assert.strictEqual(prodConfig.ca, customCa);
});

test("PostgreSQL TLS (Production Module): Local development defaults to explicit plain connection", () => {
  const devConfig = getPoolSslConfig({ NODE_ENV: "development" });
  assert.strictEqual(devConfig, false);
});
