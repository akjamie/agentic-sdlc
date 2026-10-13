import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exists, readText, writeText } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { git, isGitRepo } from '../lib/git.js';
import { runLint } from './lint.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';

export async function createSpecPR(changeId, targetBranch, opts = {}) {
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

  // 1. Pre-flight lint: must pass with 0 blockers before opening PR
  log.step(`running spec lint for ${slug}...`);
  const lintExit = runLint(slug, { repoRoot, json: true });
  if (lintExit !== 0) {
    fail(`spec lint failed; fix all blocking findings before opening the Spec PR (run \`asdlc lint ${slug}\`)`);
  }
  log.ok('spec lint passed (0 blockers)');

  // 2. Extract Title and Description from proposal.md
  const proposalPath = path.join(cdir, 'proposal.md');
  if (!exists(proposalPath)) fail(`proposal.md missing for ${slug}`);
  const proposalText = readText(proposalPath);

  // Extract clean title from proposal: # Proposal: <title> or # <title>
  let title = `spec(${slug})`;
  const titleMatch = proposalText.match(/^#\s*(?:Proposal:\s*)?([^\n\r]+)/im);
  if (titleMatch && titleMatch[1]) {
    const raw = titleMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
    if (raw) title = `spec(${slug}): ${raw}`;
  }

  const currentBranch = (git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot) ?? '').trim();
  if (currentBranch === targetBranch) {
    fail(`cannot create a PR from '${currentBranch}' into itself. Please switch to a feature branch first (e.g. \`git checkout -b spec/${slug}\`)`);
  }

  // 3. Stage & commit any unstaged spec changes
  try {
    git(['add', `openspec/changes/${slug}`], repoRoot);
    const status = git(['status', '--porcelain', `openspec/changes/${slug}`], repoRoot);
    if (status) {
      execFileSync('git', ['commit', '-m', `spec(${slug}): specify feature intent`], { cwd: repoRoot, stdio: 'ignore' });
      log.ok('committed latest spec changes');
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

  // 5. Build PR body from proposal
  const body = `## 🤖 Agentic SDLC — Spec Review

**Change ID**: \`${slug}\`
**Target Branch**: \`${targetBranch}\`
**Spec Branch**: \`${currentBranch}\`

---

${proposalText}
`;

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
      '--label', 'asdlc:spec-review',
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
        '--label', 'asdlc:spec-review',
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
        const apiUrl = remoteInfo.host === 'github.com'
          ? `https://api.github.com/repos/${remoteInfo.repoPath}/pulls`
          : `https://${remoteInfo.host}/api/v3/repos/${remoteInfo.repoPath}/pulls`;
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
              const labelUrl = remoteInfo.host === 'github.com'
                ? `https://api.github.com/repos/${remoteInfo.repoPath}/issues/${data.number}/labels`
                : `https://${remoteInfo.host}/api/v3/repos/${remoteInfo.repoPath}/issues/${data.number}/labels`;
              await fetch(labelUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${ghToken}`,
                  'Accept': 'application/vnd.github+json',
                  'User-Agent': 'asdlc-cli',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ labels: ['asdlc:spec-review', 'spec'] }),
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
        const apiUrl = `https://${remoteInfo.host}/api/v4/projects/${projectId}/merge_requests`;
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
            labels: 'asdlc:spec-review,spec',
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
    log.ok(`Spec PR automatically created: ${prUrl}`);
  } else {
    log.info('');
    log.ok(`Branch '${currentBranch}' pushed and ready for Spec PR.`);
    log.info(`Target: ${targetBranch} | Title: "${title}"`);

    // Tier 3: Browser 1-click fallback link
    if (remoteInfo) {
      if (remoteInfo.isGitHub) {
        const webUrl = `https://${remoteInfo.host}/${remoteInfo.repoPath}/compare/${targetBranch}...${currentBranch}?expand=1&labels=spec,asdlc:spec-review`;
        log.info(`👉 Click to open and create PR in browser: ${webUrl}`);
      } else if (remoteInfo.isGitLab) {
        const webUrl = `https://${remoteInfo.host}/${remoteInfo.repoPath}/-/merge_requests/new?merge_request[source_branch]=${currentBranch}&merge_request[target_branch]=${targetBranch}&merge_request[labels]=asdlc:spec-review,spec`;
        log.info(`👉 Click to open and create MR in browser: ${webUrl}`);
      }
    } else {
      log.info(`(Install 'gh' / 'glab' CLI or set GITHUB_TOKEN for 1-click automatic PR creation)`);
    }
  }

  // Persist targetBranch and prUrl to .openspec.yaml for full traceability
  const metaPath = path.join(cdir, '.openspec.yaml');
  if (exists(metaPath)) {
    let metaText = readText(metaPath);
    const upsertKey = (text, key, val) => {
      const re = new RegExp(`^\\s*${key}:\\s*.*$`, 'm');
      return re.test(text) ? text.replace(re, `${key}: "${val}"`) : `${text.trimEnd()}\n${key}: "${val}"\n`;
    };
    metaText = upsertKey(metaText, 'targetBranch', targetBranch);
    if (prUrl) metaText = upsertKey(metaText, 'prUrl', prUrl);
    writeText(metaPath, metaText);
  }

  return { slug, title, targetBranch, prUrl };
}

export function parseRemoteUrl(url) {
  if (!url) return null;
  const cleaned = url.trim().replace(/\.git$/, '');
  const sshMatch = cleaned.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const host = sshMatch[1];
    return {
      host,
      repoPath: sshMatch[2],
      isGitHub: host.includes('github'),
      isGitLab: host.includes('gitlab'),
    };
  }
  try {
    const u = new URL(cleaned);
    const host = u.host;
    return {
      host,
      repoPath: u.pathname.replace(/^\//, ''),
      isGitHub: host.includes('github'),
      isGitLab: host.includes('gitlab'),
    };
  } catch {
    return null;
  }
}

export function register(program) {
  program
    .command('pr <changeId> <targetBranch>')
    .description('automatically open a Spec PR: lints spec, pushes branch, auto-generates title & body, and creates PR (via CLI, REST API, or web link)')
    .option('--repo-root <path>')
    .action(async (changeId, targetBranch, opts) => {
      await createSpecPR(changeId, targetBranch, opts);
    });
}

