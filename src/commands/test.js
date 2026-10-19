import path from 'node:path';
import { exists, readText, walkFiles } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { requireRepo, toChangeSlug } from '../lib/cliutil.js';
import { runShell } from '../lib/exec.js';
import { fail } from '../lib/errors.js';
import { log } from '../lib/log.js';

export function parseSpecAcceptanceCriteria(specText) {
  const acs = [];
  const lines = specText.split('\n');
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

export function runTests(changeId, opts = {}) {
  const repoRoot = requireRepo(opts);
  const slug = toChangeSlug(changeId);
  const cdir = changeDir(repoRoot, slug);

  if (!exists(cdir)) {
    fail(`change '${slug}' not found`, { hint: 'check the change id or run `asdlc status`' });
  }

  const specsDir = path.join(cdir, 'specs');
  if (!exists(specsDir)) {
    fail(`no specs directory found for change '${slug}'`);
  }

  const specFiles = walkFiles(specsDir).filter((f) => f.endsWith('spec.md'));
  if (specFiles.length === 0) {
    fail(`no spec.md files found under specs/ for change '${slug}'`);
  }

  const allAcs = [];
  for (const relFile of specFiles) {
    const fullPath = path.join(specsDir, relFile);
    const content = readText(fullPath);
    const acs = parseSpecAcceptanceCriteria(content);
    for (const ac of acs) {
      allAcs.push({ ...ac, specFile: relFile });
    }
  }

  if (allAcs.length === 0) {
    fail(`no acceptance criteria (AC<n>) found in specs for change '${slug}'`, {
      hint: 'add acceptance criteria with test mappings: - [ ] AC1: ... (test: path/to/test)',
    });
  }

  const missingMappings = allAcs.filter((ac) => !ac.testPath);
  if (missingMappings.length > 0) {
    fail(`${missingMappings.length} acceptance criteria lack (test: <path>) mappings:\n` +
      missingMappings.map((ac) => `  - ${ac.id}: ${ac.text}`).join('\n'));
  }

  const uniqueTestPaths = [...new Set(allAcs.map((ac) => ac.testPath))];
  const missingFiles = uniqueTestPaths.filter((tp) => !exists(path.resolve(repoRoot, tp)));
  if (missingFiles.length > 0) {
    fail(`mapped test file(s) do not exist:\n` + missingFiles.map((f) => `  - ${f}`).join('\n'), {
      hint: 'create test stubs or update (test: <path>) in specs',
    });
  }

  if (!opts.json) {
    log.info(`=== Running Acceptance Tests for ${slug} ===`);
    log.info(`Mapped ACs: ${allAcs.length} across ${uniqueTestPaths.length} test file(s):`);
    for (const ac of allAcs) {
      log.info(`  • [${ac.id}] ${ac.text} -> ${ac.testPath}`);
    }
    log.info('');
  }

  const runnerCmd = opts.runner ?? (process.platform === 'win32'
    ? `node --test ${uniqueTestPaths.map((p) => `"${p}"`).join(' ')}`
    : `node --test ${uniqueTestPaths.join(' ')}`);

  const res = runShell(runnerCmd, repoRoot, {
    env: { NODE_TEST_CONTEXT: undefined },
    stdio: 'pipe',
  });
  const passed = res.status === 0;

  if (opts.json) {
    const output = {
      changeId: slug,
      pass: passed,
      status: passed ? 'pass' : 'fail',
      acCount: allAcs.length,
      testFiles: uniqueTestPaths,
      acs: allAcs,
      stdout: res.stdout,
      stderr: res.stderr,
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);

    if (passed) {
      log.ok(`✓ all acceptance tests passed (${allAcs.length} ACs, ${uniqueTestPaths.length} files)`);
    } else {
      log.error(`✗ acceptance test run failed (exit code ${res.status})`);
    }
  }

  return passed ? 0 : 1;
}

export function register(program) {
  program
    .command('test <changeId>')
    .description('run acceptance tests mapped from change specs (TDD & CI gate)')
    .option('--json', 'output structured JSON report for CI consumption')
    .option('--runner <command>', 'custom test runner command')
    .option('--repo-root <path>')
    .action((changeId, opts) => {
      process.exitCode = runTests(changeId, opts);
    });
}
