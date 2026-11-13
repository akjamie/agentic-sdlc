import fs, { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanDiffForSecrets } from '../assess/secrets.js';
import { AsdlcError } from './errors.js';
import { git } from './git.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const DEFAULT_RUNNER_IMAGE = `ghcr.io/akjamie/asdlc-runner:${pkg.version}`;
export const SUPPORTED_CONTAINER_ENGINES = Object.freeze(['docker', 'podman']);

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
 * Checks whether an environment variable key is sensitive (tokens, keys, secrets, passwords).
 * Secrets must never be passed via container CLI arguments (-e).
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveEnvKey(key) {
  if (!key) return false;
  const upper = String(key).toUpperCase();
  if (upper.startsWith('GIT_CONFIG_') || upper === 'SSH_AUTH_SOCK' || upper.startsWith('SSL_') || upper.startsWith('NODE_EXTRA_CA_')) {
    return false;
  }
  return /(API_KEY|AUTH_TOKEN|PRIVATE_KEY|BEARER|PASSWORD|SECRET_KEY|_TOKEN$|_SECRET$|_KEY$)/i.test(upper);
}

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
 * Probes whether a container engine CLI & daemon/machine is available.
 * Probes with `<engine> info` (or `--version` fallback) to verify daemon connectivity.
 *
 * @param {string} engine
 * @param {Function} [execFn]
 * @returns {boolean}
 */
export function isEngineAvailable(engine, execFn = defaultExec) {
  if (!engine) return false;
  try {
    const res = execFn(engine, ['info'], { stdio: 'ignore', timeout: 5000 });
    if (res && res.status === 0) return true;
  } catch {
    // continue
  }
  try {
    const res = execFn(engine, ['--version'], { stdio: 'ignore', timeout: 5000 });
    return Boolean(res && res.status === 0);
  } catch {
    return false;
  }
}

/**
 * Resolves the container engine according to precedence:
 * 1. Explicit CLI option `opts.engine`
 * 2. Environment variable `ASDLC_CONTAINER_ENGINE`
 * 3. Global config `runner.engine`
 * 4. Automatic probe order: `docker`, then `podman`
 *
 * @param {object} [opts]
 * @param {Function} [execFn]
 * @returns {'docker'|'podman'}
 */
export function resolveContainerEngine(opts = {}, execFn = defaultExec) {
  const explicit = opts.engine || opts.hostEnv?.ASDLC_CONTAINER_ENGINE || process.env?.ASDLC_CONTAINER_ENGINE || opts.config?.runner?.engine;
  if (explicit && explicit !== 'auto') {
    const norm = String(explicit).toLowerCase().trim();
    if (!SUPPORTED_CONTAINER_ENGINES.includes(norm)) {
      throw new AsdlcError(
        `Unsupported container engine '${explicit}'. Supported engines: ${SUPPORTED_CONTAINER_ENGINES.join(', ')}.`,
        {
          code: 'ASDLC_ERR_INVALID_ENGINE',
          hint: `Specify --engine docker or --engine podman, or unset to allow auto-detection.`,
        }
      );
    }
    if (!isEngineAvailable(norm, execFn)) {
      throw new AsdlcError(
        `Container engine '${norm}' is not available or its daemon is not running.`,
        {
          code: 'ASDLC_ERR_ENGINE_NOT_AVAILABLE',
          hint: `Ensure '${norm}' is installed, in your PATH, and its service/machine is running.`,
        }
      );
    }
    return norm;
  }

  // Automatic probe order: docker first, then podman
  for (const candidate of SUPPORTED_CONTAINER_ENGINES) {
    if (isEngineAvailable(candidate, execFn)) {
      return candidate;
    }
  }

  throw new AsdlcError(
    'No supported container engine found (probed docker, podman). Please start Docker/Podman or run without --container.',
    {
      code: 'ASDLC_ERR_ENGINE_NOT_AVAILABLE',
      hint: 'Install Docker or Podman, ensure the service/machine is running, or execute without the --container flag.',
    }
  );
}

