# Technical Design: Agentic SDLC Harness Observability & Autonomous PR Triage

**Status:** Approved by PE & ARB (Revision 2 - Hardened)  
**Author:** Tech Lead & Systems Architecture  
**Target Reviewers:** Principal Engineers (PE), System Architects, Security & Governance Leads  
**Target Version:** `v1.11.0` (Lean ~250 LOC implementation)  
**Related Documents:** [`docs/architecture.md`](docs/architecture.md), [`docs/spec-format.md`](docs/spec-format.md)

---

## 1. Executive Summary & Problem Statement

As `@akjamie/agentic-sdlc` establishes itself as an enterprise governance engine, two architectural challenges must be solved without bloating the lightweight CLI:

1. **The Governance Black-Box & Data Topology Problem**:
   While `asdlc verify` enforces 13 deterministic quality gates, execution facts are fragmented. A local git-ignored log cannot observe cross-machine team velocity, while committing logs creates Git merge conflict hotspots. We need a dual-tier telemetry model.
2. **Autonomous Multi-Agent Review Convergence**:
   When AI Reviewers (`asdlc-impl-review`, Copilot, CodeRabbit) review PRs, the Author Agent must autonomously triage and address actionable items within a hard 3-round budget without:
   - Burdening human engineers with mandatory comment-by-comment endorsement.
   - Violating the **Player ≠ Referee** principle by self-resolving contentious review threads.
   - Falling into infinite AI-to-AI feedback death spirals.

This RFC defines a **Zero-Daemon, Git-Native Harness Observability Architecture** combined with an **Autonomous 3-Round PR Triage Protocol**.

---

## 2. Core Architectural Philosophy & System Boundaries

### 2.1 The Harness vs. Agent Runtime Boundary (Zero-Intrusion Law)

```
┌────────────────────────────────────────────────────────────────────────┐
│                   AGENT RUNTIME (Claude Code / OpenCode / Trae)        │
│  Owns: LLM prompts, token consumption, reasoning chains, model latency │
│  Telemetry: LangSmith, Arize Phoenix, OpenLLMetry                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (Invokes CLI & reads Skills)
┌───────────────────────────────────▼────────────────────────────────────┐
│                   ASDLC HARNESS & GOVERNANCE OVERLAY                   │
│  Owns: Git facts, OpenSpec contracts, 13 quality gates, audit trails   │
│  Telemetry: Local friction logs (.sdlc/) + Git-Native Provenance       │
└────────────────────────────────────────────────────────────────────────┘
```

- **Non-Goal**: We do **NOT** intercept LLM token streams, monitor prompt lengths, or act as an AI API proxy.
- **Goal**: We observe **Engineering Facts & Lifecycle Reality**: gate pass/fail distributions, verification iteration counts, stage transition latencies, and commit provenance.

### 2.2 Human-on-the-Loop Autonomous Convergence

- **No Human Bottleneck**: Author Agents and Review Agents interact autonomously within a **strict 3-round cap**.
- **Human Escalation Only by Exception**: Only when review feedback fails to converge after 3 automated rounds does the circuit breaker trip (`asdlc:needs-human-arbitration`), alerting human Tech Leads.

### 2.3 Transparent UX: Implicit Invocation Contract

Users never manually run `asdlc apply <id> --from-pr #44`.  
- **User UX**: The developer or webhook simply drops the PR context (`"fix comments on PR #44"` or `@agentic-sdlc#44`).
- **Agent Execution**: The Agent parses the PR via `gh pr view`, resolves the associated `CHANGE_ID`, and runs `asdlc apply <id> --from-pr <pr_num>` behind the scenes.

---

## 3. Two-Tier Data Topology Architecture

