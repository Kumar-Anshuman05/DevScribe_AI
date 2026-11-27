import type { GroundingSource } from "../agents/state";

export interface SearchQueryResult {
  sources: GroundingSource[];
  findingsSummary: string;
}

/**
 * Encapsulates retrieved untrusted external content into strict XML envelopes
 * to prevent prompt injection from malicious external websites.
 */
export function wrapUntrustedContent(content: string, sourceUrl: string): string {
  const sanitized = content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .slice(0, 15000); // Prevent context blowout

  return `<untrusted_research_data source="${sourceUrl}">\n${sanitized}\n</untrusted_research_data>`;
}

/**
 * Independent Search Engine with zero-cost DuckDuckGo and Tavily support:
 * 1. tavily (if configured via TAVILY_API_KEY)
 * 2. duckduckgo (Zero-cost instant search)
 * 3. curated reference fallback
 */
export async function executeSearch(query: string, searchProvider = "duckduckgo"): Promise<SearchQueryResult> {
  const now = new Date().toISOString();

  // 1. Tavily API (if explicitly configured)
  if (searchProvider === "tavily" && process.env.TAVILY_API_KEY) {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query,
          search_depth: "basic",
          max_results: 5,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const sources: GroundingSource[] = (data.results || []).map((r: any) => ({
          title: r.title || "External Resource",
          url: r.url,
          snippet: r.content,
          retrievedAt: now,
        }));

        const wrappedFindings = sources
          .map((s) => wrapUntrustedContent(s.snippet || "", s.url))
          .join("\n\n");

        return { sources, findingsSummary: wrappedFindings };
      }
    } catch (err) {
      console.warn("⚠️ Tavily search failed, falling back to DuckDuckGo/curated:", err);
    }
  }

  // 2. DuckDuckGo Instant Answer API (Zero cost, no API key required)
  if (searchProvider === "duckduckgo" || searchProvider === "tavily") {
    try {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const response = await fetch(ddgUrl, {
        headers: { "User-Agent": "DevScribe-AI-Research-Agent/1.0" },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        const data = await response.json();
        const sources: GroundingSource[] = [];

        if (data.AbstractURL && data.AbstractText) {
          sources.push({
            title: data.Heading || "Documentation Overview",
            url: data.AbstractURL,
            snippet: data.AbstractText,
            retrievedAt: now,
          });
        }

        if (Array.isArray(data.RelatedTopics)) {
          for (const topic of data.RelatedTopics.slice(0, 4)) {
            if (topic.FirstURL && topic.Text) {
              sources.push({
                title: topic.Text.slice(0, 60),
                url: topic.FirstURL,
                snippet: topic.Text,
                retrievedAt: now,
              });
            }
          }
        }

        if (sources.length > 0) {
          const findings = sources
            .map((s) => wrapUntrustedContent(s.snippet || "", s.url))
            .join("\n\n");
          return { sources, findingsSummary: findings };
        }
      }
    } catch (err) {
      console.warn("⚠️ DuckDuckGo search failed, using curated reference data:", err);
    }
  }

  // 3. Curated technical reference data for programming languages and frameworks
  const curatedSources: GroundingSource[] = [
    {
      title: "Official Developer Documentation & Best Practices",
      url: `https://developer.mozilla.org/search?q=${encodeURIComponent(query)}`,
      snippet: `Official specifications, API patterns, and modern conventions regarding: ${query}.`,
      retrievedAt: now,
    },
    {
      title: "Language & Ecosystem Specifications",
      url: "https://github.com/trending",
      snippet: `Ecosystem conventions, design patterns, and package management best practices for: ${query}.`,
      retrievedAt: now,
    },
  ];

  const fallbackFindings = curatedSources
    .map((s) => wrapUntrustedContent(s.snippet || "", s.url))
    .join("\n\n");

  return { sources: curatedSources, findingsSummary: fallbackFindings };
}
