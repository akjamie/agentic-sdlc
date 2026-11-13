import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { exists } from './fs.js';
import { fail } from './errors.js';

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Mints a signed RS256 JSON Web Token (JWT) for authenticating as a GitHub App.
 */
export function mintGitHubAppJwt(appId, privateKeyPem, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!appId || !privateKeyPem) {
    fail('GitHub App JWT requires both appId and privateKeyPem', { code: 'ASDLC_ERR_AUTH_CONFIG' });
  }
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    iat: nowSec - 60,
    exp: nowSec + 540,
    iss: String(appId),
  }));
  const signingInput = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(privateKeyPem));
  return `${signingInput}.${signature}`;
}

/**
 * Resolves Git & PR credentials in priority order:
 * 1. GitHub App Installation Token (scoped, triggers downstream CI)
 * 2. GitLab Project Access Token
 * 3. Scoped Fine-Grained PAT
 * 4. Developer CLI Keychain (`gh auth token --hostname <host>`)
 */
export async function resolveGitCredentials({
  env = process.env,
  globalConfig = null,
  host = 'github.com',
  provider = null,
  execFn = null,
  fetchFn = null,
} = {}) {
  const effectiveHost = String(host || globalConfig?.git?.default_host || 'github.com').toLowerCase();
  const inferredProvider = provider
    || globalConfig?.git?.provider
    || (effectiveHost.includes('gitlab') ? 'gitlab' : 'github');

  // 1. GitHub App Installation Token
  const appToken = env?.ASDLC_GITHUB_APP_TOKEN;
  const appId = env?.ASDLC_GITHUB_APP_ID || globalConfig?.git?.app_id;
  const installationId = env?.ASDLC_GITHUB_APP_INSTALLATION_ID || globalConfig?.git?.installation_id;
  const privateKeyRaw = env?.ASDLC_GITHUB_APP_PRIVATE_KEY || globalConfig?.git?.private_key;
  const privateKeyPath = env?.ASDLC_GITHUB_APP_PRIVATE_KEY_PATH || globalConfig?.git?.private_key_path;
  const privateKeyPem = privateKeyRaw || (privateKeyPath && exists(privateKeyPath) ? fs.readFileSync(privateKeyPath, 'utf8') : null);

  if (appToken || (appId && installationId && privateKeyPem)) {
    let token = appToken || null;
    if (!token && appId && installationId && privateKeyPem) {
      const jwt = mintGitHubAppJwt(appId, privateKeyPem);
      const apiBase = effectiveHost === 'github.com'
        ? 'https://api.github.com'
        : `https://${effectiveHost}/api/v3`;
      const doFetch = fetchFn || globalThis.fetch;
      if (typeof doFetch !== 'function') {
        fail('fetch API unavailable for exchanging GitHub App installation token', { code: 'ASDLC_ERR_AUTH_EXCHANGE' });
      }
      const res = await doFetch(`${apiBase}/app/installations/${installationId}/access_tokens`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'agentic-sdlc',
        },
      });
      if (!res.ok) {
        fail(`GitHub App token exchange failed with status ${res.status}`, { code: 'ASDLC_ERR_AUTH_EXCHANGE' });
      }
      const json = await res.json();
      token = json.token;
    }
    return {
      type: 'github-app',
      provider: 'github',
      token,
      host: effectiveHost,
      username: 'x-access-token',
      authorName: 'asdlc-bot[bot]',
      authorEmail: 'asdlc-bot[bot]@users.noreply.github.com',
      triggersCi: true,
    };
  }

  // 2. GitLab Project Access Token
  const gitlabToken = env?.ASDLC_GITLAB_TOKEN
    || env?.GITLAB_TOKEN
    || (inferredProvider === 'gitlab' ? globalConfig?.git?.token : null);
  if (gitlabToken) {
    return {
      type: 'gitlab-project-token',
      provider: 'gitlab',
      token: gitlabToken,
      host: effectiveHost,
      username: 'oauth2',
      authorName: 'asdlc-bot',
      authorEmail: 'asdlc-bot@noreply.gitlab.com',
      triggersCi: true,
    };
  }

  // 3. Scoped Fine-Grained PAT
  const scopedPat = env?.ASDLC_GIT_TOKEN || globalConfig?.git?.token || env?.GH_TOKEN || env?.GITHUB_TOKEN;
  if (scopedPat) {
    return {
      type: 'scoped-pat',
      provider: 'github',
      token: scopedPat,
      host: effectiveHost,
      username: 'x-access-token',
      authorName: env?.GIT_AUTHOR_NAME || 'asdlc-bot',
      authorEmail: env?.GIT_AUTHOR_EMAIL || 'asdlc-bot@users.noreply.github.com',
      triggersCi: env?.GITHUB_ACTIONS !== 'true' || Boolean(env?.ASDLC_GIT_TOKEN || globalConfig?.git?.token),
    };
  }

  // 4. Developer CLI Keychain fallback
  try {
    const runGh = execFn || ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const out = String(runGh('gh', ['auth', 'token', '--hostname', effectiveHost]) || '').trim();
    if (out) {
      return {
        type: 'developer-keychain',
        provider: 'github',
        token: out,
        host: effectiveHost,
        username: 'x-access-token',
        authorName: env?.GIT_AUTHOR_NAME || 'asdlc-bot',
        authorEmail: env?.GIT_AUTHOR_EMAIL || 'asdlc-bot@users.noreply.github.com',
        triggersCi: true,
      };
    }
  } catch {
    // ignore keychain failure
  }

  return null;
}

