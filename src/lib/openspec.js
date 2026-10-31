import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { exists } from './fs.js';
import { packageRoot } from './paths.js';
import { readInstalledVersion, ensureRuntimeSchemaXdgDir } from './schema.js';

const isWin = process.platform === 'win32';
const require = createRequire(import.meta.url);

// PINNED: bundled directly in @akjamie/agentic-sdlc dependencies so target Go/Java/Python
// repositories are NEVER polluted with package.json or node_modules.
export const OPENSPEC_PINNED = '1.13.2';

const quote = (value) => (/[\s"]/.test(value) ? `"${String(value).replace(/"/g, '\\"')}"` : String(value));

function resolveBundledOpenspecJs() {
  try {
    const entry = require.resolve('@fission-ai/openspec');
    const pkgDir = path.resolve(path.dirname(entry), '..');
    const binJs = path.join(pkgDir, 'bin', 'openspec.js');
    if (exists(binJs)) return binJs;
  } catch { /* fallback */ }

  const fallback = path.join(packageRoot, 'node_modules', '@fission-ai', 'openspec', 'bin', 'openspec.js');
  return exists(fallback) ? fallback : null;
}

function localBin(cwd, name) {
  if (!cwd) return null;
  const candidates = [
    path.join(cwd, 'node_modules', '.bin', isWin ? `${name}.cmd` : name),
    path.join(cwd, 'node_modules', '.bin', name),
  ];
  return candidates.find((p) => exists(p)) ?? null;
}

function which(name, env = process.env) {
  const finder = isWin ? 'where' : 'which';
  const res = spawnSync(finder, [name], { encoding: 'utf8', env });
  if (res.status !== 0) return null;
  const lines = res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  if (isWin) return lines.find((l) => l.toLowerCase().endsWith('.cmd')) ?? lines[0];
  return lines[0];
}

export function findOpenspec(cwd, opts = {}) {
  const bundled = resolveBundledOpenspecJs();
  if (bundled) return { file: bundled, kind: 'bundled', isNodeScript: true };
  const local = localBin(cwd, 'openspec');
  if (local) return { file: local, kind: 'local', isNodeScript: false };
  const global = which('openspec', opts.env);
  if (global) return { file: global, kind: 'global', isNodeScript: false };
  return null;
}

function execFound(found, args, cwd, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  // Stateless container fallback: if host ~/.local/share/openspec lacks the managed schema,
  // transparently supply bundled schema via XDG_DATA_HOME.
  if (!env.XDG_DATA_HOME && !readInstalledVersion({ env })) {
    try {
      env.XDG_DATA_HOME = ensureRuntimeSchemaXdgDir();
    } catch { /* non-fatal */ }
  }

  if (found.isNodeScript) {
    return spawnSync(process.execPath, [found.file, ...args], { cwd, encoding: 'utf8', env });
  }
  if (isWin) {
    return spawnSync(`${quote(found.file)} ${args.map(quote).join(' ')}`, {
      cwd,
      encoding: 'utf8',
      shell: true,
      env,
    });
  }
  return spawnSync(found.file, args, { cwd, encoding: 'utf8', env });
}

export function runOpenspec(args, cwd) {
  const found = findOpenspec(cwd);
  if (!found) {
    return { status: 127, stdout: '', stderr: 'openspec not found', missing: true };
  }
  const res = execFound(found, args, cwd);
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

// Resolves OpenSpec from asdlc's own bundled runtime without EVER writing package.json
// or node_modules into the target business repository (safe for Go, Java, Rust, Python repos).
export function ensureOpenspec(repoRoot) {
  const found = findOpenspec(repoRoot);
  if (found) {
    return { installed: true, action: found.kind === 'bundled' ? 'bundled' : 'present' };
  }
  return {
    installed: false,
    action: 'missing',
    status: 127,
    stderr: 'Bundled @fission-ai/openspec engine not found; reinstall @akjamie/agentic-sdlc.',
  };
}

export function validateChange(cwd, { strict = true, all = true } = {}) {
  const args = ['validate'];
  if (all) args.push('--all');
  if (strict) args.push('--strict');
  return runOpenspec(args, cwd);
}
