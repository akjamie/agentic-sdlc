---
name: asdlc-apply
description: "Stage 5: Guarded task-level TDD implementation loop"
---

# /asdlc-apply - Guarded Implementation Launcher

Launch task-level Test-Driven Development (TDD) loop from `tasks.md`.

## Usage

```bash
asdlc apply <CHANGE_ID> --agent [--from-pr <pr>] [--auto-pr] [--target-branch <branch>]
```

## Behavior

1. **Approval Guard**: Enforces that the spec has been approved and `approvedSha` is locked (or L0/L1 single-PR mode).
2. **Task-Level TDD Loop**:
   - RED: Author failing unit/integration tests mapped to requirement ACs.
   - GREEN: Implement minimal production code to pass the tests.
   - REFACTOR: Clean code structure without altering behavior.
   - EVIDENCE: Record passing test evidence.
3. **Autonomous PR Review Triage (`--from-pr <pr>`)**:
   - Classifies unresolved review threads into `SUGGESTION_BLOCK`, `ACTION_REQUIRED`, `INFORMATIONAL_QUESTION`, or `NON_ACTIONABLE`.
   - Applies fixes with `(ref: #<threadId>)` commit trailers; replies without mutating code for questions; never mutates locked specs or self-resolves disputed spec-conflict threads (`asdlc:needs-human-arbitration`).
4. **Anti-Hallucination & Anti-Drift Guard**: Prevents modifying locked specification paths during code implementation.
