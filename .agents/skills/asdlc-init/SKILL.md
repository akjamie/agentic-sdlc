---
name: asdlc-init
description: "Initialize an enterprise repository for Agentic SDLC: setup OpenSpec, Graphify code AST graph, governance policies, CI pipelines, and bundled skills."
---

# /asdlc:init - Repository Initialization & Tooling Setup

This skill executes **Stage 1 (Init)** of the Agentic SDLC. It transitions an unmanaged or standard codebase into an enterprise-governed agentic repository.

---

## What this skill does

1. **Detects Environment**: Inspects the repository type (Node, Python, Go, Java) and active agent toolchains (`.agents`, `.claude`, `.opencode`, Cursor, etc.).
2. **Confirms CI Strategy**: Prompts the developer whether to generate a CI gate pipeline (`--ci jenkins`).
3. **Executes `asdlc init`**: Runs the CLI initialization command to install:
   - The pinned OpenSpec engine (as devDependency)
   - Graphify code knowledge graph engine
   - Enterprise managed schema (`agentic-repo-change`)
   - Platform governance policy (`.sdlc/policy.yaml`)
   - Git hook guards (`.githooks/` for pre-push and post-merge)
   - Bundled IDE skills (`grilling`, `asdlc-apply`, and `/asdlc:*` suite)
   - Context routing layer (`AGENTS.md`)
4. **Validates Health**: Automatically runs `asdlc doctor` to ensure zero configuration drifts.

---

## Workflow Sequence

### Step 1: Inquire CI & Setup Preferences
Ask the user if they want automated Jenkins CI gate pipeline generation:
- Standard: `asdlc init`
- With Jenkins CI: `asdlc init --ci jenkins`

### Step 2: Execute Initialization
Run in the repository root:

```powershell
asdlc init --ci jenkins
```

Parse output and verify:
- `installed openspec` (pinned engine)
- `installed managed schema v1`
- `wrote governance config (openspec/config.yaml)`
- `installed .githooks`
- `installed bundled skills -> .agents/skills/`
- `built graphify code graph -> graphify-out/`
- `refreshed AGENTS.md`

### Step 3: Run Environment Health Check
Execute:

```powershell
asdlc doctor
```

Verify that all checks are `[PASS]`:
- Node version >= 20.19
- OpenSpec CLI present
- Managed schema installed centrally
- `.sdlc/policy.yaml` present
- `AGENTS.md` routing valid

### Step 4: Next Steps Orientation
Inform the developer:
> "Repository successfully initialized with Agentic SDLC governance! To start your first feature, run:
> `/asdlc:new \"<your feature requirement>\"`"