To resolve the paradox between local git-ignored files and cross-machine team metrics, data sources are explicitly split into two decoupled tiers:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Tier A: Local Friction Log (.sdlc/events.jsonl, git-ignored)                         │
│ • Scope: Ephemeral to current working copy / current CI job.                         │
│ • Captures: Local gate failure retries (e.g. author failed anti-test-weakening 3x).  │
│ • State derivation: Scanned locally to compute current `iteration` counter.          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Tier B: Cross-Stage & Team Metrics (Git-Native Provenance, Zero Extra Files)         │
│ • Scope: Permanent across developers and CI runners via Git history.                 │
│ • Captures: Stage lead-times (new -> approve -> archive), L0-L3 risk distribution.   │
│ • Source: openspec/changes/archive/*/ (.openspec.yaml, risk-history.jsonl, git log). │
│ • Benefit: Zero merge conflicts; any clone or CI runner can compute 30-day metrics! │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Automatic Git-Ignore Defense for `.sdlc/events.jsonl`

- **The Problem**: `.sdlc/policy.yaml` is a repository-tracked governance configuration protected by CODEOWNERS, whereas `.sdlc/events.jsonl` is strictly local and ephemeral. If a developer runs `git add -A` or triggers `asdlc pr` staging, `events.jsonl` risks being accidentally committed.
- **The Solution**: On first write, `recordEvent()` in `src/lib/telemetry.js` automatically verifies that `.sdlc/.gitignore` exists. If absent, it atomically writes:
  ```gitignore
  # Autogenerated by asdlc telemetry: ignore local friction logs; keep policy.yaml
  events.jsonl
  *.log
  ```
- **Result**: Zero git pollution, zero risk of merge conflicts, while allowing `.sdlc/policy.yaml` to remain normally tracked.

---

## 4. Lifecycle Stage Taxonomy & Alignment

Stages in telemetry map **strictly 1:1** to top-level `asdlc` CLI commands:

| Telemetry `stage` | CLI Command | Scope & Responsibility |
| :--- | :--- | :--- |
| `"stage": "new"` | `asdlc new` | Multi-source intake, AST graph query, `grill-me` interview, spec authoring |
| `"stage": "lint"` | `asdlc lint` | Deterministic spec validation (BDD GIVEN/WHEN/THEN, R0-R8, [OPEN] checks) |
| `"stage": "approve"` | `asdlc approve` | Locks `specSha`, records merge provenance, marks `READY_FOR_IMPL` |
| `"stage": "apply"` | `asdlc apply` | Guarded TDD implementation, PR review comment triage |
| `"stage": "verify"` | `asdlc verify` | 13-gate audit (anti-test-weakening, evidence, tamper guard, schema) |
| `"stage": "archive"` | `asdlc archive` | Compaction, living specs update, AST refresh, state close |

*(Note: `grill` is an internal phase within `new`; sub-actions are indicated via event `type`).*

---

## 5. Event Schema & Stateless Counter Derivation

### 5.1 Deterministic Counter Derivation in Stateless CLI

Because `asdlc` is a stateless CLI:
1. **`iteration` Counter**: When `asdlc verify` runs, it scans existing `gate.evaluated` / `gate.verified` entries for the current change in `.sdlc/events.jsonl` and computes:
   $$\text{iteration} = \text{Count}(\text{Existing verify events for changeId}) + 1$$
2. **No Ghost Events**: There is no separate `pr.fix_completed` event. Instead, when `asdlc verify` executes on a PR branch, it inspects `git log` for recent commits containing `(ref: #PRRT_...)` trailers (via `extractAddressedThreadIds`). It embeds `addressedThreadIds` directly into the `gate.verified` event.

### 5.2 Concrete Event Catalog

#### A. Gate Evaluation Event (`stage: "verify"` or `"lint"`)
```json
{
  "v": 1,
  "ts": "2026-11-21T10:15:30.120Z",
  "stage": "verify",
  "type": "gate.evaluated",
  "change": "refund-core",
  "gate": "anti-test-weakening",
  "status": "fail",
  "detail": "deleted test/auth.test.js",
  "iteration": 2,
  "round": 2
}
```

#### B. Verification Summary Event with Fix Attribution (`stage: "verify"`)
```json
{
  "v": 1,
  "ts": "2026-11-21T10:15:35.500Z",
  "stage": "verify",
  "type": "gate.verified",
  "change": "refund-core",
  "totalGates": 18,
  "passed": 18,
  "failed": 0,
  "iteration": 3,
  "round": 2,
  "status": "pass",
  "addressedThreadIds": ["PRRT_kwDOM123"]
}
```
*(Note: `totalGates` is dynamically derived from `results.length` at runtime; it typically ranges between 15 and 19 depending on project configuration, mapped acceptance tests, and external AI verification commands).*

#### C. PR Review Triage Ingestion (`stage: "apply"`)
```json
{
  "v": 1,
  "ts": "2026-11-21T10:00:00.000Z",
  "stage": "apply",
  "type": "pr.triage",
  "change": "refund-core",
  "pr": 44,
  "reviewDecision": "CHANGES_REQUESTED",
  "unaddressedThreads": 3,
  "actionableThreads": 2,
  "suggestionThreads": 1,
  "questionThreads": 0,
  "round": 2,
  "maxRounds": 3
}
```

### 5.3 Complete Quality Gate Catalog & Codebase Alignment

The Harness evaluates quality gates across two critical stages (`lint` at Stage 3, `verify` at Stage 6). The telemetry system captures all gate evaluations 1:1 matching the exact identifiers in `src/commands/lint.js` and `src/commands/verify.js`:

#### Stage 6: Implementation Verification Gates (`asdlc verify`)
1. **`repo`**: Valid OpenSpec project root and clean environment.
2. **`change`**: Change directory existence and metadata integrity.
3. **`level-integrity`**: Anti-gaming hash-chain check against monotonic downgrade.
4. **`pr-type`**: Valid PR classification (`normal`, `hotfix`, `governance`).
5. **`artifacts`**: Mandatory presence of `proposal.md`, `tasks.md`, and `specs/**`.
6. **`approved-spec`**: Cryptographic lock confirmation on target branch (`specSha`).
7. **`spec-tamper`**: Anti-tamper guard (locked spec files unmodified in impl diff).
8. **`flow-state`**: Lifecycle state machine check (`ready_for_impl`).
9. **`risk-escape`**: Scope expansion and semantic risk escalation check.
10. **`human-gate`**: Human lead PR approval and `reviewedSha` freshness check.
11. **`tasks-complete`**: 100% of tasks checked off in `tasks.md`.
12. **`test-presence`**: Production source changes mandate accompanying test diffs.
13. **`anti-test-weakening`**: Prohibits test deletions or skip/disable annotations (`.skip(`, `xit`, `@Disabled`, `@pytest.mark.skip`, `#[ignore]`).
14. **`tdd-evidence`**: Mandatory recorded test execution logs under completed tasks.
15. **`BDD + acceptance criteria`**: Deterministic R0-R8 scenario and AC coverage rules.
16. **`openspec-validate`**: Strict schema adherence via the OpenSpec engine.
17. **`schema-managed`**: Built-in centralized schema integrity and version parity.
18. **`acceptance-tests`**: Automated execution of AC-mapped tests via project test runner.
19. **`AI verification`**: Independent implementation review verdict (Player ≠ Referee).

#### Stage 3: Spec Validation Gates (`asdlc lint` - 1:1 with `src/commands/lint.js`)
1. **`change`**: Change directory existence under `openspec/changes/`.
2. **`explore.md (stage 1)`**: Grounded AST exploration artifact presence.
3. **`proposal.md`**: Proposal existence and intent structure.
4. **`spec delta`**: Valid capability delta markdown presence under `specs/**/*.md`.
5. **`design.md`**: Mandatory technical design document for UI, external API, DB, or security changes.
6. **`review.md`**: Spec review artifact presence (or automated PR review delegation marker).
7. **`review verdict`**: Review verdict validation (`APPROVE` or pending PR review).
8. **`blocking findings`**: Prohibits unresolved blocker severity findings in `review.md`.
9. **`clarifications`**: Prohibits unresolved `[OPEN]` markers or open questions in `clarifications.md`.
10. **`governance level`**: Monotonic risk level assessment and workflow mode synchronization.
11. **`BDD + acceptance criteria`**: Strict BDD scenario syntax and scenario-to-AC coverage.

---

## 6. Autonomous PR Review Triage & Player ≠ Referee Governance

### 6.1 4-Way Semantic Intent Classification
Unaddressed threads are parsed into 4 categories:
- **Category B (SUGGESTION_BLOCK)**: GitHub ```suggestion``` blocks (direct in-memory patch).
- **Category A (ACTION_REQUIRED)**: Imperative demands / defect keywords, plus mixed signals (`MIXED_SIGNAL_RE: LGTM, but fix X`).
- **Category C (INFORMATIONAL_QUESTION)**: Explanatory inquiry (reply only, zero code mutation).
- **Category D (NON_ACTIONABLE)**: Pure praise / acknowledgments (safe ignore).

### 6.2 Constitutional Governance: Player ≠ Referee Enforcement

> [!CAUTION]
> **Author Agent Prohibition**: An Author Agent is **STRICTLY FORBIDDEN** from automatically resolving any review thread where it disputes the requested change!

When an Author Agent determines a review comment contradicts an approved spec in `openspec/changes/<id>/specs/**`:
1. **Reply Only**: The Agent posts an explanatory reply quoting the exact spec section:
   > *"Spec Conflict: Per approved specification `specs/refund/spec.md#decision-2`, single-currency ledger is required. Tagging for human review."*
2. **Leave Unresolved**: The thread **MUST REMAIN UNRESOLVED**.
3. **Escalate**: The Agent applies the label `asdlc:needs-human-arbitration` or leaves the thread for the Reviewer/Human Lead to explicitly resolve. The candidate cannot dismiss its own prosecutor.

### 6.3 Resilient Review Round Calculation

To prevent human conversations or external bots (SonarQube, CodeRabbit) from artificially exhausting the 3-round budget:
- **Calculation Rule**: The review round ($R \in [1, 3]$) is computed **exclusively** by counting comments containing the formal hidden signature anchor:
  $$\text{<!-- asdlc:review-round:(\\d+) -->}$$
  or by counting commit batches containing `(ref: #PRRT_...)` trailers.
- General discussion comments and bot notifications that lack the formal review anchor do **NOT** increment $R$.

---

## 7. Two-Tier Presentation Model (Zero Gold-Plating)

We explicitly reject standalone HTML web generation (`--html`) and OTLP network exporters (`ASDLC_OTEL_ENDPOINT`) to preserve CLI speed ($\le 5\text{ms}$) and prevent template rot.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 1: Local Terminal Dashboard (`asdlc status --metrics`)            │
│         - ANSI ASCII Terminal Tables (Instant, Zero Network)           │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 2: Team CI Integration (`$GITHUB_STEP_SUMMARY`)                   │
│         - Native Markdown Report in GitHub Actions / PR Summary        │
└────────────────────────────────────────────────────────────────────────┘
```

### 7.1 Local Terminal Metrics View (`asdlc status --metrics`)

```text
======================= 🏛️ ASDLC HARNESS OBSERVABILITY =======================
📅 Data Source: Git Archive History (Last 30 Days, 24 changes tracked)

1. 🚦 Gate Friction Leaderboard (Local .sdlc/ Retries)
   Rank | Gate                  | Stage  | Fails | Top Failure Pattern
   --------------------------------------------------------------------------
    #1  | anti-test-weakening   | verify | 18    | deleted test (12), @Disabled (6)
    #2  | clarifications        | lint   | 9     | unresolved [OPEN] questions
    #3  | human-gate (staleSha) | verify | 4     | reviewedSha != HEAD commit

2. 🔄 Autonomous PR Convergence (3-Round Cap)
   • Round 1 Pass (Zero rework)    : 65% (15 PRs)
   • Round 2 Pass (Converged Rd 2) : 25% (6 PRs)
   • Round 3 Pass (Converged Rd 3) : 8%  (2 PRs)
   • Human Escalated (>3 rounds)   : 2%  (1 PR: feat-refund-channels)

3. ⏱️ Stage Lead Time (P50 / P90 via Git Provenance)
   • Stage new -> approve (Spec Phase): 14m / 45m
   • Stage apply -> verify (TDD Phase): 8m / 22m
=============================================================================
```

### 7.2 CI Markdown Report (`$GITHUB_STEP_SUMMARY`)
When `asdlc verify` runs in GitHub Actions, it appends a clean summary directly to `process.env.GITHUB_STEP_SUMMARY`:
```markdown
### 🛡️ ASDLC Governance Audit: `refund-core`
- **Verdict**: PASS (Iteration: 2, Round: 2)
- **Gates Evaluated**: 13/13 Passed
- **Addressed Review Threads**: `#PRRT_kwDOM123`
- **Integrity**: `specSha` matches locked protected branch merge commit `c1a32478`.
```

---

## 8. Lean Implementation Plan (~250 LOC)

1. **`src/lib/telemetry.js` (~80 LOC)**:
   - `recordEvent(type, payload)`: Synchronous append to `.sdlc/events.jsonl` wrapped in fail-silent try/catch. Automatically ensures `.sdlc/.gitignore` exists with `events.jsonl` on first run.
   - `getChangeIteration(changeId)`: Scans `.sdlc/events.jsonl` to return `iteration + 1`.
2. **`src/commands/verify.js`, `lint.js` & `apply.js` Hooks (~40 LOC)**:
   - Wire `recordEvent` into `verify.js` exit points. Attach `extractAddressedThreadIds` to `gate.verified` event.
   - Wire `recordEvent` into `lint.js` exit points for 11 Stage 3 gates.
   - Wire `pr.triage` recording into `apply.js`.
3. **`src/commands/status.js` Metrics Aggregator (~130 LOC)**:
   - Add `--metrics` flag: reads local `.sdlc/events.jsonl` for friction rankings; scans `openspec/changes/archive/` and `git log` for 30-day velocity, round convergence, and lead time.
   - Outputs clean ANSI ASCII tables and supports `--json`.
