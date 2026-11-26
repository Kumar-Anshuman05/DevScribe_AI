import { structuredOutlineSchema } from "./state";
import type { ArticleStateType, StructuredOutline } from "./state";
import { getAiClient, geminiConfig } from "../gemini/config";

export const PLANNING_SYSTEM_PROMPT = `You are the Planning Agent for DevScribe AI, a technical pedagogy and curriculum architect.
Your mission is to design a publication-grade outline for technical articles and programming tutorials.

Guidelines:
1. For TUTORIAL: Structure must be hands-on, sequential, and reproducible:
   - Prerequisites & Environment Setup
   - Core Architecture & Project Layout
   - Step-by-Step Implementation with granular code explanations
   - Verification, Edge Cases & Testing
   - Summary & Further Learning
2. For BLOG: Structure must be analytical and conceptual:
   - Executive Overview & Problem Context
   - Technical Deep Dive / Core Mechanics
   - Trade-off Analysis & Production Considerations
   - Real-World Case Studies / Patterns
   - Future Outlook & Architectural Recommendations

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
  console.log(`[Planning Agent] Designing structured outline for topic: "${state.topic}"`);

  if (!state.research || !state.research.findings?.trim()) {
    throw new Error(`PLANNING_AGENT_ERROR: Cannot generate outline for topic '${state.topic}' without valid preceding research findings.`);
  }

  const ai = getAiClient();

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
    const response = await ai.models.generateContent({
      model: geminiConfig.fastModel,
      contents: [
        { role: "user", parts: [{ text: `${PLANNING_SYSTEM_PROMPT}\n\n${prompt}` }] },
      ],
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });

    const rawText = response.text?.trim();
    if (!rawText) {
      throw new Error("Empty response received from LLM during outline planning.");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch (parseErr: any) {
      throw new Error(`LLM output was not valid JSON: ${parseErr.message}`);
    }

    const validation = structuredOutlineSchema.safeParse(parsedJson);
    if (!validation.success) {
      throw new Error(`Outline validation failed: ${JSON.stringify(validation.error.format())}`);
    }

    const parsed: StructuredOutline = validation.data;

    return {
      outline: parsed,
      status: "WRITING",
    };
  } catch (err: any) {
    console.error("[Planning Agent] Error generating outline:", err);
    // Propagate error to terminate workflow in failure rather than returning synthetic success or empty outline
    throw new Error(`PLANNING_AGENT_ERROR: Failed to generate structured outline for topic '${state.topic}': ${err.message}`);
  }
}
