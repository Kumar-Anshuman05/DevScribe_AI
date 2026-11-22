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
 * GET /api/v1/articles/[id] — Retrieve Article by UUID or Unique Slug
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await resolveUserAuth(req, "articles:read");
    const { id } = await params;

    // Check if queried by UUID or slug
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const article = await prisma.article.findFirst({
      where: isUuid
        ? { id, userId: auth.userId }
        : { slug: id, userId: auth.userId },
      include: {
        job: {
          select: {
            id: true,
            topic: true,
            contentType: true,
            targetAudience: true,
            tone: true,
            primaryLanguage: true,
            frameworks: true,
            status: true,
          },
        },
      },
    });

    if (!article) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: `Article '${id}' not found.` } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: article,
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
