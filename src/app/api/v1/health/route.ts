import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkGeminiHealth } from "@/lib/gemini/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health — System Health & Gemini Probe Endpoint
 */
export async function GET() {
  const startTime = Date.now();
  let dbStatus = "healthy";
  let dbLatencyMs = 0;

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
  } catch (err: any) {
    dbStatus = `unhealthy: ${err.message}`;
  }

  const geminiHealth = await checkGeminiHealth();
  const overallHealthy = dbStatus === "healthy" && (geminiHealth.isHealthy || process.env.NODE_ENV !== "production");

  return NextResponse.json(
    {
      status: overallHealthy ? "ok" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
        },
        geminiApi: {
          status: geminiHealth.isHealthy ? "healthy" : "unhealthy",
          latencyMs: geminiHealth.latencyMs,
          model: geminiHealth.model,
          error: geminiHealth.errorMessage,
        },
      },
      durationMs: Date.now() - startTime,
    },
    { status: overallHealthy ? 200 : 503 }
  );
}
