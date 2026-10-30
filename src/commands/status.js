import path from 'node:path';
import { exists, readText, walkFiles, listDir } from '../lib/fs.js';
import { changeDir, openspecDir, CHANGES_DIR } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { lastCommitTouching } from '../lib/git.js';
import { verdictOf } from './lint.js';
import { countUncheckedTasks } from './verify.js';
import { log } from '../lib/log.js';
import { isSinglePrLevel } from '../lib/level.js';

// "Where am I?" for a change - a read-only view of the 7 stages from the working
// tree + git. Useful for humans and for an agent deciding the next command.
export function statusChange(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  const slug = toChangeSlug(changeId);
  const branch = opts.protectedBranch ?? 'origin/main';
  const cdir = changeDir(repoRoot, slug);

  if (!exists(cdir)) {
    if (opts.json) {
      log.plain(JSON.stringify({
        change: slug,
        exists: false,
        next: `asdlc new ${changeId}`
      }, null, 2));
      return 0;
    }
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

  const metaPath = path.join(cdir, '.openspec.yaml');
  let metaText = exists(metaPath) ? readText(metaPath) : '';
  const levelMatch = metaText.match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
  const level = levelMatch ? levelMatch[1].toUpperCase() : 'L1';

  const stage = [
    ['1 explore (draft)', has('explore.md')],
    ['2 proposal.md', has('proposal.md')],
    ['2 spec delta', specFiles.length > 0],
    ['3 spec approved on ' + branch, Boolean(approvedSha)],
    ['4 tasks complete', unchecked === 0],
  ];

  let next;
  if (!has('explore.md') && !has('proposal.md')) next = `asdlc new ${changeId}`;
  else if (!has('proposal.md') || specFiles.length === 0) next = 'author proposal.md + specs/**';
  else if (!approvedSha) next = `run: asdlc lint ${changeId} && asdlc pr ${changeId} (after independent spec review & merge, run: asdlc approve ${changeId})`;
  else if (unchecked !== 0) next = `asdlc apply ${changeId}, then complete tasks in tasks.md`;
  else next = `asdlc verify ${changeId}`;

  if (opts.json) {
    log.plain(JSON.stringify({
      change: slug,
      exists: true,
      level,
      stage: stage.map(([name, ok]) => ({ name, ok })),
      next
    }, null, 2));
    return 0;
  }

  log.plain(`change: ${slug}`);
  for (const [name, ok] of stage) log.plain(`  [${ok ? 'x' : ' '}] ${name}`);
  log.plain('');
  log.plain(`next: ${next}`);
  return 0;
}

// Portfolio overview across all active (in-flight) changes.
// Deliberately excludes completed/archived changes to keep output compact and scannable.
export function statusPortfolio(opts = {}) {
  const repoRoot = requireRepo(opts);
  const branch = opts.protectedBranch ?? 'origin/main';
  const cdirRoot = path.join(openspecDir(repoRoot), CHANGES_DIR);

  if (!exists(cdirRoot)) {
    if (opts.json) {
      log.plain(JSON.stringify({ total: 0, active: [] }, null, 2));
      return 0;
    }
    log.plain('No active changes in flight.');
    log.plain('Run: asdlc new "<requirement>"');
    return 0;
  }

  const entries = listDir(cdirRoot).filter((e) => e.isDirectory() && e.name !== 'archive');
  const active = [];

  for (const entry of entries) {
    const slug = entry.name;
    const cdir = path.join(cdirRoot, slug);

    // Skip archived changes
    const metaPath = path.join(cdir, '.openspec.yaml');
    let metaText = exists(metaPath) ? readText(metaPath) : '';
    if (/status:\s*['"]?archived['"]?/i.test(metaText)) continue;

    const has = (f) => exists(path.join(cdir, f));
    const specFiles = exists(path.join(cdir, 'specs'))
      ? walkFiles(path.join(cdir, 'specs')).filter((f) => f.endsWith('spec.md')) : [];

    const levelMatch = metaText.match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const level = levelMatch ? levelMatch[1].toUpperCase() : 'L1';

    const reqMatch = metaText.match(/^\s*requirement:\s*([^\r\n]+)/m);
    let requirement = reqMatch ? reqMatch[1].trim() : null;
    if (requirement?.startsWith('"') && requirement?.endsWith('"')) {
      try { requirement = JSON.parse(requirement); } catch { /* keep raw */ }
    }

    const locked = [`openspec/changes/${slug}/proposal.md`, `openspec/changes/${slug}/specs`];
    const approvedSha = lastCommitTouching(repoRoot, branch, locked);
    const unchecked = has('tasks.md') ? countUncheckedTasks(readText(path.join(cdir, 'tasks.md'))) : null;
    const isSinglePr = isSinglePrLevel(level);
    const statusMatch = metaText.match(/^\s*status:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const recordedStatus = statusMatch ? statusMatch[1].toLowerCase() : null;

    let stage = '';
    let next = '';

    if (!has('explore.md') && !has('proposal.md')) {
      stage = 'Draft (Explore)';
      next = `asdlc new ${slug}`;
    } else if (!has('proposal.md') || specFiles.length === 0) {
      stage = 'Drafting Specs';
      next = `author proposal.md + specs/**`;
    } else if (isSinglePr) {
      if (unchecked === null) {
        stage = 'Ready for Impl';
        next = `asdlc apply ${slug}`;
      } else if (unchecked > 0) {
        stage = `Implementing (${unchecked} left)`;
        next = `asdlc apply ${slug}`;
      } else {
        stage = 'Ready to Verify';
        next = `asdlc verify ${slug}`;
      }
    } else {
      // Spec-first mode (L2 / L3)
      if (!approvedSha && recordedStatus !== 'ready_for_impl') {
        stage = 'Spec Review';
        next = `asdlc lint ${slug} && asdlc pr ${slug}`;
      } else if (unchecked === null) {
        stage = 'Spec Approved';
        next = `asdlc apply ${slug}`;
      } else if (unchecked > 0) {
        stage = `Implementing (${unchecked} left)`;
        next = `asdlc apply ${slug}`;
      } else {
        stage = 'Ready to Verify';
        next = `asdlc verify ${slug}`;
      }
    }

    active.push({
      slug,
      level,
      stage,
      next,
      requirement
    });
  }

  active.sort((a, b) => a.slug.localeCompare(b.slug));

  if (active.length === 0) {
    if (opts.json) {
      log.plain(JSON.stringify({ total: 0, active: [] }, null, 2));
      return 0;
    }
    log.plain('No active changes in flight.');
    log.plain('Run: asdlc new "<requirement>"');
    return 0;
  }

  if (opts.json) {
    log.plain(JSON.stringify({
      total: active.length,
      active
    }, null, 2));
    return 0;
  }

  // Render clean, compact table
  log.plain(`Active changes (${active.length} in flight):\n`);

  const colSlug = Math.max(6, ...active.map((a) => a.slug.length));
  const colLevel = 5;
  const colStage = Math.max(5, ...active.map((a) => a.stage.length));

  const pad = (str, len) => str + ' '.repeat(Math.max(0, len - str.length));

  log.plain(`  ${pad('CHANGE', colSlug)}  ${pad('LEVEL', colLevel)}  ${pad('STAGE', colStage)}  NEXT COMMAND`);
  log.plain(`  ${'-'.repeat(colSlug)}  ${'-'.repeat(colLevel)}  ${'-'.repeat(colStage)}  ${'-'.repeat(24)}`);

  for (const a of active) {
    log.plain(`  ${pad(a.slug, colSlug)}  ${pad(a.level, colLevel)}  ${pad(a.stage, colStage)}  ${a.next}`);
  }
  log.plain('');
  return 0;
}

export function register(program) {
  program
    .command('status [changeId]')
    .description('show where a change is in the 7 stages + the next command (or portfolio overview if omitted)')
    .option('--protected-branch <ref>', 'branch the approved spec must be merged into', 'origin/main')
    .option('--repo-root <path>')
    .option('--json', 'output machine-readable JSON')
    .action((changeId, opts) => {
      process.exitCode = changeId ? statusChange(changeId, opts) : statusPortfolio(opts);
    });
}

