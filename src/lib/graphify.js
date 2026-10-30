import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { exists, readText, writeText } from './fs.js';
import { headSha } from './git.js';

// graphify is a BU-standard authoring aid: it builds a code-derived knowledge
// graph (deterministic AST, no LLM key) that the drafting agent queries for a
// map of the codebase before writing a spec. It is NOT a gate.
//
// The graph is a DERIVED CACHE bound to the current HEAD (graphify-out/), never
// committed; refreshed when HEAD moves.

const GRAPH_REL = 'graphify-out/graph.json';
const REF_REL = 'graphify-out/.asdlc_ref';
export const GITIGNORE_LINE = 'graphify-out/';

function which(name) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [name], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? null;
}

export function graphifyAvailable() {
  return Boolean(which('graphify'));
}

// Default-install per the BU standard (uv preferred, else pip). Never throws.
export function ensureGraphify({ autoInstall = true } = {}) {
  if (graphifyAvailable()) return { installed: true, action: 'present' };
  if (!autoInstall) return { installed: false, action: 'missing' };
  const viaUv = Boolean(which('uv'));
  const cmd = viaUv ? ['uv', 'tool', 'install', '--upgrade', 'graphifyy'] : ['pip', 'install', 'graphifyy'];
  try {
    execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    /* fall through to the availability check */
  }
  return { installed: graphifyAvailable(), action: viaUv ? 'uv-install' : 'pip-install' };
}

function run(args, cwd) {
  try {
    return { status: 0, stdout: execFileSync('graphify', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { status: e.status ?? 1, stdout: (e.stdout ?? '').toString(), stderr: (e.stderr ?? '').toString() };
  }
}

export function graphExists(repoRoot) {
  return exists(path.join(repoRoot, GRAPH_REL));
}

export function readRef(repoRoot) {
  const p = path.join(repoRoot, REF_REL);
  return exists(p) ? readText(p).trim() : null;
}

/**
 * Loads the Graphify knowledge graph JSON.
 * Returns null if missing or invalid.
 */
export function loadGraphData(repoRoot) {
  if (!repoRoot) return null;
  const p = path.join(repoRoot, GRAPH_REL);
  if (!exists(p)) return null;
  try {
    return JSON.parse(readText(p));
  } catch {
    return null;
  }
}

/**
 * Calculates cross-file fan-in (inbound dependency count) from Graphify AST.
 * If file touches high-centrality symbols or modules, returns metrics.
 */
export function getGraphTopologyMetrics(repoRoot) {
  const graph = loadGraphData(repoRoot);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    return { available: false, fileInDegree: {}, godNodes: [] };
  }

  const nodeToFile = {};
  const fileInDegree = {};

  for (const n of graph.nodes) {
    if (n.source_file) {
      nodeToFile[n.id] = String(n.source_file).replace(/\\/g, '/');
    }
  }

  for (const link of graph.links) {
    const targetFile = nodeToFile[link.target];
    const sourceFile = nodeToFile[link.source];
    if (targetFile && sourceFile && targetFile !== sourceFile) {
      fileInDegree[targetFile] = (fileInDegree[targetFile] || 0) + 1;
    }
  }

  const sortedFiles = Object.entries(fileInDegree)
    .sort((a, b) => b[1] - a[1]);

  return {
    available: true,
    fileInDegree,
    topHubs: sortedFiles.slice(0, 15)
  };
}

export function writeRef(repoRoot) {
  const sha = headSha(repoRoot);
  if (sha) writeText(path.join(repoRoot, REF_REL), sha);
  return sha;
}

// missing | stale | fresh  (relative to the current HEAD)
export function graphStatus(repoRoot, head = headSha(repoRoot)) {
  if (!graphExists(repoRoot)) return 'missing';
  if (!head) return 'unknown';
  return readRef(repoRoot) === head ? 'fresh' : 'stale';
}

// First build: code-only AST (deterministic, no LLM key).
export function buildGraph(repoRoot) {
  const res = run(['extract', '.', '--code-only'], repoRoot);
  if (res.status === 0) writeRef(repoRoot);
  return res;
}

// Incremental code refresh (no LLM key).
export function refreshGraph(repoRoot) {
  const res = run(['update', '.'], repoRoot);
  if (res.status === 0) writeRef(repoRoot);
  return res;
}

// Build if missing, refresh if stale for `head`.
export function ensureFreshGraph(repoRoot, head = headSha(repoRoot)) {
  const status = graphStatus(repoRoot, head);
  if (status === 'missing') return { status, result: buildGraph(repoRoot) };
  if (status === 'stale') return { status, result: refreshGraph(repoRoot) };
  return { status };
}

export function graphifyQuery(repoRoot, question) {
  return run(['query', question], repoRoot);
}

// Idempotently add a line to .gitignore. Returns true if it changed the file.
export function ensureGitignore(repoRoot, line = GITIGNORE_LINE) {
  const p = path.join(repoRoot, '.gitignore');
  const cur = exists(p) ? readText(p) : '';
  if (cur.split(/\r?\n/).some((l) => l.trim() === line)) return false;
  const sep = cur && !cur.endsWith('\n') ? '\n' : '';
  writeText(p, `${cur}${sep}${line}\n`);
  return true;
}