/**
 * Builds an isolated in-memory Git/CLI environment with credential.helper wired dynamically
 * so tokens are never written to disk or .git/config.
 */
export function buildEphemeralGitEnv(cred, baseEnv = process.env) {
  const out = { ...baseEnv, GIT_TERMINAL_PROMPT: '0' };
  if (!cred || !cred.token) return out;

  if (cred.provider === 'gitlab') {
    out.GITLAB_TOKEN = cred.token;
  } else {
    out.GH_TOKEN = cred.token;
    out.GITHUB_TOKEN = cred.token;
  }

  const tokenVar = cred.provider === 'gitlab' ? '$GITLAB_TOKEN' : '$GH_TOKEN';
  const existingCount = Number(out.GIT_CONFIG_COUNT || 0);
  out[`GIT_CONFIG_KEY_${existingCount}`] = 'credential.helper';
  out[`GIT_CONFIG_VALUE_${existingCount}`] = `!f() { echo username=${cred.username || 'x-access-token'}; echo password=${tokenVar}; }; f`;
  out.GIT_CONFIG_COUNT = String(existingCount + 1);
  return out;
}

/**
 * Formats an automated bot commit message with an optional human Co-authored-by trailer.
 */
export function formatBotCommitMessage(message, { coAuthorName = null, coAuthorEmail = null } = {}) {
  const base = String(message ?? '').trim();
  if (coAuthorName && coAuthorEmail) {
    return `${base}\n\nCo-authored-by: ${coAuthorName} <${coAuthorEmail}>`;
  }
  return base;
}

function maskToken(value) {
  const str = String(value);
  if (str.length <= 8) return '********';
  const prefixMatch = str.match(/^([a-zA-Z]+_)/);
  const prefix = prefixMatch ? prefixMatch[1] : str.slice(0, 3);
  const tail = str.slice(-4);
  return `${prefix}************${tail}`;
}

/**
 * Redacts known credential patterns, URL basic-auth secrets, PEM private keys,
 * and explicit runtime secrets from stdout/stderr/artifact strings.
 */
export function redactSecrets(text, explicitSecrets = []) {
  let out = String(text ?? '');
  if (!out) return out;

  // Mask explicit runtime secret strings first
  for (const sec of explicitSecrets) {
    if (sec && typeof sec === 'string' && sec.length >= 4) {
      const masked = maskToken(sec);
      out = out.split(sec).join(masked);
    }
  }

  // Mask PEM private keys
  out = out.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');

  // Mask Bearer / Basic auth headers
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, (_, scheme) => `${scheme} ************`);

  // Mask URL-embedded credentials: https://user:secret@host
  out = out.replace(/(https?:\/\/[^:/\s]+:)([^@\s]+)(@)/gi, (_, pre, _secret, at) => `${pre}************${at}`);

  // Mask known provider tokens (GitHub, GitLab, Anthropic, OpenAI/Ark)
  out = out.replace(/\b(?:ghp|ghs|ghu|gho|ghr|github_pat|glpat|sk-ant|sk|xoxb|xoxp)[_-][A-Za-z0-9_-]{8,}\b/g, (m) => maskToken(m));

  return out;
}

/**
 * Resolves AI harness base configuration following the Zero-Schema-Loss whole-file policy:
 * 1. Imported enterprise config at ~/.asdlc/agent/opencode/opencode.json
 * 2. Host native config at ~/.config/opencode/opencode.json (plus auth.json)
 * 3. Generated single-provider fallback from globalConfig.agent
 * Model selection overrides are passed via CLI `-m <provider/model>` flags without mutating host files.
 */
