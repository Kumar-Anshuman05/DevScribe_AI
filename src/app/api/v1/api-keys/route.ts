import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateApiKey } from "@/lib/auth/apiKey";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Strictly enforce authenticated user identity; no findFirst() fallback
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: { message: "Unauthorized. Please sign in to generate an API key." } },
        { status: 401 }
      );
    }

    const userId = user.id;

    // Ensure user record exists in prisma DB
    await prisma.user.upsert({
      where: { id: userId },
      update: { email: user.email || "" },
      create: { id: userId, email: user.email || "" },
    });

    const { name, scopes } = await req.json().catch(() => ({}));
    const { plaintextKey, keyPrefix, keyHash } = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        userId,
        name: name || "Developer API Key",
        keyPrefix,
        keyHash,
        scopes: scopes || ["generate:write", "generate:read", "articles:read"],
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        plaintextKey, // Return plaintext ONCE upon creation
        scopes: apiKey.scopes,
        createdAt: apiKey.createdAt.toISOString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { message: err.message } },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Strictly require authenticated session
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: { message: "Unauthorized. Please sign in." } },
        { status: 401 }
      );
    }

    const keys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, data: keys });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { message: err.message } },
      { status: 500 }
    );
  }
}
