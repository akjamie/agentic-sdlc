# Enterprise Agentic SDLC Blueprint (v10): OpenSpec + Graphify foundation + platform governance plane

> **BLUF**
>
> **Adopt the engines, own the governance plane.** OpenSpec owns the spec lifecycle and artifact structure; Graphify owns the structured awareness of "the current state of the system" (it does not read code — it queries a knowledge graph). The enterprise owns "what must happen, who approves it, and how it is evidenced". **Enforcement lives only at the Git platform + Jenkins + Jira layer.** The agent-side skills and config merely reduce friction — they do not constitute enforcement.
>
> A developer does only three things daily: **submit a spec, start implementation, report a spec gap**. All judgments are made automatically by path rules and scripts.
>
> `asdlc` packages OpenSpec, Graphify, and the platform governance rules into an enterprise CLI that is **installable and upgradable with a single command**, without publishing to the public npm registry.
>
> **Core change in this version (v8): once apply begins, the spec (`proposal.md`, `specs/**`) is physically immutable.** If a spec gap is discovered during implementation, it is no longer allowed to "modify an already-approved spec within the same PR". Instead, the current change is marked `SUPERSEDED` and a new change is opened that walks the full Spec PR approval lifecycle from zero (§6, §8, §8.1). This removes the most fragile piece of the previous design (modifying locked paths within the same PR, and relying on the approver not rubber-stamping a large diff), turning "number of spec revisions" into a cleaner metric — "supersede chain length" (§14.2).
>
> **Scope note for this version:** suggestions raised in the previous review — DORA vendor third-party risk assessment, EU AI Act Annex III tagging, internal-audit (third line of defense) role, and review.md tamper-proofing/retention periods — are **confirmed out of scope**. These belong to the enterprise risk/compliance/procurement teams, not to the SDLC toolchain (asdlc/OpenSpec/Graphify) itself. This blueprint is strictly bounded to "tooling and governing the spec-driven development process", and does not extend into operational compliance.
>
> **New in v9:** a SUPERSEDED change cannot be applied/verified/archived (§8.2) — a new machine-readable `.sdlc-state.yaml` state file is added; `asdlc apply`/`verify`/`archive` check it locally first (developer-experience layer, bypassable), CI required-check #12 is the true enforcement point (non-bypassable), plus a bot action to auto-close stale Impl PRs as a backstop.
>
> **New in v10:** `asdlc upgrade` (§16.5, developer-side, runnable by everyone) by default obtains the latest version recorded in `asdlc.lock` — the one already validated by the platform team — **not** the freshest upstream OpenSpec/Graphify release. Chasing the upstream latest, running Contract Tests, and deciding whether to upgrade is done by a new `asdlc platform refresh-lock` (§16.6, platform team only, separate RBAC). The two commands do not overlap in responsibility (§16.7): the "developers default to the latest" experience is preserved, but the judgment of what "latest" means always stays with the platform team.

---

## 0. v6 → v7 change summary

| # | Gap | v6 status | v7 fix |
| :--- | :--- | :--- | :--- |
| 0 | asdlc npm install method | not mentioned | new §3: local tarball / internal registry, with a clear recommendation |
| 1 | `asdlc init` orchestration | did not exist | new §4: openspec install → graphify install → openspec init (hook triggers graphify init) |
| 2 | explore/propose wired to graphify | §5.1/§9 said "AI understands the real structure" (agent reads code) | changed to §7.1: explore first runs `graphify update`, then queries the graph instead of reading code |
| 3 | `asdlc lint spec` | did not exist, only `openspec validate --strict` | new command; §10.1 clarifies the division of labor (format vs quality) |
| 4 | converge inside apply | moved to verify and done once | §7.2 changed to task-level converge; verify retains the full re-check |
| 5 | verify checks task completion | only requirement→impl→test | §7.2 explicitly cross-checks tasks.md checkbox state |
| 6 | update AGENTS.md before archive | unlinked; refreshed only on a fixed cycle | §7.3 archive merge triggers graphify update + AGENTS.md refresh, same trigger as KB rebuild |
| 7 | `asdlc review` | only the CI-internal review triggered by Jenkins | new local command; §10.1 realizes "same guard, run in both places" |

Two more sections added: **§15 graphify integration industry benchmark** (whether to adopt community bridge projects directly), and **§16 asdlc/OpenSpec/Graphify upgrade strategy** (how three independently evolving components avoid dragging each other down).

All of v6's platform governance design (PR types, path locking, policy.yaml, SPEC_GAP handling, fast/emergency lanes, metrics system) is **fully retained** — it is not in scope of this fix.

### v7 → v8

| Topic | v7 | v8 | Reason |
| :--- | :--- | :--- | :--- |
| modifying spec after apply | SPEC_GAP class C: after author confirmation, modify locked paths in the same Impl PR | **not allowed**: current change marked SUPERSEDED, a new change walks the Spec PR approval from zero (§6, §8.1) | eliminates the "approver rubber-stamps a large diff" risk — previously only observable via data, not eliminable by design |
| spec-revision-count metric | revision count within one change | supersede chain length (§14.2) | metric meaning adjusted in step with the mechanism |
| scope | included several pending fintech compliance suggestions | **explicitly excluded** DORA vendor assessment, EU AI Act Annex III tagging, internal-audit role, review.md retention — risk/compliance responsibilities, not part of the SDLC toolchain | keep the blueprint boundary clear; do not do operational compliance |

### v8 → v9

| Topic | v8 | v9 | Reason |
| :--- | :--- | :--- | :--- |
| execution blocking of SUPERSEDED changes | the supersede mechanism defined that a change "should" no longer be used, but did not define how machines actually block it | **new §8.2**: `.sdlc-state.yaml` state file + local guard in `asdlc apply/verify/archive` + CI required-check #12 (the true enforcement point) + auto-close of stale Impl PRs | rules cannot remain a documented convention only; something must actually block |

### v9 → v10

