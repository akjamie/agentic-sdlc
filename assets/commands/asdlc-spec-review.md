---
name: asdlc-spec-review
description: "Stage 3: Independent AI Spec & Architecture Review (Player != Referee)"
---

# /asdlc-spec-review - Independent Spec & Architecture Review

Evaluate a Spec PR, RFC, `proposal.md`, `design.md`, and `specs/**` in an isolated session (`Player != Referee`) before human Tech Lead approval.

## Usage

Provide a PR URL, PR number, or local `<CHANGE_ID>` inside your AI Agent session:

- `/asdlc-spec-review https://github.com/<org>/<repo>/pull/<N>`
- `/asdlc-spec-review #<N>`
- `/asdlc-spec-review <CHANGE_ID>`

## Behavior

1. **Trusted Grounding**: Inspect `proposal.md`, `design.md`, `clarifications.md`, `specs/**`, and `explore.md`. When reviewing a PR, read `REVIEW.md` / `.sdlc/policy.yaml` from `origin/<baseBranch>`.
2. **7-Dimension Audit (D1–D7)**:
   - Completeness, ambiguity/contradiction, cross-repo consistency, contract impact, testability, security/privacy, and UI/API design soundness.
3. **Structured Output & Round Anchor**:
   - Include `<!-- asdlc:review-round:<N> -->` at the top of PR comments for deterministic round tracking.
   - In **PR Mode**, post the review comment directly via `gh pr comment` and set the `asdlc/spec-ai-review` commit status (`success` or `failure`).
   - In **Local Mode**, print the formatted review report directly without posting to GitHub.
