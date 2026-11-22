import { Annotation } from "@langchain/langgraph";

export interface GroundingSource {
  title: string;
  url: string;
  snippet?: string;
  retrievedAt: string;
}

export interface ResearchData {
  findings: string;
  libraries: Array<{ name: string; version: string; docsUrl?: string }>;
  sources: GroundingSource[];
}

export interface OutlineSection {
  title: string;
  level: number;
  description: string;
  targetWordCount: number;
  learningObjectives?: string[];
  keyTopics?: string[];
}

export interface StructuredOutline {
  title: string;
  summary: string;
  targetAudience: string;
  sections: OutlineSection[];
}

export interface CodeBlockItem {
  language: string;
  code: string;
  isValid?: boolean;
  errors?: string[];
}

export interface CodeValidationResult {
  allValid: boolean;
  blocksValidated: number;
  blocks: CodeBlockItem[];
  syntaxErrors: string[];
}

export interface QualityReport {
  score: number;
  technicalAccuracyScore: number; // 30% weight
  codeCompletenessScore: number; // 30% weight
  pedagogicalStructureScore: number; // 20% weight
  formattingAndSeoScore: number; // 20% weight
  critique: string;
  revisionRequired: boolean;
  actionableFeedback?: string[];
}

/**
 * ArticleState Definition for LangGraph.js cyclic multi-agent graph.
 */
export const ArticleStateAnnotation = Annotation.Root({
  // Job identification and parameters
  jobId: Annotation<string>(),
  threadId: Annotation<string>(),
  userId: Annotation<string>(),
  topic: Annotation<string>(),
  contentType: Annotation<"BLOG" | "TUTORIAL">(),
  targetAudience: Annotation<string>(),
  tone: Annotation<"DIDACTIC" | "CONVERSATIONAL" | "ENTERPRISE_ARCHITECTURAL">(),
  targetWordCount: Annotation<number>(),
  primaryLanguage: Annotation<string | null>(),
  frameworks: Annotation<string[]>({
    reducer: (x, y) => (y !== undefined ? y : x ?? []),
    default: () => [],
  }),
  additionalGuidelines: Annotation<string | null>(),

  // Agent Intermediate Outputs
  research: Annotation<ResearchData | null>(),
  outline: Annotation<StructuredOutline | null>(),
  draftMarkdown: Annotation<string | null>(),
  codeValidation: Annotation<CodeValidationResult | null>(),
  qualityReport: Annotation<QualityReport | null>(),

  // Execution Control & Loop Guard
  revisionCount: Annotation<number>({
    reducer: (x, y) => (y !== undefined ? y : x ?? 0),
    default: () => 0,
  }),
  status: Annotation<"QUEUED" | "RESEARCHING" | "PLANNING" | "WRITING" | "VALIDATING_CODE" | "REVIEWING" | "COMPLETED" | "COMPLETED_WITH_WARNINGS" | "FAILED">(),
  errorMessage: Annotation<string | null>(),
});

export type ArticleStateType = typeof ArticleStateAnnotation.State;
