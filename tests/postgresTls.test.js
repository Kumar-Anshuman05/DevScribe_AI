const test = require("node:test");
const assert = require("node:assert");

function getPostgresSslConfig(env) {
  const isProduction = env.NODE_ENV === "production";

  if (isProduction) {
    // In production: strict TLS certificate validation is mandatory
    return {
      rejectUnauthorized: true,
      ...(env.DATABASE_SSL_CERT ? { ca: env.DATABASE_SSL_CERT } : {}),
    };
  }

  // Non-production explicit configuration
  if (env.DATABASE_SSL === "true" || env.DATABASE_SSL_CERT) {
    return {
      rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
      ...(env.DATABASE_SSL_CERT ? { ca: env.DATABASE_SSL_CERT } : {}),
    };
  }

  return false;
}

test("PostgreSQL TLS: Production strictly requires rejectUnauthorized: true", () => {
  const prodConfig = getPostgresSslConfig({ NODE_ENV: "production" });
  assert.strictEqual(typeof prodConfig, "object");
  assert.strictEqual(prodConfig.rejectUnauthorized, true);
});

test("PostgreSQL TLS: Production never permits rejectUnauthorized: false", () => {
  // Even if an insecure override is attempted in production, it must still enforce true
  const prodConfig = getPostgresSslConfig({
    NODE_ENV: "production",
    DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
  });
  assert.strictEqual(prodConfig.rejectUnauthorized, true);
});

test("PostgreSQL TLS: Production passes custom CA certificate when provided", () => {
  const customCa = "-----BEGIN CERTIFICATE-----\nMIIC...MOCK_CA\n-----END CERTIFICATE-----";
  const prodConfig = getPostgresSslConfig({
    NODE_ENV: "production",
    DATABASE_SSL_CERT: customCa,
  });
  assert.strictEqual(prodConfig.rejectUnauthorized, true);
  assert.strictEqual(prodConfig.ca, customCa);
});

test("PostgreSQL TLS: Local development defaults to explicit plain connection", () => {
  const devConfig = getPostgresSslConfig({ NODE_ENV: "development" });
  assert.strictEqual(devConfig, false);
});
