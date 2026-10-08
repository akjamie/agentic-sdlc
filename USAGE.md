# Usage Guide

## Prerequisites

- Node.js >= 20.19.0
- npm (for dependency management)
- Git

## Setup (one time per repo)

```bash
cd your-repo
npm i -D agentic-sdlc @fission-ai/openspec
npx asdlc init --ci jenkins
```

This single command:
1. Installs OpenSpec CLI (pinned version) as a devDependency
2. Installs Graphify (via uv/pip) for code knowledge graphs
3. Runs `openspec init` to wire agent tooling (detected automatically)
4. Installs the BU-managed schema centrally (no per-repo copy)
5. Writes `openspec/config.yaml` (governance rules + lint policy)
6. Writes `.sdlc/policy.yaml` (platform-owned, CODEOWNERS-protected)
7. Installs `.githooks/` (pre-push, post-merge) + sets `core.hooksPath`
8. Writes a `Jenkinsfile` (CI gate pipeline)
9. Writes `AGENTS.md` routing (workflow + system status from the code graph)

## The 7-stage flow

### Stage 1: `asdlc init` (one time)

```bash
asdlc init --ci jenkins
```

### Stage 2: `asdlc new <CHANGE-ID>` (start a spec)

```bash
asdlc new TECH-1234
```

This:
- scaffolds `openspec/changes/tech-1234/` via OpenSpec
- refreshes the code knowledge graph (graphify, behind the scenes)
- writes `explore.md` (structured queries: affected modules, call chains)
- seeds `clarifications.md` (for the grilling interview)

Then:
1. **Grill the author**: your IDE agent runs the `grilling` skill (relentless
   design-tree interview, in rounds). Record settled decisions in `clarifications.md`.
2. **Author the spec**: write `proposal.md`, `specs/<capability>/spec.md`, and
   `review.md`, grounded in `explore.md`.

Each spec requirement must have:
- A GIVEN/WHEN/THEN scenario
- An Acceptance Criteria block: `- [ ] AC1: assertion (test: path)`
- A Test Strategy section

### Stage 3: `asdlc lint <CHANGE-ID>` (check the spec)

```bash
asdlc lint TECH-1234
```

Checks: artifacts present, review verdict APPROVE, no blocking findings,
BDD shape, AC→test mapping. Run before opening the spec PR.

### Stage 3.5: Spec PR

```bash
git checkout -b asdlc/tech-1234
git add openspec/changes/tech-1234
git commit -m "spec(TECH-1234): ..."
git push -u origin asdlc/tech-1234
gh pr create --fill
```

The pre-push hook triggers Jenkins (`asdlc lint`), which posts a commit status.
A human merges the spec PR → **the merge is the approval**.

### Stage 4: `asdlc approve <CHANGE-ID>` (after merge)

```bash
asdlc approve TECH-1234
```

Records the path-limited approved SHA, tags `approved/TECH-1234`, marks
`READY_FOR_IMPL`. Run on main after pulling the merge.

### Stage 5: `asdlc apply <CHANGE-ID>` (start implementing)

```bash
asdlc apply TECH-1234
```

Guards: refuses if the spec is not approved. Then use `/opsx-apply` in your
agentic IDE to implement with task-level TDD + converge.

### Stage 6: `asdlc verify <CHANGE-ID>` (check the implementation)

```bash
asdlc verify TECH-1234 --repo your-repo-name
```

Checks: artifacts, approved SHA, flow state, tasks complete, BDD/AC,
`openspec validate --strict`, external checks (tests/contract/security),
and independent AI verification (if configured).

Run this in CI on the implementation PR. Exit code non-zero = don't merge.

### Stage 7: `asdlc archive <CHANGE-ID>` (finish)

```bash
asdlc archive TECH-1234
```

Archives the change + refreshes the knowledge graph + updates AGENTS.md.

## Navigation

```bash
asdlc status TECH-1234   # where am I in the 7 stages?
asdlc doctor             # is my environment set up correctly?
```

## Spec gap handling

If implementation reveals a spec problem, classify it:

| Class | What | Action |
|---|---|---|
| A | Implementation error | Reproduce with a test, fix in this PR |
| B | Missing test | Add the test, stay in this PR |
| C | Spec gap/conflict | Close the change, start a fresh `asdlc new` |
| D | Post-merge defect | New Jira bug; spec wrong → `asdlc new` |

A bad spec is **never edited**. Close it and start fresh.
