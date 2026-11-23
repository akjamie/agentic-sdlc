# Enterprise Operating Model & Collaboration Playbook

> **Core Architecture: Three-Party Isolated Agent Sessions (Developer · Pre-Lead Review Bot · Tech Lead) + Zero-Intrusion Managed Jenkins**  
> Without modifying locked-down corporate Jenkins build nodes, `agentic-sdlc` enforces **19 local pre-flight quality gates**, **pre-lead independent AI Review Bot audits**, and a **3-round autonomous convergence protocol**. It guarantees **Player ≠ Referee** session isolation while compressing human Tech Lead review effort from hours to minutes.

---

## 🧭 1. Why This Operating Model?

Enterprise engineering teams deploying autonomous coding agents face three practical constraints:

1. **Locked-Down CI Build Nodes (Managed Jenkins)**: Corporate Jenkins agents are centrally provisioned by infrastructure teams. Application teams rarely have `root` privileges to run `npm install -g` or install custom global CLI binaries on Jenkins workers.
2. **Tech Lead Review Bandwidth Bottleneck**: AI agents generate code 10x faster than humans can read it. Routing raw, unvetted PRs directly to Tech Leads turns senior engineers into human linters and creates a massive delivery bottleneck.
3. **Shared-Context Verification Bias (`Player == Referee`)**: When the same AI session that writes the code also reviews the code, it inherits its own blind spots and assumptions, failing to catch contract drift or missing edge cases.

**The `agentic-sdlc` Solution**: Distribute governance gates and AI reviews across **three physically isolated agent sessions**, allowing managed Jenkins nodes to focus strictly on traditional builds, unit tests, and artifact packaging.

---

## 🏛️ 2. System Topology: Four-Party Isolation & Collaboration

