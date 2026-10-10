# Glossary — locked terminology

> **Purpose**: OpenSpec's vocabulary overlaps heavily with the enterprise layer's
> vocabulary, but with different meanings. This locks "one concept = one name" so
> nobody confuses the three different things called "spec".
>
> **Naming discipline**
> - `Repo-local Spec` (or `spec.md`) = the enterprise-layer **approved intent** file.
>   Never shorten it to the bare word "spec".
> - OpenSpec's capability delta is always called **`OpenSpec spec delta`**, in
>   `specs/**/*.md`.
> - Status fields are always **projections**, never the "source of truth"; the only
>   authority is the **commit SHA on the protected branch**.

---

## 1. Core entities

| Term (locked) | Layer | Definition | Location | Lifecycle |
|---|---|---|---|---|
| **System Design** | cross-repo | the structural design of a domain: cross-repo contracts + ordering constraints | coordination store `system-designs/<domain>/<ver>/` | persistent; many stories reuse it |
| **contracts.md** | System Design | cross-repo API/Event/Data contracts (field-level) | `system-designs/<domain>/<ver>/contracts.md` | per version |
| **sequencing.md** | System Design | commit/release/rollback ordering + consistency windows | `system-designs/<domain>/<ver>/sequencing.md` | per version |
| **System Design Registry** | governance | maps each domain to its `current` version + stakeholder repos | `system-designs/registry.yaml` | persistent |
| **Repo-local Spec** | single repo | given the contract, this repo's approved intent (Requirements/Scenarios/AC) | inside a repo change | per story |
| **Change Package** | single repo | the artifacts of one change (proposal/spec/review/tasks) | `openspec/changes/<id>/` | per story |
| **Change Manifest** | governance | pure status routing table: which repos, which approved version, where each stands | coordination store `manifests/<changeId>.yaml` | per story |

## 2. Change Package artifacts

| Artifact | Definition | Writer | Mutable? |
|---|---|---|---|
| `proposal.md` | why — background and impact | draft agent / human | yes (draft) |
| `spec.md` / `specs/**/*.md` | approved intent: behavior contract + scenarios (BDD) + AC | draft agent / human | no after approval |
| `review.md` | the independent fresh-context reviewer's record | **reviewer agent (read-only)** | append-only |
| `design.md` | repo-internal technical design (HOW) | draft agent / human | yes (draft) |
| `tasks.md` | execution state (NOT part of approved intent) | execution agent / bot | yes |

## 3. Governance & state

| Term | Definition |
|---|---|
| **approval evidence** | the fact of a Git PR merge to the protected branch |
| **approved commit** | the last commit on the protected branch touching the locked paths (`proposal.md`, `specs/**`) |
| **projection** | a read-only status field derived from the approved commit; never authoritative |
| **Amendment** | a new version of a System Design; consumers are marked stale and must re-align |
| **stale** | a repo references a System Design version that is no longer `current` |
| **Converge (Report First)** | gaps are reported and classified (A/B/C/D), never silently absorbed into code |

## 4. Context

| Term | Definition | Source |
|---|---|---|
| **KB/RAG** | historical decisions ("why we designed it this way") | Pre-FSR/FSR/FDD |
| **Context Index** | machine-extracted current interface facts (structured YAML, not a code snapshot) | CI extraction pipeline → `system-context/<repo>.yaml` |
| **reconcile** | re-extract and diff against the stored index; drift marks the repo stale |

## 5. Roles & autonomy

| Term | Definition |
|---|---|
| **Draft agent** | the agent context that authors the spec/design |
| **Reviewer agent** | fresh context, distinct from the draft; writes only `review.md` |
| **Player / Referee** | the drafter must not be the final judge; applies at both layers |
| **A0–A3** | autonomy tiers; System Design and Repo Spec advance independently |

## 6. OpenSpec ↔ enterprise mapping

| Enterprise (v5/v10) | OpenSpec native | Key difference |
|---|---|---|
| Change Package | `openspec/changes/<id>/` | — |
| `proposal.md` | artifact `proposal` | same |
| `spec.md` (approved intent) | **no direct equivalent**; OpenSpec `specs` are capability deltas | the big one |
| `review.md` | none (enterprise-added) | read-only, append-only |
| `design.md` | artifact `design` | kept separate (OpenSpec-idiomatic) |
| `tasks.md` | artifact `tasks` | same |
| System Design / Registry / Manifest / Context Index | none; enterprise-built | do not fork OpenSpec |
| Store / References | `openspec store` (**beta**) / `references:` | see ADOPTION-GAPS |

## 7. Disallowed / confusing terms

| Don't say | Say instead |
|---|---|
| "spec" (bare word) | `Repo-local Spec` (intent) or `OpenSpec spec delta` |
| "the Manifest manages ordering" | that's `sequencing.md` in the System Design; the Manifest records state |
| "approved field" | the `approved commit` SHA (the projection is derived) |
| "the design goes in the spec" | System Design (cross-repo) vs Repo-local Spec (single repo)