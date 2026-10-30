# Usage Guide

## Prerequisites

- Node.js >= 20.19.0
- Git
- (uv or pip for Graphify — `asdlc init` installs it for you)

## Install asdlc

Install it from npm, your internal tarball, or git:

```bash
# A. from public npm registry
npm install -g @akjamie/agentic-sdlc

# B. directly from remote git repository (npm v12+ requires --allow-git=all)
npm install -g --allow-git=all git+https://github.com/akjamie/agentic-sdlc.git

# C. local development
npm install -g .
```

> [!NOTE]
> **npm v12+ Security Policy (`EALLOWGIT`)**:
> Starting with **npm v12** (Node.js 24+), fetching packages from Git references is disabled by default (`allow-git = "none"`). When installing directly from GitHub, pass `--allow-git=all` (or configure `allow-git=all` in `~/.npmrc`). If overwriting a previously installed binary, append `--force`.

The engines (OpenSpec, Graphify) are installed by `asdlc init`, not by hand.

## Set up a repository (once)

```bash
cd your-repo
asdlc init --ci jenkins
```

This one command:

1. installs OpenSpec (a pinned devDependency) and Graphify (uv/pip)
2. runs `openspec init` and wires your agentic IDE (auto-detected)
3. installs the managed schema centrally — no per-repo copy
4. installs bundled skills (`grilling`, `asdlc-apply`) and slash commands across all detected IDE tools
5. writes `openspec/config.yaml` (governance rules + lint policy)
6. writes `.sdlc/policy.yaml` (platform-owned; protect with CODEOWNERS)
7. installs `.githooks/` (pre-push, post-merge) + `core.hooksPath`
8. writes a `Jenkinsfile` (CI gate pipeline)
9. writes `AGENTS.md` routing (workflow + system status from the code graph)

---

## 🤖 IDE Slash-Command & Tool Parity Matrix

`asdlc init` and `asdlc update` auto-detect configured AI tools in your repository and guarantee consistent slash commands and skills across all environments:

| Tool | Detected Marker | Slash Commands Path | Command Format | Skills Target |
| :--- | :---: | :--- | :---: | :--- |
| **Claude Code** | `.claude/` | `.claude/commands/asdlc-*.md` | Markdown (`.md`) | `.claude/skills/` |
| **OpenCode** | `.opencode/` | `.opencode/commands/asdlc-*.md` | Markdown (`.md`) | `.opencode/skills/` |
| **Pi (`oh-my-pi`)** | `.pi/` | `.pi/prompts/asdlc-*.md` | Markdown (`.md`) | `.pi/skills/` |
| **Antigravity** | `.agents/` (or `.antigravity/`) | `.agents/workflows/asdlc-*.md` | Markdown (`.md`) | `.agents/skills/` |
| **GitHub Copilot** | `.github/` | `.github/prompts/asdlc-*.prompt.md` | Copilot (`.prompt.md`) | `.github/skills/` |
| **Cursor** | `.cursor/` | `.cursor/commands/asdlc-*.md` | Markdown (`.md`) | `.cursor/skills/` |
| **Trae** | `.trae/` | `.trae/commands/asdlc-*.md` | Markdown (`.md`) | `.trae/skills/` |
| **Windsurf / Devin** | `.windsurf/` (or `.devin/`) | `.windsurf/workflows/asdlc-*.md` | Markdown (`.md`) | `.windsurf/skills/` |
| **Gemini CLI** | `.gemini/` | `.gemini/commands/asdlc/*.toml` | TOML (`.toml`) | `.gemini/skills/` |

### Standard Slash Commands
- `/asdlc-new` — Stage 1/2: Grounding, high-signal grilling interview, settle clarifications, author specs.
- `/asdlc-lint` — Stage 3: Deterministic BDD & AC quality checks (R0–R8).
- `/asdlc-pr` — Stage 3.5: Automated Spec/Impl PR generation with governance labels.
- `/asdlc-approve` — Stage 4: Cryptographic `specSha` lock & transition to `READY_FOR_IMPL`.
- `/asdlc-apply` — Stage 5: Guarded task-level TDD implementation loop.
- `/asdlc-test` — Stage 5.5: Execute AC test runners mapped to requirements.
- `/asdlc-verify` — Stage 6: Audit 12 enterprise quality gates.
- `/asdlc-archive` — Stage 7: Merge deltas to living specs & refresh AST graph.
- `/asdlc-status` — Change orientation or compact repository portfolio view.
- `/asdlc-doctor` — Toolchain diagnostic check validating per-tool command & skill health.

