import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkGroqHealth } from "@/lib/groq/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health — System Health & Groq Probe Endpoint
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

  const groqHealth = await checkGroqHealth();
  const overallHealthy = dbStatus === "healthy" && (groqHealth.isHealthy || process.env.NODE_ENV !== "production");

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
        groqApi: {
          status: groqHealth.isHealthy ? "healthy" : "unhealthy",
          latencyMs: groqHealth.latencyMs,
          model: groqHealth.model,
          error: groqHealth.errorMessage,
        },
      },
      durationMs: Date.now() - startTime,
    },
    { status: overallHealthy ? 200 : 503 }
  );
}
