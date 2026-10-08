import path from 'node:path';
import { resolveRepoRoot, openspecDir } from './paths.js';
import { exists, readText } from './fs.js';
import { readYaml } from './yaml.js';
import { fail } from './errors.js';

export function toChangeSlug(changeId) {
  return String(changeId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function requireRepo(opts = {}) {
  const repoRoot = resolveRepoRoot(opts);
  if (!exists(openspecDir(repoRoot))) {
    fail(`no OpenSpec project found at ${repoRoot}`, {
      code: 'NOT_INITIALIZED',
      hint: 'Run `asdlc init` first.',
    });
  }
  return repoRoot;
}

export function jsonOut(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// Policy-as-code for the lint harness: severities live in the repo's
// openspec/config.yaml so a BU can tune policy without forking the tool.
export function readLintConfig(repoRoot) {
  const cfg = path.join(openspecDir(repoRoot), 'config.yaml');
  const empty = { rules: {}, version: null };
  if (!exists(cfg)) return empty;
  try {
    const parsed = readYaml(cfg) ?? {};
    const lint = parsed.lint ?? {};
    return {
      rules: typeof lint.rules === 'object' && lint.rules !== null ? lint.rules : {},
      version: typeof lint.version === 'string' ? lint.version : null,
    };
  } catch {
    return empty;
  }
}
