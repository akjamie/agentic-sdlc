import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

  // SSH Patterns A, B, and C (Agent forwarding, /dev/shm deploy key, Known Hosts handling)
  const platform = opts.platform || process.platform;
  if (opts.sshAuthSock || opts.sshAgent) {
    const isDockerDesktop = platform === 'darwin' || platform === 'win32';
    const hostSock = opts.sshAuthSock || (isDockerDesktop ? '/run/host-services/ssh-auth.sock' : hostEnv?.SSH_AUTH_SOCK);
    const containerSock = hostSock === '/run/host-services/ssh-auth.sock'
      ? '/run/host-services/ssh-auth.sock'
      : '/run/ssh-agent.sock';
    if (hostSock) {
      args.push('-v', `${hostSock}:${containerSock}:ro`);
      injectedEnv.SSH_AUTH_SOCK = containerSock;
    }
    if (!injectedEnv.GIT_SSH_COMMAND) {
      injectedEnv.GIT_SSH_COMMAND = 'ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/shm/.ssh/known_hosts';
    }
  } else if (opts.sshKeyPath || hostEnv?.ASDLC_SSH_KEY) {
    if (!injectedEnv.GIT_SSH_COMMAND) {
      injectedEnv.GIT_SSH_COMMAND = 'ssh -i /dev/shm/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/shm/.ssh/known_hosts';
    }
  }

  for (const [k, v] of Object.entries(injectedEnv)) {
    if (v !== undefined && v !== null && String(v).length > 0) {
      args.push('-e', `${k}=${v}`);
    }
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

function defaultExec(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: opts.encoding ?? 'utf8', ...opts });
}

/**
 * Performs 3-layer workspace ingestion + external intake / custom skill / /dev/shm credential
 * streaming into an isolated stopped/created container without mounting the host filesystem.
 *
 * @param {string} repoDir
 * @param {string} containerId
 * @param {object} [opts]
 * @returns {object} staging summary
 */