```mermaid
flowchart TB
    subgraph DEV_PLANE ["1. Developer Workspace (Author Agent Session)"]
        direction TB
        D_NEW["Stage 1-2: Intake & Clarification (asdlc new + explore.md + Grill-Me)"]
        D_TDD["Stage 5: Guarded TDD Loop (asdlc apply: Red -> Green -> Evidence)"]
        D_PRE["Stage 3/6: Local Pre-Flight Gates (asdlc lint / test / verify: 19 Gates)"]
        D_TRIAGE["Autonomous PR Feedback Triage (asdlc apply --from-pr: 4-Way Classifier)"]
        D_NEW --> D_TDD
        D_TDD --> D_PRE
        D_PRE --> D_TRIAGE
    end

    subgraph GIT_PLANE ["2. Git Forge & Managed Jenkins (Zero-ASDLC-Install)"]
        direction TB
        PR_HUB["Pull Request / Merge Request (Labels: asdlc:spec-review | asdlc:impl-review)"]
        JENKINS["Managed Jenkins Nodes (Runs standard Maven / Gradle / Pytest / Go / npm)"]
        PR_HUB <--> JENKINS
    end

    subgraph BOT_PLANE ["3. Pre-Lead AI Review Bot (Independent Referee Session)"]
        direction TB
        B_WATCH["PR Poller / Webhook Listener (Watches spec-review & impl-review labels)"]
        B_SPEC["Independent Spec Review (/asdlc:spec-review: 7D Audit + AC Matrix)"]
        B_IMPL["Independent Impl Review (/asdlc:impl-review: 5D Audit + Incremental Diff)"]
        B_SUMMARY["Pre-Lead Review Summary (Posts structured PR Comment before Tech Lead)"]
        B_WATCH --> B_SPEC
        B_WATCH --> B_IMPL
        B_SPEC --> B_SUMMARY
        B_IMPL --> B_SUMMARY
    end

    subgraph TL_PLANE ["4. Tech Lead Workspace (Human-on-the-Loop)"]
        direction TB
        TL_READ["Inspect Pre-Lead AI Summary (Reviews AC Matrix & Round 1-3 Accounting)"]
        TL_LOCAL["Optional Local AI Deep Dive (/asdlc:impl-review PR_URL - Zero Checkout)"]
        TL_ARB["Exception Arbitration & Final Merge (Adjudicates escalations -> Merge)"]
        TL_METRIC["Team Governance Telemetry (asdlc status --metrics: 30-Day Dashboard)"]
        TL_READ --> TL_LOCAL
        TL_LOCAL --> TL_ARB
        TL_ARB --> TL_METRIC
    end

    D_PRE ==>|"asdlc pr pushes branch & labels"| PR_HUB
    PR_HUB ==>|"Triggers independent pre-review"| B_WATCH
    B_SUMMARY ==>|"Posts structured Review Comment"| PR_HUB
    PR_HUB -.->|"Developer prompts: fix PR comments"| D_TRIAGE
    D_TRIAGE ==>|"Pushes fix(review) commit"| PR_HUB
    PR_HUB ==>|"Converged (or 3-Round Breaker)"| TL_READ

    classDef devPlane fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;
    classDef gitPlane fill:#eff6ff,stroke:#2563eb,stroke-width:2px,color:#1e3a8a;
    classDef botPlane fill:#f5f3ff,stroke:#7c3aed,stroke-width:2px,color:#4c1d95;
    classDef tlPlane fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#78350f;

    classDef devNode fill:#ffffff,stroke:#10b981,stroke-width:1.5px,color:#064e3b;
    classDef gitNode fill:#ffffff,stroke:#3b82f6,stroke-width:1.5px,color:#1e3a8a;
    classDef botNode fill:#ffffff,stroke:#8b5cf6,stroke-width:1.5px,color:#4c1d95;
    classDef tlNode fill:#ffffff,stroke:#f59e0b,stroke-width:1.5px,color:#78350f;

    class DEV_PLANE devPlane;
    class GIT_PLANE gitPlane;
    class BOT_PLANE botPlane;
    class TL_PLANE tlPlane;
    class D_NEW,D_TDD,D_PRE,D_TRIAGE devNode;
    class PR_HUB,JENKINS gitNode;
    class B_WATCH,B_SPEC,B_IMPL,B_SUMMARY botNode;
    class TL_READ,TL_LOCAL,TL_ARB,TL_METRIC tlNode;
```

---

## 🔄 3. End-to-End Collaboration Sequence

The sequence below illustrates how the **Developer (Author Agent)**, **Review Bot (Pre-Lead AI Referee)**, **Managed Jenkins**, and **Tech Lead** coordinate across the full lifecycle:

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer (Author Agent)
    participant Git as Git PR and Managed Jenkins
    participant Bot as Review Bot (Pre-Lead AI Referee)
    actor TL as Tech Lead (Final Gate and Arbiter)

    Note over Dev,Git: Phase A - Risk Tiering and Spec Alignment (L0/L1 Single-PR vs L2/L3 Dual-PR)
    Dev->>Dev: asdlc new (--from-issue / --from-file) -> explore.md + Grill-Me -> proposal.md and specs

    alt L2 / L3 High-Impact Change (Dual-PR: Spec PR First)
        Dev->>Git: asdlc pr (runs local pre-flight: asdlc lint, attaches label asdlc-spec-review)
        Git->>Bot: Detects asdlc-spec-review label and fetches Spec PR
        Bot->>Git: Runs /asdlc:spec-review (D1-D7 audit) and posts AI Spec Review Summary
        opt Spec Blocker or Major Findings Detected
            Git->>Dev: Developer prompts agent to fix comments on PR
            Dev->>Git: Updates spec and pushes for Bot re-verification
        end
        TL->>Git: Tech Lead reviews Pre-Lead Spec Summary and merges Spec PR
        Dev->>Dev: asdlc approve (locks Git specSha and unlocks implementation)
    end

    Note over Dev,Git: Phase B - Guarded TDD Implementation and 19 Local Quality Gates (Zero Jenkins Changes)
    Dev->>Dev: asdlc apply -> executes Red-Green-Refactor per tasks.md with test evidence
    Dev->>Dev: asdlc test and asdlc verify (passes all 19 deterministic gates locally)
    Dev->>Git: asdlc pr (smart staging skips secrets and attaches label asdlc-impl-review)
    Git->>Git: Managed Jenkins runs standard compile and test suite (no asdlc binary needed)

    Note over Git,Bot: Phase C - Pre-Lead Review Bot Audit and 3-Round Autonomous Convergence
    Git->>Bot: Detects asdlc-impl-review label, fetches PR diff and base-branch spec
    Bot->>Git: Runs /asdlc:impl-review (D1-D5 + AC Conformance Matrix + Defect Attribution)
    
    loop Up to 3 Rounds of Autonomous Convergence (Human-on-the-Loop)
        Git->>Dev: Developer prompts Author Agent to fix comments on PR
        Dev->>Dev: asdlc apply --from-pr (4-Way Triage - Patch / TDD Fix / Reply / Escalate Conflict)
        Dev->>Git: Pushes commit fix(review) with thread trailer ref
        Bot->>Git: Rounds 2 and 3 inspect incremental diff only and post Re-Review Accounting table
    end

    Note over Git,TL: Phase D - 3-Minute Tech Lead Final Sign-Off and Post-Merge Compaction
    TL->>Git: Tech Lead checks Jenkins green status + converged Bot Summary -> Approve and Merge
    Dev->>Dev: asdlc archive --merged (syncs Living Specs to openspec/specs/ and refreshes AST)
