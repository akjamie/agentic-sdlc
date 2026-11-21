import path from 'node:path';
import { exists, readText, writeText, walkFiles } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug, readLintConfig, jsonOut } from '../lib/cliutil.js';
import { lintSpecText, countBlockers } from '../lib/speclint.js';
import { assess } from '../assess/index.js';
import { resolveWorkflowMode } from '../lib/config.js';
import { log, dim } from '../lib/log.js';
import { recordEvent, writeGitHubStepSummary } from '../lib/telemetry.js';

// THE spec check (v10: lint absorbed review). Deterministic:
//   - required artifacts (explore.md + proposal.md + >=1 spec delta)
//   - the review record (review.md) exists, verdict APPROVE, no blocking findings
//   - BDD + Acceptance-Criteria quality
export function verdictOf(text) {
  const s = String(text ?? '');
  const fm = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const vm = fm[1].match(/^\s*verdict\s*:\s*['"]?([A-Za-z_]+)['"]?\s*$/mi);
    if (vm) return vm[1].toUpperCase();
  }
  const m = s.match(/##\s*Verdict[^\n]*\n+\s*([A-Za-z_]+)/);
  return m ? m[1].toUpperCase() : null;
}

export function reviewedShaOf(text) {
  const s = String(text ?? '');
  const fm = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const sm = fm[1].match(/^\s*reviewedSha\s*:\s*['"]?([0-9a-f]{7,40})['"]?\s*$/mi);
    if (sm) return sm[1];
  }
  const m = s.match(/-\s*reviewedSha\s*:\s*`?([0-9a-f]{7,40})`?/i);
  return m ? m[1] : null;
}

export function hasBlockingFindings(text) {
  const s = String(text ?? '');
  const fm = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm && /\bseverity\s*:\s*['"]?blocker['"]?/i.test(fm[1])) {
    return true;
  }
  const m = s.match(/##\s*Blocking Findings[^\n]*\n([\s\S]*?)(?:\n##\s|\s*$)/i);
  if (!m) return false;
  const body = m[1].replace(/<!--[\s\S]*?-->/g, '').trim();
  return Boolean(body) && !/^\(?\s*none\s*\)?\.?$/i.test(body);
}

/**
 * Returns true if clarifications.md still contains unresolved [OPEN] markers
 * or non-empty questions under `## Open questions` (outside HTML comments).
 */
export function hasUnresolvedClarifications(text) {
  const stripped = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '');
  if (/\[OPEN\]/i.test(stripped)) return true;
  const m = stripped.match(/##\s*Open questions[^\n]*\n([\s\S]*?)(?:\n##\s|\s*$)/i);
  if (!m) return false;
  const body = m[1].trim();
  return Boolean(body) && !/^\(?\s*none\s*\)?\.?$/i.test(body);
}

function finish(results, { json, changeId, repoRoot, startTime }) {
  const blockers = results.filter((r) => r.status === 'fail');

  // Telemetry Fail-Silent Logging (Harness Observability)
  try {
    for (const r of blockers) {
      recordEvent('gate.evaluated', {
        stage: 'lint',
        gate: r.name,
        status: 'fail',
        detail: r.detail,
        change: changeId || null,
      }, { repoRoot });
    }
    recordEvent('gate.verified', {
      stage: 'lint',
      change: changeId || null,
      verdict: blockers.length === 0 ? 'pass' : 'fail',
      totalGates: results.length,
      passedGates: results.length - blockers.length,
      durationMs: startTime ? (Date.now() - startTime) : null,
    }, { repoRoot });

    if (process.env.GITHUB_STEP_SUMMARY) {
      const tableRows = results.map((r) => {
        const icon = { pass: '✅ PASS', fail: '❌ FAIL', skip: '⏭️ SKIP' }[r.status] || r.status;
        return `| \`${r.name}\` | ${icon} | ${r.detail || ''} |`;
      }).join('\n');
      const verdictBadge = blockers.length === 0 ? '✅ PASS' : '❌ FAIL';
      const md = `### 🏛️ ASDLC Lint Results: \`${changeId || 'unknown'}\`
| Gate | Status | Detail |
| :--- | :--- | :--- |
${tableRows}

**Verdict: ${verdictBadge} (${results.length - blockers.length}/${results.length} Passed)**
`;
      writeGitHubStepSummary(md);
    }
  } catch {
    // Fail-silent contract: Telemetry never throws or interferes with lint results
  }

  if (json) {
    jsonOut({ changeId, pass: blockers.length === 0, results });
    return blockers.length ? 1 : 0;
  }
  log.info('');
  for (const r of results) {
    const badge = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }[r.status];
    log.plain(`  [${badge}] ${r.name}`);
    if (r.detail) log.plain(`        ${dim(r.detail)}`);
  }
  log.info('');
  if (blockers.length) {
    log.plain(`lint failed: ${blockers.length} check(s)`);
    return 1;
  }
  log.plain('lint passed');
  return 0;
}

export function runLint(changeId, opts = {}) {
  const startTime = Date.now();
  const repoRoot = requireRepo(opts);
  const slug = toChangeSlug(changeId);
  const cdir = changeDir(repoRoot, slug);
  const results = [];
  const add = (name, status, detail) => results.push({ name, status, detail });

  if (!exists(cdir)) {
    add('change', 'fail', `change '${slug}' not found`);
    return finish(results, { json: opts.json, changeId: slug, repoRoot, startTime });
  }
  add('change', 'pass', slug);
  add('explore.md (stage 1)', exists(path.join(cdir, 'explore.md')) ? 'pass' : 'fail',
    exists(path.join(cdir, 'explore.md')) ? '' : 'run `asdlc new <ID>` (explore is the first stage)');
  const proposalPath = path.join(cdir, 'proposal.md');
  const proposalText = exists(proposalPath) ? readText(proposalPath) : '';
  add('proposal.md', exists(proposalPath) ? 'pass' : 'fail',
    exists(proposalPath) ? '' : 'proposal.md missing');

  const specFiles = exists(path.join(cdir, 'specs'))
    ? walkFiles(path.join(cdir, 'specs')).filter((f) => f.endsWith('spec.md'))
    : [];
  add('spec delta', specFiles.length > 0 ? 'pass' : 'fail', specFiles.length > 0 ? `${specFiles.length} file(s)` : 'no spec delta present');

  const combinedSpecText = specFiles.map((f) => readText(path.join(cdir, 'specs', f))).join('\n');
  const fullIntentText = `${proposalText}\n${combinedSpecText}`;

  // Deterministic detection for UI and 3rd-party/external API scope
  const UI_OR_EXTERNAL_API = /\b(ui|ux|frontend|web|screen|page|view|component|css|style|html|layout|dialog|modal|button|table|card|form|itinerary|3rd-party|third-party|external api|vendor api|geocode|amap|weather api|maps api|payment gateway|stripe|oauth|webhook)\b/i;
  const requiresDesign = UI_OR_EXTERNAL_API.test(fullIntentText);

  const designPath = path.join(cdir, 'design.md');
  if (!exists(designPath)) {
    if (requiresDesign) {
      add('design.md', 'fail', 'design.md is mandatory for UI and external API changes (run `asdlc new --design` or author design.md)');
    }
  } else {
    const text = readText(designPath);
    const nonComment = text.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (nonComment.length < 150) {
      add('design.md', 'fail', 'design.md contains only unedited template placeholders; fill in technical design');
    } else {
      add('design.md', 'pass', 'technical design documented');
    }
  }

  const reviewPath = path.join(cdir, 'review.md');
  if (!exists(reviewPath)) {
    add('review.md', 'pass', 'delegated to independent review agent (review comments & summary posted on PR)');
    add('review verdict', 'pass', 'pending human PR review on GitHub/GitLab');
  } else {
    const text = readText(reviewPath);
    add('review.md', 'pass', '');
    const verdict = verdictOf(text);
    add('review verdict', verdict === 'APPROVE' ? 'pass' : 'fail', verdict ? `verdict: ${verdict}` : 'no verdict found');
    add('blocking findings', hasBlockingFindings(text) ? 'fail' : 'pass', hasBlockingFindings(text) ? 'blocking findings present' : '');
  }

  const clarPath = path.join(cdir, 'clarifications.md');
  if (exists(clarPath)) {
    const clarText = readText(clarPath);
    const unresolved = hasUnresolvedClarifications(clarText);
    add('clarifications', unresolved ? 'fail' : 'pass', unresolved ? 'unresolved [OPEN] questions in clarifications.md' : 'all clarifications settled');
  }

  // Spec-stage risk assessment: ground in artifacts and sync level/workflow mode
  const metaPath = path.join(cdir, '.openspec.yaml');
  let currLvl = null;
  if (exists(metaPath)) {
    const lvlMatch = readText(metaPath).match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    currLvl = lvlMatch ? lvlMatch[1].toUpperCase() : null;
  }
  const agentAssessPath = path.join(cdir, '.agent-assess.json');
  if (currLvl || exists(agentAssessPath) || exists(path.join(cdir, 'risk-history.jsonl'))) {
    const resolvedMode = resolveWorkflowMode({ cliMode: opts.mode, repoRoot });
    const assessment = assess({
      stage: 'spec',
      changeId: slug,
      repoRoot,
      mode: resolvedMode,
      persist: true
    });
    const effectiveLevel = assessment.risk.level;
    if (exists(metaPath) && currLvl !== effectiveLevel) {
      let metaText = readText(metaPath);
      const upsertKey = (text, key, val) => {
        const re = new RegExp(`^\\s*${key}:\\s*.*$`, 'm');
        return re.test(text) ? text.replace(re, `${key}: "${val}"`) : `${text.trimEnd()}\n${key}: "${val}"\n`;
      };
      metaText = upsertKey(metaText, 'level', effectiveLevel);
      metaText = upsertKey(metaText, 'workflowMode', assessment.governance.workflow_mode);
      writeText(metaPath, metaText);
    }
    add('governance level', 'pass', `${effectiveLevel} (${assessment.governance.workflow_mode})`);
  }

  const { rules } = readLintConfig(repoRoot);
  const findings = [];
  for (const file of specFiles) {
    // Spec stage: check the AC->test MAPPING exists, but not that the test file
    // exists yet (the test is written during implementation; `asdlc verify`
    // enforces existence).
    for (const fnd of lintSpecText(readText(path.join(cdir, 'specs', file)), { rules })) findings.push({ ...fnd, file });
  }
  const blockers = countBlockers(findings);
  let bddDetail = blockers === 0 ? `${findings.length} advisory finding(s)` : `${blockers} blocker(s)`;
  if (blockers > 0) {
    const list = findings
      .map((f) => `${f.code}: ${f.message}${f.location ? ` (${f.location})` : ''}`)
      .slice(0, 5);
    const overflow = findings.length > 5 ? ` (+${findings.length - 5} more)` : '';
    bddDetail = `${blockers} blocker(s) [${list.join('; ')}${overflow}] (see docs/spec-format.md)`;
  }
  add('BDD + acceptance criteria', blockers === 0 ? 'pass' : 'fail', bddDetail);

  return finish(results, { json: opts.json, changeId: slug, repoRoot, startTime });
}

export function register(program) {
  program
    .command('lint <changeId>')
    .description('check the spec: artifacts + review record + BDD/acceptance criteria')
    .option('--repo-root <path>')
    .option('--mode <mode>', 'workflow mode: supervised (default) | spec-first | auto')
    .option('--json', 'stable JSON output for CI')
    .action((changeId, opts) => {
      process.exitCode = runLint(changeId, opts);
    });
}