export function resolveAgentHarnessConfig({
  globalConfig = {},
  cliModel = null,
  cliReviewModel = null,
  homeDir = os.homedir(),
  env = process.env,
} = {}) {
  const harness = (env?.ASDLC_AGENT_HARNESS || globalConfig?.agent?.harness || 'opencode').toLowerCase();
  const enterpriseConfigPath = path.join(homeDir, '.asdlc', 'agent', 'opencode', 'opencode.json');
  const hostOpenCodeDir = path.join(homeDir, '.config', 'opencode');
  const hostConfigPath = path.join(hostOpenCodeDir, 'opencode.json');
  const hostAuthPath = path.join(homeDir, '.local', 'share', 'opencode', 'auth.json');

  let configSource = 'generated-minimal';
  let baseConfigPath = null;
  let generatedConfig = null;

  if (exists(enterpriseConfigPath)) {
    configSource = 'enterprise-template';
    baseConfigPath = enterpriseConfigPath;
  } else if (exists(hostConfigPath)) {
    configSource = 'host-inherited';
    baseConfigPath = hostConfigPath;
  } else {
    const provider = globalConfig?.agent?.provider || 'anthropic';
    const baseUrl = globalConfig?.agent?.base_url || null;
    const customHeaders = globalConfig?.agent?.custom_headers || null;
    const providerOptions = {};
    if (baseUrl) providerOptions.baseURL = baseUrl;
    if (customHeaders && typeof customHeaders === 'object') providerOptions.headers = customHeaders;
    generatedConfig = {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        [provider]: Object.keys(providerOptions).length > 0 ? { options: providerOptions } : {},
      },
    };
  }

  const authorModel = cliModel || env?.ASDLC_AGENT_MODEL || globalConfig?.agent?.model || null;
  const reviewModel = cliReviewModel || env?.ASDLC_REVIEW_MODEL || globalConfig?.agent?.review_model || authorModel;
  const providerName = globalConfig?.agent?.provider || 'anthropic';
  const apiKey = env?.ASDLC_AGENT_API_KEY || globalConfig?.agent?.api_key || null;
  const authPayload = apiKey
    ? { [providerName]: { type: 'api', key: apiKey } }
    : null;

  const buildRunArgs = (prompt, modelOverride = null) => {
    if (harness === 'claude') {
      const args = ['-p', '--dangerously-skip-permissions'];
      if (modelOverride) args.push('--model', modelOverride);
      args.push(prompt);
      return args;
    }
    const args = ['run'];
    if (modelOverride) args.push('-m', modelOverride);
    args.push(prompt);
    return args;
  };

  return {
    harness,
    configSource,
    baseConfigPath,
    authPath: exists(hostAuthPath) ? hostAuthPath : null,
    generatedConfig,
    authPayload,
    model: authorModel,
    authorModel,
    reviewModel,
    heterogeneous: Boolean(authorModel && reviewModel && authorModel !== reviewModel),
    buildAuthorArgs: (prompt) => buildRunArgs(prompt, authorModel),
    buildReviewerArgs: (prompt) => buildRunArgs(prompt, reviewModel),
  };
}

/**
 * Resolves explicit `env.*` variables and `runner.env_passthrough` wildcard globs
 * (e.g. `JIRA_*,CONFLUENCE_*`) into an environment map for intake and container execution.
 */
export function resolvePassthroughEnv(globalConfig = {}, hostEnv = process.env) {
  const out = {};
  const explicitEnv = globalConfig?.env;
  if (explicitEnv && typeof explicitEnv === 'object') {
    for (const [k, v] of Object.entries(explicitEnv)) {
      if (v !== undefined && v !== null && String(v).length > 0) {
        out[k] = String(v);
      }
    }
  }

  const rawPatterns = globalConfig?.runner?.env_passthrough || hostEnv?.ASDLC_ENV_PASSTHROUGH || '';
  const patterns = String(rawPatterns)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (patterns.length > 0 && hostEnv && typeof hostEnv === 'object') {
    for (const pattern of patterns) {
      const regexStr = `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`;
      const re = new RegExp(regexStr);
      for (const [k, v] of Object.entries(hostEnv)) {
        if (v !== undefined && v !== null && String(v).length > 0 && re.test(k)) {
          out[k] = String(v);
        }
      }
    }
  }

  return out;
}
