# DevScribe AI — Intelligent Technical Content Platform

> **"Think. Research. Write. Validate."**  
> **Architecture Version**: `4.3.3 (Final Dispatcher Correction Baseline)`  
> **Academic Context**: B.Tech CSE (AI/ML) Capstone Engineering Project

DevScribe AI is an autonomous agentic AI software platform engineered to research, outline, author, statically validate, and quality-audit publication-grade technical blog posts and programming tutorials.

---

## 1. Key Architectural Capabilities

- **Stateful 5-Agent Cognitive Graph (`LangGraph.js` + `Google Gemini API`)**:
  1. **Research Agent**: Search grounding with untrusted XML envelope defense (`<untrusted_research_data>`).
  2. **Planning Agent**: Pedagogical outlines with section target word counts and learning objectives.
  3. **Content Writer Agent**: Publication-grade technical Markdown prose with fenced language-tagged code blocks.
  4. **Code Validator Node**: Deterministic `@babel/parser` (TS/JS), JSON, and YAML AST parsing. Python/Go/Rust/SQL structural delimiter check. **Generated code is NEVER executed on the host runtime!**
  5. **Quality Reviewer Agent**: 100-point rubric breakdown (30% Technical Accuracy, 30% Code Completeness, 20% Pedagogy, 20% Formatting/SEO) with cyclic review loop (max 2 revisions). Strictly enforces `>= 85` passing threshold and rejects missing/placeholder scores.
- **Concurrency-Safe, Fenced Idempotency Engine**:
  - Deterministic deep canonical JSON serialization with recursive key sorting.
  - Atomic reservation leasing with unique UUID fencing ownership tokens.
  - Wall-clock expiry evaluation (`lease_expires_at > clock_timestamp()`) and atomic rollback behavior.
- **Dual Outbox Event Dispatchers**:
  - **Inngest Outbox Dispatcher**: Processes *exclusively* `job.created` events.
  - **Webhook Outbox Dispatcher**: Processes *exclusively* `job.completed` and `job.failed` events. Enforces unique per-claim UUID tokens, 45-second delivery leases, and isolated outbox rollup.
  - **Database Deduplication**: Schema-level unique constraint `@@unique([aggregateId, eventType])` guarantees exactly-once terminal outbox persistence.
- **Hardened Webhook Security & Networking**:
  - Multi-address A/AAAA DNS resolution and universal SSRF denylist (blocking RFC 1918, RFC 6598, loopback, and cloud metadata `169.254.169.254`).
  - DNS socket pinning via custom lookup resolver to eliminate TOCTOU and DNS rebinding attacks.
  - Automatic redirect prohibition (`SSRF_REDIRECT_PROHIBITED`) to prevent internal redirect escalation.
  - Dual-secret rotation with AES-256-GCM encryption at rest.
  - Constant-time signature verification (`crypto.timingSafeEqual`) and 300-second replay window tolerance.
  - Strict 5,000ms timeout and 4,096-byte response body cap.

---

## 2. Directory Structure

