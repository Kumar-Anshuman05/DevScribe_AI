import crypto from "crypto";

export interface WebhookVerificationResult {
  isValid: boolean;
  error?: "INVALID_SIGNATURE_FORMAT" | "INVALID_TIMESTAMP_FORMAT" | "TIMESTAMP_OUT_OF_TOLERANCE" | "SIGNATURE_MISMATCH";
}

/**
 * Strict verification of incoming or simulated DevScribe AI webhook signatures.
 * Enforces:
 * 1. Strict regex match on sha256=<64 hex chars>
 * 2. 10-digit Unix timestamp within +/- 300-second window
 * 3. Constant-time comparison using crypto.timingSafeEqual
 */
export function verifyDevScribeWebhook(
  rawPayload: string,
  signatureHeader: string,
  timestampHeader: string,
  secret: string
): WebhookVerificationResult {
  // 1. Strict signature format validation
  if (!signatureHeader || !/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) {
    return { isValid: false, error: "INVALID_SIGNATURE_FORMAT" };
  }
  const signatureHex = signatureHeader.slice(7);

  // 2. Strict timestamp integer and tolerance validation
  if (!timestampHeader || !/^\d{10}$/.test(timestampHeader)) {
    return { isValid: false, error: "INVALID_TIMESTAMP_FORMAT" };
  }
  const timestamp = parseInt(timestampHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return { isValid: false, error: "TIMESTAMP_OUT_OF_TOLERANCE" };
  }

  // 3. Compute expected signature over timestamp + '.' + rawPayload
  const signedPayload = `${timestamp}.${rawPayload}`;
  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  // 4. Constant-time comparison
  const sigBuffer = Buffer.from(signatureHex, "hex");
  const expectedBuffer = Buffer.from(expectedHex, "hex");

  if (sigBuffer.length !== expectedBuffer.length) {
    return { isValid: false, error: "SIGNATURE_MISMATCH" };
  }

  const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  return { isValid, error: isValid ? undefined : "SIGNATURE_MISMATCH" };
}
