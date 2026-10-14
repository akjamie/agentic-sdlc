import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exists, readText, writeText } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { git, isGitRepo, changeOnRef, lastCommitTouching } from '../lib/git.js';
import { runLint } from './lint.js';
import { runVerify } from './verify.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';

export async function createPR(changeId, targetBranch, opts = {}) {
  const repoRoot = requireRepo(opts);
  if (!isGitRepo(repoRoot)) fail('not a git repository');

  if (!targetBranch) {
    fail('target branch is required (e.g. `asdlc pr <changeId> main` or `asdlc pr <changeId> develop`)', {
      code: 'MISSING_TARGET_BRANCH',
      hint: 'specify the base branch to merge into: asdlc pr <changeId> <targetBranch>',
    });
  }

  const slug = toChangeSlug(changeId);
  const cdir = changeDir(repoRoot, slug);
  if (!exists(cdir)) fail(`change '${slug}' not found`);

  // Detect PR type 100% automatically (Spec PR vs Impl PR)
  const metaPath = path.join(cdir, '.openspec.yaml');
  const metaText = exists(metaPath) ? readText(metaPath) : '';
  const statusMatch = metaText.match(/^\s*status:\s*['"]?([^\s'"]+)['"]?\s*$/m);
  const changeStatus = statusMatch ? statusMatch[1].toLowerCase() : '';
  const shaMatch = metaText.match(/^\s*specSha:\s*['"]?([^\s'"]+)['"]?\s*$/m);
  const specSha = shaMatch ? shaMatch[1] : null;

  const tasksPath = path.join(cdir, 'tasks.md');
  const tasksText = exists(tasksPath) ? readText(tasksPath) : '';
  const uncheckedCount = (tasksText.match(/^\s*-\s+\[\s\]/gm) ?? []).length;
  const checkedCount = (tasksText.match(/^\s*-\s+\[[xX]\]/gm) ?? []).length;

  const currentBranch = (git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot) ?? '').trim();
  if (currentBranch === targetBranch) {
    fail(`cannot create a PR from '${currentBranch}' into itself. Please switch to a feature branch first (e.g. \`git checkout -b spec/${slug}\` or \`git checkout -b impl/${slug}\`)`);
  }

  // Check if the spec is already approved/merged into targetBranch
  const isApprovedOnTarget = changeOnRef(repoRoot, targetBranch, slug)
    || changeOnRef(repoRoot, `origin/${targetBranch}`, slug)
    || Boolean(lastCommitTouching(repoRoot, targetBranch, [`openspec/changes/${slug}/proposal.md`]));

  // Check git diff or status for source code changes outside openspec/changes/<slug>
  const diffFiles = (git(['diff', '--name-only', `${targetBranch}...HEAD`], repoRoot, { allowFail: true }) ?? '')
    .split(/\r?\n/).filter(Boolean);
  const hasSourceChanges = diffFiles.some((f) => !f.startsWith(`openspec/changes/${slug}/`));

  let prType;
  if (opts.type) {
    prType = opts.type.toLowerCase();
  } else if (
    isApprovedOnTarget ||
    changeStatus === 'ready_for_impl' ||
    Boolean(specSha) ||
    currentBranch.startsWith('impl/') ||
    (hasSourceChanges && (checkedCount > 0 || uncheckedCount === 0))
  ) {
    prType = 'impl';
  } else {
    prType = 'spec';
  }

  const isSpec = prType === 'spec';
  const labelPrefix = isSpec ? 'asdlc:spec-review' : 'asdlc:impl-review';
  const secondaryLabel = isSpec ? 'spec' : 'impl';
  const prTypeName = isSpec ? 'Spec PR' : 'Implementation PR';

  // 1. Pre-flight self-check
  if (isSpec) {
    log.step(`running spec lint pre-flight for ${slug}...`);
    const lintExit = runLint(slug, { repoRoot, json: true });
    if (lintExit !== 0) {
      fail(`spec lint failed; fix all blocking findings before opening the Spec PR (run \`asdlc lint ${slug}\`)`);
    }
    log.ok('spec lint passed (0 blockers)');
  } else {
    log.step(`running implementation verify pre-flight for ${slug}...`);
    const verifyExit = runVerify(slug, {
      repoRoot,
      base: targetBranch,
      protectedBranch: targetBranch,
      ...opts,
    });
    if (verifyExit !== 0) {
      fail(`implementation verification failed; all 12 gates must pass before opening the Implementation PR (run \`asdlc verify ${slug}\`)`);
    }
    log.ok('implementation verify passed (all 12 gates passed)');
  }

  // 2. Extract Title and Description from proposal.md
  const proposalPath = path.join(cdir, 'proposal.md');
  if (!exists(proposalPath)) fail(`proposal.md missing for ${slug}`);
  const proposalText = readText(proposalPath);

  let title = `${isSpec ? 'spec' : 'impl'}(${slug})`;
  const titleMatch = proposalText.match(/^#\s*(?:Proposal:\s*)?([^\n\r]+)/im);
  if (titleMatch && titleMatch[1]) {
    const raw = titleMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
    if (raw) title = `${isSpec ? 'spec' : 'impl'}(${slug}): ${raw}`;
  }

  // 3. Stage & commit any unstaged changes
  try {
    if (isSpec) {
      git(['add', `openspec/changes/${slug}`], repoRoot);
      const status = git(['status', '--porcelain', `openspec/changes/${slug}`], repoRoot);
      if (status) {
        execFileSync('git', ['commit', '-m', `spec(${slug}): specify feature intent`], { cwd: repoRoot, stdio: 'ignore' });
        log.ok('committed latest spec changes');
      }
    } else {
      git(['add', '-A'], repoRoot);
      const status = git(['status', '--porcelain'], repoRoot);
      if (status) {
        execFileSync('git', ['commit', '-m', `impl(${slug}): implement verified changes`], { cwd: repoRoot, stdio: 'ignore' });
        log.ok('committed latest implementation changes');
      }
    }
  } catch { /* ignore */ }

  // 4. Push to remote
  log.step(`pushing branch '${currentBranch}' to origin...`);
  try {
    execFileSync('git', ['push', '-u', 'origin', currentBranch], { cwd: repoRoot, stdio: 'inherit' });
    log.ok(`pushed branch '${currentBranch}' to origin`);
  } catch (err) {
    log.warn(`git push skipped or failed: ${err.message}`);
  }

  // 5. Build PR body
  let body = '';
  if (isSpec) {
    body = `## 🤖 Agentic SDLC — Spec Review

**Change ID**: \`${slug}\`
**Target Branch**: \`${targetBranch}\`
**Spec Branch**: \`${currentBranch}\`

---

${proposalText}
`;
  } else {
    body = `## 🤖 Agentic SDLC — Implementation Review

**Change ID**: \`${slug}\`
**Target Branch**: \`${targetBranch}\`
**Implementation Branch**: \`${currentBranch}\`

### 📋 Completed Tasks & TDD Evidence
${tasksText || '(no tasks recorded)'}

---

### 🎯 Approved Intent
${proposalText}
`;
  }

  // 6. Multi-tier PR creation strategy:
  // Tier 1: Platform CLI (gh / glab)
  // Tier 2: Direct REST API (GITHUB_TOKEN / GITLAB_TOKEN)
  // Tier 3: 1-click Web compare URL fallback
  let prCreated = false;
  let prUrl = null;

  // Detect remote repository information
  const remoteUrl = git(['remote', 'get-url', 'origin'], repoRoot, { allowFail: true });
  const remoteInfo = parseRemoteUrl(remoteUrl);

  // Attempt Tier 1: CLI
  try {
    const out = execFileSync('gh', [
      'pr', 'create',
      '--title', title,
      '--body', body,
      '--base', targetBranch,
      '--head', currentBranch,
      '--label', labelPrefix,
    ], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    prCreated = true;
    prUrl = out.trim();
  } catch {
    try {
      const out = execFileSync('gh', [
        'pr', 'create',
        '--title', title,
        '--body', body,
        '--base', targetBranch,
        '--head', currentBranch,
      ], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      prCreated = true;
      prUrl = out.trim();
    } catch {
      // gh not available or failed
    }
  }

  if (!prCreated) {
    try {
      const out = execFileSync('glab', [
        'mr', 'create',
        '--title', title,
        '--description', body,
        '--target-branch', targetBranch,
        '--source-branch', currentBranch,
        '--label', labelPrefix,
      ], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      prCreated = true;
      prUrl = out.trim();
    } catch {
      // glab not available
    }
  }

  // Attempt Tier 2: Direct REST API via fetch (Node 20+)
  if (!prCreated && remoteInfo) {
    const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const glToken = process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN || process.env.GL_TOKEN;

    if (remoteInfo.isGitHub && ghToken) {
      try {
        const apiBase = remoteInfo.host === 'github.com'
          ? 'https://api.github.com'
          : `${remoteInfo.protocol}//${remoteInfo.host}/api/v3`;
        const apiUrl = `${apiBase}/repos/${remoteInfo.repoPath}/pulls`;
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ghToken}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'asdlc-cli',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title,
            body,
            head: currentBranch,
            base: targetBranch,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          prCreated = true;
          prUrl = data.html_url;

          // Attach labels via GitHub Issues API (pull requests are issues in GitHub)
          if (data.number) {
            try {
              const labelUrl = `${apiBase}/repos/${remoteInfo.repoPath}/issues/${data.number}/labels`;
              await fetch(labelUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${ghToken}`,
                  'Accept': 'application/vnd.github+json',
                  'User-Agent': 'asdlc-cli',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ labels: [labelPrefix, secondaryLabel] }),
              });
            } catch { /* ignore label add error */ }
          }
        }
      } catch {
        // API attempt failed
      }
    } else if (remoteInfo.isGitLab && glToken) {
      try {
        const projectId = encodeURIComponent(remoteInfo.repoPath);
        const apiUrl = `${remoteInfo.protocol}//${remoteInfo.host}/api/v4/projects/${projectId}/merge_requests`;
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'PRIVATE-TOKEN': glToken,
            'User-Agent': 'asdlc-cli',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title,
            description: body,
            source_branch: currentBranch,
            target_branch: targetBranch,
            labels: `${labelPrefix},${secondaryLabel}`,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          prCreated = true;
          prUrl = data.web_url;
        }
      } catch {
        // GitLab API attempt failed
      }
    }
  }

  if (prCreated && prUrl) {
    log.ok(`${prTypeName} automatically created: ${prUrl}`);
  } else {
    log.info('');
    log.ok(`Branch '${currentBranch}' pushed and ready for ${prTypeName}.`);
    log.info(`Target: ${targetBranch} | Title: "${title}" | Labels: ${labelPrefix}, ${secondaryLabel}`);

    // Tier 3: Browser 1-click fallback link
    if (remoteInfo) {
      if (remoteInfo.isGitHub) {
        const webUrl = `${remoteInfo.protocol}//${remoteInfo.host}/${remoteInfo.repoPath}/compare/${targetBranch}...${currentBranch}?expand=1&labels=${secondaryLabel},${labelPrefix}`;
        log.info(`👉 Click to open and create PR in browser: ${webUrl}`);
      } else if (remoteInfo.isGitLab) {
        const webUrl = `${remoteInfo.protocol}//${remoteInfo.host}/${remoteInfo.repoPath}/-/merge_requests/new?merge_request[source_branch]=${currentBranch}&merge_request[target_branch]=${targetBranch}&merge_request[labels]=${labelPrefix},${secondaryLabel}`;
        log.info(`👉 Click to open and create MR in browser: ${webUrl}`);
      }
    } else {
      log.info(`(Install 'gh' / 'glab' CLI or set GITHUB_TOKEN for 1-click automatic PR creation)`);
    }
  }

  // Persist targetBranch and prUrl to .openspec.yaml for full traceability
  if (exists(metaPath)) {
    let metaTextUpdated = readText(metaPath);
    const upsertKey = (text, key, val) => {
      const re = new RegExp(`^\\s*${key}:\\s*.*$`, 'm');
      return re.test(text) ? text.replace(re, `${key}: "${val}"`) : `${text.trimEnd()}\n${key}: "${val}"\n`;
    };
    metaTextUpdated = upsertKey(metaTextUpdated, 'targetBranch', targetBranch);
    metaTextUpdated = upsertKey(metaTextUpdated, 'lastPrType', prType);
    if (prUrl) metaTextUpdated = upsertKey(metaTextUpdated, 'prUrl', prUrl);
    writeText(metaPath, metaTextUpdated);
  }

  return { slug, type: prType, title, targetBranch, prUrl, labels: [labelPrefix, secondaryLabel] };
}

// Backwards-compatible export
export function createSpecPR(changeId, targetBranch, opts = {}) {
  return createPR(changeId, targetBranch, { type: 'spec', ...opts });
}

export function parseRemoteUrl(url, opts = {}) {
  if (!url) return null;
  const cleaned = url.trim().replace(/\.git$/, '');
  let host = '';
  let repoPath = '';
  let protocol = 'https:';

  const sshMatch = cleaned.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    host = sshMatch[1];
    repoPath = sshMatch[2];
  } else {
    try {
      const u = new URL(cleaned);
      host = u.host;
      protocol = u.protocol || 'https:';
      repoPath = u.pathname.replace(/^\//, '');
    } catch {
      return null;
    }
  }

  const explicitPlatform = (opts.platform || process.env.ASDLC_GIT_PLATFORM || process.env.GIT_PLATFORM || '').toLowerCase();
  const isGitLab = explicitPlatform === 'gitlab'
    || host.includes('gitlab')
    || (!host.includes('github') && Boolean(process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN || process.env.GL_TOKEN));
  const isGitHub = explicitPlatform === 'github'
    || host.includes('github')
    || (!isGitLab);

  return {
    host,
    repoPath,
    protocol,
    isGitHub,
    isGitLab,
  };
}

export function register(program) {
  program
    .command('pr <changeId> <targetBranch>')
    .description('automatically open a Spec or Implementation PR: auto-detects stage, pre-flight checks, pushes branch, and attaches labels for CI AI review')
    .option('--repo-root <path>')
    .action(async (changeId, targetBranch, opts) => {
      await createPR(changeId, targetBranch, opts);
    });
}

