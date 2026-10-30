import fs from 'node:fs';
import path from 'node:path';
import { HARD_RULES, isTestOrDocFile } from '../rules/builtin.js';
import { getGraphTopologyMetrics } from '../../lib/graphify.js';

export function evaluateV3Topology({ requirement = '', changedFiles = [], repoRoot = null, changeId = null } = {}) {
  const req = String(requirement || '').toLowerCase();
  const evidence = [];
  const unresolved = [];
  let level = 'L1';
  let confidence = 'high';
  let mandatory_human_review = false;
  let no_signal = true;

  // 1. Check Hard Rules for Topology / Contracts / Infra
  const topoRules = HARD_RULES.filter((r) =>
    ['HARD_API_CONTRACT', 'HARD_DB_MIGRATION', 'HARD_SUPPLY_CHAIN'].includes(r.id)
  );

  const API_CONTENT_PATTERNS = [
    /@(RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\b/,
    /@(app|router)\.(get|post|put|delete|patch)\b/,
    /\b(APIRouter|gin\.Default|router\.HandleFunc)\b/
  ];

  for (const rule of topoRules) {
    const hits = changedFiles.filter((f) => {
      if (isTestOrDocFile(f)) return false;
      const norm = f.replace(/\\/g, '/');
      if (rule.patterns.some((p) => p.test(norm))) return true;

      // Content-based heuristic for API handlers in source files
      if (rule.id === 'HARD_API_CONTRACT' && repoRoot && /\.(java|kt|py|go|ts|js)$/i.test(norm)) {
        try {
          const fullPath = path.isAbsolute(f) ? f : path.join(repoRoot, f);
          if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (API_CONTENT_PATTERNS.some((p) => p.test(content))) return true;
          }
        } catch { /* ignore read failure */ }
      }
      return false;
    });

    if (hits.length > 0) {
      level = 'L2';
      no_signal = false;
      evidence.push({
        id: `V3_${rule.id}`,
        kind: 'rule_hit',
        rule_id: rule.id,
        signal: 'hard',
        summary: `${rule.summary} (${hits.slice(0, 3).join(', ')})`,
        source: hits[0]
      });
    }
  }

  // Check CI Tooling Rule
  const ciRule = HARD_RULES.find((r) => r.id === 'HARD_CI_TOOLING');
  if (ciRule) {
    const ciHits = changedFiles.filter((f) => ciRule.patterns.some((p) => p.test(f.replace(/\\/g, '/'))));
    if (ciHits.length > 0) {
      no_signal = false;
      evidence.push({
        id: 'V3_HARD_CI_TOOLING',
        kind: 'rule_hit',
        rule_id: ciRule.id,
        signal: 'hard',
        summary: `${ciRule.summary} (${ciHits.slice(0, 3).join(', ')})`,
        source: ciHits[0]
      });
    }
  }

  // 2. Graphify AST Knowledge Graph Centrality & God Nodes Check
  // Escalates to L2 if changed files touch architectural hubs with high cross-file fan-in
  if (repoRoot) {
    try {
      const topoMetrics = getGraphTopologyMetrics(repoRoot);
      if (topoMetrics.available && topoMetrics.fileInDegree) {
        // High centrality threshold: >= 20 cross-file inbound dependencies
        // Exclude purely peripheral utility loggers or formats
        const GOD_NODE_THRESHOLD = 20;
        const hitHubs = [];

        // Check 1: Physical changed files
        for (const f of changedFiles) {
          if (isTestOrDocFile(f)) continue;
          const norm = f.replace(/\\/g, '/');
          if (/(^|\/)(log|logger|logging|cliutil)\.[a-z0-9]+$/i.test(norm)) continue; // ignore pure logger / cli wrappers
          const inDegree = topoMetrics.fileInDegree[norm] || 0;
          if (inDegree >= GOD_NODE_THRESHOLD) {
            hitHubs.push({ file: norm, inDegree });
          }
        }

        // Check 2: If stage: new without changedFiles yet, ground in explore.md query if present
        // IMPORTANT: Only match against the ## Query: section to prevent false-positives
        // from the global ## Architectural hubs (god nodes) header.
        if (hitHubs.length === 0 && changeId) {
          try {
            const expPath = path.join(repoRoot, 'openspec', 'changes', changeId, 'explore.md');
            if (fs.existsSync(expPath)) {
              const expContent = fs.readFileSync(expPath, 'utf8');
              const queryMatch = expContent.match(/##\s*Query:[^\n]*\n([\s\S]*?)(?:\n##\s|$)/i);
              const queryContent = queryMatch ? queryMatch[1] : '';
              if (queryContent && !queryContent.includes('_(no matches)_') && !queryContent.includes('_(unavailable')) {
                for (const [hubFile, inDeg] of (topoMetrics.topHubs || [])) {
                  if (inDeg >= GOD_NODE_THRESHOLD && !/(^|\/)(log|logger|logging|cliutil)\.[a-z0-9]+$/i.test(hubFile)) {
                    const baseName = path.basename(hubFile);
                    if (queryContent.includes(hubFile) || queryContent.includes(baseName)) {
                      hitHubs.push({ file: hubFile, inDegree: inDeg });
                    }
                  }
                }
              }
            }
          } catch { /* ignore explore read */ }
        }

        if (hitHubs.length > 0) {
          no_signal = false;
          if (level === 'L1') {
            level = 'L2';
          }
          const hubDesc = hitHubs.slice(0, 3).map((h) => `${h.file} (${h.inDegree} inbound refs)`).join(', ');
          evidence.push({
            id: 'V3_GRAPHIFY_GOD_NODE',
            kind: 'topology_centrality',
            signal: 'hard',
            summary: `Touches Graphify AST architectural hub: ${hubDesc}`,
            source: hitHubs[0].file
          });
        }
      }
    } catch {
      /* ignore graph metrics reading failure */
    }
  }

  // 3. Check Requirement Semantics for Architecture / Schema / Infra
  const topoKeywords = [
    'api', 'endpoint', 'openapi', 'swagger', 'grpc', 'protobuf', 'graphql', 'webhook',
    'fastapi', 'springboot', 'spring boot', 'controller', 'rest api', 'router',
    'database', 'migration', 'schema', 'db table', 'database table', 'sql table', 'ddl', 'model', 'docker', 'k8s', 'helm'
  ];

  for (const kw of topoKeywords) {
    const re = new RegExp(`\\b${kw.replace(/-/g, '[-\\s]')}\\b`, 'i');
    if (re.test(req)) {
      no_signal = false;
      if (level === 'L1') {
        level = 'L2';
      }
      evidence.push({
        id: 'V3_TOPOLOGY_KEYWORD',
        kind: 'task_statement',
        signal: 'soft',
        summary: `Requirement touches cross-boundary architectural keyword: '${kw}'`
      });
      break;
    }
  }

  return {
    level,
    confidence,
    evidence,
    unresolved,
    mandatory_human_review,
    no_signal
  };
}
