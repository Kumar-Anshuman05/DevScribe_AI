import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateApiKey } from "./apiKey";
import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api/error";

export interface ResolvedAuth {
  userId: string;
  apiKeyId: string | null;
}

/**
 * Resolves user identity from either Bearer API Key or Supabase Cookie Session.
 * Strictly verifies identity, permissions/scopes, and ensures tenant isolation.
 * Never falls back to arbitrary database queries like prisma.user.findFirst().
 */
export async function resolveUserAuth(
  req: NextRequest,
  requiredScope?: string
): Promise<ResolvedAuth> {
  const authHeader = req.headers.get("authorization");

  // 1. Programmatic API Key Authentication
  if (authHeader) {
    if (authHeader.toLowerCase().startsWith("bearer ds_live_")) {
      const apiAuth = await authenticateApiKey(authHeader, requiredScope);
      if (!apiAuth.isValid) {
        throw new ApiError(401, "UNAUTHORIZED", `API Key invalid: ${apiAuth.error}`);
      }
      return { userId: apiAuth.userId!, apiKeyId: apiAuth.apiKeyId ?? null };
    } else if (authHeader.toLowerCase().startsWith("bearer ")) {
      throw new ApiError(
        401,
        "UNAUTHORIZED",
        "Invalid API Key prefix. Production API keys must start with 'ds_live_'."
      );
    }
  }

  // 2. Browser Session Authentication via Supabase SSR
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (user && !error) {
      // Ensure user record exists in Prisma DB
      await prisma.user.upsert({
        where: { id: user.id },
        update: { email: user.email || "" },
        create: { id: user.id, email: user.email || "" },
      });
      return { userId: user.id, apiKeyId: null };
    }
  } catch {
    // Cookie auth unavailable or not configured in current environment
  }

  throw new ApiError(
    401,
    "UNAUTHORIZED",
    "Missing or invalid authorization credentials. Provide Bearer API key or sign in."
  );
}
