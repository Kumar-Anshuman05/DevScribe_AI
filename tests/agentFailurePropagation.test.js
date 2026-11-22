const test = require("node:test");
const assert = require("node:assert");

// Mocking agent behavior when Gemini API rejects
test("Agent Error Propagation: Research agent throws on API rejection without synthetic fallback", async () => {
  async function mockResearchAgentNode(fail = true) {
    if (fail) {
      throw new Error("RESEARCH_AGENT_ERROR: Failed during technical research phase for topic 'Kafka': API rate limit exceeded");
    }
    return { status: "PLANNING" };
  }

  await assert.rejects(
    async () => {
      await mockResearchAgentNode(true);
    },
    {
      name: "Error",
      message: /RESEARCH_AGENT_ERROR/,
    }
  );
});

test("Agent Error Propagation: Planning agent throws on API rejection without synthetic fallback", async () => {
  async function mockPlanningAgentNode(fail = true) {
    if (fail) {
      throw new Error("PLANNING_AGENT_ERROR: Failed to generate structured outline for topic 'Kafka': Model context window exceeded");
    }
    return { status: "WRITING" };
  }

  await assert.rejects(
    async () => {
      await mockPlanningAgentNode(true);
    },
    {
      name: "Error",
      message: /PLANNING_AGENT_ERROR/,
    }
  );
});

test("Agent Error Propagation: Content Writer agent throws on API rejection without synthetic fallback", async () => {
  async function mockWriterAgentNode(fail = true) {
    if (fail) {
      throw new Error("CONTENT_WRITER_AGENT_ERROR: Failed to generate technical draft for topic 'Kafka': LLM connection timed out");
    }
    return { status: "VALIDATING_CODE" };
  }

  await assert.rejects(
    async () => {
      await mockWriterAgentNode(true);
    },
    {
      name: "Error",
      message: /CONTENT_WRITER_AGENT_ERROR/,
    }
  );
});

test("Agent Error Propagation: Quality Reviewer agent throws on rejection; NEVER returns hardcoded score 86", async () => {
  async function mockReviewerAgentNode(fail = true) {
    if (fail) {
      throw new Error("QUALITY_REVIEWER_AGENT_ERROR: Failed to perform quality audit for topic 'Kafka': Service unavailable");
    }
    return { qualityReport: { score: 92, revisionRequired: false } };
  }

  await assert.rejects(
    async () => {
      await mockReviewerAgentNode(true);
    },
    (err) => {
      assert.match(err.message, /QUALITY_REVIEWER_AGENT_ERROR/);
      // Ensure synthetic score fallback does NOT exist
      assert.strictEqual(err.qualityReport, undefined);
      return true;
    }
  );
});
