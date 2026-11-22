import crypto from "crypto";
import prisma from "@/lib/prisma";

export interface ApiKeyVerificationResult {
  isValid: boolean;
  apiKeyId?: string;
  userId?: string;
  scopes?: string[];
  error?: "MISSING_HEADER" | "INVALID_FORMAT" | "KEY_NOT_FOUND" | "KEY_REVOKED" | "KEY_EXPIRED" | "INSUFFICIENT_SCOPE";
}

/**
 * Computes SHA-256 hash of a plaintext API key for constant-time comparison against keyHash in DB.
 */
export function hashApiKey(plaintextKey: string): string {
  return crypto.createHash("sha256").update(plaintextKey).digest("hex");
}

/**
 * Generates a new cryptographically secure API key.
 * Format: ds_live_<32 hex chars>
 */
export function generateApiKey(): { plaintextKey: string; keyPrefix: string; keyHash: string } {
  const randomHex = crypto.randomBytes(16).toString("hex");
  const plaintextKey = `ds_live_${randomHex}`;
  const keyPrefix = plaintextKey.slice(0, 16); // e.g. "ds_live_7c41e9b2"
  const keyHash = hashApiKey(plaintextKey);

  return { plaintextKey, keyPrefix, keyHash };
}

/**
 * Validates an Authorization header containing Bearer ds_live_xxx,
 * checks database record, expiration, active state, and requested scope.
 */
export async function authenticateApiKey(
  authHeader: string | null | undefined,
  requiredScope?: string
): Promise<ApiKeyVerificationResult> {
  if (!authHeader) {
    return { isValid: false, error: "MISSING_HEADER" };
  }

  const parts = authHeader.trim().split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return { isValid: false, error: "INVALID_FORMAT" };
  }

  const plaintextKey = parts[1];
  if (!plaintextKey.startsWith("ds_live_")) {
    return { isValid: false, error: "INVALID_FORMAT" };
  }

  const keyHash = hashApiKey(plaintextKey);

  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      userId: true,
      isActive: true,
      expiresAt: true,
      scopes: true,
    },
  });

  if (!apiKeyRecord) {
    return { isValid: false, error: "KEY_NOT_FOUND" };
  }

  if (!apiKeyRecord.isActive) {
    return { isValid: false, error: "KEY_REVOKED" };
  }

  if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
    return { isValid: false, error: "KEY_EXPIRED" };
  }

  if (requiredScope && !apiKeyRecord.scopes.includes(requiredScope)) {
    return { isValid: false, error: "INSUFFICIENT_SCOPE" };
  }

  // Update lastUsedAt & requestCount asynchronously (non-blocking)
  prisma.apiKey
    .update({
      where: { id: apiKeyRecord.id },
      data: {
        lastUsedAt: new Date(),
        requestCount: { increment: 1 },
      },
    })
    .catch((err) => console.error("Failed to update API key lastUsedAt:", err));

  return {
    isValid: true,
    apiKeyId: apiKeyRecord.id,
    userId: apiKeyRecord.userId,
    scopes: apiKeyRecord.scopes,
  };
}
