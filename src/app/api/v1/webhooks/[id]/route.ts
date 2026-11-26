import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolveUserAuth } from "@/lib/auth/resolveAuth";
import { ApiError } from "@/lib/api/error";

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
