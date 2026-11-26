import dns from "dns";
import http from "http";
import https from "https";
import { URL } from "url";
import { decryptWebhookSecret, signWebhookPayload } from "./crypto";

export interface SendWebhookHttpParams {
  url: string;
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
  nextSecretCiphertext?: string | null;
  nextSecretIv?: string | null;
  nextSecretTag?: string | null;
  deliveryId: string;
  eventType: string;
  payload: unknown;
}

export interface WebhookHttpResult {
  isSuccess: boolean;
  httpStatus?: number;
  responseBody?: string;
  errorMessage?: string;
}

/**
 * Checks if an IPv4 or IPv6 address belongs to private/internal/cloud-metadata networks.
 * Denylists:
 * - Loopback (127.0.0.0/8, ::1)
 * - RFC 1918 Private subnets (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - RFC 6598 Carrier-Grade NAT (100.64.0.0/10)
 * - RFC 3927 Link-local / Cloud Metadata (169.254.0.0/16, including 169.254.169.254)
 * - RFC 1122 Unroutable (0.0.0.0/8)
 * - RFC 5771 Multicast (224.0.0.0/4)
 * - RFC 1112 Reserved / Broadcast (240.0.0.0/4, 255.255.255.255)
 * - RFC 4193 Unique Local IPv6 (fc00::/7)
 * - RFC 4291 Link-Local IPv6 (fe80::/10)
 * - IPv6 Multicast (ff00::/8)
 * - IPv4-mapped IPv6 (::ffff:0:0/96, ::ffff:127.0.0.1, etc.)
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") {
    return true;
  }

  const trimmed = ip.trim();

  // Handle IPv4-mapped IPv6 (e.g. "::ffff:127.0.0.1" or "::ffff:7f00:1")
  if (trimmed.toLowerCase().startsWith("::ffff:")) {
    const v4Part = trimmed.slice(7);
    if (v4Part.includes(".")) {
      return isPrivateOrReservedIp(v4Part);
    }
  }

  // IPv4 checks
  if (trimmed.includes(".")) {
    const parts = trimmed.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    // Loopback (127.0.0.0/8)
    if (parts[0] === 127) return true;
    // Unroutable / "This host" (0.0.0.0/8)
    if (parts[0] === 0) return true;
    // Private (10.0.0.0/8)
    if (parts[0] === 10) return true;
    // Carrier-Grade NAT (100.64.0.0/10: 100.64.0.0 - 100.127.255.255)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // Link-local & Cloud Metadata (169.254.0.0/16, including 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // Private (172.16.0.0/12: 172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // IETF Protocol Assignments (192.0.0.0/24) & TEST-NET-1 (192.0.2.0/24)
    if (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)) return true;
    // Private (192.168.0.0/16)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // Benchmark testing (198.18.0.0/15: 198.18.0.0 - 198.19.255.255)
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // TEST-NET-2 (198.51.100.0/24)
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    // TEST-NET-3 (203.0.113.0/24)
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // Multicast (224.0.0.0/4: 224.0.0.0 - 239.255.255.255)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // Reserved / Broadcast (240.0.0.0/4)
    if (parts[0] >= 240) return true;
  }

  // IPv6 checks
  if (trimmed.includes(":")) {
    const normalized = trimmed.toLowerCase();
    // Unspecified (::)
    if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;
    // Loopback (::1)
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
    // Unique Local Address (fc00::/7: fc00:: - fdff:ffff:...)
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    // Link-Local Unicast (fe80::/10: fe80:: - febf:ffff:...)
    if (
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    ) {
      return true;
    }
    // Multicast (ff00::/8)
    if (normalized.startsWith("ff")) return true;
    // Discard prefix (100::/64)
    if (normalized.startsWith("100:")) return true;
    // Documentation prefix (2001:db8::/32)
    if (normalized.startsWith("2001:db8:") || normalized.startsWith("2001:0db8:")) return true;
  }

  return false;
}

/**
 * Validates every resolved A and AAAA address against the SSRF denylist.
 * Rejects the entire hostname if ANY resolved address is private, loopback, or metadata.
 */
export function validateAllResolvedIps(
  lookupResults: Array<{ address: string; family?: number }>,
  allowLocal = false
): { isValid: boolean; blockedIp?: string } {
  if (!lookupResults || lookupResults.length === 0) {
    return { isValid: false, blockedIp: "empty_records" };
  }

  if (allowLocal) {
    return { isValid: true };
  }

  for (const record of lookupResults) {
    if (isPrivateOrReservedIp(record.address)) {
      return { isValid: false, blockedIp: record.address };
    }
  }

  return { isValid: true };
}

/**
 * Creates a custom DNS lookup resolver that pins outgoing connections
 * to the pre-validated IP address, eliminating TOCTOU / DNS rebinding attacks.
 */
export function createPinnedLookup(resolvedIp: string) {
  const isIpv6 = resolvedIp.includes(":");
  const ipFamily = isIpv6 ? 6 : 4;

  return (
    _hostname: string,
    options: any,
    callback: (err: NodeJS.ErrnoException | null, address: string | any[], family?: number) => void
  ) => {
    const cb = typeof options === "function" ? options : callback;
    const isAll = typeof options === "object" && options !== null && options.all;

    if (isAll) {
      cb(null, [{ address: resolvedIp, family: ipFamily }]);
    } else {
      cb(null, resolvedIp, ipFamily);
    }
  };
}

