# About Agentic SDLC (ASDLC)
# 关于 Agentic SDLC：下一代 AI 原生软件工程体系

> **"Transforming AI from an unpredictable text generator into an auditable, high-assurance software engineering partner."**  
> **"让生成式 AI 从不可控的代码生成器，转变为具备契约门禁、可审计、高确定性的软件工程伙伴。"**

---

## 1. Executive Summary / 核心概述

**Agentic SDLC (ASDLC)** is an enterprise-grade, specification-driven software development lifecycle designed specifically for the era of AI coding agents. 

While traditional software engineering relies on manual handoffs and post-facto code reviews, and unconstrained autonomous coding leads to review bandwidth exhaustion, shared-context verification bias, and unverified architectural drift, **Agentic SDLC introduces a deterministic 7-stage governance pipeline**. It binds AI agents to Git-locked specifications, strict TDD loops, and automated multi-gate verification.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              The 7-Stage ASDLC Pipeline                                │
│                                                                                        │
│   [1. NEW]         Scaffold change + ground in Graphify AST knowledge graph            │
│       ↓                                                                                │
│   [2. GRILL]       Batch-grill-me interview -> settle design -> author BDD spec        │
│       ↓                                                                                │
│   [3. LINT]        Deterministic AC/BDD linter -> open Spec PR                         │
│       ↓                                                                                │
│   [4. APPROVE]     Human / TL sign-off -> Git specSha lock (READY_FOR_IMPL)            │
│       ↓                                                                                │
│   [5. APPLY]       Guarded task-level TDD (Red -> Green -> Refactor -> Converge)       │
│       ↓                                                                                │
│   [6. VERIFY]      12 verification gates (tamper detection, test presence, verification tests) │
│       ↓                                                                                │
│   [7. ARCHIVE]     Living specs sync -> README update -> constitutional protection     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Why Agentic SDLC? The Enterprise AI Coding Bottlenecks
## 为什么需要 Agentic SDLC？企业级 AI 编程的核心挑战

As autonomous coding agents scale across software engineering organizations, technical leaders encounter three systemic engineering bottlenecks:  
随着自主编程代理在研发组织中规模化普及，工程团队正面临三项关键的系统性瓶颈：

### 1. Review Bandwidth Asymmetry (审查吞吐量不对称)
- **EN**: Code production throughput has scaled by an order of magnitude, but human cognitive capacity for deep architectural comprehension remains constant. When teams face frequent, multi-file AI pull requests, line-by-line review becomes unsustainable. Review depth is inadvertently diluted, risking the entry of latent defects and architectural drift into trunk branches.
- **ZH**: AI 辅助将代码编写的速度提升了数倍，但人类梳理调用链、推演边界条件与架构一致性的认知带宽并未发生本质变化。当每日 PR 数量和单次 Diff 规模显著上升时，审查者难以长期保持高强度细粒度推演，审查深度容易被稀释，增加了技术负债流入主干的概率。

### 2. Shared-Context Verification Bias (同源验证偏差 · Player == Referee)
- **EN**: When the same agent writes both implementation code and unit tests within the same reasoning context, tests naturally share the agent's internal assumptions and biases. A passing test suite confirms that the code aligns with the agent's internal logic, which may diverge from the true enterprise specification. Passing CI tests can inadvertently mask contract discrepancies.
- **ZH**: 当编写生产代码与编写单元测试完全由同一个上下文中的 Agent 完成时，两者共享了同一套归纳偏差与理解前提。当 Agent 对某项业务边界存在理解偏差时，其编写的测试往往会将该偏差固化为“预期行为”。此时测试全绿只能证明“代码符合 Agent 自身的理解”，无法代表“代码满足真实的系统契约”。

### 3. Implicit Assumption Accumulation (隐式假设累积与意图留白)
- **EN**: Natural language requirements are inherently concise, leaving technical ambiguities unspecified (e.g., error payloads, retry strategies, boundary fallbacks, persistence tradeoffs). Autonomous agents resolve these ambiguities on their own. Without early alignment on these forks, unverified assumptions surface late during code review or staging, driving up rework cycles.
- **ZH**: 自然语言表达天然具有高度概括性与信息留白；而自主代理为了完成端到端任务，必须在多步推理中自行填补大量工程细节（如幂等策略、错误封套、降级行为与存储选型）。这些隐式假设若未经显式对齐，往往直到提测或评审阶段才被发现，造成较高的返工成本。

---

## 3. Core Architectural Pillars
## 核心架构支柱与关键创新

