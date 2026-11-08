# Autonomous Container Pipeline & Global Governance Solution Proposal
# 全自动容器流水线与全局治理架构方案

> **Bilingual Solution Proposal (Pre-Implementation RFC) / 中英文双语架构方案（待实施设计稿）**  
> **Status / 状态**: Proposed Solution — Not Yet Implemented / 方案设计稿（尚未进入代码实现）  
> **Scope / 范围**: Global configuration (`asdlc config`), dual-mode governance switch (`spec-first` | `auto`), multi-source intake (`--from-file` / `--from-issue`), hardened non-root polyglot runner (`asdlc-runner`), and state-driven autonomous orchestrator (`asdlc run`).

---

## Table of Contents / 目录

- [English Solution Proposal](#english-solution-proposal)
  - [1. Problem Statement & Design Principles](#1-problem-statement--design-principles)
  - [2. End-to-End Architecture & Workflows](#2-end-to-end-architecture--workflows)
    - [2.1 Host Orchestrator vs. Ephemeral Non-Root Container Split](#21-host-orchestrator-vs-ephemeral-non-root-container-split)
    - [2.2 Stage-Driven Container Lifecycle with Human-in-the-Loop Gates](#22-stage-driven-container-lifecycle-with-human-in-the-loop-gates)
    - [2.3 Dual-Track Symmetry: Interactive (Non-Container) vs. Autonomous (Container) Modes](#23-dual-track-symmetry-interactive-non-container-vs-autonomous-container-modes)
  - [3. Global Control Plane & Two-Mode Workflow Switch (`asdlc config`)](#3-global-control-plane--two-mode-workflow-switch-asdlc-config)
    - [3.1 Interactive Terminal UI (`asdlc config`) & Scriptable CLI](#31-interactive-terminal-ui-asdlc-config--scriptable-cli)
    - [3.2 Enterprise & User-Grade AI Configuration Strategy (Zero Schema Loss)](#32-enterprise--user-grade-ai-configuration-strategy-zero-schema-loss)
    - [3.3 End-to-End Authentication & Ephemeral Secret Ingestion Pipeline](#33-end-to-end-authentication--ephemeral-secret-ingestion-pipeline)
    - [3.4 Enterprise Model Injection & Heterogeneous Reviewer Topology](#34-enterprise-model-injection--heterogeneous-reviewer-topology)
    - [3.5 Multi-Tier Environment Variable Precedence & Secret Masking Engine](#35-multi-tier-environment-variable-precedence--secret-masking-engine)
    - [3.6 Zero-Friction GitHub Repository & Context Auto-Detection](#36-zero-friction-github-repository--context-auto-detection)
  - [4. Multi-Source Intake & Two-Tier Skill Resolution](#4-multi-source-intake--two-tier-skill-resolution)
  - [5. Official `ubuntu:26.04` LTS Image & Hardened Non-Root Baseline](#5-official-ubuntu2604-lts-image--hardened-non-root-baseline)
    - [5.1 Two-Layer Polyglot Runner Image](#51-two-layer-polyglot-runner-image)
    - [5.2 Internal Non-Exposed Security Baseline](#52-internal-non-exposed-security-baseline)
    - [5.3 Tri-State Repository Lifecycle & Ingestion Matrix (Greenfield, Brownfield, Established)](#53-tri-state-repository-lifecycle--ingestion-matrix-greenfield-brownfield-established)
  - [6. State-Driven Orchestrator (`asdlc run`) & Async PR Grilling](#6-state-driven-orchestrator-asdlc-run--async-pr-grilling)
    - [6.1 Dual Execution Modes: Local Directory vs Zero-Checkout Remote (`--repo`)](#61-dual-execution-modes-local-directory-vs-zero-checkout-remote---repo)
    - [6.2 Human-Centric Change Identification & Zero-Friction Resume](#62-human-centric-change-identification--zero-friction-resume)
    - [6.3 The "3+1" Canonical Stage Execution Model & Deterministic Resolution Engine](#63-the-31-canonical-stage-execution-model--deterministic-resolution-engine)
      - [6.3.1 The "3+1" Canonical Stage Taxonomy (`--stage spec | apply | verify | fix`)](#631-the-31-canonical-stage-taxonomy---stage-spec--apply--verify--fix)
      - [6.3.2 Ground-Truth State Vector & Invariants (Fallback Pipeline Driver)](#632-ground-truth-state-vector--invariants-fallback-pipeline-driver)
      - [6.3.3 Strict Disambiguation: Spec Review vs. Apply vs. Impl Review](#633-strict-disambiguation-spec-review-vs-apply-vs-impl-review)
      - [6.3.4 Autonomous Review Comment Triage & Resolution Engine (Beyond 'CHANGES_REQUESTED')](#634-autonomous-review-comment-triage--resolution-engine-beyond-changes_requested)
      - [6.3.5 Comprehensive 10-Phase State Matrix](#635-comprehensive-10-phase-state-matrix)
    - [6.4 Governance Hardening](#64-governance-hardening)
  - [7. Phased Implementation Roadmap](#7-phased-implementation-roadmap)
- [中文架构方案](#中文架构方案)
  - [1. 背景痛点与核心原则](#1-背景痛点与核心原则)
  - [2. 总体架构与交互流程](#2-总体架构与交互流程)
    - [2.1 宿主机编排器与临时非 Root 容器切分](#21-宿主机编排器与临时非-root-容器切分)
    - [2.2 阶段驱动的容器生命周期与人机协作门禁（定界自主，拒绝黑盒猜测）](#22-阶段驱动的容器生命周期与人机协作门禁定界自主拒绝黑盒猜测)
    - [2.3 双轨生命周期对齐：交互式（非容器）与全自动（容器）模式的无缝互通](#23-双轨生命周期对齐交互式非容器与全自动容器模式的无缝互通)
  - [3. 全局配置控制面与双模式开关 (`asdlc config`)](#3-全局配置控制面与双模式开关-asdlc-config)
    - [3.1 交互式终端 UI (`asdlc config`) 与脚本化 CLI](#31-交互式终端-ui-asdlc-config-与脚本化-cli)
    - [3.2 行业级与用户级 AI 配置设计（整文件原子继承 + CLI 参数覆盖）](#32-行业级与用户级-ai-配置设计整文件原子继承--cli-参数覆盖)
    - [3.3 端到端鉴权体系与无痕临时凭据注入流水线](#33-端到端鉴权体系与无痕临时凭据注入流水线)
    - [3.4 企业级模型传入与异构审查拓扑（Player != Referee）](#34-企业级模型传入与异构审查拓扑player--referee)
    - [3.5 多层环境变量优先级链与全局敏感信息脱敏引擎](#35-多层环境变量优先级链与全局敏感信息脱敏引擎)
    - [3.6 零摩擦 GitHub 仓库与执行上下文全自动识别引擎](#36-零摩擦-github-仓库与执行上下文全自动识别引擎)
  - [4. 多源需求输入（Intake）与两层 Skill 取单架构](#4-多源需求输入intake与两层-skill-取单架构)
  - [5. 官方 `ubuntu:26.04` LTS 全栈镜像与非 Root 安全基线](#5-官方-ubuntu2604-lts-全栈镜像与非-root-安全基线)
    - [5.1 双层镜像与版本强绑定](#51-双层镜像与版本强绑定)
    - [5.2 内部硬编码安全基线](#52-内部硬编码安全基线)
    - [5.3 三种项目生命周期适配矩阵（Greenfield、Brownfield 与成熟项目）与双向同步闭环](#53-三种项目生命周期适配矩阵greenfieldbrownfield-与成熟项目与双向同步闭环)
  - [6. 状态驱动编排器 (`asdlc run`) 与 Draft PR 异步 Grill 闭环](#6-状态驱动编排器-asdlc-run-与-draft-pr-异步-grill-闭环)
    - [6.1 双执行模式：本地就地执行与免 Clone 零检出执行 (`--repo`)](#61-双执行模式本地就地执行与免-clone-零检出执行---repo)
    - [6.2 人性化变更定位与零摩擦续跑机制（智能推导、交互选择器、PR # / URL / Issue 解析）](#62-人性化变更定位与零摩擦续跑机制智能推导交互选择器pr---url--issue-解析)
    - [6.3 “3+1” 权威阶段执行体系与确定性阶段推导引擎](#63-31-权威阶段执行体系与确定性阶段推导引擎)
      - [6.3.1 “3+1” 核心阶段手柄 (`--stage spec | apply | verify | fix`)](#631-31-核心阶段手柄---stage-spec--apply--verify--fix)
      - [6.3.2 四维客观不变量状态向量（无 `--stage` 时的后备流水线驱动器）](#632-四维客观不变量状态向量无---stage-时的后备流水线驱动器)
      - [6.3.3 核心阶段精准仲裁矩阵：互斥不变量对比](#633-核心阶段精准仲裁矩阵互斥不变量对比)
      - [6.3.4 深度解析：无 Request Changes 纯评论场景下的自主甄别与处理引擎（3-Tier Triage Engine）](#634-深度解析无-request-changes-纯评论场景下的自主甄别与处理引擎3-tier-triage-engine)
      - [6.3.5 全生命周期 10 阶段流转矩阵](#635-全生命周期-10-阶段流转矩阵)
    - [6.4 治理合规门禁补强](#64-治理合规门禁补强)
  - [7. 分阶段落地路线图](#7-分阶段落地路线图)

---

# English Solution Proposal

## 1. Problem Statement & Design Principles

Enterprise engineering teams adopting Agentic SDLC need **human judgment on requirement clarification and merge approvals**, while executing deterministic downstream work—spec drafting, independent spec review, TDD implementation, independent implementation review, acceptance testing, and PR creation—unattended inside an isolated runtime. Three practical bottlenecks currently stand in the way:

1. **Per-repository configuration & classification friction**: Workflow routing (`single-pr` vs `spec-first`) is coupled to the heuristic `L0–L3` risk engine without a machine-global switch, making it difficult to enforce predictable classic dual-PR (`spec-first`) governance across repositories without editing `.sdlc/policy.yaml` in every repo.
2. **Single-string requirement intake**: `asdlc new` accepts only a single inline requirement string rather than multiple local design documents and multiple external tickets (Jira, Confluence, GitHub Issues).
3. **Lack of a standardized headless container runtime**: Downstream stages rely on an interactive local IDE session rather than an official polyglot non-root container image with zero-translation multi-vendor LLM auth passthrough and non-TTY asynchronous clarification.

### Core Design Principles
- **Seamless Coexistence of Manual (IDE) and Autonomous (Container) Modes**: Git commits, PR state, and `.openspec.yaml` remain the single source of truth. Interactive IDE sessions and `asdlc run --container` invoke the exact same CLI primitives and can hand off work at any stage.
- **Strict Separation of Concerns (Zero Vendor Schema Translation)**: `~/.asdlc/config.yaml` is read exclusively by `asdlc`; built-in headless AI agents (`opencode` and `claude`) consume their native configuration files (`opencode.json` + `auth.json` across 75+ providers, or `.claude/settings.json`); enterprise issue trackers plug in via overrideable Skills rather than hardcoded proprietary SDKs in `asdlc` core.
- **Secure by Default, Minimal CLI Surface**: Non-root execution (`UID 10001:10001`), dropped Linux capabilities, and kernel-enforced read-only locks (`0444`) on approved specs during implementation are enforced internally as factory defaults without exposing low-level Docker flags on the CLI.

---

## 2. End-to-End Architecture & Workflows

### 2.1 Host Orchestrator vs. Ephemeral Non-Root Container Split

```mermaid
flowchart TD
  subgraph Host["Host Machine (Developer Laptop or Automation Runner)"]
    CLI["asdlc CLI (config / new / run)"]
    GCFG["~/.asdlc/config.yaml (0600, asdlc-only)"]
    ACFG["Native Agent Configs (opencode.json + auth.json / .claude)"]
    CSKILL["~/.asdlc/skills/* (Enterprise Custom Ticket Skills)"]
    HFILES["Host Local Docs (--from-file, supports paths outside repo)"]
    GHTOKEN["Host Auth Extractor (gh auth token / env_passthrough)"]
  end

  subgraph Container["Ephemeral Container (ubuntu:26.04, UID 10001:10001, --rm)"]
    WS["/workspace (Isolated Linux Git Clone)"]
    INTAKE["openspec/changes/<id>/intake/ (File Snapshots + Skill-Fetched Issues)"]
    S1["Session 1: Author / Implementer (opencode run / claude -p)"]
    S2["Session 2: Fresh-Context Reviewer (Player != Referee)"]
    GATES["Deterministic Gates (asdlc lint / test / verify)"]
  end

  subgraph Remote["Git & PR Platform (GitHub / GitLab)"]
    PR1["Draft / Ready Spec PR (Async Grill via PR Comments)"]
    MAIN["Protected Target Branch (Merge locks specSha)"]
    PR2["Implementation PR (Verified + AI Reviewed)"]
  end

  CLI --> GCFG
  CLI --> ACFG
  CLI --> CSKILL
  CLI --> HFILES
  CLI --> GHTOKEN
  CLI -- "docker create + docker cp (chown 10001:10001)" --> Container
  WS --> INTAKE
  INTAKE --> S1
  S1 --> S2
  S2 --> GATES
  GATES -- "Phase 1 (spec-first)" --> PR1
  PR1 -- "Human Merge" --> MAIN
  MAIN -- "Phase 2: 0444 Kernel Read-Only Spec Lock" --> WS
  GATES -- "Phase 2 / single-pr" --> PR2
```

### 2.2 Stage-Driven Container Lifecycle with Human-in-the-Loop Gates

> [!IMPORTANT]
> **Architectural Clarity: Bounded Stage Automation vs. Naive Telepathic Black Box**
> A common fallacy in autonomous software engineering tooling is attempting to build a "one-command magic black box" that telepathically guesses what to do across multiple days and multiple human PR review cycles. In production enterprise engineering, software development is inherently **multi-phased, asynchronous, and punctuated by human judgment** (clarification answers, PR reviews, and Tech Lead merge approvals).
> 
> Therefore, the container pipeline **strictly rejects telepathic black-box state guessing**. Instead, it adopts **Bounded Stage-Driven Execution**:
> 1. **Autonomous Within Bounded Stages**: Inside each ephemeral container run, execution is 100% automated (AST grounding, TDD loops, gate linting, review comment triage).
> 2. **Stage-Driven Across Milestones**: Across stages, transitions are driven by human milestones or CI webhooks using the four canonical stage commands: `--stage spec`, `--stage apply`, `--stage verify`, and `--stage fix`.
> 3. **Finite Container Lifespan**: Each container run has a single, crystal-clear, non-negotiable mission: execute its designated stage, enforce the verification gate, and destroy itself (`--rm`). Zero idle background compute.

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer / Tech Lead
  actor Rev as Peer Reviewer
  participant Host as Host CLI (asdlc run)
  participant Runner as Container Runner (UID 10001)
  participant AgentA as Session A (Author / Impl)
  participant AgentR as Session B (Fresh Reviewer)
  participant GitPR as GitHub / GitLab PR

  Note over Dev,GitPR: Stage 1: Specification Authoring & Review (--stage spec)
  Dev->>Host: asdlc run --from-issue JIRA-345 --from-file ./prd.md --stage spec
  Host->>Runner: Launch container + docker cp workspace, config, skills
  Runner->>AgentA: Resolve intake/ issues, ground in AST, draft proposal & specs
  alt Unresolved business ambiguity (OPEN items exist)
    AgentA->>GitPR: Open Draft PR (asdlc:needs-clarification) + post Q1..Qn comments
    Runner-->>Host: Exit cleanly 0 (awaiting human answers, zero idle container)
    Dev->>GitPR: Reply directly to Q1..Qn in PR comments
    Dev->>Host: asdlc run #34 --stage spec
    Host->>Runner: Ingest PR comments -> Clear OPEN items in clarifications.md
  end
  Runner->>AgentR: Spawn Session B (asdlc-spec-review, heterogeneous model)
  Runner->>Runner: Run deterministic gate: asdlc lint (must PASS)
  Runner->>GitPR: Mark Ready Spec PR #34 (asdlc:spec-review) + attach review verdict
  Runner-->>Host: Destroy container (--rm)

  opt Reviewer Leaves Feedback on Spec PR #34 (--stage fix)
    Rev->>GitPR: Post review comments or suggestions on Spec PR #34
    Dev->>Host: asdlc run #34 --stage fix
    Host->>Runner: Pull unresolved review threads via GraphQL
    Runner->>AgentA: Amend proposal.md & specs/** to satisfy feedback
    Runner->>Runner: Run asdlc lint (must PASS)
    Runner->>GitPR: Push fix commit + reply to thread + resolveReviewThread
    Runner-->>Host: Destroy container (--rm)
  end

  Dev->>GitPR: Human TL reviews & merges Spec PR #34 into main (locks specSha)

  Note over Dev,GitPR: Stage 2: TDD Implementation (--stage apply)
  Dev->>Host: asdlc run feat-auth --stage apply
  Host->>Runner: Clone branch, lock specs as 0:0 0444 read-only
  Runner->>AgentA: Generate tasks.md + execute task-level TDD loop (Red -> Green -> Refactor)
  Runner->>Runner: Local test suite PASS on all tasks
  Runner-->>Host: Destroy container (--rm)

  Note over Dev,GitPR: Stage 3: Verification & Impl Review (--stage verify)
  Dev->>Host: asdlc run feat-auth --stage verify
  Host->>Runner: Spawn Session B (asdlc-impl-review) + run asdlc verify (14 gates)
  Runner->>GitPR: Open Implementation PR #42 (asdlc:impl-review) + attach evidence
  Runner-->>Host: Destroy container (--rm)

  opt Reviewer Leaves Feedback on Impl PR #42 (--stage fix)
    Rev->>GitPR: Post code review comments / suggestions on Impl PR #42
    Dev->>Host: asdlc run #42 --stage fix
    Host->>Runner: Ingest review comments via GraphQL
    Runner->>AgentA: Modify source code & tests to satisfy feedback
    Runner->>Runner: Run asdlc verify (14 gates must PASS)
    Runner->>GitPR: Push fix commit + reply to thread + resolveReviewThread
    Runner-->>Host: Destroy container (--rm)
  end

  Dev->>GitPR: Final Human Approval & Merge Impl PR into main
```

### 2.3 Dual-Track Symmetry: Interactive (Non-Container) vs. Autonomous (Container) Modes

A foundational architectural requirement of Agentic SDLC is **Zero Mutation of the Non-Container Workflow**.
`asdlc run --container` does **not** replace or alter the existing interactive developer workflow in IDEs. Instead, Agentic SDLC operates as a **Dual-Track Symmetric System**:

```mermaid
flowchart LR
  subgraph Track1["Track 1: Interactive IDE Mode (Non-Container)"]
    direction TB
    I_NEW["asdlc new (Interactive Grill)"] --> I_LINT["asdlc lint"]
    I_LINT --> I_PR1["asdlc pr (Spec PR)"]
    I_PR1 --> I_APP["asdlc apply (IDE TDD Loop)"]
    I_APP --> I_VER["asdlc verify"]
    I_VER --> I_PR2["asdlc pr (Impl PR)"]
  end

  subgraph Shared["Single Source of Truth (Git + OpenSpec)"]
    direction TB
    SPEC["proposal.md & specs/**"]
    LOCK["main specSha Lock"]
    CODE["Source Code & Tests"]
  end

  subgraph Track2["Track 2: Autonomous Headless Mode (Container)"]
    direction TB
    C_DRAFT["asdlc run (Draft & Explore)"] --> C_GRILL["Draft PR Async Comment Q&A"]
    C_GRILL --> C_PR1["Ready Spec PR (spec-review)"]
    C_PR1 --> C_TDD["Headless TDD (0444 Spec Lock)"]
    C_TDD --> C_VER["Verify & Impl Review"]
    C_VER --> C_PR2["Open Impl PR (impl-review)"]
  end

  I_NEW -.-> SPEC
  C_DRAFT -.-> SPEC
  I_PR1 -.-> LOCK
  C_PR1 -.-> LOCK
  I_APP -.-> CODE
  C_TDD -.-> CODE

  I_APP <-.->|"Bidirectional Zero-Friction Handoff"| C_TDD
```

#### 2.3.1 Symmetrical Comparison: Non-Container vs. Container Workflow

| Operational Dimension | Track 1: Interactive IDE Mode (Non-Container) | Track 2: Autonomous Container Mode (`--container`) | Track 1.5: Host Local Orchestrator (`asdlc run` without `--container`) |
| :--- | :--- | :--- | :--- |
| **Target User / Context** | Human developer pair-programming in Cursor, VS Code, or terminal. | Unattended background job, CI runner, or cloud execution. | Developer on host machine who wants autonomous execution without Docker. |
| **Prerequisites** | Node.js, Git. Zero Docker requirement. | Docker / Podman installed; `ghcr.io/akjamie/asdlc-runner` image. | Local AI CLI installed (`opencode` or `claude`). |
| **Requirement Intake & Grilling** | `asdlc new "req"`: Interactive terminal interview (1 question at a time). | `asdlc run [req] --from-issue ...`: Non-TTY draft; questions posted to Draft PR. | Same as Container, but executed directly on host terminal. |
| **Spec Authoring & Linting** | Developer edits files in IDE; runs `asdlc lint <id>`. | Headless Session 1 drafts spec; Session 2 reviews; `lint` gate. | Headless local session drafts spec; local `lint` gate. |
| **Human PR Comments Handling** | Developer reads comments in browser/IDE; edits files; runs `git push`. (Optionally prompts IDE agent: *"Address review comments on PR #42"*). | Container automatically pulls PR comments via GitHub API, amends spec/code, re-verifies, and pushes fix commit. | Same as Container, but updates host working copy. |
| **Implementation Loop (Apply)** | `asdlc apply <id>`: Developer drives TDD loop in IDE (Red $\to$ Green $\to$ Refactor). | Headless Session 1 executes TDD loop inside sandbox under `0444` kernel lock. | Local session executes TDD loop on host workspace. |
| **Verification & Review** | Developer runs `asdlc test`, `/asdlc-impl-review`, and `asdlc verify <id>`. | Container runs `asdlc-impl-review` + `asdlc verify` (3-round self-healing loop). | Local session runs verify and review gates. |
| **PR Lifecycle** | `asdlc pr <id> main`: Developer explicitly opens Spec or Impl PR. | Container programmatically opens/updates PR via injected token. | Host CLI opens/updates PR via host credentials. |

#### 2.3.2 Zero-Breaking-Change Guarantee for Non-Container Workflows
1. **Underlying Primitives Remain 100% Intact**:
   All core CLI commands (`asdlc new`, `asdlc lint`, `asdlc apply`, `asdlc verify`, `asdlc pr`, `asdlc approve`, `asdlc archive`, `asdlc status`, `asdlc doctor`) retain their exact CLI arguments, behavior, and exit codes. Existing IDE extensions, bash scripts, and manual developer habits continue to work without modification.
2. **Global Config Is Strictly Optional**:
   `~/.asdlc/config.yaml` provides global defaults. If absent, non-container commands fall back seamlessly to `.sdlc/policy.yaml` or built-in defaults.
3. **Bidirectional Zero-Friction Handoff**:
   Because Git commits and `.openspec.yaml` are the *only* source of truth:
   - **Hand off from IDE to Container**: A developer can interactively design a spec in their IDE (`asdlc new`), get the Spec PR merged on GitHub, and then delegate the tedious coding to the container: `asdlc run <changeId> --container`.
   - **Take over from Container to IDE**: If an autonomous task in a container pauses on a Draft PR, a developer can simply check out the branch (`git checkout change/<slug>`), refine the code or spec in their IDE, run `asdlc lint`, and push—without any synchronization desync.

---

## 3. Global Control Plane & Two-Mode Workflow Switch (`asdlc config`)

### 3.1 Dual-Interface Control Plane: Interactive Wizard (`asdlc config`) + Scriptable CLI

To avoid the cognitive burden of memorizing dozens of dot-paths while maintaining full CI/scripting compatibility, `asdlc config` provides two complementary interfaces:

#### 1. Interactive Terminal Setup Wizard (`asdlc config` with zero arguments)
Running `asdlc config` without arguments launches an interactive, modular terminal wizard with **early-exit support at every step** (`[Save & Exit]` or `Esc`):

```text
=== Agentic SDLC Global Configuration Wizard ===
Press [Ctrl+C] or choose 'Save & Exit' at any time to finish.

? What would you like to configure? (Use arrow keys)
❯ 1. Workflow Mode (Current: spec-first)
  2. AI Model & Harness (Current: Inherit Host OpenCode)
  3. Git & Pull Request Auth (Current: GitHub via gh CLI)
  4. Issue Tracker Integration (Jira / Confluence)
  ---------------------------------------------------------
  [ Save & Exit ]
```

- **Smart Auto-Detection**:
  - Automatically checks if `gh` is installed and logged in -> Displays `✓ GitHub: Inherited from host 'gh' CLI (user: akjamie)`.
  - Automatically checks if OpenCode is present on the host -> Displays `✓ AI: Found host OpenCode config (~/.config/opencode/opencode.json)`.
- **Modular Sections & Easy Skip**:
  - **Section 1: Workflow Mode** — Pick between `● spec-first (Recommended for new teams: Mandatory Spec PR -> Merge -> Impl PR)` and `○ auto (Adaptive: L0/L1 Single-PR, L2/L3 Dual-PR)`.
  - **Section 2: AI Harness & Model Override** — Options to keep host OpenCode, specify a container-only model override (e.g. `doubao-seed-code`), enter an API key, or import a JSON file.
  - **Section 3: Git & PR Credentials** — Option to inherit host `gh` or provide a custom PAT.
  - **Section 4: External Issue Trackers (Optional)** — Prompt to enter Jira / Confluence base URLs and tokens, or choose `● Skip for now (Configure later or use local files only)`. Token inputs are masked on screen.
- **Atomic Persistence**: On choosing `[Save & Exit]`, updates are written atomically to `~/.asdlc/config.yaml` with mode `0600`.

#### 2. Non-Interactive Scriptable CLI (For CI/CD and Power Users)
For headless automation, scripts, and granular inspection, standard subcommands remain fully available:

```bash
# 1. Global workflow switch: two supported operational modes
asdlc config set workflow_mode auto           # auto (default) | spec-first

# 2. Git & PR Remote Host Settings (for Enterprise Intranets / Private GitLab / GHES)
asdlc config set git.default_host gitlab.corp.company.com # default: github.com
asdlc config set git.protocol https                       # https (default & recommended) | ssh
asdlc config set git.provider gitlab                      # github (default) | gitlab

# 3. Optional agent & runner orchestration settings
asdlc config set agent.harness opencode        # opencode (default) | claude
asdlc config set agent.model ""                # optional override (-m provider/model)
asdlc config set agent.review_model ""         # optional heterogeneous reviewer model
asdlc config set runner.image ""               # optional internal registry mirror override

# 4. Generic env injection & passthrough for enterprise custom skills
asdlc config set env.JIRA_BASE_URL https://jira.corp.com
asdlc config set env.JIRA_API_TOKEN <TOKEN>
asdlc config set runner.env_passthrough "JIRA_*,CONFLUENCE_*"

# 5. Inspection (keys matching *key/*token/*secret/*password are masked by default)
asdlc config list [--show-secrets] [--json]
asdlc config get workflow_mode
asdlc config unset env.JIRA_API_TOKEN
```

**Exact Boundary of the Two Workflow Modes** (Strict 100% Mathematical Symmetry Across Non-Container IDE and Container Modes):

| `workflow_mode` | Governance & PR Topology | Non-Container Local IDE (Track 1) | Container Runner (Track 2) |
| :--- | :--- | :--- | :--- |
| **`auto`** *(Default)* | **Adaptive Risk-Tiered.** Evaluates the three-vector L0–L3 risk engine: L0/L1 changes route to Single-PR topology (spec + code co-located in 1 PR for maximum velocity), while L2/L3 changes route to Dual-PR topology (mandatory Spec PR human approval before Impl PR). | Developer runs `asdlc lint`; risk engine calculates Level. If L0/L1, single PR is opened (`asdlc pr <id>`). If L2/L3, Spec PR is opened first, locked upon merge. | Container evaluates risk in Phase 3. If L0/L1, container proceeds through `apply` & `verify` and opens a single combined PR. If L2/L3, opens Spec PR, enters Phase 5 wait state. |
| **`spec-first`** | **Mandatory Dual-PR (Max Governance).** Skips risk engine and forces strict dual-PR separation for all changes: **Spec PR (`lint` + `spec-review` + human merge locking `specSha`) $\to$ Impl PR (`verify` + `impl-review`)**. Ideal for compliance and core infrastructure. | Every change requires Spec PR creation, human TL approval & merge on GitHub, locking `specSha`, before `asdlc apply` is permitted. | Container executes `--stage spec`, opens Spec PR, and terminates or waits for merge. Implementation requires explicit `--stage apply` after Spec merge. |

> [!IMPORTANT]
> **Why `single-pr` is NOT a Standalone Global Configuration**:
> In enterprise governance, exposing a top-level `workflow_mode: single-pr` setting creates a catastrophic loophole: a developer or rogue automation could set global `single-pr` to bypass all dual-PR gates for high-risk changes (such as database schema migrations, IAM privilege escalations, or core billing logic). 
> Therefore, in `agentic-sdlc`, `single-pr` is strictly an **internal routing topology** determined dynamically by `auto` mode when a change's risk assessment strictly evaluates to L0 or L1.

**Precedence Chain (Highest → Lowest)**:
`CLI Flags` > `Environment Variables (ASDLC_*)` > `Repo .sdlc/policy.yaml (optional override)` > **`Global ~/.asdlc/config.yaml`** > `Built-in Default`.

### 3.2 Enterprise & User-Grade AI Configuration Strategy (Zero Schema Loss)

`~/.asdlc/config.yaml` is **never parsed directly by the built-in AI harness**. Instead, the system treats AI configuration with an industry-grade **Immutable File Selection + CLI Flag Override model** (avoiding fragile JSON deep-merging):

1. **How Configuration Files Are Selected (Zero Deep-Merge)**:
   - In production, deep-merging multi-vendor JSON configurations can overwrite mutual provider options, break custom headers, or corrupt array structures.
   - **Resolution Policy**: `asdlc` selects the base configuration file as a **whole atomic unit** (no partial field stitching):
     - **Primary Base**: `~/.asdlc/agent/opencode/opencode.json` (if the user or team imported an explicit container template via `asdlc config agent --file`).
     - **Fallback Base**: The developer's native host configuration `%USERPROFILE%\.config\opencode\opencode.json` (Windows) or `~/.config/opencode/opencode.json` (macOS/Linux) and matching `auth.json`.
     - **Fallback Zero-State**: If neither exists, `asdlc` writes a minimal valid single-provider configuration generated from `asdlc config set agent.provider` and `agent.api_key`.

2. **How Container-Specific Models Are Overridden (Runtime CLI Flag `-m`)**:
   - If a developer uses `anthropic/claude-sonnet-4-5` on their host but wants the container pipeline to run a dedicated model (e.g. `doubao-seed-code` or an internal high-throughput endpoint), **`asdlc` never mutates the underlying `opencode.json` file**.
   - Instead, setting `asdlc config set agent.model <model>` passes the override directly to the OpenCode invocation via its official runtime argument:
     ```bash
     opencode run -m "provider/model" "<prompt>"
     ```
   - According to OpenCode specifications, CLI `-m <provider/model>` naturally takes precedence over the `"model"` property in `opencode.json`.
   - **Heterogeneous Review Model**: Independent reviews similarly execute in a separate process using `opencode run -m <agent.review_model> "<prompt>"`.
   - **Result**: Complete multi-provider settings, proxies, and custom headers are preserved 100% intact from the base configuration, while the active model is cleanly overridden for container execution without touching host files.

3. **Pure Data-Driven Staging via Standard Bridge Network (No `--net=host` Dependency)**:
   - Corporate CIS benchmarks and container runtimes (such as Docker Desktop on Windows/macOS with WSL2/Hyper-V) restrict or disable `--net=host`.
   - The orchestrator completely avoids running interactive browser-based login containers. All credential assembly happens locally in host Node.js process memory.
   - Credentials (`auth.json`) and configuration (`opencode.json`) are injected via `docker cp` directly into the container's `/home/agent/.local/share/opencode/auth.json` and `/home/agent/.config/opencode/opencode.json` with strict mode `0600` and ownership `10001:10001`.
   - The container operates on a standard isolated Docker bridge network, fully compliant with enterprise bastion and container security policies.

4. **Supported Onboarding Modes**:
   - **Mode A: Seamless Host Inheritance**: Automatically discovers host `%USERPROFILE%\.config\opencode\opencode.json` (Windows) or `~/.config/opencode/opencode.json` (macOS/Linux) and matching `auth.json`, copying them into the container without manual steps.
   - **Mode B: Key-Based CLI Quickset**:
     ```bash
     asdlc config set agent.provider "anthropic"
     asdlc config set agent.api_key "sk-ant-xxx"
     asdlc config set agent.base_url "https://api.corp.com/v1" # optional private gateway
     ```
     Host `asdlc run` formats standard `opencode.json` and `auth.json` in memory and pushes them into the container.
   - **Mode C: Enterprise Standard Template Import**:
     ```bash
     asdlc config agent --file ./enterprise-opencode.json
     ```
     Stores the team-vetted JSON verbatim under `~/.asdlc/agent/opencode/opencode.json`, overriding host local defaults for all container runs.

### 3.3 End-to-End Authentication & Ephemeral Secret Ingestion Pipeline
To satisfy corporate zero-trust and CIS container security standards, secret credentials must **never be baked into Docker image layers, written to host-mounted volumes, or stored in plaintext disk files**.

```mermaid
flowchart LR
  subgraph Host ["Host Workstation / CI Environment"]
    KEYCHAIN["Host Keychain / gh auth token / $GITHUB_TOKEN"]
    CFG["~/.asdlc/config.yaml (0600)"]
    EXTRACT["Host Orchestrator Memory Pipe"]
  end

  subgraph Container ["Ephemeral Container (UID 10001)"]
    RAMDISK["/dev/shm (In-Memory RAM Disk, 0600)"]
    ENV_PIPE["In-Memory Process Env: $GH_TOKEN"]
    GIT_HELPER["git credential.helper (RAM Hook)"]
    AGENT_PROC["Headless Agent Process"]
  end

  KEYCHAIN --> EXTRACT
  CFG --> EXTRACT
  EXTRACT -- "Ephemeral stdin / --env" --> ENV_PIPE
  EXTRACT -- "Memory stream (0600)" --> RAMDISK
  ENV_PIPE --> GIT_HELPER
  RAMDISK --> AGENT_PROC
```

1. **Host-to-Container Ingestion (Ephemeral In-Memory Pipe)**:
   - When running on a developer workstation, `asdlc run` queries the host OS keychain via `gh auth token` (Windows Credential Manager, macOS Keychain, or Linux Secret Service) or consumes a configured scoped Personal Access Token (PAT via `git.token`).
   - The token is passed to the container exclusively via ephemeral container environment (`--env GH_TOKEN=...`) or an in-memory stream into `/dev/shm` (RAM disk), strictly owned by `10001:10001` with permissions `0600`.
   - The container Git environment is pre-configured with an in-memory credential helper:
     ```bash
     git config --global credential.helper '!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f'
     ```
   - When the container terminates (`--rm`), process memory and `/dev/shm` are completely destroyed.
2. **CI/CD Execution Identity: GitHub App / Project Access Token / Scoped PAT (Uncompromised Auto-PR)**:
   - **Deprecation of Individual Human Credentials in CI**: Running unattended CI pipelines using an individual developer's personal interactive `gh auth` session is deprecated to prevent broad account blast radiuses and satisfy Separation of Duties (SoD / SOX / SOC2).
   - **First-Class Auto-PR Invariant**: The pipeline strictly guarantees **100% autonomous Auto-PR capability**. The containerized runner retains full authority to push `change/<slug>` branches, open Spec PRs, update Impl PRs, reply to review threads, and request human lead reviews—with zero manual human git-push overhead.
   - **Supported Enterprise Service Identities**:
     - **Option A: GitHub App Installation Token (Recommended for Enterprise GitHub)**:
       - Generates a short-lived (1-hour) token scoped strictly to the single target repository with permissions `contents: write`, `pull_requests: write`, and `issues: write`.
       - **Overcomes GitHub Actions Downstream CI Deadlock**: Standard GitHub Actions `GITHUB_TOKEN` deliberately blocks recursive workflow triggers—meaning fix commits pushed by a container runner using `GITHUB_TOKEN` leave required status checks permanently pending. Pushing via a **GitHub App identity (`asdlc-bot[bot]`)** ensures that all downstream CI test suites and branch protection checks **trigger and execute automatically on the auto-created PR**!
     - **Option B: Scoped Fine-Grained PAT / GitLab Project Access Token**:
       - Fully supported across both GitHub and GitLab for teams that manage project-scoped service accounts without GitHub App infrastructure.
       - Configured in CI secrets (`ASDLC_GIT_TOKEN: ${{ secrets.ASDLC_PROJECT_TOKEN }}`).
   - **Commit Attribution & Audit Trail**:
     - Automated commits pushed during the autonomous PR lifecycle are attributed cleanly to the bot identity with co-author trailers:
       ```git
       commit b7e3f21
       Author: asdlc-bot[bot] <asdlc-bot@users.noreply.github.com>
       Co-authored-by: Alice Engineer <alice@company.com>
       
       feat(auth): implement token rotation spec (closes #42)
       ```
3. **Enterprise VPC & Private Trackers (Jira / Confluence / Private Git)**:
   - Secrets defined in `~/.asdlc/config.yaml` (`env.JIRA_API_TOKEN`, `env.GITLAB_TOKEN`) are injected into the container via explicit passthrough (`runner.env_passthrough: "JIRA_*,GITLAB_*"`).
4. **Enterprise SSH Authentication & Zero-Leak Ingestion**:
   - **Does SSH Require a Private Key?**: Yes. Git over SSH (`git@host:dept/repo.git`) uses asymmetric cryptography (Ed25519/RSA). It strictly requires a valid private key registered with the remote Git server, or an active SSH agent holding that key. Without it, Git aborts with `Permission denied (publickey)`.
   - **How It Is Solved in the Container (Avoiding Four Security Anti-Patterns)**:
     - ❌ *Never bake SSH keys into the Docker image* (prevents image layer leakage).
     - ❌ *Never bind-mount host `~/.ssh` read-write* (prevents rogue scripts from corrupting host keys or `authorized_keys`).
     - ❌ *Never bind-mount `~/.ssh` across Windows/Linux UID boundaries* (prevents OpenSSH fatal error `Permissions 0644 for id_rsa are too open`).
     - ❌ *Never allow interactive host verification prompts* (prevents headless runs from hanging forever on `Are you sure you want to continue connecting (yes/no)?`).
   - **Supported Ingestion Patterns**:
     - **Pattern A: Ephemeral SSH-Agent Socket Forwarding (`SSH_AUTH_SOCK`)** *(Default for Local Dev)*:
       - The developer's host machine runs an SSH Agent (OpenSSH Authentication Agent on Windows, macOS Keychain, or Linux `ssh-agent`).
       - `asdlc run` binds the host SSH agent socket into the container as a read-only socket:
         ```bash
         # Linux / macOS native:
         -v "$SSH_AUTH_SOCK":/run/host-services/ssh-auth.sock:ro -e SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock
         # Docker Desktop (Windows / macOS) built-in socket alias:
         -v //run/host-services/ssh-auth.sock:/run/host-services/ssh-auth.sock -e SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock
         ```
       - **Zero Private Keys in Container**: The container sends cryptographic sign requests to the host agent; no raw private key files ever enter the container filesystem or RAM.
     - **Pattern B: Ephemeral RAM-Disk Key Stream (`/dev/shm/.ssh/`)** *(For Headless CI / Deploy Keys)*:
       - When running in automated CI without an agent, or when using a dedicated deploy key (`asdlc config set git.ssh_key_path ~/.ssh/id_ci` or env `ASDLC_SSH_KEY`):
       - The host orchestrator reads the private key into memory and streams it into the container's tmpfs RAM disk (`/dev/shm/.ssh/id_ed25519`), setting permissions strictly to `0600` and owner `10001:10001`.
       - Wiped completely when the container stops (`--rm`).
     - **Pattern C: Headless Known-Hosts Pre-Seeding (Zero TTY Prompts)**:
       - Before launching the container, the host orchestrator inspects the target host and pre-seeds container `/etc/ssh/ssh_known_hosts` (via in-memory `ssh-keyscan` or host `~/.ssh/known_hosts`), or injects `StrictHostKeyChecking accept-new` into container `~/.ssh/config`.
       - Eliminates terminal hangs on first-time host key verification.
   - **PE Recommendation (HTTPS Tokens vs SSH Keys)**:
     - In modern container CI/CD, **HTTPS + Token (`x-access-token` / `$GH_TOKEN` / `$GITLAB_TOKEN`) via `credential.helper` is generally preferred over SSH**:
       1. Tokens support fine-grained repository scoping and auto-expiration (e.g. 1-hour GitHub Actions tokens).
       2. HTTPS traverses corporate web proxies (`HTTP_PROXY`) and firewall rules seamlessly, whereas corporate egress firewalls frequently block outbound SSH port 22.
     - However, where enterprise compliance mandates SSH, Patterns A and B provide 100% automated, zero-leak operational parity.

### 3.4 Enterprise Model Injection & Heterogeneous Reviewer Topology
The AI reasoning engine requires flexibility to consume models from diverse internal and commercial providers while enforcing governance guardrails:
1. **Dynamic Model Injection via Runtime Flags**:
   - The primary authoring model (`agent.model` or `--model <provider/model>`) drives Spec drafting (Phase 1) and TDD implementation (Phase 6).
   - CLI flags take absolute precedence:
     ```bash
     asdlc run feat-auth --stage apply --model anthropic/claude-3-7-sonnet
     ```
2. **Heterogeneous Reviewer Topology (`Player != Referee`)**:
   - To eliminate "cognitive bias" and prevent self-rubberstamping, the independent review phases (Phase 4 Spec Review and Phase 7 Impl Review) execute under a physically isolated process using `agent.review_model` or `--review-model <provider/model>`.
   - Example:
     ```bash
     asdlc run feat-auth --stage verify --review-model openai/gpt-4o
     ```
3. **Private Corporate AI Gateways**:
   - When enterprise traffic must route through an internal proxy or AI gateway (e.g. LiteLLM, Cloudflare AI Gateway, Volcano Ark, Azure APIM):
     ```bash
     asdlc config set agent.base_url "https://ai-gateway.corp.company.com/v1"
     asdlc config set agent.custom_headers '{"X-Corp-Dept": "Infra", "X-Project-TRN": "trn:infra:sdlc"}'
     ```

### 3.5 Multi-Tier Environment Variable Precedence & Secret Masking Engine
A predictable 5-Tier hierarchy governs all configuration resolution:
```text
Tier 1: CLI Runtime Flags (--model, --repo, --stage, --env KEY=VAL) [Highest]
   ↓
Tier 2: Host Process Environment (process.env.ASDLC_*, ANTHROPIC_API_KEY, GH_TOKEN)
   ↓
Tier 3: Local Project Policy (.openspec/policy.yaml or .sdlc/policy.yaml)
   ↓
Tier 4: Global Configuration (~/.asdlc/config.yaml, mode 0600)
   ↓
Tier 5: System Internal Defaults [Lowest]
```
- **Global Secret Masking Engine**:
  - All output streams (stdout, stderr, and logfiles) pass through a stream sanitizer matching regex `/(token|key|secret|password|credential|pat|auth)/i`.
  - Values matching sensitive keys are masked: `ghp_1234567890abcdef...` -> `ghp_************cdef`.
  - Anti-Dumping Invariant: Even if an agent script executes `printenv` or `env` inside the container bash, the host runner intercepts and redacts sensitive strings before they can reach terminal displays or artifact logs.

### 3.6 Zero-Friction GitHub Repository & Context Auto-Detection
The orchestrator resolves the target Git remote and PR context through an unambiguous 4-tier detection cascade:
1. **Tier 1: Direct PR / Issue URL**:
   `asdlc run https://github.com/owner/repo/pull/42 --stage fix`
   - Regex decomposes URL into `host: github.com`, `owner: owner`, `repo: repo`, `number: 42`.
2. **Tier 2: PR Number with Local Remote Resolution**:
   `asdlc run #42 --stage fix`
   - When executed inside a local workspace, `asdlc` inspects `git remote -v`:
     - Parses SSH: `git@github.com:owner/repo.git` $\to$ `owner/repo`
     - Parses HTTPS: `https://github.com/owner/repo.git` $\to$ `owner/repo`
     - Parses Enterprise GitHub: `https://github.corp.company.com/team/repo.git`
3. **Tier 3: Ambient CI/CD Environment Auto-Detection**:
   - In GitHub Actions: automatically reads `$GITHUB_REPOSITORY` (`owner/repo`) and `$GITHUB_SERVER_URL`.
   - In GitLab CI: automatically reads `$CI_PROJECT_PATH` and `$CI_SERVER_URL`.
4. **Tier 4: Zero-Checkout Remote Mode (`--repo`)**:
   `asdlc run #42 --repo owner/repo --stage fix`
   - When invoked from an arbitrary folder or machine without local git checkout, the container runner performs an ephemeral shallow clone directly inside container `/workspace`. Zero host disk pollution.
5. **Tier 5: Greenfield Resolution & Mandatory Remote Contract**:
   - When executed in an uninitialized non-Git folder or a directory without a configured remote origin:
     - **Mandatory Target Requirement**: Container mode requires either `--create-repo <owner/repo>` (automatically creates the GitHub repository on the fly via `gh repo create` and pushes the initial baseline) or `--repo <owner/repo>` (links to an existing remote repository).
     - **Why Blind Host Write-Back is Prohibited**: Naively allowing a container to scaffold a repository in isolation and write it back to host without a target repository violates four core production principles:
       1. *Orphan / Undefined Namespace*: The local directory may be an arbitrary temporary folder (`/tmp` or unassigned workspace). Without an authoritative repo name, writing files back generates unmanaged orphan projects.
       2. *Cross-OS Permission Snowballs*: Container runs as non-root UID `10001:10001`. Blind `docker cp` writes root/Linux-permissioned Git trees onto Windows NTFS or macOS hosts, leading to broken file permissions and Git credential locks.
       3. *Autonomous PR Loop Blockage*: The core purpose of `asdlc run` is end-to-end lifecycle execution (PR creation, CI status checks, async PR comment grilling). Without a remote Git repo, the container cannot open a PR or receive CI feedback, stranding the task mid-execution.
       4. *Host Write-Back Failure Risk*: If host write-back fails (due to disk limits, antivirus file locks, or path errors), container teardown destroys all progress without recovery.
     - **Fail-Fast Error Notification Specification (`ASDLC_ERR_NO_REPOSITORY`)**:
       - **Diagnostic Exit Code**: Non-zero (`1`). Halts before launching containers or consuming AI tokens.
       - **Eye-Catching Terminal Card**: Emits a structured diagnostic card with exact causes and 3 copy-pasteable remedies:
         ```text
         ┌──────────────────────────────────────────────────────────────────────────────┐
         │  [ERROR] ASDLC_ERR_NO_REPOSITORY: Target GitHub repository not specified     │
         ├──────────────────────────────────────────────────────────────────────────────┤
         │  Root Cause:                                                                 │
         │  - Current directory is not a Git repository or has no remote origin.        │
         │  - Container execution requires an explicit target repository.               │
         │                                                                              │
         │  Actionable Remedies (Choose one):                                           │
         │  1. Create a new GitHub repository on the fly:                               │
         │     $ asdlc run "Build refund API" --create-repo <org/repo-name> --container │
         │                                                                              │
         │  2. Target an existing remote GitHub repository (Zero-Checkout mode):        │
         │     $ asdlc run "Build refund API" --repo <org/repo-name> --container        │
         │                                                                              │
         │  3. For local non-container development, initialize Git locally first:       │
         │     $ git init && asdlc init                                                 │
         └──────────────────────────────────────────────────────────────────────────────┘
         ```
       - **CI/CD Workflow Annotation**: In GitHub Actions, automatically outputs:
         `::error title=ASDLC_ERR_NO_REPOSITORY::Target GitHub repository could not be resolved. Provide --repo or --create-repo.`
       - **Machine-Readable JSON**: Supports `--json` emitting `{ "code": "ASDLC_ERR_NO_REPOSITORY", "verdict": "FAIL", "message": "...", "remedies": [...] }`.

### 3.6.1 Canonical Full URL vs. Shorthand Slug & Enterprise Intranet Zero-Guessing Policy

A major point of failure in enterprise container automation is resolving repository targets: **Should users specify a full canonical URL or a partial shorthand slug?** While guessing `github.com` works on the public internet, **guessing in enterprise private networks (Intranet / VPC / On-Premise) is completely impossible and dangerous**.

#### 1. Real-World Enterprise Intranet Dilemmas
* **Multi-Host & Heterogeneous Git Platforms**: Enterprise intranets host multiple Git servers concurrently: GitHub Enterprise Server (GHES, e.g. `github.corp.company.com`), self-hosted GitLab (`gitlab.internal.corp`), Bitbucket Server, Gitea, or private cloud remotes (Aliyun Codeup, Tencent CNB).
* **Deeply Nested Namespaces**: Unlike GitHub's fixed 2-level `owner/repo`, enterprise GitLab projects frequently have 3–5 levels of subgroups (e.g. `fintech/core-banking/settlement/refund-service`). A partial name like `refund-service` or `settlement/refund-service` is inherently ambiguous.
* **Anti-Data-Exfiltration Invariant**: If a developer on an internal network types `--repo fintech/refund-service`, **the system must NEVER fall back to guessing `github.com`!** Blindly querying `github.com/fintech/refund-service` with internal project tokens across public DNS/networks is an unacceptable data-leakage and compliance violation.

#### 2. Dual-Format Support with Deterministic Disambiguation

`asdlc run` enforces an unambiguous three-tier resolution policy:

| Format Type | Syntax Example | Resolution Behavior | Best Used When |
| :--- | :--- | :--- | :--- |
| **A. Canonical Full URL** *(Highest Precedence & Zero-Ambiguity)* | `https://gitlab.corp.company.com/fintech/settlement/refund.git`<br>`git@github.corp.company.com:infra/runner.git` | **100% Deterministic.** Directly extracts protocol, host, port, nested groups, and repo name. Bypasses all config defaults and guessing. | Enterprise CI/CD pipelines, automated scripts, and private GitLab multi-level subgroups. |
| **B. Configured Shorthand Slug** *(Zero-Guessing Host Expansion)* | `--repo fintech/refund`<br>`--create-repo fintech/refund` | **Deterministic Global Expansion.** If `git.default_host` is configured in `~/.asdlc/config.yaml` (e.g. `gitlab.corp.company.com`), expands strictly to `git@gitlab.corp.company.com:fintech/refund.git`. Never queries public networks. | Daily developer terminal usage on corporate laptops. |
| **C. Ambient Context Shorthand** | `#42` or bare slug in working tree | Extracts host and upstream namespace directly from local `git remote get-url origin` or ambient CI env (`$GITHUB_SERVER_URL` / `$CI_SERVER_URL`). | Developers working inside locally cloned projects. |

#### 3. Intranet Fail-Fast Disambiguation Guard (`ASDLC_ERR_AMBIGUOUS_HOST`)
If a user passes a shorthand slug (e.g. `--repo dept/project` or `--create-repo dept/project`) but:
1. No protocol or domain is included in the string;
2. `git.default_host` is NOT configured in `~/.asdlc/config.yaml`;
3. The current directory is not an existing Git clone, and no ambient CI environment is present;
4. The system detects an enterprise intranet environment (e.g. enterprise proxy, custom CA cert, or non-public network):

**The orchestrator immediately fails fast before launching containers, outputting `ASDLC_ERR_AMBIGUOUS_HOST`**:
```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  [ERROR] ASDLC_ERR_AMBIGUOUS_HOST: Cannot resolve Git host for shorthand slug│
├──────────────────────────────────────────────────────────────────────────────┤
│  Input Provided: "dept/project"                                              │
│  In enterprise environments, fallback guessing to github.com is strictly     │
│  prohibited to prevent private repository metadata and token exfiltration.   │
│                                                                              │
│  Remediation Options (Choose one):                                           │
│  1. Provide the canonical full URL (Recommended for CI/headless):            │
│     $ asdlc run --repo https://gitlab.corp.com/dept/project.git --container  │
│                                                                              │
│  2. Configure your enterprise default host once globally:                    │
│     $ asdlc config set git.default_host gitlab.corp.company.com              │
│     $ asdlc config set git.protocol https                                    │
│     Then rerun with shorthand: $ asdlc run --repo dept/project --container   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Multi-Source Intake & Two-Tier Skill Resolution

### 4.1 Repeatable `--from-file` and `--from-issue` Snapshotting
Both `asdlc new` and `asdlc run` accept repeatable `--from-file` and `--from-issue` arguments:

```bash
# Interactive IDE workflow
asdlc new "Partial order refund settlement" --from-file ~/Downloads/prd.md --from-file ./api.yaml --from-issue JIRA-345

# Autonomous container workflow
asdlc run --from-issue JIRA-345 --from-issue JIRA-346 --from-file ~/Downloads/prd.md --container
```

- **Host File Staging (`--from-file`)**: Supports arbitrary host paths outside the repository. Validated on the host (failing fast with `INTAKE_FILE_NOT_FOUND` if missing), copied into the container via `docker cp`, and snapshotted under `openspec/changes/<id>/intake/files/<NN>-<filename>` with SHA-256 digests in `intake/index.yaml`.
- **Two-Tier Skill Ticket Resolution (`--from-issue`)**: Because enterprise trackers vary widely in SSO gateways, custom acceptance criteria fields (`customfield_xxx`), and linked Confluence/wiki pages, `asdlc` core avoids hardcoded tracker SDKs:
  1. **Tier 1 — Enterprise Custom Skills (`~/.asdlc/skills/`)**: Automatically copied into the container and prioritized over bundled skills, paired with `env.*` / `runner.env_passthrough`.
  2. **Tier 2 — Bundled `asdlc-intake` Skill (Fallback)**: Ships `assets/skills/asdlc-intake/SKILL.md` supporting GitHub Issues/Projects, standard Jira (Cloud/DC), and Confluence pages. All fetched external text is wrapped in untrusted-data fences to mitigate prompt injection.

---

## 5. Official `ubuntu:26.04` LTS Image & Hardened Non-Root Baseline

### 5.1 Two-Layer Polyglot Runner Image
1. **Base Layer `ghcr.io/akjamie/asdlc-base:2026.xx` (`docker/Dockerfile.base`, rebuilt on toolchain updates)**:
   - OS: **`ubuntu:26.04` LTS** (`linux/amd64` + `linux/arm64`).
   - Toolchains: Node.js 22 LTS (`npm`/`pnpm`/`yarn`), Python 3.12 (`uv`/`pip`/`pytest` + prebuilt `tree-sitter`), OpenJDK 21 LTS (`maven`/`gradle`), Go 1.24+, Rust (`cargo`), C/C++ (`build-essential`/`gcc`/`g++`/`cmake`/`pkg-config`), `git`, `gh`, `glab`, `ripgrep`, `jq`, `curl`.
2. **Runner Layer `ghcr.io/akjamie/asdlc-runner:<pkg.version>` (`docker/Dockerfile.runner`, co-published per release)**:
   - Pre-installs version-matched `@akjamie/agentic-sdlc`, `openspec`, `graphifyy`, global `.agents/skills`, **`opencode`** (default), and **`claude`**.
   - **Version Pinning & CI Release**: `asdlc` defaults to `ghcr.io/akjamie/asdlc-runner:${pkg.version}` (never bare `:latest`), built and pushed automatically in `.github/workflows/release.yml` alongside `npm publish`, and synced on `asdlc upgrade`.

### 5.2 Internal Non-Exposed Security Baseline
Enforced internally on every container launch without exposing CLI flags to weaken them:
- **Strict Non-Root Execution**: Dedicated unprivileged user `agent` (`UID 10001:10001`, no `sudo`), `--user 10001:10001`, `--cap-drop=ALL`, `--security-opt=no-new-privileges:true`, `--pids-limit=512`, and `--rm` (also satisfying `claude -p --dangerously-skip-permissions`, which rejects `UID 0`).
- **Enterprise Dubious Ownership Immunity (CVE-2022-24765)**:
  - In containerized runtimes, UID mismatches between host users and container users (`UID 10001`) routinely trigger Git's security check: `fatal: detected dubious ownership in repository at '/workspace'`.
  - The runner image hardcodes system-wide `/etc/gitconfig` with `[safe] directory = /workspace` and injects `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=safe.directory`, and `GIT_CONFIG_VALUE_0=/workspace`. Git operations never block or fail due to UID boundary crossing.
- **Enterprise Corporate Proxy & TLS CA Trust Chain Passthrough**:
  - In enterprise VPCs with SSL-inspecting proxies (Zscaler, BlueCoat, Prisma), container calls to LLM APIs or Git remotes fail if custom CA root certificates are missing.
  - Host `asdlc run` automatically captures host `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and custom CA bundle paths (`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`), injects proxy settings into the container, and streams custom CA bundles into `/etc/ssl/certs/corporate-ca.crt` to guarantee frictionless enterprise network traversal.
- **Workspace Ingestion & Zero Host Bind-Mount (`git archive` Pipeline)**:
  - How the repository is provided to the container is a critical security and portability boundary:
    1. **Why Direct `git clone` Inside Container Fails**: Private enterprise repositories, private submodules, and corporate VPN boundaries require SSH keys or tokens that should not be permanently cloned from within a sandbox. Furthermore, `git clone` inside the container would miss the developer's local uncommitted baseline, staged work, or active branch state.
    2. **Why Host `-v` Bind-Mount Is Prohibited**: Bind-mounting the host project root directly exposes the host filesystem to arbitrary container scripts, creates Windows NTFS volume latency (10x slowdown on `node_modules`), causes CRLF line-ending mismatches, and risks UID permission pollution.
    3. **Production Standard: 3-Layer High-Fidelity Ingestion (`git archive + patch + untracked`)**:
       - **Layer 1 (Committed Base)**: Host streams the current branch snapshot into `/workspace` via `git archive HEAD | tar -x`.
       - **Layer 2 (Uncommitted Working Delta)**: If the host tree has uncommitted staged or unstaged changes, host pipes `git diff -p HEAD` into container `git apply --whitespace=nowarn`.
       - **Layer 3 (Untracked Non-Ignored Files)**: Untracked files (e.g. newly created configs, local `.env.example`) resolved via `git ls-files --others --exclude-standard` are streamed into `/workspace`.
       - Container `/workspace` sets ownership strictly to `10001:10001` and initializes an isolated Git tree targeting the remote origin.
       - Git push operations execute using the ephemeral `gh auth token` / `GH_TOKEN` injected into the process memory, completely eliminating host workspace bind-mount hazards.
- **Kernel-Level Read-Only Spec Lock (`0444`)**: During Phase 2 (`READY_FOR_IMPL`), `proposal.md` and `specs/**` are owned by `0:0` with mode `0444`, blocking unauthorized writes at the OS filesystem layer alongside `asdlc verify`'s `spec-tamper` check.

### 5.3 Tri-State Repository Lifecycle & Ingestion Matrix (Greenfield, Brownfield, Established)

A production-grade container runtime cannot assume every project is already a mature, initialized repository. `asdlc run --container` dynamically detects the repository state on the host and adapts its ingestion, container initialization, and host synchronization accordingly:

| Lifecycle State | Host Detection Condition | Host-to-Container Ingestion | Container Autonomous Initialization | Change Execution & Verification | Egress & Host Bidirectional Sync |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Greenfield Project**<br>*(Empty dir or loose PRD/docs, no Git repo)* | `git rev-parse --is-inside-work-tree` fails | Tar-streams directory content (filtering build artifacts via standard ignore list) + intake files via `docker cp`; sets `ASDLC_LIFECYCLE=greenfield`. **Guard**: Requires `--create-repo <name>` or `--repo <name>`; otherwise fails fast before container spin-up with `ASDLC_ERR_NO_REPOSITORY`. | 1. `git init -b main`<br>2. Configures container committer<br>3. Runs `asdlc init --headless`<br>4. Creates initial governance baseline commit<br>5. Calls `gh repo create` (if `--create-repo`) | Scaffolds language project layout (`package.json`, `go.mod`, etc.) based on PRD/prompt; drafts proposal, spec, tasks, and TDD loop | **A. Remote**: Pushes baseline to `main`, pushes feature branch to `origin`, opens PR<br>**B. Local Materialization**: Host CLI copies initialized workspace back: `docker cp <cid>:/workspace/. <hostDir>/` before container teardown |
| **2. Brownfield Project**<br>*(Existing codebase & Git history, never run asdlc)* | `git rev-parse --is-inside-work-tree` succeeds, but `openspec/` does NOT exist | Streams `git archive HEAD` + uncommitted/untracked non-ignored delta files; sets `ASDLC_LIFECYCLE=brownfield` | **Zero-Touch Auto-Onboarding (`asdlc init --onboard`)**:<br>1. Detects build system & test runner<br>2. Generates AST graph (`graphifyy`)<br>3. Seeds `.agents/skills` & OpenSpec<br>4. Generates tailored `AGENTS.md`<br>5. Commits onboarding baseline | Grounds in freshly generated AST graph (`explore.md`); drafts spec, reviews, and runs TDD against existing codebase | **A. Remote PR**: Pushes onboarding baseline & feature branch, opens Spec/Impl PR<br>**B. Local Materialization**: Syncs `openspec/` and `.agents/` back to host via `git bundle` or selective `docker cp` |
| **3. Established Project**<br>*(Git repo + initialized asdlc)* | `git rev-parse --is-inside-work-tree` succeeds AND `openspec/` exists | Streams `git archive HEAD` + dirty working tree delta (staged + unstaged diff); sets `ASDLC_LIFECYCLE=established` | Verifies governance integrity; runs incremental AST graph refresh on touched files | State machine advances change: drafts spec, PR comment grilling, or locks Spec `0444` and runs TDD verification | **A. Remote PR**: Pushes feature branch to `origin`, opens/updates PR<br>**B. Offline/Local**: Exports branch via `git bundle`, host CLI imports via `git fetch <bundle> <branch>:<branch>` (zero working tree pollution) |

#### 5.3.1 Greenfield Project Bootstrapping & Local Workspace Materialization
When a developer runs `asdlc run "Build an express service" --from-file ./prd.md --create-repo my-org/express-service --container` in an empty or non-Git directory:
1. **Mandatory Remote Guard**: If neither `--create-repo <owner/repo>` nor `--repo <owner/repo>` is provided, the host orchestrator fails fast immediately with `ASDLC_ERR_NO_REPOSITORY` (see §3.6 Tier 5), protecting against orphaned container runs.
2. **Host Ingestion**: The host CLI packages any existing local documentation or files (excluding `.DS_Store`, `node_modules`, etc.), and streams them into the container's `/workspace`.
3. **Container Headless Bootstrapping**: Inside `/workspace`, the runner initializes Git (`git init -b main`), sets local identity (`asdlc-agent <agent@asdlc.internal>`), runs headless `asdlc init`, creates commit 0 (`chore: initialize repository with agentic-sdlc governance`), and provisions the remote repository via `gh repo create my-org/express-service --private --source=. --push`.
4. **Scaffolding & Implementation**: The agent inspects the requirement, scaffolds project build files (`package.json`, `tsconfig.json`, source directory skeleton), drafts the spec, and executes the TDD implementation.
5. **Local Workspace Materialization**: Before the ephemeral container is destroyed (`--rm`), the host CLI copies the newly initialized workspace, `.git` repository, code, and OpenSpec artifacts back to the host project directory (`docker cp <container_id>:/workspace/. <host_dir>/`). The host is left with a fully functional, version-controlled project bound to the newly created remote repository.

#### 5.3.2 Brownfield Zero-Touch Auto-Onboarding & Baseline Isolation
When running `asdlc run <requirement> --container` on an existing legacy repository that has never adopted Agentic SDLC:
1. **Non-Destructive Ingestion**: The host CLI streams `git archive HEAD` plus any local uncommitted/staged edits into the container `/workspace`.
2. **Zero-Touch Auto-Onboarding (`asdlc init --onboard`)**: Instead of aborting with a blocking error, the runner automatically executes headless onboarding:
   - **Stack & Test Discovery**: Analyzes build tools (`maven`/`gradle`, `npm`/`pnpm`, `go.mod`, `pytest`, `cargo`) and identifies test commands.
   - **Deterministic AST Code Graph vs. Vector RAG**: Standard Vector RAG chops legacy code into arbitrary chunks, losing type hierarchies, polymorphism, and multi-hop call chains—leading to hallucinations in complex codebases. Instead, `asdlc-runner` uses pre-installed Tree-sitter parsers (`graphifyy`) to extract precise symbol definitions, interfaces, callers, and dependencies into `graphify-out/` and generate `explore.md`.
   - **Targeted Blast-Radius Grounding**: The agent does not attempt full-system re-architecture; it uses the AST graph to calculate the blast radius *strictly around the requested change*, suppressing context bloat.
   - **Governance Seeding**: Installs `.agents/skills`, sets up OpenSpec schemas, and writes a tailored `AGENTS.md` capturing the repository's build/test workflows.
3. **Baseline Isolation**: The onboarding artifacts are committed to an isolated baseline branch (`asdlc/onboarding-baseline`), keeping tooling governance changes cleanly separated from the incoming feature change.
4. **Change Execution**: The runner checks out `change/<slug>`, grounds in the AST graph, and executes the standard autonomous lifecycle.

#### 5.3.3 Established Repositories, Dirty Working Tree Preservation, and `git bundle` Sync
For repositories already managed by Agentic SDLC:
1. **High-Fidelity Working Tree Ingestion (3-Layer Overlay)**: Developers frequently run container tasks with uncommitted edits or staged work. Host `asdlc run` captures `git archive HEAD` (committed base) + `git diff -p HEAD` (active working tree delta applied via `git apply`) + untracked non-ignored files. Inside the container, this state is faithfully materialized, ensuring the containerized agent operates on the exact code the developer has locally.
2. **Incremental AST Graph Refresh**: Instead of re-indexing the entire codebase, the runner runs an incremental delta update on recently modified files, minimizing startup latency.
3. **Safe Egress via Remote PR or `git bundle` (Zero Host Working Tree Pollution)**:
   - In standard CI/autonomous mode, the container pushes the branch to `origin` and creates/updates the PR.
   - In local-only or offline mode, naive `docker cp` would risk overwriting unsaved host files or colliding with active IDE file locks. Instead, the container packages the new commits into a self-contained `git bundle` (`/workspace/change.bundle`). The host CLI imports the branch via `git fetch <bundle> <branch>:<branch>`, updating the host Git database without touching the active working copy. The developer can inspect the branch safely at their own pace.

---

## 6. State-Driven Orchestrator (`asdlc run`) & Async PR Grilling

### 6.1 Dual Execution Modes: Local Directory vs Zero-Checkout Remote (`--repo`)
Requiring developers to always sit in a locally cloned repository root is an anti-pattern. `asdlc run` supports two first-class operational modes:

1. **Contextual Local Mode (Default when in a repository folder)**:
   ```bash
   # Inferred from current working directory
   asdlc run "Add payment refund webhook" --from-file ./prd.md --container
   ```
   - Ingests the local working tree snapshot (via 3-layer overlay) as detailed in §5.2.
   - Synchronizes results back to local Git or remotes.

2. **Zero-Checkout Remote Mode (Run from any folder without local Git clone)**:
   ```bash
   # Run from home directory, automation server, or empty terminal:
   asdlc run --repo akjamie/agentic-sdlc "Add payment refund webhook" --container
   # Or with explicit git URL:
   asdlc run --repo https://github.com/my-org/core-api.git --from-issue JIRA-345 --container
   ```
   - The developer's laptop does **not** need a local clone of the repository.
   - Host CLI spins up the `asdlc-runner` container and injects the developer's credentials (`gh auth token` / `GH_TOKEN`).
   - The container runner clones the repository directly into `/workspace`, checks out a feature branch, executes the autonomous pipeline, and pushes the Spec/Impl PR to GitHub/GitLab.
   - Zero local disk clutter, zero checkout requirements, perfectly portable across dev laptops and CI runners.

### 6.2 Human-Centric Change Identification & Zero-Friction Resume
Forcing users to memorize or copy-paste synthetic internal change slugs across runs creates high cognitive friction. `asdlc run` resolves change context through a human-centric hierarchy:

1. **First-Class Pull Request Reference (Most Natural for Devs)**:
   ```bash
   asdlc run #34 --container
   # Or full PR URL directly copied from browser:
   asdlc run https://github.com/akjamie/agentic-sdlc/pull/34 --container
   ```
   - Resolves the change slug directly from the PR's label metadata (`asdlc:change-id: <slug>`) or branch name (`change/<slug>`).
2. **Issue Tracker Reference**:
   ```bash
   asdlc run --from-issue JIRA-345 --container
   ```
   - Automatically matches the existing change associated with `JIRA-345` in `openspec/changes/*/intake/index.yaml` and resumes it.
3. **Smart Active-Branch Auto-Detection (Zero Arguments)**:
   - When running `asdlc run` inside a repository without arguments:
     - If the active branch is `change/<slug>`, it automatically resumes that specific change.
     - If on `main` with a single active change, it resumes that change.
4. **Interactive Terminal Picker (When Ambiguous)**:
   - When multiple changes are active, running `asdlc run` launches an interactive selector:
     ```text
     ? Found 2 active changes. Select one to resume or start a new task:
     ❯ [1] payment-refund     (Draft Spec PR #34: 2 open questions pending replies)
       [2] token-encryption   (Spec PR #31 Merged: Ready for TDD Implementation)
       [3] + Start a new change
     ```
5. **Actionable Pause Output**: Whenever a run pauses (e.g. awaiting human replies to questions), the CLI displays the exact copy-pasteable command to resume:
   ```text
   ⏸️ Paused: Awaiting human replies on Draft Spec PR #34.
   👉 Reply directly in the PR comments on GitHub.
   👉 Once replied, resume at any time:
        asdlc run #34 --container
   ```

### 6.3 The "3+1" Canonical Stage Execution Model & Deterministic Resolution Engine
In adherence to the UNIX philosophy—*Explicit is better than implicit*—the autonomous container pipeline treats **explicit stage flags as First-Class Citizens**, while providing an automated, single-hop **Pipeline Driver** as a convenience fallback when `--stage` is omitted.

#### 6.3.1 The "3+1" Canonical Stage Taxonomy (`--stage spec | apply | verify | fix`)
The autonomous lifecycle is factored cleanly into **three forward production stages** and **one reactive collaboration stage** (all standardized into clean, single-word verbs):

| Stage Name | Category | Target Input | Autonomous Action | Verification Gate | Legacy Alias |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--stage spec` | Forward Production | Change ID, File, Issue | Ground in AST $\to$ Draft Proposal & Specs $\to$ Run BDD Lint $\to$ Initial Review $\to$ Open Spec PR | `asdlc lint` PASS | `--stage spec-review` |
| `--stage apply` | Forward Production | Change ID with merged Spec | Enforce `0444` kernel lock on specs $\to$ Execute Task-level TDD Loop (Red $\to$ Green $\to$ Refactor) | Unit tests PASS | N/A |
| `--stage verify` | Forward Production | Change ID with completed tasks | Independent AI Impl Review $\to$ Run `asdlc verify` (14-gate suite) $\to$ Open/Update Impl PR | `asdlc verify` PASS | `--stage impl-review` |
| `--stage fix` | Reactive Collaboration | PR Number (`#N`) or URL | 3-Tier Triage Engine: Fetch unresolved review comments $\to$ Classify $\to$ Apply fixes / Reply / Resolve | Re-lint (Spec) or Re-verify (Impl) | `--stage fix-comments` |

##### 1. Explicit Stage Execution (Deterministic & CI/CD Native)
When invoking `asdlc run` with an explicit `--stage`, zero heuristic guesswork is performed:
```bash
# 1. Author and review specification
asdlc run feat-auth --stage spec

# 2. Execute TDD implementation
asdlc run feat-auth --stage apply

# 3. Independent implementation review and gate verification
asdlc run feat-auth --stage verify

# 4. Ingest and address review comments on PR #42 (Spec PR or Impl PR)
asdlc run #42 --stage fix
```

##### 2. Enterprise CI/CD Integration (GitHub Actions / GitLab CI)
In production CI pipelines, webhooks already know the exact triggering event. The `--stage fix` stage enables dead-simple, 1-line automation without brittle Bash scripting:
```yaml
name: Agentic Review Auto-Fix
on:
  pull_request_review_comment:
    types: [created]
  pull_request_review:
    types: [submitted]

jobs:
  address-review:
    runs-on: ubuntu-latest
    steps:
      - name: Address Review Feedback
        run: asdlc run ${{ github.event.pull_request.number }} --stage fix
```

##### 3. Non-Container Local CLI Symmetry
To guarantee Dual-Track SDLC symmetry, review comment fixing is also available as an atomic local CLI command for developers working directly in their local IDE without containers:
```bash
# Interactive local developer execution in terminal/VS Code:
asdlc fix #42
# Container sandbox execution:
asdlc run #42 --stage fix
```

#### 6.3.2 Ground-Truth State Vector & Invariants (Fallback Pipeline Driver)
When a developer or automation invokes `asdlc run [target]` **without an explicit `--stage`**, the orchestrator acts as a transparent, single-hop **Pipeline Driver** (analogous to `make` checking target dependencies).
It evaluates the 4-Dimension State Vector $\mathbf{S} = \langle \text{Artifacts}, \text{GitLocks}, \text{TreeDiff}, \text{PRMetadata} \rangle$, logs the selected stage prominently, and advances by exactly one logical step:
```text
[INFO] No --stage specified. Auto-selected stage: 'fix' for PR #42.
[TIP]  You can run this stage explicitly: asdlc run #42 --stage fix
```

At startup, the Pipeline Driver resolves the state vector $\mathbf{S} = \langle \text{Artifacts}, \text{GitLocks}, \text{TreeDiff}, \text{PRMetadata} \rangle$:

1. **Artifact Invariants (`openspec/changes/<id>/`)**:
   - $P_{\text{spec}} \in \{0, 1\}$: `proposal.md` and `specs/**/*.md` exist.
   - $N_{\text{open}} \in \mathbb{N}$: Count of unresolved `[OPEN]` items in `clarifications.md`.
   - $N_{\text{tasks}} \in \mathbb{N}$, $U_{\text{tasks}} \in \mathbb{N}$: Total tasks and unchecked tasks (`- [ ]`) in `tasks.md`.
   - $R_{\text{stage}} \in \{\text{none}, \text{spec}, \text{impl}\}$, $R_{\text{verdict}} \in \{\text{none}, \text{APPROVE}, \text{CHANGES_REQUESTED}\}$: Latest review record in `review.md`.
2. **Git Governance Invariant (`specSha`)**:
   - $L_{\text{target}} \in \{0, 1\}$: Spec is locked on protected target branch (`main`).
     Evaluated via: `approvedSha = lastCommitTouching(repoRoot, targetBranch, ['proposal.md', 'specs/'])`.
     - In `workflow_mode: spec-first`: $L_{\text{target}} = 1$ **if and only if** the Spec PR has been merged into `main`.
     - In `workflow_mode: auto` (L0/L1 single-PR): $L_{\text{target}} \equiv 1$ (single-PR co-location privilege).
3. **Working Tree & Source Diff**:
   - $S_{\text{code}} \in \mathbb{N}$: Count of non-spec source code files modified in `git diff targetBranch...HEAD`.
4. **Remote PR Status (via GitHub/GitLab API)**:
   - $\text{PR}_{\text{label}} \in \{\text{needs-clarification}, \text{spec-review}, \text{impl-review}, \text{none}\}$.
   - $\text{PR}_{\text{state}} \in \{\text{DRAFT}, \text{OPEN}, \text{MERGED}, \text{CLOSED}, \text{none}\}$.
   - $C_{\text{replied}} \in \{0, 1\}$: Human comments exist on Draft PR answering question threads.
   - $H_{\text{feedback}} \in \{0, 1\}$: Unaddressed human feedback present on an open Spec/Impl PR, evaluated comprehensively across review decisions, unresolved threads, and post-commit comments:
     $$H_{\text{feedback}} = 1 \iff \left(\text{reviewDecision} == \text{'CHANGES_REQUESTED'} \lor N_{\text{unresolvedActionableThreads}} > 0 \lor T_{\text{lastHumanComment}} > T_{\text{lastCommit}}\right)$$

#### 6.3.3 Strict Disambiguation: Spec Review vs. Apply vs. Impl Review
The three critical stages are **strictly mutually exclusive** and partition the execution space:

| Evaluation Dimension | Stage A: Spec Review (`spec-review`) | Stage B: Apply (TDD Implementation) | Stage C: Impl Review (`impl-review`) |
| :--- | :--- | :--- | :--- |
| **Spec Locked on Main? ($L_{\text{target}}$)** | **$L_{\text{target}} = 0$** (Spec PR is still on branch, NOT yet merged to main) | **$L_{\text{target}} = 1$** (Spec PR is merged on main; `specSha` cryptographically locked) | **$L_{\text{target}} = 1$** (Spec is locked and immutable) |
| **Tasks Status ($U_{\text{tasks}}$)** | `tasks.md` does not exist or has not started | **$U_{\text{tasks}} > 0$** (Unchecked tasks remain: `- [ ] Task K`) | **$U_{\text{tasks}} = 0$** (All tasks 100% checked: `- [x]`) |
| **Source Code Diff ($S_{\text{code}}$)** | $S_{\text{code}} = 0$ (Zero business code changes allowed; spec-only) | $S_{\text{code}} \ge 0$ (Code changes actively being implemented) | **$S_{\text{code}} > 0$** (Source code and test files present in diff) |
| **Target Under Review** | `proposal.md`, `specs/**`, BDD acceptance criteria | N/A (Coding & Test Execution) | Implementation diff against locked `specSha` & test fidelity |
| **Kernel Lock Status** | Specs are writable by author | **`proposal.md` & `specs/**` locked as `0:0 0444` read-only** | Specs locked `0444`; implementation code under review |
| **Human PR Feedback Loop** | If $H_{\text{feedback}} = 1$: Fix specs $\to$ re-lint $\to$ push fix commit | N/A (Internal TDD execution) | If $H_{\text{feedback}} = 1$: Fix code & tests $\to$ re-verify $\to$ push fix commit |
| **Next Transition Gate** | `asdlc lint` PASS $\land\ H_{\text{feedback}} = 0 \to$ Ready PR $\to$ Human Merge | All tasks checked $\to$ Transition immediately to Impl Review | `asdlc verify` PASS $\land\ H_{\text{feedback}} = 0 \to$ Ready for Merge |

##### 6.3.3.1 PR-Driven Resolution Pipeline (`asdlc run #N` or URL)
When a developer or automation invokes `asdlc run #N` or passes a PR URL, the orchestrator queries the PR metadata and dispatches deterministically:

1. **If PR has label `asdlc:needs-clarification` (Draft Spec PR)**:
   - Checks PR comment thread.
   - If $C_{\text{replied}} = 0$ (humans have not yet replied): Logs *"Draft Spec PR #N is awaiting human answers to questions Q1..Qn"*, exits cleanly 0.
   - If $C_{\text{replied}} = 1$ (human replied): Ingests replies, clears `[OPEN]` items, updates `clarifications.md`, transitions to **Spec Review**.
2. **If PR has label `asdlc:spec-review` (Spec PR)**:
   - If $\text{PR}_{\text{state}} = \text{MERGED}$: The Spec PR was merged! $L_{\text{target}}$ becomes 1. Automatically checks out `impl/<slug>`, applies `0444` kernel lock on specs, and transitions to **Apply**.
   - If $\text{PR}_{\text{state}} = \text{OPEN}$:
     - **If $H_{\text{feedback}} = 1$ (Human Reviewer requested changes or left inline comments)**:
       - Enters **PHASE_SPEC_HUMAN_REVIEW_FIX**: Pulls inline review comments via `gh api repos/:owner/:repo/pulls/:id/comments`.
       - Session A amends `proposal.md` and `specs/**` to satisfy reviewer demands, records settlements in `clarifications.md`.
       - Runs `asdlc lint`, spawns fresh Session B (`asdlc-spec-review`) for delta validation.
       - Pushes commit `spec(<slug>): address PR review comments from @reviewer`, replies to review comment threads, and requests re-review.
     - **If $H_{\text{feedback}} = 0$ (No unaddressed human feedback)**:
       - If `asdlc-spec-review` has not run on current HEAD: Runs fresh **Spec Review**.
       - If AI review passed: Logs *"Spec PR #N is ready and approved by AI. Waiting for Tech Lead merge approval on GitHub"*, exits cleanly 0.
3. **If PR has label `asdlc:impl-review` (Implementation PR)**:
   - If $\text{PR}_{\text{state}} = \text{MERGED}$: Change lifecycle complete! Prompts to run `asdlc archive <slug>`.
   - If $\text{PR}_{\text{state}} = \text{OPEN}$:
     - **If $H_{\text{feedback}} = 1$ (Human Reviewer requested code changes or test additions)**:
       - Enters **PHASE_IMPL_HUMAN_REVIEW_FIX**: Pulls line-by-line review comments via GitHub REST API.
       - Session A modifies source code and unit tests to satisfy feedback.
       - Runs local test suite to ensure green, executes `asdlc verify` and spawns fresh Session B (`asdlc-impl-review`).
       - Pushes commit `impl(<slug>): address PR review comments from @reviewer`, replies to threads, and requests re-review.
     - **If $H_{\text{feedback}} = 0$ (No unaddressed human feedback)**:
       - If `asdlc-impl-review` or `asdlc verify` has not run on current HEAD: Runs fresh **Impl Review & Verification**.
       - If verified: Logs *"Implementation PR #N verified and ready for final Human merge"*, exits cleanly 0.

#### 6.3.4 Autonomous Review Comment Triage & Resolution Engine (Beyond 'CHANGES_REQUESTED')
In real-world enterprise engineering, human reviewers rarely click "Request Changes" (`reviewDecision: CHANGES_REQUESTED`). Instead, reviewers frequently:
1. Submit a review bundle with state `COMMENTED` (leaving `reviewDecision` as `null` or `COMMENTED`), containing actionable feedback like *"nit: handle null pointer here"* or *"please add test for edge case X"*;
2. Post single inline comments directly on the diff without bundling a formal review;
3. Use GitHub's native ```suggestion``` blocks;
4. Post clarifying questions (e.g., *"Why did we choose SHA256 over HMAC?"*) that require technical explanations rather than code changes;
5. Post non-actionable remarks (e.g., *"LGTM"*, *"Nice approach"*).

If an autonomous agent solely checks `reviewDecision === 'CHANGES_REQUESTED'`, it will falsely declare victory ($H_{\text{feedback}} = 0$), completely ignoring human feedback. To solve this, `asdlc` implements a **3-Tier PR Comment Triage & Resolution Engine**:

```mermaid
flowchart TD
  START(["PR Inspection: asdlc run #N"]) --> T1["Tier 1: Multi-Channel Ingestion & Temporal Filter\nGraphQL reviewThreads(isResolved: false) + Issue Comments\nFilter: createdAt > latestCommit && author != agent"]
  T1 --> T1_CHECK{"Unaddressed Comments Found?"}
  T1_CHECK -- "No (N == 0)" --> CLEAN["H_feedback = 0 -> PR Clean -> Proceed to Verify/Merge"]
  T1_CHECK -- "Yes (N > 0)" --> T2["Tier 2: Semantic Intent Classifier (4-Way Router)"]
  
  T2 --> C1["Category A: ACTION_REQUIRED (Code/Spec)\nExplicit bugfix, missing case, refactor demand"]
  T2 --> C2["Category B: SUGGESTION_BLOCK\nGitHub suggestion diff blocks"]
  T2 --> C3["Category C: INFORMATIONAL_QUESTION\nArchitectural inquiry, rationale request"]
  T2 --> C4["Category D: NON_ACTIONABLE\nPraise, 'LGTM', emoji acknowledgments"]

  C1 --> ACT_CODE["Session A: Edit Code/Spec -> Run TDD / Lint -> Local Verify"]
  C2 --> ACT_SUGG["AST Dry-Run: Apply Suggestion -> Run Unit Tests"]
  C3 --> ACT_INFO["Reasoning Agent: Formulate technical answer citing Spec/AST"]
  C4 --> ACT_ACK["Post reaction/acknowledgment (No code change)"]

  ACT_CODE --> T3["Tier 3: Bidirectional Resolution & Audit Trail"]
  ACT_SUGG --> T3
  ACT_INFO --> T3_REPLY["Reply to PR thread with technical explanation (Leave thread open for human)"]

  T3 --> COMMIT["Git Commit: fix(scope): address review feedback (ref: #threadId)\nGit Push to branch"]
  COMMIT --> REPLY["addPullRequestReviewThreadReply(body: 'Fixed in commit abc1234')"]
  REPLY --> RESOLVE["resolveReviewThread(threadId: $id)\nThread marked resolved in GitHub UI"]
  RESOLVE --> NEXT_CYCLE["Re-evaluate: Verify branch passes -> Update PR Status"]
```

##### 1. Tier 1: Deterministic Multi-Channel Ingestion & Anti-Loop Filtering
The engine fetches review feedback via GitHub GraphQL API, which preserves conversation threads and line mappings:
```graphql
query PullRequestReviewThreads($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewDecision
      headRefOid
      commits(last: 1) { nodes { commit { committedDate, oid } } }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 20) {
            nodes {
              id
              databaseId
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}
```
Anti-Infinite-Loop Invariants:
- **Temporal Invariant ($T_{\text{comment}} > T_{\text{commit}}$)**: Only comments created *after* the latest commit on the PR branch are considered unaddressed. Any comment preceding the latest commit is deemed already addressed or outdated.
- **Author Invariant ($\text{Author} \ne \text{Agent}$)**: The agent's own automated comments, bot summaries, and CI notifications are strictly filtered out to prevent self-triggering feedback loops.
- **Resolution Invariant ($\text{isResolved} == \text{false}$)**: Only unresolved review threads are evaluated. Threads marked resolved by humans are respected as closed.

##### 2. Tier 2: 4-Way Semantic Intent Classification
Each candidate comment is parsed with repository AST grounding and classified into one of four distinct intent categories:
- **Category A: `ACTION_REQUIRED_CODE_OR_SPEC`**:
  - *Trigger Pattern*: Imperatives requesting alterations ("Please add test", "Rename to parseQuery", "Should throw 404 instead of 500").
  - *Routing*: Passed directly to `Session A` alongside exact file path, line hunk, and AST symbol context. `Session A` applies the change, runs local tests/lint, and verifies compliance.
- **Category B: `SUGGESTION_BLOCK`**:
  - *Trigger Pattern*: Markdown code fence ````suggestion ... ```` directly in review comment.
  - *Routing*: Extracted into an in-memory diff patch, applied to the working tree, and tested against `npm test`. If green, accepted directly.
- **Category C: `INFORMATIONAL_QUESTION`**:
  - *Trigger Pattern*: Interrogatives requesting clarification ("Why was this approach chosen?", "Will this cause memory leaks?").
  - *Routing*: Handled by AI Technical Lead reasoning engine. Evaluates against `specs/`, `design.md`, and code AST to produce an authoritative, courteous response. **Zero code or spec files are mutated; zero empty commits are pushed.**
- **Category D: `NON_ACTIONABLE`**:
  - *Trigger Pattern*: "Looks good to me", "Nice!", "+1", emoji reactions.
  - *Routing*: Acknowledged with a thumbs-up reaction on GitHub; no downstream action triggered.

##### 3. Tier 3: Bidirectional Thread Resolution & Audit Trail
When actionable feedback (Category A or B) is implemented:
1. **Traceable Commit**: Changes are committed with conventional commit standards referencing the thread ID:
   ```bash
   git commit -m "fix(auth): handle null token exception (ref: #thread-MDEyOlB1bGxSZXF1ZXN0UmV2aWV3VGhyZWFkMTIz)"
   git push origin <branch>
   ```
2. **Explicit Thread Reply**: The engine calls `addPullRequestReviewThreadReply`:
   ```graphql
   mutation ReplyThread($threadId: ID!, $body: String!) {
     addPullRequestReviewThreadReply(input: {
       pullRequestReviewThreadId: $threadId,
       body: "Resolved in commit [`abc1234`](commit/abc1234): Handled null token exception and added regression test in `auth.test.js`."
     }) {
       comment { id }
     }
   }
   ```
3. **GraphQL Thread Resolution**: The engine resolves the thread in GitHub's UI:
   ```graphql
   mutation ResolveThread($threadId: ID!) {
     resolveReviewThread(input: { threadId: $threadId }) {
       thread { isResolved }
     }
   }
   ```
This completes a 100% automated, transparent review feedback loop without requiring human reviewers to re-navigate the PR just to click "Resolve conversation".

##### 4. Dual-Track Symmetry (Local IDE vs. Container Pipeline)
This triage engine is part of `@asdlc/engine` core and is completely symmetrical across execution modes:
- **Container Mode (`asdlc run --container #42`)**: Runs end-to-end automatically inside the isolated container runner.
- **Local IDE Mode (`asdlc review-comments --pr #42` or `asdlc apply --from-pr #42`)**: A developer in VS Code or CLI can invoke the exact same command locally to view triaged comments, apply suggested patches interactively, or let the local agent address them step-by-step. Non-container developer workflows remain 100% first-class and unimpaired.

#### 6.3.5 Comprehensive 10-Phase State Matrix
```mermaid
flowchart TD
  START(["Container Boots: asdlc run {target}"]) --> EVAL["State Evaluator: Inspect Git Branch, PR API, and openspec/"]
  EVAL --> S1{"1. Proposal & Specs authored?"}
  S1 -- "No" --> A1["Action: Ground in explore.md AST -> Draft Proposal & Specs"]
  S1 -- "Yes" --> S2{"2. clarifications.md has [OPEN] items?"}
  S2 -- "Yes" --> S2_PR{"Draft PR exists?"}
  S2_PR -- "No" --> A2_1["Action: Open Draft PR (needs-clarification) + Post Qs & Pause"]
  S2_PR -- "Yes" --> S2_REP{"Humans replied in PR comments?"}
  S2_REP -- "No" --> A2_2["Action: Log 'Waiting for human replies' & Exit 0"]
  S2_REP -- "Yes" --> A2_3["Action: Ingest replies -> Clear OPEN -> Finalize Specs"]
  A2_3 --> S3
  S2 -- "No" --> S3{"3. Spec reviewed & Spec PR open?"}
  S3 -- "Yes" --> S3_REV{"Human requested changes on Spec PR? (H_feedback == 1)"}
  S3_REV -- "Yes" --> A3_FIX["Action: Ingest human comments -> Session A fixes specs -> Session B re-lints -> Push fix commit"]
  S3_REV -- "No" --> S4{"4. Spec PR merged to main (specSha locked)?"}
  S3 -- "No" --> A3_RUN["Action: Spawn Session 2 (spec-review) -> asdlc lint -> Open Ready Spec PR"]
  A3_RUN --> S4
  S4 -- "No" --> A4["Action: Log 'Waiting for human TL to review & merge Spec PR' & Exit 0"]
  S4 -- "Yes" --> S5{"5. tasks.md 100% completed?"}
  S5 -- "No" --> A5["Action: Lock Specs 0444 -> Run task-level TDD loop (Red -> Green -> Refactor)"]
  S5 -- "Yes" --> S6{"6. Impl PR open & has human comments? (H_feedback == 1)"}
  S6 -- "Yes" --> A6_FIX["Action: Ingest human review comments -> Session A fixes code/tests -> asdlc verify -> Push fix commit"]
  S6 -- "No" --> S7{"7. asdlc verify & impl-review pass?"}
  S7 -- "No" --> A7_FIX["Action: Spawn Session 2 (impl-review) -> Fix regressions (max 3 rounds)"]
  S7 -- "Yes" --> A8["Action: Open/Update Implementation PR -> Ready for Final Merge"]
```

| Phase Index & Name | Active Pre-conditions | Autonomous Engine Action | Exit / Transition Boundary |
| :--- | :--- | :--- | :--- |
| **Phase 1: SPEC_DRAFT** | $P_{\text{spec}} = 0$ | Runs `asdlc new --no-grill`; grounds in Tree-sitter AST; writes initial proposal and specifications. | Moves to Phase 2 (if `[OPEN]` exists) or Phase 4. |
| **Phase 2: SPEC_GRILL_PAUSE** | $N_{\text{open}} > 0 \land \text{PR}_{\text{state}} = \text{none}$ | Pushes branch, opens Draft PR (`asdlc:needs-clarification`), posts structured questions in comments. | Exits cleanly 0 with pause instructions. |
| **Phase 3: SPEC_GRILL_RESUME** | $N_{\text{open}} > 0 \land C_{\text{replied}} = 1$ | Pulls PR comments via GitHub API, resolves `[OPEN]` items with human answers, updates `clarifications.md`. | Moves to Phase 4. |
| **Phase 4: SPEC_REVIEW** | $P_{\text{spec}} = 1 \land N_{\text{open}} = 0 \land L_{\text{target}} = 0 \land R_{\text{stage}} \ne \text{spec}$ | Spawns fresh Session 2 (`asdlc-spec-review`), runs `asdlc lint` gate, marks PR Ready with label `asdlc:spec-review`. | Moves to Phase 5. |
| **Phase 4b: SPEC_HUMAN_REVIEW_FIX** | $\text{PR}_{\text{label}} = \text{spec-review} \land \text{PR}_{\text{state}} = \text{OPEN} \land H_{\text{feedback}} = 1$ | Pulls human review comments; Session A amends specs; runs `lint`; Session B re-evaluates; pushes fix commit and replies to threads. | Moves back to Phase 5 for human re-review. |
| **Phase 5: AWAITING_SPEC_MERGE** | $\text{PR}_{\text{label}} = \text{spec-review} \land L_{\text{target}} = 0 \land H_{\text{feedback}} = 0$ | Logs waiting prompt for Human Tech Lead merge approval. | Exits cleanly 0 (zero idle container compute). |
| **Phase 6: APPLY_TDD** | $L_{\text{target}} = 1 \land U_{\text{tasks}} > 0$ | Locks specs as `0:0 0444`; authors `tasks.md` if missing; executes task-level TDD loop on unchecked tasks. | Moves to Phase 7 when $U_{\text{tasks}} = 0$. |
| **Phase 7: IMPL_REVIEW_AND_VERIFY** | $L_{\text{target}} = 1 \land U_{\text{tasks}} = 0 \land (\text{verify} \ne \text{PASS} \lor R_{\text{stage}} \ne \text{impl})$ | Spawns fresh Session 2 (`asdlc-impl-review`); runs `asdlc verify` (deterministic security & test gates); up to 3 fix rounds. | Moves to Phase 8 when verify & review pass. |
| **Phase 7b: IMPL_HUMAN_REVIEW_FIX** | $\text{PR}_{\text{label}} = \text{impl-review} \land \text{PR}_{\text{state}} = \text{OPEN} \land H_{\text{feedback}} = 1$ | Pulls line-by-line review comments; Session A fixes code & tests; runs `npm test` & `asdlc verify`; pushes fix commit. | Moves back to Phase 8 for human re-review. |
| **Phase 8: OPEN_IMPL_PR** | All verification gates pass $\land\ H_{\text{feedback}} = 0 \land \text{PR}_{\text{label}} \ne \text{impl-review}$ | Opens Implementation PR (`asdlc:impl-review`), attaches verification report and test summary. | Mission Complete. |

### 6.4 Governance Hardening
1. **`Player != Referee` Process Isolation**: Author/Implementer and Reviewer always execute as separate fresh processes with zero shared transcript, bounded by a **3-round** convergence cap.
2. **Deterministic `[OPEN]` Clarification Gate**: `asdlc lint` blocks Ready Spec PRs whenever `clarifications.md` has non-empty `## Open questions` or `[OPEN]` markers.
3. **Truthful Approval Provenance**: Updates `src/commands/approve.js` so `review.md` records actual merge SHA and approver provenance rather than synthetic six-dimension human PASS scores when no prior `review.md` exists.

---

## 7. Phased Implementation Roadmap

| Iteration | Scope | Verification Gate |
| :--- | :--- | :--- |
| **Iteration 1: Global Config, Multi-Source Intake & Lint Gates** | 1. `asdlc config` (`~/.asdlc/config.yaml`, `0600`, secret masking, `login`/`agent`)<br>2. `workflow_mode: spec-first \| auto` wired across `new`, `lint`, `apply`, `pr`, `verify`, `status`<br>3. Repeatable `--from-file` / `--from-issue`, `intake/index.yaml`, and bundled `asdlc-intake` skill<br>4. `[OPEN]` gate in `lint` and truthful provenance in `approve.js` | 100% existing tests green + unit/integration suites for `global-config`, `workflow-mode`, `intake`, and `clarification-lint` |
| **Iteration 2: Official `ubuntu:26.04` Non-Root Image & Release Pipeline** | 1. `docker/Dockerfile.base` & `docker/Dockerfile.runner` (`UID 10001:10001`, polyglot toolchains, `opencode` + `claude` + `asdlc` + `skills`)<br>2. Version-pinned GHCR build/push in `.github/workflows/release.yml`<br>3. Optional image sync in `asdlc upgrade` | Container runs as `10001:10001` with `--cap-drop=ALL`; polyglot compilers and `opencode`/`claude`/`asdlc` self-checks pass |
| **Iteration 3: `asdlc run` State Machine & Async PR Grilling** | 1. `src/commands/run.js` & `src/lib/container.js` (`docker cp` staging, `gh auth token`, `0444` Spec lock)<br>2. Dual-process `Player != Referee` isolation & 3-round cap<br>3. `asdlc:needs-clarification` Draft PR comment round-trip | End-to-end state-machine tests covering Spec PR creation, Draft PR comment Q&A resume, post-merge Impl PR, and `auto` Single-PR flow |

---
---

# 中文架构方案

## 1. 背景痛点与核心原则

在企业工程团队落地 Agentic SDLC 时，既需要保留**人在需求澄清与关键合入审批上的决策权**，又需要将确定性门禁之后的执行环节（Spec 起草与独立审查、TDD 编码实现、独立代码审查、验收测试与创建 PR）放入隔离运行环境中自动完成。当前存在三项核心瓶颈：

1. **单仓配置与分级心智负担重**：现有流程强绑定启发式 `L0–L3` 风险评估来决定单/双 PR，缺少机器级全局开关，无法在不修改每个业务仓 `.sdlc/policy.yaml` 的情况下统一锁定经典的「强制双 PR（`spec-first`）」模式。
2. **输入源单一**：`asdlc new` 仅支持单条文本参数，不支持同时传入多份本地文档与多个外部需求单（Jira / Confluence / GitHub Issues）。
3. **缺少标准化非特权全栈容器运行时**：下游环节依赖本地交互式 IDE 会话，缺少内置主流编译工具链与无头 AI 工具的官方非 Root 容器镜像、75+ 模型供应商零翻译登录透传，以及无终端交互下的异步澄清闭环。

### 核心设计原则
- **人工（IDE）与自动（Container）双轨完全兼容**：Git 分支、PR 状态与 `.openspec.yaml` 保持唯一状态真相源。本地 IDE 会话与 `asdlc run --container` 调用完全相同的底层命令，任何阶段均可随时人工接手或交回容器。
- **职责彻底解耦，零配置翻译损耗**：`~/.asdlc/config.yaml` 仅供 `asdlc` 自身读取；内置 AI（`opencode` / `claude`）100% 读取各自官方原生配置；外部需求单通过可覆盖的 Skill 层接入，不在核心 CLI 硬编码私有 SDK。
- **出厂默认安全，隐藏底层参数噪音**：非 Root 用户（`UID 10001:10001`）、剥离内核 Capability 与实现阶段 Spec 文件内核级只读锁（`0444`）全部作为内部默认安全基线，不在 CLI 暴露底层安全参数。

---

## 2. 总体架构与交互流程

*(架构组件图与异步 PR Grill 时序图见上方英文部分第 2 节图表，中英文共享同一套拓扑与状态流转设计。)*

### 2.1 核心职责切分
- **宿主机（`asdlc run`）**：负责读取 `~/.asdlc/config.yaml`、校验并 `docker cp` 宿主机 `--from-file` 文档、跨平台提取宿主机已有原生 AI 凭证与 `gh auth token`、注入企业自定义 `~/.asdlc/skills/`，并管理一次性非特权容器生命周期。
- **隔离容器（`UID 10001:10001`）**：在容器原生 Linux `/workspace` 内独立克隆仓库，通过 Skill 拉取外部需求单落盘 `intake/`，以**两个完全独立的进程会话**分别执行「编写/实现」与「独立审查（`Player != Referee`）」，通过确定性门禁后推送分支并创建/更新 PR，退出即销毁（`--rm`）。

### 2.2 阶段驱动的容器生命周期与人机协作门禁（定界自主，拒绝黑盒猜测）

> [!IMPORTANT]
> **架构定调：阶段定界自主 vs. 虚幻的“全自动读心黑盒”**
> AI 研发流水线最常陷入的一个典型误区，是试图把系统做成一个“敲一行命令、全自动猜透一切、跨越数天无所不能的黑盒”。在真实企业软件工程中，任何严谨的交付必然跨越数天、必然穿插着人类的技术判断（需求澄清问答、PR Review 批注、Tech Lead 合入审查与发布裁决）。
> 
> 因此，本方案**坚决摒弃脆弱的“黑盒状态猜测”**，采用**“阶段定界自主（Bounded Stage Automation）与显式驱动”**：
> 1. **阶段内高度自治（Stage-Scoped Automation）**：每一次容器启动，其目标极度聚焦，在边界内全自动执行（AST 图谱解析、TDD 红绿循环、门禁代码检查、Review 意见自动修复）；
> 2. **阶段间显式驱动（Stage-Driven Orchestration）**：跨越人机协作里程碑时，由开发者或 CI Webhook 显式下发指令（`--stage spec`、`--stage apply`、`--stage verify`、`--stage fix`），彻底杜绝跨天多次启动时的“不知道做到哪儿了”；
> 3. **用完即焚零空转（Ephemeral Compute）**：容器执行完当前 Stage 并通过门禁后立刻退出销毁（`--rm`），绝不在后台常驻挂起浪费算力。

```mermaid
sequenceDiagram
  autonumber
  actor Dev as 业务开发者 / Tech Lead
  actor Rev as 同行代码审查者 (Reviewer)
  participant Host as 宿主机 CLI (asdlc run)
  participant Runner as 容器沙箱 (UID 10001)
  participant AgentA as Session A (编写/实现会话)
  participant AgentR as Session B (独立审查会话)
  participant GitPR as GitHub / GitLab PR

  Note over Dev,GitPR: 阶段 1: 需求草拟与规范审查 (--stage spec)
  Dev->>Host: asdlc run --from-issue JIRA-345 --from-file ./prd.md --stage spec
  Host->>Runner: 启动容器 + docker cp 注入代码树、配置与技能
  Runner->>AgentA: 解析 intake/ 需求单，AST 图谱定位，草拟提案与 Spec
  alt 存在未解决业务歧义 (含 OPEN 标记)
    AgentA->>GitPR: 开启 Draft Spec PR (asdlc:needs-clarification) + 提交提问评论
    Runner-->>Host: 干净退出 0 (零空转等待人工回复)
    Dev->>GitPR: 直接在 PR 评论区回复答疑
    Dev->>Host: asdlc run #34 --stage spec
    Host->>Runner: 抓取 PR 评论回复 -> 消化并清空 OPEN 标记
  end
  Runner->>AgentR: 派生独立审查进程 (asdlc-spec-review, 异构模型)
  Runner->>Runner: 运行物理门禁: asdlc lint (必须通过)
  Runner->>GitPR: 标记 Ready Spec PR #34 (asdlc:spec-review) + 附带审查凭据
  Runner-->>Host: 销毁容器 (--rm)

  opt 人工审查提出 Spec 修改批注 (--stage fix)
    Rev->>GitPR: 在 Spec PR #34 留下行内修改建议或评论
    Dev->>Host: asdlc run #34 --stage fix
    Host->>Runner: 通过 GraphQL 拉取未解决评论线程
    Runner->>AgentA: 修改 proposal.md 与 specs/** 响应评审
    Runner->>Runner: 重新执行 asdlc lint (必须通过)
    Runner->>GitPR: 推送修复 Commit + 回复评论 + resolveReviewThread
    Runner-->>Host: 销毁容器 (--rm)
  end

  Dev->>GitPR: Tech Lead 审核并在主干合入 Spec PR #34 (锁定 specSha)

  Note over Dev,GitPR: 阶段 2: 严格 TDD 编码实现 (--stage apply)
  Dev->>Host: asdlc run feat-auth --stage apply
  Host->>Runner: 克隆主干，内核锁死 Spec 为 0:0 0444 只读
  Runner->>AgentA: 生成 tasks.md + 执行任务级 TDD 红绿重构循环
  Runner->>Runner: 本地单元测试全部通过
  Runner-->>Host: 销毁容器 (--rm)

  Note over Dev,GitPR: 阶段 3: 独立审查与终态验证 (--stage verify)
  Dev->>Host: asdlc run feat-auth --stage verify
  Host->>Runner: 派生独立审查进程 (asdlc-impl-review) + 运行 asdlc verify (14项门禁)
  Runner->>GitPR: 开启正式 Implementation PR #42 (asdlc:impl-review) + 附带测试凭据
  Runner-->>Host: 销毁容器 (--rm)

  opt 人工审查提出代码/测试修改批注 (--stage fix)
    Rev->>GitPR: 在 Impl PR #42 提出代码审查意见
    Dev->>Host: asdlc run #42 --stage fix
    Host->>Runner: 通过 GraphQL 拉取行内评审批注
    Runner->>AgentA: 修改源码与测试用例响应批注
    Runner->>Runner: 运行 asdlc verify 门禁验证 (14 项必须全绿)
    Runner->>GitPR: 推送修复 Commit + 回复评论 + resolveReviewThread
    Runner-->>Host: 销毁容器 (--rm)
  end

  Dev->>GitPR: Tech Lead 终审通过合入 Impl PR，流水线大功告成
```

### 2.3 双轨生命周期对齐：交互式（非容器）与全自动（容器）模式的无缝互通

Agentic SDLC 的核心设计原则是**绝不破坏、绝不绑架现有的非容器交互式研发流程**。
`asdlc run --container` 绝非替代现有的 IDE 开发者流程，而是与其构成高度对齐的**双轨对称体系**：

#### 1. 轨道一：交互式 IDE 模式（Non-Container / 经典开发者结对流程）
- **核心场景**：开发者在 Cursor、VS Code 或本地终端中，与 AI Agent（Claude Code / OpenCode / GitHub Copilot）实时结对编程。
- **执行方式**：
  - 单步显式推进：`asdlc new "req"`（终端交互式单步盘问） $\to$ IDE 协同编写 Spec $\to$ `asdlc lint` $\to$ `asdlc pr`（打开 Spec PR） $\to$ Tech Lead 审核合入 $\to$ `asdlc apply`（在 IDE 中由开发者主导任务级 TDD 红绿循环） $\to$ `asdlc verify` $\to$ `asdlc pr`（打开 Impl PR） $\to$ `asdlc archive`。
- **环境要求**：纯本地 Node.js + Git，**完全不需要 Docker，零额外环境依赖**。
- **如何处理 PR 评论修改**：
  - 当 Tech Lead 在 GitHub PR 上提出评审批注（Comments）或打回（Changes Requested）时：
    - 开发者在本地运行 `asdlc status`，清晰掌握当前处于 `[存在 2 条未解决的 PR 评审意见]`；
    - 开发者在本地 IDE 中直接修改代码/测试，重新执行 `asdlc lint` 或 `asdlc verify` 并 `git push`；
    - 开发者亦可在 IDE 聊天窗中唤起内置技能（如 `/asdlc-apply` 或 `/asdlc-spec-review`）：*“请帮我解决 PR #42 上的两条修改批注”*，由本地 Agent 辅助就地修改。

#### 2. 轨道二：全自动无头模式（Autonomous Container Mode / 容器沙箱）
- **核心场景**：开发者不想在本地占用前台终端、不想安装目标项目的语言编译环境，或者在 CI/CD 流水线中批量处理工单。
- **执行方式**：
  - 一键托管执行：`asdlc run --from-issue JIRA-123 --container`。
  - 遇到业务歧义自动发 Draft PR 评论提问并退出；人在 GitHub 评论回复后，敲一行 `asdlc run #42 --container` 自动接关；
  - 遇到 PR 评审批注（$H_{\text{feedback}} = 1$），容器沙箱自动拉取行内批注、修改源码或 Spec、跑通门禁、推新 Commit 并回复评论，全流程无人值守。

#### 3. 轨道 1.5：宿主就地编排模式（Host Local Orchestrator，`asdlc run` 不带 `--container`）
- 开发者希望享受全自动状态机的省心，但本机未装 Docker 或更偏好使用本地编译链时：直接运行 `asdlc run [changeId]`，编排器在本地直接驱动 `opencode run` 或 `claude -p` 就地执行状态流转。

#### 4. 双轨无缝双向自由交接（Seamless Bidirectional Handoff）
因为系统的唯一真相源（Single Source of Truth）是 **Git 提交拓扑、PR 远端状态与 `.openspec.yaml`**，两套轨道的数据结构完全同构：
- **从 IDE 甩给容器（Delegate to Container）**：
  开发者在 IDE 中使用 `asdlc new` 完成了复杂的方案设计，Spec PR 合入后，开发者不想自己手动写几十个单元测试的胶水代码，只需执行 `asdlc run <changeId> --container`，将枯燥的 TDD 编码实现全权托管给容器沙箱，自己在本地继续去喝咖啡或开发其他功能。
- **从容器接管回 IDE（Takeover to IDE）**：
  由工单自动触发容器拉起的变更，在遇到复杂业务分歧时挂起在 Draft PR 上。如果开发者认为在 GitHub 评论区回复太麻烦，可以直接在本地 `git checkout change/<slug>`，立刻无缝切入本地 IDE 模式，继续用熟悉的本地命令手工编辑和调试，**两轨之间零状态分歧、零交接损耗**。

#### 5. 对非容器工作流的“零破坏承诺”（Zero Breaking Changes）
1. **基础指令语义与接口 100% 保持不变**：
   现有全部 7 阶段底层指令（`new`, `lint`, `apply`, `verify`, `pr`, `approve`, `archive`, `status`, `test`, `doctor`）的参数格式、退出码、门禁语义完全保持原有行为，已有任何自动化脚本与开发习惯无需改动一行代码。
2. **全局配置向下完全兼容**：
   `~/.asdlc/config.yaml` 仅作为缺省治理配置提供全局便利。若本地不存在该文件，所有交互式命令 100% 平滑回退至现有代码库的 `.sdlc/policy.yaml` 或默认兜底，绝不产生破坏性断裂。

---

## 3. 全局配置控制面与双模式开关 (`asdlc config`)

### 3.1 双模控制面：交互式配置向导 (`asdlc config`) + 脚本化 CLI

为避免开发者记忆繁琐的命令行点分路径，同时保证 CI/CD 脚本的确定性调用，`asdlc config` 提供了两种互补交互模式：

#### 1. 终端交互式引导向导（无参数执行 `asdlc config`）
开发者直接输入 `asdlc config` 即启动交互式向导，支持**每一步随时按 `[Save & Exit]` 或 `Esc` 保存退出**：

```text
=== Agentic SDLC Global Configuration Wizard ===
Press [Ctrl+C] or choose 'Save & Exit' at any time to finish.

? What would you like to configure? (Use arrow keys)
❯ 1. Workflow Mode (Current: spec-first)
  2. AI Model & Harness (Current: Inherit Host OpenCode)
  3. Git & Pull Request Auth (Current: GitHub via gh CLI)
  4. Issue Tracker Integration (Jira / Confluence)
  ---------------------------------------------------------
  [ Save & Exit ]
```

- **宿主环境智能感知**：
  - 自动检测本地 `gh` CLI 登录态 -> 提示 `✓ GitHub: Inherited from host 'gh' CLI (user: akjamie)`，回车直接复用。
  - 自动检测本地 OpenCode 配置文件 -> 提示 `✓ AI: Found host OpenCode config (~/.config/opencode/opencode.json)`。
- **模块化步骤，选填项随时跳过**：
  - **模块 1：工作流模式** — 单选 `● spec-first (推荐新团队: 强制 Spec PR -> 人工合入 -> Impl PR)` 或 `○ auto (自适应分级)`。
  - **模块 2：AI 引擎与容器模型覆盖** — 可选直接复用宿主配置、为容器设置专属模型（如 `doubao-seed-code`）、快捷录入 API Key，或导入团队标准 JSON。
  - **模块 3：Git & PR 凭证** — 继承宿主 `gh` 或提供自定义 Token。
  - **模块 4：外部需求单配置（选填）** — 支持录入 Jira / Confluence URL 与 Token，或直接选择 `● 暂不配置 (后续配置或仅使用本地文件)`。敏感 Token 输入全程掩码打码。
- **原子化落盘**：随时选择 `[Save & Exit]`，配置以 `0600` 权限安全写入 `~/.asdlc/config.yaml`。

#### 2. 非交互脚本化 CLI（面向自动化脚本与 CI/CD）
针对无人值守部署与脚本编写，保留全部标准子命令：

引入机器级全局配置 `~/.asdlc/config.yaml`（权限强制 `0600`），所有配置项统一收敛至 `asdlc config`（不单设 `asdlc auth`；命中 `*key/*token/*secret/*password` 在 `list` 时自动脱敏）：

- **`workflow_mode` 权威支持两档**（在本地 IDE 与容器沙箱中表现 100% 严格对称一致）：
- **企业内网 Git 默认主机配置**：
  ```bash
  asdlc config set git.default_host gitlab.corp.company.com # 默认: github.com
  asdlc config set git.protocol https                       # https (默认推荐) | ssh
  asdlc config set git.provider gitlab                      # github (默认) | gitlab
  ```

| `workflow_mode` | 治理定位与 PR 拓扑 | 本地 IDE 交互模式 (Track 1) | 容器沙箱自动化流水线 (Track 2) |
| :--- | :--- | :--- | :--- |
| **`auto`** *(默认推荐)* | **自适应风险分级拓扑**。内置 L0–L3 三维风险引擎：L0/L1 自动走单 PR 拓扑（Spec 与代码合并提 1 个 PR，保障极速流转）；L2/L3 自动升格为双 PR 拓扑（强制 Spec PR 人工合入锁定后再进 Impl PR）。 | 开发者本地运行 `asdlc lint`，引擎自动评定级别。若为 L0/L1 直接提单 PR；若为 L2/L3 则先提 Spec PR，合入锁定 `specSha` 后才准许 `asdlc apply`。 | 容器在阶段 3 评定风险。若为 L0/L1，直接连贯执行 `apply` 与 `verify` 并开单 PR；若为 L2/L3，开启 Spec PR 并挂起进入阶段 5 等待人工合入。 |
| **`spec-first`** | **强制严格双 PR（合规顶配）**。跳过风险评估，所有变更一律强制双 PR：**Spec PR（`lint` + `spec-review` + 人工合入主干锁 `specSha`）$\to$ Impl PR（`verify` + `impl-review`）**。适合金融级核心架构与强合规团队。 | 所有变更无例外，必须先走 Spec PR、人类 Tech Lead 审查并合入主干生成锁定的 `specSha`，本地 `asdlc apply` 才能解锁。 | 容器仅执行 `--stage spec`，提 Spec PR 后安全退出；待人类合入后，通过 `--stage apply` 唤醒进入实现流水线。 |

> [!IMPORTANT]
> **为何 `single-pr` 绝不能作为全局配置开放**：
> 在企业级研发生命周期中，若开放全局 `workflow_mode: single-pr`，将形成极其危险的治理后门：个别开发者或流水线可通过设置全局单 PR，绕过对高危 DDL 库表重构、认证改造、转账计费等 L2/L3 变更的双 PR 强审拦截。
> 因此，在 `agentic-sdlc` 规范中，`single-pr` **纯粹是 `auto` 模式评估出 L0/L1 低风险后所授予的内部流转特权**，坚决不作为顶层全局开关暴露。

- **优先级链**：`CLI 参数` > `环境变量 ASDLC_*` > `单仓 .sdlc/policy.yaml（仅特例覆盖）` > **`全局 ~/.asdlc/config.yaml`** > `内置默认值`。

### 3.2 行业级与用户级 AI 配置设计（整文件原子继承 + CLI 参数覆盖）

`~/.asdlc/config.yaml` **不给内置 AI 直接解析**。系统站在行业级平台规范与实际用户习惯的角度，设计了**整文件原子选择 + 运行时命令行参数覆盖模型（坚决杜绝脆弱的 JSON 深度拼积木）**：

1. **基础文件原子级选择（零 Deep Merge 隐患）**：
   - 在生产实践中，多厂商复杂 JSON 深度合并极易冲掉嵌套数组、覆盖同名但认证方式不同的 Provider。
   - **基础源确定策略**：宿主机将基础配置作为**不可变原子单元**选择（整份读取，不拆碎字段）：
     - **第一优先**：`~/.asdlc/agent/opencode/opencode.json`（若通过 `asdlc config agent --file` 导入过团队专属模板）。
     - **第二优先**：宿主机原生已有的 `%USERPROFILE%\.config\opencode\opencode.json`（Windows）或 `~/.config/opencode/opencode.json`（macOS/Linux）及对应的 `auth.json`。
     - **第三兜底**：两边均无时，由 `asdlc` 根据 `asdlc config set agent.provider` / `agent.api_key` 在内存生成一份最小合法配置。

2. **容器差异化模型覆盖：走官方原生 CLI 参数 `-m`（零文件修改）**：
   - 开发者本地日常习惯用 `anthropic/claude-sonnet-4-5`，但希望容器自动化流水线使用企业高吞吐模型 `doubao-seed-code`。
   - **实现机制**：`asdlc` **绝不去修改底层的 `opencode.json`**，而是将 `asdlc config set agent.model <model>` 直接转换为 OpenCode 官方命令行参数：
     ```bash
     opencode run -m "provider/model" "<prompt>"
     ```
   - **根据 OpenCode 官方规范**：命令行传入的 `-m <provider/model>` 优先级天然高于 `opencode.json` 里的 `"model"` 属性。
   - **异构独立审查模型**：审查阶段同样通过独立进程启动 `opencode run -m <agent.review_model> "<prompt>"`。
   - **收益**：底层复杂的 75+ 供应商连接、内网私有代理、自定义 Header 100% 完整继承，而活动模型被干净利落地在运行时单次覆盖，**绝不污染或篡改开发者宿主机的本地 OpenCode 配置文件**！

3. **纯数据流注入（零 `--net=host` 依赖，适配企业 CIS 合规）**：
   - 彻底废弃在容器内跑交互式网页登录的设计，避免因 `--net=host` 在企业堡垒机被禁用、或在 Windows/macOS WSL2 虚拟机网络下无法回调宿主机浏览器而导致死锁。
   - 认证数据全流程在宿主机内存组装，通过 `docker cp` 单向注入容器文件系统，权限锁定为 `10001:10001`、`0600`。容器运行在标准 Docker bridge 隔离网络下，完美符合企业 CIS 容器安全规范。

4. **三种接入模式**：
   - **模式 A（宿主机无缝继承）**：自动跨平台识别宿主机 `%USERPROFILE%\.config\opencode\opencode.json`（Windows）或 `~/.config/opencode/opencode.json`（macOS/Linux）及对应的 `auth.json`，直接注入容器使用。
   - **模式 B（命令行快速配置）**：
     ```bash
     asdlc config set agent.provider "anthropic"
     asdlc config set agent.api_key "sk-ant-xxx"
     asdlc config set agent.base_url "https://api.corp.com/v1" # 可选内部网关
     ```
     宿主机在内存中组装标准合法 JSON 并注入容器。
   - **模式 C（企业标准模板导入）**：
     ```bash
     asdlc config agent --file ./enterprise-opencode.json
     ```
     原封不动存入 `~/.asdlc/agent/opencode/opencode.json`，供所有容器流水线作为专属配置执行。

### 3.3 端到端鉴权体系与无痕临时凭据注入流水线
为全面满足企业级零信任与 CIS 容器安全规范，敏感凭据**绝不允许烘烤进 Docker 镜像层、绝不挂载宿主机敏感目录、绝不在容器磁盘以明文持久化**。

```mermaid
flowchart LR
  subgraph 宿主机 ["宿主机工作站 / CI 执行环境"]
    KEYCHAIN["系统凭据管理器 / gh auth token / $GITHUB_TOKEN"]
    CFG["~/.asdlc/config.yaml (0600 严格权限)"]
    EXTRACT["编排器进程内存管道 (Host Memory Pipe)"]
  end

  subgraph 容器沙箱 ["临时非 Root 容器 (UID 10001:10001)"]
    RAMDISK["/dev/shm 内存盘 (0600 严格权限)"]
    ENV_PIPE["进程环境变量 $GH_TOKEN (无磁盘留存)"]
    GIT_HELPER["git credential.helper (内存钩子)"]
    AGENT_PROC["无头 AI 研发主进程"]
  end

  KEYCHAIN --> EXTRACT
  CFG --> EXTRACT
  EXTRACT -- "临时 stdin / --env" --> ENV_PIPE
  EXTRACT -- "内存流注入 (0600)" --> RAMDISK
  ENV_PIPE --> GIT_HELPER
  RAMDISK --> AGENT_PROC
```

1. **宿主机到容器无痕注入（内存管道传输）**：
   - 开发者在本地工位工作站执行 `asdlc run` 时，系统优先调用宿主机 OS 凭据库提取 `gh auth token` 或读取开发者配置的细粒度个人令牌（PAT，配置项 `git.token`）；
   - 凭据仅通过单向临时进程环境变量（`--env GH_TOKEN=...`）或写入 `/dev/shm` 内存临时文件（权限 `0600`、属主 `10001:10001`）注入容器；
   - 容器内全局 Git 预置内存级 Credential Helper：
     ```bash
     git config --global credential.helper '!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f'
     ```
   - 容器执行完毕退出即销毁（`--rm`），内存盘与环境变量即刻蒸发，**宿主机与容器磁盘零密钥残留**。
2. **CI/CD 执行身份：全面升级 GitHub App / Project Access Token / 细粒度 PAT（坚决保留全自动 Auto-PR 能力）**：
   - **废除在无人值守 CI 中使用个人交互式 gh token 的做法**：防止以个人超大权限 Token 运行导致 Blast Radius 扩大，并满足职责分离（SoD / SOX / 金融合规审计）要求。
   - **全自动 Auto-PR 能力坚决保留（First-Class Invariant）**：系统在架构上**100% 完整保留容器全自动推分支、开 PR、更新 PR 与回复 Review 线程的核心能力**，绝不降级为人工手动推拉。
   - **双轨服务账号支持（兼顾合规与 CI 触发）**：
     - **方案 A：GitHub App Installation Token（企业 GitHub 官方推荐）**：
       - 在 CI 中通过 App ID 与私钥动态签发，有效期 1 小时，权限严格限制在单仓（`contents: write`, `pull_requests: write`）；
       - **彻底解决 Actions 下游 CI 触发死锁问题**：GitHub Actions 原生默认的 `GITHUB_TOKEN` 出于防递归死循环设计，**其推送的提交和提的 PR 不会触发下游的 CI 工作流**（导致 Required Status Checks 一直挂起卡死）。而通过专用的 **GitHub App 身份（`asdlc-bot[bot]`）** 推送，能够**完美正常触发下游的测试流水线与分支保护门禁**，使自动化 Auto-PR 真正形成闭环！
     - **方案 B：细粒度 PAT / GitLab Project Access Token（项目级服务令牌）**：
       - 针对使用 GitLab 或未搭建 GitHub App 的企业，完全原生支持项目级 Token（PAT / Project Access Token）；
       - 在 CI 环境变量中直接注入 `ASDLC_GIT_TOKEN: ${{ secrets.ASDLC_PROJECT_TOKEN }}`，实现同样的仓库级最小权限隔离与全自动 Auto-PR。
   - **提交审计与归因**：流水线提交统一附加署名与触发者联合署名，兼顾自动化与合规追溯：
     ```git
     Author: asdlc-bot[bot] <asdlc-bot@users.noreply.github.com>
     Co-authored-by: 张三 <zhangsan@corp.company.com>
     ```
3. **企业内网与私有工单鉴权（Jira / Confluence / 私有 GitLab）**：
   - 在 `~/.asdlc/config.yaml` 中配置的第三方服务密钥（如 `env.JIRA_API_TOKEN`）遵循严格白名单机制，通过 `runner.env_passthrough` 按需定向透传至容器，禁止宽泛全量注入。
4. **企业级 SSH 鉴权与零泄漏沙箱注入方案**：
   - **SSH 是否需要配置密钥？**：是的。Git over SSH（`git@host:dept/repo.git`）采用非对称加密（Ed25519 或 RSA），强依赖能够与远端 Git 服务公钥配对的私钥（或正在运行的 SSH Agent）。没有私钥，Git 会立即报 `Permission denied (publickey)` 失败。
   - **容器内解决 SSH 密钥的四大安全禁区**：
     - ❌ **严禁将私钥打入镜像**：防止镜像发布或内网被拉取时泄露凭据；
     - ❌ **严禁直接挂载宿主 `~/.ssh:/home/agent/.ssh:rw`**：防止沙箱内恶意或故障脚本覆盖宿主机 `authorized_keys` 或篡改配置；
     - ❌ **严禁跨操作系统卷权限挂载**：Windows NTFS 挂载到 Linux 容器后权限常为 `0777`，OpenSSH 会强制拦截报错：`Permissions 0644 for id_rsa are too open`；
     - ❌ **严禁阻塞式交互提示**：首次连接未预埋公钥指纹时，SSH 会阻塞等待 `Are you sure you want to continue connecting (yes/no)?`，导致无头容器直接死锁挂起。
   - **三大权威落地工程方案**：
     - **方案 A：宿主机 SSH-Agent 转发（`SSH_AUTH_SOCK` 推荐用于工位开发）**：
       - 开发者本地通常已有 SSH Agent（Windows OpenSSH Authentication Agent、macOS Keychain 或 Linux `ssh-agent`）；
       - `asdlc run` 启动容器时，仅以只读方式挂载 Agent 的 Unix Domain Socket：
         ```bash
         # 原生 Linux / macOS:
         -v "$SSH_AUTH_SOCK":/run/host-services/ssh-auth.sock:ro -e SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock
         # Docker Desktop (Windows / macOS) 专属内建转发别名:
         -v //run/host-services/ssh-auth.sock:/run/host-services/ssh-auth.sock -e SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock
         ```
       - **沙箱内零私钥实体**：容器内部仅通过 Socket 向宿主发起签名协商请求，私钥明文从始至终不离开宿主机内存，容器退出销毁后无任何残留。
     - **方案 B：内存盘流式临时密钥注入（`/dev/shm/.ssh/` 适用于 CI / Deploy Key）**：
       - 面向无 SSH Agent 的自动化 CI 或专用部署密钥场景（配置 `asdlc config set git.ssh_key_path ~/.ssh/id_ci` 或注入环境变量 `ASDLC_SSH_KEY`）；
       - 宿主机在内存中读取密钥，流式写入容器 Linux 内存盘（`/dev/shm/.ssh/id_ed25519`），严格设为属主 `10001:10001`、权限 `0600`；
       - 自动生成容器内 `~/.ssh/config`（绑定 `IdentityFile /dev/shm/.ssh/id_ed25519` 与 `IdentitiesOnly yes`）；容器停止（`--rm`）后内存自动抹除。
     - **方案 C：指纹无感预埋（Known-Hosts Headless Pre-Seeding，根绝死锁）**：
       - 容器启动前，宿主编排器自动根据目标 Host 提取公钥指纹（从宿主 `~/.ssh/known_hosts` 提取或在内存执行 `ssh-keyscan`），直接写入容器 `/etc/ssh/ssh_known_hosts`，并附加 `StrictHostKeyChecking accept-new`，实现 100% 零人工确认、零死锁卡死。
   - **PE 架构建议（HTTPS Token vs. SSH Key）**：
     - 在现代云原生与容器 CI/CD 流水线中，**HTTPS + Token（`x-access-token` / `$GH_TOKEN` / `$GITLAB_TOKEN`）通常比 SSH 更加稳健**：
       1. 权限最小化与短期有效（如 GitHub Actions 临时 Token 1 小时自动失效，且限制单仓权限，而 SSH Key 往往具有全账号或长期全局权限）；
       2. 企业网络穿透性好（内网通常走 `HTTP_PROXY` 穿透 443 端口，而很多企业防火墙策略严格封锁外发 22 端口 SSH）。
     - 两种协议在 `asdlc` 中均得到 100% 工业级支持，企业可按安全合规要求自由选择。

### 3.4 企业级模型传入与异构审查拓扑（Player != Referee）
编排器在支持接入商业与企业内网私有各类大模型的同时，在架构层面固化治理防御机制：
1. **动态模型传入（命令行绝对优先覆盖）**：
   - 主体编码/实现模型可通过 `agent.model` 全局预设，亦可通过 `--model <provider/model>` 在运行时动态指定：
     ```bash
     asdlc run feat-auth --stage apply --model anthropic/claude-3-7-sonnet
     ```
2. **异构独立审查拓扑（`Player != Referee` 裁判会话解耦）**：
   - 为避免同一模型在审查自身编写的代码时产生“认知盲区”或“自欺欺人的橡胶图章（Rubber-stamping）”，规范审查（阶段 4）与代码审查（阶段 7）强制派生独立审查子进程，并支持指定物理隔离的异构审查模型（`--review-model`）：
     ```bash
     asdlc run feat-auth --stage verify --review-model openai/gpt-4o
     ```
3. **企业私有 AI 网关无缝透传**：
   - 面向金融、政企私有化部署环境（如火山方舟网关、LiteLLM、Cloudflare AI Gateway、Azure APIM），支持配置内网 Base URL 与审计认证 Header：
     ```bash
     asdlc config set agent.base_url "https://ai-gateway.corp.company.com/v1"
     asdlc config set agent.custom_headers '{"X-Corp-Dept": "Security", "X-Audit-TRN": "trn:audit:sdlc"}'
     ```

### 3.5 多层环境变量优先级链与全局敏感信息脱敏引擎
所有配置项与环境变量遵循严格确定性的 5 层决策链：
```text
第 1 层：命令行运行时参数 (--model, --repo, --stage, --env KEY=VAL) [最高优先级]
   ↓
第 2 层：宿主机进程环境变量 (process.env.ASDLC_*, ANTHROPIC_API_KEY, GH_TOKEN)
   ↓
第 3 层：项目仓级策略文件 (.openspec/policy.yaml 或 .sdlc/policy.yaml)
   ↓
第 4 层：机器全局配置文件 (~/.asdlc/config.yaml, mode 0600)
   ↓
第 5 层：系统出厂内置默认值 [最低优先级]
```
- **全局动态敏感信息脱敏引擎**：
  - 系统所有终端输出、日志与 `asdlc config list` 统一挂载敏感词脱敏拦截器（正则命中 `/(token|key|secret|password|credential|pat|auth)/i`）；
  - 敏感值自动打码显示：`ghp_1234567890abcdef...` $\to$ `ghp_************cdef`；
  - **防泄密环境拦截不变量（Anti-Dumping Invariant）**：即使有未受信任的脚本或 Agent 试图在容器终端内执行 `env`、`printenv` 或发生异常报错转储，宿主机输出流管道均会实时拦截并清洗敏感字串，彻底阻断泄密路径。

### 3.6 零摩擦 GitHub 仓库与执行上下文全自动识别引擎
编排器通过四级解析级联，让开发者和 CI 在任何场景下均能以最符合直觉的方式自动绑定目标代码仓：
1. **第 1 级：完整 PR / Issue 链接直接解析**：
   `asdlc run https://github.com/owner/repo/pull/42 --stage fix`
   - 正则自动解构提取 `host: github.com`、`owner: owner`、`repo: repo`、`number: 42`，无需用户在本地预先存在任何 Git 仓。
2. **第 2 级：PR 编号结合本地 Git Remote 自动解析**：
   `asdlc run #42 --stage fix`
   - 当在本地工作区执行时，自动读取本地 `git remote -v`：
     - 支持标准 SSH 协议：`git@github.com:owner/repo.git` $\to$ `owner/repo`；
     - 支持标准 HTTPS 协议：`https://github.com/owner/repo.git` $\to$ `owner/repo`；
     - 支持企业私有域名：`https://github.corp.company.com/team/repo.git`。
3. **第 3 级：CI/CD 运行时上下文无感自动绑定**：
   - 在 GitHub Actions 环境下，自动读取环境变量 `$GITHUB_REPOSITORY`（`owner/repo`）与 `$GITHUB_SERVER_URL`；
   - 在 GitLab CI 环境下，自动读取环境变量 `$CI_PROJECT_PATH` 与 `$CI_SERVER_URL`。
4. **第 4 级：免 Clone 零检出远程执行（`--repo`）**：
   `asdlc run #42 --repo owner/repo --stage fix`
   - 当在空目录或跳板机执行时，容器沙箱自动执行基于内存盘的轻量 Shallow Clone，宿主机零磁盘占用、零残留代码。
5. **第 5 级：Greenfield 全新目录判定与强约束远端契约**：
   - 当在非 Git 目录或未配置 remote origin 的目录执行容器流水线时：
     - **强约束远端参数要求**：容器模式下必须显式提供 `--create-repo <owner/repo>`（在云端一键新建 GitHub 仓库并推送初始提交）或 `--repo <owner/repo>`（关联已有远端仓库）。
     - **为何坚决禁止宿主机盲写回（Blind Host Write-Back）**：
       1. *无锚定标识与目录污染*：在临时目录或空目录下，项目没有权威的仓库名称与 Remote 命名空间，盲目回写会制造未受管的孤立目录；
       2. *跨操作系统权限雪崩*：容器内部为 `10001:10001` 用户，盲目 `docker cp` 会将 Linux 权限写入 Windows NTFS 或 macOS 宿主，引发 Git 权限锁死；
       3. *端到端 PR 闭环阻断*：`asdlc run` 核心使命是全自动 PR、CI 验证与评论 Grill。没有远端 Git 仓，流程在第一阶段结束后便无法开 PR、无法触发 CI，流水线陷入死胡同；
       4. *回写失败无容灾*：若宿主磁盘满或文件被 IDE 占用导致 `docker cp` 失败，临时容器销毁将导致成果彻底丢失。
     - **标准阻断错误规范（`ASDLC_ERR_NO_REPOSITORY`）**：
       - **Fail Fast 拦截**：退出码返回 `1`，在启动容器消耗算力或 Token 前立即中止；
       - **控制台诊断卡片**：输出高可读性 ANSI 错误卡片，明确列出 3 条直接可复制执行的解决方案：
         ```text
         ┌──────────────────────────────────────────────────────────────────────────────┐
         │  [ERROR] ASDLC_ERR_NO_REPOSITORY: 未指定目标 GitHub 代码仓                   │
         ├──────────────────────────────────────────────────────────────────────────────┤
         │  问题根因:                                                                   │
         │  - 当前工作目录不是 Git 仓库，或尚未配置 remote origin。                     │
         │  - 容器沙箱自动化运行必须有明确的归宿代码仓。                                 │
         │                                                                              │
         │  解决方案 (任选其一直接复制执行):                                            │
         │  1. 自动新建远端 GitHub 仓库并执行端到端流水线:                              │
         │     $ asdlc run "Build refund API" --create-repo <org/repo-name> --container │
         │                                                                              │
         │  2. 指定已有远端 GitHub 代码仓 (免 Clone 零检出模式):                        │
         │     $ asdlc run "Build refund API" --repo <org/repo-name> --container        │
         │                                                                              │
         │  3. 若仅进行本地非容器化开发，请先在宿主执行本地初始化:                      │
         │     $ git init && asdlc init                                                 │
         └──────────────────────────────────────────────────────────────────────────────┘
         ```
       - **CI/CD 原生注解**：在 GitHub Actions 环境下自动输出工作流指令：
         `::error title=ASDLC_ERR_NO_REPOSITORY::无法解析目标 GitHub 代码仓。请传入 --repo 或 --create-repo。`
       - **机器可读 JSON**：支持 `--json` 输出结构化错误诊断 `{ "code": "ASDLC_ERR_NO_REPOSITORY", "verdict": "FAIL", "message": "...", "remedies": [...] }`。

### 3.6.1 完整 Canonical URL 与相对简写对比，以及企业内网“零猜测”防泄密策略

在企业内网与私有云环境下，代码仓目标的解析是容器自动化流水线最容易发生歧义与安全事故的环节：**究竟必须传完整 URL，还是可以传部分简写（Shorthand）？在外网或许可以默认猜测 `github.com`，但在企业私网内盲目猜测不仅完全行不通，更是严重的安全红线！**

#### 1. 真实企业内网的核心痛点分析
* **多宿主与多代码平台并存**：企业内网普遍同时运行多种 Git 平台：自建 GitHub Enterprise Server（GHES，如 `https://github.corp.company.com`）、自建私有 GitLab（如 `https://gitlab.internal.corp`）、Bitbucket Server、Gitea、或云厂商专有云托管（阿里云 Codeup、腾讯云 CNB）。
* **深层嵌套命名空间（Multi-Level Subgroups）**：不同于公网 GitHub 固定只有两层的 `owner/repo`，企业 GitLab 或自建系统往往采用 3–5 级群组：`fintech/core-banking/settlement/refund-service`。若只写简写 `refund-service` 甚至 `settlement/refund-service`，在全局数以万计的项目中根本无法唯一锁定！
* **防越界与防数据外泄铁律（Anti-Data-Exfiltration Invariant）**：如果一个内网开发者输入了 `--repo fintech/refund`，**系统坚决杜绝私自回退猜测 `github.com`！** 带着企业内部的项目命名与潜在凭证向公网 GitHub 发起探测，将直接触发企业合规风控红线与内网数据泄漏事件。

#### 2. 双格式支持矩阵与确定性解析规则

`asdlc run` 确立了严格的三级解析规范，做到“零猜测、防越界、高体验”：

| 格式分类 | 命令语法示例 | 确定性解析逻辑 | 推荐使用场景 |
| :--- | :--- | :--- | :--- |
| **A. 完整 Canonical URL** *(最高优先级，绝对零歧义)* | `https://gitlab.corp.company.com/fintech/settlement/refund.git`<br>`git@github.corp.company.com:infra/runner.git` | **100% 绝对精确。** 协议、域名、端口、多级 Namespace 与 Repo Slug 完全由 URL 自包含决定。完全绕过所有配置兜底与任何猜测。 | 企业 CI/CD 流水线、生产自动化脚本、以及跨多级群组的 GitLab 项目。 |
| **B. 企业全局绑定简写** *(基于配置的确定性展开，绝不外泄)* | `--repo fintech/refund`<br>`--create-repo fintech/refund` | **显式映射展开。** 优先读取 `~/.asdlc/config.yaml` 中由管理员或开发者预先配置的 `git.default_host` 与 `git.protocol`，确定性展开为内网地址。未配置绝不盲目请求公网。 | 开发者日常在企业内网工位电脑上的高效终端交互。 |
| **C. 本地上下文简写** | `asdlc run #42 --container` 或本地分支运行 | 直接从本地既有 `git remote get-url origin` 或当前 CI 环境变量（`$GITHUB_SERVER_URL` / `$CI_SERVER_URL`）继承宿主及群组上下文。 | 开发者在已有 Git 仓库目录下的日常迭代开发。 |

#### 3. 内网歧义阻断与 Fail-Fast 报错规范 (`ASDLC_ERR_AMBIGUOUS_HOST`)
若开发者传入了简写（如 `--repo dept/project` 或 `--create-repo dept/project`），但：
1. 字符串中未包含协议（`http://`、`https://`、`git@`）或域名；
2. 宿主机全局未配置 `git.default_host`；
3. 当前工作目录不是已有 Git 代码仓，且无 CI 环境变量注入；
4. 系统检测到当前处于内网环境（命中企业内网代理、私有 CA 根证书、或内网专用网段）：

**编排器在启动 Docker 容器或消耗 Token 前立即 Fail-Fast 阻断，返回退出码 `1`，绝不盲目探测公网！**
* **控制台诊断卡片**：
  ```text
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  [ERROR] ASDLC_ERR_AMBIGUOUS_HOST: 无法确定内网 Git 代码仓的主机与命名空间   │
  ├──────────────────────────────────────────────────────────────────────────────┤
  │  输入参数: "dept/project"                                                    │
  │  在企业/内网环境下，系统坚决杜绝向公网 github.com 盲目猜测回退，以防内网数据 │
  │  与代码元数据发生外泄风险。                                                 │
  │                                                                              │
  │  解决方案 (任选其一):                                                        │
  │  1. 传入完整 Canonical URL (推荐用于 CI 自动化与深层命名空间):               │
  │     $ asdlc run --repo https://gitlab.corp.com/dept/project.git --container  │
  │                                                                              │
  │  2. 一次性配置企业内网默认 Host:                                             │
  │     $ asdlc config set git.default_host gitlab.corp.company.com              │
  │     $ asdlc config set git.protocol https                                    │
  │     配置后即可直接使用简写: $ asdlc run --repo dept/project --container      │
  └──────────────────────────────────────────────────────────────────────────────┘
  ```

---

## 4. 多源需求输入（Intake）与两层 Skill 取单架构

1. **多文件与多单据快照**：`asdlc new` 与 `asdlc run` 均支持可重复的 `--from-file <path>`（支持宿主机仓外路径，`docker cp` 拷入容器）与 `--from-issue <ref>`，统一归档至 `openspec/changes/<id>/intake/` 并生成带 SHA-256 校验的 `intake/index.yaml`。
2. **两层 Skill 取单（核心零第三方 SDK 耦合）**：
   - **第一优先级（企业自定义 `~/.asdlc/skills/`）**：配合 `env.*` 与 `runner.env_passthrough` 注入内网凭证，容器启动时自动拷入并覆盖同名内置 Skill，灵活适配企业私有 Jira 字段与内网鉴权。
   - **第二优先级（内置 `asdlc-intake` 标准 Skill 兜底）**：自带标准取单指引，支持 GitHub Issues/Projects、Jira (Cloud/DC)、以及关联 Confluence 页面顺藤摸瓜读取，所有外部文本强制包裹不可信数据围栏防范 Prompt Injection。

---

## 5. 官方 `ubuntu:26.04` LTS 全栈镜像与非 Root 安全基线

1. **双层镜像与版本强绑定**：
   - **底层 `asdlc-base:2026.xx`**：基于最新 **`ubuntu:26.04` LTS**（`linux/amd64` + `linux/arm64`），预装 Node 22、Python 3.12 + `uv`（含预编译 `tree-sitter`）、JDK 21 (`maven`/`gradle`)、Go、Rust、C/C++ 编译链及 `git`/`gh`/`glab`/`ripgrep`/`jq`。
   - **上层 `asdlc-runner:<pkg.version>`**：预装同版本 `asdlc`、`openspec`、`graphifyy`、全局 `.agents/skills` 以及 **`opencode`（默认）** 和 **`claude`**。在 `.github/workflows/release.yml` 中随 npm 发版同步构建推送，默认精确锁定 `${pkg.version}` 标签（不用裸 `:latest`），`asdlc upgrade` 自动联动拉取。
2. **内部硬编码安全基线与企业级环境穿透（不暴露降级开关）**：
   - 固定非特权用户 `agent`（`UID 10001:10001`，无 `sudo`），内部默认附加 `--user 10001:10001`、`--cap-drop=ALL`、`--security-opt=no-new-privileges:true`、`--pids-limit=512`、`--rm`。
   - **Git 容器跨用户安全检测免疫（CVE-2022-24765）**：镜像全局 `/etc/gitconfig` 硬编码 `[safe] directory = /workspace`，并注入 `GIT_CONFIG_KEY_0=safe.directory`，根绝因宿主与容器 UID 不一致导致的 `fatal: detected dubious ownership` 拦截。
   - **企业级代理与私有 CA 证书链穿透**：宿主机自动透传 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 与宿主自定义根证书（`SSL_CERT_FILE`、`NODE_EXTRA_CA_CERTS`），将证书流式注入容器 `/etc/ssl/certs/corporate-ca.crt`，解决大企业内网 SSL 劫持代理导致的证书校验中断。
   - **零宿主卷挂载（3 层高保真流式注入）**：
     - 不在容器内执行私有 `git clone`（避免私网凭证/VPN 泄入沙箱）；
     - 不 `-v` 挂载宿主机目录（杜绝容器脚本破坏宿主机、规避 Windows NTFS 卷性能雪崩与 CRLF 换行冲突）；
     - **第 1 层（提交基线）**：宿主机提取当前分支快照 (`git archive HEAD | docker cp`) 灌入容器 `/workspace` 并赋权 `10001:10001`；
     - **第 2 层（脏工作区增量）**：若宿主机存在暂存区或未暂存改动，自动采集 `git diff -p HEAD` 在容器内执行 `git apply`，100% 还原开发者当前屏幕现场；
     - **第 3 层（未跟踪文件）**：采集 `git ls-files --others --exclude-standard` 仅注入新建代码，严格尊重 `.gitignore`；
     - 容器推送依靠内存注入的短期 Token（`gh auth token` / `GH_TOKEN`）。
   - **实现阶段内核级只读锁死 Spec**：将容器内 `proposal.md` 与 `specs/**` 置为 `0:0`（`0444` 只读），从 Linux 内核层物理封锁篡改。
3. **三种项目生命周期适配矩阵（Greenfield、Brownfield 与成熟项目）与双向同步闭环**：
   - 工业级容器执行器不能假定所有项目均已规范初始化。`asdlc run --container` 在宿主机侧动态检测项目状态并执行对应的流式注入与结果物化：
     - **场景一：Greenfield 全新项目（无 Git 仓库、零代码自举与宿主反向物化）**：
       - *宿主机检测*：`git rev-parse --is-inside-work-tree` 失败（空目录或仅有 loose PRD/说明文档）。
       - *强契约门禁拦截*：**必须显式提供 `--create-repo <owner/repo>` 或 `--repo <owner/repo>`**。若均未提供，宿主编排器立即以 `ASDLC_ERR_NO_REPOSITORY` 阻断退出，绝不盲目启动容器，杜绝孤儿工程与回写失败（参见 §3.6 第 5 级）。
       - *注入机制*：宿主机将当前目录非忽略文件（过滤 `.DS_Store`、`node_modules` 等）通过 `tar | docker cp` 灌入容器 `/workspace`，传递环境变量 `ASDLC_LIFECYCLE=greenfield`。
       - *容器内自举*：容器内执行 `git init -b main` 并配置本地签名（`asdlc-agent <agent@asdlc.internal>`）；自动执行无头 `asdlc init --headless` 初始化 OpenSpec 规范结构；通过 `gh repo create <owner/repo> --private --source=. --push` 在 GitHub 创建远端仓库并推送主干；提交初始治理基线提交 `commit 0: Initial repository scaffolding via asdlc`。
       - *脚手架与变更落地*：基于输入的 PRD/Prompt 自动初始化对应语言的项目骨架（如 `package.json`、`go.mod`、`pom.xml`），推进 Spec 与 TDD 实现。
       - *双向同步与结果物化*：容器向刚创建的远端仓库推送 Feature 分支并开 PR；在容器销毁（`--rm`）前，宿主机 CLI 自动执行 `docker cp <container_id>:/workspace/. <host_dir>/`，将初始化完毕的 Git 仓库、项目工程骨架与治理文件完整物化回宿主机，开发者立即获得完整绑定远端、可直接运行的本地工程。
     - **场景二：Brownfield 既有老项目（已有 Git 历史、首次接入 asdlc 的无感知自初始化）**：
       - *宿主机检测*：`git rev-parse --is-inside-work-tree` 成功（存在 `.git`），但根目录下无 `openspec/` 目录。
       - *注入机制*：宿主机按 3 层结构打包灌入容器，传递 `ASDLC_LIFECYCLE=brownfield`。
       - *容器内零感知自初始化（Zero-Touch Auto-Onboarding）*：容器编排器绝不报拦截性错误（杜绝“请先在本地运行 asdlc init”），而是自动执行无头 `asdlc init --onboard`：
         1. 自动检测代码库构建工具（Maven/Gradle/npm/Go/Cargo/Pytest）与测试命令；
         2. **确定性 AST 知识图谱 vs 文本向量 RAG**：传统 RAG 将老代码切块会丢失类型继承、接口实现与多跳调用链，在依赖注入繁重的老项目中极易幻觉。`asdlc-runner` 调用预装 Tree-sitter 全量编译 AST 生成 `graphify-out/` 与 `explore.md`，精准掌握全局符号与边界；
         3. **变更级影响范围收敛（Blast Radius）**：Agent 绝不尝试全盘重构老系统，而是借助代码图谱仅圈定当前需求触达的上下游受影响模块，大幅节省 Token 并保障准确性；
         4. 自动生成适配该代码库技术栈的专用 `AGENTS.md`，装配 `.agents/skills` 与 OpenSpec 规范结构；
         5. 将初始化产物独立提交在 `asdlc/onboarding-baseline` 分支上，使工具链接入历史与业务代码变更清晰解耦。
       - *无缝衔接业务变更*：切出 `change/<slug>` 分支，基于刚生成的精准代码图谱推导变更设计与 Spec，完成代码实现。
       - *结果回流*：容器向远端推送 Baseline 与 Feature 分支并提 PR；同时将 `openspec/` 与 `.agents/` 同步回宿主机。
     - **场景三：成熟项目（已接入 asdlc、脏工作区高保真同步与 `git bundle` 零污染拉回）**：
       - *宿主机检测*：Git 仓库与 `openspec/` 均存在。
       - *脏工作区高保真注入*：开发人员常在本地存有未提交改动（WIP / Staged）时拉起容器任务。宿主机采集 `git archive HEAD`（已提交基线）与 `git diff HEAD`（本地工作区实时增量 patch），在容器内精确还原宿主机当前的真实编辑现场。
       - *增量图谱刷新*：容器跳过全量扫描，仅对近期变动文件做增量 AST 刷新，秒级进入需求状态机。
       - *安全回流（PR 或 `git bundle` 零污染拉回）*：联网时容器直接推送远端 PR；离线或本地模式下，若使用传统 `docker cp` 会覆盖宿主机正在编辑的文件或引发 IDE 锁冲突，因此容器将新生成的 Commit 打包为自包含的 `git bundle` 存入临时卷，宿主机执行 `git fetch <bundle> <branch>:<branch>` 仅更新宿主 Git 对象库，绝不粗暴覆盖宿主机当前工作区，杜绝文件冲突与丢失。

---

## 6. 状态驱动编排器 (`asdlc run`) 与 Draft PR 异步 Grill 闭环

### 6.1 双执行模式：本地就地执行与免 Clone 零检出执行 (`--repo`)
强制要求开发者必须先在本地 `git clone` 代码仓、再 `cd` 到项目根目录执行命令，在自动化运维与多项目管理中属于反模式。`asdlc run` 原生支持双执行形态：

1. **就地执行模式（Contextual Local Mode，默认）**：
   ```bash
   # 在本地代码仓目录中直接执行
   asdlc run "Add payment refund webhook" --from-file ./prd.md --container
   ```
   - 自动采集宿主当前工作区现场（3 层高保真流式注入）；
   - 执行完毕后按需回流至本地 Git 对象库或远端。

2. **免 Clone 零检出执行模式（Zero-Checkout Remote Mode，从任意目录发起）**：
   ```bash
   # 在家目录、空终端、或自动化运维跳板机上直接指定远端仓库：
   asdlc run --repo akjamie/agentic-sdlc "Add payment refund webhook" --container
   # 或指定完整 Git 链接并关联工单：
   asdlc run --repo https://github.com/my-org/core-api.git --from-issue JIRA-345 --container
   ```
   - 宿主机**完全不需要在本地检出或占用磁盘 Clone 该项目**；
   - 宿主机 CLI 拉起 `asdlc-runner` 容器，直接透传短期认证 Token（`gh auth token` / `GH_TOKEN`）；
   - 容器沙箱内部直接在 Linux 内存盘/workspace 中克隆、切分支、执行全套 SDLC 流水线并自动向 GitHub/GitLab 提 PR；
   - 宿主机零代码残留、零磁盘污染，在 CI/CD 流水线与开发者多项目调度场景极具生产力。

### 6.2 人性化变更定位与零摩擦续跑机制（智能推导、交互选择器、PR # / URL / Issue 解析）
要求用户在多次执行中记忆并手敲合成的内部 Change ID（如 `rate-limiting-security-token-encryption`）会导致极大的操作心智负担。`asdlc run` 建立了一套以开发者习惯为中心的多级智能定位体系：

1. **直传 PR 编号或完整 URL（最贴合人类习惯）**：
   ```bash
   asdlc run #34 --container
   # 或直接从浏览器粘贴 PR 完整地址：
   asdlc run https://github.com/akjamie/agentic-sdlc/pull/34 --container
   ```
   - 编排器通过 GitHub/GitLab API 直接读取 PR 标签元数据（`asdlc:change-id: <slug>`）或关联分支，自动定位到精确的变更上下文。
2. **直传关联工单号（Issue-Driven Resume）**：
   ```bash
   asdlc run --from-issue JIRA-345 --container
   ```
   - 编排器自动比对 `openspec/changes/*/intake/index.yaml` 中绑定的 Issue 索引，命中后直接续跑已有变更。
3. **零参数智能分支推导（Smart Active-Branch Auto-Detection）**：
   - 在项目目录中直接运行 `asdlc run`：
     - 若当前 Git 分支本身就是 `change/<slug>`，直接续跑当前变更；
     - 若当前在 `main` 且本地只有一个活跃中的未归档变更，自动直接续跑。
4. **终端交互式选择器（Terminal Interactive Selector，存在歧义时）**：
   - 当仓库存在多个正在进行中的变更时，`asdlc run` 自动唤起终端交互菜单：
     ```text
     ? 检测到 2 个正在推进中的变更，请选择需要续跑的项或新建变更:
     ❯ [1] payment-refund     (Draft Spec PR #34: 存在 2 个阻塞问题等待人工回复)
       [2] token-encryption   (Spec PR #31 已合入: 等待推进 TDD 代码实现)
       [3] + 发起全新变更
     ```
5. **挂起时输出明确的无脑回车指令**：每当容器由于等待人工反馈挂起退出时，终端明确打印下一阶段的可粘贴命令：
   ```text
   ⏸️ 已安全挂起: Draft Spec PR #34 正等待人工确认核心设计。
   👉 请直接在 GitHub PR 评论区回复问题。
   👉 回复完成后，随时通过以下命令一键恢复流水线:
        asdlc run #34 --container
   ```

### 6.3 “3+1” 权威阶段执行体系与确定性阶段推导引擎
秉承 UNIX 实用主义哲学——*“显式优于隐式，透明优于魔法”*——容器流水线将**显式阶段标志（Explicit Stage Flag）作为第一公民**；同时提供一套确定性、单向单步推进的**流水线驱动器（Pipeline Driver）**，在用户缺省 `--stage` 时提供极简的自动前推便利。

#### 6.3.1 “3+1” 核心阶段手柄 (`--stage spec | apply | verify | fix`)
整个全生命周期收敛为 **3 个前向生产阶段** 与 **1 个响应协作阶段**（统一为精炼、齐整的单动词体系）：

| Stage 参数 | 阶段属性 | 适用输入 | 核心动作 | 质量门禁 | 兼容别名 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--stage spec` | 前向生产 | 变更 ID、需求文件、Issue | 基于 AST 图谱草拟提案与 Spec $\to$ 跑通 BDD Lint $\to$ 初审 $\to$ 发起 Spec PR | `asdlc lint` PASS | `--stage spec-review` |
| `--stage apply` | 前向生产 | 主干已合入 Spec 的变更 ID | 启用 Spec `0444` 内核只读锁 $\to$ 执行任务级 TDD 红绿重构循环 | 单元测试全 PASS | 无 |
| `--stage verify` | 前向生产 | 代码已完成的变更 ID | 派生独立进程跑 Impl Review $\to$ 跑通 `asdlc verify`（14 项物理门禁） $\to$ 提单/更新 Impl PR | `asdlc verify` PASS | `--stage impl-review` |
| `--stage fix` | 响应协作 | PR 编号（`#N`）或 PR URL | 调用 3-Tier 甄别引擎：拉取未解决评论 $\to$ 语义分类 $\to$ 修复/答疑/提交 $\to$ 标记 Resolve | 重跑 lint 或 verify | `--stage fix-comments` |

##### 1. 显式阶段执行（确定性、无歧义、指哪打哪）
当使用显式 `--stage` 启动时，容器直奔目标，零黑盒猜测：
```bash
# 1. 明确草拟并审查 Spec
asdlc run feat-auth --stage spec

# 2. 明确执行 TDD 编码实现
asdlc run feat-auth --stage apply

# 3. 明确审查实现质量并跑通全套门禁
asdlc run feat-auth --stage verify

# 4. 明确消化并回复 PR #42 上的评审意见（支持 Spec PR 与 Impl PR）
asdlc run #42 --stage fix
```

##### 2. 企业 CI/CD 自动化集成（GitHub Actions / GitLab CI）
在生产流水线中，Webhook 事件自身已携带明确动作。`--stage fix` 使得自动化配置极其纯粹，一行搞定：
```yaml
name: Agentic Review Auto-Fix
on:
  pull_request_review_comment:
    types: [created]
  pull_request_review:
    types: [submitted]

jobs:
  address-review:
    runs-on: ubuntu-latest
    steps:
      - name: Address Review Feedback
        run: asdlc run ${{ github.event.pull_request.number }} --stage fix
```

##### 3. 本地非容器原子命令对齐（双轨对称性）
为了确保本地开发者体验 100% 对齐，Review 意见修复在本地非容器模式下作为一等原子子命令提供：
```bash
# 本地终端/IDE 交互式执行：
asdlc fix #42
# 容器沙箱全自动执行：
asdlc run #42 --stage fix
```

#### 6.3.2 四维客观不变量状态向量（无 `--stage` 时的后备流水线驱动器）
当开发者或脚本在未提供 `--stage` 的情况下调用 `asdlc run [target]` 时，编排器退化为透明的单步**流水线驱动器（Pipeline Driver，类似 `make` 检查 Target 依赖）**。
它毫秒级计算状态向量 $\mathbf{S} = \langle \text{Artifacts}, \text{GitLocks}, \text{TreeDiff}, \text{PRMetadata} \rangle$，在终端首行清晰打印当前推进动作，向前推进一步：
```text
[INFO] No --stage specified. Auto-selected stage: 'fix' for PR #42.
[TIP]  You can run this stage explicitly: asdlc run #42 --stage fix
```

编排器在启动时计算状态向量 $\mathbf{S} = \langle \text{Artifacts}, \text{GitLocks}, \text{TreeDiff}, \text{PRMetadata} \rangle$：
1. **规范制品不变量（Artifact Invariants，取自 `openspec/changes/<id>/`）**：
   - $P_{\text{spec}} \in \{0, 1\}$：`proposal.md` 与 `specs/**/*.md` 是否已落盘；
   - $N_{\text{open}} \in \mathbb{N}$：`clarifications.md` 中尚未解决的 `[OPEN]` 问题数量；
   - $N_{\text{tasks}} \in \mathbb{N}, U_{\text{tasks}} \in \mathbb{N}$：`tasks.md` 中任务总数与**未勾选任务数（`- [ ]`）**；
   - $R_{\text{stage}}, R_{\text{verdict}}$：`review.md` 中记录的最新审查阶段（`spec` 还是 `impl`）与审查结论。
2. **Git 主干治理锁（Git Locks & `specSha`）**：
   - $L_{\text{target}} \in \{0, 1\}$：规范是否已在目标受保护主干（`main`）合入锁定。
     推导函数：`approvedSha = lastCommitTouching(repoRoot, targetBranch, ['proposal.md', 'specs/'])`。
     - 在 `spec-first` 模式下：**当且仅当 Spec PR 已合入 `main` 时**，$L_{\text{target}} = 1$；
     - 在 `auto` 模式（L0/L1 Single-PR 特权）：$L_{\text{target}} \equiv 1$。
3. **工作区与代码改动树（Tree Diff）**：
   - $S_{\text{code}} \in \mathbb{N}$：当前变更相对于目标分支的非规范源码改动文件数（`git diff targetBranch...HEAD` 中排除 `openspec/changes/<id>/` 后的文件数）。
4. **远端 PR 元数据（PR Status via API）**：
   - $\text{PR}_{\text{label}} \in \{\text{needs-clarification}, \text{spec-review}, \text{impl-review}, \text{none}\}$；
   - $\text{PR}_{\text{state}} \in \{\text{DRAFT}, \text{OPEN}, \text{MERGED}, \text{CLOSED}, \text{none}\}$；
   - $C_{\text{replied}} \in \{0, 1\}$：Draft PR 评论区中是否有人类工程师的答复；
   - $H_{\text{feedback}} \in \{0, 1\}$：开启态的 Spec/Impl PR 上是否存在人类审查者提出的**未修改评论或 Changes Requested**。
     形式化计算式：
     $$H_{\text{feedback}} = 1 \iff \left(\text{reviewDecision} == \text{'CHANGES_REQUESTED'} \lor N_{\text{unresolvedActionableThreads}} > 0 \lor T_{\text{lastHumanComment}} > T_{\text{lastCommit}}\right)$$

#### 6.3.3 核心阶段精准仲裁矩阵：互斥不变量对比
Spec Review、Apply 与 Impl Review 处于严格的物理互斥区间，不存在任何模棱两可的灰色地带：

| 评估维度 | 阶段 A: Spec Review (`spec-review`) | 阶段 B: Apply (TDD 代码实现) | 阶段 C: Impl Review (`impl-review`) |
| :--- | :--- | :--- | :--- |
| **主干规范锁定 ($L_{\text{target}}$)** | **$L_{\text{target}} = 0$**（Spec PR 尚未在目标主干合入，不可执行代码编写） | **$L_{\text{target}} = 1$**（Spec PR 已合入目标主干，生成只读 `specSha` 快照） | **$L_{\text{target}} = 1$**（规范已处于锁定状态） |
| **未完成任务数 ($U_{\text{tasks}}$)** | `tasks.md` 尚未生成或尚未进入实现 | **$U_{\text{tasks}} > 0$**（存在未完成任务项：`- [ ] Task K`） | **$U_{\text{tasks}} = 0$**（任务全部 100% 勾选完成：`- [x]`） |
| **源码改动数 ($S_{\text{code}}$)** | $S_{\text{code}} = 0$（严禁包含业务源码改动，纯文档规范） | $S_{\text{code}} \ge 0$（正在编写业务实现代码与单元测试） | **$S_{\text{code}} > 0$**（业务代码与测试文件均已实现完毕） |
| **审查标的物** | `proposal.md`、`specs/**`、BDD 场景与可测试验收准则 | 无（当前处于编码与测试执行态） | 源码 Diff 对比锁定的 `specSha`、测试保真度与代码质量 |
| **内核只读锁状态** | 规范处于作者编辑态（可写） | **`proposal.md` 与 `specs/**` 被系统置为 `0:0 0444` 只读** | 规范只读锁定；源码处于交付待审态 |
| **人类 PR 评审修改闭环** | 若 $H_{\text{feedback}} = 1$：修改规范 $\to$ 重跑 lint $\to$ 推送修复 Commit | 无（内部闭环 TDD 执行） | 若 $H_{\text{feedback}} = 1$：修改代码与用例 $\to$ 重跑 verify $\to$ 推送修复 Commit |
| **跃迁出口门禁** | `asdlc lint` PASS $\land\ H_{\text{feedback}} = 0 \to$ 转 Ready PR $\to$ 人工合入 | 任务全部勾选清零 $\to$ 立即自动跃迁至 Impl Review | `asdlc verify` PASS $\land\ H_{\text{feedback}} = 0 \to$ 准备终态合入 |

- **为什么不会把 Spec Review 误判为 Impl Review？**
  因为 Spec Review 发生时，$L_{\text{target}} = 0$（主干尚未锁定该规范），且 $S_{\text{code}} = 0$（无任何业务代码）。Impl Review 发生的前提必须是主干已锁定规范（$L_{\text{target}} = 1$）且业务代码已实现（$S_{\text{code}} > 0$ 且 $U_{\text{tasks}} = 0$）。
- **为什么在 Spec PR 合入前绝不会偷跑 Apply？**
  `spec-first` 模式强制依赖 $L_{\text{target}} = 1$ 作为执行防火墙。在主干未探测到 `approvedSha` 之前，任何试图生成代码的请求都会被物理阻断，并提示进入 `AWAITING_SPEC_MERGE` 状态等待 Tech Lead 合入。
- **为什么 Apply 编码完成会自动切入 Impl Review？**
  任务未勾选数 $U_{\text{tasks}}$ 构成精准计数器。只要 $U_{\text{tasks}} > 0$，流水线就保持在 Apply 的 TDD 红绿循环中；一旦 $U_{\text{tasks}} = 0$，编排器立刻判定实现结束，物理封板并派生全新审查进程启动 Impl Review。

##### 6.3.3.1 PR 驱动的分发链路（当传入 `asdlc run #N` 或 PR URL 时）
1. **若 PR 带有标签 `asdlc:needs-clarification`（Draft Spec PR）**：
   - 抓取评论线程。若无人类新评论，退出 0 并提示等待；若有人类回复，消化问答清空 `[OPEN]` 并推进至 **Spec Review**。
2. **若 PR 带有标签 `asdlc:spec-review`（Spec PR）**：
   - 若 PR 已合入（`MERGED`）：主干已就绪（$L_{\text{target}} = 1$），自动切出 `impl/<slug>` 分支并开启 `0444` 内核只读锁，推进至 **Apply**。
   - 若 PR 仍开启（`OPEN`）：
     - **若 $H_{\text{feedback}} = 1$（人类评审提出修改意见或打回 Changes Requested）**：
       - 进入 **SPEC_HUMAN_REVIEW_FIX（阶段 4b）**：通过 GitHub API 拉取评审行内与总体评论；
       - Session A 响应人类审查意见，修改 `proposal.md` 与 `specs/**`，在 `clarifications.md` 记录修改依据；
       - 跑通 `asdlc lint`，派生 Session B 独立审查验证修改点；
       - 推送新提交 `spec(<slug>): address PR review comments from @reviewer`，回复评论并请求重新审查。
     - **若 $H_{\text{feedback}} = 0$（无未解决的人工评审意见）**：
       - 若尚未跑过审查则派生独立进程跑 **Spec Review**；若已跑过且 PASS 则打印等待人工合入并退出 0。
3. **若 PR 带有标签 `asdlc:impl-review`（Implementation PR）**：
   - 若 PR 已合入（`MERGED`）：流程达成，提示运行 `asdlc archive <slug>` 归档；
   - 若 PR 仍开启（`OPEN`）：
     - **若 $H_{\text{feedback}} = 1$（人类评审要求修改代码或追加测试）**：
       - 进入 **IMPL_HUMAN_REVIEW_FIX（阶段 7b）**：拉取行内代码 Review 意见；
       - Session A 修改业务代码与测试用例，执行本地测试套件确认通过；
       - 跑通 `asdlc verify` 并派生 Session B 独立审查；
       - 推送新提交 `impl(<slug>): address PR review comments from @reviewer`，回复评审并请求重新审查。
     - **若 $H_{\text{feedback}} = 0$（无未解决的人工评审意见）**：
       - 若尚未跑过验收则派生独立进程跑 **Impl Review 与 asdlc verify**；全部通过后打印等待人工最终合入并退出 0。

#### 6.3.4 深度解析：无 Request Changes 纯评论场景下的自主甄别与处理引擎（3-Tier Triage Engine）
在真实企业工程研发协作中，代码审查人员（Reviewer）往往**并不会显式点击 GitHub 的 "Request Changes"** 按钮（很多团队甚至禁用该阻断性动作或将其视为对抗性沟通）。相反，审查者通常通过以下四种方式提出修改：
1. 提交状态为 `COMMENTED` 的 Review 汇总包（此时 `reviewDecision` 为 `null` 或 `COMMENTED`），并在行内留下实质性改动建议（如 *"nit: 这里缺少判空保护，请加一下"* 或 *"请补充超时异常测试用例"*）；
2. 不打 Review 包，直接在 Diff 页面留下一条或多条独立的行内行级别 Comment；
3. 直接使用 GitHub 原生 ```suggestion 代码块建议微调；
4. 提出技术性提问与原理解析（如 *"为什么这里选 SHA256 而不是 HMAC？"*），这类评论**不需要改动代码或规范，而需要给出严谨的技术解答**；
5. 纯赞赏或表情反馈（如 *"LGTM"*、*":+1:"*）。

若 AI 编排器仅仅机械地判定 `reviewDecision === 'CHANGES_REQUESTED'`，系统会直接误判为"评审通过无意见"（$H_{\text{feedback}} = 0$），将人类审查意见完全置若罔闻。为此，`asdlc` 设计并实现了 **3-Tier PR 审查评论自主甄别与处理引擎**：

```mermaid
flowchart TD
  START(["PR 检查启动: asdlc run #N"]) --> T1["Tier 1: 多通道摄取与时序过滤\nGraphQL reviewThreads(isResolved: false) + Issue 顶层评论\n时序与作者防环过滤: createdAt > latestCommit && author != agent"]
  T1 --> T1_CHECK{"是否存在未响应评论?"}
  T1_CHECK -- "否 (N == 0)" --> CLEAN["H_feedback = 0 -> PR 干净无阻碍 -> 进入验证/合入"]
  T1_CHECK -- "是 (N > 0)" --> T2["Tier 2: 语义意图四分类路由器 (4-Way Router)"]
  
  T2 --> C1["类别 A: 实质修改需求 (ACTION_REQUIRED)\n显式 Bug 修复、边界遗漏、重构或用例补充"]
  T2 --> C2["类别 B: 建议代码块 (SUGGESTION_BLOCK)\nGitHub 原生 suggestion 代码补丁"]
  T2 --> C3["类别 C: 咨询与原理解答 (INFORMATIONAL_QUESTION)\n架构选型疑问、原理澄清、非修改性交流"]
  T2 --> C4["类别 D: 非操作性响应 (NON_ACTIONABLE)\n赞美、LGTM、表情符号肯定"]

  C1 --> ACT_CODE["Session A: 修改代码/规范 -> 运行 TDD / Lint -> 本地验证"]
  C2 --> ACT_SUGG["AST 语法校验试跑: 应用补丁 -> 运行测试套件"]
  C3 --> ACT_INFO["架构推导智能体: 结合 Spec 与 AST 生成严谨技术解答"]
  C4 --> ACT_ACK["调用 GitHub API 回复表情/点赞 (不触发代码变更)"]

  ACT_CODE --> T3["Tier 3: 双向线程自动闭环与审计溯源"]
  ACT_SUGG --> T3
  ACT_INFO --> T3_REPLY["在 PR 讨论线程内回复专业解答 (保留线程开放供人类确认)"]

  T3 --> COMMIT["Git 提交: fix(scope): 修复评审意见 (ref: #threadId)\nGit Push 推送至分支"]
  COMMIT --> REPLY["addPullRequestReviewThreadReply(body: '已在提交 abc1234 中修复')"]
  REPLY --> RESOLVE["resolveReviewThread(threadId: $id)\nGitHub UI 自动 Resolve 讨论线程"]
  RESOLVE --> NEXT_CYCLE["重新评估: 验证分支门禁全绿 -> 更新 PR 状态"]
```

##### 1. Tier 1: 确定性多通道摄取与时序防环过滤
编排器通过 GitHub GraphQL API 获取具备严格会话线索与代码锚点的行内评审线程：
```graphql
query PullRequestReviewThreads($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewDecision
      headRefOid
      commits(last: 1) { nodes { commit { committedDate, oid } } }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 20) {
            nodes {
              id
              databaseId
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}
```
**三重防死循环不变量约束**：
- **时序不变量 ($T_{\text{comment}} > T_{\text{commit}}$)**：仅筛选**晚于当前 PR 分支最新 Commit 提交时间戳**的评论。凡是在当前 Commit 之前的评论，一律视为历史已解决或已过期项。
- **作者不变量 ($\text{Author} \ne \text{Agent}$)**：严格剔除 Agent 自身账号、CI/CD Bot 与自动化汇总账号发表的评论，杜绝"Agent 回复自己触发死循环"。
- **解决状态不变量 ($\text{isResolved} == \text{false}$)**：在 GraphQL 线程中已被人工标记为 Resolved 的线程直接跳过，仅处理处于活跃争议状态的线程。

##### 2. Tier 2: 语义意图四分类路由器
抓取到的有效评论与上下文 AST 代码行进行联合解析，归入四个互斥类别：
- **类别 A: 实质改动需求 (`ACTION_REQUIRED_CODE_OR_SPEC`)**：
  - *特征*：祁使句式、明确缺陷指出、要求补充测试或修改逻辑（如 *"这里空指针异常未处理"*、*"请补充边界场景用例"*）。
  - *执行*：将文件路径、精确行号代码块与评论内容打包派发给 `Session A`，由其按 TDD 规范修改代码或规范，本地跑通单元测试与 lint。
- **类别 B: 建议代码块 (`SUGGESTION_BLOCK`)**：
  - *特征*：评论体中包含 GitHub 原生 ````suggestion ... ```` 标记。
  - *执行*：原地解析出内存补丁并打入当前工作区，执行本地测试套件确认无语法错误且全绿后采纳。
- **类别 C: 咨询与原理解答 (`INFORMATIONAL_QUESTION`)**：
  - *特征*：疑问句式、设计考量咨询、性能与安全关切（如 *"为什么使用内存锁而非 Redis 分布式锁？"*）。
  - *执行*：交由架构推导模型查阅 `specs/`、`design.md` 与系统 AST，在 PR 线程中生成专业、详尽、有理有据的技术答复。**严禁为了回复提问而空跑无意义的虚假代码提交**。
- **类别 D: 非操作性肯定 (`NON_ACTIONABLE`)**：
  - *特征*："LGTM"、"赞"、"Good idea"、纯表情。
  - *执行*：在 GitHub 评论上直接打上 Thumbs-Up 表情，不触发下游任何流水线动作。

##### 3. Tier 3: 双向线程自动闭环与审计凭据
当实质性修改（类别 A 或 B）完成并通过验证后：
1. **结构化追溯提交**：以规范化语义提交代码并显式关联评论线程 ID：
   ```bash
   git commit -m "fix(auth): handle null token exception (ref: #thread-MDEyOlB1bGxSZXF1ZXN0UmV2aWV3VGhyZWFkMTIz)"
   git push origin <branch>
   ```
2. **精准线索回复**：调用 GraphQL `addPullRequestReviewThreadReply` 在原行内评论下跟帖回复：
   ```graphql
   mutation ReplyThread($threadId: ID!, $body: String!) {
     addPullRequestReviewThreadReply(input: {
       pullRequestReviewThreadId: $threadId,
       body: "已在提交 [`abc1234`](commit/abc1234) 中修复：增加了空令牌异常处理并在 `auth.test.js` 中补齐了回归测试用例。"
     }) {
       comment { id }
     }
   }
   ```
3. **GraphQL 自动标记 Resolve**：调用 GitHub GraphQL Mutation 将该 Review 线程在网页端标记为 Resolved：
   ```graphql
   mutation ResolveThread($threadId: ID!) {
     resolveReviewThread(input: { threadId: $threadId }) {
       thread { isResolved }
     }
   }
   ```
审查人员无需反复手动去点一个个 "Resolve conversation"，只要刷新 PR 页面即可看到完整的修改 Commit、代码 Diff 与线程关闭凭据。

##### 4. 双轨生命周期对称性保障（本地 IDE vs 容器运行）
本评论甄别引擎是 `@asdlc/engine` 的纯纯核心模块，完全支持双轨双向复用：
- **容器自动化模式 (`asdlc run --container #42`)**：在隔离容器内静默、高效地全自动完成抓取、修复、测试、推送与回复。
- **本地交互模式 (`asdlc review-comments --pr #42` 或 `asdlc apply --from-pr #42`)**：工程师在 VS Code / 本地终端中运行同样命令，可以逐条预览分类后的 Review 意见、交互式采纳建议代码块，或驱动本地 Agent 协同完成修复。非容器开发流程获得 100% 同等的能力赋能，绝无任何体验降级或逻辑漂移。

#### 6.3.5 全生命周期 10 阶段流转矩阵
| 阶段序号与标识 | 激活前提条件（Pre-conditions） | 容器本次执行的精准动作（Action） | 跃迁与退出出口（Transition Boundary） |
| :--- | :--- | :--- | :--- |
| **阶段 1: SPEC_DRAFT** | $P_{\text{spec}} = 0$ | 运行 `asdlc new --no-grill`，基于 AST 图谱草拟提案与 Spec | 若存在 `[OPEN]` 转阶段 2；否则转阶段 4 |
| **阶段 2: SPEC_GRILL_PAUSE** | $N_{\text{open}} > 0 \land \text{PR}_{\text{state}} = \text{none}$ | 推送分支，创建 Draft PR 并发评论提问 | 打印回复指引，干净退出 0 |
| **阶段 3: SPEC_GRILL_RESUME** | $N_{\text{open}} > 0 \land C_{\text{replied}} = 1$ | 抓取评论回复，清空 `[OPEN]`，定稿 Spec | 推进至阶段 4 |
| **阶段 4: SPEC_REVIEW** | $P_{\text{spec}} = 1 \land N_{\text{open}} = 0 \land L_{\text{target}} = 0 \land R_{\text{stage}} \ne \text{spec}$ | 派生独立进程执行 `asdlc-spec-review` 与 `asdlc lint`，标记 PR Ready | 推进至阶段 5 |
| **阶段 4b: SPEC_HUMAN_REVIEW_FIX** | $\text{PR}_{\text{label}} = \text{spec-review} \land \text{PR}_{\text{state}} = \text{OPEN} \land H_{\text{feedback}} = 1$ | 抓取人工评审意见；Session A 修改 Spec；通过 `lint` 与 Session B 重评；推送修复提交并回复 Review | 推进回阶段 5 等待人工复审 |
| **阶段 5: AWAITING_SPEC_MERGE** | $\text{PR}_{\text{label}} = \text{spec-review} \land L_{\text{target}} = 0 \land H_{\text{feedback}} = 0$ | 打印等待人类 Tech Lead 审核合入指引 | 干净退出 0（容器即刻销毁零空转） |
| **阶段 6: APPLY_TDD** | $L_{\text{target}} = 1 \land U_{\text{tasks}} > 0$ | 内核锁死规范为 `0:0 0444`；生成 `tasks.md`；执行任务级 TDD 红绿重构循环 | 当 $U_{\text{tasks}} = 0$ 时自动跃迁至阶段 7 |
| **阶段 7: IMPL_REVIEW_AND_VERIFY** | $L_{\text{target}} = 1 \land U_{\text{tasks}} = 0 \land (\text{verify} \ne \text{PASS} \lor R_{\text{stage}} \ne \text{impl})$ | 派生独立进程执行 `asdlc-impl-review` 与 `asdlc verify` 门禁（最多 3 轮修复） | 验证全 PASS 后推进至阶段 8 |
| **阶段 7b: IMPL_HUMAN_REVIEW_FIX** | $\text{PR}_{\text{label}} = \text{impl-review} \land \text{PR}_{\text{state}} = \text{OPEN} \land H_{\text{feedback}} = 1$ | 抓取行内代码评审意见；Session A 修改源码与测试；执行 `asdlc verify`；推送修复提交并回复 Review | 推进回阶段 8 等待人工复审 |
| **阶段 8: OPEN_IMPL_PR** | 所有验证门禁 PASS $\land\ H_{\text{feedback}} = 0 \land \text{PR}_{\text{label}} \ne \text{impl-review}$ | 开启正式 Implementation PR，附带全套测试与门禁凭据报告 | 流水线大功告成 |

### 6.4 治理合规门禁补强
1. **`Player != Referee` 裁判会话完全物理隔离**：编写/实现与审查强制拆分为独立进程执行，支持配置 `agent.review_model` 异构审查模型，修复循环上限 3 轮。
2. **确定性 `[OPEN]` 决议阻塞门禁**：`asdlc lint` 在发现 `clarifications.md` 仍含有未解决的 `[OPEN]` 标记或非空开放式问题时强行阻断提单。
3. **真实审批溯源**：更新 `src/commands/approve.js`，如实记录合入 SHA 与审批来源凭据。

---

## 7. 分阶段落地路线图

1. **Iteration 1（全局控制面、多源 Intake 与门禁补强）**：交付 `asdlc config`（`~/.asdlc/config.yaml`、`0600` 权限与脱敏、`login`/`agent`）、`workflow_mode: spec-first | auto` 全链路贯通、`asdlc new` 多源 `--from-file`/`--from-issue` 与内置 `asdlc-intake` Skill、`lint` 的 `[OPEN]` 阻塞门禁及 `approve.js` 溯源修正。
2. **Iteration 2（官方 `ubuntu:26.04` 非 Root 镜像与发布流水线）**：交付 `docker/Dockerfile.base` 与 `docker/Dockerfile.runner`（`UID 10001:10001`）、`release.yml` GHCR 同版本发布及 `asdlc upgrade` 镜像同步。
3. **Iteration 3（`asdlc run` 状态机与 PR 异步 Grill 闭环）**：交付 `src/commands/run.js` 与容器驱动（`docker cp`、`gh auth token`、`0444` Spec 只读锁）、双会话隔离审查与 Draft PR 评论问答续跑闭环。
