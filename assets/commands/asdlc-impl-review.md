---
name: asdlc-impl-review
description: "Stage 6.5: Independent AI Implementation Review & 3-Round Audit (Player != Referee)"
---

# /asdlc-impl-review - Independent Implementation Review

Evaluate an Implementation PR or local change in an isolated session (`Player != Referee`) against the locked base-branch specification, `REVIEW.md`, and test evidence.

## Usage

Provide a PR URL, PR number, or local `<CHANGE_ID>` inside your AI Agent session:

- `/asdlc-impl-review https://github.com/<org>/<repo>/pull/<N>`
- `/asdlc-impl-review #<N>`
- `/asdlc-impl-review <CHANGE_ID>`

## Behavior

1. **Trusted Base-Branch Grounding**: Read approved specs and `REVIEW.md` from `origin/<baseBranch>` (never from untrusted PR `HEAD`).
2. **Incremental Diff on Rounds 2–3**: Extract the previous `lastReviewedSha` / `<!-- asdlc:review-round:N -->` anchor and inspect `git diff <lastReviewedSha>...HEAD`, rendering a `Re-Review Accounting` table.
3. **5-Dimension Audit (D1–D5) & Defect Attribution**:
   - Audit spec conformance (AC matrix), code quality, test fidelity (`asdlc test <ID> --json`), production readiness, and security hygiene.
   - Distinguish `🔴 [Blocker: Introduced]` / `🟡 [Major: Introduced]` from non-blocking `⚪ [Tech Debt: Pre-existing]`.
4. **3-Round Cap & Delivery**:
   - Include `<!-- asdlc:review-round:<N> -->` at the top of PR comments.
   - Submit formal GitHub PR Review (`gh api repos/$REPO/pulls/$PR/reviews`) or `gh pr comment` + `asdlc/impl-ai-review` commit status (`success` or `failure`).
   - Escalate with `asdlc:needs-human-arbitration` if unresolved after Round 3.
