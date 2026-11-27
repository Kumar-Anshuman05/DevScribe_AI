import { structuredOutlineSchema } from "./state";
import type { ArticleStateType, StructuredOutline } from "./state";
import { callGroqJson, groqConfig } from "../groq/config";

export const PLANNING_SYSTEM_PROMPT = `You are the Planning Agent for DevScribe AI, a technical pedagogy and curriculum architect.
Your mission is to design a publication-grade outline for technical articles and programming tutorials.

Guidelines:
1. For TUTORIAL: Structure must be hands-on, sequential, and reproducible:
   - Prerequisites & Environment Setup
   - Core Architecture & Project Layout
   - Step-by-Step Implementation with granular code explanations
   - Verification, Edge Cases & Testing
   - Summary & Further Learning
3. Keep section descriptions concise (1-2 sentences per section). Provide between 3 to 5 core sections.

Output must strictly conform to this JSON schema:
{
  "title": "Compelling, SEO-Optimized Title",
  "summary": "High-impact 2-3 sentence overview of the article.",
  "targetAudience": "Audience level",
  "sections": [
    {
      "title": "Section Title",
      "level": 2,
      "description": "Granular summary of topics, diagrams, and code to include.",
      "targetWordCount": 400,
      "learningObjectives": ["Objective 1", "Objective 2"],
      "keyTopics": ["Topic A", "Topic B"]
    }
  ]
}`;

export async function planningAgentNode(state: ArticleStateType): Promise<Partial<ArticleStateType>> {
  const startedAt = Date.now();
  console.log(`[Planning Agent] START jobId=${state.jobId} topic="${state.topic}" model=${groqConfig.fastModel}`);

  if (!state.research || !state.research.findings?.trim()) {
    throw new Error(`PLANNING_AGENT_ERROR: Cannot generate outline for topic '${state.topic}' without valid preceding research findings.`);
  }

  const prompt = `Topic: ${state.topic}
Content Type: ${state.contentType}
Target Audience: ${state.targetAudience}
Tone: ${state.tone}
Target Word Count: ${state.targetWordCount} words
Primary Language: ${state.primaryLanguage || "N/A"}
Frameworks: ${state.frameworks.join(", ") || "N/A"}
Additional Guidelines: ${state.additionalGuidelines || "None"}

Research Findings Summary:
${state.research.findings}

Create the comprehensive structured outline JSON:`;

  try {
    const parsedJson = await callGroqJson({
      model: groqConfig.fastModel,
      systemPrompt: PLANNING_SYSTEM_PROMPT,
      userPrompt: prompt,
      temperature: 0.3,
      maxTokens: 2500,
      requestName: "planning_agent",
    });

    const validation = structuredOutlineSchema.safeParse(parsedJson);
    if (!validation.success) {
      throw new Error(`Outline validation failed: ${JSON.stringify(validation.error.format())}`);
    }

    const parsed: StructuredOutline = validation.data;

    console.log(
      `[Planning Agent] COMPLETE jobId=${state.jobId} durationMs=${Date.now() - startedAt} sections=${parsed.sections.length}`
    );

    return {
      outline: parsed,
      status: "WRITING",
    };
  } catch (err: any) {
    console.error(`[Planning Agent] ERROR jobId=${state.jobId} durationMs=${Date.now() - startedAt}:`, err);
    throw new Error(`PLANNING_AGENT_ERROR: Failed to generate structured outline for topic '${state.topic}': ${err.message}`);
  }
}
