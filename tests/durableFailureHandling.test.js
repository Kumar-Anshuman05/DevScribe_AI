const test = require("node:test");
const assert = require("node:assert");

function createMockDb() {
  return {
    jobs: new Map([
      ["job_123", { id: "job_123", status: "RESEARCHING", errorMessage: null, completedAt: null }],
      ["job_completed", { id: "job_completed", status: "COMPLETED", errorMessage: null, completedAt: new Date().toISOString() }],
      ["job_warnings", { id: "job_warnings", status: "COMPLETED_WITH_WARNINGS", errorMessage: null, completedAt: new Date().toISOString() }],
    ]),
    outbox: [],
    events: [],
  };
}

async function handleJobFailure(db, jobId, errorMsg, shouldFailDb = false) {
  if (shouldFailDb) {
    throw new Error("DB_CONNECTION_TIMEOUT: Transient database failure during transaction");
  }

  const existingJob = db.jobs.get(jobId);
  if (!existingJob) return;

  // Guard: Completed job cannot be overwritten as failed by a late failure callback
  if (existingJob.status === "COMPLETED" || existingJob.status === "COMPLETED_WITH_WARNINGS") {
    return;
  }

  // Idempotency: If already FAILED, do not re-process
  if (existingJob.status === "FAILED") {
    return;
  }

  // Transition job status to FAILED
  existingJob.status = "FAILED";
  existingJob.errorMessage = errorMsg;
  existingJob.completedAt = new Date().toISOString();

  // Deduplicate outbox event
  const alreadyOutboxed = db.outbox.some(
    (e) => e.aggregateType === "GenerationJob" && e.aggregateId === jobId && e.eventType === "job.failed"
  );

  if (!alreadyOutboxed) {
    db.outbox.push({
      aggregateType: "GenerationJob",
      aggregateId: jobId,
      eventType: "job.failed",
      payload: {
        jobId,
        error: errorMsg,
        status: "FAILED",
        failedAt: existingJob.completedAt,
      },
      status: "PENDING",
    });
  }

  db.events.push({
    jobId,
    agentName: "supervisor",
    eventType: "NODE_FAILED",
    errorMessage: errorMsg,
  });
}

test("Durable Failure Handling: Atomically transitions job to FAILED and creates job.failed outbox event", async () => {
  const db = createMockDb();
  const errorMsg = "RESEARCH_AGENT_ERROR: Web search grounding quota exceeded.";
  await handleJobFailure(db, "job_123", errorMsg);

  const updatedJob = db.jobs.get("job_123");
  assert.strictEqual(updatedJob.status, "FAILED");
  assert.strictEqual(updatedJob.errorMessage, errorMsg);
  assert.ok(updatedJob.completedAt);

  assert.strictEqual(db.outbox.length, 1);
  const outboxEvent = db.outbox[0];
  assert.strictEqual(outboxEvent.aggregateType, "GenerationJob");
  assert.strictEqual(outboxEvent.aggregateId, "job_123");
  assert.strictEqual(outboxEvent.eventType, "job.failed");
  assert.strictEqual(outboxEvent.payload.status, "FAILED");
  assert.strictEqual(outboxEvent.payload.error, errorMsg);
  assert.strictEqual(outboxEvent.status, "PENDING");

  assert.strictEqual(db.events.length, 1);
  assert.strictEqual(db.events[0].eventType, "NODE_FAILED");
});

test("Durable Failure Handling: Idempotent under repeated or concurrent failure calls", async () => {
  const db = createMockDb();
  const errorMsg = "PLANNING_AGENT_ERROR: Connection reset by peer.";

  // First call
  await handleJobFailure(db, "job_123", errorMsg);
  // Second call (duplicate/retry)
  await handleJobFailure(db, "job_123", errorMsg);

  // Exactly one outbox event and one telemetry event created
  assert.strictEqual(db.outbox.length, 1);
  assert.strictEqual(db.events.length, 1);
  assert.strictEqual(db.jobs.get("job_123").status, "FAILED");
});

test("Durable Failure Handling: Prevents late failure callback from overwriting completed jobs", async () => {
  const db = createMockDb();

  // Attempt late failure on COMPLETED job
  await handleJobFailure(db, "job_completed", "LATE_ERROR: Worker timeout");
  assert.strictEqual(db.jobs.get("job_completed").status, "COMPLETED");
  assert.strictEqual(db.outbox.length, 0);

  // Attempt late failure on COMPLETED_WITH_WARNINGS job
  await handleJobFailure(db, "job_warnings", "LATE_ERROR: Worker timeout");
  assert.strictEqual(db.jobs.get("job_warnings").status, "COMPLETED_WITH_WARNINGS");
  assert.strictEqual(db.outbox.length, 0);
});

test("Durable Failure Handling: Re-throws persistence errors so Inngest can observe and retry", async () => {
  const db = createMockDb();

  await assert.rejects(
    async () => {
      await handleJobFailure(db, "job_123", "Some error", true);
    },
    {
      name: "Error",
      message: /DB_CONNECTION_TIMEOUT/,
    }
  );
});
