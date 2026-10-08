# v6 Adoption — Gaps & Rollout

`V10-PLAN.html` (imported verbatim) is the latest authoritative design; `V6-PLAN.md`
is kept for history. This file tracks how the current `asdlc` implementation maps
to the design, what's missing, and the rollout waves.

## Current surface (as built)

- **Engine (OpenSpec, reused):** `asdlc init` wraps `openspec init`; the enterprise
  schema `agentic-repo-change` is installed **centrally** (no per-repo copy, no
  override); authoring uses `/opsx:*`.
- **Governance (ours):**
  - `asdlc lint` — BDD + Acceptance-Criteria linter (deterministic).
  - `asdlc gate` — CI gate: artifacts, **approved-SHA via git ancestry**, flow
    state, spec-quality, `openspec validate --strict`, schema-managed, external.
  - `asdlc merge` — post-merge discriminator (spec vs normal PR) → `approved/<ID>`
    tag + `READY_FOR_IMPL`.
  - `asdlc verify` — pluggable **independent AI verification** (player ≠ referee).
  - `asdlc schema install|status` — central schema, no-repo-override enforcement.
- **Glue:** `.githooks/{pre-push,post-merge}`; Jenkinsfile (lint on spec PR,
  gate+verify on impl PR); graphify code graph built at `init` (HEAD-bound,
  gitignored, authoring-only).

## Gap table (v6 → current → action)

| v6 requirement | current | action | wave |
|---|---|---|---|
| Strategy file `.sdlc/policy.yaml` (locked/controlled/fast_path/reviewers/ai_review/rollout_mode) | none | add (backbone) | **P0** |
| PR type by **path only** | `merge` uses branch+path | switch to path-only + policy | **P0** |
| Approved commit = **path-limited `git log`** (proposal.md + specs/**) | uses merge commit | refine | **P0** |
| `rollout_mode` advisory→block per check | none | add to gate | **P0** |
| review.md **machine-generated** (Jenkins service identity) + write-protection | author-written template | generate in CI (behind capability flag + fallback) | P1 |
| **SPEC_GAP A/B/C/D** + in-PR locked-path revision | none | config guidance + gate touch-check | P1 |
| **Fast / emergency channels** | none | policy-driven | P1 |
| Context/baseline layer (AGENTS.md + coverage metric) | config `context` only | add AGENTS.md + baseline coverage | P2 |
| Metrics / maturity / autonomy register | none | add | P2 |
| System Design / Manifest / Context Index | none | deferred (Phase 3, cross-repo) | later |
| Docs/Confluence enrichment for the graph | code-only | deferred (needs approved model + Confluence export) | later |

## Waves

- **Wave 1 — graphify integration** ✅ (init installs+builds a code-only graph at
  HEAD; `asdlc graph ensure|query`; AGENTS.md routing + schema instruction guide
  refresh+query; gitignored; not a gate).
- **Wave 2 — v6 import** ✅ (`V6-PLAN.md`).
- **Wave 3 (P0)** ✅ — `.sdlc/policy.yaml` (`src/lib/policy.js`); **PR-type by
  path only** (`src/lib/prtype.js`, used by `gate` + `merge`); **path-limited
  approved SHA** (`git log -1 <main> -- proposal.md specs`, in `gate` + `merge`);
  `rollout_mode` advisory↔block in `gate`.
- **Wave 4 (P1) — developer-side flow** ✅ — `asdlc explore` → `explore.md`
  (explore-before-propose enforced at `review`); `.sdlc-state.yaml` + SUPERSEDED
  guards in `apply`/`verify`/`archive` + CI check `not-superseded`; `asdlc gap
  report|supersede` (v8: approved specs are immutable); `asdlc archive` refreshes
  the graph + `AGENTS.md` (v7 §7.3); `AGENTS.md` carries the full asdlc workflow +
  a generated system-status section; `gate` checks `tasks-complete`; `init` now
  installs OpenSpec itself (`ensureOpenspec`).
- **Still open (needs Phase-0 inputs / platform)** — machine-generated `review.md`
  (needs Git-platform path-level push restriction); `asdlc.lock` + `asdlc upgrade`
  + `asdlc platform refresh-lock` (§16); Jenkins auto-close of a superseded Impl
  PR; docs/Confluence graph enrichment; System Design/Manifest/Context Index;
  metrics/maturity/autonomy; Graphify implementation selection (Python/Go/Node).

## Phase-0 validations (block P1, not P0)

- Git platform **path-level push restriction** (to protect machine-generated `review.md`).
- A **second approved model/vendor** (AI Review independence).
- Internal **PyPI mirror** reachable (graphify install).

## Assumed defaults (override if needed)

- `design.md` = **controlled** (not locked).
- Machine `review.md` ships **behind a capability flag**, with the fallback
  (review record in PR comments + Jira) if the platform can't restrict writes.
- `asdlc verify` stays **pluggable** and advisory until a second approved model is wired.
