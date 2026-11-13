import { isGitRepo, headSha, git } from './git.js';
import { fail, AsdlcError } from './errors.js';
import { exists } from './fs.js';
import { openspecDir } from './paths.js';

const CANONICAL_URL_RE = /^(?:(https?|ssh):\/\/(?:([^@]+)@)?([^/:]+)(?::(\d+))?\/|git@([^:]+):)(.+?)(?:\.git)?(?:\/(?:pull|-\/merge_requests)\/(\d+))?\/?$/i;
const SHORTHAND_SLUG_RE = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+$/;
const PR_REF_RE = /^#?(\d+)$/;

/**
 * Renders a boxed diagnostic error card with root causes and actionable remedies.
 */
export function formatDiagnosticCard({ code, title, rootCauses = [], remedies = [] }) {
  const lines = [
    `┌──────────────────────────────────────────────────────────────────────────────┐`,
    `│  [ERROR] ${code}: ${title}`,
    `├──────────────────────────────────────────────────────────────────────────────┤`,
  ];
  if (rootCauses.length > 0) {
    lines.push('│  Root Cause:');
    for (const rc of rootCauses) {
      lines.push(`│  - ${rc}`);
    }
  }
  if (remedies.length > 0) {
    lines.push('│');
    lines.push('│  Actionable Remedies (Choose one):');
    remedies.forEach((rem, i) => {
      lines.push(`│  ${i + 1}. ${rem}`);
    });
  }
  lines.push(`└──────────────────────────────────────────────────────────────────────────────┘`);
  return lines.join('\n');
}

function throwDiagnosticError({ code, title, message, rootCauses = [], remedies = [], env = process.env }) {
  const card = formatDiagnosticCard({ code, title, rootCauses, remedies });
  if (env?.GITHUB_ACTIONS === 'true') {
    process.stderr.write(`::error title=${code}::${message}\n`);
  }
  const err = new AsdlcError(message, {
    code,
    exitCode: 1,
    hint: remedies[0] || '',
    detail: card,
  });
  err.remedies = remedies;
  err.card = card;
  throw err;
}

/**
 * Verifies that the target workspace or container options provide an initialized Git repository
 * with at least one commit, or explicit remote/create-repo targets for greenfield runs.
 */
export function assertGitRepositoryInitialized(repoRoot, {
  container = false,
  repo = null,
  createRepo = null,
  env = process.env,
  requireCommit = true,
} = {}) {
  const hasGit = Boolean(repoRoot && isGitRepo(repoRoot));
  const hasOpenspec = Boolean(repoRoot && exists(openspecDir(repoRoot)));

  // Container zero-checkout or greenfield flow with explicit remote/creation target
  if (container && (repo || createRepo)) {
    return { initialized: hasGit, greenfield: !hasGit };
  }

  // Case 1: Empty/non-Git folder (container mode always requires remote or repo; local requires repo/openspec)
  if (!hasGit && (container || !hasOpenspec)) {
    throwDiagnosticError({
      code: 'ASDLC_ERR_NO_REPOSITORY',
      title: 'Target Git repository not specified',
      message: `No initialized Git repository found at ${repoRoot}. Container and governance workflows require an explicit repository.`,
      rootCauses: [
        'Current directory is not a Git repository or has no remote origin.',
        container ? 'Container execution requires an explicit target repository (--repo or --create-repo).' : 'OpenSpec project is not initialized in a Git repository.',
      ],
      remedies: [
        'Create a new GitHub repository: asdlc run "<requirement>" --create-repo <org/repo-name> --container',
        'Target an existing remote repository: asdlc run "<requirement>" --repo <org/repo-name> --container',
        'Initialize Git locally first: git init && git commit --allow-empty -m "chore: init" && asdlc init',
      ],
      env,
    });
  }

  // Case 2: `git init` exists, but 0 commits (unborn HEAD) breaks SHA anchoring & spec locks
  if (hasGit && requireCommit && !headSha(repoRoot)) {
    throwDiagnosticError({
      code: 'ASDLC_ERR_NO_REPOSITORY',
      title: 'Git repository has no initial commit (unborn HEAD)',
      message: `Git repository at ${repoRoot} has no commits yet. At least one initial commit is required for branch anchoring.`,
      rootCauses: [
        'git init was run, but no initial commit exists on HEAD yet.',
      ],
      remedies: [
        'Create an initial commit: git add -A && git commit --allow-empty -m "chore: initial commit"',
      ],
      env,
    });
  }

  // Case 3: Container mode inside a git repo without remote origin and without --repo/--create-repo
  if (container && hasGit && !repo && !createRepo) {
    const originUrl = git(['remote', 'get-url', 'origin'], repoRoot, { allowFail: true });
    if (!originUrl) {
      throwDiagnosticError({
        code: 'ASDLC_ERR_NO_REPOSITORY',
        title: 'Git repository has no remote origin configured',
        message: `Git repository at ${repoRoot} has no remote 'origin'. Container autonomous PR lifecycle requires a remote target.`,
        rootCauses: [
          'Local Git repository has no remote named "origin".',
          'Neither --repo nor --create-repo was specified.',
        ],
        remedies: [
          'Create remote repository: asdlc run "<requirement>" --create-repo <org/repo-name> --container',
          'Or link an existing remote: git remote add origin <url>',
        ],
        env,
      });
    }
  }

  return { initialized: true, greenfield: false };
}

