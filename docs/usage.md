# Usage Guide

## Prerequisites

- Node.js >= 20.19.0
- Git
- (uv or pip for Graphify — `asdlc init` installs it for you)

## Install asdlc

`asdlc` is **not** on the public npm registry. Install it from your internal
tarball or registry:

```bash
# A. directly from remote git repository (npm v12+ requires --allow-git=all)
npm install -g --allow-git=all git+https://github.com/akjamie/agentic-sdlc.git

# B. internal tarball
npm install -g https://internal-artifactory/asdlc/asdlc-0.1.0.tgz

# C. local development / private registry
npm install -g .
# or: npm install -g asdlc
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
4. installs bundled skills (`grilling`, `asdlc-apply`) into `.agents/skills/`
5. writes `openspec/config.yaml` (governance rules + lint policy)
6. writes `.sdlc/policy.yaml` (platform-owned; protect with CODEOWNERS)
7. installs `.githooks/` (pre-push, post-merge) + `core.hooksPath`
8. writes a `Jenkinsfile` (CI gate pipeline)
9. writes `AGENTS.md` routing (workflow + system status from the code graph)

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
shape, AC→test mapping. Run before opening the spec PR.

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

### 5. Verify — `asdlc verify <ID>`

```bash
asdlc verify TECH-1234 --repo your-repo
```

Runs on the implementation PR in CI. Exit code non-zero = do not merge.

### 6. Finish — `asdlc archive <ID>`

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