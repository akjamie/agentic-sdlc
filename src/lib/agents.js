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

export function hasCurrentRouting(text = '') {
  return String(text).includes(ROUTING_MARKER) && String(text).includes('Two-Track Execution Flow');
}

const ROUTING_BLOCK = `${ROUTING_MARKER}
## Agentic SDLC — Two-Track Execution Flow

Everything runs through \`asdlc\` - do NOT call \`openspec ...\` directly. Check current level and mode with \`asdlc status <ID>\`.

### 📌 Track A: High-Risk & Core Modules (L2/L3 or spec-first)
Dual-PR lifecycle with cryptographic intent lock:
1. \`asdlc new "<intent>"\` (scaffold + explore + **grill-me interview embedded**, settle \`clarifications.md\`, then author proposal/specs) -> 
2. \`asdlc lint <ID>\` -> 3. \`asdlc pr <ID> <target>\` (Spec PR) -> 4. Human merge & \`asdlc approve <ID>\` -> 
5. \`asdlc apply <ID>\` (TDD loop) -> 6. \`asdlc verify <ID>\` -> 7. \`asdlc pr <ID> <target>\` (Impl PR) -> 8. \`asdlc archive <ID>\`.

### ⚡ Track B: Bounded & Routine Modules (L0/L1 under supervised/auto)
Fast-path Single-PR lifecycle (Spec & code in one PR, human confirms at merge):
1. \`asdlc new "<intent>"\` (grill-me interview embedded) -> 2. Draft \`specs/\` & \`tasks.md\` -> 
3. \`asdlc apply <ID>\` (directly starts TDD loop; **separate Spec PR and \`asdlc approve\` are waived**) -> 
4. \`asdlc verify <ID>\` -> 5. \`asdlc pr <ID> <target>\` (Single PR; human Approve at merge is still required under supervised; auto per policy) -> 6. \`asdlc archive <ID>\`.

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
