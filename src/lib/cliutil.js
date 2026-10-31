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

// Bilingual domain lexicon bridging Chinese engineering requirements to canonical English
// codebase symbols and readable change slugs (enabling Graphify AST queries on CJK inputs).
const CJK_DOMAIN_LEXICON = [
  [/重构/, 'refactor'],
  [/修复|排障|缺陷/, 'fix'],
  [/清结算|清算/, 'clearing-settlement'],
  [/支付|打款|收单/, 'payment'],
  [/结算/, 'settlement'],
  [/退款/, 'refund'],
  [/账务|账本|记账|对账/, 'ledger'],
  [/计费|账单/, 'billing'],
  [/钱包|资金/, 'wallet'],
  [/删表|删除.*表|清空.*表|清理历史|物理删除/, 'purge-table'],
  [/鉴权|认证|登录态|单点登录/, 'auth'],
  [/权限|越权|角色/, 'rbac'],
  [/密钥|私钥|令牌|加密|脱敏/, 'secret-crypto'],
  [/接口|出入参|协议/, 'api'],
  [/路由|网关|控制器/, 'router'],
  [/数据库|数据表|表结构|迁移|索引/, 'schema-db'],
  [/订单/, 'order'],
  [/缓存/, 'cache'],
  [/队列|消息/, 'queue'],
  [/配置/, 'config'],
  [/单元测试|集成测试|测试用例/, 'test'],
  [/文档|注释/, 'docs'],
];

function extractCjkMappedTokens(text) {
  const raw = String(text ?? '');
  if (!/[\u4e00-\u9fff]/.test(raw)) return [];
  const tokens = [];
  for (const [pattern, mapped] of CJK_DOMAIN_LEXICON) {
    if (pattern.test(raw)) {
      for (const part of mapped.split('-')) {
        if (!tokens.includes(part)) tokens.push(part);
      }
    }
  }
  return tokens;
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
  const cjkWords = extractCjkMappedTokens(raw).filter((w) => !['refactor', 'fix'].includes(w));
  const merged = [...new Set([...asciiWords, ...cjkWords])];
  return merged.slice(0, 6).join(' ');
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
    .filter(Boolean)
    .slice(0, 4);

  const cjkTokens = asciiWords.length === 0 ? extractCjkMappedTokens(text).slice(0, 5) : [];
  const words = asciiWords.length > 0 ? asciiWords : cjkTokens;

  const keywords = words.join('-');
  if (ticket && keywords) return `${ticket}-${keywords}`.slice(0, 40).replace(/-+$/, '');
  if (ticket) return ticket;
  if (keywords) return keywords.slice(0, 40).replace(/-+$/, '');
  const fallback = toChangeSlug(text).slice(0, 40);
  if (fallback) return fallback;

  // Non-ASCII fallback when no domain terms matched: generate deterministic slug from content hash
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
