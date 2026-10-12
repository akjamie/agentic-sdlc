import path from 'node:path';
import { exists, readText } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { lastCommitTouching, git } from '../lib/git.js';
import { readYaml } from '../lib/yaml.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';

// Guard before implementing: the spec must be APPROVED on the target branch
// (i.e. the Spec PR has been merged into targetBranch, locking proposal.md & specs/**).
export function applyGuard(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  const slug = toChangeSlug(changeId);
  const cdir = changeDir(repoRoot, slug);
  if (!exists(cdir)) fail(`change '${slug}' not found`);

  // 1. Target branch approved commit check
  const branch = opts.targetBranch ?? opts.protectedBranch ?? 'main';
  const locked = [`openspec/changes/${slug}/proposal.md`, `openspec/changes/${slug}/specs`];
  const approvedSha = lastCommitTouching(repoRoot, branch, locked);

  if (!approvedSha) {
    fail(`'${slug}' is not approved yet (no Spec commit merged into ${branch})`, {
      code: 'NOT_APPROVED',
      hint: `open a Spec PR via \`asdlc pr ${changeId} ${branch}\`, merge it, then run \`asdlc approve ${changeId}\``,
    });
  }

  // 2. Flow state and specSha consistency in .openspec.yaml
  const metaPath = path.join(cdir, '.openspec.yaml');
  let meta = {};
  if (exists(metaPath)) {
    const text = readText(metaPath);
    const sha = text.match(/^\s*specSha:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const status = text.match(/^\s*status:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    meta = { specSha: sha ? sha[1] : null, status: status ? status[1] : null };
  }

  if (meta.status !== 'ready_for_impl') {
    fail(`'${slug}' state is ${meta.status ?? 'unset'} (expected: ready_for_impl)`, {
      code: 'NOT_READY_FOR_IMPL',
      hint: `run \`asdlc approve ${changeId}\` to record approval and transition change state`,
    });
  }

  if (meta.specSha && meta.specSha !== approvedSha) {
    fail(`'${slug}' specSha mismatch: declared ${meta.specSha.slice(0, 8)} != approved ${approvedSha.slice(0, 8)} on ${branch}`, {
      code: 'SPEC_SHA_MISMATCH',
      hint: `spec was modified after approval. Run \`asdlc approve ${changeId}\` or revert local spec changes.`,
    });
  }

  // 3. Local working tree tamper check: locked paths must not have uncommitted edits
  const dirty = (git(['status', '--porcelain', '--', ...locked], repoRoot, { allowFail: true }) ?? '').trim();
  if (dirty) {
    fail(`cannot apply '${slug}': locked spec paths have uncommitted local modifications:\n${dirty}`, {
      code: 'SPEC_DIRTY',
      hint: 'commit or stash your spec modifications before proceeding with implementation',
    });
  }

  // 4. Tasks checklist presence
  const tasksPath = path.join(cdir, 'tasks.md');
  if (!exists(tasksPath)) {
    fail(`'${slug}' missing tasks.md`, {
      code: 'TASKS_MISSING',
      hint: 'author tasks.md with TDD verification tasks before running apply',
    });
  }

  log.ok(`${slug} is APPROVED on ${branch} (specSha: ${approvedSha.slice(0, 8)}, state: ready_for_impl)`);
  log.info(`Ready for implementation. Follow task-level TDD loop in tasks.md.`);
  return 0;
}

export function register(program) {
  program
    .command('apply <changeId>')
    .description('guard before implementing: the spec must be approved on the protected branch')
    .option('--protected-branch <ref>', 'branch the approved spec must be merged into', 'origin/main')
    .option('--repo-root <path>')
    .action((changeId, opts) => {
      process.exitCode = applyGuard(changeId, opts);
    });
}
