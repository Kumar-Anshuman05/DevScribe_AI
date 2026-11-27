"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { Info, Lightbulb, AlertTriangle, Copy, Check } from "lucide-react";

type CalloutKind = "NOTE" | "TIP" | "WARNING";

const CALLOUT_STYLES: Record<
  CalloutKind,
  {
    label: string;
    containerClass: string;
    headerClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  NOTE: {
    label: "Note",
    containerClass: "border-sky-500/35 bg-sky-500/10",
    headerClass: "text-sky-400",
    icon: Info,
  },
  TIP: {
    label: "Tip",
    containerClass: "border-emerald-500/35 bg-emerald-500/10",
    headerClass: "text-emerald-400",
    icon: Lightbulb,
  },
  WARNING: {
    label: "Warning",
    containerClass: "border-amber-500/35 bg-amber-500/10",
    headerClass: "text-amber-400",
    icon: AlertTriangle,
  },
};

function normalizeHeadingText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Strips a leading Markdown H1 when it duplicates the article page header title.
 */
export function stripDuplicateLeadingTitle(markdown: string, pageTitle?: string): string {
  if (!markdown || !pageTitle) return markdown;

  const match = markdown.match(/^\s*#\s+([^\r\n]+)(?:\r?\n)+/);
  if (!match) return markdown;

  const normH1 = normalizeHeadingText(match[1]);
  const normTitle = normalizeHeadingText(pageTitle);

  if (normH1 && normTitle && (normH1 === normTitle || normTitle.startsWith(normH1))) {
    return markdown.slice(match[0].length);
  }

  return markdown;
}

function extractTextFromChildren(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractTextFromChildren).join("");
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractTextFromChildren(node.props.children);
  }
  return "";
}

function extractCodeLanguage(children: React.ReactNode): string {
  const childArray = React.Children.toArray(children);
  for (const child of childArray) {
    if (React.isValidElement<{ className?: string }>(child)) {
      const className = child.props.className || "";
      const match = className.match(/(?:language-|lang-)([a-zA-Z0-9_+-]+)/);
      if (match?.[1]) {
        return match[1].toLowerCase();
      }
    }
  }
  return "text";
}

