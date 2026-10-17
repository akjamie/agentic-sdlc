import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { exists, listDir, readText, copyTree, ensureDir } from '../lib/fs.js';
import { skillsAssetDir, resolveRepoRoot, openspecDir } from '../lib/paths.js';
import { detectTools, installSkills } from './init.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';

// Standard agent tools and their home/global directories
const GLOBAL_TOOL_DIRS = {
  agents: '.agents',
  opencode: '.opencode',
  pi: '.pi',
  dsh: '.dsh',
  claude: '.claude',
  cursor: '.cursor',
  codex: '.codex',
  trae: '.trae',
  zed: '.zed',
  gemini: '.gemini',
};

/**
 * Parse YAML frontmatter from a SKILL.md file
 */
function parseSkillMetadata(skillDir) {
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!exists(skillFile)) return null;
  const content = readText(skillFile);
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: path.basename(skillDir), description: '' };

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*["']?([\s\S]*?)["']?$/m);

  return {
    name: nameMatch ? nameMatch[1].trim() : path.basename(skillDir),
    description: descMatch ? descMatch[1].trim().replace(/\r?\n/g, ' ') : '',
  };
}

/**
 * List all available bundled skills
 */
export function listSkills() {
  if (!exists(skillsAssetDir)) {
    log.warn('No bundled skills asset directory found.');
    return;
  }

  const dirs = listDir(skillsAssetDir).filter((d) => d.isDirectory());
  log.info(`Bundled Agent Skills (${dirs.length} available):`);
  log.info('');

  for (const d of dirs) {
    const meta = parseSkillMetadata(path.join(skillsAssetDir, d.name));
    if (meta) {
      log.info(`  • ${meta.name.padEnd(20)} ${meta.description}`);
    } else {
      log.info(`  • ${d.name}`);
    }
  }
}

/**
 * Install or link skills globally (for CI Linux VM or headless agent runners)
 */
export function installGlobalSkills(opts = {}) {
  const home = os.homedir();
  if (!exists(skillsAssetDir)) {
    log.error(`Skills assets not found at: ${skillsAssetDir}`);
    return 1;
  }

  const skillsCount = listDir(skillsAssetDir).filter((d) => d.isDirectory()).length;
  const useLink = Boolean(opts.link);

  // Determine target tool directories in user home
  let targets = new Set(['.agents']);

  if (opts.tools) {
    const requested = opts.tools.split(',').map((t) => t.trim().toLowerCase());
    for (const tool of requested) {
      if (tool === 'all') {
        Object.values(GLOBAL_TOOL_DIRS).forEach((dir) => targets.add(dir));
      } else {
        const clean = tool.replace(/^\./, '');
        targets.add(GLOBAL_TOOL_DIRS[clean] || `.${clean}`);
      }
    }
  } else {
    // If no explicit tools given, always install to .agents (universal)
    // plus any detected tool directories present in home
    for (const [tool, dir] of Object.entries(GLOBAL_TOOL_DIRS)) {
      if (exists(path.join(home, dir))) {
        targets.add(dir);
      }
    }
  }

  log.step(`Installing bundled skills globally (${skillsCount} skills) into user home...`);

  let installedCount = 0;
  for (const dir of targets) {
    const dest = path.join(home, dir, 'skills');
    ensureDir(dest);

    if (useLink) {
      // Symlink individual skills or the entire tree
      let symlinkOk = true;
      try {
        const subdirs = listDir(skillsAssetDir).filter((d) => d.isDirectory());
        for (const sub of subdirs) {
          const srcSkill = path.join(skillsAssetDir, sub.name);
          const destSkill = path.join(dest, sub.name);
          if (exists(destSkill)) {
            try { fs.rmSync(destSkill, { recursive: true, force: true }); } catch { /* ignore */ }
          }
          fs.symlinkSync(srcSkill, destSkill, 'junction');
        }
        log.ok(`symlinked skills -> ~/${dir}/skills/ (live link)`);
        installedCount++;
      } catch (err) {
        log.warn(`symlink failed for ~/${dir}/skills/: ${err.message}. Falling back to copy...`);
        symlinkOk = false;
      }
      if (!symlinkOk) {
        copyTree(skillsAssetDir, dest);
        log.ok(`copied skills -> ~/${dir}/skills/`);
        installedCount++;
      }
    } else {
      copyTree(skillsAssetDir, dest);
      log.ok(`installed skills -> ~/${dir}/skills/`);
      installedCount++;
    }
  }

  log.info('');
  log.ok(`Global skills setup complete (${installedCount} target agent directories).`);
  return 0;
}

/**
 * CLI command registration
 */
export function register(program) {
  const skillsCmd = program
    .command('skills')
    .description('manage and install bundled agent skills for workspace or global CI agents');

  skillsCmd
    .command('list')
    .description('list all bundled agent skills available in agentic-sdlc')
    .action(() => {
      listSkills();
    });

  skillsCmd
    .command('install')
    .description('install skills to repository workspace, or globally for CI/headless agents')
    .option('-g, --global', 'install globally to user home (~/.agents, ~/.opencode, etc.) for CI runners')
    .option('--tools <tools>', 'comma-separated list of target agent tools (e.g. opencode,pi,dsh,claude or "all")')
    .option('--link', 'create symbolic links instead of copying (auto-updates when package is updated)')
    .option('--repo-root <path>', 'repository root path (default: current workspace)')
    .action((opts) => {
      if (opts.global) {
        process.exitCode = installGlobalSkills(opts);
      } else {
        const repoRoot = resolveRepoRoot(opts);
        if (!exists(openspecDir(repoRoot))) {
          fail('no OpenSpec repository found in current directory', {
            hint: 'To install skills globally on a CI VM or headless environment, pass --global: asdlc skills install --global',
          });
        }
        const explicit = opts.tools ? opts.tools.split(',').map((s) => s.trim().toLowerCase()) : [];
        const tools = [...new Set([...detectTools(repoRoot), ...explicit])];
        installSkills(repoRoot, tools);
        log.ok('Repository skills refreshed successfully.');
      }
    });
}
