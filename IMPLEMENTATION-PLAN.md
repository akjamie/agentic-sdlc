# Agentic SDLC 实施方案（OpenSpec）

> **BLUF / 版本说明**
>
> 本文是 v5 战略方案（`agentic-sdlc-integration-plan-v5.md`）的**实施层文档**，回答"先做什么、怎么搭起来、每个阶段怎么验收"。战略层（v5）定义 `System Design` / `Repo-local Spec` / `Change Manifest` 三实体与两层分离；本文定义它们的**具体文件形态、状态机、审批记录机制、CI Gate 实现、抽取管线、以及分阶段施工顺序**。
>
> 原则不变：**Humans approve intent. Agents execute intent. Independent agents verify intent. CI enforces intent. Git preserves the evidence.**
>
> 依赖事实（2026-09 核实 OpenSpec 当前版本）：
> - 自定义 schema：`openspec schema init/fork/validate/which`
> - Store（独立 OpenSpec repo）：`openspec store setup/register/list` —— **beta**
> - 只读引用：`openspec/config.yaml` 中 `references:[<id>]`，把被引用 store 的 spec 索引注入 `openspec instructions`，内容从不拷贝，`--store <id>` 精确 fetch
> - CI 校验：`openspec validate --all --strict`
> - 默认 `spec-driven` schema 的 artifact 为 `proposal / specs / design / tasks`（与本文 Change Package 需做术语映射）

---

## 1. 术语映射（OpenSpec 原生 ↔ 企业叠加层）

**这是 Phase 0 第一份交付物。** OpenSpec 自带一套词汇，与 v5 方案大量重叠但含义不同；不锁映射，团队会把"spec"当成三个不同东西。

| 企业层概念（v5） | OpenSpec 原生映射 | 说明 / 关键差异 |
|---|---|---|
| **Change Package** | OpenSpec `changes/<id>/` 目录 | OpenSpec 原生 artifact：`proposal / specs / design / tasks` |
| `proposal.md`（why） | OpenSpec `proposal`（模板） | 基本一致 |
| `spec.md`（approved intent） | **无直接对应**。OpenSpec 的 `specs/` 是 capability delta（ADDED/MODIFIED/REMOVED scenarios），不是 intent 工件 | **最重要差异**：企业层 `spec.md` 是"批准的意图文档"，需用自定义 schema 扩展；不要与 OpenSpec `specs/` 语义混淆 |
| `review.md`（Fresh-context reviewer 产出） | **无对应** | 企业自建 artifact，只读、不可改 spec |
| `tasks.md`（mutable execution state） | OpenSpec `tasks` | 一致 |
| **System Design**（contracts.md / sequencing.md） | 无直接对应，住在 coordination store，经 `references:` 只读暴露 | 企业层持久实体，不是 OpenSpec change |
| **System Design Registry** | coordination store 内 `system-designs/registry.yaml` | 机器维护 |
| **Change Manifest**（纯状态路由表） | 无对应，企业自建 | 住在 coordination store |
| **Context Index**（结构化现状） | 无对应，CI 抽取管线产出到 `system-context/` | 企业自建 |
| **Store** | OpenSpec `store`（beta） | 见 §4，是否 bet on beta 是决策点 D-2 |
| **References** | OpenSpec `references:` | 只读上下文，完全复用 |

> 命名纪律：文档与工具里，"**Repo-local Spec**" 永远指企业层 `spec.md`（approved intent），不缩写成 "spec"；OpenSpec 的 capability delta 一律称 "OpenSpec spec delta"。

---

## 2. 组件清单与物理位置（谁是 owner、住在哪）

| 组件 | 物理位置 | Writer | 生命周期 |
|---|---|---|---|
| **Repo-local Change Package** | 各业务 repo `openspec/changes/<id>/`（proposal/spec/review/tasks） | Draft agent（起草）、Reviewer agent（只写 review.md）、人（审批）、bot（状态） | 随 Tech Story 生灭 |
| **System Design** | coordination store `system-designs/<domain>/<ver>/contracts.md`、`sequencing.md` | 架构/平台团队 + Draft agent + Fresh-context reviewer | 独立持久，多 story 复用 |
| **System Design Registry** | `system-designs/registry.yaml` | bot（状态）+ 人（新建/修订时提交内容） | 持久 |
| **Change Manifest** | `manifests/<changeId>.yaml` | bot（全部字段，除 `systemDesigns` 由人创建时填） | 随 Tech Story 生灭 |
| **Context Index** | `system-context/<repo>.yaml` | 各 repo CI 抽取管线 push | 持久，低频对账刷新 |
| **approval 记录** | coordination store `approved` 保护分支（见 §5） | bot（post-merge 同步） | 持久 |