### Pillar 1: Git-Anchored Spec SHA Freezing (规约 Git 快照锁定与防篡改)
- When a human or Tech Lead reviews and approves a specification (`asdlc approve <ID>`), the system records a path-limited Git commit hash (`specSha`) covering only `proposal.md` and `specs/**`.
- During implementation (Stage 5), the AI is strictly prohibited from touching the approved spec.
- In Stage 6 (`asdlc verify`), any unauthorized modification triggers the `spec-tamper` blocking gate. **The AI cannot change the contract once approved.**

### Pillar 2: AST-Grounded Exploration via Graphify (AST 驱动的代码拓扑探查)
- Before a line of specification is written, `asdlc new` queries a local repository code knowledge graph generated by **Graphify**.
- The AI discovers architectural hubs ("god nodes") and existing symbol relationships through structured graph queries rather than expensive and hallucination-prone brute-force file reading.
- Operates **100% offline and air-gapped** by default for sensitive enterprise environments.

### Pillar 3: Batch-Grill-Me Protocol (批量决策前沿探查协议)
- Instead of tedious, open-ended 20-round Q&A sessions, `asdlc` implements the **batch-grill-me** protocol.
- The AI looks up facts independently from the repository.
- The AI consolidates all open architectural and business decisions into **1 to 2 structured batches with recommended expert defaults**, allowing human leads to settle decisions in minutes.

### Pillar 4: Strict Task-Level TDD Loop (任务级不可逆测试驱动循环)
- In Stage 5 (`asdlc apply`), implementation is strictly bound to `tasks.md`.
- Each Acceptance Criterion (`AC`) is enforced via a mandatory Red -> Green -> Refactor -> Evidence sequence.
- Code without corresponding test files is rejected at the gate (`test-presence`).

### Pillar 5: Dual-Handshake Constitutional Protection (双重握手宪法保护机制)
- System instructions (`AGENTS.md`) serve as the Root of Trust for all AI agents.
- Normal feature specs sync to `openspec/specs/` and `README.md`, but are **strictly prevented from polluting `AGENTS.md`**, eliminating prompt bloat.
- Only changes with verified modifications to core governance paths (`.sdlc/policy.yaml`, `openspec/config.yaml`, `.githooks`) are allowed to refresh `AGENTS.md`.

---

## 4. Comparative Architecture
## 技术方案横向对比

| Dimension / 维度 | Raw Copilot / Cursor | Traditional SDLC | Agentic SDLC (ASDLC) |
| :--- | :--- | :--- | :--- |
| **Contract Authority** | None (Ad-hoc prompt) | Jira / Confluence (Disconnected) | **Git-Anchored Spec SHA (In-Repo Git Gate)** |
| **AI Freedom** | Unconstrained (High drift risk) | N/A (Manual coding) | **Bounded Execution (Stage Guards)** |
| **Context Grounding** | Vector similarity / Embeddings | Human memory | **AST Knowledge Graph (Graphify)** |
| **Quality Verification** | Manual reviewer eye-check | CI test runs | **9 Automated Gates (Anti-tamper, AC, TDD)** |
| **Documentation Sync** | None (Docs get stale) | Manual wiki updates | **Automatic Living Specs Archive (`openspec/`)** |
| **Enterprise Governance**| Hard to audit | Heavy process friction | **Git-Native, Branch-Agnostic, Zero Friction** |

---

## 5. Technology Stack & Integration
## 技术栈与集成生态

- **Core Engine**: Node.js CLI (`asdlc`), built on top of the open-source **OpenSpec** specification standard.
- **AST Knowledge Graph**: Python + **Graphify AST**, generating topological architectural indexes.
- **Agent IDE Interoperability**: Out-of-the-box skill distribution supporting:
  - Antigravity IDE (`.agents/skills/`)
  - Claude Code (`.claude/skills/`)
  - OpenCode (`.opencode/skills/`)
  - Cursor, Windsurf, Zed, Trae, Devin, Gemini
- **CI/CD Integrations**: Scaffolding for GitHub Actions, GitLab CI, and Jenkins (`Jenkinsfile`).

---

## 6. Open Source Roadmap & Community
## 开源路线图与企业展望

1. **Free Public Distribution on npm**: Available globally via `npm install -g @akjamie/agentic-sdlc`.
2. **Automated CI/CD via GitHub Actions**: Automated test verification and granular release pipelines.
3. **Enterprise Overlays**: Pluggable BU governance policies, SOC2/ISO audit log exporters, and internal model adapter support.

---

> *Agentic SDLC bridges the gap between AI velocity and enterprise discipline. Build faster, with 100% confidence.*
