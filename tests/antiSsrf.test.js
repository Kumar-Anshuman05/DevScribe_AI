const test = require("node:test");
const assert = require("node:assert");

function isPrivateOrReservedIp(ip) {
  if (ip.includes(".")) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;
    if (parts[0] === 127) return true; // Loopback
    if (parts[0] === 10) return true; // RFC 1918 Private
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // RFC 1918 Private
    if (parts[0] === 192 && parts[1] === 168) return true; // RFC 1918 Private
    if (parts[0] === 169 && parts[1] === 254) return true; // Cloud Metadata
    if (parts[0] === 0 || parts[0] === 255) return true;
  }
  if (ip.includes(":")) {
    const norm = ip.toLowerCase();
    if (norm === "::1" || norm === "::") return true;
    if (norm.startsWith("fe80:") || norm.startsWith("fc00:") || norm.startsWith("fd00:")) return true;
  }
  return false;
}

test("Anti-SSRF: Blocks loopback and private subnets", () => {
  assert.strictEqual(isPrivateOrReservedIp("127.0.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("10.0.1.5"), true);
  assert.strictEqual(isPrivateOrReservedIp("192.168.1.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("172.20.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("169.254.169.254"), true); // AWS/GCP Metadata
  assert.strictEqual(isPrivateOrReservedIp("::1"), true);
});

test("Anti-SSRF: Permits legitimate public Internet IP addresses", () => {
  assert.strictEqual(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.strictEqual(isPrivateOrReservedIp("104.244.42.1"), false);
  assert.strictEqual(isPrivateOrReservedIp("140.82.121.4"), false); // GitHub
});
