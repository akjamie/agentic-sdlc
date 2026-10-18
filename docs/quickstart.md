# Agentic SDLC Quickstart Guide
# 从零到首个 Spec PR 合入实战指南

> **Bilingual Edition / 中英文双语实战指南**  
> Complete end-to-end walkthrough from initializing a repository to merging your first verified Spec PR.  
> 涵盖从空仓库初始化到首个已验证 Spec PR 合入的端到端完整流程。

---

## 📑 Table of Contents / 目录
- [English Walkthrough](#english-walkthrough)
  - [Prerequisites](#prerequisites)
  - [Phase 1: Initialize the Repository](#phase-1-initialize-the-repository)
  - [Phase 2: Start a New Spec (Stage 1)](#phase-2-start-a-new-spec-stage-1)
  - [Phase 3: Batch Grilling & Design Settlement (Stage 2)](#phase-3-batch-grilling--design-settlement-stage-2)
  - [Phase 4: Lint & Open Spec PR (Stage 3)](#phase-4-lint--open-spec-pr-stage-3)
  - [Phase 5: Human Review & Approval (Stage 4)](#phase-5-human-review--approval-stage-4)
  - [Phase 6: Strict TDD Implementation (Stage 5)](#phase-6-strict-tdd-implementation-stage-5)
  - [Phase 7: Verification & Archive (Stages 6 & 7)](#phase-7-verification--archive-stages-6--7)
- [中文实战流程](#中文实战流程)
  - [准备工作](#准备工作)
  - [阶段一：初始化仓库](#阶段一初始化仓库)
  - [阶段二：脚手架新建变更 (Stage 1)](#阶段二脚手架新建变更-stage-1)
  - [阶段三：批量盘问与设计收敛 (Stage 2)](#阶段三批量盘问与设计收敛-stage-2)
  - [阶段四：质量门禁与发起 Spec PR (Stage 3)](#阶段四质量门禁与发起-spec-pr-stage-3)
  - [阶段五：同行评审与意图核准 (Stage 4)](#阶段五同行评审与意图核准-stage-4)
  - [阶段六：严格 TDD 闭环实施 (Stage 5)](#阶段六严格-tdd-闭环实施-stage-5)
  - [阶段七：全维度验证与能力归档 (Stages 6 & 7)](#阶段七全维度验证与能力归档-stages-6--7)

---

# English Walkthrough

## Prerequisites
- **Node.js**: >= 18.0.0
- **Git**: Installed and configured with `user.name` and `user.email`
- **Optional**: Python + `uv` or `pip` (for Graphify AST knowledge graphs)
- **Install `asdlc` CLI**:
  ```bash
  npm install -g @akjamie/agentic-sdlc
  ```

---

## Phase 1: Initialize the Repository

Navigate to your project root (or a fresh Git repo) and run `asdlc init`:

```bash
cd my-project
git init
asdlc init
```

### What this does behind the scenes:
1. Reuses and wires the **OpenSpec engine** (`.openspec/`, `openspec.yaml`).
2. Scaffolds enterprise governance policy (`.sdlc/policy.yaml`).
3. Installs bundled agent skills (`.agents/skills/`, `.claude/skills/`, etc.).
4. Builds the repository code knowledge graph via **Graphify AST**.
5. Initializes Git hooks (`core.hooksPath` -> `.githooks/`) to guard against unverified pushes.
6. Writes `AGENTS.md` with system routing guidelines and architectural god nodes.

---

## Phase 2: Start a New Spec (Stage 1)

Whenever you have a new business requirement, run `asdlc new`:

```bash
asdlc new "Support user login with JWT tokens and expiration refresh"
```

### Generated Artifacts:
`asdlc` derives a canonical slug (e.g. `user-login-with-jwt`) and scaffolds `openspec/changes/user-login-with-jwt/`:
- **`.openspec.yaml`**: Change metadata tracking the lifecycle stage.
- **`explore.md`**: Architectural context and god-node connections automatically queried from the AST graph.
- **`clarifications.md`**: Pre-seeded decision frontier template for author grilling.

---

## Phase 3: Batch Grilling & Design Settlement (Stage 2)

Trigger the **grilling** skill in your AI agent:
> *"Run grilling on change `user-login-with-jwt` using batch-grill-me."*

### Grilling Protocol:
1. The agent analyses `explore.md` and repo codebase facts (never ask humans for facts the agent can check).
2. The agent presents the **entire decision frontier in 1 structured batch** (e.g., Q1: Token storage strategy, Q2: Refresh window duration, Q3: Error responses).
3. Each question includes a **recommended default**:
   - `Q1 (Recommended): Store JWT in HttpOnly secure cookies.`
4. The human author responds: *"Approved defaults, but change refresh window in Q2 to 7 days."*
5. Settled decisions are recorded into `clarifications.md`.
6. Grounded in these decisions, the agent authors:
   - `proposal.md`: Problem, capabilities, non-functional requirements.
   - `specs/**/spec.md`: BDD scenarios with clear **Acceptance Criteria (AC)**.
   - `tasks.md`: Paired TDD implementation steps.

---

## Phase 4: Lint & Open Spec PR (Stage 3)

Run the deterministic BDD quality linter:

```bash
asdlc lint user-login-with-jwt
```

It validates:
- [x] R0-R8 BDD rules (GIVEN / WHEN / THEN consistency).
- [x] Traceable Acceptance Criteria (`AC1`, `AC2` mapped to test paths).
- [x] Presence of all required artifacts.

Once lint passes with 0 blockers, automatically open your **Spec PR**:

```bash
asdlc pr user-login-with-jwt main
```

- Automatically pushes the branch `spec/user-login-with-jwt`.
- Automatically extracts PR Title and Description from `proposal.md`.
- Opens PR on GitHub/GitLab via CLI, REST API, or provides a 1-click browser compare link!

---

## Phase 5: Human Review & Approval (Stage 4)

Your Tech Lead or product stakeholder reviews the Spec PR.  
Once intent is agreed upon, run:

```bash
asdlc approve user-login-with-jwt
```

### What this freezes:
1. Calculates the path-limited Git SHA (`specSha`) of `proposal.md` and `specs/**`.
2. Sets `status: ready_for_impl` in `.openspec.yaml`.
3. Stamps `review.md` with `## Verdict: APPROVE` and cryptographic audit trail.
4. Unlocks Stage 5 for implementation!

---

## Phase 6: Strict TDD Implementation (Stage 5)

Now tell your AI agent:
> *"Execute `/asdlc:apply user-login-with-jwt` using strict task-level TDD."*

The agent executes the immutable 5-step TDD loop:
1. **Red**: Write a failing test matching AC1 (`npm test` -> FAIL).
2. **Green**: Implement minimal code to pass the test (`npm test` -> PASS).
3. **Refactor**: Clean up implementation without altering behavior.
4. **Evidence**: Record task verification evidence.
5. **Converge**: Check off task in `tasks.md` and repeat for next AC.

> **Security Guard**: If the agent attempts to modify `proposal.md` or `specs/**` during implementation to cheat test requirements, `asdlc verify` will immediately detect `spec-tamper` and reject the PR!

---

## Phase 7: Verification & Archive (Stages 6 & 7)

### Run Stage 6 Verification:
```bash
asdlc verify user-login-with-jwt
```
Runs the 9 enterprise quality gates:
1. Path-limited `specSha` matches approved commit.
2. Zero spec tampering during implementation.
3. Flow state is `READY_FOR_IMPL`.
4. All tasks in `tasks.md` completed.
5. Test presence enforced (every modified source file has matching tests in diff).
6. TDD execution evidence valid.
7. BDD & acceptance criteria linting clean.
8. External repository tests pass.

### Final Archive:
Merge your PR into the target branch. On trunk, run:

```bash
asdlc archive user-login-with-jwt
```
- Syncs delta specs into `openspec/specs/` (the project's permanent living documentation).
- Updates `README.md` capability dashboard.
- Protects `AGENTS.md` against prompt bloat (only updated if constitutional governance rules changed).

🎉 **Congratulations! Your first spec-driven, AI-native feature has been safely delivered!**

---

# 中文实战流程

## 准备工作
- **Node.js**: >= 18.0.0
- **Git**: 已安装并配置好用户名与邮箱
- **可选依赖**: Python + `uv` 或 `pip`（用于 Graphify 语法知识图谱构建）
- **安装 `asdlc` 全局命令行**:
  ```bash
  npm install -g @akjamie/agentic-sdlc
  ```

---

## 阶段一：初始化仓库

进入目标项目根目录（或新建 Git 仓库）并执行 `asdlc init`：

```bash
cd my-project
git init
asdlc init
```

### 初始化底层动作：
1. 复用并配置底层 **OpenSpec 规范引擎**（`.openspec/`）。
2. 初始化企业研发治理策略文件（`.sdlc/policy.yaml`）。
3. 自动注入开箱即用的 Agent Skills（注入到 `.agents/skills/`、`.claude/skills/` 等）。
4. 通过 **Graphify AST** 扫描仓库代码并建立知识拓扑。
5. 配置 Git 安全钩子（`core.hooksPath` 指向 `.githooks/`），拦截未通过 verify 的推送。
6. 生成 `AGENTS.md`，注入核心研发路由与架构核心枢纽节点（God Nodes）。

---

## 阶段二：脚手架新建变更 (Stage 1)

面对新业务需求，只需执行一行命令：

```bash
asdlc new "支持用户通过 JWT Token 登录与无感刷新令牌"
```

### 自动生成的产物：
CLI 自动推导标准标识名（如 `user-login-with-jwt`）并在 `openspec/changes/user-login-with-jwt/` 生成：
- **`.openspec.yaml`**: 变更元数据与当前生命周期状态。
- **`explore.md`**: 基于代码图谱提取的高关联架构枢纽与上下文，让 AI 接手时立即扎根真实系统。
- **`clarifications.md`**: 预置的决策树模板，供盘问阶段使用。

---

## 阶段三：批量盘问与设计收敛 (Stage 2)

在 AI 编程助手中触发 **grilling** 技能：
> *"对变更 `user-login-with-jwt` 执行 grilling，使用 batch-grill-me 协议盘问。"*

### 盘问流程：
1. AI 查阅 `explore.md` 与代码事实（事实由 AI 自行查验，绝不向人类提问能查到的客观事实）。
2. AI 一次性抛出**包含全部决策前沿的结构化问卷**（如 Q1: 令牌存储方式、Q2: 刷新有效期、Q3: 异常状态码响应）。
3. 每道题目附带**专家级推荐选项**：
   - `Q1 (推荐): 使用 HttpOnly Secure Cookie 存储 JWT。`
4. 开发者只需快速确认或微调：*"同意推荐项，但 Q2 的有效期调整为 7 天。"*
5. 决策结论落盘至 `clarifications.md`。
6. 基于沉淀的决策，AI 编写：
   - `proposal.md`: 需求背景、能力清单、非功能指标。
   - `specs/**/spec.md`: 标准 BDD 场景及带测试路径的**验收准则 (AC)**。
   - `tasks.md`: 严格成对的 TDD 实施任务。

---

## 阶段四：质量门禁与发起 Spec PR (Stage 3)

执行确定性 BDD 规范检查：

```bash
asdlc lint user-login-with-jwt
```

检查项涵盖：
- [x] BDD 语法与 GIVEN / WHEN / THEN 规范约束。
- [x] 验收准则可追踪性（每项 AC 是否绑定具体测试文件）。
- [x] 必需产物完备性。

检查通过（0 blockers）后，一键开启 **Spec PR**：

```bash
asdlc pr user-login-with-jwt main
```

- 自动切换或推送 `spec/user-login-with-jwt` 分支。
- 自动提取 `proposal.md` 作为 PR 标题与正文。
- 自动调用 GitHub/GitLab CLI、REST API 或生成浏览器一键对比链接！

---

## 阶段五：同行评审与意图核准 (Stage 4)

Tech Lead 或架构师在 PR 上进行业务与架构评审。  
评审达成一致后，在终端或 CI 中执行核准命令：

```bash
asdlc approve user-login-with-jwt
```

### 核心核准动作：
1. 锁定此时 `proposal.md` 与 `specs/**` 的 Git 提交哈希（`specSha`）。
2. 在 `.openspec.yaml` 标记状态：`status: ready_for_impl`。
3. 生成 `review.md` 并盖上 `## Verdict: APPROVE` 的审计印章。
4. 正式解锁 Stage 5 实施权限！

---

## 阶段六：严格 TDD 闭环实施 (Stage 5)

此时向 AI 发送指令：
> *"执行 `/asdlc:apply user-login-with-jwt`，遵循严格任务级 TDD。"*

AI 严格遵循五步 TDD 循环：
1. **Red**: 针对 AC1 编写失败测试用例（`npm test` -> 必须红灯报错）。
2. **Green**: 编写业务逻辑让测试通过（`npm test` -> 绿灯通过）。
3. **Refactor**: 在测试保护下重构与清理代码。
4. **Evidence**: 留存执行证明。
5. **Converge**: 在 `tasks.md` 勾选任务，推进至下一项。

> **防篡改卫士**：如果 AI 在实施过程中试图修改 `proposal.md` 或 `specs/**` 降低测试标准，后续验证阶段将触发 `spec-tamper` 拦截并阻断合入！

---

## 阶段七：全维度验证与能力归档 (Stages 6 & 7)

### 执行 Stage 6 门禁验证：
```bash
asdlc verify user-login-with-jwt
```
自动运行 9 项企业级门禁：
1. Spec SHA 匹配核准时的不可变提交。
2. 零规约篡改（spec-tamper: 0）。
3. 状态合规处于 `READY_FOR_IMPL`。
4. `tasks.md` 任务全部完成。
5. 测试伴随性验证（Diff 中每个源码文件均有对应的测试文件）。
6. TDD 研发证据链完整。
7. BDD 语法合规。
8. 仓库测试套件全部通过。

### 最终归档：
PR 合入主干后，在主干执行归档：

```bash
asdlc archive user-login-with-jwt
```
- 将增量 Spec 同步沉淀至 `openspec/specs/`（成为企业永久活文档）。
- 更新 `README.md` 功能状态看板。
- 保护 `AGENTS.md` 免受普通业务信息污染（仅在宪法级治理演进时刷新）。

🎉 **恭喜！您已成功通过 Agentic SDLC 完成首个高质量、防漂移的 AI 规范驱动开发！**
