/**
 * Formats assessment records into PR status summaries, comments, and labels (Specification §9.7)
 */

export function renderCheckSummary(record) {
  const lvl = record.risk.level;
  const human = record.governance.implementation_review === 'ai+human' ? 'human-review-required' : 'auto-merge-eligible';
  const codes = (record.reason_codes || []).join(',') || 'NONE';
  return `[${record.verdict.toUpperCase()}] Level: ${lvl} | Mode: ${record.governance.workflow_mode} | Review: ${human} | Codes: ${codes}`;
}

export function renderPRComment(record) {
  const isEscalated = record.transition.direction === 'up';
  const lvl = record.risk.level;
  const isHumanReview = record.governance.implementation_review === 'ai+human';

  // Prominent Governance Level & Action Highlight Banner
  let actionHighlight = '';
  if (isEscalated) {
    actionHighlight = `> ⚠️ **【治理动作：实施阶段升级 · 必须人工终审】**\n> 🎯 **最终治理等级**：\`${lvl}\`（由 \`${record.transition.from_level || 'L1'}\` 原地升级）\n> 🚨 **流转执行**：保持单 PR 流水线，**自动合并已关闭 (Auto-Merge DENIED)**，必须由人类 Lead 审核批准后方可合入。`;
  } else if (isHumanReview) {
    actionHighlight = `> 🛑 **【治理动作：高风险改动 · 必须人工终审】**\n> 🎯 **最终治理等级**：\`${lvl}\`\n> 🚨 **流转执行**：**自动合并已关闭 (Auto-Merge DENIED)**，必须由人类 Lead 审核批准后方可合入主干。`;
  } else {
    actionHighlight = `> ⚡ **【治理动作：低风险改动 · AI 自动合入 (Auto-Merge Eligible)】**\n> 🎯 **最终治理等级**：\`${lvl}\`\n> 🚀 **流转执行**：CI 门禁与自动化测试全绿后，**系统将自动 Approve 并执行合并**，无需人工审批阻断。`;
  }

  const title = isEscalated
    ? `⚠️ 需要人工评审 · 风险等级 ${record.transition.from_level || 'L1'} → ${lvl}（升级）`
    : `🛡️ ASdlc 治理评估报告 · 风险等级 ${lvl}`;

  const reasonList = (record.reason_codes || []).map((c) => `- [${c}]`).join('\n') || '- 局部封闭改动，未触发硬规则';

  const evidenceItems = [];
  for (const vName of ['v1_intent', 'v2_security', 'v3_topology']) {
    const v = record.vectors[vName];
    if (v && v.evidence) {
      for (const e of v.evidence) {
        evidenceItems.push(`- [${e.signal.toUpperCase()}] ${e.summary}`);
      }
    }
  }

  const reviewQuestions = isHumanReview
    ? `**评审人请确认：**\n- 行为与代码变化是否与已批准意图一致\n- 确认未解项与潜在外部影响已被充分覆盖\n`
    : `**自动化判定：**\n- 满足自动合并条件，无需额外人工 Lead 审批。\n`;

  return `### ${title}

${actionHighlight}

| 最终治理等级 (Level) | 工作流模式 (Workflow) | 实施评审要求 (Review) | 记录指纹 (Fingerprint) |
| :---: | :---: | :---: | :---: |
| **\`${lvl}\`** | \`${record.governance.workflow_mode}\` | \`${record.governance.implementation_review}\` | \`${(record.hash || '').slice(0, 12) || 'unpersisted'}\` |

**📋 评估理由与依据：**
${evidenceItems.join('\n') || reasonList}

${reviewQuestions}
`;
}

export function renderLabels(record) {
  const labels = [`asdlc:${record.risk.level}`];
  if (record.governance.implementation_review === 'ai+human') {
    labels.push('asdlc:human-review-required');
  }
  if (record.transition.direction === 'up') {
    labels.push('asdlc:escalated');
  }
  return labels;
}
