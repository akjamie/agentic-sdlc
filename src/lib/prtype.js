import { matchesAny } from './policy.js';
import { isSinglePrLevel, readChangeLevel } from './level.js';

// PR type is determined by PATHS and change governance LEVEL.
const CHANGE = /^openspec\/changes\/([^/]+)\//;
const SPECS = /^openspec\/specs\//;

export function changeIdOf(pathname) {
  const m = String(pathname).match(CHANGE);
  return m ? m[1] : null;
}

// -> { type, reason } where type is one of:
//   spec | impl | archive | fast | emergency | normal | invalid
export function classifyPR({ changedFiles = [], changeOnMain = false, policy, emergency = false, level, repoRoot, singlePr = false } = {}) {
  const files = changedFiles.filter(Boolean);
  if (emergency) return { type: 'emergency', reason: 'marked emergency' };

  const changeFiles = files.filter((f) => CHANGE.test(f));
  const outside = files.filter((f) => !CHANGE.test(f));

  if (files.length > 0 && changeFiles.length === 0
      && files.every((f) => matchesAny(f, policy?.fast_path?.allow_paths ?? []))) {
    return { type: 'fast', reason: 'all paths in fast_path.allow_paths' };
  }

  const archiveOnly = files.length > 0
    && files.every((f) => CHANGE.test(f) || SPECS.test(f))
    && files.some((f) => SPECS.test(f));
  if (archiveOnly) return { type: 'archive', reason: 'change dir + specs merge only' };

  // Resolve governance level from argument, repo metadata, or default
  const changeId = changeFiles.length > 0 ? changeIdOf(changeFiles[0]) : null;
  const effectiveLevel = level ?? (repoRoot && changeId ? readChangeLevel(repoRoot, changeId) : null);

  if (changeFiles.length > 0 && !changeOnMain) {
    if (singlePr || isSinglePrLevel(effectiveLevel)) {
      // For L0 / L1 or in-place escalated changes, source code and spec delta are permitted in the same Single PR
      return outside.length === 0
        ? { type: 'spec', reason: `new change dir, no source (${effectiveLevel ?? 'single-pr'})` }
        : { type: 'impl', reason: `single PR flow for ${effectiveLevel ?? 'escalated'} change (specs and source co-located)` };
    }

    // For L2 / L3 (or unlevelled changes): First spec PR must contain the change dir ONLY - no source alongside.
    return outside.length === 0
      ? { type: 'spec', reason: 'new change dir, no source' }
      : { type: 'invalid', reason: 'first PR mixes spec files and source; split it for L2/L3 change' };
  }

  if (changeFiles.length > 0 && changeOnMain) return { type: 'impl', reason: 'existing change dir + source/tasks' };
  if (outside.length > 0) return { type: 'normal', reason: 'no change dir (outside the SDD flow)' };
  return { type: 'normal', reason: files.length === 0 ? 'no changes' : 'unclassified' };
}

