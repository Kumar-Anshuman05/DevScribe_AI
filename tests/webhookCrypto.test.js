const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function encryptSecret(plaintext, keyHex) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(keyHex, "hex"), iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return { ciphertext: encrypted, iv: iv.toString("hex"), tag };
}

function decryptSecret(payload, keyHex) {
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(keyHex, "hex"), Buffer.from(payload.iv, "hex"));
  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
  let decrypted = decipher.update(payload.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function signWebhook(payload, secret, timestamp) {
  const signed = `${timestamp}.${payload}`;
  const hex = crypto.createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  return `sha256=${hex}`;
}

function verifyWebhook(rawPayload, signatureHeader, timestampHeader, secret) {
  if (!signatureHeader || !/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) {
    return { isValid: false, error: "INVALID_FORMAT" };
  }
  const signatureHex = signatureHeader.slice(7);
  const timestamp = parseInt(timestampHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return { isValid: false, error: "TIMESTAMP_EXPIRED" };
  }

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawPayload}`, "utf8").digest("hex");
  const sigBuf = Buffer.from(signatureHex, "hex");
  const expBuf = Buffer.from(expected, "hex");

  if (sigBuf.length !== expBuf.length) return { isValid: false, error: "MISMATCH" };
  const isValid = crypto.timingSafeEqual(sigBuf, expBuf);
  return { isValid };
}

test("Webhook Crypto: AES-256-GCM Encrypt & Decrypt Roundtrip", () => {
  const masterKey = crypto.randomBytes(32).toString("hex");
  const plaintext = "whsec_super_secret_webhook_signing_token_12345";

  const encrypted = encryptSecret(plaintext, masterKey);
  const decrypted = decryptSecret(encrypted, masterKey);

  assert.strictEqual(decrypted, plaintext);
  assert.notStrictEqual(encrypted.ciphertext, plaintext);
});

test("Webhook Crypto: Constant-Time HMAC Signature Verification", () => {
  const secret = "whsec_test_secret_abc";
  const payload = JSON.stringify({ event: "job.completed", jobId: "123" });
  const timestamp = Math.floor(Date.now() / 1000);

  const signature = signWebhook(payload, secret, timestamp);

  // Correct verification
  const result = verifyWebhook(payload, signature, timestamp.toString(), secret);
  assert.strictEqual(result.isValid, true);

  // Altered payload fails
  const tamperedResult = verifyWebhook(payload + "tampered", signature, timestamp.toString(), secret);
  assert.strictEqual(tamperedResult.isValid, false);

  // Timestamp out of 300s tolerance window fails
  const expiredTimestamp = (timestamp - 350).toString();
  const expiredSig = signWebhook(payload, secret, parseInt(expiredTimestamp, 10));
  const expiredResult = verifyWebhook(payload, expiredSig, expiredTimestamp, secret);
  assert.strictEqual(expiredResult.isValid, false);
  assert.strictEqual(expiredResult.error, "TIMESTAMP_EXPIRED");
});