/**
 * Parses a canonical Git or PR/MR URL into structured components.
 * Supports https://, http://, ssh://, git@host:path, multi-level GitLab subgroups, and /pull/N or /-/merge_requests/N.
 */
export function parseCanonicalGitUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const m = trimmed.match(CANONICAL_URL_RE);
  if (!m) return null;

  const [, protoRaw, , httpsHost, port, sshHost, pathPart, prNumRaw] = m;
  const host = (httpsHost || sshHost || '').toLowerCase();
  if (!host || !pathPart) return null;

  const cleanPath = pathPart.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  const segments = cleanPath.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const repo = segments[segments.length - 1];
  const namespace = segments.slice(0, -1).join('/');
  const protocol = protoRaw ? protoRaw.toLowerCase() : 'ssh';
  const hostWithPort = port ? `${host}:${port}` : host;
  const remoteUrl = protocol === 'ssh' && !protoRaw
    ? `git@${host}:${cleanPath}.git`
    : `${protocol}://${hostWithPort}/${cleanPath}.git`;

  return {
    format: 'canonical-url',
    protocol: protocol === 'ssh' ? 'ssh' : 'https',
    host,
    port: port ? Number(port) : null,
    namespace,
    repo,
    fullSlug: cleanPath,
    remoteUrl,
    prNumber: prNumRaw ? Number(prNumRaw) : null,
  };
}

function detectIntranetIndicators({ env = process.env, policy = null, originUrl = null, strictIntranet = false } = {}) {
  if (strictIntranet || env?.ASDLC_STRICT_HOST === '1' || policy?.git?.strict_host === true) return true;
  if (env?.HTTPS_PROXY || env?.HTTP_PROXY || env?.https_proxy || env?.http_proxy || env?.SSL_CERT_FILE || env?.NODE_EXTRA_CA_CERTS) {
    return true;
  }
  if (originUrl) {
    const parsed = parseCanonicalGitUrl(originUrl);
    if (parsed && parsed.host !== 'github.com' && parsed.host !== 'gitlab.com') {
      return true;
    }
  }
  return false;
}

/**
 * Resolves target Git repository & host deterministically across 3 tiers:
 * A. Canonical full URL (zero ambiguity, supports multi-level subgroups & ports)
 * B. Configured shorthand slug (requires configured default_host; never guesses github.com in intranet/multi-subgroup contexts)
 * C. Ambient context (local git origin remote or CI env vars)
 */
