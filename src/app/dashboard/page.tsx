import Link from "next/link";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Button } from "@/components/ui";
import { Sparkles, FileText, CheckCircle2, Clock, AlertCircle, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardOverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let jobs: any[] = [];
  let stats = { totalJobs: 0, completedArticles: 0, avgScore: 85, pendingWebhooks: 0 };

  try {
    const [recentJobs, totalJobsCount, articlesCount, avgScoreResult] = await Promise.all([
      prisma.generationJob.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          article: { select: { id: true, title: true, slug: true, qualityScore: true } },
        },
      }),
      prisma.generationJob.count({ where: { userId: user.id } }),
      prisma.article.count({ where: { userId: user.id } }),
      prisma.article.aggregate({
        where: { userId: user.id },
        _avg: { qualityScore: true },
      }),
    ]);

    jobs = recentJobs;
    stats = {
      totalJobs: totalJobsCount,
      completedArticles: articlesCount,
      avgScore: Math.round(avgScoreResult._avg.qualityScore || 85),
      pendingWebhooks: 0,
    };
  } catch (err) {
    console.warn("Prisma query error in dashboard overview:", err);
  }

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Engineering Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monitor multi-agent execution telemetry, published articles, and background webhook delivery.
          </p>
        </div>
        <Link href="/dashboard/generate">
          <Button className="gap-2">
            <Sparkles className="h-4 w-4" />
            New Generation Job
          </Button>
        </Link>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <span className="text-xs font-medium text-muted-foreground">Total Generation Jobs</span>
          <div className="text-2xl font-bold mt-1">{stats.totalJobs}</div>
        </Card>

        <Card className="p-4">
          <span className="text-xs font-medium text-muted-foreground">Completed Articles</span>
          <div className="text-2xl font-bold mt-1 text-emerald-400">{stats.completedArticles}</div>
        </Card>

        <Card className="p-4">
          <span className="text-xs font-medium text-muted-foreground">Average Quality Score</span>
          <div className="text-2xl font-bold mt-1 text-primary">{stats.avgScore}/100</div>
        </Card>

        <Card className="p-4">
          <span className="text-xs font-medium text-muted-foreground">Dispatcher Isolation</span>
          <div className="text-2xl font-bold mt-1 text-cyan-400">v4.3.3 Fenced</div>
        </Card>
      </div>

      {/* Recent Generation Jobs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Recent Generation Jobs</h2>
          <Link href="/dashboard/articles" className="text-xs text-primary hover:underline flex items-center gap-1">
            View All Articles <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {jobs.length === 0 ? (
          <Card className="p-10 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-base font-semibold">No Generation Jobs Yet</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto mb-4">
              Get started by launching a technical blog or programming tutorial generation job.
            </p>
            <Link href="/dashboard/generate">
              <Button size="sm">Create First Job</Button>
            </Link>
          </Card>
        ) : (
          <div className="grid gap-3">
            {jobs.map((job) => (
              <Link key={job.id} href={`/dashboard/jobs/${job.id}`}>
                <Card className="p-4 hover:border-primary/50 transition-all flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{job.topic}</span>
                      <Badge variant="outline" className="text-[10px] py-0">
                        {job.contentType}
                      </Badge>
                      {job.primaryLanguage && (
                        <Badge variant="default" className="text-[10px] py-0">
                          {job.primaryLanguage}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3">
                      <span>Target: {job.targetWordCount} words</span>
                      <span>•</span>
                      <span>Audience: {job.targetAudience}</span>
                      <span>•</span>
                      <span>{new Date(job.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {job.status === "COMPLETED" && (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Completed ({job.article?.qualityScore ?? 85})
                      </Badge>
                    )}
                    {job.status === "COMPLETED_WITH_WARNINGS" && (
                      <Badge variant="warning" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Completed w/ Warnings
                      </Badge>
                    )}
                    {job.status === "QUEUED" && (
                      <Badge variant="outline" className="gap-1">
                        <Clock className="h-3 w-3" />
                        Queued
                      </Badge>
                    )}
                    {job.status === "FAILED" && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Failed
                      </Badge>
                    )}
                    {["RESEARCHING", "PLANNING", "WRITING", "VALIDATING_CODE", "REVIEWING"].includes(job.status) && (
                      <Badge variant="default" className="gap-1 animate-pulse">
                        <Clock className="h-3 w-3" />
                        {job.status} ({job.progress}%)
                      </Badge>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
