import { inngest } from "../client";
import prisma from "@/lib/prisma";
import { createDevScribeAgentGraph } from "@/lib/agents/graph";
import { processPendingWebhookDeliveries } from "@/lib/webhooks/dispatcher";

/**
 * Persists terminal failure state atomically and generates outbox event for webhook dispatch.
 */
export async function handleJobFailure(jobId: string, errorMsg: string) {
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Update GenerationJob to terminal FAILED state
      await tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: errorMsg,
          completedAt: new Date(),
        },
      });

      // 2. Atomically insert Webhook OutboxEvent with eventType = 'job.failed'
      await tx.outboxEvent.create({
        data: {
          aggregateType: "GenerationJob",
          aggregateId: jobId,
          eventType: "job.failed",
          payload: {
            jobId,
            error: errorMsg,
            status: "FAILED",
            failedAt: new Date().toISOString(),
          },
          status: "PENDING",
        },
      });

      // 3. Atomically record NODE_FAILED generation event for telemetry
      await tx.generationEvent.create({
        data: {
          jobId,
          agentName: "supervisor",
          eventType: "NODE_FAILED",
          errorMessage: errorMsg,
          stateSnapshot: { stage: "WORKFLOW_FAILED" },
        },
      });
    });

    // 4. Trigger Webhook Dispatcher to notify subscribers immediately
    const workerId = `inngest-failure-worker-${Date.now()}`;
    await processPendingWebhookDeliveries(workerId);
  } catch (err) {
    console.error(`[Inngest Workflow] Failed to persist durable failure for job ${jobId}:`, err);
  }
}

export const generationWorkflow = inngest.createFunction(
  {
    id: "generate-technical-article",
    name: "Generate Technical Article or Tutorial",
    concurrency: {
      limit: 2, // Concurrency limit to prevent LLM quota exhaustion
    },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const originalEvent = (event.data as any)?.event;
      const jobId = originalEvent?.data?.jobId;
      const errorMsg = error?.message || (event.data as any)?.error?.message || "Generation workflow execution failed.";

      if (jobId) {
        console.error(`[Inngest Workflow] Permanent failure triggered for job ${jobId}: ${errorMsg}`);
        await handleJobFailure(jobId, errorMsg);
      }
    },
  },
  { event: "devscribe/job.created" },
  async ({ event, step }) => {
    const { jobId, threadId, userId } = event.data;

    // Step 1: Verify Job & Update Status to RESEARCHING
    const job = await step.run("initialize-job-state", async () => {
      const existingJob = await prisma.generationJob.findUnique({
        where: { id: jobId },
      });

      if (!existingJob) {
        throw new Error(`Job ${jobId} not found.`);
      }

      if (existingJob.status === "COMPLETED" || existingJob.status === "COMPLETED_WITH_WARNINGS") {
        return existingJob;
      }

      return await prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: "RESEARCHING",
          startedAt: new Date(),
          progress: 15,
        },
      });
    });

    if (job.status === "COMPLETED" || job.status === "COMPLETED_WITH_WARNINGS") {
      return { status: "ALREADY_COMPLETED", jobId };
    }

    // Step 2: Execute LangGraph Multi-Agent Workflow
    const agentOutput = await step.run("execute-multi-agent-pipeline", async () => {
      // Record NODE_STARTED generation event
      await prisma.generationEvent.create({
        data: {
          jobId,
          agentName: "supervisor",
          eventType: "NODE_STARTED",
          stateSnapshot: { stage: "PIPELINE_START" },
        },
      });

      const graph = await createDevScribeAgentGraph();

      const initialState = {
        jobId,
        threadId,
        userId: job.userId,
        topic: job.topic,
        contentType: job.contentType,
        targetAudience: job.targetAudience,
        tone: job.tone,
        targetWordCount: job.targetWordCount,
        primaryLanguage: job.primaryLanguage,
        frameworks: job.frameworks,
        additionalGuidelines: job.additionalGuidelines,
        revisionCount: 0,
        status: "RESEARCHING" as const,
      };

      const finalState = await graph.invoke(initialState, {
        configurable: { thread_id: threadId },
      });

      return finalState;
    });

    // Step 3: Atomic Transaction — Insert Article + Update Job + Commit Webhook OutboxEvent
    await step.run("persist-article-and-outbox", async () => {
      const markdown = agentOutput.draftMarkdown || `# ${job.topic}\n\nGenerated content.`;
      const wordCount = markdown.split(/\s+/).filter(Boolean).length;
      const readingTimeMinutes = Math.max(1, Math.round(wordCount / 200));
      const qualityScore = agentOutput.qualityReport?.score ?? 85;
      const terminalStatus = qualityScore >= 85 ? "COMPLETED" : "COMPLETED_WITH_WARNINGS";

      const slugBase = job.topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");
      const slug = `${slugBase}-${job.id.slice(0, 8)}`;

      await prisma.$transaction(async (tx) => {
        // 1. Update GenerationJob to terminal state
        await tx.generationJob.update({
          where: { id: jobId },
          data: {
            status: terminalStatus,
            progress: 100,
            revisionCount: agentOutput.revisionCount || 0,
            completedAt: new Date(),
          },
        });

        // 2. Insert Article
        const article = await tx.article.create({
          data: {
            jobId,
            userId: job.userId,
            title: agentOutput.outline?.title || job.topic,
            slug,
            summary: agentOutput.outline?.summary || `Technical deep dive into ${job.topic}`,
            metaDescription: (agentOutput.outline?.summary || `Technical guide on ${job.topic}`).slice(0, 160),
            contentMarkdown: markdown,
            tags: [job.contentType, job.primaryLanguage, ...(job.frameworks || [])].filter(Boolean) as string[],
            qualityScore,
            qualityReport: (agentOutput.qualityReport as any) || {},
            groundingMetadata: (agentOutput.research as any) || {},
            wordCount,
            readingTimeMinutes,
          },
        });

        // 3. Atomically commit Webhook OutboxEvent
        await tx.outboxEvent.create({
          data: {
            aggregateType: "GenerationJob",
            aggregateId: jobId,
            eventType: "job.completed",
            payload: {
              jobId,
              articleId: article.id,
              slug: article.slug,
              title: article.title,
              qualityScore: article.qualityScore,
              status: terminalStatus,
              wordCount: article.wordCount,
              completedAt: new Date().toISOString(),
            },
            status: "PENDING",
          },
        });
      });
    });

    // Step 4: Trigger Outbound Webhook Delivery Dispatcher
    await step.run("trigger-webhook-dispatch", async () => {
      const workerId = `inngest-worker-${Date.now()}`;
      await processPendingWebhookDeliveries(workerId);
    });

    return { success: true, jobId, status: "COMPLETED" };
  }
);