| Topic | v9 | v10 | Reason |
| :--- | :--- | :--- | :--- |
| whose "latest" does `asdlc upgrade` mean | one `asdlc upgrade`, implicitly the asdlc.lock current version, without distinguishing "upstream latest" from "validated latest" | **split into two commands**: `asdlc upgrade` (§16.5, developers, gets the lock-validated version) + `asdlc platform refresh-lock` (§16.6, platform team, separate RBAC, chases upstream and runs Contract Tests) | if developers could pull upstream latest directly, it would bypass the §16.1 lock mechanism itself |

---

## 1. Design principles

1. **Enforce at the platform, guide in the agent.** Any rule that exists only in a prompt, skill, or config is treated as a "suggestion".
2. **Paths decide everything.** PR type, review requirements, and whether a spec approval is triggered are all determined by the changed file paths.
3. **Human judgment is kept in exactly two places:** approving spec intent; review exceptions.
4. **Policy is centralized.** Locked paths, approvers, and allow-lists live in a single policy file protected by the platform team.
5. **Same guard, run in two places.** The local skill runs the guard (fail early); CI runs the same one.
6. **Advise first, block later.** Every new rule first runs in reference mode to collect false-positive rates, then switches to blocking.
7. **Components are replaceable; the contract is our own.** Change Package structure, the evidence model, and the policy file are defined by the enterprise; OpenSpec, Graphify, the AI review model, and the KB tool are all replaceable.
8. **Current state comes from structured queries, not AI reading code.** Any stage that needs "what the system is right now" (explore, propose, AGENTS.md refresh) queries the Graphify-produced graph. The agent is not allowed to guess by scanning source directly.

---

## 2. Architecture overview

```text
┌──────────────────────────────────────────────────────────────┐
│ Governance plane (our own, enforced)                         │
│  Git platform: branch protection / CODEOWNERS / required checks │
│  Jenkins shared pipeline library: guard / AI review / review.md / KB build │
│  Jira: story / traceability / approval record archive        │
│  Policy repo: policy.yaml, autonomy-register.yaml, asdlc.lock │
├──────────────────────────────────────────────────────────────┤
│ Spec engine (OpenSpec, not forked) + graph engine (Graphify, not forked) │
│  Custom Schema, config.yaml rules, validate/verify/archive   │
│  graphify-out/graph.json: structured facts (query/path/explain/update) │
├──────────────────────────────────────────────────────────────┤
│ Agent layer (replaceable)                                    │
│  approved execution agent (e.g. Copilot) + independent-context reviewer │
│  asdlc CLI (init/lint/apply/verify/archive/review) + AGENTS.md │
├──────────────────────────────────────────────────────────────┤
│ Knowledge layer                                              │
│  spec site / Graphify-derived code knowledge graph / ADR / retrieval │
└──────────────────────────────────────────────────────────────┘
```

**Relationship to other frameworks/tools (compose, not choose-one):**

| Source | What we absorb | What we do not absorb |
| :--- | :--- | :--- |
| OpenSpec | incremental specs, change lifecycle, archive merges into the main spec | do not fork the core |
| Graphify | knowledge graph produced by local deterministic AST parsing (query/path/explain/update) | do not depend on the community graphify-openspec-bridge package (§15 explains why) |
| Spec Kit (ideas) | analyze (pre-implementation consistency check), converge (post-implementation gap discovery) | the whole Process Harness |
| AWS AI-DLC (ideas) | clarification records, append-only audit, co-refinement review | the overall process |
| Superpowers (ideas) | task-level TDD, independent review, verify-before-complete | installing the framework itself |
| Kiro (ideas) | runtime interception of dangerous actions | developer-experience layer only, not enforcement |

---

## 3. asdlc distribution and install (fix #0)

**Not pushed to the public npm registry. Only two paths, chosen by scale and existing infrastructure:**

| Method | How | Fits |
| :--- | :--- | :--- |
| **Local tarball (recommended start)** | platform team runs `npm pack` to produce `asdlc-<version>.tgz`, publishes to an internal artifact store (Artifactory/Nexus generic or npm repo, or an intranet share); developers run `npm install -g <internal-url>/asdlc-<version>.tgz` | Phase 0–2, small scale, validation stage |
| **Internal private npm registry** | stand up a private npm registry with existing Artifactory/Nexus/Verdaccio, point `.npmrc` at it, `npm publish --registry <internal-url>`; developers just run `npm install -g asdlc` | from Phase 3, once scale grows and version lookup/permission management is needed |

**Methods deliberately not chosen:** no `npm install git+<url>` (every install pulls the entire git history; versions are uncontrollable; the §16 lock mechanism cannot work); no `npm link` (dev-machine debugging only, not a distribution channel to all developers).

```bash
# developer experience with the local-tarball method
npm install -g https://internal-artifactory/asdlc/asdlc-1.3.0.tgz
asdlc --version
```

Version numbers are tied to the `asdlc.lock` in §16.

---

## 4. asdlc init orchestration (fix #1)

```text
asdlc init
   │
   ├─1─▶ check/install OpenSpec CLI (npm install -g @fission-ai/openspec, version pinned by asdlc.lock)
   │
   ├─2─▶ check/install Graphify (per the §15 implementation choice; version pinned by asdlc.lock)
   │
   ├─3─▶ openspec init
   │        └─ enterprise custom schema (proposal/specs/design/tasks/review) written
   │        └─ hook: when openspec init completes, graphify init is triggered automatically (see below)
   │
   └─4─▶ graphify init (auto-triggered by the §3 hook; also invokable on its own)
            └─ first full graph build: graphify . → graphify-out/graph.json
            └─ write the graph path into openspec/config.yaml's context field
            └─ generate/update the "how to query current state" section of AGENTS.md
```

**End-to-end initialization in one command:**

```bash
asdlc init
# equivalent to:
#   openspec install (if missing) && graphify install (if missing)
#   && openspec init
#   && graphify init   # auto-triggered by openspec init's post-init hook
```

