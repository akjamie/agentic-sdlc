---
name: asdlc-impl-review
description: "Independent AI Implementation Review (Stage 6.5): evaluate an Impl PR for spec conformance, code quality, test fidelity, and production readiness before human lead approval. Accepts a GitHub PR URL or local CHANGE_ID."
aliases:
  - impl-review
  - code-review-asdlc
---

# /asdlc:impl-review — Independent Implementation Reviewer

This skill executes **independent AI implementation review** against an Implementation PR (`asdlc:impl-review` label) or a locally-verified change.
It applies the **Player ≠ Referee** principle: the reviewing agent MUST NOT be the agent that authored the implementation.

> [!IMPORTANT]
> **Scope**: Reviews *implementation conformance and code quality* — spec adherence, test rigor, architecture, and production safety.
> Requires `asdlc verify <CHANGE_ID>` to have passed (12 gates) before this review is meaningful.
> Does NOT re-run `asdlc verify`. Does NOT review spec intent — that is `asdlc-spec-review`.
> `impl-review.md` output is **advisory** for the human lead reviewer on the PR; it is not enforced by any CLI gate.

---

## Invocation

```
# From a GitHub PR URL
/asdlc:impl-review https://github.com/<org>/<repo>/pull/<N>

# From a local change directory
/asdlc:impl-review <CHANGE_ID>
```

---

## Workflow Sequence

### Step 1: Acquire Context

**If given a PR URL:**
1. Run `gh pr view <PR_NUMBER> --repo <org>/<repo> --json title,body,baseRefName,headRefName,files` to enumerate changed files.
2. Run `gh pr diff <PR_NUMBER> --repo <org>/<repo>` to read the full implementation diff.
3. Extract `CHANGE_ID` from the PR body or branch name.

**If given a CHANGE_ID:**
1. Read the approved spec: `openspec/changes/<CHANGE_ID>/specs/**/*.md`.
2. Read `openspec/changes/<CHANGE_ID>/tasks.md` for the completed TDD task log and evidence.
3. Inspect all source and test files touched in the implementation diff (use `git diff <approvedSha>...HEAD`).

> [!NOTE]
> Read the **spec first**, then the implementation. The spec is the ground truth; the code is the candidate.

---

### Step 2: Apply the Five Review Dimensions

Evaluate the full diff against all five dimensions. Mark each `PASS`, `CONCERN`, or `FAIL`.

#### D1 — Spec Conformance (AC-by-AC)
For every `ACn:` in `specs/**/*.md`:
- Does the implementation satisfy the exact acceptance criterion as written?
- Is the behavior exercised in the mapped `(test: <path>)` test?
- Are there any requirements in the spec with **no implementation coverage**?
- Are there any implemented behaviors with **no corresponding AC** (scope creep)?

Flag scope creep as Major: it bypasses the governance gate and may introduce untested surface area.

#### D2 — Code Quality & Architecture
- **Deep modules**: Does each new module expose a simple interface over a complex interior? Avoid shallow wrappers that leak implementation.
- **Single Responsibility**: Does each function/class do one thing? Flag functions that handle both IO and business logic in the same body.
- **Error propagation**: Are errors surfaced explicitly (typed error objects or Result types), not swallowed silently?
- **Dead code / commented-out blocks**: Flag any production dead code.
- **Naming**: Are names precise and consistent with the spec's domain language (enum values, field names, error codes defined in the spec)?

#### D3 — Test Fidelity & TDD Evidence
- Are tests **behavior-driven**, not implementation-driven? (Do they assert observable outputs for given inputs, not call order or internal state?)
- Are mocks **minimal and scoped**? A mock that replaces an entire subsystem and always returns a happy-path fixture is a vacuous test.
- Does each test exercise the **failure path** as well as the happy path?
- Does `tasks.md` contain real test runner output for every `[x]` task (not just "✅ done")?
- Are edge cases from the spec (e.g. rainy-day ranking, high-temp advisory, upstream-API-unavailable fallback) each exercised by a distinct test case?

