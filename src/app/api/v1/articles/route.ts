import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateApiKey } from "@/lib/auth/apiKey";
import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api/error";

async function resolveUserAuth(req: NextRequest, requiredScope: string) {
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ds_live_")) {
    const apiAuth = await authenticateApiKey(authHeader, requiredScope);
    if (!apiAuth.isValid) {
      throw new ApiError(401, "UNAUTHORIZED", `API Key invalid: ${apiAuth.error}`);
    }
    return { userId: apiAuth.userId! };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      return { userId: user.id };
    }
  } catch {}

  throw new ApiError(401, "UNAUTHORIZED", "Missing credentials.");
}

/**
 * GET /api/v1/articles — List user articles (paginated)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await resolveUserAuth(req, "articles:read");
    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));

    const [articles, total] = await Promise.all([
      prisma.article.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          jobId: true,
          title: true,
          slug: true,
          summary: true,
          tags: true,
          qualityScore: true,
          wordCount: true,
          readingTimeMinutes: true,
          createdAt: true,
        },
      }),
      prisma.article.count({ where: { userId: auth.userId } }),
    ]);

    return NextResponse.json({
      success: true,
      data: articles,
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