```
├── prisma/
│   └── schema.prisma               # Relational data model with explicit UUIDs & unique constraints
├── src/
│   ├── app/
│   │   ├── (auth)/                 # Supabase SSR authentication (login, signup)
│   │   ├── dashboard/              # Server-protected developer web dashboard
│   │   │   ├── generate/           # Generation Studio with parameter controls
│   │   │   ├── jobs/[id]/          # Real-time multi-agent execution telemetry
│   │   │   ├── articles/           # Article Library & GFM syntax-highlighted reader
│   │   │   ├── api-keys/           # Self-service SHA-256 API key management
│   │   │   └── webhooks/           # Webhook listener registration & status
│   │   ├── api/
│   │   │   ├── inngest/            # Inngest serve handler for durable background execution
│   │   │   ├── docs/               # OpenAPI 3.1 specification endpoint
│   │   │   └── v1/
│   │   │       ├── jobs/           # POST (fenced idempotency) & GET jobs
│   │   │       ├── articles/       # Paginated article retrieval by UUID or slug
│   │   │       ├── webhooks/       # Webhook registration and revocation
│   │   │       ├── api-keys/       # API key creation and revocation
│   │   │       └── health/         # System health & Gemini probe endpoint
│   │   └── layout.tsx              # Root HTML shell
│   ├── components/
│   │   ├── layout/                 # Navigation bar and application shell
│   │   └── ui/                     # Reusable design system primitives
│   ├── middleware.ts               # Next.js edge authentication middleware
│   └── lib/
│       ├── agents/                 # LangGraph state, PostgresSaver checkpointer, and agent nodes
│       ├── auth/                   # Centralized resolveUserAuth, API key hashing, and scoping
│       ├── gemini/                 # Centralized Gen AI client, health probe, and grounding
│       ├── idempotency/            # Canonical JSON serializer and atomic reservation guard
│       ├── inngest/                # Inngest durable client and generation workflow
│       ├── outbox/                 # Inngest outbox dispatcher (job.created)
│       ├── supabase/               # Supabase SSR cookie auth (client & server)
│       └── webhooks/               # Pinned-socket HTTP client, crypto, and webhook dispatcher
├── tests/                          # Automated test suite directly exercising production modules
│   ├── loader.mjs                  # Path resolution loader for '@/' aliases in tests
│   ├── register.mjs                # Node 24 module customization hook
│   ├── agentFailurePropagation.test.js
│   ├── antiSsrf.test.js
│   ├── authEnforcement.test.js
│   ├── canonicalJson.test.js
│   ├── checkpointerEnforcement.test.js
│   ├── codeValidator.test.js
│   ├── durableFailureHandling.test.js
│   ├── postgresTls.test.js
│   ├── socketPinning.test.js
│   └── webhookCrypto.test.js
└── PROJECT_SPEC.md                 # Approved engineering specification (v4.3.3)
```

---

## 3. Environment Variables Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Populate the required credentials:

```env
# Tri-Tier Database Connections
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"
CHECKPOINTER_DATABASE_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"

# Database TLS & SSL Configuration
DATABASE_SSL="true"
DATABASE_SSL_REJECT_UNAUTHORIZED="true"

# Supabase Auth & Storage (SSR)
NEXT_PUBLIC_SUPABASE_URL="https://[ref].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOi..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi..."

# Google Gemini API
GEMINI_API_KEY="AIzaSy..."
GEMINI_MODEL_FAST="gemini-2.5-flash"
GEMINI_MODEL_REASONING="gemini-2.5-flash"

# Search Provider: gemini_grounding | tavily | duckduckgo
RESEARCH_SEARCH_PROVIDER="gemini_grounding"

# Webhook Encryption Key (32-byte / 64 hex chars)
WEBHOOK_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

---

## 4. Setup & Running the Application

```bash
# 1. Install dependencies
npm install

# 2. Validate & generate Prisma Client
npx prisma validate
npx prisma generate

# 3. Run automated test suite (exercises actual production modules)
npm test

# 4. Build optimized Next.js production bundle
npm run build

# 5. Start development server
npm run dev
```

Visit `http://localhost:3000` to access the DevScribe AI dashboard.

---

## 5. Automated Verification Test Suite

DevScribe AI features an automated test suite that directly imports and executes the actual production modules from `src/lib/`:

```bash
npm test
```

Test coverage includes:
- **Canonical JSON**: Key sorting invariance, array preservation, non-serializable rejection.
- **Webhook Crypto**: AES-256-GCM authenticated encryption roundtrip, constant-time HMAC-SHA256 signature verification, 300s timestamp expiration.
- **SSRF Prevention**: Multi-address DNS validation, universal denylist (loopback, RFC 1918, RFC 6598, link-local, cloud metadata `169.254.169.254`, IPv6 ULA, IPv4-mapped IPv6).
- **Socket Pinning**: Custom DNS lookup resolver preventing TOCTOU / DNS rebinding attacks.
- **AST & Code Integrity**: Babel AST validation for TS/JS, native JSON parser, YAML parser, Python/Rust delimiter checking.
- **Agent Validation**: Zod schema enforcement on research findings, structured outlines, quality reports, and supervisor 85-point routing with 2-revision limit.
- **Checkpointer & TLS**: Durable PostgreSQL checkpointer fail-fast error enforcement, strict production `rejectUnauthorized: true` TLS certificate validation.
- **Authentication**: Route protection, independent API route authorization, user ownership enforcement.
