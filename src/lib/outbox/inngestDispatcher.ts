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
    SET status = 'PROCESSING',
        locked_at = clock_timestamp(),
        locked_by = ${workerId},
        lease_expires_at = clock_timestamp() + INTERVAL '60 seconds',
        updated_at = clock_timestamp()
    WHERE id IN (
      SELECT id FROM outbox_events
      WHERE status = 'PENDING'
        AND event_type = 'job.created'
      ORDER BY created_at ASC
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
        SET status = 'DISPATCHED',
            dispatched_at = clock_timestamp(),
            locked_at = NULL,
            locked_by = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = ${event.id}::uuid
          AND event_type = 'job.created'
          AND locked_by = ${workerId}
          AND lease_expires_at > clock_timestamp()
      `;

      if (result > 0) {
        dispatchedCount++;
      }
    } catch (err: any) {
      console.error(`[Inngest Dispatcher] Error dispatching event ${event.id}:`, err);
      // Revert to PENDING on dispatch error for retry
      await prisma.$executeRaw`
        UPDATE outbox_events
        SET status = 'PENDING',
            retry_count = retry_count + 1,
            error_message = ${err.message || "Failed to dispatch to Inngest"},
            locked_at = NULL,
            locked_by = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = ${event.id}::uuid
          AND event_type = 'job.created'
          AND locked_by = ${workerId}
      `.catch(() => { });
    }
  }

  return dispatchedCount;
}
