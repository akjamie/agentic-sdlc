---
name: asdlc-review
description: "[DORMANT / CI-MANAGED] Spec review is executed automatically by CI on PRs (leaving comments and summary directly on GitHub/GitLab). Local review.md generation is dormant."
---

# /asdlc:review - Independent Spec Review (Dormant / CI-Managed)

> [!NOTE]
> **Workflow Update**: Local generation of `review.md` is **dormant**. 
> Spec quality and 6-dimension reviews are executed automatically by the **CI AI Reviewer Action** on Spec PRs. 
> Feedback and ratings are posted directly as PR comments/summaries to facilitate Human TL Review.

This skill is retained for reference or manual pre-PR dry runs if requested. When invoked, it switches into the **Independent Reviewer** role (Player ≠ Referee). The reviewer MUST NOT be the authoring agent.

---

## Review Dimensions

Every change is evaluated along six dimensions:

1. **Completeness**: Are all user journeys covered? Are edge cases, error conditions, and nil/empty inputs handled?
2. **Ambiguity**: Are requirements clear and unambiguous? Does each use strict normative language (`SHALL` / `MUST`) rather than passive voice?
3. **Cross-repo consistency**: Does this change break or impact cross-repo API/event contracts? If so, is a System Design Amendment required?
4. **Contract impact**: Are breaking changes flagged with `**BREAKING**` in `proposal.md`? Are backwards compatibility guarantees documented?
5. **Testability**: Does every requirement have verifiable Acceptance Criteria (`AC<n>`) with concrete test paths?
6. **Security**: Are authentication, authorization, input validation, secret hygiene, and data privacy respected?

---

## Workflow Sequence

### Step 1: Read Change Context (Read-Only)
Inspect all intent files under `openspec/changes/<CHANGE_ID>/`:
- `proposal.md`
- `specs/**/*.md`
- `explore.md`

### Step 2: Formulate Findings
Categorize findings by severity:
- **Blocker**: Spec violation, missing acceptance criteria, untestable assertion, or security risk.
- **Major**: Ambiguous scenario, missing `**GIVEN**`, or unaddressed edge cases.
- **Minor / Advisory**: Documentation clarity, style suggestions.

### Step 3: Author `review.md`
Write `openspec/changes/<CHANGE_ID>/review.md` with the following structure:

```markdown
# Review: <CHANGE_ID>

## Summary
<2-3 sentences summarizing the change and the evaluation outcome>

## Dimensions Evaluation
- Completeness: PASS | CONCERN | FAIL
- Ambiguity: PASS | CONCERN | FAIL
- Cross-repo consistency: PASS | CONCERN | FAIL
- Contract impact: PASS | CONCERN | FAIL
- Testability: PASS | CONCERN | FAIL
- Security: PASS | CONCERN | FAIL

## Requirement -> Implementation -> Test Traceability
| Requirement | Acceptance Criteria | Target Test | Status |
|---|---|---|---|
| Req 1 | AC1: ... | test/foo.test.js | VERIFIED |

## Blocking Findings
(none)
<!-- Or list: 1. [Blocker] <description> -->

## Advisory Notes
<Optional recommendations>

## Verdict
APPROVE
<!-- Or: NEEDS_REVISION -->
```

### Step 4: Next Steps
- If verdict is `APPROVE`: Guide the author to run `/asdlc:lint <CHANGE_ID>` and submit the Spec PR.
- If verdict is `NEEDS_REVISION`: List blocking items that the spec author must address.
