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
  4. **Code Validator Node**: Deterministic `@babel/parser` (TS/JS), JSON, and YAML AST parsing. **Code is never executed on the host runtime!**
  5. **Quality Reviewer Agent**: 100-point rubric breakdown (30% Accuracy, 30% Code AST, 20% Pedagogy, 20% SEO) with cyclic review loop (max 2 revisions).
- **Concurrency-Safe, Fenced Idempotency Engine**:
  - Deterministic deep canonical JSON serialization with recursive key sorting.
  - Atomic reservation leasing with unique UUID fencing ownership tokens.
  - Wall-clock expiry evaluation (`lease_expires_at > clock_timestamp()`) and rollback guards.
- **Dual Outbox Event Dispatchers**:
  - **Inngest Outbox Dispatcher**: Subscribes *exclusively* to `eventType = 'job.created'` events.
  - **Webhook Outbox Dispatcher**: Subscribes *exclusively* to `job.completed` and `job.failed`. Enforces per-claim UUID tokens (`gen_random_uuid()`), 45-second delivery leases, and isolated outbox rollup.
- **Hardened Webhook Security**:
  - Anti-SSRF socket validation (blocks RFC 1918, loopback, and cloud metadata `169.254.169.254`).
  - AES-256-GCM encrypted secrets at rest with zero-downtime dual-secret rotation.
  - Constant-time signature comparison (`crypto.timingSafeEqual`) and 300-second replay window tolerance.

---

## 2. Directory Structure

```
├── prisma/
│   └── schema.prisma               # Relational data model with explicit @db.Uuid mapping
├── src/
│   ├── app/
│   │   ├── (auth)/                 # Authentication screens
│   │   ├── dashboard/              # Responsive developer web dashboard
│   │   │   ├── generate/           # Generation Studio with full parameterization
│   │   │   ├── jobs/[id]/          # Live Telemetry & step-by-step progress tracker
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
│   │   │       ├── api-keys/       # API key creation and deletion
│   │   │       └── health/         # System health & Gemini probe endpoint
│   ├── components/
│   │   ├── layout/                 # Navbar and application shell
│   │   └── ui/                     # Reusable design system primitives
│   └── lib/
│       ├── agents/                 # LangGraph state, checkpointer, and 5 agent nodes
│       ├── auth/                   # API key SHA-256 verification and scoping
│       ├── gemini/                 # Centralized Gen AI client, health probe, and grounding
│       ├── idempotency/            # Canonical JSON serializer and atomic reservation guard
│       ├── inngest/                # Inngest durable client and generation workflow
│       ├── outbox/                 # Inngest outbox dispatcher (job.created)
│       ├── supabase/               # Supabase SSR cookie auth helpers
│       └── webhooks/               # Anti-SSRF HTTP client, crypto, and webhook dispatcher
├── tests/                          # Automated unit and integration test suite
└── PROJECT_SPEC.md                 # Approved engineering specification (v4.3.3)
```

---

## 3. Environment Variables Configuration

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Populate the required credentials:

```env
# Tri-Tier Database Connections
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"
CHECKPOINTER_DATABASE_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"

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
npm install --legacy-peer-deps

# 2. Generate Prisma Client
npx prisma generate

# 3. Run database migrations (when database URL is configured)
npx prisma migrate dev

# 4. Run automated test suite
npm test

# 5. Start development server
npm run dev
```

Visit `http://localhost:3000` to access the DevScribe AI dashboard.

---

## 5. REST API Usage Examples

### Submit Generation Job (`POST /api/v1/jobs`)

```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Authorization: Bearer ds_live_your_api_key_here" \
  -H "Idempotency-Key: idemp_9f823a10-b98a-4d92-bf39-a9c8b0e41234" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Distributed Consensus with Raft in Rust",
    "contentType": "TUTORIAL",
    "targetAudience": "Advanced",
    "tone": "ENTERPRISE_ARCHITECTURAL",
    "targetWordCount": 2500,
    "primaryLanguage": "Rust",
    "frameworks": ["tokio", "tonic"]
  }'
```

### Inspect Job Status (`GET /api/v1/jobs/:id`)

```bash
curl http://localhost:3000/api/v1/jobs/e16a241a-8c5e-4a62-bc10-fb81d9f8c321 \
  -H "Authorization: Bearer ds_live_your_api_key_here"
```

---

## 6. Verification & Test Suite

Run the automated test suite verifying canonical JSON hashing, AST syntax parsing, constant-time webhook signatures, and anti-SSRF protections:

```bash
node --test tests/canonicalJson.test.js tests/codeValidator.test.js tests/webhookCrypto.test.js tests/antiSsrf.test.js
```
