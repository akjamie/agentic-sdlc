import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { exists } from '../lib/fs.js';
import { resolveRepoRoot, schemaAssetDir } from '../lib/paths.js';
import { installSchema, builtinSchemaVersion } from '../lib/schema.js';
import { doctor } from './doctor.js';
import { log } from '../lib/log.js';

import { detectTools, installSkills } from './init.js';

function which(name) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [name], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? null;
}

export function upgradeAsdlc() {
  log.step('upgrading asdlc CLI...');
  try {
    const pkgSpec = process.env.ASDLC_PKG_SPEC || 'git+https://github.com/akjamie/agentic-sdlc.git';
    execFileSync('npm', ['install', '-g', '--allow-git=all', '--force', pkgSpec], { stdio: 'inherit' });
    log.ok('asdlc CLI upgraded to latest');
    return true;
  } catch (err) {
    log.warn(`asdlc upgrade via npm failed: ${err.message}`);
    log.info('💡 [FALLBACK] If automatic upgrade failed, run manually:');
    log.info('             npm install -g --allow-git=all --force git+https://github.com/akjamie/agentic-sdlc.git');
    return false;
  }
}

export function upgradeSkills(repoRoot) {
  log.step('refreshing bundled agent skills in repository...');
  try {
    const tools = detectTools(repoRoot);
    installSkills(repoRoot, tools);
    log.ok('refreshed bundled agent skills in repository');
    return true;
  } catch (err) {
    log.warn(`skills refresh failed: ${err.message}`);
    return false;
  }
}

export function upgradeOpenspec() {
  log.step('upgrading openspec...');
  try {
    execFileSync('npm', ['install', '-g', '@fission-ai/openspec@latest'], { stdio: 'inherit' });
    log.ok('openspec upgraded to latest');
    return true;
  } catch (err) {
    log.warn(`openspec upgrade failed: ${err.message}`);
    return false;
  }
}

export function upgradeGraphify() {
  log.step('upgrading graphify...');
  const viaUv = Boolean(which('uv'));
  const viaPipx = Boolean(which('pipx'));
  const viaPip = Boolean(which('pip'));

  if (viaUv) {
    try {
      execFileSync('uv', ['tool', 'install', '--upgrade', 'graphifyy'], { stdio: 'inherit' });
      log.ok('graphify upgraded via uv');
      return true;
    } catch {
      // fallback
    }
  }

  if (viaPipx) {
    try {
      execFileSync('pipx', ['install', '--upgrade', 'graphifyy'], { stdio: 'inherit' });
      log.ok('graphify upgraded via pipx');
      return true;
    } catch {
      // fallback
    }
  }

  if (viaPip) {
    try {
      execFileSync('pip', ['install', '--upgrade', 'graphifyy'], { stdio: 'inherit' });
      log.ok('graphify upgraded via pip');
      return true;
    } catch (err) {
      // PEP 668 on Debian/Ubuntu externally-managed-environment: retry with --break-system-packages
      try {
        execFileSync('pip', ['install', '--upgrade', 'graphifyy', '--break-system-packages'], { stdio: 'inherit' });
        log.ok('graphify upgraded via pip (--break-system-packages)');
        return true;
      } catch (err2) {
        log.warn(`graphify upgrade via pip failed: ${err2.message}`);
        return false;
      }
    }
  }

  log.warn('neither uv, pipx, nor pip found; please install/upgrade graphify manually');
  return false;
}

export function upgradeSchema() {
  log.step('refreshing BU-managed OpenSpec schema...');
  try {
    if (!exists(schemaAssetDir)) {
      log.warn(`schema asset directory missing at ${schemaAssetDir}`);
      return false;
    }
    const dest = installSchema();
    log.ok(`refreshed schema v${builtinSchemaVersion()} -> ${dest}`);
    return true;
  } catch (err) {
    log.warn(`schema refresh failed: ${err.message}`);
    return false;
  }
}

import { installGlobalSkills } from './skills.js';

export function runUpgrade(opts = {}) {
  log.info('=== Upgrading Agentic SDLC Toolchain ===');
  log.info('');

  const repoRoot = opts.global ? null : resolveRepoRoot(opts);

  if (opts.asdlc !== false) upgradeAsdlc();
  if (opts.openspec !== false) upgradeOpenspec();
  if (opts.graphify !== false) upgradeGraphify();
  if (opts.schema !== false) upgradeSchema();

  if (opts.skills !== false) {
    if (opts.global) {
      installGlobalSkills(opts);
    } else if (repoRoot) {
      upgradeSkills(repoRoot);
    }
  }

  log.info('');
  log.ok('Toolchain upgrade complete.');

  if (opts.doctor !== false) {
    log.info('');
    log.info('=== Post-upgrade Health Check (doctor) ===');
    return doctor(repoRoot ? { repoRoot } : {});
  }

  return 0;
}

export function register(program) {
  program
    .command('upgrade')
    .description('upgrade the toolchain: asdlc CLI, OpenSpec, Graphify, managed schemas, and repo or global skills')
    .option('-g, --global', 'upgrade toolchain and refresh global user skills (~/.agents) for CI runners')
    .option('--no-asdlc', 'skip upgrading asdlc itself')
    .option('--no-openspec', 'skip upgrading openspec')
    .option('--no-graphify', 'skip upgrading graphify')
    .option('--no-schema', 'skip refreshing BU-managed schema')
    .option('--no-skills', 'skip refreshing skills')
    .option('--no-doctor', 'skip running post-upgrade doctor check')
    .option('--repo-root <path>')
    .action((opts) => {
      process.exitCode = runUpgrade(opts);
    });
}
