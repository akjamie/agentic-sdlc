import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk, RISK_LEVELS } from '../src/lib/risk.js';

test('assessRisk - Stage 1 (asdlc new): Demotion Guards for pure docs', () => {
  // Should demote to L0 even if high-risk keywords like auth/payment exist in doc context
  const r1 = assessRisk({ requirement: 'fix typo in auth error docs' });
  assert.equal(r1.level, RISK_LEVELS.L0);
  assert.equal(r1.isSinglePr, true);

  const r2 = assessRisk({ requirement: 'update payment integration readme markdown' });
  assert.equal(r2.level, RISK_LEVELS.L0);

  const r3 = assessRisk({ requirement: 'format comments and whitespace in user service' });
  assert.equal(r3.level, RISK_LEVELS.L0);
});

test('assessRisk - Stage 1 (asdlc new): High-Risk Regulatory and Security (L3)', () => {
  // Financial domain
  const r1 = assessRisk({ requirement: 'implement payment refund ledger clearing' });
  assert.equal(r1.level, RISK_LEVELS.L3);
  assert.equal(r1.requiresHumanReview, true);
  assert.equal(r1.isSinglePr, false);

  // Auth / Security domain
  const r2 = assessRisk({ requirement: 'add oauth jwt session authentication' });
  assert.equal(r2.level, RISK_LEVELS.L3);
  assert.equal(r2.requiresHumanReview, true);

  // Compliance / PII domain
  const r3 = assessRisk({ requirement: 'process user pii tax id for gdpr compliance' });
  assert.equal(r3.level, RISK_LEVELS.L3);

  // Destructive operations
  const r4 = assessRisk({ requirement: 'drop table obsolete_orders and purge data' });
  assert.equal(r4.level, RISK_LEVELS.L3);
});

test('assessRisk - Stage 1 (asdlc new): Cross-Boundary Architectural (L2)', () => {
  // API contracts
  const r1 = assessRisk({ requirement: 'update openapi specification for orders api' });
  assert.equal(r1.level, RISK_LEVELS.L2);
  assert.equal(r1.isSinglePr, false);

  // Database / Schemas
  const r2 = assessRisk({ requirement: 'create database migration for products table schema' });
  assert.equal(r2.level, RISK_LEVELS.L2);

  // Infra / Supply Chain
  const r3 = assessRisk({ requirement: 'update kubernetes helm chart and package.json dependencies' });
  assert.equal(r3.level, RISK_LEVELS.L2);
});

test('assessRisk - Stage 1 (asdlc new): Bounded Local Changes (L1)', () => {
  const r1 = assessRisk({ requirement: 'refactor sort algorithm for product catalogue' });
  assert.equal(r1.level, RISK_LEVELS.L1);
  assert.equal(r1.isSinglePr, true);
  assert.equal(r1.requiresHumanReview, false);
});

test('assessRisk - Stage 6 (asdlc verify): Physical blast radius and level escape guard', () => {
  // 1. Pure docs files -> L0
  const r1 = assessRisk({
    changedFiles: ['docs/guide.md', 'README.md'],
    currentLevel: RISK_LEVELS.L0
  });
  assert.equal(r1.level, RISK_LEVELS.L0);
  assert.equal(r1.action, 'MAINTAIN');
  assert.equal(r1.escalated, false);

  // 2. Pure test files -> capped at L1 even if modifying test/auth.test.js
  const r2 = assessRisk({
    changedFiles: ['test/auth.test.js', 'tests/payment.spec.ts'],
    currentLevel: RISK_LEVELS.L1
  });
  assert.equal(r2.level, RISK_LEVELS.L1);
  assert.equal(r2.escalated, false);

  // 3. Level Escape detected: Declared L1, but modified security files -> Escalate to L3
  const r3 = assessRisk({
    changedFiles: ['src/auth/jwt.js', 'src/util/helper.js'],
    currentLevel: RISK_LEVELS.L1
  });
  assert.equal(r3.level, RISK_LEVELS.L3);
  assert.equal(r3.action, 'ESCALATE');
  assert.equal(r3.escalated, true);
  assert.equal(r3.requiresHumanReview, true);

  // 4. Level Escape detected: Declared L1, but modified migrations -> Escalate to L2
  const r4 = assessRisk({
    changedFiles: ['migrations/001_create_users.sql'],
    currentLevel: RISK_LEVELS.L1
  });
  assert.equal(r4.level, RISK_LEVELS.L2);
  assert.equal(r4.action, 'ESCALATE');
  assert.equal(r4.escalated, true);

  // 5. Monotonic rule: Declared L2, physical files are local L1 -> MAINTAIN L2 (Never silently demote)
  const r5 = assessRisk({
    changedFiles: ['src/services/calculator.js'],
    currentLevel: RISK_LEVELS.L2
  });
  assert.equal(r5.level, RISK_LEVELS.L2);
  assert.equal(r5.action, 'MAINTAIN');
  assert.equal(r5.escalated, false);
});
