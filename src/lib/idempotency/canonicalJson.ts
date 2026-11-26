import crypto from "crypto";

/**
 * Deterministic deep canonical JSON serializer.
 * - Recursively sorts object keys lexicographically.
 * - Preserves array element order.
 * - Rejects non-serializable top-level values (undefined, functions, symbols).
 * - Produces deterministic SHA-256 hash across semantically identical JSON payloads.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new Error("CANONICAL_JSON_ERROR: Value is not serializable JSON (undefined, function, or symbol).");
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const serializedElements = value.map((element) => canonicalJsonStringify(element));
    return `[${serializedElements.join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const serializedEntries: string[] = [];

  for (const key of sortedKeys) {
    const val = obj[key];
    // Skip undefined or function values inside objects, consistent with JSON.stringify
    if (val === undefined || typeof val === "function" || typeof val === "symbol") {
      continue;
    }
    const serializedVal = canonicalJsonStringify(val);
    serializedEntries.push(`${JSON.stringify(key)}:${serializedVal}`);
  }

  return `{${serializedEntries.join(",")}}`;
}

/**
 * Computes a deterministic SHA-256 hash of a request payload using deep canonical JSON serialization.
 */
export function computeCanonicalRequestHash(payload: unknown): string {
  const canonicalString = canonicalJsonStringify(payload);
  return crypto.createHash("sha256").update(canonicalString, "utf8").digest("hex");
}
