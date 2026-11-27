import { z } from "zod";

const envSchema = z.object({
  // Tri-Tier Database Connections
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),
  CHECKPOINTER_DATABASE_URL: z.string().optional(),
  DATABASE_SSL_CERT: z.string().optional(),

  // Supabase Auth
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL").optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Groq API
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
  GROQ_MODEL_FAST: z.string().default("openai/gpt-oss-20b"),
  GROQ_MODEL_REASONING: z.string().default("openai/gpt-oss-20b"),

  // Search & Grounding
  RESEARCH_SEARCH_PROVIDER: z.enum(["duckduckgo", "tavily"]).default("duckduckgo"),
  TAVILY_API_KEY: z.string().optional(),

  // Inngest
  INNGEST_EVENT_KEY: z.string().default("local"),
  INNGEST_SIGNING_KEY: z.string().default("local"),

  // Webhook Encryption
  WEBHOOK_ENCRYPTION_KEY: z
    .string()
    .length(64, "WEBHOOK_ENCRYPTION_KEY must be a 64-character (32-byte) hex string")
    .default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),

  // Application
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let validatedEnv: Env;

export function getEnv(): Env {
  if (!validatedEnv) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.warn("⚠️ Environment validation warning:", result.error.format());
      // In development/test mode, provide sensible fallbacks so builds succeed even before real keys are populated
      validatedEnv = envSchema.parse({
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock",
        GROQ_API_KEY: process.env.GROQ_API_KEY || "mock-groq-key",
      });
    } else {
      validatedEnv = result.data;
    }
  }
  return validatedEnv;
}

export const env = getEnv();
