import path from 'node:path';
import { exists, listDir, copyTree, ensureDir, readText, writeText } from './fs.js';
import { skillsAssetDir, commandsAssetDir } from './paths.js';
import { log } from './log.js';

export const TOOL_REGISTRY = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    tier: 1,
    detectDir: '.claude',
    skillsDir: '.claude/skills',
    commandsDir: '.claude/commands',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    tier: 1,
    detectDir: '.opencode',
    skillsDir: '.opencode/skills',
    commandsDir: '.opencode/commands',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
  pi: {
    id: 'pi',
    name: 'Pi (oh-my-pi)',
    tier: 1,
    detectDir: '.pi',
    skillsDir: '.pi/skills',
    commandsDir: '.pi/prompts',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
  antigravity: {
    id: 'antigravity',
    name: 'Google Antigravity',
    tier: 1,
    detectDir: '.agents',
    detectAliases: ['.antigravity'],
    skillsDir: '.agents/skills',
    commandsDir: '.agents/workflows',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
  'github-copilot': {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    tier: 1,
    detectDir: '.github',
    skillsDir: '.github/skills',
    commandsDir: '.github/prompts',
    commandExt: '.prompt.md',
    commandFormat: 'prompt-md',
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    tier: 2,
    detectDir: '.cursor',
    skillsDir: '.cursor/skills',
    commandsDir: '.cursor/commands',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
  trae: {
    id: 'trae',
    name: 'Trae',
    tier: 2,
    detectDir: '.trae',
    skillsDir: '.trae/skills',
    commandsDir: '.trae/commands',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
  windsurf: {
    id: 'windsurf',
    name: 'Windsurf / Devin Desktop',
    tier: 2,
    detectDir: '.windsurf',
    detectAliases: ['.devin'],
    skillsDir: '.windsurf/skills',
    commandsDir: '.windsurf/workflows',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    tier: 2,
    detectDir: '.gemini',
    skillsDir: '.gemini/skills',
    commandsDir: '.gemini/commands/asdlc',
    commandExt: '.toml',
    commandFormat: 'toml',
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    tier: 2,
    detectDir: '.codex',
    skillsDir: '.codex/skills',
    commandsDir: '.codex/commands',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
  zed: {
    id: 'zed',
    name: 'Zed',
    tier: 2,
    detectDir: '.zed',
    skillsDir: '.zed/skills',
    commandsDir: '.zed/commands',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
  dsh: {
    id: 'dsh',
    name: 'DSH Agent',
    tier: 2,
    detectDir: '.dsh',
    skillsDir: '.dsh/skills',
    commandsDir: '.dsh/commands',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
  agents: {
    id: 'agents',
    name: 'Generic Agents',
    tier: 2,
    detectDir: '.agents',
    skillsDir: '.agents/skills',
    commandsDir: '.agents/workflows',
    commandExt: '.md',
    commandFormat: 'markdown',
  },
};

/**
 * Detect AI agent tools configured in this repository
 */
export function detectTools(repoRoot) {
  const detected = new Set();
  for (const tool of Object.values(TOOL_REGISTRY)) {
    if (exists(path.join(repoRoot, tool.detectDir))) {
      detected.add(tool.id);
    }
    if (tool.detectAliases) {
      for (const alias of tool.detectAliases) {
        if (exists(path.join(repoRoot, alias))) {
          detected.add(tool.id);
        }
      }
    }
  }
  return Array.from(detected);
}

/**
 * Resolve tool definition by ID, alias, or directory name
 */
export function getToolDefinition(toolIdentifier) {
  if (!toolIdentifier) return null;
  const clean = String(toolIdentifier).toLowerCase().replace(/^\./, '');
  if (TOOL_REGISTRY[clean]) return TOOL_REGISTRY[clean];

  for (const tool of Object.values(TOOL_REGISTRY)) {
    if (tool.detectDir === `.${clean}` || (tool.detectAliases && tool.detectAliases.includes(`.${clean}`))) {
      return tool;
    }
  }
  return null;
}

/**
 * Install bundled skills into all detected or specified agent tools
 */
export function installSkills(repoRoot, tools = []) {
  if (!exists(skillsAssetDir)) return;
  const count = listDir(skillsAssetDir).filter((d) => d.isDirectory()).length;
  const targetDirs = new Set(['.agents/skills']);

  // If user has an explicit .antigravity folder, copy skills there too
  if (exists(path.join(repoRoot, '.antigravity'))) {
    targetDirs.add('.antigravity/skills');
  }

  for (const t of tools) {
    const def = getToolDefinition(t);
    if (def) {
      targetDirs.add(def.skillsDir);
      if (def.detectAliases) {
        for (const alias of def.detectAliases) {
          if (exists(path.join(repoRoot, alias))) {
            targetDirs.add(path.join(alias, 'skills').replace(/\\/g, '/'));
          }
        }
      }
    } else {
      const clean = String(t).toLowerCase().replace(/^\./, '');
      if (clean) targetDirs.add(`.${clean}/skills`);
    }
  }

  for (const dir of targetDirs) {
    const dest = path.join(repoRoot, dir);
    copyTree(skillsAssetDir, dest);
    log.ok(`installed bundled skills (${count} skills) -> ${dir}/`);
  }
}

/**
 * Format markdown command template for a specific tool format
 */
function formatCommandContent(baseContent, baseName, format) {
  if (format === 'prompt-md') {
    // GitHub Copilot uses .prompt.md with standard YAML frontmatter
    return baseContent;
  }
  if (format === 'toml') {
    // Gemini CLI uses TOML command definitions
    const descMatch = baseContent.match(/^description:\s*["']?([\s\S]*?)["']?$/m);
    const desc = descMatch ? descMatch[1].trim() : `Execute ${baseName}`;
    const cleanBody = baseContent.replace(/^---[\s\S]*?---\r?\n/, '').trim();
    return `description = "${desc.replace(/"/g, '\\"')}"\n\nprompt = """\n${cleanBody}\n"""\n`;
  }
  return baseContent;
}

/**
 * Install slash commands and workflows across detected or specified tools
 */
export function installCommands(repoRoot, tools = []) {
  if (!exists(commandsAssetDir)) return;
  const commandFiles = listDir(commandsAssetDir).filter((f) => !f.isDirectory() && f.name.endsWith('.md'));
  if (commandFiles.length === 0) return;

  const targetTools = new Set(['agents']);
  for (const t of tools) {
    const def = getToolDefinition(t);
    if (def) targetTools.add(def.id);
  }

  // Also check if .antigravity exists on disk
  const hasAntigravityAlias = exists(path.join(repoRoot, '.antigravity'));

  for (const toolId of targetTools) {
    const def = TOOL_REGISTRY[toolId];
    if (!def) continue;

    const destDir = path.join(repoRoot, def.commandsDir);
    ensureDir(destDir);

    for (const cmdFile of commandFiles) {
      const baseName = cmdFile.name.replace(/\.md$/, '');
      const rawContent = readText(path.join(commandsAssetDir, cmdFile.name));
      const targetContent = formatCommandContent(rawContent, baseName, def.commandFormat);
      const targetFileName = `${baseName}${def.commandExt}`;
      writeText(path.join(destDir, targetFileName), targetContent);
    }
    log.ok(`installed slash commands (${commandFiles.length} commands) -> ${def.commandsDir}/`);

    // If antigravity alias folder exists, mirror workflows there too
    if (toolId === 'antigravity' && hasAntigravityAlias) {
      const aliasDir = path.join(repoRoot, '.antigravity', 'workflows');
      ensureDir(aliasDir);
      for (const cmdFile of commandFiles) {
        const rawContent = readText(path.join(commandsAssetDir, cmdFile.name));
        writeText(path.join(aliasDir, cmdFile.name), rawContent);
      }
      log.ok(`installed slash commands (${commandFiles.length} commands) -> .antigravity/workflows/`);
    }
  }
}

/**
 * Audit tool health for asdlc doctor
 */
export function checkToolHealth(repoRoot, toolId) {
  const def = TOOL_REGISTRY[toolId];
  if (!def) return null;

  const skillsPath = path.join(repoRoot, def.skillsDir);
  const commandsPath = path.join(repoRoot, def.commandsDir);

  const skillsOk = exists(skillsPath) && listDir(skillsPath).length > 0;
  const commandsOk = exists(commandsPath) && listDir(commandsPath).length > 0;

  let status = 'pass';
  let detail = `skills + commands installed (${def.commandsDir})`;

  if (!skillsOk && !commandsOk) {
    status = 'warn';
    detail = 'missing skills and commands (run `asdlc init`)';
  } else if (!skillsOk) {
    status = 'warn';
    detail = `missing skills in ${def.skillsDir} (run 'asdlc init')`;
  } else if (!commandsOk) {
    status = 'warn';
    detail = `missing commands in ${def.commandsDir} (run 'asdlc init')`;
  }

  return {
    id: def.id,
    name: def.name,
    status,
    detail,
    skillsOk,
    commandsOk,
  };
}
