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

  program.addHelpText('after', `
The flow:
  asdlc init                     set up the repo (installs OpenSpec + Graphify, wires CI)
  asdlc new "<requirement>"     start a spec: scaffold + refresh graph + explore.md + grilling
  asdlc lint <ID>                check the spec (artifacts + BDD + acceptance criteria)
  asdlc pr <ID> <targetBranch>   open the Spec PR (pushes branch + auto-creates PR via CLI or API)
  asdlc approve <ID>             record approval (on PR / merge / in-place) + mark READY_FOR_IMPL
  asdlc apply <ID>               guard, then /opsx-apply (task-level TDD loop)
  asdlc test <ID>                run acceptance tests mapped from change specs (TDD & CI gate)
  asdlc verify <ID>              check the implementation (artifacts, tasks, tests, AI)
  asdlc archive <ID>             finish: archive change + sync living specs to openspec/specs/

Navigation, health & maintenance:
  asdlc status <ID>              where a change is in the 7 stages + the next command
  asdlc doctor                   environment + repo setup health
  asdlc update                   update repo state: skills, AST knowledge graph (KB) & AGENTS.md
  asdlc upgrade [--global]       upgrade asdlc CLI, openspec, graphify & managed schema
  asdlc skills list              list all available bundled agent skills
  asdlc skills install --global  install skills globally for CI/headless agents (opencode, pi, dsh)

A bad spec is not edited: close it and run \`asdlc new\` again.`);
  return program;
}

export async function run(argv = process.argv) {
  const program = buildCli();
  program.exitOverride();
  try {
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
