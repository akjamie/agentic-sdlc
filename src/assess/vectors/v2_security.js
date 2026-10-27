import { HARD_RULES, isTestOrDocFile } from '../rules/builtin.js';
import { judgeChangeSemantics } from '../ai_judge.js';

export function evaluateV2Security({ requirement = '', changedFiles = [], repoRoot = null } = {}) {
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
    const hits = changedFiles.filter((f) => {
      // Exclude test and documentation files from security/destructive hard rules (never exclude governance plane)
      if (rule.id !== 'HARD_GOV_PLANE' && isTestOrDocFile(f)) return false;
      const norm = f.replace(/\\/g, '/');
      if (rule.patterns.some((p) => p.test(norm))) return true;
      // Content-level or name-level DDL check for SQL files
      if (rule.id === 'HARD_DESTRUCTIVE_DDL' && /\.(sql)$/i.test(norm)) {
        if (/drop|truncate|purge|destructive/i.test(norm)) return true;
      }
      return false;
    });

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
  const highRiskCompounds = [
    'access token', 'refresh token', 'bearer token', 'session token', 'auth token', 'security token',
    'jwt', 'oauth', 'private key', 'secret key', 'password hash', 'password encryption',
    'mfa', 'rbac', 'kms', 'pii', 'gdpr', 'tax id', 'ssn', 'payment refund', 'payment ledger',
    'refund ledger', 'clearing settlement', 'credit card'
  ];

  const genericSecWords = [
    'auth', 'authentication', 'password', 'credential', 'crypto',
    'payment', 'payout', 'refund', 'billing', 'ledger', 'wallet', 'clearing'
  ];

  let compoundHit = null;
  for (const compound of highRiskCompounds) {
    const re = new RegExp(`\\b${compound.replace(/-/g, '[-\\s]')}\\b`, 'i');
    if (re.test(req)) {
      compoundHit = compound;
      break;
    }
  }

  const matchedGenerics = [];
  for (const word of genericSecWords) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(req)) {
      matchedGenerics.push(word);
    }
  }

  const aiJudgment = judgeChangeSemantics({ requirement: req, changedFiles });
  const isDocOrTest = aiJudgment.is_pure_test || aiJudgment.is_pure_doc;

  if (!isDocOrTest) {
    if (compoundHit) {
      no_signal = false;
      level = 'L3';
      mandatory_human_review = true;
      evidence.push({
        id: 'V2_SECURITY_COMPOUND_KEYWORD',
        kind: 'task_statement',
        signal: 'hard',
        summary: `Task requirement touches critical security/regulatory compound phrase: '${compoundHit}'`
      });
    } else if (matchedGenerics.length >= 2) {
      no_signal = false;
      level = 'L3';
      mandatory_human_review = true;
      evidence.push({
        id: 'V2_SECURITY_MULTI_KEYWORD',
        kind: 'task_statement',
        signal: 'soft',
        summary: `Task requirement touches multiple security/financial domains: '${matchedGenerics.join(', ')}'`
      });
    } else if (matchedGenerics.length === 1) {
      no_signal = false;
      if (level === 'L1') {
        level = 'L2'; // Capped at L2 for single soft generic keyword
      }
      evidence.push({
        id: 'V2_SECURITY_SINGLE_KEYWORD',
        kind: 'task_statement',
        signal: 'soft',
        summary: `Task requirement touches security/financial domain keyword: '${matchedGenerics[0]}'`
      });
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