---

## The seven stages

### 1. Start a spec — `asdlc new "<requirement>"`
<!-- Note: Stage 1 is numbered 2 in the 7-stage pipeline (init is 1). -->

```bash
asdlc new "i want to build jwt authentication for payment api"
# or with a Jira ticket:
asdlc new "TECH-1234: add rate limiting"
# or with explicit ID override:
asdlc new "add rate limiting" --id tech-1234
```

Derives a clean canonical slug (e.g. `jwt-authentication-payment-api` or `tech-1234-rate-limiting`),
scaffolds `openspec/changes/<slug>/`, refreshes the knowledge graph, writes `explore.md`
(grounded in queries using the requirement terms), and seeds `clarifications.md`.

Then:

1. **Batch-Grill the author.** Your IDE agent runs the `grilling` skill using the
   **`batch-grill-me`** protocol (evaluating the entire decision frontier in 1-2 structured
   batches with recommended defaults) and records settled decisions in `clarifications.md`.
2. **Author the spec.** Write `proposal.md`, `specs/<capability>/spec.md`, and
   `review.md`, grounded in `explore.md`.

### 2. Check the spec — `asdlc lint <ID>`

```bash
asdlc lint TECH-1234
```

Checks: required artifacts, review verdict `APPROVE`, no blocking findings, BDD
shape, scenario-to-AC coverage (`R5-scenario-coverage`), and AC→test mapping. Run before opening the spec PR.

### 3. Approve — merge the spec PR, then `asdlc approve <ID>`

```bash
git checkout -b asdlc/tech-1234
git add openspec/changes/tech-1234 && git commit -m "spec(TECH-1234): ..."
git push -u origin asdlc/tech-1234
gh pr create --fill
```

The pre-push hook triggers Jenkins (`asdlc lint`), which posts a commit status.
A human merges the spec PR — **the merge is the approval**. On main:

```bash
asdlc approve TECH-1234
```

### 4. Implement — `asdlc apply <ID>`, then `/opsx-apply`

```bash
asdlc apply TECH-1234
```

Refuses if the spec is not approved. Then implement with `/opsx-apply` in your
IDE using task-level TDD + converge.

### 5. Acceptance Tests — `asdlc test <ID>`

```bash
# Local TDD validation: run tests mapped from change specs
asdlc test TECH-1234

# CI gate execution: output structured JSON for AI review
asdlc test TECH-1234 --json
```

Executes all test files mapped via `(test: <path>)` in `specs/**/*.md`.
- **Local TDD**: Agents run it locally to verify red-to-green transitions.
- **CI Gate**: CI Implementation Review executes it independently to enforce **Player ≠ Referee** (blocking PR merge if any test fails).

### 6. Verify — `asdlc verify <ID>`

```bash
asdlc verify TECH-1234 --repo your-repo
```

Runs on the implementation PR in CI. Exit code non-zero = do not merge.

### 7. Finish — `asdlc archive <ID>`

```bash
asdlc archive TECH-1234
```

Archives the change, refreshes the knowledge graph, and updates `AGENTS.md`.

## Navigation

```bash
asdlc status TECH-1234   # where am I in the seven stages?
asdlc doctor             # is my environment set up correctly?
```

## Spec gap handling

If implementation reveals a spec problem, classify it:

| Class | What | Action |
|---|---|---|
| A | Implementation error | Reproduce with a test, fix in this PR |
| B | Missing test | Add the test, stay in this PR |
| C | Spec gap / conflict | Close the change; start a fresh `asdlc new` |
| D | Post-merge defect | New Jira bug; if the spec itself is wrong, `asdlc new` |

A bad spec is **never edited** — close it and start fresh.