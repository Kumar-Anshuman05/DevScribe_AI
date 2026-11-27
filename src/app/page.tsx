import Link from "next/link";
import { Sparkles, Terminal, ShieldCheck, Cpu, ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import { Navigation } from "@/components/layout/Navbar";
import { Card, Badge, Button } from "@/components/ui";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-border py-20 md:py-28">
        <div className="container mx-auto px-4 max-w-5xl text-center">
          <Badge variant="default" className="mb-4 py-1 px-3 text-xs uppercase tracking-wider">
            Next-Gen Multi-Agent Technical Authoring
          </Badge>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6">
            Think. Research. Write. <span className="text-primary underline decoration-primary/40">Validate.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
            DevScribe AI is an autonomous agentic platform engineered to produce publication-grade
            technical blogs and programming tutorials through cyclic supervisory graphs, deterministic AST syntax parsing,
            and transactional outbox delivery.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/dashboard/generate">
              <Button size="lg" className="gap-2">
                <Sparkles className="h-5 w-5" />
                Launch Generation Studio
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="outline" size="lg">
                View Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Flywheel Architecture Section */}
      <section className="py-16 border-b border-border bg-card/40">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">The 5-Stage Agentic Intelligence Pipeline</h2>
            <p className="text-muted-foreground mt-2 text-sm">Stateful cyclic orchestration governed by LangGraph.js and Groq LPU Inference</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className="p-5 border-border bg-card">
              <div className="h-8 w-8 rounded-md bg-blue-500/10 text-blue-400 flex items-center justify-center font-bold mb-3">1</div>
              <h3 className="font-bold text-sm mb-1">Research Agent</h3>
              <p className="text-xs text-muted-foreground">Tool-augmented search grounding with untrusted XML envelope defense.</p>
            </Card>

            <Card className="p-5 border-border bg-card">
              <div className="h-8 w-8 rounded-md bg-purple-500/10 text-purple-400 flex items-center justify-center font-bold mb-3">2</div>
              <h3 className="font-bold text-sm mb-1">Planning Agent</h3>
              <p className="text-xs text-muted-foreground">Pedagogical outlines with section word counts and learning objectives.</p>
            </Card>

            <Card className="p-5 border-border bg-card">
              <div className="h-8 w-8 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold mb-3">3</div>
              <h3 className="font-bold text-sm mb-1">Content Writer</h3>
              <p className="text-xs text-muted-foreground">Production prose authoring with language-tagged fenced code blocks.</p>
            </Card>

            <Card className="p-5 border-border bg-card">
              <div className="h-8 w-8 rounded-md bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold mb-3">4</div>
              <h3 className="font-bold text-sm mb-1">AST Code Validator</h3>
              <p className="text-xs text-muted-foreground">Deterministic Babel & native parsing without runtime host execution.</p>
            </Card>

            <Card className="p-5 border-border bg-card">
              <div className="h-8 w-8 rounded-md bg-rose-500/10 text-rose-400 flex items-center justify-center font-bold mb-3">5</div>
              <h3 className="font-bold text-sm mb-1">Quality Reviewer</h3>
              <p className="text-xs text-muted-foreground">100-point rubric audit with cyclic feedback loop (max 2 revisions).</p>
            </Card>
          </div>
        </div>
      </section>

      {/* Enterprise Reliability Features */}
      <section className="py-16">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-6">
              <ShieldCheck className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold text-base mb-2">Fenced Idempotency Engine</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Atomic reservation leases with distinct UUID ownership tokens, canonical deep JSON sorting, and wall-clock expiry guards.
              </p>
            </Card>

            <Card className="p-6">
              <RefreshCw className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold text-base mb-2">Dual Outbox Dispatchers</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Strict separation between Inngest job creation and delivery-level webhook leases with SKIP LOCKED concurrency control.
              </p>
            </Card>

            <Card className="p-6">
              <Terminal className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold text-base mb-2">Hardened Webhook Security</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                AES-256-GCM encrypted secrets, dual-secret zero-downtime rotation, anti-SSRF IP pinning, and constant-time HMAC validation.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <p>DevScribe AI — B.Tech CSE (AI/ML) Capstone Engineering Platform • Architecture v4.3.3</p>
      </footer>
    </div>
  );
}
