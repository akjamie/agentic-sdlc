import { HARD_RULES } from '../rules/builtin.js';

export function evaluateV2Security({ requirement = '', changedFiles = [] } = {}) {
  const req = String(requirement || '').toLowerCase();
  const evidence = [];
  const unresolved = [];
  let level = 'L1';
  let confidence = 'high';
  let mandatory_human_review = false;
  let no_signal = true;

  // 1. Check Hard Rules against physical files
  const securityRules = HARD_RULES.filter((r) =>
    ['HARD_GOV_PLANE', 'HARD_SECURITY_CREDENTIALS', 'HARD_FINANCIAL_ASSETS', 'HARD_DESTRUCTIVE_DDL'].includes(r.id)
  );

  for (const rule of securityRules) {
    const hits = changedFiles.filter((f) => rule.patterns.some((p) => p.test(f.replace(/\\/g, '/'))));
    if (hits.length > 0) {
      level = 'L3';
      no_signal = false;
      mandatory_human_review = rule.mandatory_human_review;
      evidence.push({
        id: `V2_${rule.id}`,
        kind: 'rule_hit',
        rule_id: rule.id,
        signal: 'hard',
        summary: `${rule.summary} (${hits.slice(0, 3).join(', ')})`,
        source: hits[0]
      });
    }
  }

  // 2. Check Requirement Semantics for Security/Financial/Regulatory
  const secKeywords = [
    'auth', 'authentication', 'password', 'oauth', 'jwt', 'session', 'mfa', 'rbac', 'kms', 'secret',
    'token', 'permission', 'crypto', 'credential', 'private key', 'payment', 'payout', 'refund', 'billing',
    'ledger', 'wallet', 'clearing', 'pii', 'gdpr', 'tax id', 'ssn'
  ];

  for (const kw of secKeywords) {
    const re = new RegExp(`\\b${kw.replace(/-/g, '[-\\s]')}\\b`, 'i');
    if (re.test(req)) {
      no_signal = false;
      // Soft signal for requirement alone: elevates to L3 + mandatory human review if high confidence
      if (level !== 'L3') {
        level = 'L3';
        mandatory_human_review = true;
      }
      evidence.push({
        id: 'V2_SECURITY_KEYWORD',
        kind: 'task_statement',
        signal: 'soft',
        summary: `Task requirement touches critical security/regulatory domain: '${kw}'`
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
