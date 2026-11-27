import { Inngest } from "inngest";

const isDev =
  process.env.NODE_ENV !== "production" ||
  process.env.INNGEST_DEV === "1" ||
  process.env.INNGEST_EVENT_KEY === "local";

export const inngest = new Inngest({
  id: "devscribe-ai",
  name: "DevScribe AI Workflow Engine",
  eventKey: process.env.INNGEST_EVENT_KEY || "local",
  baseUrl: process.env.INNGEST_BASE_URL || (isDev ? "http://127.0.0.1:8288" : undefined),
  isDev,
});

