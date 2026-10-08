import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { register as registerInit } from './commands/init.js';
import { register as registerNew } from './commands/new.js';
import { register as registerLint } from './commands/lint.js';
import { register as registerApprove } from './commands/approve.js';
import { register as registerApply } from './commands/apply.js';
import { register as registerVerify } from './commands/verify.js';
import { register as registerArchive } from './commands/archive.js';
import { register as registerStatus } from './commands/status.js';
import { register as registerDoctor } from './commands/doctor.js';
import { AsdlcError } from './lib/errors.js';
import { log } from './lib/log.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function buildCli() {
  const program = new Command();
  program
    .name('asdlc')
    .description('BU Agentic SDLC - an OpenSpec + Graphify flow behind one command.')
    .version(pkg.version);

  // The 7 stages, in order.
  registerInit(program); //    1. set up the repo
  registerNew(program); //     2. start a spec (scaffold + graph refresh + explore.md)
  registerLint(program); //    3. check the spec
  registerApprove(program); // 4. record approval (after the spec PR merges)
  registerApply(program); //   5. start implementing
  registerVerify(program); //  6. check the implementation
  registerArchive(program); // 7. finish (refresh graph + AGENTS.md)

  // Navigation + health (not stages).
  registerStatus(program); // where am I / what's next
  registerDoctor(program); // environment + setup health

  program.addHelpText('after', `
The flow (7 stages):
  asdlc init                     set up the repo (installs OpenSpec + Graphify, wires CI)
  asdlc new <ID>                 start a spec: scaffold + refresh the graph + explore.md
                                 (+ seed clarifications.md for the grilling interview)
  asdlc lint <ID>                check the spec (artifacts + review + BDD/acceptance criteria)
  <merge the spec PR>  asdlc approve <ID>   record the approved SHA + mark READY_FOR_IMPL
  asdlc apply <ID>               guard, then /opsx-apply (the spec must be approved)
  asdlc verify <ID>              check the implementation (approved SHA, tasks, tests, AI)
  asdlc archive <ID>             finish: refresh the graph + AGENTS.md

Navigation + health:
  asdlc status <ID>              where a change is in the 7 stages + the next command
  asdlc doctor                   environment + repo setup health

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