export function resolveGitHostAndRepo(targetInput = '', options = {}) {
  let opts = options;
  let raw = '';
  if (typeof targetInput === 'string') {
    raw = targetInput.trim();
  } else if (targetInput && typeof targetInput === 'object') {
    raw = String(targetInput.repo || targetInput.target || targetInput.url || '').trim();
    opts = { ...targetInput, ...options };
  }
  const {
    repoRoot = null,
    globalConfig = null,
    policy = null,
    env = process.env,
    strictIntranet = false,
  } = opts;

  // Tier A: Canonical full URL (GitHub, GitLab, GHES, multi-subgroup, PR/MR URL)
  if (raw) {
    const canonical = parseCanonicalGitUrl(raw);
    if (canonical) return canonical;
  }

  // Tier B: Shorthand slug (e.g. "owner/repo" or "fintech/settlement/refund")
  const prMatch = raw.match(PR_REF_RE);
  if (raw && !prMatch && SHORTHAND_SLUG_RE.test(raw)) {
    const cleanSlug = raw.replace(/\.git$/i, '');
    const segments = cleanSlug.split('/').filter(Boolean);
    const repo = segments[segments.length - 1];
    const namespace = segments.slice(0, -1).join('/');

    const configuredHost = env?.ASDLC_GIT_HOST
      || policy?.git?.default_host
      || globalConfig?.git?.default_host
      || null;

    const configuredProtocol = (
      env?.ASDLC_GIT_PROTOCOL
      || policy?.git?.protocol
      || globalConfig?.git?.protocol
      || 'https'
    ).toLowerCase();

    const originUrl = repoRoot && isGitRepo(repoRoot)
      ? git(['remote', 'get-url', 'origin'], repoRoot, { allowFail: true })
      : null;

    const isDeepGroup = segments.length >= 3;
    const intranetDetected = detectIntranetIndicators({ env, policy, originUrl, strictIntranet });

    if (!configuredHost && (isDeepGroup || intranetDetected)) {
      throwDiagnosticError({
        code: 'ASDLC_ERR_AMBIGUOUS_HOST',
        title: 'Cannot resolve Git host for shorthand slug',
        message: `Ambiguous shorthand repository '${raw}' without configured git.default_host. Refusing to fall back to github.com.`,
        rootCauses: [
          `Input provided: "${raw}" without protocol or domain.`,
          'In enterprise/intranet environments or nested GitLab groups, fallback guessing to github.com is prohibited to prevent metadata and token exfiltration.',
        ],
        remedies: [
          `Provide a canonical full URL: asdlc run --repo https://gitlab.corp.com/${cleanSlug}.git --container`,
          'Configure your enterprise default host: asdlc config set git.default_host gitlab.corp.company.com',
        ],
        env,
      });
    }

    const host = configuredHost ? configuredHost.toLowerCase() : 'github.com';
    const remoteUrl = configuredProtocol === 'ssh'
      ? `git@${host}:${cleanSlug}.git`
      : `https://${host}/${cleanSlug}.git`;

    return {
      format: configuredHost ? 'configured-shorthand' : 'public-shorthand',
      protocol: configuredProtocol === 'ssh' ? 'ssh' : 'https',
      host,
      port: null,
      namespace,
      repo,
      fullSlug: cleanSlug,
      remoteUrl,
      prNumber: null,
    };
  }

  // Tier C: Ambient context (#N, bare change slug, or empty)
  const prNumber = prMatch ? Number(prMatch[1]) : null;
  if (repoRoot && isGitRepo(repoRoot)) {
    const originUrl = git(['remote', 'get-url', 'origin'], repoRoot, { allowFail: true });
    if (originUrl) {
      const parsed = parseCanonicalGitUrl(originUrl);
      if (parsed) {
        return {
          ...parsed,
          format: 'ambient-origin',
          prNumber,
        };
      }
    }
  }

  // Ambient CI environment (GitHub Actions / GitLab CI)
  if (env?.GITHUB_REPOSITORY) {
    const serverUrl = (env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '');
    const parsed = parseCanonicalGitUrl(`${serverUrl}/${env.GITHUB_REPOSITORY}`);
    if (parsed) return { ...parsed, format: 'ambient-ci', prNumber };
  }
  if (env?.CI_PROJECT_PATH) {
    const serverUrl = (env.CI_SERVER_URL || 'https://gitlab.com').replace(/\/+$/, '');
    const parsed = parseCanonicalGitUrl(`${serverUrl}/${env.CI_PROJECT_PATH}`);
    if (parsed) return { ...parsed, format: 'ambient-ci', prNumber };
  }

  fail(`Cannot resolve target Git repository or remote host from '${raw || '(cwd)'}'.`, {
    code: 'ASDLC_ERR_NO_REPOSITORY',
    hint: 'Pass --repo <url-or-owner/repo>, run inside a cloned repo with remote origin, or set git.default_host.',
  });
}

