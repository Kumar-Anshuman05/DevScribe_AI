const test = require("node:test");
const assert = require("node:assert");

// Import actual production canonical JSON serializer directly from src/lib/idempotency/canonicalJson
let canonicalJsonStringify;
let computeCanonicalRequestHash;

test.before(async () => {
  const mod = await import("@/lib/idempotency/canonicalJson");
  canonicalJsonStringify = mod.canonicalJsonStringify;
  computeCanonicalRequestHash = mod.computeCanonicalRequestHash;
});

test("Canonical JSON (Production Module): Identical hash for scrambled key order", () => {
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

test("Canonical JSON (Production Module): Preserves array ordering", () => {
  const arr1 = { items: [1, 2, 3] };
  const arr2 = { items: [3, 2, 1] };

  assert.notStrictEqual(canonicalJsonStringify(arr1), canonicalJsonStringify(arr2));
  assert.notStrictEqual(computeCanonicalRequestHash(arr1), computeCanonicalRequestHash(arr2));
});

test("Canonical JSON (Production Module): Rejects undefined and non-serializable values", () => {
  assert.throws(() => {
    canonicalJsonStringify(undefined);
  });
  assert.throws(() => {
    canonicalJsonStringify(() => {});
  });
});
