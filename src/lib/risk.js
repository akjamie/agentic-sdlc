import path from 'node:path';
import { exists, readText } from './fs.js';

export const RISK_LEVELS = {
  L0: 'L0',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
};

export const LEVEL_RANK = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

// 1. Regulatory & High-Risk Security/Financial Keywords (L3)
export const L3_KEYWORDS = {
  financial: [
    'payment', 'payout', 'refund', 'billing', 'ledger', 'wallet',
    'clearing', 'transaction', 'pricing-engine', 'pricing engine',
    'settlement', 'reconciliation', 'checkout'
  ],
  security: [
    'auth', 'oauth', 'jwt', 'session', 'mfa', 'sso', 'rbac', 'abac',
    'iam', 'kms', 'secret', 'credential', 'private-key', 'private key',
    'password', 'crypto', 'encryption', 'certificate', 'token', 'permission'
  ],
  compliance: [
    'pii', 'tax-id', 'tax id', 'ssn', 'audit-log', 'audit log',
    'card-number', 'card number', 'gdpr', 'hipaa', 'pci-dss', 'pci dss'
  ],
  destructive: [
    'drop table', 'drop column', 'truncate', 'purge', 'hard delete',
    'hard-delete', 'destructive', 'drop index', 'clean database'
  ]
};

// 2. Cross-Boundary & Architecture Topology Keywords (L2)
export const L2_KEYWORDS = {
  api_contracts: [
    'api', 'openapi', 'swagger', 'grpc', 'protobuf', 'graphql',
    'webhook', 'gateway', 'router', 'endpoint', 'rest'
  ],
  data_models: [
    'database', 'db', 'migration', 'schema', 'ddl', 'table',
    'entity', 'orm', 'prisma', 'typeorm', 'model'
  ],
  infra_supply: [
    'docker', 'k8s', 'kubernetes', 'helm', 'terraform', 'pipeline',
    'ci/cd', 'workflow', 'package.json', 'pnpm-lock', 'go.mod', 'cargo.toml'
  ]
};

// 3. Trivial/Documentation Keywords (for L0 demotion)
export const L0_KEYWORDS = [
  'typo', 'readme', 'doc', 'docs', 'documentation', 'comment',
  'comments', 'formatting', 'whitespace', 'spelling', 'markdown'
];

// Patterns that indicate functional code modifications (not pure doc updates)
const COMPOUND_CODE_ACTIONS = [
  /\b(implement|build|rewrite)\b/i,
  /\bfix (bug|issue|defect|error|crash|panic)\b/i,
  /\brefactor (logic|engine|service|handler|module|architecture)\b/i,
  /\badd (feature|endpoint|service|support|functionality)\b/i,
  /\bmigrate (database|table|schema|data)\b/i
];

// File path patterns
const DOC_PATH_PATTERNS = [
  /^docs\//i,
  /\.md$/i,
  /\.txt$/i,
  /^LICENSE/i
];

const TEST_PATH_PATTERNS = [
  /^test\//i,
  /^tests\//i,
  /__tests__\//i,
  /\.test\.[a-z0-9]+$/i,
  /\.spec\.[a-z0-9]+$/i,
  /^fixtures\//i
];

const L3_PATH_PATTERNS = [
  /(^|\/)(auth|security|payment|billing|ledger|kms)\//i,
  /(^|\/)migrations\/.*(drop|destructive|purge)/i,
  /\.(pem|key)$/i
];

const L2_PATH_PATTERNS = [
  /(^|\/)(api|protos?|schemas?|migrations?|k8s|helm|infra)\//i,
  /(^|\/)(openapi|swagger)\.[a-z0-9]+$/i,
  /\.(proto|graphql|prisma)$/i,
  /(^|\/)(dockerfile.*|containerfile.*)$/i,
  /(^|\/)(package\.json|go\.mod|cargo\.toml|pom\.xml)$/i,
  /^\.github\/workflows\//i
];

/**
 * Normalizes file paths to POSIX format.
 */
function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/');
}

/**
 * Evaluates risk and impact across SDLC stages.
 * Stage 1 (asdlc new): evaluates requirement text and intent.
 * Stage 6 (asdlc verify / pr): evaluates real changed files and guards against level escape.
 *
 * @param {Object} options
 * @param {string} [options.requirement] - Natural language requirement / intent
 * @param {string[]} [options.changedFiles] - Physical list of changed files from git diff
 * @param {string} [options.currentLevel] - Stamped governance level in .openspec.yaml
 * @param {string} [options.repoRoot] - Repository root directory
 * @returns {Object} Assessment report
 */
