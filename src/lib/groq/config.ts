import { Groq } from "groq-sdk";

export const GROQ_REQUEST_TIMEOUT_MS = 75_000; // 75s bounded timeout (within 60-90s target)
export const GROQ_MAX_RATE_LIMIT_BACKOFF_MS = 65_000;

export const groqConfig = {
  apiKey: process.env.GROQ_API_KEY || "",
  fastModel: process.env.GROQ_MODEL_FAST || "openai/gpt-oss-20b",
  reasoningModel: process.env.GROQ_MODEL_REASONING || "openai/gpt-oss-20b",
  searchProvider: process.env.RESEARCH_SEARCH_PROVIDER || "duckduckgo",
  requestTimeoutMs: GROQ_REQUEST_TIMEOUT_MS,
};

let groqClientInstance: Groq | null = null;

export function getGroqClient(): Groq {
  if (!groqClientInstance) {
    const apiKey = groqConfig.apiKey || process.env.GROQ_API_KEY || "";
    if (!apiKey) {
      console.warn("⚠️ Warning: GROQ_API_KEY environment variable is missing.");
    }
    groqClientInstance = new Groq({
      apiKey,
      timeout: GROQ_REQUEST_TIMEOUT_MS,
      maxRetries: 0, // Retries are explicitly bounded in executeGroqCompletion
    });
  }
  return groqClientInstance;
}

export const groqClient = getGroqClient();

function getRetryAfterMs(err: any): number {
  const msg = err?.error?.message || err?.message || "";
  const match = msg.match(/try again in ([\d.]+)s/i);
  if (match && match[1]) {
    const parsedMs = Math.ceil(parseFloat(match[1]) + 2) * 1000;
    return Math.min(parsedMs, GROQ_MAX_RATE_LIMIT_BACKOFF_MS);
  }
  return 25_000;
}

export type GroqChatCompletionParams = Parameters<Groq["chat"]["completions"]["create"]>[0];

export interface GroqExecutionOptions {
  requestName?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

/**
 * Resilient Groq Chat Completion with strict 75s request timeout,
 * bounded 429 Rate Limit backoff (max 2 attempts), and start/completion/duration/error logging.
 */
export async function executeGroqCompletion(
  params: GroqChatCompletionParams,
  options: GroqExecutionOptions = {}
): Promise<Groq.Chat.ChatCompletion> {
  const groq = getGroqClient();
  const maxAttempts = options.maxAttempts ?? 2;
  const timeoutMs = options.timeoutMs ?? GROQ_REQUEST_TIMEOUT_MS;
  const requestName = options.requestName || "groq_completion";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    console.log(
      `[Groq Request Start] op=${requestName} model=${params.model} attempt=${attempt}/${maxAttempts} max_tokens=${params.max_tokens ?? "default"} timeoutMs=${timeoutMs}`
    );

    try {
      const completion = (await groq.chat.completions.create(params, {
        timeout: timeoutMs,
        signal: controller.signal,
      })) as Groq.Chat.ChatCompletion;

      const durationMs = Date.now() - attemptStart;
      console.log(
        `[Groq Request Complete] op=${requestName} model=${params.model} durationMs=${durationMs} promptTokens=${completion.usage?.prompt_tokens ?? "?"} completionTokens=${completion.usage?.completion_tokens ?? "?"}`
      );
      return completion;
    } catch (err: any) {
      const durationMs = Date.now() - attemptStart;
      const isTimeout = err?.name === "AbortError" || err?.name === "APIConnectionTimeoutError" || /aborted|timeout/i.test(err?.message || "");
      const status = err?.status ?? (isTimeout ? "TIMEOUT" : "UNKNOWN");

      console.error(
        `[Groq Request Error] op=${requestName} model=${params.model} attempt=${attempt}/${maxAttempts} durationMs=${durationMs} status=${status} error=${err?.message || String(err)}`
      );

      if (err?.status === 413) {
        throw new Error(
          `GROQ_PAYLOAD_TOO_LARGE: Request exceeded Groq model TPM/payload limit (${err.message})`
        );
      }

      if (err?.status === 429 && attempt < maxAttempts) {
        const waitMs = getRetryAfterMs(err);
        console.warn(
          `[Groq Rate Limit] op=${requestName} 429 TPM limit reached. Backing off for ${waitMs / 1000}s (Attempt ${attempt}/${maxAttempts})...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (isTimeout) {
        throw new Error(`GROQ_TIMEOUT: op=${requestName} timed out after ${timeoutMs}ms`);
      }

      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Groq completion (${requestName}) failed after ${maxAttempts} bounded attempts.`);
}

/**
 * Attempts to repair truncated JSON strings where tokens ran out before closing quotes or brackets.
 */
function tryRepairTruncatedJson(raw: string): any {
  let text = raw.trim();
  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return null;
  text = text.slice(firstBrace);

  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
    } else if (c === "\\") {
      escape = true;
    } else if (c === '"') {
      inString = !inString;
    }
  }

  let repaired = text;
  if (inString) {
    repaired += '"';
  }

  let openBraces = 0;
  let openBrackets = 0;
  inString = false;
  escape = false;
  for (let i = 0; i < repaired.length; i++) {
    const c = repaired[i];
    if (escape) {
      escape = false;
    } else if (c === "\\") {
      escape = true;
    } else if (c === '"') {
      inString = !inString;
    } else if (!inString) {
      if (c === "{") openBraces++;
      else if (c === "}") openBraces--;
      else if (c === "[") openBrackets++;
      else if (c === "]") openBrackets--;
    }
  }

  while (openBrackets > 0) {
    repaired += "]";
    openBrackets--;
  }
  while (openBraces > 0) {
    repaired += "}";
    openBraces--;
  }

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

/**
 * Robust JSON extraction helper that parses raw text or fenced ```json blocks.
 */
export function extractAndParseJson(text: string): any {
  if (!text || !text.trim()) {
    throw new Error("Empty text received for JSON parsing");
  }

  try {
    return JSON.parse(text.trim());
  } catch {
    // continue
  }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonCandidate);
    } catch {
      // continue
    }
  }

  const repaired = tryRepairTruncatedJson(text);
  if (repaired) {
    return repaired;
  }

  throw new Error(`Failed to extract valid JSON from LLM output. Raw snippet: ${text.slice(0, 200)}`);
}

