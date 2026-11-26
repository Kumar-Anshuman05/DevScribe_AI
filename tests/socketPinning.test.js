const test = require("node:test");
const assert = require("node:assert");

// Import actual production functions directly from src/lib/webhooks/httpClient
let isPrivateOrReservedIp;
let validateAllResolvedIps;
let createPinnedLookup;

test.before(async () => {
  const mod = await import("@/lib/webhooks/httpClient");
  isPrivateOrReservedIp = mod.isPrivateOrReservedIp;
  validateAllResolvedIps = mod.validateAllResolvedIps;
  createPinnedLookup = mod.createPinnedLookup;
});

test("Multi-Address DNS Validation (Production Module): Rejects mixed public and private A records", () => {
  const mixedRecords = [
    { address: "93.184.216.34", family: 4 }, // Public (example.com)
    { address: "127.0.0.1", family: 4 },     // Prohibited Loopback
  ];

  const result = validateAllResolvedIps(mixedRecords);
  assert.strictEqual(result.isValid, false);
  assert.strictEqual(result.blockedIp, "127.0.0.1");
});

test("Multi-Address DNS Validation (Production Module): Rejects dual-stack with public IPv4 and loopback/metadata", () => {
  const dualStackAttacker = [
    { address: "104.244.42.1", family: 4 }, // Public IPv4
    { address: "::1", family: 6 },          // Prohibited IPv6 Loopback
  ];

  const result1 = validateAllResolvedIps(dualStackAttacker);
  assert.strictEqual(result1.isValid, false);
  assert.strictEqual(result1.blockedIp, "::1");

  const metadataAttack = [
    { address: "104.244.42.1", family: 4 },
    { address: "169.254.169.254", family: 4 }, // Cloud Metadata
  ];
  const result2 = validateAllResolvedIps(metadataAttack);
  assert.strictEqual(result2.isValid, false);
  assert.strictEqual(result2.blockedIp, "169.254.169.254");
});

test("Multi-Address DNS Validation (Production Module): Permits multiple legitimate public addresses", () => {
  const publicRecords = [
    { address: "140.82.121.3", family: 4 },
    { address: "140.82.121.4", family: 4 },
    { address: "2607:f8b0:4005:805::200e", family: 6 },
  ];

  const result = validateAllResolvedIps(publicRecords);
  assert.strictEqual(result.isValid, true);
  assert.strictEqual(result.blockedIp, undefined);
});

test("Socket Pinning (Production Module): Custom lookup pins to resolved IP and prevents DNS rebinding", (t, done) => {
  const targetIp = "93.184.216.34";
  const pinnedLookup = createPinnedLookup(targetIp);

  // When Node HTTP/HTTPS calls lookup, it receives the pinned IP without querying DNS
  pinnedLookup("attacker-rebinding-domain.com", {}, (err, address, family) => {
    assert.strictEqual(err, null);
    assert.strictEqual(address, targetIp);
    assert.strictEqual(family, 4);
    done();
  });
});

test("Socket Pinning (Production Module): Custom lookup handles IPv6 and options.all correctly", (t, done) => {
  const targetIpv6 = "2607:f8b0:4005:805::200e";
  const pinnedLookup = createPinnedLookup(targetIpv6);

  pinnedLookup("example.com", { all: true }, (err, addresses) => {
    assert.strictEqual(err, null);
    assert.strictEqual(Array.isArray(addresses), true);
    assert.strictEqual(addresses[0].address, targetIpv6);
    assert.strictEqual(addresses[0].family, 6);
    done();
  });
});

test("Anti-SSRF Denylist (Production Module): Comprehensive IPv4 coverage", () => {
  // Loopback
  assert.strictEqual(isPrivateOrReservedIp("127.0.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("127.255.255.255"), true);

  // RFC 1918 Private subnets
  assert.strictEqual(isPrivateOrReservedIp("10.0.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("10.255.255.255"), true);
  assert.strictEqual(isPrivateOrReservedIp("172.16.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("172.31.255.255"), true);
  assert.strictEqual(isPrivateOrReservedIp("192.168.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("192.168.255.255"), true);

  // Cloud metadata & Link-local (RFC 3927)
  assert.strictEqual(isPrivateOrReservedIp("169.254.169.254"), true);
  assert.strictEqual(isPrivateOrReservedIp("169.254.1.1"), true);

  // Carrier-Grade NAT (RFC 6598)
  assert.strictEqual(isPrivateOrReservedIp("100.64.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("100.127.255.255"), true);

  // Unroutable / Multicast / Broadcast
  assert.strictEqual(isPrivateOrReservedIp("0.0.0.0"), true);
  assert.strictEqual(isPrivateOrReservedIp("224.0.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("239.255.255.255"), true);
  assert.strictEqual(isPrivateOrReservedIp("240.0.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("255.255.255.255"), true);

  // Valid public IPs allowed
  assert.strictEqual(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.strictEqual(isPrivateOrReservedIp("1.1.1.1"), false);
  assert.strictEqual(isPrivateOrReservedIp("140.82.121.4"), false);
});

test("Anti-SSRF Denylist (Production Module): Comprehensive IPv6 coverage", () => {
  // Loopback and unspecified
  assert.strictEqual(isPrivateOrReservedIp("::1"), true);
  assert.strictEqual(isPrivateOrReservedIp("::"), true);

  // Unique Local (fc00::/7)
  assert.strictEqual(isPrivateOrReservedIp("fc00::1"), true);
  assert.strictEqual(isPrivateOrReservedIp("fd12:3456:789a::1"), true);

  // Link-Local (fe80::/10)
  assert.strictEqual(isPrivateOrReservedIp("fe80::1"), true);
  assert.strictEqual(isPrivateOrReservedIp("febf::ffff"), true);

  // Multicast (ff00::/8)
  assert.strictEqual(isPrivateOrReservedIp("ff02::1"), true);

  // IPv4-mapped IPv6 pointing to private/loopback/metadata
  assert.strictEqual(isPrivateOrReservedIp("::ffff:127.0.0.1"), true);
  assert.strictEqual(isPrivateOrReservedIp("::ffff:169.254.169.254"), true);
  assert.strictEqual(isPrivateOrReservedIp("::ffff:10.0.0.1"), true);

  // IPv4-mapped IPv6 pointing to public IP
  assert.strictEqual(isPrivateOrReservedIp("::ffff:8.8.8.8"), false);

  // Valid public IPv6
  assert.strictEqual(isPrivateOrReservedIp("2607:f8b0:4005:805::200e"), false);
});
