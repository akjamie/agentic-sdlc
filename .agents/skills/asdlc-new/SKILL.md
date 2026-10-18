---
name: asdlc-new
description: "Start a new spec-driven change: derives change slug from natural language requirement, grounds in knowledge graph (explore.md), runs batch-grill-me interview, and drafts initial proposal, technical design (design.md), and spec deltas."
---

# /asdlc:new - Start Feature & Batch-Grill Author

This skill executes **Stage 2 (New)** of the Agentic SDLC. It transforms a natural language requirement into an approved intent change package (`proposal.md`, `specs/**`, and `design.md`).

---

## Workflow Sequence

### Step 1: Scaffold Change & Refresh Graph
When the user invokes `/asdlc:new "<requirement>"`:

```powershell
asdlc new "<requirement>"
```

The CLI:
1. Derives a clean canonical slug (e.g. `jwt-authentication-payment-api` or content-hashed `change-<id>`).
2. Creates `openspec/changes/<SLUG>/`.
3. Runs Graphify queries using the extracted requirement terms to discover real codebase AST nodes and call chains.
4. Generates `explore.md` and seeds `clarifications.md`.
5. **Technical Design Auto-Detection**: If the requirement touches UI/UX, frontend, APIs, services, databases, or architecture (or if `--design` is passed), seeds `design.md` with enterprise-grade technical design scaffolding.

> [!IMPORTANT]
> **NO PAUSE / CONTINUOUS EXECUTION**: Do NOT stop after `asdlc new` to ask the author "Should I start grilling?".
> You MUST proceed immediately to Step 2 and Step 3 (**batch-grill-me** interview) in the same turn!
> Only after `clarifications.md` has all questions settled may you draft `proposal.md`, `design.md`, and `specs/**`.

### Step 2: Ground Yourself in Codebase & External Context (Strict Order)
Follow this strict discovery sequence:
1. **Local Graph & Workspace First (Primary)**:
   - Read `openspec/changes/<SLUG>/explore.md`.
   - Note the **Architectural Hubs (god nodes)** that this change touches.
   - Review existing functions, types, and exported symbols. Never guess: ground internal assumptions in real paths from `explore.md`.
2. **Policy Guard & Targeted External Search (Enabled by Default)**:
   - **Enterprise Egress Policy Guard**: Check `.sdlc/policy.yaml` before executing any external web or API doc search.
     - **Default is ENABLED (`allow`)**: External web search is enabled by default. If `web_search` is omitted, unspecified, or set to `allow` in `.sdlc/policy.yaml`, search is permitted and encouraged for grounding 3rd-party APIs, vendor SDKs, and specs.
     - **Strict Egress Deny**: Search is blocked **ONLY if `.sdlc/policy.yaml` explicitly sets `web_search: deny`** (for air-gapped / offline enterprise environments).
       In that case, emit:
       `[POLICY] External search disabled by .sdlc/policy.yaml (web_search: deny); proceeding with local context only.`
       Tag any external API assumptions in `clarifications.md` and `design.md` with `[UNVERIFIED: policy_denied]`.
   - **Authoritative Fact Lookup** (when search is allowed / default):
     If the requirement references 3rd-party APIs, vendor SDKs, protocols, or external library specs (e.g. Amap, Weather APIs, Maps, Payment Gateways):
     Execute a targeted web/doc search to look up authoritative endpoints, rate limits, request/response formats, error codes, and caching best practices.
   - **Non-blocking failure tolerance**: If external search fails (offline, rate limited, sandbox network restriction, DNS failure, timeout), **DO NOT BLOCK**.
     Output:
     `[WARN] External search failed or offline: <reason>. Continuing with defined steps.`
     Tag any unverified external API assumptions, endpoints, schemas, or rate limits in `clarifications.md` and `design.md` with `[UNVERIFIED: <reason>]`.
     These will be explicitly surfaced on the PR review by CI/D7 for mandatory human confirmation before merge.

