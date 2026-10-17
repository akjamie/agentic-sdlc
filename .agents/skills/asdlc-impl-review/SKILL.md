---
name: asdlc-impl-review
description: "Independent AI Implementation Review (Stage 6.5): evaluate an Impl PR for spec conformance, code quality, test fidelity, and production readiness before human lead approval. Accepts a GitHub PR URL or local CHANGE_ID."
aliases:
  - impl-review
  - code-review-asdlc
---

# /asdlc:impl-review — CI-Triggered Independent Implementation Reviewer

This skill executes **independent AI implementation review**, triggered by CI when a PR carries the `asdlc:impl-review` label.
It posts its findings as a **markdown PR comment** via the GitHub API so the human lead sees them inline on the PR.

It applies the **Player ≠ Referee** principle: the reviewing agent MUST NOT be the agent that authored the implementation.

> [!IMPORTANT]
> **Scope**: Reviews *implementation conformance and code quality* — spec adherence, test rigor, architecture, and production safety.
> Requires `asdlc verify <CHANGE_ID>` to have passed (12 gates) before this review is meaningful.
> Does NOT re-run `asdlc verify`. Does NOT review spec intent — that is `asdlc-spec-review`.
> Output is a **PR comment**, not a local file.

---

## Trigger

This skill is invoked by CI when a PR is labeled `asdlc:impl-review`. The typical invocation in a GitHub Actions workflow or Jenkinsfile:

```yaml
# GitHub Actions example
- name: AI Implementation Review
  if: contains(github.event.pull_request.labels.*.name, 'asdlc:impl-review')
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    PR_NUMBER: ${{ github.event.pull_request.number }}
    REPO: ${{ github.repository }}
  run: |
    # Agent CLI / SDK invokes this skill with: /asdlc:impl-review $PR_NUMBER $REPO
```

```groovy
// Jenkinsfile example
stage('Implementation AI Review') {
  when { expression { env.IS_IMPL == 'true' } }
  steps {
    withCredentials([string(credentialsId: 'github-token', variable: 'GH_TOKEN')]) {
      sh "${env.ASDLC} impl-review --pr ${env.PR_NUMBER} --repo ${env.REPO}"
    }
  }
}
```

---

## Workflow Sequence

### Step 1: Acquire PR Context

Run the following commands to collect everything needed for review:

```bash
# List changed files and metadata
gh pr view $PR_NUMBER --repo $REPO --json title,body,baseRefName,headRefName,files

# Read the full implementation diff
gh pr diff $PR_NUMBER --repo $REPO
```

Extract from the PR body or branch:
- `CHANGE_ID` from the `**Change ID**:` field or branch name
- `specSha` from `.openspec.yaml` (read from the base branch or PR file list)

Then read the approved spec to use as ground truth:

```bash
# Read the approved spec from the base branch
git show origin/<baseRefName>:openspec/changes/<CHANGE_ID>/specs/<capability>/spec.md
git show origin/<baseRefName>:openspec/changes/<CHANGE_ID>/tasks.md
```

> [!NOTE]
> Read the **spec first**, then the implementation diff. The spec is the ground truth; the code is the candidate.

---

### Step 2: Apply the Five Review Dimensions

Evaluate the full diff against all five dimensions. Mark each `PASS`, `CONCERN`, or `FAIL`.

#### D1 — Spec Conformance (AC-by-AC)
For every `ACn:` in `specs/**/*.md`:
- Does the implementation satisfy the exact acceptance criterion as written?
- Is the behavior exercised in the mapped `(test: <path>)` test?
- Are there any requirements in the spec with **no implementation coverage**?
- Are there any implemented behaviors with **no corresponding AC** (scope creep)?

Flag scope creep as Major: it bypasses the governance gate and introduces untested surface area.

#### D2 — Code Quality & Architecture
- **Deep modules**: Does each new module expose a simple interface hiding a complex interior? Flag shallow wrappers that leak implementation detail.
- **Single Responsibility**: Does each function / class do one thing? Flag functions mixing IO and business logic in the same body.
- **Error propagation**: Are errors surfaced explicitly (typed error objects or Result types), not swallowed silently?
- **Dead code**: Flag any commented-out or unreachable production code.
- **Naming**: Are names precise and consistent with the spec's domain language (enum values, field names, error codes defined in the spec)?

