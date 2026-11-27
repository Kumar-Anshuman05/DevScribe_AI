import prisma from "@/lib/prisma";
import { type WebhookDelivery, WebhookDeliveryStatus } from "@prisma/client";
import { sendWebhookHttp } from "./httpClient";

/**
 * Dedicated Webhook Delivery Dispatcher (v4.3.3 Final Baseline)
 * - Exclusive subscription to 'job.completed' and 'job.failed' events.
 * - Delivery-level lease fencing with wall-clock checks (lease_expires_at > clock_timestamp()).
 * - Individual distinct UUID claimToken per claimed delivery.
 * - Final-attempt crash recovery (Stage 1b) to prevent stuck deliveries.
 * - Outbox rollup strictly isolated from Inngest 'job.created' events.
 */
export async function processPendingWebhookDeliveries(workerId: string): Promise<number> {
  // ---------------------------------------------------------------------------
  // Stage 1: Ingestion — Prepare WebhookDelivery rows for newly arrived OutboxEvents
  // ---------------------------------------------------------------------------
  // Strictly filter by eventType IN ('job.completed', 'job.failed') so Inngest
  // 'job.created' events are NEVER ingested into the webhook delivery pipeline.
  const pendingOutboxEvents = await prisma.outboxEvent.findMany({
    where: {
      status: "PENDING",
      eventType: { in: ["job.completed", "job.failed"] },
    },
    take: 10,
  });

  for (const event of pendingOutboxEvents) {
    const job = await prisma.generationJob.findUnique({
      where: { id: event.aggregateId },
      select: { userId: true },
    });
    if (!job) continue;

    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { userId: job.userId, isActive: true, eventTypes: { has: event.eventType } },
    });

    if (endpoints.length === 0) {
      // No endpoints subscribed -> Mark outbox event DISPATCHED immediately
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "DISPATCHED", dispatchedAt: new Date() },
      });
      continue;
    }

    // Insert delivery rows with stable deliveryId: ON CONFLICT DO NOTHING ensures
    // that re-evaluating an outbox event NEVER overwrites or resets existing delivery rows!
    for (const endpoint of endpoints) {
      await prisma.$executeRaw`
        INSERT INTO webhook_deliveries (
          "id", "deliveryId", "outboxEventId", "webhookId", "jobId", "eventType", "payload",
          "attemptCount", "maxAttempts", "status", "scheduledAt", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), gen_random_uuid(), ${event.id}::uuid, ${endpoint.id}::uuid,
          ${event.aggregateId}::uuid, ${event.eventType}, ${JSON.stringify(event.payload)}::jsonb,
          0, 3, 'PENDING', NOW(), NOW(), NOW()
        )
        ON CONFLICT ("outboxEventId", "webhookId") DO NOTHING
      `;
    }

    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSING" },
    });
  }

  // ---------------------------------------------------------------------------
  // Stage 1b: Final-Attempt Crash Recovery — Expired IN_FLIGHT with Exhausted Attempts
  // ---------------------------------------------------------------------------
  // If a worker crashes or times out while processing a delivery that has already
  // reached max_attempts, transition it to EXHAUSTED using clock_timestamp() so it
  // does not remain permanently stuck, allowing OutboxEvent to reach terminal FAILED.
  await prisma.$executeRaw`
    UPDATE webhook_deliveries
    SET "status" = 'EXHAUSTED'::"WebhookDeliveryStatus",
        "claimToken" = NULL,
        "lockedAt" = NULL,
        "lockedBy" = NULL,
        "leaseExpiresAt" = NULL,
        "errorMessage" = 'Worker crashed or timed out on final delivery attempt.',
        "updatedAt" = clock_timestamp()
    WHERE "status" = 'IN_FLIGHT'
      AND "leaseExpiresAt" < clock_timestamp()
      AND "attemptCount" >= "maxAttempts"
  `;

  // ---------------------------------------------------------------------------
  // Stage 2: Claim Deliveries — Atomic Delivery-Level Fencing (SKIP LOCKED)
  // ---------------------------------------------------------------------------
  // Rules enforced:
  // - NEVER claims SUCCESS or EXHAUSTED deliveries.
  // - Respects next_retry_at <= clock_timestamp().
  // - Reclaims expired IN_FLIGHT leases (status = 'IN_FLIGHT' AND lease_expires_at < clock_timestamp()).
  // - Enforces attempt_count < max_attempts BEFORE making any network call.
  // - Generates a distinct UUID claimToken per claimed delivery row using gen_random_uuid().
  // - Increments attempt_count atomically on claim.
  const claimedDeliveries = await prisma.$queryRaw<WebhookDelivery[]>`
    UPDATE webhook_deliveries
    SET "status" = 'IN_FLIGHT',
        "claimToken" = gen_random_uuid(),
        "lockedAt" = clock_timestamp(),
        "lockedBy" = ${workerId},
        "leaseExpiresAt" = clock_timestamp() + INTERVAL '45 seconds',
        "attemptCount" = "attemptCount" + 1,
        "attemptedAt" = clock_timestamp(),
        "updatedAt" = clock_timestamp()
    WHERE id IN (
      SELECT id FROM webhook_deliveries
      WHERE (
        "status" = 'PENDING'
        OR ("status" = 'FAILED_RETRYABLE' AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= clock_timestamp()))
        OR ("status" = 'IN_FLIGHT' AND "leaseExpiresAt" < clock_timestamp())
      )
      AND "attemptCount" < "maxAttempts"
      ORDER BY "scheduledAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 10
    )
    RETURNING *;
  `;

  let processedCount = 0;

  // ---------------------------------------------------------------------------
  // Stage 3: Outbound Network Request (STRICTLY OUTSIDE DATABASE TRANSACTION)
  // ---------------------------------------------------------------------------
  for (const delivery of claimedDeliveries) {
    processedCount++;
    const endpoint = await prisma.webhookEndpoint.findUnique({
      where: { id: delivery.webhookId },
    });

    if (!endpoint || !endpoint.isActive) {
      // Endpoint was deleted or disabled -> Mark terminal EXHAUSTED conditionally
      // with claim_token, locked_by, AND lease_expires_at > clock_timestamp()
      await prisma.$executeRaw`
        UPDATE webhook_deliveries
        SET "status" = 'EXHAUSTED'::"WebhookDeliveryStatus",
            "claimToken" = NULL,
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "leaseExpiresAt" = NULL,
            "updatedAt" = clock_timestamp()
        WHERE id = ${delivery.id}::uuid
          AND "claimToken" = ${delivery.claimToken}::uuid
          AND "lockedBy" = ${workerId}
          AND "leaseExpiresAt" > clock_timestamp()
      `;
      continue;
    }

    const dispatchResult = await sendWebhookHttp({
      url: endpoint.url,
      secretCiphertext: endpoint.secretCiphertext,
      secretIv: endpoint.secretIv,
      secretTag: endpoint.secretTag,
      nextSecretCiphertext: endpoint.nextSecretCiphertext,
      nextSecretIv: endpoint.nextSecretIv,
      nextSecretTag: endpoint.nextSecretTag,
      deliveryId: delivery.deliveryId, // Stable deliveryId preserved across retries
      eventType: delivery.eventType,
      payload: delivery.payload,
    });

    // ---------------------------------------------------------------------------
    // Stage 4: Fenced Result Acknowledgement (Conditional on claim_token, locked_by & lease expiry)
    // ---------------------------------------------------------------------------
    const isSuccess = dispatchResult.isSuccess;
    const isMaxAttempts = delivery.attemptCount >= delivery.maxAttempts;
    let newStatus: WebhookDeliveryStatus = "SUCCESS";
    let nextRetry: Date | null = null;

    if (!isSuccess) {
      if (isMaxAttempts) {
        newStatus = "EXHAUSTED"; // Terminal failure state
      } else {
        newStatus = "FAILED_RETRYABLE";
        // Exponential backoff: attempt 1 -> 60s, attempt 2 -> 300s
        const backoffSeconds = delivery.attemptCount === 1 ? 60 : 300;
        nextRetry = new Date(Date.now() + backoffSeconds * 1000);
      }
    }

    // Update conditional on our unique claim_token, worker ID, AND wall-clock lease validity.
    // If our lease expired (clock_timestamp() > lease_expires_at) or was reclaimed by another worker,
    // this update touches 0 rows, preventing an expired worker from recording late results.
    await prisma.$executeRaw`
      UPDATE webhook_deliveries
      SET "status" = ${newStatus}::"WebhookDeliveryStatus",
          "httpStatus" = ${dispatchResult.httpStatus},
          "responseBody" = ${dispatchResult.responseBody?.slice(0, 4096) || null},
          "errorMessage" = ${dispatchResult.errorMessage || null},
          "completedAt" = ${isSuccess ? new Date() : null},
          "nextRetryAt" = ${nextRetry},
          "claimToken" = NULL,
          "lockedAt" = NULL,
          "lockedBy" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = clock_timestamp()
      WHERE id = ${delivery.id}::uuid
        AND "claimToken" = ${delivery.claimToken}::uuid
        AND "lockedBy" = ${workerId}
        AND "leaseExpiresAt" > clock_timestamp()
    `;
  }

  // ---------------------------------------------------------------------------
  // Stage 5: Outbox Event Rollup Status (Strictly Scoped to Webhook Event Types)
  // ---------------------------------------------------------------------------
  // Evaluates parent OutboxEvents where all deliveries have reached a terminal state.
  // Explicitly filters on event_type IN ('job.completed', 'job.failed') so it can NEVER
  // modify or roll up Inngest 'job.created' outbox events!
  await prisma.$executeRaw`
    UPDATE outbox_events e
    SET "status" = CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM webhook_deliveries d
            WHERE d."outboxEventId" = e.id AND d."status" != 'SUCCESS'
          ) THEN 'DISPATCHED'::"OutboxStatus"
          ELSE 'FAILED'::"OutboxStatus"
        END,
        "dispatchedAt" = NOW()
    WHERE e."status" = 'PROCESSING'
      AND e."eventType" IN ('job.completed', 'job.failed')
      AND NOT EXISTS (
        SELECT 1 FROM webhook_deliveries d
        WHERE d."outboxEventId" = e.id
          AND d."status" IN ('PENDING', 'IN_FLIGHT', 'FAILED_RETRYABLE')
      )
  `;

  return processedCount;
}
