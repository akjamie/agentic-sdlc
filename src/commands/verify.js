import path from 'node:path';
import { exists, readText, writeText, walkFiles } from '../lib/fs.js';
import { readYaml } from '../lib/yaml.js';
import { openspecDir, changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug, readLintConfig, jsonOut } from '../lib/cliutil.js';
import { validateChange } from '../lib/openspec.js';
import { runShell } from '../lib/exec.js';
import { lastCommitTouching, changeOnRef, git } from '../lib/git.js';
import { lintSpecText, countBlockers } from '../lib/speclint.js';
import { checkSchema } from '../lib/schema.js';
import { loadPolicy, isAdvisory, DEFAULT_POLICY, matchesAny } from '../lib/policy.js';
import { classifyPR } from '../lib/prtype.js';
import { isSinglePrLevel, requiresHumanReview, readChangeLevel, readEffectiveLevel } from '../lib/level.js';
import { assess, renderCheckSummary, loadRiskHistory } from '../assess/index.js';
import { checkTestPresence, checkTaskEvidence } from '../lib/tdd.js';
import { runTests, parseSpecAcceptanceCriteria } from './test.js';
import { log, dim } from '../lib/log.js';

// THE implementation check (v10: gate absorbed verify). Deterministic checks
// first, then - if a verifier is configured - independent AI verification
// (player != referee).

