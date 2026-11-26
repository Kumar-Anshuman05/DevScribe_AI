"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { Card, Badge, Button } from "@/components/ui";
import {
  Sparkles,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Search,
  BookOpen,
  PenTool,
  CheckSquare,
  Award,
} from "lucide-react";

interface JobData {
  id: string;
  threadId: string;
  topic: string;
  contentType: string;
  targetAudience: string;
  tone: string;
  targetWordCount: number;
  primaryLanguage?: string;
  frameworks: string[];
  status: string;
  progress: number;
  revisionCount: number;
  errorMessage?: string;
  createdAt: string;
  article?: {
    id: string;
    title: string;
    slug: string;
    qualityScore: number;
    wordCount: number;
  };
  events: Array<{
    id: string;
    agentName: string;
    eventType: string;
    durationMs?: number;
    createdAt: string;
  }>;
}

const AGENTS = [
  { key: "researcher", name: "Research Agent", icon: Search, stage: "RESEARCHING" },
  { key: "planner", name: "Planning Agent", icon: BookOpen, stage: "PLANNING" },
  { key: "writer", name: "Content Writer", icon: PenTool, stage: "WRITING" },
  { key: "code_validator", name: "AST Code Validator", icon: CheckSquare, stage: "VALIDATING_CODE" },
  { key: "reviewer", name: "Quality Reviewer", icon: Award, stage: "REVIEWING" },
];

export default function JobTelemetryPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const jobId = resolvedParams.id;

  const [job, setJob] = useState<JobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchJob() {
    try {
      const res = await fetch(`/api/v1/jobs/${jobId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to load job.");
      }
      setJob(data.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchJob();
    // Poll every 3 seconds while job is active
    const interval = setInterval(() => {
      if (job && (job.status === "COMPLETED" || job.status === "COMPLETED_WITH_WARNINGS" || job.status === "FAILED")) {
        clearInterval(interval);
      } else {
        fetchJob();
      }
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, job?.status]);

  if (loading) {
    return (
      <div className="py-20 text-center space-y-3">
        <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
        <p className="text-sm text-muted-foreground">Loading job telemetry...</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <Card className="p-8 text-center max-w-lg mx-auto">
        <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
        <h2 className="text-lg font-bold">Failed to Load Job</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">{error || "Job not found."}</p>
        <Link href="/dashboard">
          <Button variant="outline">Return to Dashboard</Button>
        </Link>
      </Card>
    );
  }

  const isTerminal = job.status === "COMPLETED" || job.status === "COMPLETED_WITH_WARNINGS" || job.status === "FAILED";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-muted-foreground">ID: {job.id.slice(0, 8)}...</span>
            <Badge variant="outline" className="text-[10px]">
              {job.contentType}
            </Badge>
            {job.primaryLanguage && (
              <Badge variant="default" className="text-[10px]">
                {job.primaryLanguage}
              </Badge>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">{job.topic}</h1>
        </div>

        <div className="flex items-center gap-3">
          {job.article && (
            <Link href={`/dashboard/articles/${job.article.id}`}>
              <Button className="gap-2">
                <BookOpen className="h-4 w-4" />
                Read Article
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          )}
          <Button variant="outline" size="sm" onClick={fetchJob} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Progress Bar & Status */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Lifecycle State:</span>
            {job.status === "COMPLETED" && (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Completed
              </Badge>
            )}
            {job.status === "COMPLETED_WITH_WARNINGS" && (
              <Badge variant="warning" className="gap-1">
                <AlertCircle className="h-3 w-3" /> Completed with Warnings
              </Badge>
            )}
            {job.status === "FAILED" && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="h-3 w-3" /> Failed
              </Badge>
            )}
            {!isTerminal && (
              <Badge variant="default" className="gap-1 animate-pulse">
                <Clock className="h-3 w-3" /> {job.status}
              </Badge>
            )}
          </div>

          <span className="font-mono text-xs text-muted-foreground">
            Progress: {job.progress}% • Revisions: {job.revisionCount}/2
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.max(5, job.progress)}%` }}
          />
        </div>
      </Card>

      {/* 5-Agent Pipeline Nodes */}
      <div className="space-y-3">
        <h2 className="text-base font-bold">Multi-Agent Cognitive Pipeline</h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {AGENTS.map((agent, idx) => {
            const Icon = agent.icon;
            const isCompleted =
              job.status === "COMPLETED" ||
              job.status === "COMPLETED_WITH_WARNINGS" ||
              job.progress > (idx + 1) * 18;
            const isCurrent = job.status === agent.stage;

            return (
              <Card
                key={agent.key}
                className={`p-4 transition-all ${
                  isCurrent
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : isCompleted
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-border bg-card opacity-60"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Icon
                    className={`h-5 w-5 ${
                      isCurrent
                        ? "text-primary animate-pulse"
                        : isCompleted
                        ? "text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  />
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : isCurrent ? (
                    <RefreshCw className="h-3.5 w-3.5 text-primary animate-spin" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="text-xs font-semibold">{agent.name}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {isCompleted ? "Verified" : isCurrent ? "Executing..." : "Pending"}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Generation Events Log */}
      <div className="space-y-3">
        <h2 className="text-base font-bold">Execution Telemetry Events</h2>
        {job.events.length === 0 ? (
          <Card className="p-6 text-center text-xs text-muted-foreground">
            No events logged yet. Inngest durable workflow is executing background steps.
          </Card>
        ) : (
          <div className="space-y-2">
            {job.events.map((evt) => (
              <Card key={evt.id} className="p-3 text-xs flex items-center justify-between font-mono">
                <div className="flex items-center gap-3">
                  <span className="text-primary font-bold">[{evt.agentName.toUpperCase()}]</span>
                  <span>{evt.eventType}</span>
                </div>
                <div className="text-muted-foreground flex items-center gap-3">
                  {evt.durationMs && <span>{evt.durationMs}ms</span>}
                  <span>{new Date(evt.createdAt).toLocaleTimeString()}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
