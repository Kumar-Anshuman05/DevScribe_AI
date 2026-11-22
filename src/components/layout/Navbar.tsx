import Link from "next/link";
import { Sparkles, Terminal, FileText, Key, Webhook, BookOpen, LayoutDashboard } from "lucide-react";

export function Navigation() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-black">
              D
            </div>
            <span>DevScribe<span className="text-primary font-mono text-sm ml-1">AI</span></span>
          </Link>

          <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground">
            <Link href="/dashboard" className="flex items-center gap-1.5 transition-colors hover:text-foreground">
              <LayoutDashboard className="h-4 w-4" />
              Overview
            </Link>
            <Link href="/dashboard/generate" className="flex items-center gap-1.5 transition-colors hover:text-foreground text-primary font-semibold">
              <Sparkles className="h-4 w-4" />
              Generate
            </Link>
            <Link href="/dashboard/articles" className="flex items-center gap-1.5 transition-colors hover:text-foreground">
              <FileText className="h-4 w-4" />
              Articles
            </Link>
            <Link href="/dashboard/api-keys" className="flex items-center gap-1.5 transition-colors hover:text-foreground">
              <Key className="h-4 w-4" />
              API Keys
            </Link>
            <Link href="/dashboard/webhooks" className="flex items-center gap-1.5 transition-colors hover:text-foreground">
              <Webhook className="h-4 w-4" />
              Webhooks
            </Link>
            <Link href="/api/docs" target="_blank" className="flex items-center gap-1.5 transition-colors hover:text-foreground">
              <BookOpen className="h-4 w-4" />
              API Docs
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/generate"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow transition hover:bg-primary/90"
          >
            <Sparkles className="h-3.5 w-3.5" />
            New Job
          </Link>
          <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>v4.3.3 Active</span>
          </div>
        </div>
      </div>
    </header>
  );
}
