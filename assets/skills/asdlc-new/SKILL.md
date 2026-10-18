---
name: asdlc-new
description: "Start a new spec-driven change: derives change slug from natural language requirement, grounds in knowledge graph (explore.md), runs batch-grill-me interview, and drafts initial proposal, technical design (design.md), and spec deltas."
---

# /asdlc:new - Start Feature & Batch-Grill Author

This skill executes **Stage 2 (New)** of the Agentic SDLC. It transforms a natural language requirement into an approved intent change package (`proposal.md`, `specs/**`, `design.md`, `review.md`).

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
2. **Targeted External Search (Essential for 3rd-Party APIs & UI Systems)**:
   - If the requirement references 3rd-party APIs, vendor SDKs, protocols, or external library specs (e.g. Amap, Weather APIs, Maps, Payment Gateways):
     Execute a targeted web/doc search to look up authoritative endpoints, rate limits, request/response formats, error codes, and caching best practices.
   - **Non-blocking failure tolerance**: If external search fails (offline, rate limited, sandbox network restriction, DNS failure, timeout), **DO NOT BLOCK**.
     Output:
     `[WARN] External search failed or offline: <reason>. Continuing with defined steps.`
     Record unverified assumptions in `clarifications.md`, and proceed immediately with local context.

### Step 3: Run the `batch-grill-me` Interview
Before authoring any spec markdown, run the **`batch-grill-me`** protocol:
1. Evaluate the entire open decision frontier for this feature.
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
     - **UI/UX Design & Aesthetics (Zero tolerance for unstyled HTML)**:
       - Design tokens: Curated color palette, Google typography (Inter, Outfit), spacing/radii.
       - Component hierarchy: Hero/Search, Filters, Data Cards, Detail views.
       - Responsive breakpoints: Mobile (<=640px), Tablet (<=1024px), Desktop (>1024px).
       - Mandatory interaction states: Default, Hover/Focus, Loading Skeleton, Empty State with prompt, Error Banner with retry.

3. **`specs/<capability>/spec.md`**:
   - `## Purpose`: Clear capability statement (50+ chars).
   - `## ADDED Requirements`:
     - Every requirement: `### Requirement: <name>` using **SHALL** or **MUST**.
     - Every requirement has `#### Scenario: <name>` with **GIVEN / WHEN / THEN**.
     - Every requirement has an `**Acceptance criteria**` block:
       `- [ ] AC1: <concrete testable assertion> (test: <path/to/test>)`
     - `## Constraints & NFRs`: Verifiable performance/security statements.
     - `## Out of Scope` and `## Test Strategy`.

4. **`review.md`**:
   - Run an independent review pass and stamp `## Verdict: APPROVE`.

### Step 5: Transition to Lint
Once artifacts are written, guide the developer:
> "Artifacts drafted! Now run `/asdlc:lint <SLUG>` to verify BDD scenarios, technical design, and acceptance criteria before opening the spec PR."
