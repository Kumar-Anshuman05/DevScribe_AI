import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolveUserAuth } from "@/lib/auth/resolveAuth";
import { ApiError } from "@/lib/api/error";

/**
 * GET /api/v1/jobs/[id] — Poll Live Job Telemetry & Execution Events
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await resolveUserAuth(req, "generate:read");
    const { id } = await params;

    const job = await prisma.generationJob.findUnique({
      where: { id },
      include: {
        article: {
          select: {
            id: true,
            title: true,
            slug: true,
            qualityScore: true,
            wordCount: true,
            readingTimeMinutes: true,
          },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });

    if (!job) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: `Job ${id} not found.` } },
        { status: 404 }
      );
    }

    // Tenant isolation check
    if (job.userId !== auth.userId) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Access to this resource is prohibited." } },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: job.id,
        threadId: job.threadId,
        topic: job.topic,
        contentType: job.contentType,
        targetAudience: job.targetAudience,
        tone: job.tone,
        targetWordCount: job.targetWordCount,
        primaryLanguage: job.primaryLanguage,
        frameworks: job.frameworks,
        status: job.status,
        progress: job.progress,
        revisionCount: job.revisionCount,
        errorMessage: job.errorMessage,
        startedAt: job.startedAt?.toISOString() || null,
        completedAt: job.completedAt?.toISOString() || null,
        createdAt: job.createdAt.toISOString(),
        article: job.article,
        events: job.events,
      },
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
