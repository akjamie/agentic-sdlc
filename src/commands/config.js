import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import {
  GLOBAL_CONFIG_FILE,
  loadGlobalConfig,
  saveGlobalConfig,
  validateWorkflowMode,
} from '../lib/config.js';
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

function setNestedIfValue(obj, keyPath, val) {
  if (val !== undefined && val !== null && String(val).trim() !== '') {
    setNested(obj, keyPath, String(val).trim());
  }
}

/**
 * Inspects host CLI authentication (`gh auth status`) and local harness configs
 * (`~/.config/opencode/opencode.json`) to pre-populate sensible wizard defaults.
 */
export function detectHostDefaults({ homeDir = os.homedir(), ghRunner = null } = {}) {
  const hostOpenCode = path.join(homeDir, '.config', 'opencode', 'opencode.json');
  const hasHostOpenCode = fs.existsSync(hostOpenCode);
  let ghAuthenticated = false;
  let ghAccount = null;
  try {
    const runGh = ghRunner || ((cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 }));
    const res = runGh('gh', ['auth', 'status']);
    if (res && res.status === 0) {
      ghAuthenticated = true;
      const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
      const acctMatch = combined.match(/account\s+([^\s(]+)/i);
      ghAccount = acctMatch ? acctMatch[1] : null;
    }
  } catch {
    // ignore offline / missing gh
  }
  return {
    hasHostOpenCode,
    hostOpenCodePath: hasHostOpenCode ? hostOpenCode : null,
    ghAuthenticated,
    ghAccount,
  };
}

/**
 * 4-Section Interactive Setup Wizard (`asdlc config` with zero arguments):
 * 1. Workflow Mode (supervised | spec-first | auto)
 * 2. AI Model & Harness (harness, provider, model, api_key, base_url, review_model)
 * 3. Git & Pull Request Auth (provider, auth method, token / SSH key)
 * 4. Issue Tracker Integration (Jira / Confluence & runner.env_passthrough)
 * Saves atomically to ~/.asdlc/config.yaml with mode 0600.
 */
