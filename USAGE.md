# Usage Guide

## Prerequisites

- Node.js >= 20.19.0
- Git
- (uv or pip for Graphify — `asdlc init` installs it for you)

## Install asdlc

`asdlc` is **not** on the public npm registry. Install it from your internal
tarball or registry:

```bash
# A. internal tarball (the recommended start)
npm install -g https://internal-artifactory/asdlc/asdlc-0.1.0.tgz

# B. internal private registry (once you run one)
npm install -g asdlc
```

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
4. writes `openspec/config.yaml` (governance rules + lint policy)
5. writes `.sdlc/policy.yaml` (platform-owned; protect with CODEOWNERS)
6. installs `.githooks/` (pre-push, post-merge) + `core.hooksPath`
7. writes a `Jenkinsfile` (CI gate pipeline)
8. writes `AGENTS.md` routing (workflow + system status from the code graph)

## The seven stages

### 1. Start a spec — `asdlc new <ID>`

```bash
asdlc new TECH-1234
```

Scaffolds `openspec/changes/tech-1234/`, refreshes the knowledge graph, writes
`explore.md` (affected modules / call chains), and seeds `clarifications.md`.

Then:

1. **Grill the author.** Your IDE agent runs the `grilling` skill (a relentless
   design-tree interview, in rounds) and records settled decisions in
   `clarifications.md`.
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