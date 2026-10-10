# agentic-sdlc — Principal Consultant Review

> **Reviewed by**: Agentic SDLC Lead Engineer / ThoughtWorks Principal / McKinsey AI Engineering Partner lens  
> **Date**: 2026-10-09  
> **Version**: 0.1.0 · 35 tests · all green

---

## Verdict

**Solid architectural bones. The governance model is sound — CI-enforced, git-as-truth, player≠referee.** The 7-stage flow is the right shape for enterprise agentic teams. But there are three immediately actionable gaps and a broader set of strategic gaps that will limit adoption at scale.

---

## Issue 1 — Documentation is scattered and underpowered

### What's wrong

All docs live at the repo root: `README.md`, `USAGE.md`, `GLOSSARY.md`, `V10-PLAN.en.html`, `V10-PLAN.zh.html`. This is fine for a solo project but fails at three enterprise moments:

1. **New team member onboarding** — no guided journey from "what is this?" → "my first spec" → "I'm on-call for the CI gate".
2. **Ops/Platform team** — no runbook for the CI pipeline, CODEOWNERS setup, or schema upgrade path.
3. **AI agents** — `AGENTS.md` has the routing block but no "how to read a failing `asdlc verify`" cheatsheet; agents have to infer it from code.

There is also a **content quality gap** in the current docs:
- `README.md` shows the architecture mermaid but never explains **what `AGENTS.md` is** or why it exists — which is one of the most novel decisions in the product.
- `USAGE.md` has the happy path but no troubleshooting or "what do I do when lint fails?" section.
- `GLOSSARY.md` is excellent (locked terminology is a rare discipline) but orphaned — `README.md` never links to it inline, so authors miss it.
- The V10-PLAN HTML is a design document masquerading as documentation; it has no "current vs. planned" callouts, so readers can't tell what's implemented.

### Fix: move docs to `docs/` with a clear taxonomy

```
docs/
  getting-started.md        ← new-team onboarding (30-min path)
  user-guide.md             ← step-by-step (absorbs USAGE.md, expanded)
  concept-guide.md          ← why/what (absorbs README sections, adds AGENTS.md explanation)
  reference/
    commands.md             ← all flags, all exit codes, all env vars
    spec-format.md          ← the lint rules R0–R8 in human language with examples
    policy-yaml.md          ← .sdlc/policy.yaml schema and all keys
    speclint-rules.md       ← R0-R8 severity table + worked examples (critical for teams)
  ops/
    ci-setup.md             ← Jenkinsfile, CODEOWNERS, protected branch config
    schema-upgrade.md       ← how to bump the managed schema version safely
    troubleshooting.md      ← common failures + remediation
  adr/                      ← architecture decision records
    001-git-as-truth.md
    002-player-neq-referee.md
    003-graphify-advisory-not-gate.md
GLOSSARY.md                 ← keep at root (locked terms = high visibility)
```

`README.md` should become a **3-minute orientation** that links into `docs/` for everything else.

> [!IMPORTANT]
> `docs/reference/spec-format.md` is the highest-ROI doc missing today. Teams will write broken specs all week and only find out at `asdlc lint`. Showing the rules — with passing and failing examples — before the first spec is written is worth days of rework.

---

## Issue 2 — No portfolio-level status view for open specs

### What's wrong

`asdlc status <ID>` works well for a **single change**, but there is no answer to the question a tech lead or delivery manager asks every morning:

> "What specs are in-flight, which ones are blocked, and who's holding up the gate?"

This matters especially because the 7-stage flow is deliberately slow (by design — governance takes time). Visibility into the backlog is a prerequisite for adoption at team scale.

### What's implemented vs. what's needed

| Query | Status |
|---|---|
| `asdlc status <ID>` — single change | ✅ Implemented |
| `asdlc status` — list ALL open changes with stage | ❌ Missing |
| Changes blocked at `asdlc lint` | ❌ No aggregation |
| Changes waiting for spec PR merge | ❌ No aggregation |
| Changes approved but not yet applied | ❌ No aggregation |
| Stale changes (no activity > N days) | ❌ Missing |
| Machine-readable output (`--json`) | ❌ Missing (critical for CI dashboards) |

### Fix

Two additions, sequenced:

**Short term — `asdlc status` with no ID (portfolio view):**
```
change: tech-1234   [x] explore  [x] proposal  [x] review:APPROVE  [x] approved  [ ] tasks
  next: asdlc apply TECH-1234

change: tech-5678   [x] explore  [ ] proposal
  next: author proposal.md + specs/**

change: tech-9012   (not created)
  next: asdlc new TECH-9012
```

**Medium term — `--json` flag on all read commands (`status`, `doctor`, `verify`):**
```json
{
  "changes": [
    { "id": "tech-1234", "stage": 4, "next": "apply", "blockers": [] },
    { "id": "tech-5678", "stage": 2, "next": "author", "blockers": ["no proposal.md"] }
  ]
}
```

This unlocks Jira/Jenkins dashboards, Slack bots, and IDE status panels without scraping CLI output.

> [!NOTE]
> `AGENTS.md`'s system-status block (god nodes from Graphify) is architecture telemetry, not spec-flow telemetry. The two are complements, not substitutes.

---

## Issue 3 — `--ci jenkins` is unexplained and `--tools` is under-documented

### What's wrong with `--ci jenkins`

The flag is **contextually surprising** for two reasons:

1. **Jenkins-only is a red flag for new adopters.** Enterprise teams on GitHub Actions, GitLab CI, Azure DevOps, or Tekton see `jenkins` as a legacy smell. Even if Jenkins is your BU standard, the CLI surface should communicate that other CI systems work — they just need manual wiring.

2. **The flag is optional but critical.** A developer who runs `asdlc init` without `--ci jenkins` gets git hooks but no CI pipeline. The hooks alone are advisory (a developer can bypass them). The Jenkinsfile is the actual enforcement gate. This should be called out loudly in the docs and in the CLI help text.

### What's actually in the code (which is good)

