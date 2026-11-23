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

export function extractRequirementTerms(text) {
  const raw = String(text ?? '');
  const s = raw
    .replace(/\b[A-Za-z]{2,10}-\d+\b[:\s-]*/g, '')
    .toLowerCase()
    .replace(/\b(i\s+want\s+to\s+build|i\s+want\s+to\s+add|i\s+want\s+to|we\s+need\s+to|please\s+add|build|create|add|implement)\b/gi, '')
    .replace(/\b(a|an|the|of|for|with|in|on|to|and|by)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  const asciiWords = s.split(/\s+/).filter(Boolean);
  return [...new Set(asciiWords)].slice(0, 6).join(' ');
}

export function deriveChangeSlug(input, opts = {}) {
  if (opts.id) return toChangeSlug(opts.id);
  const text = String(input ?? '').trim();
  if (!text) return 'change';

  // If already a short alphanumeric ID or slug (e.g. TECH-1234 or rate-limiting) without spaces
  if (!text.includes(' ') && text.length <= 40 && /^[a-zA-Z0-9_-]+$/.test(text)) {
    return toChangeSlug(text);
  }

  // Extract ticket ID if present (e.g. "TECH-1234: i want to build...")
  const ticketMatch = text.match(/\b([A-Za-z]{2,10}-\d+)\b/);
  const ticket = ticketMatch ? ticketMatch[1].toLowerCase() : null;

  // Strip filler phrases and ticket prefix
  let cleaned = text
    .replace(/\b[A-Za-z]{2,10}-\d+\b[:\s-]*/g, '')
    .toLowerCase()
    .replace(/\b(i\s+want\s+to\s+build|i\s+want\s+to\s+add|i\s+want\s+to|we\s+need\s+to|please\s+add|build|create|add|implement)\b/gi, '')
    .replace(/\b(a|an|the|of|for|with|in|on|to|and|by)\b/gi, '')
    .trim();

  if (!cleaned) cleaned = text.toLowerCase();

  const asciiWords = cleaned
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const words = [...new Set(asciiWords)].slice(0, 5);

  const keywords = words.join('-');
  if (ticket && keywords) return `${ticket}-${keywords}`.slice(0, 40).replace(/-+$/, '');
  if (ticket) return ticket;
  if (keywords) return keywords.slice(0, 40).replace(/-+$/, '');
  const fallback = toChangeSlug(text).slice(0, 40);
  if (fallback) return fallback;

  // Non-ASCII fallback when no ASCII terms matched: generate deterministic slug from content hash
  const hash = Math.abs(text.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0)).toString(36);
  return `change-${hash || Date.now().toString(36)}`;
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

/**
 * Detect whether CLI execution is happening inside an AI Coding Agent, CI, test runner,
 * or non-interactive piped runtime rather than a bare interactive human terminal.
 */
export function isAgentRuntime(opts = {}) {
  const {
    env = process.env,
    stdinIsTTY = Boolean(process.stdin?.isTTY),
    stdoutIsTTY = Boolean(process.stdout?.isTTY),
    agent = false,
    scaffoldOnly = false,
    guardOnly = false,
    check = false,
  } = opts;

  const explicitOverride = Boolean(agent || scaffoldOnly || guardOnly || check);
  const explicitAgentEnv = env.ASDLC_AGENT === '1' || env.ASDLC_AGENT === 'true';

  if (env.ASDLC_FORCE_INTERACTIVE_TERMINAL === '1') {
    return explicitOverride || explicitAgentEnv;
  }

  if (explicitOverride || explicitAgentEnv) return true;

  const hasDedicatedRuntimeEnv = Boolean(
    env.CLAUDECODE === '1'
    || env.CLAUDE_CODE_ENTRYPOINT
    || env.OPENCODE === '1'
    || env.OPENCODE_AGENT
    || env.OPENCODE_SESSION
    || env.CURSOR_AGENT === '1'
    || env.CI === 'true'
    || env.CI === '1'
    || env.GITHUB_ACTIONS === 'true'
    || env.NODE_TEST_CONTEXT
  );
  if (hasDedicatedRuntimeEnv) return true;

  return !stdinIsTTY || !stdoutIsTTY;
}

const AGENT_REQUIRED_HINTS = {
  new: {
    message: "'asdlc new' cannot complete standalone in a bare terminal — spec grilling and authoring require an AI Coding Agent.",
    hint: `Run '/asdlc-new "<requirement>"' inside your AI Agent (e.g. OpenCode, Claude Code, Antigravity, Cursor), or pass '--scaffold-only' to only scaffold the directory.`,
  },
  apply: {
    message: "'asdlc apply' cannot complete standalone in a bare terminal — the TDD implementation loop and PR comment fixes require an AI Coding Agent.",
    hint: "Run '/asdlc-apply <changeId>' (or prompt 'fix comments on PR #<N>') inside your AI Agent, or pass '--guard-only' to only check pre-implementation guards.",
  },
};

/**
 * Hard-block hybrid CLI commands when invoked directly in a bare interactive terminal
 * without an AI Agent runtime or explicit standalone flag.
 */
export function requireAgentRuntime(commandName, opts = {}) {
  if (isAgentRuntime(opts)) return true;

  const entry = AGENT_REQUIRED_HINTS[commandName] ?? {
    message: `'asdlc ${commandName}' requires an AI Coding Agent session and cannot run standalone in a bare terminal.`,
    hint: `Run '/asdlc-${commandName}' inside your AI Agent (e.g. OpenCode, Claude Code, Antigravity, Cursor).`,
  };

  fail(entry.message, {
    code: 'AGENT_RUNTIME_REQUIRED',
    hint: entry.hint,
  });
}
