# Changelog

All notable changes to `@akjamie/agentic-sdlc` are documented in this file.

## [1.9.2] - 2026-11-13

### Changed & Fixed
- **Review Skills Auto-Post in PR Mode**:
  - `asdlc-spec-review` and `asdlc-impl-review` skills now automatically post review comments to GitHub PRs directly without halting for interactive confirmation when invoked with a PR URL or number.
  - In local mode (invoked with a local `changeId`), reviews continue to print cleanly to the terminal/stdout.
- **CLI DX & Default Branch Unification**:
  - `asdlc pr <changeId> [targetBranch]`: Made `[targetBranch]` optional, automatically resolving from `.openspec.yaml` target branch or repository default branch via `resolveDefaultBranch()`.
  - Migrated `asdlc pr` topology detection to centralized `resolveTopology()` helper.
  - Unified default branch resolution across `asdlc verify` and `asdlc pr`.
- **Skills & Documentation Alignment**:
  - Synchronized `asdlc-lint` and `asdlc-pr` skills across `.agents/skills/` and `assets/skills/` for the Two-Track lifecycle.
  - Removed superseded temporary design docs (`docs/risk-detection-hardening.md` and `docs/single-pr-approval-decoupling.md`) in favor of canonical root and reference docs.
  - Added repository-wide `.gitattributes` (`* text=auto eol=lf`) to enforce LF line endings across Windows and Unix platforms.

## [1.9.1] - 2026-11-12

### Added
- **Unified Topology Resolver (`lib/level.js#resolveTopology`)**: Consolidates effective governance level (including tamper detection), workflow mode precedence, and Single-PR eligibility into a single helper consumed by `approve` and `status`.
- **Shared Default Branch Resolution (`lib/git.js#resolveDefaultBranch`)**: Shared across `apply`, `approve`, `status`, and `resolveTopology` so repositories using `master` or lacking `origin/main` still anchor policy floors and risk history accurately.
- **`asdlc approve --mode` / `--protected-branch` / `--target-branch`**: Consistent CLI options for mode overrides and target branch resolution.
- **Two-Track Agent Routing & Skills**: Updated `AGENTS.md` routing template and `asdlc-approve` / `asdlc-apply` / `asdlc-new` skills to distinguish **Track A (Dual-PR)** and **Track B (Single-PR)**.

### Changed & Fixed
- **Single-PR `approve` Idempotency & Guard Hardening (P0)**:
  - Explicit `asdlc approve <ID>` on Single-PR (`L0`/`L1`) changes idempotently transitions pre-implementation status (`draft`/`spec_review`/unset) to `ready_for_impl` without creating `specSha`, git tags, commits, or modifying `review.md` (preserving `human-gate` enforcement). Post-implementation states (`archived`, etc.) are preserved without regression.
  - Tampered changes (`topology.tampered`) now fail fast with `LEVEL_TAMPERED`.
  - Track A (`L2`/`L3`/`spec-first`/unlevelled) explicit `approve <ID>` now verifies Spec PR merge evidence on the target branch and fails fast with `SPEC_NOT_MERGED` if unmerged.
  - Post-merge hook path (no `changeId`) remains 100% unchanged.
- **Truth in `asdlc status`**:
  - Stage 3 in Single-PR mode now renders as `[~] 3 spec approval (co-located in single PR; human sign-off at merge)` instead of `[x] 3 spec approved on origin/main`.
  - `asdlc status --json` adds non-breaking `mode: "single-pr"` and `approvalTrack: "colocated"` fields in Single-PR mode.
  - `status` now displays the effective governance level (e.g., showing `L2` if escalated/tampered) and displays `unlevelled` (Dual-PR) rather than `L1` when no level is declared.
- **`asdlc apply` DX**: Only prints `marked status=ready_for_impl` on actual state transition, avoiding duplicate logs on idempotent re-runs.

### Upgrade Notes
- Existing repositories should run `asdlc doctor --fix` after upgrading to refresh `AGENTS.md` and local skill templates with the Two-Track lifecycle guidance.