export async function runConfigWizard(opts = {}) {
  const configPath = opts.configPath || GLOBAL_CONFIG_FILE;
  const cfg = loadGlobalConfig(configPath);
  const detected = detectHostDefaults({ homeDir: opts.homeDir, ghRunner: opts.ghRunner });

  const askFromAnswers = (answers) => {
    return async (key, _promptText, defaultVal = '') => {
      if (Object.hasOwn(answers, key)) return answers[key];
      return defaultVal;
    };
  };

  let askFn = opts.prompter;
  let rl = null;
  if (!askFn && opts.answers) {
    askFn = askFromAnswers(opts.answers);
  } else if (!askFn) {
    if (!process.stdin.isTTY && !opts.nonInteractive) {
      log.info('=== Agentic SDLC Global Configuration (~/.asdlc/config.yaml) ===');
      log.info(`  Detected OpenCode host config: ${detected.hasHostOpenCode ? detected.hostOpenCodePath : 'none'}`);
      log.info(`  Detected GitHub CLI auth:      ${detected.ghAuthenticated ? (detected.ghAccount || 'authenticated') : 'not authenticated'}`);
      log.info('');
      log.info('Interactive setup wizard requires a TTY terminal. Run in a terminal or use:');
      log.info('  asdlc config set <key> <value>');
      log.info('  asdlc config list');
      return { saved: false, config: cfg, detected };
    }
    if (opts.nonInteractive) {
      askFn = askFromAnswers({});
    } else {
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      askFn = async (_key, promptText, defaultVal = '') => {
        const suffix = defaultVal ? ` [${defaultVal}]` : '';
        const ans = await rl.question(`${promptText}${suffix}: `);
        return ans.trim() || defaultVal;
      };
    }
  }

  try {
    log.info('=== Agentic SDLC Global Setup Wizard ===');
    log.info(`  Host OpenCode config: ${detected.hasHostOpenCode ? detected.hostOpenCodePath : 'none (Mode B/C fallback)'}`);
    log.info(`  Host GitHub CLI auth: ${detected.ghAuthenticated ? (detected.ghAccount || 'authenticated') : 'not detected'}`);
    log.info('');

    // Section 1: Workflow Mode
    log.step('1. Workflow Mode');
    const modeAns = await askFn(
      'workflow_mode',
      'Default workflow mode (supervised | spec-first | auto)',
      cfg.workflow_mode || 'supervised'
    );
    cfg.workflow_mode = validateWorkflowMode(modeAns);

    // Section 2: AI Model & Harness
    log.step('2. AI Model & Harness');
    const harness = await askFn('agent.harness', 'Agent harness (opencode | claude)', cfg.agent?.harness || 'opencode');
    const provider = await askFn('agent.provider', 'AI Provider (anthropic | openai | openrouter | custom)', cfg.agent?.provider || 'anthropic');
    const model = await askFn('agent.model', 'Default author model (e.g. anthropic/claude-sonnet-4-5)', cfg.agent?.model || '');
    const reviewModel = await askFn('agent.review_model', 'Independent reviewer model (Player != Referee, optional)', cfg.agent?.review_model || '');
    const apiKey = await askFn('agent.api_key', 'Provider API Key (stored with 0600, leave blank to inherit host)', cfg.agent?.api_key || '');
    const baseUrl = await askFn('agent.base_url', 'Custom API Base URL (optional, for LiteLLM / vLLM / Bedrock)', cfg.agent?.base_url || '');
    setNestedIfValue(cfg, 'agent.harness', harness);
    setNestedIfValue(cfg, 'agent.provider', provider);
    setNestedIfValue(cfg, 'agent.model', model);
    setNestedIfValue(cfg, 'agent.review_model', reviewModel);
    setNestedIfValue(cfg, 'agent.api_key', apiKey);
    setNestedIfValue(cfg, 'agent.base_url', baseUrl);

    // Section 3: Git & Pull Request Auth
    log.step('3. Git & Pull Request Auth');
    const gitHost = await askFn('git.default_host', 'Default Git host', cfg.git?.default_host || 'github.com');
    const gitProvider = await askFn('git.provider', 'Git provider (github | gitlab)', cfg.git?.provider || (gitHost.includes('gitlab') ? 'gitlab' : 'github'));
    const gitToken = await askFn('git.token', 'Git PAT / Token (leave blank to use gh keychain or GitHub App)', cfg.git?.token || '');
    const sshKeyPath = await askFn('git.ssh_key_path', 'SSH private key path for intranet git (optional)', cfg.git?.ssh_key_path || '');
    setNestedIfValue(cfg, 'git.default_host', gitHost);
    setNestedIfValue(cfg, 'git.provider', gitProvider);
    setNestedIfValue(cfg, 'git.token', gitToken);
    setNestedIfValue(cfg, 'git.ssh_key_path', sshKeyPath);

    // Section 4: Issue Tracker Integration (Jira / Confluence)
    log.step('4. Issue Tracker Integration (Jira / Confluence)');
    const jiraUrl = await askFn('env.JIRA_BASE_URL', 'Jira Base URL (e.g. https://jira.company.com, optional)', cfg.env?.JIRA_BASE_URL || '');
    const jiraEmail = await askFn('env.JIRA_EMAIL', 'Jira / Confluence Email (optional)', cfg.env?.JIRA_EMAIL || '');
    const jiraToken = await askFn('env.JIRA_API_TOKEN', 'Jira / Confluence API Token (optional)', cfg.env?.JIRA_API_TOKEN || '');
    const passthrough = await askFn('runner.env_passthrough', 'Container env passthrough globs', cfg.runner?.env_passthrough || 'JIRA_*,CONFLUENCE_*');
    setNestedIfValue(cfg, 'env.JIRA_BASE_URL', jiraUrl);
    setNestedIfValue(cfg, 'env.JIRA_EMAIL', jiraEmail);
    setNestedIfValue(cfg, 'env.JIRA_API_TOKEN', jiraToken);
    setNestedIfValue(cfg, 'runner.env_passthrough', passthrough);

    saveGlobalConfig(cfg, configPath);
    log.ok(`Saved global configuration -> ${configPath} (0600)`);
    return { saved: true, configPath, config: cfg, detected };
  } finally {
    if (rl) rl.close();
  }
}

export function register(program) {
  const configCmd = program
    .command('config')
    .description('manage global ~/.asdlc/config.yaml settings (interactive wizard if no subcommand)')
    .action(async () => {
      await runConfigWizard();
    });

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