```

---

## 👥 4. Role-Based Standard Operating Procedures (SOPs)

### 4.1 👨‍💻 Role 1: Developer + Author Agent

Developers run `asdlc` locally inside their IDE (Claude Code, Cursor, Antigravity, OpenCode). **Every deterministic gate is enforced before code ever leaves the developer's machine.**

| Lifecycle Step | Developer Prompt / Command | Underlying CLI & Governance Guarantees |
| :--- | :--- | :--- |
| **1. Start Feature** | `/asdlc:new "idempotent refund API" --from-issue PROJ-102` | Snapshots Jira/GitHub ticket in `<untrusted-external-ticket>` fence, queries Graphify AST into `explore.md`, assigns `L0–L3`, and runs `grill-me` to settle `clarifications.md`. |
| **2. Open Spec PR**<br>*(L2/L3 only)* | `/asdlc:pr` or `asdlc pr <ID>` | Runs `asdlc lint` pre-flight (11 BDD/AC gates). On pass, pushes branch, creates Spec PR, and attaches `asdlc:spec-review`. |
| **3. TDD Execution** | `/asdlc:apply <ID>` | **L0/L1** unlocks immediately; **L2/L3** verifies `approvedSha` on `main` first. Executes Red-Green-Refactor loop per `tasks.md` with captured test logs. |
| **4. Open Impl PR** | `/asdlc:pr` or `asdlc pr <ID>` | Runs `asdlc verify <ID>` pre-flight (**19 gates**: including `anti-test-weakening` and `spec-tamper`). Smart-stages safe files, opens PR, and attaches `asdlc:impl-review`. |
| **5. Fix PR Comments** | Prompt agent:<br>**`"fix comments on PR #44"`** | Invokes `asdlc apply <ID> --from-pr 44`. Fetches unresolved threads via GraphQL, applies 4-way semantic triage, commits fixes with `(ref: #PRRT_...)` trailers, and replies. |

---

### 4.2 🤖 Role 2: Pre-Lead AI Review Bot (Independent Referee)

The Review Bot acts as an **automated, independent gatekeeper** running in a separate agent session or worker container. It evaluates PRs and posts a comprehensive review summary **before the human Tech Lead steps in**.

#### Three Core Pillars of the Review Bot:
1. **Label-Driven Auto-Routing**:
   - PRs labeled `asdlc:spec-review` trigger [`/asdlc:spec-review <PR_NUMBER>`](../assets/skills/asdlc-spec-review/SKILL.md).
   - PRs labeled `asdlc:impl-review` trigger [`/asdlc:impl-review <PR_NUMBER>`](../assets/skills/asdlc-impl-review/SKILL.md).
2. **Trusted Base-Branch Grounding & Defect Attribution (`REVIEW.md`)**:
   - Always reads approved specs and repository `REVIEW.md` rules from `origin/<baseBranch>` (never from the untrusted PR `HEAD`).
   - **Strict Defect Attribution**: Bugs introduced by the PR are flagged as `🔴 [Blocker: Introduced]` (blocks merge). Legacy issues in touched files are logged as `⚪ [Tech Debt: Pre-existing]` (**never blocks the PR**).
3. **Incremental Re-Review & 3-Round Accounting (`Diff-Only Re-Review`)**:
   - On Rounds 2 and 3, the bot extracts `lastReviewedSha` from its previous comment and inspects **only the incremental diff (`git diff lastReviewedSha...HEAD`)**, preventing nitpick thrashing on already-approved lines.
   - Renders a **`🔄 Re-Review Accounting`** table tracking each finding ID (`R1-#1`, `R1-#2`) to resolution.

```mermaid
flowchart TD
    START(["Developer runs asdlc pr (Auto-attaches label: asdlc:impl-review)"]) --> R1

    R1["Round 1: Full Diff Initial Audit (/asdlc:impl-review posts D1-D5 + AC Matrix)"]
    R1 -->|"0 Blockers (APPROVE)"| APPROVED
    R1 -->|"Blockers or Majors Found (REQUEST_CHANGES)"| FIX1

    FIX1["Developer Round 1 Triage & Fix (asdlc apply --from-pr: Patch / TDD Fix / Reply)"]
    FIX1 -->|"Pushes fix(review) commit"| R2
    FIX1 -->|"Comment contradicts locked Spec (Forbidden to self-resolve)"| DISPUTED

    R2["Round 2: Incremental Diff Only (git diff lastReviewedSha...HEAD + Re-Review Accounting)"]
    R2 -->|"All findings resolved (APPROVE)"| APPROVED
    R2 -->|"Remaining unresolved Blockers"| FIX2

    FIX2["Developer Round 2 Fix (Pushes incremental fix commit)"] --> R3

    R3["Round 3: Final Automated Re-Review (Audits incremental diff & accounting)"]
    R3 -->|"All findings resolved (APPROVE)"| APPROVED
    R3 -->|"Unconverged after 3 rounds"| ESCALATED

    DISPUTED["Spec Immutability Guard (Replies citing Spec + leaves Thread Unresolved)"] --> ESCALATED
    ESCALATED["Anti-Thrashing Circuit Breaker Tripped (Attaches asdlc:needs-human-arbitration & halts AI)"]

    APPROVED["Pre-Lead AI Review Passed (Structured Summary Ready on PR)"] --> TL_MERGE
    ESCALATED --> TL_ARB

    TL_MERGE["Tech Lead 3-Minute Final Sign-Off (Checks Summary + Jenkins Green -> Merge)"]
    TL_ARB["Tech Lead Exception Arbitration (Adjudicates disputed threads only -> Merge)"]

    classDef startNode fill:#eff6ff,stroke:#2563eb,stroke-width:2px,color:#1e3a8a;
    classDef botNode fill:#f5f3ff,stroke:#7c3aed,stroke-width:2px,color:#4c1d95;
    classDef devNode fill:#ffffff,stroke:#059669,stroke-width:2px,color:#064e3b;
    classDef passNode fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d;
    classDef warnNode fill:#fef2f2,stroke:#dc2626,stroke-width:2px,color:#7f1d1d;
    classDef tlNode fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#78350f;

    class START startNode;
    class R1,R2,R3 botNode;
    class FIX1,FIX2 devNode;
    class APPROVED passNode;
    class DISPUTED,ESCALATED warnNode;
    class TL_MERGE,TL_ARB tlNode;
```

---

### 4.3 👨‍⚖️ Role 3: Tech Lead (Architecture Gatekeeper & Arbiter)

This operating model frees Tech Leads from tedious line-by-line syntax and boilerplate checking:

1. **Standard Converged Flow (90%+ of PRs) — 3-Minute Sign-Off**:
   - By the time the Tech Lead opens the PR, the Review Bot and Developer have already converged over 1–2 rounds and reached `✅ APPROVE`.
   - The Tech Lead scans the **AC Conformance Matrix**, verifies the **Re-Review Accounting** table, checks that Jenkins build/tests are green, and clicks **Approve & Merge**.
2. **Interactive Deep-Dive Flow — Standalone Local AI Co-Reviewer**:
   - For critical `L2/L3` architectural changes, the Tech Lead can run an interactive review session on their own machine **without even checking out the developer's branch**:
     ```text
     review PR https://github.com/org/repo/pull/44
     ```
   - `asdlc-impl-review` supports **Standalone PR-Only Mode**, pulling the remote PR diff and base-branch spec directly into the Tech Lead's agent session.
3. **Exception Arbitration Flow (<10% of PRs) — Handling `asdlc:needs-human-arbitration`**:
   - When a PR carries the `asdlc:needs-human-arbitration` label (either because 3 automated rounds did not converge or a review comment contradicted an approved spec), the Tech Lead reads the concise synthesis report and makes the final call on the 1–2 disputed items.

---

### 4.4 🏗️ Role 4: Managed Jenkins Nodes (Zero-Install Compatibility)

Why does this workflow succeed even when corporate Jenkins nodes prohibit installing `asdlc`? Because **governance and build execution are cleanly decoupled**:

| Verification Responsibility | Executed By | Why Managed Jenkins Doesn't Need `asdlc` Installed |
| :--- | :--- | :--- |
| **19 Deterministic SDLC Gates**<br>(`spec-tamper`, `anti-test-weakening`, `tdd-evidence`, `level-integrity`, etc.) | **Developer Local (`asdlc pr` Pre-flight)**<br>+ **Review Bot Session** | `asdlc pr` refuses to push or open a PR unless `asdlc lint` (for Spec PRs) or `asdlc verify` (for Impl PRs) exits `0` locally. |
| **Player ≠ Referee Independent Audit**<br>(7D Spec Review + 5D Impl Review + AC Matrix) | **Pre-Lead AI Review Bot** | Runs in a dedicated agent session/worker outside Jenkins, fetching PR diffs via Git APIs and posting structured Markdown comments. |
| **Compilation, Packaging, Integration Suites & SonarQube** | **Managed Corporate Jenkins Nodes** | Jenkins runs standard `mvn test`, `pytest`, `go test`, or `npm test` using its existing enterprise images and reports commit status back to the PR. **Zero Jenkins reconfiguration required.** |

---

## 🛠️ 5. Four-Way Semantic PR Triage Protocol (How the Author Agent Fixes Comments)

When a developer prompts `"fix comments on PR #<N>"` (invoking `asdlc apply <ID> --from-pr <N>`), the Triage Engine ([`src/lib/triage.js`](../src/lib/triage.js)) deterministically classifies every unaddressed human or bot thread into four categories:

| Category | Detection Signal | Autonomous Author Agent Action | Mutates Code? | Auto-Resolves Thread? |
| :---: | :--- | :--- | :---: | :---: |
| **Category B**<br>`SUGGESTION_BLOCK` | Contains a GitHub ```` ```suggestion ```` diff block | Applies exact line-range replacement in memory, runs tests, and commits with `fix(review): ... (ref: #ThreadID)` | ✅ Yes | ✅ Yes (replies with Commit SHA) |
| **Category A**<br>`ACTION_REQUIRED` | Contains defect keywords, imperative requests, or mixed signals (`"LGTM, but fix X"`) | Enters TDD loop to add test assertions and fix code, passes `asdlc verify`, and commits with `(ref: #ThreadID)` | ✅ Yes | ✅ Yes (replies with Commit SHA) |
| **Category C**<br>`INFORMATIONAL_QUESTION` | Architectural or rationale inquiry (`"Why did we use X here?"`) | Formulates a technical explanation grounded in `design.md` and replies directly to the thread | ❌ **No** (zero code mutation) | ❌ **No** (left open for reviewer confirmation) |
| **Category D**<br>`NON_ACTIONABLE` | Pure praise or acknowledgment (`"LGTM"`, `"Nice work!"`, `"👍"`) | Safely ignored to prevent empty noise commits | ❌ No | — |
| **⚠️ Constitutional Guard**<br>`SPEC_CONFLICT` | Requested change **contradicts the locked (`specSha`) specification** | **Strictly forbidden from editing locked specs or self-resolving!**<br>Replies quoting the exact spec section, leaves thread open, and attaches `asdlc:needs-human-arbitration` | ❌ **No** | 🚫 **Forbidden** (`Player ≠ Referee` invariant) |

---

## 📊 6. Team Velocity & Governance Observability (`asdlc status --metrics`)

Every gate evaluation, local retry, PR triage round, and lifecycle transition is tracked without any external database or telemetry daemon (combining git-ignored local friction logs in `.sdlc/events.jsonl` with permanent Git archive provenance in `openspec/changes/archive/`).

Tech Leads and Product Owners can run the metrics dashboard on any repository clone:

```bash
asdlc status --metrics
```

```text
======================= 🏛️ ASDLC HARNESS OBSERVABILITY =======================
📅 Data Source: Git Archive History (Last 30 Days, 24 changes tracked)

1. 🚦 Gate Friction Leaderboard (Local .sdlc/ Retries)
   Rank | Gate                  | Stage  | Fails | Top Failure Pattern
   --------------------------------------------------------------------------
    #1  | anti-test-weakening   | verify | 18    | deleted test (12), @Disabled (6)
    #2  | clarifications        | lint   | 9     | unresolved [OPEN] questions
    #3  | human-gate (staleSha) | verify | 4     | reviewedSha != HEAD commit

2. 🔄 Autonomous PR Convergence (3-Round Cap)
   • Round 1 Pass (Zero rework)    : 65% (15 PRs)
   • Round 2 Pass (Converged Rd 2) : 25% (6 PRs)
   • Round 3 Pass (Converged Rd 3) : 8%  (2 PRs)
   • Human Escalated (>3 rounds)   : 2%  (1 PR: feat-refund-channels)

3. ⏱️ Stage Lead Time (P50 / P90 via Git Provenance)
   • Stage new -> approve (Spec Phase): 14m / 45m
   • Stage apply -> verify (TDD Phase): 8m / 22m

4. 🛡️ Risk Tier Breakdown
   • L0 (Docs/Internal): 5 | L1 (Normal): 12 | L2 (High): 6 | L3 (Critical): 1
=============================================================================
```

---

## 🔗 Related Documentation

- ⏱️ **[30-Minute Getting Started Guide (getting-started.md)](./getting-started.md)**: Step-by-step hands-on tutorial from zero install to your first governed PR.
- 📐 **[Spec Format & Lint Reference (spec-format.md)](./spec-format.md)**: Complete guide to R0–R8 lint rules, BDD scenarios, and testable acceptance criteria.
- 🔬 **[Harness Observability & Autonomous PR Triage RFC (harness-observability-and-triage-design.md)](./harness-observability-and-triage-design.md)**: Technical design behind the two-tier telemetry model and 3-round circuit breaker.
- ⌨️ **[CLI Command Reference (usage.md)](./usage.md)**: Full flag, option, and exit code reference for all `asdlc` commands.