/**
 * Health check helper for `asdlc doctor`.
 * Reports active engine, version, or warn if neither is available.
 *
 * @param {Function} [execFn]
 * @returns {{ status: 'pass'|'warn', detail: string, engine?: string }}
 */
export function checkContainerEngineHealth(execFn = defaultExec) {
  for (const candidate of SUPPORTED_CONTAINER_ENGINES) {
    try {
      const verRes = execFn(candidate, ['--version'], { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
      if (verRes && verRes.status === 0) {
        const verText = String(verRes.stdout || '').trim().split('\n')[0];
        const infoRes = execFn(candidate, ['info'], { stdio: 'ignore', timeout: 5000 });
        if (infoRes && infoRes.status === 0) {
          return { status: 'pass', detail: `${candidate} (${verText})`, engine: candidate };
        }
        return { status: 'warn', detail: `${candidate} installed (${verText}) but daemon/machine unreachable`, engine: candidate };
      }
    } catch {
      // continue
    }
  }
  return { status: 'warn', detail: 'neither docker nor podman detected (optional, required only for --container)' };
}

/**
 * Build hardened OCI `create` argument vector enforcing non-root UID 10001:10001,
 * dropped capabilities, PIDs cap, dubious-ownership immunity, and enterprise proxy/CA passthrough.
 *
 * @param {object} [opts]
 * @returns {string[]}
 */
export function buildContainerCreateArgs(opts = {}) {
  const image = opts.image || DEFAULT_RUNNER_IMAGE;
  const workdir = opts.workdir || CONTAINER_SECURITY_BASELINE.safeDirectory;
  const hostEnv = opts.hostEnv || process.env;
  const engine = opts.engine || 'docker';
  const args = [
    'create',
    '--user',
    CONTAINER_SECURITY_BASELINE.user,
    `--cap-drop=${CONTAINER_SECURITY_BASELINE.capDrop}`,
    `--security-opt=${CONTAINER_SECURITY_BASELINE.securityOpt}`,
    `--pids-limit=${CONTAINER_SECURITY_BASELINE.pidsLimit}`,
    '-w',
    workdir,
  ];

  if (opts.rm !== false) {
    args.push('--rm');
  }

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
    const isDockerDesktop = engine === 'docker' && (platform === 'darwin' || platform === 'win32');
    const hostSock = opts.sshAuthSock || (isDockerDesktop ? '/run/host-services/ssh-auth.sock' : hostEnv?.SSH_AUTH_SOCK);
    const containerSock = hostSock === '/run/host-services/ssh-auth.sock'
      ? '/run/host-services/ssh-auth.sock'
      : '/run/ssh-agent.sock';
    if (hostSock) {
      const mountOpt = (engine === 'podman' && platform === 'linux') ? ':ro,z' : ':ro';
      args.push('-v', `${hostSock}:${containerSock}${mountOpt}`);
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
    if (isSensitiveEnvKey(k)) continue; // §3.3: Never leak secrets via inspect / -e flags
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

export const buildDockerCreateArgs = buildContainerCreateArgs;

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
  const engine = opts.engine || 'docker';
  const staged = {
    lifecycle,
    containerId,
    layers: [],
    externalFiles: 0,
    customSkillsInjected: false,
    shmCredentials: [],
  };

  if (lifecycle === 'greenfield') {
    const res = execFn(engine, ['exec', containerId, 'sh', '-c', 'mkdir -p /workspace'], { cwd: targetDir });
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
        const cp = execFn(engine, ['cp', '-', `${containerId}:/workspace`], { input: archive.stdout, encoding: null });
        if (cp && cp.status !== 0 && !opts.ignoreErrors) {
          throw new AsdlcError(`Failed to stream git archive into container: ${cp.stderr || cp.status}`, {
            code: 'ASDLC_ERR_CONTAINER_STAGE',
          });
        }
        staged.layers.push('git-archive-head');
      }
    }

    // Layer 2: Uncommitted tracked changes (`git diff --binary HEAD`)
    const diffRes = execFn('git', ['diff', '--binary', 'HEAD'], { cwd: targetDir, timeout: 60000 });
    if (diffRes && diffRes.status === 0 && diffRes.stdout && String(diffRes.stdout).trim().length > 0) {
      const applyRes = execFn(engine, ['exec', '-i', containerId, 'git', 'apply', '--allow-empty', '-'], {
        input: String(diffRes.stdout),
        timeout: 60000,
      });
      if (applyRes && applyRes.status !== 0 && !opts.ignoreErrors) {
        throw new AsdlcError(`Failed to apply git diff in container: ${applyRes.stderr || applyRes.status}`, {
          code: 'ASDLC_ERR_CONTAINER_STAGE',
        });
      }
      staged.layers.push('git-diff-head');
    }

    // Layer 3: Untracked non-ignored files (`git ls-files --others --exclude-standard`)
    const untrackedRes = execFn('git', ['ls-files', '--others', '--exclude-standard'], { cwd: targetDir, timeout: 60000 });
    const untracked = String(untrackedRes?.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (untracked.length > 0) {
      for (const rel of untracked) {
        const abs = path.join(targetDir, rel);
        if (!fs.existsSync(abs)) continue;
        const containerDestDir = path.posix.dirname(`/workspace/${rel.replace(/\\/g, '/')}`);
        execFn(engine, ['exec', containerId, 'mkdir', '-p', containerDestDir], { timeout: 15000 });
        const cpRes = execFn(engine, ['cp', abs, `${containerId}:/workspace/${rel.replace(/\\/g, '/')}`], { timeout: 30000 });
        if (cpRes && cpRes.status !== 0 && !opts.ignoreErrors) {
          throw new AsdlcError(`Failed to copy untracked file '${rel}' into container: ${cpRes.stderr || cpRes.status}`, {
            code: 'ASDLC_ERR_CONTAINER_STAGE',
          });
        }
      }
      staged.layers.push(`untracked-files:${untracked.length}`);
    }

    // Ensure non-root agent user (UID 10001:10001) owns the staged workspace
    execFn(engine, ['exec', containerId, 'chown', '-R', '10001:10001', '/workspace'], { timeout: 60000 });
  }

  // External --from-file attachments
  const fromFiles = Array.isArray(opts.fromFiles) ? opts.fromFiles.filter(Boolean) : [];
  if (fromFiles.length > 0) {
    execFn(engine, ['exec', containerId, 'mkdir', '-p', '/workspace/.asdlc-intake/files'], { timeout: 15000 });
    for (const f of fromFiles) {
      const abs = path.isAbsolute(f) ? f : path.resolve(targetDir, f);
      if (fs.existsSync(abs)) {
        const cpRes = execFn(engine, ['cp', abs, `${containerId}:/workspace/.asdlc-intake/files/${path.basename(abs)}`], { timeout: 30000 });
        if (cpRes && cpRes.status !== 0 && !opts.ignoreErrors) {
          throw new AsdlcError(`Failed to copy intake file '${f}' into container: ${cpRes.stderr || cpRes.status}`, {
            code: 'ASDLC_ERR_CONTAINER_STAGE',
          });
        }
        staged.externalFiles += 1;
      }
    }
  }

  // Tier 1 enterprise custom skills (~/.asdlc/skills/)
  const customSkillsDir = path.join(homeDir, '.asdlc', 'skills');
  if (fs.existsSync(customSkillsDir)) {
    execFn(engine, ['exec', containerId, 'mkdir', '-p', '/workspace/.asdlc'], { timeout: 15000 });
    const cpRes = execFn(engine, ['cp', customSkillsDir, `${containerId}:/workspace/.asdlc/skills`], { timeout: 30000 });
    if (cpRes && cpRes.status !== 0 && !opts.ignoreErrors) {
      throw new AsdlcError(`Failed to copy custom skills into container: ${cpRes.stderr || cpRes.status}`, {
        code: 'ASDLC_ERR_CONTAINER_STAGE',
      });
    }
    staged.customSkillsInjected = true;
  }

  // Stream volatile AI auth & SSH keys directly into container tmpfs (/dev/shm) with 0600 permissions
  const streamShmFile = (containerDestPath, content) => {
    const dir = path.posix.dirname(containerDestPath);
    execFn(engine, ['exec', '-i', containerId, 'sh', '-c', `mkdir -p ${dir} && chmod 700 ${dir} && cat > ${containerDestPath} && chmod 600 ${containerDestPath}`], {
      input: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
      timeout: 30000,
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

  // Stream Git / tool credentials and API tokens into /dev/shm/.env with export syntax
  const shmEnv = {};
  if (opts.creds?.token) {
    shmEnv.GH_TOKEN = opts.creds.token;
    shmEnv.GITHUB_TOKEN = opts.creds.token;
  }
  for (const [k, v] of Object.entries(opts.env || {})) {
    if (isSensitiveEnvKey(k) && v !== undefined && v !== null && String(v).length > 0) {
      shmEnv[k] = String(v);
    }
  }
  if (Object.keys(shmEnv).length > 0) {
    const envLines = Object.entries(shmEnv)
      .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
      .join('\n') + '\n';
    streamShmFile('/dev/shm/.env', envLines);
  }

  // Ensure OpenCode agent finds configuration in /dev/shm
  execFn(engine, [
    'exec', containerId, 'sh', '-c',
    'mkdir -p /home/agent/.config /home/agent/.local/share && ln -sfn /dev/shm/opencode /home/agent/.config/opencode && ln -sfn /dev/shm/opencode /home/agent/.local/share/opencode'
  ], { timeout: 15000 });

  return staged;
}

/**
 * Enforces true root-owned read-only immutability (chown 0:0, chmod 0444) on approved spec files
 * inside the container so the unprivileged agent (UID 10001) cannot mutate them.
 *
 * @param {string} containerId
 * @param {string} changeSlug
 * @param {object} [opts]
 * @returns {string[]} locked paths
 */
export function lockContainerSpecsRootReadOnly(containerId, changeSlug, opts = {}) {
  const execFn = opts.execFn || defaultExec;
  const engine = opts.engine || 'docker';
  const lockedPaths = [
    `/workspace/openspec/changes/${changeSlug}/proposal.md`,
    `/workspace/openspec/changes/${changeSlug}/specs`,
  ];
  for (const p of lockedPaths) {
    execFn(engine, ['exec', '-u', '0:0', containerId, 'sh', '-c', `if [ -e "${p}" ]; then chown -R 0:0 "${p}" && chmod -R 0444 "${p}"; fi`], { timeout: 15000 });
  }
  return lockedPaths;
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
  const engine = opts.engine || 'docker';
  const targetDir = path.resolve(repoDir || process.cwd());
  const branch = opts.branch || 'HEAD';

  if (lifecycleState === 'greenfield') {
    fs.mkdirSync(targetDir, { recursive: true });
    execFn(engine, ['cp', `${containerId}:/workspace/.`, targetDir], { timeout: 60000 });
    return { lifecycle: 'greenfield', strategy: 'full-copy', dest: targetDir };
  }

  if (lifecycleState === 'brownfield') {
    const syncedPaths = [];
    for (const rel of ['openspec', '.agents', 'AGENTS.md', '.gitignore']) {
      const check = execFn(engine, ['exec', containerId, 'test', '-e', `/workspace/${rel}`], { timeout: 15000 });
      if (!check || check.status === 0) {
        const hostDest = path.join(targetDir, rel);
        execFn(engine, ['cp', `${containerId}:/workspace/${rel}`, hostDest], { timeout: 30000 });
        syncedPaths.push(rel);
      }
    }
    return { lifecycle: 'brownfield', strategy: 'selective-governance-copy', syncedPaths };
  }

  // Established repositories: atomic git bundle fetch without touching host dirty tree
  const bundleHostPath = opts.bundleHostPath || path.join(os.tmpdir(), `asdlc-egress-${containerId.slice(0, 12)}.bundle`);
  const bundleRes = execFn(engine, ['exec', containerId, 'git', '-C', '/workspace', 'bundle', 'create', '/tmp/asdlc-out.bundle', branch], { timeout: 60000 });
  if (bundleRes && bundleRes.status !== 0 && !opts.ignoreErrors) {
    throw new AsdlcError(`Failed to create git egress bundle inside container: ${bundleRes.stderr || bundleRes.status}`, {
      code: 'ASDLC_ERR_CONTAINER_EGRESS',
    });
  }

  const cpRes = execFn(engine, ['cp', `${containerId}:/tmp/asdlc-out.bundle`, bundleHostPath], { timeout: 60000 });
  if (cpRes && cpRes.status !== 0 && !opts.ignoreErrors) {
    throw new AsdlcError(`Failed to copy git egress bundle from container: ${cpRes.stderr || cpRes.status}`, {
      code: 'ASDLC_ERR_CONTAINER_EGRESS',
    });
  }

  const targetRef = opts.targetRef || branch;
  const egressTrackingRef = `refs/asdlc/egress/${branch.replace(/^refs\/(heads\/)?/, '')}`;
  const fetchRes = execFn('git', ['fetch', bundleHostPath, `${branch}:${egressTrackingRef}`, '--force'], { cwd: targetDir, timeout: 60000 });
  if (fetchRes && fetchRes.status !== 0 && !opts.ignoreErrors) {
    throw new AsdlcError(`Failed to fetch git egress bundle into host repository: ${fetchRes.stderr || fetchRes.status}`, {
      code: 'ASDLC_ERR_CONTAINER_EGRESS',
    });
  }

  // If host workspace is currently on target branch, fast-forward; otherwise update ref
  let headBranch = '';
  try {
    const headRes = execFn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: targetDir, timeout: 5000 });
    headBranch = headRes?.stdout?.trim() || '';
  } catch {
    // ignore
  }

  if (headBranch === branch || headBranch === targetRef) {
    execFn('git', ['merge', '--ff-only', egressTrackingRef], { cwd: targetDir, timeout: 15000 });
  } else {
    execFn('git', ['update-ref', `refs/heads/${targetRef.replace(/^refs\/heads\//, '')}`, egressTrackingRef], { cwd: targetDir, timeout: 15000 });
  }

  try {
    if (fs.existsSync(bundleHostPath)) fs.unlinkSync(bundleHostPath);
  } catch {
    // ignore cleanup error
  }
  return { lifecycle: 'established', strategy: 'git-bundle-fetch', branch: targetRef };
}

/**
 * Build deterministic container CLI invocation command forwarding all orchestrator flags.
 *
 * @param {string|null} target
 * @param {object} [opts]
 * @returns {string}
 */
export function buildContainerRunCommand(target, opts = {}) {
  const parts = ['asdlc', 'run'];
  if (target) parts.push(JSON.stringify(String(target)));
  if (opts.stage) parts.push('--stage', opts.stage);
  if (opts.repo) parts.push('--repo', JSON.stringify(opts.repo));
  if (opts.mode) parts.push('--mode', opts.mode);
  if (opts.model) parts.push('--model', JSON.stringify(opts.model));
  if (opts.reviewModel) parts.push('--review-model', JSON.stringify(opts.reviewModel));
  if (opts.targetBranch) parts.push('--target-branch', JSON.stringify(opts.targetBranch));
  for (const f of (opts.fromFile || [])) parts.push('--from-file', JSON.stringify(f));
  for (const i of (opts.fromIssue || [])) parts.push('--from-issue', JSON.stringify(i));
  return parts.join(' ');
}

/**
 * Executes a full end-to-end containerized pipeline lifecycle:
 * 1. Verifies container engine (Docker / Podman) CLI & daemon/machine
 * 2. Creates container with idle entrypoint (sleep infinity) without --rm
 * 3. Starts container in background so tmpfs (/dev/shm) is mounted and exec is accepted
 * 4. Ingests workspace via 3-layer staging + volatile credentials in /dev/shm
 * 5. Locks specs root-owned (if apply stage)
 * 6. Executes pipeline stage as unprivileged UID 10001 with sourced /dev/shm/.env
 * 7. Syncs egress artifacts back to host repository while container is alive
 * 8. Cleans up container safely
 *
 * @param {string|null} target
 * @param {object} [opts]
 * @returns {Promise<object>} execution summary
 */
export async function runContainerPipeline(target, opts = {}) {
  const execFn = opts.execFn || defaultExec;
  const targetDir = path.resolve(opts.repoRoot || process.cwd());
  const lifecycleInfo = detectRepoLifecycle(targetDir);

  const engine = resolveContainerEngine(opts, execFn);

  const containerName = `asdlc-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const containerSubcommand = buildContainerRunCommand(target, opts);

  const createArgs = buildContainerCreateArgs({
    name: containerName,
    engine,
    image: opts.image || DEFAULT_RUNNER_IMAGE,
    hostEnv: opts.env || process.env,
    sshAuthSock: opts.sshAuthSock,
    sshAgent: opts.sshAgent,
    sshKeyPath: opts.sshKeyPath,
    caCertHostPath: opts.caCertHostPath,
    rm: false, // Must not delete automatically on exit so egress artifacts can be synced
    cmd: ['sleep', 'infinity'], // Keeps container alive as daemon for staging, execution, and egress
  });

  const createRes = execFn(engine, createArgs);
  if (!createRes || createRes.status !== 0) {
    throw new AsdlcError(`${engine} create failed: ${createRes?.stderr || createRes?.status}`, {
      code: 'ASDLC_ERR_CONTAINER_CREATE',
    });
  }
  const containerId = String(createRes.stdout || '').trim() || containerName;

  try {
    // 1. Start container in background so tmpfs (/dev/shm) is active and exec works
    const startRes = execFn(engine, ['start', containerId]);
    if (startRes && startRes.status !== 0) {
      throw new AsdlcError(`Failed to start container daemon: ${startRes.stderr || startRes.status}`, {
        code: 'ASDLC_ERR_CONTAINER_START',
      });
    }

    // 2. Stage workspace and inject credentials into active /dev/shm
    stageWorkspaceToContainer(targetDir, containerId, {
      ...opts,
      engine,
      execFn,
      lifecycle: lifecycleInfo.lifecycle,
    });

    // 3. Lock specs root-owned if apply stage
    if (opts.stage === 'apply' && opts.slug) {
      lockContainerSpecsRootReadOnly(containerId, opts.slug, { engine, execFn });
    }

    // 4. Run stage command inside the running container as unprivileged UID 10001
    const execTimeout = opts.timeoutMs ?? (opts.stage === 'apply' ? 1800000 : 600000);
    const runRes = execFn(engine, [
      'exec',
      '-u', CONTAINER_SECURITY_BASELINE.user,
      containerId,
      'sh', '-c',
      `if [ -f /dev/shm/.env ]; then . /dev/shm/.env; fi; exec ${containerSubcommand}`,
    ], {
      stdio: opts.stdio || 'inherit',
      timeout: execTimeout,
    });
    const exitCode = runRes?.status ?? 0;

    // 5. Sync egress artifacts back to host while container is still alive
    let egress = null;
    if (exitCode === 0 && !opts.skipEgress) {
      egress = syncContainerEgressToHost(targetDir, containerId, lifecycleInfo.lifecycle, {
        ...opts,
        engine,
        execFn,
        branch: opts.branch || 'HEAD',
      });
    }

    return {
      engine,
      containerId,
      exitCode,
      egress,
      stdout: runRes?.stdout || '',
      stderr: runRes?.stderr || '',
    };
  } finally {
    // 6. Guarantee container removal
    execFn(engine, ['rm', '-f', containerId]);
  }
}

