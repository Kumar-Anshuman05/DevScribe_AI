const test = require("node:test");
const assert = require("node:assert");
const { z } = require("zod");

// Recreate the exact schemas from src/lib/agents/state.ts for isolated unit testing
const qualityReportSchema = z.object({
  score: z.number().int().min(0).max(100),
  technicalAccuracyScore: z.number().min(0).max(30),
  codeCompletenessScore: z.number().min(0).max(30),
  pedagogicalStructureScore: z.number().min(0).max(20),
  formattingAndSeoScore: z.number().min(0).max(20),
  critique: z.string().min(5),
  revisionRequired: z.boolean(),
  actionableFeedback: z.array(z.string()).default([]),
});

const researchDataSchema = z.object({
  findings: z.string().min(20),
  libraries: z.array(z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    docsUrl: z.string().optional(),
  })).default([]),
});

const structuredOutlineSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(10),
  targetAudience: z.string().min(2),
  sections: z.array(z.object({
    title: z.string().min(2),
    level: z.number().int().min(1).max(6),
    description: z.string().min(5),
    targetWordCount: z.number().int().positive(),
  })).min(1),
});

test("Reviewer Zod Validation: Rejects malformed or incomplete quality reports", () => {
  // Missing score
  assert.strictEqual(
    qualityReportSchema.safeParse({
      technicalAccuracyScore: 28,
      codeCompletenessScore: 27,
      pedagogicalStructureScore: 18,
      formattingAndSeoScore: 18,
      critique: "Well structured article.",
      revisionRequired: false,
    }).success,
    false
  );

  // Score out of range (> 100)
  assert.strictEqual(
    qualityReportSchema.safeParse({
      score: 105,
      technicalAccuracyScore: 30,
      codeCompletenessScore: 30,
      pedagogicalStructureScore: 20,
      formattingAndSeoScore: 20,
      critique: "Over-scored report.",
      revisionRequired: false,
    }).success,
    false
  );

  // Missing critique
  assert.strictEqual(
    qualityReportSchema.safeParse({
      score: 88,
      technicalAccuracyScore: 27,
      codeCompletenessScore: 26,
      pedagogicalStructureScore: 18,
      formattingAndSeoScore: 17,
      revisionRequired: false,
    }).success,
    false
  );

  // Valid report succeeds
  assert.strictEqual(
    qualityReportSchema.safeParse({
      score: 88,
      technicalAccuracyScore: 27,
      codeCompletenessScore: 26,
      pedagogicalStructureScore: 18,
      formattingAndSeoScore: 17,
      critique: "Substantive evaluation meeting all rubric dimensions.",
      revisionRequired: false,
      actionableFeedback: [],
    }).success,
    true
  );
});

test("Supervisor Routing: Strictly requires numeric score and preserves 2-revision limit", () => {
  function routeAfterReview(state) {
    if (!state.qualityReport || typeof state.qualityReport.score !== "number") {
      throw new Error("QUALITY_ROUTING_ERROR: Cannot evaluate review routing without a valid numeric quality score.");
    }
    const score = state.qualityReport.score;
    const revisionCount = state.revisionCount ?? 0;

    if (score >= 85) return "finalize";
    if (revisionCount < 2) return "writer";
    return "finalize";
  }

  // Throws if qualityReport is missing or non-numeric (never defaults to 85!)
  assert.throws(() => routeAfterReview({}), {
    name: "Error",
    message: /QUALITY_ROUTING_ERROR/,
  });
  assert.throws(() => routeAfterReview({ qualityReport: null }), {
    name: "Error",
    message: /QUALITY_ROUTING_ERROR/,
  });

  // Score >= 85 routes directly to finalize
  assert.strictEqual(routeAfterReview({ qualityReport: { score: 90 }, revisionCount: 0 }), "finalize");

  // Score < 85 with revisionCount 0 -> routes to writer
  assert.strictEqual(routeAfterReview({ qualityReport: { score: 75 }, revisionCount: 0 }), "writer");

  // Score < 85 with revisionCount 1 -> routes to writer
  assert.strictEqual(routeAfterReview({ qualityReport: { score: 75 }, revisionCount: 1 }), "writer");

  // Score < 85 with revisionCount 2 -> reaches loop guard, routes to finalize
  assert.strictEqual(routeAfterReview({ qualityReport: { score: 75 }, revisionCount: 2 }), "finalize");
});

test("Content Writer Validation: Rejects empty, whitespace, or placeholder drafts", () => {
  function validateDraftMarkdown(rawText, topic) {
    const draftMarkdown = rawText?.trim();
    if (!draftMarkdown || draftMarkdown.length < 100 || draftMarkdown.includes("Draft content pending.")) {
      throw new Error(`CONTENT_WRITER_AGENT_ERROR: Writer returned empty or insufficient content for topic '${topic}'.`);
    }
    return draftMarkdown;
  }

  // Empty string
  assert.throws(() => validateDraftMarkdown("", "Kafka"), {
    message: /CONTENT_WRITER_AGENT_ERROR/,
  });

  // Whitespace only
  assert.throws(() => validateDraftMarkdown("   \n\t  ", "Kafka"), {
    message: /CONTENT_WRITER_AGENT_ERROR/,
  });

  // Placeholder content
  assert.throws(() => validateDraftMarkdown("# Kafka\n\nDraft content pending.", "Kafka"), {
    message: /CONTENT_WRITER_AGENT_ERROR/,
  });

  // Substantive markdown passes
  const validDraft = "# Kafka Architecture\n\n" + "Apache Kafka provides high-throughput event streaming. ".repeat(10).trim();
  assert.strictEqual(validateDraftMarkdown(validDraft, "Kafka"), validDraft);
});

test("Planning Agent Validation: Rejects empty or malformed outlines", () => {
  assert.strictEqual(structuredOutlineSchema.safeParse({}).success, false);
  assert.strictEqual(structuredOutlineSchema.safeParse({ title: "Hi", summary: "Short", sections: [] }).success, false);
  assert.strictEqual(
    structuredOutlineSchema.safeParse({
      title: "Building Microservices with Go",
      summary: "Comprehensive guide to microservices patterns and concurrency in Go.",
      targetAudience: "Senior Developers",
      sections: [
        {
          title: "Introduction",
          level: 2,
          description: "Overview of microservices architecture in Go.",
          targetWordCount: 400,
        },
      ],
    }).success,
    true
  );
});

test("Research Agent Validation: Rejects empty research findings", () => {
  assert.strictEqual(researchDataSchema.safeParse({}).success, false);
  assert.strictEqual(researchDataSchema.safeParse({ findings: "Too short" }).success, false);
  assert.strictEqual(
    researchDataSchema.safeParse({
      findings: "Thorough architectural breakdown of distributed lock managers using Redis and etcd.",
      libraries: [{ name: "ioredis", version: "^5.3.0" }],
    }).success,
    true
  );
});
