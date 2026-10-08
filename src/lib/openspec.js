import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { exists } from './fs.js';
import { runShell } from './exec.js';

const isWin = process.platform === 'win32';

// PINNED: CI and dev machines must run the same engine version.
export const OPENSPEC_PINNED = '1.13.2';

const quote = (value) => (/[\s"]/.test(value) ? `"${String(value).replace(/"/g, '\\"')}"` : String(value));

function exec(file, args, cwd) {
  if (isWin) {
    return spawnSync(`${quote(file)} ${args.map(quote).join(' ')}`, {
      cwd,
      encoding: 'utf8',
      shell: true,
    });
  }
  return spawnSync(file, args, { cwd, encoding: 'utf8' });
}

function localBin(cwd, name) {
  const candidates = [
    path.join(cwd, 'node_modules', '.bin', isWin ? `${name}.cmd` : name),
    path.join(cwd, 'node_modules', '.bin', name),
  ];
  return candidates.find((p) => exists(p)) ?? null;
}

function which(name) {
  const finder = isWin ? 'where' : 'which';
  const res = spawnSync(finder, [name], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const lines = res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  if (isWin) return lines.find((l) => l.toLowerCase().endsWith('.cmd')) ?? lines[0];
  return lines[0];
}

export function findOpenspec(cwd) {
  const local = localBin(cwd, 'openspec');
  if (local) return { file: local, kind: 'local' };
  const global = which('openspec');
  if (global) return { file: global, kind: 'global' };
  return null;
}

export function runOpenspec(args, cwd) {
  const found = findOpenspec(cwd);
  if (!found) {
    return { status: 127, stdout: '', stderr: 'openspec not found', missing: true };
  }
  const res = exec(found.file, args, cwd);
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    missing: false,
  };
}

export function openspecVersion(cwd) {
  const res = runOpenspec(['--version'], cwd);
  return res.status === 0 ? res.stdout.trim() : null;
}

// Install OpenSpec as a repo devDependency (pinned) when the CLI is absent.
// Works for any repo - creates a package.json first when needed - so
// `asdlc init` is fully self-contained (req: init includes openspec install).
export function ensureOpenspec(repoRoot) {
  if (openspecVersion(repoRoot)) return { installed: true, action: 'present' };

  if (!exists(path.join(repoRoot, 'package.json'))) {
    runShell('npm init -y', repoRoot);
  }
  const res = runShell(
    `npm install --save-dev @fission-ai/openspec@${OPENSPEC_PINNED} --no-audit --no-fund`,
    repoRoot,
  );
  const installed = Boolean(openspecVersion(repoRoot));
  return { installed, action: 'npm-install', status: res.status, stderr: (res.stderr || '').slice(0, 300) };
}

export function validateChange(cwd, { strict = true, all = true } = {}) {
  const args = ['validate'];
  if (all) args.push('--all');
  if (strict) args.push('--strict');
  return runOpenspec(args, cwd);
}
