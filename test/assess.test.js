import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assess, loadRiskHistory, loadLatestAssessment, renderCheckSummary, renderPRComment, renderLabels } from '../src/assess/index.js';
import { computeRecordHash, validateRecordSchema, validateChainInvariants } from '../src/assess/schema.js';
import { validateAIClassificationExpectation } from '../src/assess/ai_judge.js';

test('assess: stage new initial evaluation and hash chain generation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-assess-test-'));
  try {
    const changeId = 'auth-session';
    const cdir = path.join(tmp, 'openspec', 'changes', changeId);
    fs.mkdirSync(cdir, { recursive: true });

    // 1. Initial evaluation
    const rec1 = assess({
      stage: 'new',
      changeId,
      requirement: 'implement jwt token session authentication',
      repoRoot: tmp
    });

    assert.equal(rec1.seq, 1);
    assert.equal(rec1.prev_hash, null);
    assert.ok(rec1.hash);
    assert.equal(rec1.risk.level, 'L3');
    assert.equal(rec1.governance.workflow_mode, 'spec-first');
    assert.equal(rec1.governance.implementation_review, 'ai+human');
    assert.equal(rec1.transition.direction, 'initial');

    // Verify hash integrity
    assert.equal(computeRecordHash(rec1), rec1.hash);

    // 2. Second evaluation (Spec stage)
    const rec2 = assess({
      stage: 'spec',
      changeId,
      requirement: 'implement jwt token session authentication',
      repoRoot: tmp
    });

    assert.equal(rec2.seq, 2);
    assert.equal(rec2.prev_hash, rec1.hash);
    assert.equal(rec2.risk.level, 'L3');

    // Check disk files
    const history = loadRiskHistory(tmp, changeId);
    assert.equal(history.length, 2);
    assert.equal(history[0].hash, rec1.hash);
    assert.equal(history[1].hash, rec2.hash);

    const latest = loadLatestAssessment(tmp, changeId);
    assert.equal(latest.hash, rec2.hash);

    // Verify chain invariant
    const chainValid = validateChainInvariants(history);
    assert.equal(chainValid.valid, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assess: enforces monotonic escalation (only goes UP, never down without waiver)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-monotonic-test-'));
  try {
    const changeId = 'monotonic-flow';
    const cdir = path.join(tmp, 'openspec', 'changes', changeId);
    fs.mkdirSync(cdir, { recursive: true });

    // Step 1: new -> L1
    const rec1 = assess({
      stage: 'new',
      changeId,
      requirement: 'refactor internal math helper',
      repoRoot: tmp
    });
    assert.equal(rec1.risk.level, 'L1');
    assert.equal(rec1.governance.workflow_mode, 'single-pr');

    // Step 2: impl -> modified API contract -> Escalates to L2
    const rec2 = assess({
      stage: 'impl',
      changeId,
      changedFiles: ['src/api/routes.js', 'src/math.js'],
      repoRoot: tmp
    });
    assert.equal(rec2.risk.level, 'L2');
    assert.equal(rec2.transition.direction, 'up');
    assert.equal(rec2.verdict, 'escalated');
    assert.equal(rec2.governance.implementation_review, 'ai+human');

    // Step 3: subsequent re-check with only local file -> MUST MAINTAIN L2 (never demote)
    const rec3 = assess({
      stage: 'impl',
      changeId,
      changedFiles: ['src/math.js'],
      repoRoot: tmp
    });
    assert.equal(rec3.risk.level, 'L2');
    assert.equal(rec3.transition.direction, 'same');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assess: hard signal single-veto for destructive operations and security', () => {
  const r1 = assess({
    stage: 'impl',
    changeId: 'drop-test',
    changedFiles: ['migrations/002_drop_users_table.sql'],
    persist: false
  });
  assert.equal(r1.risk.level, 'L3');
  assert.equal(r1.governance.implementation_review, 'ai+human');
  assert.equal(r1.governance.spec_approval, 'human');

  const r2 = assess({
    stage: 'impl',
    changeId: 'doc-test',
    changedFiles: ['docs/guide.md', 'README.md'],
    persist: false
  });
  assert.equal(r2.risk.level, 'L0');
  assert.equal(r2.governance.workflow_mode, 'single-pr');
  assert.equal(r2.governance.implementation_review, 'ai');
});

test('assess: fallback to global defaults on crash (§5.5)', () => {
  const fallback = assess({
    stage: 'impl',
    changeId: 'crash-change',
    // passing an invalid object structure to force internal handling
    requirement: null,
    changedFiles: null,
    persist: false
  });

  assert.ok(['L2', 'L3'].includes(fallback.risk.level));
  assert.equal(fallback.governance.workflow_mode, 'spec-first');
  assert.equal(fallback.governance.implementation_review, 'ai+human');
});

test('render: formats check summary, PR comment, and labels correctly', () => {
  const mockRecord = {
    change_id: 'sample',
    seq: 2,
    hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    stage: 'impl',
    verdict: 'escalated',
    risk: { level: 'L2', confidence: 'high' },
    governance: { workflow_mode: 'spec-first', implementation_review: 'ai+human' },
    reason_codes: ['HARD_RULE_HIT', 'ESCALATED_IN_IMPL'],
    source: { harness_rules_version: '2026.10.0' },
    vectors: {
      v1_intent: { evidence: [] },
      v2_security: { evidence: [] },
      v3_topology: { evidence: [{ signal: 'hard', summary: 'API routes modified' }] }
    },
    transition: { direction: 'up', from_level: 'L1', to_level: 'L2' }
  };

  const summary = renderCheckSummary(mockRecord);
  assert.match(summary, /\[ESCALATED\]/);
  assert.match(summary, /Level: L2/);
  assert.match(summary, /human-review-required/);

  const comment = renderPRComment(mockRecord);
  assert.match(comment, /需要人工评审 · 风险等级 L1 → L2（升级）/);
  assert.match(comment, /API routes modified/);
  assert.match(comment, /spec-first/);

  const labels = renderLabels(mockRecord);
  assert.deepEqual(labels, ['asdlc:L2', 'asdlc:human-review-required', 'asdlc:escalated']);
});

test('assess: P0-1 regression - hard delete intent with unit test keyword cannot be downgraded to L0', () => {
  const rec = assess({
    stage: 'new',
    changeId: 'unit-test-hard-delete',
    requirement: 'add unit tests for the hard delete script',
    persist: false
  });
  assert.equal(rec.risk.level, 'L3', 'Destructive intent must remain L3 even if test keyword is present');
  assert.equal(rec.governance.implementation_review, 'ai+human');
  assert.equal(rec.governance.auto_approval, 'disabled');
});

test('assess: P0-2 regression - agent skill modifications trigger HARD_GOV_PLANE (L3) and never classify as L0', () => {
  const rec1 = assess({
    stage: 'impl',
    changeId: 'skill-tamper-1',
    changedFiles: ['assets/skills/asdlc-apply/SKILL.md'],
    persist: false
  });
  assert.equal(rec1.risk.level, 'L3');
  assert.equal(rec1.governance.implementation_review, 'ai+human');

  const rec2 = assess({
    stage: 'impl',
    changeId: 'skill-tamper-2',
    changedFiles: ['.agents/skills/asdlc-new/SKILL.md'],
    persist: false
  });
  assert.equal(rec2.risk.level, 'L3');
  assert.equal(rec2.governance.implementation_review, 'ai+human');
});

test('assess: P1-2 regression - innocuous SQL filename containing destructive DDL is detected via content', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-sql-content-test-'));
  try {
    fs.mkdirSync(path.join(tmp, 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'migrations', '009_cleanup.sql'), '-- innocuous comment\nDROP TABLE accounts;\n');

    const rec = assess({
      stage: 'impl',
      changeId: 'sql-content-test',
      changedFiles: ['migrations/009_cleanup.sql'],
      repoRoot: tmp,
      persist: false
    });
    assert.equal(rec.risk.level, 'L3', 'SQL content with DROP TABLE must trigger L3 regardless of filename');
    assert.equal(rec.governance.implementation_review, 'ai+human');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assess: P1-3 regression - tampered risk-history.jsonl fails closed on read', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-tamper-read-test-'));
  try {
    const changeId = 'tamper-flow';
    const cdir = path.join(tmp, 'openspec', 'changes', changeId);
    fs.mkdirSync(cdir, { recursive: true });

    // Create valid assessment
    assess({
      stage: 'new',
      changeId,
      requirement: 'implement secure ledger',
      repoRoot: tmp
    });

    // Verify valid load
    const hist = loadRiskHistory(tmp, changeId);
    assert.equal(hist.length, 1);

    // Tamper with file
    const histPath = path.join(cdir, 'risk-history.jsonl');
    const original = fs.readFileSync(histPath, 'utf8');
    const tampered = original.replace('"L2"', '"L0"');
    assert.notEqual(original, tampered, 'Must replace level to tamper');
    fs.writeFileSync(histPath, tampered);

    assert.throws(
      () => loadRiskHistory(tmp, changeId),
      (err) => err.code === 'TAMPER_DETECTED' || err.message.includes('tamper')
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function writeGraphFixture(repoRoot) {
  const graphDir = path.join(repoRoot, 'graphify-out');
  fs.mkdirSync(graphDir, { recursive: true });
  const nodes = [
    { id: 'fs_exists', label: 'exists()', source_file: 'src/lib/fs.js' },
    { id: 'leaf_fn', label: 'leafFn()', source_file: 'src/lib/leaf.js' },
    { id: 'tdd_check', label: 'checkTaskEvidence()', source_file: 'src/lib/tdd.js' }
  ];
  const links = [];
  // 25 production callers -> src/lib/fs.js (true architectural god-node hub)
  for (let i = 0; i < 25; i++) {
    const callerId = `prod_caller_${i}`;
    nodes.push({ id: callerId, label: `cmd${i}()`, source_file: `src/commands/cmd_${i}.js` });
    links.push({ source: callerId, target: 'fs_exists' });
  }
  // 25 unit test callers + only 2 production callers -> src/lib/leaf.js (must NOT become a god node)
  for (let i = 0; i < 25; i++) {
    const testId = `test_caller_${i}`;
    nodes.push({ id: testId, label: `test${i}()`, source_file: `test/leaf_${i}.test.js` });
    links.push({ source: testId, target: 'leaf_fn' });
  }
  links.push({ source: 'prod_caller_0', target: 'leaf_fn' });
  links.push({ source: 'prod_caller_1', target: 'leaf_fn' });

  fs.writeFileSync(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes, links }));
}

test('assess: Graphify AST god node centrality triggers L2 escalation for high fan-in modules and ignores test callers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-graph-hub-test-'));
  try {
    writeGraphFixture(tmp);

    // 1. Touching true production hub (25 prod inbound edges) -> escalates to L2
    const recHub = assess({
      stage: 'impl',
      changeId: 'god-node-test',
      changedFiles: ['src/lib/fs.js'],
      repoRoot: tmp,
      persist: false
    });
    assert.equal(recHub.risk.level, 'L2');
    assert.ok(recHub.vectors.v3_topology.evidence.some((e) => e.id === 'V3_GRAPHIFY_GOD_NODE'));

    // 2. Touching leaf module imported heavily by test suites (25 test edges, 2 prod edges) -> stays L1
    const recLeaf = assess({
      stage: 'impl',
      changeId: 'leaf-node-test',
      changedFiles: ['src/lib/leaf.js'],
      repoRoot: tmp,
      persist: false
    });
    assert.equal(recLeaf.risk.level, 'L1');
    assert.ok(!recLeaf.vectors.v3_topology.evidence.some((e) => e.id === 'V3_GRAPHIFY_GOD_NODE'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assess: agent-native semantic evaluation correctly escalates api_contract and respects invariants', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-agent-native-'));
  try {
    const changeId = 'agent-eval-test';
    const cdir = path.join(tmp, 'openspec', 'changes', changeId);
    fs.mkdirSync(cdir, { recursive: true });

    // Seed agent assessment record
    fs.writeFileSync(path.join(cdir, '.agent-assess.json'), JSON.stringify({
      classification: 'api_contract',
      rationale: 'Agent evaluated requirement as modifying cross-boundary router contract'
    }));

    const rec = assess({
      stage: 'new',
      changeId,
      requirement: 'update internal user session handler',
      repoRoot: tmp,
      persist: false
    });

    assert.equal(rec.risk.level, 'L2');
    assert.ok(rec.vectors.v1_intent.evidence.some((e) => e.id === 'V1_AI_API_CONTRACT_INTENT'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assess: Invariant 3 - production source code files cannot be disguised as pure test or doc', () => {
  const fakeAiOutput = {
    is_pure_test: true,
    is_pure_doc: false,
    classification: 'test_only',
    rationale: 'Claiming this is purely a test change'
  };

  const check = validateAIClassificationExpectation(fakeAiOutput, {
    changedFiles: ['tests/foo.test.js', 'src/core/payment.js'],
    requirement: 'add tests'
  });

  assert.equal(check.ok, false);
  assert.equal(check.override.is_pure_test, false);
  assert.equal(check.override.classification, 'internal_code');
});

test('assess: explore.md query grounding matches 0-hop Start nodes and ignores header & 2-hop BFS neighbors', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-explore-test-'));
  try {
    writeGraphFixture(tmp);
    const changeId = 'explore-grounding-test';
    const cdir = path.join(tmp, 'openspec', 'changes', changeId);
    fs.mkdirSync(cdir, { recursive: true });

    // 1. Explore.md with architectural hubs in header, but Query section has no matches -> strictly L1
    const noMatchExplore = `# Explore: ${changeId}

## Architectural hubs (god nodes)

1. exists() - 25 edges (src/lib/fs.js)

## Query: my-clean-change

_(no matches)_
`;
    fs.writeFileSync(path.join(cdir, 'explore.md'), noMatchExplore);

    const recClean = assess({
      stage: 'new',
      changeId,
      requirement: 'refactor internal helper logic',
      repoRoot: tmp,
      persist: false
    });
    assert.equal(recClean.risk.level, 'L1');

    // 2. Real Graphify BFS depth=2 output where Start hits leaf/tdd, and src/lib/fs.js is only a 2-hop neighbor -> strictly L1
    const bfsNeighborExplore = `# Explore: ${changeId}

## Architectural hubs (god nodes)

1. exists() - 25 edges

## Query: tdd checkTaskEvidence

Graph: 55 nodes, 52 edges | Traversal: BFS depth=2 | Start: ['checkTaskEvidence()', 'tdd.test.js'] | 12 nodes found
NODE checkTaskEvidence() [src=src/lib/tdd.js community=5]
NODE exists() [src=src/lib/fs.js community=1]
EDGE cmd0() --calls--> exists()
`;
    fs.writeFileSync(path.join(cdir, 'explore.md'), bfsNeighborExplore);

    const recNeighbor = assess({
      stage: 'new',
      changeId,
      requirement: 'refactor tdd helper logic',
      repoRoot: tmp,
      persist: false
    });
    assert.equal(recNeighbor.risk.level, 'L1');
    assert.ok(!recNeighbor.vectors.v3_topology.evidence.some((e) => e.id === 'V3_GRAPHIFY_GOD_NODE'));

    // 3. Real Graphify BFS output where Start directly targets exists() in src/lib/fs.js -> strictly L2
    const bfsDirectHitExplore = `# Explore: ${changeId}

## Architectural hubs (god nodes)

1. exists() - 25 edges

## Query: fs exists

Graph: 55 nodes, 52 edges | Traversal: BFS depth=2 | Start: ['exists()'] | 26 nodes found
NODE exists() [src=src/lib/fs.js community=1]
`;
    fs.writeFileSync(path.join(cdir, 'explore.md'), bfsDirectHitExplore);

    const recDirectHit = assess({
      stage: 'new',
      changeId,
      requirement: 'refactor internal helper logic',
      repoRoot: tmp,
      persist: false
    });
    assert.equal(recDirectHit.risk.level, 'L2');
    assert.ok(recDirectHit.vectors.v3_topology.evidence.some((e) => e.id === 'V3_GRAPHIFY_GOD_NODE'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assess: L0 purity and Invariant 3 ignore per-change openspec/changes/<id>/* metadata and persist evaluator_mode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-l0-meta-test-'));
  try {
    const changeId = 'unit-tests-branch';
    const cdir = path.join(tmp, 'openspec', 'changes', changeId);
    fs.mkdirSync(cdir, { recursive: true });
    fs.writeFileSync(path.join(cdir, '.agent-assess.json'), JSON.stringify({
      is_pure_test: true,
      is_pure_doc: false,
      classification: 'test_only',
      rationale: 'Agent verified change only adds unit tests alongside SDLC metadata'
    }));

    const rec = assess({
      stage: 'impl',
      changeId,
      requirement: 'add unit tests for math utility',
      changedFiles: [
        `openspec/changes/${changeId}/.openspec.yaml`,
        `openspec/changes/${changeId}/risk-history.jsonl`,
        `openspec/changes/${changeId}/risk-assessment.yaml`,
        `openspec/changes/${changeId}/.agent-assess.json`,
        'tests/math.test.js'
      ],
      repoRoot: tmp,
      persist: true
    });

    assert.equal(rec.risk.level, 'L0');
    assert.equal(rec.vectors.v1_intent.evaluator_mode, 'agent_native');

    const history = loadRiskHistory(tmp, changeId);
    assert.equal(history[0].vectors.v1_intent.evaluator_mode, 'agent_native');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assess: heuristic_seed does not masquerade as V1_AI_* or false-positive on English word "rest"', () => {
  const rec = assess({
    stage: 'new',
    changeId: 'readme-typo',
    requirement: 'fix typo in rest of readme',
    persist: false
  });

  assert.equal(rec.risk.level, 'L0');
  assert.equal(rec.vectors.v1_intent.evaluator_mode, 'heuristic_seed');
  assert.ok(!rec.vectors.v1_intent.evidence.some((e) => e.id === 'V1_AI_API_CONTRACT_INTENT'));
});

