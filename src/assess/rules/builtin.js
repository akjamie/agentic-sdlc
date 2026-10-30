export const HARNESS_RULES_VERSION = '2026.10.0';
export const ENGINE_VERSION = '1.5.0';

export const RISK_LEVELS = {
  L0: 'L0',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
};

export const LEVEL_RANK = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

/**
 * Global default fallback governance (Specification §5.5)
 * Applied when assessment crashes, times out, or baseline is corrupted.
 * Fixed at L2 (not L3) to avoid total tool paralysis while closing all automation.
 */
export const DEFAULT_GOVERNANCE = {
  level: 'L2',
  workflow_mode: 'spec-first',
  spec_approval: 'human',
  implementation_review: 'ai+human',
  auto_approval: 'disabled'
};

export const CANONICAL_DESTRUCTIVE_PATTERN = /\b(drop\s+(table|column|database|index|schema)|truncate\s+(table|database)?|purge\s+(data|table|database)|hard\s+delete|clean\s+database|destroy\s+database)\b/i;

/**
 * Hard Signal Rules (§5.2):
 * Deterministic path patterns, migration types, CI/CD, agent governance files.
 * Can trigger single-veto up to L3.
 */
export const HARD_RULES = [
  // 1. Critical Governance Plane (L3)
  {
    id: 'HARD_GOV_PLANE',
    level: 'L3',
    signal: 'hard',
    mandatory_human_review: true,
    patterns: [
      /(^|\/)AGENTS\.md$/i,
      /(^|\/)openspec\/config\.yaml$/i,
      /(^|\/)(assets|\.agents)\/skills\/.*SKILL\.md$/i
    ],
    summary: 'Modifies core Agent governance constitution (AGENTS.md, openspec/config.yaml, or agent skills)'
  },
  // 2. High-Risk Security, Credentials & Cryptography (L3)
  {
    id: 'HARD_SECURITY_CREDENTIALS',
    level: 'L3',
    signal: 'hard',
    mandatory_human_review: true,
    patterns: [
      /(^|\/)(auth|security|session|mfa|kms)\//i,
      /\.(pem|key|cert|p12|jks)$/i,
      /(^|\/)secrets?\.[a-z0-9]+$/i
    ],
    summary: 'Touches security, cryptographic keys, authentication, or secrets'
  },
  // 3. Financial, Billing & Ledgers (L3)
  {
    id: 'HARD_FINANCIAL_ASSETS',
    level: 'L3',
    signal: 'hard',
    mandatory_human_review: true,
    patterns: [
      /(^|\/)(payment|billing|ledger|clearing|settlement|wallet)\//i
    ],
    summary: 'Touches core financial accounting, settlement, or payment ledger paths'
  },
  // 4. Destructive Database Operations (L3)
  {
    id: 'HARD_DESTRUCTIVE_DDL',
    level: 'L3',
    signal: 'hard',
    mandatory_human_review: true,
    patterns: [
      /(^|\/)(db\/)?migrations?\/.*(drop|truncate|purge|destructive)/i,
      /(^|\/)db\/migration\/.*(drop|truncate|purge|destructive)/i
    ],
    summary: 'Executes destructive, irreversible schema or data deletion operations'
  },
  // 5. Public API Contracts & Framework Handlers (L2 - Spec-First)
  {
    id: 'HARD_API_CONTRACT',
    level: 'L2',
    signal: 'hard',
    mandatory_human_review: false,
    patterns: [
      // Schema & IDL definitions (excluding docs and tooling schemas)
      /(^|\/)(protos?)\//i,
      /(^|\/)(openapi|swagger)\.[a-z0-9]+$/i,
      /\.(proto|graphql|gql|thrift|prisma)$/i,
      // Spring Boot (Java / Kotlin)
      /(^|\/).*(Controller|Resource|Endpoint|Api)\.(java|kt)$/i,
      /(^|\/)(controllers?|endpoints?|resources?)\/.*\.(java|kt)$/i,
      // FastAPI / Python web frameworks
      /(^|\/)(routers?|endpoints?)\/.*\.py$/i,
      /(^|\/).*(router|controller|endpoint).*\.py$/i,
      /(^|\/)(app|api)\/(main|app)\.py$/i,
      // Node.js / NestJS / Express / Next.js
      /(^|\/).*\.controller\.(ts|js)$/i,
      /(^|\/)(pages|app|server|src)\/api\/.*\.(ts|js|tsx|jsx)$/i,
      /(^|\/)(routes?\/|.*routes?\.)(ts|js)$/i,
      // Go web handlers (excluding utilities and non-API handlers)
      /(^|\/)(handlers?|routers?|controllers?|api)\/(?!.*error_handler).*\.go$/i,
      /^(?!.*[/\\](utils?|helpers?)[/\\]).*(?<!error)_(handler|router|controller)\.go$/i
    ],
    summary: 'Modifies public API contracts, controllers, routers, or schemas (Spring Boot, FastAPI, NestJS, Go, Proto, OpenAPI)'
  },
  // 6. CI/CD Workflows & Git Hooks (L1 Tooling / Routine Dev)
  {
    id: 'HARD_CI_TOOLING',
    level: 'L1',
    signal: 'hard',
    mandatory_human_review: false,
    patterns: [
      /^\.github\/workflows\//i,
      /(^|\/)Jenkinsfile$/i,
      /(^|\/)\.githooks\//i,
      /(^|\/)\.husky\//i,
      /(^|\/)\.gitlab-ci\.ya?ml$/i
    ],
    summary: 'Modifies CI/CD pipeline workflows, Git hooks, or developer tooling'
  },
  // 7. Database Migrations & Data Models (L2)
  {
    id: 'HARD_DB_MIGRATION',
    level: 'L2',
    signal: 'hard',
    mandatory_human_review: false,
    patterns: [
      /(^|\/)(db\/)?migrations?\//i,
      /(^|\/)db\/(schema|models?)\//i,
      /(^|\/)prisma\/schema\.prisma$/i
    ],
    summary: 'Modifies database migrations, tables, or persistence schemas'
  },
  // 7. Supply Chain & Build Manifests (L2)
  {
    id: 'HARD_SUPPLY_CHAIN',
    level: 'L2',
    signal: 'hard',
    mandatory_human_review: false,
    patterns: [
      /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i,
      /(^|\/)(go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|pom\.xml|build\.gradle)$/i,
      /(^|\/)(Dockerfile.*|Containerfile.*|docker-compose.*)$/i,
      /(^|\/)(helm|k8s|terraform)\//i
    ],
    summary: 'Touches dependency manifests, lockfiles, containers, or infra code'
  }
];

