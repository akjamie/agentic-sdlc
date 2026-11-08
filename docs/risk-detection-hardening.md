# Risk Detection Hardening Review
# 风险识别加固评审报告

> **Status / 状态**: Review findings + TL/TPO De-Risked Remediation Plan (v2.1) — **Not Yet Implemented** / 评审结论与经架构及产品纠偏后的低风险整改方案（尚未进入代码实现）
> **Scope / 范围**: `src/assess/**` 风险评估引擎、`src/commands/verify.js` 控制面门禁、`src/commands/pr.js`、`src/lib/prtype.js`、`src/lib/policy.js`、`src/lib/git.js`、`src/lib/speclint.js`、`src/lib/cliutil.js`
> **Audience / 受众**: Principal Engineer (PE) / Tech Lead (TL) / Tech Product Owner (TPO) / 平台与安全评审人
> **Related / 关联**: [autonomous-pipeline.md §3](./autonomous-pipeline.md)（`spec-first | auto` 双模式 RFC）、[architecture.md](./architecture.md)、[glossary.md](./glossary.md)

---

## 目录

1. [结论摘要](#1-结论摘要)
2. [评审方法与可信度说明](#2-评审方法与可信度说明)
3. [当前判级机制回顾](#3-当前判级机制回顾)
4. [系统性缺陷（跨技术栈）](#4-系统性缺陷跨技术栈)
5. [分技术栈发现（编程语言与框架层）](#5-分技术栈发现编程语言与框架层)
6. [控制面与信任边界缺陷（PE 视角）](#6-控制面与信任边界缺陷pe-视角)
7. [多国自然语言（UTF-8 / Unicode）工程底座缺陷（严禁按自然语言语种特判）](#7-多国自然语言utf-8--unicode工程底座缺陷严禁按自然语言语种特判)
8. [产品边界与明确非目标（避免过度设计）](#8-产品边界与明确非目标避免过度设计)
9. [四维稳健性综合评估（安全性、准确性、稳定性、易用性）](#9-四维稳健性综合评估安全性准确性稳定性易用性)
10. [整改方案（经 TL/TPO 防反噬纠偏）](#10-整改方案经-tltpo-防反噬纠偏)
11. [与 `autonomous-pipeline.md` 的职责分工边界](#11-与-autonomous-pipelinemd-的职责分工边界)
12. [验收标准与回归测试](#12-验收标准与回归测试)
13. [实施路线图](#13-实施路线图)
14. [已知局限](#14-已知局限)
15. [已拍板架构与产品决策（TL + TPO 决议）](#15-已拍板架构与产品决策tl--tpo-决议)
- [附录 A：探针用例清单](#附录-a探针用例清单历史测试输入样例非规则路径)
- [附录 B：复现方式](#附录-b复现方式)

---

## 1. 结论摘要

**从 Principal Engineer（信任边界与防绕过）、Tech Lead（多技术栈信噪比、架构可行性与国际化 UTF-8 底座）和 Tech Product Owner（全生命周期连贯性与研发采用率）三重标准审视，当前版本存在控制面信任倒置与技术栈规则漏检，但完全可在不破坏现有工作流与底层引擎的前提下平滑闭环收敛。**

- **架构底座扎实**：三向量评估（V1 意图 / V2 安全 / V3 拓扑）、单向棘轮防降级、无状态 Schema 与 Diff 截断（`test/pe-hardening.test.js` WS-1..WS-5）方向正确。
- **控制面存在信任倒置（PE 核心发现）**：`asdlc verify` 直接从不可信的当前 PR 工作区（`HEAD`）读取 `.sdlc/policy.yaml` 与 `openspec/config.yaml`（含 `gates.external` Shell 命令），PR 可将自身门禁改为 `advisory` 返回 `exit 0` 过审甚至注入命令；AI Verifier 将原始代码 `diff` 无随机边界裸拼进提示词，存在间接提示词注入面。
- **代码技术栈规则漏检高且误报伤及日常体验（Tech Lead 核心发现）**：硬编码路径正则主要围绕少数目录名；在 **120 个按 Java / Node.js / Python / Go / Quarkus / Kotlin / .NET 真实工程构造的用例**中，**97 个漏判（UNDER）、9 个误判（OVER）**，仅 14 个符合预期。同时前端目录、Monorepo 子包与普通需求文案频繁误触发 L2/L3。
- **自然语言（Human Language）处理误入“按语种写词典/算权重”歧途**：现有代码试图维护中英文风险关键词表（`cjkHighRiskCompounds`、`genericSecWords`）与中文翻译词表（`CJK_DOMAIN_LEXICON`）。**世界上人类自然语言太多（中、英、日、韩、德、法、西、俄等），绝不能靠识别或枚举某种人类自然语言来判断风险、算字数权重或翻译分支名**；底层只需做好通用的 **UTF-8 / Unicode 标准支持**（如 Git `core.quotepath=off`、剥离 UTF-8 BOM）。
- **架构与产品防反噬红线（TL + TPO 核心纠偏）**：
  1. **严禁再用人类自然语言（中文/英文词表或字符权重）做任何判断**：彻底删除 `v1_intent.js` / `v2_security.js` / `v3_topology.js` 中的自然语言词表，删除 `cliutil.js` 的 `CJK_DOMAIN_LEXICON` 字典，禁止按汉字/拉丁字母搞 `2.5x` 字符权重特判；Pre-Code 阶段（`new`/`lint`）靠 **Explore 命中的代码文件特征 + Spec 结构化契约块 + 宿主 Agent（`.agent-assess.json`）** 分流，Post-Code 阶段（`verify`）**100% 靠双向代码 Diff 实证**；
  2. **严禁破坏 `@fission-ai/openspec` 与原地升档特性**：保留业务仓极简 `openspec/config.yaml` 以兼容底层 OpenSpec CLI，仅将门禁控制项强制锚定 `<baseRef>`；保持 `Single-PR -> Impl 原地升档` 由 `human-gate` 闭环拦截，不破坏 Invariant #8；
  3. **严禁杀死 `L1` 快车道或自研重型跨模块编译器**：建立 **L0 + L1 双层正向安全包络**保住日常小改动的单 PR 体验；代码技术栈识别采用 **`<50ms` 轻量三层静态特征（框架 `import` 指纹 + 文件 Schema 头/DDL/配置键 + 标准构建清单）+ 可选 Graphify 1-hop 入边传播**，拒绝在 CLI 内手写重型多语言编译器。

| 严重度 | 维度 | 问题 | 核心收敛策略（低风险闭环） |
| :-- | :-- | :-- | :-- |
| **P0** | 控制面 (PE) | 策略与外部命令从不可信 PR 分支读取 | `verify` 强制从 `<baseRef>` 读取 `.sdlc/policy.yaml` 与门禁配置，禁止执行 PR 工作区未授信 Shell 命令 |
| **P0** | 控制面 (PE) | AI Verifier 缺乏随机边界隔离 | 随机 UUID Nonce 分隔符包裹 Diff + 严格 JSON 解析，异常一律 Fail-Closed |
| **P0** | 工程底座 (TL) | Git `core.quotepath` 非 ASCII 路径八进制转义 | `git()` 全局锁死 `-c core.quotepath=off`（标准 UTF-8 透传，与具体哪国语言无关）；移除 `pr.js` 暂存空 `catch` |
| **P0** | 风险识别 | docs / test 豁免先于风险规则 & L0 过宽 | 重构评估顺序：密钥与硬规则先于目录豁免；`docs/api/openapi.yaml`、`requirements.txt`、`CLAUDE.md` 移出 L0 |
| **P0** | 风险识别 | 增量密钥漏检 & 删除高危文件盲区 | 仅对 Diff 新增行（`+`）做高置信密钥扫描（排除 `${ENV}` 插值）；同时扫描 `<baseRef>` 被删文件内容防删库/删鉴权绕过 |
| **P0** | 风险识别 | 治理文件 / CI / 策略文件未受保护 | `.sdlc/**`、`CODEOWNERS`、`.github/workflows/*`、`openspec/config.yaml` 纳入 L3 强制人审 |
| **P1** | 架构范式 (TPO/TL) | 靠人类自然语言词表猜风险 vs. 写代码前无 Diff | **彻底废除一切人类自然语言词表与翻译字典**；拆分为 **Stage 1/2（Explore 命中代码文件 + Spec 结构化契约 + Agent 评估）** 与 **Stage 6（100% 代码 Diff 双向实证）** |
| **P1** | 采用率保护 (TPO) | 默认 L1 缺边界证明 vs. 一刀切 L2 杀死敏捷 | 建立 **L0（纯文档/测试）+ L1（有界局部代码正向包络）** 双层证明，既防风险逃逸又保住日常 L1 单 PR 体验 |
| **P1** | 代码技术栈引擎 (TL) | 写死目录名/层级导致 Java/Node/Python/Go 等漏检 | 落地代码轻量三层静态信号（框架 `import` 指纹、文件 Schema 头/配置键、标准构建清单/生成头）+ 可选 Graphify 1-hop 传播 |
| **P1** | 信噪比 (TL) | 误判治理与供应链 `scripts` 防护 | 剔除生成物（`*.pb.go`）、配对回滚迁移（`*.down.sql`）、前端 `axios`、MyBatis 纯 `<select>`；`package.json scripts` 变更保持 L2 |
| **P1** | 工程体验 (TL) | Spec Lint UTF-8 BOM、非 ASCII 标点与机械字数卡点 | 自动剥离 UTF-8 BOM；非 ASCII 标题冒号精准提示行号修复；简化 `Purpose` 为非空有效段落（不按任何自然语言语种搞字数权重折算） |
| **P2** | 平台适配 (TL) | 未知 Git 域名降级 & `CODEOWNERS` 联动 | 内网 Git / Codeup / Gitee 优雅降级输出手动 PR 指引；可选读取 `<baseRef>:CODEOWNERS` 辅助提权 |

---

## 2. 评审方法与可信度说明

- 通过直接调用 `assess()`（`src/assess/index.js`）、`runVerify()`（`src/commands/verify.js`）、`lintSpecDocument()`（`src/lib/speclint.js`）及真实临时 Git 仓库进行**实证探针测试**。
- 风险识别探针统一采用 `stage='impl'`、`requirement='update'`（刻意使用不含任何关键词的平淡需求，排除 V1/V2 的自然语言关键词干扰，只测代码"路径 + 内容"信号）；涉及**内容检测**的用例均在临时目录中**创建了真实代码文件**。
- 共五组实测探针：
  - **治理平面 / 通用路径（附录 A.0）**：19 个路径型补充用例。**不计入下文的 120。**
  - **Java / Python / Node / .NET / IaC（附录 A.1、A.6~A.8）**：69 个用例（UNDER 55 / OVER 7 / ok 7）。
  - **Java（Alibaba Cloud）/ Quarkus / Kotlin / Go（附录 A.2~A.5）**：51 个用例（UNDER 42 / OVER 2 / ok 7）。
    - 上述两轮合计 **"120 个用例" = 69 + 51；"97 漏判 / 9 误判 / 14 符合预期"**。
  - **PE 控制面与提示词隔离探针（`probe_pe.mjs`，第 6 节）**：验证工作区 `.sdlc/policy.yaml` 自降级绕过 `runVerify`、以及源码注释进入 AI Verifier Prompt 的注入面。
  - **UTF-8 非 ASCII 路径与 Spec Lint 探针（`probe_zh.mjs`、`probe_zhgit2.mjs`，第 7 节）**：验证自然语言词表误报/漏报、BDD 非 ASCII 标点与 UTF-8 BOM 报错、以及真实 Git 仓库下 `core.quotepath` 对非 ASCII 文件名的暂存丢失与风险降级。
- **"期望等级"是评审人（Tech Lead / PE）的工程判断，不是硬性规范。** 但 97/120 的漏判规模与控制面自篡改漏洞属于机制设计问题。
- **关于探针路径与真实多级目录的说明：** 附录 A 中的路径（如 `src/main/java/org/acme/OrderRest.java`、`src/main/resources/db/migration/...`）仅为喂给当前 `assess()` 的**测试输入样例（Test Fixtures），绝非整改规则本身**。事实上，早期探针用 `src/main/resources/db/V12__alter.sql`（不含 `migration/` 目录名）测试时即被漏判为 L1——这恰恰证明在分库分表、多数据源或多级目录（如 `db/mysql/2026/v2/V12__alter.sql`、`sql/ddl/release_1.2/init.sql`）下，靠目录名匹配迁移脚本完全不可靠。
- **一个推断而非实测的点：** Go 的 `cmd/api/main.go`（含 `echo.New()`）判 L2，但这是因为路径含 `api/` 目录**巧合命中**，并非识别了 `echo.New()`。按源码推断，`cmd/server/main.go` + `echo.New()` 会漏判，该变体未单独探针验证。

---

## 3. 当前判级机制回顾

```
changedFiles ─┬─► V1 意图   (需求文本关键词 / AI 语义判定 / 破坏性意图)
              ├─► V2 安全   (HARD_GOV_PLANE / SECURITY_CREDENTIALS / FINANCIAL / DESTRUCTIVE_DDL + 关键词)
              └─► V3 拓扑   (HARD_API_CONTRACT / DB_MIGRATION / SUPPLY_CHAIN / CI + Graphify 入度)
                      │
                      ▼
          decide.js: level = max(V1,V2,V3)，起点 L1
                      │  满足 "无强制人审 且 maxRank≤1 且 全为 doc/test" → L0
                      ▼
          governance.js: L0/L1 → single-pr + auto_approval=enabled
                         L2/L3 → spec-first + ai+human + auto_approval=disabled
```

关键位置：

| 位置 | 作用 |
| :-- | :-- |
| [`builtin.js` L38-158](../src/assess/rules/builtin.js) | `HARD_RULES`：全部为路径正则 |
| [`builtin.js` L165-182](../src/assess/rules/builtin.js) | `L0_DETERMINISTIC_PATTERNS`、`TEST_AND_DOC_PATTERNS` |
| [`decide.js` L40-51](../src/assess/decide.js) | 起点 `L1`，向上取 max |
| [`decide.js` L62-74](../src/assess/decide.js) | L0 判定（纯文档 / 纯测试） |
| [`v1_intent.js` L103-107](../src/assess/vectors/v1_intent.js) | `confidence=low` 仅在需求文本为空时出现 |
| [`v2_security.js` L16-53](../src/assess/vectors/v2_security.js) | 安全硬规则：仅路径 + `.sql` 内容 |
| [`v3_topology.js` L20-57](../src/assess/vectors/v3_topology.js) | API 内容检测：仅 6 种扩展名、十余个模式 |
| [`v3_topology.js` L28](../src/assess/vectors/v3_topology.js) | **docs / test 豁免在风险规则匹配之前** |
| [`governance.js` L18-23](../src/assess/governance.js) | L1 = 自动合入 |
| [`prtype.js` L22-25](../src/lib/prtype.js) + [`policy.js` L11](../src/lib/policy.js) | `fast_path` 默认放行 `docs/**` |
| [`pr.js` L574-580](../src/commands/pr.js) | Git 平台识别 |

---

## 4. 系统性缺陷（跨技术栈）

### D1（P1）默认 L1 缺少“有界局部代码正向包络（Bounded Envelope）”

没有命中任何规则的变更，无论改动了 1 个内部工具函数还是跨目录重构了 30 个核心业务类，一律为 `L1` 且 `auto_approval=enabled`（`confidence` 只在需求文本与变更文件同时为空时才变 `low`）。同时需要注意：**不能为了修复 D1 而把所有非文档改动一刀切判为 L2**（那会彻底杀死 `L1` 单 PR 快车道），而应建立 **L0（纯文档/测试）+ L1（未命中高危特征、变更文件数 ≤ 5、未触碰根导出与 God-Node）** 的双层正向包络。

### D2（P0）docs / test 豁免先于风险规则

[`v3_topology.js` L28](../src/assess/vectors/v3_topology.js) 对 `isTestOrDocFile(f)` 的过滤发生在风险规则匹配**之前**。凡位于 `docs/`、`doc/`、`test/`、`tests/` 目录下的文件，都不再参与契约规则评估。

实测：`docs/api/openapi.yaml`、`docs/swagger.json` 均为 **L0 + 自动合入**。很多团队恰好把 OpenAPI 放在 `docs/` 下。

此外，`fast_path` 默认放行 `docs/**`（[`policy.js` L11](../src/lib/policy.js)），在 `classifyPR` 中同样会把"全部在 `docs/**` 内"的 PR 判为 `fast`。**这个口子在 `spec-first` 模式下依然存在。**

### D3（P0）L0 的 `.md` / `.txt` 过宽

`L0_DETERMINISTIC_PATTERNS` 把所有 `.md` 与 `.txt` 当成文档。实测均为 **L0 + 自动合入**：

| 文件 | 实际性质 |
| :-- | :-- |
| `requirements.txt` | Python 依赖清单（供应链） |
| `CMakeLists.txt` | C/C++ 构建脚本 |
| `CLAUDE.md`、`.github/copilot-instructions.md`、`assets/commands/*.md` | **Agent 指令**（改动即改变 agent 行为，也是 prompt injection 入口） |
| `src/prompts/system.md` | **LLM 提示词**（AI 应用的生产逻辑） |

治理平面（`HARD_GOV_PLANE`）只保护 `AGENTS.md`、`openspec/config.yaml`、`SKILL.md`。

### D4（P0）无内容级密钥检测

没有任何规则扫描文件**内容**中的凭据。实测 `application-prod.yml` 含 `alibaba.cloud.access-key: LTAI…` 与 `secret-key` 时仍为 **L1 自动合入**。`.pem|.key|.p12` 等仅按**扩展名**判定。

### D5（P0）治理文件、CI、策略文件未受保护

| 文件 | 实测 | 风险 |
| :-- | :-- | :-- |
| `.github/workflows/*`、`Jenkinsfile`、`.gitlab-ci.yml`、云效 `.workflow/*` | L1（CI 规则命中后不提升等级） | 决定 `asdlc verify` 是否被执行，可被改成"不执行" |
| `.sdlc/policy.yaml` | L1 | `rollout_mode: advisory` 可把任意门禁降为 warn；`fast_path` 可放行路径 |
| `CODEOWNERS` | L1 | 直接改变谁能审批 |
| `src/assess/rules/*`（本项目自身） | L1 | 规则本身可被改写 |

一个 PR 可以先改掉门禁，再自己合入。

### D6（P1）写死目录名与固定目录层级，遇到多级目录或自定义包名即失效

1. **只枚举少数目录词**：`HARD_SECURITY_CREDENTIALS` 只匹配 `(auth|security|session|mfa|kms)/` 目录；`HARD_DB_MIGRATION` 只认 `migrations?/` 或 `db/(schema|models?)/`。
2. **写死相邻目录层级，无法穿透多级子目录**：
   - `/(^|\/)db\/(schema|models?)\//i`（[`builtin.js` L139](../src/assess/rules/builtin.js)）：一旦企业按数据源或版本增加多级目录（如 `db/mysql/v2/schema/order.sql`、`src/main/resources/db/mysql/2026_q4/V12__add_col.sql` 或自定义 `sql/ddl/release_1.2/alter.sql`），中间多出一级目录就立即失配降为 L1；
   - `/(^|\/)(pages|app|server|src)\/api\//i`（L108）：假设 `api` 紧贴 `src` 下一级，`src/v2/api/` 即失配；
   - `^\.github\/workflows\/`（L123）与 `^docs\/`（L166）：用 `^` 锁死仓库根，多模块嵌套时行为不一致；
   - `/(^|\/)(routes?\/|.*routes?\.)(ts|js)$/i`（L109）：正则本身存在编写缺陷（`routes?\/` 后漏写了 `.*\.`，导致 `src/routes/orders.ts` 或多级 `src/routes/v1/orders.ts` 根本无法匹配！）。
3. **不看代码文件内容语义**：`config/SecurityConfig.java`、`core/deps.py`、`common/guards/jwt.guard.ts`、`src/middleware.ts`、`pkg/interceptor/token.go` 等任意自定义包/目录下的核心文件全部漏判（L1）。

### D7（P1）契约识别仅覆盖 Spring MVC 等少数写法

- 路径规则：Java 只认 `*(Controller|Resource|Endpoint|Api).java|kt`；Python 只认 `router|controller|endpoint`；Node 只认 `routes?` 与 `*.controller.ts`；Go 只认 `handlers?|routers?|controllers?|api/` 目录。
- 内容规则（[`v3_topology.js` L20-24](../src/assess/vectors/v3_topology.js)）：仅 `@RestController`/`@Controller`/`@*Mapping`、`@app|router.get…`（带 `@` 的 Python 装饰器写法）、`APIRouter`、`gin.Default`、`router.HandleFunc`；且仅扫描 `.java|.kt|.py|.go|.ts|.js`（**不含 `.cs`**）。
- 缺失：JAX-RS `@Path`、Reactive Routes `@Route`、Dubbo、Feign、gRPC 注册、Kafka/RocketMQ 监听、Ktor `routing {}`、Express `router.get(`（无 `@`）、`@app.route`（Flask）、`gin.New`、chi、echo、fiber、`http.NewServeMux`、Django `urls.py`/`views.py`/`serializers.py`、Nest DTO/Resolver/Gateway、tRPC、GraphQL resolver、.NET Controller。

### D8（P1）SQL 与代码式迁移检测既漏检非标目录 DDL，又误报回滚脚本

- **非 `migration/` 目录下的普通 DDL 全漏**：若 `.sql` 文件不含 `DROP/TRUNCATE`，仅靠 [`builtin.js` L138](../src/assess/rules/builtin.js) 的 `migrations?/` 目录名识别 L2。只要项目使用多级自定义目录（如 `spring.flyway.locations=classpath:db/mysql/v2` 或 `sql/2026/11/alter_order.sql`）执行 `CREATE TABLE` / `ALTER TABLE ADD COLUMN`，全部漏判为 **L1**。
- **代码式破坏性迁移不可见**：[`v2_security.js` L27-36](../src/assess/vectors/v2_security.js) 内容级破坏性检测只看 `.sql` 扩展名；Alembic `op.drop_table`、Django `migrations.DeleteModel`/`RemoveField`、Go `AutoMigrate` 均不可见。
- **误报正常回滚脚本**：`migrations/*.down.sql`（golang-migrate 的正常回滚脚本）含 `DROP COLUMN`，被判 **L3 + 强制人工审批**。

### D9（P1）配置文件与供应链清单是盲区

- 运行配置：`application*.yml/properties`、`bootstrap.yml`、`quarkus` 的 `application.properties`、`microprofile-config.properties`、`gradle.properties`、`.mvn/settings.xml`、`.npmrc`、`next.config.js`、`appsettings.*.json`、`serverless.yml`——均为 L1。
- 供应链规则：`build\.gradle$` 以 `$` 结尾，**`build.gradle.kts`、`settings.gradle.kts`、`libs.versions.toml` 不匹配**；无 `pyproject.toml`、`poetry.lock`、`uv.lock`、`Pipfile*`、`bun.lockb`、`pnpm-workspace.yaml`、`*.csproj`、`go.work`、`vendor/`。
- IaC 规则只认 `helm/`、`k8s/`、`terraform/` 三个**目录名**：`infra/main.tf`、`charts/`、`kubernetes/`、`deploy/`、CDK、ROS、Serverless Devs、ACK 清单均漏判。

### D10（P1）误判伤害采用率

| 误判 | 原因 | 影响 |
| :-- | :-- | :-- |
| 任意 `package.json` → L2 | 供应链规则匹配所有路径 | monorepo 每个子包、Dependabot / Renovate 升级都要走 Spec PR |
| `src/api/**`（前端接口层）→ L2 | `(pages\|app\|server\|src)/api/` 匹配任意 `src/api/` | 每个 React / Vue 项目都会中招 |
| `auth/`、`session/` 下的 CSS → L3 + 强制人审 | 目录规则不区分文件类型 | 改样式要领导审批 |
| `app/main.py` → L2 | `(app\|api)/(main\|app)\.py` | 任意 CLI 的 `main.py` |
| `*Api.java`（出站客户端）→ L2 | 后缀匹配 | 把出站调用当成对外契约 |
| `*.pb.go` 在 `api/` 下 → L2 | 目录匹配 | `.proto` 已判 L2，生成物重复计分 |
| `*.down.sql` → L3 | 见 D8 | 见 D8 |

误判多了，团队会选择关闭 `auto`。**精度与召回同样重要。**

### D11（P2）Git 平台识别默认当 GitHub

[`pr.js` L574-580](../src/commands/pr.js)：`isGitHub = explicit==='github' || host.includes('github') || (!isGitLab)`。凡不是 GitHub、也不是 GitLab 的主机（云效 Codeup、Gitee、Gerrit、Bitbucket），都默认走 GitHub 路径：Tier 2 会拿 `GITHUB_TOKEN` 向 `/api/v3` 发请求，Tier 3 会生成 GitHub 格式的 compare 链接。

### D12（P2）图谱缺失时静默放行

[`v3_topology.js` L81](../src/assess/vectors/v3_topology.js)：`getGraphTopologyMetrics` 不可用时直接跳过 God-node 检查，无任何 `unresolved` 记录、不降低 `confidence`。God-node 阈值（入度 ≥ 20）写死，对小仓库永远不触发。

---

## 5. 分技术栈发现（编程语言与框架层）

> 记号：**期望** = 评审人期望的最低等级；**实测** = `assess()` 实际结果。表中左列路径仅为**探针测试输入样例**（完整清单见[附录 A](#附录-a探针用例清单历史测试输入样例非规则路径)），**绝非将路径写死进规则**。
> **设计红线（严禁写死业务包名/目录层级，同时严禁在 CLI 内重造多语言编译器）：** 真实企业项目的包名、子模块深度与目录层级千差万别（多级子目录、自定义 `sourceSets`、DDD/COLA），右列识别信号**一律与目录深度和业务包名解耦**，优先采用 `<50ms` 纯静态轻量三层信号：**① 第三方框架 `import` 指纹**、**② 文件内容 Schema 头/SQL DDL 语法/配置键**、**③ 编译器/工具链自身写死的标准清单文件名与生成物头**；辅以 **④ 可选 Graphify 1-hop 入边拓扑传播 + `CODEOWNERS` 兜底**（放弃重型跨模块 `pom.xml` 插件与 POJO 方法签名类型解析）。

### 5.1 Java / Spring

*注：当前引擎虽能命中教科书式的 `*Controller.java` 与 `db/migration/V*__*.sql`，但均靠脆弱的类名后缀或固定目录名命中；一旦换用自定义类名或多级分库目录即失效。*

| 漏判场景（左列路径仅为测试样例） | 期望 | 实测 | 与包名/目录深度无关的识别信号（轻量确定性） |
| :-- | :-- | :-- | :-- |
| 任意包下的鉴权配置与过滤器 | L3 | L1 | `import` 指纹：`org.springframework.security.*`、`cn.dev33.satoken.*`、`org.apache.shiro.*`、`io.jsonwebtoken.*`、`com.auth0.jwt.*`；或实现 `OncePerRequestFilter` / `HandlerInterceptor` / `GlobalFilter` |
| 任意包下的接口载荷纯 POJO（DTO/VO/Cmd） | L2 | L1 | **可选 Graphify 1-hop 入边 + 校验注解**：当 Graphify 图谱存在时，被第 1 层识别出的 Controller/RPC 文件直接 `import` 的文件升 L2；或含 `jakarta.validation.constraints.*` / `io.swagger.v3.oas.annotations.media.Schema` |
| Feign 出站契约 | L2 | L1 | `import org.springframework.cloud.openfeign.*` 或 `@FeignClient` |
| MQ 消息监听契约 | L2 | L1 | `import` 指纹：`org.springframework.kafka.*`、`org.springframework.amqp.*`、`jakarta.jms.*` |
| 多级/自定义目录下的 SQL DDL（如 `db/mysql/2026/v2/V12__alter.sql`） | L2 | L1 | **SQL 内容语法检测**：任意路径 `.sql` 文件内容含 `CREATE\s+(TABLE\|INDEX\|VIEW)`、`ALTER\s+TABLE` 等 DDL 即判 L2（含非配对回滚的 `DROP`/`TRUNCATE` 判 L3），彻底脱离 `db/migration/` 目录名依赖 |
| 核心运行配置 | L2 | L1 | 配置内容键特征：`spring.datasource.*`、`spring.security.*`、`server.ssl.*` |
| Liquibase 变更集（任意目录） | L2 | L1 | 文件内容 Schema 头：`databaseChangeLog`（XML xmlns 或 YAML 根键，无视目录深度） |
| MyBatis XML（任意目录，区分读写） | L1 / L2 | L1 | 文件内容含 `<!DOCTYPE mapper` 或 `<mapper namespace=`：纯 `<select>` 查询保持 **L1**（避免日常后台查询误触发双 PR 疲劳）；含 DDL、结构变更或无 `WHERE` 的 `<update>`/`<delete>` 升 **L2/L3** |
| JPA 持久化实体 | L2 | L1 | `import jakarta.persistence.*` / `javax.persistence.*`（`@Entity`、`@Table`） |
| `build.gradle.kts`、`libs.versions.toml` | L2 | L1 | Gradle 工具链标准文件名：`build.gradle(.kts)`、`settings.gradle(.kts)`、`libs.versions.toml` |

**误判：** `util/ExternalApi.java`（出站客户端）→ L2（仅因类名后缀含 `Api` 误判，应废除纯类名后缀硬规则，改看 `import` 与注解）。

### 5.2 Java / Alibaba Cloud 系列（Spring Cloud Alibaba、Dubbo、Nacos、RocketMQ、Seata、Sentinel、MyBatis-Plus、云效）

**0 / 16 符合预期。** Java 团队分层命名各异（`*-api`、`*-client`、`*-share`、`*-sdk`、`*-facade` 或混合业务包），绝对不能靠枚举包路径识别。

| 漏判用例（路径仅为示例） | 期望 | 实测 | 包名无关的识别信号（不猜业务目录/类名，不重造 Maven 解析器） |
| :-- | :-- | :-- | :-- |
| Dubbo `OrderFacade`（二方包接口） | L2 | L1 | `import org.apache.dubbo.*` / `com.alibaba.dubbo.*`；零注解纯接口通过 **Graphify 1-hop 入边**（被含 `@DubboService` / `@DubboReference` 的文件直接引用）或仓库 `<baseRef>:CODEOWNERS` 声明识别 |
| 二方包内的 `OrderDTO`（纯 `Serializable`） | L2 | L1 | 同上：Graphify 1-hop 被 RPC/Controller 文件直接 `import`，或含 `jakarta.validation.*` / OpenAPI `@Schema` 契约注解 |
| `@DubboService` 实现 | L2 | L1 | `import org.apache.dubbo.*` / `com.alibaba.dubbo.*` |
| RocketMQ 消费者 | L2 | L1 | `import org.apache.rocketmq.*` / `com.aliyun.openservices.ons.*` |
| `bootstrap.yml`、Nacos 配置文件 | L2 | L1 | 配置内容键：`spring.cloud.nacos.*`、`dubbo.*`（不依赖 `config/nacos/` 等目录名） |
| **配置文件含明文 AK/SK** | **L3** | **L1** | **增量 Diff 通用密钥扫描**（仅扫 `+` 行并排除 `${...}` 插值，见 [10.4](#104-通用密钥内容扫描全局硬规则仅扫增量--行并过滤变量插值)） |
| Sentinel 限流规则、Seata 配置 | L2 | L1 | 代码 `import com.alibaba.csp.sentinel.*` / `io.seata.*`；配置文件内容含 `seata.` 或 Sentinel 规则字段特征（`flowRule` / `grade` + `count`） |
| MyBatis-Plus 实体与 Mapper | L2 / L1 | L1 | `@TableName` 持久化实体变更判 **L2**；纯 Mapper 查询新增保持 **L1**（防止日常 CRUD 审批疲劳） |
| Serverless Devs `s.yaml`、ROS 模板、ACK 清单 | L2 | L1 | 内容 Schema 头：ROS `ROSTemplateFormatVersion`、K8s `apiVersion:` + `kind:`、Serverless Devs `edition:` + `services:` |
| 云效 `.workflow/*.yml` | L3 | L1 | 云效平台固定流水线目录 `.workflow/*.y*ml`（工具链约定，见 [10.3](#103-治理平面扩展仅限工具链与平台固定路径)） |
| `.mvn/settings.xml` | L2 | L1 | Maven 工具链固定路径 `.mvn/settings.xml` 或 XML 根 `<settings` |

**Git 平台：** 云效 Codeup 等主机默认当 GitHub 处理（D11）。

### 5.3 Quarkus

3 / 11 符合预期，且这 3 个均为后缀 / 文件名巧合命中。

| 漏判用例（路径仅为示例） | 期望 | 实测 | 包名无关的识别信号 |
| :-- | :-- | :-- | :-- |
| JAX-RS `@Path` + `@GET`，类名不带 `Resource` | L2 | L1 | `import jakarta.ws.rs.*` / `javax.ws.rs.*` |
| Reactive Routes `@Route` | L2 | L1 | `import io.quarkus.vertx.web.*` |
| Panache 实体 | L2 | L1 | `import io.quarkus.hibernate.orm.panache.*` / `io.quarkus.mongodb.panache.*` |
| Quarkus 配置（`quarkus.oidc.*`、`quarkus.datasource.*`） | L2~L3 | L1 | 配置内容键：`quarkus.datasource.*`（L2）、`quarkus.oidc.*` / `quarkus.security.*`（L3） |
| `HttpAuthenticationMechanism`、`SecurityIdentityAugmentor` | L3 | L1 | `import io.quarkus.security.*` / `io.quarkus.vertx.http.runtime.security.*` / `io.smallrye.jwt.*` |
| `microprofile-config.properties` | L2 | L1 | MicroProfile 规范固定路径 `META-INF/microprofile-config.properties` |
| Kotlin 写的 Quarkus `@Path` | L2 | L1 | `import jakarta.ws.rs.*`（同等覆盖 `.kt` 源码） |

### 5.4 Kotlin

1 / 8 符合预期（`OrderController.kt` 命中仅因 Spring 内容规则恰好覆盖 `.kt`）。

| 漏判用例（路径仅为示例） | 期望 | 实测 | 包名无关的识别信号 |
| :-- | :-- | :-- | :-- |
| Ktor `routing { get(...) }` | L2 | L1 | `import io.ktor.server.routing.*` |
| Ktor `install(Authentication)` | L3 | L1 | `import io.ktor.server.auth.*` |
| Spring Kotlin 鉴权配置 | L3 | L1 | `import org.springframework.security.*`（不依赖类名是否叫 `SecurityConfig`） |
| Exposed 表定义 | L2 | L1 | `import org.jetbrains.exposed.sql.*` |
| `buildSrc/**/Versions.kt` | L2 | L1 | Gradle 规范固定构建目录 `buildSrc/**` |
| `settings.gradle.kts`、`gradle.properties` | L2 | L1 | Gradle 工具链标准构建文件 |

### 5.5 Go

3 / 16 符合预期（含 `cmd/api/main.go` 的路径巧合命中，见 [§2](#2-评审方法与可信度说明)）。Go 社区目录组织极度自由（平铺、DDD、`internal/`），严禁按目录猜职责。

| 问题用例（路径仅为示例） | 期望 | 实测 | 包名无关的识别信号 |
| :-- | :-- | :-- | :-- |
| 任意包下的 HTTP 路由注册 | L2 | L1 | `import` 指纹：`github.com/gin-gonic/gin`、`github.com/labstack/echo`、`github.com/go-chi/chi`、`github.com/gofiber/fiber`、`github.com/cloudwego/hertz`、`github.com/go-kratos/kratos` 或标准库 `http.HandleFunc` / `http.NewServeMux` |
| gRPC / Kitex 服务注册 | L2 | L1 | `import "google.golang.org/grpc"` + `Register\w+Server\(`，或 `github.com/cloudwego/kitex` |
| 任意包下的 JWT / RBAC / OAuth 鉴权代码 | L3 | L1 | `import` 指纹：`github.com/golang-jwt/jwt`、`github.com/casbin/casbin`、`golang.org/x/oauth2`、`github.com/coreos/go-oidc`、`golang.org/x/crypto`（完全不看文件名是否叫 `jwt.go`） |
| go-zero `.api`、`buf.yaml`、`sqlc.yaml` | L2 | L1 | 工具链专属文件/语法：`buf.y*ml`、`sqlc.y*ml`；`.api` 文件含 go-zero `syntax = "v1"` / `service` 块 |
| GORM / Goose / Migrate 代码迁移 | L2 | L1 | `import` 指纹：`github.com/golang-migrate/migrate`、`github.com/pressly/goose`、`entgo.io/ent/dialect/sql/schema` 或 `AutoMigrate(` |
| `go.work`、`vendor/**` | L2 | L1 | Go 工具链标准文件 `go.work`、`go.mod`、`go.sum`、`vendor/modules.txt` |
| **`migrations/*.down.sql`（配对回滚）** | L2 | **L3** | **当且仅当同一 PR 中存在配对的同名 `*.up.sql` 时**，`*.down.sql`（或同文件 `-- +goose Down` 段）中的 `DROP` 判 L2 不升 L3；单独修改历史 `.down.sql` 仍判 L3 |
| **`api/v1/order.pb.go`（生成物）** | L1 | **L2** | 文件头含标准注释 `// Code generated .* DO NOT EDIT\.` 一律归为生成物排除，不看目录与后缀猜 |

### 5.6 Python

**漏得最严重的栈之一。** Python 业务常按领域 App 切分目录（且 FastAPI 鉴权多写在 `deps.py` 中），按文件名/目录名匹配必然大面积失效。

| 漏判用例（路径仅为示例） | 期望 | 实测 | 包名无关的识别信号 |
| :-- | :-- | :-- | :-- |
| Django / DRF 路由、视图与序列化契约 | L2 | L1 | `import` 指纹：`from django.urls import`、`from rest_framework import`（`APIView`、`ViewSet`、`Serializer`） |
| Flask / FastAPI 任意模块路由 | L2 | L1 | `import flask` / `import fastapi` + 路由装饰器 `@\w+\.(route\|get\|post\|put\|delete\|patch)\(` |
| ORM 持久化模型与公开 Schema | L2 | L1 | `import` 指纹：`django.db.models`、`sqlalchemy.orm`（`DeclarativeBase`/`Column`）、被路由文件直接 import 的 `pydantic.BaseModel` |
| **Alembic / Django 迁移与破坏性操作** | L2 / **L3** | L1 / L2 | `from alembic import op` 或 `from django.db import migrations` → L2（无视存放目录）；`upgrade()` / `operations` 含 `op\.drop_`、`DeleteModel`、`RemoveField` → **L3**（`downgrade()` 函数内的回滚 `op.drop_` 保持 L2） |
| 任意文件（如 `deps.py`）中的认证鉴权逻辑 | L3 | L1 | `import` 指纹：`fastapi.security`、`jose`、`jwt`、`passlib`、`bcrypt`、`authlib`、`django.contrib.auth`、`rest_framework.permissions`、`flask_login` |
| **`requirements.txt`、`pyproject.toml`、`poetry.lock`、`uv.lock`、`Pipfile*`** | L2 | **L0** / L1 | Python 包管理器标准清单文件名（从 L0 排除） |
| Airflow / Celery 调度契约 | L2 | L1 | `from airflow import DAG` / `@dag`、`from celery import`（不依赖 `dags/` 目录名） |

**误判：** `app/main.py` → L2（因写死 `(app|api)/(main|app)\.py` 误伤普通 CLI 脚本，废除该路径规则后自然消除）。

### 5.7 Node.js / TypeScript

| 漏判用例（路径仅为示例） | 期望 | 实测 | 包名无关的识别信号 |
| :-- | :-- | :-- | :-- |
| Express / Fastify / Koa / Hono 路由模块 | L2 | L1 | `import` 指纹：`express`、`fastify`、`koa`、`hono` + 路由挂载调用 |
| tRPC / GraphQL 服务端契约 | L2 | L1 | `import` 指纹：`@trpc/server`、`@apollo/server`、`@nestjs/graphql`、`graphql-yoga` |
| **任意目录下的鉴权 Guard / Session / JWT（如 `context.ts`）** | L3 | L1 | `import` 指纹：`passport`、`@nestjs/passport`、`@nestjs/jwt`、`jose`、`jsonwebtoken`、`next-auth`、`@auth/core`、`better-auth`、`bcrypt`、`argon2` |
| Nest 契约类（Controller / Resolver / Gateway + 关联 DTO） | L2 | L1 | `import '@nestjs/common'` / `'@nestjs/websockets'` / `'class-validator'` 装饰器 + 可选 Graphify 1-hop 入边关联 |
| **Next.js `middleware.ts` 与 Server Actions** | L3 / L2 | L1 | Next.js 框架强制约定入口 `middleware.(ts\|js)`；文件顶部 `"use server"` 指令 |
| `.npmrc`、`pnpm-workspace.yaml`、`bun.lockb` | L2 | L1 | Node 包管理器标准清单文件 |
| `next.config.*`、`serverless.yml`、AWS CDK | L2 | L1 | 框架标准配置名；CDK 通过 `import 'aws-cdk-lib'` 识别（不看是否在 `infra/` 目录） |
| Drizzle / Prisma 数据库 Schema | L2 | L1 | `import 'drizzle-orm/pg-core'`（或 `mysql-core`/`sqlite-core`）、`*.prisma` |
| **代码目录中的 LLM 提示词文件** | L2 | **L0** | **无需复杂 AST 追踪 `readFileSync`**：凡位于源码目录（`src/**`, `app/**`, `pkg/**`, `internal/**`）或 `**/prompts/**` 下的 `.md`/`.txt`/`.prompt` 一律移出 L0 白名单，按代码/提示词资产定级 |

**误判治理（立竿见影）：**
- 前端 `src/api/client.ts`（`import axios` / `@tanstack/react-query`，无任何服务端框架 `import`）不再因路径含 `src/api/` 被误判为 L2！
- `packages/ui/package.json` 按语义 Diff 仅当修改纯说明元数据（`version`, `description`, `keywords`）时判 L1；**修改 `dependencies` 或 `scripts`（含 `postinstall` / `test` 等供应链与门禁脚本）严格保持 L2**。

### 5.8 .NET / IaC / 其他

| 漏判用例（路径仅为示例） | 期望 | 实测 | 包名无关的识别信号 |
| :-- | :-- | :-- | :-- |
| ASP.NET Core 控制器 / Minimal API | L2 | L1 | `using Microsoft.AspNetCore.Mvc` / `[ApiController]` / `app.MapGet(`（不看类名后缀） |
| ASP.NET Core 认证授权 | L3 | L1 | `using Microsoft.AspNetCore.Authorization` / `Microsoft.AspNetCore.Authentication` |
| `*.csproj`、`Directory.Packages.props`、`CMakeLists.txt` | L2 | L1 / **L0** | 编译器/构建系统标准清单（从 L0 排除） |
| `appsettings.Production.json` | L2~L3 | L1 | .NET 框架约定配置 `appsettings*.json` + 内容含 `ConnectionStrings` / `Jwt` |
| Helm / K8s / Terraform（任意自定义目录） | L2 | L1 | 看扩展名与内容结构：`Chart.yaml`（Helm）、YAML 含 `apiVersion:` + `kind:`（K8s）、`*.tf`（Terraform），**彻底废除写死 `helm/`、`k8s/`、`terraform/` 目录名** |
| `session/ui/*.css`、`auth/*.css` | L1 | **L3** | 废除按 `auth/`、`session/` 目录名一刀切判 L3 后，纯样式文件自然回归 L1 |

---

## 6. 控制面与信任边界缺陷（PE 视角）

> **现有基础肯定：** 仓库已完成过第一轮工程加固（见 [`test/pe-hardening.test.js`](../test/pe-hardening.test.js) WS-1..WS-5），包括 Verifier Diff 200KB 截断防 Token 爆炸、`.agent-assess.json` 单向升档棘轮、`risk-history.jsonl` 锚定目标分支读取、无状态 Schema 约束以及 >50MB 大文件暂存拦截。
>
> 但在更底层的**控制面（Control Plane）与数据面（Data Plane）隔离**上，仍存在以下可被不可信输入（PR 提交者或失控 Agent）利用的系统性漏洞：

### T1（P0）控制面与数据面信任倒置：PR 可自改策略与外部命令

在 [`src/commands/verify.js`](../src/commands/verify.js) 中，门禁运行期的关键配置全部直接从**当前不可信的 PR 工作区（`HEAD`）**读取，而非从受保护基线分支（`baseRef`，如 `origin/main`）读取：

- [`loadPolicy(repoRoot)`](../src/commands/verify.js)（L182）：读取工作区 `.sdlc/policy.yaml`；
- [`readLintConfig(repoRoot)`](../src/commands/verify.js)（L340）：读取工作区 `openspec/config.yaml` 的 `lint` 配置；
- [`readExternalChecks(repoRoot)`](../src/commands/verify.js)（L368）：读取工作区 `openspec/config.yaml` 的 `gates.external`，并直接送入 `runShell(check.command)` 执行（**存在 PR 任意命令执行 RCE 风险**）；
- [`readYamlConfig(repoRoot).verify`](../src/commands/verify.js)（L392）：读取工作区 AI Verifier 模型与阈值配置。

**实测复现（`probe_pe.mjs`）：** 对一个不存在任何 Spec 产物的违规变更调用 `runVerify('no-such-change')`，正常返回退出码 `1`；但只要在同一工作区写入 `.sdlc/policy.yaml` 并将 `rollout_mode.change` 设为 `advisory`，`runVerify` 立即返回退出码 **`0`** 绿灯放行。结合 D5（`.sdlc/policy.yaml` 在 `auto` 下仅判 `L1`），攻击面完全闭合。

### T2（P1）门禁布尔参数边界与 `risk-escape` / `human-gate` 职责厘清

- **绕过参数在 CI 下的约束**：[`verify.js`](../src/commands/verify.js)（L421-425）暴露了 `--approved`、`--emergency`、`--skip-openspec`、`--skip-external` 参数。虽然在受保护的 `.github/workflows/ci.yml` 中 PR 作者无法直接篡改 CLI 入参（前提是先修复 D5 将 `.github/workflows/**` 升为 L3），但 `--approved` 若能在 CI 下自动读取 GitHub/GitLab PR Review 状态（如 `GITHUB_EVENT_PATH`）将更加稳健；
- **`risk-escape` 与 `human-gate` 的协同机制（注意勿破坏 Invariant #8）**：
  - 源码核查确认：当变更在 `new/spec` 阶段合法定级为 `L1` 进入 `apply`、但在 `impl` 阶段因触碰 API 升档为 `L2`（`isEscalatedInImpl`）时，[`verify.js` L297](../src/commands/verify.js) 的 `risk-escape` 返回 `'pass'` **是刻意设计（践行 Invariant #8 Humane In-Place Scope Escalation 免拆分支原地升档）**，而**真正的阻断发生在紧随其后的 L312 `human-gate = 'fail'`**（强制撤回自动合入，要求 Tech Lead 人工审批后才放行）。
  - **真正需要修补的漏洞**：① 当变更在 `new/spec` 阶段已被评为 `L2/L3` 却未合并前置 Spec PR（无 `approvedSha`）时，必须在 `approved-spec` / `risk-escape` 直接报 `'fail'`；② [`src/assess/schema.js`](../src/assess/schema.js)（L141）应移除无签名的 `transition.waiver: true` 自由降级口子；③ 将检查项显示名优化为 `scope-escalation`，消除“名字叫 escape 却返回 pass”的审计误解；
- **非 Spec PR 旁路**：若 PR 完全不修改 `openspec/changes/<id>/` 而直接修改业务源码，[`classifyPR`](../src/lib/prtype.js)（L51）将其归类为 `normal`。CI 模板需默认提供 PR 级 `classifyPR` 门禁检查，确保非 `fast_path` 的裸代码 PR 无法绕过 SDD 流程。

### T3（P0）AI Verifier 间接提示词注入（违背"运动员≠裁判"不变量）

- [`buildPrompt`](../src/commands/verify.js)（L145-159）将不可信的原始代码 `diff` 直接拼接在固定文本 `===== IMPLEMENTATION DIFF =====` 下方，未使用随机一次性边界符（Randomized Nonce Fencing），也未对 Diff 中伪造的分隔线做转义；
- [`extractJson`](../src/commands/verify.js)（L161-166）使用 `text.indexOf('{')` 至 `text.lastIndexOf('}')` 贪婪截取返回内容；
- **实测复现（`probe_pe.mjs`）：** 写在业务源码注释或测试字符串中的伪造分隔符与越狱指令可原样进入裁判上下文。与此同时，`CLAUDE.md`、`.github/copilot-instructions.md`、`src/prompts/*.md` 等指令文件在当前规则下被判为 `L0` 自动放行（见 D3）。

### T4（P1）多处异常采用静默放行（Fail-Open）而非安全闭合（Fail-Closed）

- **删除高危文件静默漏检**：[`v2_security.js`](../src/assess/vectors/v2_security.js)（L31）与 [`v3_topology.js`](../src/assess/vectors/v3_topology.js)（L36）仅通过 `fs.existsSync(fullPath)` 读取当前工作区文件。若 PR 直接**删除** `SecurityConfig.java` 或鉴权中间件，工作区文件不存在，内容扫描直接跳过并判为 `L1`；
- **图谱缺失静默高置信度**：[`v3_topology.js`](../src/assess/vectors/v3_topology.js)（L81）在 Graphify AST 图谱缺失或过期时直接跳过核心高扇入节点（God-node）检测，既不写入 `unresolved` 原因，也不下调 `confidence`（仍保持 `'high'`）；
- **暂存失败静默吞错**：[`src/commands/pr.js`](../src/commands/pr.js)（L80-81）的 `stageImplementationChanges` 在 `git(['add', '--', rel], repoRoot, { allowFail: true })` 失败时直接忽略错误，仍将该文件路径推入 `staged` 数组报告“已暂存”（在任何非 ASCII UTF-8 路径场景下必现丢文件，见下节 C1）。

---

## 7. 多国自然语言（UTF-8 / Unicode）工程底座缺陷（严禁按自然语言语种特判）

在全球化研发环境中，开发者可能使用中文、英文、日文、韩文、德文、法文、西班牙文或任何人类自然语言编写需求与文档。**底座工具绝不能靠识别或枚举某种人类自然语言（如写中文/英文词表、给汉字单独设 2.5 倍权重、维护中文转英文词典）来做判断**，而必须遵循**100% 与人类语种无关的 UTF-8 / Unicode 通用工程标准**：

### C1（P0）Git `core.quotepath` 非 ASCII 路径八进制转义导致“静默丢文件 + 风险降级”

[`src/lib/git.js`](../src/lib/git.js)（L6）封装的 `git()` 未传入 `-c core.quotepath=off`。Git 默认会将包含**任何非 ASCII（UTF-8 > 0x7F）字符**的路径输出为**首尾带双引号的八进制转义字符串**（例如 `docs/接口说明.md` 或 `docs/Übersicht.md` 变为 `"docs/\346\216\245..."`）。

**真实 Git 仓库实测（`probe_zhgit2.mjs`）确认两项严重后果：**

1. **未跟踪非 ASCII 文件 `git add` 静默丢失**：`git status --porcelain` 返回带引号的路径，[`stageImplementationChanges`](../src/commands/pr.js)（L80-81）将含字面量双引号的字符串传给 `git add -- "\"docs/...\""`，Git 报错 `pathspec did not match any files` 被 `allowFail: true` 静默吞掉，最终返回数组声称已暂存，实际暂存区为空；
2. **高危文件后缀失配降级**：含非 ASCII 字符的密钥或迁移文件（如 `certs/生产证书.pem`、`db/migration/V1__初始化.sql`）在 `git diff --name-only` 中末尾多出一个双引号 `"`，导致 `.pem$`、`.sql$` 正则全部失配，从 **L3 直接漏判降级为 L1**。

### C2（P1）BDD Spec Lint 对 UTF-8 BOM、非 ASCII 标点与机械字符长度阈值的摩擦

通过 `probe_zh.mjs` 对 [`src/lib/speclint.js`](../src/lib/speclint.js) 实测：

| 常见国际化输入场景 | 实测结果 | 摩擦原因与通用修复方向（零语种特判） |
| :-- | :-- | :-- |
| Windows 编辑器保存带标准 UTF-8 BOM（`\uFEFF`） | 阻断报错 `R1-purpose` | 文件首行 `\uFEFF## Purpose` 导致 `^##\s+Purpose` 失配；应按 Unicode 标准在解析前统一剥离 `\uFEFF` |
| Markdown 标题误输非 ASCII 冒号（如 `### Requirement：...`） | 阻断报错 `R0-no-requirements` / `R3-scenario` | 正则（L19-20）仅认 ASCII `:`，却笼统报错“未找到任何 Requirement/Scenario 块”；应在检测到标题含非 ASCII 标点时给出精准行号级提示 |
| `## Purpose` 机械卡死 `length < 50`（L116） | 阻断报错 `R1-purpose` | 不同人类语言的字符信息熵差异极大（**严禁按中文、日文或拉丁字母去算什么 `2.5x` 语种权重！**），机械卡 50 字符只会逼人凑字数；应统一改为与人类语言无关的“非空有效段落校验（去除模板占位符后 `>= 15` 个非空白字符即可）” |

### C3（P1 架构演进）彻底废除人类自然语言正则词表，建立“Stage 1/2 代码特征/契约预判 + Stage 6 代码 Diff 实证”双阶段模型

当前 [`v1_intent.js`](../src/assess/vectors/v1_intent.js)、[`v2_security.js`](../src/assess/vectors/v2_security.js)（L56-106）与 [`v3_topology.js`](../src/assess/vectors/v3_topology.js) 试图通过正则字典枚举英文与中文自然语言关键词（`highRiskCompounds`、`cjkHighRiskCompounds`、`genericSecWords`）来判定风险等级：

1. **为什么必须彻底废除一切人类自然语言词表**：世界上有无数种人类语言与行业术语，怎么可能靠词表判断？需求写“优化支付页文案”因命中自然语言词表被误判 L2/L3，换个语种或同义词写高危变更又会漏判 L1；
2. **为什么不能盲目取消 Stage 1/2 的前向分流信号（TPO 生命周期关键约束）**：
   - 在 `asdlc` 中，决定走 **Single-PR（L0/L1）** 还是 **Spec-First Dual-PR（L2/L3）** 的关键分流点发生在 **Stage 1（`asdlc new`）** 和 **Stage 2（`asdlc lint`）**——**此时尚未编写任何业务代码（`changedFiles = []`）**！
   - 如果机械规定“全生命周期只看代码 Diff”，则在 `new` 与 `lint` 阶段因 `changedFiles` 为空，所有需求要么全落入 `L1`（导致高危变更全部跳过前置 Spec PR 审批，直接违背 Invariant #1），要么全落入 `L2`（导致 `auto` 模式彻底退化为 `spec-first`）。
3. **完全不看人类自然语言词表的双阶段解耦架构**：
   - **Pre-Code 阶段（`stage: new | spec`，分流决策）**：**彻底清空 `v1_intent.js` / `v2_security.js` / `v3_topology.js` 中的所有自然语言词表**，改由 **① `explore.md` 图谱检索命中的目标代码文件**（对命中代码文件直接运行第 10.5 节的编程语言/框架三层静态特征预判）、**② `proposal.md` / `spec.md` 中显式声明的目标代码路径与结构化契约块（DDL/API）**、以及 **③ 宿主 Agent 会话结构化评估（`.agent-assess.json` 单向升档棘轮）** 共同决定初始分流；
   - **Post-Code 阶段（`stage: impl` / `asdlc verify`，终审门禁）**：**100% Code Diff is King**——完全剥离人类自然语言需求描述，100% 由实际代码 Diff（含 `<baseRef>` 被删文件内容与 `HEAD` 新增文件内容）、编程语言框架 `import` 指纹、配置键与密钥扫描决定最终等级。

### C4（P2）废除 `CJK_DOMAIN_LEXICON` 自然语言翻译词典，改由宿主 Agent 显式传入 ASCII `--id` 与 `--query`

- **问题现状**：[`src/lib/cliutil.js`](../src/lib/cliutil.js)（L16-43）维护了一个硬编码的中文翻译词表 `CJK_DOMAIN_LEXICON`（仅 25 个词），试图用静态字典把中文需求翻译成英文分支名；[`src/commands/new.js`](../src/commands/new.js)（L59-62）直接拿人类自然语言需求分词去查 Graphify AST 代码符号表。世界上那么多人类语言，根本不可能在 CLI 里靠维护多国语言翻译词典来生成分支名或查 AST；
- **根治方案**：**彻底删除 `CJK_DOMAIN_LEXICON` 词典，绝不在 CLI 内做任何人类自然语言分词或翻译**。在 [`asdlc-new`](../assets/skills/asdlc-new/SKILL.md) 中，由原生理解任意人类语言的宿主 AI Agent 直接将需求提炼为英文 kebab-case `--id <slug>` 与代码符号级 `--query <ascii-symbols>` 传给 CLI。

---

## 8. 产品边界与明确非目标（避免过度设计）

面向企业级落地时，极易陷入“大厂内部全栈平台幻觉”——试图在一个研发工具里包揽发布灰度、监控回滚、OA 审批、维护多国自然语言词典、甚至自研重型多语言编译器/LSP。放眼全球成熟工程软件（GitHub/GitLab、Semgrep、SonarQube、Bytebase、Argo Rollouts），**没有任何一款成功产品跨界大包大揽**。

为保持架构克制与高可接入性，本工具严格遵循 **Unix 哲学：只做深“代码仓（Repo）边界内的研发态 Spec 契约与变更风险门禁”**，明确划定以下边界：

| 领域 | 明确不做（Non-Goals / 越界需求） | 产品本分（In-Scope / 务实闭环） |
| :-- | :-- | :-- |
| **工作流模式（`workflow_mode`）实现** | ❌ **本文档不负责 `workflow_mode`（`spec-first \| auto`）的配置加载、CLI 切换或容器编排实现**（该部分实现完全交由 [`docs/autonomous-pipeline.md`](./autonomous-pipeline.md) 负责） | ✅ 本文档只负责把底层 **`assess()` 风险定级（`L0–L3`）** 与 **`verify` 控制面安全门禁** 做准、做稳，向上提供可靠的定级信号 |
| **人类自然语言判断** | ❌ **绝不维护任何人类自然语言（中/英/日/德等）的风险关键词表、翻译字典（`CJK_DOMAIN_LEXICON`）或单语种字符长度权重** | ✅ 底层统一遵循 UTF-8 / Unicode 标准；人类自然语言理解 100% 交由宿主 AI Agent（`--id`、`--query`、`.agent-assess.json`） |
| **重型静态分析与编译器** | ❌ **不在 CLI 内手写跨模块 AST 类型推导器或 Maven/Gradle 依赖树解析器**；不做在线 SQL 执行计划/锁表分析 | ✅ 代码层采用 `<50ms` **轻量三层静态特征（编程语言框架 `import` 指纹 + 文件 Schema 头/配置键 + 标准构建清单）+ 可选 Graphify 1-hop 入边** 识别契约与迁移 |
| **发布与企业办公管控** | ❌ 不做特性开关、金丝雀灰度、线上监控回滚、飞书/钉钉/OA 审批流或跨仓集中式 Policy Server | ✅ 保持**纯本地、无状态、零配置（Zero-Config）Git 原生 CLI**；未知内网 Git 域名优雅降级输出手动 PR 指引，不强绑 GitHub |

---

## 9. 四维稳健性综合评估（安全性、准确性、稳定性、易用性）

把整套加固方案放到真实企业级研发与高可用生产体系中审视，必须在四个核心工程维度上实现**高确定性与相互制约的平衡**，确保系统“既能焊死安全底线，又不会给日常业务交付添乱”：

| 评估维度 | 核心诉求 | 现状脆弱点（加固前） | 稳健加固机制（加固后） | 稳健性判据（验收标准） |
| :--- | :--- | :--- | :--- | :--- |
| **安全性**<br>*(Security)* | 信任边界防倒置<br>裁判防越狱注入<br>高危密钥零逃逸 | • PR 可提交本地 `policy.yaml` 设 `advisory` 达成自降级绿灯，或通过 `config.yaml` 注入 `gates.external` 命令（T1）<br>• 原始 Diff 裸拼进 AI 裁判 Prompt（T3）<br>• 明文 AK/SK 写入配置或直接删除鉴权文件仍判 L1 放行（D4/T4） | • **控制面强制基线锚定**：CI 门禁策略与外部检查 100% 从 `<baseRef>` 或受保护环境变量读取<br>• **随机 Nonce 边界隔离**：密码学随机 UUID 分隔符包裹 Diff，解析异常 Fail-Closed<br>• **增量密钥扫描 + 删文件基线回溯**：扫描 Diff `+` 行高置信密钥（排除 `${ENV}` 插值），同时回溯 `<baseRef>` 被删文件内容 | • PR 篡改自身策略绕过率：**0%**<br>• 恶意 Prompt 越狱裁判成功率：**0%**<br>• 明文密钥与删鉴权文件漏报率：**0%** |
| **准确性**<br>*(Accuracy)* | 废除自然语言猜风险<br>代码技术栈高召回高精度<br>保住 L1 敏捷快车道 | • 人类自然语言正则词表导致文案改动误判 L3、其他语种/黑话需求漏判 L1<br>• 代码层硬编码业务包名与浅层目录匹配，导致 97/120 用例漏判 | • **彻底废除人类自然语言词表**：Stage 1/2 靠 Explore 目标代码文件与结构化契约分流，Stage 6 100% 靠双向代码 Diff 实证定级<br>• **代码轻量三层包名无关信号**：依赖编程语言框架 `import` 指纹、文件 Schema 头/配置键、标准构建清单 + 可选 Graphify 1-hop 入边<br>• **精细化降噪与 L1 正向包络**：排除生成物、配对 `.down.sql`、MyBatis 纯 `<select>` 与纯前端调用；建立 L1 有界局部代码正向证明 | • 首批覆盖代码技术栈漏判率：**≤ 5%**<br>• 日常业务改动误伤率：**≤ 5%**<br>• 契约/迁移文件识别与目录深度完全解耦 |
| **稳定性**<br>*(Stability)* | 零外部网络依赖<br>毫秒级确定性<br>UTF-8 跨平台一致 | • Git `core.quotepath` 转义导致所有非 ASCII 路径丢文件与降级<br>• 缺 AST 图谱时静默跳过核心检查 | • **代码基础定级 100% 纯本地静态计算**：离线、断网 CI 环境下 `<100ms` 确定性产出，不依赖重型 AST 编译器<br>• **底层引擎 100% 兼容**：保留精简版 `openspec/config.yaml`，确保 `@fission-ai/openspec` 零破坏运行<br>• **Git UTF-8 底座全局健壮化**：强制锁死 `core.quotepath=off`，暂存失败立即显式报错 | • 断网离线环境门禁执行成功率：**100%**<br>• 门禁静态评估耗时：**< 100ms**<br>• 任意 UTF-8 语言文件名跨 OS 判定一致性：**100%** |
| **易用性**<br>*(Usability)* | 真正 Zero-Config<br>可行动错误诊断<br>零自然语言词表维护 | • 在 CLI 内维护自然语言词表与翻译字典，无法应对全球多语言<br>• Spec 非 ASCII 冒号 `：` 报“找不到 Requirement”误导排查<br>• `Purpose` 硬卡 50 字符逼人凑字数 | • **规则内核与基线策略职责清晰**：包内只读规则内核 + `<baseRef>` 受保护基线策略<br>• **自解释且具备行动指引的诊断（Actionable Errors）**：自动剥离 UTF-8 BOM，非 ASCII 标题标点精准定位行号，简化 `Purpose` 为非空有效段落（不搞语种字符权重）<br>• **引入 Shadow Mode**：新规则先以旁路伴跑模式写入 `observations` 统计对账 | • 业务研发维护私有规则行数：**0 行**<br>• CLI 内维护的人类自然语言词典数：**0 个** |

---

## 10. 整改方案（经 TL/TPO 防反噬纠偏）

### 10.1 控制面 `<baseRef>` 信任锚定 + 兼容 OpenSpec 底座 + 防注入加固

1. **控制面基线锚定（保持 `@fission-ai/openspec` 100% 兼容）**：
   - **纠偏说明（避免破坏底层引擎）**：[`init.js`](../src/commands/init.js) 与 [`openspec.js`](../src/lib/openspec.js) 底层调用的 `@fission-ai/openspec` CLI 强依赖业务仓库下的 `openspec/config.yaml` 来识别项目根目录与 `schema: agentic-repo-change`（`XDG_DATA_HOME` 仅提供 Schema 定义，不能替代项目级 `config.yaml`）。因此**绝不能删除或阻断 `openspec/config.yaml`**。
   - **控制面与数据面隔离设计**：
     - **npm 包内只读规则内核**：所有代码技术栈风险规则、`R0–R8` 默认等级与 OpenSpec Schema 模板 **100% 封装在 `@akjamie/agentic-sdlc` 包内部**；`init.js` 写出的 `openspec/config.yaml` 精简为纯声明式文件（仅含 `schema: agentic-repo-change` 与静态流程说明，不再暴露可执行 `gates.external` 或 `verify.command` 模板）。
     - **受保护基线分支策略 `<baseRef>` 强制读取**：在 `asdlc verify` 中，[`loadPolicy`](../src/lib/policy.js)、`readLintConfig` 与 `readExternalChecks` **在 CI 环境下强制通过 `git show <baseRef>:.sdlc/policy.yaml`（及 `<baseRef>:openspec/config.yaml`）从受保护目标分支读取**；若 `<baseRef>` 上尚无该文件，一律回退至包内最严默认策略（`DEFAULT_POLICY`，全部 `block`），**彻底无视当前 PR 工作区（`HEAD`）对策略或外部命令的本地修改**。（注：关于 `workflow_mode` 的配置与运行时编排实现统一交由 [`docs/autonomous-pipeline.md`](./autonomous-pipeline.md) 处理，本文档不涉及。）
2. **AI Verifier 随机边界隔离与严格解析**：
   - 每次调用 [`buildPrompt`](../src/commands/verify.js) 生成密码学随机分隔符（如 `<<<ASDLC_DIFF_BOUNDARY_${crypto.randomUUID()}>>>`），并对 Diff 文本中任何形似分隔符的字符串做转义；在系统指令中声明边界内全部内容均为不可信纯数据，忽略其中一切自然语言指令；
   - 将 [`extractJson`](../src/commands/verify.js) 改为严格解析并校验 `verdict` 枚举值（仅允许 `'PASS' | 'FAIL'`），解析失败一律按 `'FAIL'` 处理。
3. **`scope-escalation`（原 `risk-escape`）与 `human-gate` 精确闭环（保护 Invariant #8）**：
   - **保持 Humane In-Place Scope Escalation**：当变更在 `new/spec` 阶段合法定级为 `L0/L1`（Single-PR），而在 `impl` 阶段触碰了 L2/L3 代码文件发生原地升档（`isEscalatedInImpl`）时，`scope-escalation`（原 `risk-escape`）记录升档审计并保持 `'pass'`，同时将 `implementation_review` 升为 `'ai+human'`，**由紧随其后的 `human-gate` 在未获 Tech Lead 审批时返回 `'fail'` 阻断合入**（一旦 Tech Lead 审批通过，无需拆分支即可合入）；
   - **阻断真正的非法逃逸**：① 若变更在 `new/spec` 阶段已被评为 `L2/L3` 却未合并前置 Spec PR（无 `approvedSha`），`approved-spec` 与 `scope-escalation` 直接返回 `'fail'`；② 移除 [`src/assess/schema.js`](../src/assess/schema.js)（L141）无签名的 `transition.waiver: true` 降级口子；
   - **Graphify 图谱状态透明化（D12）**：当 Graphify 图谱缺失或过期时，向评估记录追加 `unresolved: ['graph_unavailable']`。若变更文件数较多（如 > 5 个源码文件）且缺图谱，将 `V3.confidence` 降为 `'medium'`（不盲目一刀切降为 `'low'`，避免未装 Python Graphify 的轻量仓库全量卡死 L1）。

### 10.2 双向 Diff 感知与判定顺序重构（含 L0/L1 双层正向安全包络）

**当前缺陷：** 仅读工作区现存文件（删除高危文件会漏检） + 先豁免 `docs/test` 再匹配风险规则 + 无 L1 边界定义。
**重构后的 8 步评估流水线：**

```
1. 路径 UTF-8 归一化与双端内容加载：
   - git 强制开启 -c core.quotepath=off；
   - 对每个变更文件同时加载 <headRef> 新内容与 <baseRef> 旧内容（防止 git rm SecurityConfig.java 因工作区文件不存在而漏判为 L1！）；
   - 按文件头标准魔数（如 // Code generated ... DO NOT EDIT）剔除生成物。
2. 增量通用密钥扫描（仅扫 Diff 新增 '+' 行）             → 命中即 L3 + 强制人审（不受任何目录豁免影响）
3. 治理平面 / CI / 构建与工具链标准清单文件             → L2 ~ L3（见 10.3 & 10.7）
4. 代码技术栈三层静态语义信号 + 可选 Graphify 1-hop 传播 → L2 ~ L3（同时检查新旧文件内容，删契约/删鉴权同等命中，见 10.5）
5. CODEOWNERS 升级（可选，读取 <baseRef>:CODEOWNERS）   → 命中敏感团队判 L3，非默认 owner 判 L2
6. docs / test 豁免 —— 仅对"未被 2~5 命中、且不在源码目录下的纯文档或纯测试文件"生效
7. 双层正向安全证明（Positive Safety Envelope）：
   - 7a. L0 正向证明：全部实质变更文件落在收窄后的显式 L0 白名单（见 10.7） → L0（Single-PR + 自动合入）
   - 7b. L1 正向包络（Bounded Local Code）：未命中 2~5 任何 L2/L3 规则、实质源码变更文件数有界（≤ 5 个）、未触碰包根导出入口（index.ts / lib.rs / package.json exports）及 Graphify God-Node → L1（Single-PR）
8. 兜底策略：超出 L1 有界包络（如大面积跨目录重构）或高不确定性变更 → 自动升档 L2（Spec-First）
```

**核心收益：**
- **彻底堵死 `docs/api/openapi.yaml` 与 `git rm` 删文件逃逸**：内容特征先于目录豁免，且删除 `<baseRef>` 上的鉴权/契约文件同样触发 L2/L3；
- **保住 `L1` 单 PR 敏捷性**：日常几行代码的内部 helper 修复或单模块逻辑调整落在 `7b. L1 正向包络` 内，无需走繁琐的双 PR，避免因“未匹配一律判 L2”导致研发团队弃用。

### 10.3 治理平面扩展（仅限工具链与平台固定路径）

将以下**平台/工具链自身写死的标准路径**纳入 **L3 + 强制人工审批**（`mandatory_human_review: true`）：

| 类别 | 平台/工具链固定路径 |
| :-- | :-- |
| CI 与流水线 | `.github/workflows/**`、`Jenkinsfile`、`.gitlab-ci.yml`、`.workflow/**`（云效）、`azure-pipelines.yml`、`.circleci/**` |
| 策略与归属 | `.sdlc/**`、`openspec/config.yaml`、`CODEOWNERS`（含 `.github/CODEOWNERS`、`docs/CODEOWNERS`） |
| Agent 指令 | `CLAUDE.md`、`GEMINI.md`、`AGENTS.md`、`.cursor/**`、`.claude/**`、`.github/copilot-instructions.md`、`.github/prompts/**`、`assets/commands/**` |
| 评估规则自身 | `src/assess/**`（仅本项目自举保护） |

### 10.4 通用密钥内容扫描（全局硬规则：仅扫增量 `+` 行并过滤变量插值）

不依赖技术栈，对所有非二进制变更文件的 **Git Diff 新增/修改行（`+` 行）** 做内容扫描，命中即 **L3 + 强制人审**：

| 类型 | 高置信匹配模式 | 强制误报过滤（防存量配置误杀） |
| :-- | :-- | :-- |
| 云厂商定长 AK | 阿里云 `LTAI[0-9A-Za-z]{12,20}`、AWS `AKIA[0-9A-Z]{16}`、腾讯云 `AKID[0-9A-Za-z]{13,20}` | 忽略注释行与 `.env.example` / `.env.template` |
| 私钥块 | `-----BEGIN (RSA\|EC\|OPENSSH\|DSA\|PRIVATE) .*PRIVATE KEY-----` | 无豁免，命中即 L3 |
| 平台令牌 | `ghp_[0-9A-Za-z]{36}`、`github_pat_[0-9A-Za-z_]{50,}`、`xox[baprs]-[0-9A-Za-z-]+`、`sk-[A-Za-z0-9]{20,}` | 排除含 `xxx`、`dummy`、`mock`、`test`、`example` 的测试假数据 |
| 通用密钥赋值与连接串 | `(?:access[-_]?key[-_]?secret\|secret[-_]?key\|private[-_]?key)\s*[:=]\s*['"]?([A-Za-z0-9+/=_-]{16,})`、`jdbc:.*password=([^&\s]+)`、`mongodb(\+srv)?://[^:]+:([^@]+)@` | **显式排除环境变量与加密插值**：右值含 `${...}`、`{{...}}`、`$ENV`、`ENC(...)`、`vault:`、`kms:` 或 `<YOUR_...>` 时一律不触发 |

注意：命中结果写入 `risk-history.jsonl` 前必须执行**掩码脱敏**（如 `LTAI****`），严禁将明文密钥二次持久化到版本库。

### 10.5 内置代码技术栈识别引擎：轻量三层静态信号 + 可选 1-Hop 图谱传播

**工程克制原则：** 摒弃一切写死业务包名/目录层级的脆弱正则，同时**拒绝在 CLI 内手写多语言跨模块 AST 类型解析器或 Maven/Gradle 依赖树编译器**。针对编程语言与框架（Java / Node.js / Python / Go / Quarkus / Kotlin / .NET），通过以下 **`<50ms` 纯静态三层硬信号 + 可选 Graphify 1-hop 入边** 实现零配置高精度判级：

| 识别层 | 识别依据（开发者无法改名的锚点） | 典型示例（详见第 5 节各技术栈表格） | 命中等级 |
| :-- | :-- | :-- | :-- |
| **第 1 层：第三方框架 `import` / `using` 指纹** | 业务包名可变，但引用的框架 SDK 包名全球固定 | • **安全 (L3)**：`import org.springframework.security.*`、`cn.dev33.satoken.*`、`org.apache.shiro.*`、`github.com/golang-jwt/jwt`、`github.com/casbin/casbin`、`fastapi.security`、`@nestjs/passport`、`Microsoft.AspNetCore.Authorization`<br>• **服务端契约 (L2)**：`org.apache.dubbo.*`、`org.apache.rocketmq.*`、`jakarta.ws.rs.*`、`google.golang.org/grpc`、`@trpc/server`、`express`（天然区分前端 `import axios`）<br>• **迁移与破坏性操作 (L2/L3)**：`from alembic import op`（`upgrade` 含 `op.drop_` 升 L3） | L2 / **L3** |
| **第 2 层：文件内容 Schema 头 / 配置键 / SQL 语法** | 看文件内部协议头、SQL DDL 动词或配置键，无视存放目录层级 | • YAML/JSON 含 `openapi:` / `swagger:` → 接口契约 (L2)<br>• `.sql` 含 `CREATE/ALTER TABLE` → 迁移 (L2)；非配对回滚含 `DROP/TRUNCATE` → (L3)<br>• XML 含 `<mapper namespace=` 且含写操作/DDL → (L2)；纯 `<select>` → (L1)<br>• YAML 含 `apiVersion:` + `kind: Deployment\|Ingress\|Role\|Secret` → K8s (L2)<br>• 配置文件含 `spring.datasource.*` / `spring.cloud.nacos.*` / `quarkus.oidc.*` → 核心运行配置 (L2/L3) | L1 / L2 / **L3** |
| **第 3 层：工具链/编译器固定清单与生成物头** | 仅匹配编译器规范自身写死的文件名或标准生成头 | • 供应链：`pom.xml`、`build.gradle(.kts)`、`libs.versions.toml`、`go.mod`、`go.work`、`pyproject.toml`、`requirements*.txt`、`package.json`、`*.csproj`、`CMakeLists.txt`、`*.tf`、`*.proto`<br>• 生成物剔除：文件头前 10 行含 `// Code generated .* DO NOT EDIT` 或 `# Generated by` 自动排除，不计风险分 | L2 / 排除 |
| **第 4 层（可选增强）：Graphify 1-Hop 入边传播** | 当本地存在新鲜 `graphify-out/graph.json` 时，利用现成文件级引用边传播契约属性 | • 若变更文件（如纯 POJO `CreateOrderRequest.java` 或二方接口 `OrderFacade.java`）在 `graph.json` 中被第 1 层命中的 Controller / RPC 文件直接引用（1-hop inbound link），自动继承 **L2** 契约等级 | L2 |

### 10.6 复用 `<baseRef>:CODEOWNERS` 作为敏感路径的事实来源（P2 可选增强）

企业通常已经在 `CODEOWNERS` 中声明"这些路径归安全组 / 支付组 / 平台组"。建议：

- **必须从 `<baseRef>` 读取 `CODEOWNERS`**（防止 PR 删除自身路径的 owner 声明绕过检查）；
- 变更文件命中**非默认 owner**（非全局 `*` 默认规则）→ 至少 L2；
- owner 匹配敏感团队名特征（如 `@*/security`、`@*/payments`、`@*/infra`）→ L3；
- 这样既解决纯业务计算类（如无特殊 `import` 的 `BigDecimal` 清结算核心类）与零注解二方接口的识别，又与代码托管平台的审批规则天然对齐。

### 10.7 L0 白名单收窄与供应链安全判级

- **L0 白名单严格收窄为：**
  - 仓库根目录标准说明文件：`README*.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`LICENSE`、`NOTICE`；
  - `docs/**` 下的 `.md`（**且文件内容不含** `openapi:`、`swagger:` 等契约头）；
  - 纯测试文件（`test/**`、`tests/**`、`*.test.*`、`*.spec.*`、`*_test.go`、`test_*.py`），且未触碰任何生产目录。
- **L0 强制排除（绝不当作纯文档）：**
  - `requirements*.txt`、`CMakeLists.txt`、以及任何非说明类的 `.txt` 构建/依赖清单；
  - `CLAUDE.md`、`AGENTS.md`、`GEMINI.md`、`.github/copilot-instructions.md`、`assets/commands/**` 等 Agent 指令（L3）；
  - **任何位于源码目录（`src/**`, `app/**`, `pkg/**`, `internal/**`, `lib/**`）或 `**/prompts/**` 下的 `.md` / `.txt` / `.prompt` 文件**（涵盖 LLM 提示词模板，至少判 L2）。
- **供应链清单（`package.json` 等）安全判级（修补 `scripts` 漏洞）：**
  - `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` / `resolutions` / `overrides` / `exports` / `main` 变化 → **L2**；
  - **`scripts` 字段变化 → 必须保持 L2**（`scripts.postinstall` / `preinstall` 是供应链投毒 RCE 重灾区，修改 `scripts.test` 可直接伪造测试通过，严禁放行 L1）；
  - 锁文件（`package-lock.json`、`pnpm-lock.yaml`、`yarn.lock`、`uv.lock`、`poetry.lock`、`go.sum`）变更 → **保持 L2**（主流供应链投毒常发生在 semver patch 小版本，不做脆弱的锁文件 AST 降级解析）；
  - **仅修改纯描述性元数据**（`version`、`description`、`keywords`、`author`、`repository`、`homepage`）→ **L1**。

### 10.8 误判治理汇总

| 误判场景 | 根治处理方案 |
| :-- | :-- |
| `src/api/**` 前端接口层（`import axios`） | 废除 `(pages\|app\|server\|src)/api/` 盲目路径硬规则；前端文件无服务端路由注解/`import` 指纹，自然回归 L1 |
| `auth/`、`session/` 下的 CSS / 图片 / 字体 | 静态样式与媒体资源扩展名（`.css`, `.scss`, `.less`, `.svg`, `.png`, `.woff2`）从安全目录规则中排除，判 L0/L1 |
| `app/main.py` 普通脚本 | 删除 `(app\|api)/(main\|app)\.py` 路径规则，改由第 1 层 `import fastapi` / `flask` 内容信号识别 |
| `*Api.java` 出站工具类 | 删除 `*Api.java` 类名后缀硬规则，改由 `@RestController` / `@Path` / `@FeignClient` 等 `import` 与注解识别 |
| `*.pb.go` / 生成代码 | 文件头含 `// Code generated .* DO NOT EDIT` 自动归入 `generated` 剔除，不重复计分 |
| `*.down.sql` 配对回滚脚本 | 当同一 PR 含配对 `*.up.sql` 时，`.down.sql` 内的 `DROP` 判 L2 不触发 L3（单独改 `.down.sql` 仍为 L3） |
| MyBatis `*Mapper.xml` 日常新增 `<select>` | 仅含 `<select>` 查询变更为 L1；含 DDL 或无 `WHERE` 写操作才升 L2/L3 |
| 人类自然语言需求文本命中宽泛词（如“支付文案”） | **彻底废除 V1/V2/V3 中的一切人类自然语言正则词表**；Stage 1/2 靠 Explore 命中代码文件与契约结构分流，Stage 6 100% 靠代码 Diff 定级 |

### 10.9 UTF-8 / Unicode 国际化底座修复（零自然语言语种特判）

1. **全局关闭 Git 路径八进制转义（标准 UTF-8 透传）**：在 [`src/lib/git.js`](../src/lib/git.js) 的 `git()` 入口统一前置 `['-c', 'core.quotepath=off', ...args]`；在 [`stageImplementationChanges`](../src/commands/pr.js)（L80）中移除 `allowFail: true` 静默吞错，暂存失败时立即抛出明确错误。
2. **Spec Lint 标准 Unicode 兼容（[`src/lib/speclint.js`](../src/lib/speclint.js)，绝不按语种算字数权重）**：
   - 解析前统一剥离文件头 `\uFEFF`（UTF-8 BOM）；
   - 检测标题行中的非 ASCII 冒号（如 `### Requirement：`、`#### Scenario：`），给出精确行号与可行动修复提示（`Line N: Replace non-ASCII colon with ASCII ':'`），不再误报“未找到 Requirement/Scenario”；
   - 将 `## Purpose` 机械的 `length < 50` 校验简化为与人类语言无关的“非空有效段落校验（去除模板占位符后 `>= 15` 个非空白字符即可）”，**严禁针对中文或任何单一人类语言搞 `2.5x` 字符权重折算**。
3. **废除 `CJK_DOMAIN_LEXICON` 翻译词典，由宿主 Agent 显式传入 `--id <slug>` 与 `--query <symbols>`**：不在 [`cliutil.js`](../src/lib/cliutil.js) 中维护任何人类自然语言词典；由宿主 AI Agent 在调用 `asdlc new` 时直接传入英文 `--id` 与 AST 查询符号。

### 10.10 灰度：Shadow Mode（旁路伴跑对账）

新规则在切换为阻断门禁前，支持以 **Shadow Mode** 运行：将新引擎的判定结果与触发规则写入评估记录预留的 `observations` 数组，不改变当前门禁阻断行为。待验证真实仓库误报率 ≤ 5% 后再切换为主判定引擎。

---

## 11. 与 `autonomous-pipeline.md` 的职责分工边界

- **`workflow_mode` 的实现完全交由 [`docs/autonomous-pipeline.md` §3](./autonomous-pipeline.md) 负责**：包括 `spec-first | auto` 的配置定义、切换方式、容器化编排及双模式工作流流转，**本文档一律不重复设计、不介入其实现**。
- **本文档仅专注于底层 `assess()` 风险检测引擎与 `verify` 控制面安全**：无论上层工作流如何消费定级结果，本文档确保 `assess()` 输出的 `L0–L3` 等级、`fast_path` 安全底线（禁止 `docs/api/openapi.yaml` 或含密钥/控制面文件免审放行）以及 `verify` 的 `<baseRef>` 策略锚定具备高确定性。

---

## 12. 验收标准与回归测试

### 12.1 对抗用例库

将[附录 A](#附录-a探针用例清单历史测试输入样例非规则路径)的用例（A.1~A.8 共 120 个跨技术栈代码用例，外加 A.0 的 19 个补充路径用例）以及控制面/UTF-8 路径/删文件回溯用例固化为回归测试，建议位置：

```
test/risk-corpus/
  java-spring.json    java-alibaba.json   quarkus.json
  kotlin.json         go.json             python.json
  node.json           dotnet-iac.json     governance.json
test/control-plane-security.test.js       # T1~T4 <baseRef> 策略锚定、删除高危文件回溯、Prompt Nonce 隔离、Fail-Closed
test/utf8-i18n-engineering.test.js        # C1~C4 非 ASCII 路径 git quotepath、UTF-8 BOM、非 ASCII 标点诊断、Pre-Code/Post-Code 衔接
```

每条风险语料格式：`{ stack, path, content, expectedMin, note }`。
**强制“路径与目录层级变异（Path-Mutation）”断言：** 测试驱动在运行每条用例时，自动将其源码内容挂载到多种非标目录结构下重复断言（如深层多模块 `apps/core/sub-mod/custom-src/com/xx/v2/Foo.java`、多级分库目录 `dal/resources/sql/mysql/2026/q4/01.sql`、平铺根目录 `Foo.go`），**确保判级结果与目录深度、业务包名完全解耦**。

### 12.2 度量指标

| 指标 | 定义 | 验收目标 |
| :-- | :-- | :-- |
| 控制面自篡改绕过率 | PR 修改自身 `.sdlc/policy.yaml` 或 `openspec/config.yaml` 绕过门禁或注入命令 | **0%** |
| 密钥、治理文件与删鉴权文件漏判 | Diff 新增明文密钥、修改治理/CI 文件或 `git rm` 鉴权文件判级 < L3 | **0%** |
| 非 ASCII（UTF-8）文件名暂存丢失 / 降级 | 含非 ASCII 字符路径的新增文件未暂存或 `.pem`/`.sql` 降级 | **0%** |
| 代码技术栈漏判率（UNDER） | 实测等级 < 期望等级 的用例占比 | 首批主力栈 ≤ 5% |
| 代码技术栈误判率（OVER） | 实测等级 > 期望等级 的用例占比 | ≤ 5%，且不误伤前端 `axios`、MyBatis 纯 `<select>`、配对 `.down.sql` 与有界内部代码 |
| CLI 内维护的人类自然语言词表数 | 自然语言风险词表 + 自然语言翻译词典（如 `CJK_DOMAIN_LEXICON`）数量 | **0** |

### 12.3 现有测试的局限

当前 `npm test`（168 个测试）全部通过，但除 `pe-hardening.test.js` 的 5 个专项外，绝大多数属于**正常路径回归测试，而非对抗测试**：尚未覆盖策略自降级、删除高危文件、非 ASCII 路径引号转义与跨技术栈非标目录路径。

---

## 13. 实施路线图（分三阶段平稳交付，拒绝大爆炸重构）

| 里程碑 | 核心交付内容 | 风险控制与目标 |
| :-- | :-- | :-- |
| **M1 · P0 安全止血与 UTF-8 Git 底座修复**<br>*(预计 3~5 天，可独立发版)* | • **10.1 控制面锚定 `<baseRef>`**：`verify.js` 从 `<baseRef>` 读取 `policy.yaml` 与外部检查，精简 `init.js` 写出的 `openspec/config.yaml`（保持 100% 兼容 OpenSpec CLI），AI Verifier 增加随机 UUID Nonce 边界隔离；<br>• **10.9 Git UTF-8 路径修复**：`git.js` 全局加 `-c core.quotepath=off`，`pr.js` 移除暂存静默吞错；<br>• **10.2/10.3/10.4/10.7 底线闭合**：反转 `docs/test` 豁免顺序、收窄 L0 白名单、治理/CI 文件提权 L3、上线增量 `+` 行密钥扫描（排除 `${ENV}` 插值）与 `<baseRef>` 被删文件内容回溯；<br>• 落地 `test/control-plane-security.test.js` 与 `test/utf8-i18n-engineering.test.js` | **零架构破坏、零误报风险**，立即封死 PR 策略自降级、RCE、密钥泄露与非 ASCII 文件名丢文件 |
| **M2 · P1 废除自然语言词表 + 四大主力技术栈 + SpecLint 修复**<br>*(预计 1~2 周)* | • **C3/C4 彻底废除人类自然语言判断**：删除 `v1_intent.js` / `v2_security.js` / `v3_topology.js` 自然语言词表与 `cliutil.js` 的 `CJK_DOMAIN_LEXICON`，实现 `Pre-Code（Explore 目标代码文件 + Spec 契约预判 + Agent 评估）` + `Post-Code（双向代码 Diff 实证 + L1 有界正向包络）`；<br>• **10.5 首批四大主力代码栈**：内置 **Java（Spring + Alibaba）**、**Node/TS**、**Python**、**Go** 三层代码静态信号 + 可选 Graphify 1-hop 传播 + 10.8 误判治理；<br>• **10.9 SpecLint Unicode 修复**：剥离 UTF-8 BOM、非 ASCII 标点行号级指引、简化 `Purpose` 为非空有效段落（不搞语种字符权重）；<br>• **10.10 Shadow Mode**：支持 `observations` 旁路对账 | 解决 85%+ 真实代码技术栈漏判，彻底砍掉自然语言词表误报，同时保住 L1 单 PR 敏捷体验 |
| **M3 · P2 长尾代码技术栈与企业生态适配**<br>*(按需迭代)* | • **10.5 二批长尾代码栈**：补齐 **Quarkus**、**Kotlin/Ktor**、**.NET** 代码信号规则；<br>• **10.6 `<baseRef>:CODEOWNERS` 联动**；<br>• **D11 生态体验**：未知内网 Git 域名优雅降级打印手动 PR 指引 | 低成本融入多元企业内网环境 |

---

## 14. 已知局限

- **纯静态特征与 1-Hop 图谱仍无法覆盖全部纯业务公式语义。** 三层静态代码信号能准确识别框架入口、鉴权库、持久化与配置契约，但对动态反射、元编程，以及**零特殊依赖的纯业务逻辑高危改动**（例如只用了基础 `BigDecimal` 运算的清结算公式修改）可见性有限，需结合 `<baseRef>:CODEOWNERS`（10.6）与独立 Review Session 兜底。
- **不替代代码托管平台侧分支保护（Branch Protection）。** 本工具的所有本地与 CI 门禁最终依赖 GitHub / GitLab / 云效开启“受保护分支禁止直接 Push + 必须通过 Required Status Check + 必须经独立 Reviewer 审批”才能形成物理闭环。

---

## 15. 已拍板架构与产品决策（TL + TPO 决议）

针对初版评审中的待决分歧，经 Tech Lead 与 Tech Product Owner 联合评估，确立以下 6 项最终决议：

| # | 决策议题 | 最终决议 | 架构与产品依据 |
| :-: | :--- | :--- | :--- |
| **1** | **控制面基线读取与兜底策略** | **强制读 `<baseRef>`；若 `<baseRef>` 尚无配置文件，按内置最严 `block` 策略执行** | 遵循 Fail-Closed 原则；首次接入仓库在策略合入主干前，绝不信任 PR 分支自建的 `advisory` 配置。 |
| **2** | **`L0/L1` 风险边界定义与 `workflow_mode` 职责切分** | **建立 L0（纯文档/测试）+ L1（有界局部代码）双层正向安全包络；`workflow_mode` 的具体实现完全交由 [`docs/autonomous-pipeline.md`](./autonomous-pipeline.md)** | 避免把未命中 L0 的局部代码一刀切判为 L2；同时严守文档边界，不在本文档重复实现工作流模式编排。 |
| **3** | **代码技术栈识别 vs. 人类自然语言去词表化** | **代码层分两批交付轻量三层静态特征（M2 四大主力栈 $\to$ M3 三个长尾栈）；人类自然语言层彻底废除一切词表、翻译字典与语种字符权重** | 代码编程语言/框架（Java/Node/Python/Go 等）通过 `<50ms` `import` 指纹与 Schema 头精准识别；而人类自然语言（中/英/日/德等）千变万化，绝不在 CLI 内用自然语言做任何风险或权重判断。 |
| **4** | **密钥扫描机制** | **全局硬规则默认开启，但仅扫 Diff 新增（`+`）行并过滤 `${...}` 等插值语法** | 兼顾“明文密钥零逃逸（不受 `docs/test` 豁免）”与“存量占位符配置零误报”，命中结果脱敏后落盘。 |
| **5** | **`openspec/config.yaml` 存废** | **保留极简声明式 `openspec/config.yaml`，剥离可执行门禁配置** | 保障底层 `@fission-ai/openspec` CLI 100% 正常工作，同时消除 PR 注入 `gates.external` 命令的攻击面。 |
| **6** | **未知内网 Git 域名行为（D11）** | **严禁默认当 GitHub 发请求；优雅降级为本地 `git push` + 打印标准提 PR 指引** | 契合企业内网零猜测（Zero-Guessing）原则，无缝兼容云效 Codeup、Gitee、自建 GitLab/Gerrit。 |

---

## 附录 A：探针用例清单（历史测试输入样例，非规则路径）

> **重要声明：** 下表“路径”列（如 `src/main/java/org/acme/OrderRest.java`、`src/main/resources/db/migration/...`）仅为评审时构造的**单次探针输入文件路径**，用来证明“即便在教科书式的默认目录结构下，现有引擎也大面积漏判”，**绝不代表规则应绑定这些路径或目录深度**。整改后的引擎完全基于代码内容语法、框架 `import` 指纹与 AST 拓扑判级，无论文件嵌套在多少级子目录或何种自定义包名下均同等生效。
> **图例：** `ok` = 实测等级 ≥ 期望；`UNDER` = 漏判；`OVER` = 误判（期望为较低等级，实测更高）。
> **口径：** 需求文本统一为 `update`；含内容的用例在临时目录创建真实文件。

### A.0 治理平面与通用路径（路径级探针）

| 场景 | 路径 | 期望 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| IAM 目录 | `src/iam/policy.js` | L3 | L1 | UNDER |
| RBAC / permissions 目录 | `src/rbac/check.js`、`src/permissions/guard.js` | L3 | L1 | UNDER |
| identity 目录 | `src/identity/login.ts` | L3 | L1 | UNDER |
| authn 目录 | `src/authn/verify.ts` | L3 | L1 | UNDER |
| payments（复数） | `src/payments/charge.ts` | L3 | L1 | UNDER |
| 计费 / 定价 | `src/invoice/calc.ts`、`src/pricing/discount.ts` | L2 | L1 | UNDER |
| 库入口导出 | `src/index.js` | L2 | L1 | UNDER |
| SDK 公共导出 | `packages/sdk/src/public.ts` | L2 | L1 | UNDER |
| 部署清单 | `deploy/prod/deployment.yaml` | L2 | L1 | UNDER |
| 生产配置 | `config/production.yml` | L2 | L1 | UNDER |
| Terraform | `infra/main.tf` | L2 | L1 | UNDER |
| `CODEOWNERS` | `.github/CODEOWNERS` | L3 | L1 | UNDER |
| CI workflow | `.github/workflows/deploy.yml` | L3 | L1 | UNDER |
| 策略文件 | `.sdlc/policy.yaml` | L3 | L1 | UNDER |
| 评估规则自身 | `src/assess/rules/builtin.js` | L3 | L1 | UNDER |
| 依赖清单 | `requirements.txt` | L2 | **L0** | UNDER |
| Agent 指令 | `CLAUDE.md` | L3 | **L0** | UNDER |
| Agent 指令 | `.github/copilot-instructions.md` | L3 | **L0** | UNDER |
| Agent 命令 | `assets/commands/asdlc-new.md` | L3 | **L0** | UNDER |

### A.1 Java / Spring

| 场景 | 路径 | 期望 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| Spring controller | `order-service/src/main/java/com/acme/order/web/OrderController.java` | L2 | L2 | ok |
| API 载荷 DTO | `.../web/dto/CreateOrderRequest.java` | L2 | L1 | UNDER |
| Security 配置 | `.../config/SecurityConfig.java` | L3 | L1 | UNDER |
| JWT 过滤器 | `.../config/JwtAuthenticationFilter.java` | L3 | L1 | UNDER |
| 出站契约 | `.../client/PaymentFeignClient.java`（`@FeignClient`） | L2 | L1 | UNDER |
| 异步契约 | `.../mq/OrderEventListener.java`（`@KafkaListener`） | L2 | L1 | UNDER |
| JAX-RS `*Resource` | `.../rest/OrderResource.java` | L2 | L2 | ok |
| 生产配置 | `src/main/resources/application-prod.yml` | L2 | L1 | UNDER |
| Flyway 标准路径 | `src/main/resources/db/migration/V12__add_col.sql` | L2 | L2 | ok |
| Flyway 破坏性 | `src/main/resources/db/migration/V13__drop.sql`（`DROP TABLE`） | L3 | L3 | ok |
| Liquibase | `src/main/resources/db/changelog/db.changelog-2026.xml` | L2 | L1 | UNDER |
| MyBatis mapper XML | `src/main/resources/mapper/OrderMapper.xml` | L2 | L1 | UNDER |
| JPA 实体 | `.../domain/Order.java`（`@Entity`） | L2 | L1 | UNDER |
| Gradle Kotlin DSL | `build.gradle.kts` | L2 | L1 | UNDER |
| Gradle 版本目录 | `gradle/libs.versions.toml` | L2 | L1 | UNDER |
| 出站客户端 `*Api` | `.../util/ExternalApi.java` | L1 | L2 | OVER |

### A.2 Java / Alibaba Cloud

| 场景 | 路径 | 期望 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| Dubbo Facade 接口 | `order-api/src/main/java/com/acme/order/api/OrderFacade.java` | L2 | L1 | UNDER |
| `*-api` 模块 DTO | `order-api/.../api/dto/OrderDTO.java` | L2 | L1 | UNDER |
| Dubbo 提供者实现 | `.../rpc/OrderFacadeImpl.java`（`@DubboService`） | L2 | L1 | UNDER |
| RocketMQ 消费者 | `.../mq/OrderPaidConsumer.java`（`@RocketMQMessageListener`） | L2 | L1 | UNDER |
| Nacos bootstrap | `src/main/resources/bootstrap.yml` | L2 | L1 | UNDER |
| **AK/SK 明文** | `src/main/resources/application-prod.yml`（含 `alibaba.cloud.access-key`） | **L3** | **L1** | UNDER |
| Nacos 配置导出 | `config/nacos/order-service-prod.yaml` | L2 | L1 | UNDER |
| Sentinel 规则 | `src/main/resources/sentinel/flow-rules.json` | L2 | L1 | UNDER |
| Seata 注册 | `src/main/resources/seata/registry.conf` | L2 | L1 | UNDER |
| MyBatis-Plus 实体 | `.../dal/entity/OrderDO.java`（`@TableName`） | L2 | L1 | UNDER |
| MyBatis Mapper 接口 | `.../dal/mapper/OrderMapper.java`（`@Mapper`） | L2 | L1 | UNDER |
| Serverless Devs | `s.yaml` | L2 | L1 | UNDER |
| 阿里云 ROS | `ros/template.yaml` | L2 | L1 | UNDER |
| ACK 清单 | `deploy/ack/deployment.yaml` | L2 | L1 | UNDER |
| 云效流水线 | `.workflow/build.yml` | L3 | L1 | UNDER |
| Maven settings | `.mvn/settings.xml` | L2 | L1 | UNDER |

### A.3 Quarkus

| 场景 | 路径 | 期望 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| `*Resource`（后缀） | `src/main/java/org/acme/GreetingResource.java` | L2 | L2 | ok |
| JAX-RS `@Path`，无后缀 | `src/main/java/org/acme/OrderRest.java` | L2 | L1 | UNDER |
| Reactive Routes | `src/main/java/org/acme/Routes.java`（`@Route`） | L2 | L1 | UNDER |
| Panache 实体 | `src/main/java/org/acme/Order.java` | L2 | L1 | UNDER |
| Quarkus 配置 | `src/main/resources/application.properties` | L2 | L1 | UNDER |
| 自定义认证机制 | `.../CustomAuthMechanism.java` | L3 | L1 | UNDER |
| `SecurityIdentityAugmentor` | `.../RoleAugmentor.java` | L3 | L1 | UNDER |
| MicroProfile 配置 | `src/main/resources/META-INF/microprofile-config.properties` | L2 | L1 | UNDER |
| Dockerfile | `src/main/docker/Dockerfile.native-micro` | L2 | L2 | ok |
| 静态 OpenAPI | `src/main/resources/META-INF/openapi.yaml` | L2 | L2 | ok |
| Kotlin 写的 `@Path` | `src/main/kotlin/org/acme/GreetingKt.kt` | L2 | L1 | UNDER |

### A.4 Kotlin

| 场景 | 路径 | 期望 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| Spring Kotlin controller | `src/main/kotlin/com/acme/web/OrderController.kt` | L2 | L2 | ok |
| Ktor routing | `src/main/kotlin/com/acme/plugins/Routing.kt` | L2 | L1 | UNDER |
| Ktor Authentication | `src/main/kotlin/com/acme/plugins/Security.kt` | L3 | L1 | UNDER |
| Spring Kotlin SecurityConfig | `src/main/kotlin/com/acme/config/SecurityConfig.kt` | L3 | L1 | UNDER |
| Exposed 表定义 | `src/main/kotlin/com/acme/db/Tables.kt` | L2 | L1 | UNDER |
| buildSrc 版本 | `buildSrc/src/main/kotlin/Versions.kt` | L2 | L1 | UNDER |
| Gradle settings KTS | `settings.gradle.kts` | L2 | L1 | UNDER |
| `gradle.properties` | `gradle.properties`（含 `signing.password`） | L2 | L1 | UNDER |

### A.5 Go

| 场景 | 路径 | 期望 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| `gin.New()` 于 `router.go` | `internal/server/router.go` | L2 | L1 | UNDER |
| `handler` 目录 | `internal/handler/order.go` | L2 | L2 | ok |
| chi 路由 | `internal/transport/http/order_http.go` | L2 | L1 | UNDER |
| echo（路径含 `api/` 巧合命中） | `cmd/api/main.go` | L2 | L2 | ok（巧合） |
| gRPC 注册 | `internal/server/grpc.go` | L2 | L1 | UNDER |
| `pb.go` 生成物 | `api/v1/order.pb.go` | L1 | L2 | OVER |
| go-zero DSL | `api/order.api` | L2 | L1 | UNDER |
| buf 配置 | `buf.yaml` | L2 | L1 | UNDER |
| golang-migrate up | `migrations/000002_add_col.up.sql` | L2 | L2 | ok |
| **golang-migrate down（正常回滚）** | `migrations/000002_add_col.down.sql` | L2 | **L3** | OVER |
| GORM `AutoMigrate` | `internal/db/migrate.go` | L2 | L1 | UNDER |
| sqlc 配置 | `sqlc.yaml` | L2 | L1 | UNDER |
| JWT 中间件 | `pkg/middleware/jwt.go` | L3 | L1 | UNDER |
| RBAC 中间件 | `internal/middleware/rbac.go` | L3 | L1 | UNDER |
| go workspace | `go.work` | L2 | L1 | UNDER |
| vendor | `vendor/github.com/x/y/z.go` | L2 | L1 | UNDER |

### A.6 Python

| 场景 | 路径 | 期望 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| Django view | `shop/views.py` | L2 | L1 | UNDER |
| Django urls | `shop/urls.py` | L2 | L1 | UNDER |
| DRF serializer | `shop/serializers.py` | L2 | L1 | UNDER |
| Django model | `shop/models.py` | L2 | L1 | UNDER |
| Django migration | `shop/migrations/0002_auto.py` | L2 | L2 | ok |
| Django 破坏性迁移 | `shop/migrations/0003_del.py`（`DeleteModel`） | L3 | L2 | UNDER |
| Alembic 迁移 | `alembic/versions/ab12_add_col.py` | L2 | L1 | UNDER |
| Alembic 破坏性 | `alembic/versions/cd34_drop.py`（`op.drop_table`） | L3 | L1 | UNDER |
| `api/` 模块（无 router 字样） | `app/api/v1/users.py` | L2 | L1 | UNDER |
| Flask blueprint | `app/blueprints/orders.py`（`@bp.route`） | L2 | L1 | UNDER |
| Flask `routes.py` | `app/routes.py`（`@app.route`） | L2 | L1 | UNDER |
| Pydantic schema | `app/schemas/order.py` | L2 | L1 | UNDER |
| security 文件 | `app/core/security.py` | L3 | L1 | UNDER |
| auth 文件 | `app/core/auth.py` | L3 | L1 | UNDER |
| Django 生产设置 | `config/settings/production.py` | L3 | L1 | UNDER |
| pip 依赖 | `requirements.txt` | L2 | **L0** | UNDER |
| pyproject | `pyproject.toml` | L2 | L1 | UNDER |
| poetry lock | `poetry.lock` | L2 | L1 | UNDER |
| uv lock | `uv.lock` | L2 | L1 | UNDER |
| Airflow DAG | `dags/etl_daily.py` | L2 | L1 | UNDER |
| CLI `main.py` | `app/main.py` | L1 | L2 | OVER |

### A.7 Node.js / TypeScript

| 场景 | 路径 | 期望 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| Express `*.router.ts` | `src/modules/orders/orders.router.ts` | L2 | L1 | UNDER |
| tRPC router | `src/server/trpc/routers/order.ts` | L2 | L1 | UNDER |
| Nest guard（在 `auth/` 目录） | `src/modules/auth/auth.guard.ts` | L3 | L3 | ok |
| Nest JWT guard（无 `auth/` 目录） | `src/common/guards/jwt.guard.ts` | L3 | L1 | UNDER |
| Nest DTO | `src/modules/orders/dto/create-order.dto.ts` | L2 | L1 | UNDER |
| GraphQL resolver | `src/modules/orders/orders.resolver.ts` | L2 | L1 | UNDER |
| Next.js middleware | `src/middleware.ts` | L3 | L1 | UNDER |
| Next Server Action（`(auth)` 分组） | `src/app/(auth)/login/actions.ts` | L3 | L1 | UNDER |
| Next route handler | `src/app/api/orders/route.ts` | L2 | L2 | ok |
| 前端接口层 | `src/api/client.ts` | L1 | L2 | OVER |
| 前端接口模块 | `src/api/orders.ts` | L1 | L2 | OVER |
| monorepo 子包清单 | `packages/ui/package.json` | L1 | L2 | OVER |
| `.npmrc` | `.npmrc` | L2 | L1 | UNDER |
| pnpm workspace | `pnpm-workspace.yaml` | L2 | L1 | UNDER |
| bun lock | `bun.lockb` | L2 | L1 | UNDER |
| Next 配置 | `next.config.js` | L2 | L1 | UNDER |
| serverless | `serverless.yml` | L2 | L1 | UNDER |
| Drizzle schema | `db/schema.ts` | L2 | L1 | UNDER |
| Drizzle 迁移 | `drizzle/0001_init.sql` | L2 | L1 | UNDER |
| AWS CDK | `infra/lib/api-stack.ts` | L2 | L1 | UNDER |
| LLM 提示词 | `src/prompts/system.md` | L2 | **L0** | UNDER |

### A.8 .NET / IaC / 文档豁免

| 场景 | 路径 | 期望 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| .NET controller | `Api/Controllers/OrdersController.cs` | L2 | L1 | UNDER |
| .NET 依赖 | `Api/Api.csproj` | L2 | L1 | UNDER |
| .NET 生产设置 | `Api/appsettings.Production.json` | L3 | L1 | UNDER |
| Helm（`charts/`） | `charts/app/values.yaml` | L2 | L1 | UNDER |
| k8s（`kubernetes/`） | `kubernetes/deploy.yaml` | L2 | L1 | UNDER |
| Terraform | `infra/main.tf` | L2 | L1 | UNDER |
| C++ 构建 | `CMakeLists.txt` | L2 | **L0** | UNDER |
| **OpenAPI 在 `docs/`** | `docs/api/openapi.yaml` | L2 | **L0** | UNDER |
| **Swagger 在 `docs/`** | `docs/swagger.json` | L2 | **L0** | UNDER |
| `session/` 下的 CSS | `src/session/ui/Banner.css` | L1 | **L3** | OVER |
| `auth/` 下的 CSS | `web/src/auth/login.css` | L1 | **L3** | OVER |

---

## 附录 B：复现方式

探针脚本为一次性评审产物，**未纳入仓库**，位于评审会话的临时目录：

```
<brain>/scratch/probe.mjs       # 通用路径探针（A.0）
<brain>/scratch/probe2.mjs      # 治理文件 / L0 探针（A.0）
<brain>/scratch/probe3.mjs      # Java / Python / Node / .NET / IaC，69 用例（A.1、A.6~A.8）
<brain>/scratch/probe4.mjs      # Alibaba / Quarkus / Kotlin / Go，51 用例（A.2~A.5）
<brain>/scratch/probe_pe.mjs    # PE 控制面自降级绕过与 Verifier Prompt 注入面探针（第 6 节）
<brain>/scratch/probe_zh.mjs    # 中文需求分类、Spec Lint 全角标点与 UTF-8 BOM 探针（第 7 节）
<brain>/scratch/probe_zhgit2.mjs # 真实 Git 仓库中文文件名 core.quotepath 暂存与降级探针（第 7 节）
```

核心调用方式（节选）：

```js
import { assess } from '<repo>/src/assess/index.js';

const r = assess({
  stage: 'impl',
  changeId: 'x',
  requirement: 'update',          // 刻意平淡，排除关键词干扰
  changedFiles: [relativePath],
  repoRoot: tmpDirWithRealFiles,  // 内容检测规则需要真实文件
  persist: false,
});
console.log(r.risk.level, r.governance.workflow_mode, r.governance.auto_approval);
```

**建议：** 按 [12.1](#121-对抗用例库) 将用例固化为 `test/risk-corpus/*.json`、`test/control-plane-security.test.js` 与 `test/utf8-i18n-engineering.test.js`，纳入 `npm test`，使其可持续复现并防止回退。