function meta(repoRoot, changeId) {
  const p = path.join(changeDir(repoRoot, toChangeSlug(changeId)), '.openspec.yaml');
  if (!exists(p)) return {};
  try {
    const data = readYaml(p) ?? {};
    return {
      specSha: data.specSha ? String(data.specSha) : null,
      status: data.status ? String(data.status) : null,
      level: data.level ? String(data.level).toUpperCase() : null,
      escalatedInImpl: data.escalatedInImpl === true || String(data.escalatedInImpl).toLowerCase() === 'true',
    };
  } catch {
    const text = readText(p);
    const sha = text.match(/^\s*specSha:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const status = text.match(/^\s*status:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const lvl = text.match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const esc = text.match(/^\s*escalatedInImpl:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    return {
      specSha: sha ? sha[1] : null,
      status: status ? status[1] : null,
      level: lvl ? lvl[1].toUpperCase() : null,
      escalatedInImpl: esc ? esc[1].toLowerCase() === 'true' : false,
    };
  }
}

function readYamlConfig(repoRoot) {
  const cfg = path.join(openspecDir(repoRoot), 'config.yaml');
  if (!exists(cfg)) return {};
  try { return readYaml(cfg) ?? {}; } catch { return {}; }
}

export function countUncheckedTasks(text) {
  return (text.match(/^\s*-\s+\[\s\]/gm) ?? []).length;
}

function readExternalChecks(repoRoot) {
  const ext = (readYamlConfig(repoRoot).gates ?? {}).external;
  if (!Array.isArray(ext)) return [];
  return ext.filter((e) => e && typeof e.command === 'string').map((e) => ({ name: e.name ?? e.command, command: e.command }));
}

function finish(results, policy, opts = {}) {
  let failed = 0;
  const processed = results.map((r) => {
    const status = r.status === 'fail' && isAdvisory(policy, r.name) ? 'warn' : r.status;
    if (status === 'fail') failed += 1;
    return { ...r, status };
  });

  if (opts.json) {
    jsonOut({
      verdict: failed === 0 ? 'PASS' : 'FAIL',
      pass: failed === 0,
      failed,
      results: processed,
    });
    return failed ? 1 : 0;
  }

  log.info('');
  for (const r of processed) {
    const badge = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', skip: 'SKIP' }[r.status];
    log.plain(`  [${badge}] ${r.name}`);
    if (r.detail) log.plain(`        ${dim(r.detail)}`);
  }
  log.info('');
  if (failed) { log.plain(`verify failed: ${failed} check(s)`); return 1; }
  log.plain('verify passed');
  return 0;
}

function intent(cdir) {
  const parts = [];
  for (const f of ['proposal.md', 'review.md', 'tasks.md']) {
    const p = path.join(cdir, f);
    if (exists(p)) parts.push(`===== ${f} =====\n${readText(p)}`);
  }
  const specsDir = path.join(cdir, 'specs');
  if (exists(specsDir)) {
    for (const f of walkFiles(specsDir).filter((x) => x.endsWith('spec.md'))) {
      parts.push(`===== specs/${f} =====\n${readText(path.join(specsDir, f))}`);
    }
  }
  return parts.join('\n\n');
}

export const DEFAULT_MAX_DIFF_CHARS = 32000;

export function buildVerifierDiffPayload(diff, { maxChars = DEFAULT_MAX_DIFF_CHARS } = {}) {
  const raw = String(diff || '');
  if (!raw) return '(empty diff)';
  if (raw.length <= maxChars) return raw;

  // Split unified diff by file and preserve file manifest + bounded per-file hunks
  const sections = raw.split(/(?=^diff --git )/m).filter(Boolean);
  const fileManifest = sections.map((sec) => {
    const header = sec.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
    const file = header ? header[2] : 'unknown';
    const adds = (sec.match(/^\+(?!\+\+)/gm) || []).length;
    const dels = (sec.match(/^-(?!--)/gm) || []).length;
    return `  - ${file} (+${adds} / -${dels})`;
  });

  const manifestBlock = `Changed files (${sections.length}):\n${fileManifest.join('\n')}\n\n`;
  const notice = `\n\n[DIFF TRUNCATED: total ${raw.length} chars exceeded ${maxChars}-char stdin budget. Run the \`asdlc-impl-review\` skill in an independent agent session for multi-file deep review.]`;
  const remainingBudget = Math.max(256, maxChars - manifestBlock.length - notice.length);
  const perFileBudget = Math.max(160, Math.floor(remainingBudget / Math.max(1, sections.length)));

  const excerpts = [];
  let used = 0;
  for (const sec of sections) {
    if (used >= remainingBudget) break;
    const allowance = Math.min(perFileBudget, remainingBudget - used);
    const slice = sec.length > allowance ? `${sec.slice(0, allowance)}\n... (hunk truncated)` : sec;
    excerpts.push(slice);
    used += slice.length + 2;
  }

  return `${manifestBlock}${excerpts.join('\n\n')}${notice}`;
}

function buildPrompt(changeId, intentText, diff, base, opts = {}) {
  const boundedDiff = buildVerifierDiffPayload(diff, { maxChars: opts.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS });
  return `You are an INDEPENDENT VERIFIER for change ${changeId}. You did NOT author it.
Verify the IMPLEMENTATION satisfies the APPROVED INTENT. Be skeptical.
- Decide PASS/FAIL for every requirement / acceptance criterion and every task.
- FAIL if a requirement is unmet, a task is unchecked/unimplemented, or test evidence is missing.
Output ONLY strict JSON: {"verdict":"PASS|FAIL","summary":"...","requirements":[{"id":"...","verdict":"PASS|FAIL","evidence":"...","gaps":"..."}]}

===== APPROVED INTENT =====
${intentText}

===== IMPLEMENTATION DIFF (base ${base}) =====
${boundedDiff}
`;
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export function runVerify(changeId, opts = {}) {
  const results = [];
  const add = (name, status, detail) => results.push({ name, status, detail });
  const branch = opts.protectedBranch ?? 'origin/main';

  let repoRoot;
  try {
    repoRoot = requireRepo(opts);
    add('repo', 'pass', repoRoot);
  } catch (err) {
    add('repo', 'fail', err.message);
    return finish(results, DEFAULT_POLICY);
  }

  const policy = loadPolicy(repoRoot);
  const slug = toChangeSlug(changeId);
  const base = opts.base ?? branch;
  const head = opts.head ?? 'HEAD';

  const cdir = changeDir(repoRoot, slug);
  if (!exists(cdir)) {
    add('change', 'fail', `change '${slug}' not found`);
    return finish(results, policy, opts);
  }
  add('change', 'pass', slug);
  const effLevel = readEffectiveLevel(repoRoot, changeId, { baseRef: base });
  if (effLevel?.tampered) {
    add('level-integrity', 'fail', `tampered: declared ${effLevel.declaredLevel} < recorded history ${effLevel.maxHistoryLevel}`);
  } else {
    add('level-integrity', 'pass', `conforms to recorded history (${effLevel?.effectiveLevel || 'L1'})`);
  }
  const metaInfo = meta(repoRoot, changeId);
  const { specSha, status } = metaInfo;
  const changeLevel = effLevel?.effectiveLevel || metaInfo.level || null;

  const changedFiles = (git(['diff', '--name-only', `${base}...${head}`], repoRoot, { allowFail: true }) ?? '')
    .split(/\r?\n/).filter(Boolean);
  const changeOnMain = changeOnRef(repoRoot, branch, slug);

  // Single-PR privilege applies ONLY if the change is currently L0/L1 OR legitimately entered
  // implementation as L0/L1 and escalated strictly during `impl` (NOT during `new`/`spec`).
  let history = [];
  try { history = loadRiskHistory(repoRoot, slug); } catch { /* handled by readEffectiveLevel */ }
  const preImplRecords = history.filter((r) => r.stage === 'new' || r.stage === 'spec');
  const escalatedOnlyInImpl = Boolean(
    metaInfo.escalatedInImpl ||
    (history.length > 0 &&
      preImplRecords.length > 0 &&
      preImplRecords.every((r) => isSinglePrLevel(r.risk?.level)) &&
      history.some((r) => r.stage === 'impl' && !isSinglePrLevel(r.risk?.level)))
  );
  const isSinglePr = Boolean(isSinglePrLevel(changeLevel) || escalatedOnlyInImpl);

  const pr = classifyPR({ changedFiles, changeOnMain, policy, emergency: opts.emergency, level: changeLevel, repoRoot, singlePr: isSinglePr });
  add('pr-type', pr.type === 'invalid' ? 'fail' : 'pass', `type=${pr.type} (${pr.reason})`);

  const required = ['proposal.md', 'tasks.md'];
  const missing = required.filter((f) => !exists(path.join(cdir, f)));
  const specFiles = exists(path.join(cdir, 'specs'))
    ? walkFiles(path.join(cdir, 'specs')).filter((f) => f.endsWith('spec.md')) : [];
  if (missing.length === 0 && specFiles.length > 0) add('artifacts', 'pass', 'proposal, tasks, spec delta present');
  else add('artifacts', 'fail', [...missing.map((f) => `${f} missing`), ...(specFiles.length === 0 ? ['no spec delta'] : [])].join('; '));

  const lockedPaths = [`openspec/changes/${slug}/proposal.md`, `openspec/changes/${slug}/specs`];
  const approvedSha = lastCommitTouching(repoRoot, branch, lockedPaths);
  if (effLevel?.tampered) {
    add('approved-spec', 'fail', 'governance level tampered: declared level is lower than history');
  } else if (isSinglePr) {
    add('approved-spec', 'pass', `${changeLevel || 'single-pr'} single-PR mode (spec approval co-located in implementation PR)`);
  } else if (!approvedSha) {
    add('approved-spec', 'fail', `no commit on locked paths is merged into ${branch} (not approved)`);
  } else if (specSha && specSha !== approvedSha) {
    add('approved-spec', 'fail', `declared specSha ${specSha.slice(0, 8)} != approved commit ${approvedSha.slice(0, 8)}`);
  } else {
    add('approved-spec', 'pass', `approved commit ${approvedSha.slice(0, 8)} on ${branch}`);
  }

  // Lightweight tamper guard: in a two-phase implementation PR, locked spec files MUST NOT be modified
  const lockedModified = changedFiles.filter((f) => matchesAny(f, policy?.locked_paths ?? DEFAULT_POLICY.locked_paths));
  if (!isSinglePr && pr.type === 'impl' && lockedModified.length > 0) {
    add('spec-tamper', 'fail', `${lockedModified.length} locked spec file(s) modified in implementation PR (${lockedModified.join(', ')})`);
  } else {
    add('spec-tamper', 'pass', 'locked spec paths unmodified');
  }

  if (isSinglePr) {
    add('flow-state', 'pass', `${changeLevel || 'single-pr'} single-PR mode (direct implementation)`);
  } else {
    add('flow-state', status === 'ready_for_impl' ? 'pass' : 'fail',
      status === 'ready_for_impl' ? 'READY_FOR_IMPL' : `status is ${status ?? 'unset'} (run: asdlc approve ${changeId})`);
  }

  const isCI = opts.ci !== undefined
    ? Boolean(opts.ci)
    : (opts.openingPr ? false : Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI));

  const assessment = assess({
    stage: 'impl',
    changeId: slug,
    baseSha: base,
    headSha: head,
    changedFiles,
    repoRoot,
    persist: Boolean(repoRoot && changeId && exists(cdir) && !opts.openingPr && !isCI)
  });

  const effectiveLevel = assessment.risk.level;
  const isEscalatedInImpl = Boolean(
    (assessment.reason_codes || []).includes('ESCALATED_IN_IMPL') ||
    (isSinglePr && !isSinglePrLevel(effectiveLevel))
  );

  if (isEscalatedInImpl) {
    // Synchronize .openspec.yaml on in-place escalation (local runs only, avoid dirtying tree in CI)
    const metaPath = path.join(cdir, '.openspec.yaml');
    if (!isCI && !opts.openingPr && exists(metaPath)) {
      let metaText = readText(metaPath);
      const upsertKey = (text, key, val) => {
        const re = new RegExp(`^\\s*${key}:\\s*.*$`, 'm');
        return re.test(text) ? text.replace(re, `${key}: "${val}"`) : `${text.trimEnd()}\n${key}: "${val}"\n`;
      };
      metaText = upsertKey(metaText, 'level', effectiveLevel);
      metaText = upsertKey(metaText, 'workflowMode', assessment.governance.workflow_mode);
      metaText = upsertKey(metaText, 'escalatedInImpl', 'true');
      writeText(metaPath, metaText);
    }

    // Humane design: When escalation happens after apply (in implementation),
    // maintain a single PR in-place, but strictly revoke auto-merge and mandate human lead approval.
    add('risk-escape', 'pass', `escalated from ${changeLevel || 'L1'} to ${effectiveLevel} in implementation (in-place single PR maintained; auto-merge revoked, mandatory human lead review required)`);
  } else {
    add('risk-escape', 'pass', `conforms to ${assessment.risk.level} boundary (${assessment.governance.workflow_mode})`);
  }

  const isHumanReview = assessment.governance.implementation_review === 'ai+human';

  if (isHumanReview) {
    if (isCI) {
      // In CI, approval cannot rely on self-committed in-tree review.md (P0-3).
      // It must be verified via --approved flag (passed by CI workflow when platform PR approval check passes)
      // or external platform attestation.
      if (opts.approved) {
        add('human-gate', 'pass', `${effectiveLevel}: human lead approval verified on PR`);
      } else {
        add('human-gate', 'fail', `${effectiveLevel}: mandatory human lead approval required before merge (PR not approved by lead)`);
      }
    } else {
      const reviewPath = path.join(cdir, 'review.md');
      const isApprovedInReview = exists(reviewPath) && /##\s*Verdict\s*\n+\s*APPROVE/i.test(readText(reviewPath));
      if (isApprovedInReview || opts.approved) {
        add('human-gate', 'pass', `${effectiveLevel}: local lead review staged (APPROVE in review.md)`);
      } else {
        add('human-gate', 'pass', `${effectiveLevel}: mandatory human lead approval required before merge (auto-merge DENIED)`);
      }
    }
  } else {
    add('human-gate', 'pass', `${effectiveLevel}: auto-merge permitted once AI review passes (no human review required)`);
  }

  const tasksPath = path.join(cdir, 'tasks.md');
  const unchecked = exists(tasksPath) ? countUncheckedTasks(readText(tasksPath)) : Infinity;
  add('tasks-complete', unchecked === 0 ? 'pass' : 'fail',
    unchecked === 0 ? 'all tasks checked' : (Number.isFinite(unchecked) ? `${unchecked} unchecked task(s)` : 'tasks.md missing'));

  const testDiff = checkTestPresence(changedFiles);
  add('test-presence', testDiff.ok ? 'pass' : 'fail', testDiff.detail);

  if (exists(tasksPath)) {
    const evidence = checkTaskEvidence(readText(tasksPath));
    add('tdd-evidence', evidence.ok ? 'pass' : 'fail', evidence.detail);
  }

  const { rules } = readLintConfig(repoRoot);
  const findings = [];
  for (const file of specFiles) {
    for (const fnd of lintSpecText(readText(path.join(cdir, 'specs', file)), { repoRoot, rules })) findings.push({ ...fnd, file });
  }
  const blockers = countBlockers(findings);
  add('BDD + acceptance criteria', blockers === 0 ? 'pass' : 'fail', blockers === 0 ? `${findings.length} advisory finding(s)` : `${blockers} blocker(s)`);

  if (opts.skipOpenspec) {
    add('openspec-validate', 'skip', '--skip-openspec');
  } else {
    const res = validateChange(repoRoot, { strict: true, all: true });
    if (res.missing) add('openspec-validate', 'fail', 'openspec CLI not found');
    else if (res.status === 0) add('openspec-validate', 'pass', 'strict validation passed');
    else add('openspec-validate', 'fail', `${res.stdout}${res.stderr}`.trim().slice(0, 600));
  }

  const schema = checkSchema(repoRoot, {
    expectedVersion: readYamlConfig(repoRoot)?.schemaVersion ?? null,
    stateless: true,
  });
  add('schema-managed', schema.ok ? 'pass' : 'fail',
    schema.ok ? `managed schema v${schema.installed}` : `${schema.reason}${schema.hint ? ` (${schema.hint})` : ''}`);

  if (!opts.skipExternal) {
    const SECRET = /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL/i;
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET.test(k)));
    const env = { ...cleanEnv, ASDLC_CHANGE_ID: changeId, ASDLC_REPO: opts.repo ?? '', ASDLC_SPEC_SHA: specSha ?? '' };
    const extChecks = readExternalChecks(repoRoot);
    for (const check of extChecks) {
      const res = runShell(check.command, repoRoot, { env });
      if (res.status === 0) add(check.name, 'pass', '');
      else add(check.name, 'fail', `${res.stdout}${res.stderr}`.trim().slice(0, 600) || `exit ${res.status}`);
    }

    // Default mapped acceptance-test execution when specs declare AC test mappings
    if (extChecks.length === 0 && specFiles.length > 0 && blockers === 0) {
      const hasMappedAcs = specFiles.some((f) =>
        parseSpecAcceptanceCriteria(readText(path.join(cdir, 'specs', f))).some((ac) => ac.testPath)
      );
      if (hasMappedAcs) {
        try {
          const testExit = runTests(slug, { repoRoot, silent: true });
          add('acceptance-tests', testExit === 0 ? 'pass' : 'fail',
            testExit === 0 ? 'all spec-mapped acceptance tests passed' : 'one or more spec-mapped acceptance tests failed');
        } catch (err) {
          add('acceptance-tests', 'fail', err.message);
        }
      }
    }
  }

  const vcfg = readYamlConfig(repoRoot).verify ?? {};
  const command = process.env.ASDLC_VERIFY_COMMAND ?? vcfg.command;
  const required2 = Boolean(opts.required ?? vcfg.required ?? false);
  if (!command) {
    add('AI verification', required2 ? 'fail' : 'skip', required2 ? 'no verifier configured (set ASDLC_VERIFY_COMMAND)' : 'no verifier configured');
  } else {
    const diff = git(['diff', `${base}...${head}`], repoRoot, { allowFail: true }) ?? '';
    const maxDiffChars = opts.maxDiffChars ?? vcfg.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS;
    const res = runShell(command, repoRoot, {
      input: buildPrompt(changeId, intent(cdir), diff, base, { maxDiffChars }),
      timeout: 900000,
    });
    const report = extractJson(res.stdout) ?? { verdict: 'FAIL', summary: 'verifier produced no parseable JSON' };
    const ok = String(report.verdict).toUpperCase() === 'PASS' && res.status === 0;
    add('AI verification', ok ? 'pass' : 'fail', String(report.summary ?? '').slice(0, 300));
  }

  return finish(results, policy, opts);
}

export function register(program) {
  program
    .command('verify <changeId>')
    .description('check the implementation: artifacts + approved SHA + tasks complete + lint + validate + AI verification')
    .option('--repo <name>', 'repository name')
    .option('--repo-root <dir>', 'repository root path')
    .option('--protected-branch <ref>', 'branch the approved spec must be merged into', 'origin/main')
    .option('--base <ref>', 'base ref for the PR diff (default: protected branch)')
    .option('--head <ref>', 'head ref (default: HEAD)')
    .option('--approved', 'flag indicating human lead approval is verified on PR / platform')
    .option('--emergency', 'emergency mode bypassing standard branch checks')
    .option('--required', 'require AI verification gate to pass')
    .option('--skip-openspec', 'skip openspec validation')
    .option('--skip-external', 'skip external checks from config')
    .option('--json', 'print output in structured JSON')
    .action((changeId, opts) => {
      process.exitCode = runVerify(changeId, opts);
    });
}