---

## 3. System Design 文件形态（锁定 contracts/sequencing 范围，防 Mega Parent Spec）

```text
system-designs/
  payment-settlement/
    v2/
      contracts.md     # 跨 repo 的 API/Event/Data 契约，只写"对外的、会被其他 repo 消费的"
      sequencing.md    # 跨 repo 顺序/一致性约束（先改谁、谁先发、回滚顺序）
    v3-draft/
      contracts.md
      sequencing.md
  registry.yaml
```

`registry.yaml`：

```yaml
payment-settlement:
  current: v2
  stakeholderRepos: [payment-api, payment-service, payment-web]
order-fulfillment:
  current: v1
  stakeholderRepos: [order-service, inventory-service]
```

**防膨胀约束（治理原则 6 的具体化）：** `contracts.md` 只允许三个小节——(a) 对外合约（API/Event/Schema 字段级），(b) 兼容性约束（versioning/deprecation），(c) 明确列出的非目标。`sequencing.md` 只允许：仓库提交顺序、发布顺序、回滚顺序、一致性窗口。**任何单 repo 内部实现细节出现在这里 = review 直接打回。** Bottom-up 新建 / Top-down 主动修订 / Amendment（生成新版本、旧版本引用方 CI 标记 stale）沿用 v5 §4。

---

## 4. 决策 D-2：Store 押注策略

OpenSpec `store` 目前是 **beta**。两条路，Phase 3 前必须选一条写死：

| 选项 | 做法 | 代价 | 适用 |
|---|---|---|---|
| **(A) 押 store beta** | coordination store 用 `openspec store`，repo 经 `references:` 引用 | beta API 可能 break，需 pin 版本 + 升级护栏 | 想少写胶水、接受 beta 风险 |
| **(B) 普通 git repo + references** | coordination store 就是普通 git repo，repo 在 `config.yaml` 写 `references:[<url>]` 只读消费 | 自己维护读取约定 | 不想跨 repo 层被 beta 卡死 |

**推荐**：先用 (B) 起步，把 `system-designs/`、`system-context/`、`manifests/` 当归普通文件消费；等 `store` 走出 beta 且评估无 break 后无缝迁到 (A)（同样目录结构可平移）。**两者的共享契约是目录结构，不是 store 机制**——保证迁移成本低。

---

## 5. 审批记录机制（治理原则 1 落地，解决"approved SHA 从哪读"的鸡生蛋）

**问题**：CI gate 要校验 "PR 引用的 spec commit = approved spec commit"，但 approved 指针若由被校验的同一个 PR 写，就自批准了。

**机制（Phase 2 落地）**：
1. coordination store 有一条受保护的 `approved` 分支，**只有 bot 账号能 push**（人类要改必须走 PR + 审批，不许直 push）。
2. 人审批并 merge spec 的 PR 到 `main` 后，bot 执行 post-merge，把 `main` fast-forward 同步到 `approved`（若 squash 则打 tag `approved/<changeId>` 指向 merge commit）。
3. 实现 PR 必须在变更元数据带 `changeId` + 它依赖的 `spec commit SHA`（写入 PR body 或 `openspec/changes/<id>/.openspec.yaml`）。
4. CI Traceability gate 读取 coordination store 的 `approved` 分支 HEAD（或 tag），与 PR 声明的 SHA 比对，不一致即 fail。

**规则**：`approved` 分支是唯一权威（Git PR merge 是 approval 证据），状态字段（如 `SPEC_APPROVED`）只是 projection（bot 从 `approved` 派生写回），永不当权威。

---

## 6. Change Manifest 状态机（FSM）

Manifest 唯一职责 = "做到哪了"。以下状态机是 Phase 3 交付物，由 bot 根据 PR/CI 事件写入，人不手填。

```yaml
changeId: TECH-1888
systemDesigns:            # 人创建时唯一手填字段
  - payment-settlement@v2
  - order-fulfillment@v1
components:
  - repo: payment-api
    status: IMPLEMENTING
    specSha: "abc123"
  - repo: payment-service
    status: SPEC_APPROVED
    specSha: "def456"
  - repo: payment-web
    status: NOT_STARTED
```

**Repo 状态机**：

