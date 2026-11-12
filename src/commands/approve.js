import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exists, readText, writeText } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { headSha, git, isGitRepo, lastCommitTouching, changeOnRef, safeCommit } from '../lib/git.js';
import { loadPolicy } from '../lib/policy.js';
import { classifyPR } from '../lib/prtype.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { resolveTopology } from '../lib/level.js';

function upsertKey(text, key, value) {
  const re = new RegExp(`^\\s*${key}:\\s*.*$`, 'm');
  const line = `${key}: ${value}`;
  if (re.test(text)) return text.replace(re, line);
  return `${text.trimEnd()}\n${line}\n`;
}

function ensureApprovedReview(repoRoot, slug, approvedSha, mergeSha) {
  const cdir = changeDir(repoRoot, slug);
  const reviewPath = path.join(cdir, 'review.md');
  const now = new Date().toISOString();

  if (exists(reviewPath)) {
    let content = readText(reviewPath);
    if (/##\s*Verdict[^\n]*/i.test(content)) {
      content = content.replace(/##\s*Verdict[^\n]*\n+\s*[A-Za-z_]+/i, '## Verdict\nAPPROVE');
    } else {
      content = `${content.trimEnd()}\n\n## Verdict\nAPPROVE\n`;
    }
    const record = `\n\n## Approval Record\n- status: READY_FOR_IMPL\n- specSha: ${approvedSha}\n- mergeCommit: ${mergeSha}\n- approvedAt: ${now}\n`;
    if (/##\s*Approval Record/i.test(content)) {
      content = content.replace(/##\s*Approval Record[\s\S]*$/i, record.trimStart());
    } else {
      content = `${content.trimEnd()}${record}`;
    }
    writeText(reviewPath, content);
  } else {
    const content = `# Review: ${slug}

## Summary
Human PR review and merge completed on protected branch.
Spec approval confirmed and locked via merge commit \`${mergeSha.slice(0, 8)}\`.

## Dimensions Evaluation
- Completeness: PASS
- Ambiguity: PASS
- Cross-repo consistency: PASS
- Contract impact: PASS
- Testability: PASS
- Security: PASS

## Blocking Findings
(none)

## Verdict
APPROVE

## Approval Record
- status: READY_FOR_IMPL
- specSha: ${approvedSha}
- mergeCommit: ${mergeSha}
- approvedAt: ${now}
`;
    writeText(reviewPath, content);
  }
}

// DISCRIMINATOR (v6 7.1): PR type is decided by PATHS ONLY. A merge is an
// APPROVAL only when it is a spec merge (new change dir, no source); impl/archive/
// fast/normal merges are ignored so the flow stays distinguishable.
export function mergeChange(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  if (!isGitRepo(repoRoot)) fail('not a git repository; cannot derive merge evidence');

  const policy = loadPolicy(repoRoot);
  const sha = opts.sha ?? headSha(repoRoot);
  if (!sha) fail('cannot resolve the merge commit (HEAD)');

  const slug = changeId ? toChangeSlug(changeId) : detectSlugFromHead(repoRoot);
  if (!slug) {
    log.warn('no openspec/changes/* touched by this merge; treating as a normal PR (no approval)');
    return [];
  }

  // Single-PR optimization (Stage 4 decoupling):
  // When explicitly invoked for a Single-PR change, spec approval is co-located with the
  // final implementation PR. We idempotently mark status: ready_for_impl without requiring
  // a separate merged Spec PR, without stamping specSha or tagging, and without writing review.md.
  if (changeId) {
    const branch = opts.protectedBranch ?? opts.branch ?? 'origin/main';
    const topology = resolveTopology({ repoRoot, slug, baseRef: branch, cliMode: opts.mode });
    if (topology.isSinglePr) {
      const meta = path.join(changeDir(repoRoot, slug), '.openspec.yaml');
      if (!exists(meta)) fail(`${slug}: no .openspec.yaml`);

      let text = readText(meta);
      text = upsertKey(text, 'status', 'ready_for_impl');
      writeText(meta, text);

      log.ok(`${slug}: Single-PR mode (${topology.effectiveLevel}) - spec approval is co-located with implementation PR.`);
      log.ok('marked status=ready_for_impl in-place (no separate Spec PR required).');
      log.info('final approval = human Approve on the single PR (NOT waived).');
      return [slug];
    }
  }

  const changedFiles = (git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD^1', 'HEAD'], repoRoot, { allowFail: true }) ?? '')
    .split(/\r?\n/).filter(Boolean);
  // was the change already on main BEFORE this merge?
  const changeOnMain = changeOnRef(repoRoot, 'HEAD^1', slug);
  const pr = classifyPR({ changedFiles, changeOnMain, policy, emergency: opts.emergency });
  // If auto-detected without an explicit changeId (e.g. post-merge hook),
  // strictly verify that this merge commit was a spec-only merge.
  if (!changeId && pr.type !== 'spec') {
    log.info(`${slug}: not a spec merge (type=${pr.type}) -> no approval stamp`);
    return [];
  }

  // The approved commit is PATH-LIMITED (v6 4): last commit on HEAD touching the
  // locked paths. review.md / tasks.md commits never move it.
  const lockedPaths = [`openspec/changes/${slug}/proposal.md`, `openspec/changes/${slug}/specs`];
  const approvedSha = lastCommitTouching(repoRoot, 'HEAD', lockedPaths) ?? sha;

  const meta = path.join(changeDir(repoRoot, slug), '.openspec.yaml');
  if (!exists(meta)) fail(`${slug}: no .openspec.yaml`);

  let text = readText(meta);
  text = upsertKey(text, 'specSha', approvedSha);
  text = upsertKey(text, 'status', 'ready_for_impl');
  writeText(meta, text);
  log.ok(`${slug}: APPROVED specSha=${approvedSha.slice(0, 8)} status=ready_for_impl`);

  // Auto-generate / stamp review.md with human approval and approvedSha
  ensureApprovedReview(repoRoot, slug, approvedSha, sha);
  log.ok(`${slug}: stamped review.md (verdict=APPROVE, specSha=${approvedSha.slice(0, 8)})`);

  // The "approved" tag on the spec: an immutable, machine-readable record.
  if (opts.tag !== false) {
    try {
      execFileSync('git', ['tag', '-f', `approved/${slug.toUpperCase()}`, approvedSha], { cwd: repoRoot, stdio: 'ignore' });
      log.ok(`tagged approved/${slug.toUpperCase()} @ ${approvedSha.slice(0, 8)}`);
    } catch (err) {
      log.warn(`tag not created: ${err.message}`);
    }
  }

  if (opts.commit !== false) {
    try {
      execFileSync('git', ['add', `openspec/changes/${slug}/.openspec.yaml`, `openspec/changes/${slug}/review.md`], { cwd: repoRoot, stdio: 'ignore' });
      safeCommit(repoRoot, `chore(approve): spec approved @ ${approvedSha.slice(0, 8)} (${slug})`);
      log.ok('committed approval stamp');
    } catch {
      log.warn('nothing to commit (already stamped)');
    }
  }

  log.info('');
  log.info('Next (automatic chain):');
  log.info('  - generate tasks:  /opsx-continue   (its own step, after approval)');
  log.info('  - implement:       /opsx-apply       -> implementation PR');
  log.info('  - verify:          asdlc verify <ID>');
  return [slug];
}

function detectSlugFromHead(repoRoot) {
  const out = git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD^1', 'HEAD'], repoRoot, { allowFail: true });
  if (!out) return null;
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^openspec\/changes\/([^/]+)\//);
    if (m && m[1] !== 'archive') return m[1];
  }
  return null;
}

export function register(program) {
  program
    .command('approve [changeId]')
    .description('record the approved spec after the spec PR merges (tags approved/<ID> + marks READY_FOR_IMPL)')
    .option('--sha <sha>', 'merge commit (default: HEAD)')
    .option('--mode <mode>', 'workflow mode override (supervised, spec-first, auto)')
    .option('--no-tag', 'skip the approved/<ID> git tag')
    .option('--no-commit', 'stamp without committing')
    .option('--repo-root <path>')
    .action((changeId, opts) => {
      mergeChange(changeId, opts);
    });
}
