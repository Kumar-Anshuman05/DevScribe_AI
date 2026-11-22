import { getAiClient, geminiConfig } from "./config";

export interface GeminiHealthStatus {
  isHealthy: boolean;
  latencyMs: number;
  model: string;
  errorMessage?: string;
  timestamp: string;
}

/**
 * Sends a minimal 1-token probe request to verify Gemini API key validity and model responsiveness.
 */
export async function checkGeminiHealth(): Promise<GeminiHealthStatus> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  if (!geminiConfig.apiKey) {
    return {
      isHealthy: false,
      latencyMs: 0,
      model: geminiConfig.fastModel,
      errorMessage: "GEMINI_API_KEY is not configured.",
      timestamp,
    };
  }

  try {
    const ai = getAiClient();
    // Use fastModel for quick 1-token health ping
    const response = await ai.models.generateContent({
      model: geminiConfig.fastModel,
      contents: "ping",
      config: {
        maxOutputTokens: 2,
        temperature: 0,
      },
    });

    const latencyMs = Date.now() - startTime;
    return {
      isHealthy: Boolean(response && response.text),
      latencyMs,
      model: geminiConfig.fastModel,
      timestamp,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      isHealthy: false,
      latencyMs,
      model: geminiConfig.fastModel,
      errorMessage: err.message || "Failed to communicate with Gemini API",
      timestamp,
    };
  }
}
