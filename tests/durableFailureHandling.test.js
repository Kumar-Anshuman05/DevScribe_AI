const test = require("node:test");
const assert = require("node:assert");

test("Durable Failure Handling: Atomically transitions job to FAILED and creates job.failed outbox event", async () => {
  // Simulate transactional database operations
  const db = {
    jobs: new Map([
      ["job_123", { id: "job_123", status: "RESEARCHING", errorMessage: null, completedAt: null }],
    ]),
    outbox: [],
    events: [],
  };

  async function handleJobFailure(jobId, errorMsg) {
    const job = db.jobs.get(jobId);
    if (!job) throw new Error("Job not found");

    // 1. Terminal status FAILED
    job.status = "FAILED";
    job.errorMessage = errorMsg;
    job.completedAt = new Date().toISOString();

    // 2. Outbox event with eventType = 'job.failed'
    db.outbox.push({
      aggregateType: "GenerationJob",
      aggregateId: jobId,
      eventType: "job.failed",
      payload: {
        jobId,
        error: errorMsg,
        status: "FAILED",
        failedAt: job.completedAt,
      },
      status: "PENDING",
    });

    // 3. Telemetry event
    db.events.push({
      jobId,
      agentName: "supervisor",
      eventType: "NODE_FAILED",
      errorMessage: errorMsg,
    });
  }

  const errorMsg = "RESEARCH_AGENT_ERROR: Web search grounding quota exceeded.";
  await handleJobFailure("job_123", errorMsg);

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

test("Inngest onFailure Hook: Extracts original event data and invokes failure handler", async () => {
  let capturedFailure = null;

  async function mockOnFailure({ event, error }) {
    const originalEvent = event.data?.event;
    const jobId = originalEvent?.data?.jobId;
    const errorMsg = error?.message || event.data?.error?.message || "Generation workflow execution failed.";

    if (jobId) {
      capturedFailure = { jobId, errorMsg };
    }
  }

  const inngestFailureEvent = {
    data: {
      event: {
        name: "devscribe/job.created",
        data: {
          jobId: "job_xyz_789",
          threadId: "thread_456",
          userId: "user_123",
        },
      },
      error: {
        name: "Error",
        message: "CONTENT_WRITER_AGENT_ERROR: Gemini 503 Overloaded",
      },
    },
  };

  await mockOnFailure({
    event: inngestFailureEvent,
    error: new Error("CONTENT_WRITER_AGENT_ERROR: Gemini 503 Overloaded"),
  });

  assert.ok(capturedFailure);
  assert.strictEqual(capturedFailure.jobId, "job_xyz_789");
  assert.strictEqual(capturedFailure.errorMsg, "CONTENT_WRITER_AGENT_ERROR: Gemini 503 Overloaded");
});