#### D3 — Test Fidelity & TDD Evidence
- Are tests **behavior-driven**, not implementation-driven? (Assert observable outputs for given inputs, not call order or internal state)
- Are mocks **minimal and scoped**? A mock replacing an entire subsystem and always returning a happy-path fixture is a vacuous test.
- Does each test exercise the **failure path** as well as the happy path?
- Does `tasks.md` contain real test runner output for every `[x]` task (not just "✅ done")?
- Are edge cases from the spec (e.g. rainy-day ranking, high-temp advisory, upstream-API-unavailable fallback) each exercised by a distinct test case?

#### D4 — Production Readiness & Performance
- **NFRs met**: If the spec declares a latency SLA, is there a test or benchmark that fails when the SLA is violated?
- **Resource leaks**: Are HTTP connections, file handles, and streams properly closed?
- **Retry / timeout**: Are upstream HTTP calls wrapped with timeouts to prevent hanging?
- **Observability**: Are structured log statements present at entry and exit of key operations? Are PII fields excluded from logs?

#### D5 — Security & Secret Hygiene
- Are there any hard-coded credentials, API keys, or tokens in the diff?
- Is user-supplied input sanitized before being passed to external API query parameters or shell commands?
- Are error messages free of internal stack traces or system paths that would leak to end users?
- Is any new HTTP endpoint protected from excessively large or malformed payloads?

---

### Step 3: Build the AC Conformance Matrix

For each `ACn:` in the approved spec, produce one row:

| AC | Spec Assertion | Implemented In | Test File | Status |
| :--- | :--- | :--- | :--- | :--- |
| AC1 | <assertion text> | src/<module>.ts | test/<feature>.test.ts | ✅ PASS / ❌ MISSING |

Mark `❌ MISSING` for any AC whose implementation or test cannot be located in the diff.

---

### Step 4: Formulate Findings

Classify each finding:

- **🔴 Blocker** — AC not implemented, test always passes regardless of code, hard-coded secret, resource leak, spec-forbidden behavior present. Blocks merge.
- **🟡 Major** — Scope creep (code not covered by any AC), vacuous mock, missing timeout on upstream HTTP call, PII in logs.
- **🟢 Advisory** — Naming clarity, minor refactor opportunity, optional performance improvement.

---

### Step 5: Post PR Comment

Compose the review as markdown and post it as a PR comment using the GitHub API:

```bash
gh pr comment $PR_NUMBER --repo $REPO --body "$(cat <<'EOF'
<review-markdown>
EOF
)"
```

Format the comment body strictly as:

~~~markdown
## 🤖 AI Implementation Review — `<CHANGE_ID>`

> **Reviewer**: AI Independent Implementation Reviewer (`asdlc-impl-review`)
> **Base spec SHA**: `<specSha>`
> **Verdict**: ✅ APPROVE | 🔴 REQUEST_CHANGES

### Dimension Scores

| Dimension | Rating | Key Finding |
| :--- | :---: | :--- |
| D1 Spec Conformance | ✅ PASS / ⚠️ CONCERN / ❌ FAIL | <one-line summary> |
| D2 Code Quality & Architecture | ✅ / ⚠️ / ❌ | <one-line summary> |
| D3 Test Fidelity & TDD Evidence | ✅ / ⚠️ / ❌ | <one-line summary> |
| D4 Production Readiness | ✅ / ⚠️ / ❌ | <one-line summary> |
| D5 Security & Secret Hygiene | ✅ / ⚠️ / ❌ | <one-line summary> |

### AC Conformance Matrix

| AC | Spec Assertion | Implemented In | Test File | Status |
| :--- | :--- | :--- | :--- | :--- |
| AC1 | <assertion text> | src/<module>.ts | test/<feature>.test.ts | ✅ PASS |

### 🔴 Blocking Findings
<!-- Omit section if none -->
1. **[Blocker]** `<file>:<line-range>` — AC<n>: <description of gap or violation>

### 🟡 Major Findings
<!-- Omit section if none -->
1. **[Major]** <description>

### 🟢 Advisory Notes
<!-- Omit section if none -->

---
*Human lead: review the findings above, then merge when satisfied. After merge, run `asdlc archive <CHANGE_ID>`.*
~~~

---

### Step 6: Set CI Status

After posting the comment:

- **If APPROVE**: set CI check status to `success` (green). The PR is unblocked for lead approval and merge.
- **If REQUEST_CHANGES**: set CI check status to `failure` (red). The PR is blocked until blockers are resolved.

```bash
gh api repos/$REPO/statuses/$SHA \
  -f state="success|failure" \
  -f context="asdlc/impl-ai-review" \
  -f description="AI Impl Review: APPROVE|REQUEST_CHANGES" \
  -f target_url="$PR_URL"
```