Folding `graphify init` into `openspec init`'s hook is the approach proposed in the requirements, and it is **feasible and recommended** — because the two have a strong ordering dependency: the graph path produced by `graphify init` must be written into `openspec/config.yaml`, which only exists after `openspec init` generates it. So hooking is less error-prone than two independent commands where the developer might forget one step.

---

## 5. Roles and responsibilities

(same as v6 §3 — no deviation found, retained unchanged)

| Role | Responsibility |
| :--- | :--- |
| Developer (author) | iterate on spec with the agent, implement, handle review comments |
| Spec approver (product/architecture/tech lead) | approve spec intent; approve spec revisions during implementation |
| Design owner | review design.md changes |
| Code owner | review implementation PRs (exception-based) |
| Platform team | maintain policy, guards, Jenkins shared library, autonomy register, **asdlc.lock** (§16) |
| Compliance/risk | approve AI tool onboarding, data classification, retention periods, model usage boundaries |
| Champion (one per team) | training, friction collection, weekly feedback |

**Maker-Checker:** the person who initiates the prompt and pushes cannot be the approver of that PR.

---

## 6. Change Package and artifact tiers

(same as v6 §4 — no deviation found, retained unchanged)

```text
openspec/changes/<JIRA>-<n>/
├── proposal.md        # why the change, impact scope
├── explore.md          # graphify query results: affected modules/dependency paths (new, see §7.1)
├── specs/**            # incremental spec: requirements, scenarios (BDD), acceptance criteria, contracts, NFR scenarios
├── design.md           # repo-internal technical design, test strategy
├── tasks.md             # task list (may include a draft; mutable during implementation)
├── clarifications.md   # optional: key Q&A and trade-offs
└── review.md            # Jenkins-generated review record (append-only, versioned)
```