### Step 3: Run the `batch-grill-me` Interview
Before authoring any spec markdown, run the **`batch-grill-me`** protocol:
1. Evaluate the open decision frontier across 3 mandatory dimensions:
   - **Functional Seams**: User flows, domain states, and interface shapes.
   - **Security Threat Vectors**: AuthN/AuthZ, input validation/sanitization boundaries, secrets injection, PII & egress control.
   - **Operational NFRs**: Latency budgets (p95/p99), caching strategy, memory/resource bounds, upstream rate limits, and failure degradation.
2. Present all architectural forks and boundary questions in **one structured batch**:
   - Number each question (`Q1`, `Q2`, `Q3`...).
   - Provide concrete options (A / B / C).
   - Supply a fact-backed **Recommended Default** grounded in codebase evidence.
3. Invite the author to batch-approve (`"Approve all recommendations"`) or provide selective overrides.
4. Record every agreed answer in `openspec/changes/<SLUG>/clarifications.md` under `## Settled decisions`.
5. If overrides unblock child questions, run Batch Round 2; otherwise close the interview.

### Step 4: Author Approved Intent Artifacts
Once `## Open questions` in `clarifications.md` is empty, author the change documents:

1. **`proposal.md`**:
   - Sections: `## Why`, `## What Changes`, `## Capabilities`, `## Impact`, `## Out of Scope`, `## Dependencies & Assumptions`.
   - 1-2 pages maximum. Focus on **WHY**, not code implementation details.

2. **`design.md` (Technical Design Document - Mandatory for UI & Complex Systems)**:
   - When a change touches UI/frontend, external APIs, databases, or services, author `design.md` to define **HOW**:
     - **Architecture & Component Interaction**: Mermaid sequence/flowchart diagrams.
     - **Interface Contracts & Schemas**: TypeScript interfaces or JSON schemas for all requests/responses.
     - **External API Integration**: Endpoints, authentication, rate limits, client-level in-memory/TTL caching (never recreate clients per request), error taxonomy & fallbacks.
     - **Security Architecture & Threat Mitigation**: Authentication/authorization, input sanitization boundaries, secret management, PII/data privacy.
     - **Operational NFRs & Performance Budgets**: Concrete latency budgets (p95/p99), resource bounds, memory/cache lifecycles, and graceful degradation.
     - **UI/UX Design Reference & Tokens (Zero tolerance for unstyled HTML)**:
       - **Required Ground Truth Reference**: Link to human-provided mockup, Figma URL, brand styleguide, or existing CSS tokens. Do NOT invent palettes or fonts in isolation.
       - Concrete design tokens derived from reference (colors, typography, spacing/radii).
       - Component hierarchy (Hero/Search, Filters, Data Cards, Detail views).
       - Responsive breakpoints: Mobile (<= 640px), Tablet (<= 1024px), Desktop (> 1024px).
       - Mandatory interaction states: Default, Hover/Focus, Loading Skeleton, Empty State with prompt, Error Banner with retry.

3. **`specs/<capability>/spec.md`**:
   - `## Purpose`: Clear capability statement (50+ chars).
   - `## ADDED Requirements`:
     - Every requirement: `### Requirement: <name>` using **SHALL** or **MUST**.
     - Every requirement has `#### Scenario: <name>` with **GIVEN / WHEN / THEN**.
     - Every requirement has an `**Acceptance criteria**` block:
       `- [ ] AC1: <concrete testable assertion> (test: <path/to/test>)`
     - **UI Testability**: For any UI capability, include visual Acceptance Criteria for responsive breakpoints and key interaction states (empty, loading, error), mapped to component/E2E test targets (e.g. Playwright / snapshot tests).
     - `## Constraints & NFRs`: Verifiable performance/security statements.
     - `## Out of Scope` and `## Test Strategy`.

4. **Review Provenance (Player $\ne$ Referee)**:
   - The authoring agent MUST NOT approve its own spec.
   - Do NOT stamp `review.md` with self-approval.
   - Independent AI review (`asdlc:spec-review`) is executed automatically on the Spec PR by CI.
   - Formal approval is given by the human lead via PR merge or `asdlc approve <SLUG>`.

### Step 5: Transition to Lint
Once artifacts are written, guide the developer:
> "Artifacts drafted! Now run `/asdlc:lint <SLUG>` to verify BDD scenarios, technical design, and acceptance criteria before opening the spec PR."
