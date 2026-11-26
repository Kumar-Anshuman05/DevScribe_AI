import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

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

export const researchDataSchema = z.object({
  findings: z.string().min(20, "Research findings must be substantive and non-empty"),
  libraries: z
    .array(
      z.object({
        name: z.string().min(1),
        version: z.string().min(1),
        docsUrl: z.string().optional(),
      })
    )
    .default([]),
});

export interface OutlineSection {
  title: string;
  level: number;
  description: string;
  targetWordCount: number;
  learningObjectives?: string[];
  keyTopics?: string[];
}

export const outlineSectionSchema = z.object({
  title: z.string().min(2, "Section title required"),
  level: z.number().int().min(1).max(6),
  description: z.string().min(5, "Section description must be descriptive"),
  targetWordCount: z.number().int().positive(),
  learningObjectives: z.array(z.string()).optional(),
  keyTopics: z.array(z.string()).optional(),
});

export interface StructuredOutline {
  title: string;
  summary: string;
  targetAudience: string;
  sections: OutlineSection[];
}

export const structuredOutlineSchema = z.object({
  title: z.string().min(3, "Outline title must be at least 3 characters"),
  summary: z.string().min(10, "Outline summary must be substantive"),
  targetAudience: z.string().min(2),
  sections: z.array(outlineSectionSchema).min(1, "Outline must contain at least one section"),
});

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

export const qualityReportSchema = z.object({
  score: z.number().int().min(0).max(100),
  technicalAccuracyScore: z.number().min(0).max(30),
  codeCompletenessScore: z.number().min(0).max(30),
  pedagogicalStructureScore: z.number().min(0).max(20),
  formattingAndSeoScore: z.number().min(0).max(20),
  critique: z.string().min(5, "Critique must be substantive"),
  revisionRequired: z.boolean(),
  actionableFeedback: z.array(z.string()).default([]),
});

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
