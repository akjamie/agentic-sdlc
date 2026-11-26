# Changelog

All notable changes to `@akjamie/agentic-sdlc` are documented in this file.

## [1.11.2] - 2026-11-26

### Added & Changed
- **Skills & Slash Commands Protocol Alignment**: Added `Workflow B: Autonomous PR Review Feedback Loop (--from-pr)` to `asdlc-apply`, embedded `<!-- asdlc:review-round:<round> -->` anchors and formal GitHub PR Review API guidance into `asdlc-impl-review` / `asdlc-spec-review`, and aligned `--agent` runtime flags in `asdlc-new` and `asdlc-apply`.
- **New Review Slash Commands**: Added `assets/commands/asdlc-spec-review.md` and `assets/commands/asdlc-impl-review.md` across supported AI tools.
- **Docs & Gates Sync**: Added `asdlc status --metrics` documentation to `asdlc-status`, updated `asdlc-verify` and `asdlc-pr` to reflect `anti-test-weakening` and `acceptance-tests` gates, and fixed `asdlc-new` frontmatter description.

## [1.11.1] - 2026-11-24

### Added & Changed
- **Hard-Block Agent-Dependent Commands in Bare Terminal (`AGENT_RUNTIME_REQUIRED`)**: `asdlc new` and `asdlc apply` now detect bare interactive human terminal invocations (`isAgentRuntime()` / `requireAgentRuntime()`) and fail fast with exit code `1` and actionable slash-command hints (`/asdlc-new`, `/asdlc-apply`) unless explicit standalone flags (`--scaffold-only`, `--guard-only`, `--agent`) or an AI Agent/CI/piped runtime are active.
- **Agent-Only Subcommand Interception**: Intercepts `spec-review`, `impl-review`, `pr-review`, `review`, `grill`, `grill-me`, `batch-grill-me`, `intake`, and `run` via Commander's `command:*` listener with clear Agent guidance while keeping `buildCli().commands` minimal.
- **CLI vs. Agent Help Clarity**: Tagged the `asdlc --help` flow summary with `[CLI]` vs `[Agent]` markers.

## [1.11.0] - 2026-11-21

### Added
- **Harness Observability & Gate Friction Telemetry (`asdlc status --metrics`)**: Local friction tracking in `.sdlc/events.jsonl` (with automatic `.sdlc/.gitignore` maintenance, 5MB log rotation, and smart staging exclusion).
- **Git-Native Team Metrics Dashboard**: Aggregates 30-day velocity, P50/P90 stage lead times, risk level distribution, and autonomous PR review round convergence directly from Git history and `openspec/changes/archive/`.
- **CI Native Step Summaries**: Direct integration with `$GITHUB_STEP_SUMMARY` in `verify` and `lint` stages with detailed gate evaluation tables, iteration indicators, and addressed review thread references.
- **Player ≠ Referee Review Governance Guard**: `buildThreadResolutionPlan()` blocks author agents from auto-resolving review comments when disputing requested changes, tagging with `asdlc:needs-human-arbitration`.
- **Resilient Review Round Calculation**: `computeReviewRound()` counts formal hidden anchors (`<!-- asdlc:review-round:N -->`) or commit trailer batches `(ref: #PRRT_...)`.

## [1.10.0] - 2026-11-21

### Added
- **Anti-Test-Weakening Gate (`anti-test-weakening`)**: `asdlc verify` now detects and blocks diffs that delete test files or introduce new skip/disable annotations (`.skip(`, `xit`/`xdescribe`, `@pytest.mark.skip`, `@Disabled`, `#[ignore]`) across Java, Python, Go, Rust, and JS/TS.
- **Unresolved Clarifications Gate (`clarifications`)**: `asdlc lint` now fails if `clarifications.md` contains unresolved `[OPEN]` markers or non-empty questions under `## Open questions`.
- **Multi-Source Intake (`--from-file` / `--from-issue` & `asdlc-intake` Skill)**: `asdlc new` supports repeatable `--from-file` (`--file`) and `--from-issue` (`--ticket` / `--issue`) flags to snapshot local design documents and external GitHub/Jira/Confluence tickets into `openspec/changes/<id>/intake/` with `<untrusted-external-ticket>` prompt-injection fencing.
- **Automatic Stack Discovery in `asdlc init`**: `asdlc init` now automatically discovers the repository language stack (Java Maven/Gradle, Python, Go, Rust, Node.js) and configures `test.runner` in `openspec/config.yaml` and `AGENTS.md` out of the box (no extra flag needed; `--no-onboard` to skip, `--headless` for non-interactive greenfield bootstrap).
- **PR Review Comment Triage (`asdlc apply <id> --from-pr #<N>`)**: Fetches inline GitHub PR review threads and comments, classifying feedback into actionable items, suggestion blocks, and informational questions (with a 3-round anti-thrashing circuit breaker helper in `src/lib/triage.js`).
- **Structured Review Verdict & `reviewedSha` Binding**: `asdlc lint` and `asdlc verify` now support YAML front-matter (`asdlc.review/1`) in `review.md` and validate `reviewedSha` against `HEAD` to prevent stale review reuse.

### Changed & Fixed
- **Truthful Merge Approval Provenance**: `asdlc approve` now records actual Git merge commit SHA and approver identity (`provenance: git-merge-sha`) instead of generating synthetic 6-dimension PASS scores when no prior `review.md` exists.
- **Binary & Large File Semantics Immunity**: `batchAnalyzeFileSemantics` automatically skips binary/media extensions and files larger than 2MB, preventing stalls on archives or model weights.
- **Acceptance Test Failure Diagnostics**: `asdlc verify` captures and displays the trailing failure summary when `acceptance-tests` fail.

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

