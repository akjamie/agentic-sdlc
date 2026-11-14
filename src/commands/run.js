import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveAgentHarnessConfig,
  resolveGitCredentials,
  resolvePassthroughEnv,
  redactSecrets,
} from '../lib/auth.js';
import { loadGlobalConfig } from '../lib/config.js';
import { toChangeSlug, jsonOut } from '../lib/cliutil.js';
import {
  buildContainerCreateArgs,
  buildDockerCreateArgs,
  detectRepoLifecycle,
  lockSpecsReadOnly,
  preScanWorkspaceForSecrets,
  resolveContainerEngine,
  runContainerPipeline,
  whichCommand,
  DEFAULT_RUNNER_IMAGE,
} from '../lib/container.js';
import { AsdlcError, fail } from '../lib/errors.js';
import {
  changeOnRef,
  git,
  lastCommitTouching,
  resolveDefaultBranch,
} from '../lib/git.js';
import { assertGitRepositoryInitialized, resolveGitHostAndRepo } from '../lib/githost.js';
import { findChangeByIssueId } from '../lib/intake.js';
import { resolveTopology } from '../lib/level.js';
import { log, dim } from '../lib/log.js';
import { exists, readText, walkFiles } from '../lib/fs.js';
import { changeDir, openspecDir } from '../lib/paths.js';
import {
  buildThreadResolutionPlan,
  checkAntiThrashingCircuitBreaker,
  triagePullRequest,
  fetchGitHubPrReviewContext,
  replyAndResolveGitHubThread,
} from '../lib/triage.js';
import { applyGuard } from './apply.js';
import { hasUnresolvedClarifications, runLint } from './lint.js';
import { newChange } from './new.js';
import { createPR } from './pr.js';
import { runVerify } from './verify.js';

export const CANONICAL_STAGES = Object.freeze(['spec', 'apply', 'verify', 'fix']);

export const STAGE_ALIASES = Object.freeze({
  'spec-review': 'spec',
  'impl-review': 'verify',
  'fix-comments': 'fix',
});

const DEFAULT_MUTEX_STALE_MS = 30 * 60 * 1000;

/**
 * Normalize explicit `--stage` values onto the canonical 3+1 stage verbs (`spec`, `apply`, `verify`, `fix`).
 * Rejects unrecognized stage names with `ASDLC_ERR_INVALID_STAGE`.
 *
 * @param {string|null|undefined} stage
 * @returns {string|null}
 */
export function normalizeStage(stage) {
  if (stage === undefined || stage === null || String(stage).trim() === '') {
    return null;
  }
  const normalized = String(stage).trim().toLowerCase();
  if (CANONICAL_STAGES.includes(normalized)) {
    return normalized;
  }
  if (Object.hasOwn(STAGE_ALIASES, normalized)) {
    return STAGE_ALIASES[normalized];
  }
  throw new AsdlcError(
    `Invalid pipeline stage '${stage}'. Expected one of: ${CANONICAL_STAGES.join(', ')} (aliases: ${Object.keys(STAGE_ALIASES).join(', ')}).`,
    {
      code: 'ASDLC_ERR_INVALID_STAGE',
      hint: 'Pass `--stage spec`, `--stage apply`, `--stage verify`, or `--stage fix`.',
    }
  );
}

/**
 * Acquire an exclusive per-change mutex lock file (`.run.lock`) to prevent concurrent orchestrators
 * from racing on the same change directory.
 *
 * @param {string} changeDirPath
 * @param {object} [opts]
 * @returns {string} lock file path
 */
export function acquireChangeMutex(changeDirPath, opts = {}) {
  const baseDir = opts.lockDir || changeDirPath;
  fs.mkdirSync(baseDir, { recursive: true });
  const lockPath = path.join(baseDir, '.run.lock');
  const staleMs = opts.staleMs ?? DEFAULT_MUTEX_STALE_MS;
  const payload = JSON.stringify({
    pid: process.pid,
    startedAt: Date.now(),
    stage: opts.stage || 'auto',
  });

  const tryCreate = () => {
    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeSync(fd, payload);
    } finally {
      fs.closeSync(fd);
    }
    return lockPath;
  };

  try {
    return tryCreate();
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let existing = null;
    try {
      existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      existing = null;
    }
    const ageMs = existing?.startedAt ? Date.now() - Number(existing.startedAt) : 0;
    if (!existing || ageMs > staleMs) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // ignore race
      }
      return tryCreate();
    }
    throw new AsdlcError(
      `Change lock already held at ${lockPath} (pid=${existing.pid}, stage=${existing.stage || 'unknown'}).`,
      {
        code: 'ASDLC_ERR_CHANGE_LOCKED',
        hint: 'Wait for the active `asdlc run` process to finish or remove stale `.run.lock`.',
      }
    );
  }
}

/**
 * Release a per-change mutex lock file created by `acquireChangeMutex`.
 *
 * @param {string|null|undefined} lockPath
 */
export function releaseChangeMutex(lockPath) {
  if (!lockPath) return;
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function readMetaFields(cdir) {
  const metaPath = path.join(cdir, '.openspec.yaml');
  if (!exists(metaPath)) return {};
  const text = readText(metaPath);
  const pick = (key) => {
    const m = text.match(new RegExp(`^\\s*${key}:\\s*['"]?([^\\s'"]+)['"]?\\s*$`, 'm'));
    return m ? m[1] : null;
  };
  return {
    status: pick('status'),
    specSha: pick('specSha'),
    targetBranch: pick('targetBranch'),
    level: pick('level'),
    workflowMode: pick('workflowMode'),
  };
}

function sanitizeResult(value, explicitSecrets = []) {
  if (typeof value === 'string') return redactSecrets(value, explicitSecrets);
  if (Array.isArray(value)) return value.map((item) => sanitizeResult(item, explicitSecrets));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeResult(v, explicitSecrets);
    }
    return out;
  }
  return value;
}

function resolvePrLabel(labels = []) {
  const normalized = (labels || []).map((l) => (typeof l === 'string' ? l : l?.name || '')).filter(Boolean);
  if (normalized.includes('asdlc:needs-clarification')) return 'needs-clarification';
  if (normalized.includes('asdlc:spec-review')) return 'spec-review';
  if (normalized.includes('asdlc:impl-review')) return 'impl-review';
  return 'none';
}

