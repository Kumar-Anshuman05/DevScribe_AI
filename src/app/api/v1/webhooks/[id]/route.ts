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
 * DELETE /api/v1/webhooks/[id] — Revoke webhook endpoint
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await resolveUserAuth(req, "webhooks:write");
    const { id } = await params;

    const endpoint = await prisma.webhookEndpoint.findUnique({
      where: { id },
    });

    if (!endpoint) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: `Webhook endpoint ${id} not found.` } },
        { status: 404 }
      );
    }

    if (endpoint.userId !== auth.userId) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Forbidden." } },
        { status: 403 }
      );
    }

    await prisma.webhookEndpoint.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: `Webhook endpoint ${id} successfully deleted.`,
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