export function stageWorkspaceToContainer(repoDir, containerId, opts = {}) {
  if (!containerId) {
    throw new AsdlcError('containerId is required for workspace ingestion', { code: 'ASDLC_ERR_CONTAINER_ID' });
  }
  const execFn = opts.execFn || defaultExec;
  const targetDir = path.resolve(repoDir || process.cwd());
  const lifecycle = opts.lifecycle || detectRepoLifecycle(targetDir).lifecycle;
  const homeDir = opts.homeDir || os.homedir();
  const staged = {
    lifecycle,
    containerId,
    layers: [],
    externalFiles: 0,
    customSkillsInjected: false,
    shmCredentials: [],
  };

  if (lifecycle === 'greenfield') {
    const res = execFn('docker', ['exec', containerId, 'sh', '-c', 'mkdir -p /workspace'], { cwd: targetDir });
    if (res && res.status !== 0 && !opts.ignoreErrors) {
      throw new AsdlcError(`Failed to initialize /workspace in greenfield container: ${res.stderr || res.status}`, {
        code: 'ASDLC_ERR_CONTAINER_STAGE',
      });
    }
    staged.layers.push('greenfield-init');
  } else {
    // Layer 1: Tracked commits via `git archive HEAD`
    const hasHead = Boolean(git(['rev-parse', '--verify', 'HEAD'], targetDir, { allowFail: true }));
    if (hasHead) {
      const archive = execFn('git', ['archive', '--format=tar', 'HEAD'], { cwd: targetDir, encoding: null });
      if (archive && archive.status === 0 && archive.stdout) {
        const cp = execFn('docker', ['cp', '-', `${containerId}:/workspace`], { input: archive.stdout, encoding: null });
        if (cp && cp.status !== 0 && !opts.ignoreErrors) {
          throw new AsdlcError(`Failed to stream git archive into container: ${cp.stderr || cp.status}`, {
            code: 'ASDLC_ERR_CONTAINER_STAGE',
          });
        }
        staged.layers.push('git-archive-head');
      }
    }

    // Layer 2: Uncommitted tracked changes (`git diff --binary HEAD`)
    const diffRes = execFn('git', ['diff', '--binary', 'HEAD'], { cwd: targetDir });
    if (diffRes && diffRes.status === 0 && diffRes.stdout && String(diffRes.stdout).trim().length > 0) {
      execFn('docker', ['exec', '-i', containerId, 'git', 'apply', '--allow-empty', '-'], {
        input: String(diffRes.stdout),
      });
      staged.layers.push('git-diff-head');
    }

    // Layer 3: Untracked non-ignored files (`git ls-files --others --exclude-standard`)
    const untrackedRes = execFn('git', ['ls-files', '--others', '--exclude-standard'], { cwd: targetDir });
    const untracked = String(untrackedRes?.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (untracked.length > 0) {
      for (const rel of untracked) {
        const abs = path.join(targetDir, rel);
        if (!fs.existsSync(abs)) continue;
        const containerDestDir = path.posix.dirname(`/workspace/${rel.replace(/\\/g, '/')}`);
        execFn('docker', ['exec', containerId, 'mkdir', '-p', containerDestDir]);
        execFn('docker', ['cp', abs, `${containerId}:/workspace/${rel.replace(/\\/g, '/')}`]);
      }
      staged.layers.push(`untracked-files:${untracked.length}`);
    }
  }

  // External --from-file attachments
  const fromFiles = Array.isArray(opts.fromFiles) ? opts.fromFiles.filter(Boolean) : [];
  if (fromFiles.length > 0) {
    execFn('docker', ['exec', containerId, 'mkdir', '-p', '/workspace/.asdlc-intake/files']);
    for (const f of fromFiles) {
      const abs = path.isAbsolute(f) ? f : path.resolve(targetDir, f);
      if (fs.existsSync(abs)) {
        execFn('docker', ['cp', abs, `${containerId}:/workspace/.asdlc-intake/files/${path.basename(abs)}`]);
        staged.externalFiles += 1;
      }
    }
  }

  // Tier 1 enterprise custom skills (~/.asdlc/skills/)
  const customSkillsDir = path.join(homeDir, '.asdlc', 'skills');
  if (fs.existsSync(customSkillsDir)) {
    execFn('docker', ['exec', containerId, 'mkdir', '-p', '/workspace/.asdlc']);
    execFn('docker', ['cp', customSkillsDir, `${containerId}:/workspace/.asdlc/skills`]);
    staged.customSkillsInjected = true;
  }

  // Stream volatile AI auth & SSH keys directly into container tmpfs (/dev/shm) with 0600 permissions
  const streamShmFile = (containerDestPath, content) => {
    const dir = path.posix.dirname(containerDestPath);
    execFn('docker', ['exec', '-i', containerId, 'sh', '-c', `mkdir -p ${dir} && chmod 700 ${dir} && cat > ${containerDestPath} && chmod 600 ${containerDestPath}`], {
      input: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    });
    staged.shmCredentials.push(containerDestPath);
  };

  if (opts.harness?.baseConfigPath && fs.existsSync(opts.harness.baseConfigPath)) {
    streamShmFile('/dev/shm/opencode/opencode.json', fs.readFileSync(opts.harness.baseConfigPath, 'utf8'));
  } else if (opts.harness?.generatedConfig) {
    streamShmFile('/dev/shm/opencode/opencode.json', opts.harness.generatedConfig);
  }

  if (opts.harness?.authPath && fs.existsSync(opts.harness.authPath)) {
    streamShmFile('/dev/shm/opencode/auth.json', fs.readFileSync(opts.harness.authPath, 'utf8'));
  } else if (opts.harness?.authPayload) {
    streamShmFile('/dev/shm/opencode/auth.json', opts.harness.authPayload);
  }

  if (opts.sshKeyPath && fs.existsSync(opts.sshKeyPath)) {
    streamShmFile('/dev/shm/.ssh/id_ed25519', fs.readFileSync(opts.sshKeyPath, 'utf8'));
  } else if (opts.sshKeyContent) {
    streamShmFile('/dev/shm/.ssh/id_ed25519', opts.sshKeyContent);
  }

  return staged;
}

/**
 * Syncs verified container workspace artifacts back to host repository according to
 * the Tri-State Repository Lifecycle (`greenfield`, `brownfield`, `established`).
 *
 * @param {string} repoDir
 * @param {string} containerId
 * @param {'greenfield'|'brownfield'|'established'} lifecycleState
 * @param {object} [opts]
 * @returns {object} egress sync summary
 */
export function syncContainerEgressToHost(repoDir, containerId, lifecycleState = 'established', opts = {}) {
  if (!containerId) {
    throw new AsdlcError('containerId is required for egress sync', { code: 'ASDLC_ERR_CONTAINER_ID' });
  }
  const execFn = opts.execFn || defaultExec;
  const targetDir = path.resolve(repoDir || process.cwd());
  const branch = opts.branch || 'HEAD';

  if (lifecycleState === 'greenfield') {
    fs.mkdirSync(targetDir, { recursive: true });
    execFn('docker', ['cp', `${containerId}:/workspace/.`, targetDir]);
    return { lifecycle: 'greenfield', strategy: 'full-copy', dest: targetDir };
  }

  if (lifecycleState === 'brownfield') {
    const syncedPaths = [];
    for (const rel of ['openspec', '.agents', 'AGENTS.md', '.gitignore']) {
      const check = execFn('docker', ['exec', containerId, 'test', '-e', `/workspace/${rel}`]);
      if (!check || check.status === 0) {
        const hostDest = path.join(targetDir, rel);
        execFn('docker', ['cp', `${containerId}:/workspace/${rel}`, hostDest]);
        syncedPaths.push(rel);
      }
    }
    return { lifecycle: 'brownfield', strategy: 'selective-governance-copy', syncedPaths };
  }

  // Established repositories: atomic git bundle fetch without touching host dirty tree
  const bundleHostPath = opts.bundleHostPath || path.join(os.tmpdir(), `asdlc-egress-${containerId.slice(0, 12)}.bundle`);
  execFn('docker', ['exec', containerId, 'git', '-C', '/workspace', 'bundle', 'create', '/tmp/asdlc-out.bundle', branch]);
  execFn('docker', ['cp', `${containerId}:/tmp/asdlc-out.bundle`, bundleHostPath]);
  const targetRef = opts.targetRef || branch;
  execFn('git', ['fetch', bundleHostPath, `${branch}:${targetRef}`], { cwd: targetDir });
  try {
    if (fs.existsSync(bundleHostPath)) fs.unlinkSync(bundleHostPath);
  } catch {
    // ignore cleanup error
  }
  return { lifecycle: 'established', strategy: 'git-bundle-fetch', branch: targetRef };
}

