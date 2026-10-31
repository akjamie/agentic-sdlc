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

export const SUPPORTED_SCHEMA_VERSIONS = new Set(['1']);

// Lazily materializes a stateless XDG_DATA_HOME directory backed by bundled assets
// so ephemeral containers and clean hosts never fail when ~/.local/share/openspec is absent.
export function ensureRuntimeSchemaXdgDir() {
  const xdgBase = path.join(os.tmpdir(), `asdlc-schema-v${builtinSchemaVersion() || '1'}`);
  const dest = path.join(xdgBase, 'openspec', 'schemas', SCHEMA_NAME);
  if (!exists(path.join(dest, 'schema.yaml')) && exists(schemaAssetDir)) {
    ensureDir(path.dirname(dest));
    copyTree(schemaAssetDir, dest);
  }
  return xdgBase;
}

// The gate check: schema version matches repo pin (either centrally installed or statelessly
// bundled when opts.stateless is true), and NOT overridden by a committed local copy.
export function checkSchema(repoRoot, { expectedVersion = null, stateless = false, ...opts } = {}) {
  const override = localOverride(repoRoot);
  if (override.tracked) {
    return {
      ok: false,
      reason: `local schema override detected: ${override.path} is committed and shadows the BU-managed schema`,
      hint: 'remove openspec/schemas/' + SCHEMA_NAME + ' and run `asdlc init`',
    };
  }
  const builtin = builtinSchemaVersion();
  const installed = readInstalledVersion(opts) ?? (stateless ? builtin : null);
  if (!installed) {
    return { ok: false, reason: 'BU-managed schema not installed on this machine', hint: 'run `asdlc init`' };
  }
  if (expectedVersion) {
    const expStr = String(expectedVersion);
    const compatible = stateless
      ? (installed === expStr || builtin === expStr || SUPPORTED_SCHEMA_VERSIONS.has(expStr))
      : installed === expStr;
    if (!compatible) {
      return {
        ok: false,
        reason: `schema version mismatch: machine has v${installed}, repo pins v${expectedVersion}`,
        hint: 'run `asdlc init` or `asdlc upgrade`',
      };
    }
  }
  return { ok: true, installed, builtin, override };
}
