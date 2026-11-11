import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readYaml, stringifyYaml } from './yaml.js';
import { loadPolicy } from './policy.js';
import { fail } from './errors.js';

export const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.asdlc');
export const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, 'config.yaml');

export const VALID_WORKFLOW_MODES = ['supervised', 'spec-first', 'auto'];
export const DEFAULT_WORKFLOW_MODE = 'supervised';

export const MODE_RANK = {
  auto: 1,
  supervised: 2,
  'spec-first': 3
};

/**
 * Loads machine-level global config from ~/.asdlc/config.yaml.
 * Returns empty object if file does not exist or fails to parse.
 */
export function loadGlobalConfig(configPath = GLOBAL_CONFIG_FILE) {
  try {
    if (fs.existsSync(configPath)) {
      const parsed = readYaml(configPath);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch {
    // Ignore read errors, fall back to empty config
  }
  return {};
}

/**
 * Writes machine-level global config to ~/.asdlc/config.yaml with 0600 permissions.
 */
export function saveGlobalConfig(config, configPath = GLOBAL_CONFIG_FILE) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const text = stringifyYaml(config);
  fs.writeFileSync(configPath, text, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Best-effort chmod on Windows platforms
  }
}

/**
 * Validates whether a mode string is valid.
 * Fails closed if 'single-pr' (internal topology, not configurable mode) or unknown string.
 */
export function validateWorkflowMode(mode) {
  if (!mode) return DEFAULT_WORKFLOW_MODE;
  const norm = String(mode).toLowerCase().trim();
  if (norm === 'single-pr') {
    fail("Configured mode cannot be 'single-pr'. Valid modes are: 'supervised', 'spec-first', 'auto'. Single-PR is an internal topology granted to L0/L1 changes.", {
      code: 'INVALID_WORKFLOW_MODE',
      hint: "Use 'supervised' (default), 'spec-first', or 'auto'."
    });
  }
  if (!VALID_WORKFLOW_MODES.includes(norm)) {
    fail(`Invalid workflow mode '${mode}'. Allowed modes: supervised, spec-first, auto`, {
      code: 'INVALID_WORKFLOW_MODE',
      hint: "Choose one of 'supervised', 'spec-first', 'auto'."
    });
  }
  return norm;
}

/**
 * Resolves the effective workflow mode across the 5-tier precedence chain:
 * CLI (--mode) > Env (ASDLC_WORKFLOW_MODE) > Repo (.sdlc/policy.yaml) > Global (~/.asdlc/config.yaml) > Default ('supervised')
 *
 * Enforces monotonic policy tightening against repo floor:
 * If repo policy specifies a workflow_mode floor (e.g. 'supervised' or 'spec-first'),
 * any higher-tier setting cannot downgrade security below that floor (fails with ILLEGAL_MODE_DOWNGRADE).
 */
export function resolveWorkflowMode({
  cliMode = null,
  envMode = null,
  repoPolicy = null,
  repoRoot = null,
  globalConfig = null,
  baseRef = null,
  customGlobalPath = null
} = {}) {
  // 1. Resolve Repo Floor
  let repoMode = repoPolicy?.workflow_mode ?? null;
  if (!repoMode && repoRoot) {
    try {
      const pol = loadPolicy(repoRoot, { baseRef });
      if (pol?.workflow_mode) {
        repoMode = pol.workflow_mode;
      }
    } catch {
      // ignore
    }
  }
  const repoFloor = repoMode ? validateWorkflowMode(repoMode) : null;

  // 2. Resolve requested mode by precedence:
  // CLI > Env > Repo > Global > Default
  let requestedMode = null;
  let source = null;

  if (cliMode) {
    requestedMode = validateWorkflowMode(cliMode);
    source = 'CLI';
  } else if (envMode || process.env.ASDLC_WORKFLOW_MODE) {
    requestedMode = validateWorkflowMode(envMode || process.env.ASDLC_WORKFLOW_MODE);
    source = 'Env';
  } else if (repoFloor) {
    requestedMode = repoFloor;
    source = 'Repo';
  } else {
    const globalCfg = globalConfig || loadGlobalConfig(customGlobalPath || GLOBAL_CONFIG_FILE);
    if (globalCfg?.workflow_mode) {
      requestedMode = validateWorkflowMode(globalCfg.workflow_mode);
      source = 'Global';
    } else {
      requestedMode = DEFAULT_WORKFLOW_MODE;
      source = 'Default';
    }
  }

  // 3. Enforce monotonic policy tightening against Repo Floor:
  // spec-first (3) > supervised (2) > auto (1)
  if (repoFloor && source !== 'Repo') {
    const requestedRank = MODE_RANK[requestedMode] ?? 0;
    const floorRank = MODE_RANK[repoFloor] ?? 0;
    if (requestedRank < floorRank) {
      fail(`cannot downgrade workflow mode to '${requestedMode}': repository policy enforces '${repoFloor}' as minimum security floor`, {
        code: 'ILLEGAL_MODE_DOWNGRADE',
        hint: `Repository policy (.sdlc/policy.yaml) sets a minimum floor of '${repoFloor}'. You may tighten it to stricter modes, but cannot relax it.`
      });
    }
  }

  return requestedMode;
}
