import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { generationWorkflow } from "@/lib/inngest/functions/generationWorkflow";

const isDev =
  process.env.NODE_ENV !== "production" ||
  process.env.INNGEST_DEV === "1" ||
  process.env.INNGEST_EVENT_KEY === "local";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generationWorkflow],
  signingKey: process.env.INNGEST_SIGNING_KEY || (isDev ? "local" : undefined),
});