Looking at [`init.js`](file:///d:/workbench/sandbox/agentic-sdlc/src/commands/init.js):

```js
if (opts.ci === 'jenkins') {
  // writes Jenkinsfile from asset template
}
```

The CI scaffolding is an asset-template pattern — extending to other CI systems is a one-file addition. The architecture is right; the surface is just poorly communicated.

### What's wrong with `--tools` and the IDE skill question

`--tools` IS already implemented and already supports `opencode`:

```js
const TOOL_DIRS = {
  '.opencode': 'opencode',
  '.claude': 'claude',
  '.cursor': 'cursor',
  '.gemini': 'gemini',
  // ... 9 more
};
```

Auto-detection also works: `detectTools(repoRoot)` scans for these directories. **This is not documented anywhere in README or USAGE.md** — a significant miss.

On the question of `/asdlc:init` as a slash command / built-in skill:

The current approach writes `AGENTS.md` routing (which IDE agents read), but the IDE has **no structured skill definition** that would make commands like `/asdlc:new`, `/asdlc:lint`, `/asdlc:status` first-class IDE primitives. This is a meaningful gap — the grilling skill is referenced by name but there's no `skills/grilling/` directory in this repo that an IDE can auto-install.

### Fix

1. **Rename/clarify the flag**: `--ci <provider>` where supported values are `jenkins` (today), with a note that others can be added. Better: `--ci-provider`.

2. **Document `--tools` and auto-detection prominently** in README and getting-started.

3. **Add an `opencode/` (or `.agents/skills/`) skill directory** with:
   - `asdlc-new.md` — skill that runs `asdlc new <ID>` and guides the grilling interview
   - `asdlc-lint.md` — skill that runs lint and explains each finding
   - `asdlc-status.md` — skill that shows portfolio view

This makes `asdlc` a first-class IDE citizen, not just a CLI tool the agent sometimes calls.

---

## Strategic Assessment — The Bigger Picture

### What's genuinely excellent

| Strength | Why it matters |
|---|---|
| **Git merge = approval** | Eliminates shadow approvals and "I approved it verbally" drift. Audit-proof. |
| **Path-limited `git log` as evidence** | Deterministic, no external approval system needed, scales to any team size. |
| **Player ≠ referee** (different AI model for verify) | This is the most important governance principle in the system. It directly addresses LLM sycophancy. |
| **Deterministic lint before AI** | Separates "did you write the spec correctly?" from "is the spec correct?" — the right separation of concerns. |
| **Graphify as advisory, not a gate** | Resists the temptation to make the AST graph authoritative. Smart. |
| **`policy.yaml` with `rollout_mode`** | Advisory-first rollout is how you actually get enterprise adoption. The "先参考模式，再阻断" comment in the code shows real operational thinking. |
| **R0-R8 rule set with configurable severity** | The spec lint ruleset is well-designed. Configurable severity per rule per repo enables gradual adoption. |

### What needs attention at scale

#### 1. Cross-repo changes are a first-class gap

The GLOSSARY defines **System Design**, **contracts.md**, **sequencing.md**, and **Change Manifest** — but none of these are implemented. They exist only as terminology. For a microservices org, this is the hardest governance problem (who approves a cross-repo API change?) and it's unaddressed in code.

**Risk**: Teams doing cross-repo work will route around `asdlc` because it can't coordinate across repos.

#### 2. `asdlc apply` unlocks `/opsx-apply` but doesn't constrain it

The guard in `apply.js` checks approval, but after that the developer is free to do anything. The spec's task list (`tasks.md`) is checked at *verify time*, not at *apply time*. This means the "task-level TDD" described in USAGE is advisory — it relies on team discipline, not enforcement.

**Recommendation**: `asdlc apply` should optionally scaffold the TDD cycle (write test → fail → implement → pass) or at minimum validate that `tasks.md` exists and has content before unlocking.

#### 3. The AI verification prompt is good but the interface is fragile

```js
const command = process.env.ASDLC_VERIFY_COMMAND ?? vcfg.command;
```

The verifier is pluggable via an env var or config, which is correct. But:
- The prompt (`buildPrompt`) feeds the full diff to the LLM — no chunking, no token management. A large implementation PR will hit context limits silently.
- The JSON extraction (`extractJson`) silently degrades to `{ verdict: "FAIL", summary: "verifier produced no parseable JSON" }`. This can mask real verifier errors.
- There's no verifier contract testing — nothing validates that the command at `ASDLC_VERIFY_COMMAND` actually speaks the expected JSON protocol.

#### 4. The knowledge graph (Graphify) is not integrated into the spec review loop

`explore.md` is generated at `asdlc new`, which is good. But by `asdlc lint` (days or weeks later), the graph may be stale. There's no check at lint time that `explore.md` was generated from a graph that's within N commits of the current HEAD.

**Recommendation**: `asdlc lint` should warn (not fail) if `explore.md` is older than the last 20 commits, prompting `asdlc new --refresh`.

#### 5. No secret rotation or API key rotation story for the AI verifier

The `verify.js` strips secrets from env before passing to the verifier:
```js
const SECRET = /TOKEN|SECRET|PASSWORD|.../i;
const cleanEnv = Object.fromEntries(...);
```

This is thoughtful. But there's no story for how the verifier authenticates to the LLM API — it falls through to whatever the environment has. In enterprise, this needs to be explicit: IAM role? Vault? Service account? This is an ops gap, not a code bug.

---

## Prioritized Action Plan

| Priority | Action | Effort | Impact |
|---|---|---|---|
| P0 | Create `docs/` structure, move and expand USAGE.md | 1 day | Unblocks team onboarding |
| P0 | Add `asdlc status` (no args) portfolio view | 0.5 day | Delivery manager visibility |
| P0 | Add `--json` to `status` and `verify` | 0.5 day | Dashboard/CI integration |
| P1 | Document `--tools` auto-detection and all supported tools | 2 hours | IDE adoption |
| P1 | Add IDE skill definitions (`.agents/skills/asdlc-*.md`) | 1 day | IDE-native experience |
| P1 | `--ci` flag: add `github-actions` template, rename to `--ci-provider` | 1 day | Drops the Jenkins-only smell |
| P1 | Warn in `asdlc lint` if `explore.md` is stale | 2 hours | Grounds specs in real code |
| P2 | Token-budget guard in `buildPrompt` (chunk if > 80K tokens) | 1 day | AI verify reliability |
| P2 | Verifier contract test (`asdlc doctor --verify-probe`) | 0.5 day | Ops confidence |
| P2 | Cross-repo `system-designs/` scaffold (`asdlc new --cross-repo`) | 1 week | Enterprise architecture |
| P3 | Task-level TDD scaffold in `asdlc apply` | 2 days | Closes the apply→verify gap |
