# agentic-sdlc — Layered Architecture Design

> What's core, what's CLI, what's IDE skills/slash commands.

---

## The Mental Model: Three Planes

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PLANE 3 — IDE / Agent Surface (skills, slash commands, prompts)        │
│  ● asdlc:new  ● asdlc:lint  ● asdlc:status  ● asdlc:review             │
│  ● asdlc:apply  ● asdlc:verify  ● asdlc:archive  ● asdlc:init           │
│  Audience: the AI agent inside the IDE (not the human directly)         │
├─────────────────────────────────────────────────────────────────────────┤
│  PLANE 2 — CLI Surface (bin/asdlc.js → Commander commands)              │
│  ● init  ● new  ● lint  ● approve  ● apply  ● test  ● verify  ● archive │
│  ● status  ● doctor                                                     │
│  Audience: developers + CI pipelines (deterministic, exit-coded)        │
├─────────────────────────────────────────────────────────────────────────┤
│  PLANE 1 — Core Library (src/lib/)                                      │
│  Pure functions: no I/O side effects, stable, individually testable     │
│  Audience: CLI commands, skills, future API surfaces, tests             │
└─────────────────────────────────────────────────────────────────────────┘
```

The rule:
- **Core reads and validates; it never prints and rarely writes.**
- **CLI is the thin shell**: parse args → call core → format output → set exit code.
- **IDE skills are conversation**: they call the CLI, interpret output, guide the human, and coordinate multi-step flows the CLI can't do alone (e.g., the grilling interview).

---

## Plane 1 — Core Library (what already exists is mostly correct)

These are the pure-function modules in `src/lib/`. They already have no Commander dependency. The layering is already mostly right here — the main gap is that some business logic is still embedded in `src/commands/`.

### Current lib modules and their correct home

| Module | What it does | Layer status |
|---|---|---|
| `speclint.js` | R0–R8 spec lint rules (pure text → findings) | ✅ Core — correctly isolated |
| `git.js` | `lastCommitTouching`, `headSha`, `changeOnRef`, etc. | ✅ Core — pure git queries |
| `prtype.js` | Classify a PR by path patterns | ✅ Core — pure logic |
| `policy.js` | Load + merge `.sdlc/policy.yaml` | ✅ Core — correct |
| `graphify.js` | Build/refresh graph, query god-nodes | ✅ Core — correct |
| `openspec.js` | Spawn openspec CLI, parse output | ✅ Core — correct |
| `agents.js` | Upsert routing/status blocks in AGENTS.md | ✅ Core — correct |
| `schema.js` | Check managed schema, version pin | ✅ Core — correct |
| `fs.js` | readText, writeText, walkFiles, findUp | ✅ Core — correct |
| `paths.js` | Canonical path helpers | ✅ Core — correct |
| `cliutil.js` | `requireRepo`, `toChangeSlug`, `readLintConfig`, `jsonOut` | ⚠️ Split needed — `requireRepo` is CLI-guard, rest is core |

### Logic currently in commands/ that should be extracted to core

These functions in command files are pure business logic that skills and future surfaces will need:

| Function | Currently in | Should be in |
|---|---|---|
| `verdictOf(text)` | `commands/lint.js` | `lib/speclint.js` or `lib/review.js` |
| `hasBlockingFindings(text)` | `commands/lint.js` | `lib/review.js` |
| `countUncheckedTasks(text)` | `commands/verify.js` | `lib/tasks.js` |
| `runLint(changeId, opts)` | `commands/lint.js` | `lib/lint.js` (new) |
| `runVerify(changeId, opts)` | `commands/verify.js` | `lib/verify.js` (new) |
| `statusChange(changeId, opts)` | `commands/status.js` | `lib/status.js` (new) |
| `mergeChange(changeId, opts)` | `commands/approve.js` | `lib/approve.js` (new) — already exported |
| `newChange(changeId, opts)` | `commands/new.js` | `lib/change.js` (new) |
| `initRepo(opts)` | `commands/init.js` | `lib/init.js` (new) — already exported |
| `doctor(opts)` | `commands/doctor.js` | `lib/doctor.js` (new) — already exported |
| `detectTools(repoRoot)` | `commands/init.js` | `lib/tools.js` (new) |
| `buildPrompt(...)` | `commands/verify.js` | `lib/aiprompt.js` (new) |
| `intent(cdir)` | `commands/verify.js` | `lib/aiprompt.js` (new) |

### Target core module map

```
src/lib/
  # Existing (keep)
  speclint.js      ← R0–R8 lint rules (add verdictOf, hasBlockingFindings)
  git.js           ← all git queries
  prtype.js        ← PR path classification
  policy.js        ← .sdlc/policy.yaml
  graphify.js      ← Graphify integration
  openspec.js      ← OpenSpec CLI adapter
  agents.js        ← AGENTS.md refresh
  schema.js        ← schema management
  fs.js            ← filesystem primitives
  paths.js         ← canonical paths
  log.js           ← structured log output

  # New extractions (move logic out of commands/)
  review.js        ← verdictOf(), hasBlockingFindings()
  tasks.js         ← countUncheckedTasks(), parseTasks()
  change.js        ← newChange(), statusChange(), archiveChange()
  lint.js          ← runLint() — the full lint pipeline
  verify.js        ← runVerify() — the full verify pipeline
  approve.js       ← mergeChange() (already exported from commands/)
  init.js          ← initRepo(), detectTools() (already exported)
  doctor.js        ← doctor() (already exported)
  aiprompt.js      ← buildPrompt(), intent(), extractJson()
  portfolio.js     ← listChanges(), summarizeAll() ← NEW (missing today)