| Tier | Path | Who can change it | Platform requirement on change |
| :--- | :--- | :--- | :--- |
| **Locked (before apply)** | proposal.md, specs/** | via PR, only while the change has not entered apply | spec approver approval + AI review + mandatory revision reason + append a version to review.md |
| **Locked (after apply)** | proposal.md, specs/** | **[v8 change] physically immutable** — once an Impl PR has been opened for the change, CI rejects any commit touching these two paths | "requirements on change" does not exist — the only exit is supersede (§8.1), opening a new change |
| **Controlled** | design.md | via PR | design owner approval + AI review re-run |
| **Reference** | explore.md | via PR, machine-generated mainly | no extra approval, but kept on archive as "why it was designed this way" evidence |
| **Free** | tasks.md, clarifications.md | via PR | no extra requirement |
| **Machine-generated** | review.md | Jenkins identity only | platform restricts manual edits |

The "approved commit" definition is unchanged: `git log -1 <main> -- proposal.md specs/`. **v8 addition: CI's locked-path revision rule (§9.2 item 6) now distinguishes "pre-apply revision" (the original approval flow) from "post-apply revision" (rejected outright, routed to supersede §8.1) — the deciding factor is whether any Impl PR history already exists under that change directory.**

---

## 7. End-to-end flow (fixes #2 / #4 / #5 / #6)

### 7.1 Spec phase (iterative, all on the spec branch + PR)

```text
skill: asdlc explore  (maps to /opsx:explore, but forces a graph refresh first)
    ① graphify update .          ← must run first, refresh the graph to latest
    ② graphify query <domain keywords>  ③ graphify path  ④ graphify explain
    ⑤ produce explore.md: affected modules, call chains, existing contracts
   ↓
/opsx:new (or propose) → generate the change and initial artifacts
    note: the "current state" read during propose comes entirely from the
    graphify query results in explore.md. The agent is NOT allowed to guess
    structure by scanning source directly in this step.
   ↓
converse with the agent, or edit artifacts by hand, iterate
   ↓
local: asdlc lint spec (fix #3, see §10.1) + openspec validate --strict
   ↓
skill: asdlc submit-spec
    guard check → push branch → open/update a Draft PR
   ↓
mark Ready for review
   ↓
Jenkins: validate → AI review (fresh context) → commit review.md to the PR branch
   ↓
human review → comments → author revises → new push invalidates approval → Jenkins re-runs
   ↓
approve & merge (squash) = the spec approval evidence
```

- **This is the most critical correction to v6:** v6 said "for large codebases, the official recommendation is to first use `/opsx:explore` to let AI understand the real structure" — which is easily implemented as "agent reads code". v7 explicitly defines explore as "first `graphify update`, then structured queries over the graph", producing `explore.md` as a persisted artifact, not transient context that the agent discards after reading code.
- AI review trigger strategy, dimensions, and reviewer independence requirements are unchanged from v6.

### 7.2 Implementation phase (fixes #4 / #5)

```text
skill: asdlc start-impl
    guard: spec merged to main? Jira consistent? → switch to impl/<JIRA>-<n> (based on latest main)
    → generate or update tasks.md
   ↓
asdlc apply runs task-group by task-group (may span multiple sessions), each task:
    ① write a failing test first
    ② implement
    ③ fresh-context reviewer: check against the spec first, then code quality
    ④ must run tests and paste output before claiming completion
    ⑤ [fix #4, new] task-level converge check:
       right after the task completes, run a lightweight consistency check
       against specs/**. Classify any gap per §8 (A/B/C). Do not wait for all
       tasks to finish — so class C (spec gap) is caught while the blast radius
       is still small, instead of surfacing all at once at the end.
   ↓
asdlc verify (fresh context) → verification report:
    ① requirement → implementation → test mapping (converge report, Report First)
    ② [fix #5, new] explicitly cross-check tasks.md checkbox state,
       flag "spec requires X but no completed task" or "task completed but mapped
       to no spec item"
   ↓ if blocking items → return to apply, loop
open Impl PR (template auto-fills Jira, approved commit, verification output)
   ↓
CI green → code owner exception-based review → squash merge
```

### 7.3 Archive phase (fix #6)

```text
asdlc archive (maps to /opsx:sync + /opsx:archive) → Archive PR (bot-initiated)
   PR contains:
   ① change dir moved into archive/, delta merged into openspec/specs/
   ② verification: the moved files match their approved content
   merge →
   ③ [fix #6, new] trigger graphify update (refresh the graph to reflect the real post-change structure)
   ④ [fix #6, new] trigger AGENTS.md incremental refresh (based on the new graph, not a fixed cycle)
   ⑤ trigger KB rebuild (same trigger point as ③④ — no longer three disjoint actions)
```

- **Second critical correction to v6:** v6 tied the AGENTS.md refresh to "significant architectural change or a fixed cycle", which meant "current state" refreshes were stale by default. v7 binds it to the archive event — every archive means real system change, so the graph and AGENTS.md follow every archive, not the next cycle.
- If multiple changes modify the same main spec, archive may conflict — that surfaces via the Archive PR merge process, and is not put on the daily dev path (same as v6).

---

## 8. Spec gaps (SPEC_GAP) and defect handling (v8 rewrites class C)

| Class | Example | Action |
| :--- | :--- | :--- |
| A. implementation error | code fails an approved scenario | write a reproducing test first, append a fix task to tasks.md, stay in the Impl PR |
| B. test gap | an acceptance criterion has no matching test | add the test, stay in the Impl PR |
| C. spec gap/error **[v8 change]** | spec under-coverage, contradiction, or behavior/contract change needed | agent stops the related task and outputs a SPEC_GAP report; after author confirmation, **do not modify the spec in the same PR — go through supersede §8.1** |
| D. discovered post-merge | test/production defect | open a Jira bug; if the approved spec states the correct behavior → Bugfix fast lane; **if the spec itself is wrong → supersede §8.1 as well** |

**After v8, classes C and D are unified on the "spec needs change" branch through the same mechanism (§8.1) — no longer two parallel paths.** Class C may trigger as early as task-level converge in §7.2 (found as soon as a task finishes) or as late as verify; class D is usually post-merge. Regardless of timing, if the conclusion is "the spec needs to change", it goes through supersede — there is no different flow for different timing.

### 8.1 Supersede mechanism (v8 addition)

**Core rule: once an Impl PR is opened for a change, `proposal.md`/`specs/**` can no longer be modified physically.** If they need to change, mark the current change `SUPERSEDED` and open a new change that walks the full Spec PR approval lifecycle from zero — there is no room to "quietly change it in the original PR by going through some process".

```text
openspec/changes/TECH-1888-1/   status: SUPERSEDED → superseded_by: TECH-1888-2
openspec/changes/TECH-1888-2/   status: ACTIVE, a fresh proposal→spec→approval run
```

**Four details that must be explicitly defined, otherwise the rule leaks at execution:**

1. **Previously approved review.md / verify reports are all voided.** They validated a spec that no longer exists; they cannot carry over as evidence for the new change. The new change must re-run AI review and verify.
2. **The old Impl PR is closed outright — not merged, not kept.** Avoid the audit nightmare of "one PR's diff spanning two different approved specs" in git history.
3. **Code already written on the old branch can be reused as a reference diff by the new change's apply phase**, but reused code must go through full task-level TDD, fresh-context review, and verify under the new change — it cannot carry over with the old "verified" label. The evidence chain stays clean, but no rewrite-from-scratch is required; engineering effort is not wasted.
4. **tasks.md inheritance:** when drafting the new change, the agent automatically diffs old vs new specs — completed tasks unaffected by the spec change are marked inherited directly; affected tasks are regenerated. No manual line-by-line reconciliation.

**Edge case (default strict, keep room to adjust):** if the only issue is a non-semantic typo (e.g. a wrong decimal in an AC number, but the scenario description itself is fine), strictly applying the rule would still force a full supersede, which is costly. **The default is: typos also go through supersede — no exception lane.** Simplicity and auditability win over saving a little cost; such "exceptions" are historically where iron rules start to erode. If you determine a narrow lane for pure-format changes is truly necessary (annotate revision reason + re-validate, without triggering supersede), you must explicitly define the "pure-format change" criterion in policy.yaml (does not touch Given/When/Then or the AC body) and accept that this is the single exception to the "physically immutable after apply" rule.

### 8.2 A SUPERSEDED change cannot be applied (v9 addition)

The supersede rule only holds if **nobody can keep running apply/verify/archive against an already-SUPERSEDED change** — otherwise the rule is just documentation, not enforced. We need a machine-readable state marker plus local and CI guards, mirroring §1 item 5 "same guard, run in two places".

**State file (machine-generated, same protection level as review.md, only the supersede automation writes it):**

```yaml
# openspec/changes/<id>/.sdlc-state.yaml
status: ACTIVE            # ACTIVE | SUPERSEDED
supersededBy: null         # e.g. TECH-1888-2, only set when status=SUPERSEDED
supersededAt: null
supersededReason: null     # points to the SPEC_GAP report that triggered supersede, for trace
```

**Local guard (first step before `asdlc apply`/`verify`/`archive` runs):**

```text
asdlc apply <change-id>
    ① read openspec/changes/<change-id>/.sdlc-state.yaml
    ② status == SUPERSEDED?
         yes → refuse to execute, do not call the underlying openspec apply/verify/archive,
               the error message carries supersededBy's new change id,
               hinting the developer to switch to the new change
         no  → proceed normally with §7.2/§7.3
```

**CI required check (the true enforcement point, added as item #12 of §9.2):** the local guard is only the developer-experience layer and can be bypassed (e.g. calling the underlying `openspec apply` directly instead of the `asdlc` wrapper). **True enforcement must live in CI** — any Impl PR whose change directory's `.sdlc-state.yaml` shows `status: SUPERSEDED` is rejected outright, no matter how complete the local code is. This check relies on one field in one file, is extremely cheap, and goes into §9.2 as a blocking item — it does not follow the "advise-first" progressive strategy, because if it leaks, the consequence is allowing an already-invalidated spec to continue being implemented, which is not a rule you observe false-positive rates on before deciding.

**Auto-close: avoid "a dead branch still has an open PR".** The supersede automation (the same action that creates the new change and writes the old change's `supersededBy`) should also auto-close any open Impl PR for the old change via a bot, with a comment explaining why and linking the new change — so the inconsistency of "state file says superseded, but the PR list still shows a live PR" doesn't depend on manual cleanup. The CI check above is the backstop when auto-close fails, not the only line of defense.

---

## 9. Enforcement mechanisms (platform-agnostic)

### 9.1 PR types: all determined by path

(same as v6 §7.1, with new explore.md handling rules)

| Type | Determination | Platform requirement |
| :--- | :--- | :--- |
| Spec PR (first) | change dir not on main; changes limited to spec-class files under that dir (incl. explore.md) | spec approver + AI review + validate |
| Impl PR | contains source/tests; change dir already on main | code owner + CI; touching locked paths stacks §8 revision requirements |
| Archive PR | only change-dir moves and `openspec/specs/**` merge | content-consistency verification |
| Fast-lane PR | no change dir; all changed paths hit the policy allow-list | code owner + CI |
| Emergency PR | an emergency flag set by designated roles | see §9.3 |

### 9.2 Required checks (advise-first, then block)

1. path determination and PR-type validity
2. `openspec validate --strict`
3. Jira traceability: branch name, PR, change dir, review.md all agree on the Jira id
4. AI review conclusion (via Jenkins status, bound to the current head)
5. review.md verification: the reviewed commit == the parent of the current head
6. locked-path revision rule (§8)
7. requirement→test coverage: each acceptance criterion maps to at least one test
8. **[new] explore.md's graphify query timestamp is not older than this propose** (prevent drafting specs from a stale graph)
9. contract/integration tests (from Phase 3)
10. policy/security checks (secret scan, dependencies, licenses)
11. branch protection: no direct push, new push after approval invalidates it, no author self-approval
12. **[v9] SUPERSEDED block: read the change dir's `.sdlc-state.yaml`; `status: SUPERSEDED` is rejected outright — blocking, no advise-first mode (§8.2)**

### 9.3 Policy file (protected by the platform team)

```yaml
# .sdlc/policy.yaml (illustrative)
locked_paths:   ["openspec/changes/*/proposal.md", "openspec/changes/*/specs/**"]
controlled:     ["openspec/changes/*/design.md"]
reference:      ["openspec/changes/*/explore.md"]
fast_path:
  allow_paths:  ["docs/**", "config/**/*.properties"]
  allow_kinds:  [typo, config-value, dependency-patch]
