import { HARD_RULES } from '../rules/builtin.js';

export function evaluateV3Topology({ requirement = '', changedFiles = [], repoRoot = null } = {}) {
  const req = String(requirement || '').toLowerCase();
  const evidence = [];
  const unresolved = [];
  let level = 'L1';
  let confidence = 'high';
  let mandatory_human_review = false;
  let no_signal = true;

  // 1. Check Hard Rules for Topology / Contracts / Infra
  const topoRules = HARD_RULES.filter((r) =>
    ['HARD_API_CONTRACT', 'HARD_DB_MIGRATION', 'HARD_SUPPLY_CHAIN'].includes(r.id)
  );

  for (const rule of topoRules) {
    const hits = changedFiles.filter((f) => rule.patterns.some((p) => p.test(f.replace(/\\/g, '/'))));
    if (hits.length > 0) {
      level = 'L2';
      no_signal = false;
      evidence.push({
        id: `V3_${rule.id}`,
        kind: 'rule_hit',
        rule_id: rule.id,
        signal: 'hard',
        summary: `${rule.summary} (${hits.slice(0, 3).join(', ')})`,
        source: hits[0]
      });
    }
  }

  // 2. Check Requirement Semantics for Architecture / Schema / Infra
  const topoKeywords = [
    'api', 'endpoint', 'openapi', 'swagger', 'grpc', 'protobuf', 'graphql', 'webhook',
    'fastapi', 'springboot', 'spring boot', 'controller', 'rest api', 'router',
    'database', 'migration', 'schema', 'table', 'ddl', 'model', 'docker', 'k8s', 'helm'
  ];

  for (const kw of topoKeywords) {
    const re = new RegExp(`\\b${kw.replace(/-/g, '[-\\s]')}\\b`, 'i');
    if (re.test(req)) {
      no_signal = false;
      if (level === 'L1') {
        level = 'L2';
      }
      evidence.push({
        id: 'V3_TOPOLOGY_KEYWORD',
        kind: 'task_statement',
        signal: 'soft',
        summary: `Requirement touches cross-boundary architectural keyword: '${kw}'`
      });
      break;
    }
  }

  return {
    level,
    confidence,
    evidence,
    unresolved,
    mandatory_human_review,
    no_signal
  };
}
