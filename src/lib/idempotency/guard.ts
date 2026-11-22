import prisma from "@/lib/prisma";
import crypto from "crypto";
import { canonicalJsonStringify } from "./canonicalJson";
import { ApiError } from "../api/error";
import { Prisma } from "@prisma/client";

export type PrismaTransaction = Prisma.TransactionClient;

export interface IdempotencyResult<T> {
  isCached: boolean;
  statusCode: number;
  payload: T;
}

/**
 * Concurrency-safe, fenced idempotency guard implementation.
 * - Deterministic deep canonical JSON serialization.
 * - Atomic reservation lease acquisition (90-second lease with unique UUID ownership token).
 * - Rollback on lost or expired ownership token via clock_timestamp().
 * - Reclaims expired or failed leases.
 */
export async function processWithIdempotency<T>(
  userId: string,
  key: string,
  rawBody: unknown,
  handler: (tx: PrismaTransaction, ownershipToken: string) => Promise<{ statusCode: number; payload: T }>
): Promise<IdempotencyResult<T>> {
  // 1. Deep canonical serialization and hashing
  const canonicalString = canonicalJsonStringify(rawBody);
  const requestHash = crypto.createHash("sha256").update(canonicalString).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hr retention TTL
  const ownershipToken = crypto.randomUUID(); // Fresh fencing token for this lease

  // 2. Atomic reservation lease acquisition (90-second lease with new ownership token)
  const reservationResult = await prisma.$executeRaw`
    INSERT INTO idempotency_records (
      id, user_id, key, request_hash, ownership_token, status, lease_expires_at, expires_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${userId}::uuid, ${key}, ${requestHash}, ${ownershipToken}::uuid, 'IN_PROGRESS', NOW() + INTERVAL '90 seconds', ${expiresAt}, NOW(), NOW()
    )
    ON CONFLICT (user_id, key) DO UPDATE
      SET status = 'IN_PROGRESS',
          request_hash = EXCLUDED.request_hash,
          ownership_token = EXCLUDED.ownership_token,
          lease_expires_at = EXCLUDED.lease_expires_at,
          expires_at = EXCLUDED.expires_at,
          status_code = NULL,
          response_body = NULL,
          updated_at = NOW()
      WHERE idempotency_records.expires_at < NOW()
         OR (idempotency_records.status = 'FAILED' AND idempotency_records.request_hash = EXCLUDED.request_hash)
         OR (idempotency_records.status = 'IN_PROGRESS' AND idempotency_records.lease_expires_at < NOW() AND idempotency_records.request_hash = EXCLUDED.request_hash)
  `;

  if (reservationResult === 0) {
    // Reservation was NOT acquired -> Inspect existing active record
    const existing = await prisma.idempotencyRecord.findUnique({
      where: { userId_key: { userId, key } },
    });

    if (!existing) {
      throw new ApiError(500, "CONCURRENCY_ERROR", "Unexpected state conflict during idempotency lookup.");
    }

    // Condition 1: Hash mismatch on same key -> 409 Conflict
    if (existing.requestHash !== requestHash) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key reused with different request payload.");
    }

    // Condition 2: Active IN_PROGRESS lease held by another worker
    if (existing.status === "IN_PROGRESS" && existing.leaseExpiresAt >= new Date()) {
      throw new ApiError(409, "CONCURRENT_REQUEST_IN_PROGRESS", "An identical request is currently being processed. Retry shortly.");
    }

    // Condition 3: Completed prior execution -> Return cached response
    if (existing.status === "COMPLETED" && existing.statusCode && existing.responseBody) {
      return {
        isCached: true,
        statusCode: existing.statusCode,
        payload: existing.responseBody as T,
      };
    }

    throw new ApiError(409, "IDEMPOTENCY_LOCKED", "Idempotency key is currently locked. Retry shortly.");
  }

  // 3. Reservation Acquired -> Execute business handler in atomic database transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      const handlerResult = await handler(tx, ownershipToken);

      // Fenced Completion Update: Verify that ownershipToken STILL matches AND lease has not expired using wall-clock time!
      const rowsUpdated = await tx.$executeRaw`
        UPDATE idempotency_records
        SET status = 'COMPLETED',
            status_code = ${handlerResult.statusCode},
            response_body = ${JSON.stringify(handlerResult.payload)}::jsonb,
            updated_at = clock_timestamp()
        WHERE user_id = ${userId}::uuid
          AND key = ${key}
          AND ownership_token = ${ownershipToken}::uuid
          AND lease_expires_at > clock_timestamp()
      `;

      if (rowsUpdated === 0) {
        // Ownership was lost or lease expired prior to commit -> Roll back entire transaction
        throw new ApiError(409, "LEASE_EXPIRED_OR_LOST", "Reservation lease expired or was claimed by another worker. Rolling back.");
      }

      return handlerResult;
    });

    return { isCached: false, statusCode: result.statusCode, payload: result.payload };
  } catch (error) {
    // Conditional Failure Transition: Only transition to FAILED if WE still hold the ownership token AND lease has not expired
    await prisma.$executeRaw`
      UPDATE idempotency_records
      SET status = 'FAILED',
          updated_at = clock_timestamp()
      WHERE user_id = ${userId}::uuid
        AND key = ${key}
        AND ownership_token = ${ownershipToken}::uuid
        AND lease_expires_at > clock_timestamp()
    `.catch(() => {});

    throw error;
  }
}
