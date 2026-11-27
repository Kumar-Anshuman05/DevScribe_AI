import { qualityReportSchema } from "./state";
import type { ArticleStateType, QualityReport } from "./state";
import { callGroqJson, groqConfig } from "../groq/config";

export const REVIEWER_SYSTEM_PROMPT = `You are the Lead Technical Reviewer and Quality Auditor for DevScribe AI.
Your responsibility is to strictly evaluate the draft technical article against an enterprise 100-point quality rubric:

1. Technical Accuracy & Contemporary Standards (30 Points):
   - Are library versions, APIs, and conventions modern and accurate?
   - Are architecture patterns and trade-offs correctly articulated?
2. Code Completeness & Syntactic Integrity (30 Points):
   - Are code snippets complete, runnable in context, and syntactically sound?
   - Did the automated AST code validator detect any syntax or delimiter errors?
3. Pedagogical Structure & Clarity (20 Points):
   - Does the content flow logically for the stated audience seniority?
   - Are complex concepts illuminated with clear prose, analogies, or diagrams?
4. Formatting, GFM & SEO Optimization (20 Points):
   - Proper use of headings, callout boxes, code language annotations, and meta descriptions?

DECISION CRITERIA:
- Score >= 85: APPROVED. High publication readiness. revisionRequired = false.
- Score < 85: REVISION REQUIRED. Provide concrete, actionable feedback for the Content Writer. revisionRequired = true.

Output strictly as a valid JSON object matching this schema:
{
  "score": 88,
  "technicalAccuracyScore": 27,
  "codeCompletenessScore": 26,
  "pedagogicalStructureScore": 18,
  "formattingAndSeoScore": 17,
  "critique": "Comprehensive summary of strengths and areas of improvement.",
  "revisionRequired": false,
  "actionableFeedback": [
    "Refactor snippet in section 2 to import X directly",
    "Add callout box for memory consideration"
  ]
}`;

export async function qualityReviewerAgentNode(state: ArticleStateType): Promise<Partial<ArticleStateType>> {
  const startedAt = Date.now();
  console.log(
    `[Quality Reviewer Agent] START jobId=${state.jobId} topic="${state.topic}" revision=${state.revisionCount} model=${groqConfig.reasoningModel}`
  );

  if (!state.draftMarkdown || !state.draftMarkdown.trim()) {
    throw new Error(`QUALITY_REVIEWER_AGENT_ERROR: Cannot review empty draft for topic '${state.topic}'.`);
  }

  const codeAuditInfo = state.codeValidation?.allValid
    ? "Automated Code Validation: ALL code snippets passed AST syntax parsing successfully."
    : `Automated Code Validation: Syntax errors detected in code blocks:\n${(state.codeValidation?.syntaxErrors || []).join("\n")}`;

  // Bound draft payload to fit comfortably within Groq TPM limits alongside system prompt + maxTokens
  const maxDraftChars = 16000;
  const draftForAudit =
    state.draftMarkdown.length > maxDraftChars
      ? `${state.draftMarkdown.slice(0, maxDraftChars)}\n\n[Truncated for TPM limit check; total length ${state.draftMarkdown.length} chars]`
      : state.draftMarkdown;

  const prompt = `Topic: ${state.topic}
Content Type: ${state.contentType}
Target Audience: ${state.targetAudience}
Primary Language: ${state.primaryLanguage || "None"}
Frameworks: ${state.frameworks.join(", ") || "None"}

${codeAuditInfo}

Draft Article Markdown:
${draftForAudit}

Evaluate the article against the 100-point rubric and output the JSON evaluation report:`;

  try {
    const parsedJson = await callGroqJson({
      model: groqConfig.reasoningModel,
      systemPrompt: REVIEWER_SYSTEM_PROMPT,
      userPrompt: prompt,
      temperature: 0.2,
      maxTokens: 1500,
      requestName: "quality_reviewer_agent",
    });

    const validation = qualityReportSchema.safeParse(parsedJson);
    if (!validation.success) {
      throw new Error(`Quality report validation failed: ${JSON.stringify(validation.error.format())}`);
    }

    const parsed: QualityReport = validation.data;

    // Enforce that if automated code validation failed with syntax errors, score cannot exceed 80
    if (!state.codeValidation?.allValid && parsed.score > 80) {
      parsed.score = Math.min(parsed.score, 79);
      parsed.revisionRequired = true;
      parsed.actionableFeedback = [
        ...(parsed.actionableFeedback || []),
        "Fix syntax errors flagged by automated code validation.",
      ];
    }

    console.log(
      `[Quality Reviewer Agent] COMPLETE jobId=${state.jobId} durationMs=${Date.now() - startedAt} score=${parsed.score} revisionRequired=${parsed.revisionRequired}`
    );

    return {
      qualityReport: parsed,
      status: "REVIEWING",
    };
  } catch (err: any) {
    console.error(`[Quality Reviewer Agent] ERROR jobId=${state.jobId} durationMs=${Date.now() - startedAt}:`, err);
    throw new Error(`QUALITY_REVIEWER_AGENT_ERROR: Failed during quality audit for topic '${state.topic}': ${err.message}`);
  }
}
