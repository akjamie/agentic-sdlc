import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Option } from 'commander';
import { exists, readText, writeText } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug, requireAgentRuntime } from '../lib/cliutil.js';
import { lastCommitTouching, git, resolveDefaultBranch } from '../lib/git.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { isSinglePrLevel, readEffectiveLevel } from '../lib/level.js';
import { resolveWorkflowMode } from '../lib/config.js';
import { assess } from '../assess/index.js';
import { triagePullRequest, PULL_REQUEST_THREADS_QUERY } from '../lib/triage.js';
import { recordEvent } from '../lib/telemetry.js';

// Guard before implementing: the spec must be APPROVED on the target branch
// (i.e. the Spec PR has been merged into targetBranch, locking proposal.md & specs/**).
export function applyGuard(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  const slug = toChangeSlug(changeId);
  const cdir = changeDir(repoRoot, slug);
  if (!exists(cdir)) fail(`change '${slug}' not found`);

  const metaPath = path.join(cdir, '.openspec.yaml');
  let meta = {};
  if (exists(metaPath)) {
    const text = readText(metaPath);
    const sha = text.match(/^\s*specSha:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const status = text.match(/^\s*status:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const tb = text.match(/^\s*targetBranch:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const apr = text.match(/^\s*autoPr:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const lvl = text.match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    const wm = text.match(/^\s*workflowMode:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    meta = {
      specSha: sha ? sha[1] : null,
      status: status ? status[1] : null,
      targetBranch: tb ? tb[1] : null,
      autoPr: apr ? apr[1] : null,
      level: lvl ? lvl[1].toUpperCase() : null,
      workflowMode: wm ? wm[1].toLowerCase() : null,
    };
  }

  const branch = opts.targetBranch
    ?? opts.protectedBranch
    ?? meta.targetBranch
    ?? resolveDefaultBranch(repoRoot);

  const resolvedMode = resolveWorkflowMode({ cliMode: opts.mode, repoRoot, baseRef: branch });
  const locked = [`openspec/changes/${slug}/proposal.md`, `openspec/changes/${slug}/specs`];

  const levelInfo = readEffectiveLevel(repoRoot, slug, { baseRef: branch });
  if (levelInfo?.tampered) {
    fail(`cannot apply '${slug}': declared level in .openspec.yaml (${levelInfo.declaredLevel}) is lower than recorded history (${levelInfo.maxHistoryLevel}). Manual level downgrading is strictly forbidden.`, {
      code: 'LEVEL_TAMPERED',
      hint: 'Revert unauthorized level edits in .openspec.yaml or raise a system rule fix.'
    });
  }

  let effectiveLevel = levelInfo?.effectiveLevel || meta.level || null;
  const agentAssessPath = path.join(cdir, '.agent-assess.json');
  if (meta.level && (exists(agentAssessPath) || levelInfo?.maxHistoryLevel)) {
    const assessment = assess({
      stage: 'spec',
      changeId: slug,
      repoRoot,
      mode: resolvedMode,
      persist: true
    });
    const assessedLevel = assessment.risk.level;
    const rank = { L0: 0, L1: 1, L2: 2, L3: 3 };
    if ((rank[assessedLevel] ?? 0) > (rank[effectiveLevel] ?? 0)) {
      effectiveLevel = assessedLevel;
      if (exists(metaPath)) {
        let metaText = readText(metaPath);
        const upsertKey = (text, key, val) => {
          const re = new RegExp(`^\\s*${key}:\\s*.*$`, 'm');
          return re.test(text) ? text.replace(re, `${key}: "${val}"`) : `${text.trimEnd()}\n${key}: "${val}"\n`;
        };
        metaText = upsertKey(metaText, 'level', effectiveLevel);
        metaText = upsertKey(metaText, 'workflowMode', assessment.governance.workflow_mode);
        writeText(metaPath, metaText);
      }
    }
  }

  const isSinglePr = isSinglePrLevel(effectiveLevel) && resolvedMode !== 'spec-first' && meta.workflowMode !== 'spec-first';
  let approvedSha = null;

  if (isSinglePr) {
    // For L0 / L1, Single PR mode allows direct local implementation.
    // Transition to ready_for_impl automatically if drafting.
    if (meta.status !== 'ready_for_impl' && exists(metaPath)) {
      let metaText = readText(metaPath);
      const upsertKey = (text, key, val) => {
        const re = new RegExp(`^\\s*${key}:\\s*.*$`, 'm');
        return re.test(text) ? text.replace(re, `${key}: "${val}"`) : `${text.trimEnd()}\n${key}: "${val}"\n`;
      };
      metaText = upsertKey(metaText, 'status', 'ready_for_impl');
      writeText(metaPath, metaText);
      log.ok(`${slug}: marked status=ready_for_impl (no separate Spec PR in Single-PR mode; human sign-off happens on the final PR)`);
    }
    log.ok(`${slug}: governance level is ${effectiveLevel} (Single PR mode: direct local implementation permitted)`);
  } else {
    // L2 / L3 Two-phase Spec-first flow
    // 2. Multi-tenant path-isolated approval detection
    // Query ONLY commits touching this change's own directory on target branch
    approvedSha = lastCommitTouching(repoRoot, branch, locked);

    if (!approvedSha) {
      fail(`'${slug}' is not approved yet (no Spec PR for this change merged into ${branch})`, {
        code: 'NOT_APPROVED',
        hint: `open a Spec PR via \`asdlc pr ${changeId} ${branch}\` and merge it before implementing`,
      });
    }

    // 3. Local working tree tamper check: locked paths must not have uncommitted edits
    const dirty = (git(['status', '--porcelain', '--', ...locked], repoRoot, { allowFail: true }) ?? '').trim();
    if (dirty) {
      fail(`cannot apply '${slug}': locked spec paths have uncommitted local modifications:\n${dirty}`, {
        code: 'SPEC_DIRTY',
        hint: 'commit or stash your spec modifications before proceeding with implementation',
      });
    }

    // 4. Content-level Git-anchored zero-diff invariant:
    // The local spec content MUST match the approved version on the target branch
    const diff = (git(['diff', approvedSha, '--', ...locked], repoRoot, { allowFail: true }) ?? '').trim();
    if (diff) {
      fail(`'${slug}' spec differs from the approved version on ${branch} (${approvedSha.slice(0, 8)}):\n${diff.slice(0, 300)}`, {
        code: 'SPEC_DIFFERS_FROM_APPROVED',
        hint: `spec was modified after approval. Merge latest ${branch} or revert unauthorized spec changes.`,
      });
    }

    // 5. Automatic state transition: PR Merge is the single source of truth for approval!
    // If the spec is physically merged on the target branch with 0 diff, automatically transition to ready_for_impl
    if (meta.status !== 'ready_for_impl' || meta.specSha !== approvedSha) {
      if (exists(metaPath)) {
        let metaText = readText(metaPath);
        const upsertKey = (text, key, val) => {
          const re = new RegExp(`^\\s*${key}:\\s*.*$`, 'm');
          return re.test(text) ? text.replace(re, `${key}: "${val}"`) : `${text.trimEnd()}\n${key}: "${val}"\n`;
        };
        metaText = upsertKey(metaText, 'specSha', approvedSha);
        metaText = upsertKey(metaText, 'status', 'ready_for_impl');
        if (effectiveLevel && effectiveLevel !== meta.level) {
          metaText = upsertKey(metaText, 'level', effectiveLevel);
          metaText = upsertKey(metaText, 'workflowMode', 'spec-first');
        }
        writeText(metaPath, metaText);
      }
      log.ok(`${slug}: recognized PR approval on ${branch} (synced state to ready_for_impl @ ${approvedSha.slice(0, 8)})`);
    }
  }

  // 6. Explicit Auto-PR Delegation Handling
  if (opts.autoPr !== undefined && exists(metaPath)) {
    let metaText = readText(metaPath);
    const upsertKey = (text, key, val) => {
      const re = new RegExp(`^\\s*${key}:\\s*.*$`, 'm');
      return re.test(text) ? text.replace(re, `${key}: ${val}`) : `${text.trimEnd()}\n${key}: ${val}\n`;
    };
    metaText = upsertKey(metaText, 'autoPr', opts.autoPr ? 'true' : 'false');
    writeText(metaPath, metaText);
  }

  if (opts.targetBranch && exists(metaPath)) {
    let metaText = readText(metaPath);
    const upsertKey = (text, key, val) => {
      const re = new RegExp(`^\\s*${key}:\\s*.*$`, 'm');
      return re.test(text) ? text.replace(re, `${key}: "${val}"`) : `${text.trimEnd()}\n${key}: "${val}"\n`;
    };
    metaText = upsertKey(metaText, 'targetBranch', opts.targetBranch);
    writeText(metaPath, metaText);
  }

  // 7. Tasks checklist presence
  const tasksPath = path.join(cdir, 'tasks.md');
  if (!exists(tasksPath)) {
    fail(`'${slug}' missing tasks.md`, {
      code: 'TASKS_MISSING',
      hint: 'author tasks.md with TDD verification tasks before running apply',
    });
  }

  const isAutoPr = opts.autoPr === true || (opts.autoPr === undefined && meta.autoPr === 'true');
  const shaDisplay = approvedSha ? ` (specSha: ${approvedSha.slice(0, 8)}, state: ready_for_impl)` : ` (state: ready_for_impl)`;
  log.ok(`${slug} is READY FOR IMPLEMENTATION on ${branch}${shaDisplay}`);

  if (opts.fromPr) {
    const prRef = String(opts.fromPr).replace(/^#/, '');
    const prNum = Number(prRef);
    let prCtx = opts.prContext || null;
    if (!prCtx) {
      let reviewThreads = [];
      let reviewDecision = null;
      const remoteUrl = git(['remote', 'get-url', 'origin'], repoRoot, { allowFail: true }) || '';
      const repoMatch = remoteUrl.match(/[:/]([^/:\s]+)\/([^/:\s]+?)(?:\.git)?$/);
      if (repoMatch && Number.isFinite(prNum) && prNum > 0) {
        const gql = spawnSync('gh', [
          'api', 'graphql',
          '-F', `owner=${repoMatch[1]}`,
          '-F', `repo=${repoMatch[2]}`,
          '-F', `number=${prNum}`,
          '-f', `query=${PULL_REQUEST_THREADS_QUERY}`,
        ], { cwd: repoRoot, encoding: 'utf8', timeout: 8000 });
        if (gql.status === 0 && gql.stdout) {
          try {
            const parsedGql = JSON.parse(gql.stdout);
            const prNode = parsedGql?.data?.repository?.pullRequest;
            reviewThreads = prNode?.reviewThreads?.nodes || [];
            reviewDecision = prNode?.reviewDecision || null;
          } catch {
            // fallback to view
          }
        }
      }
      const gh = spawnSync('gh', ['pr', 'view', prRef, '--json', 'comments,reviews,reviewDecision'], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 8000,
      });
      if (gh.status === 0 && gh.stdout) {
        try {
          const parsed = JSON.parse(gh.stdout);
          prCtx = {
            reviewThreads,
            issueComments: parsed.comments || [],
            reviewDecision: reviewDecision || parsed.reviewDecision || null,
          };
        } catch {
          prCtx = { reviewThreads, reviewDecision };
        }
      } else if (reviewThreads.length > 0) {
        prCtx = { reviewThreads, issueComments: [], reviewDecision };
      }
    }
    let commitMessages = [];
    try {
      const recentLog = git(['log', '-n', '20', '--format=%B'], repoRoot, { allowFail: true }) || '';
      commitMessages = recentLog.split(/\r?\n\r?\n/).filter(Boolean);
    } catch {}
    const triage = triagePullRequest(prCtx || {}, { commitMessages });
    log.info(`[PR #${prRef}] Triaged review feedback (Round ${triage.round}/${triage.maxRounds}): ${triage.actionableThreads.length} actionable, ${triage.questionThreads.length} question(s), ${triage.suggestionThreads.length} suggestion(s).`);
    recordEvent('pr.triage', {
      stage: 'apply',
      change: slug,
      pr: prNum,
      reviewDecision: triage.reviewDecision || null,
      unaddressedThreads: triage.unaddressedCount,
      actionableThreads: triage.actionableThreads.length,
      suggestionThreads: triage.suggestionThreads.length,
      questionThreads: triage.questionThreads.length,
      actionableCount: triage.actionableThreads.length,
      questionCount: triage.questionThreads.length,
      suggestionCount: triage.suggestionThreads.length,
      round: triage.round,
      maxRounds: triage.maxRounds,
    }, { repoRoot });
  }

  if (isAutoPr) {
    log.info(`Auto-PR delegation: ENABLED (agent is authorized to open Implementation PR once tasks & verify pass).`);
  } else {
    log.info(`Auto-PR delegation: DISABLED (local-only mode; run \`asdlc pr\` when ready to submit).`);
  }
  log.info(`Ready for implementation. Follow task-level TDD loop in tasks.md.`);
  return 0;
}

export function register(program) {
  program
    .command('apply <changeId>')
    .description('guard before implementing: the spec must be approved on the protected branch')
    .option('--protected-branch <ref>', 'branch the approved spec must be merged into', 'origin/main')
    .option('--target-branch <ref>', 'target branch to merge into')
    .option('--mode <mode>', 'workflow mode: supervised (default) | spec-first | auto')
    .option('--from-pr <pr>', 'triage review comments from a GitHub PR number or #N')
    .option('--auto-pr', 'explicitly delegate authority to automatically open Implementation PR after verification passes')
    .option('--no-auto-pr', 'disable automatic Implementation PR creation (default)')
    .option('--guard-only', 'only run pre-implementation guard checks in terminal without starting the AI TDD loop')
    .addOption(new Option('--agent', 'internal agent runtime marker').hideHelp())
    .option('--repo-root <path>')
    .action((changeId, opts) => {
      requireAgentRuntime('apply', opts);
      process.exitCode = applyGuard(changeId, opts);
    });
}
