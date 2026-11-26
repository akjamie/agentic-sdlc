import path from 'node:path';
import { exists, readText, writeText, walkFiles } from './fs.js';
import { changeDir } from './paths.js';

/**
 * Parse `- [ ] ACn: <description> (test: <path>)` acceptance criteria grouped by Requirement.
 */
export function parseSpecAcceptanceCriteria(specText) {
  const acs = [];
  const lines = String(specText ?? '').split(/\r?\n/);
  let currentReq = '';

  for (const line of lines) {
    const reqMatch = line.match(/^###\s+Requirement:\s*(.+?)\s*$/);
    if (reqMatch) {
      currentReq = reqMatch[1];
      continue;
    }
    const acMatch = line.match(/^\s*-\s*\[[ xX]\]\s*(AC\d+)\s*:\s*(.+)$/);
    if (!acMatch) continue;
    const testMatch = line.match(/\(test:\s*([^)]+?)\s*\)/i);
    acs.push({
      id: acMatch[1],
      requirement: currentReq,
      text: acMatch[2].replace(/\(test:.*$/i, '').trim(),
      testPath: testMatch ? testMatch[1].trim() : null,
    });
  }
  return acs;
}

function hasUiSurface(designText, specEntries) {
  if (designText && /(UI\/UX|Visual|Breakpoints|Loading\s+Skeleton|Empty\s+State|Component)/i.test(designText)) {
    return true;
  }
  return specEntries.some(({ content }) => /(Playwright|responsive\s+breakpoint|Empty,\s*Loading,\s*Error)/i.test(content));
}

/**
 * Compile `openspec/changes/<slug>/tasks.md` deterministically from spec ACs.
 * Idempotent: never overwrites an existing non-empty `tasks.md`.
 * Fails closed (`generated: false`) if no valid ACs exist in specs.
 */
export function generateTasksFromSpecs(repoRoot, slug) {
  const cdir = changeDir(repoRoot, slug);
  const tasksPath = path.join(cdir, 'tasks.md');

  if (exists(tasksPath) && readText(tasksPath).trim().length > 0) {
    return { generated: false, reason: 'already_exists', path: tasksPath };
  }

  const specsDir = path.join(cdir, 'specs');
  if (!exists(specsDir)) {
    return { generated: false, reason: 'no_specs', path: tasksPath };
  }

  const specFiles = walkFiles(specsDir).filter((f) => f.endsWith('spec.md'));
  const specEntries = specFiles.map((rel) => {
    const content = readText(path.join(specsDir, rel));
    return { rel: rel.replace(/\\/g, '/'), content, acs: parseSpecAcceptanceCriteria(content) };
  });

  const allAcs = specEntries.flatMap((e) => e.acs.map((ac) => ({ ...ac, specFile: e.rel })));
  if (allAcs.length === 0) {
    return { generated: false, reason: 'no_acs', path: tasksPath };
  }

  const designPath = path.join(cdir, 'design.md');
  const designText = exists(designPath) ? readText(designPath) : '';
  const uiTasksIncluded = hasUiSurface(designText, specEntries);

  const lines = [
    `# Tasks: ${slug}`,
    '',
    '> Auto-generated from capability specs (mutable during implementation: refine, split, or append TDD tasks as needed).',
    '> Follow strict task-level TDD loop (RED -> GREEN -> REFACTOR -> EVIDENCE).',
    '',
  ];

  let taskCount = 0;

  if (uiTasksIncluded) {
    lines.push('## 0. UI/UX Foundation & Component States (`design.md`)');
    lines.push('- [ ] 0.1 [UI/DESIGN] Establish design tokens, responsive layout containers, and theme styles');
    lines.push('- [ ] 0.2 [UI/COMPONENTS] Implement Empty, Loading, Error, and Success states with component render tests');
    lines.push('');
    taskCount += 2;
  }

  const groups = new Map();
  for (const ac of allAcs) {
    const key = `${ac.specFile}::${ac.requirement || 'General'}`;
    if (!groups.has(key)) {
      groups.set(key, { specFile: ac.specFile, requirement: ac.requirement || 'Capability Requirements', acs: [] });
    }
    groups.get(key).acs.push(ac);
  }

  let sectionNum = 1;
  for (const group of groups.values()) {
    lines.push(`## ${sectionNum}. ${group.requirement} (\`specs/${group.specFile}\`)`);
    let subNum = 1;
    for (const ac of group.acs) {
      const testRef = ac.testPath ? ` (\`${ac.testPath}\`)` : '';
      lines.push(`- [ ] ${sectionNum}.${subNum} [TEST] Write failing test for ${ac.id}: ${ac.text}${testRef}`);
      subNum += 1;
      lines.push(`- [ ] ${sectionNum}.${subNum} [IMPL] Implement minimal code to satisfy ${ac.id}${testRef}`);
      subNum += 1;
      taskCount += 2;
    }
    lines.push('');
    sectionNum += 1;
  }

  writeText(tasksPath, `${lines.join('\n').trimEnd()}\n`);
  return {
    generated: true,
    taskCount,
    acCount: allAcs.length,
    uiTasksIncluded,
    path: tasksPath,
  };
}
