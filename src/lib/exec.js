import { spawnSync } from 'node:child_process';

export function runShell(command, cwd, { env = {}, timeout = 600000, input } = {}) {
  const mergedEnv = { ...process.env, ...env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete mergedEnv[k];
  }
  const res = spawnSync(command, {
    cwd,
    encoding: 'utf8',
    shell: true,
    timeout,
    env: mergedEnv,
    input, // optional stdin: feeds prompts to a headless verifier agent
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    failed: res.error != null || res.status === null,
    error: res.error?.message,
  };
}