import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { lastCommitTouching } from '../lib/git.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';

// Guard before implementing: the spec must be APPROVED (merged to the protected
// branch, i.e. a commit exists on the locked paths). Then use /opsx-apply.
export function applyGuard(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  const slug = toChangeSlug(changeId);
  const branch = opts.protectedBranch ?? 'origin/main';
  const cdir = changeDir(repoRoot, slug);
  const locked = [`openspec/changes/${slug}/proposal.md`, `openspec/changes/${slug}/specs`];
  const approvedSha = lastCommitTouching(repoRoot, branch, locked);
  if (!approvedSha) {
    fail(`'${slug}' is not approved yet (no commit on its locked paths in ${branch})`, {
      code: 'NOT_APPROVED',
      hint: `merge the spec PR, then run \`asdlc approve ${changeId}\``,
    });
  }
  log.ok(`${slug} is approved (${approvedSha.slice(0, 8)}) - implement with /opsx-apply (task-level TDD + converge).`);
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
