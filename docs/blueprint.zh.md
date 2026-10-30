# 企业级 Agentic SDLC 落地方案(v10):OpenSpec + Graphify 底座 + 平台治理面

> **BLUF**
>
> **Adopt the engines, own the governance plane。** OpenSpec 负责规格的生命周期与产物结构,Graphify 负责"系统现状"的结构化感知(不读代码,查询知识图谱);企业自己负责"什么必须发生、由谁批准、怎样留证"。**强制点只放在 Git 平台 + Jenkins + Jira 这一层**,agent 侧的 skill、config 只负责降低摩擦,不构成强制。
>
> 开发者日常只做三件事:**提交规格、开始实现、上报规格缺口**。所有判定由路径规则和脚本自动完成。
>
> `asdlc` 是把 OpenSpec、Graphify、平台治理规则打包成**一条命令可装、可升级**的企业 CLI,不依赖推送到公网 npm registry。
>
> **本版(v8)核心改动:apply 开始后,规格(proposal.md、specs/**)物理不可修改。** 实现阶段一旦发现规格缺口,不再允许"在同一 PR 内修改已批准规格",而是把当前 change 标记为 `SUPERSEDED`,新开一个 change 从零走完整的 Spec PR 审批生命周期(§6、§8、§8.1)。这个改动消除了此前最脆弱的一处设计(同 PR 内修改锁定路径、依赖批准人不走形式审查大 diff),让规格修订次数变成一个更干净的"supersede 链长度"指标(§14.2)。
>
> **本版范围说明:** 上一轮评审中提出的 DORA 供应商第三方风险评估、EU AI Act Annex III 标记、内审(第三道防线)角色、review.md 不可篡改性与保留年限等建议,经确认**不纳入本方案**——这些属于企业风险/合规/采购团队的职责范围,不是 SDLC 工具链(asdlc/OpenSpec/Graphify)本身该承担的能力,本方案的边界严格限定在"把规格驱动的研发流程工具化、治理化",不延伸到运营合规流程本身。
>
> **v9 新增:** SUPERSEDED 的 change 不能被 apply/verify/archive(§8.2)——新增机器可读的 `.sdlc-state.yaml` 状态文件,`asdlc apply`/`verify`/`archive` 执行前本地先查一次(开发体验层,可被绕过),CI 必需检查第 12 项是真正的强制点(不可绕过),另附自动关闭旧 Impl PR 的机器人动作作为兜底。
>
> **v10 新增:** `asdlc upgrade`(§16.5,开发者侧,所有人能跑)默认拿到的是 `asdlc.lock` 当前记录的、已被平台团队验证过的最新版本,**不是** OpenSpec/Graphify 上游刚发布的最新版本;真正去追上游最新版、跑 Contract Test、决定要不要升级,是新增的 `asdlc platform refresh-lock`(§16.6,仅平台团队、独立 RBAC)。两条命令职责不重叠(§16.7),"开发者默认拿到最新"的体验保留,但"最新"的判定权始终留在平台团队手上。

---

## 0. v6 → v7 变更摘要

| # | 缺口 | v6 状态 | v7 修复 |
| :--- | :--- | :--- | :--- |
| 0 | asdlc 的 npm 安装方式 | 未提及 | 新增 §3:本地 tarball / 内部 registry 两种方式,明确推荐 |
| 1 | `asdlc init` 编排 | 不存在 | 新增 §4:openspec install → graphify install → openspec init(钩子带出 graphify init) |
| 2 | explore/propose 接入 graphify | §5.1/§9 写的是"AI 了解真实结构"(agent 读代码) | 改为 §7.1:explore 强制先 `graphify update`,查询图谱而非读码 |
| 3 | `asdlc lint spec` | 不存在,只有 `openspec validate --strict` | 新增命令,§10.1 明确与 validate 的分工(格式 vs 质量) |
| 4 | apply 内的 converge | 被挪到 verify 阶段一次性做 | §7.2 改为任务级 converge,verify 保留全量复核 |
| 5 | verify 检查 task 完成度 | 只提需求→实现→测试 | §7.2 显式要求对照 tasks.md 勾选状态 |
| 6 | archive 前更新 AGENTS.md | 未关联,只按周期刷新 | §7.3 archive 合并即触发 graphify update + AGENTS.md 刷新,和 KB 重建同一触发点 |
| 7 | `asdlc review` | 只有 Jenkins 触发的 CI 内部 review | 新增本地命令,§10.1 落实"同一份守卫、两处运行" |

另增两节:**§15 graphify 集成的行业对标评估**(是否该直接采用社区桥接方案),**§16 asdlc/OpenSpec/Graphify 升级策略**(三个独立演进的组件如何不互相拖垮)。

v6 原有的平台治理设计(PR 类型、路径锁定、policy.yaml、SPEC_GAP 处理、快速/紧急通道、度量体系)**全部保留**,不是本次修复范围。

### v7 → v8

| 主题 | v7 | v8 | 原因 |
| :--- | :--- | :--- | :--- |
| apply 后修改规格 | SPEC_GAP C 类:经作者确认后,在同一 Impl PR 内修改锁定路径 | **不允许**:当前 change 标记 SUPERSEDED,新开 change 从零走 Spec PR 审批(§6、§8.1) | 消除"批准人对大 diff 走形式审查"这个此前只能靠数据观察、无法靠设计消除的风险 |
| 规格修订次数指标 | 同一 change 内部的修订次数 | supersede 链长度(§14.2) | 指标含义随机制变化同步调整 |
| 范围 | 含 fintech 评审中提出的若干合规建议待定 | **明确排除** DORA 供应商评估、EU AI Act Annex III 标记、内审角色、review.md 保留年限——这些是风险/合规团队职责,不进 SDLC 工具链方案 | 保持方案边界清晰,不做运营合规的事 |

### v8 → v9

| 主题 | v8 | v9 | 原因 |
| :--- | :--- | :--- | :--- |
| SUPERSEDED change 的执行拦截 | Supersede 机制定义了"应该"不再被使用,但没有定义机器怎么拦住 | **新增 §8.2**:`.sdlc-state.yaml` 状态文件 + `asdlc apply/verify/archive` 本地守卫 + CI 必需检查第 12 项(真正强制点)+ 旧 Impl PR 自动关闭 | 规则不能只停留在文档约定,需要有东西真正拦住 |

### v9 → v10

| 主题 | v9 | v10 | 原因 |
| :--- | :--- | :--- | :--- |
| `asdlc upgrade` 的"最新"是谁的最新 | 只有一条 `asdlc upgrade`,隐含拿的是 asdlc.lock 当前版本,未显式区分"上游最新"和"已验证最新" | **拆成两条命令**:`asdlc upgrade`(§16.5,开发者,拿 lock 已验证版本)+ `asdlc platform refresh-lock`(§16.6,平台团队,独立 RBAC,追上游最新并跑 Contract Test) | 开发者如果能直接拉上游最新,会绕开 §16.1 的锁定机制本身 |

---

## 1. 设计原则

1. **强制在平台,引导在 agent。** 任何一条规则如果只写在 prompt、skill 或 config 里,就视为"建议"。
2. **路径决定一切。** PR 类型、评审要求、是否触发规格批准,全部由改动的文件路径判定。
3. **人的判断只保留两处:** 批准规格意图;评审例外。
4. **策略集中。** 锁定路径、批准人、白名单放在一份由平台团队保护的策略文件里。
5. **同一份守卫,两处运行。** 本地 skill 调用守卫(提前失败),CI 再运行同一份。
6. **先建议、后阻断。** 每条新规则先以参考模式运行,收集误报率,再切为阻断。
7. **组件可替换、契约自有。** Change Package 结构、证据模型、策略文件由企业定义;OpenSpec、Graphify、AI Review 模型、KB 工具均可替换。
8. **现状来自结构化查询,不来自 AI 读代码。** 任何需要"系统现在是什么样"的环节(explore、propose、AGENTS.md 刷新),一律查 Graphify 产出的图谱,不允许让 agent 直接通读源码来猜。

---

## 2. 架构总览

```text
┌──────────────────────────────────────────────────────────────┐
│ 治理面(自有,强制)                                            │
│  Git 平台:分支保护 / CODEOWNERS / 必需检查                     │
│  Jenkins 共享流水线库:守卫 / AI Review / review.md / KB 构建   │
│  Jira:Story / 追溯 / 批准记录归档                              │
│  策略仓库:policy.yaml、autonomy-register.yaml、asdlc.lock     │
├──────────────────────────────────────────────────────────────┤
│ 规格引擎(OpenSpec,不 fork) + 图谱引擎(Graphify,不 fork)      │
│  Custom Schema、config.yaml 规则、validate/verify/archive      │
│  graphify-out/graph.json:结构化事实(query/path/explain/update)│
├──────────────────────────────────────────────────────────────┤
│ Agent 层(可替换)                                              │
│  批准的执行 agent(如 Copilot)+ 独立上下文 Reviewer           │
│  asdlc CLI(init/lint/apply/verify/archive/review)+ AGENTS.md  │
├──────────────────────────────────────────────────────────────┤
│ 知识层                                                         │
│  规格站点 / Graphify 派生的代码知识图谱 / ADR / 检索           │
└──────────────────────────────────────────────────────────────┘
```

**与其他框架/工具的关系(组合,不是二选一):**

| 来源 | 吸收的内容 | 不吸收 |
| :--- | :--- | :--- |
| OpenSpec | 增量规格、Change 生命周期、archive 合并主规格 | 不 fork 核心 |
| Graphify | 本地确定性 AST 解析产出的知识图谱(query/path/explain/update) | 不直接依赖社区的 graphify-openspec-bridge 包(§15 说明原因) |
| Spec Kit(思想) | analyze(实施前一致性检查)、converge(实施后缺口发现) | 整套 Process Harness |
| AWS AI-DLC(思想) | 澄清记录、追加式审计、共同细化评审 | 整体流程 |
| Superpowers(思想) | 任务级 TDD、独立评审、完成前验证 | 安装该框架本身 |
| Kiro(思想) | runtime 拦截危险动作 | 仅作开发体验层,不作强制 |

---

## 3. asdlc 分发与安装(修复 #0)

**不推送到公网 npm registry,只有两条路径可选,按规模和既有基础设施二选一:**

| 方式 | 做法 | 适合 |
| :--- | :--- | :--- |
| **本地 tarball(推荐起步)** | 平台团队 `npm pack` 产出 `asdlc-<version>.tgz`,发布到内部制品库(Artifactory/Nexus 的 generic/npm repo,或内网共享盘);开发者 `npm install -g <内部地址>/asdlc-<version>.tgz` | Phase 0-2,规模小、验证阶段 |
| **内部私有 npm registry** | 用现有 Artifactory/Nexus/Verdaccio 起一个私有 npm registry,`.npmrc` 指向内部 registry,`npm publish --registry <内部地址>`,开发者端正常 `npm install -g asdlc` | Phase 3 起,规模变大、需要版本检索和权限管理时切换 |

**不选的方式:** 不用 `npm install git+<url>`(每次安装都要拉全部 git 历史,版本不可控、无法做 §16 的 lock 机制);不用 `npm link`(只适合开发机调试,不是分发给全体开发者的方式)。

```bash
# 本地 tarball 方式的开发者体验
npm install -g https://internal-artifactory/asdlc/asdlc-1.4.0.tgz
asdlc --version
```

版本号与 §16 的 `asdlc.lock` 绑定,见该节。

---

## 4. asdlc init 编排(修复 #1)

```text
asdlc init
   │
   ├─1─▶ 检查/安装 OpenSpec CLI(npm install -g @fission-ai/openspec,版本按 asdlc.lock 锁定)
   │
   ├─2─▶ 检查/安装 Graphify(按 §15 的实现选型;版本按 asdlc.lock 锁定)
   │
   ├─3─▶ openspec init
   │        └─ 企业自定义 schema(proposal/specs/design/tasks/review)写入
   │        └─ 钩子:openspec init 完成后自动触发 graphify init(见下)
   │
   └─4─▶ graphify init(可以被 §3 的钩子自动带出,也支持单独调用)
            └─ 首次全量建图:graphify . → graphify-out/graph.json
            └─ 把 graph 路径写入 openspec/config.yaml 的 context 字段
            └─ 生成/更新 AGENTS.md 的"如何查询现状"章节
```

**一条命令完成端到端初始化:**

```bash
asdlc init
# 等价于:
#   openspec install (若未装) && graphify install (若未装)
#   && openspec init
#   && graphify init   # 由 openspec init 的 post-init 钩子自动触发
```

`graphify init` 折进 `openspec init` 的钩子里是你在需求里提出的方案,**可行且推荐**——因为两者的初始化顺序有强依赖:`graphify init` 产出的 graph 路径需要写进 `openspec/config.yaml`,必须在 `openspec init` 生成该文件之后才能写入,所以钩子化比两个独立命令更不容易被开发者漏执行一步。

---

## 5. 角色与职责

(与 v6 §3 相同,未发现偏差,原样保留)

| 角色 | 职责 |
| :--- | :--- |
| 开发者(作者) | 与 agent 迭代规格、实现、处理评审意见 |
| 规格批准人(产品/架构/tech lead) | 批准规格意图;批准实现阶段的规格修订 |
| 设计负责人 | 评审 design.md 的变更 |
| 代码 owner | 评审实现 PR(例外式) |
| 平台团队 | 维护策略、守卫、Jenkins 共享库、自主度登记表、**asdlc.lock**(§16) |
| 合规/风险 | 审批 AI 工具准入、数据分级、留存期限、模型使用边界 |
| 倡导者(每团队 1 人) | 培训、收集摩擦、每周反馈 |

**Maker-Checker:** 发起 prompt 并推送的人不能是该 PR 的批准人。

---

## 6. Change Package 与产物分档

(与 v6 §4 相同,未发现偏差,原样保留)

```text
openspec/changes/<JIRA>-<n>/
├── proposal.md        # 为什么改、影响范围
├── explore.md          # graphify 查询结果:受影响的模块/依赖路径(新增,见 §7.1)
├── specs/**            # 增量规格:需求、场景(BDD)、验收标准、契约、NFR 场景
├── design.md           # repo 内部技术设计、测试策略
├── tasks.md             # 任务清单(可含初稿,实现阶段可改)
├── clarifications.md   # 可选:关键问答与取舍
└── review.md            # Jenkins 生成的评审记录(追加式版本)
```

| 档位 | 路径 | 谁能改 | 改动时的平台要求 |
| :--- | :--- | :--- | :--- |
| **锁定(apply 前)** | proposal.md、specs/** | 通过 PR,仅限 change 尚未进入 apply 阶段 | 规格批准人批准 + AI Review + 必填修订原因 + review.md 追加版本 |
| **锁定(apply 后)** | proposal.md、specs/** | **【v8 变更】物理不可改**,一旦该 change 的 Impl PR 已开出,CI 直接拒绝任何修改这两类路径的提交 | 不存在"改动时的要求"这一说——唯一出口是 supersede(§8.1),新开一个 change |
| **受控** | design.md | 通过 PR | 设计负责人批准 + AI Review 重跑 |
| **参考** | explore.md | 通过 PR,机器生成为主 | 无额外审批,但归档时保留作为"当时为什么这么设计"的证据 |
| **自由** | tasks.md、clarifications.md | 通过 PR | 无额外要求 |
| **机器生成** | review.md | 仅 Jenkins 身份 | 平台限制人工修改 |

"批准提交"定义不变:`git log -1 <main> -- proposal.md specs/`。**v8 新增:CI 的锁定路径修订规则(§9.2 第 6 项)现在区分"apply 前修订"(走原有批准流程)和"apply 后修订"(直接拒绝,引导走 §8.1 的 supersede)——判定依据是该 change 目录下是否已存在任何 Impl PR 的历史记录。**

---

## 7. 端到端流程(修复 #2 / #4 / #5 / #6)

### 7.1 规格阶段(迭代,全部发生在 spec 分支 + PR 上)

```text
skill: asdlc explore(对应 /opsx:explore,但强制先刷新图谱)
   ① graphify update .          ← 必须先做,刷新知识图谱到最新
   ② graphify query <领域关键词> ③ graphify path ④ graphify explain
   ⑤ 产出 explore.md:受影响模块、调用链、现有契约
   ↓
/opsx:new(或 propose)→ 生成 change 与初始产物
   注意:propose 阶段读取的"系统现状"一律来自 explore.md 里 graphify 查询的
   结构化结果,agent 不被允许在这一步直接通读源码来猜测结构
   ↓
与 agent 对话、或直接手改产物,反复迭代
   ↓
本地 asdlc lint spec(修复 #3,见 §10.1)+ openspec validate --strict
   ↓
skill: asdlc submit-spec
   守卫检查 → 推送分支 → 开或更新 Draft PR
   ↓
标记 Ready for review
   ↓
Jenkins:validate → AI Review(全新上下文)→ 提交 review.md 到 PR 分支
   ↓
人工评审 → 意见 → 作者修订 → 新推送使批准作废 → Jenkins 重跑
   ↓
批准并合并(squash)= 规格 approval 证据
```

- **这是对 v6 最关键的修正:** v6 原文"对大型代码库,官方建议先用 `/opsx:explore` 让 AI 了解真实结构"这句话容易被实现成"agent 读代码",v7 明确把 explore 定义成"先 `graphify update`,再对图谱做结构化查询",产出 `explore.md` 作为独立产物沉淀下来,而不是 agent 读完代码就丢掉的临时上下文。
- AI Review 触发策略、维度、Reviewer 独立性要求与 v6 一致,不变。

### 7.2 实现阶段(修复 #4 / #5)

```text
skill: asdlc start-impl
   守卫:规格已合并 main?Jira 一致?→ 切 impl/<JIRA>-<n>(基于最新 main)
   → 生成或更新 tasks.md
   ↓
asdlc apply 按任务组执行(可跨多个会话),每个任务:
   ① 先写会失败的测试
   ② 实现
   ③ 全新上下文评审者:先对照规格,再看代码质量
   ④ 声称完成前必须运行测试并贴出输出
   ⑤ 【修复#4,新增】任务级 converge 检查:
      本任务完成后,立即对照 specs/** 做一次轻量一致性检查,
      发现缺口按 §8 分类(A/B/C),不等全部任务做完才处理——
      这样 C 类(规格缺口)能在影响范围还小的时候被发现,
      而不是积累到最后一次性暴露
   ↓
asdlc verify(全新上下文)→ 验证报告:
   ① 需求 → 实现 → 测试 的映射(Converge 报告,Report First)
   ②【修复#5,新增】显式对照 tasks.md 的勾选状态,
      标记"规格有要求但没有对应已完成 task"或"task 完成但未关联任何规格条目"的情况
   ↓ 有阻断项则回到 apply 修复,循环
开 Impl PR(模板自动填 Jira、批准提交、验证输出)
   ↓
CI 全绿 → 代码 owner 例外式评审 → squash 合并
```

### 7.3 归档阶段(修复 #6)

```text
asdlc archive(对应 /opsx:sync + /opsx:archive)→ Archive PR(机器人发起)
   PR 含:
   ① 变更目录移入 archive/、增量并入 openspec/specs/
   ② 校验:被移动文件内容与批准时一致
   合并 →
   ③【修复#6,新增】触发 graphify update(刷新知识图谱,反映本次变更后的真实结构)
   ④【修复#6,新增】触发 AGENTS.md 增量刷新(基于新图谱,而不是等固定周期)
   ⑤ 触发 KB 重建(与 ③④ 同一触发点,不再是三个互相脱节的动作)
```

- **这是对 v6 的第二处关键修正:** v6 把 AGENTS.md 刷新放在 §9,和"架构有重大变化或按固定周期"挂钩,等于说系统现状的刷新默认是滞后的。v7 把它和 archive 事件绑死——每次 archive 都意味着系统状态发生了真实变化,图谱和 AGENTS.md 应该跟着每次 archive 同步更新,而不是等下一个周期。
- 如果多个 change 同时改同一主规格,archive 时可能冲突,由 Archive PR 的合并流程暴露,不放进日常开发路径(与 v6 一致)。

---

## 8. 规格缺口(SPEC_GAP)与缺陷处理(v8 重写 C 类)

| 类别 | 例子 | 动作 |
| :--- | :--- | :--- |
| A. 实现错误 | 代码不满足已批准场景 | 先写复现测试,在 tasks.md 追加修复任务,留在 Impl PR |
| B. 测试缺口 | 某条验收标准没有对应测试 | 补测试,留在 Impl PR |
| C. 规格缺口/错误【v8 改动】 | 规格未覆盖、互相矛盾、需改变行为或契约 | agent 停止相关任务,输出 SPEC_GAP 报告;经作者确认后,**不在同一 PR 内修改规格,走 §8.1 的 supersede 流程** |
| D. 合并后才发现 | 测试/线上缺陷 | 新建 Jira Bug;已批准规格写明了正确行为 → Bugfix 快速通道;**规格本身有问题 → 同样走 §8.1 的 supersede 流程** |

**v8 之后 C 类和 D 类在"规格需要改"这一分支上统一成同一套机制(§8.1),不再是两条平行路径。** C 类的触发时机可能早至 §7.2 的任务级 converge 阶段(任务做完立即发现),也可能晚至 verify 阶段;D 类通常是合并后才发现。不管哪个时机触发,只要结论是"规格需要改",走的都是 supersede,不存在时机不同就走不同流程的情况。

### 8.1 Supersede 机制(v8 新增)

**核心规则:一个 change 的 Impl PR 一旦开出,`proposal.md`/`specs/**` 物理不可再改。** 需要改,就把当前 change 标记为 `SUPERSEDED`,新开一个 change,从零走完整的 Spec PR 审批生命周期——不存在"走个流程在原 PR 里偷偷改掉"的空间。

```text
openspec/changes/TECH-1888-1/   status: SUPERSEDED → superseded_by: TECH-1888-2
openspec/changes/TECH-1888-2/   status: ACTIVE,全新走一遍 proposal→spec→审批
```

**四个必须显式定义的细节,否则规则会在执行层面漏掉:**

1. **已批准的 review.md / verify 报告全部作废。** 它们验证的是一份已经不存在的规格,不能作为新 change 的证据延续使用,新 change 必须重新走一遍 AI Review 和 verify。
2. **旧 Impl PR 直接关闭,不合并、不保留修改。** 避免 git 历史上出现"一个 PR 的 diff 横跨两份不同的已批准规格"这种审计噩梦。
3. **旧分支上已写的代码可以作为参考 diff 被新 change 的 apply 阶段复用**,但复用的代码必须在新 change 下重新经过完整的任务级 TDD、全新上下文评审、verify,不能带着旧的"已验证"标签直接搬过去——证据链要干净,但不要求推倒重写,工程量不浪费。
4. **tasks.md 的继承:** 新 change 起草时,由 agent 自动对比新旧 specs 的 diff——不受规格变更影响的已完成任务直接标记继承,受影响的任务重新生成,不需要人工逐条核对。

**边界情况(默认从严,保留调整空间):** 如果发现的只是一处不改变语义的 typo(比如 AC 里数字小数点写错,场景描述本身没问题),严格按上述规则也要整体 supersede,代价偏高。**默认处理方式是:typo 同样走 supersede,不开例外口子**——简单和可审计性优先于省一点小成本,这类"例外"历史上正是侵蚀铁律的起点。如果你们判断确有必要为纯格式类改动开一个窄口子(标注修订原因 + 重新 validate,不触发 supersede),需要显式在 policy.yaml 里定义"纯格式改动"的判定标准(不触碰 Given/When/Then 和验收标准正文),并接受这是对"apply 后物理不可改"这条铁律的唯一例外。

### 8.2 SUPERSEDED 的 change 不能被 apply(v9 新增)

Supersede 规则本身只有在**没人能对一个已经 SUPERSEDED 的 change 继续跑 apply/verify/archive** 的前提下才成立,否则规则只是写在文档里,没有被真正强制。需要一个机器可读的状态标记,外加本地和 CI 两处守卫,和 §1 第 5 条"同一份守卫,两处运行"同一个模式。

**状态文件(机器生成,和 review.md 同一保护等级,仅 supersede 自动化能写):**

```yaml
# openspec/changes/<id>/.sdlc-state.yaml
status: ACTIVE            # ACTIVE | SUPERSEDED
supersededBy: null         # 例:TECH-1888-2,仅 status=SUPERSEDED 时有值
supersededAt: null
supersededReason: null     # 指向触发 supersede 的 SPEC_GAP 报告,留痕用
```

**本地守卫(`asdlc apply` / `asdlc verify` / `asdlc archive` 执行前的第一步):**

```text
asdlc apply <change-id>
   ① 读取 openspec/changes/<change-id>/.sdlc-state.yaml
   ② status == SUPERSEDED?
        是 → 直接拒绝执行,不调用底层 openspec apply/verify/archive,
             报错信息里带出 supersededBy 指向的新 change id,
             提示开发者应该切到新 change 上继续工作
        否 → 正常走 §7.2/§7.3 流程
```

**CI 必需检查(真正的强制点,新增进 §9.2 必需检查列表第 12 项):** 本地守卫只是开发体验层,能被绕过(比如直接调用底层 `openspec apply` 而不走 `asdlc` 包装)。**真正的强制必须落在 CI**——任何 Impl PR,只要其 change 目录的 `.sdlc-state.yaml` 显示 `status: SUPERSEDED`,CI 一律拒绝,不管本地有没有跑过守卫、本地代码写得多完整。这条检查判定依据只有一个文件的一个字段,成本极低,可以放进 §9.2 必需检查列表,作为阻断项,不走"先参考后阻断"的渐进策略——因为一旦放过,后果是允许一份已经被认定有问题的规格继续被实现,这不是一个适合观察误报率再决定的规则。

**自动关闭:避免"已经作废的分支还开着 PR"。** 触发 supersede 的自动化(即新 change 创建、写入旧 change 的 `supersededBy` 的同一个动作)应该同时:对旧 change 对应的任何已开启的 Impl PR,由机器人自动关闭并留言说明原因、附上新 change 的链接——这样"状态文件说已作废,但 PR 列表里还挂着一个活的 PR"这种人工容易漏掉的不一致情况,不依赖人去手动清理。CI 检查(上一段)是这个自动关闭失效时的兜底,不是唯一防线。

---

## 9. 强制机制(平台无关)

### 9.1 PR 类型:全部由路径判定

(与 v6 §7.1 相同,新增 explore.md 的处理规则)

| 类型 | 判定条件 | 平台要求 |
| :--- | :--- | :--- |
| Spec PR(首次) | change 目录不在 main 上,改动仅限该目录下的规格类文件(含 explore.md) | 规格批准人 + AI Review + validate |
| Impl PR | 含源码/测试;change 目录已在 main | 代码 owner + CI;触碰锁定路径叠加 §8 的修订要求 |
| Archive PR | 仅含变更目录移动与 `openspec/specs/**` 合并 | 内容一致性校验 |
| 快速通道 PR | 无 change 目录,改动路径全部命中策略白名单 | 代码 owner + CI |
| 紧急 PR | 由指定角色打 emergency 标记 | 见 §9.3 |

### 9.2 必需检查(先参考模式,再阻断)

1. 路径判定与 PR 类型合法性
2. `openspec validate --strict`
3. Jira 追溯:分支名、PR、change 目录、review.md 的 Jira 一致
4. AI Review 结论(通过 Jenkins 状态,绑定当前 head)
5. review.md 校验:被评审提交 = 当前 head 的父提交
6. 锁定路径修订规则(§8)
7. 需求到测试覆盖:每条验收标准至少映射一个测试
8. **【新增】explore.md 的 graphify 查询时间戳不早于本次 propose 的时间**(防止用过期图谱起草规格)
9. 契约/集成测试(Phase 3 起)
10. 策略/安全检查(密钥扫描、依赖、许可证)
11. 分支保护:禁止直推、批准后新推送作废、不允许作者自批
12. **【v9 新增】SUPERSEDED 拦截:读取 change 目录的 `.sdlc-state.yaml`,`status: SUPERSEDED` 一律拒绝合并,阻断项,不走参考模式(§8.2)**

### 9.3 策略文件(平台团队保护)

```yaml
# .sdlc/policy.yaml(示意)
locked_paths:   ["openspec/changes/*/proposal.md", "openspec/changes/*/specs/**"]
controlled:     ["openspec/changes/*/design.md"]
reference:      ["openspec/changes/*/explore.md"]
fast_path:
  allow_paths:  ["docs/**", "config/**/*.properties"]
  allow_kinds:  [typo, config-value, dependency-patch]
reviewers:
  spec:   "@org/spec-approvers"
  design: "@org/design-owners"
ai_review:
  trigger: on-ready-and-push
  debounce_seconds: 120
rollout_mode:    { path_check: block, ai_review: advisory }
```

### 9.4 review.md 的生成与保护

(与 v6 §7.4 相同,未发现偏差,原样保留)

---

## 10. 命令、skill 与 config 设计(修复 #3 / #7)

### 10.1 asdlc 命令面(修复 #3、#7,这是本版新增的完整命令表)

| 命令 | 对应 OpenSpec/Graphify 动作 | 做什么 | 本地可跑?CI 也跑? |
| :--- | :--- | :--- | :--- |
| `asdlc init` | openspec init + graphify init | §4 的编排 | 本地一次性 |
| `asdlc explore` | graphify update + query/path/explain | §7.1,产出 explore.md | 本地 |
| `asdlc propose` | openspec new | 生成 change 骨架 | 本地 |
| `asdlc lint spec`【新增,修复#3】 | 包装 `openspec validate --strict`,**外加**企业自定义规则 | validate 只检查结构/格式是否合法;`lint spec` 额外检查:场景是否真正可测试(不是复述需求)、AC 是否有具体可验证的断言而非形容词、是否每条需求都挂了 Jira 可追溯、BDD Given/When/Then 关键字是否齐全 | **本地 + CI 都跑**(同一份规则) |
| `asdlc submit-spec` | — | 守卫检查 + 推送 + 开/更新 Draft PR | 本地 |
| `asdlc start-impl` | — | 守卫检查 + 切分支 + 生成 tasks.md | 本地 |
| `asdlc apply` | openspec apply | §7.2,含任务级 converge;**执行前先查 `.sdlc-state.yaml`,SUPERSEDED 直接拒绝(§8.2)** | 本地,可跨会话 |
| `asdlc verify` | openspec verify | §7.2,含 tasks.md 勾选核对;**同样先查 SUPERSEDED 状态** | 本地 + CI |
| `asdlc review`【新增,修复#7】 | 包装同一套 AI Review 逻辑 | 本地手动触发一次 AI Review,**和 Jenkins 在 CI 里跑的是同一份规则实现**,让开发者能在推送前先自查,落实"同一份守卫,两处运行"的设计原则(§1 第 5 条) | **本地 + CI 都跑** |
| `asdlc report-gap` | — | 输出 SPEC_GAP 报告 | 本地 |
| `asdlc archive` | openspec sync + archive | §7.3,含 graphify update + AGENTS.md 刷新 | 本地发起,机器人代执行 |
| `asdlc upgrade` | — | 见 §16 | 本地/平台 |

AGENTS.md 一页纸路由规则(什么走规格、什么走快速通道)与 v6 一致,不重复展开。

### 10.2 config.yaml 与 Schema 要点

- **规格规则:** 每条需求至少一个场景和验收标准;必须含 Jira 编号;NFR 用场景表达;含测试策略;**explore.md 必须早于 proposal.md 存在**(强制顺序,防止跳过图谱查询直接写规格)。
- **apply 规则:** 任务级 TDD;全新上下文评审;完成前贴测试输出;任务级 converge 检查;发现规格问题只输出 SPEC_GAP 并停止,不得自行编辑锁定产物。
- **archive 指引:** 归档后触发 graphify update → AGENTS.md 刷新 → KB 构建,三者为同一条流水线的连续步骤。

---

## 11. 存量项目支持:上下文层 + 规格基线层(修正)

存量项目需要两类不同的东西:

| 层 | 回答的问题 | 载体 | 怎么建立 |
| :--- | :--- | :--- | :--- |
| **上下文层** | 系统现在是怎么构成的 | `AGENTS.md`、`openspec/config.yaml` 的 `context`、**graphify-out/graph.json** | **由 graphify 静态分析产出,agent 只读图谱不读码**(修正 v6 的"由 agent 扫描整理") |
| **规格基线层** | 系统应该做什么 | `openspec/specs/**` | 渐进补齐,见下 |

**上下文层的建立流程(替换 v6 原描述):**

1. `asdlc init` 触发 `graphify init`,对存量代码做一次全量建图。
2. AGENTS.md 的"系统现状"章节**由图谱数据生成,不是 agent 读代码总结的**——具体做法是跑一组固定的 graphify 查询(模块列表、对外接口、依赖最密集的 N 个节点),把结果格式化写入 AGENTS.md,这一步是确定性脚本,不经过 LLM 总结这一环节,避免总结失真。
3. 大型代码库首次建图成本可能较高,Phase 0 需要实测建图耗时,评估是否需要分批(按目录/模块)建图。
4. AGENTS.md 纳入 CODEOWNERS 保护;刷新触发点统一为 archive 事件(§7.3),不再依赖"固定周期"这种容易被忽略的触发方式。

**规格基线层(渐进补齐,与 v6 一致,不重复展开):**

- 增量规格(ADDED/MODIFIED)本来就适合存量项目;已知的 OpenSpec 行为约束(ADDED 创建新主规格、MODIFIED 对不存在的主规格是阻断性错误)仍需在锁定版本上验证。
- 覆盖不完整的风险通过基线覆盖率指标和目录标注缓解。

---

## 12. 知识库(KB)

(与 v6 §10 基本一致,触发点统一到 archive,见 §7.3)

| 来源 | 内容 | 方式 |
| :--- | :--- | :--- |
| 意图知识 | `openspec/specs/**`、批准记录 | 站点生成器直接发布,确定性 |
| 决策知识 | ADR | 设计评审通过后由 agent 起草,人确认 |
| 代码派生知识 | graphify 知识图谱 | archive 事件统一触发刷新(§7.3),必须可自托管、不出内网 |

---

## 13. 分级路线图(沿用 v5/v6,按数据推进)

| 阶段 | 时长 | 范围 | 进入下一阶段的条件 |
| :--- | :--- | :--- | :--- |
| **Phase 0** | 2–4 周 | 验证 OpenSpec + Graphify 能力;asdlc 打包分发原型(§3);Custom Schema、样例、指标基线 | 关键假设全部验证或有退路 |
| **Phase 1** | 4–8 周 | 单 repo、1–2 条真实变更,人工主导;不做 CI 阻断;验证 explore→graphify 的流程体验 | 流程被真实使用,收集摩擦与误报 |
| **Phase 2** | 2–3 个月 | AI Review 作参考;CI 加路径判定、追溯、review.md 校验、explore.md 时效性校验;低风险类型尝试 repo 级 A2 | AI 一致率、误报率、使用率达标 |
| **Phase 3** | 3–5 个月 | 首次真实 2-repo 依赖时引入 System Design、简化 Manifest、Context Index(由 graphify 承担底层抽取);AI Review 承担部分 gate | 跨 repo 事故/返工出现可量化证据 |
| **Phase 4** | 5–8 个月 | 完整 CI Gate;10+ repo 时组合级看板;repo 级低风险类型到 A3 | — |

---

## 14. 成熟度与度量

(与 v6 §12 一致,新增一项指标)

### 14.1 成熟度刻度

| 级 | 名称 | 特征 |
| :--- | :--- | :--- |
| L1 | AI-Assist | 个人使用补全/对话,无共同流程 |
| L2 | SDD 试点 | 规格先行,人工评审,无平台强制 |
| L3 | 受治理 | 路径判定、追溯、review 记录由平台强制 |
| L4 | 多 repo 协调 | System Design、Manifest、Context Index 运行 |
| L5 | 组合级 | 组合看板、按类型的自主度登记与自动升降级 |

### 14.2 指标(自动采集)

与 v6 §12.2 一致,新增:**【新增】图谱新鲜度**——graphify 图谱距上次刷新的时长、archive 后图谱刷新成功率,来源为 Jenkins 打点。

**【v8 变更】"规格修订次数"指标重新定义:** 不再统计同一 change 内部的修订次数(这个概念在 v8 下不存在,apply 后规格物理不可改),改为统计**一条 Jira Story 产生的 supersede 链长度**——同一个 Jira Story 因为规格缺口被 supersede 了几次(`TECH-1888-1 → TECH-1888-2 → TECH-1888-3 ...`)。链长度异常(比如同一 Story 被 supersede 超过 2-3 次)应该触发和原指标同样的信号:说明前期 explore/propose 阶段的质量不够,值得被纳入该变更类型的自主度降级判断(§14.3)。

### 14.3 自主度登记表

与 v6 §12.3 一致,不重复展开。

---

## 15. graphify 集成的行业对标评估:是不是"行业顶配"

你问得对,这个需要如实核查,不能想当然。结论分两层:**整合思路是对的、而且已经有人验证过同一个方向;但这个方向目前没有成熟、被广泛采用的标准实现,"行业顶配"这个词目前名不副实——你们如果现在做,大概率是这个方向里最早的一批认真落地者,不是在采用一个已经成熟的行业方案。**

### 15.1 已经存在的同方向实践

市面上确实有一个开源项目在做一模一样的事:把 OpenSpec 和 Graphify 桥接起来,用一个自定义 Schema 定义五段式产物流水线——proposal(为什么)→ explore(查图谱)→ specs(做什么)→ design(怎么做)→ tasks(谁来做),并且在每个阶段显式绑定对应的 graphify 命令:proposal 阶段用 `graphify query <领域>` 取上下文,explore 阶段综合用 query/path/explain 画出受影响范围,apply 完成时自动跑 `graphify update` 刷新图谱。

**这个发现直接验证了你们的方案方向——v7 §7.1/§7.3 的设计和这个项目的思路几乎一致**,不是我们凭空想出来的,是已经有人用同样的逻辑验证过这条路线是可行的。

### 15.2 但它不是"行业顶配",如实列出理由

- **采用度几乎为零。** 这个桥接项目 0 star、0 fork、6 次提交、单一维护者——不是被企业验证过的成熟方案,是一个个人的概念验证项目。
- **OpenSpec 官方和 Graphify 官方都没有互相背书。** 两边都没有把对方列为官方集成或推荐组合,这个桥接完全是第三方自发拼接的。
- **底层 Graphify 本身是 Python 工具**(`pipx install graphifyy`),这对一个要求"纯 npm 安装、不碰 pip/pipx"的银行级环境是一个额外的运行时依赖和供应链面,需要单独评估。好消息是已经出现了面向这个问题的移植版本——一个 Go 重写版本(零 Python 依赖、号称快 20 倍)和一个 Node/TypeScript 移植版本(纯 npm 包装),这两个选项都比原始 Python 版本更贴近"asdlc 纯 npm 生态"的要求,但它们各自的成熟度、维护活跃度、和原版的命令输出兼容性,都需要在 Phase 0 实测验证,不能假设三个版本行为完全等价。
- **命名冲突风险。** "graphify"这个名字在 npm/GitHub 上被至少 4-5 个互不相关的项目占用(React 组件可视化工具、图形布局工具、另一个独立的代码可视化工具 codebase-vis 等),引入依赖和内部文档时必须用精确的包名/仓库地址消歧,不能只靠"graphify"这个名字搜索确认。

### 15.3 结论与建议

**不要直接把那个社区桥接包(`graphify-openspec-bridge`)作为依赖项拉进银行的供应链里**——单一维护者、零审查、零对外承诺的稳定性,这在你们这种监管环境下是不可接受的依赖风险。

**正确的做法,和 v4/v5 里"Adopt the engine, own the governance plane"是同一个原则的延伸:把这个桥接项目当作一份免费的参考设计(five-artifact pipeline + 每阶段绑定的 graphify 命令),自己在 asdlc 内部实现等价的逻辑**(就是本版 §4、§7.1、§7.3 做的事),不引入这个外部包本身作为运行时依赖。这样既拿到了"已经被验证过的设计思路"这个好处,又不背负"依赖一个随时可能停止维护的个人项目"这个风险。

**对 Graphify 本体的建议:** 纳入 §16 的 Adapter Boundary 和版本锁定机制,Phase 0 同时测试 Python/Go/Node 三个实现版本的命令输出一致性,优先选择能让 `asdlc` 保持纯 npm 安装链路的版本(Node 移植版本或走 Go 二进制分发都能做到),除非测试发现成熟度/功能完整性有明显差距迫使你们暂时接受 Python 依赖。

---

## 16. asdlc / OpenSpec / Graphify 升级策略

三个组件独立演进、版本节奏完全不同(asdlc 是你们自己的内部发布节奏;OpenSpec 和 Graphify 是外部开源项目,各自按自己的节奏发版),**不能假设它们互相兼容,必须显式管理。**

### 16.1 核心机制:asdlc.lock,只有平台团队能改

```yaml
# asdlc.lock(和 .sdlc/policy.yaml 一样,平台团队保护,团队不能改)
asdlc: 1.4.0
openspec: 1.3.1
graphify:
  impl: node        # python | go | node,见 §15.3
  version: 0.9.2
compatibilityValidatedAt: 2026-10-05
contractTestsPassed: true
```

`asdlc init`/`asdlc upgrade` 安装的 OpenSpec 和 Graphify 版本,**必须严格等于这个文件里锁定的版本**,不允许开发者本地自己升级子依赖——这和 v4 §9 对 OpenSpec 定的"不 fork、Pin 版本、用 Adapter Boundary 隔离"原则是同一套逻辑,现在扩展到了 Graphify 和 asdlc 自己身上。

### 16.2 三类升级,流程不同

| 升级对象 | 触发 | 验证方式 | 谁批准 |
| :--- | :--- | :--- | :--- |
| **asdlc 自身**(命令、skill、policy 逻辑) | 平台团队发新版本 | 跑一遍 §16.3 的 asdlc 自测套件 + 在一个 canary repo 上以 `rollout_mode: advisory` 跑一轮真实 pilot | 平台团队 |
| **OpenSpec**(外部依赖) | 上游发版 | 跑 v4 §9 已定义的 `enterprise-sdd-contract-tests`(custom schema 能加载、apply/verify/archive 行为符合预期) | 平台团队,通过后才改 asdlc.lock |
| **Graphify**(外部依赖) | 上游发版,或切换实现(如 Python→Node) | 新增 `enterprise-graphify-contract-tests`(见 §16.3) | 平台团队,通过后才改 asdlc.lock |

### 16.3 Graphify 专属的 Contract Test(本版新增,之前只有 OpenSpec 有)

升级 Graphify 版本或切换实现之前必须全部通过:

1. 对一个固定的参考代码库跑 `graphify update`,进程退出码为 0
2. `graphify query`、`graphify path`、`graphify explain` 对同一组固定问题返回的结构(字段名、类型)与上一版本兼容,**允许内容更准确,不允许字段结构breaking change**
3. `graphify-out/graph.json` 的 schema 版本号被 asdlc 读取并校验,不兼容则 `asdlc init`/`asdlc explore` 直接拒绝启动并报错,不允许静默降级使用
4. 建图耗时在约定的 SLA 内(对存量大型 repo 的建图时间,见 §11)

### 16.4 asdlc 自身的自测套件

升级 asdlc 本身(命令逻辑、policy 解释器)之前:

1. §10.1 命令表里每条命令跑一次端到端 smoke test(init/explore/lint/apply/verify/archive/review)
2. 守卫规则的"本地 + CI 两处运行"一致性测试——确保本地 `asdlc lint`/`asdlc review` 和 Jenkins 里跑的判断结果一致,这是防止两份逻辑分叉的关键测试
3. 在至少一个 canary repo 上以 advisory 模式跑真实的一轮规格→实现→归档,人工确认行为符合预期

### 16.5 `asdlc upgrade`:开发者侧,默认拿到"平台团队已放行的最新"

**这里的"最新"不是"OpenSpec/Graphify 上游刚发布的最新",而是"`asdlc.lock` 当前记录的最新"——这两者是两回事,普通开发者只接触前者。**

```bash
asdlc upgrade
# 读取内部 registry 当前发布的最新 asdlc 版本(其 asdlc.lock 已由平台团队验证过)
# 若版本有变化,提示:新版本号、变更摘要链接、是否强制(平台团队可标记某次升级为强制)
# 执行:卸载旧版 openspec/graphify → 按新 lock 安装指定版本
# 升级后自动跑一次 `asdlc explore --self-check`(验证图谱/规格引擎均可用)
```

开发者**不能**单独升级 OpenSpec 或 Graphify 中的任何一个而不升级 asdlc,也**不能**让 `asdlc upgrade` 直接去拉 OpenSpec/Graphify 上游的最新发布版——三者作为一个整体版本单元发布,这是避免"这个人的 Graphify 比那个人的新,结果 explore.md 产出的字段都不一样"这类分叉问题的唯一可靠方式,也是让 §16.1 的 `asdlc.lock` 锁定机制真正生效、不被 `upgrade` 命令本身绕过的前提。

### 16.6 `asdlc platform refresh-lock`:平台团队侧,真正去追上游最新版(v10 新增)

**"追上游最新版本、决定要不要升级"这件事本身,不能是开发者敲一条命令就顺带触发的——这是一个单独的、有权限门槛的平台操作,只有平台团队能跑。**

```bash
asdlc platform refresh-lock
# ① 拉取 OpenSpec、Graphify 上游当前最新发布版本号(仅查询,不安装)
# ② 对比 asdlc.lock 当前锁定版本,列出有更新的组件
# ③ 对每个有更新的组件,跑 §16.3(Graphify)/ v4 §9(OpenSpec)已定义的 Contract Test
# ④ 全部通过 → 生成新的 asdlc.lock 草案 + 一份变更摘要,交平台团队人工确认后提交
#    任一项不过 → 停在原地,原样报告哪个 Contract Test 失败、失败在哪一步,
#                 不自动重试、不自动降级使用,等待平台团队处理
```

确认提交后的 `asdlc.lock` 才会被打进下一个 asdlc 发布版本,进入 §16.5 开发者 `asdlc upgrade` 能拿到的范围。**这条命令权限需要和 `asdlc init`/`asdlc apply` 这类日常命令分开(建议走独立的 RBAC 组,比如只有 `.sdlc/policy.yaml` 的保护组成员能执行),防止被误用成"开发者也能自己把 lock 推到未经验证的上游最新版"。**

### 16.7 两条命令的关系,一张图说清楚

```text
OpenSpec/Graphify 上游发新版
        │
        ▼
asdlc platform refresh-lock  ← 只有平台团队能跑,跑 Contract Test
        │ 通过
        ▼
   新的 asdlc.lock + 新的 asdlc 发布版本(推到内部 registry/tarball)
        │
        ▼
asdlc upgrade  ← 所有开发者能跑,拿到的就是上面这个已验证版本
```

两条命令分别对应"谁来判断新版本能不能用"和"谁来用上已经判断过能用的版本",职责不重叠,也不存在开发者能绕过 Contract Test 直接拿到上游最新版这条路径。

---

## 17. 治理原则(团队 constitution,不可谈判)

1. 已批准的规格以**批准提交**为唯一权威,PR 合并是 approval 证据,状态字段只是投影。
2. Converge = Report First:低风险缺口自动追加任务(任务级,见 §7.2);规格性变化必须经规格批准人批准。
3. Player 不能当 Referee:起草与评审使用不同上下文,尽量使用不同模型。
4. AI Review 的可信度用抽样人工复核的数据证明。
5. System Design 与 Repo Spec 的自主度独立评估。
6. 强制点在平台,不在 agent runtime。
7. 任何新规则先参考模式,再阻断。
8. 发起 prompt 并推送的人不能批准自己的 PR。
9. **【新增】系统现状来自结构化查询(Graphify),不来自 agent 读代码。**
10. **【新增】OpenSpec、Graphify、asdlc 三者版本作为一个整体单元发布,不允许局部升级。**
11. **【v8 新增】apply 开始后,规格物理不可修改。** 发现规格缺口只有一个出口:supersede(§8.1),不存在"在同一 PR 内悄悄改规格"的空间。

---

## 18. 风险与对应动作

(在 v6 §14 基础上新增 graphify 相关风险)

| 风险 | 对应动作 |
| :--- | :--- |
| OpenSpec 能力与版本变动 | 锁定版本;Phase 0 逐项验证;契约自有,可替换 |
| **【新增】Graphify 单一维护者/社区桥接包停止维护** | 不依赖外部桥接包,自建等价逻辑(§15.3);Graphify 本体也锁版本 + Contract Test(§16.3) |
| **【新增】Graphify 的 Python/Go/Node 三个实现行为不一致** | Phase 0 三选一前先跑对比测试;选定后用 Contract Test 固化,不随意切换实现 |
| **【新增】graphify-out/graph.json 对超大型存量仓库建图过慢** | Phase 0 实测,评估分批建图/增量更新策略 |
| 规格评审走形式 | 人工打回轮次、规格修订次数、缺陷逃逸数据观察 |
| AI Review 与起草同源 | 不同模型/供应商 + 确定性检查 + 抽样复核 |
| 数据与合规 | 仅使用批准的模型网关;数据分级;合规团队预先评审(包含 Graphify 的运行环境是否出内网) |
| 团队绕开流程 | 快速/紧急通道合法化;看板可见 |
| 存量测试基础设施薄弱 | pilot 准入前做测试健康度评估 |

---

## 19. 立即行动清单

**第 1 周(验证,决定后续设计):**

1. OpenSpec:Custom Schema 能否新增 explore/review 产物;`openspec update` 是否覆盖自有 skill;archive/sync 在多 change 改同一主规格时的行为。
2. **【新增】Graphify:在至少一个有代表性的存量 repo 上分别验证 Python/Go/Node 三个实现的建图耗时、query/path/explain 输出是否等价、CLI 参数是否兼容。**
3. **【新增】asdlc 分发:验证内部 tarball 分发或私有 npm registry 两种方式在你们现有基础设施(Artifactory/Nexus)上的可行性,产出 asdlc.lock 的首个版本。**
4. 平台:必需检查、CODEOWNERS 路径写法、批准后新推送作废、按路径限制推送。
5. Jenkins 无人值守调用 AI Review 的方式与模型网关。
6. 企业版 Copilot 如何加载自有 skill、如何实现独立上下文 Reviewer。
7. 存量场景:在真实的存量 repo 上跑一次"graphify init → explore → 首次触碰某能力"的完整流程。

**第 2–4 周:**

1. 建立指标基线(含图谱新鲜度);选定试点 repo;培训倡导者。
2. 产出 Custom Schema、config.yaml、AGENTS.md、asdlc 命令实现、PR 模板、policy.yaml 原型、asdlc.lock 原型。
3. 与合规/风险团队评审 AI 工具准入、数据分级、Graphify 运行环境(是否需要内网部署)。

---

# 附录 A:方案评审(Review)

(沿用 v6 的评审方法论,§A.3 主要发现基础上新增本版已处理的项目)

## A.3 主要发现(更新)

v6 原有的 10 条发现中,**第 6 条"存量:上下文层已具备,规格基线待验证"需要修正**——v7 已经把上下文层的实现方式从"agent 扫描"改为"graphify 结构化抽取",原先的"已具备"判断不再成立,应改为"⚠️ 待验证":需要在 Phase 0 实测 graphify 建图在真实存量代码库上的效果,这是新增的、优先级不低于原 10 条发现的验证项。

其余 9 条发现(关键能力未验证、评审工作量转移、AI Review 独立性、同 PR 内修订规格的风险、review.md 保护依赖平台、紧急通道与既有制度的关系、数据与模型合规、AI Review 成本、NFR 表达)维持 v6 的判断,不受本次修复影响。

**新增两条发现:**

11.【中】**graphify-openspec-bridge 不可直接作为依赖引入**,只能作参考设计——已在 §15.3 给出结论,不再是待决策事项。
12.【高】**asdlc 自身的分发与升级机制此前完全缺失**,v7 补齐后仍需在 Phase 0 验证内部制品库的实际可行性(§19 第 3 条),这是新的支点,优先级与 OpenSpec/Graphify 能力验证同级。
