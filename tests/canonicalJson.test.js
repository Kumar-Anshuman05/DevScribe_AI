const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

// Deep canonical JSON serializer
function canonicalJsonStringify(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
      throw new Error("Payload contains non-serializable value");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const serializedElements = value.map((element) => canonicalJsonStringify(element));
    return `[${serializedElements.join(",")}]`;
  }

  const obj = value;
  const sortedKeys = Object.keys(obj).sort();
  const serializedEntries = [];

  for (const key of sortedKeys) {
    const val = obj[key];
    if (val === undefined || typeof val === "function" || typeof val === "symbol") {
      continue;
    }
    const serializedVal = canonicalJsonStringify(val);
    serializedEntries.push(`${JSON.stringify(key)}:${serializedVal}`);
  }

  return `{${serializedEntries.join(",")}}`;
}

function computeCanonicalRequestHash(payload) {
  const canonicalString = canonicalJsonStringify(payload);
  return crypto.createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

test("Canonical JSON: Identical hash for scrambled key order", () => {
  const payloadA = {
    topic: "Distributed Systems",
    targetWordCount: 2500,
    options: { b: 2, a: 1, nested: { y: 20, x: 10 } },
    tags: ["system", "backend"],
  };

  const payloadB = {
    tags: ["system", "backend"],
    options: { nested: { x: 10, y: 20 }, a: 1, b: 2 },
    topic: "Distributed Systems",
    targetWordCount: 2500,
  };

  const strA = canonicalJsonStringify(payloadA);
  const strB = canonicalJsonStringify(payloadB);

  assert.strictEqual(strA, strB);
  assert.strictEqual(computeCanonicalRequestHash(payloadA), computeCanonicalRequestHash(payloadB));
});

test("Canonical JSON: Preserves array ordering", () => {
  const arr1 = { items: [1, 2, 3] };
  const arr2 = { items: [3, 2, 1] };

  assert.notStrictEqual(canonicalJsonStringify(arr1), canonicalJsonStringify(arr2));
  assert.notStrictEqual(computeCanonicalRequestHash(arr1), computeCanonicalRequestHash(arr2));
});

test("Canonical JSON: Rejects undefined and function values", () => {
  assert.throws(() => {
    canonicalJsonStringify(undefined);
  });
});