```text
NOT_STARTED ──(bot 初始化)──▶ SPEC_DRAFTING ──(人审批 spec)──▶ SPEC_APPROVED
   SPEC_APPROVED ──(bot 见 implementation PR)──▶ IMPLEMENTING ──(PR open)──▶ IN_CI_VERIFICATION
   IN_CI_VERIFICATION ──(八层 gate 全绿)──▶ MERGED ──(openspec archive)──▶ ARCHIVED
   IN_CI_VERIFICATION ──(gate 失败)──▶ REJECTED (可回到 IMPLEMENTING)
   （引用的 System Design 版本被 Amendment 顶掉）──▶ STALE ──(重新对齐)──▶ SPEC_DRAFTING
```

**System Design 状态机**（独立于 repo）：

```text
DRAFT ──(Fresh-context review + 人审批)──▶ APPROVED (current)
   APPROVED ──(Amendment 生成新版本)──▶ SUPERSEDED
   APPROVED ──(显式废弃)──▶ RETIRED
```

**明确不做**：Manifest 不存跨 repo 依赖/顺序/契约（在 System Design），不存任何设计推理。三个消费场景（CI 版本校验 / Workset 组装 / 组合看板）沿用 v5 §6。

---

## 7. CI Gate（八层，逐层落地手段）

Phase 2 先上第 1–3 层，Phase 4 上全八层。每层给出**实现手段**而非口号：

| # | Gate | 实现手段 | 何时上 |
|---|---|---|---|
| 1 | Traceability | CI 读 PR 元数据（changeId + specSha + systemDesigns 版本），与 coordination store `approved`/`manifests/<id>.yaml` 比对 | Phase 2 |
| 2 | Approved Spec/Design | 比对 PR 声明 SHA == `approved` 分支 HEAD / tag（§5） | Phase 2 |
| 3 | OpenSpec Validation | `openspec validate --all --strict` 跑在 PR CI | Phase 2 |
| 4 | Independent AI Verification | 无头 agent（§8）产出 `review.md` + requirement→impl→test 验证报告 | Phase 3 |
| 5 | Requirement-to-Test Coverage | 解析 spec 每条 AC，映射到至少一个 test case | Phase 3 |
| 6 | Contract/Integration Test | 对 `contracts.md` 每个对外契约跑真实接口/事件断言 | Phase 4 |
| 7 | Policy/Security Checks | 复用现有安全扫描 + 企业策略扩展（secrets/依赖/license） | Phase 2（复用）/ Phase 4（扩展） |
| 8 | Branch Protection | 平台统一（approval + status check + 线性历史） | Phase 2 |

**Converge = Report First（两级）：** repo 内部低风险修复（缺失单测、fixture）自动追加 task；跨 repo 契约变化必须回到 System Design 走 Amendment，不允许在某个 repo spec 里私下吸收。

---

## 8. 无头验证 agent（Gate #4 的运营设计）

**问题**：独立验证 agent 在 CI 里跑，涉及 runtime、沙箱、成本、时延。

- **Runtime**：与执行 agent 解耦，选一个能 headless 调用、支持"只读 + 只写 review.md"约束的 runtime（Phase 2 评估 1 个，不锁死）。
- **沙箱**：CI job 跑在隔离容器，持只读凭据（可读 repo + coordination store，不可 push 除 review.md 外的任何内容）。
- **成本/时延预算**：每 PR 一次验证，设 token 与 wall-clock 上限，超限降级为"人工审查强制"而非静默通过。
- **产出**：`review.md`（只读、不可改 spec）+ 结构化验证报告（每条 AC 的 requirement→implementation→test 三元映射，供 Gate #5 复用）。

---

## 9. Context Index 抽取管线（唯一净新增工程，Phase 1 起预研）

这是 v5 §5 的落地，全方案唯一"从零造轮子"的部分，**Phase 1 就开始 spike，别等 Phase 3**。

```text
每个 repo 的 CI（merge to main 触发）
    │
    ▼
静态分析抽取（按 repo 语言/协议选工具）：
   - API：OpenAPI 生成器 / protobuf reflection / 导出符号扫描
   - 事件/消息：schema registry 导出
   - DB schema：迁移文件解析
   - CODEOWNERS
    │
    ▼
产出结构化 Context Index（几十行 YAML，非代码快照）
    │
    ▼
push 到 coordination store 的 system-context/<repo>.yaml
```

- **对账（防过期）**：低频 job（每周 / System Design 起草前触发）重跑抽取，与上一版 diff，不一致只标记该 repo Context 为 `stale`，下次被引用时强制刷新，不全量重扫。
- **Pre-Phase 3 预研目标**：在 1 个真实 repo 上证明"抽取 → 发布 → diff 标记 stale"闭环跑通，产出工具选型记录（建议提前到 Phase 1 末完成）。

---

## 10. Jira 集成契约（决策 D-5）