```

---

## Plane 2 — CLI Surface (what changes)

Commands become **thin wrappers**: parse → core call → format output → exit.

Each command should be reducible to ~10 lines:

```js
// commands/lint.js — target shape
export function register(program) {
  program
    .command('lint <changeId>')
    .description('check the spec: artifacts + review record + BDD/AC')
    .option('--repo-root <path>')
    .option('--json', 'stable JSON output for CI')
    .action((changeId, opts) => {
      const result = runLint(changeId, opts);        // core
      process.exitCode = formatLintResult(result, opts); // CLI formatting
    });
}
```

### New CLI commands needed

| Command | Description | Calls |
|---|---|---|
| `asdlc status` *(no args)* | Portfolio view of all open changes | `lib/portfolio.listChanges()` |
| `asdlc status <ID> --json` | Machine-readable single-change status | `lib/change.statusChange()` |
| `asdlc verify <ID> --json` | Machine-readable verify result | `lib/verify.runVerify()` |
| `asdlc init --ci github-actions` | GitHub Actions template | `lib/init.initRepo()` |
| `asdlc init --ci gitlab` | GitLab CI template | `lib/init.initRepo()` |
| `asdlc lint <ID> --explain` | Human-readable lint result with fix hints | `lib/lint.runLint()` + hints map |
| `asdlc test <ID> [--json]` | Run acceptance tests mapped from change specs (TDD & CI gate) | `commands/test.js` (test runner) |
| `asdlc new <ID> --refresh` | Force graph refresh even if fresh | `lib/change.newChange()` |

---

## Plane 3 — IDE Skills / Slash Commands (what's missing today)

This is the biggest gap. IDE skills are **not wrappers around CLI** — they are conversations. They:
1. Call the CLI (via shell, reading JSON output)
2. Interpret and explain results in context
3. Drive multi-step flows that span human turns
4. Make decisions (e.g., recommend answers during grilling)

### Where skills live

```
.agents/skills/
  asdlc-init/
    SKILL.md            ← /asdlc:init (repo setup & tool wiring)
  asdlc-doctor/
    SKILL.md            ← /asdlc:doctor (health diagnostics & automated remediation)
  asdlc-new/
    SKILL.md            ← /asdlc:new (requirement scoping & explore grounding)
  grilling/
    SKILL.md            ← INTERNAL engine (batch-grill-me frontier interview)
  asdlc-lint/
    SKILL.md            ← /asdlc:lint (deterministic BDD & AC verification)
  asdlc-review/
    SKILL.md            ← /asdlc:review (independent 6-dimension referee review)
  asdlc-approve/
    SKILL.md            ← /asdlc:approve (spec PR merge verification, SHA lock, tag, TDD task scaffolding)
  asdlc-apply/
    SKILL.md            ← /asdlc:apply (guard check & 5-phase TDD execution loop)
  asdlc-verify/
    SKILL.md            ← /asdlc:verify (12-gate implementation verification & diagnostics)
  asdlc-archive/
    SKILL.md            ← /asdlc:archive (explicit human closeout, AST graph update, AGENTS.md refresh)
  asdlc-status/
    SKILL.md            ← /asdlc:status (lifecycle progress & active portfolio dashboard)
```

`asdlc init --tools opencode` auto-installs these into `.opencode/skills/` (or the IDE equivalent). Bundled out of the box in `assets/skills/`.

### Skill design: what each skill does vs. what the CLI does

#### `/asdlc:new "<requirement>"`

```
CLI does:
  asdlc new "<requirement>" [--id <slug>]
    → derives clean canonical slug from requirement (e.g. "build user auth with JWT" → user-auth-jwt)
    → openspec new change <slug>
    → records requirement in .openspec.yaml
    → queries graphify with extracted domain terms ("user auth JWT")
    → writes explore.md grounded in real code
    → seeds clarifications.md with requirement context