export interface CallGroqJsonOptions {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  requestName?: string;
  timeoutMs?: number;
}

/**
 * Resilient Groq JSON completion caller.
 * Handles both strict json_object mode and regex extraction fallback only on JSON validation failure.
 * Enforces bounded timeouts and fails fast on 413 or timeout errors.
 */
export async function callGroqJson(options: CallGroqJsonOptions): Promise<any> {
  const maxTokens = options.maxTokens || 2500;
  const temperature = options.temperature ?? 0.2;
  const requestName = options.requestName || "groq_json";
  const timeoutMs = options.timeoutMs ?? GROQ_REQUEST_TIMEOUT_MS;

  // Attempt 1: Strict JSON Object mode
  try {
    const completion = await executeGroqCompletion(
      {
        model: options.model,
        messages: [
          {
            role: "system",
            content: `${options.systemPrompt}\n\nCRITICAL: Respond ONLY with a valid JSON object. Do not wrap in markdown or backticks.`,
          },
          { role: "user", content: options.userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature,
        max_tokens: maxTokens,
      },
      { requestName: `${requestName}_strict`, timeoutMs }
    );

    const content = completion.choices[0]?.message?.content?.trim();
    if (content) {
      return extractAndParseJson(content);
    }
  } catch (err: any) {
    const isJsonValidationError =
      err?.status === 400 &&
      (err?.error?.code === "json_validate_failed" || err?.message?.includes("json_validate_failed"));

    if (!isJsonValidationError) {
      throw err;
    }

    console.warn(
      `[Groq JSON Caller] op=${requestName} strict JSON validation failed (${err.message}). Retrying once without response_format constraint...`
    );

    // Attempt 2: Flexible extraction without response_format constraint (only for json_validate_failed)
    const fallbackCompletion = await executeGroqCompletion(
      {
        model: options.model,
        messages: [
          {
            role: "system",
            content: `${options.systemPrompt}\n\nIMPORTANT: Return ONLY the JSON object. Do not include introductory or concluding commentary.`,
          },
          { role: "user", content: options.userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      },
      { requestName: `${requestName}_fallback`, timeoutMs }
    );

    const fallbackContent = fallbackCompletion.choices[0]?.message?.content?.trim();
    if (fallbackContent) {
      return extractAndParseJson(fallbackContent);
    }
  }

  throw new Error(`Groq (${requestName}) failed to return a valid JSON response.`);
}