- **ID 权威**：`changeId` 以 Jira Technical Story key 为 source of truth（`TECH-xxx`），Manifest / change 目录名 / PR 元数据都引用它。
- **同步方向**：Jira 是需求与审批入口；状态投影由 bot 单向写回（spec approved / merged / stale），不反向把 Jira 状态当 Git 权威。
- **接入点**：webhook（Jira → bot）+ bot 账号（bot → Jira），先 Phase 1 用手工映射（PR 标题/body 带 Jira key），Phase 3 再自动同步。

---

## 11. 分阶段路线图与验收门槛（DOD）

沿用 v5 §11 相位，但加上**每阶段退出条件（exit criteria）**：

| 阶段 | 范围 | 关键交付 | 退出条件（不满足不外扩） |
|---|---|---|---|
| **Phase 0**（2-4 周） | 无跨 repo、无 System Design | Custom Schema、repo spec 样例、术语表、pin 版本 | `openspec validate --strict` 过 fixture；术语表被团队 adoption |
| **Phase 1**（4-8 周） | 单 repo、1-2 真实变更，人工主导 | 第一条 proposal→spec→review→实现→merge 闭环；成本打点 | 一次真实 merge 无 bypass；reviewer 与 draft 是不同上下文 |
| **Phase 2**（2-3 月） | 同 repo，AI Review 参考、CI 上 1–3 层 gate | 审批记录机制（§5）、accuracy 基线、branch protection | 抽样复核 evidence；Gate 1–3 全绿 |
| **Phase 3**（3-5 月） | 首个 2-repo 有依赖变更 | System Design（单领域）+ 简化 Manifest + Context Index 管线（2 repo） | §5 审批记录在真实跨 repo 上跑通；stale 机制生效 |
| **Phase 4**（5-8 月） | 扩展 + 全八层 gate | Registry/Index 扩域、完整 CI、组合看板 | 全八层落地；A3 只对已验证低风险类型开放 |

**自主度台阶**（A0→A3）完全沿用 v5 §10：System Design 与 Repo Spec 独立评估、独立推进，repo-level 可快于 system-level。

---

## 12. 并行工作流（tracks + 依赖 + owner）

| # | Track | 产出 | 依赖 | 起止 |
|---|---|---|---|---|
| A | OpenSpec baseline | pin 版本、init、custom schema、术语表 | — | Phase 0 |
| B | Repo pilot | 单 repo 真实变更闭环 | A | Phase 1 |
| C | 无头验证 harness | headless agent 包装 + 成本预算 + review.md 发布 | A | Phase 2 |
| D | Context Index spike | 抽取 runner + 发布 + reconcile-diff | A（概念独立） | Phase 1–3 |
| E | 治理面 | 审批记录、Manifest FSM、CI gate、Jira 契约 | A/C/D | Phase 2–4 |

---

## 13. 风险寄存器（owner + 触发动作）

| 风险 | Owner | 触发动作 |
|---|---|---|
| 存量 repo 测试基建薄弱，gate 形同虚设 | DevOps | pilot 准入前测试健康度评估（Phase 0/1） |
| Context Index 过期导致错误现状 | Platform | 低频对账 + stale 强制刷新（§9） |
| System Design 被重做成 Mega Parent Spec | Arch | §3 三小节硬约束，review 打回 |
| AI Review 虚假安全感 | Eng lead | 长期抽样人工复核，Gate #4 超限降级人工 |
| Agent 成本不可控 | DevOps | Phase 1 起每 change 成本打点（§12 Track C） |
| Store beta break | Platform | pin 版本；先 (B) 后 (A)（§4） |
| 团队抵触先写 spec | Eng lead | Phase 0 低成本样例铺垫 |

---

## 14. 立即行动清单（本轮可启动）

1. 产出 Phase 0 术语表（§1）与 Custom Schema 样例（`openspec schema init`），2 周内。
2. 选 1 个 repo、1-2 条真实变更启动 Phase 1 pilot，不涉及 System Design/Manifest/CI。
3. 为 Phase 3 预研 Context Index 静态分析工具选型，**提前到 Phase 1 末**做小范围验证。

---

## 附：决策日志（D-1 … D-6，待决策状态）

- **D-1** 术语映射锁定（§1）—— Phase 0 完成
- **D-2** Store 押注：先 B 后 A（§4）—— 建议采纳
- **D-3** 审批记录机制（§5）—— Phase 2 落地
- **D-4** 无头验证 runtime 选型（§8）—— Phase 2 评估
- **D-5** Jira ID 权威与同步方向（§10）—— 待确认
- **D-6** Custom Schema 的 artifact 清单（原生 vs 企业自建）—— Phase 0 完成