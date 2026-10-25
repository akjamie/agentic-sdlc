import path from 'node:path';
import { exists, readText, walkFiles } from '../lib/fs.js';
import { readYaml } from '../lib/yaml.js';
import { openspecDir, changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug, readLintConfig } from '../lib/cliutil.js';
import { validateChange } from '../lib/openspec.js';
import { runShell } from '../lib/exec.js';
import { lastCommitTouching, changeOnRef, git } from '../lib/git.js';
import { lintSpecText, countBlockers } from '../lib/speclint.js';
import { checkSchema } from '../lib/schema.js';
import { loadPolicy, isAdvisory, DEFAULT_POLICY, matchesAny } from '../lib/policy.js';
import { classifyPR } from '../lib/prtype.js';
import { isSinglePrLevel, requiresHumanReview, readChangeLevel } from '../lib/level.js';
import { checkTestPresence, checkTaskEvidence } from '../lib/tdd.js';
import { log, dim } from '../lib/log.js';

// THE implementation check (v10: gate absorbed verify). Deterministic checks
// first, then - if a verifier is configured - independent AI verification
// (player != referee).

function meta(repoRoot, changeId) {
  const p = path.join(changeDir(repoRoot, toChangeSlug(changeId)), '.openspec.yaml');
  if (!exists(p)) return {};
  const text = readText(p);
  const sha = text.match(/^\s*specSha:\s*['"]?([^\s'"]+)['"]?\s*$/m);
  const status = text.match(/^\s*status:\s*['"]?([^\s'"]+)['"]?\s*$/m);
  const lvl = text.match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
  return {
    specSha: sha ? sha[1] : null,
    status: status ? status[1] : null,
    level: lvl ? lvl[1].toUpperCase() : null,
  };
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

function finish(results, policy) {
  let failed = 0;
  log.info('');
  for (const r of results) {
    const status = r.status === 'fail' && isAdvisory(policy, r.name) ? 'warn' : r.status;
    const badge = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', skip: 'SKIP' }[status];
    if (status === 'fail') failed += 1;
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

function buildPrompt(changeId, intentText, diff, base) {
  return `You are an INDEPENDENT VERIFIER for change ${changeId}. You did NOT author it.
Verify the IMPLEMENTATION satisfies the APPROVED INTENT. Be skeptical.
- Decide PASS/FAIL for every requirement / acceptance criterion and every task.
- FAIL if a requirement is unmet, a task is unchecked/unimplemented, or test evidence is missing.
Output ONLY strict JSON: {"verdict":"PASS|FAIL","summary":"...","requirements":[{"id":"...","verdict":"PASS|FAIL","evidence":"...","gaps":"..."}]}

===== APPROVED INTENT =====
${intentText}

===== IMPLEMENTATION DIFF (base ${base}) =====
${diff || '(empty diff)'}
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
    return finish(results, policy);
  }
  add('change', 'pass', slug);
  const { specSha, status, level: changeLevel } = meta(repoRoot, changeId);

  const changedFiles = (git(['diff', '--name-only', `${base}...${head}`], repoRoot, { allowFail: true }) ?? '')
    .split(/\r?\n/).filter(Boolean);
  const changeOnMain = changeOnRef(repoRoot, branch, slug);
  const pr = classifyPR({ changedFiles, changeOnMain, policy, emergency: opts.emergency, level: changeLevel, repoRoot });
  add('pr-type', pr.type === 'invalid' ? 'fail' : 'pass', `type=${pr.type} (${pr.reason})`);

  const required = ['proposal.md', 'tasks.md'];
  const missing = required.filter((f) => !exists(path.join(cdir, f)));
  const specFiles = exists(path.join(cdir, 'specs'))
    ? walkFiles(path.join(cdir, 'specs')).filter((f) => f.endsWith('spec.md')) : [];
  if (missing.length === 0 && specFiles.length > 0) add('artifacts', 'pass', 'proposal, tasks, spec delta present');
  else add('artifacts', 'fail', [...missing.map((f) => `${f} missing`), ...(specFiles.length === 0 ? ['no spec delta'] : [])].join('; '));

  const lockedPaths = [`openspec/changes/${slug}/proposal.md`, `openspec/changes/${slug}/specs`];
  const approvedSha = lastCommitTouching(repoRoot, branch, lockedPaths);
  if (isSinglePrLevel(changeLevel)) {
    add('approved-spec', 'pass', `${changeLevel} single-PR mode (spec approval co-located in implementation PR)`);
  } else if (!approvedSha) {
    add('approved-spec', 'fail', `no commit on locked paths is merged into ${branch} (not approved)`);
  } else if (specSha && specSha !== approvedSha) {
    add('approved-spec', 'fail', `declared specSha ${specSha.slice(0, 8)} != approved commit ${approvedSha.slice(0, 8)}`);
  } else {
    add('approved-spec', 'pass', `approved commit ${approvedSha.slice(0, 8)} on ${branch}`);
  }

  // Lightweight tamper guard: in a two-phase implementation PR, locked spec files MUST NOT be modified
  const lockedModified = changedFiles.filter((f) => matchesAny(f, policy?.locked_paths ?? DEFAULT_POLICY.locked_paths));
  if (!isSinglePrLevel(changeLevel) && pr.type === 'impl' && lockedModified.length > 0) {
    add('spec-tamper', 'fail', `${lockedModified.length} locked spec file(s) modified in implementation PR (${lockedModified.join(', ')})`);
  } else {
    add('spec-tamper', 'pass', 'locked spec paths unmodified');
  }

  if (isSinglePrLevel(changeLevel)) {
    add('flow-state', 'pass', `${changeLevel} single-PR mode (direct implementation)`);
  } else {
    add('flow-state', status === 'ready_for_impl' ? 'pass' : 'fail',
      status === 'ready_for_impl' ? 'READY_FOR_IMPL' : `status is ${status ?? 'unset'} (run: asdlc approve ${changeId})`);
  }

  const humanReview = requiresHumanReview(changeLevel, { contractTestVerified: opts.contractTestVerified });
  if (humanReview) {
    add('human-gate', 'pass', `${changeLevel ?? 'unlevelled'}: mandatory human lead approval required before merge (auto-merge DENIED)`);
  } else {
    add('human-gate', 'pass', `${changeLevel ?? 'unlevelled'}: auto-merge permitted once AI review passes (no human review required)`);
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

  const schema = checkSchema(repoRoot, { expectedVersion: readYamlConfig(repoRoot)?.schemaVersion ?? null });
  add('schema-managed', schema.ok ? 'pass' : 'fail',
    schema.ok ? `managed schema v${schema.installed}` : `${schema.reason}${schema.hint ? ` (${schema.hint})` : ''}`);

  if (!opts.skipExternal) {
    const SECRET = /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL/i;
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET.test(k)));
    const env = { ...cleanEnv, ASDLC_CHANGE_ID: changeId, ASDLC_REPO: opts.repo ?? '', ASDLC_SPEC_SHA: specSha ?? '' };
    for (const check of readExternalChecks(repoRoot)) {
      const res = runShell(check.command, repoRoot, { env });
      if (res.status === 0) add(check.name, 'pass', '');
      else add(check.name, 'fail', `${res.stdout}${res.stderr}`.trim().slice(0, 600) || `exit ${res.status}`);
    }
  }

  const vcfg = readYamlConfig(repoRoot).verify ?? {};
  const command = process.env.ASDLC_VERIFY_COMMAND ?? vcfg.command;
  const required2 = Boolean(opts.required ?? vcfg.required ?? false);
  if (!command) {
    add('AI verification', required2 ? 'fail' : 'skip', required2 ? 'no verifier configured (set ASDLC_VERIFY_COMMAND)' : 'no verifier configured');
  } else {
    const diff = git(['diff', `${base}...${head}`], repoRoot, { allowFail: true }) ?? '';
    const res = runShell(command, repoRoot, { input: buildPrompt(changeId, intent(cdir), diff, base), timeout: 900000 });
    const report = extractJson(res.stdout) ?? { verdict: 'FAIL', summary: 'verifier produced no parseable JSON' };
    const ok = String(report.verdict).toUpperCase() === 'PASS' && res.status === 0;
    add('AI verification', ok ? 'pass' : 'fail', String(report.summary ?? '').slice(0, 300));
  }

  return finish(results, policy);
}

export function register(program) {
  program
    .command('verify <changeId>')
    .description('check the implementation: artifacts + approved SHA + tasks complete + lint + validate + AI verification')
    .option('--repo <name>', 'repository name')
    .option('--protected-branch <ref>', 'branch the approved spec must be merged into', 'origin/main')
    .option('--base <ref>', 'base ref for the PR diff (default: protected branch)')
    .option('--head <ref>', 'head ref (default: HEAD)')
    .option('--skip-openspec', 'skip openspec validation')
    .option('--skip-external', 'skip external checks from config')
    .action((changeId, opts) => {
      process.exitCode = runVerify(changeId, opts);
    });
}
