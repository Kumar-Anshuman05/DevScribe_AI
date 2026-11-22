import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: { message: "Unauthorized. Please sign in." } },
        { status: 401 }
      );
    }

    const { id } = await params;
    const apiKey = await prisma.apiKey.findUnique({
      where: { id },
    });

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: { message: `API Key ${id} not found.` } },
        { status: 404 }
      );
    }

    // Enforce strict user ownership
    if (apiKey.userId !== user.id) {
      return NextResponse.json(
        { success: false, error: { message: "Forbidden. You do not own this API key." } },
        { status: 403 }
      );
    }

    await prisma.apiKey.delete({ where: { id } });
    return NextResponse.json({ success: true, message: `API Key ${id} revoked.` });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { message: err.message } },
      { status: 500 }
    );
  }
}
