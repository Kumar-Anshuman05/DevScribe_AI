import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { resolveUserAuth } from "@/lib/auth/resolveAuth";
import { encryptWebhookSecret } from "@/lib/webhooks/crypto";
import { ApiError } from "@/lib/api/error";

const webhookSchema = z.object({
  url: z.string().url("Valid HTTPS URL required").refine((u) => u.startsWith("https://") || process.env.NODE_ENV !== "production", {
    message: "Webhook URLs must use HTTPS in production.",
  }),
  description: z.string().max(200).optional(),
  eventTypes: z.array(z.string()).default(["job.completed", "job.failed"]),
});

/**
 * POST /api/v1/webhooks — Register Webhook Subscription with AES-256-GCM Encrypted Secret
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await resolveUserAuth(req, "webhooks:write");
    const rawBody = await req.json();
    const parsed = webhookSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid webhook payload.", details: parsed.error.format() } },
        { status: 400 }
      );
    }

    // Generate a fresh cryptographically secure signing secret
    const plaintextSecret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
    const encrypted = encryptWebhookSecret(plaintextSecret);

    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        userId: auth.userId,
        url: parsed.data.url,
        description: parsed.data.description,
        eventTypes: parsed.data.eventTypes,
        secretCiphertext: encrypted.ciphertext,
        secretIv: encrypted.iv,
        secretTag: encrypted.tag,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: endpoint.id,
          url: endpoint.url,
          description: endpoint.description,
          eventTypes: endpoint.eventTypes,
          secret: plaintextSecret, // Revealed only once upon creation
          createdAt: endpoint.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
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

/**
 * GET /api/v1/webhooks — List Webhooks for authenticated user
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await resolveUserAuth(req, "webhooks:read");
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        url: true,
        description: true,
        eventTypes: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: endpoints,
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
