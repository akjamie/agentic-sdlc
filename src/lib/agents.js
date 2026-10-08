import path from 'node:path';
import { exists, readText, writeText } from './fs.js';
import { runShell } from './exec.js';
import { graphExists } from './graphify.js';

// AGENTS.md is the routing layer the agentic IDE reads. Two machine-managed
// blocks (markers): the asdlc workflow, and the system status derived from the
// graphify graph (deterministic query, not an LLM summary). Hand-written
// content elsewhere in AGENTS.md is preserved.

export const ROUTING_MARKER = '<!-- asdlc:routing -->';
export const STATUS_MARKER = '<!-- asdlc:system-status -->';

const ROUTING_BLOCK = `${ROUTING_MARKER}
## Agentic SDLC — the 7 stages (one front door)

Everything runs through \`asdlc\` - do NOT call \`openspec ...\` directly. There is no
raw escape hatch: the wrappers ARE the guards (graph refresh, approval, checks).

1. **new** - \`asdlc new <ID>\`: scaffold the change + refresh the knowledge graph +
   write \`explore.md\` + seed \`clarifications.md\`. This is stage 1.
2. **grill** - run the **grilling** skill with the author (a relentless design-tree
   interview, in rounds: ask the whole frontier, recommend an answer, look facts up
   yourself) and record the settled decisions in \`clarifications.md\`. THEN author
   **proposal.md -> specs/** -> review.md**, grounded in \`explore.md\`.
3. **lint** - \`asdlc lint <ID>\`: artifacts + review record + BDD/acceptance criteria.
4. **approve** - a human merges the spec PR; then \`asdlc approve <ID>\` records the
   path-limited approved SHA + READY_FOR_IMPL.
5. **apply** - \`asdlc apply <ID>\` (guard: the spec must be approved), then
   \`/opsx-apply\` with task-level TDD + task-level converge.
6. **verify** - \`asdlc verify <ID>\`: approved SHA, artifacts, tasks complete, tests, AI.
7. **archive** - \`asdlc archive <ID>\`: refresh the graph + this file.

Need orientation? \`asdlc status <ID>\` (where am I / next command) and \`asdlc doctor\`
(environment health). A bad spec is never edited: close it and \`asdlc new\` again.`;

function upsertBlock(text, marker, block) {
  const idx = text.indexOf(marker);
  if (idx < 0) {
    const sep = text && !text.endsWith('\n') ? '\n' : '';
    return `${text}${sep}${sep}${block}\n`;
  }
  const rest = text.slice(idx + marker.length);
  const next = rest.match(/\n<!-- asdlc:/);
  const end = next ? idx + marker.length + next.index : text.length;
  return `${text.slice(0, idx)}${block}\n${text.slice(end)}`;
}

function systemStatusBlock(repoRoot) {
  if (!graphExists(repoRoot)) return `${STATUS_MARKER}
## System status (from the knowledge graph)

_(graph not built yet - run \`asdlc init\` or \`asdlc new <change>\`)_`;
  const res = runShell('graphify god-nodes', repoRoot);
  const body = (res.stdout || '').trim().split(/\r?\n/).slice(0, 15).join('\n');
  return `${STATUS_MARKER}
## System status (from the knowledge graph, generated - do not hand-edit)

${body || '_(no nodes)_'}

_Architectural hubs = the most-connected modules. Run \`asdlc new <change>\`
to query the graph for detail._`;
}

export function refreshAgents(repoRoot, { systemStatus = true } = {}) {
  const p = path.join(repoRoot, 'AGENTS.md');
  let text = exists(p) ? readText(p) : '';
  text = upsertBlock(text, ROUTING_MARKER, ROUTING_BLOCK);
  if (systemStatus) text = upsertBlock(text, STATUS_MARKER, systemStatusBlock(repoRoot));
  writeText(p, text);
  return p;
}
