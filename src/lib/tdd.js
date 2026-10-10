// Pure TDD analysis functions (deterministic, no side effects)

export function isTestFile(file) {
  const normalized = String(file).replace(/\\/g, '/');
  return (
    /(?:^|\/)(?:tests?|__tests__|spec)\//i.test(normalized) ||
    /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(normalized)
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
  const lines = tasksText.split('\n');
  const checked = lines.filter((l) => /^\s*-\s*\[[xX]\]/.test(l));
  if (checked.length === 0) {
    return { ok: false, detail: 'no completed tasks found' };
  }

  // Each completed task should indicate verification:
  // e.g. verify:, test:, (test: ...), (AC...), evidence:, or [TEST]
  const missingVerification = checked.filter((l) => {
    return !/(?:verify:|test:|\(test:|\(AC\d+\)|evidence:|\[TEST\]|\[IMPL\])/i.test(l);
  });

  if (missingVerification.length > 0) {
    return {
      ok: false,
      detail: `${missingVerification.length} completed task(s) lack verification statement or test mapping`,
    };
  }

  return { ok: true, detail: `${checked.length} completed task(s) verified` };
}
