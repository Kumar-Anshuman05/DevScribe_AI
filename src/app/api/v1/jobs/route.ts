import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { authenticateApiKey } from "@/lib/auth/apiKey";
import { createClient } from "@/lib/supabase/server";
import { processWithIdempotency } from "@/lib/idempotency/guard";
import { processPendingInngestEvents } from "@/lib/outbox/inngestDispatcher";
import { ApiError } from "@/lib/api/error";

const createJobSchema = z.object({
  topic: z.string().min(3, "Topic must be at least 3 characters").max(200),
  contentType: z.enum(["BLOG", "TUTORIAL"]).default("TUTORIAL"),
  targetAudience: z.string().default("Intermediate"),
  tone: z.enum(["DIDACTIC", "CONVERSATIONAL", "ENTERPRISE_ARCHITECTURAL"]).default("DIDACTIC"),
  targetWordCount: z.number().int().min(1000).max(4000).default(2500),
  primaryLanguage: z.string().optional().nullable(),
  frameworks: z.array(z.string()).default([]),
  additionalGuidelines: z.string().max(2000).optional().nullable(),
});

/**
 * Resolves user identity from either Bearer API Key or Supabase Cookie Session.
 */
async function resolveUserAuth(req: NextRequest, requiredScope: string) {
  const authHeader = req.headers.get("authorization");

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ds_live_")) {
    const apiAuth = await authenticateApiKey(authHeader, requiredScope);
    if (!apiAuth.isValid) {
      throw new ApiError(401, "UNAUTHORIZED", `API Key invalid: ${apiAuth.error}`);
    }
    return { userId: apiAuth.userId!, apiKeyId: apiAuth.apiKeyId };
  }

  // Fallback to Supabase cookie auth for web dashboard
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Ensure user exists in prisma DB
      await prisma.user.upsert({
        where: { id: user.id },
        update: { email: user.email || "" },
        create: { id: user.id, email: user.email || "" },
      });
      return { userId: user.id, apiKeyId: null };
    }
  } catch (err) {
    // Cookie auth unavailable
  }

  throw new ApiError(401, "UNAUTHORIZED", "Missing or invalid authorization credentials. Provide Bearer API key or sign in.");
}

/**
 * POST /api/v1/jobs — Submit Generation Job with Fenced Idempotency
 */
export async function POST(req: NextRequest) {
  const requestId = `req_${crypto.randomBytes(4).toString("hex")}`;
  const timestamp = new Date().toISOString();

  try {
    const auth = await resolveUserAuth(req, "generate:write");
    const idempotencyKey = req.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_IDEMPOTENCY_KEY",
            message: "The 'Idempotency-Key' header is mandatory for generation requests.",
          },
        },
        { status: 400 }
      );
    }

    const rawBody = await req.json();
    const parseResult = createJobSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid job parameters.",
            details: parseResult.error.format(),
          },
        },
        { status: 400 }
      );
    }

    const validData = parseResult.data;

    // Execute with Fenced Concurrency-Safe Idempotency Guard
    const idempotencyResult = await processWithIdempotency(
      auth.userId,
      idempotencyKey,
      validData,
      async (tx, ownershipToken) => {
        const jobId = crypto.randomUUID();
        const threadId = `th_${crypto.randomBytes(6).toString("hex")}`;

        // 1. Insert GenerationJob (status: QUEUED)
        const job = await tx.generationJob.create({
          data: {
            id: jobId,
            userId: auth.userId,
            apiKeyId: auth.apiKeyId,
            threadId,
            topic: validData.topic,
            contentType: validData.contentType,
            targetAudience: validData.targetAudience,
            tone: validData.tone,
            targetWordCount: validData.targetWordCount,
            primaryLanguage: validData.primaryLanguage,
            frameworks: validData.frameworks,
            additionalGuidelines: validData.additionalGuidelines,
            status: "QUEUED",
            progress: 0,
          },
        });

        // 2. Insert OutboxEvent (eventType: job.created, status: PENDING)
        await tx.outboxEvent.create({
          data: {
            aggregateType: "GenerationJob",
            aggregateId: job.id,
            eventType: "job.created",
            payload: {
              jobId: job.id,
              threadId: job.threadId,
              userId: auth.userId,
              topic: job.topic,
              contentType: job.contentType,
            },
            status: "PENDING",
          },
        });

        // 3. Return 202 Accepted Payload
        const responsePayload = {
          success: true,
          data: {
            jobId: job.id,
            threadId: job.threadId,
            status: job.status,
            progress: job.progress,
            createdAt: job.createdAt.toISOString(),
            statusUrl: `/api/v1/jobs/${job.id}`,
          },
          meta: {
            timestamp,
            requestId,
          },
        };

        return {
          statusCode: 202,
          payload: responsePayload,
        };
      }
    );

    // Trigger immediate outbox dispatch (non-blocking)
    processPendingInngestEvents(`worker-${Date.now()}`).catch((err) =>
      console.error("Immediate Inngest outbox dispatch error:", err)
    );

    return NextResponse.json(idempotencyResult.payload, {
      status: idempotencyResult.statusCode,
      headers: {
        "X-Idempotent-Replay": idempotencyResult.isCached ? "true" : "false",
      },
    });
  } catch (err: any) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: err.errorCode,
            message: err.message,
            details: err.details,
          },
        },
        { status: err.statusCode }
      );
    }

    console.error("Unexpected error in POST /api/v1/jobs:", err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An internal server error occurred while processing the job.",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/jobs — List jobs for the authenticated user
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await resolveUserAuth(req, "generate:read");
    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));

    const [jobs, total] = await Promise.all([
      prisma.generationJob.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          article: {
            select: { id: true, title: true, slug: true, qualityScore: true },
          },
        },
      }),
      prisma.generationJob.count({ where: { userId: auth.userId } }),
    ]);

    return NextResponse.json({
      success: true,
      data: jobs,
      pagination: { total, limit, offset },
    });
  } catch (err: any) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: err.errorCode, message: err.message } },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: err.message } },
      { status: 500 }
    );
  }
}