reviewers:
  spec:   "@org/spec-approvers"
  design: "@org/design-owners"
ai_review:
  trigger: on-ready-and-push
  debounce_seconds: 120
rollout_mode:    { path_check: block, ai_review: advisory }
```

### 9.4 review.md generation and protection

(same as v6 §7.4 — no deviation found, retained unchanged)

---

## 10. Command, skill, and config design (fixes #3 / #7)

### 10.1 asdlc command surface (fixes #3, #7 — the complete command table added in this version)

| Command | Corresponding OpenSpec/Graphify action | What it does | Local? CI? |
| :--- | :--- | :--- | :--- |
| `asdlc init` | openspec init + graphify init | §4 orchestration | local, one-time |
| `asdlc explore` | graphify update + query/path/explain | §7.1, produces explore.md | local |
| `asdlc propose` | openspec new | generate the change skeleton | local |
| `asdlc lint spec` [new, fix #3] | wraps `openspec validate --strict` **plus** enterprise custom rules | validate only checks structure/format validity; `lint spec` additionally checks: scenarios are truly testable (not restating requirements), AC has concrete verifiable assertions rather than adjectives, every requirement carries Jira traceability, BDD Given/When/Then keywords are complete | **local + CI** (same rules) |
| `asdlc submit-spec` | — | guard check + push + open/update a Draft PR | local |
| `asdlc start-impl` | — | guard check + branch switch + generate tasks.md | local |
| `asdlc apply` | openspec apply | §7.2, includes task-level converge; **checks `.sdlc-state.yaml` first, rejects SUPERSEDED (§8.2)** | local, may span sessions |
| `asdlc verify` | openspec verify | §7.2, includes tasks.md checkbox cross-check; **also checks SUPERSEDED first** | local + CI |
| `asdlc review` [new, fix #7] | wraps the same AI review logic | manually triggers one AI review locally, **using the same rule implementation Jenkins runs in CI**, letting developers self-check before pushing — realizing "same guard, run in two places" (§1 item 5) | **local + CI** |
| `asdlc report-gap` | — | output a SPEC_GAP report | local |
| `asdlc archive` | openspec sync + archive | §7.3, includes graphify update + AGENTS.md refresh | local initiate, bot executes |
| `asdlc upgrade` | — | see §16 | local/platform |

The AGENTS.md one-page routing rule (what goes through spec vs fast lane) is unchanged from v6 — not re-expanded here.

### 10.2 config.yaml and Schema essentials

- **Spec rules:** each requirement has at least one scenario and one AC; must carry a Jira id; NFRs expressed as scenarios; includes test strategy; **explore.md must exist before proposal.md** (enforced ordering, preventing skipping the graph query and writing specs directly).
- **Apply rules:** task-level TDD; fresh-context review; paste test output before claiming complete; task-level converge check; on discovering a spec problem, only output SPEC_GAP and stop, never self-edit locked artifacts.
- **Archive guidance:** after archive trigger graphify update → AGENTS.md refresh → KB build, three consecutive steps of the same pipeline.

---

## 11. Existing-project support: context layer + spec baseline layer (corrected)

Existing projects need two different things:

| Layer | Question answered | Carrier | How to build |
| :--- | :--- | :--- | :--- |
| **Context layer** | how the system is currently composed | `AGENTS.md`, `openspec/config.yaml` `context`, **graphify-out/graph.json** | **produced by graphify static analysis; agents read the graph, not the code** (corrects v6's "agent scans and organizes") |
| **Spec baseline layer** | what the system should do | `openspec/specs/**` | backfilled progressively, see below |

**Context-layer build process (replaces v6's description):**

1. `asdlc init` triggers `graphify init`, a full graph build over the existing code.
2. The "system current state" section of AGENTS.md is **generated from graph data, not summarized by an agent reading code** — concretely, run a fixed set of graphify queries (module list, public interfaces, the N most-connected nodes), format the results into AGENTS.md. This step is a deterministic script with no LLM summarization, avoiding summarization distortion.
3. First graph build on a large codebase may be costly; Phase 0 must measure build time and evaluate batching (by directory/module).
4. AGENTS.md is placed under CODEOWNERS protection; the refresh trigger is unified at the archive event (§7.3), no longer a "fixed cycle" that is easy to ignore.

**Spec baseline layer (progressive backfill, same as v6 — not re-expanded):**

- Incremental specs (ADDED/MODIFIED) already suit existing projects; the known OpenSpec behavior constraints (ADDED creates a new main spec, MODIFIED on a non-existent main spec is a blocking error) must still be verified on the pinned version.
- Coverage-completeness risk is mitigated via the baseline coverage metric and directory annotation.

---

## 12. Knowledge base (KB)

(essentially v6 §10; trigger unified at archive, see §7.3)

| Source | Content | Method |
| :--- | :--- | :--- |
| Intent knowledge | `openspec/specs/**`, approval records | site generator publishes directly, deterministic |
| Decision knowledge | ADR | drafted by agent after design review passes, human confirms |
| Code-derived knowledge | graphify knowledge graph | refresh unified at the archive event (§7.3); must be self-hostable, no traffic leaving the intranet |

---

## 13. Phased roadmap (continues v5/v6, data-driven)

| Phase | Duration | Scope | Gate to next phase |
| :--- | :--- | :--- | :--- |
| **Phase 0** | 2–4 weeks | validate OpenSpec + Graphify capabilities; asdlc packaging/distribution prototype (§3); Custom Schema, samples, metric baseline | all key assumptions validated or have a fallback |
| **Phase 1** | 4–8 weeks | single repo, 1–2 real changes, human-led; no CI blocking; validate the explore→graphify flow experience | the flow is genuinely used; friction and false positives collected |
| **Phase 2** | 2–3 months | AI review as reference; CI adds path determination, traceability, review.md verification, explore.md freshness checks; low-risk types trial repo-level A2 | AI agreement rate, false-positive rate, adoption rate meet targets |
| **Phase 3** | 3–5 months | first real 2-repo dependency → introduce System Design, simplified Manifest, Context Index (graphify handles underlying extraction); AI review takes on partial gates | quantified evidence of cross-repo incidents/rework appears |
| **Phase 4** | 5–8 months | full CI gate; 10+ repos → portfolio-level board; repo-level low-risk types to A3 | — |

---

## 14. Maturity and metrics

(same as v6 §12, one new metric)

### 14.1 Maturity scale

| Level | Name | Traits |
| :--- | :--- | :--- |
| L1 | AI-Assist | individual completion/chat, no shared process |
| L2 | SDD pilot | spec-first, human review, no platform enforcement |
| L3 | Governed | path determination, traceability, review records enforced by platform |
| L4 | Multi-repo coordination | System Design, Manifest, Context Index running |
| L5 | Portfolio-level | portfolio board, per-type autonomy registration and auto up/downgrade |

### 14.2 Metrics (auto-collected)

Same as v6 §12.2, plus: **[new] graph freshness** — time since the graphify graph last refresh, and post-archive graph refresh success rate, sourced from Jenkins instrumentation.

**[v8 change] the "spec revision count" metric is redefined:** no longer counts revisions within one change (that concept doesn't exist in v8 — the spec is physically immutable after apply). Instead it counts **the supersede chain length produced by one Jira story** — how many times one Jira story was superseded because of spec gaps (`TECH-1888-1 → TECH-1888-2 → TECH-1888-3 ...`). An abnormal chain length (e.g. the same story superseded more than 2–3 times) triggers the same signal as the original metric: the upfront explore/propose quality is insufficient, and it feeds the autonomy-downgrade judgment for that change type (§14.3).

### 14.3 Autonomy register

Same as v6 §12.3 — not re-expanded.

---

## 15. graphify integration — industry benchmark: is it "best in class"?

Your question is fair; this needs honest verification, not assumption. The conclusion has two layers: **the integration idea is correct and someone else has validated the same direction; but there is no mature, widely adopted standard implementation today. "Best in class" is currently not earned — if you build this now, you are likely among the earliest serious implementers of this direction, not adopters of a mature industry solution.**

### 15.1 Existing same-direction practices

There is indeed an open-source project doing exactly this: bridging OpenSpec and Graphify with a custom Schema defining a five-artifact pipeline — proposal (why) → explore (query the graph) → specs (what) → design (how) → tasks (who) — and explicitly binding the corresponding graphify command at each stage: the proposal stage uses `graphify query <domain>` for context, the explore stage combines query/path/explain to map the affected scope, and apply completion auto-runs `graphify update` to refresh the graph.

**This discovery directly validates your direction — v7 §7.1/§7.3 is almost identical in thinking to this project's approach**: not something we invented, but a route already validated by someone else's logic.

### 15.2 But it is not "best in class" — honestly listed reasons

- **Near-zero adoption.** The bridge project has 0 stars, 0 forks, 6 commits, a single maintainer — not an enterprise-validated mature solution, but an individual's proof-of-concept.
- **Neither OpenSpec nor Graphify officially endorses the other.** Neither lists the other as an official integration or recommended combination; the bridge is an entirely third-party splice.
- **Graphify itself is a Python tool** (`pipx install graphifyy`), an extra runtime dependency and supply-chain surface for a bank-class environment that requires a pure-npm install with no pip/pipx. The good news: ports addressing this already exist — a Go rewrite (zero Python dependency, claimed ~20× faster) and a Node/TypeScript port (pure npm wrapper). Both fit the "asdlc pure-npm ecosystem" requirement better than the original Python version, but their maturity, maintenance activity, and command-output compatibility with the original must be measured in Phase 0 — do not assume the three implementations behave identically.
- **Naming-collision risk.** "graphify" is occupied by at least 4–5 unrelated projects on npm/GitHub (React component visualization, graph-layout tools, codebase-vis, etc.). When introducing the dependency and internal docs, use the exact package name/repo URL to disambiguate — never rely on the bare name "graphify" in a search.

### 15.3 Conclusion and recommendation

**Do not pull the community bridge package (`graphify-openspec-bridge`) into the bank's supply chain as a dependency** — single maintainer, zero review, zero external stability commitment; unacceptable dependency risk in this regulatory environment.

**The correct approach extends "Adopt the engines, own the governance plane" from v4/v5: treat the bridge project as free reference design** (five-artifact pipeline + per-stage graphify commands), and implement equivalent logic inside asdlc yourself (which is exactly what §4, §7.1, §7.3 do). You get the "already-validated design idea" benefit without the "depend on a personal project that may stop being maintained" risk.

**For Graphify itself:** include it in §16's Adapter Boundary and version-lock mechanism; Phase 0 tests the command-output consistency of the Python/Go/Node implementations side by side, prioritizing whichever keeps asdlc's install chain pure-npm (Node port or Go binary distribution both work), unless testing shows a maturity/feature gap that forces temporary Python dependency.

---

## 16. asdlc / OpenSpec / Graphify upgrade strategy

Three components evolve independently with completely different release cadences (asdlc is your own internal release rhythm; OpenSpec and Graphify are external open-source projects releasing on their own). **You cannot assume they stay compatible; compatibility must be managed explicitly.**

### 16.1 Core mechanism: asdlc.lock, modifiable only by the platform team

```yaml
# asdlc.lock (like .sdlc/policy.yaml, protected by the platform team, teams cannot modify)
asdlc: 1.3.0
openspec: 1.3.1
graphify:
  impl: node        # python | go | node, see §15.3
  version: 0.9.2
compatibilityValidatedAt: 2026-10-05
contractTestsPassed: true
```

The OpenSpec and Graphify versions installed by `asdlc init`/`asdlc upgrade` **must strictly equal the versions locked in this file** — developers cannot locally upgrade sub-dependencies themselves. This is the same principle v4 §9 established for OpenSpec ("don't fork, pin the version, isolate with an Adapter Boundary"), now extended to Graphify and asdlc itself.

### 16.2 Three upgrade types, three flows

| Upgrade target | Trigger | Verification | Approver |
| :--- | :--- | :--- | :--- |
| **asdlc itself** (commands, skills, policy logic) | platform team ships a new version | run the §16.3 asdlc self-test suite + one real pilot round on a canary repo with `rollout_mode: advisory` | platform team |
| **OpenSpec** (external dependency) | upstream release | run the v4 §9 `enterprise-sdd-contract-tests` (custom schema loads; apply/verify/archive behave as expected) | platform team, only then update asdlc.lock |
| **Graphify** (external dependency) | upstream release, or implementation switch (e.g. Python→Node) | new `enterprise-graphify-contract-tests` (see §16.3) | platform team, only then update asdlc.lock |

### 16.3 Graphify-specific Contract Test (new this version — previously only OpenSpec had one)

All must pass before upgrading the Graphify version or switching implementation:

1. run `graphify update` on a fixed reference codebase; process exit code is 0
2. `graphify query`, `graphify path`, `graphify explain` return the same structure (field names, types) as the previous version for the same fixed set of questions; **more accurate content is allowed, field-structure breaking changes are not**
3. the `graphify-out/graph.json` schema version is read and validated by asdlc; if incompatible, `asdlc init`/`asdlc explore` refuse to start and error out — no silent downgrade
4. graph build time is within the agreed SLA (for large existing repos, see §11)

### 16.4 asdlc self-test suite

Before upgrading asdlc itself (command logic, policy interpreter):

1. run an end-to-end smoke test for every command in the §10.1 table (init/explore/lint/apply/verify/archive/review)
2. guard-rule "local + CI run in two places" consistency test — ensure local `asdlc lint`/`asdlc review` and Jenkins reach the same judgment; the key test that prevents two logics from diverging
3. run one real spec→implement→archive round on at least one canary repo in advisory mode, manually confirming expected behavior

### 16.5 `asdlc upgrade`: developer-side, defaults to "the latest the platform team has released"

**Here "latest" is not "the latest OpenSpec/Graphify upstream just released", but "the latest recorded in `asdlc.lock`" — two different things, and ordinary developers only ever touch the former.**

```bash
asdlc upgrade
# read the latest asdlc version currently published to the internal registry
# (its asdlc.lock has already been validated by the platform team)
# if the version changed, prompt: new version number, change-summary link,
# whether mandatory (the platform team can mark a release as forced)
# execute: uninstall old openspec/graphify → install the versions pinned by the new lock
# after upgrade, auto-run `asdlc explore --self-check` (verify graph + spec engine both work)
```

A developer **cannot** upgrade OpenSpec or Graphify individually without upgrading asdlc, and **cannot** let `asdlc upgrade` directly pull the latest upstream OpenSpec/Graphify release — the three ship as one versioned unit. This is the only reliable way to avoid "this person's Graphify is newer than that person's, so explore.md produces different fields", and the precondition for §16.1's `asdlc.lock` mechanism to actually take effect and not be bypassed by the upgrade command itself.

### 16.6 `asdlc platform refresh-lock`: platform-side, actually chasing the upstream latest (v10 addition)

**Chasing upstream versions and deciding whether to upgrade cannot be something a developer triggers incidentally by typing a command — it is a separate, permission-gated platform operation only the platform team can run.**

```bash
asdlc platform refresh-lock
# ① fetch the current latest release version numbers of OpenSpec and Graphify upstream (query only, no install)
# ② compare against asdlc.lock's locked versions, list components with updates
# ③ for each updated component, run the Contract Tests defined in §16.3 (Graphify) / v4 §9 (OpenSpec)
# ④ all pass → generate a new asdlc.lock draft + a change summary, submit for platform-team manual confirmation
#    any fail → stay put, report which Contract Test failed and at which step,
#                 no auto-retry, no auto-downgrade, wait for platform-team handling
```

Only the confirmed asdlc.lock gets baked into the next asdlc release, entering the range §16.5 developers can obtain via `asdlc upgrade`. **This command's permission must be separated from daily commands like `asdlc init`/`asdlc apply` (a separate RBAC group is recommended, e.g. only the protection group of `.sdlc/policy.yaml` can run it), preventing misuse as "developer pushes the lock to an unvalidated upstream latest".**

### 16.7 The relationship between the two commands, in one diagram

```text
OpenSpec/Graphify upstream releases a new version
        │
        ▼
asdlc platform refresh-lock  ← platform team only, runs Contract Tests
        │ pass
        ▼
   new asdlc.lock + a new asdlc release (pushed to internal registry/tarball)
        │
        ▼
asdlc upgrade  ← every developer can run it, gets exactly the validated version above
```

The two commands correspond to "who judges whether a new version is usable" and "who uses the version already judged usable" respectively — responsibilities do not overlap, and there is no path for a developer to bypass Contract Tests and obtain the upstream latest directly.

---

## 17. Governance principles (team constitution, non-negotiable)

1. The approved spec's sole authority is the **approved commit**; the PR merge is the approval evidence; status fields are just projections.
2. Converge = Report First: low-risk gaps auto-append tasks (task-level, see §7.2); spec-level changes must be approved by the spec approver.
3. Player cannot be Referee: drafting and reviewing use different contexts, ideally different models.
4. AI review credibility is proven through sampled manual re-review data.
5. System Design and Repo Spec autonomy are assessed independently.
6. Enforcement lives at the platform, not the agent runtime.
7. Any new rule runs in advise mode first, then block.
8. The person who initiates the prompt and pushes cannot approve their own PR.
9. **[new] Current state comes from structured queries (Graphify), not agents reading code.**
10. **[new] OpenSpec, Graphify, and asdlc ship as one versioned unit — no partial upgrades.**
11. **[v8] Once apply begins, the spec is physically immutable.** A spec gap has exactly one exit: supersede (§8.1) — there is no room to "quietly change the spec inside the same PR".

---

## 18. Risks and mitigations

(v6 §14 plus new graphify-related risks)

| Risk | Mitigation |
| :--- | :--- |
| OpenSpec capability/version churn | pin version; verify item-by-item in Phase 0; contract is ours, replaceable |
| **[new] Graphify single-maintainer / community bridge stops being maintained** | do not depend on the external bridge; build equivalent logic ourselves (§15.3); also pin the Graphify version + Contract Test (§16.3) |
| **[new] Python/Go/Node implementations of Graphify behave inconsistently** | run comparison tests before the Phase 0 pick; fix the chosen one with Contract Tests, don't casually switch |
| **[new] graphify-out/graph.json build too slow on huge existing repos** | measure in Phase 0; evaluate batched/incremental build strategies |
| spec review becomes rubber-stamping | observe manual-return rounds, spec-revision count, defect-escape data |
| AI review same-source as drafting | different model/vendor + deterministic checks + sampled re-review |
| data & compliance | only approved model gateways; data classification; pre-review by compliance (incl. whether Graphify's runtime stays on-network) |
| teams bypass the process | legalize fast/emergency lanes; make them visible on the board |
| weak existing test infrastructure | test-health assessment before pilot onboarding |

---

## 19. Immediate action list

**Week 1 (validate, decide the rest of the design):**

1. OpenSpec: can the Custom Schema add explore/review artifacts; does `openspec update` cover our own skills; archive/sync behavior when multiple changes touch the same main spec.
2. **[new] Graphify: on at least one representative existing repo, verify the Python/Go/Node implementations' build time, query/path/explain output equivalence, and CLI argument compatibility.**
3. **[new] asdlc distribution: verify the feasibility of the internal tarball or private npm registry on your existing infrastructure (Artifactory/Nexus), and produce the first asdlc.lock.**
4. Platform: required checks, CODEOWNERS path syntax, invalidation on new push after approval, path-limited push.
5. Jenkins unattended AI review invocation and the model gateway.
6. Enterprise Copilot: how to load our own skills, how to implement an independent-context reviewer.
7. Existing scenario: run a full "graphify init → explore → first touch of some capability" cycle on a real existing repo.

**Weeks 2–4:**

1. establish the metric baseline (incl. graph freshness); pick the pilot repo; train champions.
2. produce Custom Schema, config.yaml, AGENTS.md, asdlc command implementation, PR templates, policy.yaml prototype, asdlc.lock prototype.
3. review AI tool onboarding, data classification, and the Graphify runtime environment (whether on-network deployment is needed) with the compliance/risk team.

---

# Appendix A: Solution review

(carries over v6's review methodology; §A.3 major findings plus the items handled in this version)

## A.3 Major findings (updated)

Of v6's original 10 findings, **finding #6 "existing projects: context layer ready, spec baseline to verify" needs correction** — v7 changed the context layer from "agent scanning" to "graphify structured extraction", so the original "already ready" judgment no longer holds; it should be "⚠️ to verify": Phase 0 must measure graphify's graph build on a real existing codebase. This is a new verification item with priority no lower than the original 10.

The other 9 findings (key capabilities unverified, review workload shift, AI review independence, the risk of revising the spec in the same PR, review.md protection depending on the platform, the emergency lane vs existing policy, data & model compliance, AI review cost, NFR expression) keep their v6 judgment — unaffected by this fix.

**Two new findings:**

11. [Medium] **graphify-openspec-bridge cannot be introduced directly as a dependency**, only as reference design — a conclusion already drawn in §15.3, no longer a pending decision.
12. [High] **asdlc's own distribution and upgrade mechanism was entirely missing before**; after v7's fix, Phase 0 must still verify the real feasibility of the internal artifact store (§19 item 3) — a new fulcrum with priority equal to the OpenSpec/Graphify capability verification.
