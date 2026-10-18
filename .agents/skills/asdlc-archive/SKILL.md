---
name: asdlc-archive
description: "Explicitly close and archive a verified change (Stage 7): confirm post-merge review, move change to archive, refresh code knowledge graph, and update AGENTS.md system status."
---

# /asdlc:archive - Deliberate Human Archive Gate

This skill executes **Stage 7 (Archive)** of the Agentic SDLC. Archiving is an explicit, human-confirmed milestone — never automatically triggered by verify — marking that post-merge testing and human validation are complete.

---

## Why Archive is an Explicit Gate

1. `asdlc verify` proves that code matches the approved spec on CI.
2. In production engineering, teams often perform staging regression runs, canary validations, or stakeholder demos after merge.
3. Therefore, **a human makes the call** to archive and close the change.

---

## Workflow Sequence

### Step 1: Human Confirmation Check
Confirm with the user:
> "Have post-merge verification, staging testing, and stakeholder reviews completed for change `<CHANGE_ID>`?"

Wait for human confirmation before proceeding.

### Step 2: Capture Durable Lessons Learned
Before archiving, check if this change introduced durable system knowledge (new conventions, commands, architectural patterns). If so, update the relevant section of `AGENTS.md` (while leaving the `<!-- asdlc:routing -->` blocks intact).

### Step 3: Execute `asdlc archive`
Run:

```powershell
asdlc archive <CHANGE_ID>
```

The CLI:
1. Moves `openspec/changes/<SLUG>/` into `openspec/changes/archive/<SLUG>/`.
2. Syncs living specs into `openspec/specs/` and records the capability in `README.md`.
3. Rebuilds the AST knowledge graph (`graphify-out/`) against the new HEAD commit.
4. Creates `AGENTS.md` (if missing) and regenerates its `system-status` block with newly calculated architectural hubs and god nodes.

### Step 4: Confirm Archive Completion
Summarize the result to the user:
> "✅ Change `<CHANGE_ID>` successfully archived!
> - The change artifacts are archived under `openspec/changes/archive/<SLUG>/`.
> - The code knowledge graph has been refreshed to reflect the updated codebase.
> - `AGENTS.md` is updated with fresh system status."
