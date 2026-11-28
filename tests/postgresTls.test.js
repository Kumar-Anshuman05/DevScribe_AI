const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const tls = require("node:tls");

// Import actual production PostgreSQL SSL configuration resolver directly from src/lib/agents/checkpointer
let getPoolSslConfig;
let sanitizeConnectionStringSslParams;
let SUPABASE_ROOT_2021_CA;

test.before(async () => {
  const mod = await import("@/lib/agents/checkpointer");
  getPoolSslConfig = mod.getPoolSslConfig;
  sanitizeConnectionStringSslParams = mod.sanitizeConnectionStringSslParams;
  SUPABASE_ROOT_2021_CA = mod.SUPABASE_ROOT_2021_CA;
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

test("PostgreSQL TLS (Production Module): Production preserves Node.js root CAs and includes verified Supabase Root 2021 CA", () => {
  const prodConfig = getPoolSslConfig({ NODE_ENV: "production" });
  assert.strictEqual(prodConfig.rejectUnauthorized, true);
  assert.ok(Array.isArray(prodConfig.ca));
  assert.ok(prodConfig.ca.includes(SUPABASE_ROOT_2021_CA));

  for (const rootCa of tls.rootCertificates) {
    assert.ok(prodConfig.ca.includes(rootCa));
  }

  const x509 = new crypto.X509Certificate(SUPABASE_ROOT_2021_CA);
  assert.strictEqual(
    x509.fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA"
  );
});

test("PostgreSQL TLS (Production Module): Production normalizes escaped newlines in DATABASE_SSL_CERT and preserves root CAs", () => {
  const escapedCa = "-----BEGIN CERTIFICATE-----\\nMIIC...MOCK_CA\\n-----END CERTIFICATE-----";
  const expectedCa = "-----BEGIN CERTIFICATE-----\nMIIC...MOCK_CA\n-----END CERTIFICATE-----";
  const prodConfig = getPoolSslConfig({
    NODE_ENV: "production",
    DATABASE_SSL_CERT: escapedCa,
  });
  assert.strictEqual(prodConfig.rejectUnauthorized, true);
  assert.ok(Array.isArray(prodConfig.ca));
  assert.ok(prodConfig.ca.includes(expectedCa));
  assert.ok(prodConfig.ca.includes(SUPABASE_ROOT_2021_CA));
  assert.ok(prodConfig.ca.includes(tls.rootCertificates[0]));
});

test("PostgreSQL TLS (Production Module): Strips sslmode and sslrootcert URL parameters so explicit SSL config is preserved", () => {
  const raw =
    "postgresql://postgres:secret@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require&sslrootcert=prod-ca-2021.crt&application_name=devscribe";
  const sanitized = sanitizeConnectionStringSslParams(raw);
  const parsed = new URL(sanitized);

  assert.strictEqual(parsed.searchParams.has("sslmode"), false);
  assert.strictEqual(parsed.searchParams.has("sslrootcert"), false);
  assert.strictEqual(parsed.searchParams.get("application_name"), "devscribe");
  assert.strictEqual(parsed.hostname, "aws-0-ap-southeast-2.pooler.supabase.com");
  assert.strictEqual(parsed.port, "5432");
});

test("PostgreSQL TLS (Production Module): Local development defaults to explicit plain connection", () => {
  const devConfig = getPoolSslConfig({ NODE_ENV: "development" });
  assert.strictEqual(devConfig, false);
});
