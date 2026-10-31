import path from 'node:path';
import { exists, readText } from './fs.js';
import { changeDir } from './paths.js';
import { toChangeSlug } from './cliutil.js';
import { git } from './git.js';
import { assess, loadMaxHistoryLevel, loadRiskHistory } from '../assess/index.js';
import { RISK_LEVELS, LEVEL_RANK } from '../assess/rules/builtin.js';
import { fail } from './errors.js';

export const LEVELS = RISK_LEVELS;

export function inferInitialLevel({ requirement = '', explicitLevel, repoRoot, changeId } = {}) {
  // Always run assessment to establish immutable baseline in history
  const result = assess({
    stage: 'new',
    changeId: changeId || 'provisional',
    requirement,
    repoRoot,
    persist: Boolean(repoRoot && changeId)
  });

  const systemLevel = result.risk.level;
  let finalLevel = systemLevel;
  let reason = 'bounded local module change';

  const allEvidence = [
    ...(result.vectors.v2_security.evidence || []),
    ...(result.vectors.v3_topology.evidence || []),
    ...(result.vectors.v1_intent.evidence || [])
  ];
  if (allEvidence.length > 0) {
    reason = allEvidence[0].summary;
  } else if (result.reason_codes && result.reason_codes.length > 0) {
    reason = result.reason_codes[0];
  }

  if (explicitLevel) {
    const norm = String(explicitLevel).toUpperCase();
    if (LEVELS[norm]) {
      const explicitRank = LEVEL_RANK[norm] ?? 1;
      const systemRank = LEVEL_RANK[systemLevel] ?? 1;
      if (explicitRank < systemRank) {
        fail(`cannot downgrade governance level to ${norm}: system evaluation strictly rated requirement as ${systemLevel} (${reason})`, {
          code: 'ILLEGAL_DOWNGRADE',
          hint: 'Level ratings are automated system invariants. Raise a system rule bug if the rating is inaccurate.'
        });
      }
      finalLevel = norm;
      reason = `explicitly specified via --level ${norm}`;
    }
  }

  const isSpecFirst = finalLevel === 'L2' || finalLevel === 'L3';
  return {
    level: finalLevel,
    changeType: result.change_type,
    reason,
    workflowMode: isSpecFirst ? 'spec-first' : 'single-pr',
    implementationReview: isSpecFirst ? 'ai+human' : 'ai',
    assessment: result
  };
}

export function isSinglePrLevel(level) {
  return level === LEVELS.L0 || level === LEVELS.L1;
}

export function requiresHumanReview(level, opts = {}) {
  if (level === LEVELS.L3) return true;
  if (level === LEVELS.L2) return !Boolean(opts?.contractTestVerified);
  return false;
}

export function readChangeLevel(repoRoot, changeId) {
  const eff = readEffectiveLevel(repoRoot, changeId);
  return eff ? eff.effectiveLevel : null;
}

function readBaseBranchHistoryInfo(repoRoot, slug, baseRef) {
  if (!repoRoot || !slug || !baseRef) return { maxLevel: null, records: [] };
  const candidates = [baseRef];
  if (baseRef.startsWith('origin/')) candidates.push(baseRef.slice('origin/'.length));

  for (const ref of candidates) {
    const histOut = git(['show', `${ref}:openspec/changes/${slug}/risk-history.jsonl`], repoRoot, { allowFail: true });
    const metaOut = git(['show', `${ref}:openspec/changes/${slug}/.openspec.yaml`], repoRoot, { allowFail: true });
    if (!histOut && !metaOut) continue;

    let maxLvl = null;
    const records = [];
    if (histOut) {
      for (const line of histOut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        try {
          const rec = JSON.parse(line);
          records.push(rec);
          const lvl = rec.risk?.level;
          if (lvl && (!maxLvl || (LEVEL_RANK[lvl] ?? 0) > (LEVEL_RANK[maxLvl] ?? 0))) {
            maxLvl = lvl;
          }
        } catch { /* ignore */ }
      }
    }
    if (metaOut) {
      const m = metaOut.match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
      const decl = m ? m[1].toUpperCase() : null;
      if (decl && (!maxLvl || (LEVEL_RANK[decl] ?? 0) > (LEVEL_RANK[maxLvl] ?? 0))) {
        maxLvl = decl;
      }
    }
    return { maxLevel: maxLvl, records };
  }
  return { maxLevel: null, records: [] };
}

export function readEffectiveLevel(repoRoot, changeId, opts = {}) {
  if (!repoRoot || !changeId) return null;
  const slug = toChangeSlug(changeId);
  const cdir = changeDir(repoRoot, slug);
  const metaPath = path.join(cdir, '.openspec.yaml');
  let declaredLevel = null;
  if (exists(metaPath)) {
    const metaText = readText(metaPath);
    const m = metaText.match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    declaredLevel = m ? m[1].toUpperCase() : null;
  }

  let maxHistory = null;
  let localRecords = [];
  let chainCorrupt = false;
  try {
    localRecords = loadRiskHistory(repoRoot, slug);
    maxHistory = loadMaxHistoryLevel(repoRoot, slug);
  } catch (err) {
    if (err.code === 'TAMPER_DETECTED' || err.message?.includes('tamper')) {
      chainCorrupt = true;
    } else {
      throw err;
    }
  }

  // Anchor against target branch history if available (prevents local delete-and-regenerate attack)
  const baseInfo = opts.baseRef ? readBaseBranchHistoryInfo(repoRoot, slug, opts.baseRef) : { maxLevel: null, records: [] };
  if (baseInfo.records.length > 0) {
    if (
      localRecords.length < baseInfo.records.length ||
      localRecords[0]?.hash !== baseInfo.records[0]?.hash
    ) {
      chainCorrupt = true;
    }
  }

  if (!declaredLevel && !maxHistory && !baseInfo.maxLevel && !chainCorrupt) {
    return null;
  }

  const declaredRank = declaredLevel ? (LEVEL_RANK[declaredLevel] ?? 0) : 0;
  const historyRank = maxHistory ? (LEVEL_RANK[maxHistory] ?? 0) : 0;
  const baseRank = baseInfo.maxLevel ? (LEVEL_RANK[baseInfo.maxLevel] ?? 0) : 0;
  const requiredMinRank = Math.max(historyRank, baseRank);

  const tampered = chainCorrupt || Boolean(requiredMinRank > 0 && declaredLevel && declaredRank < requiredMinRank);
  const effectiveRank = Math.max(declaredRank, historyRank, baseRank);
  const effectiveLevel = Object.keys(LEVEL_RANK).find((k) => LEVEL_RANK[k] === effectiveRank) || (declaredLevel || maxHistory || baseInfo.maxLevel || 'L1');

  return {
    declaredLevel,
    maxHistoryLevel: maxHistory || baseInfo.maxLevel,
    effectiveLevel,
    tampered
  };
}

