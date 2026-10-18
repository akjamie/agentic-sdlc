import path from 'node:path';
import { exists, readText, writeText, listDir } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { runOpenspec } from '../lib/openspec.js';
import { refreshAgents } from '../lib/agents.js';
import { ensureFreshGraph } from '../lib/graphify.js';
import { git } from '../lib/git.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';

function syncReadme(repoRoot, slug, proposalText) {
  const readmePath = path.join(repoRoot, 'README.md');
  if (!exists(readmePath)) return;
  let text = readText(readmePath);
  if (text.includes(`\`${slug}\``)) return;

  let summary = 'Implemented capability.';
  const m = proposalText.match(/##\s*Why\s*\n+([^\n\r]+)/i);
  if (m && m[1]) {
    const raw = m[1].replace(/<!--[\s\S]*?-->/g, '').trim();
    if (raw) summary = raw;
  }

  const entry = `- **\`${slug}\`**: ${summary}`;
  if (text.includes('## Living Specifications')) {
    text = text.replace('## Living Specifications', `## Living Specifications\n\n${entry}`);
  } else {
    text = `${text.trimEnd()}\n\n## Living Specifications\n\n${entry}\n`;
  }
  writeText(readmePath, text);
  log.ok(`updated README.md with archived capability (${slug})`);
}

export const CONSTITUTIONAL_PATHS = [
  'AGENTS.md',
  '.sdlc/policy.yaml',
  'openspec/config.yaml',
  '.githooks',
];

export function isConstitutionalChange(repoRoot, opts = {}) {
  if (opts.constitutional === true || opts.agents === true) return true;

  // 2. Working tree status (unstaged/staged governance changes)
  const statusOut = git(['status', '--porcelain'], repoRoot, { allowFail: true }) ?? '';
  const statusFiles = statusOut
    .split(/\r?\n/)
    .map((l) => l.slice(3).trim())
    .filter(Boolean);

  // 3. Precise commit check: check HEAD commit (the merge commit being archived)
  const commitFilesOut = git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], repoRoot, { allowFail: true }) ?? '';
  const commitFiles = commitFilesOut
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const allTouched = new Set([...statusFiles, ...commitFiles]);

  for (const rawFile of allTouched) {
    const file = rawFile.replace(/\\/g, '/');
    for (const cp of CONSTITUTIONAL_PATHS) {
      if (file === cp || file.startsWith(`${cp}/`)) {
        return true;
      }
    }
  }

  return false;
}

// Stage 7: Archive. Moves change to archive, syncs delta specs into
// openspec/specs/, updates README.md, and updates AGENTS.md ONLY if constitutional.
export function archiveChange(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  const slug = toChangeSlug(changeId);
  const cdir = changeDir(repoRoot, slug);
  if (!exists(cdir)) fail(`change '${slug}' not found`);

  const proposalFile = path.join(cdir, 'proposal.md');
  const proposalText = exists(proposalFile) ? readText(proposalFile) : '';

  if (opts.openspec !== false) {
    const res = runOpenspec(['archive', slug, '--yes'], repoRoot);
    if (res.status === 0) log.ok(`archived ${slug}: synced living specs -> openspec/specs/`);
    else log.warn(`openspec archive returned ${res.status} (archive manually if needed)`);
  }

  syncReadme(repoRoot, slug, proposalText);

  // Refresh AST knowledge graph if Graphify is available
  if (opts.graph !== false) {
    try {
      const g = ensureFreshGraph(repoRoot);
      if (g.status === 'missing' || g.status === 'stale') {
        log.ok(`rebuilt knowledge graph (graphify ${g.status} -> fresh)`);
      }
    } catch (err) {
      log.warn(`knowledge graph refresh skipped: ${err.message}`);
    }
  }

  // AGENTS.md update:
  // - If AGENTS.md does not exist, create and initialize it.
  // - If AGENTS.md exists, refresh the system status (knowledge graph god nodes)
  //   and routing block so the agentic IDE stays grounded in current architecture.
  // - If constitutional change or explicit --agents, log governance refresh.
  // - If --no-agents was explicitly passed, skip updating AGENTS.md.
  const agentsPath = path.join(repoRoot, 'AGENTS.md');
  const agentsMissing = !exists(agentsPath);
  const constitutional = isConstitutionalChange(repoRoot, opts);
  const shouldUpdateAgents = opts.agents !== false;

  if (shouldUpdateAgents) {
    refreshAgents(repoRoot, { systemStatus: true });
    if (agentsMissing) {
      log.ok('created AGENTS.md (was missing) and initialized system status');
    } else if (constitutional) {
      log.ok('updated AGENTS.md (constitutional change detected on governance paths)');
    } else {
      log.ok('refreshed AGENTS.md system status (knowledge graph hubs)');
    }
  }

  log.ok(`archive complete for ${slug}`);
  return 0;
}

export function register(program) {
  program
    .command('archive <changeId>')
    .description('finish: archive change + sync living specs to openspec/specs/ + update README & AGENTS.md')
    .option('--repo-root <path>')
    .option('--agents', 'force refresh AGENTS.md')
    .option('--no-agents', 'skip updating AGENTS.md')
    .option('--no-graph', 'skip rebuilding knowledge graph')
    .option('--no-openspec', 'skip the openspec archive step')
    .action((changeId, opts) => {
      process.exitCode = archiveChange(changeId, opts);
    });
}

