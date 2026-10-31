import path from 'node:path';
import { exists, readText } from '../../lib/fs.js';
import { HARD_RULES, isTestOrDocFile, CANONICAL_DESTRUCTIVE_PATTERN } from '../rules/builtin.js';
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
      // Exclude test and documentation files from security/credentials (never exclude governance plane or destructive DDL) (P1-4)
      if (rule.id !== 'HARD_GOV_PLANE' && rule.id !== 'HARD_DESTRUCTIVE_DDL' && isTestOrDocFile(f)) return false;
      const norm = f.replace(/\\/g, '/');
      if (rule.patterns.some((p) => p.test(norm))) return true;
      // Content-level or name-level DDL check for SQL files (P1-2)
      if (rule.id === 'HARD_DESTRUCTIVE_DDL' && /\.(sql)$/i.test(norm)) {
        if (/drop|truncate|purge|destructive/i.test(norm)) return true;
        if (repoRoot) {
          const fullPath = path.isAbsolute(f) ? f : path.join(repoRoot, f);
          if (exists(fullPath)) {
            const sqlContent = readText(fullPath);
            if (CANONICAL_DESTRUCTIVE_PATTERN.test(sqlContent)) return true;
          }
        }
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

  // 2. Check Requirement Semantics for Security/Financial/Regulatory (English + Chinese)
  const highRiskCompounds = [
    'access token', 'refresh token', 'bearer token', 'session token', 'auth token', 'security token',
    'jwt', 'oauth', 'private key', 'secret key', 'password hash', 'password encryption',
    'mfa', 'rbac', 'kms', 'pii', 'gdpr', 'tax id', 'ssn', 'payment refund', 'payment ledger',
    'refund ledger', 'clearing settlement', 'credit card'
  ];

  const cjkHighRiskCompounds = [
    '清结算', '资金清算', '账务清算', '资金账本', '核心账务', '对账', '打款', '提现',
    '私钥', '密钥轮换', '密码哈希', '密码加密', '鉴权绕过', '越权', '隐私合规', '实名认证', '数据脱敏'
  ];

  const genericSecWords = [
    'auth', 'authentication', 'password', 'credential', 'crypto',
    'payment', 'payout', 'refund', 'billing', 'ledger', 'wallet', 'clearing'
  ];

  const cjkGenericSecWords = [
    '支付', '结算', '账务', '账本', '钱包', '计费', '账单', '退款',
    '鉴权', '认证', '权限', '密钥', '令牌', '加密', '登录态'
  ];

  let compoundHit = null;
  for (const compound of highRiskCompounds) {
    const re = new RegExp(`\\b${compound.replace(/-/g, '[-\\s]')}\\b`, 'i');
    if (re.test(req)) {
      compoundHit = compound;
      break;
    }
  }
  if (!compoundHit) {
    for (const cjkCompound of cjkHighRiskCompounds) {
      if (req.includes(cjkCompound)) {
        compoundHit = cjkCompound;
        break;
      }
    }
  }

  const matchedGenerics = [];
  for (const word of genericSecWords) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(req)) {
      matchedGenerics.push(word);
    }
  }
  for (const cjkWord of cjkGenericSecWords) {
    if (req.includes(cjkWord)) {
      matchedGenerics.push(cjkWord);
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
