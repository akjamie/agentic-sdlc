---
name: asdlc-spec-review
description: "Independent AI Spec Review (Stage 3): evaluate a spec PR or local change for completeness, ambiguity, contradiction, testability, and security before human TL approval. Accepts a GitHub PR URL or local CHANGE_ID."
aliases:
  - spec-review
---

# /asdlc:spec-review — Independent Spec Reviewer

This skill executes **independent AI spec review** against a Spec PR (`asdlc:spec-review` label) or a local change directory.
It applies the **Player ≠ Referee** principle: the reviewing agent MUST NOT be the agent that authored the spec.

> [!IMPORTANT]
> **Scope**: Reviews *intent* — BDD quality, logical consistency, architectural soundness, AC testability.
> Does NOT re-run `asdlc lint` (deterministic structural checks are already gated by `asdlc pr`).
> Does NOT review implementation code — that is `asdlc-impl-review`.

---

## Invocation

```
# From a GitHub PR URL
/asdlc:spec-review https://github.com/<org>/<repo>/pull/<N>

# From a local change directory
/asdlc:spec-review <CHANGE_ID>
```

---

## Workflow Sequence

### Step 1: Acquire Change Context

**If given a PR URL:**
1. Run `gh pr view <PR_NUMBER> --repo <org>/<repo> --json title,body,files` to list changed files.
2. Run `gh pr diff <PR_NUMBER> --repo <org>/<repo>` to read the full diff.
3. Extract `CHANGE_ID` from the branch name or the PR body `**Change ID**:` field.

**If given a CHANGE_ID:**
1. Read all artifacts under `openspec/changes/<CHANGE_ID>/`:
   - `explore.md` — knowledge graph grounding
   - `clarifications.md` — settled design decisions
   - `proposal.md` — intent, scope, and impact
   - `specs/**/*.md` — requirements, BDD scenarios, ACs

> [!NOTE]
> Read **all** artifacts before forming any finding. Partial context produces false positives.

---

### Step 2: Apply the Six Review Dimensions

Evaluate every requirement against all six dimensions. Mark each `PASS`, `CONCERN`, or `FAIL`.

#### D1 — Completeness
- Does the spec cover all user journeys stated in `proposal.md ## Why`?
- Are nil/empty inputs, upstream failures, and degradation paths handled?
- Is every `## MODIFIED` or `## REMOVED` requirement accompanied by a **Reason**?

#### D2 — Ambiguity & Contradiction
- Does each requirement use normative `SHALL` / `MUST`, not passive voice?
- Are there contradictory ACs or scenarios within the spec? (e.g., one AC implies HTTP 200 graceful fallback, another implies HTTP 4xx hard error, for the same trigger event)
- Are threshold values, enum members, and schema field names precisely specified?

#### D3 — Cross-Repo Consistency
- Does this change alter a shared API contract, event schema, or RPC interface?
- If yes: is a System Design Amendment referenced in `proposal.md ## System Design refs`?

#### D4 — Contract Impact
- Are breaking changes explicitly flagged `**BREAKING**` in `proposal.md ## What Changes`?
- Are backward-compatibility commitments documented?

#### D5 — Testability
- Does every `### Requirement:` have ≥ 1 `- [ ] ACn:` with a concrete `(test: <path>)` mapping?
- Is each AC deterministically observable? ("must feel responsive" is not testable; "must respond in <2s (p99)" is)
- Are integration and contract test targets distinct from unit test targets where the scope demands it?

#### D6 — Security & Privacy
- Is authentication / authorization addressed for any new API or CLI endpoint?
- Are secrets, tokens, and credentials never logged or hard-coded?
- Is user-supplied input validated before use?
- If the change stores user data, is PII lifecycle (retention, deletion) documented?

---

### Step 3: Build the Requirement → AC → Test Traceability Matrix

For each `### Requirement:` found in `specs/**/*.md`, produce one row:

| Requirement | ACs | Target Test File | Status |
| :--- | :--- | :--- | :--- |
| City resolution | AC1, AC2 | test/city-resolve.test.ts | VERIFIED |

Flag any requirement that is missing ACs, missing a `(test: <path>)`, or whose test path appears implausible for the repo's language and test runner.

---

### Step 4: Formulate Findings

Classify each finding:

- **Blocker** — Contradictory ACs, untestable assertion, missing normative language, security risk. Blocks `asdlc approve`.
- **Major** — Ambiguous scenario, unhandled edge case, missing degradation path. Must be resolved before approval.
- **Advisory** — Clarity or style improvements. Does not block.

---

### Step 5: Write `ai-spec-review.md`

> [!IMPORTANT]
> Write to `openspec/changes/<CHANGE_ID>/ai-spec-review.md` — **NOT** `review.md`.
> `review.md` is exclusively owned by `asdlc approve` (the human TL approval stamp).
> Writing to it here would bypass the governance gate.
> Human TLs read `ai-spec-review.md` on the PR before deciding whether to run `asdlc approve`.

Write to `openspec/changes/<CHANGE_ID>/ai-spec-review.md`:

```markdown
# AI Spec Review: <CHANGE_ID>

> Reviewer: AI (asdlc-spec-review) — advisory; not a substitute for human TL approval
> Reviewed: <ISO-8601 timestamp>
> Source: <PR URL or "local">

## Summary
<2–3 sentences: what the change does and overall review outcome>

## Dimensions

| Dimension | Rating | Key Finding |
| :--- | :---: | :--- |
| D1 Completeness | PASS / CONCERN / FAIL | <one-line summary> |
| D2 Ambiguity & Contradiction | PASS / CONCERN / FAIL | <one-line summary> |
| D3 Cross-repo consistency | PASS / CONCERN / FAIL | <one-line summary> |
| D4 Contract impact | PASS / CONCERN / FAIL | <one-line summary> |
| D5 Testability | PASS / CONCERN / FAIL | <one-line summary> |
| D6 Security & Privacy | PASS / CONCERN / FAIL | <one-line summary> |

## Requirement → AC → Test Traceability

| Requirement | ACs | Target Test | Status |
| :--- | :--- | :--- | :--- |
| <Requirement name> | AC1, AC2 | test/<feature>.test.ts | VERIFIED |

## Blocking Findings
<!-- List every Blocker. If none: write "(none)" -->
1. [Blocker] <Requirement: Name> — AC<n>: <description of contradiction or missing assertion>

## Major Findings
<!-- List every Major finding. If none: write "(none)" -->

## Advisory Notes
<!-- Omit section if empty -->

## Verdict
APPROVE
<!-- Or: NEEDS_REVISION -->
```

---

### Step 6: Report Outcome

**If `APPROVE`:**
> "✅ Spec review complete — **APPROVE**.
> `ai-spec-review.md` written. Share it with the human TL on the PR.
> When the TL is satisfied, they run `asdlc approve <CHANGE_ID>` to lock `specSha` and transition to `READY_FOR_IMPL`."

**If `NEEDS_REVISION`:**
> "🔴 Spec review complete — **NEEDS_REVISION**.
> Blocking findings must be resolved before `asdlc approve` is run."

List every Blocker inline in the response so the author can act without switching files.
