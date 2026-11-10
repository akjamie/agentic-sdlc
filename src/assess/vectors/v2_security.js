import path from 'node:path';
import { exists, readText } from '../../lib/fs.js';
import { git } from '../../lib/git.js';
import { HARD_RULES, isTestOrDocFile, CANONICAL_DESTRUCTIVE_PATTERN } from '../rules/builtin.js';
import { scanDiffForSecrets } from '../secrets.js';
import { analyzeFileSemantics, batchAnalyzeFileSemantics } from '../semantics.js';

export function evaluateV2Security({ requirement = '', changedFiles = [], repoRoot = null, baseRef = null, diffText = null, fileSemantics = null } = {}) {
  const req = String(requirement || '').toLowerCase();
  const evidence = [];
  const unresolved = [];
  let level = 'L1';
  let confidence = 'high';
  let mandatory_human_review = false;
  let no_signal = true;

  const semanticsMap = fileSemantics || batchAnalyzeFileSemantics(changedFiles, { repoRoot, baseRef });

  // 1a. Scan diff or changed files for plaintext secrets
  let secretFindings = [];
  if (diffText) {
    secretFindings = scanDiffForSecrets(diffText);
  } else if (repoRoot) {
    for (const f of changedFiles) {
      const fullPath = path.isAbsolute(f) ? f : path.join(repoRoot, f);
      if (exists(fullPath)) {
        try {
          const content = readText(fullPath);
          const sf = scanDiffForSecrets(content);
          if (sf.length > 0) secretFindings.push(...sf.map((s) => ({ ...s, file: f })));
        } catch { /* ignore binary / unreadable */ }
      }
    }
  }

  if (secretFindings.length > 0) {
    level = 'L3';
    no_signal = false;
    mandatory_human_review = true;
    evidence.push({
      id: 'V2_HARD_SECRET_LEAK',
      kind: 'secret_leak',
      rule_id: 'HARD_SECURITY_CREDENTIALS',
      signal: 'hard',
      summary: `Plaintext credential detected in changed code (${secretFindings.map((s) => `${s.rule}:${s.redacted}`).slice(0, 3).join(', ')})`,
      source: secretFindings[0].file || 'diff'
    });
  }

  // 1b. Check for deleted sensitive files (fallback to baseRef)
  if (repoRoot && baseRef) {
    for (const f of changedFiles) {
      const fullPath = path.isAbsolute(f) ? f : path.join(repoRoot, f);
      const norm = f.replace(/\\/g, '/');
      if (!exists(fullPath)) {
        try {
          const cached = semanticsMap.get(f);
          const oldContent = cached ? cached.oldContent : git(['show', `${baseRef}:${norm}`], repoRoot, { allowFail: true });
          if (oldContent) {
            const isSecurity = /@EnableWebSecurity|SecurityConfig|JwtAuthenticationFilter|jwt\.sign|passport|fastapi\.security/i.test(oldContent);
            const isDestructive = CANONICAL_DESTRUCTIVE_PATTERN.test(oldContent);
            if (isSecurity || isDestructive || /(auth|security|session|mfa|kms)/i.test(norm)) {
              level = 'L3';
              no_signal = false;
              mandatory_human_review = true;
              evidence.push({
                id: 'V2_DELETED_SECURITY',
                kind: 'deleted_security',
                rule_id: 'HARD_SECURITY_CREDENTIALS',
                signal: 'hard',
                summary: `Deleted high-risk security configuration or destructive migration from base: ${norm}`,
                source: norm
              });
            }
          }
        } catch { /* ignore */ }
      }
    }
  }

  // 1c. Check Hard Rules against physical files
  const securityRules = HARD_RULES.filter((r) =>
    ['HARD_GOV_PLANE', 'HARD_SECURITY_CREDENTIALS', 'HARD_FINANCIAL_ASSETS', 'HARD_DESTRUCTIVE_DDL'].includes(r.id)
  );

  for (const rule of securityRules) {
    const hits = changedFiles.filter((f) => {
      // Exclude test and documentation files from security/credentials (never exclude governance plane or destructive DDL) (P1-4)
      if (rule.id !== 'HARD_GOV_PLANE' && rule.id !== 'HARD_DESTRUCTIVE_DDL' && isTestOrDocFile(f)) return false;
      const norm = f.replace(/\\/g, '/');
      if (rule.patterns.some((p) => p.test(norm))) return true;
      // Content-level or name-level DDL check for SQL files (P1-2)
      if (rule.id === 'HARD_DESTRUCTIVE_DDL' && /\.(sql)$/i.test(norm)) {
        if (/drop|truncate|purge|destructive/i.test(norm)) return true;
        if (repoRoot) {
          const fullPath = path.isAbsolute(f) ? f : path.join(repoRoot, f);
          if (exists(fullPath)) {
            const sqlContent = readText(fullPath);
            if (CANONICAL_DESTRUCTIVE_PATTERN.test(sqlContent)) return true;
          }
        }
      }
      return false;
    });

    if (hits.length > 0) {
      level = 'L3';
      no_signal = false;
      mandatory_human_review = rule.mandatory_human_review;
      evidence.push({
        id: `V2_${rule.id}`,
        kind: 'rule_hit',
        rule_id: rule.id,
        signal: 'hard',
        summary: `${rule.summary} (${hits.slice(0, 3).join(', ')})`,
        source: hits[0]
      });
    }
  }

  // 2. Static Semantics Engine: Check L3 security / credentials / middleware / auth
  for (const f of changedFiles) {
    if (isTestOrDocFile(f)) continue;
    const sem = semanticsMap.get(f) || analyzeFileSemantics({ filePath: f, allChangedFiles: changedFiles });
    if (sem && sem.level === 'L3') {
      level = 'L3';
      no_signal = false;
      mandatory_human_review = true;
      for (const sig of sem.signals.filter((s) => s.level === 'L3')) {
        evidence.push({
          id: `V2_${sig.id}`,
          kind: 'static_semantics',
          signal: 'hard',
          summary: sig.summary,
          source: f
        });
      }
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
