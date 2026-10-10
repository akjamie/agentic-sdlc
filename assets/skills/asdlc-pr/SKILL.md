---
name: asdlc-pr
description: "Open a Spec PR: pre-flight linting, git branch pushing, auto-extract title/body from proposal.md, and create PR via CLI, REST API, or browser link."
---

# /asdlc:pr - Automated Spec Pull Request Creation

This skill opens a **Spec PR** for reviewing proposed intent before implementation starts.

---

## Command

```powershell
asdlc pr <CHANGE_ID> <targetBranch>
```

- `<targetBranch>`: Target branch to merge into (e.g. `main`, `develop`, `staging`). Required.

---

## Execution Pipeline

1. **Pre-flight Lint**: Automatically executes `asdlc lint <ID>`. Fails fast if any blocking findings exist.
2. **Title & Body Extraction**: Derives clean PR title from `proposal.md` (`# Proposal: <title>`) and embeds the structured proposal as the PR body.
3. **Commit & Push**: Stages latest spec changes on the current branch and pushes to origin (`git push -u origin <branch>`).
4. **Three-Tier Creation Strategy**:
   - **Tier 1 (CLI)**: Tries `gh pr create` (or `glab mr create`) with `asdlc:spec-review` label.
   - **Tier 2 (Direct REST API)**: If CLI is unavailable, checks `GITHUB_TOKEN` or `GITLAB_TOKEN` and calls the platform REST API directly.
   - **Tier 3 (Browser Fallback)**: If neither is configured, prints a 1-click browser comparison URL pre-filled with branch parameters.

---

## Prerequisites & Tools

- `asdlc` does NOT require heavy bundled browser tools or vendor external CLIs.
- Standard developer CLIs (`gh`, `glab`) or API tokens (`GITHUB_TOKEN`) are optional for headless automation.
