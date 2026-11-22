"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Badge } from "@/components/ui";
import { Sparkles, Loader2, ArrowRight, BookOpen, Code2, AlertCircle } from "lucide-react";

export default function GenerateStudioPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form state
  const [topic, setTopic] = useState("");
  const [contentType, setContentType] = useState<"BLOG" | "TUTORIAL">("TUTORIAL");
  const [targetAudience, setTargetAudience] = useState("Intermediate");
  const [tone, setTone] = useState<"DIDACTIC" | "CONVERSATIONAL" | "ENTERPRISE_ARCHITECTURAL">("DIDACTIC");
  const [targetWordCount, setTargetWordCount] = useState(2500);
  const [primaryLanguage, setPrimaryLanguage] = useState("TypeScript");
  const [frameworksInput, setFrameworksInput] = useState("Next.js, Prisma, Tailwind CSS");
  const [additionalGuidelines, setAdditionalGuidelines] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) {
      setErrorMessage("Please specify a technical topic.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const frameworks = frameworksInput
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    // Generate unique client idempotency key
    const idempotencyKey = `idemp_${crypto.randomUUID()}`;

    try {
      const response = await fetch("/api/v1/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          topic,
          contentType,
          targetAudience,
          tone,
          targetWordCount: Number(targetWordCount),
          primaryLanguage,
          frameworks,
          additionalGuidelines: additionalGuidelines || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to submit generation job.");
      }

      const jobId = data.data?.jobId;
      if (jobId) {
        router.push(`/dashboard/jobs/${jobId}`);
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "An unexpected error occurred.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Generation Studio</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure multi-agent parameters for grounded technical research, drafting, AST code validation, and quality auditing.
        </p>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="p-6 space-y-5">
          {/* Topic */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Technical Topic & Scope *</label>
            <input
              type="text"
              required
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Distributed Consensus with Raft in Rust"
              className="w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Format & Tone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Content Format</label>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value as any)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="TUTORIAL">Step-by-Step Programming Tutorial</option>
                <option value="BLOG">Technical Architecture Blog</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold">Editorial Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as any)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="DIDACTIC">Didactic & Educational</option>
                <option value="ENTERPRISE_ARCHITECTURAL">Enterprise Architectural</option>
                <option value="CONVERSATIONAL">Conversational & Engaging</option>
              </select>
            </div>
          </div>

          {/* Audience & Word Count */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Target Seniority</label>
              <select
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="Beginner">Beginner (Foundational)</option>
                <option value="Intermediate">Intermediate (Practitioner)</option>
                <option value="Advanced">Advanced (Senior / Principal)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold">Target Word Count ({targetWordCount} words)</label>
              <input
                type="range"
                min={1000}
                max={4000}
                step={250}
                value={targetWordCount}
                onChange={(e) => setTargetWordCount(Number(e.target.value))}
                className="w-full mt-2 accent-primary"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>1,000 words</span>
                <span>2,500 words</span>
                <span>4,000 words</span>
              </div>
            </div>
          </div>

          {/* Primary Language & Frameworks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Primary Programming Language</label>
              <input
                type="text"
                value={primaryLanguage}
                onChange={(e) => setPrimaryLanguage(e.target.value)}
                placeholder="e.g. TypeScript, Python, Rust, Go"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold">Frameworks / Libraries (comma-separated)</label>
              <input
                type="text"
                value={frameworksInput}
                onChange={(e) => setFrameworksInput(e.target.value)}
                placeholder="e.g. tokio, axum, serde"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Custom Guidelines */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Additional Guidelines / Focus Constraints (Optional)</label>
            <textarea
              rows={3}
              value={additionalGuidelines}
              onChange={(e) => setAdditionalGuidelines(e.target.value)}
              placeholder="e.g. Include a section explaining log compaction and trade-offs against snapshotting."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>
        </Card>

        {/* Submit Button */}
        <div className="flex justify-end gap-3">
          <Button
            type="submit"
            disabled={isSubmitting}
            size="lg"
            className="w-full sm:w-auto gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting Job...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Submit Generation Job
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
