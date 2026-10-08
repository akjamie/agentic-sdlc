import path from 'node:path';
import { exists, readText, walkFiles } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { lastCommitTouching } from '../lib/git.js';
import { verdictOf } from './lint.js';
import { countUncheckedTasks } from './verify.js';
import { log } from '../lib/log.js';

// "Where am I?" for a change - a read-only view of the 7 stages from the working
// tree + git. Useful for humans and for an agent deciding the next command.
export function statusChange(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  const slug = toChangeSlug(changeId);
  const branch = opts.protectedBranch ?? 'origin/main';
  const cdir = changeDir(repoRoot, slug);

  if (!exists(cdir)) {
    log.plain(`change: ${slug}`);
    log.plain('  (not created)');
    log.plain(`next: asdlc new ${changeId}`);
    return 0;
  }

  const has = (f) => exists(path.join(cdir, f));
  const specFiles = exists(path.join(cdir, 'specs'))
    ? walkFiles(path.join(cdir, 'specs')).filter((f) => f.endsWith('spec.md')) : [];
  const review = has('review.md') ? readText(path.join(cdir, 'review.md')) : null;
  const verdict = review ? verdictOf(review) : null;
  const locked = [`openspec/changes/${slug}/proposal.md`, `openspec/changes/${slug}/specs`];
  const approvedSha = lastCommitTouching(repoRoot, branch, locked);
  const unchecked = has('tasks.md') ? countUncheckedTasks(readText(path.join(cdir, 'tasks.md'))) : null;

  const stage = [
    ['1 explore.md', has('explore.md')],
    ['2 proposal.md', has('proposal.md')],
    ['2 spec delta', specFiles.length > 0],
    ['2 review.md (APPROVE)', verdict === 'APPROVE'],
    ['3 approved on ' + branch, Boolean(approvedSha)],
    ['4 tasks complete', unchecked === 0],
  ];

  log.plain(`change: ${slug}`);
  for (const [name, ok] of stage) log.plain(`  [${ok ? 'x' : ' '}] ${name}`);

  let next;
  if (!has('explore.md')) next = `asdlc new ${changeId}`;
  else if (!has('proposal.md') || specFiles.length === 0) next = 'author proposal.md + specs/** (grounded in explore.md)';
  else if (verdict !== 'APPROVE') next = `asdlc lint ${changeId}`;
  else if (!approvedSha) next = `merge the spec PR, then: asdlc approve ${changeId}`;
  else if (unchecked !== 0) next = `asdlc apply ${changeId}, then /opsx-apply`;
  else next = `asdlc verify ${changeId} --repo <name>`;
  log.plain('');
  log.plain(`next: ${next}`);
  return 0;
}

export function register(program) {
  program
    .command('status <changeId>')
    .description('show where a change is in the 7 stages + the next command')
    .option('--protected-branch <ref>', 'branch the approved spec must be merged into', 'origin/main')
    .option('--repo-root <path>')
    .action((changeId, opts) => {
      process.exitCode = statusChange(changeId, opts);
    });
}
