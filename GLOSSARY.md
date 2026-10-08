# Glossary — Agentic SDLC 术语表（Phase 0 交付物 D-1）

> **目的**：OpenSpec 原生词汇与 v5 企业叠加层词汇大量重叠但含义不同。本文锁定"一个概念 = 一个名字"，避免团队把 "spec" 当成三个不同东西。
>
> **命名纪律**
> - `Repo-local Spec`（或 `spec.md`）= 企业层的 **approved intent** 文件，永不简写为裸词 "spec"。
> - OpenSpec 原生 capability delta 一律称 **`OpenSpec spec delta`**，文件位于 `specs/**/*.md`。
> - 状态字段一律称 **projection**，不称 "source of truth"；唯一权威是 **`approved` 分支的 commit SHA**。

---

## 1. 核心实体

| 术语（锁定） | 属于哪层 | 定义 | 物理位置 | 生命周期 |
|---|---|---|---|---|
| **System Design** | 跨 repo（战略层） | 某系统能力/领域的结构性设计：跨 repo 契约 + 顺序约束 | coordination store `system-designs/<domain>/<ver>/` | 独立持久，多 story 复用、跨季度修订 |
| **contracts.md** | System Design 内 | 跨 repo 的 API/Event/Data 契约（字段级） | `system-designs/<domain>/<ver>/contracts.md` | 随版本 |
| **sequencing.md** | System Design 内 | 跨 repo 的提交/发布/回滚顺序与一致性窗口 | `system-designs/<domain>/<ver>/sequencing.md` | 随版本 |
| **System Design Registry** | 治理面 | 记录每个领域 `current` 版本与 stakeholderRepos | `system-designs/registry.yaml` | 持久 |
| **Repo-local Spec** | 单 repo | 给定契约后，本 repo 的 **approved intent**（Requirements/Scenarios/AC） | 本 repo change 内 | 随 Tech Story 生灭 |
| **Change Package** | 单 repo | 一次变更的工件集合（proposal/spec/review/tasks） | 各 repo `openspec/changes/<id>/` | 随 Tech Story 生灭 |
| **Change Manifest** | 治理面 | **纯状态路由表**：这个变更涉及谁、以哪个 approved 版本为准、各 repo 到哪一步 | coordination store `manifests/<changeId>.yaml` | 随 Tech Story 生灭 |

## 2. Change Package 内的工件

| 工件 | 定义 | Writer | 可变？ |
|---|---|---|---|
| `proposal.md` | why：背景与影响范围 | Draft agent / 人 | 可变（草稿期） |
| `spec.md` / `specs/**/*.md` | approved intent：行为契约 + 场景（BDD）+ AC | Draft agent / 人 | 批准后不可变 |
| `review.md` | 独立 Fresh-context Reviewer 的复核结论 | **Reviewer agent（只读，不可改 spec）** | 追加式，不回写 spec |
| `design.md` | 本 repo 内部的技术设计（HOW） | Draft agent / 人 | 草稿期可变 |
| `tasks.md` | 执行状态（mutable execution state，**不属于 approved intent**） | 执行 agent / bot | 可变 |

## 3. 治理与状态

| 术语 | 定义 |
|---|---|
| **approval evidence** | Git PR merge 到 `main` 这一事实本身 |
| **`approved` 分支** | coordination store 上受保护分支，只有 bot 可 push；**唯一权威来源** |
| **approved SHA** | `approved` 分支 HEAD（或 `approved/<changeId>` tag）指向的 commit SHA |
| **projection** | 由 bot 从 `approved` 派生的只读状态字段（如 Manifest 的 `SPEC_APPROVED`）；**永不当权威** |
| **Amendment** | 为已 approved 的 System Design 生成新版本；旧版本引用方被 CI 标记 `stale` |
| **stale** | 某 repo 引用的 System Design 版本已非 `current`，需重新对齐 |
| **Converge (Report First)** | 缺口发现后先报告；repo 内部低风险修复可自动追加 task，跨 repo 契约变化必须走 Amendment |

## 4. 现状来源（Context）

| 术语 | 定义 | 来源 |
|---|---|---|
| **KB/RAG** | 历史架构决策（为什么这么设计） | Pre-FSR/FSR/FDD 沉淀 |
| **Context Index** | 机器抽取的**当前**接口/契约事实（结构化 YAML，非代码快照） | CI 静态分析抽取管线 → `system-context/<repo>.yaml` |
| **对账 (reconcile)** | 低频重跑抽取并与上一版 diff，不一致则标记 `stale` | 定时 job |

## 5. 角色与自主度

| 术语 | 定义 |
|---|---|
| **Draft agent** | 起草 spec/design 的 agent 上下文 |
| **Reviewer agent** | Fresh-context，**与 Draft 不同上下文**；只写 `review.md` |
| **Player / Referee 分离** | 起草者不能当最终裁判；System Design 与 Repo Spec 两层都适用 |
| **A0–A3** | 自主度台阶；System Design 与 Repo Spec **独立评估、独立推进** |

## 6. OpenSpec 原生 ↔ 企业层映射

| 企业层（v5） | OpenSpec 原生 | 关键差异 |
|---|---|---|
| Change Package | `openspec/changes/<id>/` 目录 | — |
| `proposal.md` | artifact `proposal` | 一致 |
| `spec.md`（approved intent） | **无直接对应**；OpenSpec 的 `specs` 是 capability delta | **最重要差异**，见 §1/§2 |
| `review.md` | **无对应**（企业自建，已加入自定义 schema） | 只读、不回写 spec |
| `design.md` | artifact `design` | v5 把 Technical Design 放进 spec.md；本方案单独保留 design.md（OpenSpec-idiomatic） |
| `tasks.md` | artifact `tasks` | 一致 |
| System Design / Registry / Manifest / Context Index | **无对应**，企业自建于 coordination store | 不 fork OpenSpec 核心 |
| Store / References | `openspec store`（**beta**）/ `references:` | 见实施计划 §4 决策 D-2 |

## 7. 禁用/易混词对照

| 不要用 | 应说 |
|---|---|
| "spec"（裸词） | `Repo-local Spec`（企业意图）或 `OpenSpec spec delta`（能力增量） |
| "Manifest 管依赖/顺序" | 那是 System Design 的 `sequencing.md`；Manifest 只记状态 |
| "approved 字段" | `approved` 分支 SHA（唯一权威）；字段是 projection |
| "设计写进 spec 里" | System Design（跨 repo）与 Repo-local Spec（单 repo）分层 |