#### D4 — Production Readiness & Performance
- **NFRs met**: If the spec declares a latency SLA (e.g., "< 2 seconds"), is there a test or benchmark that fails when the SLA is violated?
- **Resource leaks**: Are HTTP connections, file handles, and streams properly closed?
- **Retry / timeout**: Are upstream HTTP calls wrapped with timeouts to prevent hanging?
- **Observability**: Are structured log statements present at entry and exit of key operations? Are PII fields excluded from logs?

#### D5 — Security & Secret Hygiene
- Are there any hard-coded credentials, API keys, or tokens in the diff?
- Is user-supplied input sanitized before being passed to external API query parameters or commands?
- Are error messages free of internal stack traces or system paths that would leak to end users?
- Is the HTTP endpoint (if present) protected from excessively large or malformed payloads?

---

### Step 3: Build the AC Conformance Matrix

For each `ACn:` in the approved spec, produce one row:

| AC | Spec Assertion | Implemented In | Test File | Status |
| :--- | :--- | :--- | :--- | :--- |
| AC1 | <spec assertion text> | src/<module>.ts | test/<feature>.test.ts | PASS |
| AC2 | <spec assertion text> | src/<module>.ts | test/<feature>.test.ts | PASS |

Mark `MISSING` for any AC whose implementation or test cannot be located in the diff.

---

### Step 4: Formulate Findings

Classify each finding:

- **Blocker** — AC not implemented, test always passes regardless of code, hard-coded secret, memory/resource leak, spec-forbidden behavior present. Blocks merge.
- **Major** — Scope creep (code not covered by any AC), vacuous mock hiding a real untested path, missing timeout on upstream HTTP call, PII in logs.
- **Advisory** — Naming clarity, minor refactor opportunity, optional performance improvement.

---

### Step 5: Write `impl-review.md`

Write to `openspec/changes/<CHANGE_ID>/impl-review.md`:

```markdown
# Implementation Review: <CHANGE_ID>

> Reviewer: AI (asdlc-impl-review) — advisory; not a substitute for human lead approval
> Reviewed: <ISO-8601 timestamp>
> Source: <PR URL or "local">
> Base spec SHA: <specSha from .openspec.yaml>

## Summary
<2–3 sentences: scope of the implementation and overall review outcome>

## Dimensions

| Dimension | Rating | Key Finding |
| :--- | :---: | :--- |
| D1 Spec Conformance | PASS / CONCERN / FAIL | <one-line summary> |
| D2 Code Quality & Architecture | PASS / CONCERN / FAIL | <one-line summary> |
| D3 Test Fidelity & TDD Evidence | PASS / CONCERN / FAIL | <one-line summary> |
| D4 Production Readiness | PASS / CONCERN / FAIL | <one-line summary> |
| D5 Security & Secret Hygiene | PASS / CONCERN / FAIL | <one-line summary> |

## AC Conformance Matrix

| AC | Spec Assertion | Implemented In | Test File | Status |
| :--- | :--- | :--- | :--- | :--- |
| AC1 | <assertion text> | src/<module>.ts | test/<feature>.test.ts | PASS / MISSING |

## Blocking Findings
<!-- List every Blocker. If none: write "(none)" -->
1. [Blocker] <file>:<line-range> — AC<n>: <description of gap or violation>

## Major Findings
<!-- List every Major finding. If none: write "(none)" -->

## Advisory Notes
<!-- Omit section if empty -->

## Verdict
APPROVE
<!-- Or: REQUEST_CHANGES -->
```

---

### Step 6: Report Outcome

**If `APPROVE`:**
> "✅ Implementation review complete — **APPROVE**.
> `impl-review.md` written. The implementation is ready for human lead approval and merge.
> After merge, run `asdlc archive <CHANGE_ID>` to close the change and refresh the knowledge graph."

**If `REQUEST_CHANGES`:**
> "🔴 Implementation review complete — **REQUEST_CHANGES**.
> Blocking findings must be resolved before this PR is merged."

List every Blocker inline with the file path and line range so the implementer can act immediately.
