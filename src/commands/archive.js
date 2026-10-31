import fs from 'node:fs';
import path from 'node:path';
import { exists, readText, ensureDir, copyTree, removeDir, listDir, walkFiles } from '../lib/fs.js';
import { changeDir, openspecDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { runOpenspec } from '../lib/openspec.js';
import { refreshAgents } from '../lib/agents.js';
import { ensureFreshGraph } from '../lib/graphify.js';
import { git } from '../lib/git.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';

export const CONSTITUTIONAL_PATHS = [
  'AGENTS.md',
  '.sdlc/policy.yaml',
  'openspec/config.yaml',
];

export function isConstitutionalChange(repoRoot, opts = {}) {
  if (opts.constitutional === true || opts.agents === true) return true;

  const statusOut = git(['status', '--porcelain', '-uall'], repoRoot, { allowFail: true }) ?? '';
  const statusFiles = statusOut
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\S+\s+/, '').trim())
    .filter(Boolean);

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

function compactChangeFallback(repoRoot, slug) {
  const cdir = changeDir(repoRoot, slug);
  if (!exists(cdir)) return;

  const specsSrc = path.join(cdir, 'specs');
  if (exists(specsSrc)) {
    const specRelFiles = walkFiles(specsSrc).filter((f) => f.endsWith('spec.md'));
    for (const rel of specRelFiles) {
      const srcFile = path.join(specsSrc, rel);
      const destFile = path.join(openspecDir(repoRoot), 'specs', rel);
      ensureDir(path.dirname(destFile));
      fs.copyFileSync(srcFile, destFile);
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const archiveDest = path.join(openspecDir(repoRoot), 'changes', 'archive', `${stamp}-${slug}`);
  ensureDir(path.dirname(archiveDest));
  copyTree(cdir, archiveDest);
  removeDir(cdir);
}

// Stage 7: Post-Merge Archive.
// Compacts openspec/changes/<slug> -> openspec/changes/archive/ and syncs living specs
// into openspec/specs/ WITHOUT polluting root README.md or routine AGENTS.md (zero merge-conflict hotspots).
export function archiveChange(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  const slug = toChangeSlug(changeId);
  const cdir = changeDir(repoRoot, slug);
  if (!exists(cdir)) fail(`change '${slug}' not found`);

  if (opts.openspec !== false) {
    const res = runOpenspec(['archive', slug, '--yes'], repoRoot);
    if (res.status === 0) {
      log.ok(`archived ${slug}: synced living specs -> openspec/specs/`);
    } else {
      compactChangeFallback(repoRoot, slug);
      log.ok(`archived ${slug} via native compaction -> openspec/specs/`);
    }
  } else {
    compactChangeFallback(repoRoot, slug);
    log.ok(`archived ${slug}: synced living specs -> openspec/specs/`);
  }

  // Refresh derived AST knowledge graph cache if Graphify is available (gitignored, no merge conflicts)
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

  // Conflict-free root governance rule:
  // Routine feature archives NEVER rewrite root README.md or AGENTS.md.
  // AGENTS.md is updated ONLY when explicitly requested via --agents or when constitutional paths changed.
  const shouldUpdateAgents = opts.agents === true || (opts.agents !== false && isConstitutionalChange(repoRoot, opts));
  if (shouldUpdateAgents) {
    refreshAgents(repoRoot, { systemStatus: true });
    log.ok('updated AGENTS.md (explicit --agents or constitutional governance change)');
  }

  log.ok(`archive complete for ${slug}`);
  return 0;
}

function isChangeMergedAndComplete(repoRoot, slug, targetRef = 'HEAD') {
  const cdir = changeDir(repoRoot, slug);
  const tasksPath = path.join(cdir, 'tasks.md');
  // A change is only completed if implementation tasks were generated, completed, and checked off.
  // Newly merged Spec PRs on targetRef only contain proposal.md/specs without tasks.md;
  // they must NOT be treated as complete.
  if (!exists(tasksPath)) return false;

  const tasksText = readText(tasksPath);
  const checked = (tasksText.match(/^\s*-\s+\[x\]/gim) ?? []).length;
  const unchecked = (tasksText.match(/^\s*-\s+\[\s\]/gm) ?? []).length;
  if (checked === 0 || unchecked > 0) return false;

  const trackedOnTarget = git(['ls-tree', '-r', '--name-only', targetRef, `openspec/changes/${slug}`], repoRoot, { allowFail: true }) ?? '';
  return Boolean(trackedOnTarget.trim());
}

/**
 * Post-merge batch compaction (`asdlc archive --merged`):
 * Archives all completed changes already merged on targetRef in a single L0 maintenance pass,
 * eliminating per-feature 3rd PR overhead.
 */
export function archiveMergedChanges(opts = {}) {
  const repoRoot = requireRepo(opts);
  const changesRoot = path.join(openspecDir(repoRoot), 'changes');
  if (!exists(changesRoot)) {
    log.info('No openspec/changes directory found.');
    return 0;
  }

  const targetRef = opts.targetBranch ?? 'HEAD';
  const entries = fs.readdirSync(changesRoot, { withFileTypes: true });
  const candidates = entries
    .filter((ent) => ent.isDirectory() && ent.name !== 'archive' && !ent.name.startsWith('.'))
    .map((ent) => ent.name);

  const mergedSlugs = candidates.filter((slug) => isChangeMergedAndComplete(repoRoot, slug, targetRef));
  if (mergedSlugs.length === 0) {
    log.info('No completed merged changes pending archive.');
    return 0;
  }

  for (const slug of mergedSlugs) {
    archiveChange(slug, { ...opts, graph: false, agents: false });
  }

  if (opts.graph !== false) {
    try { ensureFreshGraph(repoRoot); } catch { /* ignore */ }
  }
  if (opts.agents === true) {
    refreshAgents(repoRoot, { systemStatus: true });
  }

  log.ok(`batch archived ${mergedSlugs.length} merged change(s): ${mergedSlugs.join(', ')}`);
  return 0;
}

export function register(program) {
  program
    .command('archive [changeId]')
    .description('post-merge compaction: archive completed change(s) and sync living specs to openspec/specs/')
    .option('--merged', 'batch-archive all completed changes merged on target branch')
    .option('--target-branch <ref>', 'target branch ref to check for --merged (default: HEAD)')
    .option('--repo-root <path>')
    .option('--agents', 'explicitly refresh AGENTS.md')
    .option('--no-agents', 'skip updating AGENTS.md (default for non-constitutional changes)')
    .option('--no-graph', 'skip rebuilding knowledge graph')
    .option('--no-openspec', 'use native compaction without invoking openspec archive')
    .action((changeId, opts) => {
      if (opts.merged) {
        process.exitCode = archiveMergedChanges(opts);
        return;
      }
      if (!changeId) {
        fail('specify <changeId> or pass --merged to batch-archive merged changes');
      }
      process.exitCode = archiveChange(changeId, opts);
    });
}