/**
 * Deterministic Proof of L0 Trivial Change (§2.2):
 * All files must match documentation or non-executable patterns.
 * Never touches code, CI, configs, or agent files.
 */
export const L0_DETERMINISTIC_PATTERNS = [
  /^docs\//i,
  /\.md$/i,
  /\.txt$/i,
  /^LICENSE$/i,
  /^NOTICE$/i
];

export const TEST_AND_DOC_PATTERNS = [
  /(^|\/)(tests?|__tests__|testing)\//i,
  /\.(test|spec)\.[a-z0-9]+$/i,
  /_test\.go$/i,
  /test_[^/]+\.py$/i,
  /[^/]+_test\.py$/i,
  /(^|\/)docs?\//i,
  /\.(md|txt)$/i,
  /(^|\/)assets\/(?:images|media|icons|fonts)\//i
];

export function isChangeMetadataFile(filePath = '') {
  const norm = String(filePath).replace(/\\/g, '/');
  return /(^|\/)openspec\/changes\/[^/]+\//i.test(norm);
}

export function isTestOrDocFile(filePath = '') {
  const norm = String(filePath).replace(/\\/g, '/');
  if (
    /(^|\/)AGENTS\.md$/i.test(norm) ||
    /(^|\/)openspec\/config\.yaml$/i.test(norm) ||
    /(^|\/)(assets|\.agents)\/skills\//i.test(norm)
  ) {
    return false;
  }
  return TEST_AND_DOC_PATTERNS.some((p) => p.test(norm));
}

