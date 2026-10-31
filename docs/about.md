# About Agentic SDLC (ASDLC)
# 关于 Agentic SDLC：下一代 AI 原生软件工程体系

> **"Transforming AI from an unpredictable text generator into an auditable, high-assurance software engineering partner."**  
> **"让生成式 AI 从不可控的代码生成器，转变为具备契约门禁、可审计、高确定性的软件工程伙伴。"**

---

## 1. Executive Summary / 核心概述

**Agentic SDLC (ASDLC)** is an enterprise-grade, specification-driven software development lifecycle designed specifically for the era of AI coding agents. 

While traditional software engineering relies on manual handoffs and post-facto code reviews, and unconstrained autonomous coding leads to review bandwidth exhaustion, shared-context verification bias, and boundary spillover regressions, **Agentic SDLC introduces a deterministic 7-stage governance pipeline**. It binds AI agents to Git-locked specifications, strict TDD loops, and automated multi-gate verification.

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
- **ZH**: AI 辅助将代码编写的速度提升了数倍，但人类梳理调用链、推演边界条件与架构一致性的认知带宽并未发生本质变化。当每日 PR 数量和单次 Diff 规模显著上升时，审查者难以长期保持高强度细粒度推演，审查深度容易被稀释，增加了潜在缺陷与架构偏离流入主干的概率。

### 2. Shared-Context Verification Bias (同源验证偏差 · Player == Referee)
- **EN**: When the same agent writes both implementation code and unit tests within the same reasoning context, tests naturally share the agent's internal assumptions and biases. A passing test suite confirms that the code aligns with the agent's internal logic, which may diverge from the true enterprise specification. Passing CI tests can inadvertently mask contract discrepancies.
- **ZH**: 当编写生产代码与编写单元测试完全由同一个上下文中的 Agent 完成时，两者共享了同一套归纳偏差与理解前提。当 Agent 对某项业务边界存在理解偏差时，其编写的测试往往会将该偏差固化为“预期行为”。此时测试全绿只能证明“代码符合 Agent 自身的理解”，无法代表“代码满足真实的系统契约”。

### 3. Implicit Assumptions & Boundary Spillover (隐式假设累积与越界修改风险)
- **EN**: Natural language prompts are inherently concise, stating localized intent while leaving architectural boundaries, blast-radius limits, and edge behaviors unspecified. To fulfill the prompt, autonomous agents resolve ambiguities independently and frequently modify high fan-in shared libraries, common interceptors, or public schemas. Without explicit boundary contracts and blast-radius awareness, these unverified assumptions and boundary crossovers trigger cascading regressions across dependent components.
- **ZH**: 自然语言天然精炼且伴随大量留白，提示词往往只表达局部诉求，而省略了严格的系统边界约束与改动爆炸半径限制。全自主 Agent 在缺乏代码拓扑全景意识时，常自行推演并顺藤摸瓜修改公共高入度枢纽、共享拦截器或上下游协议，导致原本局部的微调击穿模块隔离界限，引发下游依赖的级联破坏（Cascading Regressions）与高昂的后期返工成本。

---

## 3. Core Architectural Pillars
## 核心架构支柱与关键创新

### Pillar 1: Adaptive Dual-Track Risk Governance (L0–L3 自适应双轨分流)
- **Frictionless Fast Track (L0/L1)**: Pure test additions, documentation updates, and bounded local refactors operate in a streamlined Single-PR mode with automated validation and zero review friction, protecting human review bandwidth.
- **Spec-First Rigor (L2/L3)**: High-impact changes touching public APIs, database DDL, auth engines, or constitutional rules enforce a Dual-PR flow with upfront human architectural approval before implementation begins.

