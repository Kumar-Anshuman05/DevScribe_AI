const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

let prisma;

test.before(async () => {
  const prismaMod = await import("@/lib/prisma");
  prisma = prismaMod.default || prismaMod;
});

test("GenerationEvent FK Constraint: Rejects creation when jobId does not exist in generation_jobs (reproduces P2003)", async () => {
  // Check if live database is reachable
  let isDbAvailable = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    isDbAvailable = true;
  } catch (err) {
    console.log("Database connection not reachable, skipping live DB test:", err.message);
  }

  if (!isDbAvailable) {
    return;
  }

  // Attempt to insert a generationEvent with a non-existent jobId (e.g., an arbitrary UUID or thread ID)
  const nonExistentJobId = crypto.randomUUID();

  await assert.rejects(
    async () => {
      await prisma.generationEvent.create({
        data: {
          jobId: nonExistentJobId,
          agentName: "supervisor",
          eventType: "NODE_STARTED",
          stateSnapshot: { stage: "PIPELINE_START" },
        },
      });
    },
    (err) => {
      // Prisma error code P2003: Foreign key constraint failed
      assert.strictEqual(err.code, "P2003", `Expected Prisma P2003 error, got: ${err.code} - ${err.message}`);
      assert.ok(
        err.message.includes("generation_events_jobId_fkey") || err.message.includes("Foreign key constraint violated"),
        `Expected foreign key constraint reference in error message, got: ${err.message}`
      );
      return true;
    }
  );
});

test("GenerationEvent FK Constraint: Successfully persists against actual existing GenerationJob", async () => {
  let isDbAvailable = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    isDbAvailable = true;
  } catch {
    return;
  }

  // Create temporary user and job
  const testUserId = crypto.randomUUID();
  const testEmail = `test-event-user-${Date.now()}@example.com`;
  const testJobId = crypto.randomUUID();
  const testThreadId = `th_test_${crypto.randomBytes(6).toString("hex")}`;

  await prisma.user.create({
    data: { id: testUserId, email: testEmail },
  });

  const job = await prisma.generationJob.create({
    data: {
      id: testJobId,
      userId: testUserId,
      threadId: testThreadId,
      topic: "Event Persistence Concurrency",
      contentType: "TUTORIAL",
      status: "RESEARCHING",
      progress: 15,
    },
  });

  try {
    // 1. Verify that threadId cannot be used as jobId (must fail FK constraint)
    // Note: threadId is a string like "th_test_...", not a UUID, or if a UUID format was used,
    // it does not exist in generation_jobs.id
    const fakeUuidThreadId = crypto.randomUUID();
    await assert.rejects(
      async () => {
        await prisma.generationEvent.create({
          data: {
            jobId: fakeUuidThreadId,
            agentName: "supervisor",
            eventType: "NODE_STARTED",
          },
        });
      },
      (err) => {
        assert.strictEqual(err.code, "P2003");
        return true;
      }
    );

    // 2. Verify that using the actual job.id succeeds
    const event = await prisma.generationEvent.create({
      data: {
        jobId: job.id,
        agentName: "supervisor",
        eventType: "NODE_STARTED",
        stateSnapshot: { stage: "PIPELINE_START" },
      },
    });

    assert.ok(event.id);
    assert.strictEqual(event.jobId, job.id);
    assert.strictEqual(event.agentName, "supervisor");
    assert.strictEqual(event.eventType, "NODE_STARTED");

    // 3. Query through relation
    const retrievedJob = await prisma.generationJob.findUnique({
      where: { id: job.id },
      include: { events: true },
    });

    assert.ok(retrievedJob);
    assert.strictEqual(retrievedJob.events.length, 1);
    assert.strictEqual(retrievedJob.events[0].id, event.id);

  } finally {
    // 4. Cleanup: deleting the job cascades to delete generationEvent
    await prisma.generationJob.delete({
      where: { id: testJobId },
    }).catch(() => {});

    await prisma.user.delete({
      where: { id: testUserId },
    }).catch(() => {});

    // Verify event was cascade deleted
    const leftoverEvents = await prisma.generationEvent.findMany({
      where: { jobId: testJobId },
    });
    assert.strictEqual(leftoverEvents.length, 0, "Events must be cascade deleted when job is removed");
  }
});
