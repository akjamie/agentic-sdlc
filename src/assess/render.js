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
  const title = isEscalated
    ? `⚠️ 需要人工评审 · 风险等级 ${record.transition.from_level || 'L1'} → ${record.risk.level}（升级）`
    : `🛡️ ASdlc 治理评估报告 · 风险等级 ${record.risk.level}`;

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

  const reviewQuestions = record.governance.implementation_review === 'ai+human'
    ? `**评审人请确认：**\n- 行为与代码变化是否与已批准意图一致\n- 确认未解项与潜在外部影响已被充分覆盖\n`
    : `**自动化判定：**\n- 满足自动合并条件，无需额外人工 Lead 审批。\n`;

  return `### ${title}

**评估理由：**
${evidenceItems.join('\n') || reasonList}

${reviewQuestions}
**治理结果：**
- **工作流模式**：\`${record.governance.workflow_mode}\`
- **实施评审要求**：\`${record.governance.implementation_review}\`
- **评估阶段**：\`${record.stage}\` (序号: #${record.seq})
- **规则版本**：\`${record.source.harness_rules_version}\`
- **记录指纹**：\`${record.hash.slice(0, 12)}\`
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