### Pillar 2: Git-Anchored Spec SHA Freezing (规约 Git 快照锁定与防篡改)
- When a human or Tech Lead reviews and approves a specification (`asdlc approve <ID>`), the system records a path-limited Git commit hash (`specSha`) covering only `proposal.md` and `specs/**`.
- During implementation (Stage 5), the AI is strictly prohibited from touching the approved spec.
- In Stage 6 (`asdlc verify`), any unauthorized modification triggers the `spec-tamper` blocking gate. **The AI cannot change the contract once approved.**

### Pillar 3: AST-Grounded Exploration & Blast-Radius Awareness (AST 拓扑探查与改动爆炸半径感知)
- Before a line of specification is written, `asdlc new` queries a local repository code knowledge graph generated by **Graphify**.
- The AI discovers architectural hubs ("god nodes") and existing symbol relationships through structured graph queries rather than expensive and hallucination-prone brute-force file reading.
- Changes touching high fan-in shared modules ($\ge 20$ inbound dependencies) are automatically escalated to L2, preventing blind boundary spillover.
- Operates **100% offline and air-gapped** by default for sensitive enterprise environments.

### Pillar 4: Batch-Grill-Me Protocol (批量决策前沿探查协议)
- Instead of tedious, open-ended 20-round Q&A sessions, `asdlc` implements the **batch-grill-me** protocol.
- The AI looks up facts independently from the repository.
- The AI consolidates all open architectural and business decisions into **1 to 2 structured batches with recommended expert defaults**, allowing human leads to settle decisions in minutes.

### Pillar 5: Strict Task-Level TDD Loop (任务级不可逆测试驱动循环)
- In Stage 5 (`asdlc apply`), implementation is strictly bound to `tasks.md`.
- Each Acceptance Criterion (`AC`) is enforced via a mandatory Red -> Green -> Refactor -> Evidence sequence.
- Code without corresponding test files is rejected at the gate (`test-presence`).

### Pillar 6: Player ≠ Referee Verification Isolation (独立上下文验证隔离)
- Verification in CI is executed by a fresh, unpolluted LLM context outside the authoring agent's reasoning thread.
- Eliminates shared-context verification bias: the authoring agent cannot write lenient tests or self-validate flawed internal assumptions.

### Pillar 7: Dual-Handshake Constitutional Protection & In-Place Escalation (双重握手宪法保护与就地范围升级)
- System instructions (`AGENTS.md`) serve as the Root of Trust for all AI agents. Feature specs sync to `openspec/specs/` and `README.md`, but are **strictly prevented from polluting `AGENTS.md`**, eliminating prompt bloat.
- Only changes with verified modifications to core governance paths (`.sdlc/policy.yaml`, `openspec/config.yaml`, `.githooks`) can refresh `AGENTS.md`.
- If an L1 routine change unexpectedly touches public APIs or schemas during implementation, the system preserves the single PR in-place, revokes auto-merge, and routes to a Tech Lead without tearing Git branches apart.

---

## 4. Comparative Architecture
## 技术方案横向对比

| Dimension / 维度 | Raw Copilot / Cursor | Traditional SDLC | Agentic SDLC (ASDLC) |
| :--- | :--- | :--- | :--- |
| **Contract Authority** | None (Ad-hoc prompt) | Jira / Confluence (Disconnected) | **Git-Anchored Spec SHA (In-Repo Git Gate)** |
| **AI Freedom** | Unconstrained (High drift risk) | N/A (Manual coding) | **Bounded Execution (Stage Guards)** |
| **Context Grounding** | Vector similarity / Embeddings | Human memory | **AST Knowledge Graph (Graphify)** |
| **Quality Verification** | Manual reviewer eye-check | CI test runs | **12 Automated Gates (Anti-tamper, AC, TDD)** |
| **Documentation Sync** | None (Docs get stale) | Manual wiki updates | **Automatic Living Specs Archive (`openspec/`)** |
| **Enterprise Governance**| Hard to audit | Heavy process friction | **Git-Native, Branch-Agnostic, Low Friction on Routine Work** |

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

> *Agentic SDLC bridges the gap between AI velocity and enterprise discipline. Build faster, with verifiable confidence.*
