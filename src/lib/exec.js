import { spawnSync } from 'node:child_process';

export function runShell(command, cwd, { env = {}, timeout = 600000, input } = {}) {
  const res = spawnSync(command, {
    cwd,
    encoding: 'utf8',
    shell: true,
    timeout,
    env: { ...process.env, ...env },
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