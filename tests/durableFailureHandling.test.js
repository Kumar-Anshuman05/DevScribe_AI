const test = require("node:test");
const assert = require("node:assert");

// Import the actual production handleJobFailure function and Prisma client
let handleJobFailure;
let prisma;

function createTestDatabase(initialJobs = []) {
  const jobs = new Map();
  for (const j of initialJobs) {
    jobs.set(j.id, { ...j });
  }
  const outbox = [];
  const generationEvents = [];

  const tx = {
    generationJob: {
      updateMany: async ({ where, data }) => {
        const job = jobs.get(where.id);
        if (!job) return { count: 0 };
        if (where.status && where.status.notIn) {
          if (where.status.notIn.includes(job.status)) {
            return { count: 0 };
          }
        }
        Object.assign(job, data);
        return { count: 1 };
      },
      findUnique: async ({ where }) => {
        const job = jobs.get(where.id);
        return job ? { ...job } : null;
      },
    },
    outboxEvent: {
      findFirst: async ({ where }) => {
        const found = outbox.find(
          (e) =>
            e.aggregateType === where.aggregateType &&
            e.aggregateId === where.aggregateId &&
            e.eventType === where.eventType
        );
        return found ? { ...found } : null;
      },
      create: async ({ data }) => {
        // Enforce unique constraint @@unique([aggregateId, eventType])
        const duplicate = outbox.find(
          (e) => e.aggregateId === data.aggregateId && e.eventType === data.eventType
        );
        if (duplicate) {
          const err = new Error("Unique constraint violation");
          err.code = "P2002";
          throw err;
        }
        const created = { id: `outbox-${outbox.length + 1}`, ...data };
        outbox.push(created);
        return created;
      },
    },
    generationEvent: {
      create: async ({ data }) => {
        const created = { id: `event-${generationEvents.length + 1}`, ...data };
        generationEvents.push(created);
        return created;
      },
    },
  };

  return { jobs, outbox, generationEvents, tx };
}

test.before(async () => {
  const prismaMod = await import("@/lib/prisma");
  prisma = prismaMod.default;

  const workflowMod = await import("@/lib/inngest/functions/generationWorkflow");
  handleJobFailure = workflowMod.handleJobFailure;
});

function attachPrismaMocks(db) {
  prisma.$transaction = async (cb) => cb(db.tx);
  prisma.$queryRaw = async () => [];
  prisma.$executeRaw = async () => 0;
  prisma.outboxEvent = {
    findMany: async () => [],
    findFirst: db.tx.outboxEvent.findFirst,
  };
  prisma.generationJob = {
    findUnique: db.tx.generationJob.findUnique,
    updateMany: db.tx.generationJob.updateMany,
  };
}

test("Durable Failure Handling (Production Function): Atomically transitions active job to FAILED and creates outbox and telemetry", async () => {
  const db = createTestDatabase([
    { id: "job_active_1", status: "RESEARCHING", errorMessage: null, completedAt: null },
  ]);

  attachPrismaMocks(db);

  await handleJobFailure("job_active_1", "Gemini API rate limit exceeded");

  const job = db.jobs.get("job_active_1");
  assert.strictEqual(job.status, "FAILED");
  assert.strictEqual(job.errorMessage, "Gemini API rate limit exceeded");
  assert.ok(job.completedAt);

  // Exactly 1 outbox event
  assert.strictEqual(db.outbox.length, 1);
  assert.strictEqual(db.outbox[0].eventType, "job.failed");
  assert.strictEqual(db.outbox[0].aggregateId, "job_active_1");
  assert.strictEqual(db.outbox[0].payload.error, "Gemini API rate limit exceeded");

  // Exactly 1 generation event
  assert.strictEqual(db.generationEvents.length, 1);
  assert.strictEqual(db.generationEvents[0].eventType, "NODE_FAILED");
  assert.strictEqual(db.generationEvents[0].errorMessage, "Gemini API rate limit exceeded");
});

test("Durable Failure Handling (Production Function): Prevents late failure callback from overwriting completed jobs", async () => {
  const completedDate = new Date("2026-01-01T00:00:00Z");
  const db = createTestDatabase([
    { id: "job_done", status: "COMPLETED", errorMessage: null, completedAt: completedDate },
    { id: "job_warn", status: "COMPLETED_WITH_WARNINGS", errorMessage: null, completedAt: completedDate },
  ]);

  attachPrismaMocks(db);

  // Attempt late failure on COMPLETED job
  await handleJobFailure("job_done", "Late worker timeout error");
  assert.strictEqual(db.jobs.get("job_done").status, "COMPLETED");
  assert.strictEqual(db.jobs.get("job_done").errorMessage, null);
  assert.strictEqual(db.jobs.get("job_done").completedAt, completedDate);

  // Attempt late failure on COMPLETED_WITH_WARNINGS job
  await handleJobFailure("job_warn", "Late reviewer connection error");
  assert.strictEqual(db.jobs.get("job_warn").status, "COMPLETED_WITH_WARNINGS");
  assert.strictEqual(db.jobs.get("job_warn").errorMessage, null);

  // No outbox or telemetry created
  assert.strictEqual(db.outbox.length, 0);
  assert.strictEqual(db.generationEvents.length, 0);
});

