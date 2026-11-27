import prisma from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import type { OutboxEvent } from "@prisma/client";

/**
 * Inngest Outbox Dispatcher
 * Subscribes strictly to eventType = 'job.created'.
 * Enforces worker lease and wall-clock expiry check.
 */
export async function processPendingInngestEvents(workerId: string): Promise<number> {
  // Atomic claim of pending job.created events ONLY (SKIP LOCKED)
  const events = await prisma.$queryRaw<OutboxEvent[]>`
    UPDATE outbox_events
    SET "status" = 'PROCESSING',
        "lockedAt" = clock_timestamp(),
        "lockedBy" = ${workerId},
        "leaseExpiresAt" = clock_timestamp() + INTERVAL '60 seconds'
    WHERE id IN (
      SELECT id FROM outbox_events
      WHERE "status" = 'PENDING'
        AND "eventType" = 'job.created'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 10
    )
    RETURNING *;
  `;

  let dispatchedCount = 0;

  for (const event of events) {
    try {
      await inngest.send({
        name: "devscribe/job.created",
        id: event.aggregateId, // Inngest-level deduplication key
        data: (event.payload as any) || {},
      });

      // Fenced completion update: strictly scoped to job.created and valid lease
      const result = await prisma.$executeRaw`
        UPDATE outbox_events
        SET "status" = 'DISPATCHED',
            "dispatchedAt" = clock_timestamp(),
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "leaseExpiresAt" = NULL
        WHERE id = ${event.id}::uuid
          AND "eventType" = 'job.created'
          AND "lockedBy" = ${workerId}
          AND "leaseExpiresAt" > clock_timestamp()
      `;

      if (result > 0) {
        dispatchedCount++;
      }
    } catch (err: any) {
      console.error(`[Inngest Dispatcher] Error dispatching event ${event.id}:`, err);
      // Revert to PENDING on dispatch error for retry
      await prisma.$executeRaw`
        UPDATE outbox_events
        SET "status" = 'PENDING',
            "retryCount" = "retryCount" + 1,
            "errorMessage" = ${err.message || "Failed to dispatch to Inngest"},
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "leaseExpiresAt" = NULL
        WHERE id = ${event.id}::uuid
          AND "eventType" = 'job.created'
          AND "lockedBy" = ${workerId}
      `.catch(() => { });
    }
  }

  return dispatchedCount;
}
