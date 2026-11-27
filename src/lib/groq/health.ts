import { getGroqClient, groqConfig } from "./config";

export interface GroqHealthStatus {
  isHealthy: boolean;
  latencyMs: number;
  model: string;
  errorMessage?: string;
}

/**
 * Sends a minimal probe request to verify Groq API key validity and model responsiveness.
 */
export async function checkGroqHealth(): Promise<GroqHealthStatus> {
  const start = Date.now();
  if (!groqConfig.apiKey) {
    return {
      isHealthy: false,
      latencyMs: 0,
      model: groqConfig.fastModel,
      errorMessage: "GROQ_API_KEY is not configured.",
    };
  }

  try {
    const groq = getGroqClient();
    await groq.chat.completions.create(
      {
        model: groqConfig.fastModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 10,
      },
      { timeout: 15_000 }
    );

    return {
      isHealthy: true,
      latencyMs: Date.now() - start,
      model: groqConfig.fastModel,
    };
  } catch (err: any) {
    return {
      isHealthy: false,
      latencyMs: Date.now() - start,
      model: groqConfig.fastModel,
      errorMessage: err.message || "Failed to communicate with Groq API",
    };
  }
}
