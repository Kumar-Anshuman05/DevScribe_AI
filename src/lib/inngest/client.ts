import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "devscribe-ai",
  name: "DevScribe AI Workflow Engine",
  eventKey: process.env.INNGEST_EVENT_KEY || "local",
});
