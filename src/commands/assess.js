import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { git } from '../lib/git.js';
import { assess, renderCheckSummary, renderPRComment } from '../assess/index.js';
import { log } from '../lib/log.js';

export function runAssessCommand(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  const slug = changeId ? toChangeSlug(changeId) : null;
  const stage = opts.stage || 'new';

  let changedFiles = [];
  if (stage === 'impl') {
    const base = opts.base || 'origin/main';
    const head = opts.head || 'HEAD';
    const diffFiles = git(['diff', '--name-only', `${base}...${head}`], repoRoot, { allowFail: true }) ?? '';
    changedFiles = diffFiles.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  const result = assess({
    stage,
    changeId: slug,
    requirement: opts.requirement || '',
    changedFiles,
    baseSha: opts.base || 'HEAD',
    headSha: opts.head || null,
    repoRoot,
    persist: Boolean(slug)
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.verdict === 'ok' ? 0 : 1;
  }

  log.info(renderCheckSummary(result));
  if (result.transition && result.transition.direction === 'up') {
    log.warn(`[ESCALATED] Level increased from ${result.transition.from_level} to ${result.risk.level}`);
  }
  return result.verdict === 'ok' ? 0 : 1;
}

export function register(program) {
  program
    .command('assess [changeId]')
    .description('evaluate change risk and governance requirements via unified assess engine')
    .option('--stage <stage>', 'assessment stage: new | spec | impl', 'new')
    .option('--requirement <text>', 'requirement description (for stage: new)')
    .option('--base <ref>', 'base ref for diff (for stage: impl)', 'origin/main')
    .option('--head <ref>', 'head ref for diff (for stage: impl)', 'HEAD')
    .option('--json', 'output raw assessment JSON')
    .action((changeId, opts) => {
      const code = runAssessCommand(changeId, opts);
      if (code !== 0 && !process.exitCode) {
        process.exitCode = code;
      }
    });
}
