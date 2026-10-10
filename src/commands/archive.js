import path from 'node:path';
import { exists, readText, writeText, listDir } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { runOpenspec } from '../lib/openspec.js';
import { refreshAgents } from '../lib/agents.js';
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

  // Constitutional change check: normal spec changes sync to openspec/specs/ and README.
  // AGENTS.md is updated ONLY if constitutional governance files were touched.
  const shouldUpdateAgents = opts.agents === true || (opts.agents !== false && isConstitutionalChange(repoRoot, opts));
  if (shouldUpdateAgents) {
    refreshAgents(repoRoot, { systemStatus: false });
    log.ok(`updated AGENTS.md (constitutional change detected on governance paths)`);
  }

  log.ok(`archive complete for ${slug}`);
  return 0;
}

export function register(program) {
  program
    .command('archive <changeId>')
    .description('finish: archive change + sync living specs to openspec/specs/ + update README (and AGENTS.md if constitutional)')
    .option('--repo-root <path>')
    .option('--agents', 'force refresh AGENTS.md')
    .option('--no-agents', 'skip updating AGENTS.md')
    .option('--no-openspec', 'skip the openspec archive step')
    .action((changeId, opts) => {
      process.exitCode = archiveChange(changeId, opts);
    });
}

