import { StateGraph, END } from "@langchain/langgraph";
import { ArticleStateAnnotation } from "./state";
import type { ArticleStateType } from "./state";
import { researchAgentNode } from "./researcher";
import { planningAgentNode } from "./planner";
import { contentWriterAgentNode } from "./writer";
import { validateArticleCode } from "./codeValidator";
import { qualityReviewerAgentNode } from "./reviewer";
import { getSafeCheckpointer } from "./checkpointer";

/**
 * Code Validation Node: runs deterministic AST syntax checks on the draft markdown.
 */
async function codeValidationNode(state: ArticleStateType): Promise<Partial<ArticleStateType>> {
  console.log(`[Code Validator Node] Validating code snippets for topic: "${state.topic}"`);
  const markdown = state.draftMarkdown || "";
  const validationResult = validateArticleCode(markdown);

  return {
    codeValidation: validationResult,
    status: "VALIDATING_CODE",
  };
}

/**
 * Supervisor Routing Function: Evaluates Quality Review score and loop guard.
 * Strictly requires a valid QualityReport with a numeric score.
 * Rules:
 * - Score >= 85 -> "finalize_completed"
 * - Score < 85 AND revisionCount < 2 -> "revise_draft" (increments revisionCount)
 * - Score < 85 AND revisionCount >= 2 -> "finalize_with_warnings"
 */
function routeAfterReview(state: ArticleStateType): "writer" | "finalize" {
  if (
    state.qualityReport === null ||
    state.qualityReport === undefined ||
    typeof state.qualityReport.score !== "number"
  ) {
    throw new Error("QUALITY_ROUTING_ERROR: Cannot evaluate review routing without a valid numeric quality score.");
  }

  const score = state.qualityReport.score;
  const revisionCount = state.revisionCount ?? 0;

  console.log(`[Supervisor Router] Review score: ${score}/100, Revision count: ${revisionCount}/2`);

  if (score >= 85) {
    console.log("[Supervisor Router] Quality threshold met (>= 85). Finalizing job as COMPLETED.");
    return "finalize";
  }

  if (revisionCount < 2) {
    console.log(`[Supervisor Router] Score below threshold (${score} < 85). Routing to Writer for Revision ${revisionCount + 1}.`);
    return "writer";
  }

  console.log("[Supervisor Router] Maximum revisions reached (2). Finalizing as COMPLETED_WITH_WARNINGS.");
  return "finalize";
}

/**
 * Finalization Node: sets terminal job status based on evaluated score.
 * Never defaults to successful score if qualityReport is missing.
 */
async function finalizeNode(state: ArticleStateType): Promise<Partial<ArticleStateType>> {
  if (
    state.qualityReport === null ||
    state.qualityReport === undefined ||
    typeof state.qualityReport.score !== "number"
  ) {
    throw new Error("FINALIZATION_ERROR: Cannot finalize job without a valid numeric quality score.");
  }

  const score = state.qualityReport.score;
  const terminalStatus = score >= 85 ? "COMPLETED" : "COMPLETED_WITH_WARNINGS";

  return {
    status: terminalStatus,
  };
}

/**
 * Pre-revision state updater to increment revision counter before re-invoking writer.
 */
async function revisionCounterNode(state: ArticleStateType): Promise<Partial<ArticleStateType>> {
  return {
    revisionCount: (state.revisionCount ?? 0) + 1,
    status: "WRITING",
  };
}

/**
 * Constructs and compiles the LangGraph Multi-Agent Workflow.
 * Durable PostgreSQL checkpointer is required; fails fast if not available.
 */
export async function createDevScribeAgentGraph() {
  const workflow = new StateGraph(ArticleStateAnnotation)
    // 1. Add Agent Nodes
    .addNode("researcher", researchAgentNode)
    .addNode("planner", planningAgentNode)
    .addNode("writer", contentWriterAgentNode)
    .addNode("code_validator", codeValidationNode)
    .addNode("reviewer", qualityReviewerAgentNode)
    .addNode("revision_counter", revisionCounterNode)
    .addNode("finalizer", finalizeNode)

    // 2. Add Fixed Edges
    .addEdge("__start__", "researcher")
    .addEdge("researcher", "planner")
    .addEdge("planner", "writer")
    .addEdge("writer", "code_validator")
    .addEdge("code_validator", "reviewer")

    // 3. Add Conditional Quality Routing Edge
    .addConditionalEdges("reviewer", routeAfterReview, {
      writer: "revision_counter",
      finalize: "finalizer",
    })
    .addEdge("revision_counter", "writer")
    .addEdge("finalizer", END);

  // Enforce durable PostgreSQL checkpointer unconditionally
  const checkpointer = await getSafeCheckpointer();
  return workflow.compile({ checkpointer });
}