test("Durable Failure Handling (Production Function): Idempotent when job is already FAILED and outbox exists", async () => {
  const failedDate = new Date("2026-01-01T00:00:00Z");
  const db = createTestDatabase([
    { id: "job_failed_1", status: "FAILED", errorMessage: "Original failure", completedAt: failedDate },
  ]);

  // Pre-existing outbox event
  db.outbox.push({
    id: "outbox-existing",
    aggregateType: "GenerationJob",
    aggregateId: "job_failed_1",
    eventType: "job.failed",
    payload: { jobId: "job_failed_1", error: "Original failure" },
  });

  attachPrismaMocks(db);

  // Repeated failure invocation
  await handleJobFailure("job_failed_1", "Duplicate failure call");

  assert.strictEqual(db.jobs.get("job_failed_1").errorMessage, "Original failure");
  assert.strictEqual(db.outbox.length, 1, "Must not insert duplicate outbox event");
  assert.strictEqual(db.generationEvents.length, 0, "Must not insert duplicate telemetry");
});

test("Durable Failure Handling (Production Function): Safely repairs missing failure outbox event without duplicate telemetry", async () => {
  const failedDate = new Date("2026-01-01T00:00:00Z");
  const db = createTestDatabase([
    { id: "job_failed_no_outbox", status: "FAILED", errorMessage: "Crashed before outbox", completedAt: failedDate },
  ]);

  // Outbox is empty (simulating earlier crash right after job status update)
  assert.strictEqual(db.outbox.length, 0);

  attachPrismaMocks(db);

  // Invocation repairs missing outbox event
  await handleJobFailure("job_failed_no_outbox", "Recovery check");

  assert.strictEqual(db.outbox.length, 1, "Must create repaired outbox event");
  assert.strictEqual(db.outbox[0].aggregateId, "job_failed_no_outbox");
  assert.strictEqual(db.outbox[0].eventType, "job.failed");
  assert.strictEqual(db.generationEvents.length, 0, "Must NOT insert duplicate NODE_FAILED telemetry");
});

test("Durable Failure Handling (Production Function): Completion-versus-failure concurrency race is mutually exclusive", async () => {
  const db = createTestDatabase([
    { id: "job_race", status: "WRITING", errorMessage: null, completedAt: null },
  ]);

  attachPrismaMocks(db);

  // Step 3 completion transaction logic
  async function simulateStep3Completion(jobId) {
    return prisma.$transaction(async (tx) => {
      const updateResult = await tx.generationJob.updateMany({
        where: {
          id: jobId,
          status: {
            notIn: ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED"],
          },
        },
        data: {
          status: "COMPLETED",
          progress: 100,
          completedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        return { success: false, reason: "ALREADY_TERMINAL" };
      }

      await tx.outboxEvent.create({
        data: {
          aggregateType: "GenerationJob",
          aggregateId: jobId,
          eventType: "job.completed",
          payload: { jobId, status: "COMPLETED" },
        },
      });

      return { success: true };
    });
  }

  // Branch A: handleJobFailure commits first
  await handleJobFailure("job_race", "Agent timeout");
  assert.strictEqual(db.jobs.get("job_race").status, "FAILED");

  // Branch B: Late completion arrives after job is already FAILED
  const completionResult = await simulateStep3Completion("job_race");
  assert.strictEqual(completionResult.success, false);
  assert.strictEqual(completionResult.reason, "ALREADY_TERMINAL");
  assert.strictEqual(db.jobs.get("job_race").status, "FAILED");

  // Verify only job.failed outbox exists, never job.completed
  assert.strictEqual(db.outbox.length, 1);
  assert.strictEqual(db.outbox[0].eventType, "job.failed");
});

test("Durable Failure Handling (Production Function): Concurrent failure calls race safely with duplicate outbox prevention", async () => {
  const db = createTestDatabase([
    { id: "job_concurrent", status: "PLANNING", errorMessage: null, completedAt: null },
  ]);

  attachPrismaMocks(db);

  // Execute two concurrent failure calls
  await Promise.all([
    handleJobFailure("job_concurrent", "Failure from Worker 1"),
    handleJobFailure("job_concurrent", "Failure from Worker 2"),
  ]);

  const job = db.jobs.get("job_concurrent");
  assert.strictEqual(job.status, "FAILED");
  // Only 1 outbox event and 1 generation event
  assert.strictEqual(db.outbox.length, 1);
  assert.strictEqual(db.outbox[0].eventType, "job.failed");
  assert.strictEqual(db.generationEvents.length, 1);
});

test("Durable Failure Handling (Production Function): Re-throws persistence errors so Inngest can observe and retry", async () => {
  prisma.$transaction = async () => {
    throw new Error("DB_CONNECTION_TIMEOUT: Transient database failure during transaction");
  };

  await assert.rejects(
    async () => {
      await handleJobFailure("job_test", "Some error");
    },
    {
      name: "Error",
      message: /DB_CONNECTION_TIMEOUT/,
    }
  );
});
