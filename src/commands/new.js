import path from 'node:path';
import { exists, readText, writeText, ensureDir } from '../lib/fs.js';
import { changeDir, schemaAssetDir, resolveRepoRoot } from '../lib/paths.js';
import { requireRepo, deriveChangeSlug, extractRequirementTerms } from '../lib/cliutil.js';
import { ensureGraphify, ensureFreshGraph, graphifyQuery } from '../lib/graphify.js';
import { runOpenspec } from '../lib/openspec.js';
import { runShell } from '../lib/exec.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { Option } from 'commander';
import { inferInitialLevel } from '../lib/level.js';
import { resolveWorkflowMode } from '../lib/config.js';
import { assertGitRepositoryInitialized } from '../lib/githost.js';
import { ingestIntakeSources } from '../lib/intake.js';

function collectOption(val, prev = []) {
  return [...prev, val];
}

// STAGE 1 of the spec (v10: explore + propose are ONE step).
//   1) scaffold the change through OpenSpec (derives canonical slug from requirement)
//   2) refresh the knowledge graph (graphify, behind the scenes)
//   3) write explore.md so the proposal is grounded in the real system
export function newChange(requirement, opts = {}) {
  const effectiveRoot = resolveRepoRoot(opts);
  assertGitRepositoryInitialized(effectiveRoot, {
    container: Boolean(opts.container),
    repo: opts.repo,
    createRepo: opts.createRepo,
    requireCommit: opts.requireCommit !== false,
  });
  const repoRoot = requireRepo(opts);

  const fromFiles = Array.isArray(opts.fromFile) ? opts.fromFile : (opts.fromFile ? [opts.fromFile] : []);
  const fromIssues = Array.isArray(opts.fromIssue) ? opts.fromIssue : (opts.fromIssue ? [opts.fromIssue] : []);
  const effectiveReq = requirement
    || (fromIssues.length > 0 ? fromIssues[0] : null)
    || (fromFiles.length > 0 ? path.basename(fromFiles[0], path.extname(fromFiles[0])) : null);

  if (!effectiveReq) {
    fail('requirement description, --from-file, or --from-issue is required', {
      code: 'MISSING_REQUIREMENT',
      hint: 'Run `asdlc new "<requirement>"` or provide `--from-file` / `--from-issue`.',
    });
  }

  // Pre-validate intake files before scaffolding directories
  for (const f of fromFiles) {
    const abs = path.isAbsolute(f) ? f : path.resolve(repoRoot, f);
    if (!exists(abs)) {
      fail(`Intake file not found: ${f}`, {
        code: 'INTAKE_FILE_NOT_FOUND',
        hint: `Verify path '${f}' exists before running asdlc new.`,
      });
    }
  }

  const slug = deriveChangeSlug(effectiveReq, opts);
  const cdir = changeDir(repoRoot, slug);
  if (exists(cdir)) fail(`change '${slug}' already exists`, { hint: 'use a new requirement/id, or iterate the existing change' });

  if (opts.openspec !== false) {
    const res = runOpenspec(['new', 'change', slug], repoRoot);
    if (res.missing) fail('OpenSpec CLI not found', { hint: 'run `asdlc init`' });
    if (res.status !== 0) fail(`openspec new change failed: ${(res.stderr || res.stdout || '').slice(0, 300)}`);
    log.ok(`created change '${slug}' (derived from: "${effectiveReq}")`);
  } else {
    ensureDir(cdir);
    writeText(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\n');
    log.ok(`created change '${slug}' (derived from: "${effectiveReq}")`);
  }

  const intakeIndex = ingestIntakeSources(repoRoot, slug, {
    fromFiles,
    fromIssues,
    homeDir: opts.homeDir,
    issueFetcher: opts.issueFetcher,
  });
  if (intakeIndex) {
    log.ok(`captured intake sources: ${intakeIndex.files.length} file(s), ${intakeIndex.issues.length} issue(s)`);
  }

  // Determine grill mode: 'none' (--no-grill), 'batch' (--batch-grill), or 'interactive' (default grill-me)
  const grillMode = opts.grill === false ? 'none' : (opts.batchGrill ? 'batch' : 'interactive');

  // Grounding in knowledge graph (explore.md) before assessing initial risk level
  const g = ensureGraphify({ autoInstall: false });
  if (!g.installed) {
    log.warn('[WARN] explore.md generated without graph context (Graphify not installed). Run `asdlc init --graph` to enable architectural AST index.');
    const fallbackMd = `# Explore: ${slug}

> Requirement: "${effectiveReq}"
> [WARN] explore.md generated without graph context because Graphify is not installed or enabled.
> Run \`asdlc init --graph\` to build the repository knowledge graph.
> generatedAt: ${new Date().toISOString()}

## Architectural hubs (god nodes)
_(unavailable - graphify not initialized)_

## Query: ${slug}
_(unavailable - graphify not initialized)_
`;
    writeText(path.join(cdir, 'explore.md'), fallbackMd);
    log.ok(`wrote explore.md (fallback without graph context)`);
  } else {
    try {
      const fresh = ensureFreshGraph(repoRoot);
      const terms = extractRequirementTerms(effectiveReq);
      const q = opts.query ?? (terms || slug);
      const hubs = (runShell('graphify god-nodes', repoRoot).stdout || '').trim();
      const query = graphifyQuery(repoRoot, q);
      const md = `# Explore: ${slug}

> Requirement: "${effectiveReq}"
> Generated by \`asdlc new\` from the knowledge graph - structured queries, not
> code reading. Ground the proposal in this. generatedAt: ${new Date().toISOString()}

## Architectural hubs (god nodes)

${hubs || '_(none)_'}

## Query: ${q}

${(query.stdout || '').trim() || '_(no matches)_'}
`;
      writeText(path.join(cdir, 'explore.md'), md);
      log.ok(`wrote explore.md (graph ${fresh.status}, query: "${q}")`);
    } catch (err) {
      log.warn(`[WARN] explore.md generated with partial context (graph error: ${err.message}). Run \`asdlc init --graph\` to reindex.`);
      const fallbackMd = `# Explore: ${slug}

> Requirement: "${effectiveReq}"
> [WARN] Graph query encountered an error: ${err.message}
> Run \`asdlc init --graph\` to reindex repository knowledge graph.
> generatedAt: ${new Date().toISOString()}

## Architectural hubs (god nodes)
_(unavailable - graph query error)_

## Query: ${slug}
_(unavailable - graph query error)_
`;
      writeText(path.join(cdir, 'explore.md'), fallbackMd);
      log.ok(`wrote explore.md (fallback with error note)`);
    }
  }

  // Resolve workflow mode across precedence hierarchy (CLI > Env > Repo > Global > Default)
  const resolvedMode = resolveWorkflowMode({ cliMode: opts.mode, repoRoot });

  // Infer governance level (L0, L1, L2, L3) via unified assessment engine (grounded in explore.md)
  const { level, changeType, workflowMode, reason: levelReason } = inferInitialLevel({
    requirement: effectiveReq,
    explicitLevel: opts.level,
    agentContext: opts.agentContext,
    repoRoot,
    changeId: slug,
    mode: resolvedMode
  });

  // Record requirement, grill mode, and governance level in change metadata (.openspec.yaml)
  const metaPath = path.join(cdir, '.openspec.yaml');
  if (exists(metaPath)) {
    const existing = readText(metaPath).trimEnd();
    writeText(metaPath, `${existing}\nrequirement: ${JSON.stringify(effectiveReq)}\ngrillMode: "${grillMode}"\nchangeType: "${changeType}"\nworkflowMode: "${workflowMode}"\ngovernanceMode: "${resolvedMode}"\nlevel: "${level}"\nlevelReason: ${JSON.stringify(levelReason)}\n`);
  }

  if (workflowMode === 'single-pr') {
    if (resolvedMode === 'supervised') {
      log.ok(`assigned governance level: ${level} [Type: ${changeType}] (${levelReason}) - [Supervised Single PR mode: code & specs in one PR, human merge confirmation required]`);
    } else {
      log.ok(`assigned governance level: ${level} [Type: ${changeType}] (${levelReason}) - [Single PR mode: code & specs in one PR, auto-merge eligible]`);
    }
  } else {
    log.ok(`assigned governance level: ${level} [Type: ${changeType}] (${levelReason}) - [Spec-first mode: Spec PR required before implementation]`);
  }

  // Seed the grilling interview / clarification record.
  const clar = path.join(cdir, 'clarifications.md');
  if (!exists(clar)) {
    let clarContent = '';
    if (grillMode === 'batch') {
      clarContent = `# Clarifications: ${slug}

> Requirement: "${effectiveReq}"
> Mode: batch-grill
> Before writing proposal.md / specs, the agent MUST run a **batch-grill-me** interview
> with the author (skill: \`batch-grill-me\`) and record the settled decisions here.
> Evaluate the design tree, present the ENTIRE active frontier in structured batches
> (numbered Q1..Qn with concrete recommended defaults and trade-offs), allowing the author
> to approve or adjust decisions.
> Facts are the agent's job to look up; decisions are the author's to make.

## Requirement
"${effectiveReq}"

## Settled decisions
<!-- one entry per settled decision: decision -> answer, with the reason -->

## Open questions
<!-- must be empty before the spec is written -->
`;
    } else if (grillMode === 'none') {
      clarContent = `# Clarifications: ${slug}

> Requirement: "${effectiveReq}"
> Mode: no-grill (self-settled)
> Interactive grilling was skipped via \`--no-grill\`.
> The agent MUST ground decisions in codebase facts, AST (\`explore.md\`), and existing patterns,
> and record all settled assumptions below BEFORE authoring proposal.md / specs.

## Requirement
"${effectiveReq}"

## Settled decisions
<!-- record all context-inferred decisions and assumptions here -->

## Open questions
<!-- (none) -->
`;
    } else {
      // Default: interactive (grill-me)
      clarContent = `# Clarifications: ${slug}

> Requirement: "${effectiveReq}"
> Mode: interactive (grill-me)
> Before writing proposal.md / specs, the agent runs a high-signal conversational **grill-me** interview
> with the author (skill: \`grilling\`) and records settled decisions here.
>
> **Anti-Fatigue Guardrails**:
> 1. Codebase-first: Look up facts in AST/code; NEVER ask what can be inspected.
> 2. Material forks only: Ask only about real architectural trade-offs; decide implementation details yourself.
> 3. Recommendation-led: Ask 1 focused question at a time with a concrete recommended default and rationale.
> 4. Early-exit: Stop questioning immediately when material forks are settled or the author says "proceed".

## Requirement
"${effectiveReq}"

## Settled decisions
<!-- one entry per settled decision: decision -> answer, with the reason -->

## Open questions
<!-- must be empty before the spec is written -->
`;
    }
    writeText(clar, clarContent);
    log.ok(`seeded clarifications.md (${grillMode === 'batch' ? 'batch-grill mode' : (grillMode === 'none' ? 'no-grill mode' : 'conversational grill-me mode')})`);
  }

  // Technical design (design.md) scaffolding:
  // Auto-seed if requirement implies UI, frontend, API integration, security, NFR, or technical complexity,
  // or if explicitly requested via opts.design === true.
  const UI_OR_TECH_KEYWORDS = /\b(ui|ux|frontend|web|screen|page|view|component|css|style|api|endpoint|service|client|integration|database|db|schema|model|architecture|refactor|migration|auth|payment|cache|gateway|protocol|security|threat|nfr|performance|rate.?limit|sanitize|encryption)\b/i;
  const shouldSeedDesign = opts.design === true || (opts.design !== false && UI_OR_TECH_KEYWORDS.test(effectiveReq));
  const designPath = path.join(cdir, 'design.md');
  if (shouldSeedDesign && !exists(designPath)) {
    const tmplPath = path.join(schemaAssetDir, 'templates', 'design.md');
    let tmpl = exists(tmplPath) ? readText(tmplPath) : `# Technical Design: ${slug}\n\n`;
    tmpl = tmpl.replace('<!-- change id -->', slug);
    tmpl = tmpl.replace('<!-- requirement summary -->', effectiveReq.replace(/"/g, '\\"'));
    writeText(designPath, tmpl);
    log.ok('seeded design.md (technical design for architecture/UI/API/security/NFR)');
  }

  log.info('');
  log.info('[ASDLC PROTOCOL: IMMEDIATE ACTION REQUIRED FOR AGENT]');
  log.info('  ▶ DO NOT pause or ask the author if you should begin grilling.');
  log.info('  ▶ Ground yourself in `explore.md` and research codebase facts first.');
  log.info('  ▶ Perform external search for 3rd-party APIs, vendor SDKs, and UI design patterns (enabled by default).');
  log.info('     (If search fails or offline: emit \'[WARN] External search failed or offline: <reason>. Continuing with defined steps.\' and continue without blocking).');
  if (grillMode === 'batch') {
    log.info('  ▶ [MODE: BATCH-GRILL] Formulate decision frontier and invoke `batch-grill-me` to present structured batches with recommended defaults.');
    log.info('  ▶ Record agreed decisions into `clarifications.md`.');
    log.info('  ▶ ONLY AFTER clarifications are settled: author `proposal.md`, `specs/**`, and `design.md` (if seeded/needed).');
  } else if (grillMode === 'none') {
    log.info('  ▶ [MODE: NO-GRILL] Interactive grilling bypassed via `--no-grill`.');
    log.info('  ▶ Ground decisions in code/AST facts, record settled assumptions into `clarifications.md`, and proceed to `proposal.md`, `specs/**`, and `design.md` (if seeded/needed).');
  } else {
    log.info('  ▶ [MODE: GRILL-ME] Formulate decision frontier and run conversational, recommendation-led grilling (1 material decision at a time).');
    log.info('     (Anti-fatigue: look up code facts first; skip micro-trivia; halt questioning when author says proceed or forks hit zero).');
    log.info('  ▶ Record agreed decisions into `clarifications.md`.');
    log.info('  ▶ ONLY AFTER clarifications are settled: author `proposal.md`, `specs/**`, and `design.md` (if seeded/needed).');
  }
  if (shouldSeedDesign) {
    log.info('  ▶ [ARCHITECTURE] Generate architecture diagram (embedded Mermaid flowchart / sequenceDiagram).');
    log.info('  ▶ [API DESIGN] Follow `api-design` skill (RESTful nouns, Stripe-style / RFC 7807 errors, idempotency, cursor pagination).');
    log.info('  ▶ [UI/UX DESIGN] Ground visual specs in `frontend-design` (Anthropic) & Vercel Web Interface Guidelines.');
  }
  log.info(`  ▶ Run \`asdlc lint ${slug}\`.`);
  return slug;
}

export function register(program) {
  program
    .command('new [requirement]')
    .description('start a spec: scaffold + refresh the graph + explore.md + clarifications.md (for grilling)')
    .option('--id <slug>', 'explicit change slug (override auto-derivation)')
    .option('--query <q>', 'graph query terms (default: extracted requirement terms)')
    .option('--from-file <path>', 'local requirement/PRD/schema file to snapshot (repeatable)', collectOption, [])
    .option('--from-issue <id>', 'external issue/ticket reference to intake (repeatable)', collectOption, [])
    .option('--design', 'explicitly generate technical design (design.md)')
    .option('--no-design', 'skip generating technical design (design.md)')
    .option('--batch-grill', 'use batch-grill-me (present entire decision frontier in structured batches)')
    .option('--no-grill', 'skip interactive grilling interview (self-settle decisions in clarifications.md)')
    .option('--mode <mode>', 'workflow mode: supervised (default) | spec-first | auto')
    .addOption(new Option('--level <level>', 'internal governance level override (hidden)').hideHelp())
    .option('--repo-root <path>')
    .action((requirement, opts) => {
      newChange(requirement, opts);
    });
}