function readChangeStateInputs(repoRoot, slug, opts = {}) {
  const cdir = changeDir(repoRoot, slug);
  const cdirExists = exists(cdir);
  const meta = cdirExists ? readMetaFields(cdir) : {};
  const targetBranch = (opts.targetBranch || meta.targetBranch || resolveDefaultBranch(repoRoot)).replace(/^origin\//, '');
  const topology = opts.topology || (cdirExists
    ? resolveTopology({ repoRoot, slug, baseRef: targetBranch, cliMode: opts.mode })
    : { mode: opts.mode || 'supervised', isSinglePr: false });

  const proposalExists = cdirExists && exists(path.join(cdir, 'proposal.md'));
  const specsPath = path.join(cdir, 'specs');
  const specFiles = exists(specsPath)
    ? walkFiles(specsPath).filter((f) => f.endsWith('.md'))
    : [];
  const pSpec = proposalExists && specFiles.length > 0 ? 1 : 0;

  const clarPath = path.join(cdir, 'clarifications.md');
  let nOpen = 0;
  if (exists(clarPath)) {
    const clarText = readText(clarPath);
    nOpen = (clarText.match(/\[OPEN\]/gi) ?? []).length;
  }

  const tasksPath = path.join(cdir, 'tasks.md');
  let nTasks = 0;
  let uTasks = 0;
  if (exists(tasksPath)) {
    const tasksText = readText(tasksPath);
    const checked = (tasksText.match(/^\s*-\s+\[[xX]\]/gm) ?? []).length;
    uTasks = (tasksText.match(/^\s*-\s+\[\s\]/gm) ?? []).length;
    nTasks = checked + uTasks;
  }

  let rStage = null;
  let rVerdict = null;
  const reviewPath = path.join(cdir, 'review.md');
  if (exists(reviewPath)) {
    const revText = readText(reviewPath);
    const st = revText.match(/\bstage\s*[:=]\s*['"]?(spec|impl)['"]?/i);
    const vd = revText.match(/\bverdict\s*[:=]\s*['"]?(APPROVE|REQUEST_CHANGES)['"]?/i);
    rStage = st ? st[1].toLowerCase() : null;
    rVerdict = vd ? vd[1].toUpperCase() : null;
  }

  const pr = opts.prContext || {};
  const prLabel = pr.label || resolvePrLabel(pr.labels);
  const prState = pr.state ? String(pr.state).toUpperCase() : 'none';

  const approvedOnBranch = changeOnRef(repoRoot, targetBranch, slug)
    || changeOnRef(repoRoot, `origin/${targetBranch}`, slug)
    || Boolean(lastCommitTouching(repoRoot, targetBranch, [`openspec/changes/${slug}/proposal.md`, `openspec/changes/${slug}/specs`]));
  const isApproved = approvedOnBranch
    || String(meta.status || '').toLowerCase() === 'ready_for_impl'
    || (prLabel === 'spec-review' && prState === 'MERGED');

  const lTarget = topology.isSinglePr
    ? (pSpec === 1 ? 1 : 0)
    : (isApproved ? 1 : 0);

  const diffFiles = (git(['diff', '--name-only', `${targetBranch}...HEAD`], repoRoot, { allowFail: true }) ?? '')
    .split(/\r?\n/)
    .filter(Boolean);
  const sCode = diffFiles.filter(
    (f) => !f.startsWith(`openspec/changes/${slug}/`) && !f.startsWith('graphify-out/')
  ).length;

  return {
    artifacts: { pSpec, nOpen, nTasks, uTasks, rStage, rVerdict },
    gitLocks: { mode: topology.mode, isSinglePr: topology.isSinglePr, lTarget },
    treeDiff: { sCode, targetBranch },
    prMetadata: {
      prLabel,
      prState,
      cReplied: pr.cReplied ? 1 : (Number(pr.humanReplyCount || 0) > 0 ? 1 : 0),
      hFeedback: pr.hFeedback ? 1 : (pr.reviewDecision === 'CHANGES_REQUESTED' || Number(pr.unresolvedActionableCount || 0) > 0 ? 1 : 0),
      roundsUsed: Number(pr.roundsUsed || 0),
    },
    verifyPassed: Boolean(opts.verifyPassed),
  };
}

/**
 * Evaluate the 4-Dimension Objective State Vector <Artifacts, GitLocks, TreeDiff, PRMetadata>
 * against the 10-Phase State Matrix to derive the deterministic next pipeline phase & stage.
 *
 * @param {object} ctx
 * @returns {{ phase: string, stage: string, reason: string, exitCleanly?: boolean, circuitBroken?: boolean, vector: object }}
 */
export function evaluateStateVector(ctx = {}) {
  const artifacts = {
    pSpec: ctx.artifacts?.pSpec ?? 0,
    nOpen: ctx.artifacts?.nOpen ?? 0,
    nTasks: ctx.artifacts?.nTasks ?? 0,
    uTasks: ctx.artifacts?.uTasks ?? 0,
    rStage: ctx.artifacts?.rStage ?? null,
    rVerdict: ctx.artifacts?.rVerdict ?? null,
  };
  const gitLocks = {
    mode: ctx.gitLocks?.mode || 'supervised',
    isSinglePr: Boolean(ctx.gitLocks?.isSinglePr),
    lTarget: ctx.gitLocks?.lTarget ?? 0,
  };
  const treeDiff = {
    sCode: ctx.treeDiff?.sCode ?? 0,
    targetBranch: ctx.treeDiff?.targetBranch || 'main',
  };
  const prMetadata = {
    prLabel: ctx.prMetadata?.prLabel || 'none',
    prState: ctx.prMetadata?.prState || 'none',
    cReplied: ctx.prMetadata?.cReplied ?? 0,
    hFeedback: ctx.prMetadata?.hFeedback ?? 0,
    roundsUsed: ctx.prMetadata?.roundsUsed ?? 0,
  };
  const verifyPassed = Boolean(ctx.verifyPassed);
  const vector = { artifacts, gitLocks, treeDiff, prMetadata };

  const out = (phase, stage, reason, extra = {}) => ({ phase, stage, reason, vector, ...extra });

  // 1. PR-driven high-priority routes
  if (prMetadata.prLabel === 'needs-clarification') {
    if (prMetadata.cReplied === 1) {
      return out('SPEC_GRILL_RESUME', 'spec', 'Draft PR has human replies resolving open clarifications');
    }
    return out('SPEC_GRILL_PAUSE', 'spec', 'Draft PR awaits human clarification replies', { exitCleanly: true });
  }

  if (prMetadata.hFeedback === 1 && (prMetadata.prState === 'OPEN' || prMetadata.prState === 'DRAFT')) {
    if (prMetadata.roundsUsed >= 3) {
      return out(
        'HUMAN_ARBITRATION_REQUIRED',
        'fix',
        'Anti-thrashing circuit breaker tripped after 3 unresolved review rounds',
        { exitCleanly: true, circuitBroken: true }
      );
    }
    if (prMetadata.prLabel === 'spec-review') {
      return out('SPEC_HUMAN_REVIEW_FIX', 'fix', 'Open Spec PR has unresolved human review feedback');
    }
    return out('IMPL_HUMAN_REVIEW_FIX', 'fix', 'Open PR has unresolved human review feedback');
  }

  if (prMetadata.prLabel === 'spec-review' && prMetadata.prState === 'MERGED' && (artifacts.nTasks === 0 || artifacts.uTasks > 0)) {
    return out('APPLY_TDD', 'apply', 'Spec PR merged on target branch; ready for TDD implementation');
  }

  if (prMetadata.prLabel === 'impl-review' && prMetadata.prState === 'MERGED') {
    return out('READY_TO_ARCHIVE', 'verify', 'Implementation PR merged; ready to run `asdlc archive`', { exitCleanly: true });
  }

  // 2. Artifact + Git Lock deterministic vector progression
  if (artifacts.pSpec === 0) {
    return out('SPEC_DRAFT', 'spec', 'Specification artifacts (proposal.md / specs/**) not yet drafted');
  }

  if (artifacts.nOpen > 0) {
    if (prMetadata.cReplied === 1) {
      return out('SPEC_GRILL_RESUME', 'spec', 'Human clarification answers received; ready to settle [OPEN] items');
    }
    return out('SPEC_GRILL_PAUSE', 'spec', `${artifacts.nOpen} open clarification(s) remain`, { exitCleanly: true });
  }

  if (!gitLocks.isSinglePr && gitLocks.lTarget === 0) {
    if (
      prMetadata.prLabel === 'spec-review'
      && prMetadata.prState === 'OPEN'
      && artifacts.rStage === 'spec'
      && artifacts.rVerdict === 'APPROVE'
      && prMetadata.hFeedback === 0
    ) {
      return out('AWAITING_SPEC_MERGE', 'spec', 'Spec PR reviewed and awaiting human merge into target branch', { exitCleanly: true });
    }
    return out('SPEC_REVIEW', 'spec', 'Spec drafted with 0 [OPEN] markers; awaiting lint & Spec PR review');
  }

  if (gitLocks.lTarget === 1 && (artifacts.nTasks === 0 || artifacts.uTasks > 0)) {
    return out('APPLY_TDD', 'apply', 'Spec locked on target branch with unchecked/missing tasks');
  }

  if (gitLocks.lTarget === 1 && artifacts.nTasks > 0 && artifacts.uTasks === 0) {
    if (verifyPassed && artifacts.rStage === 'impl' && prMetadata.hFeedback === 0) {
      if (prMetadata.prLabel !== 'impl-review') {
        return out('OPEN_IMPL_PR', 'verify', 'All tasks and verification gates passed; ready to open Implementation PR');
      }
      return out('AWAITING_IMPL_MERGE', 'verify', 'Implementation PR verified and awaiting human merge', { exitCleanly: true });
    }
    return out('IMPL_REVIEW_AND_VERIFY', 'verify', 'All tasks checked; running independent impl review and verification gates');
  }

  return out('SPEC_DRAFT', 'spec', 'Default initial spec phase');
}

function parsePrReference(target) {
  if (!target) return null;
  const s = String(target).trim();
  const hashMatch = s.match(/^#(\d+)$/);
  if (hashMatch) return Number(hashMatch[1]);
  const urlMatch = s.match(/\/(?:pull|merge_requests)\/(\d+)(?:[/?#]|$)/);
  if (urlMatch) return Number(urlMatch[1]);
  return null;
}

function extractSlugFromBranchName(branchName) {
  const b = String(branchName || '').trim();
  const m = b.match(/^(?:change|spec|impl|feat|fix)\/([a-z0-9._-]+)$/i);
  return m ? toChangeSlug(m[1]) : null;
}

function listActiveChangeSlugs(repoRoot) {
  const changesRoot = path.join(openspecDir(repoRoot), 'changes');
  if (!exists(changesRoot)) return [];
  return fs.readdirSync(changesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive')
    .map((d) => d.name);
}

function extractSlugFromPrMetadata(prMeta, activeSlugs = []) {
  if (!prMeta) return null;
  const labels = (prMeta.labels || []).map((l) => (typeof l === 'string' ? l : l?.name || '')).filter(Boolean);
  for (const label of labels) {
    const m = label.match(/^asdlc:change-id:\s*(.+)$/i);
    if (m) return toChangeSlug(m[1].trim());
  }
  const fromBranch = extractSlugFromBranchName(prMeta.headRefName || prMeta.head?.ref || '');
  if (fromBranch) return fromBranch;
  for (const s of activeSlugs) {
    if (String(prMeta.title || '').toLowerCase().includes(s.toLowerCase())) {
      return s;
    }
  }
  return null;
}

function inferActiveSlug(repoRoot, opts = {}) {
  const active = listActiveChangeSlugs(repoRoot);
  if (active.length === 0) return null;

  // Priority 1: Current git branch name (`change/<slug>`, `spec/<slug>`, `impl/<slug>`, etc.)
  const headBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot, { allowFail: true });
  const branchSlug = extractSlugFromBranchName(headBranch);
  if (branchSlug && active.includes(branchSlug)) {
    return branchSlug;
  }

  // Priority 2: Single active change in workspace
  if (active.length === 1) return active[0];

  // Priority 3: Disambiguate multiple active changes via callback or fail explicitly
  if (typeof opts.changeSelector === 'function') {
    const picked = opts.changeSelector(active);
    if (picked && active.includes(picked)) return picked;
  }

  fail(`Multiple active changes found (${active.join(', ')}). Specify a change ID, e.g. \`asdlc run ${active[0]}\`.`, {
    code: 'MULTIPLE_ACTIVE_CHANGES',
    hint: `Active changes: ${active.join(', ')}`,
  });
}

function formatPauseBanner(reason, resumeCmd) {
  return `⏸️  Paused: ${reason}\n   👉 Resume command: ${resumeCmd}`;
}

function collectRepeatable(val, prev = []) {
  return [...prev, val];
}

function mergeOptsList(...lists) {
  const out = [];
  for (const list of lists) {
    if (Array.isArray(list)) out.push(...list.filter(Boolean));
    else if (list) out.push(list);
  }
  return out;
}

/**
 * Orchestrate autonomous or local-symmetrical SDLC stage execution (`spec`, `apply`, `verify`, `fix`).
 *
 * @param {string|null|undefined} target - Change ID, natural language requirement, `#N` PR number, or PR URL.
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
export async function runPipeline(target, opts = {}) {
  const explicitStage = normalizeStage(opts.stage);
  const env = opts.env || process.env;

  // Resolve remote host/repo if `--repo` is provided (enforces intranet zero-guessing policy)
  let hostRepo = null;
  if (opts.repo) {
    hostRepo = resolveGitHostAndRepo({ repo: opts.repo, host: opts.host });
  }

  const workDir = path.resolve(opts.repoRoot || opts.cwd || process.cwd());
  const lifecycleInfo = opts.repo
    ? { lifecycle: 'remote', isGitRepo: false, hasOpenspec: false }
    : detectRepoLifecycle(workDir);

  if (lifecycleInfo.lifecycle === 'greenfield' && !opts.createRepo && !opts.repo) {
    assertGitRepositoryInitialized(workDir, { repo: opts.repo, createRepo: opts.createRepo });
  }

  // Pre-Ingestion Secret Scan Guard (runs on local workspace before container/AI execution)
  if (!opts.skipSecretScan && lifecycleInfo.isGitRepo) {
    preScanWorkspaceForSecrets(workDir, { diffText: opts.diffText });
  }

  const fromFiles = mergeOptsList(opts.fromFile, opts.file);
  const fromIssues = mergeOptsList(opts.fromIssue, opts.ticket, opts.issue);
  const globalConfig = opts.globalConfig || loadGlobalConfig();
  const passthroughEnv = resolvePassthroughEnv(globalConfig, env);
  const mergedEnv = { ...passthroughEnv, ...env };

  const prNumber = parsePrReference(target);
  const repoRoot = lifecycleInfo.isGitRepo && lifecycleInfo.hasOpenspec ? workDir : (opts.repoRoot ? path.resolve(opts.repoRoot) : workDir);

  // Resolve credentials & agent harness config when container or dry-run planning is requested
  const creds = await resolveGitCredentials({ env: mergedEnv, globalConfig, host: hostRepo?.host, fetchFn: opts.fetchFn });
  const authSource = creds?.type || 'none';
  const explicitSecrets = creds?.token ? [creds.token] : [];
  if (globalConfig?.agent?.api_key) explicitSecrets.push(globalConfig.agent.api_key);
  if (mergedEnv?.JIRA_API_TOKEN) explicitSecrets.push(mergedEnv.JIRA_API_TOKEN);

  const harness = resolveAgentHarnessConfig({
    globalConfig,
    cliModel: opts.model,
    cliReviewModel: opts.reviewModel,
    env: mergedEnv,
  });

  // Determine target change slug if possible (active branch, single change, selector, PR metadata, issue ID)
  let slug = null;
  if (!prNumber && target) {
    const candidate = toChangeSlug(target);
    if (exists(changeDir(repoRoot, candidate))) {
      slug = candidate;
    } else if (fromIssues.length && lifecycleInfo.hasOpenspec) {
      slug = findChangeByIssueId(repoRoot, fromIssues[0]) || null;
    }
  } else if (prNumber) {
    const activeSlugs = lifecycleInfo.hasOpenspec ? listActiveChangeSlugs(repoRoot) : [];
    let prMeta = opts.prContext || null;
    if (!prMeta && typeof opts.prMetadataResolver === 'function') {
      prMeta = await opts.prMetadataResolver(prNumber, { repo: opts.repo, host: opts.host, env: mergedEnv });
    } else if (!prMeta && lifecycleInfo.isGitRepo) {
      try {
        const ghRes = spawnSync('gh', ['pr', 'view', String(prNumber), '--json', 'number,title,headRefName,labels,state'], {
          cwd: repoRoot,
          encoding: 'utf8',
          env: mergedEnv,
          timeout: 8000,
        });
        if (ghRes.status === 0 && ghRes.stdout) {
          prMeta = JSON.parse(ghRes.stdout);
        }
      } catch {
        // offline fallback
      }
    }
    slug = (prMeta?.changeId ? toChangeSlug(prMeta.changeId) : null)
      || extractSlugFromPrMetadata(prMeta, activeSlugs);
    if (!slug && !opts.dryRun && explicitStage !== 'spec') {
      fail(`Could not resolve active change associated with PR #${prNumber}.`, {
        code: 'ASDLC_ERR_PR_NOT_FOUND',
        hint: `Ensure PR #${prNumber} has label 'asdlc:change-id: <slug>' or branch 'spec/<slug>' / 'impl/<slug>'.`,
      });
    }
  } else if (opts.prContext?.changeId) {
    slug = toChangeSlug(opts.prContext.changeId);
  } else if (fromIssues.length && lifecycleInfo.hasOpenspec) {
    slug = findChangeByIssueId(repoRoot, fromIssues[0]) || null;
  } else if (!target && lifecycleInfo.hasOpenspec) {
    slug = inferActiveSlug(repoRoot, { changeSelector: opts.changeSelector });
  }

  let vectorResult = null;
  if (slug && lifecycleInfo.isGitRepo && lifecycleInfo.hasOpenspec) {
    const inputs = readChangeStateInputs(repoRoot, slug, opts);
    vectorResult = evaluateStateVector(inputs);
  } else if (opts.prContext) {
    vectorResult = evaluateStateVector({
      artifacts: opts.prContext.artifacts,
      gitLocks: opts.prContext.gitLocks,
      treeDiff: opts.prContext.treeDiff,
      prMetadata: {
        prLabel: resolvePrLabel(opts.prContext.labels),
        prState: opts.prContext.state || 'OPEN',
        cReplied: opts.prContext.cReplied ? 1 : 0,
        hFeedback: opts.prContext.hFeedback ? 1 : 0,
        roundsUsed: Number(opts.prContext.roundsUsed || 0),
      },
      verifyPassed: opts.verifyPassed,
    });
  } else {
    vectorResult = evaluateStateVector({});
  }

  const selectedStage = explicitStage || vectorResult.stage;

  if (!explicitStage && !opts.json) {
    log.info(`No --stage specified. Auto-selected stage: '${selectedStage}' (${vectorResult.phase}).`);
    log.info(dim(`You can run this stage explicitly: asdlc run ${target || slug || '<target>'} --stage ${selectedStage}`));
  }

  const isContainerRun = Boolean(opts.container || opts.engine);

  // Container dry-run mode returns the hardened execution plan without running Docker / Podman
  if (isContainerRun && opts.dryRun) {
    let resolvedEngine = 'docker';
    try {
      resolvedEngine = resolveContainerEngine(opts, spawnSync);
    } catch {
      resolvedEngine = opts.engine || 'docker';
    }
    const containerArgs = buildContainerCreateArgs({
      engine: resolvedEngine,
      image: opts.image,
      hostEnv: mergedEnv,
      caCertHostPath: opts.caCertHostPath,
      sshAuthSock: opts.sshAuthSock,
      sshAgent: Boolean(globalConfig?.git?.ssh_agent || opts.sshAgent),
      sshKeyPath: opts.sshKeyPath || globalConfig?.git?.ssh_key_path,
      env: {
        ...passthroughEnv,
        ASDLC_LIFECYCLE: lifecycleInfo.lifecycle,
        ASDLC_STAGE: selectedStage,
        ASDLC_AUTH_SOURCE: authSource,
        ...(harness.model ? { ASDLC_MODEL: harness.model } : {}),
        ...(harness.reviewModel ? { ASDLC_REVIEW_MODEL: harness.reviewModel } : {}),
      },
      cmd: ['asdlc', 'run', ...(target ? [String(target)] : []), '--stage', selectedStage],
    });
    const plan = sanitizeResult({
      dryRun: true,
      container: true,
      engine: resolvedEngine,
      lifecycle: lifecycleInfo.lifecycle,
      hostRepo,
      slug,
      prNumber,
      selectedStage,
      phase: vectorResult.phase,
      stateVector: vectorResult.vector,
      authSource,
      passthroughKeys: Object.keys(passthroughEnv),
      harnessConfig: {
        configSource: harness.configSource,
        model: harness.model,
        reviewModel: harness.reviewModel,
      },
      containerArgs,
      dockerArgs: containerArgs, // Backwards-compatible alias
    }, explicitSecrets);
    if (opts.json) jsonOut(plan);
    return plan;
  }

  // Full Container Execution Mode
  if (isContainerRun && !opts.dryRun) {
    log.step(`Launching container pipeline (${opts.image || DEFAULT_RUNNER_IMAGE})...`);
    const containerResult = await runContainerPipeline(target, {
      ...opts,
      engine: opts.engine,
      slug,
      prNumber,
      stage: selectedStage,
      repoRoot,
      env: mergedEnv,
      harness,
      creds,
      sshAuthSock: opts.sshAuthSock,
      sshAgent: Boolean(globalConfig?.git?.ssh_agent || opts.sshAgent),
      sshKeyPath: opts.sshKeyPath || globalConfig?.git?.ssh_key_path,
    });
    const safeContainerResult = sanitizeResult({
      container: true,
      slug,
      prNumber,
      stage: selectedStage,
      ...containerResult,
    }, explicitSecrets);
    if (opts.json) jsonOut(safeContainerResult);
    return safeContainerResult;
  }

  // Zero-flag context inference: determine if AI agent execution is mandatory
  // When opts.ci is explicitly false, it suppresses CI autodetection (e.g. running in local test harnesses under CI runners)
  const isCiExplicitFalse = opts.ci === false;
  const isCiEnv = !isCiExplicitFalse && Boolean(opts.ci || mergedEnv?.CI === 'true' || mergedEnv?.GITHUB_ACTIONS === 'true');
  const isContainerEnv = Boolean(isContainerRun || mergedEnv?.ASDLC_CONTAINER === '1' || mergedEnv?.ASDLC_IN_CONTAINER === '1');
  const hasExplicitModelOverride = Boolean(opts.model || opts.reviewModel || opts.agentConfig);
  const isMandatoryAgentEnv = Boolean(isContainerEnv || isCiEnv || hasExplicitModelOverride || opts.autonomous);

  const harnessBin = harness.harness;
  const whichFn = typeof opts.whichCommand === 'function' ? opts.whichCommand : whichCommand;
  const resolvedHarnessBin = whichFn(harnessBin);
  const hasHarnessCli = Boolean(resolvedHarnessBin);

  const runDefaultAgent = async ({ prompt, model, type = 'author' }) => {
    if (!hasHarnessCli) return null;
    if (typeof opts.agentRunner === 'function') {
      return opts.agentRunner({ harness: harnessBin, prompt, model, type, repoRoot, env: mergedEnv });
    }
    const buildArgs = type === 'reviewer' ? harness.buildReviewerArgs : harness.buildAuthorArgs;
    const args = buildArgs(prompt, model);
    try {
      const isWin = process.platform === 'win32';
      const cmdToRun = isWin && (resolvedHarnessBin.endsWith('.cmd') || resolvedHarnessBin.endsWith('.bat'))
        ? resolvedHarnessBin
        : harnessBin;
      const res = spawnSync(cmdToRun, args, { cwd: repoRoot, stdio: opts.stdio || 'inherit', env: mergedEnv, shell: isWin });
      return { ok: res && res.status === 0, status: res && res.status === 0 ? 'completed' : 'failed', exitCode: res?.status };
    } catch (err) {
      return { ok: false, status: 'error', error: err.message };
    }
  };

  // Ensure slug exists or can be scaffolded for `--stage spec`
  if (!slug && selectedStage === 'spec') {
    if (!target && !fromFiles.length && !fromIssues.length) {
      fail('Cannot start `spec` stage without a requirement, change ID, `--from-file`, or `--from-issue`/`--ticket`.');
    }
    slug = newChange(target || null, {
      repoRoot,
      fromFile: fromFiles,
      fromIssue: fromIssues,
      grill: false,
      openspec: opts.openspec ?? false,
      mode: opts.mode,
      targetBranch: opts.targetBranch,
      issueFetcher: opts.issueFetcher,
      ghRunner: opts.ghRunner,
      httpFetcher: opts.httpFetcher,
      env: mergedEnv,
      globalConfig,
    });
  }

  const cdir = slug ? changeDir(repoRoot, slug) : null;
  let lockPath = null;
  if (cdir && exists(cdir)) {
    lockPath = acquireChangeMutex(cdir, { stage: selectedStage, staleMs: opts.staleMs });
  }

  try {
    let result;
    const targetBranch = (opts.targetBranch || vectorResult.vector.treeDiff.targetBranch || 'main').replace(/^origin\//, '');

    if (selectedStage === 'spec') {
      const clarPath = cdir ? path.join(cdir, 'clarifications.md') : null;
      const openFound = clarPath && exists(clarPath) && hasUnresolvedClarifications(readText(clarPath));

      if (openFound) {
        const hasReplies = Boolean(opts.prContext?.cReplied || opts.prContext?.comments?.length);
        if (hasReplies && typeof opts.onResumeClarifications === 'function') {
          await opts.onResumeClarifications({ slug, cdir, prContext: opts.prContext });
        } else {
          let prInfo = null;
          if (!opts.skipPr) {
            if (typeof opts.createDraftPr === 'function') {
              prInfo = await opts.createDraftPr({ slug, targetBranch, label: 'asdlc:needs-clarification' });
            } else if (lifecycleInfo.isGitRepo) {
              prInfo = await createPR(slug, targetBranch, {
                repoRoot,
                mode: opts.mode,
                env: mergedEnv,
                fetchFn: opts.fetchFn,
                draft: true,
                skipPush: opts.skipPush,
                skipCliPr: opts.skipCliPr,
                skipOpenspec: opts.skipOpenspec,
                skipExternal: opts.skipExternal,
              });
            }
          }
          const prNumLabel = prInfo?.number ? `#${prInfo.number}` : slug;
          const resumeCmd = `asdlc run ${prNumLabel}${opts.container ? ' --container' : ''}`;
          const pauseBanner = formatPauseBanner(
            `Awaiting human replies on Draft Spec PR ${prNumLabel} for '${slug}' ([OPEN] clarifications remain).`,
            resumeCmd
          );
          if (!opts.json) log.info(pauseBanner);
          result = {
            slug,
            stage: 'spec',
            phase: hasReplies ? 'SPEC_GRILL_RESUME' : 'SPEC_GRILL_PAUSE',
            paused: !hasReplies,
            prLabel: 'asdlc:needs-clarification',
            pauseBanner,
            exitCode: 0,
            pr: prInfo,
          };
          if (opts.json) jsonOut(sanitizeResult(result, explicitSecrets));
          return result;
        }
      }

      const lintExitCode = runLint(slug, { repoRoot });
      const lintResult = { pass: lintExitCode === 0, exitCode: lintExitCode };
      if (!lintResult.pass) {
        fail(`Spec lint failed for '${slug}'. Fix blocking findings before opening Spec PR.`);
      }
      let reviewResult = null;
      if (typeof opts.specReviewer === 'function') {
        reviewResult = await opts.specReviewer({ slug, cdir, repoRoot, reviewModel: harness.reviewModel });
      } else if (hasHarnessCli) {
        log.step(`Running spec review via ${harnessBin}...`);
        const prompt = `Review specification for change ${slug} in ${cdir}. Validate BDD acceptance criteria.`;
        const res = await runDefaultAgent({ prompt, model: harness.reviewModel, type: 'reviewer' });
        reviewResult = { status: res?.ok ? 'passed' : 'failed', summary: `Spec review via ${harnessBin}` };
      } else if (isMandatoryAgentEnv) {
        fail('Autonomous/CI spec stage requires an AI review agent harness.', {
          code: 'ASDLC_ERR_AGENT_UNAVAILABLE',
          hint: `Ensure '${harnessBin}' is installed and accessible in PATH.`,
        });
      } else {
        if (!opts.json) log.info(`[INFO] Local AI CLI (${harnessBin}) not found in PATH; executed deterministic gates only.`);
        reviewResult = { status: 'skipped', summary: `Local AI CLI (${harnessBin}) not found in PATH; executed deterministic gates only (human review on PR)` };
      }
      let prResult = null;
      if (!opts.skipPr) {
        prResult = await createPR(slug, targetBranch, {
          repoRoot,
          mode: opts.mode,
          env,
          fetchFn: opts.fetchFn,
          skipPush: opts.skipPush,
          skipCliPr: opts.skipCliPr,
          skipOpenspec: opts.skipOpenspec,
          skipExternal: opts.skipExternal,
          draft: opts.draft,
        });
      }
      result = {
        slug,
        stage: 'spec',
        phase: 'SPEC_REVIEW',
        lint: lintResult,
        review: reviewResult,
        pr: prResult,
        exitCode: 0,
      };
    } else if (selectedStage === 'apply') {
      if (!slug || !cdir || !exists(cdir)) {
        fail(`Change '${slug || target}' not found for 'apply' stage.`);
      }
      const guard = applyGuard(slug, { repoRoot, targetBranch, mode: opts.mode });
      const lockedSpecPaths = lockSpecsReadOnly(cdir);
      let implOutput = null;
      if (typeof opts.implExecutor === 'function') {
        implOutput = await opts.implExecutor({ slug, cdir, repoRoot, lockedSpecPaths, model: harness.model });
      } else if (hasHarnessCli) {
        log.step(`Running implementation via ${harnessBin}...`);
        const prompt = `Implement change ${slug} following TDD workflow in ${cdir}/tasks.md without modifying locked spec files.`;
        const res = await runDefaultAgent({ prompt, model: harness.model, type: 'author' });
        implOutput = { status: res?.ok ? 'implemented' : 'failed', summary: `Implementation via ${harnessBin}` };
      } else if (isMandatoryAgentEnv) {
        fail('Autonomous/CI apply stage requires an AI implementation agent.', {
          code: 'ASDLC_ERR_AGENT_UNAVAILABLE',
          hint: `Ensure '${harnessBin}' is installed and accessible in PATH to run TDD implementation.`,
        });
      } else {
        if (!opts.json) log.info(`[INFO] Local AI CLI (${harnessBin}) not found in PATH; executed deterministic gates only.`);
        implOutput = { status: 'waiting_for_implementation', message: 'Spec locked 0444 read-only. Implement tasks in tasks.md, then run asdlc verify.' };
      }
      result = {
        slug,
        stage: 'apply',
        phase: 'APPLY_TDD',
        guard,
        lockedSpecPaths,
        implOutput,
        exitCode: 0,
      };
    } else if (selectedStage === 'verify') {
      if (!slug || !cdir || !exists(cdir)) {
        fail(`Change '${slug || target}' not found for 'verify' stage.`);
      }
      let implReview = null;
      if (typeof opts.implReviewer === 'function') {
        implReview = await opts.implReviewer({ slug, cdir, repoRoot, reviewModel: harness.reviewModel });
      } else if (hasHarnessCli) {
        log.step(`Running implementation review via ${harnessBin}...`);
        const prompt = `Review implementation for change ${slug} in ${repoRoot}. Verify against approved spec in ${cdir}.`;
        const res = await runDefaultAgent({ prompt, model: harness.reviewModel, type: 'reviewer' });
        implReview = { status: res?.ok ? 'passed' : 'failed', summary: `Implementation review via ${harnessBin}` };
      } else if (isMandatoryAgentEnv) {
        fail('Autonomous/CI verify stage requires an independent AI reviewer.', {
          code: 'ASDLC_ERR_AGENT_UNAVAILABLE',
          hint: `Ensure '${harnessBin}' is installed and accessible in PATH.`,
        });
      } else {
        if (!opts.json) log.info(`[INFO] Local AI CLI (${harnessBin}) not found in PATH; executed deterministic gates only.`);
        implReview = { status: 'skipped', summary: `Local AI CLI (${harnessBin}) not found in PATH; independent AI reviewer not configured` };
      }
      const verifyExitCode = runVerify(slug, {
        repoRoot,
        protectedBranch: targetBranch,
        base: targetBranch,
        mode: opts.mode,
        ci: opts.ci,
        approved: opts.approved,
        skipOpenspec: opts.skipOpenspec,
        skipExternal: opts.skipExternal,
      });
      const verifyResult = { pass: verifyExitCode === 0, exitCode: verifyExitCode };
      let prResult = null;
      if (!opts.skipPr && verifyResult.pass) {
        prResult = await createPR(slug, targetBranch, {
          repoRoot,
          mode: opts.mode,
          env,
          fetchFn: opts.fetchFn,
          skipPush: opts.skipPush,
          skipCliPr: opts.skipCliPr,
          skipOpenspec: opts.skipOpenspec,
          skipExternal: opts.skipExternal,
        });
      }
      result = {
        slug,
        stage: 'verify',
        phase: verifyResult.pass ? 'OPEN_IMPL_PR' : 'IMPL_REVIEW_AND_VERIFY',
        review: implReview,
        verify: verifyResult,
        pr: prResult,
        exitCode: verifyResult.pass ? 0 : 1,
      };
    } else if (selectedStage === 'fix') {
      const prCtx = typeof opts.fetchPrContext === 'function'
        ? await opts.fetchPrContext({ prNumber, slug, target })
        : (opts.prContext || (prNumber ? await fetchGitHubPrReviewContext(prNumber, { repoRoot, repo: opts.repo, host: opts.host, env: mergedEnv, fetchFn: opts.fetchFn }) : {}));
      const rawThreads = prCtx.reviewThreads || prCtx.threads || [];
      const currentRound = Number(
        prCtx.currentRound
          ?? (prCtx.roundsUsed !== undefined
            ? Number(prCtx.roundsUsed) + 1
            : (opts.roundsUsed !== undefined ? Number(opts.roundsUsed) + 1 : 1))
      );
      const cb = checkAntiThrashingCircuitBreaker({
        currentRound,
        maxRounds: 3,
        unresolvedThreads: rawThreads,
        changeId: slug || 'unknown',
        prNumber,
      });

      if (cb.tripped) {
        result = {
          slug,
          prNumber,
          stage: 'fix',
          phase: 'HUMAN_ARBITRATION_REQUIRED',
          circuitBroken: true,
          escalationLabel: cb.label || 'asdlc:needs-human-arbitration',
          synthesisReport: cb.synthesisReport,
          exitCode: cb.exitCode ?? 2,
        };
        if (opts.json) jsonOut(sanitizeResult(result, explicitSecrets));
        return result;
      }

      const triage = triagePullRequest({
        reviewThreads: rawThreads,
        issueComments: prCtx.issueComments || prCtx.topLevelComments || [],
        reviewDecision: prCtx.reviewDecision || null,
        commitMessages: prCtx.commitMessages || [],
        agentLogins: prCtx.agentLogins || prCtx.botLogins || [],
      });
      // §6.3.4: Category C questions must NEVER be resolved automatically
      const actionablePlan = [
        ...triage.actionableThreads,
        ...triage.suggestionThreads,
      ].map((t) => buildThreadResolutionPlan(t, { commitSha: opts.commitSha }));

      let fixOutput = null;
      if (typeof opts.fixExecutor === 'function') {
        fixOutput = await opts.fixExecutor({ slug, prNumber, triage, plan: actionablePlan, repoRoot });
      } else if (hasHarnessCli && actionablePlan.length > 0) {
        log.step(`Running review comment fixes via ${harnessBin}...`);
        const prompt = `Address review feedback on PR #${prNumber}: ${actionablePlan.map((p) => p.commentBody).filter(Boolean).join('; ')}`;
        const agentRes = await runDefaultAgent({ prompt, model: harness.model, type: 'author' });
        fixOutput = { status: agentRes?.ok ? 'completed' : 'failed', ok: agentRes?.ok };
      } else if (isMandatoryAgentEnv && actionablePlan.length > 0) {
        fail('Autonomous/CI fix stage requires an AI implementation agent.', {
          code: 'ASDLC_ERR_AGENT_UNAVAILABLE',
          hint: `Ensure '${harnessBin}' is installed and accessible in PATH to address review comments.`,
        });
      } else if (actionablePlan.length > 0) {
        if (!opts.json) log.info(`[INFO] Local AI CLI (${harnessBin}) not found in PATH; review comments left for manual resolution.`);
      }

      // Threads may ONLY be resolved after a verified fix commit exists
      const effectiveCommitSha = fixOutput?.commitSha || opts.commitSha;
      const resolvedThreads = [];
      if (effectiveCommitSha && fixOutput?.ok !== false && !opts.skipThreadResolution) {
        for (const item of actionablePlan) {
          if (item.threadId) {
            const replyMsg = item.commitMessage
              ? `Applied suggestion in commit ${effectiveCommitSha.slice(0, 8)}:\n${item.commitMessage}`
              : `Resolved in commit ${effectiveCommitSha.slice(0, 8)}.`;
            const res = await replyAndResolveGitHubThread(item.threadId, replyMsg, {
              repoRoot,
              repo: opts.repo,
              host: opts.host,
              env: mergedEnv,
              fetchFn: opts.fetchFn,
            });
            resolvedThreads.push(res);
          }
        }
      }

      result = {
        slug,
        prNumber,
        stage: 'fix',
        phase: vectorResult.phase === 'SPEC_HUMAN_REVIEW_FIX' ? 'SPEC_HUMAN_REVIEW_FIX' : 'IMPL_HUMAN_REVIEW_FIX',
        triage,
        resolutionPlan: actionablePlan,
        unresolvedQuestions: triage.questionThreads.length,
        fixOutput: fixOutput || {
          status: 'plan_generated',
          resolvedCount: resolvedThreads.length,
          reason: effectiveCommitSha ? 'Fix processed' : 'No fix commit executed; review threads remain open for agent/author',
        },
        resolvedThreads,
        exitCode: 0,
      };
    }

    const safeResult = sanitizeResult(result, explicitSecrets);
    if (opts.json) jsonOut(safeResult);
    return safeResult;
  } finally {
    releaseChangeMutex(lockPath);
  }
}

export function register(program) {
  program
    .command('run [target]')
    .description('orchestrate autonomous or stage-driven SDLC pipeline (spec | apply | verify | fix)')
    .option('--stage <stage>', 'explicit canonical stage: spec, apply, verify, or fix')
    .option('--repo <repo>', 'target repository (owner/repo or canonical full git URL for intranet/zero-checkout)')
    .option('--create-repo <repo>', 'provision a new remote repository in greenfield mode')
    .option('--host <host>', 'explicit git host when disambiguating enterprise hosts')
    .option('--from-file <path>', 'attach local requirement/PRD file snapshot (repeatable)', collectRepeatable, [])
    .option('--file <path>', 'alias for --from-file (repeatable)', collectRepeatable, [])
    .option('--from-issue <id>', 'attach external issue reference snapshot (repeatable)', collectRepeatable, [])
    .option('--ticket <id>', 'alias for --from-issue (repeatable)', collectRepeatable, [])
    .option('--issue <id>', 'alias for --from-issue (repeatable)', collectRepeatable, [])
    .option('--container', 'run in isolated hardened UID 10001:10001 container runtime')
    .option('--engine <engine>', 'container engine to use: docker | podman (default: auto)')
    .option('--dry-run', 'print deterministic execution & security plan without executing')
    .option('--mode <mode>', 'override workflow mode: spec-first | supervised | auto')
    .option('--target-branch <branch>', 'target protected branch (defaults to repo default)')
    .option('--agent-config <path>', 'enterprise opencode.json template path')
    .option('-m, --model <model>', 'override author AI model')
    .option('--review-model <model>', 'override independent reviewer AI model (Player != Referee)')
    .option('--json', 'emit redacted structured JSON output')
    .action(async (target, opts) => {
      const res = await runPipeline(target, opts);
      if (res && typeof res.exitCode === 'number' && res.exitCode !== 0) {
        process.exitCode = res.exitCode;
      }
    });

  // First-class local CLI symmetry for addressing PR review feedback (Tier 1-3 triage)
  program
    .command('fix [target]')
    .alias('review-comments')
    .description('address PR review comments with Tier 1-3 triage & anti-thrashing circuit breaker')
    .option('--repo <repo>', 'target repository (owner/repo or canonical git URL)')
    .option('--host <host>', 'explicit git host when disambiguating enterprise hosts')
    .option('--mode <mode>', 'override workflow mode: spec-first | supervised | auto')
    .option('--target-branch <branch>', 'target protected branch (defaults to repo default)')
    .option('-m, --model <model>', 'override author AI model')
    .option('--json', 'emit redacted structured JSON output')
    .option('--repo-root <path>')
    .action(async (target, opts) => {
      const res = await runPipeline(target, { ...opts, stage: 'fix' });
      if (res && typeof res.exitCode === 'number' && res.exitCode !== 0) {
        process.exitCode = res.exitCode;
      }
    });
}
