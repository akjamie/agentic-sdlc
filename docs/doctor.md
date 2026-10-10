# `asdlc doctor` — Environment & Toolchain Diagnostics
# 环境与工具链健康诊断指南

> **Quick command / 快捷命令**:  
> `asdlc doctor` (诊断当前环境与配置健康度)  
> `asdlc doctor --fix` (自动修复可自愈的配置漂移)

---

## 1. Overview / 概述

`asdlc doctor` 是 Agentic SDLC 的环境自检与治理诊断命令。它模拟真实的流水线与 AI Agent 视角，对底层运行时、规约引擎、知识图谱、安全门禁及 Git 配置进行 **12 维全面体检**。

当执行 `asdlc doctor` 时，各项检查以 `PASS` / `WARN` / `FAIL` 输出，并提供诊断明细与修复指引。

---

## 2. Diagnostic Matrix / 12 维诊断矩阵与修复能力分类

系统将问题严格划分为 **可自动修复（Auto-Fixable）** 与 **需人工介入（Manual Action Required）** 两大类：

| # | 检查项 / Diagnostic Check | 说明 / Description | 严重级别 | 是否可 `--fix` 自愈？ | 修复动作 / 处置方案 |
| :- | :--- | :--- | :--- | :--- | :--- |
| **1** | **node >= 20.19** | Node.js 运行时版本 | **FAIL** | ❌ 需人工升级 | 升级本地 Node.js 运行时至 `>= 20.19.0` (推荐 Node 20 LTS 或 Node 22) |
| **2** | **OpenSpec CLI** | OpenSpec 规约引擎是否就绪 | **FAIL/WARN** | ❌ 需环境就绪 | `npm install -g openspec` 或运行 `asdlc init` |
| **3** | **Graphify** | Python AST 代码拓扑工具 | **WARN** | 🟢 **可自愈** (`--fix`) | 调用 `uv tool install graphifyy` 或 `pip install graphifyy` |
| **4** | **OpenSpec project** | 项目是否初始化 OpenSpec 目录 | **FAIL** | ❌ 需初始化 | 运行 `asdlc init` 脚手架 |
| **5** | **managed schema** | BU 集中纳管的 OpenSpec Schema | **FAIL** | 🟢 **可自愈** (`--fix`) | 自动重新安装并注册 BU managed schema 到系统全局 |
| **6** | **schema override** | 是否违规将 schema 提交进当前仓库 | **FAIL** | ❌ 需人工还原 | **严禁在单体业务仓库提交私有 schema**；需执行 `git rm openspec/schemas/` 还原 |
| **7** | **repo config schema** | 仓库 config.yaml 是否声明标准 schema | **WARN** | 🟢 **可自愈** (`--fix`) | 自动将 `schema: agentic-repo-change` 写入 `openspec/config.yaml` |
| **8** | **.sdlc/policy.yaml** | 团队治理准则配置文件是否存在 | **WARN** | 🟢 **可自愈** (`--fix`) | 自动从资产模板复制生成 `.sdlc/policy.yaml` |
| **9** | **.githooks** | Git 提交与推送安全钩子是否激活 | **WARN** | 🟢 **可自愈** (`--fix`) | 自动复制 hook 脚本并执行 `git config core.hooksPath .githooks` |
| **10**| **AGENTS.md routing** | System Prompt 根入口是否包含路由 | **WARN** | 🟢 **可自愈** (`--fix`) | 自动调用 `refreshAgents()` 重新渲染标准 7 阶段路由指令 |
| **11**| **knowledge graph** | AST 拓扑图谱是否最新 (fresh) | **WARN** | 🟢 **可自愈** (`--fix`) | 运行 `graphify build` 刷新图谱缓存 |
| **12**| **graphify-out ignored**| 图谱缓存目录是否已加入 .gitignore | **WARN** | 🟢 **可自愈** (`--fix`) | 自动将 `graphify-out/` 追加写入 `.gitignore`，防止误提交超大缓存 |

---

## 3. Usage & Remediation Workflow / 常用诊断与自愈工作流

### 场景 1：日常健康体检
在拉取他人分支或开始编写新需求前：
```bash
asdlc doctor
```
若全部通过，终端输出：
```text
  [PASS] node >= 20.19
  [PASS] OpenSpec CLI
  [PASS] Graphify
  [PASS] OpenSpec project
  [PASS] managed schema
  [PASS] schema override
  [PASS] repo config schema
  [PASS] .sdlc/policy.yaml
  [PASS] .githooks
  [PASS] AGENTS.md routing
  [PASS] knowledge graph
  [PASS] graphify-out ignored

doctor: ok
```

### 场景 2：一键自愈配置漂移
如果克隆了新仓库，或者拉取了未配置 githooks / 缺少 policy 的分支：
```bash
asdlc doctor --fix
```
CLI 会逐一自动补全丢失的治理文件与配置：
```text
attempting automated remediation (--fix)...
✔ fixed: configured git core.hooksPath -> .githooks
✔ fixed: created .sdlc/policy.yaml from template
✔ fixed: refreshed AGENTS.md routing
✔ fixed: added graphify-out/ to .gitignore

doctor: ok
```

### 场景 3：遇到不可自愈的阻断性故障（FAIL）
若输出中含有 `FAIL`：
1. **Node 版本过低**：使用 `nvm` 或官方安装包切换到 Node 20+；
2. **Schema Override 违规**：某些开发者可能会尝试在仓库内魔改 `openspec/schemas/agentic-repo-change`，这破坏了全团队统一规约。执行 `git rm -r openspec/schemas/` 恢复合规。
