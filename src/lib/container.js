import fs from 'node:fs';
import path from 'node:path';
import { scanDiffForSecrets } from '../assess/secrets.js';
import { AsdlcError } from './errors.js';
import { git } from './git.js';

/**
 * Container security baseline enforced internally on every sandbox launch.
 * Never exposes CLI flags to run as root or grant Linux capabilities.
 */
export const CONTAINER_SECURITY_BASELINE = Object.freeze({
  user: '10001:10001',
  capDrop: 'ALL',
  securityOpt: 'no-new-privileges:true',
  pidsLimit: '512',
  rm: true,
  safeDirectory: '/workspace',
  caCertPath: '/etc/ssl/certs/corporate-ca.crt',
});

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];
const MAX_SCAN_FILE_BYTES = 512 * 1024;

/**
 * Extract corporate HTTP(S) proxy environment variables from host env.
 *
 * @param {Record<string, string|undefined>} [hostEnv]
 * @returns {Record<string, string>}
 */
export function collectCorporateProxyEnv(hostEnv = process.env) {
  const out = {};
  for (const key of PROXY_ENV_KEYS) {
    if (hostEnv?.[key]) {
      out[key] = String(hostEnv[key]);
    }
  }
  return out;
}

/**
 * Build hardened `docker create` argument vector enforcing non-root UID 10001:10001,
 * dropped capabilities, PIDs cap, dubious-ownership immunity, and enterprise proxy/CA passthrough.
 *
 * @param {object} [opts]
 * @returns {string[]}
 */
export function buildDockerCreateArgs(opts = {}) {
  const image = opts.image || 'ghcr.io/akjamie/asdlc-runner:2.0.0';
  const workdir = opts.workdir || CONTAINER_SECURITY_BASELINE.safeDirectory;
  const hostEnv = opts.hostEnv || process.env;
  const args = [
    'create',
    '--rm',
    '--user',
    CONTAINER_SECURITY_BASELINE.user,
    `--cap-drop=${CONTAINER_SECURITY_BASELINE.capDrop}`,
    `--security-opt=${CONTAINER_SECURITY_BASELINE.securityOpt}`,
    `--pids-limit=${CONTAINER_SECURITY_BASELINE.pidsLimit}`,
    '-w',
    workdir,
  ];

  if (opts.name) {
    args.push('--name', String(opts.name));
  }

  const injectedEnv = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'safe.directory',
    GIT_CONFIG_VALUE_0: workdir,
    ...collectCorporateProxyEnv(hostEnv),
    ...(opts.env || {}),
  };

  if (opts.caCertHostPath || hostEnv?.SSL_CERT_FILE || hostEnv?.NODE_EXTRA_CA_CERTS) {
    injectedEnv.SSL_CERT_FILE = CONTAINER_SECURITY_BASELINE.caCertPath;
    injectedEnv.NODE_EXTRA_CA_CERTS = CONTAINER_SECURITY_BASELINE.caCertPath;
  }

  for (const [k, v] of Object.entries(injectedEnv)) {
    if (v !== undefined && v !== null && String(v).length > 0) {
      args.push('-e', `${k}=${v}`);
    }
  }

  if (opts.sshAuthSock) {
    args.push('-v', `${opts.sshAuthSock}:/run/ssh-agent.sock:ro`);
    args.push('-e', 'SSH_AUTH_SOCK=/run/ssh-agent.sock');
  }

  args.push(image);
  if (Array.isArray(opts.cmd) && opts.cmd.length > 0) {
    args.push(...opts.cmd);
  }
  return args;
}

/**
 * Detect Tri-State Repository Lifecycle (`greenfield`, `brownfield`, `established`).
 *
 * @param {string} repoDir
 * @returns {{ lifecycle: 'greenfield'|'brownfield'|'established', isGitRepo: boolean, hasOpenspec: boolean }}
 */
export function detectRepoLifecycle(repoDir) {
  const target = path.resolve(repoDir || process.cwd());
  if (!fs.existsSync(target)) {
    return { lifecycle: 'greenfield', isGitRepo: false, hasOpenspec: false };
  }
  const inside = git(['rev-parse', '--is-inside-work-tree'], target, { allowFail: true });
  const isGitRepo = Boolean(inside && inside.trim() === 'true');
  if (!isGitRepo) {
    return { lifecycle: 'greenfield', isGitRepo: false, hasOpenspec: false };
  }
  const hasOpenspec = fs.existsSync(path.join(target, 'openspec'));
  return {
    lifecycle: hasOpenspec ? 'established' : 'brownfield',
    isGitRepo: true,
    hasOpenspec,
  };
}