Skill adds:
  1. Accepts human natural language intent ("i want to build xxx")
  2. Runs asdlc new "<requirement>" --json and gets derived slug
  3. Summarizes affected modules and god nodes from explore.md
  4. Automatically transitions into the internal grilling interview grounded in the requirement
```

#### Internal Grilling Engine: `batch-grill-me` (Stage 2)

This internal skill is triggered during `/asdlc:new`. It runs the high-efficiency batch decision-tree interview.

```
This is a stateful multi-turn interview using the batch-grill-me protocol:

  Round loop:
    1. READ clarifications.md and explore.md
    2. IDENTIFY the full decision frontier:
       - Every design question whose prerequisites are settled
       - Every ambiguity in explore.md that the spec would need to resolve
    3. NUMBER and ASK all frontier questions in one batch
       - For each question, give the RECOMMENDED answer with rationale
       - Look up facts from explore.md / graphify before asking
    4. WAIT for the human's decisions
    5. RECORD settled decisions in clarifications.md (## Settled decisions)
    6. Move resolved questions out of ## Open questions
    7. LOOP until frontier is empty

  When frontier empty:
    "The spec is ready to write. Author:
      - proposal.md (why + impact)
      - specs/<capability>/spec.md (ADDED Requirements + BDD + AC)
      - review.md (independent review)
    Then run /asdlc:lint"
```

#### `/asdlc:lint <ID>`

```
CLI does:
  asdlc lint <ID> --json
    → check artifacts
    → check review.md verdict
    → run R0-R8 spec lint rules
    → exit 0/1 with JSON result

Skill adds:
  1. Run asdlc lint <ID> --json
  2. If pass → "Ready to open the Spec PR. Here's the git workflow: ..."
  3. If fail → For each FAIL row:
       - Explain what rule was violated (R0–R8 in plain language)
       - Show a concrete fix example
       - Point to the exact file and section to edit
  4. Re-run after human edits (loop until pass or human stops)
```

#### `/asdlc:review <ID>` (independent reviewer role)

```
This skill SWITCHES the agent into the independent reviewer persona.
The agent must NOT have been the spec author in this session.

  1. Read explore.md, proposal.md, specs/**
  2. Run a structured review against the spec format rules
  3. Write review.md with:
     ## Summary
     ## Verdict   ← APPROVE | NEEDS_REVISION
     ## Blocking Findings  ← (none) or itemized
     ## Advisory Notes
  4. Remind the human: "I was the reviewer. A DIFFERENT agent or model
     should have authored the spec. If it was me, discard this review
     and use an independent model."
```

#### `/asdlc:approve <ID>`

```
CLI does:
  asdlc approve <ID>
    → classifies PR (must be spec merge touching only openspec/changes/<ID>/)
    → resolves path-limited approved commit SHA (last commit touching proposal.md and specs/)
    → stamps .openspec.yaml (specSha + status: ready_for_impl)
    → tags approved/<ID> @ <approvedSha>
    → commits approval stamp

Skill adds:
  1. Pre-merge check: verifies branch has zero source code diffs (path discrimination)
  2. Guides human PR merge on main/protected branch
  3. Executes asdlc approve <ID> and verifies tag + commit
  4. Scaffolds or validates tasks.md with paired [TEST] and [IMPL] tasks for every AC
  5. Transitions to /asdlc:apply <ID>
```

#### `/asdlc:apply <ID>`

```
CLI does:
  asdlc apply <ID>
    → guard: spec must be approved
    → prints "implement with /opsx-apply"

Skill adds:
  1. Run asdlc apply <ID>
  2. If guard fails → explain why (not approved, wrong branch)
  3. If guard passes:
     a. Read tasks.md — list all unchecked tasks
     b. For each task (TDD loop):
        i.  "Write the test for [task] first."
        ii. Run the test → confirm it FAILS (red)
        iii. "Now implement [task]."
        iv. Run the test → confirm it PASSES (green)
        v.  Check off the task in tasks.md
        vi. Move to next task
  4. When all tasks checked: "Run /asdlc:verify to close the loop."
```

#### `/asdlc:verify <ID>`

```
CLI does:
  asdlc verify <ID> --json
    → 10 deterministic checks
    → optional AI verification
    → exit 0/1 with results

Skill adds:
  1. Run asdlc verify <ID> --json
  2. If pass → "Verify passed. Complete any remaining post-merge testing and human
     review, then run /asdlc:archive <ID> to close the change."
  3. If fail → For each FAIL:
       - approved-spec fail → "The spec was not approved. Run: asdlc approve <ID> on main."
       - tasks-complete fail → "N tasks unchecked. Open tasks.md and complete them."
       - BDD+AC fail → Show which AC has no test file, link to the test path.
       - AI verification fail → Show the AI summary, ask human to review gaps.
  4. Loop until all pass or human escalates.
```

#### `/asdlc:status`

```
CLI does (today):    asdlc status <ID>  → single change status
CLI needs (future):  asdlc status --json → portfolio JSON

Skill:
  1. Run asdlc status --json (or parse plaintext today)
  2. Render a dashboard in the chat:

     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     📋 TECH-1234  Stage 4  ✅ Approved
     📝 TECH-5678  Stage 2  ⏳ Awaiting proposal
     🔴 TECH-9012  Stage 3  ❌ Lint blocked (R5-ac in spec.md)
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  3. Let human pick a change to drill into or act on
```

#### `/asdlc:archive <ID>`

```
Stage 7 — explicit human-triggered close. NOT auto-triggered after verify.
Rationale: verify passes the gate, but teams need to complete post-merge
testing, stakeholder review, and production validation before archiving.
A human must make the call.

CLI does:
  asdlc archive <ID>
    → openspec archive
    → refresh Graphify graph (new HEAD)
    → update AGENTS.md system-status block

Skill adds:
  1. Confirm: "Have post-verify testing and human review completed?"
  2. Run asdlc archive <ID>
  3. Confirm graph + AGENTS.md refreshed
  4. Summary: "Change <ID> archived. The knowledge graph reflects the
     new codebase. Open changes: [list from asdlc status --json]"
```

#### `/asdlc:doctor`

```
CLI does:
  asdlc doctor
    → evaluates 12 platform, engine, schema, policy, and git hook invariants
    → reports PASS / WARN / FAIL with exact failure details

Skill adds:
  1. Runs asdlc doctor
  2. If all pass → confirms zero configuration drift
  3. If warnings/failures → maps check to automated remediation recipe:
     - OpenSpec / schema missing → asdlc init --force
     - Forbidden schema override → git rm tracked local schema
     - Missing hooks → git config core.hooksPath .githooks
     - Stale knowledge graph → graphify .
  4. Automatically guides or runs fix commands, then re-verifies
```

---

## The Full Picture: What Calls What

```
Human (in IDE)
    │
    ▼ types /asdlc:lint TECH-1234
IDE Skill (asdlc-lint/SKILL.md)
    │ runs
    ▼ asdlc lint TECH-1234 --json
CLI (bin/asdlc.js → commands/lint.js)
    │ calls
    ▼ runLint(changeId, opts)          ← lib/lint.js (core, extracted)
        ├─ requireRepo()               ← lib/cliutil.js
        ├─ lintSpecText()              ← lib/speclint.js (pure)
        ├─ verdictOf()                 ← lib/review.js (pure)
        ├─ hasBlockingFindings()       ← lib/review.js (pure)
        └─ readLintConfig()            ← lib/cliutil.js
    │ returns JSON result
CLI formats + exits
Skill reads JSON, explains findings, asks human to fix, loops
```

**The key discipline**: the skill reads the CLI's `--json` output, never scrapes human-readable text. This is why every command needs `--json`.

---

## Implementation Sequence

### Phase 1 — Stabilise the core (prerequisites for skills)

1. Add `--json` to `asdlc status` and `asdlc verify` (status has no `--json` today)
2. Add `asdlc status` (no args) portfolio view
3. Extract `verdictOf`, `hasBlockingFindings` → `lib/review.js`
4. Extract `countUncheckedTasks` → `lib/tasks.js`
5. Extract `runLint`, `runVerify`, `statusChange` into lib modules

All tests pass before any skill work begins.

### Phase 2 — Skills scaffold

6. Create `.agents/skills/asdlc-lint/SKILL.md`
7. Create `.agents/skills/asdlc-status/SKILL.md`
8. Wire `asdlc init --tools <tool>` to copy skills into the IDE directory

### Phase 3 — The grilling loop (internal to asdlc-new)

9. Write the grilling loop instructions into `.agents/skills/asdlc-new/SKILL.md`
   (grilling is a phase within `/asdlc:new`, not a separate user-facing skill)
10. Create `.agents/skills/grilling/SKILL.md` as an INTERNAL skill
    (agent loads it as context, human never invokes it directly)

### Phase 4 — Full skill suite

11. `asdlc-apply`, `asdlc-verify`, `asdlc-archive`, `asdlc-review`, `asdlc-init`
12. Update `AGENTS.md` routing block to list all slash commands

### Phase 5 — CI integration

13. `--ci github-actions` template (drops the Jenkins-only smell)
14. `--json` machine-readable output on all commands (for CI dashboards)
