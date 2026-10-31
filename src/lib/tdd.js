// Pure TDD analysis functions (deterministic, no side effects)

export function isTestFile(file) {
  const normalized = String(file).replace(/\\/g, '/');
  return (
    /(?:^|\/)(?:tests?|__tests__|testing|spec|fixtures?|mocks?)\//i.test(normalized) ||
    /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(normalized) ||
    /_test\.go$/i.test(normalized) ||
    /test_[^/]+\.py$/i.test(normalized) ||
    /[^/]+_test\.py$/i.test(normalized) ||
    /(?:^|\/).*(?:Test|Tests|TestCase|IT)\.(?:java|kt|scala)$/i.test(normalized)
  );
}

export function isSourceFile(file) {
  const normalized = String(file).replace(/\\/g, '/');
  if (isTestFile(normalized)) return false;
  // Ignore governance, docs, config, openspec change specs
  if (/^(?:openspec|\.sdlc|docs|\.githooks|jenkins)\//i.test(normalized)) return false;
  if (/\.(?:md|markdown|json|ya?ml|toml|lock|gitignore|editorconfig|png|jpg|svg|ico)$/i.test(normalized)) return false;
  // Source code files
  return (
    /\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|java|rs|rb|c|cpp|cs|php|swift|kt)$/i.test(normalized) ||
    /^(?:src|lib|app|bin)\//i.test(normalized)
  );
}

export function checkTestPresence(changedFiles = []) {
  const sources = changedFiles.filter(isSourceFile);
  const tests = changedFiles.filter(isTestFile);

  if (sources.length > 0 && tests.length === 0) {
    return {
      ok: false,
      sources,
      tests,
      detail: `${sources.length} source file(s) modified (${sources.slice(0, 3).join(', ')}${sources.length > 3 ? '...' : ''}) without corresponding test files in diff`,
    };
  }

  return {
    ok: true,
    sources,
    tests,
    detail: sources.length === 0
      ? 'no source files modified'
      : `${sources.length} source file(s), ${tests.length} test file(s) in diff`,
  };
}

export function checkTaskEvidence(tasksText) {
  if (!tasksText || !tasksText.trim()) {
    return { ok: false, detail: 'tasks.md is empty' };
  }
  const lines = tasksText.split(/\r?\n/);
  const checkedIndices = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*-\s*\[[xX]\]/.test(lines[i])) checkedIndices.push(i);
  }
  if (checkedIndices.length === 0) {
    return { ok: false, detail: 'no completed tasks found' };
  }

  const hasCheckedTestTask = checkedIndices.some((idx) => /\[TEST\]/i.test(lines[idx]));

  // Each completed task must carry explicit verification / AC / test mapping,
  // OR be an [IMPL] task paired with at least one completed [TEST] task (or nested verify/evidence sub-bullet).
  // Standalone `- [x] 1.1 [IMPL] done` with zero [TEST] tasks and zero verification evidence is rejected.
  const missingVerification = checkedIndices.filter((idx) => {
    const line = lines[idx];
    // Collect any indented sub-bullets immediately under this task
    let block = line;
    for (let j = idx + 1; j < lines.length; j += 1) {
      if (/^\s*-\s*\[[ xX]\]/.test(lines[j]) || /^#+\s/.test(lines[j])) break;
      if (/^\s{2,}[-*]/.test(lines[j])) block += `\n${lines[j]}`;
    }

    if (/(?:verify:|test:|\(test:|\(AC\d+\)|evidence:|\[TEST\])/i.test(block)) {
      return false;
    }
    if (/\[IMPL\]/i.test(line) && hasCheckedTestTask) {
      return false;
    }
    return true;
  });

  if (missingVerification.length > 0) {
    return {
      ok: false,
      detail: `${missingVerification.length} completed task(s) lack verification statement, paired [TEST] task, or test mapping`,
    };
  }

  return { ok: true, detail: `${checkedIndices.length} completed task(s) verified` };
}
