import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { register as registerInit } from './commands/init.js';
import { register as registerNew } from './commands/new.js';
import { register as registerLint } from './commands/lint.js';
import { register as registerPr } from './commands/pr.js';
import { register as registerApprove } from './commands/approve.js';
import { register as registerApply } from './commands/apply.js';
import { register as registerTest } from './commands/test.js';
import { register as registerVerify } from './commands/verify.js';
import { register as registerArchive } from './commands/archive.js';
import { register as registerStatus } from './commands/status.js';
import { register as registerDoctor } from './commands/doctor.js';
import { register as registerUpgrade } from './commands/upgrade.js';
import { register as registerUpdate } from './commands/update.js';
import { register as registerSkills } from './commands/skills.js';
import { register as registerAssess } from './commands/assess.js';
import { register as registerConfig } from './commands/config.js';
import { AsdlcError } from './lib/errors.js';
import { log } from './lib/log.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function buildCli() {
  const program = new Command();
  program
    .name('asdlc')
    .description('Agentic SDLC - an OpenSpec + Graphify flow behind one command.')
    .version(pkg.version);

  // The 7 stages, in order.
  registerInit(program); //    1. set up the repo
  registerNew(program); //     2. start a spec (scaffold + graph refresh + explore.md)
  registerLint(program); //    3. check the spec
  registerPr(program); //      3.5 open the Spec PR automatically
  registerApprove(program); // 4. record approval (after the spec PR merges or in-place)
  registerApply(program); //   5. start implementing
  registerTest(program); //    5.5 run acceptance tests mapped from change specs (TDD & CI gate)
  registerVerify(program); //  6. check the implementation
  registerArchive(program); // 7. finish (sync living specs to openspec/specs/)

  // Navigation + health + maintenance (not stages).
  registerStatus(program); // where am I / what's next
  registerDoctor(program); // environment + setup health
  registerUpdate(program); // update repo state: skills, AST graph (KB) & AGENTS.md
  registerUpgrade(program); // upgrade toolchain (asdlc, openspec, graphify, schema)
  registerSkills(program); // manage & install bundled agent skills (repo or global CI)
  registerAssess(program); // evaluate risk & governance requirements (CI & local tool)
  registerConfig(program); // manage machine global configuration (~/.asdlc/config.yaml)

  program.addHelpText('after', `
The flow ([CLI] runs standalone; [Agent] runs inside OpenCode / Claude Code / Antigravity / Cursor):
  [CLI]        asdlc init                     set up the repo (installs OpenSpec + Graphify, wires CI)
  [Agent]      /asdlc-new "<requirement>"     start a spec: scaffold + graph + explore.md + grilling (CLI: --scaffold-only)
  [Agent]      /asdlc-spec-review <ID|PR>     independent AI spec review (Player != Referee)
  [CLI]        asdlc lint <ID>                check the spec (artifacts + BDD + acceptance criteria)
  [CLI]        asdlc pr <ID> [targetBranch]   open the Spec/Impl PR (pushes branch + attaches review labels)
  [CLI]        asdlc approve <ID>             record approval (on PR / merge / in-place) + mark READY_FOR_IMPL
  [Agent]      /asdlc-apply <ID>              guard + task-level TDD loop / fix PR comments (CLI: --guard-only)
  [CLI]        asdlc test <ID>                run acceptance tests mapped from change specs (TDD & CI gate)
  [CLI]        asdlc verify <ID>              check the implementation (artifacts, tasks, tests, AI)
  [Agent]      /asdlc-impl-review <ID|PR>     independent AI implementation review (Player != Referee)
  [CLI]        asdlc archive <ID>             finish: archive change + sync living specs to openspec/specs/

Navigation, health & maintenance:
  asdlc status [ID]              where a change is in the 7 stages (or portfolio overview if omitted)
  asdlc doctor                   environment + repo setup health
  asdlc update                   update repo state: skills, AST knowledge graph (KB) & AGENTS.md
  asdlc upgrade [--global]       upgrade asdlc CLI, openspec, graphify & managed schema
  asdlc skills list              list all available bundled agent skills
  asdlc skills install --global  install skills globally for CI/headless agents (opencode, pi, dsh)
  asdlc config <set|get|list>    manage global settings (~/.asdlc/config.yaml, workflow_mode)

A bad spec is not edited: close it and run \`asdlc new\` again.`);
  return program;
}

const REVIEW_ENTRY = (subcmd) => ({
  message: `'asdlc ${subcmd}' cannot run in a terminal — independent Implementation/Spec Review requires an AI Agent session (Player ≠ Referee).`,
  hint: 'Open an independent AI Agent session (OpenCode, Claude Code, Antigravity, Cursor) and run: /asdlc-impl-review <changeId_or_PR> (or /asdlc-spec-review <changeId_or_PR>)',
});

const GRILL_ENTRY = (subcmd) => ({
  message: `'asdlc ${subcmd}' cannot run in a terminal — interactive design grilling requires an AI Agent session.`,
  hint: 'Run \'/asdlc-new "<requirement>"\' or \'/grill-me\' inside your AI Agent (OpenCode, Claude Code, Antigravity, Cursor).',
});

const AGENT_ONLY_COMMANDS = {
  'spec-review': {
    message: "'asdlc spec-review' cannot run in a terminal — independent Spec Review requires an AI Agent session (Player ≠ Referee).",
    hint: 'Open an independent AI Agent session (OpenCode, Claude Code, Antigravity, Cursor) and run: /asdlc-spec-review <changeId_or_PR>',
  },
  'impl-review': REVIEW_ENTRY('impl-review'),
  'pr-review': REVIEW_ENTRY('pr-review'),
  review: REVIEW_ENTRY('review'),
  grill: GRILL_ENTRY('grill'),
  'grill-me': GRILL_ENTRY('grill-me'),
  'batch-grill-me': GRILL_ENTRY('batch-grill-me'),
  intake: {
    message: "'asdlc intake' cannot run standalone in a terminal — external ticket resolution requires an AI Agent session.",
    hint: 'Run \'/asdlc-new "<requirement>" --from-issue <TICKET>\' inside your AI Agent.',
  },
  run: {
    message: "'asdlc run' is not a standalone CLI command — autonomous stage execution must be driven inside an AI Agent session.",
    hint: "For PR review, run '/asdlc-impl-review <PR_URL>' in your AI Agent; for local verification gates, run 'asdlc verify <changeId>'.",
  },
};

function firstSubcommand(args) {
  for (const token of args) {
    if (!token.startsWith('-')) return token;
  }
  return null;
}

export async function run(argv = process.argv) {
  const program = buildCli();
  program.exitOverride();
  try {
    const subcmd = firstSubcommand(argv.slice(2));
    if (subcmd && Object.prototype.hasOwnProperty.call(AGENT_ONLY_COMMANDS, subcmd)) {
      const entry = AGENT_ONLY_COMMANDS[subcmd];
      throw new AsdlcError(entry.message, {
        code: 'AGENT_RUNTIME_REQUIRED',
        exitCode: 1,
        hint: entry.hint,
      });
    }
    await program.parseAsync(argv);
    return process.exitCode ?? 0;
  } catch (err) {
    if (err?.code?.startsWith('commander.')) return err.exitCode ?? 0;
    if (err instanceof AsdlcError) {
      log.error(err.message);
      if (err.hint) log.info(`  hint: ${err.hint}`);
      if (err.detail) log.info(`  ${err.detail}`);
      return err.exitCode;
    }
    log.error(err?.message ?? String(err));
    if (process.env.ASDLC_DEBUG) log.error(err?.stack ?? '');
    return 1;
  }
}
