import { ArticleStateType } from "./state";
import { getAiClient, geminiConfig } from "../gemini/config";

export const WRITER_SYSTEM_PROMPT = `You are the Content Writer Agent for DevScribe AI, an elite software engineering author.
Your objective is to produce production-grade, publication-ready technical blog posts and step-by-step programming tutorials.

MANDATORY EDITORIAL STANDARDS:
1. Markdown Formatting: Output strictly valid GitHub-Flavored Markdown (GFM). Use proper headers (##, ###), callout blocks (> [!NOTE], > [!TIP], > [!WARNING]), and markdown tables.
2. Code Blocks: ALL code snippets MUST be fenced with specific language tags (e.g., \`\`\`typescript, \`\`\`python, \`\`\`rust, \`\`\`json).
3. Syntactic Correctness: Ensure ALL code snippets are 100% syntactically valid with matching brackets, complete import statements, and realistic type definitions. No ellipses inside code structures where it would break syntax!
4. Technical Depth: Avoid generic fluff or boilerplate explanations. Explain architectural reasoning, performance implications, memory/concurrency trade-offs, and failure recovery.
5. Grounding Citations: Integrate research references naturally with markdown links.
6. Diagrams: Where appropriate, embed Mermaid.js architecture diagrams using \`\`\`mermaid.`;

export async function contentWriterAgentNode(state: ArticleStateType): Promise<Partial<ArticleStateType>> {
  console.log(`[Content Writer Agent] Writing article draft for topic: "${state.topic}" (Revision: ${state.revisionCount})`);

  if (!state.outline || !state.outline.sections || state.outline.sections.length === 0) {
    throw new Error(`CONTENT_WRITER_AGENT_ERROR: Cannot write draft for topic '${state.topic}' without valid structured outline.`);
  }

  const ai = getAiClient();

  const isRevision = state.revisionCount > 0 && state.qualityReport?.actionableFeedback;
  const feedbackContext = isRevision
    ? `\nCRITICAL EDITORIAL REVISION FEEDBACK (Score: ${state.qualityReport?.score}/100):\n` +
      `Critique: ${state.qualityReport?.critique}\n` +
      `Required Fixes:\n${(state.qualityReport?.actionableFeedback || []).map((f) => `- ${f}`).join("\n")}\n` +
      `Code Syntax Issues:\n${(state.codeValidation?.syntaxErrors || []).map((e) => `- ${e}`).join("\n")}\n`
    : "";

  const prompt = `Topic: ${state.topic}
Content Type: ${state.contentType}
Target Audience: ${state.targetAudience}
Tone: ${state.tone}
Target Word Count: ${state.targetWordCount} words
Primary Language: ${state.primaryLanguage || "None"}
Frameworks: ${state.frameworks.join(", ") || "None"}
Additional Guidelines: ${state.additionalGuidelines || "None"}

Structured Outline:
${JSON.stringify(state.outline, null, 2)}

Grounding Research & Libraries:
${JSON.stringify(state.research, null, 2)}
${feedbackContext}

Write the complete, publication-grade markdown article now:`;

  try {
    const response = await ai.models.generateContent({
      model: geminiConfig.reasoningModel,
      contents: [
        { role: "user", parts: [{ text: `${WRITER_SYSTEM_PROMPT}\n\n${prompt}` }] },
      ],
      config: {
        temperature: 0.4,
      },
    });

    const draftMarkdown = response.text?.trim();

    // Reject empty, whitespace, or placeholder content
    if (!draftMarkdown || draftMarkdown.length < 100) {
      throw new Error(`Writer returned empty or insufficient content (length: ${draftMarkdown?.length ?? 0}).`);
    }

    return {
      draftMarkdown,
      status: "VALIDATING_CODE",
    };
  } catch (err: any) {
    console.error("[Content Writer Agent] Error generating draft:", err);
    // Propagate error to terminate workflow in failure rather than returning synthetic placeholder text
    throw new Error(`CONTENT_WRITER_AGENT_ERROR: Failed to generate technical draft for topic '${state.topic}': ${err.message}`);
  }
}