/**
 * Pre-Ingestion Secret Scanning Guard:
 * Scans dirty working tree diffs and untracked non-ignored files before
 * streaming workspace contents into an isolated container or AI session.
 * Throws AsdlcError('ASDLC_ERR_UNCOMMITTED_SECRET') on detection.
 *
 * @param {string} repoDir
 * @param {object} [opts]
 * @returns {{ clean: boolean, findings: Array<object> }}
 */
export function preScanWorkspaceForSecrets(repoDir, opts = {}) {
  const findings = [];

  if (typeof opts.diffText === 'string') {
    for (const f of scanDiffForSecrets(opts.diffText)) {
      findings.push({ source: 'working-diff', ...f });
    }
  } else if (repoDir && fs.existsSync(repoDir)) {
    const lifecycle = detectRepoLifecycle(repoDir);
    if (lifecycle.isGitRepo) {
      const hasHead = Boolean(git(['rev-parse', '--verify', 'HEAD'], repoDir, { allowFail: true }));
      const diffArgs = hasHead ? ['diff', '-p', 'HEAD'] : ['diff', '--cached', '-p'];
      const diffText = git(diffArgs, repoDir, { allowFail: true }) || '';
      for (const f of scanDiffForSecrets(diffText)) {
        findings.push({ source: 'git-diff', ...f });
      }
      const untracked = (git(['ls-files', '--others', '--exclude-standard'], repoDir, { allowFail: true }) || '')
        .split(/\r?\n/)
        .filter(Boolean);
      for (const rel of untracked) {
        const abs = path.join(repoDir, rel);
        try {
          const stat = fs.statSync(abs);
          if (!stat.isFile() || stat.size > MAX_SCAN_FILE_BYTES) continue;
          const content = fs.readFileSync(abs, 'utf8');
          if (content.includes('\u0000')) continue; // skip binaries
          for (const f of scanDiffForSecrets(content)) {
            findings.push({ source: rel, ...f });
          }
        } catch {
          // ignore unreadable race
        }
      }
    }
  }

  if (findings.length > 0) {
    const summary = findings
      .slice(0, 5)
      .map((f) => `${f.source}:${f.line} [${f.rule}] ${f.redacted}`)
      .join('; ');
    throw new AsdlcError(
      `Uncommitted or untracked plaintext secret detected before container ingestion: ${summary}`,
      {
        code: 'ASDLC_ERR_UNCOMMITTED_SECRET',
        hint: 'Remove or encrypt the secret using environment variables / secret manager before running `asdlc run`.',
      }
    );
  }

  return { clean: true, findings: [] };
}

function walkSpecTargets(changeDirPath) {
  const targets = [];
  if (!changeDirPath || !fs.existsSync(changeDirPath)) return targets;
  const proposal = path.join(changeDirPath, 'proposal.md');
  if (fs.existsSync(proposal)) targets.push(proposal);

  const specsRoot = path.join(changeDirPath, 'specs');
  if (fs.existsSync(specsRoot)) {
    const stack = [specsRoot];
    while (stack.length > 0) {
      const cur = stack.pop();
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          targets.push(full);
        }
      }
    }
  }
  return targets;
}

/**
 * Set OS/kernel-level read-only permissions (0444) on approved specification
 * files (`proposal.md` and `specs/**`) during implementation (`apply`).
 *
 * @param {string} changeDirPath
 * @returns {string[]} locked file paths
 */
export function lockSpecsReadOnly(changeDirPath) {
  const locked = [];
  for (const file of walkSpecTargets(changeDirPath)) {
    fs.chmodSync(file, 0o444);
    locked.push(file);
  }
  return locked;
}

/**
 * Restore writable permissions (0644) on specification files (required for
 * spec revisions or test cleanup on Windows/POSIX).
 *
 * @param {string} changeDirPath
 * @returns {string[]} unlocked file paths
 */
export function unlockSpecsWritable(changeDirPath) {
  const unlocked = [];
  for (const file of walkSpecTargets(changeDirPath)) {
    fs.chmodSync(file, 0o644);
    unlocked.push(file);
  }
  return unlocked;
}

