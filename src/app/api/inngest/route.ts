import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { generationWorkflow } from "@/lib/inngest/functions/generationWorkflow";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generationWorkflow],
});
