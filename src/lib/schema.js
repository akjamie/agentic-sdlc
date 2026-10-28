import path from 'node:path';
import os from 'node:os';
import { exists, ensureDir, copyTree, removeDir, readText } from './fs.js';
import { parseYaml } from './yaml.js';
import { schemaAssetDir, SCHEMA_NAME } from './paths.js';
import { isPathTracked } from './git.js';

// Mirror OpenSpec's getGlobalDataDir() exactly (dist/core/global-config.js) so
// we install into the directory OpenSpec resolves "user override" schemas from.
export function globalDataDir(env = process.env, platform = os.platform(), homedir = os.homedir()) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  if (env.XDG_DATA_HOME) return join(env.XDG_DATA_HOME, 'openspec');
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'openspec');
    return join(homedir, 'AppData', 'Local', 'openspec');
  }
  return join(homedir, '.local', 'share', 'openspec');
}

export function globalSchemasDir(opts = {}) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? os.platform();
  const homedir = opts.homedir ?? os.homedir();
  return path.join(globalDataDir(env, platform, homedir), 'schemas');
}

export function installedSchemaDir(opts = {}) {
  return path.join(globalSchemasDir(opts), SCHEMA_NAME);
}

// Install the BU-managed schema ONCE per machine (not per repo).
export function installSchema(opts = {}) {
  const dest = installedSchemaDir(opts);
  if (!opts.force && exists(dest)) {
    const installed = readInstalledVersion(opts);
    if (installed) return dest;
  }
  removeDir(dest); // always replace -> no stale half-copies
  ensureDir(globalSchemasDir(opts));
  copyTree(schemaAssetDir, dest);
  return dest;
}

export function readInstalledVersion(opts = {}) {
  const p = path.join(installedSchemaDir(opts), 'schema.yaml');
  if (!exists(p)) return null;
  const parsed = parseYaml(readText(p)) ?? {};
  return parsed.version != null ? String(parsed.version) : null;
}

// The version bundled with THIS asdlc package (the source of truth to install).
export function builtinSchemaVersion() {
  const p = path.join(schemaAssetDir, 'schema.yaml');
  if (!exists(p)) return null;
  const parsed = parseYaml(readText(p)) ?? {};
  return parsed.version != null ? String(parsed.version) : null;
}

// A project-local copy of the managed schema SHADOWS the central one, because
// OpenSpec resolves project > user > package. The BU forbids local overrides.
export function localOverride(repoRoot) {
  const rel = `openspec/schemas/${SCHEMA_NAME}`;
  const present = exists(path.join(repoRoot, rel));
  return { present, tracked: present ? isPathTracked(repoRoot, rel) : false, path: rel };
}

// The gate check: schema installed centrally, version matches the repo pin,
// and NOT overridden by a committed local copy.
export function checkSchema(repoRoot, { expectedVersion = null, ...opts } = {}) {
  const override = localOverride(repoRoot);
  if (override.tracked) {
    return {
      ok: false,
      reason: `local schema override detected: ${override.path} is committed and shadows the BU-managed schema`,
      hint: 'remove openspec/schemas/' + SCHEMA_NAME + ' and run `asdlc init`',
    };
  }
  const installed = readInstalledVersion(opts);
  if (!installed) {
    return { ok: false, reason: 'BU-managed schema not installed on this machine', hint: 'run `asdlc init`' };
  }
  if (expectedVersion && installed !== String(expectedVersion)) {
    return {
      ok: false,
      reason: `schema version mismatch: machine has v${installed}, repo pins v${expectedVersion}`,
      hint: 'run `asdlc init`',
    };
  }
  return { ok: true, installed, builtin: builtinSchemaVersion(), override };
}
