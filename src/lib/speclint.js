// Deterministic spec lint harness: enforces BDD + Acceptance Criteria.
// Pure functions (text -> findings). No LLM => stable, reproducible.
// The ONLY filesystem access is the optional (test: <path>) existence check,
// which is enabled by passing `repoRoot`.
import { exists } from './fs.js';
import { resolve } from 'node:path';
//
// Rules:
//   R0 no-requirements      blocker
//   R1 purpose              blocker  (new capability: ## Purpose >= 50 chars)
//   R2 normative            blocker  (each Requirement needs SHALL/MUST)
//   R3 scenario             blocker  (each Requirement needs >= 1 scenario)
//   R4 when/then/given      blocker/major (BDD shape)
//   R5 ac                   blocker  (each Requirement needs >= 1 AC<n>)
//   R6 ac-test              blocker  (each AC needs a (test: <path>) mapping)
//   R7 test-strategy        blocker  (## Test Strategy present)
//   R8 removed-reason       major    (REMOVED requires **Reason**)

const REQ_HEAD = /^###\s+Requirement:\s*(.+?)\s*$/;
const SCEN_HEAD = /^####\s+Scenario:\s*(.+?)\s*$/;
const SEC_HEAD = /^##\s+(.+?)\s*$/;
const OPERATIONS = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/;

function topSection(text, name) {
  const lines = text.split('\n');
  const re = new RegExp(`^##\\s+${name}\\s*$`, 'i');
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (SEC_HEAD.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

function requirements(text) {
  const out = [];
  let section = null;
  let cur = null;
  for (const line of text.split('\n')) {
    if (SEC_HEAD.test(line)) {
      if (cur) { out.push(cur); cur = null; }
      const op = line.match(OPERATIONS);
      if (op) section = op[1];
      continue;
    }
    const r = line.match(REQ_HEAD);
    if (r) {
      if (cur) out.push(cur);
      cur = { name: r[1], section, text: [] };
      continue;
    }
    if (cur) cur.text.push(line);
  }
  if (cur) out.push(cur);
  return out.map((r) => ({ ...r, body: r.text.join('\n') }));
}

function scenarios(body) {
  const out = [];
  let cur = null;
  for (const line of body.split('\n')) {
    const s = line.match(SCEN_HEAD);
    if (s) {
      if (cur) out.push(cur);
      cur = { name: s[1], text: [] };
      continue;
    }
    if (cur) cur.text.push(line);
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ name: s.name, text: s.text.join('\n') }));
}

function acceptanceCriteria(body) {
  const out = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trimEnd();
    const m = trimmed.match(/^\s*-\s*\[[ xX]\]\s*(AC\d+)\s*:\s*(.+)$/);
    if (!m) continue;
    const t = trimmed.match(/\(test:\s*([^)]+?)\s*\)/i);
    out.push({ id: m[1], text: m[2].replace(/\(test:.*$/i, '').trim(), test: t ? t[1].trim() : null });
  }
  return out;
}

function sortFindings(a, b) {
  const key = (x) => `${x.location}||${x.code}||${x.message}`;
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
}

// Policy-as-code: severities are configurable per repo (openspec/config.yaml
// -> lint.rules), and the ruleset is versioned so historic changes can be
// grandfathered instead of silently invalidated by future rule changes.
export const LINT_VERSION = 2;

const DEFAULT_SEVERITY = {
  'R0-no-requirements': 'blocker',
  'R1-purpose': 'blocker',
  'R2-normative': 'blocker',
  'R3-scenario': 'blocker',
  'R4-when': 'blocker',
  'R4-then': 'blocker',
  'R4-given': 'major',
  'R5-ac': 'blocker',
  'R5-scenario-coverage': 'blocker',
  'R6-ac-test': 'blocker',
  'R7-test-strategy': 'blocker',
  'R8-removed-reason': 'major',
};

export function lintSpecText(rawText, { requireGiven = true, repoRoot = null, rules = {} } = {}) {
  const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const findings = [];
  const add = (code, rawSeverity, message, location = '') => {
    const configured = rules[code] ?? DEFAULT_SEVERITY[code] ?? rawSeverity;
    if (configured === 'off') return;
    findings.push({ code, severity: configured, location, message });
  };

  const hasAdded = /^##\s+ADDED\s+Requirements\s*$/m.test(text);
  const purpose = topSection(text, 'Purpose') ?? '';
  if (hasAdded && purpose.trim().length < 50) {
    add('R1-purpose', 'blocker', 'Purpose missing or shorter than 50 characters', '## Purpose');
  }

  if ((topSection(text, 'Test Strategy') ?? '').trim().length === 0) {
    add('R7-test-strategy', 'blocker', 'Missing or empty ## Test Strategy', '## Test Strategy');
  }

  const reqs = requirements(text);
  if (reqs.length === 0) add('R0-no-requirements', 'blocker', 'No "### Requirement:" found', '');

  for (const r of reqs) {
    if (r.section === 'REMOVED') {
      if (!/\*\*Reason\*\*/.test(r.body)) add('R8-removed-reason', 'major', `REMOVED "${r.name}" lacks **Reason**`, r.name);
      continue;
    }
    if (r.section === 'RENAMED') continue;
    if (!/\b(SHALL|MUST)\b/.test(r.body)) add('R2-normative', 'blocker', `"${r.name}" has no SHALL/MUST statement`, r.name);

    const scens = scenarios(r.body);
    if (scens.length === 0) add('R3-scenario', 'blocker', `"${r.name}" has no Scenario`, r.name);
    for (const s of scens) {
      if (!/\*\*WHEN\*\*/.test(s.text)) add('R4-when', 'blocker', `Scenario "${s.name}" missing WHEN`, `${r.name} / ${s.name}`);
      if (!/\*\*THEN\*\*/.test(s.text)) add('R4-then', 'blocker', `Scenario "${s.name}" missing THEN`, `${r.name} / ${s.name}`);
      if (requireGiven && !/\*\*GIVEN\*\*/.test(s.text)) add('R4-given', 'major', `Scenario "${s.name}" missing GIVEN`, `${r.name} / ${s.name}`);
    }

    const acs = acceptanceCriteria(r.body);
    if (acs.length === 0) {
      add('R5-ac', 'blocker', `"${r.name}" has no Acceptance criteria (AC<n>)`, r.name);
    } else if (scens.length > acs.length) {
      add('R5-scenario-coverage', 'blocker', `"${r.name}" defines ${scens.length} scenario(s) but only ${acs.length} acceptance criteria (each scenario requires AC coverage)`, r.name);
    }
    for (const ac of acs) {
      if (!ac.test) {
        add('R6-ac-test', 'blocker', `"${ac.id}" has no (test: <path>) mapping`, `${r.name} / ${ac.id}`);
      } else if (repoRoot) {
        // "Does the mapping exist" is not enough: the referenced test file must
        // actually exist, otherwise the AC is unverifiable decoration.
        if (!exists(resolve(repoRoot, ac.test))) {
          add('R6-ac-missing-test', 'blocker', `"${ac.id}" maps to a test that does not exist: ${ac.test}`, `${r.name} / ${ac.id}`);
        }
      }
    }
  }

  return findings.sort(sortFindings);
}

export function countBlockers(findings) {
  return findings.filter((f) => f.severity === 'blocker').length;
}
