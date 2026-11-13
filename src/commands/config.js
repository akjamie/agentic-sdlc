import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGlobalConfig, saveGlobalConfig, validateWorkflowMode } from '../lib/config.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';

/**
 * Imports an enterprise OpenCode JSON template into ~/.asdlc/agent/opencode/opencode.json
 * with mode 0600 without deep-merging or mutating host files.
 */
export function importAgentConfigTemplate(sourceFile, { homeDir = os.homedir() } = {}) {
  const abs = path.resolve(sourceFile);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    fail(`Agent configuration template not found: ${sourceFile}`, {
      code: 'AGENT_CONFIG_NOT_FOUND',
      hint: 'Pass a valid opencode.json file path via --file <path>.',
    });
  }
  const raw = fs.readFileSync(abs, 'utf8');
  try {
    JSON.parse(raw);
  } catch (err) {
    fail(`Invalid JSON in agent template '${sourceFile}': ${err.message}`, {
      code: 'INVALID_AGENT_CONFIG_JSON',
    });
  }
  const destDir = path.join(homeDir, '.asdlc', 'agent', 'opencode');
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  const destPath = path.join(destDir, 'opencode.json');
  fs.writeFileSync(destPath, raw, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(destPath, 0o600);
  } catch {
    // Best-effort chmod on Windows
  }
  return destPath;
}

function setNested(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!curr[p] || typeof curr[p] !== 'object') {
      curr[p] = {};
    }
    curr = curr[p];
  }
  curr[parts[parts.length - 1]] = value;
}

function getNested(obj, keyPath) {
  const parts = keyPath.split('.');
  let curr = obj;
  for (const p of parts) {
    if (curr == null || typeof curr !== 'object') return undefined;
    curr = curr[p];
  }
  return curr;
}

function unsetNested(obj, keyPath) {
  const parts = keyPath.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (curr == null || typeof curr !== 'object') return;
    curr = curr[p];
  }
  delete curr[parts[parts.length - 1]];
}

function maskSensitive(obj, showSecrets) {
  if (showSecrets || !obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const isSensitive = /(?:key|token|secret|password)$/i.test(k);
    if (isSensitive && typeof v === 'string') {
      out[k] = '********';
    } else if (v && typeof v === 'object') {
      out[k] = maskSensitive(v, showSecrets);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function flattenConfig(obj, prefix = '') {
  const entries = [];
  if (!obj || typeof obj !== 'object') return entries;
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
      entries.push(...flattenConfig(v, fullKey));
    } else {
      entries.push([fullKey, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    }
  }
  return entries;
}

export function register(program) {
  const configCmd = program
    .command('config')
    .description('manage global ~/.asdlc/config.yaml settings (workflow_mode, git hosts, agent)');

  configCmd
    .command('set <key> <value>')
    .description('set a global configuration key (e.g. workflow_mode supervised)')
    .action((key, value) => {
      const cfg = loadGlobalConfig();
      if (key === 'workflow_mode') {
        const validated = validateWorkflowMode(value);
        setNested(cfg, key, validated);
      } else {
        setNested(cfg, key, value);
      }
      saveGlobalConfig(cfg);
      log.ok(`set ${key} = ${value}`);
    });

  configCmd
    .command('get <key>')
    .description('get a global configuration key')
    .option('--show-secrets', 'reveal masked secret value')
    .action((key, opts) => {
      const cfg = loadGlobalConfig();
      const val = getNested(cfg, key);
      if (val === undefined) {
        log.plain('(unset)');
        return;
      }
      const isSensitiveKey = /(?:key|token|secret|password)$/i.test(key);
      if (isSensitiveKey && !opts.showSecrets && typeof val === 'string') {
        log.plain('********');
      } else if (typeof val === 'object' && val !== null) {
        const masked = maskSensitive(val, opts.showSecrets);
        log.plain(JSON.stringify(masked, null, 2));
      } else {
        log.plain(String(val));
      }
    });

  configCmd
    .command('unset <key>')
    .description('remove a global configuration key')
    .action((key) => {
      const cfg = loadGlobalConfig();
      unsetNested(cfg, key);
      saveGlobalConfig(cfg);
      log.ok(`unset ${key}`);
    });

  configCmd
    .command('list')
    .description('list all global configuration settings')
    .option('--show-secrets', 'reveal masked secret values')
    .option('--json', 'output in structured JSON')
    .action((opts) => {
      const cfg = loadGlobalConfig();
      const masked = maskSensitive(cfg, opts.showSecrets);
      if (opts.json) {
        log.plain(JSON.stringify(masked, null, 2));
      } else {
        const entries = flattenConfig(masked);
        if (entries.length === 0) {
          log.plain('(no global configuration set)');
        } else {
          for (const [k, v] of entries) {
            log.plain(`${k} = ${v}`);
          }
        }
      }
    });

  configCmd
    .command('agent')
    .description('import enterprise opencode.json template into ~/.asdlc/agent/opencode/opencode.json (0600)')
    .requiredOption('--file <path>', 'path to enterprise opencode.json template')
    .action((opts) => {
      const dest = importAgentConfigTemplate(opts.file);
      log.ok(`imported enterprise agent config -> ${dest} (0600)`);
    });
}
