const test = require("node:test");
const assert = require("node:assert");

// Import actual production IP validator directly from src/lib/webhooks/httpClient
let isPrivateOrReservedIp;

test.before(async () => {
  const mod = await import("@/lib/webhooks/httpClient");
  isPrivateOrReservedIp = mod.isPrivateOrReservedIp;
});

test("Anti-SSRF (Production Module): Blocks loopback and private subnets", () => {
  assert.strictEqual(isPrivateOrReservedIp("127.0.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("10.0.1.5"), true);
  assert.strictEqual(isPrivateOrReservedIp("192.168.1.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("172.20.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("169.254.169.254"), true); // AWS/GCP Metadata
  assert.strictEqual(isPrivateOrReservedIp("::1"), true);
});

test("Anti-SSRF (Production Module): Permits legitimate public Internet IP addresses", () => {
  assert.strictEqual(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.strictEqual(isPrivateOrReservedIp("104.244.42.1"), false);
  assert.strictEqual(isPrivateOrReservedIp("140.82.121.4"), false); // GitHub
});
