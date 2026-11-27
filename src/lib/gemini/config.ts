import { GoogleGenAI } from "@google/genai";

export const geminiConfig = {
  fastModel: process.env.GEMINI_MODEL_FAST || "gemini-3.8-flash",
  reasoningModel: process.env.GEMINI_MODEL_REASONING || "gemini-3.8-flash",
  apiKey: process.env.GEMINI_API_KEY || "",
  searchProvider: process.env.RESEARCH_SEARCH_PROVIDER || "gemini_grounding",
};

let genAIClient: GoogleGenAI | null = null;

export function getAiClient(): GoogleGenAI {
  if (!genAIClient) {
    const apiKey = geminiConfig.apiKey || process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
      console.warn("⚠️ Warning: GEMINI_API_KEY environment variable is missing.");
    }
    genAIClient = new GoogleGenAI({ apiKey });
  }
  return genAIClient;
}

export const aiClient = getAiClient();
