import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM

/**
 * Returns encryption master key buffer derived from WEBHOOK_ENCRYPTION_KEY.
 */
function getMasterKey(): Buffer {
  const hexKey = process.env.WEBHOOK_ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  return Buffer.from(hexKey, "hex");
}

export interface EncryptedSecretPayload {
  ciphertext: string;
  iv: string;
  tag: string;
}

/**
 * Encrypts a webhook plaintext secret using AES-256-GCM.
 */
export function encryptWebhookSecret(plaintextSecret: string): EncryptedSecretPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);

  let encrypted = cipher.update(plaintextSecret, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag().toString("hex");

  return {
    ciphertext: encrypted,
    iv: iv.toString("hex"),
    tag,
  };
}

/**
 * Decrypts a stored webhook secret using AES-256-GCM.
 */
export function decryptWebhookSecret(payload: EncryptedSecretPayload): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getMasterKey(),
    Buffer.from(payload.iv, "hex")
  );

  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));

  let decrypted = decipher.update(payload.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Generates an HMAC-SHA256 signature for outbound webhooks:
 * Signature is computed over: `${timestamp}.${rawPayload}`
 */
export function signWebhookPayload(rawPayload: string, secret: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${rawPayload}`;
  const hexDigest = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return `sha256=${hexDigest}`;
}