function formatLanguageLabel(lang: string): string {
  const labels: Record<string, string> = {
    ts: "TypeScript",
    typescript: "TypeScript",
    tsx: "TSX",
    js: "JavaScript",
    javascript: "JavaScript",
    jsx: "JSX",
    bash: "Bash",
    sh: "Shell",
    shell: "Shell",
    sql: "SQL",
    prisma: "Prisma",
    dotenv: "Env",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    dockerfile: "Dockerfile",
    mermaid: "Mermaid",
    python: "Python",
    py: "Python",
    text: "Plain Text",
    plain: "Plain Text",
  };
  return labels[lang] || lang.toUpperCase();
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = extractCodeLanguage(children);
  const rawCode = extractTextFromChildren(children).replace(/\n$/, "");

  const handleCopy = async () => {
    if (!rawCode) return;
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for restricted clipboard contexts
      const textarea = document.createElement("textarea");
      textarea.value = rawCode;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(textarea);
      }
    }
  };

  return (
    <div className="article-codeblock my-6 overflow-hidden rounded-lg border border-border bg-[#0d1117] shadow-sm">
      <div className="flex items-center justify-between border-b border-border/80 bg-secondary/40 px-3.5 py-2 text-xs">
        <span className="font-mono font-medium tracking-wide text-muted-foreground">
          {formatLanguageLabel(lang)}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${formatLanguageLabel(lang)} code`}
          className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-background/60 px-2.5 py-1 text-[11px] font-medium text-foreground/90 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto border-0 bg-transparent p-4 text-[13px] leading-relaxed sm:text-sm [&_code]:!bg-transparent [&_code]:!p-0 [&_code]:!border-0 [&_code]:!rounded-none [&_code]:!text-[#c9d1d9] [&_code]:!text-[13px] sm:[&_code]:!text-sm">
        {children}
      </pre>
    </div>
  );
}

function isElementTag(
  node: React.ReactNode,
  tag: string
): node is React.ReactElement<{
  children?: React.ReactNode;
  node?: { tagName?: string };
}> {
  if (!React.isValidElement<{ children?: React.ReactNode; node?: { tagName?: string } }>(node)) {
    return false;
  }
  return node.type === tag || node.props?.node?.tagName === tag;
}

function parseCallout(children: React.ReactNode): {
  kind: CalloutKind | null;
  body: React.ReactNode[];
} {
  const nodes = React.Children.toArray(children).filter(
    (node) => !(typeof node === "string" && node.trim() === "")
  );

  if (nodes.length === 0) {
    return { kind: null, body: nodes };
  }

  const first = nodes[0];
  if (!isElementTag(first, "p")) {
    return { kind: null, body: nodes };
  }

  const pChildren = React.Children.toArray(first.props.children);
  if (pChildren.length === 0) {
    return { kind: null, body: nodes };
  }

  let detected: CalloutKind | null = null;
  let updatedPChildren: React.ReactNode[] = [];

  const firstInline = pChildren[0];
  if (isElementTag(firstInline, "strong")) {
    const labelText = extractTextFromChildren(firstInline.props.children).trim();
    const match = labelText.match(/^(NOTE|TIP|WARNING):?$/i);
    if (match) {
      detected = match[1].toUpperCase() as CalloutKind;
      updatedPChildren = pChildren.slice(1);
    }
  } else if (typeof firstInline === "string") {
    const match = firstInline.match(/^\s*\[!(NOTE|TIP|WARNING)\]\s*(?:\r?\n)?/i);
    if (match) {
      detected = match[1].toUpperCase() as CalloutKind;
      const remainder = firstInline.slice(match[0].length);
      updatedPChildren = remainder ? [remainder, ...pChildren.slice(1)] : pChildren.slice(1);
    }
  }

  if (!detected) {
    return { kind: null, body: nodes };
  }

  // Trim leading line breaks, spaces, or separators (e.g. " – ", ": ") after the marker
  while (updatedPChildren.length > 0) {
    const head = updatedPChildren[0];
    if (isElementTag(head, "br")) {
      updatedPChildren = updatedPChildren.slice(1);
      continue;
    }
    if (typeof head === "string") {
      const cleaned = head.replace(/^[\s\u00a0]*[–—:-]?[\s\u00a0]*/, "");
      if (cleaned.length === 0) {
        updatedPChildren = updatedPChildren.slice(1);
        continue;
      }
      updatedPChildren = [cleaned, ...updatedPChildren.slice(1)];
    }
    break;
  }

  const restBlocks = nodes.slice(1);
  const body =
    updatedPChildren.length > 0
      ? [React.cloneElement(first, { key: first.key ?? "callout-p-0" }, updatedPChildren), ...restBlocks]
      : restBlocks;

  return { kind: detected, body };
}

export function ArticleMarkdown({
  content,
  articleTitle,
}: {
  content: string;
  articleTitle?: string;
}) {
  const preparedMarkdown = stripDuplicateLeadingTitle(content, articleTitle);

  return (
    <div className="article-markdown max-w-[74ch] mx-auto text-[15.5px] sm:text-base leading-7 text-foreground/90">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [
            rehypeHighlight,
            {
              aliases: {
                ini: ["dotenv"],
                graphql: ["prisma"],
              },
              plainText: ["mermaid", "text", "plain"],
            },
          ],
        ]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-10 mb-4 border-b border-border pb-2.5 text-2xl font-bold tracking-tight text-foreground first:mt-0 sm:text-3xl">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-10 mb-4 border-b border-border/80 pb-2 text-xl font-bold tracking-tight text-foreground first:mt-0 sm:text-2xl">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-7 mb-3 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-5 mb-2 text-base font-semibold text-foreground/95 sm:text-lg">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="my-4 leading-7 text-foreground/90 first:mt-0 last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="my-4 list-disc space-y-2 pl-6 leading-7 text-foreground/90 marker:text-primary/80">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-4 list-decimal space-y-2 pl-6 leading-7 text-foreground/90 marker:font-semibold marker:text-primary/80">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="pl-1 [&>ol]:my-2 [&>p]:my-1.5 [&>ul]:my-2">
              {children}
            </li>
          ),
          a: ({ href, children }) => {
            const isExternal = Boolean(href && /^https?:\/\//i.test(href));
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="font-medium text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary break-words"
              >
                {children}
              </a>
            );
          },
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          hr: () => <hr className="my-8 border-t border-border/80" />,
          blockquote: ({ children }) => {
            const { kind, body } = parseCallout(children);
            if (kind) {
              const style = CALLOUT_STYLES[kind];
              const Icon = style.icon;
              return (
                <aside
                  role="note"
                  aria-label={style.label}
                  className={`my-6 rounded-lg border px-4 py-3.5 ${style.containerClass}`}
                >
                  <div className={`mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${style.headerClass}`}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{style.label}</span>
                  </div>
                  <div className="text-sm sm:text-[15px] leading-relaxed text-foreground/90 [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
                    {body}
                  </div>
                </aside>
              );
            }

            return (
              <blockquote className="my-6 rounded-r-lg border-l-4 border-primary/50 bg-secondary/25 px-4 py-3 text-foreground/85 [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
                {children}
              </blockquote>
            );
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className, children, ...props }) => {
            const isHighlightedOrBlock = Boolean(
              className && (className.includes("language-") || className.includes("hljs"))
            );
            if (isHighlightedOrBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded border border-border/70 bg-secondary/80 px-1.5 py-0.5 font-mono text-[0.85em] text-sky-300 break-words"
                {...props}
              >
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="my-6 w-full overflow-x-auto rounded-lg border border-border bg-background/40">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-border bg-secondary/60 text-xs uppercase tracking-wider text-muted-foreground">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border/60">{children}</tbody>
          ),
          tr: ({ children }) => (
            <tr className="transition-colors hover:bg-secondary/20">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-4 py-3 font-semibold text-foreground">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-3 align-top text-foreground/85 leading-relaxed">
              {children}
            </td>
          ),
        }}
      >
        {preparedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
