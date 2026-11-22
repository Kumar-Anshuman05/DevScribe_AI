const test = require("node:test");
const assert = require("node:assert");

// Re-implement the exact logic from src/lib/webhooks/httpClient.ts for unit verification
function isPrivateOrReservedIp(ip) {
  if (!ip || typeof ip !== "string") return true;
  const trimmed = ip.trim();

  if (trimmed.toLowerCase().startsWith("::ffff:")) {
    const v4Part = trimmed.slice(7);
    if (v4Part.includes(".")) {
      return isPrivateOrReservedIp(v4Part);
    }
  }

  if (trimmed.includes(".")) {
    const parts = trimmed.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;
    if (parts[0] === 127) return true; // Loopback
    if (parts[0] === 0) return true; // Unroutable
    if (parts[0] === 10) return true; // RFC 1918 Private
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // RFC 6598 Carrier-Grade NAT
    if (parts[0] === 169 && parts[1] === 254) return true; // Link-local & Metadata
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // RFC 1918 Private
    if (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)) return true; // IETF & TEST-NET-1
    if (parts[0] === 192 && parts[1] === 168) return true; // RFC 1918 Private
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true; // Benchmark
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true; // TEST-NET-2
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true; // TEST-NET-3
    if (parts[0] >= 224 && parts[0] <= 239) return true; // Multicast
    if (parts[0] >= 240) return true; // Reserved / Broadcast
  }

  if (trimmed.includes(":")) {
    const normalized = trimmed.toLowerCase();
    if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // Unique Local
    if (
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    ) return true; // Link-Local
    if (normalized.startsWith("ff")) return true; // Multicast
    if (normalized.startsWith("100:")) return true; // Discard
    if (normalized.startsWith("2001:db8:") || normalized.startsWith("2001:0db8:")) return true; // Documentation
  }

  return false;
}

function createPinnedLookup(resolvedIp) {
  const isIpv6 = resolvedIp.includes(":");
  const ipFamily = isIpv6 ? 6 : 4;

  return (_hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const isAll = typeof options === "object" && options !== null && options.all;
    if (isAll) {
      cb(null, [{ address: resolvedIp, family: ipFamily }]);
    } else {
      cb(null, resolvedIp, ipFamily);
    }
  };
}

test("Socket Pinning: Custom lookup pins to resolved IP and prevents DNS rebinding", (t, done) => {
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

test("Socket Pinning: Custom lookup handles IPv6 and options.all correctly", (t, done) => {
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

test("Anti-SSRF Denylist: Comprehensive IPv4 coverage", () => {
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

test("Anti-SSRF Denylist: Comprehensive IPv6 coverage", () => {
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
