---
name: asdlc-pr
description: "Open a Spec or Implementation PR: pre-flight checks (lint vs verify), git pushing, auto-extract title/body, and attach labels (asdlc:spec-review vs asdlc:impl-review) for CI AI review."
---

# /asdlc:pr - Automated Pull Request Engine (Spec & Implementation)

This skill opens a **Spec PR** (Stage 3) or an **Implementation PR** (Stage 6.5) with deterministic pre-flight quality gates and distinct labels for CI AI review triggers.

---

## Command

```powershell
asdlc pr <CHANGE_ID> <targetBranch>
```

- `<targetBranch>`: Target branch to merge into (e.g. `main`, `develop`, `release/*`). Required.
- Zero manual flags: `asdlc pr` automatically detects whether to open a Spec PR or an Implementation PR.

---

## Dual-PR Lifecycle & Pre-flight Gates

| PR Type | Phase & Moment | Pre-Flight Guard | Auto Labels | CI Automation Trigger |
| :--- | :--- | :--- | :--- | :--- |
| **Spec PR** | Stage 3 (After drafting proposal & specs) | **`asdlc lint <ID>`**<br>(0 blocking BDD/AC issues) | `asdlc:spec-review`<br>`spec` | Runs `asdlc lint` + triggers **Spec AI Review** |
| **Impl PR** | Stage 6.5 (After TDD apply & tasks complete) | **`asdlc verify <ID>`**<br>(12 deterministic gates pass) | `asdlc:impl-review`<br>`impl` | Runs `asdlc verify` + triggers **Code AI Review** |

---

## Execution Pipeline

1. **Auto-Detection**: Determines PR phase based on branch name (`spec/*` vs `impl/*`), change approval state (`ready_for_impl`), and tasks completion.
2. **Pre-flight Quality Gate**:
   - For Spec PR: executes `asdlc lint <ID>`. Fails fast if any blocking findings exist.
   - For Impl PR: executes `asdlc verify <ID>`. Fails fast if any of the 12 implementation gates fail.
3. **Title & Body Extraction**:
   - Spec PR: derives clean title (`spec(<slug>): <title>`) and embeds proposal intent.
   - Impl PR: derives title (`impl(<slug>): <title>`) and embeds completed tasks, TDD evidence, and spec intent.
4. **Commit & Push**: Stages changes, commits with standard prefix, and pushes branch to origin.
5. **Three-Tier Creation Strategy**:
   - **Tier 1 (CLI)**: Tries `gh pr create` (or `glab mr create`) with `asdlc:spec-review` or `asdlc:impl-review` label.
   - **Tier 2 (Direct REST API)**: If CLI is unavailable, uses `GITHUB_TOKEN` or `GITLAB_TOKEN` to create PR and attach labels via REST API.
   - **Tier 3 (Browser Fallback)**: Generates a 1-click comparison URL pre-filled with branch and label parameters.
