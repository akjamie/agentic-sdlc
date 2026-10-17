import path from 'node:path';
import { exists } from '../lib/fs.js';
import { resolveRepoRoot, openspecDir, OPENSPEC_DIR } from '../lib/paths.js';
import { log } from '../lib/log.js';
import { detectTools, installSkills, installHooks } from './init.js';
import { ensureGraphify, buildGraph, ensureGitignore } from '../lib/graphify.js';
import { refreshAgents } from '../lib/agents.js';

export function updateRepo(opts = {}) {
  const repoRoot = resolveRepoRoot(opts);
  const isGit = exists(path.join(repoRoot, '.git'));
  const isSdlc = exists(openspecDir(repoRoot));

  if (!isGit) {
    log.error('Not a Git repository: \'asdlc update\' must be run inside a Git repository.');
    log.info('');
    log.info('💡 To initialize this project for Agentic SDLC, run:');
    log.info('     git init');
    log.info('     asdlc init');
    log.info('');
    log.info('💡 To upgrade your global CLI toolchain instead, run:');
    log.info('     asdlc upgrade --global');
    return 1;
  }

  if (!isSdlc) {
    log.error(`Repository not initialized for Agentic SDLC (missing '${OPENSPEC_DIR}/' directory).`);
    log.info('');
    log.info('💡 To set up Agentic SDLC in this repository (OpenSpec, knowledge graph, and agent skills):');
    log.info('     asdlc init');
    log.info('');
    log.info('💡 To upgrade your global CLI toolchain instead:');
    log.info('     asdlc upgrade');
    return 1;
  }

  log.info('=== Updating Repository SDLC State ===');
  log.info(`Repository: ${repoRoot}`);
  log.info('');

  // 1) Skills refresh
  if (opts.skills !== false) {
    log.step('refreshing bundled agent skills in repository...');
    const tools = detectTools(repoRoot);
    installSkills(repoRoot, tools);
  }

  // 2) Codebase AST knowledge graph (KB / graphify)
  if (opts.graph !== false) {
    log.step('rebuilding codebase AST knowledge graph (graphify)...');
    try {
      const g = ensureGraphify();
      if (g.installed) {
        const b = buildGraph(repoRoot);
        if (b.status === 0) {
          log.ok('rebuilt code knowledge graph -> graphify-out/ (bound to HEAD)');
          ensureGitignore(repoRoot);
        } else {
          log.warn('graphify build returned non-zero status (non-fatal)');
        }
      } else {
        log.warn('graphify not installed; skipping knowledge graph rebuild');
      }
    } catch (err) {
      log.warn(`graphify update failed: ${err.message}`);
    }
  }

  // 3) Agent routing layer (AGENTS.md)
  log.step('refreshing AGENTS.md system status & architectural hubs...');
  try {
    refreshAgents(repoRoot);
    log.ok('refreshed AGENTS.md system status (derived from knowledge graph)');
  } catch (err) {
    log.warn(`AGENTS.md refresh failed: ${err.message}`);
  }

  // 4) Git governance hooks
  if (opts.hooks !== false) {
    try {
      installHooks(repoRoot);
    } catch (err) {
      log.warn(`git hooks refresh failed: ${err.message}`);
    }
  }

  log.info('');
  log.ok('Repository SDLC state is fully up to date.');
  return 0;
}

export function register(program) {
  program
    .command('update')
    .description('update current repository SDLC state: refresh agent skills, rebuild AST knowledge graph (KB), and sync AGENTS.md')
    .option('--repo-root <path>', 'repository root (default: current repository)')
    .option('--no-skills', 'skip refreshing agent skills')
    .option('--no-graph', 'skip rebuilding codebase knowledge graph')
    .option('--no-hooks', 'skip refreshing git hooks')
    .action((opts) => {
      process.exitCode = updateRepo(opts);
    });
}