export function assessRisk({ requirement = '', changedFiles = [], currentLevel = null, repoRoot = null } = {}) {
  const reqText = String(requirement || '').toLowerCase();
  const normFiles = (changedFiles || []).map(normalizePath).filter(Boolean);

  let assessedLevel = RISK_LEVELS.L1;
  const reasons = [];
  const findings = {
    regulatory: [],
    architectural: [],
    destructive: [],
    demotionGuards: []
  };

  // =========================================================================
  // 1. Physical Code Blast Radius Check (Stage 6: verify / pr)
  // =========================================================================
  if (normFiles.length > 0) {
    const nonDocFiles = normFiles.filter((f) => !DOC_PATH_PATTERNS.some((p) => p.test(f)));
    const nonTestFiles = nonDocFiles.filter((f) => !TEST_PATH_PATTERNS.some((p) => p.test(f)));

    // A. Pure documentation changes -> L0
    if (nonDocFiles.length === 0) {
      assessedLevel = RISK_LEVELS.L0;
      reasons.push('all modified files are documentation or non-executable markdown/text');
      findings.demotionGuards.push('pure-documentation-files');
    }
    // B. Pure test changes -> capped at L1
    else if (nonTestFiles.length === 0) {
      assessedLevel = RISK_LEVELS.L1;
      reasons.push('all functional changes are restricted to test files and fixtures');
      findings.demotionGuards.push('pure-test-files');
    }
    // C. Source code changes evaluated against file path patterns
    else {
      // Check L3 path patterns (security/financial/destructive)
      const l3Hits = nonTestFiles.filter((f) => L3_PATH_PATTERNS.some((p) => p.test(f)));
      if (l3Hits.length > 0) {
        assessedLevel = RISK_LEVELS.L3;
        reasons.push(`modified high-risk regulatory or security files: ${l3Hits.slice(0, 3).join(', ')}`);
        findings.regulatory.push(...l3Hits);
      } else {
        // Check L2 path patterns (API/migrations/schema/infra)
        const l2Hits = nonTestFiles.filter((f) => L2_PATH_PATTERNS.some((p) => p.test(f)));
        if (l2Hits.length > 0) {
          assessedLevel = RISK_LEVELS.L2;
          reasons.push(`modified architectural contract, schema, or infra files: ${l2Hits.slice(0, 3).join(', ')}`);
          findings.architectural.push(...l2Hits);
        }
      }
    }
  }

  // =========================================================================
  // 2. Intent & Requirement Analysis (Stage 1: asdlc new, or combined)
  // =========================================================================
  if (reqText.trim()) {
    let reqLevel = RISK_LEVELS.L1;
    let reqReason = 'bounded local module change';

    // A. Demotion Guard: Check pure documentation / typo intent
    const hasL0Keyword = L0_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(reqText));
    const hasFunctionalCodeAction = COMPOUND_CODE_ACTIONS.some((pattern) => pattern.test(reqText));

    if (hasL0Keyword && !hasFunctionalCodeAction) {
      reqLevel = RISK_LEVELS.L0;
      reqReason = 'documentation, typographical, or formatting modification';
      findings.demotionGuards.push('pure-doc-intent');
    } else {
      // B. Check L3 keywords (Financial, Security, Compliance, Destructive)
      let matchedL3 = null;
      for (const [category, words] of Object.entries(L3_KEYWORDS)) {
        for (const w of words) {
          if (new RegExp(`\\b${w.replace(/-/g, '[-\\s]')}\\b`, 'i').test(reqText)) {
            matchedL3 = { category, keyword: w };
            break;
          }
        }
        if (matchedL3) break;
      }

      if (matchedL3) {
        reqLevel = RISK_LEVELS.L3;
        reqReason = `critical domain keyword matched: '${matchedL3.keyword}' (${matchedL3.category})`;
        findings.regulatory.push(matchedL3);
      } else {
        // C. Check L2 keywords (API, Data Model, Infra)
        let matchedL2 = null;
        for (const [category, words] of Object.entries(L2_KEYWORDS)) {
          for (const w of words) {
            if (new RegExp(`\\b${w.replace(/-/g, '[-\\s]')}\\b`, 'i').test(reqText)) {
              matchedL2 = { category, keyword: w };
              break;
            }
          }
          if (matchedL2) break;
        }

        if (matchedL2) {
          reqLevel = RISK_LEVELS.L2;
          reqReason = `cross-boundary architectural keyword matched: '${matchedL2.keyword}' (${matchedL2.category})`;
          findings.architectural.push(matchedL2);
        }
      }
    }

    // Combine requirement evaluation with file-based evaluation (take the higher risk)
    if (normFiles.length === 0 || LEVEL_RANK[reqLevel] > LEVEL_RANK[assessedLevel]) {
      assessedLevel = reqLevel;
      reasons.unshift(reqReason);
    }
  }

  // =========================================================================
  // 3. Monotonic Escalation Guard (Against Level Escape)
  // =========================================================================
  let action = 'INITIAL';
  let escalated = false;

  if (currentLevel) {
    const curRank = LEVEL_RANK[currentLevel] ?? 1;
    const assessedRank = LEVEL_RANK[assessedLevel] ?? 1;

    if (assessedRank > curRank) {
      action = 'ESCALATE';
      escalated = true;
      reasons.push(`governance level escalated from ${currentLevel} to ${assessedLevel} due to physical blast radius`);
    } else {
      action = 'MAINTAIN';
      // System does not demote declared governance level automatically
      assessedLevel = currentLevel;
    }
  }

  return {
    level: assessedLevel,
    currentLevel: currentLevel || null,
    action,
    escalated,
    reasons: [...new Set(reasons)],
    findings,
    isSinglePr: assessedLevel === RISK_LEVELS.L0 || assessedLevel === RISK_LEVELS.L1,
    requiresHumanReview: assessedLevel === RISK_LEVELS.L3
  };
}