/**
 * Dispatches an outbound webhook HTTP POST request with multi-address DNS validation,
 * socket pinning anti-SSRF protection, dual-secret rotation headers, stable delivery ID,
 * 5s timeout, and 4KB body cap.
 */
export async function sendWebhookHttp(params: SendWebhookHttpParams): Promise<WebhookHttpResult> {
  const parsedUrl = new URL(params.url);

  // 1. Protocol validation
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return {
      isSuccess: false,
      errorMessage: `SSRF_VIOLATION: Unsupported protocol '${parsedUrl.protocol}'. Only http: and https: are allowed.`,
    };
  }

  // Enforce HTTPS in production
  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    return {
      isSuccess: false,
      errorMessage: "SSRF_VIOLATION: Webhook URLs must use HTTPS in production.",
    };
  }

  // 2. DNS Resolution & Multi-record validation (Anti-SSRF)
  let lookupResults: Array<{ address: string; family: number }>;
  try {
    const rawLookup = await dns.promises.lookup(parsedUrl.hostname, { all: true });
    lookupResults = Array.isArray(rawLookup) ? rawLookup : [rawLookup];
  } catch (err: any) {
    return {
      isSuccess: false,
      errorMessage: `DNS_RESOLUTION_FAILED: Unable to resolve hostname '${parsedUrl.hostname}': ${err.message}`,
    };
  }

  if (!lookupResults || lookupResults.length === 0) {
    return {
      isSuccess: false,
      errorMessage: `DNS_RESOLUTION_FAILED: No DNS A/AAAA records returned for hostname '${parsedUrl.hostname}'.`,
    };
  }

  // Reject the hostname if ANY resolved address is private, reserved, loopback, or metadata
  const allowLocal = process.env.ALLOW_LOCAL_WEBHOOKS === "true";
  const validation = validateAllResolvedIps(lookupResults, allowLocal);
  if (!validation.isValid) {
    return {
      isSuccess: false,
      errorMessage: `SSRF_BLOCKED: Hostname '${parsedUrl.hostname}' resolved to prohibited IP '${validation.blockedIp}' in a private, loopback, or metadata subnet.`,
    };
  }

  // Pin outgoing socket connection to the first pre-validated IP address
  const resolvedIp = lookupResults[0].address;

  // 3. Decrypt primary secret & compute signature
  const primarySecret = decryptWebhookSecret({
    ciphertext: params.secretCiphertext,
    iv: params.secretIv,
    tag: params.secretTag,
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify(params.payload);
  const primarySignature = signWebhookPayload(rawBody, primarySecret, timestamp);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(rawBody).toString(),
    "User-Agent": "DevScribe-Webhook-Dispatcher/1.0",
    "X-DevScribe-Timestamp": timestamp.toString(),
    "X-DevScribe-Delivery-Id": params.deliveryId, // Stable delivery ID
    "X-DevScribe-Event": params.eventType,
    "X-DevScribe-Signature": primarySignature,
  };

  // 4. If rotating nextSecret is present, compute and inject secondary header
  if (params.nextSecretCiphertext && params.nextSecretIv && params.nextSecretTag) {
    try {
      const nextSecret = decryptWebhookSecret({
        ciphertext: params.nextSecretCiphertext,
        iv: params.nextSecretIv,
        tag: params.nextSecretTag,
      });
      headers["X-DevScribe-Signature-Next"] = signWebhookPayload(rawBody, nextSecret, timestamp);
    } catch (err) {
      console.warn("Failed to decrypt secondary rotating secret, skipping header:", err);
    }
  }

  // 5. Send HTTP POST request with DNS socket pinning, 5,000ms timeout, and SNI preservation
  return new Promise<WebhookHttpResult>((resolve) => {
    const isHttps = parsedUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    const pinnedLookup = createPinnedLookup(resolvedIp);

    const requestOptions: https.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: "POST",
      headers,
      timeout: 5000, // 5-second connection & read timeout
      servername: parsedUrl.hostname, // Preserves SNI and TLS certificate hostname validation
      lookup: pinnedLookup as any, // Socket pinning to resolvedIp, preventing DNS rebinding TOCTOU
    };

    const req = transport.request(requestOptions, (res) => {
      let bodyData = "";
      res.setEncoding("utf8");

      res.on("data", (chunk) => {
        // Truncate to maximum 4,096 bytes (4KB) to prevent database bloat
        if (bodyData.length < 4096) {
          bodyData += chunk;
        }
      });

      res.on("end", () => {
        const httpStatus = res.statusCode || 0;
        const isSuccess = httpStatus >= 200 && httpStatus < 300;
        resolve({
          isSuccess,
          httpStatus,
          responseBody: bodyData.slice(0, 4096),
        });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        isSuccess: false,
        httpStatus: 504,
        errorMessage: "WEBHOOK_TIMEOUT: Destination server timed out after 5,000ms.",
      });
    });

    req.on("error", (err) => {
      resolve({
        isSuccess: false,
        errorMessage: `WEBHOOK_NETWORK_ERROR: ${err.message}`,
      });
    });

    req.write(rawBody);
    req.end();
  });
}
