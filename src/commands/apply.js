import path from 'node:path';
import { exists } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { lastCommitTouching } from '../lib/git.js';
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

  const branch = opts.targetBranch ?? opts.protectedBranch ?? 'main';
  const locked = [`openspec/changes/${slug}/proposal.md`, `openspec/changes/${slug}/specs`];
  const approvedSha = lastCommitTouching(repoRoot, branch, locked);

  if (!approvedSha) {
    fail(`'${slug}' is not approved yet (no Spec PR merged into ${branch})`, {
      code: 'NOT_APPROVED',
      hint: `open a Spec PR via \`asdlc pr ${changeId} ${branch}\`, merge it, then run \`asdlc apply\``,
    });
  }

  log.ok(`${slug} is approved on ${branch} (${approvedSha.slice(0, 8)}) - implement with /opsx-apply (task-level TDD + converge).`);
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
