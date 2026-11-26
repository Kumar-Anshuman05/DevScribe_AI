const test = require("node:test");
const assert = require("node:assert");

// Import actual production webhook crypto functions directly from src/lib/webhooks/crypto
let encryptWebhookSecret;
let decryptWebhookSecret;
let signWebhookPayload;
let verifyWebhookSignature;

test.before(async () => {
  const mod = await import("@/lib/webhooks/crypto");
  encryptWebhookSecret = mod.encryptWebhookSecret;
  decryptWebhookSecret = mod.decryptWebhookSecret;
  signWebhookPayload = mod.signWebhookPayload;
  verifyWebhookSignature = mod.verifyWebhookSignature;
});

test("Webhook Crypto (Production Module): AES-256-GCM Encrypt & Decrypt Roundtrip", () => {
  const plaintext = "whsec_super_secret_webhook_signing_token_12345";

  const encrypted = encryptWebhookSecret(plaintext);
  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.iv);
  assert.ok(encrypted.tag);
  assert.notStrictEqual(encrypted.ciphertext, plaintext);

  const decrypted = decryptWebhookSecret(encrypted);
  assert.strictEqual(decrypted, plaintext);
});

test("Webhook Crypto (Production Module): Constant-Time HMAC Signature Verification", () => {
  const secret = "whsec_test_secret_abc";
  const payload = JSON.stringify({ event: "job.completed", jobId: "123" });
  const timestamp = Math.floor(Date.now() / 1000);

  const signature = signWebhookPayload(payload, secret, timestamp);

  // Correct verification
  const result = verifyWebhookSignature(payload, signature, timestamp.toString(), secret);
  assert.strictEqual(result.isValid, true);
  assert.strictEqual(result.error, undefined);

  // Altered payload fails
  const tamperedResult = verifyWebhookSignature(payload + "tampered", signature, timestamp.toString(), secret);
  assert.strictEqual(tamperedResult.isValid, false);
  assert.strictEqual(tamperedResult.error, "SIGNATURE_MISMATCH");

  // Timestamp out of 300s tolerance window fails with TIMESTAMP_EXPIRED
  const expiredTimestamp = (timestamp - 350).toString();
  const expiredSig = signWebhookPayload(payload, secret, parseInt(expiredTimestamp, 10));
  const expiredResult = verifyWebhookSignature(payload, expiredSig, expiredTimestamp, secret);
  assert.strictEqual(expiredResult.isValid, false);
  assert.strictEqual(expiredResult.error, "TIMESTAMP_EXPIRED");
});
