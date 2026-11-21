import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  recordEvent,
  readLocalEvents,
  getChangeIteration,
  writeGitHubStepSummary,
  computeTeamMetrics,
  renderMetricsDashboard,
} from '../src/lib/telemetry.js';
import { stageImplementationChanges } from '../src/commands/pr.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'asdlc.js');

function setupTestRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-telemetry-test-'));
  execFileSync('git', ['init', tmp], { stdio: 'ignore' });
  execFileSync('git', ['-C', tmp, 'config', 'user.name', 'test'], { stdio: 'ignore' });
  execFileSync('git', ['-C', tmp, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore' });
  fs.mkdirSync(path.join(tmp, 'openspec', 'changes'), { recursive: true });
  return tmp;
}

test('telemetry recordEvent: writes valid JSONL and auto-creates .sdlc/.gitignore (fail-silent anti-leak)', () => {
  const repo = setupTestRepo();
  try {
    recordEvent('gate.evaluated', {
      stage: 'verify',
      gate: 'anti-test-weakening',
      status: 'fail',
      detail: 'test deleted: auth.test.js',
      change: 'feat-auth',
    }, { repoRoot: repo });

    const sdlcDir = path.join(repo, '.sdlc');
    const gitignorePath = path.join(sdlcDir, '.gitignore');
    const eventsFile = path.join(sdlcDir, 'events.jsonl');

    assert.equal(fs.existsSync(gitignorePath), true);
    assert.match(fs.readFileSync(gitignorePath, 'utf8'), /events\.jsonl/);

    assert.equal(fs.existsSync(eventsFile), true);
    const content = fs.readFileSync(eventsFile, 'utf8').trim();
    const ev = JSON.parse(content);
    assert.equal(ev.v, 1);
    assert.equal(ev.stage, 'verify');
    assert.equal(ev.type, 'gate.evaluated');
    assert.equal(ev.gate, 'anti-test-weakening');
    assert.equal(ev.status, 'fail');
    assert.equal(ev.change, 'feat-auth');
    assert.ok(ev.ts);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('telemetry recordEvent: strictly fail-silent contract under I/O errors or invalid paths', () => {
  // Should never throw regardless of invalid inputs
  assert.doesNotThrow(() => {
    recordEvent('test.event', {}, { repoRoot: null });
    recordEvent('test.event', {}, { repoRoot: undefined });
    recordEvent('test.event', {}, { repoRoot: '' });
    recordEvent('test.event', {}, { repoRoot: '\0invalid_path' });
  });
});

test('telemetry readLocalEvents & getChangeIteration: parses and derives iteration count', () => {
  const repo = setupTestRepo();
  try {
    assert.equal(getChangeIteration(repo, 'feat-x'), 1);

    recordEvent('gate.evaluated', { stage: 'verify', change: 'feat-x', gate: 'tests', status: 'fail' }, { repoRoot: repo });
    recordEvent('gate.verified', { stage: 'verify', change: 'feat-x', verdict: 'fail' }, { repoRoot: repo });
    assert.equal(getChangeIteration(repo, 'feat-x'), 2);

    recordEvent('gate.evaluated', { stage: 'verify', change: 'feat-x', gate: 'tests', status: 'pass' }, { repoRoot: repo });
    recordEvent('gate.verified', { stage: 'verify', change: 'feat-x', verdict: 'pass' }, { repoRoot: repo });
    assert.equal(getChangeIteration(repo, 'feat-x'), 3);

    // Filter by type
    const fails = readLocalEvents(repo, { change: 'feat-x', type: 'gate.evaluated' });
    assert.equal(fails.length, 2);

    // Corrupt lines are ignored without throwing
    const eventsFile = path.join(repo, '.sdlc', 'events.jsonl');
    fs.appendFileSync(eventsFile, 'NOT_JSON\n{"incomplete":\n', 'utf8');
    const safeRead = readLocalEvents(repo, { change: 'feat-x' });
    assert.equal(safeRead.length, 4);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('telemetry writeGitHubStepSummary: appends to GITHUB_STEP_SUMMARY or skips fail-silent when absent', () => {
  const tmpSummary = path.join(os.tmpdir(), `asdlc-summary-${Date.now()}.md`);
  const oldEnv = process.env.GITHUB_STEP_SUMMARY;
  try {
    delete process.env.GITHUB_STEP_SUMMARY;
    assert.doesNotThrow(() => writeGitHubStepSummary('### Test Summary'));

    process.env.GITHUB_STEP_SUMMARY = tmpSummary;
    writeGitHubStepSummary('### Test Summary 1');
    writeGitHubStepSummary('### Test Summary 2');

    assert.equal(fs.existsSync(tmpSummary), true);
    const text = fs.readFileSync(tmpSummary, 'utf8');
    assert.match(text, /### Test Summary 1/);
    assert.match(text, /### Test Summary 2/);
  } finally {
    if (oldEnv !== undefined) process.env.GITHUB_STEP_SUMMARY = oldEnv;
    else delete process.env.GITHUB_STEP_SUMMARY;
    if (fs.existsSync(tmpSummary)) fs.unlinkSync(tmpSummary);
  }
});

test('telemetry computeTeamMetrics & renderMetricsDashboard: aggregates archives and formats dashboard', () => {
  const repo = setupTestRepo();
  try {
    const archiveDir = path.join(repo, 'openspec', 'changes', 'archive');

    // Change 1: 2026-11-01-c1 (L1, 1 round pass)
    const c1 = path.join(archiveDir, '2026-11-01-c1');
    fs.mkdirSync(c1, { recursive: true });
    fs.writeFileSync(path.join(c1, '.openspec.yaml'), 'level: "L1"\n');
    fs.writeFileSync(path.join(c1, 'proposal.md'), '# Proposal\n');
    fs.writeFileSync(path.join(c1, 'review.md'), '# Review\n- approvedAt: "2026-11-01T10:00:00Z"\n## Verdict\nAPPROVE\n');

    // Change 2: 2026-11-10-c2 (L2, 2 rounds with 1 trailer)
    const c2 = path.join(archiveDir, '2026-11-10-c2');
    fs.mkdirSync(c2, { recursive: true });
    fs.writeFileSync(path.join(c2, '.openspec.yaml'), 'level: "L2"\n');
    fs.writeFileSync(path.join(c2, 'proposal.md'), '# Proposal\n');
    fs.writeFileSync(path.join(c2, 'review.md'), '# Review\n- approvedAt: "2026-11-10T12:00:00Z"\n(ref: #PRRT_123)\n## Verdict\nAPPROVE\n');

    // Change 3: 2026-11-15-c3 (L3, human escalated)
    const c3 = path.join(archiveDir, '2026-11-15-c3');
    fs.mkdirSync(c3, { recursive: true });
    fs.writeFileSync(path.join(c3, '.openspec.yaml'), 'level: "L3"\n');
    fs.writeFileSync(path.join(c3, 'proposal.md'), '# Proposal\n');
    fs.writeFileSync(path.join(c3, 'review.md'), '# Review\nlabel: asdlc:needs-human-arbitration\n## Verdict\nAPPROVE\n');

    // Record local friction events
    recordEvent('gate.evaluated', { stage: 'verify', gate: 'anti-test-weakening', status: 'fail', detail: 'deleted test', change: 'c1' }, { repoRoot: repo });
    recordEvent('gate.evaluated', { stage: 'verify', gate: 'anti-test-weakening', status: 'fail', detail: 'deleted test', change: 'c2' }, { repoRoot: repo });
    recordEvent('gate.evaluated', { stage: 'lint', gate: 'clarifications', status: 'fail', detail: 'open questions', change: 'c3' }, { repoRoot: repo });

    const metrics = computeTeamMetrics(repo, { days: 60 });
    assert.equal(metrics.totalTrackedChanges, 3);
    assert.equal(metrics.riskLevels.L1, 1);
    assert.equal(metrics.riskLevels.L2, 1);
    assert.equal(metrics.riskLevels.L3, 1);
    assert.equal(metrics.convergence.counts.r1, 1);
    assert.equal(metrics.convergence.counts.r2, 1);
    assert.equal(metrics.convergence.counts.escalated, 1);

    // Friction leaderboard
    assert.equal(metrics.frictionLeaderboard.length, 2);
    assert.equal(metrics.frictionLeaderboard[0].gate, 'anti-test-weakening');
    assert.equal(metrics.frictionLeaderboard[0].count, 2);

    // Render dashboard
    const dashboard = renderMetricsDashboard(metrics);
    assert.match(dashboard, /ASDLC HARNESS OBSERVABILITY/);
    assert.match(dashboard, /Gate Friction Leaderboard/);
    assert.match(dashboard, /anti-test-weakening/);
    assert.match(dashboard, /Autonomous PR Convergence/);
    assert.match(dashboard, /Round 1 Pass/);
    assert.match(dashboard, /Risk Tier Breakdown/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI: asdlc status --metrics renders dashboard and supports --json', () => {
  const repo = setupTestRepo();
  try {
    const textOut = execFileSync(process.execPath, [bin, 'status', '--metrics', '--repo-root', repo], { encoding: 'utf8' });
    assert.match(textOut, /ASDLC HARNESS OBSERVABILITY/);
    assert.match(textOut, /Gate Friction Leaderboard/);

    const jsonRaw = execFileSync(process.execPath, [bin, 'status', '--metrics', '--repo-root', repo, '--json'], { encoding: 'utf8' });
    const json = JSON.parse(jsonRaw);
    assert.equal(typeof json.totalTrackedChanges, 'number');
    assert.ok(json.riskLevels);
    assert.ok(json.convergence);
    assert.ok(Array.isArray(json.frictionLeaderboard));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('stageImplementationChanges: physical defense skips .sdlc/events.jsonl', () => {
  const repo = setupTestRepo();
  try {
    recordEvent('gate.evaluated', { stage: 'verify', gate: 'tests', status: 'fail' }, { repoRoot: repo });
    const eventsPath = path.join(repo, '.sdlc', 'events.jsonl');
    assert.equal(fs.existsSync(eventsPath), true);

    const stagedRes = stageImplementationChanges(repo);
    assert.ok(Array.isArray(stagedRes.staged));

    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
    // events.jsonl must never be staged
    assert.doesNotMatch(status, /events\.jsonl/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI lint and verify: record telemetry events and populate GITHUB_STEP_SUMMARY', () => {
  const repo = setupTestRepo();
  const summaryFile = path.join(repo, 'step-summary.md');
  const oldSummary = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = summaryFile;

  try {
    // 1. Scaffold a test change
    const changesDir = path.join(repo, 'openspec', 'changes', 'feat-sample');
    fs.mkdirSync(changesDir, { recursive: true });
    fs.writeFileSync(path.join(changesDir, '.openspec.yaml'), 'level: "L1"\nrequirement: "sample change"\n');

    // Run lint on incomplete change -> should record events and fail
    try {
      execFileSync(process.execPath, [bin, 'lint', 'feat-sample', '--repo-root', repo], { encoding: 'utf8', stdio: 'pipe' });
    } catch {
      // expected to exit 1
    }

    const events = readLocalEvents(repo, { change: 'feat-sample', stage: 'lint' });
    assert.ok(events.length > 0);
    const failEvents = events.filter((e) => e.type === 'gate.evaluated' && e.status === 'fail');
    assert.ok(failEvents.length > 0);

    // GITHUB_STEP_SUMMARY should contain the markdown table
    assert.equal(fs.existsSync(summaryFile), true);
    const summaryText = fs.readFileSync(summaryFile, 'utf8');
    assert.match(summaryText, /ASDLC Lint Results/);
    assert.match(summaryText, /Verdict:/);
  } finally {
    if (oldSummary !== undefined) process.env.GITHUB_STEP_SUMMARY = oldSummary;
    else delete process.env.GITHUB_STEP_SUMMARY;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
