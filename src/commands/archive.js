import { exists } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { runOpenspec } from '../lib/openspec.js';
import { ensureFreshGraph } from '../lib/graphify.js';
import { refreshAgents } from '../lib/agents.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';

// STAGE 6: finish. One trigger point (v7 §7.3): openspec archive -> refresh the
// knowledge graph -> refresh AGENTS.md.
export function archiveChange(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  const slug = toChangeSlug(changeId);
  const cdir = changeDir(repoRoot, slug);
  if (!exists(cdir)) fail(`change '${slug}' not found`);

  if (opts.openspec !== false) {
    const res = runOpenspec(['archive', slug, '--yes'], repoRoot);
    if (res.status === 0) log.ok(`archived ${slug}`);
    else log.warn(`openspec archive returned ${res.status} (archive manually if needed)`);
  }

  const fresh = ensureFreshGraph(repoRoot);
  refreshAgents(repoRoot);
  log.ok(`refreshed knowledge graph (${fresh.status}) + AGENTS.md`);
  return 0;
}

export function register(program) {
  program
    .command('archive <changeId>')
    .description('finish: archive the change + refresh the knowledge graph + AGENTS.md')
    .option('--repo-root <path>')
    .option('--no-openspec', 'skip the openspec archive step (KB refresh only)')
    .action((changeId, opts) => {
      process.exitCode = archiveChange(changeId, opts);
    });
}
