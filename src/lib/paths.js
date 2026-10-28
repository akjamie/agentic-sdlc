import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, findUp } from './fs.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const packageRoot = path.resolve(here, '..', '..');
export const assetsDir = path.join(packageRoot, 'assets');
export const configAssetFile = path.join(assetsDir, 'config', 'config.yaml');
export const ciAssetDir = path.join(assetsDir, 'ci');
export const githooksAssetDir = path.join(assetsDir, 'githooks');
export const policyAssetFile = path.join(assetsDir, 'policy', 'policy.yaml');
export const skillsAssetDir = path.join(assetsDir, 'skills');

// The BU-managed OpenSpec schema: installed ONCE per machine into OpenSpec's
// global schemas dir. Repos carry NO copy and must not override it.
// The schema NAME (agentic-repo-change) lives in schema.yaml, not the path.
export const SCHEMA_NAME = 'agentic-repo-change';
export const schemaAssetDir = path.join(assetsDir, 'schema');

// We REUSE OpenSpec's engine: the default schema, not a fork.
export const DEFAULT_SCHEMA = 'spec-driven';

export const OPENSPEC_DIR = 'openspec';
export const CHANGES_DIR = 'changes';
export const SPECS_DIR = 'specs';

export function findRepoRoot(start = process.cwd()) {
  return findUp(start, (dir) => exists(path.join(dir, '.git')) || exists(path.join(dir, OPENSPEC_DIR)));
}

export function resolveRepoRoot(opts = {}) {
  if (opts.repoRoot) return path.resolve(opts.repoRoot);
  return findRepoRoot(process.cwd()) ?? process.cwd();
}

export function openspecDir(repoRoot) {
  return path.join(repoRoot, OPENSPEC_DIR);
}

export function changeDir(repoRoot, changeId) {
  const slug = String(changeId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return path.join(openspecDir(repoRoot), CHANGES_DIR, slug);
}
