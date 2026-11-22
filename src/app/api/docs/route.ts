import { NextResponse } from "next/server";

const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "DevScribe AI REST API",
    version: "4.3.3",
    description: "An Agentic Platform for Intelligent Technical Content Research, Generation and Validation.",
  },
  servers: [{ url: "/api/v1", description: "Default V1 Server" }],
  paths: {
    "/jobs": {
      post: {
        summary: "Submit generation job",
        description: "Creates an asynchronous technical article generation job using fenced idempotency.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Unique idempotency token (e.g., UUID)",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["topic"],
                properties: {
                  topic: { type: "string", example: "Distributed Consensus with Raft in Rust" },
                  contentType: { type: "string", enum: ["BLOG", "TUTORIAL"], default: "TUTORIAL" },
                  targetAudience: { type: "string", default: "Intermediate" },
                  tone: { type: "string", enum: ["DIDACTIC", "CONVERSATIONAL", "ENTERPRISE_ARCHITECTURAL"], default: "DIDACTIC" },
                  targetWordCount: { type: "integer", minimum: 1000, maximum: 4000, default: 2500 },
                  primaryLanguage: { type: "string", example: "Rust" },
                  frameworks: { type: "array", items: { type: "string" }, example: ["tokio", "tonic"] },
                  additionalGuidelines: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Job accepted and queued for execution",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "400": { description: "Validation error or missing idempotency key" },
          "409": { description: "Idempotency conflict (payload hash mismatch or concurrent lock)" },
        },
      },
      get: {
        summary: "List user jobs",
        responses: { "200": { description: "Paginated list of jobs" } },
      },
    },
    "/jobs/{id}": {
      get: {
        summary: "Get live job status & telemetry",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Job status and agent execution events" } },
      },
    },
    "/articles": {
      get: {
        summary: "List articles",
        responses: { "200": { description: "List of generated articles" } },
      },
    },
    "/articles/{id}": {
      get: {
        summary: "Fetch article by ID or slug",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Article details and full markdown" } },
      },
    },
    "/webhooks": {
      post: {
        summary: "Register webhook endpoint",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", format: "uri" },
                  description: { type: "string" },
                  eventTypes: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Webhook registered, returns plaintext secret once" } },
      },
      get: {
        summary: "List registered webhooks",
        responses: { "200": { description: "List of endpoints" } },
      },
    },
    "/health": {
      get: {
        summary: "System health check",
        responses: { "200": { description: "System operational" } },
      },
    },
  },
};

export async function GET() {
  return NextResponse.json(openApiSpec);
}
